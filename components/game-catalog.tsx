"use client";

import { useMemo, useState } from "react";
import { filterGames } from "@/lib/filter-games";
import { EMPTY_FILTERS } from "@/lib/types";
import type { Game } from "@/lib/types";
import { Filters } from "./filters";
import { GameCard } from "./game-card";

export function GameCatalog({ games }: { games: Game[] }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const visibleGames = useMemo(
    () => filterGames(games, filters),
    [filters, games],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Filters
        filters={filters}
        resultCount={visibleGames.length}
        onChange={setFilters}
      />

      {visibleGames.length > 0 ? (
        <section
          aria-label="Lista de jogos"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visibleGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-white/15 bg-zinc-900/40 px-5 py-12 text-center text-sm text-zinc-400">
          Nenhum jogo encontrado com esses filtros. Tente limpar ou reduzir as
          opções.
        </p>
      )}
    </div>
  );
}
