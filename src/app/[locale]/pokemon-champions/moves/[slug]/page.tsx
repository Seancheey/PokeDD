import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { cachedQuery } from "@/lib/cache";
import { TypeChip } from "@/components/TypeChip";
import type { PokemonType } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import {
  localizedMoveName,
  localizedMoveEffect,
  localizedPokemonName,
} from "@/lib/i18n-pokemon";
import { CategoryBadge } from "@/components/CategoryBadge";

export const dynamic = "force-dynamic";

export default async function MoveDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Moves");
  const td = await getTranslations("Moves.detail");
  const cols = await getTranslations("Moves.columns");

  const m = await cachedQuery("move:detail", { slug }, () =>
    prisma.move.findUnique({ where: { slug } }),
  );
  if (!m) notFound();

  // Pokémon that can learn this move. The slug is wrapped in JSON-quotes
  // in the `learnableMoves` array, so the substring match `"foo"` is safe —
  // it can't false-match a prefix or suffix of another slug.
  const learners = await cachedQuery("move:learners", { slug }, () =>
    prisma.pokemon.findMany({
      where: {
        AND: [
          { learnableMoves: { contains: `"${slug}"` } },
          { games: { contains: '"pokemon-champions"' } },
        ],
      },
      orderBy: [
        { rank: { sort: "asc", nulls: "last" } },
        { dexNo: "asc" },
      ],
      omit: { createdAt: true, updatedAt: true },
    }),
  );

  const displayName = localizedMoveName(m, locale as Locale);
  const effect = localizedMoveEffect(m, locale as Locale);

  const stats: Array<{ label: string; value: string }> = [
    { label: cols("power"), value: m.power == null ? "—" : `${m.power}` },
    { label: cols("accuracy"), value: m.accuracy == null ? "—" : `${m.accuracy}` },
    { label: cols("pp"), value: `${m.pp}` },
    { label: cols("priority"), value: m.priority > 0 ? `+${m.priority}` : `${m.priority}` },
    { label: cols("usage"), value: `${m.usagePct.toFixed(1)}%` },
    { label: td("target"), value: m.targetShape },
    { label: td("contact"), value: m.makesContact ? td("yes") : td("no") },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/pokemon-champions/moves"
        className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
      >
        {t("back")}
      </Link>

      <header className="mt-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{displayName}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TypeChip type={m.type as PokemonType} />
          <CategoryBadge cat={m.category} />
        </div>
        <p className="mt-4 text-base text-zinc-700 dark:text-zinc-300">{effect}</p>
      </header>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{td("stats")}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs uppercase tracking-wider text-zinc-500">{s.label}</dt>
              <dd className="font-mono text-sm tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">
          {td("learners")}{" "}
          <span className="text-sm font-normal text-zinc-500">({learners.length})</span>
        </h2>
        {learners.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">—</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {learners.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pokemon-champions/pokemon/${p.slug}`}
                  className="group flex items-center gap-2 rounded-md border border-zinc-200 p-2 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <Image
                    src={p.spriteUrl}
                    alt={p.name}
                    width={36}
                    height={36}
                    unoptimized
                    className="h-9 w-9 shrink-0 object-contain"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {localizedPokemonName(p, locale as Locale)}
                  </span>
                  {p.rank ? (
                    <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                      #{p.rank}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
