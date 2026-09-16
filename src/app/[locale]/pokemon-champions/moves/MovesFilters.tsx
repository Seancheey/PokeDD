"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { POKEMON_TYPES, TYPE_COLORS, type PokemonType } from "@/lib/types";
import { cn } from "@/lib/cn";

const CATS = ["physical", "special", "status"] as const;
type Cat = (typeof CATS)[number];

export function MovesFilters({
  selectedTypes,
  category,
}: {
  selectedTypes: PokemonType[];
  category: string | null;
}) {
  const sp = useSearchParams();
  const t = useTranslations("Moves");
  const types = useTranslations("Types");

  function withParams(modify: (n: URLSearchParams) => void) {
    const next = new URLSearchParams(sp.toString());
    modify(next);
    const s = next.toString();
    return s ? `/pokemon-champions/moves?${s}` : "/pokemon-champions/moves";
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {t("categoryLabel")}
      </span>
      <Link
        href={withParams((n) => n.delete("cat"))}
        scroll={false}
        className={cn(
          "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
          !category
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
            : "border-zinc-300 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
        )}
      >
        {t("categoryAll")}
      </Link>
      {CATS.map((c) => {
        const active = category === c;
        return (
          <Link
            key={c}
            href={withParams((n) => (active ? n.delete("cat") : n.set("cat", c)))}
            scroll={false}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
              active
                ? c === "physical"
                  ? "border-red-700 bg-red-600 text-white"
                  : c === "special"
                  ? "border-blue-700 bg-blue-600 text-white"
                  : "border-zinc-600 bg-zinc-500 text-white"
                : "border-zinc-300 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
            )}
          >
            {t(`category${c.charAt(0).toUpperCase()}${c.slice(1)}` as `category${Capitalize<Cat>}`)}
          </Link>
        );
      })}

      <span className="ml-3 mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {t("typeLabel")}
      </span>
      {POKEMON_TYPES.map((tp) => {
        const isOn = selectedTypes.includes(tp);
        const c = TYPE_COLORS[tp];
        const href = withParams((n) => {
          const cur = new Set(selectedTypes);
          if (cur.has(tp)) cur.delete(tp);
          else cur.add(tp);
          if (cur.size === 0) n.delete("type");
          else n.set("type", [...cur].join(","));
        });
        return (
          <Link
            key={tp}
            href={href}
            scroll={false}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
              isOn
                ? cn(c.bg, c.text, c.border, "shadow")
                : "border-zinc-300 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
            )}
          >
            {types(tp)}
          </Link>
        );
      })}

      {selectedTypes.length > 0 || category ? (
        <Link
          href="/pokemon-champions/moves"
          className="ml-2 text-xs font-medium text-zinc-600 underline hover:text-zinc-950 dark:text-zinc-400"
        >
          {t("clear")}
        </Link>
      ) : null}
    </div>
  );
}
