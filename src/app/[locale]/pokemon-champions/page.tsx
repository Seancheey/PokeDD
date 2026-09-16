import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { TypeChip } from "@/components/TypeChip";
import type { PokemonType } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { localizedPokemonName } from "@/lib/i18n-pokemon";
import { CHAMPIONS_MC_ADDITIONS, CHAMPIONS_MC_MEGAS, CURRENT_REGULATION, REGULATION_MC_SOURCE, usageRegulation } from "@/lib/champions-regulation";

export const dynamic = "force-dynamic";

export default async function HubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Hub");

  const [top, additions] = await Promise.all([
    prisma.pokemon.findMany({
      where: { rank: { not: null }, games: { contains: '"pokemon-champions"' } },
      orderBy: { rank: "asc" },
      take: 10,
    }),
    prisma.pokemon.findMany({
      where: { slug: { in: [...CHAMPIONS_MC_ADDITIONS] }, games: { contains: '"pokemon-champions"' } },
      orderBy: [{ dexNo: "asc" }, { slug: "asc" }],
    }),
  ]);
  const megas = CHAMPIONS_MC_MEGAS.flatMap((slug) => additions.filter((p) => p.slug === slug));
  const usageSources = [...new Set(top.map((p) => usageRegulation(p.usageStats)).filter(Boolean))];
  const hasCurrentUsage = usageSources.length === 1 && usageSources[0] === CURRENT_REGULATION;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <section className="rounded-2xl bg-gradient-to-br from-red-500/90 via-orange-500/90 to-amber-400/90 px-6 py-12 text-white shadow-lg sm:px-12">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-90">
          <span className="inline-block rounded-full bg-white/20 px-2 py-0.5">
            {t("regulationBadge")}
          </span>
          <span>{t("regulationLabel")}</span>
        </div>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mt-3 max-w-2xl text-base opacity-95 sm:text-lg">
          {t("heroSubtitle")}
        </p>
        <p className="mt-3 text-sm font-medium opacity-90">{t("regulationPeriod")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/pokemon-champions/team-builder"
            className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            {t("ctaTeamBuilder")}
          </Link>
          <Link
            href="/pokemon-champions/damage-calc"
            className="rounded-full bg-white/20 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/30"
          >
            {t("ctaDamageCalc")}
          </Link>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="new-pokemon-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="new-pokemon-title" className="text-xl font-bold tracking-tight">{t("newTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("newSubtitle")}</p>
          </div>
          <a href={REGULATION_MC_SOURCE} target="_blank" rel="noreferrer" className="text-sm font-medium text-red-600 dark:text-orange-400">
            {t("officialRules")}
          </a>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {megas.map((p) => (
            <li key={p.slug}>
              <Link href={`/pokemon-champions/pokemon/${p.slug}`} className="group flex h-full flex-col items-center rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-center transition-colors hover:bg-orange-100 dark:border-orange-900 dark:bg-zinc-900 dark:hover:bg-zinc-800">
                <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">{t("newMega")}</span>
                <Image src={p.spriteUrl} width={112} height={112} alt={localizedPokemonName(p, locale as Locale)} className="my-2 h-28 w-28 object-contain transition-transform group-hover:scale-105" />
                <span className="text-sm font-semibold">{localizedPokemonName(p, locale as Locale)}</span>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  <TypeChip type={p.type1 as PokemonType} size="sm" />
                  {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <details className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-semibold">{t("allNewPokemon")}</summary>
          <ul className="mt-3 flex flex-wrap gap-2">
            {additions.filter((p) => !p.slug.includes("-mega")).map((p) => (
              <li key={p.slug}>
                <Link href={`/pokemon-champions/pokemon/${p.slug}`} className="block rounded-full bg-zinc-100 px-3 py-1.5 text-sm hover:bg-orange-100 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                  {localizedPokemonName(p, locale as Locale)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{t("topByUsageTitle")}</h2>
            <p className="text-sm text-zinc-500">{t("topByUsageSubtitle", { regulation: usageSources.join(" / ") || t("usageUnknown") })}</p>
          </div>
          <Link
            href="/pokemon-champions/pokemon"
            className="text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-400"
          >
            {t("seeFullList")}
          </Link>
        </div>
        {!hasCurrentUsage && <p className="mt-3 text-sm text-zinc-500">{t("usagePending")}</p>}

        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {top.map((p) => (
            <li key={p.id}>
              <Link
                href={`/pokemon-champions/pokemon/${p.slug}`}
                className="group flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center justify-between self-stretch text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <span>{t("rankShort", { rank: p.rank ?? 0 })}</span>
                  <span>{p.usagePct.toFixed(1)}%</span>
                </div>
                <Image
                  src={p.spriteUrl}
                  width={88}
                  height={88}
                  alt={p.name}
                  className="h-20 w-20 object-contain transition-transform group-hover:scale-105"
                />
                <div className="text-center">
                  <div className="text-sm font-semibold leading-tight">
                    {localizedPokemonName(p, locale as Locale)}
                  </div>
                  <div className="mt-1 flex flex-wrap justify-center gap-1">
                    <TypeChip type={p.type1 as PokemonType} size="sm" />
                    {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <ToolCard
          href="/pokemon-champions/pokemon"
          title={t("tools.pokemon.title")}
          desc={t("tools.pokemon.desc")}
        />
        <ToolCard
          href="/pokemon-champions/team-builder"
          title={t("tools.teamBuilder.title")}
          desc={t("tools.teamBuilder.desc")}
        />
        <ToolCard
          href="/pokemon-champions/damage-calc"
          title={t("tools.damageCalc.title")}
          desc={t("tools.damageCalc.desc")}
        />
      </section>

    </main>
  );
}

function ToolCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-zinc-200 bg-white p-5 transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <h3 className="text-base font-bold text-zinc-950 group-hover:text-red-600 dark:text-zinc-50 dark:group-hover:text-orange-400">
        {title} →
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
    </Link>
  );
}
