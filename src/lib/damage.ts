/**
 * Damage formula for Pokémon Champions (Gen 6+ shape).
 *
 * Covers:
 *   - STAB
 *   - Type effectiveness (incl. ability-driven immunities/resistances)
 *   - Stat stages (-6..+6), with crit-ignores semantics
 *   - Nature multipliers (×1.1 / ×0.9)
 *   - Status conditions (burn × 0.5 on physical, paralysis speed handled separately)
 *   - Weather (sun/rain/sand/snow) and Terrain (electric/grassy/psychic/misty)
 *   - Screens (Reflect / Light Screen / Aurora Veil) with doubles 2/3 modifier
 *   - Helping Hand × 1.5
 *   - Spread (doubles, multi-target) × 0.75
 *   - Crit × 1.5 with Gen 6+ rules (ignores adverse stat changes)
 *   - 16-roll variance (85–100%)
 *   - Selected ability modifiers — Intimidate (passive lookup elsewhere; here
 *     we accept the resulting Atk stage), Adaptability, Tough Claws (treated as
 *     "contact-ish"), Strong Jaw / Mega Launcher / Iron Fist / Punk Rock /
 *     Technician / Tinted Lens / Sheer Force / Transistor / Dragon's Maw /
 *     Aerilate-family / Filter / Solid Rock / Prism Armor / Multiscale /
 *     Ice Scales / Punk Rock (def) / Fluffy / Heatproof / Thick Fat /
 *     Water Absorb / Volt Absorb / Flash Fire / Storm Drain / Lightning Rod /
 *     Sap Sipper / Motor Drive / Levitate / Dry Skin / Wonder Guard
 *   - Item modifiers — Life Orb / Choice Band / Choice Specs / Expert Belt /
 *     Assault Vest / Eviolite / type-boost plates (×1.2 if matching attacker
 *     move type) / Muscle Band / Wise Glasses
 *   - Defender hazard chip (Stealth Rock + Spikes layers + Toxic Spikes)
 *
 * Deliberately NOT modeled (yet):
 *   - Tera type (Champions disables Terastallization in PRD)
 *   - Z-moves / Dynamax (Champions doesn't ship these)
 *   - Mold Breaker bypass (would need flag awareness)
 *   - Move flags (punch/bite/sound/pulse) — approximated by hardcoded slug lists
 */

import type { PokemonType } from "./types";
import { effectivenessAgainst } from "./type-chart";

const LEVEL = 50;

// ─── Natures ─────────────────────────────────────────────────────────────────

export type Nature =
  | "Hardy" | "Lonely" | "Adamant" | "Naughty" | "Brave"
  | "Bold" | "Docile" | "Impish" | "Lax" | "Relaxed"
  | "Modest" | "Mild" | "Bashful" | "Rash" | "Quiet"
  | "Calm" | "Gentle" | "Careful" | "Sassy" | "Quirky"
  | "Timid" | "Hasty" | "Jolly" | "Naive" | "Serious";

type StatKey = "atk" | "def" | "spa" | "spd" | "spe";

// Each entry: [up, down]
const NATURE_TABLE: Record<Nature, [StatKey | null, StatKey | null]> = {
  Hardy: [null, null], Docile: [null, null], Bashful: [null, null],
  Quirky: [null, null], Serious: [null, null],

  Lonely:  ["atk", "def"], Adamant: ["atk", "spa"], Naughty: ["atk", "spd"], Brave:   ["atk", "spe"],
  Bold:    ["def", "atk"], Impish:  ["def", "spa"], Lax:     ["def", "spd"], Relaxed: ["def", "spe"],
  Modest:  ["spa", "atk"], Mild:    ["spa", "def"], Rash:    ["spa", "spd"], Quiet:   ["spa", "spe"],
  Calm:    ["spd", "atk"], Gentle:  ["spd", "def"], Careful: ["spd", "spa"], Sassy:   ["spd", "spe"],
  Timid:   ["spe", "atk"], Hasty:   ["spe", "def"], Jolly:   ["spe", "spa"], Naive:   ["spe", "spd"],
};

export const NATURES: readonly Nature[] = Object.keys(NATURE_TABLE) as Nature[];

/** Returns the stat raised (+10%) and lowered (-10%) by a nature, or nulls for neutral. */
export function natureEffect(nat: Nature): { up: StatKey | null; down: StatKey | null } {
  const [up, down] = NATURE_TABLE[nat];
  return { up, down };
}

function natureMult(nat: Nature, stat: StatKey): number {
  const [up, down] = NATURE_TABLE[nat];
  if (up === stat) return 1.1;
  if (down === stat) return 0.9;
  return 1;
}

// ─── Stat computation ────────────────────────────────────────────────────────

/**
 * Stat at level 50 with Champions' Stat Point system.
 * Champions has no editable IVs; neutral non-HP stats are base + 20 + SP,
 * and HP is base + 75 + SP. Nature applies after Stat Points for non-HP.
 */
export function computeStat(
  base: number,
  vp: number,
  nature: Nature,
  stat: StatKey,
  isHp = false,
): number {
  const statPoints = Math.max(0, Math.min(32, Math.floor(vp)));
  if (isHp) return base + 75 + statPoints;
  return Math.floor((base + 20 + statPoints) * natureMult(nature, stat));
}

/** Stat-stage multiplier per Gen 6+ rules. */
function stageFactor(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  if (s >= 0) return (2 + s) / 2;
  return 2 / (2 - s);
}

// ─── Field types ─────────────────────────────────────────────────────────────

export type Weather = "none" | "sun" | "rain" | "sand" | "snow";
export type Terrain = "none" | "electric" | "grassy" | "psychic" | "misty";
export type Status = "none" | "burn" | "paralysis" | "poison" | "toxic" | "sleep" | "freeze";
export type Screens = { reflect: boolean; lightScreen: boolean; auroraVeil: boolean };
export type Hazards = {
  stealthRock: boolean;
  spikes: 0 | 1 | 2 | 3;
  toxicSpikes: 0 | 1 | 2;
};

