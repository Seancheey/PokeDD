"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { TypeChip } from "@/components/TypeChip";
import { EFFECTIVENESS } from "@/lib/type-chart";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";

type Bucket = { mult: 2 | 0.5 | 0; types: PokemonType[] };

function bucketsForAttack(atk: PokemonType): Bucket[] {
  const se: PokemonType[] = [];
  const nve: PokemonType[] = [];
  const im: PokemonType[] = [];
  for (const def of POKEMON_TYPES) {
    const m = EFFECTIVENESS[atk][def];
    if (m === 2) se.push(def);
    else if (m === 0.5) nve.push(def);
    else if (m === 0) im.push(def);
  }
  return [
    { mult: 2, types: se },
    { mult: 0.5, types: nve },
    { mult: 0, types: im },
  ];
}

function bucketsForDefense(def: PokemonType): Bucket[] {
  const weakTo: PokemonType[] = [];
  const resists: PokemonType[] = [];
  const immuneTo: PokemonType[] = [];
  for (const atk of POKEMON_TYPES) {
    const m = EFFECTIVENESS[atk][def];
    if (m === 2) weakTo.push(atk);
    else if (m === 0.5) resists.push(atk);
    else if (m === 0) immuneTo.push(atk);
  }
  return [
    { mult: 2, types: weakTo },
    { mult: 0.5, types: resists },
    { mult: 0, types: immuneTo },
  ];
}

function multSymbol(m: 2 | 0.5 | 0): string {
  if (m === 0) return "×0";
  if (m === 0.5) return "×½";
  return "×2";
}

function multTone(m: 2 | 0.5 | 0, perspective: "atk" | "def"): string {
  // From the attacker's perspective: ×2 is good (green), ×½/×0 are bad.
  // From the defender's perspective: ×2 is bad (red), ×½/×0 are good.
  if (m === 2) {
    return perspective === "atk"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-red-700 dark:text-red-300";
  }
  if (m === 0.5) {
    return perspective === "atk"
      ? "text-zinc-500 dark:text-zinc-400"
      : "text-emerald-700 dark:text-emerald-300";
  }
  return "text-sky-700 dark:text-sky-300";
}

function Section({
  title,
  buckets,
  perspective,
}: {
  title: string;
  buckets: Bucket[];
  perspective: "atk" | "def";
}) {
  const nonEmpty = buckets.filter((b) => b.types.length > 0);
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className="space-y-1">
        {nonEmpty.map((b) => (
          <div key={b.mult} className="flex items-start gap-1.5">
            <span
              className={`mt-0.5 w-7 shrink-0 font-mono text-[11px] font-bold ${multTone(b.mult, perspective)}`}
            >
              {multSymbol(b.mult)}
            </span>
            <span className="flex flex-wrap gap-0.5">
              {b.types.map((tp) => (
                <TypeChip key={tp} type={tp} size="sm" />
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps a TypeChip with a hover tooltip showing the full type matchup chart
 * for that type — both attacking (which types it hits hard/weak/no-effect)
 * and defending (which types hit it hard/weak/no-effect).
 *
 * Used in the Team Builder defense/offense tables so users can sanity-check
 * a row's color without leaving the page. Renders via portal so the tooltip
 * escapes the table's overflow-x-auto clipping.
 */
export function TypeMatchupTooltip({
  type,
  size = "sm",
}: {
  type: PokemonType;
  size?: "sm" | "md";
}) {
  const t = useTranslations("TeamBuilder");
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePos = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const tooltipWidth = 256; // matches w-64
    const margin = 8;
    const vw = window.innerWidth;
    // Default: right side of chip. Flip to left if it would clip.
    let left = r.right + margin;
    if (left + tooltipWidth > vw - 4) {
      left = Math.max(4, r.left - margin - tooltipWidth);
    }
    setPos({ left, top: r.top + r.height / 2 });
  }, []);

  const atkBuckets = bucketsForAttack(type);
  const defBuckets = bucketsForDefense(type);

  return (
    <>
      <span
        ref={anchorRef}
        className="relative inline-block cursor-help"
        onMouseEnter={() => {
          updatePos();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePos();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        tabIndex={0}
      >
        <TypeChip type={type} size={size} />
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              role="tooltip"
              style={{
                left: pos.left,
                top: pos.top,
                transform: "translateY(-50%)",
              }}
              className="pointer-events-none fixed z-50 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="space-y-2.5">
                <Section
                  title={t("matchupAttacks")}
                  buckets={atkBuckets}
                  perspective="atk"
                />
                <Section
                  title={t("matchupDefends")}
                  buckets={defBuckets}
                  perspective="def"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
