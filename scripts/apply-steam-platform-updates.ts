import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  getSteamCandidateVerificationReport,
  type CandidateVerification,
  type CandidateVerificationReport,
} from "./verify-steam-candidates";

const requireFromProject = createRequire(join(process.cwd(), "package.json"));
const { loadEnvConfig } = requireFromProject("@next/env") as typeof import("@next/env");

loadEnvConfig(process.cwd());

const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;

type PlatformName = (typeof PLATFORM_NAMES)[number];


interface CatalogGameRow {
  id: unknown;
  name: unknown;
  steam_app_id: unknown;
  platforms: unknown;
  platform_availability: unknown;
}

interface AuthorizedUpdate {
  verification: AuthorizedCandidateVerification;
  current: NonNullable<CandidateVerification["current"]>;
  steamPlatforms: PlatformName[];
}

type AuthorizedCandidateVerification = CandidateVerification & {
  internalGameId: string | number;
  current: NonNullable<CandidateVerification["current"]>;
  steamPlatforms: PlatformName[];
};

interface UpdateResult {
  internalGameId: string | number;
  expectedName: string;
  candidateSteamAppId: string;
  status: "atualizado" | "falha" | "resultado_nao_confirmado" | "nao_tentado";
  error?: string;
  detail?: string;
}

interface CatalogReadResult {
  status: "sucesso" | "falha";
  rows: CatalogGameRow[];
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

function normalizeInternalGameId(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  return null;
}

function normalizeAppId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numericId = Number(value.trim());
    return Number.isSafeInteger(numericId) && numericId > 0
      ? String(numericId)
      : null;
  }

  return null;
}

