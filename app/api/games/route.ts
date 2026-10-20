import { NextResponse } from "next/server";
import { getSupabaseGames } from "@/lib/supabase-games";
import type { Genre, MultiplayerType, Platform, PlayerCount } from "@/lib/types";

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const platforms = parsePlatforms(searchParams);
    const multiplayer = parseCsvParam(searchParams, "multiplayer").filter(
      (value): value is MultiplayerType => value === "online" || value === "local",
    );
    const playerCounts = parseCsvParam(searchParams, "playerCounts")
      .map((value) => (value === "5+" ? "5+" : Number(value)))
      .filter((value): value is PlayerCount =>
        [1, 2, 3, 4, "5+"].includes(value as PlayerCount),
      );
    const genres = parseCsvParam(searchParams, "genres").filter(
      (value): value is Genre =>
        ["Farming", "RPG", "Survival", "Building", "Simulation"].includes(value),
    );
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("page_size") ?? "20");

    const normalizedPage = Number.isFinite(page) ? Math.max(page, 1) : 1;
    const normalizedPageSize = Number.isFinite(pageSize) ? Math.max(pageSize, 1) : 20;
    const result = await getSupabaseGames({
      filters: {
        search,
        platforms: mapPlatformFilters(platforms),
        playerCounts,
        multiplayer,
        genres,
      },
      page: normalizedPage,
      pageSize: normalizedPageSize,
    });

    return NextResponse.json({ count: result.totalCount, games: result.games });
  } catch (error) {
    console.error("Erro ao consultar jogos:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar os jogos." },
      { status: 500 },
    );
  }
}
