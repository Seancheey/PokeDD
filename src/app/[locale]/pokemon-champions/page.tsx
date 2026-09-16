import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { cachedQuery } from "@/lib/cache";
import { TypeChip } from "@/components/TypeChip";
import type { PokemonType } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { localizedPokemonName } from "@/lib/i18n-pokemon";

export const dynamic = "force-dynamic";

export default async function HubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Hub");

  const top = await cachedQuery("pokemon:hub-top", null, () =>
    prisma.pokemon.findMany({
      where: { rank: { not: null } },
      orderBy: { rank: "asc" },
      take: 10,
      omit: { createdAt: true, updatedAt: true },
    }),
  );

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

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{t("topByUsageTitle")}</h2>
            <p className="text-sm text-zinc-500">{t("topByUsageSubtitle")}</p>
          </div>
          <Link
            href="/pokemon-champions/pokemon"
            className="text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-400"
          >
            {t("seeFullList")}
          </Link>
        </div>

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
