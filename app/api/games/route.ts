import { NextResponse } from "next/server";
import { getRawgGames } from "@/lib/rawg";
import { mapRawgGames } from "@/lib/rawg-mapper";
import { getSteamAppIdFromGame, getSteamPlatformAvailability } from "@/lib/steam";
import { sortBySearchRelevance } from "@/lib/search-relevance";

const SEARCH_CANDIDATE_PAGE_SIZE = 40;

function parsePlatforms(searchParams: URLSearchParams): string[] | undefined {
  const repeated = searchParams.getAll("platforms");
  const csv = searchParams.get("platforms");

  const values = [...repeated, ...(repeated.length === 0 && csv ? csv.split(",") : [])]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const uniqueValues = [...new Set(values)];

  return uniqueValues.length > 0 ? uniqueValues : undefined;
}

function getRawgGameId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const id = (value as { id?: unknown }).id;

  return typeof id === "number" && Number.isFinite(id)
    ? String(id)
    : typeof id === "string" && id.trim()
      ? id.trim()
      : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? undefined;
    const platforms = parsePlatforms(searchParams);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("page_size") ?? "20");

    const rawgPage = search ? 1 : Number.isFinite(page) ? page : 1;
    const rawgPageSize = search
      ? SEARCH_CANDIDATE_PAGE_SIZE
      : Number.isFinite(pageSize)
        ? pageSize
        : 20;

    const macFilterActive = platforms?.includes("5") ?? false;
    const rawgPlatforms = macFilterActive ? undefined : platforms;

    const data = await getRawgGames({
      search,
      platforms: rawgPlatforms,
      page: rawgPage,
      pageSize: rawgPageSize,
    });

    const rawGames = data.results;
    const mappedGames = mapRawgGames(rawGames);

    const steamResults = await Promise.all(
      rawGames.map(async (rawGame) => {
        const appId = await getSteamAppIdFromGame(rawGame);

        return {
          rawgGameId: getRawgGameId(rawGame),
          appId,
          availability: await getSteamPlatformAvailability(rawGame, appId),
        };
      }),
    );

    const steamAvailabilityByAppId = new Map<
      string,
      (typeof steamResults)[number]["availability"]
    >();

    steamResults.forEach(({ appId, availability }) => {
      if (appId) {
        steamAvailabilityByAppId.set(appId, availability);
      }
    });

    const steamAppIdByGameId = new Map<string, string | null>();

    steamResults.forEach(({ rawgGameId, appId }) => {
      if (rawgGameId) {
        steamAppIdByGameId.set(rawgGameId, appId);
      }
    });

    mappedGames.forEach((game) => {
      const appId = steamAppIdByGameId.get(game.id);
      const macStatus = appId
        ? steamAvailabilityByAppId.get(appId)?.Mac ?? "unknown"
        : "unknown";

      game.platformAvailability = {
        ...(game.platformAvailability ?? {}),
        Mac: macStatus,
      };
    });

    const rankedGames = search ? sortBySearchRelevance(mappedGames, search) : mappedGames;
    const macOnlyFilter = macFilterActive && platforms?.length === 1;
    const filteredGames = macOnlyFilter
      ? rankedGames.filter((game) => game.platformAvailability?.Mac === "verified")
      : rankedGames;

    const totalCount = macOnlyFilter
      ? filteredGames.length
      : search
        ? Math.min(data.count ?? filteredGames.length, filteredGames.length)
        : data.count ?? filteredGames.length;

    return NextResponse.json({ count: totalCount, games: filteredGames });
  } catch (error) {
    console.error("Erro ao consultar a RAWG:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a RAWG." },
      { status: 500 }
    );
  }
}