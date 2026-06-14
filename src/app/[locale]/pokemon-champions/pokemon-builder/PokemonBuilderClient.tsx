"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TypeChip } from "@/components/TypeChip";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import type { PokemonType } from "@/lib/types";
import {
  calc,
  computeStat,
  isVariablePowerMove,
  NATURES,
  natureEffect,
  type Nature,
  type CalcInput,
} from "@/lib/damage";
import { cn } from "@/lib/cn";
import { onLoadSavedMon } from "@/lib/my-pokemon";
import { SaveMyPokemonButton } from "@/components/SaveMyPokemonButton";
import {
  loadFormatPref,
  onFormatPrefChange,
  type BattleFormat,
} from "@/lib/format-pref";

/**
 * Internal RefPokemon shape — `usage` is the *current-format* slice. The
 * server passes both formats via `usageByFormat`; the client picks one
 * via the global format preference and rebuilds this view reactively
 * when the user flips the Nav toggle.
 */
export type BuilderRefPokemon = {
  slug: string;
  name: string;
  type1: string;
  type2: string | null;
  spriteUrl: string;
  abilities: string[];
  hiddenAbility: string | null;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  /** Body weight in hectograms (PokeAPI native). Needed for Heavy Slam / Low Kick / … */
  weight: number;
  learnableMoves: string[];
  usagePct: number;
  usage: PokemonUsage | null;
};
export type BuilderRawRefPokemon = Omit<BuilderRefPokemon, "usage"> & {
  usageByFormat: { singles: PokemonUsage | null; doubles: PokemonUsage | null } | null;
};
export type PokemonUsage = {
  topAbilities: Array<{ slug: string; pct: number }>;
  topItems: Array<{ slug: string; pct: number }>;
  topMoves: Array<{ slug: string; pct: number }>;
  topSpreads: Array<{
    nature: string;
    vp: [number, number, number, number, number, number];
    pct: number;
  }>;
  source?: string;
};
export type BuilderRefMove = {
  slug: string;
  name: string;
  type: string;
  category: "physical" | "special" | "status";
  power: number | null;
  targetShape: string;
};
export type BuilderRefAbility = { slug: string; name: string };
export type BuilderRefItem = { slug: string; name: string };

const PER_STAT_CAP = 32;
const MAX_EV_TOTAL = 66;
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
type StatKey = (typeof STAT_KEYS)[number];

// Items that change a Pokémon's effective Speed. Used to badge the row sprite
// in the speed-tier table so the user can see at a glance why a threat is
// faster/slower than its raw base stat would suggest.
const SPEED_MODIFYING_ITEMS = new Set(["choice-scarf", "iron-ball"]);

