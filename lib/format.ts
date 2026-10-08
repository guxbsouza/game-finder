import type { Game } from "./types";

export function formatPlayerCount(game: Game): string {
  if (game.maxPlayers === null) {
    return "Jogadores: não informado";
  }

  if (game.minPlayers === null || game.minPlayers === game.maxPlayers) {
    return game.maxPlayers === 1
      ? "1 jogador"
      : `${game.maxPlayers} jogadores`;
  }

  return `${game.minPlayers}–${game.maxPlayers} jogadores`;
}
