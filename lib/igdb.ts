import "server-only";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_API_URL = "https://api.igdb.com/v4";
const STEAM_EXTERNAL_GAME_SOURCE = 1;
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

type TwitchAppAccessTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

type CachedAccessToken = {
  accessToken: string;
  expiresAt: number;
};

export type IgdbExternalGame = {
  id: number;
  uid?: string;
  name?: string;
  game?: number;
  platform?: number;
  external_game_source?: number;
  game_release_format?: number;
  updated_at?: number;
};

export type IgdbGame = {
  id: number;
  name?: string;
  slug?: string;
  game_type?: number;
  parent_game?: number;
  version_parent?: number;
  version_title?: string;
  platforms?: number[];
  multiplayer_modes?: number[];
  external_games?: number[];
  updated_at?: number;
};

export type IgdbMultiplayerMode = {
  id: number;
  game?: number;
  platform?: number;
  onlinecoop?: boolean;
  onlinecoopmax?: number;
  onlinemax?: number;
  offlinecoop?: boolean;
  offlinecoopmax?: number;
  offlinemax?: number;
  lancoop?: boolean;
  splitscreen?: boolean;
  splitscreenonline?: boolean;
  campaigncoop?: boolean;
  dropin?: boolean;
};

export type IgdbPlatform = {
  id: number;
  name?: string;
  abbreviation?: string;
};

export type IgdbSteamMultiplayerLookup = {
  steamAppId: string;
  externalGames: IgdbExternalGame[];
  igdbGameId: number | null;
  game: IgdbGame | null;
  multiplayerModes: IgdbMultiplayerMode[];
  platforms: IgdbPlatform[];
};

let cachedAccessToken: CachedAccessToken | null = null;
let accessTokenInFlight: Promise<CachedAccessToken> | null = null;

function getTwitchCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais Twitch para IGDB não configuradas.");
  }

  return { clientId, clientSecret };
}

function normalizeSteamAppId(steamAppId: string | number): string {
  const normalized = String(steamAppId).trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error("Steam AppID inválido.");
  }

  return normalized;
}

function normalizeIgdbId(id: number): number {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("ID da IGDB inválido.");
  }

  return id;
}

