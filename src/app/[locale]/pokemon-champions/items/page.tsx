import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/routing";
import { localizedItemName, localizedItemDesc } from "@/lib/i18n-pokemon";
import { ItemsCategoryFilter } from "./ItemsCategoryFilter";

export const dynamic = "force-dynamic";

export default async function ItemsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Items");
  const cols = await getTranslations("Items.columns");

  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const q = get("q");
  const cat = get("cat");

  const items = await prisma.item.findMany({
    where: {
      // Only show items tagged for the current game (Pokémon Champions).
      // Pokéballs, healing items, evolution stones, repels, key items, TMs
      // and so on were imported with `games: []` so they're excluded here.
      games: { contains: '"pokemon-champions"' },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { nameI18n: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(cat ? { category: cat } : {}),
    },
    orderBy: { usagePct: "desc" },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("subtitle", { count: items.length })}</p>
        </div>
        <form className="flex gap-2" action={`/${locale === "en" ? "" : locale + "/"}pokemon-champions/items`}>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("search")}
            className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>
      </div>

      <ItemsCategoryFilter selected={cat ?? null} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-3 py-2 text-left">{cols("name")}</th>
              <th className="px-3 py-2 text-left">{cols("category")}</th>
              <th className="px-3 py-2 text-left">{cols("effect")}</th>
              <th className="px-3 py-2 text-right">{cols("usage")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                  {t("empty")}
                </td>
              </tr>
            ) : null}
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link
                    href={`/pokemon-champions/items/${it.slug}`}
                    prefetch={false}
                    className="font-semibold text-zinc-950 hover:text-red-600 dark:text-zinc-50"
                  >
                    {localizedItemName(it, locale as Locale)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {it.category}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {localizedItemDesc(it, locale as Locale)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {it.usagePct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
