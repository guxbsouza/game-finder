import {
  getSteamCandidateVerificationReport,
  type CandidateVerification,
} from "./verify-steam-candidates";
import { getAuthorizedUpdates } from "./apply-steam-platform-updates";

const PLATFORM_NAMES = ["Windows", "Mac", "Linux"] as const;

type PlatformName = (typeof PLATFORM_NAMES)[number];


interface ProposedValues {
  steam_app_id: string;
  platforms: PlatformName[];
  platform_availability: Record<string, unknown>;
}
interface PreviewResult extends CandidateVerification {
  previewStatus: "autorizado" | "bloqueado";
  proposed: ProposedValues | null;
  previewBlockReason?: string;
}

const PLATFORM_AVAILABILITY_MEANING = {
  verified: "Verificado pelos booleanos de plataforma retornados pela Steam.",
  unavailable:
    "A Steam não declara suporte para esta plataforma; isso não confirma incompatibilidade.",
} as const;

function createMacAvailability(
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
function getCurrentPlatforms(value: unknown): PlatformName[] | null {
  if (
    !Array.isArray(value) ||
    !value.every(
      (platform) =>
        typeof platform === "string" &&
        (PLATFORM_NAMES as readonly string[]).includes(platform),
    )
  ) {
    return null;
  }

  return value as PlatformName[];
}
function getAuthorizationErrors(
  verification: CandidateVerification,
  errors: readonly string[],
): string[] {
  const internalGameId = verification.internalGameId === null
    ? null
    : String(verification.internalGameId);

  return errors.filter((error) =>
    error === `verificacao_aprovavel_incompleta:${verification.candidateSteamAppId}` ||
    error === `app_id_autorizado_para_jogos_diferentes:${verification.candidateSteamAppId}` ||
    (internalGameId !== null &&
      error === `id_interno_autorizado_duplicado:${internalGameId}`)
  );
}

function makePreviewResult(
  verification: CandidateVerification,
  authorizedVerifications: ReadonlySet<CandidateVerification>,
  authorizationErrors: readonly string[],
): PreviewResult {
  const steamPlatforms = verification.steamPlatforms;
  const currentPlatforms = getCurrentPlatforms(
    verification.current?.platforms,
  );
  const blockReasons = verification.status === "aprovavel"
    ? getAuthorizationErrors(verification, authorizationErrors)
    : [verification.reason ?? verification.status];
  if (
    !authorizedVerifications.has(verification) ||
    steamPlatforms === null ||
    currentPlatforms === null
  ) {
    return {
      ...verification,
      previewStatus: "bloqueado",
      proposed: null,
      previewBlockReason: blockReasons[0] ?? "verificacao_aprovavel_incompleta",
    };
  }

  return {
    ...verification,
    previewStatus: "autorizado",
    proposed: {
      steam_app_id: verification.candidateSteamAppId,
      platforms: steamPlatforms.includes("Mac")
        ? [...new Set([...currentPlatforms, "Mac" as const])]
        : currentPlatforms.filter((platform) => platform !== "Mac"),
      platform_availability: createMacAvailability(
        verification.current?.platform_availability,
        steamPlatforms,
      ),
    },
  };
}

async function previewSteamPlatformUpdates(): Promise<void> {
  const verification = await getSteamCandidateVerificationReport();
  const authorization = getAuthorizedUpdates(verification);
  const authorizedVerifications = new Set(
    authorization.updates.map(({ verification: authorized }) => authorized),
  );
  const results = verification.results.map((candidate) =>
    makePreviewResult(candidate, authorizedVerifications, authorization.errors),
  );

  console.log(JSON.stringify({
    generatedAt: verification.generatedAt,
    catalogStatus: verification.catalogStatus,
    authorization: {
      status: verification.catalogStatus === "sucesso" &&
          !verification.results.some(({ status }) => status === "falha") &&
          authorization.errors.length === 0 && authorization.updates.length > 0
        ? "aprovado_para_aplicacao"
        : "bloqueado",
      errors: authorization.errors,
      authorizedCandidateCount: authorization.updates.length,
      note: "preview-output.txt e somente saida gerada; a autorizacao e calculada nesta execucao.",
    },
    platformAvailabilityMeaning: PLATFORM_AVAILABILITY_MEANING,
    results,
  }, null, 2));
}

previewSteamPlatformUpdates().catch(() => {
  console.error("Prévia interrompida: falha inesperada na verificação.");
  process.exitCode = 1;
});
