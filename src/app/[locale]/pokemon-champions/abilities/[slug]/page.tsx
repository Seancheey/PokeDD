import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { cachedQuery } from "@/lib/cache";
import type { Locale } from "@/i18n/routing";
import {
  localizedAbilityName,
  localizedAbilityShortDesc,
  localizedAbilityLongDesc,
  localizedPokemonName,
} from "@/lib/i18n-pokemon";

export const dynamic = "force-dynamic";

export default async function AbilityDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Abilities");
  const td = await getTranslations("Abilities.detail");

  const ability = await cachedQuery("ability:detail", { slug }, () =>
    prisma.ability.findUnique({ where: { slug } }),
  );
  if (!ability) notFound();

  // Holders: filter in JS because we'd need a JSON-array-contains query for
  // both the abilities slugs AND the hidden ability. With ~232 Champions-roster
  // mons this is cheap.
  const allMons = await cachedQuery("pokemon:champions-reference", null, () =>
    prisma.pokemon.findMany({
      where: { games: { contains: '"pokemon-champions"' } },
      omit: { createdAt: true, updatedAt: true },
    }),
  );
  const holders = allMons.filter((m) => {
    try {
      const list: string[] = JSON.parse(m.abilities);
      return list.includes(slug) || m.hiddenAbility === slug;
    } catch {
      return false;
    }
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/pokemon-champions/abilities"
        className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
      >
        {t("back")}
      </Link>

      <header className="mt-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          {localizedAbilityName(ability, locale as Locale)}
        </h1>
        <p className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
          {localizedAbilityShortDesc(ability, locale as Locale)}
        </p>
      </header>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{td("description")}</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {localizedAbilityLongDesc(ability, locale as Locale)}
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">
          {td("holders")}{" "}
          <span className="text-sm font-normal text-zinc-500">({holders.length})</span>
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {holders.map((p) => (
            <li key={p.id}>
              <Link
                href={`/pokemon-champions/pokemon/${p.slug}`}
                className="group flex items-center gap-2 rounded-md border border-zinc-200 p-2 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <Image
                  src={p.spriteUrl}
                  alt={p.name}
                  width={40}
                  height={40}
                  className="h-10 w-10 object-contain"
                />
                <span className="text-sm font-medium">
                  {localizedPokemonName(p, locale as Locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{td("stats")}</h2>
        <p className="mt-3 font-mono text-sm tabular-nums">
          {ability.usagePct.toFixed(1)}%
        </p>
      </section>
    </main>
  );
}
