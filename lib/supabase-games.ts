import "server-only";
import { supabase } from "./supabase";
import { filterGames } from "./filter-games";
import { sortBySearchRelevance } from "./search-relevance";
import type { Game, GameFilters, Genre, Platform, PlatformStatus } from "./types";
import { EMPTY_FILTERS, GENRES, PLATFORMS } from "./types";

/**
 * Representação direta das colunas da tabela public.games no Supabase.
 */
export interface SupabaseGameRow {
  id: string;
  name: string;
  slug: string | null;
  image: string;
  released_at: string | null;
  genres: unknown;
  tags: unknown;
  platforms: unknown;
  platform_availability: unknown;
  min_players: number | null;
  max_players: number | null;
  coop_online: boolean | null;
  coop_local: boolean | null;
  steam_app_id: string | null;
  igdb_id: number | null;
  rating: number | null;
  added_count: number | null;
}

/**
 * Modelo interno do Supabase com campos nulos preservados para incerteza
 * antes de projeção ou enriquecimento.
 */
export interface SupabaseGame {
  id: string;
  name: string;
  slug: string | null;
  image: string;
  genres: Genre[];
  tags: string[];
  platforms: Platform[];
  minPlayers: number | null;
  maxPlayers: number | null;
  coopOnline: boolean | null;
  coopLocal: boolean | null;
  platformAvailability: Partial<Record<Platform, PlatformStatus>>;
  steamAppId: string | null;
  igdbId: number | null;
  rating: number;
  addedCount: number;
}

const VALID_PLATFORMS = new Set<string>(PLATFORMS);
const VALID_GENRES = new Set<string>(GENRES);
const VALID_PLATFORM_STATUSES = new Set<string>(["verified", "unavailable", "unknown"]);

/**
 * Valida e normaliza o array de gêneros a partir do banco.
 */
export function validateGenres(value: unknown): Genre[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Genre[] = [];
  for (const item of value) {
    if (typeof item === "string" && VALID_GENRES.has(item)) {
      result.push(item as Genre);
    }
  }

  return [...new Set(result)];
}

/**
 * Valida e normaliza o array de tags a partir do banco.
 */
export function validateTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      result.push(item.trim().toLowerCase());
    }
  }

  return [...new Set(result)];
}

/**
 * Valida e normaliza o array de plataformas suportadas a partir do banco.
 */
export function validatePlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Platform[] = [];
  for (const item of value) {
    if (typeof item === "string" && VALID_PLATFORMS.has(item)) {
      result.push(item as Platform);
    }
  }

  return [...new Set(result)];
}

/**
 * Valida o objeto de disponibilidade de plataforma (ex.: Mac) sem inventar suporte.
 * Se o valor for ausente ou inválido, retorna Mac como "unknown".
 */
export function validatePlatformAvailability(
  value: unknown,
): Partial<Record<Platform, PlatformStatus>> {
  const availability: Partial<Record<Platform, PlatformStatus>> = {
    Mac: "unknown",
  };

  if (typeof value !== "object" || value === null) {
    return availability;
  }

  const record = value as Record<string, unknown>;

  for (const platform of PLATFORMS) {
    const rawStatus = record[platform];
    if (typeof rawStatus === "string" && VALID_PLATFORM_STATUSES.has(rawStatus)) {
      availability[platform] = rawStatus as PlatformStatus;
    }
  }

  return availability;
}

/**
 * Mapeia uma linha bruta de public.games para a estrutura SupabaseGame,
 * preservando explicitamente null para campos de incerteza (sem converter null em false).
 */
