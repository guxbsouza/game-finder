import Image from "next/image";
import { formatPlayerCount } from "@/lib/format";
import type { Game, Platform } from "@/lib/types";

const PLATFORM_LABELS: Record<Platform, string> = {
  Mac: "🍎 Mac",
  Windows: "🪟 Windows",
  Linux: "🐧 Linux",
};

function canUseNextImage(source: string): boolean {
  if (!source) {
    return false;
  }

  try {
    const url = new URL(source);

    return url.protocol === "https:" && url.hostname === "media.rawg.io";
  } catch {
    return source.startsWith("/");
  }
}

export function GameCard({ game }: { game: Game }) {
  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/90 transition hover:border-emerald-400/30">
      <div className="relative aspect-[16/9] bg-zinc-800">
        {canUseNextImage(game.image) ? (
          <Image
            src={game.image}
            alt={`Capa de ${game.name}`}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Imagem indisponível
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2.5 p-3.5">
        <h2 className="text-base font-semibold leading-snug tracking-tight text-zinc-50">
          {game.name}
        </h2>

        <div className="flex flex-wrap gap-1">
          {game.genres.map((genre) => (
            <span
              key={genre}
              className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300"
            >
              {genre}
            </span>
          ))}
        </div>

        <p className="text-sm text-zinc-300">👥 {formatPlayerCount(game)}</p>

        <ul className="space-y-0.5 text-sm text-zinc-300">
          {game.platforms
            .filter(
              (platform) =>
                platform !== "Mac" ||
                game.platformAvailability?.Mac === "verified",
            )
            .map((platform) => (
            <li key={platform}>{PLATFORM_LABELS[platform]}</li>
            ))}
        </ul>

        <ul className="space-y-0.5 text-sm">
          <li className={game.coopOnline ? "text-emerald-300" : "text-zinc-600"}>
            🌐 Coop online
          </li>
          <li className={game.coopLocal ? "text-emerald-300" : "text-zinc-600"}>
            🏠 Coop local
          </li>
        </ul>
      </div>
    </article>
  );
}
