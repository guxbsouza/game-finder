import { GameCatalog } from "@/components/game-catalog";
import { Header } from "@/components/header";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        <GameCatalog />
      </main>
    </div>
  );
}