export function mapSupabaseRowToSupabaseGame(row: SupabaseGameRow): SupabaseGame {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    slug: typeof row.slug === "string" ? row.slug : null,
    image: typeof row.image === "string" ? row.image : "",
    genres: validateGenres(row.genres),
    tags: validateTags(row.tags),
    platforms: validatePlatforms(row.platforms),
    minPlayers: typeof row.min_players === "number" && Number.isFinite(row.min_players) ? row.min_players : null,
    maxPlayers: typeof row.max_players === "number" && Number.isFinite(row.max_players) ? row.max_players : null,
    coopOnline: typeof row.coop_online === "boolean" ? row.coop_online : null,
    coopLocal: typeof row.coop_local === "boolean" ? row.coop_local : null,
    platformAvailability: validatePlatformAvailability(row.platform_availability),
    steamAppId: typeof row.steam_app_id === "string" ? row.steam_app_id : null,
    igdbId: typeof row.igdb_id === "number" && Number.isFinite(row.igdb_id) ? row.igdb_id : null,
    rating: typeof row.rating === "number" && Number.isFinite(row.rating) ? row.rating : 0,
    addedCount: typeof row.added_count === "number" && Number.isFinite(row.added_count) ? row.added_count : 0,
  };
}

/**
 * Mapeia a estrutura SupabaseGame para a interface padrão Game da aplicação.
 * Preserva estritamente null em coopOnline e coopLocal para representar incerteza,
 * sem assumir false e sem inventar compatibilidade.
 */
export function mapSupabaseRowToGame(row: SupabaseGameRow): Game {
  const sg = mapSupabaseRowToSupabaseGame(row);
  const platforms: Platform[] = sg.platforms.filter((platform) => platform !== "Mac");
  if (sg.platformAvailability.Mac === "verified") {
    platforms.push("Mac");
  }

  return {
    id: sg.id,
    name: sg.name,
    image: sg.image,
    genres: sg.genres,
    tags: sg.tags,
    platforms,
    minPlayers: sg.minPlayers,
    maxPlayers: sg.maxPlayers,
    coopOnline: sg.coopOnline,
    coopLocal: sg.coopLocal,
    platformAvailability: sg.platformAvailability,
  };
}

export interface GetSupabaseCatalogOptions {
  filters?: Partial<GameFilters>;
  page?: number;
  pageSize?: number;
}

export interface GetSupabaseCatalogResult {
  games: Game[];
  rawGames: SupabaseGame[];
  totalCount: number;
}

const SUPABASE_PAGE_SIZE = 1_000;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function fetchCatalogPage(
  filters: GameFilters,
  rangeFrom: number,
  rangeTo: number,
  includeCount: boolean,
) {
  let query = supabase
    .from("games")
    .select("*", includeCount ? { count: "exact" } : undefined);

  if (filters.search.trim()) {
    query = query.ilike("name", `%${escapeLikePattern(filters.search.trim())}%`);
  }

  const selectedPlatforms = filters.platforms;
  if (selectedPlatforms.length > 0) {
    const platformClauses: string[] = [];
    const nonMacPlatforms = selectedPlatforms.filter((platform) => platform !== "Mac");

    if (selectedPlatforms.includes("Mac")) {
      platformClauses.push("platform_availability->>Mac.eq.verified");
    }
    if (nonMacPlatforms.length > 0) {
      platformClauses.push(`platforms.ov.{${nonMacPlatforms.join(",")}}`);
    }

    if (platformClauses.length > 1) {
      query = query.or(platformClauses.join(","));
    } else if (selectedPlatforms.includes("Mac")) {
      query = query.filter("platform_availability->>Mac", "eq", "verified");
    } else {
      query = query.overlaps("platforms", nonMacPlatforms);
    }
  }

  if (filters.playerCounts.length === 1) {
    const [count] = filters.playerCounts;
    if (count === "5+") {
      query = query.gte("max_players", 5);
    } else {
      query = query.lte("min_players", count).gte("max_players", count);
    }
  } else if (filters.playerCounts.length > 1) {
    const playerClauses = filters.playerCounts.map((count) =>
      count === "5+"
        ? "max_players.gte.5"
        : `and(min_players.lte.${count},max_players.gte.${count})`,
    );
    query = query.or(playerClauses.join(","));
  }

  const multiplayerClauses = filters.multiplayer.map((type) =>
    `${type === "online" ? "coop_online" : "coop_local"}.eq.true`,
  );
  if (multiplayerClauses.length > 1) {
    query = query.or(multiplayerClauses.join(","));
  } else if (multiplayerClauses.length === 1) {
    query = query.eq(filters.multiplayer[0] === "online" ? "coop_online" : "coop_local", true);
  }

  if (filters.genres.length > 0) {
    if (filters.genres.includes("Farming")) {
      query = query.or([
        `genres.ov.{${filters.genres.join(",")}}`,
        "tags.ov.{agriculture,farming}",
      ].join(","));
    } else {
      query = query.overlaps("genres", filters.genres);
    }
  }

  return query
    .order("rating", { ascending: false })
    .order("added_count", { ascending: false })
    .order("id", { ascending: true })
    .range(rangeFrom, rangeTo);
}

