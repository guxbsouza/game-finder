const RAWG_API_URL = "https://api.rawg.io/api";

export type RawgGamesQuery = {
  search?: string;
  tags?: string[];
  platforms?: string[];
  page?: number;
  pageSize?: number;
};

type RawgGamesResponse = {
  results: unknown[];
  count: number;
};

type RawgGameStoresResponse = {
  results: unknown[];
};

async function fetchRawg<T>(path: string): Promise<T> {
  const apiKey = process.env.RAWG_API_KEY;

  if (!apiKey) {
    throw new Error("RAWG_API_KEY não configurada.");
  }

  const url = new URL(`${RAWG_API_URL}${path}`);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`RAWG API retornou status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function getRawgGames(query: RawgGamesQuery = {}) {
  const url = new URL(`${RAWG_API_URL}/games`);
  const apiKey = process.env.RAWG_API_KEY;

  if (!apiKey) {
    throw new Error("RAWG_API_KEY não configurada.");
  }

  url.searchParams.set("key", apiKey);

  const pageNumber = Math.max(Number(query.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize ?? 20), 1), 40);

  url.searchParams.set("page", String(pageNumber));
  url.searchParams.set("page_size", String(pageSize));

  if (query.search && query.search.trim()) {
    const cleanedSearch = query.search.trim();
    url.searchParams.set("search", cleanedSearch);
    url.searchParams.set("search_precise", "true");
  }

  if (query.tags && query.tags.length > 0) {
    const normalizedTags = query.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(",");

    if (normalizedTags) {
      url.searchParams.set("tags", normalizedTags);
    }
  }

  if (query.platforms && query.platforms.length > 0) {
    const normalizedPlatforms = query.platforms
      .map((platform) => platform.trim())
      .filter(Boolean)
      .join(",");

    if (normalizedPlatforms) {
      url.searchParams.set("platforms", normalizedPlatforms);
    }
  }

  return fetchRawg<RawgGamesResponse>(
    url.pathname.replace(/^\/api/, "") + url.search,
  );
}

export async function getRawgGameStores(gameId: string): Promise<unknown[]> {
  const data = await fetchRawg<RawgGameStoresResponse>(`/games/${encodeURIComponent(gameId)}/stores`);
  return Array.isArray(data.results) ? data.results : [];
}