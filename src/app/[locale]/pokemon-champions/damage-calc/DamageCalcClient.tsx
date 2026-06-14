"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TypeChip } from "@/components/TypeChip";
import { CategoryBadge } from "@/components/CategoryBadge";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import type { PokemonType } from "@/lib/types";
import {
  calc,
  NATURES,
  natureEffect,
  type Weather,
  type Terrain,
  type Status,
  type Nature,
  type CalcOutput,
} from "@/lib/damage";
import { cn } from "@/lib/cn";
import { loadAll as loadSavedMons, onSavedMonsChange, type SavedMon } from "@/lib/my-pokemon";

// ─── Reference types passed from the server page ─────────────────────────────

export type CalcRefPokemon = {
  slug: string;
  name: string;
  type1: string;
  type2: string | null;
  spriteUrl: string;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  weight: number;
  abilities: string[];
  hiddenAbility: string | null;
  learnableMoves: string[];
  usagePct: number;
  usage: {
    topAbilities: Array<{ slug: string; pct: number }>;
    topItems: Array<{ slug: string; pct: number }>;
    topMoves: Array<{ slug: string; pct: number }>;
    topSpreads: Array<{
      nature: string;
      vp: [number, number, number, number, number, number];
      pct: number;
    }>;
  } | null;
};
export type CalcRefMove = {
  slug: string; name: string; type: string;
  category: string; // "physical" | "special" | "status"
  // NULL = variable-BP move (Heavy Slam, Low Kick, …); resolved at calc time.
  power: number | null;
  accuracy: number | null; // NULL = never-misses move
  pp: number;
  priority: number;
  makesContact: boolean;
  effectChance: number | null;
  effect: string; // localized short effect description
  targetShape: string;
};
export type CalcRefAbility = { slug: string; name: string };
export type CalcRefItem = { slug: string; name: string };

// ─── Side state ──────────────────────────────────────────────────────────────

type SideState = {
  slug: string;
  ability: string;
  item: string;
  nature: Nature;
  status: Status;
  hpPct: number;
  vp: [number, number, number, number, number, number]; // hp/atk/def/spa/spd/spe
  stageAtk: number;
  stageDef: number;
  stageSpa: number;
  stageSpd: number;
};