/**
 * Consulta o catálogo de jogos em public.games no Supabase.
 * Aplica busca, filtros do catálogo e paginação em public.games, retornando
 * a contagem exata dos resultados correspondentes antes do corte da página.
 */
export async function getSupabaseGames(
  options: GetSupabaseCatalogOptions = {},
): Promise<GetSupabaseCatalogResult> {
  const { filters, page = 1, pageSize = 20 } = options;
  const normalizedFilters: GameFilters = { ...EMPTY_FILTERS, ...filters };
  const normalizedPage = Math.max(Math.floor(Number(page) || 1), 1);
  const normalizedPageSize = Math.max(Math.floor(Number(pageSize) || 20), 1);
  const pageOffset = (normalizedPage - 1) * normalizedPageSize;
  const hasSearch = normalizedFilters.search.trim().length > 0;

  if (!hasSearch) {
    const { data, count, error } = await fetchCatalogPage(
      normalizedFilters,
      pageOffset,
      pageOffset + normalizedPageSize - 1,
      true,
    );

    if (error || !Array.isArray(data)) {
      const detail = error?.message ?? "resposta inválida";
      console.error("Erro ao consultar public.games no Supabase:", detail);
      throw new Error(`Falha na consulta ao catálogo Supabase: ${detail}`);
    }

    const rows = data as SupabaseGameRow[];
    const games = rows.map(mapSupabaseRowToGame);

    return {
      games,
      rawGames: rows.map(mapSupabaseRowToSupabaseGame),
      totalCount: typeof count === "number" ? count : games.length,
    };
  }

  const searchEntries: { rawGame: SupabaseGame; game: Game }[] = [];
  let offset = 0;
  let matchingCount: number | null = null;

  while (matchingCount === null || offset < matchingCount) {
    const { data, count, error } = await fetchCatalogPage(
      normalizedFilters,
      offset,
      offset + SUPABASE_PAGE_SIZE - 1,
      offset === 0,
    );

    if (error || !Array.isArray(data)) {
      const detail = error?.message ?? "resposta inválida";
      console.error("Erro ao consultar public.games no Supabase:", detail);
      throw new Error(`Falha na consulta ao catálogo Supabase: ${detail}`);
    }

    const rows = data as SupabaseGameRow[];
    if (offset === 0 && typeof count === "number") {
      matchingCount = count;
    }

    searchEntries.push(...rows.map((row) => ({
      rawGame: mapSupabaseRowToSupabaseGame(row),
      game: mapSupabaseRowToGame(row),
    })));

    if (rows.length === 0) {
      break;
    }

    offset += rows.length;
    if (matchingCount === null && rows.length < SUPABASE_PAGE_SIZE) {
      break;
    }
  }

  const filteredGameSet = new Set(filterGames(
    searchEntries.map(({ game }) => game),
    normalizedFilters,
  ));
  const filteredEntries = searchEntries.filter(({ game }) => filteredGameSet.has(game));
  const rankedEntries = sortBySearchRelevance(
    filteredEntries.map((entry) => ({ name: entry.game.name, entry })),
    normalizedFilters.search,
  ).map(({ entry }) => entry);
  const pagedEntries = rankedEntries.slice(pageOffset, pageOffset + normalizedPageSize);

  return {
    games: pagedEntries.map(({ game }) => game),
    rawGames: pagedEntries.map(({ rawGame }) => rawGame),
    totalCount: filteredEntries.length,
  };
}
