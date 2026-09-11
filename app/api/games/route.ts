import { NextResponse } from "next/server";
import { getRawgGames } from "@/lib/rawg";
import { mapRawgGame } from "@/lib/rawg-mapper";
import { getSteamAppIdFromGame, getSteamPlatformAvailability } from "@/lib/steam";
import { sortBySearchRelevance } from "@/lib/search-relevance";
import { filterGames } from "@/lib/filter-games";
import type { Game, GameFilters, Genre, MultiplayerType, Platform } from "@/lib/types";

const SEARCH_CANDIDATE_PAGE_SIZE = 40;
const MAC_MAX_RAWG_PAGES = 5;
const MAC_RAWG_PAGE_SIZE = 40;
const STEAM_CONCURRENCY = 5;

async function mapIncrementally<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
  shouldStop: (results: R[]) => boolean,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);

      if (shouldStop(results)) {
        stopped = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );

  return results;
}

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

function parseCsvParam(searchParams: URLSearchParams, name: string): string[] {
  return [...new Set(
    searchParams
      .getAll(name)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function mapPlatformFilters(values: string[] | undefined): Platform[] {
  const platformById: Record<string, Platform> = {
    "4": "Windows",
    "5": "Mac",
    "6": "Linux",
  };

  return (values ?? [])
    .map((value) => platformById[value])
    .filter((platform): platform is Platform => Boolean(platform));
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
    const multiplayer = parseCsvParam(searchParams, "multiplayer").filter(
      (value): value is MultiplayerType => value === "online" || value === "local",
    );
    const genres = parseCsvParam(searchParams, "genres").filter(
      (value): value is Genre =>
        ["Farming", "RPG", "Survival", "Building", "Simulation"].includes(value),
    );
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("page_size") ?? "20");

    const normalizedPage = Number.isFinite(page) ? Math.max(page, 1) : 1;
    const macFilterActive = platforms?.includes("5") ?? false;
    const farmingFilterActive = genres.includes("Farming");
    const shouldBuildFilteredCatalog = Boolean(
      search ||
        platforms?.length ||
        multiplayer.length ||
        genres.length,
    );
    const rawgPlatforms = macFilterActive ? undefined : platforms;
    const rawgPage = shouldBuildFilteredCatalog ? 1 : normalizedPage;
    const rawgPageSize = shouldBuildFilteredCatalog
      ? SEARCH_CANDIDATE_PAGE_SIZE
      : Number.isFinite(pageSize)
        ? pageSize
        : 20;

    const rawGamesById = new Map<string, unknown>();
    const discoveryTags = farmingFilterActive ? ["agriculture", "farming"] : [undefined];
    let data: Awaited<ReturnType<typeof getRawgGames>> | null = null;
    const matchedGames: Game[] = [];
    const requiredGameCount = normalizedPage * pageSize;
    const canStopEarly = shouldBuildFilteredCatalog && !search;
    let stoppedEarly = false;

    const serverFilters: GameFilters = {
      search: search ?? "",
      platforms: mapPlatformFilters(platforms),
      playerCounts: [],
      multiplayer,
      genres,
    };

    for (const discoveryTag of discoveryTags) {
      for (let candidatePage = rawgPage; ; candidatePage += 1) {
        const pageData = await getRawgGames({
          search,
          tags: discoveryTag ? [discoveryTag] : undefined,
          platforms: rawgPlatforms,
          page: candidatePage,
          pageSize: candidatePage === rawgPage ? rawgPageSize : MAC_RAWG_PAGE_SIZE,
        });

        if (!data) {
          data = pageData;
        }

        const newRawGames: unknown[] = [];

        for (const rawGame of pageData.results) {
          const rawgGameId = getRawgGameId(rawGame);

          if (rawgGameId && !rawGamesById.has(rawgGameId)) {
            rawGamesById.set(rawgGameId, rawGame);
            newRawGames.push(rawGame);
          }
        }

        const newMatchedGames = await mapIncrementally(
          newRawGames,
          STEAM_CONCURRENCY,
          async (rawGame) => {
            const appId = await getSteamAppIdFromGame(rawGame);
            const availability = await getSteamPlatformAvailability(rawGame, appId);
            const game = mapRawgGame(rawGame);

            if (!game) {
              return null;
            }

            game.platformAvailability = {
              ...(game.platformAvailability ?? {}),
              Mac: appId ? availability.Mac ?? "unknown" : "unknown",
            };

            return filterGames([game], serverFilters)[0] ?? null;
          },
          (results) =>
            canStopEarly &&
            matchedGames.length + results.filter((game): game is Game => Boolean(game)).length >=
              requiredGameCount,
        );

        matchedGames.push(
          ...newMatchedGames.filter((game): game is Game => Boolean(game)),
        );

        if (canStopEarly && matchedGames.length >= requiredGameCount) {
          stoppedEarly = true;
          break;
        }

        if (!shouldBuildFilteredCatalog ||
          pageData.results.length < MAC_RAWG_PAGE_SIZE ||
          candidatePage >= MAC_MAX_RAWG_PAGES) {
          break;
        }
      }

      if (stoppedEarly) {
        break;
      }
    }

    if (!data) {
      throw new Error("RAWG não retornou dados de jogos.");
    }

    const filteredGames = shouldBuildFilteredCatalog
      ? matchedGames
      : matchedGames;
    const rankedGames = search
      ? sortBySearchRelevance(filteredGames, search)
      : filteredGames;
    const pageGames = shouldBuildFilteredCatalog
      ? rankedGames.slice(
          (normalizedPage - 1) * pageSize,
          normalizedPage * pageSize,
        )
      : rankedGames;

    const totalCount = shouldBuildFilteredCatalog
      ? stoppedEarly
        ? Math.max(rankedGames.length, requiredGameCount + 1)
        : rankedGames.length
      : search
        ? Math.min(data.count ?? pageGames.length, pageGames.length)
        : data.count ?? pageGames.length;

    return NextResponse.json({ count: totalCount, games: pageGames });
  } catch (error) {
    console.error("Erro ao consultar a RAWG:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a RAWG." },
      { status: 500 }
    );
  }
}
