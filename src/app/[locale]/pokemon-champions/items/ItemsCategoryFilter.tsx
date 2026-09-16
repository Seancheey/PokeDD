"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

const CATEGORIES = [
  { slug: "held", labelKey: "categoryHeld" },
  { slug: "choice", labelKey: "categoryChoice" },
  { slug: "berry", labelKey: "categoryBerry" },
  { slug: "mega-stone", labelKey: "categoryMega" },
  { slug: "type-boost", labelKey: "categoryTypeBoost" },
  { slug: "misc", labelKey: "categoryMisc" },
] as const;

export function ItemsCategoryFilter({ selected }: { selected: string | null }) {
  const sp = useSearchParams();
  const t = useTranslations("Items");

  function withCat(slug: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (slug == null) next.delete("cat");
    else next.set("cat", slug);
    const s = next.toString();
    return s ? `/pokemon-champions/items?${s}` : "/pokemon-champions/items";
  }

  const chip =
    "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors";
  const off =
    "border-zinc-300 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400";
  const on =
    "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {t("categoryLabel")}
      </span>
      <Link href={withCat(null)} scroll={false} className={cn(chip, !selected ? on : off)}>
        {t("categoryAll")}
      </Link>
      {CATEGORIES.map((c) => (
        <Link
          key={c.slug}
          href={withCat(selected === c.slug ? null : c.slug)}
          scroll={false}
          className={cn(chip, selected === c.slug ? on : off)}
        >
          {t(c.labelKey)}
        </Link>
      ))}
    </div>
  );
}
