import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const STEAM_STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/";
const STEAM_REQUEST_TIMEOUT_MS = 8_000;
const STEAM_REQUEST_DELAY_MS = 250;

interface SupabaseGameRow {
  id: unknown;
  name: unknown;
  steam_app_id: unknown;
}

interface SteamSearchCandidate {
  appId: number;
  officialName: string;
}

type SearchStatus =
  | "correspondencia_exata"
  | "revisao_manual"
  | "nao_encontrado"
  | "falha";

interface SearchResult {
  internalGameId: string | number | null;
  supabaseName: string | null;
  candidates: SteamSearchCandidate[];
  status: SearchStatus;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGameName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

function normalizeInternalGameId(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  return null;
}

function isMissingSteamAppId(value: unknown): boolean {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function makeSearchResult(
  internalGameId: string | number | null,
  supabaseName: string | null,
  candidates: SteamSearchCandidate[],
  status: SearchStatus,
  error?: string,
): SearchResult {
  return {
    internalGameId,
    supabaseName,
    candidates,
    status,
    ...(error ? { error } : {}),
  };
}

function parseCandidates(payload: unknown): SteamSearchCandidate[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return null;
  }

  const candidates: SteamSearchCandidate[] = [];
  const seenAppIds = new Set<number>();

  for (const item of payload.items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "number" ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0 ||
      typeof item.name !== "string" ||
      item.name.trim() === ""
    ) {
      return null;
    }

    if (!seenAppIds.has(item.id)) {
      candidates.push({ appId: item.id, officialName: item.name.trim() });
      seenAppIds.add(item.id);
    }
  }

  return candidates;
}

async function searchSteam(
  internalGameId: string | number | null,
  supabaseName: string,
): Promise<SearchResult> {
  const url = new URL(STEAM_STORE_SEARCH_URL);
  url.searchParams.set("term", supabaseName);
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "US");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return makeSearchResult(
      internalGameId,
      supabaseName,
      [],
      "falha",
      isTimeoutError(error) ? "timeout" : "erro_de_rede",
    );
  }

  if (!response.ok) {
    return makeSearchResult(
      internalGameId,
      supabaseName,
      [],
      "falha",
      `http_${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const failure = isTimeoutError(error)
      ? "timeout"
      : error instanceof SyntaxError
        ? "json_invalido"
        : "erro_ao_ler_resposta";

    return makeSearchResult(internalGameId, supabaseName, [], "falha", failure);
  }

  const candidates = parseCandidates(payload);
  if (!candidates) {
    return makeSearchResult(
      internalGameId,
      supabaseName,
      [],
      "falha",
      "resposta_invalida",
    );
  }

  const normalizedTitle = normalizeGameName(supabaseName);
  const exactMatches = candidates.filter(
    (candidate) => normalizeGameName(candidate.officialName) === normalizedTitle,
  );
  const status: SearchStatus = candidates.length === 1 && exactMatches.length === 1
    ? "correspondencia_exata"
    : candidates.length > 0
      ? "revisao_manual"
      : "nao_encontrado";

  return makeSearchResult(internalGameId, supabaseName, candidates, status);
}

async function readGamesWithoutSteamAppId(): Promise<SupabaseGameRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("supabase_configuration_missing");
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase
    .from("games")
    .select("id,name,steam_app_id");

  if (error || !Array.isArray(data) || !data.every(isRecord)) {
    throw new Error("supabase_read_failed");
  }

  return (data as SupabaseGameRow[]).filter((game) =>
    isMissingSteamAppId(game.steam_app_id)
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function discoverSteamAppIds(): Promise<void> {
  const games = await readGamesWithoutSteamAppId();
  const results: SearchResult[] = [];
  let searchCount = 0;

  for (const game of games) {
    const internalGameId = normalizeInternalGameId(game.id);
    const supabaseName = typeof game.name === "string" ? game.name.trim() : "";

    if (!supabaseName) {
      results.push(makeSearchResult(
        internalGameId,
        null,
        [],
        "falha",
        "nome_supabase_invalido",
      ));
      continue;
    }

    if (searchCount > 0) {
      await wait(STEAM_REQUEST_DELAY_MS);
    }
    searchCount += 1;
    results.push(await searchSteam(internalGameId, supabaseName));
  }

  console.log(JSON.stringify({
    source: {
      supabase: "public.games (somente leitura)",
      steam: STEAM_STORE_SEARCH_URL,
    },
    results,
  }, null, 2));
}

discoverSteamAppIds().catch(() => {
  console.error("Descoberta interrompida: falha inesperada na busca da Steam.");
  process.exitCode = 1;
});