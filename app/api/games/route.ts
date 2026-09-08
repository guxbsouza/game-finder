import { NextResponse } from "next/server";
import { getRawgGames } from "@/lib/rawg";

export async function GET() {
  try {
    const games = await getRawgGames();

    return NextResponse.json(games);
  } catch (error) {
    console.error("Erro ao consultar a RAWG:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a RAWG." },
      { status: 500 }
    );
  }
}