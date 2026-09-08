import type { Game } from "./types";

export function formatPlayerCount(game: Game): string {
  if (game.minPlayers === game.maxPlayers) {
    return game.minPlayers === 1
      ? "1 jogador"
      : `${game.minPlayers} jogadores`;
  }

  return `${game.minPlayers}–${game.maxPlayers} jogadores`;
}
