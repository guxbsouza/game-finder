import { NextResponse } from "next/server";
import { getRawgGames } from "@/lib/rawg";
import { mapRawgGames } from "@/lib/rawg-mapper";

export async function GET() {
  try {
    const data = await getRawgGames();
    const games = mapRawgGames(data.results);

    return NextResponse.json({ count: data.count, games });
  } catch (error) {
    console.error("Erro ao consultar a RAWG:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a RAWG." },
      { status: 500 }
    );
  }
}