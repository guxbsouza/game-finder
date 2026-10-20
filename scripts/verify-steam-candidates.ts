import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requireFromProject = createRequire(join(process.cwd(), "package.json"));
const { loadEnvConfig } = requireFromProject("@next/env") as typeof import("@next/env");

loadEnvConfig(process.cwd());

const STEAM_APP_DETAILS_URL = "https://store.steampowered.com/api/appdetails";
const STEAM_REQUEST_TIMEOUT_MS = 8_000;
const STEAM_REQUEST_DELAY_MS = 250;

interface SteamCandidate {
  expectedName: string;
  appId: string;
  reviewReason?: string;
}

const CANDIDATES: SteamCandidate[] = [
  { expectedName: "Rise of the Tomb Raider", appId: "391220" },
  { expectedName: "Apex Legends", appId: "1172470" },
  { expectedName: "The Witcher: Enhanced Edition Director's Cut", appId: "20900" },
  { expectedName: "Half-Life 2: Deathmatch", appId: "320" },
  { expectedName: "Fallout 4", appId: "377160" },
  { expectedName: "LIMBO", appId: "48000" },
  { expectedName: "PAYDAY 2", appId: "218620" },
  { expectedName: "Cyberpunk 2077", appId: "1091500" },
  { expectedName: "Team Fortress 2", appId: "440" },
  {
    expectedName: "Grand Theft Auto IV",
    appId: "12210",
    reviewReason: "edicao_complete_edition_requer_revisao",
  },
  {
    expectedName: "Metro 2033",
    appId: "286690",
    reviewReason: "edicao_redux_requer_revisao",
  },
  { expectedName: "Batman: Arkham Knight", appId: "208650" },
  {
    expectedName: "Grand Theft Auto: San Andreas",
    appId: "1547000",
    reviewReason: "edicao_definitive_edition_requer_revisao",
  },
  { expectedName: "METAL GEAR SOLID V: The Phantom Pain", appId: "287700" },
  { expectedName: "The Witcher 2: Assassins of Kings Enhanced Edition", appId: "20920" },
  { expectedName: "Middle-earth: Shadow of Mordor", appId: "241930" },
  { expectedName: "Little Nightmares", appId: "424840" },
  { expectedName: "BioShock 2", appId: "8850" },
  { expectedName: "Dark Souls III", appId: "374320" },
  { expectedName: "Stardew Valley", appId: "413150" },
  { expectedName: "Mirror's Edge", appId: "17410" },
  { expectedName: "BioShock Remastered", appId: "409710" },
  { expectedName: "Dota 2", appId: "570" },
  { expectedName: "Warframe", appId: "230410" },
  {
    expectedName: "Horizon Zero Dawn",
    appId: "1151640",
    reviewReason: "edicao_ambigua_requer_revisao_manual",
  },
  {
    expectedName: "Horizon Zero Dawn",
    appId: "2561580",
    reviewReason: "edicao_ambigua_requer_revisao_manual",
  },
  { expectedName: "Destiny 2", appId: "1085660" },
  { expectedName: "The Witcher 3: Wild Hunt", appId: "292030" },
  { expectedName: "Portal", appId: "400" },
  { expectedName: "Portal 2", appId: "620" },
  { expectedName: "Borderlands 2", appId: "49520" },
  { expectedName: "Hollow Knight", appId: "367520" },
] as const;

const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;

type PlatformName = (typeof PLATFORM_NAMES)[number];
type VerificationStatus = "aprovavel" | "revisao_manual" | "falha";

interface CatalogGameRow {
  id: unknown;
  name: unknown;
  steam_app_id: unknown;
  platforms: unknown;
  platform_availability: unknown;
}

interface SteamProductDetails {
  officialName: string;
  productType: string;
  platforms: PlatformName[];
}

type CatalogReadResult =
  | { status: "sucesso"; rows: CatalogGameRow[] }
  | { status: "falha"; error: string };

type SteamLookupResult =
  | { status: "sucesso"; details: SteamProductDetails }
  | { status: "falha"; error: string };

export interface CandidateVerification {
  expectedName: string;
  internalGameId: string | number | null;
  catalogName: string | null;
  storedSteamAppId: unknown;
  current: {
    steam_app_id: unknown;
    platforms: unknown;
    platform_availability: unknown;
  } | null;
  candidateSteamAppId: string;
  officialName: string | null;
  productType: string | null;
  steamPlatforms: PlatformName[] | null;
  status: VerificationStatus;
  reason?: string;
}

export interface CandidateVerificationReport {
  generatedAt: string;
  catalogStatus: "sucesso" | "falha";
  results: CandidateVerification[];
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

function normalizeStoredAppId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const appId = Number(value.trim());
    return Number.isSafeInteger(appId) && appId > 0 ? String(appId) : null;
  }

  return null;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

