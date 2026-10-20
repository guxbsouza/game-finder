import { createClient } from "@supabase/supabase-js";
import { getRawgGames } from "../lib/rawg.ts";
import { mapRawgGame } from "../lib/rawg-mapper.ts";

interface RawgRawItem {
  id?: unknown;
  slug?: unknown;
  released?: unknown;
  rating?: unknown;
  added?: unknown;
  stores?: Array<{
    url?: unknown;
    store?: {
      slug?: unknown;
    };
  }>;
}

interface GameInsertRow {
  id: string;
  name: string;
  slug: string | null;
  image: string;
  released_at: string | null;
  genres: string[];
  tags: string[];
  platforms: string[];
  platform_availability: { Mac: "unknown" };
  min_players: number | null;
  max_players: number | null;
  coop_online: boolean | null;
  coop_local: boolean | null;
  steam_app_id: string | null;
  igdb_id: number | null;
  rating: number;
  added_count: number;
}

function extractSteamAppId(rawItem: RawgRawItem): string | null {
  const stores = Array.isArray(rawItem.stores) ? rawItem.stores : [];

  for (const storeEntry of stores) {
    if (typeof storeEntry !== "object" || storeEntry === null) {
      continue;
    }

    const url = typeof storeEntry.url === "string" ? storeEntry.url : "";

    if (!url) {
      continue;
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname.toLowerCase() === "store.steampowered.com") {
        const match = parsedUrl.pathname.match(/^\/app\/(\d+)(?:\/|$)/i);
        if (match?.[1]) {
          return match[1];
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseReleasedDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  // Validar formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function runSeed(customLimit?: number): Promise<{
  totalFetched: number;
  upserted: number;
  failed: number;
}> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL não configurada no ambiente.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente.");
  }

  if (!process.env.RAWG_API_KEY) {
    throw new Error("RAWG_API_KEY não configurada no ambiente.");
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const parsedEnvLimit = Number(process.env.SEED_LIMIT);
  const targetLimit = customLimit ?? (Number.isFinite(parsedEnvLimit) && parsedEnvLimit > 0 ? parsedEnvLimit : 50);

  console.log(`Iniciando importação de até ${targetLimit} jogos da RAWG para public.games...`);

  let fetchedGamesCount = 0;
  let upsertedCount = 0;
  let failedCount = 0;
  let page = 1;

  const PAGE_SIZE = 40;

  while (fetchedGamesCount < targetLimit) {
    const remaining = targetLimit - fetchedGamesCount;

    let pageData: Awaited<ReturnType<typeof getRawgGames>>;

    try {
      pageData = await getRawgGames({ page, pageSize: PAGE_SIZE });
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`Falha ao buscar página ${page} da RAWG: ${errorMsg}`);
      console.log("\n--- Relatório Parcial de Importação ---");
      console.log(`Total lido da RAWG até a falha: ${fetchedGamesCount}`);
      console.log(`Total inserido/atualizado com sucesso: ${upsertedCount}`);
      console.log(`Total com falha: ${failedCount}`);
      throw new Error(`Interrompido por erro na API da RAWG (página ${page}): ${errorMsg}`);
    }

    if (!pageData.results || pageData.results.length === 0) {
      console.log("Nenhum resultado adicional retornado pela RAWG.");
      break;
    }

    const itemsToProcess = pageData.results.slice(0, remaining);
    const rowsToUpsert: GameInsertRow[] = [];

    for (const rawItem of itemsToProcess) {
      if (fetchedGamesCount >= targetLimit) {
        break;
      }

      fetchedGamesCount += 1;

      const mapped = mapRawgGame(rawItem);

      if (!mapped) {
        console.warn(`Registro da RAWG inválido na página ${page}, ignorado.`);
        failedCount += 1;
        continue;
      }

      const raw = rawItem as RawgRawItem;
      const steamAppId = extractSteamAppId(raw);
      const releasedAt = parseReleasedDate(raw.released);
      const rating = typeof raw.rating === "number" && Number.isFinite(raw.rating) ? raw.rating : 0;
      const addedCount = typeof raw.added === "number" && Number.isFinite(raw.added) ? raw.added : 0;
      const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : null;

      rowsToUpsert.push({
        id: mapped.id,
        name: mapped.name,
        slug,
        image: mapped.image,
        released_at: releasedAt,
        genres: mapped.genres,
        tags: mapped.tags ?? [],
        platforms: mapped.platforms,
        platform_availability: { Mac: "unknown" },
        min_players: null,
        max_players: null,
        coop_online: null,
        coop_local: null,
        steam_app_id: steamAppId,
        igdb_id: null,
        rating,
        added_count: addedCount,
      });
    }

    if (rowsToUpsert.length > 0) {
      const { error } = await supabaseAdmin
        .from("games")
        .upsert(rowsToUpsert, { onConflict: "id" });

      if (error) {
        console.error(`Erro ao fazer upsert do lote da página ${page}: ${error.message}`);
        failedCount += rowsToUpsert.length;
      } else {
        upsertedCount += rowsToUpsert.length;
        console.log(`Página ${page}: ${rowsToUpsert.length} jogos importados com sucesso.`);
      }
    }

    page += 1;
  }

  console.log("\n--- Relatório de Importação ---");
  console.log(`Total lido da RAWG: ${fetchedGamesCount}`);
  console.log(`Total inserido/atualizado com sucesso: ${upsertedCount}`);
  console.log(`Total com falha: ${failedCount}`);

  if (failedCount > 0) {
    throw new Error(`A importação finalizou com ${failedCount} registro(s) com falha.`);
  }

  return {
    totalFetched: fetchedGamesCount,
    upserted: upsertedCount,
    failed: failedCount,
  };
}

if (process.argv[1] && process.argv[1].endsWith("seed-games.ts")) {
  const argLimit = Number(process.argv[2]);
  const limit = Number.isFinite(argLimit) && argLimit > 0 ? argLimit : undefined;

  runSeed(limit).catch((err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Erro fatal no script de importação: ${errorMsg}`);
    process.exit(1);
  });
}
