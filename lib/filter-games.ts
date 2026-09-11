import type { Game, GameFilters, PlayerCount } from "./types";

function minimumPlayersRequired(count: PlayerCount): number {
  return count === "5+" ? 5 : count;
}

function supportsAtLeast(game: Game, count: PlayerCount): boolean {
  return game.maxPlayers >= minimumPlayersRequired(count);
}

function matchesGenre(game: Game, genre: GameFilters["genres"][number]): boolean {
  if (genre === "Farming") {
    return (game.tags ?? []).some(
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
        filters.multiplayer.includes("online") && game.coopOnline;
      const matchesLocal =
        filters.multiplayer.includes("local") && game.coopLocal;

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