function defaultSide(p: CalcRefPokemon | undefined, attacking: boolean): SideState {
  const top = p?.usage;
  const ability = top?.topAbilities[0]?.slug ?? p?.abilities[0] ?? "";
  const item = top?.topItems[0]?.slug ?? "";
  const spread = top?.topSpreads[0];
  const nature = (spread?.nature ?? (attacking ? "Adamant" : "Bold")) as Nature;
  // Default EV: top spread for attacker, defensive baseline for defender
  const vp: [number, number, number, number, number, number] = spread
    ? spread.vp
    : attacking
    ? [2, 32, 0, 0, 0, 32]
    : [32, 0, 32, 0, 2, 0];
  return {
    slug: p?.slug ?? "",
    ability, item, nature,
    status: "none",
    hpPct: 100,
    vp,
    stageAtk: 0, stageDef: 0, stageSpa: 0, stageSpd: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function DamageCalcClient({
  pokemon,
  moves,
  abilities,
  items,
}: {
  pokemon: CalcRefPokemon[];
  moves: CalcRefMove[];
  abilities: CalcRefAbility[];
  items: CalcRefItem[];
}) {
  const t = useTranslations("DamageCalc");
  const tTypes = useTranslations("Types");

  const monBySlug = useMemo(
    () => new Map(pokemon.map((p) => [p.slug, p])),
    [pokemon],
  );
  const abilityBySlug = useMemo(
    () => new Map(abilities.map((a) => [a.slug, a])),
    [abilities],
  );
  const itemBySlug = useMemo(() => new Map(items.map((i) => [i.slug, i])), [items]);
  const moveBySlug = useMemo(() => new Map(moves.map((m) => [m.slug, m])), [moves]);

  // Start empty — the user picks attacker / move / defender deliberately.
  const [atk, setAtk] = useState<SideState>(() => defaultSide(undefined, true));
  const [def, setDef] = useState<SideState>(() => defaultSide(undefined, false));
  const [moveSlug, setMoveSlug] = useState<string>("");
  // Aegislash defender form. Attacker is always treated as Blade (Stance Change
  // fires on any damaging move). Defender's form is user-controlled because
  // Aegislash can be incoming-hit in either stance.
  const [defAegislashForm, setDefAegislashForm] = useState<"shield" | "blade">("shield");

  const [weather, setWeather] = useState<Weather>("none");
  const [terrain, setTerrain] = useState<Terrain>("none");
  const [format, setFormat] = useState<"singles" | "doubles">("doubles");
  const [crit, setCrit] = useState(false);
  const [helpingHand, setHelpingHand] = useState(false);
  const [reflect, setReflect] = useState(false);
  const [lightScreen, setLightScreen] = useState(false);
  const [auroraVeil, setAuroraVeil] = useState(false);
  const [stealthRock, setStealthRock] = useState(false);
  const [spikes, setSpikes] = useState<0 | 1 | 2 | 3>(0);

  // When attacker species changes, refresh defaults. If the species is cleared
  // (slug === ""), also wipe the move so the page returns to a clean empty
  // state rather than leaving an orphaned move selected.
  function pickAttackerSpecies(slug: string) {
    const p = monBySlug.get(slug);
    setAtk(defaultSide(p, true));
    if (!p) {
      setMoveSlug("");
      return;
    }
    const learn = new Set(p.learnableMoves);
    const top = p.usage?.topMoves.find(
      (m) =>
        learn.has(m.slug) && moveBySlug.get(m.slug)?.category !== "status",
    );
    setMoveSlug(top?.slug ?? "");
  }

  function pickDefenderSpecies(slug: string) {
    setDef(defaultSide(monBySlug.get(slug), false));
    setDefAegislashForm("shield");
  }

  // Swap attacker ↔ defender, then re-suggest a damage move for the new
  // attacker (the old move likely isn't in the new mon's learnset).
  function swapSides() {
    const oldAtk = atk;
    const oldDef = def;
    setAtk(oldDef);
    setDef(oldAtk);
    const newAttacker = monBySlug.get(oldDef.slug);
    if (!newAttacker) {
      setMoveSlug("");
      return;
    }
    const learn = new Set(newAttacker.learnableMoves);
    const top = newAttacker.usage?.topMoves.find(
      (m) =>
        learn.has(m.slug) && moveBySlug.get(m.slug)?.category !== "status",
    );
    setMoveSlug(top?.slug ?? "");
  }

  // Apply a saved-mon config to a side (and, when attacker, seed the move).
  function applySavedMon(mon: SavedMon, side: "attacker" | "defender") {
    // Aegislash is exposed in the picker as the shield-form slug only. If the
    // saved mon was stored as the blade slug, normalize it back to shield so
    // the species dropdown reflects it. Defender starts in Shield form.
    const normalizedSlug =
      mon.slug === "aegislash-blade" ? "aegislash-shield" : mon.slug;
    const p = monBySlug.get(normalizedSlug);
    if (!p) return;
    const next: SideState = {
      slug: normalizedSlug,
      ability: mon.ability || p.abilities[0] || "",
      item: mon.item || "",
      nature: (mon.nature as Nature) || "Hardy",
      status: "none",
      hpPct: 100,
      vp: [...mon.ev] as [number, number, number, number, number, number],
      stageAtk: 0, stageDef: 0, stageSpa: 0, stageSpd: 0,
    };
    if (side === "attacker") {
      setAtk(next);
      // Pick the first damage move from the saved set that the mon can learn.
      const learn = new Set(p.learnableMoves);
      const chosen = mon.moves.find(
        (m) =>
          m &&
          learn.has(m) &&
          (moveBySlug.get(m)?.category === "physical" ||
            moveBySlug.get(m)?.category === "special"),
      );
      setMoveSlug(chosen ?? "");
    } else {
      setDef(next);
      if (normalizedSlug === "aegislash-shield") setDefAegislashForm("shield");
    }
  }

  const attackerMon = monBySlug.get(atk.slug);
  const defenderMon = monBySlug.get(def.slug);
  const move = moveBySlug.get(moveSlug);

  // Aegislash stance resolution. The species picker only exposes
  // aegislash-shield; the actual stats used for the calc depend on which side
  // it's on. Attacker → always Blade Form. Defender → user-selected.
  const attackerStatsMon =
    attackerMon?.slug === "aegislash-shield"
      ? monBySlug.get("aegislash-blade") ?? attackerMon
      : attackerMon;
  const defenderStatsMon =
    defenderMon?.slug === "aegislash-shield" && defAegislashForm === "blade"
      ? monBySlug.get("aegislash-blade") ?? defenderMon
      : defenderMon;

  const result: CalcOutput | null = useMemo(() => {
    if (!attackerStatsMon || !defenderStatsMon || !move) return null;
    if (move.category === "status") return null;
    return calc({
      attacker: {
        slug: attackerStatsMon.slug,
        types: [attackerStatsMon.type1 as PokemonType, attackerStatsMon.type2 as PokemonType | null],
        atk: attackerStatsMon.atk, spa: attackerStatsMon.spa,
        def: attackerStatsMon.def, spd: attackerStatsMon.spd, spe: attackerStatsMon.spe,
        weight: attackerStatsMon.weight,
        vpAtk: atk.vp[1], vpSpa: atk.vp[3],
        vpDef: atk.vp[2], vpSpd: atk.vp[4], vpSpe: atk.vp[5],
        nature: atk.nature,
        ability: atk.ability || undefined,
        item: atk.item || undefined,
        status: atk.status,
        stageAtk: atk.stageAtk, stageSpa: atk.stageSpa,
        stageDef: atk.stageDef, stageSpd: atk.stageSpd,
      },
      defender: {
        slug: defenderStatsMon.slug,
        types: [defenderStatsMon.type1 as PokemonType, defenderStatsMon.type2 as PokemonType | null],
        hp: defenderStatsMon.hp, def: defenderStatsMon.def, spd: defenderStatsMon.spd, spe: defenderStatsMon.spe,
        atk: defenderStatsMon.atk, spa: defenderStatsMon.spa,
        weight: defenderStatsMon.weight,
        vpHp: def.vp[0], vpDef: def.vp[2], vpSpd: def.vp[4],
        vpAtk: def.vp[1], vpSpa: def.vp[3], vpSpe: def.vp[5],
        nature: def.nature,
        ability: def.ability || undefined,
        item: def.item || undefined,
        status: def.status,
        stageDef: def.stageDef, stageSpd: def.stageSpd,
        stageAtk: def.stageAtk, stageSpa: def.stageSpa,
        hpPct: def.hpPct,
      },
      move: {
        slug: move.slug,
        type: move.type as PokemonType,
        category: move.category as "physical" | "special",
        // Variable-BP moves come in as null; calc resolves from state. Passing 0
        // keeps the existing `move.power <= 0` branch happy for any remaining
        // unresolvable case.
        power: move.power ?? 0,
        targetShape: move.targetShape,
      },
      field: {
        weather, terrain, format, crit, helpingHand,
        screens: { reflect, lightScreen, auroraVeil },
        hazards: { stealthRock, spikes, toxicSpikes: 0 },
      },
    });
  }, [
    attackerStatsMon, defenderStatsMon, move, atk, def,
    weather, terrain, format, crit, helpingHand,
    reflect, lightScreen, auroraVeil, stealthRock, spikes,
  ]);

  const speciesOptions: ComboboxOption[] = useMemo(
    () =>
      pokemon
        // Aegislash has two DB rows (shield + blade), but for the user it's one
        // species — the form is derived from context (attacker = blade,
        // defender = user-chosen). Hide the blade row from the picker so it
        // appears as a single "Aegislash" entry.
        .filter((p) => p.slug !== "aegislash-blade")
        .map((p) => ({
        value: p.slug,
        label: p.name,
        searchText: p.slug,
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
    [pokemon],
  );

  // Move options scoped to attacker's learnset, damage moves only.
  // Variable-BP moves (Heavy Slam, Low Kick, …) have power===null; keep them
  // and label as "var" — calc resolves BP from weight/speed/HP at runtime.
  const moveOptions: ComboboxOption[] = useMemo(() => {
    if (!attackerMon) return [];
    const learn = new Set(attackerMon.learnableMoves);
    const pctByMove = new Map(attackerMon.usage?.topMoves.map((m) => [m.slug, m.pct]) ?? []);
    return moves
      .filter((m) => m.category !== "status" && learn.has(m.slug))
      .map((m) => ({
        value: m.slug,
        label: `${m.name} · ${tTypes(m.type)} · ${m.power ?? "var"}`,
        searchText: m.slug,
        usagePct: pctByMove.get(m.slug),
      }));
  }, [attackerMon, moves, tTypes]);

  const allEmpty = !atk.slug && !def.slug && !moveSlug;

  return (
    <div>
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </header>

      {/* Empty-state callout — disappears as soon as anything is picked. */}
      {allEmpty ? (
        <section className="mt-5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
          <p>{t("emptyHint")}</p>
        </section>
      ) : null}

      {/* Attacker → Move → Defender flow */}
      <section className="mt-4 grid gap-3 md:grid-cols-[minmax(0,5fr)_auto_minmax(0,4fr)_auto_minmax(0,5fr)] md:items-stretch">
        <SidePanel
          title={t("attacker")}
          side={atk}
          setSide={setAtk}
          mon={attackerMon}
          speciesOptions={speciesOptions}
          onSpeciesChange={pickAttackerSpecies}
          abilities={abilities}
          abilityBySlug={abilityBySlug}
          items={items}
          itemBySlug={itemBySlug}
          onApplySaved={(mon) => applySavedMon(mon, "attacker")}
          isAttacker
          moveSlug={moveSlug}
          aegislashBladeBadge={attackerMon?.slug === "aegislash-shield"}
        />
        <FlowArrow />
        <MoveCard
          moveSlug={moveSlug}
          setMoveSlug={setMoveSlug}
          move={move}
          options={moveOptions}
          attackerSelected={Boolean(attackerMon)}
          canSwap={Boolean(attackerMon) && Boolean(defenderMon)}
          onSwap={swapSides}
        />
        <FlowArrow />
        <SidePanel
          title={t("defender")}
          side={def}
          setSide={setDef}
          mon={defenderMon}
          speciesOptions={speciesOptions}
          onSpeciesChange={pickDefenderSpecies}
          abilities={abilities}
          abilityBySlug={abilityBySlug}
          items={items}
          itemBySlug={itemBySlug}
          onApplySaved={(mon) => applySavedMon(mon, "defender")}
          moveSlug={moveSlug}
          aegislashFormToggle={
            defenderMon?.slug === "aegislash-shield"
              ? { value: defAegislashForm, onChange: setDefAegislashForm }
              : undefined
          }
        />
      </section>

      {/* Headline result — % of defender HP, large and obvious. */}
      <ResultHero
        result={result} move={move} attacker={attackerMon} defender={defenderMon}
        defenderHpPct={def.hpPct}
      />

      {/* Field strip */}
      <FieldStrip
        weather={weather} setWeather={setWeather}
        terrain={terrain} setTerrain={setTerrain}
        format={format} setFormat={setFormat}
        crit={crit} setCrit={setCrit}
        helpingHand={helpingHand} setHelpingHand={setHelpingHand}
        reflect={reflect} setReflect={setReflect}
        lightScreen={lightScreen} setLightScreen={setLightScreen}
        auroraVeil={auroraVeil} setAuroraVeil={setAuroraVeil}
        stealthRock={stealthRock} setStealthRock={setStealthRock}
        spikes={spikes} setSpikes={setSpikes}
      />

      <ResultDetails result={result} />
    </div>
  );
}

// ─── Flow arrow between Attacker / Move / Defender ──────────────────────────

function FlowArrow() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center text-2xl text-zinc-300 dark:text-zinc-700"
    >
      <span className="hidden md:inline">→</span>
      <span className="md:hidden">↓</span>
    </div>
  );
}

// ─── Move card (center of the flow) ─────────────────────────────────────────

function MoveCard({
  moveSlug,
  setMoveSlug,
  move,
  options,
  attackerSelected,
  canSwap,
  onSwap,
}: {
  moveSlug: string;
  setMoveSlug: (v: string) => void;
  move: CalcRefMove | undefined;
  options: ComboboxOption[];
  attackerSelected: boolean;
  canSwap: boolean;
  onSwap: () => void;
}) {
  const t = useTranslations("DamageCalc");
  const tMoves = useTranslations("Moves");
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">
          {t("moveLabel")}
        </h2>
        <button
          type="button"
          onClick={onSwap}
          disabled={!canSwap}
          title={t("swapSides")}
          aria-label={t("swapSides")}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:disabled:hover:bg-zinc-900"
        >
          ⇄ {t("swap")}
        </button>
      </div>
      <div className="mt-3">
        <Combobox
          value={moveSlug}
          options={options}
          onChange={setMoveSlug}
          placeholder={
            attackerSelected ? t("movePlaceholder") : t("pickAttackerFirst")
          }
          ariaLabel={t("moveLabel")}
          allowClear
        />
      </div>
      {move ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <TypeChip type={move.type as PokemonType} size="sm" />
            <CategoryBadge cat={move.category} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <MoveStat label={t("powerLabel")}>
              {move.power && move.power > 0 ? move.power : "—"}
            </MoveStat>
            <MoveStat label={tMoves("columns.accuracy")}>
              {move.accuracy ?? "—"}
            </MoveStat>
            <MoveStat label={tMoves("columns.pp")}>{move.pp}</MoveStat>
            <MoveStat label={tMoves("columns.priority")}>
              {move.priority > 0 ? `+${move.priority}` : move.priority}
            </MoveStat>
            <MoveStat label={tMoves("detail.contact")}>
              {tMoves(move.makesContact ? "detail.yes" : "detail.no")}
            </MoveStat>
            {move.effectChance ? (
              <MoveStat label={t("effectChanceLabel")}>
                {move.effectChance}%
              </MoveStat>
            ) : null}
          </dl>
          {move.effect ? (
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {move.effect}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs italic text-zinc-400">
          {attackerSelected ? t("noMoveSelected") : t("pickAttackerFirst")}
        </p>
      )}
    </article>
  );
}

function MoveStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono tabular-nums">{children}</dd>
    </div>
  );
}

// ─── Side panel ──────────────────────────────────────────────────────────────

function SidePanel({
  title,
  side,
  setSide,
  mon,
  speciesOptions,
  onSpeciesChange,
  abilities,
  abilityBySlug,
  items,
  itemBySlug,
  onApplySaved,
  isAttacker,
  moveSlug,
  aegislashBladeBadge,
  aegislashFormToggle,
}: {
  title: string;
  side: SideState;
  setSide: React.Dispatch<React.SetStateAction<SideState>>;
  mon: CalcRefPokemon | undefined;
  speciesOptions: ComboboxOption[];
  onSpeciesChange: (slug: string) => void;
  abilities: CalcRefAbility[];
  abilityBySlug: Map<string, CalcRefAbility>;
  items: CalcRefItem[];
  itemBySlug: Map<string, CalcRefItem>;
  onApplySaved: (mon: SavedMon) => void;
  isAttacker?: boolean;
  moveSlug: string;
  aegislashBladeBadge?: boolean;
  aegislashFormToggle?: { value: "shield" | "blade"; onChange: (v: "shield" | "blade") => void };
}) {
  const t = useTranslations("DamageCalc");
  const tNature = useTranslations("Natures");
  const tStat = useTranslations("StatShort");

  const pctByAbility = new Map(mon?.usage?.topAbilities.map((a) => [a.slug, a.pct]) ?? []);
  const pctByItem = new Map(mon?.usage?.topItems.map((i) => [i.slug, i.pct]) ?? []);

  const validAbilities = mon
    ? [...mon.abilities, ...(mon.hiddenAbility ? [mon.hiddenAbility] : [])]
    : [];
  const abilityOptions: ComboboxOption[] = validAbilities.map((slug) => ({
    value: slug,
    label: abilityBySlug.get(slug)?.name ?? slug,
    usagePct: pctByAbility.get(slug),
    suffix: mon?.hiddenAbility === slug ? "★" : null,
  }));

  const itemOptions: ComboboxOption[] = items.map((it) => ({
    value: it.slug,
    label: it.name,
    searchText: it.slug,
    usagePct: pctByItem.get(it.slug),
  }));

  const natureOptions: ComboboxOption[] = NATURES.map((n) => {
    const { up, down } = natureEffect(n);
    const localized = tNature(n as never);
    const effectText = up && down
      ? ` +${tStat(up)} −${tStat(down)}`
      : ` ${tNature("neutralSuffix")}`;
    return {
      value: n,
      label: localized + effectText,
      // Allow searching by raw English name even when UI is non-English.
      searchText: `${n.toLowerCase()} ${localized}`,
    };
  });

  const statuses: Status[] = ["none", "burn", "paralysis", "poison", "toxic", "sleep", "freeze"];
  const statusOptions: ComboboxOption[] = statuses.map((s) => ({
    value: s,
    label: t(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as `status${Capitalize<Status>}`),
  }));

  function setStage(key: "stageAtk" | "stageDef" | "stageSpa" | "stageSpd", value: number) {
    setSide((s) => ({ ...s, [key]: Math.max(-6, Math.min(6, value)) }));
  }

  // Show stages relevant to the selected move. Body Press uses attacker Def,
  // so swap Atk for Def on the attacker. Foul Play uses defender's Atk, so add
  // it to the defender's defensive pair.
  type StageKey = "stageAtk" | "stageDef" | "stageSpa" | "stageSpd";
  const stageRows: Array<{ key: StageKey; label: string }> = isAttacker
    ? moveSlug === "body-press"
      ? [
          { key: "stageDef", label: tStat("def") },
          { key: "stageSpa", label: tStat("spa") },
        ]
      : [
          { key: "stageAtk", label: tStat("atk") },
          { key: "stageSpa", label: tStat("spa") },
        ]
    : moveSlug === "foul-play"
      ? [
          { key: "stageAtk", label: tStat("atk") },
          { key: "stageDef", label: tStat("def") },
          { key: "stageSpd", label: tStat("spd") },
        ]
      : [
          { key: "stageDef", label: tStat("def") },
          { key: "stageSpd", label: tStat("spd") },
        ];

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
        <ImportFromSavedButton onPick={onApplySaved} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        {mon ? (
          <Image
            src={mon.spriteUrl}
            width={48}
            height={48}
            alt={mon.name}
            unoptimized
            className="h-12 w-12 shrink-0 object-contain"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <Combobox
            value={side.slug}
            options={speciesOptions}
            onChange={onSpeciesChange}
            placeholder={t("speciesPlaceholder")}
            ariaLabel={t("speciesLabel")}
            allowClear
          />
          {mon ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <TypeChip type={mon.type1 as PokemonType} size="sm" />
              {mon.type2 ? <TypeChip type={mon.type2 as PokemonType} size="sm" /> : null}
              {aegislashBladeBadge ? (
                <span className="ml-1 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  {t("bladeFormBadge")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {!mon ? (
        <p className="mt-3 text-xs italic text-zinc-400">
          {isAttacker ? t("pickAttackerHint") : t("pickDefenderHint")}
        </p>
      ) : null}

      {mon && aegislashFormToggle ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-zinc-500">
            {t("formLabel")}:
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {(["shield", "blade"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => aegislashFormToggle.onChange(f)}
                className={cn(
                  "px-2.5 py-1 font-medium",
                  aegislashFormToggle.value === f
                    ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                {t(f === "shield" ? "formShield" : "formBlade")}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mon ? (
      <>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <SmallField label={t("abilityLabel")}>
          <Combobox
            value={side.ability}
            options={abilityOptions}
            onChange={(v) => setSide((s) => ({ ...s, ability: v }))}
            placeholder={t("abilityPlaceholder")}
            allowClear
          />
        </SmallField>
        <SmallField label={t("itemLabel")}>
          <Combobox
            value={side.item}
            options={itemOptions}
            onChange={(v) => setSide((s) => ({ ...s, item: v }))}
            placeholder={t("itemPlaceholder")}
            allowClear
          />
        </SmallField>
        <SmallField label={t("natureLabel")}>
          <Combobox
            value={side.nature}
            options={natureOptions}
            onChange={(v) => setSide((s) => ({ ...s, nature: v as Nature }))}
            placeholder={t("natureLabel")}
          />
        </SmallField>
        <SmallField label={t("statusLabel")}>
          <Combobox
            value={side.status}
            options={statusOptions}
            onChange={(v) => setSide((s) => ({ ...s, status: v as Status }))}
            placeholder={t("statusLabel")}
          />
        </SmallField>
      </div>

      {/* EV inputs (compact: only the relevant offensive/defensive ones get full attention) */}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("evLabel")}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1.5 text-xs">
          {(["hp","atk","def","spa","spd","spe"] as const).map((key, i) => (
            <label key={key} className="flex items-center gap-1">
              <span className="w-8 shrink-0 text-zinc-500">{tStat(key)}</span>
              <input
                type="number" min={0} max={32} step={1}
                value={side.vp[i]}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(32, parseInt(e.target.value) || 0));
                  setSide((s) => {
                    const next = [...s.vp] as [number, number, number, number, number, number];
                    next[i] = v;
                    return { ...s, vp: next };
                  });
                }}
                className="w-full rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-right font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Stat stage steppers */}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("stageLabel")}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
          {stageRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between rounded-md border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setStage(row.key, side[row.key] - 1)}
                className="h-5 w-5 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={`Decrease ${row.label}`}
              >−</button>
              <span className="font-mono tabular-nums">
                {row.label} {side[row.key] > 0 ? "+" : ""}{side[row.key]}
              </span>
              <button
                type="button"
                onClick={() => setStage(row.key, side[row.key] + 1)}
                className="h-5 w-5 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={`Increase ${row.label}`}
              >+</button>
            </div>
          ))}
        </div>
      </div>

      {/* HP % (defender only) */}
      {!isAttacker ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-zinc-500">
            {t("hpPctLabel")}:
          </span>
          <input
            type="range" min={1} max={100} step={1}
            value={side.hpPct}
            onChange={(e) =>
              setSide((s) => ({ ...s, hpPct: parseInt(e.target.value) }))
            }
            className="flex-1"
          />
          <span className="w-10 text-right font-mono tabular-nums">{side.hpPct}%</span>
        </div>
      ) : null}
      </>
      ) : null}
    </article>
  );
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

// ─── Field strip ─────────────────────────────────────────────────────────────

function FieldStrip(props: {
  weather: Weather; setWeather: (w: Weather) => void;
  terrain: Terrain; setTerrain: (t: Terrain) => void;
  format: "singles" | "doubles"; setFormat: (f: "singles" | "doubles") => void;
  crit: boolean; setCrit: (b: boolean) => void;
  helpingHand: boolean; setHelpingHand: (b: boolean) => void;
  reflect: boolean; setReflect: (b: boolean) => void;
  lightScreen: boolean; setLightScreen: (b: boolean) => void;
  auroraVeil: boolean; setAuroraVeil: (b: boolean) => void;
  stealthRock: boolean; setStealthRock: (b: boolean) => void;
  spikes: 0 | 1 | 2 | 3; setSpikes: (n: 0 | 1 | 2 | 3) => void;
}) {
  const t = useTranslations("DamageCalc");

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">{t("field")}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Pill label={t("weather")}>
          <select
            value={props.weather}
            onChange={(e) => props.setWeather(e.target.value as Weather)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="none">{t("weatherNone")}</option>
            <option value="sun">{t("weatherSun")}</option>
            <option value="rain">{t("weatherRain")}</option>
            <option value="sand">{t("weatherSand")}</option>
            <option value="snow">{t("weatherSnow")}</option>
          </select>
        </Pill>
        <Pill label={t("terrain")}>
          <select
            value={props.terrain}
            onChange={(e) => props.setTerrain(e.target.value as Terrain)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="none">{t("terrainNone")}</option>
            <option value="electric">{t("terrainElectric")}</option>
            <option value="grassy">{t("terrainGrassy")}</option>
            <option value="psychic">{t("terrainPsychic")}</option>
            <option value="misty">{t("terrainMisty")}</option>
          </select>
        </Pill>
        <Pill label={t("format")}>
          <select
            value={props.format}
            onChange={(e) => props.setFormat(e.target.value as "singles" | "doubles")}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="doubles">{t("formatDoubles")}</option>
            <option value="singles">{t("formatSingles")}</option>
          </select>
        </Pill>
        <CheckChip checked={props.crit} onChange={props.setCrit} label={t("crit")} />
        <CheckChip checked={props.helpingHand} onChange={props.setHelpingHand} label={t("helpingHand")} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("screens")}:
        </span>
        <CheckChip checked={props.reflect} onChange={props.setReflect} label={t("reflect")} />
        <CheckChip checked={props.lightScreen} onChange={props.setLightScreen} label={t("lightScreen")} />
        <CheckChip checked={props.auroraVeil} onChange={props.setAuroraVeil} label={t("auroraVeil")} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("hazards")}:
        </span>
        <CheckChip checked={props.stealthRock} onChange={props.setStealthRock} label={t("stealthRock")} />
        <Pill label={t("spikes")}>
          <select
            value={props.spikes}
            onChange={(e) => props.setSpikes(parseInt(e.target.value) as 0 | 1 | 2 | 3)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </Pill>
      </div>
    </section>
  );
}

function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}:
      </span>
      {children}
    </label>
  );
}

