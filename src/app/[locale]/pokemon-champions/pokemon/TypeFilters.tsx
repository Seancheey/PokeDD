"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { POKEMON_TYPES, TYPE_COLORS, type PokemonType } from "@/lib/types";
import { cn } from "@/lib/cn";

export function TypeFilters({ selected }: { selected: PokemonType[] }) {
  const sp = useSearchParams();
  const t = useTranslations("List");
  const types = useTranslations("Types");

  function toggleParams(type: PokemonType) {
    const next = new URLSearchParams(sp.toString());
    const cur = new Set(selected);
    if (cur.has(type)) cur.delete(type);
    else cur.add(type);
    if (cur.size === 0) next.delete("type");
    else next.set("type", [...cur].join(","));
    return next.toString();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {t("typeLabel")}
      </span>
      {POKEMON_TYPES.map((tp) => {
        const isOn = selected.includes(tp);
        const c = TYPE_COLORS[tp];
        const q = toggleParams(tp);
        return (
          <Link
            key={tp}
            href={q ? `/pokemon-champions/pokemon?${q}` : "/pokemon-champions/pokemon"}
            scroll={false}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-all",
              isOn
                ? cn(c.bg, c.text, c.border, "shadow")
                : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {types(tp)}
          </Link>
        );
      })}
      {selected.length > 0 ? (
        <Link
          href="/pokemon-champions/pokemon"
          className="ml-2 text-xs font-medium text-zinc-600 underline hover:text-zinc-950 dark:text-zinc-400"
        >
          {t("clear")}
        </Link>
      ) : null}
    </div>
  );
}
