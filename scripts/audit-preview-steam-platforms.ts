import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INPUT_PATH = resolve(process.cwd(), "preview-output.txt");
const OUTPUT_PATH = resolve(process.cwd(), "steam-platform-audit.json");
const STEAM_APP_DETAILS_URL = "https://store.steampowered.com/api/appdetails";
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_DELAY_MS = 500;
const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;

type PlatformName = (typeof PLATFORM_NAMES)[number];

interface PreviewCandidate {
  expectedName: unknown;
  catalogName: unknown;
  candidateSteamAppId: unknown;
  previewStatus: unknown;
  proposed: unknown;
}

interface ProposedValues {
  steam_app_id: unknown;
  platforms: unknown;
  platform_availability: unknown;
}

interface SteamDetails {
  officialName: string;
  productType: string;
  platformFlags: Record<"windows" | "mac" | "linux", boolean>;
  platforms: PlatformName[];
}

type SteamLookupResult =
  | { status: "sucesso"; details: SteamDetails }
  | { status: "falha"; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeAppId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numericId = Number(value.trim());
    return Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : null;
  }

  return null;
}

function isPlatformArray(value: unknown): value is PlatformName[] {
  return Array.isArray(value) && value.every(
    (platform): platform is PlatformName =>
      typeof platform === "string" &&
      (PLATFORM_NAMES as readonly string[]).includes(platform),
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

function readPreviewText(buffer: Buffer): string {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
    ? buffer.subarray(2).toString("utf16le")
    : buffer.toString("utf8").replace(/^\uFEFF/, "");
}

async function lookupSteamProduct(appId: string): Promise<SteamLookupResult> {
  const url = new URL(STEAM_APP_DETAILS_URL);
  url.searchParams.set("appids", appId);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "falha", error: isTimeoutError(error) ? "timeout" : "erro_de_rede" };
  }

  if (!response.ok) {
    return { status: "falha", error: `http_${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      status: "falha",
      error: isTimeoutError(error)
        ? "timeout"
        : error instanceof SyntaxError ? "json_invalido" : "erro_ao_ler_resposta",
    };
  }

  const appResult = isRecord(payload) ? payload[appId] : undefined;
  if (isRecord(appResult) && appResult.success === false) {
    return { status: "falha", error: "steam_success_false" };
  }

  if (!isRecord(appResult) || appResult.success !== true || !isRecord(appResult.data)) {
    return { status: "falha", error: "resposta_invalida" };
  }

  const { name, type, platforms } = appResult.data;
  if (
    typeof name !== "string" || name.trim() === "" ||
    typeof type !== "string" || !isRecord(platforms) ||
    typeof platforms.windows !== "boolean" ||
    typeof platforms.mac !== "boolean" ||
    typeof platforms.linux !== "boolean"
  ) {
    return { status: "falha", error: "detalhes_invalidos" };
  }

  const steamField: Record<PlatformName, string> = {
    Windows: "windows",
    Mac: "mac",
    Linux: "linux",
  };
  return {
    status: "sucesso",
    details: {
      officialName: name.trim(),
      productType: type.trim().toLowerCase(),
      platformFlags: {
        windows: platforms.windows,
        mac: platforms.mac,
        linux: platforms.linux,
      },
      platforms: PLATFORM_NAMES.filter((platform) => platforms[steamField[platform]] === true),
    },
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function auditCandidate(candidate: PreviewCandidate, steam: SteamLookupResult) {
  const expectedName = typeof candidate.expectedName === "string" ? candidate.expectedName : null;
  const catalogName = typeof candidate.catalogName === "string" ? candidate.catalogName : null;
  const candidateAppId = normalizeAppId(candidate.candidateSteamAppId);
  const proposed = isRecord(candidate.proposed)
    ? candidate.proposed as unknown as ProposedValues
    : null;
  const proposedAppId = normalizeAppId(proposed?.steam_app_id);
  const proposedPlatforms = proposed && isPlatformArray(proposed.platforms)
    ? proposed.platforms
    : null;
  const proposedAvailability = proposed && isRecord(proposed.platform_availability)
    ? proposed.platform_availability
    : null;
  const reasons: string[] = [];

  if (!expectedName || !catalogName || normalizeName(expectedName) !== normalizeName(catalogName)) {
    reasons.push("nome_do_catalogo_invalido_ou_divergente");
  }
  if (!candidateAppId || !proposedAppId || candidateAppId !== proposedAppId) {
    reasons.push("steam_app_id_candidato_ou_proposto_invalido_ou_divergente");
  }
  if (!proposedPlatforms || !proposedAvailability) {
    reasons.push("proposta_de_plataformas_ou_disponibilidade_invalida");
  }

  if (steam.status === "falha") {
    return {
      expectedName,
      catalogName,
      candidateSteamAppId: candidateAppId,
      proposed: candidate.proposed,
      steam: null,
      status: "falha_auditoria",
      reviewReasons: [...reasons, steam.error],
    };
  }

  if (!expectedName || normalizeName(expectedName) !== normalizeName(steam.details.officialName)) {
    reasons.push("nome_ou_edicao_steam_diverge");
  }
  if (steam.details.productType !== "game") {
    reasons.push("tipo_steam_nao_e_game");
  }

  const steamHasMac = steam.details.platforms.includes("Mac");
  const proposedHasMac = proposedPlatforms?.includes("Mac");
  if (proposedHasMac !== steamHasMac) {
    reasons.push("plataforma_mac_proposta_diverge_da_steam");
  }

  const expectedMacAvailability = steamHasMac ? "verified" : "unavailable";
  if (proposedAvailability?.Mac !== expectedMacAvailability) {
    reasons.push("disponibilidade_mac_proposta_diverge_da_steam");
  }

  const nonMacPlatformDifferences = PLATFORM_NAMES
    .filter((platform) => platform !== "Mac")
    .filter((platform) => proposedPlatforms?.includes(platform) !== steam.details.platforms.includes(platform))
    .map((platform) => ({
      platform,
      proposed: proposedPlatforms?.includes(platform) ?? false,
      steam: steam.details.platforms.includes(platform),
      note: "informativo: a regra da proposta preserva plataformas nao-Mac existentes",
    }));

  return {
    expectedName,
    catalogName,
    candidateSteamAppId: candidateAppId,
    proposed: candidate.proposed,
    steam: steam.details,
    status: reasons.length === 0 ? "confirmado" : "revisao_manual",
    reviewReasons: reasons,
    nonMacPlatformDifferences,
  };
}

async function runAudit(): Promise<void> {
  const rawPreview = await readFile(INPUT_PATH);
  const payload: unknown = JSON.parse(readPreviewText(rawPreview));
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("preview_output_invalido");
  }

  const candidates = payload.results.filter(
    (result): result is PreviewCandidate =>
      isRecord(result) && result.previewStatus === "autorizado",
  );
  const results = [];

  for (const [index, candidate] of candidates.entries()) {
    const appId = normalizeAppId(candidate.candidateSteamAppId);
    const steam = appId === null
      ? { status: "falha" as const, error: "steam_app_id_candidato_invalido" }
      : await lookupSteamProduct(appId);
    results.push(auditCandidate(candidate, steam));

    if (index < candidates.length - 1) {
      await wait(REQUEST_DELAY_MS);
    }
  }

  const successfulQueries = results.filter(({ steam }) => steam !== null).length;
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      preview: "preview-output.txt (somente leitura)",
      steam: STEAM_APP_DETAILS_URL,
      supabase: "nao_utilizado",
    },
    summary: {
      authorizedCandidatesRead: candidates.length,
      successfulSteamQueries: successfulQueries,
      failedSteamQueries: candidates.length - successfulQueries,
      confirmed: results.filter(({ status }) => status === "confirmado").length,
      manualReviewRequired: results.filter(({ status }) => status !== "confirmado").length,
    },
    results,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

runAudit().catch((error: unknown) => {
  console.error(error instanceof Error ? `Auditoria interrompida: ${error.message}` : "Auditoria interrompida.");
  process.exitCode = 1;
});