function isMissingAppId(value: unknown): boolean {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

export function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function isPlatformArray(value: unknown): value is PlatformName[] {
  return Array.isArray(value) && value.every(
    (platform): platform is PlatformName =>
      typeof platform === "string" &&
      (PLATFORM_NAMES as readonly string[]).includes(platform),
  );
}

function isValidPlatformAvailability(
  value: unknown,
): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isValidVerification(
  verification: CandidateVerification,
): verification is AuthorizedCandidateVerification {
  const candidateAppId = normalizeAppId(verification.candidateSteamAppId);
  const currentAppId = verification.current?.steam_app_id;
  const storedAppId = verification.storedSteamAppId;
  const storedIdMatchesSnapshot = isMissingAppId(currentAppId) &&
    isMissingAppId(storedAppId) ||
    normalizeAppId(currentAppId) !== null &&
    normalizeAppId(currentAppId) === normalizeAppId(storedAppId);
  const currentIdMatchesCandidate = isMissingAppId(currentAppId) ||
    normalizeAppId(currentAppId) === candidateAppId;

  return verification.status === "aprovavel" &&
    verification.internalGameId !== null &&
    verification.catalogName !== null &&
    normalizeGameName(verification.catalogName) === normalizeGameName(verification.expectedName) &&
    verification.officialName !== null &&
    normalizeGameName(verification.officialName) === normalizeGameName(verification.expectedName) &&
    verification.productType === "game" &&
    candidateAppId !== null &&
    verification.current !== null &&
    currentAppId !== undefined &&
    storedIdMatchesSnapshot &&
    currentIdMatchesCandidate &&
    isPlatformArray(verification.current.platforms) &&
    isPlatformArray(verification.steamPlatforms) &&
    isValidPlatformAvailability(verification.current.platform_availability);
}

function toPostgresTextArray(platforms: readonly PlatformName[]): string {
  return `{${platforms.map((platform) => `"${platform}"`).join(",")}}`;
}

function sanitizeSupabaseErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : isRecord(error) && typeof error.message === "string"
      ? error.message
      : "erro_supabase_desconhecido";
  return message
    .replace(/https?:\/\/\S+/gi, "[url_redacted]")
    .replace(/(apikey|authorization|token|key)=?\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// These availability values are derived only from the verifier's validated Steam booleans.
export function createMacAvailability(
  currentAvailability: unknown,
  steamPlatforms: readonly PlatformName[],
): Record<string, unknown> {
  const availability =
    typeof currentAvailability === "object" &&
      currentAvailability !== null &&
      !Array.isArray(currentAvailability)
      ? { ...(currentAvailability as Record<string, unknown>) }
      : {};

  availability.Mac = steamPlatforms.includes("Mac")
    ? "verified"
    : "unavailable";

  return availability;
}

async function readCatalogRows(
  supabaseUrl: string,
  publishableKey: string,
  internalGameIds: Array<string | number>,
): Promise<CatalogReadResult> {
  try {
    const reader = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await reader
      .from("games")
      .select("id,name,steam_app_id,platforms,platform_availability")
      .in("id", internalGameIds);

    if (error || !Array.isArray(data) || !data.every(isRecord)) {
      return { status: "falha", rows: [], error: "leitura_supabase_falhou" };
    }

    return { status: "sucesso", rows: data as CatalogGameRow[] };
  } catch {
    return { status: "falha", rows: [], error: "leitura_supabase_falhou" };
  }
}

interface PreflightValidation {
  errors: string[];
  pendingUpdates: AuthorizedUpdate[];
  completedUpdates: AuthorizedUpdate[];
}

export interface CompletedUpdateResult {
  internalGameId: string | number;
  expectedName: string;
  candidateSteamAppId: string;
  status: "ja_atualizado";
}

export function toCompletedUpdateResults(
  updates: AuthorizedUpdate[],
): CompletedUpdateResult[] {
  return updates.map(({ verification }) => ({
    internalGameId: verification.internalGameId,
    expectedName: verification.expectedName,
    candidateSteamAppId: verification.candidateSteamAppId,
    status: "ja_atualizado" as const,
  }));
}

function getApprovedPlatforms(update: AuthorizedUpdate): PlatformName[] {
  const currentPlatforms = update.current.platforms as PlatformName[];
  return update.steamPlatforms.includes("Mac")
    ? [...new Set([...currentPlatforms, "Mac" as const])]
    : currentPlatforms.filter((platform) => platform !== "Mac");
}

function getApprovedAvailability(update: AuthorizedUpdate): Record<string, unknown> {
  return createMacAvailability(update.current.platform_availability, update.steamPlatforms);
}

function namesMatch(left: unknown, right: unknown): boolean {
  return String(left).trim().toLocaleLowerCase("en-US") ===
    String(right).trim().toLocaleLowerCase("en-US");
}

export function validatePreflightRows(
  updates: AuthorizedUpdate[],
  rows: CatalogGameRow[],
): PreflightValidation {
  const errors: string[] = [];
  const pendingUpdates: AuthorizedUpdate[] = [];
  const completedUpdates: AuthorizedUpdate[] = [];
  const expectedIds = new Set(updates.map(({ verification }) =>
    String(verification.internalGameId)
  ));

  if (rows.some((row) => {
    const id = normalizeInternalGameId(row.id);
    return id === null || !expectedIds.has(String(id));
  })) {
    errors.push("id_interno_inesperado_na_leitura");
  }

  for (const update of updates) {
    const { verification, current } = update;
    const matches = rows.filter(
      (row) => String(normalizeInternalGameId(row.id)) === String(verification.internalGameId),
    );

    if (matches.length !== 1) {
      errors.push(matches.length === 0
        ? `registro_ausente:${verification.internalGameId}`
        : `registro_duplicado:${verification.internalGameId}`);
      continue;
    }

    const [row] = matches;
    const isOriginal = namesMatch(row.name, verification.expectedName) &&
      normalizeAppId(row.steam_app_id) === normalizeAppId(current.steam_app_id) &&
      valuesMatch(row.platforms, current.platforms) &&
      valuesMatch(row.platform_availability, current.platform_availability);
    const isCompleted = namesMatch(row.name, verification.expectedName) &&
      normalizeAppId(row.steam_app_id) === normalizeAppId(verification.candidateSteamAppId) &&
      valuesMatch(row.platforms, getApprovedPlatforms(update)) &&
      valuesMatch(row.platform_availability, getApprovedAvailability(update));

    if (isOriginal) {
      pendingUpdates.push(update);
    } else if (isCompleted) {
      completedUpdates.push(update);
    } else {
      errors.push(`snapshot_divergente:${verification.internalGameId}`);
    }
  }

  return { errors, pendingUpdates, completedUpdates };
}

export function getAuthorizedUpdates(report: CandidateVerificationReport): {
  updates: AuthorizedUpdate[];
  blocked: Array<{ expectedName: string; appId: string; status: string; reason?: string }>;
  errors: string[];
} {
  const blocked = report.results
    .filter((verification) => verification.status !== "aprovavel")
    .map((verification) => ({
      expectedName: verification.expectedName,
      appId: verification.candidateSteamAppId,
      status: verification.status,
      ...(verification.reason ? { reason: verification.reason } : {}),
    }));
  const approved = report.results.filter(
    (verification) => verification.status === "aprovavel",
  );
  const updates: AuthorizedUpdate[] = [];
  const errors: string[] = [];
  const seenInternalIds = new Set<string>();
  const seenAppIds = new Map<string, string>();

  for (const verification of approved) {
    if (!isValidVerification(verification)) {
      errors.push(`verificacao_aprovavel_incompleta:${verification.candidateSteamAppId}`);
      continue;
    }

    const internalId = String(verification.internalGameId);
    const candidateName = normalizeGameName(verification.expectedName);
    const existingAppName = seenAppIds.get(verification.candidateSteamAppId);
    if (seenInternalIds.has(internalId)) {
      errors.push(`id_interno_autorizado_duplicado:${internalId}`);
      continue;
    }
    if (existingAppName && existingAppName !== candidateName) {
      errors.push(`app_id_autorizado_para_jogos_diferentes:${verification.candidateSteamAppId}`);
      continue;
    }

    seenInternalIds.add(internalId);
    seenAppIds.set(verification.candidateSteamAppId, candidateName);
    updates.push({
      verification,
      current: verification.current,
      steamPlatforms: verification.steamPlatforms,
    });
  }

  return { updates, blocked, errors };
}

async function applySteamPlatformUpdates(): Promise<void> {
  const verificationReport = await getSteamCandidateVerificationReport();
  const authorization = getAuthorizedUpdates(verificationReport);

  if (
    verificationReport.catalogStatus !== "sucesso" ||
    verificationReport.results.some(({ status }) => status === "falha") ||
    authorization.errors.length > 0 ||
    authorization.updates.length === 0
  ) {
    console.log(JSON.stringify({
      status: "abortado_antes_das_gravacoes",
      message: "Nenhum registro foi atualizado.",
      verificationTimestamp: verificationReport.generatedAt,
      blockedCandidates: authorization.blocked,
      errors: [
        ...(verificationReport.catalogStatus !== "sucesso" ? ["verificacao_supabase_falhou"] : []),
        ...(verificationReport.results.some(({ status }) => status === "falha")
          ? ["falha_na_verificacao_steam"]
          : []),
        ...authorization.errors,
        ...(authorization.updates.length === 0 ? ["nenhum_candidato_autorizado"] : []),
      ],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.log(JSON.stringify({
      status: "abortado_antes_das_gravacoes",
      message: "Nenhum registro foi atualizado.",
      blockedCandidates: authorization.blocked,
      errors: ["configuracao_supabase_ausente"],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const catalogPreflight = await readCatalogRows(
    supabaseUrl,
    publishableKey,
    authorization.updates.map(({ verification }) => verification.internalGameId),
  );
  if (catalogPreflight.status !== "sucesso") {
    console.log(JSON.stringify({
      status: "abortado_antes_das_gravacoes",
      message: "Nenhum registro foi atualizado.",
      blockedCandidates: authorization.blocked,
      errors: [catalogPreflight.error ?? "leitura_supabase_falhou"],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const preflight = validatePreflightRows(authorization.updates, catalogPreflight.rows);
  if (preflight.errors.length > 0) {
    console.log(JSON.stringify({
      status: "abortado_no_preflight",
      message: "Nenhum registro foi atualizado.",
      blockedCandidates: authorization.blocked,
      errors: preflight.errors,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const writer = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const results: UpdateResult[] = [];

  for (const [index, update] of preflight.pendingUpdates.entries()) {
    const { verification, current, steamPlatforms } = update;
    const currentPlatforms = current.platforms as PlatformName[];
    let result: UpdateResult;

    try {
      let query = writer
        .from("games")
        .update({
          steam_app_id: verification.candidateSteamAppId,
          platforms: steamPlatforms.includes("Mac")
            ? [...new Set([...currentPlatforms, "Mac" as const])]
            : currentPlatforms.filter((platform) => platform !== "Mac"),
          platform_availability: createMacAvailability(
            current.platform_availability,
            steamPlatforms,
          ),
        })
        .eq("id", verification.internalGameId)
        .ilike("name", escapeIlikePattern(verification.expectedName));

      if (current.steam_app_id === null || current.steam_app_id === undefined) {
        query = query.is("steam_app_id", null);
      } else {
        query = query.eq("steam_app_id", current.steam_app_id);
      }


      query = query.filter(
        "platforms",
        "eq",
        toPostgresTextArray(currentPlatforms),
      );

      if (current.platform_availability === null) {
        query = query.is("platform_availability", null);
      } else {
        query = query.filter(
          "platform_availability",
          "eq",
          JSON.stringify(current.platform_availability),
        );
      }

      const { data, error } = await query.select("id");
      if (error) {
        result = {
          internalGameId: verification.internalGameId,
          expectedName: verification.expectedName,
          candidateSteamAppId: verification.candidateSteamAppId,
          status: "falha",
          error: "update_falhou",
          detail: sanitizeSupabaseErrorMessage(error),
        };
      } else if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isRecord(data[0]) ||
        String(normalizeInternalGameId(data[0].id)) !== String(verification.internalGameId)
      ) {
        result = {
          internalGameId: verification.internalGameId,
          expectedName: verification.expectedName,
          candidateSteamAppId: verification.candidateSteamAppId,
          status: "resultado_nao_confirmado",
          error: "nao_foi_possivel_confirmar_uma_linha_atualizada",
        };
      } else {
        result = {
          internalGameId: verification.internalGameId,
          expectedName: verification.expectedName,
          candidateSteamAppId: verification.candidateSteamAppId,
          status: "atualizado",
        };
      }
    } catch {
      result = {
        internalGameId: verification.internalGameId,
        expectedName: verification.expectedName,
        candidateSteamAppId: verification.candidateSteamAppId,
        status: "resultado_nao_confirmado",
        error: "erro_inesperado_durante_update",
      };
    }

    results.push(result);
    if (result.status !== "atualizado") {
      results.push(...preflight.pendingUpdates.slice(index + 1).map(({ verification: remaining }) => ({
        internalGameId: remaining.internalGameId ?? "desconhecido",
        expectedName: remaining.expectedName,
        candidateSteamAppId: remaining.candidateSteamAppId,
        status: "nao_tentado" as const,
      })));
      break;
    }
  }

  const completed = results.length === preflight.pendingUpdates.length &&
    results.every(({ status }) => status === "atualizado");
  console.log(JSON.stringify({
    status: completed ? "concluido" : "parcial_ou_falha",
    verificationTimestamp: verificationReport.generatedAt,
    blockedCandidates: authorization.blocked,
    transaction: "sem_transacao; atualizacoes individuais nao sao revertidas automaticamente",
    completedUpdates: toCompletedUpdateResults(preflight.completedUpdates),
    results,
  }, null, 2));

  if (!completed) {
    process.exitCode = 1;
  }
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
applySteamPlatformUpdates().catch(() => {
  console.error("Aplicação interrompida: falha inesperada; confira o resultado antes de tentar novamente.");
  process.exitCode = 1;
});
}
