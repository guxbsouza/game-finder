export const PLATFORMS = ["Mac", "Windows", "Linux"] as const;
export const PLAYER_COUNTS = [1, 2, 3, 4, "5+"] as const;
export const MULTIPLAYER_TYPES = ["online", "local"] as const;
export const GENRES = [
  "Farming",
  "RPG",
  "Survival",
  "Building",
  "Simulation",
] as const;

export type Platform = (typeof PLATFORMS)[number];
export type PlayerCount = (typeof PLAYER_COUNTS)[number];
export type MultiplayerType = (typeof MULTIPLAYER_TYPES)[number];
export type Genre = (typeof GENRES)[number];
export type PlatformStatus = "verified" | "unavailable" | "unknown";

export type Game = {
  id: string;
  name: string;
  image: string;
  genres: Genre[];
  platforms: Platform[];
  minPlayers: number;
  maxPlayers: number;
  coopOnline: boolean;
  coopLocal: boolean;
  platformAvailability?: Partial<Record<Platform, PlatformStatus>>;
};

export type GameFilters = {
  search: string;
  platforms: Platform[];
  playerCounts: PlayerCount[];
  multiplayer: MultiplayerType[];
  genres: Genre[];
};

export const EMPTY_FILTERS: GameFilters = {
  search: "",
  platforms: [],
  playerCounts: [],
  multiplayer: [],
  genres: [],
};
