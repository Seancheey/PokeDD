import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/routing";
import {
  localizedPokemonName,
  localizedMoveName,
  localizedAbilityName,
  localizedItemName,
} from "@/lib/i18n-pokemon";
import {
  PokemonBuilderClient,
  type BuilderRawRefPokemon,
  type BuilderRefMove,
  type BuilderRefAbility,
  type BuilderRefItem,
  type PokemonUsage,
} from "./PokemonBuilderClient";

export const dynamic = "force-dynamic";

export default async function PokemonBuilderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = locale as Locale;

  const [pokemon, moves, abilities, items] = await Promise.all([
    prisma.pokemon.findMany({
      where: { games: { contains: '"pokemon-champions"' } },
      orderBy: { usagePct: "desc" },
    }),
    prisma.move.findMany(),
    prisma.ability.findMany(),
    prisma.item.findMany({
      where: { games: { contains: '"pokemon-champions"' } },
    }),
  ]);

  const refPokemon: BuilderRawRefPokemon[] = pokemon.map((p) => {
    let usageByFormat: BuilderRawRefPokemon["usageByFormat"] = null;
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
      weight: p.weight,
      learnableMoves: JSON.parse(p.learnableMoves) as string[],
      usagePct: p.usagePct,
      usageByFormat,
    };
  });
  const refMoves: BuilderRefMove[] = moves.map((m) => ({
    slug: m.slug,
    name: localizedMoveName(m, loc),
    type: m.type,
    category: m.category as "physical" | "special" | "status",
    power: m.power ?? null,
    targetShape: m.targetShape,
  }));
  const refAbilities: BuilderRefAbility[] = abilities.map((a) => ({
    slug: a.slug,
    name: localizedAbilityName(a, loc),
  }));
  const refItems: BuilderRefItem[] = items.map((i) => ({
    slug: i.slug,
    name: localizedItemName(i, loc),
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <PokemonBuilderClient
        pokemonRaw={refPokemon}
        moves={refMoves}
        abilities={refAbilities}
        items={refItems}
      />
    </main>
  );
}
