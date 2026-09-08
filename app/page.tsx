import { GameCatalog } from "@/components/game-catalog";
import { Header } from "@/components/header";
import { games } from "@/lib/games";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        <GameCatalog games={games} />
      </main>
    </div>
  );
}
