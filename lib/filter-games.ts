import type { Game, GameFilters, PlayerCount } from "./types";

function supportsAtLeast(game: Game, count: PlayerCount): boolean {
  if (game.maxPlayers === null) {
    return false;
  }

  if (count === "5+") {
    return game.maxPlayers >= 5;
  }

  return game.minPlayers !== null &&
    game.minPlayers <= count &&
    game.maxPlayers >= count;
}

function matchesGenre(game: Game, genre: GameFilters["genres"][number]): boolean {
  if (genre === "Farming") {
    return game.genres.includes(genre) || (game.tags ?? []).some(
      (tag) => tag === "agriculture" || tag === "farming",
    );
  }

  return game.genres.includes(genre);
}

export function filterGames(games: Game[], filters: GameFilters): Game[] {
  const query = filters.search.trim().toLowerCase();

  return games.filter((game) => {
    if (query && !game.name.toLowerCase().includes(query)) {
      return false;
    }

    if (filters.platforms.length > 0) {
      const matchesPlatform = filters.platforms.some((platform) =>
        platform === "Mac"
          ? game.platformAvailability?.Mac === "verified"
          : game.platforms.includes(platform),
      );

      if (!matchesPlatform) {
        return false;
      }
    }

    if (
      filters.playerCounts.length > 0 &&
      !filters.playerCounts.some((count) => supportsAtLeast(game, count))
    ) {
      return false;
    }

    if (filters.multiplayer.length > 0) {
      const matchesOnline =
        filters.multiplayer.includes("online") && game.coopOnline === true;
      const matchesLocal =
        filters.multiplayer.includes("local") && game.coopLocal === true;

      if (!matchesOnline && !matchesLocal) {
        return false;
      }
    }

    if (
      filters.genres.length > 0 &&
      !filters.genres.some((genre) => matchesGenre(game, genre))
    ) {
      return false;
    }

    return true;
  });
}
