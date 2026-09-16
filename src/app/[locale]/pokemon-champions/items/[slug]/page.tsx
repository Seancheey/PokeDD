import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { cachedQuery } from "@/lib/cache";
import type { Locale } from "@/i18n/routing";
import { localizedItemName, localizedItemDesc } from "@/lib/i18n-pokemon";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Items");
  const td = await getTranslations("Items.detail");

  const item = await cachedQuery("item:detail", { slug }, () =>
    prisma.item.findUnique({ where: { slug } }),
  );
  if (!item) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/pokemon-champions/items"
        className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
      >
        {t("back")}
      </Link>

      <header className="mt-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          {localizedItemName(item, locale as Locale)}
        </h1>
        <div className="mt-3 inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {item.category}
        </div>
      </header>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{td("description")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {localizedItemDesc(item, locale as Locale)}
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-bold">{td("stats")}</h2>
        <p className="mt-3 font-mono text-sm tabular-nums">{item.usagePct.toFixed(1)}%</p>
      </section>
    </main>
  );
}
