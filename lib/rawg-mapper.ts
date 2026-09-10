import type { Game, Genre, Platform } from "./types";

type RawgGame = {
  id: number;
  name: string;
  background_image: string | null;
  platforms?: Array<{
    platform?: {
      name?: string;
    };
  }>;
  genres?: Array<{
    name?: string;
  }>;
  tags?: Array<{
    name?: string;
  }>;
};

const supportedGenres: Record<string, Genre> = {
  building: "Building",
  farming: "Farming",
  rpg: "RPG",
  simulation: "Simulation",
  survival: "Survival",
};

const onlineCoopTags = ["online co-op", "online cooperative multiplayer"];
const localCoopTags = [
  "co-op",
  "cooperative",
  "local co-op",
  "local multiplayer",
  "split-screen",
];

function isRawgGame(value: unknown): value is RawgGame {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const game = value as Partial<RawgGame>;

  return (
    typeof game.id === "number" &&
    typeof game.name === "string" &&
    (typeof game.background_image === "string" ||
      game.background_image === null)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function mapPlatforms(rawgGame: RawgGame): Platform[] {
  const platforms = new Set<Platform>();

  for (const item of rawgGame.platforms ?? []) {
    const name = normalize(item.platform?.name ?? "");

    if (name === "pc" || name === "windows") {
      platforms.add("Windows");
    } else if (name === "macos" || name === "mac") {
      platforms.add("Mac");
    } else if (name === "linux") {
      platforms.add("Linux");
    }
  }

  return [...platforms];
}

function mapGenres(rawgGame: RawgGame): Genre[] {
  const genres = new Set<Genre>();

  for (const item of rawgGame.genres ?? []) {
    const genre = supportedGenres[normalize(item.name ?? "")];

    if (genre) {
      genres.add(genre);
    }
  }

  return [...genres];
}

function mapMultiplayer(rawgGame: RawgGame): Pick<Game, "coopOnline" | "coopLocal"> {
  const tags = (rawgGame.tags ?? [])
    .map((tag) => normalize(tag.name ?? ""))
    .filter(Boolean);

  return {
    coopOnline: tags.some((tag) => onlineCoopTags.includes(tag)),
    coopLocal: tags.some((tag) => localCoopTags.includes(tag)),
  };
}

export function mapRawgGame(value: unknown): Game | null {
  if (!isRawgGame(value)) {
    return null;
  }

  const multiplayer = mapMultiplayer(value);

  return {
    id: String(value.id),
    name: value.name,
    image: value.background_image ?? "",
    genres: mapGenres(value),
    platforms: mapPlatforms(value),
    // RAWG does not expose structured player-count fields for this mapper.
    minPlayers: 1,
    maxPlayers: 1,
    ...multiplayer,
  };
}

export function mapRawgGames(values: unknown[]): Game[] {
  return values.flatMap((value) => {
    const game = mapRawgGame(value);
    return game ? [game] : [];
  });
}