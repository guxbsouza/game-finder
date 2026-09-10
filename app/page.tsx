import { GameCatalog } from "@/components/game-catalog";
import { Header } from "@/components/header";
import type { Game } from "@/lib/types";

async function getGamesFromApi(): Promise<Game[]> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const response = await fetch(`${baseUrl}/api/games`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Não foi possível carregar os jogos.");
  }

  const data = (await response.json()) as { games?: Game[] };

  return Array.isArray(data.games) ? data.games : [];
}

export default async function Home() {
  let games: Game[] = [];

  try {
    games = await getGamesFromApi();
  } catch (error) {
    console.error("Erro ao carregar os jogos da API:", error);
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        {games.length > 0 ? (
          <GameCatalog games={games} />
        ) : (
          <div className="mx-auto max-w-6xl px-4 py-10 text-center text-sm text-zinc-400">
            Não foi possível carregar os jogos no momento.
          </div>
        )}
      </main>
    </div>
  );
}
