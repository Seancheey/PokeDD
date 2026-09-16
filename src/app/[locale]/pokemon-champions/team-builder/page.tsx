import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { cachedQuery } from "@/lib/cache";
import type { Locale } from "@/i18n/routing";
import {
  localizedPokemonName,
  localizedMoveName,
  localizedAbilityName,
  localizedItemName,
} from "@/lib/i18n-pokemon";
import { TeamBuilderClient, type RawRefPokemon, type RefMove, type RefAbility, type RefItem, type PokemonUsage } from "./TeamBuilderClient";
import { decodeTeam, type TeamShare } from "@/lib/team-share";

export const dynamic = "force-dynamic";

export default async function TeamBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const shareParam = Array.isArray(sp.share) ? sp.share[0] : sp.share;
  const initialTeam: TeamShare | null = shareParam
    ? await decodeTeam(shareParam)
    : null;
  setRequestLocale(locale);
  const loc = locale as Locale;

  const [pokemon, moves, abilities, items] = await Promise.all([
    cachedQuery("pokemon:champions-reference", null, () =>
      prisma.pokemon.findMany({
        where: { games: { contains: '"pokemon-champions"' } },
        omit: { createdAt: true, updatedAt: true },
      }),
    ),
    cachedQuery("move:all", null, () => prisma.move.findMany()),
    cachedQuery("ability:all", null, () => prisma.ability.findMany()),
    cachedQuery("item:champions-reference", null, () =>
      prisma.item.findMany({
        where: { games: { contains: '"pokemon-champions"' } },
      }),
    ),
  ]);

  // Trim reference rows to only the fields the client needs (cuts ~30% off the payload).
  // usageByFormat carries both Singles + Doubles slices; client picks one
  // reactively based on the Nav format toggle.
  const refPokemon: RawRefPokemon[] = pokemon.map((p) => {
    let usageByFormat: RawRefPokemon["usageByFormat"] = null;
    try {
      const parsed = JSON.parse(p.usageStats);
      if (parsed && (parsed.singles || parsed.doubles)) {
        usageByFormat = {
          singles: (parsed.singles ?? null) as PokemonUsage | null,
          doubles: (parsed.doubles ?? null) as PokemonUsage | null,
        };
      } else if (parsed && Array.isArray(parsed.topMoves)) {
        // Legacy pre-migration shape — treat as doubles only.
        usageByFormat = { singles: null, doubles: parsed as PokemonUsage };
      }
    } catch {
      /* leave null */
    }
    return {
      slug: p.slug,
      name: localizedPokemonName(p, loc),
      type1: p.type1,
      type2: p.type2,
      spriteUrl: p.spriteUrl,
      abilities: JSON.parse(p.abilities) as string[],
      hiddenAbility: p.hiddenAbility,
      hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe,
      learnableMoves: JSON.parse(p.learnableMoves) as string[],
      usagePct: p.usagePct,
      usageByFormat,
    };
  });
  const refMoves: RefMove[] = moves.map((m) => ({
    slug: m.slug,
    name: localizedMoveName(m, loc),
    type: m.type,
    category: m.category,
    power: m.power ?? null,
  }));
  const refAbilities: RefAbility[] = abilities.map((a) => ({
    slug: a.slug,
    name: localizedAbilityName(a, loc),
  }));
  const refItems: RefItem[] = items.map((i) => ({
    slug: i.slug,
    name: localizedItemName(i, loc),
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <TeamBuilderClient
        pokemonRaw={refPokemon}
        moves={refMoves}
        abilities={refAbilities}
        items={refItems}
        initialTeam={initialTeam}
      />
    </main>
  );
}
