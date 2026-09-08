"use client";

import type { ReactNode } from "react";
import { EMPTY_FILTERS } from "@/lib/types";
import type { GameFilters, Genre, MultiplayerType, Platform, PlayerCount } from "@/lib/types";
import { GENRES, MULTIPLAYER_TYPES, PLATFORMS, PLAYER_COUNTS } from "@/lib/types";

type FiltersProps = {
  filters: GameFilters;
  resultCount: number;
  onChange: (filters: GameFilters) => void;
};

const MULTIPLAYER_LABELS: Record<MultiplayerType, string> = {
  online: "Coop online",
  local: "Coop local",
};

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function formatResultCount(count: number): string {
  if (count === 1) {
    return "1 jogo encontrado";
  }

  return `${count} jogos encontrados`;
}

export function Filters({ filters, resultCount, onChange }: FiltersProps) {
  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.platforms.length > 0 ||
    filters.playerCounts.length > 0 ||
    filters.multiplayer.length > 0 ||
    filters.genres.length > 0;

  return (
    <section
      aria-label="Filtros"
      className="rounded-2xl border border-white/10 bg-zinc-900/80 p-4 sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-100">
          Filtros
        </h2>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-zinc-400">
          Busca por nome
        </span>
        <input
          type="search"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
          placeholder="Ex.: Stardew, Minecraft..."
          className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/20"
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FilterGroup label="Plataforma">
          {PLATFORMS.map((platform) => (
            <Chip
              key={platform}
              active={filters.platforms.includes(platform)}
              onClick={() =>
                onChange({
                  ...filters,
                  platforms: toggleValue<Platform>(filters.platforms, platform),
                })
              }
            >
              {platform}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Número de jogadores">
          {PLAYER_COUNTS.map((count) => (
            <Chip
              key={String(count)}
              active={filters.playerCounts.includes(count)}
              onClick={() =>
                onChange({
                  ...filters,
                  playerCounts: toggleValue<PlayerCount>(
                    filters.playerCounts,
                    count,
                  ),
                })
              }
            >
              {count}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Tipo de multiplayer">
          {MULTIPLAYER_TYPES.map((type) => (
            <Chip
              key={type}
              active={filters.multiplayer.includes(type)}
              onClick={() =>
                onChange({
                  ...filters,
                  multiplayer: toggleValue<MultiplayerType>(
                    filters.multiplayer,
                    type,
                  ),
                })
              }
            >
              {MULTIPLAYER_LABELS[type]}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Gênero">
          {GENRES.map((genre) => (
            <Chip
              key={genre}
              active={filters.genres.includes(genre)}
              onClick={() =>
                onChange({
                  ...filters,
                  genres: toggleValue<Genre>(filters.genres, genre),
                })
              }
            >
              {genre}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <p className="mt-4 border-t border-white/10 pt-3 text-sm text-zinc-400">
        {formatResultCount(resultCount)}
      </p>
    </section>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition sm:text-sm ${
        active
          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
          : "border-white/10 bg-zinc-900 text-zinc-300 hover:border-white/20 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
