import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;
const PLATFORM_STATUSES = ["verified", "unavailable", "unknown"] as const;
const STEAM_REQUEST_TIMEOUT_MS = 8_000;

type PlatformName = (typeof PLATFORM_NAMES)[number];
type PlatformStatus = (typeof PLATFORM_STATUSES)[number];
type PlatformAvailabilityReport = Record<PlatformName, PlatformStatus | null>;

type AuditStatus =
  | "sem_app_id"
  | "app_id_invalido"
  | "dados_supabase_invalidos"
  | "falha_consulta"
  | "divergencia"
  | "sem_divergencias";

interface SupabaseGameRow {
  id: unknown;
  name: unknown;
  platforms: unknown;
  platform_availability: unknown;
  steam_app_id: unknown;
}

interface PlatformDivergence {
  platform: PlatformName;
  supabase: boolean;
  steam: boolean;
}

interface AuditResult {
  id: string | number | null;
  name: string | null;
  steamAppId: string | null;
  supabasePlatforms: PlatformName[] | null;
  platformAvailability: PlatformAvailabilityReport | null;
  steamPlatforms: PlatformName[] | null;
  status: AuditStatus;
  error?: string;
  divergences: PlatformDivergence[] | null;
}

type SteamLookupResult =
  | { status: "sucesso"; platforms: PlatformName[] }
  | { status: "falha"; platforms: null; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlatforms(value: unknown): PlatformName[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedPlatforms = new Set(
    value
      .filter((platform): platform is string => typeof platform === "string")
      .map((platform) => platform.trim().toLowerCase()),
  );

  return PLATFORM_NAMES.filter((platform) =>
    normalizedPlatforms.has(platform.toLowerCase()) ||
    (platform === "Mac" && normalizedPlatforms.has("macos"))
  );
}

function parsePlatformAvailability(value: unknown): PlatformAvailabilityReport | null {
  if (!isRecord(value)) {
    return null;
  }

  const availability = {} as PlatformAvailabilityReport;

  for (const platform of PLATFORM_NAMES) {
    const status = value[platform];
    availability[platform] = typeof status === "string" &&
      PLATFORM_STATUSES.includes(status as PlatformStatus)
      ? status as PlatformStatus
      : null;
  }

  return availability;
}

function normalizeSteamAppId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numericAppId = Number(value.trim());
    return Number.isSafeInteger(numericAppId) && numericAppId > 0
      ? String(numericAppId)
      : null;
  }

  return null;
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

async function lookupSteamPlatforms(appId: string): Promise<SteamLookupResult> {
  let response: Response;

  try {
    response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}`,
      { signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS) },
    );
  } catch (error) {
    return {
      status: "falha",
      platforms: null,
      error: isTimeoutError(error) ? "timeout" : "erro_de_rede",
    };
  }

  if (!response.ok) {
    return {
      status: "falha",
      platforms: null,
      error: `http_${response.status}`,
    };
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

    return { status: "falha", platforms: null, error: failure };
  }

  const appResult = isRecord(payload) ? payload[appId] : undefined;
  if (!isRecord(appResult) || appResult.success !== true || !isRecord(appResult.data)) {
    return { status: "falha", platforms: null, error: "consulta_sem_detalhes" };
  }

  const platformFlags = appResult.data.platforms;
  if (!isRecord(platformFlags)) {
    return { status: "falha", platforms: null, error: "plataformas_ausentes" };
  }

  const steamFieldByPlatform: Record<PlatformName, string> = {
    Windows: "windows",
    Mac: "mac",
    Linux: "linux",
  };
  const hasPlatformData = PLATFORM_NAMES.every(
    (platform) => typeof platformFlags[steamFieldByPlatform[platform]] === "boolean",
  );

  if (!hasPlatformData) {
    return { status: "falha", platforms: null, error: "plataformas_ausentes" };
  }

  const platforms = PLATFORM_NAMES.filter(
    (platform) => platformFlags[steamFieldByPlatform[platform]] === true,
  );

  return { status: "sucesso", platforms };
}

async function readSupabaseGames(): Promise<SupabaseGameRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("missing_supabase_configuration");
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase
    .from("games")
    .select("id,name,platforms,platform_availability,steam_app_id");

  if (error || !Array.isArray(data) || !data.every(isRecord)) {
    throw new Error("supabase_read_failed");
  }

  return data as SupabaseGameRow[];
}

function normalizeGameId(value: unknown): string | number | null {
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runAudit(): Promise<void> {
  const rows = await readSupabaseGames();
  const results: AuditResult[] = [];
  let steamRequests = 0;

  for (const row of rows) {
    const id = normalizeGameId(row.id);
    const name = typeof row.name === "string" ? row.name : null;
    const supabasePlatforms = parsePlatforms(row.platforms);
    const platformAvailability = parsePlatformAvailability(row.platform_availability);

    if (isMissingSteamAppId(row.steam_app_id)) {
      results.push({
        id,
        name,
        steamAppId: null,
        supabasePlatforms,
        platformAvailability,
        steamPlatforms: null,
        status: "sem_app_id",
        divergences: null,
      });
      continue;
    }

    const steamAppId = normalizeSteamAppId(row.steam_app_id);
    if (!steamAppId) {
      results.push({
        id,
        name,
        steamAppId: null,
        supabasePlatforms,
        platformAvailability,
        steamPlatforms: null,
        status: "app_id_invalido",
        divergences: null,
      });
      continue;
    }

    if (id === null || name === null || supabasePlatforms === null) {
      results.push({
        id,
        name,
        steamAppId,
        supabasePlatforms,
        platformAvailability,
        steamPlatforms: null,
        status: "dados_supabase_invalidos",
        error: "id_nome_ou_plataformas_invalidos",
        divergences: null,
      });
      continue;
    }

    if (steamRequests > 0) {
      await wait(250);
    }
    steamRequests += 1;

    const steamResult = await lookupSteamPlatforms(steamAppId);
    if (steamResult.status === "falha") {
      results.push({
        id,
        name,
        steamAppId,
        supabasePlatforms,
        platformAvailability,
        steamPlatforms: null,
        status: "falha_consulta",
        error: steamResult.error,
        divergences: null,
      });
      continue;
    }

    const divergences = getDivergences(supabasePlatforms, steamResult.platforms);
    results.push({
      id,
      name,
      steamAppId,
      supabasePlatforms,
      platformAvailability,
      steamPlatforms: steamResult.platforms,
      status: divergences.length === 0 ? "sem_divergencias" : "divergencia",
      divergences,
    });
  }

  console.log(JSON.stringify({ results }, null, 2));
}

runAudit().catch(() => {
  console.error("Auditoria interrompida: falha ao ler o catálogo Supabase ou sua configuração.");
  process.exitCode = 1;
});