async function readCatalogGames(): Promise<CatalogReadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return { status: "falha", error: "configuracao_supabase_ausente" };
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
      .select("id,name,steam_app_id,platforms,platform_availability");

    if (error || !Array.isArray(data) || !data.every(isRecord)) {
      return { status: "falha", error: "leitura_supabase_falhou" };
    }

    return { status: "sucesso", rows: data as CatalogGameRow[] };
  } catch {
    return { status: "falha", error: "leitura_supabase_falhou" };
  }
}

async function lookupSteamProduct(appId: string): Promise<SteamLookupResult> {
  const url = new URL(STEAM_APP_DETAILS_URL);
  url.searchParams.set("appids", appId);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "falha",
      error: isTimeoutError(error) ? "timeout" : "erro_de_rede",
    };
  }

  if (!response.ok) {
    return { status: "falha", error: `http_${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const reason = isTimeoutError(error)
      ? "timeout"
      : error instanceof SyntaxError
        ? "json_invalido"
        : "erro_ao_ler_resposta";

    return { status: "falha", error: reason };
  }

  const appResult = isRecord(payload) ? payload[appId] : undefined;
  if (isRecord(appResult) && appResult.success === false) {
    return { status: "falha", error: "produto_indisponivel" };
  }

  if (!isRecord(appResult) || appResult.success !== true || !isRecord(appResult.data)) {
    return { status: "falha", error: "resposta_invalida" };
  }

  const { name, type, platforms } = appResult.data;
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof type !== "string" ||
    !isRecord(platforms) ||
    typeof platforms.windows !== "boolean" ||
    typeof platforms.mac !== "boolean" ||
    typeof platforms.linux !== "boolean"
  ) {
    return { status: "falha", error: "detalhes_invalidos" };
  }

  const fieldByPlatform: Record<PlatformName, string> = {
    Windows: "windows",
    Mac: "mac",
    Linux: "linux",
  };
  const steamPlatforms = PLATFORM_NAMES.filter(
    (platform) => platforms[fieldByPlatform[platform]] === true,
  );

  return {
    status: "sucesso",
    details: {
      officialName: name.trim(),
      productType: type.trim().toLowerCase(),
      platforms: steamPlatforms,
    },
  };
}

function findCatalogMatches(
  rows: CatalogGameRow[],
  expectedName: string,
): CatalogGameRow[] {
  const normalizedExpectedName = normalizeGameName(expectedName);
  return rows.filter(
    (row) => typeof row.name === "string" &&
      normalizeGameName(row.name) === normalizedExpectedName,
  );
}

function hasMultipleCatalogAssociations(
  candidate: SteamCandidate,
  catalogRows: CatalogGameRow[],
): string | null {
  const candidatesForAppId = CANDIDATES.filter(
    ({ appId }) => appId === candidate.appId,
  );
  const candidateNames = new Set(
    candidatesForAppId.map(({ expectedName }) => normalizeGameName(expectedName)),
  );

  if (candidateNames.size > 1) {
    return "app_id_candidato_listado_para_jogos_diferentes";
  }

  const rowsWithStoredAppId = catalogRows.filter(
    (row) => normalizeStoredAppId(row.steam_app_id) === candidate.appId,
  );
  if (rowsWithStoredAppId.length > 1) {
    return "steam_app_id_armazenado_em_multiplas_linhas";
  }

  const rowsMatchingCandidateName = catalogRows.filter(
    (row) => typeof row.name === "string" &&
      candidateNames.has(normalizeGameName(row.name)),
  );
  if (rowsMatchingCandidateName.length > 1) {
    return "candidato_corresponde_a_multiplas_linhas_do_catalogo";
  }

  const associatedRows = new Set([
    ...rowsWithStoredAppId,
    ...rowsMatchingCandidateName,
  ]);
  if (associatedRows.size > 1) {
    return "app_id_associado_a_linhas_diferentes_do_catalogo";
  }

  return null;
}

function makeVerification(
  candidate: SteamCandidate,
  catalogRows: CatalogGameRow[],
  steamResult: SteamLookupResult,
): CandidateVerification {
  const matches = findCatalogMatches(catalogRows, candidate.expectedName);
  const catalogRow = matches.length === 1 ? matches[0] : undefined;
  const catalogName = catalogRow && typeof catalogRow.name === "string"
    ? catalogRow.name
    : null;
  const internalGameId = catalogRow
    ? normalizeInternalGameId(catalogRow.id)
    : null;
  const current = catalogRow
    ? {
        steam_app_id: catalogRow.steam_app_id,
        platforms: catalogRow.platforms,
        platform_availability: catalogRow.platform_availability,
      }
    : null;
  const storedSteamAppId = catalogRow?.steam_app_id ?? null;

  if (steamResult.status === "falha") {
    return {
      expectedName: candidate.expectedName,
      internalGameId,
      catalogName,
      storedSteamAppId,
      current,
      candidateSteamAppId: candidate.appId,
      officialName: null,
      productType: null,
      steamPlatforms: null,
      status: "falha",
      reason: steamResult.error,
    };
  }

  const { details } = steamResult;
  let status: VerificationStatus = "aprovavel";
  let reason: string | undefined;
  const associationIssue = hasMultipleCatalogAssociations(candidate, catalogRows);

  if (associationIssue) {
    status = "revisao_manual";
    reason = associationIssue;
  } else if (matches.length === 0) {
    status = "revisao_manual";
    reason = "jogo_nao_encontrado_no_catalogo";
  } else if (matches.length > 1 || internalGameId === null) {
    status = "revisao_manual";
    reason = "correspondencia_ambigua_no_catalogo";
  } else if (details.productType !== "game") {
    status = "revisao_manual";
    reason = "produto_nao_classificado_como_jogo_principal";
  } else if (candidate.reviewReason) {
    status = "revisao_manual";
    reason = candidate.reviewReason;
  } else if (
    normalizeGameName(details.officialName) !== normalizeGameName(candidate.expectedName) ||
    normalizeGameName(details.officialName) !== normalizeGameName(catalogName ?? "")
  ) {
    status = "revisao_manual";
    reason = "nome_ou_edicao_nao_corresponde_exatamente";
  } else if (
    !isMissingSteamAppId(storedSteamAppId) &&
    normalizeStoredAppId(storedSteamAppId) !== candidate.appId
  ) {
    status = "revisao_manual";
    reason = "app_id_existente_diverge_do_candidato";
  }

  return {
    expectedName: candidate.expectedName,
    internalGameId,
    catalogName,
    storedSteamAppId,
    current,
    candidateSteamAppId: candidate.appId,
    officialName: details.officialName,
    productType: details.productType,
    steamPlatforms: details.platforms,
    status,
    ...(reason ? { reason } : {}),
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getSteamCandidateVerificationReport(): Promise<CandidateVerificationReport> {
  const catalogResult = await readCatalogGames();
  if (catalogResult.status === "falha") {
    return {
      generatedAt: new Date().toISOString(),
      catalogStatus: "falha",
      results: CANDIDATES.map((candidate) => ({
        expectedName: candidate.expectedName,
        internalGameId: null,
        catalogName: null,
        storedSteamAppId: null,
        current: null,
        candidateSteamAppId: candidate.appId,
        officialName: null,
        productType: null,
        steamPlatforms: null,
        status: "falha",
        reason: catalogResult.error,
      })),
    };
  }

  const prioritizedCandidates = [...CANDIDATES].sort((left, right) => {
    const leftRows = findCatalogMatches(catalogResult.rows, left.expectedName);
    const rightRows = findCatalogMatches(catalogResult.rows, right.expectedName);
    const leftNeedsAppId = leftRows.length === 1 &&
      isMissingSteamAppId(leftRows[0].steam_app_id);
    const rightNeedsAppId = rightRows.length === 1 &&
      isMissingSteamAppId(rightRows[0].steam_app_id);

    return Number(rightNeedsAppId) - Number(leftNeedsAppId);
  });

  const steamLookups: {
    candidate: SteamCandidate;
    steamResult: SteamLookupResult;
  }[] = [];
  for (const [index, candidate] of prioritizedCandidates.entries()) {
    if (index > 0) {
      await wait(STEAM_REQUEST_DELAY_MS);
    }

    const steamResult = await lookupSteamProduct(candidate.appId);
    steamLookups.push({ candidate, steamResult });
  }

  const latestCatalogResult = await readCatalogGames();
  if (latestCatalogResult.status === "falha") {
    return {
      generatedAt: new Date().toISOString(),
      catalogStatus: "falha",
      results: steamLookups.map(({ candidate, steamResult }) =>
        makeVerification(candidate, [], steamResult.status === "falha"
          ? steamResult
          : { status: "falha", error: latestCatalogResult.error })
      ),
    };
  }

  const results = steamLookups.map(({ candidate, steamResult }) =>
    makeVerification(candidate, latestCatalogResult.rows, steamResult),
  );

  return {
    generatedAt: new Date().toISOString(),
    catalogStatus: "sucesso",
    results,
  };
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  getSteamCandidateVerificationReport()
    .then((report) => {
      console.log(JSON.stringify({
        source: {
          supabase: "public.games (somente leitura)",
          steam: STEAM_APP_DETAILS_URL,
        },
        ...report,
      }, null, 2));
      if (report.catalogStatus === "falha") {
        process.exitCode = 1;
      }
    })
    .catch(() => {
      console.error("Verifica\\u00e7\\u00e3o interrompida: falha inesperada nas consultas.");
      process.exitCode = 1;
    });
}