// ─── Move flag heuristics ────────────────────────────────────────────────────
// We don't yet ingest move flags. Approximate via slug patterns.

const CONTACT_MOVES = new Set<string>([
  "flare-blitz", "knock-off", "fake-out", "u-turn", "close-combat", "wild-charge",
  "dragon-claw", "play-rough", "iron-head", "double-edge", "outrage",
  // ... not exhaustive
]);
const PUNCH_MOVES = new Set([
  "ice-punch", "fire-punch", "thunder-punch", "drain-punch", "focus-punch",
  "mach-punch", "bullet-punch", "shadow-punch", "sky-uppercut", "dynamic-punch",
  "hammer-arm", "meteor-mash", "comet-punch", "power-up-punch",
]);
const BITE_MOVES = new Set([
  "crunch", "fire-fang", "ice-fang", "thunder-fang", "poison-fang", "bite",
  "psychic-fangs", "hyper-fang", "jaw-lock",
]);
const PULSE_MOVES = new Set([
  "water-pulse", "dragon-pulse", "dark-pulse", "aura-sphere", "origin-pulse",
  "heal-pulse", "terrain-pulse",
]);
const SOUND_MOVES = new Set([
  "hyper-voice", "boomburst", "overdrive", "snarl", "round", "echoed-voice",
  "uproar", "growl", "screech", "sing", "supersonic", "perish-song",
  "metal-sound", "chatter", "relic-song", "noble-roar",
]);
// Slicing moves — boosted ×1.5 by the Sharpness ability (Gen 9).
const SLICING_MOVES = new Set([
  "aerial-ace", "air-cutter", "air-slash", "aqua-cutter", "behemoth-blade",
  "bitter-blade", "ceaseless-edge", "cross-poison", "cut", "fury-cutter",
  "kowtow-cleave", "leaf-blade", "night-slash", "population-bomb", "psyblade",
  "psycho-cut", "razor-leaf", "razor-shell", "sacred-sword", "secret-sword",
  "slash", "solar-blade", "stone-axe", "x-scissor",
]);
const SECONDARY_EFFECT_MOVES = new Set([
  // moves with non-100% secondary effects that benefit Sheer Force
  "ice-beam", "thunderbolt", "flamethrower", "shadow-ball", "sludge-bomb",
  "earth-power", "iron-head", "fire-blast", "psychic", "ancient-power",
  "rock-slide", "air-slash", "play-rough", "moonblast", "discharge", "ominous-wind",
]);
const RECOIL_MOVES = new Set([
  "double-edge", "flare-blitz", "wild-charge", "head-charge", "head-smash",
  "submission", "take-down", "wood-hammer", "volt-tackle",
]);
// Moves that always land a critical hit (1.5× damage built in).
const ALWAYS_CRIT_MOVES = new Set([
  "flower-trick",     // 千变万花 — Hisuian Lilligant signature
  "surging-strikes",  // Urshifu-Rapid-Strike signature
  "wicked-blow",      // Urshifu-Single-Strike signature
  "frost-breath",
  "storm-throw",
  "zippy-zap",
]);

// Multi-hit move effective-power multipliers. Damage is computed once at the
// listed per-hit power and then multiplied — matching the standard damage-calc
// convention of "assume every hit lands". Variable-hit moves use expected
// hits from the canonical Gen 5+ distribution; Skill Link / Loaded Dice
// overrides are applied at call-site inside calc().
type MultiHitKind = "fixed" | "twoToFive" | "tenStop";
const MULTI_HIT_MOVES: Record<string, { kind: MultiHitKind; hits: number }> = {
  // Always 2 hits (multiplier 2)
  "double-hit":       { kind: "fixed", hits: 2 },
  "double-kick":      { kind: "fixed", hits: 2 },
  "bonemerang":       { kind: "fixed", hits: 2 },
  "gear-grind":       { kind: "fixed", hits: 2 },
  "dual-chop":        { kind: "fixed", hits: 2 },
  "dual-wingbeat":    { kind: "fixed", hits: 2 },
  "dragon-darts":     { kind: "fixed", hits: 2 },
  "twin-beam":        { kind: "fixed", hits: 2 },
  "tachyon-cutter":   { kind: "fixed", hits: 2 },
  "double-iron-bash": { kind: "fixed", hits: 2 },
  // Always 3 hits
  "surging-strikes":  { kind: "fixed", hits: 3 },
  "triple-dive":      { kind: "fixed", hits: 3 },
  "water-shuriken":   { kind: "fixed", hits: 3 },
  // Increasing-power 3-hit moves: per-hit BP = base × (1, 2, 3) → effective ×6
  "triple-axel":      { kind: "fixed", hits: 6 }, // 三旋击 — 20 + 40 + 60 = 120
  "triple-kick":      { kind: "fixed", hits: 6 }, // 10 + 20 + 30 = 60
  // 2-5 hit distribution. Expected hits without Skill Link:
  // 35% × 2 + 35% × 3 + 15% × 4 + 15% × 5 = 3.1
  "bullet-seed":      { kind: "twoToFive", hits: 0 },
  "icicle-spear":     { kind: "twoToFive", hits: 0 },
  "pin-missile":      { kind: "twoToFive", hits: 0 },
  "rock-blast":       { kind: "twoToFive", hits: 0 },
  "bone-rush":        { kind: "twoToFive", hits: 0 },
  "scale-shot":       { kind: "twoToFive", hits: 0 },
  "tail-slap":        { kind: "twoToFive", hits: 0 },
  "fury-attack":      { kind: "twoToFive", hits: 0 },
  "arm-thrust":       { kind: "twoToFive", hits: 0 },
  "fury-swipes":      { kind: "twoToFive", hits: 0 },
  "spike-cannon":     { kind: "twoToFive", hits: 0 },
  "barrage":          { kind: "twoToFive", hits: 0 },
  "comet-punch":      { kind: "twoToFive", hits: 0 },
  "double-slap":      { kind: "twoToFive", hits: 0 },
  // 1-10 hits, 90% per-hit accuracy — Population Bomb.
  // Expected hits = Σ(k × P(k)) with stop-on-miss semantics ≈ 6.51.
  "population-bomb":  { kind: "tenStop", hits: 0 },
};

