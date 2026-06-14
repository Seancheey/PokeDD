import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { TypeChip } from "@/components/TypeChip";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { localizedMoveName, localizedMoveEffect } from "@/lib/i18n-pokemon";
import { CategoryBadge } from "@/components/CategoryBadge";
import { MovesFilters } from "./MovesFilters";
import { MovesSortHeader } from "./MovesSortHeader";

export const dynamic = "force-dynamic";

type Sort = "name" | "type" | "category" | "power" | "accuracy" | "pp" | "priority" | "usage";

const SORT_FIELD: Record<Sort, string> = {
  name: "name",
  type: "type",
  category: "category",
  power: "power",
  accuracy: "accuracy",
  pp: "pp",
  priority: "priority",
  usage: "usagePct",
};

export default async function MovesListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Moves");
  const cols = await getTranslations("Moves.columns");

  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const q = get("q");
  const typeFilter = (get("type") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PokemonType => (POKEMON_TYPES as readonly string[]).includes(s));
  const cat = get("cat"); // physical | special | status
  const sort = (get("sort") as Sort) ?? "usage";
  const dir = get("dir") === "asc" ? "asc" : "desc";

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { nameI18n: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }
  if (typeFilter.length > 0) where.type = { in: typeFilter };
  if (cat === "physical" || cat === "special" || cat === "status") where.category = cat;

  const moves = await prisma.move.findMany({
    where,
    orderBy: { [SORT_FIELD[sort]]: dir },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("subtitle", { count: moves.length })}</p>
        </div>
        <form className="flex gap-2" action={`/${locale === "en" ? "" : locale + "/"}pokemon-champions/moves`}>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("search")}
            className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>
      </div>

      <MovesFilters selectedTypes={typeFilter} category={cat ?? null} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
            <tr>
              <MovesSortHeader sort={sort} dir={dir} field="name" label={cols("name")} align="left" />
              <th className="px-3 py-2 text-left">{cols("type")}</th>
              <MovesSortHeader sort={sort} dir={dir} field="category" label={cols("category")} align="left" />
              <MovesSortHeader sort={sort} dir={dir} field="power" label={cols("power")} />
              <MovesSortHeader sort={sort} dir={dir} field="accuracy" label={cols("accuracy")} />
              <MovesSortHeader sort={sort} dir={dir} field="pp" label={cols("pp")} />
              <MovesSortHeader sort={sort} dir={dir} field="priority" label={cols("priority")} />
              <MovesSortHeader sort={sort} dir={dir} field="usage" label={cols("usage")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {moves.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                  {t("empty")}
                </td>
              </tr>
            ) : null}
            {moves.map((m) => (
              <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-3 py-2">
                  <Link
                    href={`/pokemon-champions/moves/${m.slug}`}
                    prefetch={false}
                    className="font-semibold text-zinc-950 hover:text-red-600 dark:text-zinc-50"
                  >
                    {localizedMoveName(m, locale as Locale)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <TypeChip type={m.type as PokemonType} size="sm" />
                </td>
                <td className="px-3 py-2 text-xs">
                  <CategoryBadge cat={m.category} />
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {m.power ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {m.accuracy ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{m.pp}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {m.priority > 0 ? `+${m.priority}` : m.priority}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {m.usagePct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// Locale-aware effect text helper, exported for use in the detail page.
export function localizedEffect(
  m: { effectText: string; effectI18n: string },
  locale: Locale,
) {
  return localizedMoveEffect(m, locale);
}
