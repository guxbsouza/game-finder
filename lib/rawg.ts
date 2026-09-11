const RAWG_API_URL = "https://api.rawg.io/api";

export type RawgGamesQuery = {
  search?: string;
  platforms?: string[];
  page?: number;
  pageSize?: number;
};

type RawgGamesResponse = {
  results: unknown[];
  count: number;
};

export async function getRawgGames(query: RawgGamesQuery = {}) {
  const apiKey = process.env.RAWG_API_KEY;

  if (!apiKey) {
    throw new Error("RAWG_API_KEY não configurada.");
  }

  const url = new URL(`${RAWG_API_URL}/games`);
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

  if (query.platforms && query.platforms.length > 0) {
    const normalizedPlatforms = query.platforms
      .map((platform) => platform.trim())
      .filter(Boolean)
      .join(",");

    if (normalizedPlatforms) {
      url.searchParams.set("platforms", normalizedPlatforms);
    }
  }

  const response = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`RAWG API retornou status ${response.status}.`);
  }

  const data = (await response.json()) as RawgGamesResponse;

  return data;
}