function multiHitMultiplier(slug: string, ability?: string, item?: string): number | null {
  const m = MULTI_HIT_MOVES[slug];
  if (!m) return null;
  if (m.kind === "fixed") return m.hits;
  const skillLink = ability === "skill-link";
  const loadedDice = item === "loaded-dice";
  if (m.kind === "twoToFive") {
    if (skillLink) return 5;
    if (loadedDice) return 4.5; // always 4-5
    return 3.1;
  }
  // tenStop: Population Bomb-style with 90% per-hit accuracy.
  if (skillLink) return 10;
  if (loadedDice) return 8.5; // always 4-10, biased high; pick 8.5 as the practical average
  return 6.51;
}

function isContact(slug: string): boolean { return CONTACT_MOVES.has(slug); }
function isPunch(slug: string): boolean { return PUNCH_MOVES.has(slug); }
function isBite(slug: string): boolean { return BITE_MOVES.has(slug); }
function isPulse(slug: string): boolean { return PULSE_MOVES.has(slug); }
function isSound(slug: string): boolean { return SOUND_MOVES.has(slug); }
function isSlicing(slug: string): boolean { return SLICING_MOVES.has(slug); }
function hasSecondary(slug: string): boolean { return SECONDARY_EFFECT_MOVES.has(slug); }
function isRecoil(slug: string): boolean { return RECOIL_MOVES.has(slug); }

// ─── Item → boosted type tables ──────────────────────────────────────────────
// Type-enhancing items and plates: ×1.2 to damage when the move type matches.
// Mirrors Smogon damage calc (TypeEnhancingItems). Applied as a final damage
// multiplier, not a base-power one — for our integer-floor numbers the two are
// equivalent within ±1 at typical scales.

const TYPE_BOOST_ITEMS: Record<string, PokemonType> = {
  // Type-specific items
  "silk-scarf":     "normal",
  "charcoal":       "fire",
  "mystic-water":   "water",
  "magnet":         "electric",
  "miracle-seed":   "grass",
  "never-melt-ice": "ice",
  "black-belt":     "fighting",
  "poison-barb":    "poison",
  "soft-sand":      "ground",
  "sharp-beak":     "flying",
  "twisted-spoon":  "psychic",
  "silver-powder":  "bug",
  "hard-stone":     "rock",
  "spell-tag":      "ghost",
  "dragon-fang":    "dragon",
  "black-glasses":  "dark",
  "metal-coat":     "steel",
  "fairy-feather":  "fairy",
  // Plates (Arceus + Judgment; +1.2 to held type for any user)
  "flame-plate":   "fire",
  "splash-plate":  "water",
  "zap-plate":     "electric",
  "meadow-plate":  "grass",
  "icicle-plate":  "ice",
  "fist-plate":    "fighting",
  "toxic-plate":   "poison",
  "earth-plate":   "ground",
  "sky-plate":     "flying",
  "mind-plate":    "psychic",
  "insect-plate":  "bug",
  "stone-plate":   "rock",
  "spooky-plate":  "ghost",
  "draco-plate":   "dragon",
  "dread-plate":   "dark",
  "iron-plate":    "steel",
  "pixie-plate":   "fairy",
};

/**
 * Species-locked orbs / dews / similar gear that boosts specific types by ×1.2
 * but only when the rightful holder is wielding them.
 *
 * Each entry is `{ types, holders }`: any of these types on a move, by any of
 * those species, yields ×1.2.
 */
const SPECIES_TYPE_ORBS: Array<{
  item: string;
  types: PokemonType[];
  holders: Set<string>;
}> = [
  {
    item: "adamant-orb",
    types: ["dragon", "steel"],
    holders: new Set(["dialga", "dialga-origin"]),
  },
  {
    item: "lustrous-orb",
    types: ["dragon", "water"],
    holders: new Set(["palkia", "palkia-origin"]),
  },
  {
    item: "griseous-orb",
    types: ["dragon", "ghost"],
    holders: new Set(["giratina-origin"]),
  },
  {
    item: "soul-dew",
    types: ["dragon", "psychic"],
    holders: new Set(["latios", "latias"]),
  },
];

/**
 * Doubles a base offensive stat for the rightful holder.
 * Light Ball doubles BOTH Atk and SpA for Pikachu.
 * Thick Club doubles Atk for Cubone/Marowak (incl. Alolan).
 * Deep Sea Tooth doubles SpA for Clamperl.
 */
function speciesStatItem(
  item: string | undefined,
  slug: string | undefined,
  kind: "atk" | "spa",
): number {
  if (!item || !slug) return 1;
  if (item === "light-ball" && slug === "pikachu") return 2;
  if (item === "thick-club" && (slug === "cubone" || slug === "marowak" || slug === "marowak-alola")) {
    return kind === "atk" ? 2 : 1;
  }
  if (item === "deep-sea-tooth" && slug === "clamperl") {
    return kind === "spa" ? 2 : 1;
  }
  return 1;
}