function CheckChip({
  checked, onChange, label,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        checked
          ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {label}
    </label>
  );
}

// ─── Result hero: the headline % of defender HP, large + obvious ─────────────

function ResultHero({
  result, move, attacker, defender, defenderHpPct,
}: {
  result: CalcOutput | null;
  move: CalcRefMove | undefined;
  attacker: CalcRefPokemon | undefined;
  defender: CalcRefPokemon | undefined;
  defenderHpPct: number;
}) {
  const t = useTranslations("DamageCalc");

  if (!result || !move || !attacker || !defender) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
        <div className="text-3xl font-black text-zinc-300 dark:text-zinc-700">
          —%
        </div>
        <p className="mt-2 text-sm text-zinc-500">{t("noResult")}</p>
      </section>
    );
  }

  // KO chance is computed against the defender's *current* HP — not max.
  // If the defender is at 22% HP and we deal 60-70% damage, every roll
  // exceeds the remaining 22% HP, so it's a guaranteed KO.
  const currentHp = Math.max(
    1,
    Math.floor((result.defenderMaxHp * defenderHpPct) / 100),
  );
  const koPct = (() => {
    if (result.effectiveness === 0) return 0;
    if (result.max <= 0) return 0;
    const koRolls = result.rolls.filter((r) => r >= currentHp).length;
    return Math.round((koRolls / Math.max(1, result.rolls.length)) * 100);
  })();

  // Tone by KO chance at the defender's *current* HP. Guaranteed KO → red,
  // possible KO → orange/amber, won't KO but still hits → muted, immune → zinc.
  const heroTone =
    result.effectiveness === 0 || result.max === 0
      ? "from-zinc-200 to-zinc-100 text-zinc-500 dark:from-zinc-800 dark:to-zinc-900"
      : koPct >= 100
      ? "from-red-600 to-red-500 text-white"
      : koPct >= 50
      ? "from-orange-500 to-amber-400 text-white"
      : koPct > 0
      ? "from-amber-300 to-yellow-200 text-amber-900 dark:from-amber-500 dark:to-amber-400 dark:text-amber-950"
      : "from-zinc-100 to-white text-zinc-800 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-200";

  const koBadge =
    result.effectiveness === 0
      ? { label: t("koImmune"), tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" }
      : koPct >= 100
      ? { label: t("koGuaranteed"), tone: "bg-red-600 text-white" }
      : koPct > 0
      ? {
          label: t("koChance", { pct: koPct }),
          tone: "bg-amber-500 text-white",
        }
      : { label: t("noKo"), tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" };

  return (
    <section
      className={cn(
        "mt-6 rounded-2xl border border-zinc-200 bg-gradient-to-br p-6 shadow-sm dark:border-zinc-800",
        heroTone,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
        {t("pctRange")}
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="font-black leading-none tracking-tight">
          <span className="text-5xl sm:text-7xl tabular-nums">
            {result.minPct}%
          </span>
          <span className="mx-2 text-3xl sm:text-5xl opacity-60">–</span>
          <span className="text-5xl sm:text-7xl tabular-nums">
            {result.maxPct}%
          </span>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wider",
            koBadge.tone,
          )}
        >
          {koBadge.label}
        </span>
      </div>
      <p className="mt-2 text-sm opacity-80">
        {t("pctOfDefender", {
          attacker: attacker.name,
          move: move.name,
          defender: defender.name,
          min: result.min,
          max: result.max,
        })}
      </p>
    </section>
  );
}

// ─── Secondary stats / histogram / modifier trace ────────────────────────────

function ResultDetails({ result }: { result: CalcOutput | null }) {
  const t = useTranslations("DamageCalc");

  if (!result) return null;

  const effLabel =
    result.effectiveness === 0 ? "×0 (immune)" : `×${result.effectiveness}`;
  const effTone =
    result.effectiveness === 0
      ? "text-zinc-500"
      : result.effectiveness >= 2
      ? "text-emerald-600 font-bold"
      : result.effectiveness <= 0.5
      ? "text-amber-600"
      : "text-zinc-600";

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("minMax")} value={`${result.min} – ${result.max}`} />
        <Stat label={t("stab")} value={`×${result.stab}`} />
        <Stat label={t("effectiveness")} value={effLabel} className={effTone} />
        <Stat
          label={t("hazardChip")}
          value={`-${result.hazardChipPct}%`}
          className={result.hazardChipPct > 0 ? "text-amber-600" : "text-zinc-400"}
        />
      </div>

      {/* Roll histogram */}
      <div className="mt-4">
        <div className="flex items-end gap-0.5 h-12">
          {result.rolls.map((r, i) => {
            const pct = result.max === 0 ? 0 : (r / result.max) * 100;
            return (
              <div
                key={i}
                title={`${r} (${((100 * r) / result.defenderMaxHp).toFixed(1)}%)`}
                className={cn(
                  "flex-1 rounded-t bg-gradient-to-t from-red-500 to-amber-400",
                  result.effectiveness === 0 && "from-zinc-300 to-zinc-200",
                )}
                style={{ height: `${Math.max(8, (pct / 100) * 48)}px` }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
          <span>85%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Modifier trace */}
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("modifiers")}
        </h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {result.notes.length === 0 ? (
            <li className="text-xs italic text-zinc-400">{t("noModifiers")}</li>
          ) : (
            result.notes.map((n, i) => (
              <li
                key={i}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {n}
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}

function Stat({
  label, value, className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-1 font-mono text-base tabular-nums", className)}>{value}</div>
    </div>
  );
}

// ─── Import-from-saved-mons button ───────────────────────────────────────────

function ImportFromSavedButton({
  onPick,
}: {
  onPick: (mon: SavedMon) => void;
}) {
  const t = useTranslations("DamageCalc");
  const [open, setOpen] = useState(false);
  const [mons, setMons] = useState<SavedMon[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Refresh the saved list when the popover opens and on storage changes.
  useEffect(() => {
    if (!open) return;
    setMons(loadSavedMons());
    const off = onSavedMonsChange(() => setMons(loadSavedMons()));
    return off;
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        ★ {t("importFromSaved")}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {mons.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs italic text-zinc-500">
              {t("noSavedMons")}
            </p>
          ) : (
            <ul className="space-y-1">
              {mons.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(m);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Image
                      src={m.spriteUrl}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="h-8 w-8 shrink-0 object-contain"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="truncate text-[10px] text-zinc-500">
                        {m.abilityName || m.ability || "—"}
                        {m.item ? ` · ${m.itemName || m.item.replace(/-/g, " ")}` : ""}
                        {` · ${m.nature}`}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
