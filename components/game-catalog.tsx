"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterGames } from "@/lib/filter-games";
import { EMPTY_FILTERS } from "@/lib/types";
import type { Game, GameFilters, Platform } from "@/lib/types";
import { sortBySearchRelevance } from "@/lib/search-relevance";
import { Filters } from "./filters";
import { GameCard } from "./game-card";

const PAGE_SIZE = 20;
const RAWG_CANDIDATE_PAGE_SIZE = 40;
const DEBOUNCE_MS = 400;

const RAWG_PLATFORM_IDS: Record<Platform, number> = {
  Windows: 4,
  Mac: 5,
  Linux: 6,
};

type RawgPageResponse = {
  count?: number;
  games?: Game[];
};

function buildApiUrl(filters: GameFilters, page: number): string {
  const params = new URLSearchParams();
  const hasSearch = filters.search.trim().length > 0;

  if (hasSearch) {
    params.set("search", filters.search.trim());
  }

  if (filters.platforms.length > 0) {
    params.set(
      "platforms",
      filters.platforms
        .map((platform) => String(RAWG_PLATFORM_IDS[platform]))
        .join(","),
    );
  }

  params.set("page", String(page));
  params.set("page_size", String(hasSearch ? RAWG_CANDIDATE_PAGE_SIZE : PAGE_SIZE));

  return `/api/games?${params.toString()}`;
}

async function fetchGames(filters: GameFilters, page: number): Promise<RawgPageResponse> {
  const response = await fetch(buildApiUrl(filters, page), {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Não foi possível carregar os jogos.");
  }

  return (await response.json()) as RawgPageResponse;
}

export function GameCatalog() {
  const [games, setGames] = useState<Game[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);

  useEffect(() => {
    const loadGames = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchGames(filters, page);
        setGames(Array.isArray(data.games) ? data.games : []);
        setTotalCount(Number(data.count ?? 0));
      } catch (loadError) {
        console.error("Erro ao buscar jogos da API:", loadError);
        setError("Não foi possível carregar os jogos no momento.");
        setGames([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    };

    loadGames();
  }, [filters, page]);

  useEffect(() => {
    const trimmedQuery = filters.search.trim();

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!trimmedQuery) {
      return;
    }

    const timerId = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            buildApiUrl({ ...filters, search: trimmedQuery, platforms: [] }, 1),
            {
              method: "GET",
              cache: "no-store",
            },
          );

          if (!response.ok) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
          }

          const data = (await response.json()) as RawgPageResponse;
          const nextSuggestions = sortBySearchRelevance(
            Array.isArray(data.games) ? data.games : [],
            trimmedQuery,
          )
            .slice(0, 5)
            .map((game) => game.name);

          setSuggestions(nextSuggestions);
          setShowSuggestions(nextSuggestions.length > 0);
        } catch {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      })();
    }, DEBOUNCE_MS);

    debounceRef.current = timerId;

    return () => {
      clearTimeout(timerId);
    };
  }, [filters]);

  const visibleGames = useMemo(
    () =>
      sortBySearchRelevance(
        filterGames(games, {
          ...filters,
          search: "",
        }),
        filters.search,
      ),
    [filters, games],
  );

  const handleFiltersChange = (nextFilters: GameFilters) => {
    setFilters(nextFilters);
    setPage(1);
  };

  const pageNumbers = useMemo(() => {
    const maxVisiblePages = 5;
    const halfWindow = Math.floor(maxVisiblePages / 2);

    let start = Math.max(1, page - halfWindow);
    const end = Math.min(totalPages, start + maxVisiblePages - 1);

    if (end - start + 1 < maxVisiblePages) {
      start = Math.max(1, end - maxVisiblePages + 1);
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [page, totalPages]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Filters
        filters={filters}
        resultCount={visibleGames.length}
        onChange={handleFiltersChange}
      />

      {showSuggestions && suggestions.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-zinc-900/80 p-2">
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Sugestões
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setFilters((current) => ({ ...current, search: suggestion }));
                  setPage(1);
                  setShowSuggestions(false);
                }}
                className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-emerald-400/40 hover:text-emerald-200"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-zinc-900/40 px-5 py-12 text-center text-sm text-zinc-400">
          Carregando jogos...
        </p>
      ) : error ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-zinc-900/40 px-5 py-12 text-center text-sm text-red-400">
          {error}
        </p>
      ) : (
        <>
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

          <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/80 p-3 text-sm text-zinc-300 sm:flex-row">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>

              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-zinc-400">
                Página {page} de {totalPages}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  className={`h-8 min-w-8 rounded-md px-2 text-xs font-medium ${
                    pageNumber === page
                      ? "border border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                      : "border border-white/10 bg-zinc-950 text-zinc-300"
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
