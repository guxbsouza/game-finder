const RAWG_API_URL = "https://api.rawg.io/api";

type RawgGamesResponse = {
  results: unknown[];
  count: number;
};

export async function getRawgGames() {
  const apiKey = process.env.RAWG_API_KEY;

  if (!apiKey) {
    throw new Error("RAWG_API_KEY não configurada.");
  }

  const url = new URL(`${RAWG_API_URL}/games`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("page_size", "20");

  const response = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`RAWG API retornou status ${response.status}.`);
  }

  const data = (await response.json()) as RawgGamesResponse;

  return data;
}