async function requestAccessToken(): Promise<CachedAccessToken> {
  const { clientId, clientSecret } = getTwitchCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Não foi possível obter token Twitch (status ${response.status}).`);
  }

  const payload = (await response.json()) as TwitchAppAccessTokenResponse;

  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Resposta de token Twitch inválida.");
  }

  if (typeof payload.expires_in !== "number" || payload.expires_in <= 0) {
    throw new Error("Expiração do token Twitch inválida.");
  }

  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedAccessToken && cachedAccessToken.expiresAt - TOKEN_EXPIRY_SAFETY_MS > now) {
    return cachedAccessToken.accessToken;
  }

  if (!accessTokenInFlight) {
    accessTokenInFlight = requestAccessToken().then((token) => {
      cachedAccessToken = token;
      return token;
    });

    void accessTokenInFlight.then(
      () => {
        accessTokenInFlight = null;
      },
      () => {
        accessTokenInFlight = null;
      },
    );
  }

  return (await accessTokenInFlight).accessToken;
}

async function queryIgdb<T>(endpoint: string, query: string, retryUnauthorized = true): Promise<T[]> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${IGDB_API_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Client-ID": getTwitchCredentials().clientId,
      Authorization: `Bearer ${accessToken}`,
    },
    body: query,
    cache: "no-store",
  });

  if (response.status === 401 && retryUnauthorized) {
    cachedAccessToken = null;
    return queryIgdb<T>(endpoint, query, false);
  }

  if (!response.ok) {
    throw new Error(`IGDB retornou status ${response.status}.`);
  }

  return (await response.json()) as T[];
}

function getSingleResolvedGameId(externalGames: IgdbExternalGame[], steamAppId: string): number | null {
  const gameIds = [...new Set(
    externalGames
      .filter(
        (externalGame) =>
          externalGame.external_game_source === STEAM_EXTERNAL_GAME_SOURCE &&
          externalGame.uid === steamAppId &&
          typeof externalGame.game === "number",
      )
      .map((externalGame) => externalGame.game as number),
  )];

  return gameIds.length === 1 ? gameIds[0] : null;
}

export async function getIgdbExternalGamesBySteamAppId(
  steamAppId: string | number,
): Promise<IgdbExternalGame[]> {
  const normalizedSteamAppId = normalizeSteamAppId(steamAppId);
  const externalGames = await queryIgdb<IgdbExternalGame>(
    "external_games",
    `fields id,uid,name,game,platform,external_game_source,game_release_format,updated_at; where uid = "${normalizedSteamAppId}" & external_game_source = ${STEAM_EXTERNAL_GAME_SOURCE};`,
  );

  return externalGames.filter(
    (externalGame) =>
      externalGame.external_game_source === STEAM_EXTERNAL_GAME_SOURCE &&
      externalGame.uid === normalizedSteamAppId,
  );
}

export async function resolveIgdbGameIdFromSteamAppId(
  steamAppId: string | number,
): Promise<number | null> {
  const normalizedSteamAppId = normalizeSteamAppId(steamAppId);
  const externalGames = await getIgdbExternalGamesBySteamAppId(normalizedSteamAppId);

  return getSingleResolvedGameId(externalGames, normalizedSteamAppId);
}

export async function getIgdbGameById(igdbGameId: number): Promise<IgdbGame | null> {
  const id = normalizeIgdbId(igdbGameId);
  const games = await queryIgdb<IgdbGame>(
    "games",
    `fields id,name,slug,game_type,parent_game,version_parent,version_title,platforms,multiplayer_modes,external_games,updated_at; where id = ${id}; limit 1;`,
  );

  return games[0] ?? null;
}

export async function getIgdbMultiplayerModesByGameId(
  igdbGameId: number,
): Promise<IgdbMultiplayerMode[]> {
  const id = normalizeIgdbId(igdbGameId);

  return queryIgdb<IgdbMultiplayerMode>(
    "multiplayer_modes",
    "fields id,game,platform,onlinecoop,onlinecoopmax,onlinemax,offlinecoop,offlinecoopmax,offlinemax,lancoop,splitscreen,splitscreenonline,campaigncoop,dropin; " +
      `where game = ${id};`,
  );
}

export async function getIgdbPlatformsByIds(platformIds: number[]): Promise<IgdbPlatform[]> {
  const ids = [...new Set(platformIds.map(normalizeIgdbId))];

  if (ids.length === 0) {
    return [];
  }

  return queryIgdb<IgdbPlatform>(
    "platforms",
    `fields id,name,abbreviation; where id = (${ids.join(",")});`,
  );
}

export async function lookupSteamAppMultiplayer(
  steamAppId: string | number,
): Promise<IgdbSteamMultiplayerLookup> {
  const normalizedSteamAppId = normalizeSteamAppId(steamAppId);
  const externalGames = await getIgdbExternalGamesBySteamAppId(normalizedSteamAppId);
  const igdbGameId = getSingleResolvedGameId(externalGames, normalizedSteamAppId);

  if (!igdbGameId) {
    return {
      steamAppId: normalizedSteamAppId,
      externalGames,
      igdbGameId: null,
      game: null,
      multiplayerModes: [],
      platforms: [],
    };
  }

  const [game, multiplayerModes] = await Promise.all([
    getIgdbGameById(igdbGameId),
    getIgdbMultiplayerModesByGameId(igdbGameId),
  ]);
  const platforms = await getIgdbPlatformsByIds(
    multiplayerModes.flatMap((mode) => mode.platform === undefined ? [] : [mode.platform]),
  );

  return {
    steamAppId: normalizedSteamAppId,
    externalGames,
    igdbGameId,
    game,
    multiplayerModes,
    platforms,
  };
}
