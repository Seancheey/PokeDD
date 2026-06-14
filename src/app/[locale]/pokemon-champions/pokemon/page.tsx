import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { TypeChip } from "@/components/TypeChip";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { localizedPokemonName } from "@/lib/i18n-pokemon";
import { TypeFilters } from "./TypeFilters";
import { SortHeader } from "./SortHeader";

export const dynamic = "force-dynamic";

type Sort =
  | "dex" | "name" | "usage" | "hp" | "atk" | "def" | "spa" | "spd" | "spe" | "bst";

type ParsedSearch = {
  type?: string;
  q?: string;
  sort: Sort;
  dir?: "asc" | "desc";
};

function parseSearch(raw: Record<string, string | string[] | undefined>): ParsedSearch {
  const get = (k: string) => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const sort = (get("sort") as Sort) ?? "dex";
  const dir = get("dir") === "desc" ? "desc" : get("dir") === "asc" ? "asc" : undefined;
  return { type: get("type"), q: get("q"), sort, dir };
}

const SORT_TO_FIELD: Record<Sort, string> = {
  dex: "dexNo",
  name: "name",
  usage: "usagePct",
  hp: "hp", atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe",
  bst: "bst",
};

export default async function PokemonListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("List");
  const cols = await getTranslations("List.columns");

  const sp = parseSearch(await searchParams);
  const selectedTypes = (sp.type ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PokemonType => (POKEMON_TYPES as readonly string[]).includes(s));

  const sort = sp.sort;
  const dir = sp.dir ?? (sort === "name" || sort === "dex" ? "asc" : "desc");

  const orderBy =
    sort === "bst" ? undefined : { [SORT_TO_FIELD[sort]]: dir as "asc" | "desc" };

  const where: Record<string, unknown> = {
    // Champions roster only — see Pokemon.games tag in importer.
    games: { contains: '"pokemon-champions"' },
  };
  if (sp.q) {
    // Match against English `name` and the raw `nameI18n` JSON blob so users
    // can search by any locale (e.g. ガオガエン, 炽焰咆哮虎, Incineroar).
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { nameI18n: { contains: sp.q, mode: "insensitive" } },
      { slug: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  if (selectedTypes.length > 0) {
    // AND across selected types: the Pokémon must carry every chosen type
    // (in either slot). Picking >2 types yields an empty result by construction,
    // since a Pokémon has at most two types.
    where.AND = selectedTypes.map((tp) => ({
      OR: [{ type1: tp }, { type2: tp }],
    }));
  }

  let pokemon = await prisma.pokemon.findMany({ where, orderBy });
  if (sort === "bst") {
    pokemon = pokemon
      .map((p) => ({ ...p, _bst: p.hp + p.atk + p.def + p.spa + p.spd + p.spe }))
      .sort((a, b) => (dir === "asc" ? a._bst - b._bst : b._bst - a._bst));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t("subtitle", { count: pokemon.length })}
          </p>
        </div>
        <form className="flex gap-2" action={`/${locale === "en" ? "" : locale + "/"}pokemon-champions/pokemon`}>
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder={t("search")}
            className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {selectedTypes.length > 0 ? (
            <input type="hidden" name="type" value={selectedTypes.join(",")} />
          ) : null}
          {sort !== "dex" ? <input type="hidden" name="sort" value={sort} /> : null}
          {dir !== "asc" ? <input type="hidden" name="dir" value={dir} /> : null}
        </form>
      </div>

      <TypeFilters selected={selectedTypes} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-3 py-2 text-left">{cols("dex")}</th>
              <th className="px-3 py-2 text-left">{cols("sprite")}</th>
              <SortHeader sort={sort} dir={dir} field="name" label={cols("name")} align="left" />
              <th className="px-3 py-2 text-left">{cols("types")}</th>
              <SortHeader sort={sort} dir={dir} field="usage" label={cols("usage")} />
              <SortHeader sort={sort} dir={dir} field="hp" label={cols("hp")} />
              <SortHeader sort={sort} dir={dir} field="atk" label={cols("atk")} />
              <SortHeader sort={sort} dir={dir} field="def" label={cols("def")} />
              <SortHeader sort={sort} dir={dir} field="spa" label={cols("spa")} />
              <SortHeader sort={sort} dir={dir} field="spd" label={cols("spd")} />
              <SortHeader sort={sort} dir={dir} field="spe" label={cols("spe")} />
              <SortHeader sort={sort} dir={dir} field="bst" label={cols("bst")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pokemon.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-zinc-500">
                  {t("empty")}{" "}
                  <Link href="/pokemon-champions/pokemon" className="font-medium underline">
                    {t("clearFilters")}
                  </Link>
                </td>
              </tr>
            ) : null}
            {pokemon.map((p) => {
              const bst = p.hp + p.atk + p.def + p.spa + p.spd + p.spe;
              return (
                <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                    {p.dexNo.toString().padStart(3, "0")}
                  </td>
                  <td className="px-3 py-1">
                    <Image
                      src={p.spriteUrl}
                      alt={p.name}
                      width={48}
                      height={48}
                      className="h-10 w-10 object-contain"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/pokemon-champions/pokemon/${p.slug}`}
                      prefetch={false}
                      className="font-semibold text-zinc-950 hover:text-red-600 dark:text-zinc-50"
                    >
                      {localizedPokemonName(p, locale as Locale)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <TypeChip type={p.type1 as PokemonType} size="sm" />
                      {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {p.usagePct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.hp}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.atk}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.def}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.spa}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.spd}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.spe}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {bst}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
