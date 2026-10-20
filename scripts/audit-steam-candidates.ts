import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const TARGET_GAMES = [
  { internalGameId: 3328, appId: "292030", title: "The Witcher 3: Wild Hunt" },
  { internalGameId: 13536, appId: "400", title: "Portal" },
  { internalGameId: 4200, appId: "620", title: "Portal 2" },
  { internalGameId: 802, appId: "49520", title: "Borderlands 2" },
  { internalGameId: 9767, appId: "367520", title: "Hollow Knight" },
] as const;

const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;
const STEAM_REQUEST_TIMEOUT_MS = 8_000;

type PlatformName = (typeof PLATFORM_NAMES)[number];
type SteamStatus = "sucesso" | "indisponivel" | "falha";
type SupabaseStatus =
  | "sucesso"
  | "nao_encontrado"
  | "duplicado"
  | "configuracao_ausente"
  | "falha"
  | "resposta_invalida";

interface SupabaseGameRow {
  id: unknown;
  name: unknown;
  platforms: unknown;
}

interface SteamGameDetails {
  officialName: string;
  platforms: PlatformName[];
}

interface SteamLookupResult {
  status: SteamStatus;
  details: SteamGameDetails | null;
  error?: string;
}

interface PlatformDivergence {
  platform: PlatformName;
  supabase: boolean;
  steam: boolean;
}

interface AuditResult {
  internalGameId: number;
  appId: string;
  supabaseName: string | null;
  steamOfficialName: string | null;
  steamPlatforms: PlatformName[] | null;
  supabasePlatforms: PlatformName[] | null;
  divergences: PlatformDivergence[] | null;
  status: "sucesso" | "parcial" | "falha";
  steamStatus: SteamStatus;
  supabaseStatus: SupabaseStatus;
  steamError?: string;
  supabaseError?: string;
}

type SupabaseReadResult =
  | { status: "sucesso"; rows: SupabaseGameRow[] }
  | {
      status: "falha";
      rows: [];
      error: "configuracao_ausente" | "consulta_falhou";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInternalGameId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const internalGameId = Number(value.trim());
    return Number.isSafeInteger(internalGameId) && internalGameId > 0
      ? internalGameId
      : null;
  }

  return null;
}

function parseSupabasePlatforms(value: unknown): PlatformName[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return PLATFORM_NAMES.filter((platform) => value.includes(platform));
}

