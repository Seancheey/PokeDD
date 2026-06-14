import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/routing";
import {
  localizedPokemonName,
  localizedMoveName,
  localizedMoveEffect,
  localizedAbilityName,
  localizedItemName,
} from "@/lib/i18n-pokemon";
import {
  DamageCalcClient,
  type CalcRefPokemon,
  type CalcRefMove,
  type CalcRefAbility,
  type CalcRefItem,
} from "./DamageCalcClient";

export const dynamic = "force-dynamic";

export default async function DamageCalcPage({
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
    }),
    prisma.move.findMany(),
    prisma.ability.findMany(),
    prisma.item.findMany({
      where: { games: { contains: '"pokemon-champions"' } },
    }),
  ]);

  const refPokemon: CalcRefPokemon[] = pokemon.map((p) => {
    let usage: CalcRefPokemon["usage"] = null;
    try {
      const parsed = JSON.parse(p.usageStats);
      // usageStats is now per-format. Damage Calc is a server-rendered
      // ref-data page; pick doubles by default (Champions' primary format)
      // and fall back to singles. Legacy flat shape (pre-migration) still
      // supported.
      const slice = parsed?.doubles ?? parsed?.singles
        ?? (Array.isArray(parsed?.topMoves) ? parsed : null);
      if (slice && Array.isArray(slice.topMoves)) usage = slice;
    } catch { /* leave null */ }
    return {
      slug: p.slug,
      name: localizedPokemonName(p, loc),
      type1: p.type1,
      type2: p.type2,
      spriteUrl: p.spriteUrl,
      hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe,
      weight: p.weight,
      abilities: JSON.parse(p.abilities) as string[],
      hiddenAbility: p.hiddenAbility,
      learnableMoves: JSON.parse(p.learnableMoves) as string[],
      usagePct: p.usagePct,
      usage,
    };
  });
  const refMoves: CalcRefMove[] = moves.map((m) => ({
    slug: m.slug,
    name: localizedMoveName(m, loc),
    type: m.type,
    category: m.category,
    // NULL in DB ⇒ variable-BP move; resolved at calc time from species state.
    power: m.power ?? null,
    accuracy: m.accuracy ?? null,
    pp: m.pp,
    priority: m.priority,
    makesContact: m.makesContact,
    effectChance: m.effectChance ?? null,
    effect: localizedMoveEffect(m, loc),
    targetShape: m.targetShape,
  }));
  const refAbilities: CalcRefAbility[] = abilities.map((a) => ({
    slug: a.slug,
    name: localizedAbilityName(a, loc),
  }));
  const refItems: CalcRefItem[] = items.map((i) => ({
    slug: i.slug,
    name: localizedItemName(i, loc),
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <DamageCalcClient
        pokemon={refPokemon}
        moves={refMoves}
        abilities={refAbilities}
        items={refItems}
      />
    </main>
  );
}
