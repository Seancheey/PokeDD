"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TypeChip } from "@/components/TypeChip";
import { TypeMatchupTooltip } from "@/components/TypeMatchupTooltip";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import type { PokemonType } from "@/lib/types";
import { POKEMON_TYPES } from "@/lib/types";
import { NATURES, natureEffect, type Nature } from "@/lib/damage";
import { parseShowdownText, type LookupSets, type ImportWarning } from "@/lib/showdown-import";
import { defensiveEffectivenessAgainst, effectivenessAgainst } from "@/lib/type-chart";
import {
  encodeTeam,
  decodeTeam,
  EMPTY_TEAM,
  type TeamShare,
  type ShareSlot,
} from "@/lib/team-share";
import { cn } from "@/lib/cn";
import { onLoadSavedMon } from "@/lib/my-pokemon";
import { SaveMyPokemonButton } from "@/components/SaveMyPokemonButton";
import {
  loadFormatPref,
  onFormatPrefChange,
  type BattleFormat,
} from "@/lib/format-pref";

export type RefPokemon = {
  slug: string;
  name: string;
  type1: string;
  type2: string | null;
  spriteUrl: string;
  abilities: string[];
  hiddenAbility: string | null;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  learnableMoves: string[];
  usagePct: number;
  usage: PokemonUsage | null;
};
export type RawRefPokemon = Omit<RefPokemon, "usage"> & {
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
export type RefMove = { slug: string; name: string; type: string; category: string; power: number | null };
export type RefAbility = { slug: string; name: string };
export type RefItem = { slug: string; name: string };

const MAX_EV = 66;
const PER_STAT_CAP = 32;
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
type StatKey = (typeof STAT_KEYS)[number];

export function TeamBuilderClient({
  pokemonRaw,
  moves,
  abilities,
  items,
  initialTeam,
}: {
  pokemonRaw: RawRefPokemon[];
  moves: RefMove[];
  abilities: RefAbility[];
  items: RefItem[];
  initialTeam: TeamShare | null;
}) {
  const t = useTranslations("TeamBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");
  const sp = useSearchParams();

  // Global format preference — flips singles/doubles for every usage-derived
  // hint (top moves, top items, top abilities, top spreads).
  const [format, setFormat] = useState<BattleFormat>("doubles");
  useEffect(() => {
    setFormat(loadFormatPref());
    return onFormatPrefChange(setFormat);
  }, []);
  const pokemon: RefPokemon[] = useMemo(
    () => pokemonRaw.map((p) => ({
      ...p,
      usage: p.usageByFormat?.[format] ?? null,
    })),
    [pokemonRaw, format],
  );

  // Build O(1) lookup maps once
  const pokemonBySlug = new Map(pokemon.map((p) => [p.slug, p]));
  const moveBySlug = new Map(moves.map((m) => [m.slug, m]));
  const abilityBySlug = new Map(abilities.map((a) => [a.slug, a]));
  const itemBySlug = new Map(items.map((i) => [i.slug, i]));

  const [team, setTeam] = useState<TeamShare>(initialTeam ?? EMPTY_TEAM);
  const [hydrated, setHydrated] = useState(initialTeam != null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [importOpen, setImportOpen] = useState(false);

  // Show the first-time "save your build" tooltip once, then never again.
  // The flag is stored client-side, so we only flip it true after hydration
  // (otherwise SSR would render the hint and hydration would tear).
  const [showSaveHint, setShowSaveHint] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissed =
        window.localStorage.getItem("pokedd:save-hint-dismissed") === "1";
      if (!dismissed && team.slots.length === 1) {
        setShowSaveHint(true);
      } else if (team.slots.length !== 1) {
        setShowSaveHint(false);
      }
    } catch {
      /* localStorage disabled — skip the hint */
    }
  }, [team.slots.length]);
  function dismissSaveHint() {
    setShowSaveHint(false);
    try {
      window.localStorage.setItem("pokedd:save-hint-dismissed", "1");
    } catch {
      /* ignore */
    }
  }
  const [_isPending, startTransition] = useTransition();

  // Lookup sets for the Showdown importer. Built once from the same reference
  // data the slot pickers already use. Memoized so the modal can re-mount
  // without rebuilding 1.3K slug entries each time.
  const importLookup: LookupSets = useMemo(() => {
    const learnableBySpecies = new Map<string, Set<string>>();
    const validAbilitiesBySpecies = new Map<string, Set<string>>();
    for (const p of pokemon) {
      learnableBySpecies.set(p.slug, new Set(p.learnableMoves));
      const abs = new Set<string>(p.abilities);
      if (p.hiddenAbility) abs.add(p.hiddenAbility);
      validAbilitiesBySpecies.set(p.slug, abs);
    }
    return {
      speciesSlugs: new Set(pokemon.map((p) => p.slug)),
      moveSlugs: new Set(moves.map((m) => m.slug)),
      abilitySlugs: new Set(abilities.map((a) => a.slug)),
      itemSlugs: new Set(items.map((i) => i.slug)),
      learnableBySpecies,
      validAbilitiesBySpecies,
    };
  }, [pokemon, moves, abilities, items]);

  // If we landed without a pre-decoded team but a `?share=` is present (e.g. client-side
  // route change), decode on mount.
  useEffect(() => {
    if (hydrated) return;
    const share = sp.get("share");
    if (!share) {
      setHydrated(true);
      return;
    }
    decodeTeam(share).then((decoded) => {
      if (decoded) setTeam(decoded);
      setHydrated(true);
    });
  }, [sp]);

  function updateSlot(index: number, mut: (s: ShareSlot) => ShareSlot) {
    setTeam((prev) => ({
      ...prev,
      slots: prev.slots.map((s, i) => (i === index ? mut(s) : s)),
    }));
  }

  function addSlot(speciesSlug: string) {
    const p = pokemonBySlug.get(speciesSlug);
    if (!p || team.slots.length >= 6) return;

    // Pre-fill from Smogon usage data when available; otherwise fall back to
    // the first listed ability and an empty kit.
    const usage = p.usage;
    const learnable = new Set(p.learnableMoves);

    const validAbilities = new Set([...p.abilities, ...(p.hiddenAbility ? [p.hiddenAbility] : [])]);
    const topAbility = usage?.topAbilities.find((a) => validAbilities.has(a.slug))?.slug;
    const topItem = usage?.topItems[0]?.slug;

    // Take up to 4 highest-usage moves that this Pokémon can actually learn.
    const topMoves: string[] = [];
    for (const m of usage?.topMoves ?? []) {
      if (!learnable.has(m.slug)) continue;
      topMoves.push(m.slug);
      if (topMoves.length === 4) break;
    }

    const topSpread = usage?.topSpreads[0];

    setTeam((prev) => ({
      ...prev,
      slots: [
        ...prev.slots,
        {
          s: speciesSlug,
          a: topAbility ?? p.abilities[0],
          i: topItem,
          m: topMoves,
          v: topSpread?.vp ?? [0, 0, 0, 0, 0, 0],
          n: topSpread?.nature,
        },
      ],
    }));
  }

  // Subscribe to "load saved mon" events from the My Pokémon FAB — append
  // a new slot pre-populated with the saved config (or do nothing if the
  // team is already full).
  useEffect(() => {
    return onLoadSavedMon((mon) => {
      if (!pokemonBySlug.has(mon.slug)) return;
      setTeam((prev) => {
        if (prev.slots.length >= 6) return prev;
        return {
          ...prev,
          slots: [
            ...prev.slots,
            {
              s: mon.slug,
              a: mon.ability,
              i: mon.item || undefined,
              m: mon.moves.filter(Boolean),
              v: mon.ev,
              n: mon.nature,
            },
          ],
        };
      });
    });
  }, [pokemonBySlug]);

  function removeSlot(index: number) {
    setTeam((prev) => ({ ...prev, slots: prev.slots.filter((_, i) => i !== index) }));
  }

  async function copyShare() {
    const payload = await encodeTeam(team);
    const url = `${window.location.origin}${window.location.pathname}?share=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      // Also update the visible URL bar (without reloading)
      startTransition(() => {
        window.history.replaceState(null, "", `?share=${payload}`);
      });
      setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      // clipboard write failed — fall back to updating URL only
      startTransition(() => {
        window.history.replaceState(null, "", `?share=${payload}`);
      });
    }
  }

  function clearTeam() {
    setTeam(EMPTY_TEAM);
    startTransition(() => {
      window.history.replaceState(null, "", window.location.pathname);
    });
  }

  if (!hydrated) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t("loading")}
      </div>
    );
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {t("import")}
          </button>
          <button
            onClick={copyShare}
            className="rounded-md bg-zinc-950 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            disabled={team.slots.length === 0}
          >
            {copyState === "copied" ? t("copied") : t("copyLink")}
          </button>
          <button
            onClick={clearTeam}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {t("clear")}
          </button>
        </div>
      </header>

      {/* Regulation label — format toggle now lives in the title bar */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="rounded-md bg-zinc-100 px-2.5 py-1 font-semibold uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {t("regulationMA")}
        </div>
      </div>

      {/* Slots grid */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {team.slots.map((slot, i) => (
          <SlotCard
            key={i}
            index={i}
            slot={slot}
            pokemonBySlug={pokemonBySlug}
            moves={moves}
            moveBySlug={moveBySlug}
            abilityBySlug={abilityBySlug}
            itemBySlug={itemBySlug}
            items={items}
            onMutate={(mut) => updateSlot(i, mut)}
            onRemove={() => removeSlot(i)}
            showSaveHint={i === 0 && showSaveHint}
            onDismissSaveHint={dismissSaveHint}
          />
        ))}
        {team.slots.length < 6 ? (
          <AddSlotPicker
            pokemon={pokemon}
            moves={moves}
            abilities={abilities}
            onPick={addSlot}
          />
        ) : null}
      </section>

      {/* Team analysis */}
      {team.slots.length > 0 ? (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <TeamDefenseTable team={team} pokemonBySlug={pokemonBySlug} />
          <TeamOffenseTable
            team={team}
            pokemonBySlug={pokemonBySlug}
            moveBySlug={moveBySlug}
          />
        </div>
      ) : null}

      {importOpen ? (
        <ImportModal
          lookup={importLookup}
          pokemonBySlug={pokemonBySlug}
          currentSlotCount={team.slots.length}
          onClose={() => setImportOpen(false)}
          onApply={(parsed, mode) => {
            setTeam((prev) => {
              if (mode === "replace") {
                return { ...prev, slots: parsed.slots.slice(0, 6) };
              }
              const room = 6 - prev.slots.length;
              return {
                ...prev,
                slots: [...prev.slots, ...parsed.slots.slice(0, room)],
              };
            });
            setImportOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AddSlotPicker({
  pokemon,
  moves,
  abilities,
  onPick,
}: {
  pokemon: RefPokemon[];
  moves: RefMove[];
  abilities: RefAbility[];
  onPick: (slug: string) => void;
}) {
  const t = useTranslations("TeamBuilder");
  const tType = useTranslations("Types");

  // Filter state — all start empty (no filtering).
  const [filterOpen, setFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<PokemonType>>(new Set());
  const [moveFilter, setMoveFilter] = useState<string>("");
  const [abilityFilter, setAbilityFilter] = useState<string>("");

  function toggleType(tp: PokemonType) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tp)) next.delete(tp);
      else next.add(tp);
      return next;
    });
  }
  function clearFilters() {
    setTypeFilter(new Set());
    setMoveFilter("");
    setAbilityFilter("");
  }
  const anyFilter =
    typeFilter.size > 0 || moveFilter !== "" || abilityFilter !== "";

  // Apply filters with AND semantics.
  const filteredPokemon = useMemo(() => {
    if (!anyFilter) return pokemon;
    return pokemon.filter((p) => {
      if (typeFilter.size > 0) {
        const t1 = p.type1 as PokemonType;
        const t2 = (p.type2 ?? null) as PokemonType | null;
        const matches = typeFilter.has(t1) || (t2 != null && typeFilter.has(t2));
        if (!matches) return false;
      }
      if (moveFilter && !p.learnableMoves.includes(moveFilter)) return false;
      if (abilityFilter) {
        const valid =
          p.abilities.includes(abilityFilter) ||
          p.hiddenAbility === abilityFilter;
        if (!valid) return false;
      }
      return true;
    });
  }, [pokemon, typeFilter, moveFilter, abilityFilter, anyFilter]);

  const options: ComboboxOption[] = useMemo(
    () =>
      filteredPokemon.map((p) => ({
        value: p.slug,
        label: p.name,
        searchText: p.slug, // allow english slug search even when UI is JA / zh
        usagePct: p.usagePct > 0 ? p.usagePct : undefined,
        prefix: (
          <Image
            src={p.spriteUrl}
            alt=""
            width={24}
            height={24}
            unoptimized
            className="h-6 w-6 object-contain"
          />
        ),
        suffix: (
          <span className="ml-1 inline-flex gap-1">
            <TypeChip type={p.type1 as PokemonType} size="sm" />
            {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
          </span>
        ),
      })),
    [filteredPokemon],
  );

  const moveOptions: ComboboxOption[] = useMemo(
    () =>
      moves.map((m) => ({
        value: m.slug,
        label: m.name,
        searchText: m.slug,
      })),
    [moves],
  );
  const abilityOptions: ComboboxOption[] = useMemo(
    () =>
      abilities.map((a) => ({
        value: a.slug,
        label: a.name,
        searchText: a.slug,
      })),
    [abilities],
  );

  return (
    <div className="flex flex-col items-stretch justify-center gap-3 rounded-2xl border-2 border-dashed border-zinc-300 bg-white/60 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
        {t("addPokemon")}
      </p>

      {/* Filters: collapsed by default. Toggle via the chip; "Clear" pops up
          alongside whenever any filter is active. */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-semibold transition-colors",
            anyFilter
              ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
          )}
        >
          {t("advancedFilter")}
          {anyFilter ? ` (${filteredPokemon.length})` : ""}
        </button>
        {anyFilter ? (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {t("advancedFilterClear")}
          </button>
        ) : null}
      </div>

      {filterOpen ? (
        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3 text-left dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {t("advancedFilterType")}
            </div>
            <div className="flex flex-wrap gap-1">
              {POKEMON_TYPES.map((tp) => {
                const active = typeFilter.has(tp);
                let label: string;
                try {
                  label = tType(tp as never);
                } catch {
                  label = tp;
                }
                return (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => toggleType(tp)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold transition-opacity",
                      active ? "opacity-100" : "opacity-40 hover:opacity-80",
                    )}
                  >
                    <TypeChip type={tp} size="sm" />
                    <span className="sr-only">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t("advancedFilterMove")}>
              <Combobox
                value={moveFilter}
                options={moveOptions}
                onChange={(v) => setMoveFilter(v)}
                ariaLabel={t("advancedFilterMove")}
                allowClear
                emptyLabel="—"
                placeholder="—"
              />
            </Field>
            <Field label={t("advancedFilterAbility")}>
              <Combobox
                value={abilityFilter}
                options={abilityOptions}
                onChange={(v) => setAbilityFilter(v)}
                ariaLabel={t("advancedFilterAbility")}
                allowClear
                emptyLabel="—"
                placeholder="—"
              />
            </Field>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-md">
        <Combobox
          value=""
          options={options}
          onChange={(slug) => slug && onPick(slug)}
          placeholder={t("slotEmptyHint")}
          searchPlaceholder={t("slotEmptyHint")}
          ariaLabel={t("addPokemon")}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SlotCard({
  index,
  slot,
  pokemonBySlug,
  moves,
  moveBySlug,
  abilityBySlug,
  itemBySlug,
  items,
  onMutate,
  onRemove,
  showSaveHint,
  onDismissSaveHint,
}: {
  index: number;
  slot: ShareSlot;
  pokemonBySlug: Map<string, RefPokemon>;
  moves: RefMove[];
  moveBySlug: Map<string, RefMove>;
  abilityBySlug: Map<string, RefAbility>;
  itemBySlug: Map<string, RefItem>;
  items: RefItem[];
  onMutate: (mut: (s: ShareSlot) => ShareSlot) => void;
  onRemove: () => void;
  showSaveHint?: boolean;
  onDismissSaveHint?: () => void;
}) {
  const t = useTranslations("TeamBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");

  const p = pokemonBySlug.get(slot.s);
  if (!p) return null;

  const validAbilities = [...p.abilities];
  if (p.hiddenAbility && !validAbilities.includes(p.hiddenAbility)) {
    validAbilities.push(p.hiddenAbility);
  }

  const ev = slot.v ?? [0, 0, 0, 0, 0, 0];
  const totalEv = ev.reduce((a, b) => a + b, 0);
  const remaining = MAX_EV - totalEv;

  function setMove(slotIdx: number, val: string) {
    onMutate((s) => {
      const m = [...(s.m ?? [])];
      while (m.length < 4) m.push("");
      m[slotIdx] = val;
      return { ...s, m: m.filter((x) => x).slice(0, 4).concat(Array(4).fill("")).slice(0, 4) };
    });
  }

  function setStat(idx: number, val: number) {
    onMutate((s) => {
      const next = [...(s.v ?? [0, 0, 0, 0, 0, 0])] as [number, number, number, number, number, number];
      next[idx] = Math.min(PER_STAT_CAP, Math.max(0, val));
      return { ...s, v: next };
    });
  }

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-3">
        <Image
          src={p.spriteUrl}
          width={56}
          height={56}
          alt={p.name}
          className="h-14 w-14 shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{p.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <TypeChip type={p.type1 as PokemonType} size="sm" />
            {p.type2 ? <TypeChip type={p.type2 as PokemonType} size="sm" /> : null}
          </div>
        </div>
        <div className="relative">
          <SaveToMyPokemon
            slot={slot}
            ev={ev}
            species={p}
            abilityBySlug={abilityBySlug}
            itemBySlug={itemBySlug}
            moveBySlug={moveBySlug}
          />
          {showSaveHint ? (
            <SaveHintBubble onDismiss={onDismissSaveHint ?? (() => {})} />
          ) : null}
        </div>
        <button
          onClick={onRemove}
          aria-label={t("remove")}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </header>

      <SlotBody
        p={p}
        slot={slot}
        ev={ev}
        remaining={remaining}
        validAbilities={validAbilities}
        abilityBySlug={abilityBySlug}
        items={items}
        moves={moves}
        onMutate={onMutate}
        setMove={setMove}
        setStat={setStat}
      />
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SlotBody({
  p,
  slot,
  ev,
  remaining,
  validAbilities,
  abilityBySlug,
  items,
  moves,
  onMutate,
  setMove,
  setStat,
}: {
  p: RefPokemon;
  slot: ShareSlot;
  ev: number[];
  remaining: number;
  validAbilities: string[];
  abilityBySlug: Map<string, RefAbility>;
  items: RefItem[];
  moves: RefMove[];
  onMutate: (mut: (s: ShareSlot) => ShareSlot) => void;
  setMove: (slotIdx: number, val: string) => void;
  setStat: (idx: number, val: number) => void;
}) {
  const t = useTranslations("TeamBuilder");
  const tStat = useTranslations("TeamBuilder.evStat");
  const tNature = useTranslations("Natures");

  // Per-slot usage lookups (top moves/abilities/items/spreads with %)
  const pctByMove = new Map(p.usage?.topMoves.map((m) => [m.slug, m.pct]) ?? []);
  const pctByAbility = new Map(
    p.usage?.topAbilities.map((a) => [a.slug, a.pct]) ?? [],
  );
  const pctByItem = new Map(p.usage?.topItems.map((i) => [i.slug, i.pct]) ?? []);

  // Ability combobox options — limited to this species' valid abilities.
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

  // Item combobox options — all items, with this species' usage % when known.
  const itemOptions: ComboboxOption[] = items.map((it) => ({
    value: it.slug,
    label: it.name,
    searchText: it.slug,
    usagePct: pctByItem.get(it.slug),
  }));

  // Move combobox options — restricted to this species' learnset.
  const learnable = new Set(p.learnableMoves);
  const learnableMoves = moves.filter((m) => learnable.has(m.slug));
  const moveOptionsBase: ComboboxOption[] = learnableMoves.map((m) => ({
    value: m.slug,
    label: m.name,
    searchText: m.slug,
    usagePct: pctByMove.get(m.slug),
  }));

  // Spread preset options
  const spreadPresets = p.usage?.topSpreads ?? [];
  const currentSpreadKey = ev.join("-");
  const presetMatch = spreadPresets.find((s) => s.vp.join("-") === currentSpreadKey);
  const spreadOptions: ComboboxOption[] = spreadPresets.map((s) => {
    const key = `${s.nature}:${s.vp.join("/")}`;
    let natureLabel = s.nature;
    try {
      natureLabel = tNature(s.nature as never);
    } catch {
      // fall back to raw English if the nature isn't in the translation table
    }
    return {
      value: key,
      label: `${natureLabel} ${s.vp.join("/")}`,
      usagePct: s.pct,
    };
  });

  function applySpread(key: string) {
    const [nature, evs] = key.split(":");
    if (!nature || !evs) return;
    const parts = evs.split("/").map((s) => parseInt(s, 10));
    if (parts.length !== 6) return;
    onMutate((s) => ({
      ...s,
      n: nature,
      v: parts as [number, number, number, number, number, number],
    }));
  }

  // Nature picker — 25 standard natures, with +/- stat hint in the label.
  const natureOptions: ComboboxOption[] = NATURES.map((nat) => {
    const eff = natureEffect(nat as Nature);
    let label: string;
    try {
      label = tNature(nat as never);
    } catch {
      label = nat;
    }
    const hint = eff.up && eff.down
      ? `+${tStat(eff.up as StatKey)} −${tStat(eff.down as StatKey)}`
      : t("natureNeutral");
    return {
      value: nat,
      label: `${label} ${hint}`,
      searchText: nat,
    };
  });

  return (
    <div className="mt-3 space-y-2 text-sm">
      <Field label={t("abilityLabel")}>
        <Combobox
          value={slot.a ?? ""}
          options={abilityOptions}
          onChange={(v) => onMutate((s) => ({ ...s, a: v }))}
          ariaLabel={t("abilityLabel")}
        />
      </Field>

      <Field label={t("itemLabel")}>
        <Combobox
          value={slot.i ?? ""}
          options={itemOptions}
          onChange={(v) => onMutate((s) => ({ ...s, i: v || undefined }))}
          ariaLabel={t("itemLabel")}
          allowClear
          emptyLabel={t("noItem")}
          placeholder={t("noItem")}
        />
      </Field>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("movesLabel")}
        </div>
        <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((mi) => {
            const cur = (slot.m ?? [])[mi] ?? "";
            // If current move isn't in the learnset (e.g. user changed species), include it
            // anyway so the selection is visible and removable.
            const options =
              cur && !learnable.has(cur)
                ? [
                    ...moveOptionsBase,
                    (() => {
                      const m = moves.find((mm) => mm.slug === cur);
                      return m
                        ? { value: m.slug, label: m.name, searchText: m.slug }
                        : null;
                    })(),
                  ].filter((x): x is ComboboxOption => !!x)
                : moveOptionsBase;
            return (
              <Combobox
                key={mi}
                value={cur}
                options={options}
                onChange={(v) => setMove(mi, v)}
                ariaLabel={t("moveSlot", { n: mi + 1 })}
                allowClear
                emptyLabel={t("moveNone")}
                placeholder={t("moveNone")}
              />
            );
          })}
        </div>
      </div>

      <Field label={t("natureLabel")}>
        <Combobox
          value={slot.n ?? ""}
          options={natureOptions}
          onChange={(v) => onMutate((s) => ({ ...s, n: v || undefined }))}
          ariaLabel={t("natureLabel")}
          allowClear
          emptyLabel={t("natureNeutral")}
          placeholder={t("natureNeutral")}
        />
      </Field>

      {/* Spread preset */}
      {spreadOptions.length > 0 ? (
        <Field label={t("spreadPresetLabel")}>
          <Combobox
            value={presetMatch ? `${presetMatch.nature}:${presetMatch.vp.join("/")}` : ""}
            options={spreadOptions}
            onChange={applySpread}
            placeholder={t("spreadPresetPlaceholder")}
            ariaLabel={t("spreadPresetLabel")}
          />
        </Field>
      ) : null}

      {/* EV inputs */}
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-zinc-500">
            {t("evLabel")}
          </span>
          <span
            className={cn(
              "font-mono tabular-nums",
              remaining < 0
                ? "font-bold text-red-600"
                : remaining === 0
                ? "text-emerald-600"
                : "text-zinc-500",
            )}
          >
            {remaining < 0
              ? t("evOver", { over: -remaining })
              : t("evRemaining", { remaining })}
          </span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {STAT_KEYS.map((k, i) => (
            <label key={k} className="flex items-center gap-1.5 text-xs">
              <span className="w-10 shrink-0 font-semibold uppercase tracking-wider text-zinc-500">
                {tStat(k as StatKey)}
              </span>
              <input
                type="number"
                min={0}
                max={PER_STAT_CAP}
                step={1}
                value={ev[i] ?? 0}
                onChange={(e) => setStat(i, parseInt(e.target.value) || 0)}
                className="w-full rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-right font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Team Defense / Offense tables ───────────────────────────────────────────

// Color tone for a defensive multiplier (a value ≥1 means it takes that ×damage).
function defenseTone(mult: number): { bg: string; text: string } {
  if (mult === 0) return { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300 font-bold" };
  if (mult < 1)  return { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400" };
  if (mult > 1)  return { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400" };
  return { bg: "", text: "text-zinc-500" };
}

function offenseTone(mult: number | null): { bg: string; text: string } {
  if (mult == null) return { bg: "", text: "text-zinc-400" };
  if (mult === 0) return { bg: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-400 font-bold" };
  if (mult > 1)  return { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400" };
  if (mult < 1)  return { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400" };
  return { bg: "", text: "text-zinc-500" };
}

function fmtMult(m: number | null): string {
  if (m == null) return "—";
  if (m === 0)  return "×0";
  if (Number.isInteger(m)) return `×${m}`;
  return `×${Number.isInteger(m * 100) ? m : +m.toFixed(2)}`;
}

function fmtNet(n: number): string {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

// Type label used in the leftmost column — reuses the TypeChip pill so each row
// is identifiable by both color AND the localized type name.

function MatrixHeader({
  slots,
  pokemonBySlug,
  invert,
}: {
  slots: ShareSlot[];
  pokemonBySlug: Map<string, RefPokemon>;
  invert?: boolean; // offense flips the ↑/↓ semantics — display labels accordingly
}) {
  return (
    <thead className="bg-zinc-50 text-xs dark:bg-zinc-950">
      <tr>
        <th className="w-8 px-2 py-2" />
        {slots.map((s, i) => {
          const p = pokemonBySlug.get(s.s);
          return (
            <th key={i} className="px-1 py-2">
              {p ? (
                <Image
                  src={p.spriteUrl}
                  alt={p.name}
                  width={32}
                  height={32}
                  className="mx-auto h-8 w-8 object-contain"
                />
              ) : null}
            </th>
          );
        })}
        <th className="px-2 py-2 text-red-600" title="weak / no super-effective">↓</th>
        <th className="px-2 py-2 text-emerald-600" title="resists / super-effective">↑</th>
        <th className="px-2 py-2 text-sky-600" title="net">=</th>
      </tr>
    </thead>
  );
}

function TeamDefenseTable({
  team,
  pokemonBySlug,
}: {
  team: TeamShare;
  pokemonBySlug: Map<string, RefPokemon>;
}) {
  const t = useTranslations("TeamBuilder");

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-bold uppercase tracking-wider">{t("defenseTitle")}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-center text-xs">
          <MatrixHeader slots={team.slots} pokemonBySlug={pokemonBySlug} />
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {POKEMON_TYPES.map((atkType) => {
              const cells: { mult: number; ability?: string; abilityApplied: boolean }[] = team.slots.map((slot) => {
                const p = pokemonBySlug.get(slot.s);
                if (!p) return { mult: 1, abilityApplied: false };
                const defTypes = [p.type1, p.type2].filter(Boolean) as PokemonType[];
                const ability = slot.a ?? p.abilities[0] ?? undefined;
                const raw = effectivenessAgainst(atkType, defTypes);
                const mult = defensiveEffectivenessAgainst(atkType, defTypes, ability);
                return { mult, ability, abilityApplied: mult !== raw };
              });
              const weak = cells.filter((c) => c.mult > 1).length;
              const resist = cells.filter((c) => c.mult < 1).length;
              const net = resist - weak;
              const netTone =
                net > 0
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold"
                  : net < 0
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-bold"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
              return (
                <tr key={atkType}>
                  <td className="px-2 py-1.5">
                    <TypeMatchupTooltip type={atkType} size="sm" />
                  </td>
                  {cells.map((c, i) => {
                    const tone = defenseTone(c.mult);
                    return (
                      <td key={i} className={cn("px-1.5 py-1.5 font-mono tabular-nums", tone.bg, tone.text)}>
                        <span
                          className="inline-flex items-center gap-0.5"
                          title={c.abilityApplied && c.ability ? `${c.ability.replace(/-/g, " ")}` : undefined}
                        >
                          {fmtMult(c.mult)}
                          {c.abilityApplied ? <sup className="text-[9px] opacity-70">*</sup> : null}
                        </span>
                      </td>
                    );
                  })}
                  <td className={cn("px-2 py-1.5 font-mono font-bold tabular-nums", weak ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "text-zinc-500")}>
                    {weak || "0"}
                  </td>
                  <td className={cn("px-2 py-1.5 font-mono font-bold tabular-nums", resist ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "text-zinc-500")}>
                    {resist || "0"}
                  </td>
                  <td className={cn("px-2 py-1.5 font-mono tabular-nums", netTone)}>
                    {fmtNet(net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamOffenseTable({
  team,
  pokemonBySlug,
  moveBySlug,
}: {
  team: TeamShare;
  pokemonBySlug: Map<string, RefPokemon>;
  moveBySlug: Map<string, RefMove>;
}) {
  const t = useTranslations("TeamBuilder");

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-bold uppercase tracking-wider">{t("offenseTitle")}</h2>
      <p className="mt-1 text-xs text-zinc-500">{t("offenseHint")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-center text-xs">
          <MatrixHeader slots={team.slots} pokemonBySlug={pokemonBySlug} invert />
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {POKEMON_TYPES.map((defType) => {
              // Per slot: best multiplier across that slot's damage moves vs defType.
              // null = no damage move selected (can't attack at all).
              const cells: { mult: number | null }[] = team.slots.map((slot) => {
                const moves = (slot.m ?? [])
                  .map((s) => moveBySlug.get(s))
                  .filter(
                    (m): m is RefMove =>
                      !!m && m.category !== "status" && m.power != null && m.power > 0,
                  );
                if (moves.length === 0) return { mult: null };
                const best = Math.max(
                  ...moves.map((m) => effectivenessAgainst(m.type as PokemonType, [defType])),
                );
                return { mult: best };
              });
              const strong = cells.filter((c) => c.mult != null && c.mult > 1).length;
              const weakOrNone = cells.filter(
                (c) => c.mult != null && c.mult < 1,
              ).length;
              const net = strong - weakOrNone;
              const netTone =
                net > 0
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold"
                  : net < 0
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-bold"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
              return (
                <tr key={defType}>
                  <td className="px-2 py-1.5">
                    <TypeMatchupTooltip type={defType} size="sm" />
                  </td>
                  {cells.map((c, i) => {
                    const tone = offenseTone(c.mult);
                    return (
                      <td key={i} className={cn("px-1.5 py-1.5 font-mono tabular-nums", tone.bg, tone.text)}>
                        {fmtMult(c.mult)}
                      </td>
                    );
                  })}
                  <td className={cn("px-2 py-1.5 font-mono font-bold tabular-nums", weakOrNone ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "text-zinc-500")}>
                    {weakOrNone || "0"}
                  </td>
                  <td className={cn("px-2 py-1.5 font-mono font-bold tabular-nums", strong ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "text-zinc-500")}>
                    {strong || "0"}
                  </td>
                  <td className={cn("px-2 py-1.5 font-mono tabular-nums", netTone)}>
                    {fmtNet(net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Save-to-My-Pokémon button (slot header)
// ─────────────────────────────────────────────────────────────────────────────

function SaveToMyPokemon({
  slot,
  ev,
  species,
  abilityBySlug,
  itemBySlug,
  moveBySlug,
}: {
  slot: ShareSlot;
  ev: number[];
  species: RefPokemon;
  abilityBySlug: Map<string, RefAbility>;
  itemBySlug: Map<string, RefItem>;
  moveBySlug: Map<string, RefMove>;
}) {
  const ability = slot.a ?? "";
  const item = slot.i ?? "";
  const moves = [...(slot.m ?? [])].concat(Array(4).fill("")).slice(0, 4);
  return (
    <SaveMyPokemonButton
      variant="icon"
      mon={{
        slug: slot.s,
        name: species.name,
        spriteUrl: species.spriteUrl,
        type1: species.type1,
        type2: species.type2,
        ability,
        abilityName: ability ? (abilityBySlug.get(ability)?.name ?? ability) : "",
        item,
        itemName: item ? (itemBySlug.get(item)?.name ?? item) : "",
        nature: slot.n ?? "Hardy",
        moves,
        moveNames: moves.map((m) => (m ? (moveBySlug.get(m)?.name ?? m) : "")),
        ev: [ev[0] ?? 0, ev[1] ?? 0, ev[2] ?? 0, ev[3] ?? 0, ev[4] ?? 0, ev[5] ?? 0],
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// First-time-only hint that appears next to the ★ save button after the user
// adds their first Pokémon. Dismissed permanently via localStorage flag in the
// parent so it never reappears across sessions.

function SaveHintBubble({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("TeamBuilder");
  return (
    <div
      role="dialog"
      aria-label={t("saveHintTitle")}
      className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs shadow-lg dark:border-amber-700 dark:bg-amber-950/80"
    >
      <div
        className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
        aria-hidden
      />
      <p className="font-semibold text-amber-900 dark:text-amber-200">
        {t("saveHintTitle")}
      </p>
      <p className="mt-1 text-amber-800 dark:text-amber-300">{t("saveHintBody")}</p>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          {t("saveHintDismiss")}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Showdown / PokePaste import modal

function ImportModal({
  lookup,
  pokemonBySlug,
  currentSlotCount,
  onClose,
  onApply,
}: {
  lookup: LookupSets;
  pokemonBySlug: Map<string, RefPokemon>;
  currentSlotCount: number;
  onClose: () => void;
  onApply: (team: TeamShare, mode: "replace" | "append") => void;
}) {
  const t = useTranslations("TeamBuilder");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"replace" | "append">(
    currentSlotCount === 0 ? "replace" : "append",
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  // Parse live as the textarea changes. Cheap (just string ops), so re-running
  // on every keystroke is fine — keeps the preview honest.
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseShowdownText(text, lookup);
  }, [text, lookup]);

  async function fetchPokePaste() {
    setFetchError(null);
    setFetching(true);
    try {
      const r = await fetch(`/api/pokepaste?url=${encodeURIComponent(url)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        setFetchError(body?.error ?? t("importErrorFetch"));
        return;
      }
      const body = await r.text();
      setText(body);
    } catch {
      setFetchError(t("importErrorFetch"));
    } finally {
      setFetching(false);
    }
  }

  const slotsParsed = parsed?.team.slots.length ?? 0;
  const room = 6 - currentSlotCount;
  const appendBlocked = mode === "append" && room === 0 && slotsParsed > 0;
  const applyDisabled = slotsParsed === 0 || appendBlocked;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{t("importTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("importSubtitle")}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_minmax(0,360px)]">
          <Field label={t("importTextLabel")}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("importTextPlaceholder")}
              className="h-64 w-full resize-y rounded-md border border-zinc-300 bg-white p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </Field>

          <div className="space-y-3">
            <Field label={t("importUrlLabel")}>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("importUrlPlaceholder")}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={fetchPokePaste}
                  disabled={!url || fetching}
                  className="rounded-md bg-zinc-950 px-3 py-1 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
                >
                  {fetching ? "…" : t("importFetch")}
                </button>
              </div>
              {fetchError ? (
                <p className="mt-1 text-xs text-red-600">{fetchError}</p>
              ) : null}
            </Field>

            <Field label={t("importMode")}>
              <div className="flex flex-col gap-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  {t("importModeReplace")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                    disabled={currentSlotCount >= 6}
                  />
                  {t("importModeAppend")}
                  {currentSlotCount > 0 ? (
                    <span className="text-xs text-zinc-500">
                      ({Math.max(0, room)} / 6)
                    </span>
                  ) : null}
                </label>
              </div>
            </Field>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          {parsed == null ? (
            <p className="text-sm text-zinc-500">{t("importPreviewEmpty")}</p>
          ) : parsed.team.slots.length === 0 ? (
            <div className="space-y-1 text-sm">
              <p className="text-zinc-700 dark:text-zinc-300">
                {t("importNoSlots")}
              </p>
              {parsed.warnings.map((w, i) => (
                <WarningRow key={i} warning={w} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {parsed.team.slots.map((slot, i) => {
                const sp = pokemonBySlug.get(slot.s);
                const slotWarnings = parsed.warnings.filter(
                  (w) => w.slotIndex === i,
                );
                return (
                  <div
                    key={i}
                    className="flex gap-3 rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    {sp ? (
                      <Image
                        src={sp.spriteUrl}
                        alt={sp.name}
                        width={40}
                        height={40}
                        unoptimized
                        className="h-10 w-10 shrink-0 object-contain"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{sp?.name ?? slot.s}</span>
                        {slot.i ? (
                          <span className="text-xs text-zinc-500">
                            @ {slot.i.replace(/-/g, " ")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {(slot.a ?? "").replace(/-/g, " ")}
                        {slot.n ? ` · ${slot.n}` : ""}
                        {slot.v ? ` · SP ${slot.v.join("/")}` : ""}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {(slot.m ?? []).map((m) => m.replace(/-/g, " ")).join(" · ")}
                      </div>
                      {slotWarnings.map((w, wi) => (
                        <WarningRow key={wi} warning={w} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Warnings unattached to any slot (e.g. unknown-species at index N) */}
              {parsed.warnings
                .filter((w) => !parsed.team.slots[w.slotIndex])
                .map((w, i) => (
                  <WarningRow key={`orphan-${i}`} warning={w} />
                ))}
            </div>
          )}
        </div>

        {appendBlocked ? (
          <p className="mt-2 text-xs text-amber-600">{t("importAppendFull")}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("importCancel")}
          </button>
          <button
            type="button"
            disabled={applyDisabled}
            onClick={() => parsed && onApply(parsed.team, mode)}
            className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          >
            {mode === "replace" ? t("importApply") : t("importApplyAppend")}
          </button>
        </div>
      </div>
    </div>
  );
}

function WarningRow({ warning }: { warning: ImportWarning }) {
  // Tone the chip on severity: hard rejects (unknown / illegal) in red,
  // lossy conversions (ev / iv / level) in amber.
  const severe =
    warning.kind === "unknown-species" ||
    warning.kind === "unknown-ability" ||
    warning.kind === "unknown-item" ||
    warning.kind === "unknown-move" ||
    warning.kind === "illegal-ability" ||
    warning.kind === "empty-block";
  const cls = severe
    ? "text-red-700 dark:text-red-300"
    : "text-amber-700 dark:text-amber-300";
  return (
    <p className={`mt-0.5 text-[11px] ${cls}`}>
      <span className="font-mono">⚠</span> {warning.detail}
    </p>
  );
}
