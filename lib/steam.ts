import type { Platform, PlatformStatus } from "./types";

export type PlatformAvailability = Partial<Record<Platform, PlatformStatus>>;

const STEAM_CACHE_TTL_MS = 1000 * 60 * 60;
const steamStatusCache = new Map<string, { expiresAt: number; status: PlatformStatus }>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSteamAppIdFromGame(value: unknown): string | null {
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

    const slug = typeof storeEntry.store === "object" && storeEntry.store !== null
      ? String((storeEntry.store as Record<string, unknown>).slug ?? "")
      : "";

    const url = typeof storeEntry.url === "string" ? storeEntry.url : "";

    if (!/steam/i.test(slug) && !/steampowered/i.test(url)) {
      continue;
    }

    const match = url.match(/\/app\/(\d+)/i) ?? url.match(/app\/(\d+)/i);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function fetchSteamMacStatus(appId: string): Promise<PlatformStatus> {
  const cacheEntry = steamStatusCache.get(appId);
  const now = Date.now();

  if (cacheEntry && cacheEntry.expiresAt > now) {
    return cacheEntry.status;
  }

  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const status: PlatformStatus = "unknown";
      steamStatusCache.set(appId, { expiresAt: now + STEAM_CACHE_TTL_MS, status });
      return status;
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

    steamStatusCache.set(appId, {
      expiresAt: Date.now() + STEAM_CACHE_TTL_MS,
      status,
    });

    return status;
  } catch {
    const status: PlatformStatus = "unknown";
    steamStatusCache.set(appId, {
      expiresAt: Date.now() + STEAM_CACHE_TTL_MS,
      status,
    });

    return status;
  }
}

export async function getSteamPlatformAvailability(
  rawgGame: unknown,
): Promise<PlatformAvailability> {
  const appId = parseSteamAppIdFromGame(rawgGame);

  if (!appId) {
    return { Mac: "unknown" };
  }

  return {
    Mac: await fetchSteamMacStatus(appId),
  };
}
