import { NextResponse } from "next/server";
import { getRawgGames } from "@/lib/rawg";
import { mapRawgGames } from "@/lib/rawg-mapper";
import { getSteamPlatformAvailability } from "@/lib/steam";
import { sortBySearchRelevance } from "@/lib/search-relevance";

const SEARCH_CANDIDATE_PAGE_SIZE = 40;

function parsePlatforms(searchParams: URLSearchParams): string[] | undefined {
  const repeated = searchParams.getAll("platforms");
  const csv = searchParams.get("platforms");

  const values = [...repeated, ...(csv ? csv.split(",") : [])]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
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

    const data = await getRawgGames({
      search,
      platforms,
      page: rawgPage,
      pageSize: rawgPageSize,
    });

    const rawGames = data.results;
    const mappedGames = mapRawgGames(rawGames);
    const rankedGames = search ? sortBySearchRelevance(mappedGames, search) : mappedGames;

    const totalCount = search
      ? Math.min(data.count ?? rankedGames.length, rankedGames.length)
      : data.count ?? rankedGames.length;

    const startIndex = (Math.max(page, 1) - 1) * pageSize;
    const pageGames = rankedGames.slice(startIndex, startIndex + pageSize);

    const steamAvailabilityEntries = await Promise.all(
      rawGames.map((rawGame) => getSteamPlatformAvailability(rawGame)),
    );

    const steamAvailabilityByGameId = new Map<string, (typeof steamAvailabilityEntries)[number]>();

    mappedGames.forEach((game, index) => {
      const availability = steamAvailabilityEntries[index];

      if (availability) {
        steamAvailabilityByGameId.set(game.id, availability);
      }
    });

    pageGames.forEach((game) => {
      const macStatus = steamAvailabilityByGameId.get(game.id)?.Mac;

      if (!macStatus) {
        return;
      }

      game.platformAvailability = {
        ...(game.platformAvailability ?? {}),
        Mac: macStatus,
      };
    });

    return NextResponse.json({ count: totalCount, games: pageGames });
  } catch (error) {
    console.error("Erro ao consultar a RAWG:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a RAWG." },
      { status: 500 }
    );
  }
}