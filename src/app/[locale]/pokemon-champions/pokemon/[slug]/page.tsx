import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { TypeChip } from "@/components/TypeChip";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
import { effectivenessAgainst } from "@/lib/type-chart";
import type { Locale } from "@/i18n/routing";
import {
  localizedPokemonName,
  localizedAbilityName,
  localizedMoveName,
} from "@/lib/i18n-pokemon";
import { LearnsetTable, type LearnsetRow } from "./LearnsetTable";

export const dynamic = "force-dynamic";

export default async function PokemonDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const loc = locale as Locale;
  const t = await getTranslations("Detail");

  const p = await prisma.pokemon.findUnique({ where: { slug } });
  if (!p) notFound();

  const bst = p.hp + p.atk + p.def + p.spa + p.spd + p.spe;
  const stats = [
    { k: "hp", v: p.hp }, { k: "atk", v: p.atk }, { k: "def", v: p.def },
    { k: "spa", v: p.spa }, { k: "spd", v: p.spd }, { k: "spe", v: p.spe },
  ];
  const max = Math.max(...stats.map((s) => s.v), 200);
  const abilityList: string[] = JSON.parse(p.abilities);
  const learnableMoveSlugs: string[] = JSON.parse(p.learnableMoves);
  const displayName = localizedPokemonName(p, loc);
  const cols = await getTranslations("List.columns");

  // Look up DB rows for the abilities + moves this Pokémon has, so we can show
  // localized names and link to detail pages.
  const allAbilitySlugs = [...new Set([...abilityList, ...(p.hiddenAbility ? [p.hiddenAbility] : [])])];
  const [abilityRows, moveRows, formRows] = await Promise.all([
    allAbilitySlugs.length > 0
      ? prisma.ability.findMany({ where: { slug: { in: allAbilitySlugs } } })
      : Promise.resolve([]),
    learnableMoveSlugs.length > 0
      ? prisma.move.findMany({ where: { slug: { in: learnableMoveSlugs } } })
      : Promise.resolve([]),
    prisma.pokemon.findMany({
      where: {
        dexNo: p.dexNo,
        OR: [
          { slug: p.slug },
          { games: { contains: '"pokemon-champions"' } },
        ],
      },
      orderBy: [{ slug: "asc" }],
    }),
  ]);

  const abilityNameBySlug = new Map(
    abilityRows.map((a) => [a.slug, localizedAbilityName(a, loc)]),
  );

  // Per-mon move usage % (Smogon overlay). usageStats is now per-format —
  // server-rendered pages default to the doubles slice (Champions' primary
  // format). Builder pages let the user toggle.
  let pctByMove = new Map<string, number>();
  try {
    const usage = JSON.parse(p.usageStats);
    const slice = usage?.doubles ?? usage?.singles ?? (Array.isArray(usage?.topMoves) ? usage : null);
    if (slice?.topMoves) {
      pctByMove = new Map<string, number>(
        (slice.topMoves as Array<{ slug: string; pct: number }>).map((m) => [m.slug, m.pct]),
      );
    }
  } catch { /* ignore */ }

  const learnsetRows: LearnsetRow[] = moveRows.map((m) => ({
    slug: m.slug,
    name: localizedMoveName(m, loc),
    type: m.type,
    category: m.category,
    power: m.power,
    accuracy: m.accuracy,
    pp: m.pp,
    usagePct: pctByMove.get(m.slug),
  }));
  const formOptions = formRows.some((f) => f.slug.includes("-mega"))
    ? formRows
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/pokemon-champions/pokemon"
        className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
      >
        {t("back")}
      </Link>

      <header className="mt-3 flex flex-col items-start gap-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center">
        <Image
          src={p.spriteUrl}
          alt={p.name}
          width={160}
          height={160}
          priority
          unoptimized
          className="h-32 w-32 shrink-0 object-contain"
        />
        <div className="flex-1">
          <div className="text-xs font-mono text-zinc-500">
            #{p.dexNo.toString().padStart(3, "0")}
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{displayName}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <TypeChip type={p.type1 as PokemonType} />
            {p.type2 ? <TypeChip type={p.type2 as PokemonType} /> : null}
          </div>
          {formOptions.length > 1 ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {t("forms")}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {formOptions.map((form) => {
                  const active = form.slug === p.slug;
                  return (
                    <Link
                      key={form.slug}
                      href={`/pokemon-champions/pokemon/${form.slug}`}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                        active
                          ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                          : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {localizedPokemonName(form, loc)}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t("usage")}</span>{" "}
              {p.usagePct.toFixed(1)}%
            </span>
            {p.rank ? (
              <span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t("rank")}</span>{" "}
                #{p.rank}
              </span>
            ) : null}
            <span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t("bst")}</span>{" "}
              {bst}
            </span>
          </div>
          <Link
            href={`/pokemon-champions/pokemon-builder?mon=${p.slug}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            {t("buildThis")}
          </Link>
        </div>
      </header>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{t("baseStats")}</h2>
        <dl className="mt-4 space-y-2">
          {stats.map((s) => (
            <div
              key={s.k}
              className="grid grid-cols-[5rem_3rem_1fr] items-center gap-3"
            >
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {cols(s.k as never)}
              </dt>
              <dd className="font-mono tabular-nums">{s.v}</dd>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-gradient-to-r from-red-500 to-amber-400"
                  style={{ width: `${Math.min(100, (s.v / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{t("abilities")}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {abilityList.map((a) => (
            <li key={a}>
              <Link
                href={`/pokemon-champions/abilities/${a}`}
                className="rounded-md bg-zinc-100 px-3 py-1 text-sm font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                {abilityNameBySlug.get(a) ?? a.replace(/-/g, " ")}
              </Link>
            </li>
          ))}
          {p.hiddenAbility ? (
            <li>
              <Link
                href={`/pokemon-champions/abilities/${p.hiddenAbility}`}
                className="rounded-md border border-dashed border-zinc-400 px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {abilityNameBySlug.get(p.hiddenAbility) ?? p.hiddenAbility.replace(/-/g, " ")}{" "}
                <span className="text-xs">{t("hiddenSuffix")}</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </section>

      <DefensiveMatchups types={[p.type1, p.type2].filter(Boolean) as PokemonType[]} t={t} />

      <LearnsetTable moves={learnsetRows} />
    </main>
  );
}

// ─── Defensive matchups ──────────────────────────────────────────────────────

type DetailT = Awaited<ReturnType<typeof getTranslations<"Detail">>>;

function DefensiveMatchups({
  types,
  t,
}: {
  types: PokemonType[];
  t: DetailT;
}) {
  // Bucket each of the 18 incoming attack types by multiplier
  const buckets: Record<string, PokemonType[]> = {
    "4": [], "2": [], "0.5": [], "0.25": [], "0": [],
  };
  for (const atk of POKEMON_TYPES) {
    const m = effectivenessAgainst(atk, types);
    if (m === 4)     buckets["4"].push(atk);
    else if (m === 2)    buckets["2"].push(atk);
    else if (m === 0.5)  buckets["0.5"].push(atk);
    else if (m === 0.25) buckets["0.25"].push(atk);
    else if (m === 0)    buckets["0"].push(atk);
    // 1× neutral isn't shown to keep the section focused
  }

  const rows: Array<{
    key: keyof typeof buckets;
    labelKey: "weak4x" | "weak2x" | "resist05" | "resist025" | "immune";
    tone: string;
  }> = [
    { key: "4",    labelKey: "weak4x",   tone: "border-red-500 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300" },
    { key: "2",    labelKey: "weak2x",   tone: "border-red-300 bg-red-50/60 text-red-700 dark:bg-red-950/20 dark:text-red-300" },
    { key: "0.5",  labelKey: "resist05", tone: "border-emerald-300 bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300" },
    { key: "0.25", labelKey: "resist025", tone: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
    { key: "0",    labelKey: "immune",   tone: "border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
  ];

  const anyNonNeutral = rows.some((r) => buckets[r.key].length > 0);

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-bold">{t("matchups")}</h2>
      {anyNonNeutral ? (
        <div className="mt-4 space-y-2">
          {rows.map((row) => {
            const list = buckets[row.key];
            if (list.length === 0) return null;
            return (
              <div
                key={row.key}
                className={`flex flex-wrap items-center gap-2 rounded-lg border-l-4 px-3 py-2 ${row.tone}`}
              >
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t(row.labelKey)}
                </span>
                <span className="flex flex-wrap gap-1">
                  {list.map((tp) => (
                    <TypeChip key={tp} type={tp} size="sm" />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">{t("matchupsNeutral")}</p>
      )}
    </section>
  );
}