function itemSpriteUrl(slug: string): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${slug}.png`;
}

type Build = {
  slug: string;
  ability: string;
  item: string;
  nature: Nature;
  moves: string[];           // length 4, "" for empty
  ev: [number, number, number, number, number, number];
  stages: { atk: number; def: number; spa: number; spd: number; spe: number };
};

// Per-target overrides applied on top of the usage-derived default build.
// Lives in BuilderBody state and flows through Speed/Offense/Defense cards.
type TargetOverrides = Partial<Pick<Build, "ability" | "item" | "nature" | "ev" | "stages">>;
type TargetOverridesMap = Map<string, TargetOverrides>;

const ANALYSIS_TABS = [
  { id: "speed", labelKey: "tabSpeed" },
  { id: "offense", labelKey: "tabOffense" },
  { id: "defense", labelKey: "tabDefense" },
] as const;
type AnalysisTabId = (typeof ANALYSIS_TABS)[number]["id"];

// ─────────────────────────────────────────────────────────────────────────────

export function PokemonBuilderClient({
  pokemonRaw,
  moves,
  abilities,
  items,
}: {
  pokemonRaw: BuilderRawRefPokemon[];
  moves: BuilderRefMove[];
  abilities: BuilderRefAbility[];
  items: BuilderRefItem[];
}) {
  const t = useTranslations("PokemonBuilder");

  // Global format preference (Nav title-bar toggle) — flips singles/doubles
  // and re-derives the per-Pokémon usage slice on the fly.
  const format = useSyncExternalStore<BattleFormat>(
    onFormatPrefChange,
    loadFormatPref,
    () => "doubles" satisfies BattleFormat,
  );

  const pokemon: BuilderRefPokemon[] = useMemo(
    () => pokemonRaw.map((p) => ({
      ...p,
      usage: p.usageByFormat?.[format] ?? null,
    })),
    [pokemonRaw, format],
  );

  const pokemonBySlug = useMemo(() => new Map(pokemon.map((p) => [p.slug, p])), [pokemon]);
  const moveBySlug = useMemo(() => new Map(moves.map((m) => [m.slug, m])), [moves]);
  const abilityBySlug = useMemo(() => new Map(abilities.map((a) => [a.slug, a])), [abilities]);
  const itemBySlug = useMemo(() => new Map(items.map((i) => [i.slug, i])), [items]);

  const top30 = useMemo(
    () => pokemon.filter((p) => p.usagePct > 0).slice(0, 30),
    [pokemon],
  );

  const [build, setBuild] = useState<Build | null>(null);
  const [customSlugs, setCustomSlugs] = useState<string[]>([]);
  // The comparison tables seed with the meta's most-used Pokémon by default.
  // Users can clear these to compare only against their own custom picks.
  const [includeDefaults, setIncludeDefaults] = useState(true);
  // Default Pokémon the user has individually deleted from the tables (custom
  // picks are removed by dropping them from `customSlugs` instead).
  const [removedSlugs, setRemovedSlugs] = useState<string[]>([]);

  const addCustom = (slug: string) => {
    setRemovedSlugs((prev) => prev.filter((s) => s !== slug));
    setCustomSlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
  };
  const removeTarget = (slug: string) => {
    if (customSlugs.includes(slug)) {
      setCustomSlugs((prev) => prev.filter((s) => s !== slug));
    } else {
      setRemovedSlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
    }
  };
  const toggleDefaults = () => {
    // Restoring defaults also un-deletes individually-removed ones.
    if (!includeDefaults) setRemovedSlugs([]);
    setIncludeDefaults((v) => !v);
  };

  // Subscribe to "load saved mon" events from the My Pokémon FAB — replace
  // the current build with the saved configuration so the user lands in
  // a fully-populated builder.
  useEffect(() => {
    return onLoadSavedMon((mon) => {
      if (!pokemonBySlug.has(mon.slug)) return;
      setBuild({
        slug: mon.slug,
        ability: mon.ability,
        item: mon.item,
        nature: mon.nature as Nature,
        moves: [...mon.moves].concat(Array(4).fill("")).slice(0, 4),
        ev: [...mon.ev] as Build["ev"],
        stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      });
    });
  }, [pokemonBySlug]);

  // Preselect a species from the `?mon=<slug>` query param (the "Build this
  // Pokémon" CTA on the species detail page links here). Runs once on mount.
  const searchParams = useSearchParams();
  useEffect(() => {
    const slug = searchParams.get("mon");
    if (slug && pokemonBySlug.has(slug)) selectPokemon(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Targets: default most-used set (unless cleared) + custom additions
  // (deduped, custom appended in order), minus any individually-removed rows.
  const targets = useMemo(() => {
    const removed = new Set(removedSlugs);
    const base = (includeDefaults ? top30 : []).filter((p) => !removed.has(p.slug));
    const seen = new Set(base.map((p) => p.slug));
    const customs = customSlugs
      .map((s) => pokemonBySlug.get(s))
      .filter((p): p is BuilderRefPokemon => !!p && !seen.has(p.slug) && !removed.has(p.slug));
    return [...base, ...customs];
  }, [top30, customSlugs, pokemonBySlug, includeDefaults, removedSlugs]);

  function selectPokemon(slug: string) {
    const p = pokemonBySlug.get(slug);
    if (!p) return;
    const u = p.usage;
    const validAbilities = new Set([...p.abilities, ...(p.hiddenAbility ? [p.hiddenAbility] : [])]);
    const topAbility = u?.topAbilities.find((a) => validAbilities.has(a.slug))?.slug;
    const topItem = u?.topItems[0]?.slug ?? "";
    const learnable = new Set(p.learnableMoves);
    const topMoves: string[] = [];
    for (const m of u?.topMoves ?? []) {
      if (!learnable.has(m.slug)) continue;
      topMoves.push(m.slug);
      if (topMoves.length === 4) break;
    }
    while (topMoves.length < 4) topMoves.push("");
    const topSpread = u?.topSpreads[0];
    const nature = (topSpread?.nature ?? "Adamant") as Nature;
    const ev = (topSpread?.vp ?? [0, 0, 0, 0, 0, 0]) as Build["ev"];
    setBuild({
      slug,
      ability: topAbility ?? p.abilities[0] ?? "",
      item: topItem,
      nature,
      moves: topMoves,
      ev,
      stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    });
  }

  const pickerOptions: ComboboxOption[] = useMemo(
    () => pokemon
      .filter((p) => p.usagePct >= 0)
      .map((p) => ({
        value: p.slug,
        label: p.name,
        searchText: p.slug,
        usagePct: p.usagePct,
        prefix: (
          <Image src={p.spriteUrl} alt="" width={28} height={28} unoptimized />
        ),
      })),
    [pokemon],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("subtitle")}</p>
      </header>

      {!build ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">{t("pickPrompt")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("pickHint")}</p>
          <div className="mt-4 max-w-md">
            <Combobox
              value=""
              onChange={selectPokemon}
              options={pickerOptions}
              placeholder={t("speciesPlaceholder")}
            />
          </div>
        </section>
      ) : (
        <BuilderBody
          build={build}
          setBuild={setBuild}
          pokemonBySlug={pokemonBySlug}
          moveBySlug={moveBySlug}
          abilityBySlug={abilityBySlug}
          itemBySlug={itemBySlug}
          pickerOptions={pickerOptions}
          allMoves={moves}
          allItems={items}
          targets={targets}
          customSlugs={customSlugs}
          onAddCustom={addCustom}
          onRemoveTarget={removeTarget}
          includeDefaults={includeDefaults}
          onToggleDefaults={toggleDefaults}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function BuilderBody({
  build,
  setBuild,
  pokemonBySlug,
  moveBySlug,
  abilityBySlug,
  itemBySlug,
  pickerOptions,
  allMoves,
  allItems,
  targets,
  customSlugs,
  onAddCustom,
  onRemoveTarget,
  includeDefaults,
  onToggleDefaults,
}: {
  build: Build;
  setBuild: (b: Build | null | ((prev: Build | null) => Build | null)) => void;
  pokemonBySlug: Map<string, BuilderRefPokemon>;
  moveBySlug: Map<string, BuilderRefMove>;
  abilityBySlug: Map<string, BuilderRefAbility>;
  itemBySlug: Map<string, BuilderRefItem>;
  pickerOptions: ComboboxOption[];
  allMoves: BuilderRefMove[];
  allItems: BuilderRefItem[];
  targets: BuilderRefPokemon[];
  customSlugs: string[];
  onAddCustom: (slug: string) => void;
  onRemoveTarget: (slug: string) => void;
  includeDefaults: boolean;
  onToggleDefaults: () => void;
}) {
  const t = useTranslations("PokemonBuilder");
  const [activeTab, setActiveTab] = useState<AnalysisTabId>("speed");
  const [targetOverrides, setTargetOverrides] = useState<TargetOverridesMap>(new Map());
  const p = pokemonBySlug.get(build.slug);
  if (!p) return null;

  function update(mut: (b: Build) => Build) {
    setBuild((prev) => (prev ? mut(prev) : prev));
  }

  // Reset to a fresh species pick — clears all overrides.
  function reset() { setBuild(null); }

  function updateTargetOverride(slug: string, mut: (cur: TargetOverrides) => TargetOverrides) {
    setTargetOverrides((prev) => {
      const next = new Map(prev);
      next.set(slug, mut(next.get(slug) ?? {}));
      return next;
    });
  }

  function resetTargetOverride(slug: string) {
    setTargetOverrides((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Map(prev);
      next.delete(slug);
      return next;
    });
  }

  function focusAnalysisTab(id: AnalysisTabId) {
    setActiveTab(id);
    requestAnimationFrame(() => {
      document.getElementById(`pokemon-builder-tab-${id}`)?.focus();
    });
  }

  function onAnalysisTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: AnalysisTabId,
  ) {
    const current = ANALYSIS_TABS.findIndex((tab) => tab.id === id);
    const last = ANALYSIS_TABS.length - 1;
    let next = current;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = current === last ? 0 : current + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = current === 0 ? last : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }

    event.preventDefault();
    focusAnalysisTab(ANALYSIS_TABS[next].id);
  }

  return (
    <div className="space-y-6">
      <ConfigPanel
        p={p}
        build={build}
        update={update}
        reset={reset}
        moveBySlug={moveBySlug}
        abilityBySlug={abilityBySlug}
        itemBySlug={itemBySlug}
        pickerOptions={pickerOptions}
        allMoves={allMoves}
        allItems={allItems}
        setBuild={setBuild}
        pokemonBySlug={pokemonBySlug}
      />
      <ComputedStatsCard p={p} build={build} />
      <CustomTargetsCard
        customSlugs={customSlugs}
        onAddCustom={onAddCustom}
        onRemoveTarget={onRemoveTarget}
        pickerOptions={pickerOptions}
        pokemonBySlug={pokemonBySlug}
        includeDefaults={includeDefaults}
        onToggleDefaults={onToggleDefaults}
      />

      <section className="min-w-0">
        <div
          role="tablist"
          aria-label={t("analysisTabs")}
          className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950"
        >
          {ANALYSIS_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`pokemon-builder-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`pokemon-builder-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => onAnalysisTabKeyDown(event, tab.id)}
                className={cn(
                  "min-h-10 shrink-0 rounded-md px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500",
                  active
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-800"
                    : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-100",
                )}
              >
                {t(tab.labelKey as never)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="pokemon-builder-panel-speed"
          aria-labelledby="pokemon-builder-tab-speed"
          hidden={activeTab !== "speed"}
          className="mt-4 min-w-0"
        >
          <SpeedTierCard
            p={p}
            build={build}
            targets={targets}
            targetOverrides={targetOverrides}
            updateTargetOverride={updateTargetOverride}
            resetTargetOverride={resetTargetOverride}
            onRemoveTarget={onRemoveTarget}
            itemBySlug={itemBySlug}
            abilityBySlug={abilityBySlug}
            allItems={allItems}
          />
        </div>
        <div
          role="tabpanel"
          id="pokemon-builder-panel-offense"
          aria-labelledby="pokemon-builder-tab-offense"
          hidden={activeTab !== "offense"}
          className="mt-4 min-w-0"
        >
          <OffenseMatrixCard
            p={p}
            build={build}
            targets={targets}
            moveBySlug={moveBySlug}
            targetOverrides={targetOverrides}
            onRemoveTarget={onRemoveTarget}
          />
        </div>
        <div
          role="tabpanel"
          id="pokemon-builder-panel-defense"
          aria-labelledby="pokemon-builder-tab-defense"
          hidden={activeTab !== "defense"}
          className="mt-4 min-w-0"
        >
          <DefenseMatrixCard
            p={p}
            build={build}
            targets={targets}
            moveBySlug={moveBySlug}
            targetOverrides={targetOverrides}
            onRemoveTarget={onRemoveTarget}
          />
        </div>
      </section>
    </div>
  );
}

// ─── Config panel ────────────────────────────────────────────────────────────

function ConfigPanel({
  p,
  build,
  update,
  reset,
  setBuild,
  moveBySlug,
  abilityBySlug,
  itemBySlug,
  pickerOptions,
  allMoves,
  allItems,
  pokemonBySlug,
}: {
  p: BuilderRefPokemon;
  build: Build;
  update: (mut: (b: Build) => Build) => void;
  reset: () => void;
  setBuild: (b: Build | null | ((prev: Build | null) => Build | null)) => void;
  moveBySlug: Map<string, BuilderRefMove>;
  abilityBySlug: Map<string, BuilderRefAbility>;
  itemBySlug: Map<string, BuilderRefItem>;
  pickerOptions: ComboboxOption[];
  allMoves: BuilderRefMove[];
  allItems: BuilderRefItem[];
  pokemonBySlug: Map<string, BuilderRefPokemon>;
}) {
  const t = useTranslations("PokemonBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");
  const tStatShort = useTranslations("StatShort");
  const tNature = useTranslations("Natures");

  const validAbilities = useMemo(() => {
    const arr = [...p.abilities];
    if (p.hiddenAbility && !arr.includes(p.hiddenAbility)) arr.push(p.hiddenAbility);
    return arr;
  }, [p]);
  const pctByMove = useMemo(
    () => new Map(p.usage?.topMoves.map((m) => [m.slug, m.pct]) ?? []),
    [p],
  );
  const pctByAbility = useMemo(
    () => new Map(p.usage?.topAbilities.map((a) => [a.slug, a.pct]) ?? []),
    [p],
  );
  const pctByItem = useMemo(
    () => new Map(p.usage?.topItems.map((i) => [i.slug, i.pct]) ?? []),
    [p],
  );

  const abilityOptions: ComboboxOption[] = validAbilities.map((a) => {
    const ref = abilityBySlug.get(a);
    return {
      value: a,
      label: ref?.name ?? a,
      searchText: a,
      usagePct: pctByAbility.get(a),
      suffix: p.hiddenAbility === a ? "★" : null,
    };
  });
  const itemOptions: ComboboxOption[] = allItems.map((it) => ({
    value: it.slug,
    label: it.name,
    searchText: it.slug,
    usagePct: pctByItem.get(it.slug),
  }));
  const learnable = useMemo(() => new Set(p.learnableMoves), [p]);
  const moveOptions: ComboboxOption[] = allMoves
    .filter((m) => learnable.has(m.slug))
    .map((m) => ({
      value: m.slug,
      label: m.name,
      searchText: m.slug,
      usagePct: pctByMove.get(m.slug),
    }));

  const ev = build.ev;
  const totalEv = ev.reduce((a, b) => a + b, 0);
  const remaining = MAX_EV_TOTAL - totalEv;
  const natureOptions: ComboboxOption[] = NATURES.map((n) => {
    const { up, down } = natureEffect(n);
    const localized = tNature(n as never);
    const annot = up && down
      ? ` +${tStatShort(up)} −${tStatShort(down)}`
      : ` ${tNature("neutralSuffix")}`;
    return { value: n, label: localized + annot, searchText: n };
  });

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <div className="flex flex-wrap items-start gap-3 sm:items-center">
        <Image
          src={p.spriteUrl}
          alt={p.name}
          width={60}
          height={60}
          className="shrink-0"
          unoptimized
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{p.name}</div>
          <div className="mt-1 flex gap-1">
            <TypeChip type={p.type1 as PokemonType} size="sm" />
            {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <SaveMyPokemonButton
            variant="pill"
            className="w-full whitespace-nowrap sm:w-auto"
            mon={{
              slug: build.slug,
              name: p.name,
              spriteUrl: p.spriteUrl,
              type1: p.type1,
              type2: p.type2,
              ability: build.ability,
              abilityName: abilityBySlug.get(build.ability)?.name ?? build.ability,
              item: build.item,
              itemName: build.item ? (itemBySlug.get(build.item)?.name ?? build.item) : "",
              nature: build.nature,
              moves: build.moves,
              moveNames: build.moves.map((m) => (m ? (moveBySlug.get(m)?.name ?? m) : "")),
              ev: build.ev,
            }}
          />
          <button
            type="button"
            onClick={reset}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-sm text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            title={t("changeSpecies")}
            aria-label={t("changeSpecies")}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-4">
          <div>
            <Label>{t("species")}</Label>
            <Combobox
              value={build.slug}
              onChange={(slug) => {
                const np = pokemonBySlug.get(slug);
                if (!np) return;
                // Re-auto-fill from the new species' usage data
                const u = np.usage;
                const valid = new Set([...np.abilities, ...(np.hiddenAbility ? [np.hiddenAbility] : [])]);
                const topAb = u?.topAbilities.find((a) => valid.has(a.slug))?.slug;
                const topIt = u?.topItems[0]?.slug ?? "";
                const lset = new Set(np.learnableMoves);
                const tm: string[] = [];
                for (const m of u?.topMoves ?? []) {
                  if (!lset.has(m.slug)) continue;
                  tm.push(m.slug);
                  if (tm.length === 4) break;
                }
                while (tm.length < 4) tm.push("");
                const sp = u?.topSpreads[0];
                setBuild({
                  slug,
                  ability: topAb ?? np.abilities[0] ?? "",
                  item: topIt,
                  nature: (sp?.nature ?? "Adamant") as Nature,
                  moves: tm,
                  ev: (sp?.vp ?? [0, 0, 0, 0, 0, 0]) as Build["ev"],
                  stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
                });
              }}
              options={pickerOptions}
            />
          </div>

          <div>
            <Label>{t("ability")}</Label>
            <Combobox
              value={build.ability}
              onChange={(v) => update((b) => ({ ...b, ability: v }))}
              options={abilityOptions}
            />
          </div>

          <div>
            <Label>{t("item")}</Label>
            <Combobox
              value={build.item}
              onChange={(v) => update((b) => ({ ...b, item: v }))}
              options={itemOptions}
              allowClear
            />
          </div>

          <div>
            <Label>{t("nature")}</Label>
            <Combobox
              value={build.nature}
              onChange={(v) => update((b) => ({ ...b, nature: v as Nature }))}
              options={natureOptions}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("moves")}</Label>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Combobox
                key={i}
                value={build.moves[i] ?? ""}
                onChange={(v) => update((b) => {
                  const m = [...b.moves];
                  m[i] = v;
                  return { ...b, moves: m };
                })}
                options={moveOptions}
                placeholder={`${t("moveSlot")} ${i + 1}`}
                allowClear
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs">
              <Label>{t("evs")}</Label>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  remaining < 0 ? "font-bold text-red-600"
                  : remaining === 0 ? "text-emerald-600"
                  : "text-zinc-500",
                )}
              >
                {remaining < 0 ? `+${-remaining} ${t("over")}` : `${remaining} ${t("left")}`}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1.5 text-xs">
              {STAT_KEYS.map((k, i) => (
                <label key={k} className="flex items-center gap-1.5">
                  <span className="w-10 shrink-0 font-semibold uppercase text-zinc-500">
                    {tStat(k as StatKey)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={PER_STAT_CAP}
                    step={1}
                    value={ev[i] ?? 0}
                    onChange={(e) => update((b) => {
                      const v = Math.max(0, Math.min(PER_STAT_CAP, parseInt(e.target.value) || 0));
                      const next = [...b.ev] as Build["ev"];
                      next[i] = v;
                      return { ...b, ev: next };
                    })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-right font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>{t("stages")}</Label>
            <div className="mt-1 grid grid-cols-2 gap-1.5 text-xs">
              {(["atk","def","spa","spd","spe"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  <span className="w-10 shrink-0 font-semibold uppercase text-zinc-500">
                    {tStat(k as StatKey)}
                  </span>
                  <Stepper
                    value={build.stages[k]}
                    min={-6}
                    max={6}
                    onChange={(v) => update((b) => ({ ...b, stages: { ...b.stages, [k]: v } }))}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const tone = value > 0 ? "text-emerald-600" : value < 0 ? "text-red-600" : "text-zinc-500";
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="rounded border border-zinc-300 px-1.5 leading-none dark:border-zinc-700"
      >−</button>
      <span className={cn("w-6 text-center font-mono tabular-nums", tone)}>
        {value > 0 ? `+${value}` : value}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="rounded border border-zinc-300 px-1.5 leading-none dark:border-zinc-700"
      >+</button>
    </div>
  );
}

// ─── Computed stats ──────────────────────────────────────────────────────────

function ComputedStatsCard({ p, build }: { p: BuilderRefPokemon; build: Build }) {
  const t = useTranslations("PokemonBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");

  const stats = useMemo(() => ({
    hp:  computeStat(p.hp,  build.ev[0], build.nature, "atk", true),
    atk: computeStat(p.atk, build.ev[1], build.nature, "atk", false),
    def: computeStat(p.def, build.ev[2], build.nature, "def", false),
    spa: computeStat(p.spa, build.ev[3], build.nature, "spa", false),
    spd: computeStat(p.spd, build.ev[4], build.nature, "spd", false),
    spe: computeStat(p.spe, build.ev[5], build.nature, "spe", false),
  }), [p, build.nature, build.ev]);
  const bst = p.hp + p.atk + p.def + p.spa + p.spd + p.spe;
  const fx = natureEffect(build.nature);

  return (
    <Card title={t("computedStats")}>
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-2 py-1.5 text-left">{t("stat")}</th>
            <th className="px-2 py-1.5 text-right">{t("base")}</th>
            <th className="px-2 py-1.5 text-right">{t("ev")}</th>
            <th className="px-2 py-1.5 text-right">{t("computed")}</th>
          </tr>
        </thead>
        <tbody>
          {(["hp","atk","def","spa","spd","spe"] as const).map((k, i) => {
            const arrow = fx.up === k ? "▲" : fx.down === k ? "▼" : "";
            const arrowTone = fx.up === k ? "text-red-500" : fx.down === k ? "text-blue-500" : "";
            return (
              <tr key={k} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                <td className="px-2 py-1.5 font-semibold uppercase text-zinc-600 dark:text-zinc-400">
                  {tStat(k as StatKey)} <span className={arrowTone}>{arrow}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-500">
                  {p[k]}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-500">
                  {build.ev[i]}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums font-bold">
                  {stats[k]}
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="px-2 py-1.5 text-xs uppercase tracking-wider text-zinc-500">BST</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-500">{bst}</td>
            <td colSpan={2}></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ─── Speed tier ──────────────────────────────────────────────────────────────

function SpeedTierCard({
  p,
  build,
  targets,
  targetOverrides,
  updateTargetOverride,
  resetTargetOverride,
  onRemoveTarget,
  itemBySlug,
  abilityBySlug,
  allItems,
}: {
  p: BuilderRefPokemon;
  build: Build;
  targets: BuilderRefPokemon[];
  targetOverrides: TargetOverridesMap;
  updateTargetOverride: (slug: string, mut: (cur: TargetOverrides) => TargetOverrides) => void;
  resetTargetOverride: (slug: string) => void;
  onRemoveTarget: (slug: string) => void;
  itemBySlug: Map<string, BuilderRefItem>;
  abilityBySlug: Map<string, BuilderRefAbility>;
  allItems: BuilderRefItem[];
}) {
  const t = useTranslations("PokemonBuilder");

  const [mods, setMods] = useState({ tailwind: false, scarf: false });
  // Stages already in build; expose Tailwind / Scarf as overlay multipliers.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  const mySpe = useMemo(() => {
    let s = computeStat(p.spe, build.ev[5], build.nature, "spe", false);
    s = Math.floor(s * stageMult(build.stages.spe));
    if (build.item === "choice-scarf" || mods.scarf) s = Math.floor(s * 1.5);
    if (mods.tailwind) s = Math.floor(s * 2);
    if (build.item === "iron-ball") s = Math.floor(s * 0.5);
    return s;
  }, [p, build, mods]);

  const rows = useMemo(() => {
    return targets.map((tp) => {
      const tb = resolveTargetBuild(tp, targetOverrides.get(tp.slug));
      const s = speedFromBuild(tp, tb);
      return { p: tp, spe: s, build: tb };
    }).sort((a, b) => b.spe - a.spe);
  }, [targets, targetOverrides]);

  return (
    <Card
      title={t("speedTier")}
      action={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Pill
            active={mods.tailwind}
            onClick={() => setMods((m) => ({ ...m, tailwind: !m.tailwind }))}
            label={t("tailwind")}
          />
          <Pill
            active={mods.scarf}
            onClick={() => setMods((m) => ({ ...m, scarf: !m.scarf }))}
            label={t("scarf")}
          />
          <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 font-mono tabular-nums dark:bg-zinc-800">
            {t("yourSpeed")}: <span className="font-bold">{mySpe}</span>
          </span>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">{t("pokemon")}</th>
              <th className="px-2 py-1.5 text-right">{t("usage")}</th>
              <th className="px-2 py-1.5 text-right">{t("speed")}</th>
              <th className="px-2 py-1.5 text-right">{t("vsYou")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const diff = mySpe - r.spe;
              const tone = diff > 0
                ? "text-emerald-600"
                : diff < 0 ? "text-red-600" : "text-zinc-500";
              const label = diff > 0 ? t("outspeed") : diff < 0 ? t("outsped") : t("tied");
              const editing = editingSlug === r.p.slug;
              const customized = targetOverrides.has(r.p.slug);
              const speedItem = SPEED_MODIFYING_ITEMS.has(r.build.item) ? r.build.item : null;
              const speedItemName = speedItem
                ? itemBySlug.get(speedItem)?.name ?? speedItem
                : null;
              return (
                <Fragment key={r.p.slug}>
                  <tr className={cn(
                    "group border-b border-zinc-100 last:border-b-0 dark:border-zinc-800",
                    r.p.slug === build.slug && "bg-zinc-50 dark:bg-zinc-900/50",
                    editing && "bg-amber-50/60 dark:bg-amber-950/20",
                  )}>
                    <td className="px-2 py-1.5 text-zinc-400 font-mono tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingSlug(editing ? null : r.p.slug)}
                          aria-expanded={editing}
                          aria-label={t("editConfigFor", { name: r.p.name })}
                          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left -mx-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                        >
                          <span className="relative inline-block shrink-0">
                            <Image src={r.p.spriteUrl} alt="" width={24} height={24} unoptimized />
                            {speedItem ? (
                              <Image
                                src={itemSpriteUrl(speedItem)}
                                alt=""
                                width={14}
                                height={14}
                                unoptimized
                                title={speedItemName ?? speedItem}
                                className="absolute -bottom-1 -right-1 rounded-full bg-white shadow-sm ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700"
                              />
                            ) : null}
                          </span>
                          <span className="font-medium">{r.p.name}</span>
                          {customized ? (
                            <span
                              className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                              title={t("customized")}
                              aria-label={t("customized")}
                            />
                          ) : null}
                        </button>
                        <RowDeleteButton
                          onClick={() => onRemoveTarget(r.p.slug)}
                          label={t("removeFromComparison", { name: r.p.name })}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-500">
                      {r.p.usagePct > 0 ? `${r.p.usagePct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.spe}</td>
                    <td className={cn("px-2 py-1.5 text-right font-mono tabular-nums", tone)}>
                      {label} ({diff > 0 ? "+" : ""}{diff})
                    </td>
                  </tr>
                  {editing ? (
                    <tr className="border-b border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <td colSpan={5} className="px-3 py-3">
                        <TargetEditor
                          p={r.p}
                          build={r.build}
                          customized={customized}
                          onChange={(mut) => updateTargetOverride(r.p.slug, mut)}
                          onReset={() => resetTargetOverride(r.p.slug)}
                          onClose={() => setEditingSlug(null)}
                          abilityBySlug={abilityBySlug}
                          allItems={allItems}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Offense matrix ──────────────────────────────────────────────────────────

function OffenseMatrixCard({
  p,
  build,
  targets,
  moveBySlug,
  targetOverrides,
  onRemoveTarget,
}: {
  p: BuilderRefPokemon;
  build: Build;
  targets: BuilderRefPokemon[];
  moveBySlug: Map<string, BuilderRefMove>;
  targetOverrides: TargetOverridesMap;
  onRemoveTarget: (slug: string) => void;
}) {
  const t = useTranslations("PokemonBuilder");

  const myDamagingMoves = useMemo(() => {
    return build.moves
      .map((s) => moveBySlug.get(s))
      .filter((m): m is BuilderRefMove => !!m && m.category !== "status" && ((m.power ?? 0) > 0 || isVariablePowerMove(m.slug)));
  }, [build.moves, moveBySlug]);

  return (
    <Card title={t("offenseTitle")} subtitle={t("offenseHint")}>
      {myDamagingMoves.length === 0 ? (
        <Empty>{t("noOffensiveMoves")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left dark:bg-zinc-900">
                  {t("target")}
                </th>
                {myDamagingMoves.map((m) => (
                  <th key={m.slug} className="px-2 py-1.5 text-center">
                    <span className="inline-flex items-center gap-1">
                      <TypeChip type={m.type as PokemonType} size="sm" />
                      <span className="text-zinc-700 dark:text-zinc-300">{m.name}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {targets.map((tp) => (
                <tr key={tp.slug} className="group border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <td className="sticky left-0 z-10 bg-white px-2 py-1.5 dark:bg-zinc-900">
                    <span className="inline-flex items-center gap-1.5">
                      <Image src={tp.spriteUrl} alt="" width={22} height={22} unoptimized />
                      <span className="font-medium">{tp.name}</span>
                      <RowDeleteButton
                        onClick={() => onRemoveTarget(tp.slug)}
                        label={t("removeFromComparison", { name: tp.name })}
                      />
                    </span>
                  </td>
                  {myDamagingMoves.map((m) => (
                    <td key={m.slug} className="px-1.5 py-1.5 text-center">
                      <DamageCell
                        attacker={p}
                        attackerBuild={build}
                        defender={tp}
                        defenderBuild={resolveTargetBuild(tp, targetOverrides.get(tp.slug))}
                        move={m}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Defense matrix ──────────────────────────────────────────────────────────

function DefenseMatrixCard({
  p,
  build,
  targets,
  moveBySlug,
  targetOverrides,
  onRemoveTarget,
}: {
  p: BuilderRefPokemon;
  build: Build;
  targets: BuilderRefPokemon[];
  moveBySlug: Map<string, BuilderRefMove>;
  targetOverrides: TargetOverridesMap;
  onRemoveTarget: (slug: string) => void;
}) {
  const t = useTranslations("PokemonBuilder");

  // My damaging moves — used for the "Can you OHKO before they hit?" column.
  const myDamagingMoves = useMemo(
    () => build.moves
      .map((s) => moveBySlug.get(s))
      .filter((m): m is BuilderRefMove => !!m && m.category !== "status" && ((m.power ?? 0) > 0 || isVariablePowerMove(m.slug))),
    [build.moves, moveBySlug],
  );
  const mySpeed = useMemo(() => speedFromBuild(p, build), [p, build]);

  // For each top target, gather their top 4 damaging moves
  const targetThreats = useMemo(() => {
    return targets.map((tp) => {
      const learnable = new Set(tp.learnableMoves);
      const damaging = (tp.usage?.topMoves ?? [])
        .filter((m) => learnable.has(m.slug))
        .map((m) => moveBySlug.get(m.slug))
        .filter((m): m is BuilderRefMove => !!m && m.category !== "status" && ((m.power ?? 0) > 0 || isVariablePowerMove(m.slug)))
        .slice(0, 4);
      return { p: tp, moves: damaging };
    });
  }, [targets, moveBySlug]);

  return (
    <Card title={t("defenseTitle")} subtitle={t("defenseHint")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left dark:bg-zinc-900">
                {t("attacker")}
              </th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap">{t("matchupOutcome")}</th>
              <th className="px-2 py-1.5 text-left">{t("threats")}</th>
            </tr>
          </thead>
          <tbody>
            {targetThreats.map((tt) => (
              <tr key={tt.p.slug} className="group border-b border-zinc-100 last:border-b-0 dark:border-zinc-800 align-top">
                <td className="sticky left-0 z-10 bg-white px-2 py-1.5 dark:bg-zinc-900">
                  <span className="inline-flex items-center gap-1.5">
                    <Image src={tt.p.spriteUrl} alt="" width={22} height={22} unoptimized />
                    <span className="font-medium">{tt.p.name}</span>
                    <RowDeleteButton
                      onClick={() => onRemoveTarget(tt.p.slug)}
                      label={t("removeFromComparison", { name: tt.p.name })}
                    />
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <OutcomeBadge
                    p={p}
                    build={build}
                    target={tt.p}
                    targetBuild={resolveTargetBuild(tt.p, targetOverrides.get(tt.p.slug))}
                    targetMoves={tt.moves}
                    myDamagingMoves={myDamagingMoves}
                    mySpeed={mySpeed}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {tt.moves.length === 0 ? (
                      <span className="text-xs text-zinc-400">{t("noKnownMoves")}</span>
                    ) : tt.moves.map((m) => (
                      <ThreatChip
                        key={m.slug}
                        attacker={tt.p}
                        attackerBuild={resolveTargetBuild(tt.p, targetOverrides.get(tt.p.slug))}
                        defender={p}
                        defenderBuild={build}
                        move={m}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OutcomeBadge({
  p,
  build,
  target,
  targetBuild,
  targetMoves,
  myDamagingMoves,
  mySpeed,
}: {
  p: BuilderRefPokemon;
  build: Build;
  target: BuilderRefPokemon;
  targetBuild: Build;
  targetMoves: BuilderRefMove[];
  myDamagingMoves: BuilderRefMove[];
  mySpeed: number;
}) {
  const t = useTranslations("PokemonBuilder");
  const theirSpeed = speedFromBuild(target, targetBuild);

  // Best of my damaging moves against this target → highest OHKO%.
  const myBest = useMemo(() => {
    let bestOhko = 0;
    let bestMaxPct = 0;
    let bestMove: BuilderRefMove | null = null;
    for (const m of myDamagingMoves) {
      const r = runCalc(p, build, target, targetBuild, m);
      if (!r) continue;
      if (r.ohkoPct > bestOhko || (r.ohkoPct === bestOhko && r.maxPct > bestMaxPct)) {
        bestOhko = r.ohkoPct;
        bestMaxPct = r.maxPct;
        bestMove = m;
      }
    }
    return { ohkoPct: bestOhko, maxPct: bestMaxPct, move: bestMove };
  }, [p, build, target, targetBuild, myDamagingMoves]);

  // Best of the target's threats against me → highest OHKO% from them.
  const theirBest = useMemo(() => {
    let bestOhko = 0;
    let bestMaxPct = 0;
    let bestMove: BuilderRefMove | null = null;
    for (const m of targetMoves) {
      const r = runCalc(target, targetBuild, p, build, m);
      if (!r) continue;
      if (r.ohkoPct > bestOhko || (r.ohkoPct === bestOhko && r.maxPct > bestMaxPct)) {
        bestOhko = r.ohkoPct;
        bestMaxPct = r.maxPct;
        bestMove = m;
      }
    }
    return { ohkoPct: bestOhko, maxPct: bestMaxPct, move: bestMove };
  }, [target, targetBuild, p, build, targetMoves]);

  const faster = mySpeed > theirSpeed;
  const tied = mySpeed === theirSpeed;
  const youOhko = myBest.ohkoPct >= 100;
  const theyOhko = theirBest.ohkoPct >= 100;

  // Outcome state machine — answers "who dies first?" using speed +
  // both directions' OHKO ability.
  //   • You faster + you OHKO        → outright Win
  //   • You faster + you don't OHKO + they OHKO back → Trade-and-die (LOSE)
  //   • You faster + neither OHKO    → continued fight, you go first
  //   • Speed tie                    → 50/50 race; show + your best
  //   • They faster + they OHKO      → Lose (you don't act)
  //   • They faster + they don't OHKO + you OHKO → Revenge (WIN)
  //   • They faster + neither OHKO   → continued fight, they go first
  let labelKey: string;
  let tone: string;
  if (faster && youOhko) {
    labelKey = "outcomeWin";
    tone = "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900";
  } else if (faster && !youOhko && theyOhko) {
    labelKey = "outcomeFasterTraded";
    tone = "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";
  } else if (faster) {
    labelKey = "outcomeFasterSafe";
    tone = "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300";
  } else if (tied && youOhko && !theyOhko) {
    labelKey = "outcomeSpeedTieWin";
    tone = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  } else if (tied && theyOhko && !youOhko) {
    labelKey = "outcomeSpeedTieLose";
    tone = "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";
  } else if (tied && youOhko && theyOhko) {
    labelKey = "outcomeSpeedTieFlip";
    tone = "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300";
  } else if (tied) {
    labelKey = "outcomeSpeedTie";
    tone = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  } else if (theyOhko) {
    // Slower + opponent OHKOs you → you never act
    labelKey = "outcomeLose";
    tone = "bg-rose-100 text-rose-800 ring-1 ring-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900";
  } else if (youOhko) {
    // Slower + you survive their hit + you OHKO back
    labelKey = "outcomeSlowerRevenge";
    tone = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  } else {
    labelKey = "outcomeSlowerStall";
    tone = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }
  const label = t(labelKey as never);

  const speedArrow = faster ? "▲" : tied ? "=" : "▼";
  const speedTone = faster ? "text-emerald-600" : tied ? "text-zinc-500" : "text-rose-600";
  // Subline: show your best damaging move + their best threat. Two short lines.
  const tooltip = `${t("yourSpeed")} ${mySpeed} ${speedArrow} ${theirSpeed}` +
    (myBest.move ? ` · you: ${myBest.move.name} ${myBest.maxPct.toFixed(0)}%` : "") +
    (theirBest.move ? ` · they: ${theirBest.move.name} ${theirBest.maxPct.toFixed(0)}%` : "");

  return (
    <span
      className={cn(
        "inline-flex flex-col items-start gap-0.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap",
        tone,
      )}
      title={tooltip}
    >
      <span className="inline-flex items-center gap-1">
        <span className={cn("font-mono tabular-nums", speedTone)}>{speedArrow}</span>
        {label}
      </span>
      <span className="font-mono tabular-nums text-[10px] opacity-80">
        {myBest.move ? `→ ${myBest.maxPct.toFixed(0)}%` : "→ —"}
        {" · "}
        {theirBest.move ? `← ${theirBest.maxPct.toFixed(0)}%` : "← —"}
      </span>
    </span>
  );
}

// ─── Custom targets ──────────────────────────────────────────────────────────

function CustomTargetsCard({
  customSlugs,
  onAddCustom,
  onRemoveTarget,
  pickerOptions,
  pokemonBySlug,
  includeDefaults,
  onToggleDefaults,
}: {
  customSlugs: string[];
  onAddCustom: (slug: string) => void;
  onRemoveTarget: (slug: string) => void;
  pickerOptions: ComboboxOption[];
  pokemonBySlug: Map<string, BuilderRefPokemon>;
  includeDefaults: boolean;
  onToggleDefaults: () => void;
}) {
  const t = useTranslations("PokemonBuilder");
  const [pick, setPick] = useState("");
  return (
    <Card title={t("customTitle")} subtitle={t("customHint")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Combobox
            value={pick}
            onChange={(v) => {
              if (v) onAddCustom(v);
              setPick("");
            }}
            options={pickerOptions}
            placeholder={t("addCustomPlaceholder")}
          />
        </div>
        <button
          type="button"
          onClick={onToggleDefaults}
          className="shrink-0 rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-300"
        >
          {includeDefaults ? t("clearDefaults") : t("restoreDefaults")}
        </button>
      </div>
      {customSlugs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {customSlugs.map((slug) => {
            const p = pokemonBySlug.get(slug);
            if (!p) return null;
            return (
              <span
                key={slug}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              >
                <Image src={p.spriteUrl} alt="" width={18} height={18} unoptimized />
                {p.name}
                <button
                  onClick={() => onRemoveTarget(slug)}
                  className="ml-1 text-zinc-400 hover:text-red-500"
                >×</button>
              </span>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

// ─── Per-target editor ───────────────────────────────────────────────────────

function TargetEditor({
  p,
  build,
  customized,
  onChange,
  onReset,
  onClose,
  abilityBySlug,
  allItems,
}: {
  p: BuilderRefPokemon;
  build: Build;
  customized: boolean;
  onChange: (mut: (cur: TargetOverrides) => TargetOverrides) => void;
  onReset: () => void;
  onClose: () => void;
  abilityBySlug: Map<string, BuilderRefAbility>;
  allItems: BuilderRefItem[];
}) {
  const t = useTranslations("PokemonBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");
  const tStatShort = useTranslations("StatShort");
  const tNature = useTranslations("Natures");

  const validAbilities = useMemo(() => {
    const arr = [...p.abilities];
    if (p.hiddenAbility && !arr.includes(p.hiddenAbility)) arr.push(p.hiddenAbility);
    return arr;
  }, [p]);
  const pctByAbility = useMemo(
    () => new Map(p.usage?.topAbilities.map((a) => [a.slug, a.pct]) ?? []),
    [p],
  );
  const pctByItem = useMemo(
    () => new Map(p.usage?.topItems.map((i) => [i.slug, i.pct]) ?? []),
    [p],
  );

  const abilityOptions: ComboboxOption[] = validAbilities.map((a) => {
    const ref = abilityBySlug.get(a);
    return {
      value: a,
      label: ref?.name ?? a,
      searchText: a,
      usagePct: pctByAbility.get(a),
      suffix: p.hiddenAbility === a ? "★" : null,
    };
  });
  const itemOptions: ComboboxOption[] = allItems.map((it) => ({
    value: it.slug,
    label: it.name,
    searchText: it.slug,
    usagePct: pctByItem.get(it.slug),
  }));
  const natureOptions: ComboboxOption[] = NATURES.map((n) => {
    const { up, down } = natureEffect(n);
    const localized = tNature(n as never);
    const annot = up && down
      ? ` +${tStatShort(up)} −${tStatShort(down)}`
      : ` ${tNature("neutralSuffix")}`;
    return { value: n, label: localized + annot, searchText: n };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Image src={p.spriteUrl} alt="" width={28} height={28} unoptimized />
          <div>
            <div className="text-sm font-semibold">{t("editConfigFor", { name: p.name })}</div>
            <div className="text-[11px] text-zinc-500">
              {customized ? t("customized") : t("usingUsageDefaults")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {customized ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("resetCustomization")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t("closeEditor")}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <Label>{t("ability")}</Label>
          <Combobox
            value={build.ability}
            onChange={(v) => onChange((cur) => ({ ...cur, ability: v }))}
            options={abilityOptions}
          />
        </div>
        <div>
          <Label>{t("item")}</Label>
          <Combobox
            value={build.item}
            onChange={(v) => onChange((cur) => ({ ...cur, item: v }))}
            options={itemOptions}
            allowClear
          />
        </div>
        <div>
          <Label>{t("nature")}</Label>
          <Combobox
            value={build.nature}
            onChange={(v) => onChange((cur) => ({ ...cur, nature: v as Nature }))}
            options={natureOptions}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("evs")}</Label>
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-xs">
            {STAT_KEYS.map((k, i) => (
              <label key={k} className="flex items-center gap-1.5">
                <span className="w-9 shrink-0 font-semibold uppercase text-zinc-500">
                  {tStat(k as StatKey)}
                </span>
                <input
                  type="number"
                  min={0}
                  max={PER_STAT_CAP}
                  step={1}
                  value={build.ev[i] ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(PER_STAT_CAP, parseInt(e.target.value) || 0));
                    const next = [...build.ev] as Build["ev"];
                    next[i] = v;
                    onChange((cur) => ({ ...cur, ev: next }));
                  }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-right font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>{t("stages")}</Label>
          <div className="mt-1 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-3">
            {(["atk","def","spa","spd","spe"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <span className="w-9 shrink-0 font-semibold uppercase text-zinc-500">
                  {tStat(k as StatKey)}
                </span>
                <Stepper
                  value={build.stages[k]}
                  min={-6}
                  max={6}
                  onChange={(v) => onChange((cur) => ({
                    ...cur,
                    stages: { ...build.stages, [k]: v },
                  }))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Damage cells ────────────────────────────────────────────────────────────

function DamageCell({
  attacker,
  attackerBuild,
  defender,
  defenderBuild,
  move,
}: {
  attacker: BuilderRefPokemon;
  attackerBuild: Build;
  defender: BuilderRefPokemon;
  defenderBuild: Build;
  move: BuilderRefMove;
}) {
  const result = useMemo(
    () => runCalc(attacker, attackerBuild, defender, defenderBuild, move),
    [attacker, attackerBuild, defender, defenderBuild, move],
  );
  if (!result) return <span className="text-zinc-400">—</span>;
  const { minPct, maxPct, ohkoPct, twoHkoPct } = result;
  const tone = ohkoPct >= 100
    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 font-bold"
    : ohkoPct >= 50
    ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
    : twoHkoPct >= 100
    ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    : maxPct >= 50
    ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
    : "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500";
  return (
    <span className={cn("inline-block min-w-[88px] rounded px-2 py-1 font-mono tabular-nums text-xs", tone)}>
      <span className="block">{minPct.toFixed(0)}–{maxPct.toFixed(0)}%</span>
      <span className="block text-[10px] opacity-80">
        {ohkoPct >= 100 ? "OHKO" : ohkoPct > 0 ? `${ohkoPct.toFixed(0)}% OHKO` : twoHkoPct >= 100 ? "2HKO" : ""}
      </span>
    </span>
  );
}

function ThreatChip({
  attacker,
  attackerBuild,
  defender,
  defenderBuild,
  move,
}: {
  attacker: BuilderRefPokemon;
  attackerBuild: Build;
  defender: BuilderRefPokemon;
  defenderBuild: Build;
  move: BuilderRefMove;
}) {
  const result = useMemo(
    () => runCalc(attacker, attackerBuild, defender, defenderBuild, move),
    [attacker, attackerBuild, defender, defenderBuild, move],
  );
  if (!result) return null;
  const { minPct, maxPct, ohkoPct, twoHkoPct } = result;
  const tone = ohkoPct >= 100
    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 font-bold ring-1 ring-rose-300"
    : ohkoPct >= 50
    ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
    : twoHkoPct >= 100
    ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    : maxPct >= 50
    ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
    : "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs", tone)}
      title={`${maxPct.toFixed(0)}% max · ${ohkoPct.toFixed(0)}% OHKO`}
    >
      <TypeChip type={move.type as PokemonType} size="sm" />
      <span className="font-medium">{move.name}</span>
      <span className="ml-1 font-mono tabular-nums opacity-80">
        {minPct.toFixed(0)}–{maxPct.toFixed(0)}%
      </span>
      {ohkoPct >= 100 ? <span className="ml-1 font-bold">OHKO</span>
        : ohkoPct > 0 ? <span className="ml-1 font-mono text-[10px]">{ohkoPct.toFixed(0)}%</span>
        : twoHkoPct >= 100 ? <span className="ml-1 font-bold">2HKO</span>
        : null}
    </span>
  );
}

// ─── Shared layout ───────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs font-medium",
        active
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      {label}
    </button>
  );
}

// Per-row delete control for the comparison tables. Hidden until the row is
// hovered (or the button is keyboard-focused) to keep the tables uncluttered.
function RowDeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-500 group-hover:opacity-100 dark:hover:bg-red-950/30 dark:hover:text-red-300"
    >
      ×
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-800/50">
      {children}
    </div>
  );
}

// ─── Calc helpers ────────────────────────────────────────────────────────────

function stageMult(s: number): number {
  if (s >= 0) return (2 + s) / 2;
  return 2 / (2 - s);
}

function speedFromBuild(p: BuilderRefPokemon, build: Build): number {
  let s = computeStat(p.spe, build.ev[5], build.nature, "spe", false);
  s = Math.floor(s * stageMult(build.stages.spe));
  if (build.item === "choice-scarf") s = Math.floor(s * 1.5);
  if (build.item === "iron-ball") s = Math.floor(s * 0.5);
  return s;
}

function attackerDefaultBuild(p: BuilderRefPokemon): Build {
  const u = p.usage;
  const sp = u?.topSpreads[0];
  const validAbilities = new Set([...p.abilities, ...(p.hiddenAbility ? [p.hiddenAbility] : [])]);
  const ab = u?.topAbilities.find((a) => validAbilities.has(a.slug))?.slug
          ?? p.abilities[0] ?? "";
  return {
    slug: p.slug,
    ability: ab,
    item: u?.topItems[0]?.slug ?? "",
    nature: (sp?.nature ?? "Adamant") as Nature,
    moves: [],
    ev: (sp?.vp ?? [0, 0, 0, 0, 0, 0]) as Build["ev"],
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
}

function defenderDefaultBuild(p: BuilderRefPokemon): Build {
  // Defenders use the same usage-derived spread as attackers; the defensive
  // stats just come from the EV row's HP/Def/SpD slots.
  return attackerDefaultBuild(p);
}

// Resolve a target's effective Build by layering user overrides on top of the
// usage-derived default. Used everywhere the user's customizations should
// affect speed/damage analysis.
function resolveTargetBuild(p: BuilderRefPokemon, overrides?: TargetOverrides): Build {
  const base = defenderDefaultBuild(p);
  if (!overrides) return base;
  return {
    ...base,
    ability: overrides.ability ?? base.ability,
    item: overrides.item ?? base.item,
    nature: overrides.nature ?? base.nature,
    ev: overrides.ev ?? base.ev,
    stages: overrides.stages ?? base.stages,
  };
}

function runCalc(
  attacker: BuilderRefPokemon,
  attackerBuild: Build,
  defender: BuilderRefPokemon,
  defenderBuild: Build,
  move: BuilderRefMove,
): { minPct: number; maxPct: number; ohkoPct: number; twoHkoPct: number } | null {
  // Keep variable-BP moves (Heavy Slam, Low Kick, Gyro Ball, …): PokeAPI ships
  // them with null power, but calc() resolves BP from weight/speed/HP state.
  if (move.category === "status") return null;
  if ((move.power ?? 0) <= 0 && !isVariablePowerMove(move.slug)) return null;
  const input: CalcInput = {
    attacker: {
      slug: attacker.slug,
      types: [attacker.type1 as PokemonType, (attacker.type2 ?? null) as PokemonType | null],
      atk: attacker.atk,
      spa: attacker.spa,
      def: attacker.def,
      spd: attacker.spd,
      spe: attacker.spe,
      weight: attacker.weight,
      vpAtk: attackerBuild.ev[1],
      vpSpa: attackerBuild.ev[3],
      vpDef: attackerBuild.ev[2],
      vpSpd: attackerBuild.ev[4],
      vpSpe: attackerBuild.ev[5],
      nature: attackerBuild.nature,
      ability: attackerBuild.ability || undefined,
      item: attackerBuild.item || undefined,
      status: "none",
      stageAtk: attackerBuild.stages.atk,
      stageSpa: attackerBuild.stages.spa,
      stageDef: attackerBuild.stages.def,
      stageSpd: attackerBuild.stages.spd,
    },
    defender: {
      slug: defender.slug,
      types: [defender.type1 as PokemonType, (defender.type2 ?? null) as PokemonType | null],
      hp: defender.hp,
      def: defender.def,
      spd: defender.spd,
      atk: defender.atk,
      spa: defender.spa,
      spe: defender.spe,
      weight: defender.weight,
      vpHp: defenderBuild.ev[0],
      vpDef: defenderBuild.ev[2],
      vpSpd: defenderBuild.ev[4],
      vpAtk: defenderBuild.ev[1],
      vpSpa: defenderBuild.ev[3],
      vpSpe: defenderBuild.ev[5],
      nature: defenderBuild.nature,
      ability: defenderBuild.ability || undefined,
      item: defenderBuild.item || undefined,
      stageDef: defenderBuild.stages.def,
      stageSpd: defenderBuild.stages.spd,
      stageAtk: defenderBuild.stages.atk,
      stageSpa: defenderBuild.stages.spa,
      hpPct: 100,
    },
    move: {
      slug: move.slug,
      type: move.type as PokemonType,
      category: move.category as "physical" | "special",
      power: move.power ?? 0,
      targetShape: move.targetShape,
    },
    field: {
      weather: "none",
      terrain: "none",
      format: "doubles",
      crit: false,
      helpingHand: false,
      screens: { reflect: false, lightScreen: false, auroraVeil: false },
      hazards: { stealthRock: false, spikes: 0, toxicSpikes: 0 },
    },
  };
  const out = calc(input);
  if (!out) return null;
  const ohkoCount = out.rolls.filter((r) => r >= out.defenderMaxHp).length;
  const ohkoPct = (ohkoCount / out.rolls.length) * 100;
  const twoHkoPct = out.min * 2 >= out.defenderMaxHp ? 100 : 0;
  return { minPct: out.minPct, maxPct: out.maxPct, ohkoPct, twoHkoPct };
}
