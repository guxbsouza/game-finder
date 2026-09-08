export function Header() {
  return (
    <header className="border-b border-white/10 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-5 sm:px-6 sm:py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
          GameFinder
        </h1>
        <p className="max-w-xl text-sm text-zinc-400">
          Encontre jogos para jogar com seus amigos
        </p>
      </div>
    </header>
  );
}