/** Defender-side Deep Sea Scale: ×2 SpD for Clamperl. */
function speciesDefenseItem(
  item: string | undefined,
  slug: string | undefined,
  kind: "def" | "spd",
): number {
  if (!item || !slug) return 1;
  if (item === "deep-sea-scale" && slug === "clamperl") {
    return kind === "spd" ? 2 : 1;
  }
  return 1;
}

// ─── Type-resist berries (defender-side, ×0.5 on SE matching-type hit) ───────
// Chilan Berry is special: always halves Normal-type damage regardless of
// effectiveness. All others trigger only when the move is super-effective.
// (Ripen ability quarters instead of halves, but Bounsweet line isn't in Reg
// M-A — skipping that case until it matters.)

const TYPE_RESIST_BERRIES: Record<string, PokemonType> = {
  "occa-berry":    "fire",
  "passho-berry":  "water",
  "wacan-berry":   "electric",
  "rindo-berry":   "grass",
  "yache-berry":   "ice",
  "chople-berry":  "fighting",
  "kebia-berry":   "poison",
  "shuca-berry":   "ground",
  "coba-berry":    "flying",
  "payapa-berry":  "psychic",
  "tanga-berry":   "bug",
  "charti-berry":  "rock",
  "kasib-berry":   "ghost",
  "haban-berry":   "dragon",
  "colbur-berry":  "dark",
  "babiri-berry":  "steel",
  "roseli-berry":  "fairy",
  "chilan-berry":  "normal", // always; not SE-gated
};

// ─── Variable-BP / stat-target move tables ───────────────────────────────────
// Stat-target overrides — the move uses a different stat than its category implies.

/** Special moves that hit the defender's *Def* (not SpD). */
const SPECIAL_USE_DEF_FOR_DEFENDER = new Set([
  "psyshock", "psystrike", "secret-sword",
]);

/** Physical move that uses the user's *Def* in place of Atk. */
const PHYS_USE_USER_DEF = new Set(["body-press"]);

/** Physical move that uses the *defender's* Atk in place of user's Atk. */
const PHYS_USE_DEFENDER_ATK = new Set(["foul-play"]);

// ─── Inputs / outputs ────────────────────────────────────────────────────────

export type CalcInput = {
  attacker: {
    /** Species slug — optional; needed only for species-specific items
     *  (Light Ball / Thick Club / Deep Sea Tooth / Adamant Orb / Soul Dew / …). */
    slug?: string;
    types: [PokemonType, PokemonType | null];
    atk: number;   // base
    spa: number;   // base
    /** Optional — needed only for Body Press (uses user's Def for offense). */
    def?: number;
    spd?: number;
    vpAtk: number;
    vpSpa: number;
    vpDef?: number;
    vpSpd?: number;
    nature: Nature;
    ability?: string;
    item?: string;
    status: Status;
    stageAtk: number; // -6..+6
    stageSpa: number;
    stageDef?: number;
    stageSpd?: number;
  };
  defender: {
    slug?: string;
    types: [PokemonType, PokemonType | null];
    hp: number;    // base
    def: number;   // base
    spd: number;   // base
    /** Optional — needed only for Foul Play (uses defender's Atk for offense). */
    atk?: number;
    spa?: number;
    vpHp: number;
    vpDef: number;
    vpSpd: number;
    vpAtk?: number;
    vpSpa?: number;
    nature: Nature;
    ability?: string;
    item?: string;
    /** Optional — needed only for Hex / Wake-Up Slap / Smelling Salts. */
    status?: Status;
    stageDef: number;
    stageSpd: number;
    stageAtk?: number;
    stageSpa?: number;
    hpPct: number;     // 1-100; affects Multiscale, hazard chip
  };
  move: {
    slug: string;
    type: PokemonType;
    category: "physical" | "special";
    power: number;
    targetShape: string; // "all-adjacent" etc.
  };
  field: {
    weather: Weather;
    terrain: Terrain;
    format: "singles" | "doubles";
    spread?: boolean;
    crit: boolean;
    helpingHand: boolean;
    screens: Screens;
    hazards: Hazards;
  };
};

