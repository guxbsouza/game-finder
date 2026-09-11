import type { Platform, PlatformStatus } from "./types";
import { getRawgGameStores } from "./rawg";

export type PlatformAvailability = Partial<Record<Platform, PlatformStatus>>;

const STEAM_CACHE_TTL_MS = 1000 * 60 * 60;
const STEAM_TRANSIENT_COOLDOWN_MS = 1000 * 10;
const STEAM_MAX_RETRIES = 2;
const steamStatusCache = new Map<string, { expiresAt: number; status: PlatformStatus }>();
const steamTransientCooldown = new Map<string, number>();
const rawgAppIdCache = new Map<string, { expiresAt: number; appId: string | null }>();
const steamStatusInFlight = new Map<string, Promise<PlatformStatus>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getCanonicalSteamAppId(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const directAppId = value.steam_app_id ?? value.steamAppId;

  if (typeof directAppId === "number" && Number.isFinite(directAppId)) {
    return String(directAppId);
  }

  if (typeof directAppId === "string" && directAppId.trim()) {
    return directAppId.trim();
  }

  const stores = Array.isArray(value.stores) ? value.stores : [];

  for (const storeEntry of stores) {
    if (!isObject(storeEntry)) {
      continue;
    }

    const url = typeof storeEntry.url === "string" ? storeEntry.url : "";

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      continue;
    }

    if (parsedUrl.hostname.toLowerCase() !== "store.steampowered.com") {
      continue;
    }

    const match = parsedUrl.pathname.match(/^\/app\/(\d+)(?:\/|$)/i);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function getRawgGameId(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const id = value.id;
  return typeof id === "number" && Number.isFinite(id)
    ? String(id)
    : typeof id === "string" && id.trim()
      ? id.trim()
      : null;
}

function getSteamStoreAppId(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const storeId = value.store_id;
  const store = isObject(value.store) ? value.store : null;
  const slug = typeof store?.slug === "string" ? store.slug.toLowerCase() : "";

  if (storeId !== 1 && slug !== "steam") {
    return null;
  }

  return getCanonicalSteamAppId({ stores: [value] });
}

export async function getSteamAppIdFromGame(value: unknown): Promise<string | null> {
  const directAppId = getCanonicalSteamAppId(value);

  if (directAppId) {
    return directAppId;
  }

  const rawgGameId = getRawgGameId(value);

  if (!rawgGameId) {
    return null;
  }

  const now = Date.now();
  const cacheEntry = rawgAppIdCache.get(rawgGameId);

  if (cacheEntry && cacheEntry.expiresAt > now) {
    return cacheEntry.appId;
  }

  let appId: string | null = null;

  try {
    const stores = await getRawgGameStores(rawgGameId);
    appId = stores.map(getSteamStoreAppId).find(Boolean) ?? null;
  } catch {
    appId = null;
  }

  rawgAppIdCache.set(rawgGameId, {
    expiresAt: now + STEAM_CACHE_TTL_MS,
    appId,
  });

  return appId;
}

async function fetchSteamMacStatusUncached(appId: string): Promise<PlatformStatus> {
  for (let attempt = 0; attempt <= STEAM_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appId}`,
        {
          cache: "no-store",
        },
      );

      if (response.status === 429) {
        if (attempt < STEAM_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }

        steamTransientCooldown.set(appId, Date.now() + STEAM_TRANSIENT_COOLDOWN_MS);
        return "unknown";
      }

      if (!response.ok) {
        return "unknown";
      }

      const payload = (await response.json()) as Record<
        string,
        { success?: boolean; data?: { platforms?: { mac?: boolean } } }
      >;

      const appData = payload[appId];
      const macPlatform = appData?.data?.platforms?.mac;
      const status: PlatformStatus =
        typeof macPlatform === "boolean"
          ? macPlatform
            ? "verified"
            : "unavailable"
          : "unknown";

      if (status !== "unknown") {
        steamStatusCache.set(appId, {
          expiresAt: Date.now() + STEAM_CACHE_TTL_MS,
          status,
        });
      }

      steamTransientCooldown.delete(appId);
      return status;
    } catch {
      return "unknown";
    }
  }

  return "unknown";
}

function fetchSteamMacStatus(appId: string): Promise<PlatformStatus> {
  const cacheEntry = steamStatusCache.get(appId);
  const now = Date.now();

  if (cacheEntry && cacheEntry.expiresAt > now) {
    return Promise.resolve(cacheEntry.status);
  }

  const cooldownExpiresAt = steamTransientCooldown.get(appId);

  if (cooldownExpiresAt && cooldownExpiresAt > now) {
    return Promise.resolve("unknown");
  }

  const inFlight = steamStatusInFlight.get(appId);

  if (inFlight) {
    return inFlight;
  }

  const request = fetchSteamMacStatusUncached(appId);
  steamStatusInFlight.set(appId, request);

  void request.then(
    () => steamStatusInFlight.delete(appId),
    () => steamStatusInFlight.delete(appId),
  );

  return request;
}

export async function getSteamPlatformAvailability(
  rawgGame: unknown,
  appId?: string | null,
): Promise<PlatformAvailability> {
  const resolvedAppId = appId === undefined
    ? await getSteamAppIdFromGame(rawgGame)
    : appId;

  if (!resolvedAppId) {
    return { Mac: "unknown" };
  }

  return {
    Mac: await fetchSteamMacStatus(resolvedAppId),
  };
}