function getDivergences(
  supabasePlatforms: PlatformName[],
  steamPlatforms: PlatformName[],
): PlatformDivergence[] {
  const supabaseSet = new Set(supabasePlatforms);
  const steamSet = new Set(steamPlatforms);

  return PLATFORM_NAMES
    .filter((platform) => supabaseSet.has(platform) !== steamSet.has(platform))
    .map((platform) => ({
      platform,
      supabase: supabaseSet.has(platform),
      steam: steamSet.has(platform),
    }));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

function failedSteamLookup(error: string): SteamLookupResult {
  return { status: "falha", details: null, error };
}

async function lookupSteamGame(appId: string): Promise<SteamLookupResult> {
  let response: Response;

  try {
    response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}`,
      { signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS) },
    );
  } catch (error) {
    return failedSteamLookup(isTimeoutError(error) ? "timeout" : "erro_de_rede");
  }

  if (!response.ok) {
    return failedSteamLookup(`http_${response.status}`);
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

    return failedSteamLookup(failure);
  }

  const appResult = isRecord(payload) ? payload[appId] : undefined;
  if (isRecord(appResult) && appResult.success === false) {
    return { status: "indisponivel", details: null, error: "app_indisponivel" };
  }

  if (!isRecord(appResult) || appResult.success !== true || !isRecord(appResult.data)) {
    return failedSteamLookup("resposta_invalida");
  }

  const { name, platforms } = appResult.data;
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    !isRecord(platforms) ||
    typeof platforms.windows !== "boolean" ||
    typeof platforms.mac !== "boolean" ||
    typeof platforms.linux !== "boolean"
  ) {
    return failedSteamLookup("resposta_invalida");
  }

  const steamPlatforms = PLATFORM_NAMES.filter((platform) => {
    const fieldByPlatform: Record<PlatformName, string> = {
      Windows: "windows",
      Mac: "mac",
      Linux: "linux",
    };
    return platforms[fieldByPlatform[platform]] === true;
  });

  return {
    status: "sucesso",
    details: { officialName: name.trim(), platforms: steamPlatforms },
  };
}

async function readSupabaseGames(): Promise<SupabaseReadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return { status: "falha", rows: [], error: "configuracao_ausente" };
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase
      .from("games")
      .select("id,name,platforms")
      .in("id", TARGET_GAMES.map(({ internalGameId }) => internalGameId));

    if (error) {
      return { status: "falha", rows: [], error: "consulta_falhou" };
    }

    return { status: "sucesso", rows: (data ?? []) as SupabaseGameRow[] };
  } catch {
    return { status: "falha", rows: [], error: "consulta_falhou" };
  }
}

function makeAuditResult(
  target: (typeof TARGET_GAMES)[number],
  steamResult: SteamLookupResult,
  supabaseResult: SupabaseReadResult,
): AuditResult {
  let supabaseName: string | null = null;
  let supabasePlatforms: PlatformName[] | null = null;
  let supabaseStatus: SupabaseStatus;
  let supabaseError: string | undefined;

  if (supabaseResult.status === "falha") {
    supabaseStatus = supabaseResult.error === "configuracao_ausente"
      ? "configuracao_ausente"
      : "falha";
    supabaseError = supabaseResult.error;
  } else {
    const matchingRows = supabaseResult.rows.filter(
      (row) => normalizeInternalGameId(row.id) === target.internalGameId,
    );

    if (matchingRows.length === 0) {
      supabaseStatus = "nao_encontrado";
    } else if (matchingRows.length > 1) {
      supabaseStatus = "duplicado";
    } else {
      const [row] = matchingRows;
      const parsedPlatforms = parseSupabasePlatforms(row.platforms);

      if (typeof row.name !== "string" || parsedPlatforms === null) {
        supabaseStatus = "resposta_invalida";
      } else {
        supabaseName = row.name;
        supabasePlatforms = parsedPlatforms;
        supabaseStatus = "sucesso";
      }
    }
  }

  const steamPlatforms = steamResult.details?.platforms ?? null;
  const status = steamResult.status === "sucesso" && supabaseStatus === "sucesso"
    ? "sucesso"
    : steamResult.status === "falha" &&
        (supabaseStatus === "falha" || supabaseStatus === "configuracao_ausente")
      ? "falha"
      : "parcial";

  return {
    internalGameId: target.internalGameId,
    appId: target.appId,
    supabaseName,
    steamOfficialName: steamResult.details?.officialName ?? null,
    steamPlatforms,
    supabasePlatforms,
    divergences: steamPlatforms !== null && supabasePlatforms !== null
      ? getDivergences(supabasePlatforms, steamPlatforms)
      : null,
    status,
    steamStatus: steamResult.status,
    supabaseStatus,
    ...(steamResult.error ? { steamError: steamResult.error } : {}),
    ...(supabaseError ? { supabaseError } : {}),
  };
}

async function runAudit(): Promise<void> {
  const [supabaseResult, steamResults] = await Promise.all([
    readSupabaseGames(),
    Promise.all(TARGET_GAMES.map(({ appId }) => lookupSteamGame(appId))),
  ]);

  const results = TARGET_GAMES.map((target, index) =>
    makeAuditResult(target, steamResults[index], supabaseResult),
  );

  console.log(JSON.stringify({ results }, null, 2));
}

runAudit().catch(() => {
  console.error("Auditoria interrompida: falha inesperada ao consultar as fontes.");
  process.exitCode = 1;
});