export type CalcOutput = {
  rolls: number[];
  min: number;
  max: number;
  defenderMaxHp: number;
  minPct: number;
  maxPct: number;
  stab: number;
  effectiveness: number;
  hazardChipPct: number;
  /** Human-readable trace of applied modifiers */
  notes: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SPREAD_SHAPES = new Set(["all-adjacent", "spread"]);

function isGrounded(types: [PokemonType, PokemonType | null], ability?: string): boolean {
  if (types[0] === "flying" || types[1] === "flying") return false;
  if (ability === "levitate") return false;
  return true;
}

function hazardChipPct(defender: CalcInput["defender"], hazards: Hazards): number {
  let pct = 0;
  if (hazards.stealthRock) {
    const eff = effectivenessAgainst("rock", defender.types.filter((t): t is PokemonType => !!t));
    // SR damage: 12.5% × effectiveness multiplier
    pct += 12.5 * eff;
  }
  const grounded = isGrounded(defender.types, defender.ability);
  if (grounded) {
    const spikesPct = [0, 12.5, 16.6, 25][hazards.spikes];
    pct += spikesPct;
  }
  return Math.min(pct, 100);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function calc(input: CalcInput): CalcOutput | null {
  const { attacker: a, defender: d, move } = input;
  if (move.power <= 0) return null;

  // Some moves are scripted to always crit. Auto-set field.crit so the 1.5×
  // gets baked in everywhere — UI doesn't have to remember to toggle it.
  const field = ALWAYS_CRIT_MOVES.has(move.slug)
    ? { ...input.field, crit: true }
    : input.field;

  const notes: string[] = [];
  const isPhysical = move.category === "physical";

  // ── Ability/Item-based type immunities or absorption ─────────────────────
  // If defender has Water/Volt/Storm Drain/etc., the move is nullified.
  if (d.ability === "water-absorb" && move.type === "water") return zeroResult(d);
  if (d.ability === "storm-drain" && move.type === "water") return zeroResult(d);
  if (d.ability === "volt-absorb" && move.type === "electric") return zeroResult(d);
  if (d.ability === "lightning-rod" && move.type === "electric") return zeroResult(d);
  if (d.ability === "motor-drive" && move.type === "electric") return zeroResult(d);
  if (d.ability === "flash-fire" && move.type === "fire") return zeroResult(d);
  if (d.ability === "well-baked-body" && move.type === "fire") return zeroResult(d);
  if (d.ability === "sap-sipper" && move.type === "grass") return zeroResult(d);
  if (d.ability === "levitate" && move.type === "ground") return zeroResult(d);
  if (d.ability === "earth-eater" && move.type === "ground") return zeroResult(d);
  if (d.ability === "dry-skin" && move.type === "water") return zeroResult(d);

  // ── Effective stats ──────────────────────────────────────────────────────
  // Most moves use Atk/Def (physical) or SpA/SpD (special), but a handful
  // diverge:
  //   - Body Press: physical, uses *user's Def* in place of Atk.
  //   - Foul Play:  physical, uses *defender's Atk* in place of user's Atk.
  //   - Psyshock & co.: special move, but uses *defender's Def* (not SpD).
  // We keep `isPhysical` reflecting the move's *category* (so screens, STAB
  // and category-keyed item checks behave correctly) and instead override the
  // *source* of A and D below. `aStatIsAtk` tracks whether burn / Choice Band
  // / etc. should still apply (those mods touch the Atk stat specifically).

  const useUserDef = PHYS_USE_USER_DEF.has(move.slug);
  const useOppAtk = PHYS_USE_DEFENDER_ATK.has(move.slug);
  const useOppDef = SPECIAL_USE_DEF_FOR_DEFENDER.has(move.slug);

  const aStatKey: StatKey = useUserDef ? "def" : isPhysical ? "atk" : "spa";
  const dStatKey: StatKey = useOppDef ? "def" : isPhysical ? "def" : "spd";

  const aBaseStat = useUserDef
    ? (a.def ?? 1)
    : useOppAtk
    ? (d.atk ?? 1)
    : isPhysical ? a.atk : a.spa;
  const aVp = useUserDef
    ? (a.vpDef ?? 0)
    : useOppAtk
    ? (d.vpAtk ?? 0)
    : isPhysical ? a.vpAtk : a.vpSpa;
  const aNatureForOff = useOppAtk ? d.nature : a.nature;
  const aStageRaw = useUserDef
    ? (a.stageDef ?? 0)
    : useOppAtk
    ? (d.stageAtk ?? 0)
    : isPhysical ? a.stageAtk : a.stageSpa;

  const dBaseStat = useOppDef ? d.def : isPhysical ? d.def : d.spd;
  const dVp = useOppDef ? d.vpDef : isPhysical ? d.vpDef : d.vpSpd;
  const dStageRaw = useOppDef ? d.stageDef : isPhysical ? d.stageDef : d.stageSpd;

  // Burn / Choice Band only apply when the offensive stat is actually Atk.
  // Body Press uses Def (not Atk), Foul Play uses opponent's Atk — burn check
  // would need defender's status, which we don't propagate for burn on Foul
  // Play (uncommon enough to defer).
  const aStatIsAtk = aStatKey === "atk";

  const A0 = computeStat(aBaseStat, aVp, aNatureForOff, aStatKey);
  const D0 = computeStat(dBaseStat, dVp, d.nature, dStatKey);
  const HP = computeStat(d.hp, d.vpHp, d.nature, "atk", true);

  // Crit ignores adverse stat changes (and screens, and burn).
  const aStage = field.crit ? Math.max(aStageRaw, 0) : aStageRaw;
  const dStage = field.crit ? Math.min(dStageRaw, 0) : dStageRaw;
  let A = Math.floor(A0 * stageFactor(aStage));
  let D = Math.floor(D0 * stageFactor(dStage));

  // ── Atk/Def boosts from items + abilities applied to stats ───────────────
  // Choice Band/Specs boost Atk/SpA specifically — Body Press uses Def, so
  // Choice Band shouldn't multiply it; same for Foul Play (Band stays with
  // the defender who isn't wielding the move).
  if (a.item === "choice-band" && isPhysical && aStatIsAtk) {
    A = Math.floor(A * 1.5); notes.push("Choice Band ×1.5 Atk");
  }
  if (a.item === "choice-specs" && !isPhysical) {
    A = Math.floor(A * 1.5); notes.push("Choice Specs ×1.5 SpA");
  }
  if (d.item === "assault-vest" && !isPhysical) { D = Math.floor(D * 1.5); notes.push("Assault Vest ×1.5 SpD"); }
  if (d.item === "eviolite") { D = Math.floor(D * 1.5); notes.push("Eviolite ×1.5"); }

  // Species-specific stat doublers
  const offMult = speciesStatItem(a.item, a.slug, isPhysical ? "atk" : "spa");
  if (offMult > 1) { A = Math.floor(A * offMult); notes.push(`${a.item} ×${offMult} ${isPhysical ? "Atk" : "SpA"}`); }
  const defMult = speciesDefenseItem(d.item, d.slug, isPhysical ? "def" : "spd");
  if (defMult > 1) { D = Math.floor(D * defMult); notes.push(`${d.item} ×${defMult} ${isPhysical ? "Def" : "SpD"}`); }

  // Huge Power / Pure Power: ×2 Atk (Atk only — not Body Press's Def).
  if (isPhysical && aStatIsAtk && (a.ability === "huge-power" || a.ability === "pure-power")) {
    A = Math.floor(A * 2); notes.push(`${a.ability} ×2 Atk`);
  }
  // Guts: ×1.5 Atk when statused.
  if (isPhysical && aStatIsAtk && a.ability === "guts" && a.status !== "none") {
    A = Math.floor(A * 1.5); notes.push("Guts ×1.5 Atk");
  }
  // Defeatist: halves Atk + SpA below 50% HP — attacker hpPct isn't modeled;
  // skip until we add it. (Common opponent Archeops doesn't appear in Reg M-A.)

  // Hadron Engine (Miraidon): in Electric Terrain, SpA ×1.33
  if (a.ability === "hadron-engine" && field.terrain === "electric" && !isPhysical) {
    A = Math.floor(A * (5461 / 4096));
    notes.push("Hadron Engine ×1.33 SpA");
  }
  // Orichalcum Pulse (Koraidon): in Sun, Atk ×1.33
  if (a.ability === "orichalcum-pulse" && field.weather === "sun" && isPhysical) {
    A = Math.floor(A * (5461 / 4096));
    notes.push("Orichalcum Pulse ×1.33 Atk");
  }
  // Solar Power: SpA ×1.5 in sun
  if (a.ability === "solar-power" && field.weather === "sun" && !isPhysical) {
    A = Math.floor(A * 1.5);
    notes.push("Solar Power ×1.5 SpA");
  }
  // Sand-boosted SpD on Rock-types
  if (field.weather === "sand" && (d.types[0] === "rock" || d.types[1] === "rock") && !isPhysical) {
    D = Math.floor(D * 1.5);
    notes.push("Sand ×1.5 SpD on Rock");
  }
  // Snow-boosted Def on Ice-types
  if (field.weather === "snow" && (d.types[0] === "ice" || d.types[1] === "ice") && isPhysical) {
    D = Math.floor(D * 1.5);
    notes.push("Snow ×1.5 Def on Ice");
  }

  // ── Type tweaks via attacker abilities (e.g. Refrigerate makes Normal→Ice) ─
  let moveType: PokemonType = move.type;
  let basePower = move.power;
  const aetherKind: Record<string, PokemonType> = {
    "refrigerate": "ice", "pixilate": "fairy", "galvanize": "electric",
    "aerilate": "flying", "normalize": "normal",
  };
  if (a.ability && aetherKind[a.ability] && move.type === "normal") {
    moveType = aetherKind[a.ability];
    basePower = Math.floor(basePower * 1.2);
    notes.push(`${a.ability} → ${moveType} & ×1.2`);
  }

  // ── Variable base-power moves ────────────────────────────────────────────
  // Slug-keyed BP overrides that depend on attacker/defender state.
  if (move.slug === "knock-off" && d.item) {
    basePower = Math.floor(basePower * 1.5);
    notes.push("Knock Off ×1.5 (defender has item)");
  }
  if (move.slug === "acrobatics" && !a.item) {
    basePower = basePower * 2;
    notes.push("Acrobatics ×2 (no item)");
  }
  if (move.slug === "facade" && a.status !== "none") {
    basePower = basePower * 2;
    notes.push("Facade ×2 (statused)");
  }
  if (move.slug === "hex" && d.status && d.status !== "none") {
    basePower = basePower * 2;
    notes.push("Hex ×2 (defender statused)");
  }
  if (move.slug === "wake-up-slap" && d.status === "sleep") {
    basePower = basePower * 2;
    notes.push("Wake-Up Slap ×2 (asleep)");
  }
  if (move.slug === "smelling-salts" && d.status === "paralysis") {
    basePower = basePower * 2;
    notes.push("Smelling Salts ×2 (paralyzed)");
  }
  // Weather Ball — 50 BP, doubles + retypes under weather.
  if (move.slug === "weather-ball") {
    if (field.weather === "sun") { basePower = 100; moveType = "fire"; notes.push("Weather Ball → Fire, 100 BP"); }
    else if (field.weather === "rain") { basePower = 100; moveType = "water"; notes.push("Weather Ball → Water, 100 BP"); }
    else if (field.weather === "sand") { basePower = 100; moveType = "rock"; notes.push("Weather Ball → Rock, 100 BP"); }
    else if (field.weather === "snow") { basePower = 100; moveType = "ice"; notes.push("Weather Ball → Ice, 100 BP"); }
  }

  // ── Base damage ──────────────────────────────────────────────────────────
  // ((2L/5 + 2) × power × A / D) / 50 + 2
  let dmg = Math.floor((Math.floor(((2 * LEVEL) / 5 + 2) * basePower * A) / D) / 50) + 2;

  // ── Modifier chain (Gen 6+ multiplier-aware order) ───────────────────────
  // Spread (doubles, multi-target)
  const isSpread =
    field.spread ??
    (field.format === "doubles" && SPREAD_SHAPES.has(move.targetShape));
  if (isSpread) { dmg = Math.floor(dmg * 0.75); notes.push("Spread ×0.75"); }

  // Helping Hand
  if (field.helpingHand) { dmg = Math.floor(dmg * 1.5); notes.push("Helping Hand ×1.5"); }

  // Weather move boosts
  if (field.weather === "sun") {
    if (moveType === "fire") { dmg = Math.floor(dmg * 1.5); notes.push("Sun ×1.5 Fire"); }
    else if (moveType === "water") { dmg = Math.floor(dmg * 0.5); notes.push("Sun ×0.5 Water"); }
  } else if (field.weather === "rain") {
    if (moveType === "water") { dmg = Math.floor(dmg * 1.5); notes.push("Rain ×1.5 Water"); }
    else if (moveType === "fire") { dmg = Math.floor(dmg * 0.5); notes.push("Rain ×0.5 Fire"); }
  }

  // Terrain (must be grounded for grounded-only effects)
  const defenderGrounded = isGrounded(d.types, d.ability);
  const attackerGrounded = isGrounded(a.types, a.ability);
  if (field.terrain === "electric" && attackerGrounded && moveType === "electric") {
    dmg = Math.floor(dmg * 1.3); notes.push("Electric Terrain ×1.3");
  }
  if (field.terrain === "grassy" && attackerGrounded && moveType === "grass") {
    dmg = Math.floor(dmg * 1.3); notes.push("Grassy Terrain ×1.3");
  }
  if (field.terrain === "psychic" && attackerGrounded && moveType === "psychic") {
    dmg = Math.floor(dmg * 1.3); notes.push("Psychic Terrain ×1.3");
  }
  if (field.terrain === "misty" && defenderGrounded && moveType === "dragon") {
    dmg = Math.floor(dmg * 0.5); notes.push("Misty Terrain ×0.5 Dragon");
  }
  // Grassy Terrain halves Earthquake/Bulldoze/Magnitude vs grounded
  if (field.terrain === "grassy" && defenderGrounded &&
      (move.slug === "earthquake" || move.slug === "bulldoze" || move.slug === "magnitude")) {
    dmg = Math.floor(dmg * 0.5); notes.push("Grassy Terrain ×0.5 ground");
  }

  // Screens (defender side) — ignored by crits, in doubles ×2/3 not ×0.5
  if (!field.crit) {
    const screen = isPhysical
      ? field.screens.reflect || field.screens.auroraVeil
      : field.screens.lightScreen || field.screens.auroraVeil;
    if (screen) {
      const mult = field.format === "doubles" ? 2 / 3 : 0.5;
      dmg = Math.floor(dmg * mult);
      notes.push(`Screens ×${mult.toFixed(2)}`);
    }
  }

  // Crit
  if (field.crit) { dmg = Math.floor(dmg * 1.5); notes.push("Crit ×1.5"); }

  // Attacker ability boosts on move type / kind
  if (a.ability === "tough-claws" && isContact(move.slug)) {
    dmg = Math.floor(dmg * 1.3); notes.push("Tough Claws ×1.3");
  }
  if (a.ability === "strong-jaw" && isBite(move.slug)) {
    dmg = Math.floor(dmg * 1.5); notes.push("Strong Jaw ×1.5");
  }
  if (a.ability === "mega-launcher" && isPulse(move.slug)) {
    dmg = Math.floor(dmg * 1.5); notes.push("Mega Launcher ×1.5");
  }
  if (a.ability === "iron-fist" && isPunch(move.slug)) {
    dmg = Math.floor(dmg * 1.2); notes.push("Iron Fist ×1.2");
  }
  if (a.ability === "sharpness" && isSlicing(move.slug)) {
    dmg = Math.floor(dmg * 1.5); notes.push("Sharpness ×1.5");
  }
  if (a.ability === "punk-rock" && isSound(move.slug)) {
    dmg = Math.floor(dmg * 1.3); notes.push("Punk Rock atk ×1.3");
  }
  if (a.ability === "sheer-force" && hasSecondary(move.slug)) {
    dmg = Math.floor(dmg * 1.3); notes.push("Sheer Force ×1.3");
  }
  if (a.ability === "technician" && basePower <= 60) {
    dmg = Math.floor(dmg * 1.5); notes.push("Technician ×1.5");
  }
  if (a.ability === "transistor" && moveType === "electric") {
    dmg = Math.floor(dmg * 1.3); notes.push("Transistor ×1.3");
  }
  if (a.ability === "dragons-maw" && moveType === "dragon") {
    dmg = Math.floor(dmg * 1.5); notes.push("Dragon's Maw ×1.5");
  }
  if (a.ability === "steely-spirit" && moveType === "steel") {
    dmg = Math.floor(dmg * 1.5); notes.push("Steely Spirit ×1.5");
  }
  if (a.ability === "sand-force" && field.weather === "sand"
      && (moveType === "rock" || moveType === "ground" || moveType === "steel")) {
    dmg = Math.floor(dmg * 1.3); notes.push("Sand Force ×1.3");
  }
  if (a.ability === "reckless" && isRecoil(move.slug)) {
    dmg = Math.floor(dmg * 1.2); notes.push("Reckless ×1.2");
  }

  // Defender ability damping
  if (d.ability === "punk-rock" && isSound(move.slug)) {
    dmg = Math.floor(dmg * 0.5); notes.push("Punk Rock def ×0.5");
  }
  if (d.ability === "ice-scales" && !isPhysical) {
    dmg = Math.floor(dmg * 0.5); notes.push("Ice Scales ×0.5");
  }
  if (d.ability === "fluffy") {
    if (isContact(move.slug)) { dmg = Math.floor(dmg * 0.5); notes.push("Fluffy contact ×0.5"); }
    if (moveType === "fire")  { dmg = Math.floor(dmg * 2);   notes.push("Fluffy fire ×2"); }
  }
  if (d.ability === "heatproof" && moveType === "fire") {
    dmg = Math.floor(dmg * 0.5); notes.push("Heatproof ×0.5");
  }
  if (d.ability === "water-bubble" && moveType === "fire") {
    dmg = Math.floor(dmg * 0.5); notes.push("Water Bubble ×0.5");
  }
  if (d.ability === "thick-fat" && (moveType === "fire" || moveType === "ice")) {
    dmg = Math.floor(dmg * 0.5); notes.push("Thick Fat ×0.5");
  }
  if (d.ability === "purifying-salt" && moveType === "ghost") {
    dmg = Math.floor(dmg * 0.5); notes.push("Purifying Salt ×0.5");
  }
  if (d.ability === "dry-skin" && moveType === "fire") {
    dmg = Math.floor(dmg * 1.25); notes.push("Dry Skin ×1.25");
  }
  if (d.ability === "multiscale" && d.hpPct >= 99.5) {
    dmg = Math.floor(dmg * 0.5); notes.push("Multiscale ×0.5");
  }

  // Item boosts that apply AFTER base modifiers
  if (a.item === "life-orb")     { dmg = Math.floor(dmg * 1.3); notes.push("Life Orb ×1.3"); }
  if (a.item === "muscle-band" && isPhysical) {
    dmg = Math.floor(dmg * 1.1); notes.push("Muscle Band ×1.1");
  }
  if (a.item === "wise-glasses" && !isPhysical) {
    dmg = Math.floor(dmg * 1.1); notes.push("Wise Glasses ×1.1");
  }
  // Type-enhancing items + plates: ×1.2 when the move type matches.
  if (a.item && TYPE_BOOST_ITEMS[a.item] === moveType) {
    dmg = Math.floor(dmg * 1.2);
    notes.push(`${a.item} ×1.2 ${moveType}`);
  }
  // Species-locked orbs / Soul Dew: ×1.2 on matching type for matching species.
  if (a.item && a.slug) {
    for (const orb of SPECIES_TYPE_ORBS) {
      if (orb.item === a.item && orb.holders.has(a.slug) && orb.types.includes(moveType)) {
        dmg = Math.floor(dmg * 1.2);
        notes.push(`${a.item} ×1.2 ${moveType}`);
        break;
      }
    }
  }
  // Punching Glove: ×1.1 to punching moves (and removes contact, which we
  // don't otherwise model side-effects of, so it's pure damage here).
  if (a.item === "punching-glove" && isPunch(move.slug)) {
    dmg = Math.floor(dmg * 1.1);
    notes.push("Punching Glove ×1.1");
  }

  // STAB
  let stab = 1;
  if (a.types.includes(moveType)) {
    stab = a.ability === "adaptability" ? 2 : 1.5;
    dmg = Math.floor(dmg * stab);
    if (a.ability === "adaptability") notes.push("Adaptability STAB ×2");
    else notes.push("STAB ×1.5");
  }

  // Type effectiveness
  const defTypes = d.types.filter((t): t is PokemonType => !!t);
  let eff = effectivenessAgainst(moveType, defTypes);

  // Wonder Guard: only super-effective hits land.
  if (d.ability === "wonder-guard" && eff <= 1) return zeroResult(d, notes.concat("Wonder Guard"));

  // Filter / Solid Rock / Prism Armor: SE hits ×0.75
  if (eff > 1 && (d.ability === "filter" || d.ability === "solid-rock" || d.ability === "prism-armor")) {
    eff *= 0.75;
    notes.push(`${d.ability} ×0.75 SE`);
  }
  // Tinted Lens: NVE hits ×2
  if (eff > 0 && eff < 1 && a.ability === "tinted-lens") {
    eff *= 2;
    notes.push("Tinted Lens ×2 NVE");
  }
  if (eff === 0) return zeroResult(d, notes.concat("Immune"));
  dmg = Math.floor(dmg * eff);

  // Type-resist berries — defender-side ×0.5 on matching type. Chilan halves
  // any Normal-type hit; the rest only halve super-effective hits.
  if (d.item && TYPE_RESIST_BERRIES[d.item] === moveType) {
    const isChilan = d.item === "chilan-berry";
    if (isChilan || eff > 1) {
      dmg = Math.floor(dmg * 0.5);
      notes.push(`${d.item} ×0.5 ${moveType}`);
    }
  }

  // Expert Belt — SE only
  if (a.item === "expert-belt" && eff > 1) {
    dmg = Math.floor(dmg * 1.2); notes.push("Expert Belt ×1.2 SE");
  }

  // Burn halves physical Atk-based damage. Body Press uses Def, so burn
  // doesn't apply. Facade is unaffected by burn (handled in BP boost below).
  // Guts ignores the burn drop.
  if (isPhysical && aStatIsAtk && a.status === "burn" && a.ability !== "guts" && move.slug !== "facade") {
    dmg = Math.floor(dmg * 0.5); notes.push("Burn ×0.5");
  }

  // ── Multi-hit moves ──────────────────────────────────────────────────────
  // Apply the move's effective hit count (Triple Axel 1+2+3 = 6×, fixed-hit
  // multi-attacks, and probability-weighted hits for 2-5 / 1-10 moves with
  // Skill Link / Loaded Dice overrides).
  const multiHit = multiHitMultiplier(move.slug, a.ability, a.item);
  if (multiHit !== null) {
    dmg = Math.floor(dmg * multiHit);
    notes.push(`Multi-hit ×${multiHit % 1 === 0 ? multiHit : multiHit.toFixed(2)} (${move.slug})`);
  }

  // ── 16-roll variance ─────────────────────────────────────────────────────
  const rolls: number[] = [];
  for (let r = 85; r <= 100; r++) rolls.push(Math.floor((dmg * r) / 100));
  const min = rolls[0];
  const max = rolls[rolls.length - 1];

  // Hazard chip (informational — affects "is OHKO?" mentally, doesn't enter the formula)
  const hazardPct = hazardChipPct(d, field.hazards);

  return {
    rolls,
    min, max,
    defenderMaxHp: HP,
    minPct: +((100 * min) / HP).toFixed(1),
    maxPct: +((100 * max) / HP).toFixed(1),
    stab,
    effectiveness: eff,
    hazardChipPct: +hazardPct.toFixed(1),
    notes,
  };
}

function zeroResult(d: CalcInput["defender"], notes: string[] = []): CalcOutput {
  const HP = computeStat(d.hp, d.vpHp, d.nature, "atk", true);
  return {
    rolls: Array(16).fill(0),
    min: 0, max: 0,
    defenderMaxHp: HP,
    minPct: 0, maxPct: 0,
    stab: 1,
    effectiveness: 0,
    hazardChipPct: 0,
    notes,
  };
}
