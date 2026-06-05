/**
 * Bulk import from PokeAPI's CSV data dump.
 *
 * Source: https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
 * Files live in `data/pokeapi/*.csv` (gitignored; re-fetch with the bash recipe in README).
 *
 * Strategy:
 *   - Replace all Pokemon/Move/Ability/Item rows with PokeAPI data.
 *   - For each row, build a `nameI18n` JSON map for en / ja / zh-Hans / zh-Hant.
 *   - For Moves: latest version_group flavor text per locale as `effectI18n`.
 *   - Same for Abilities (`shortDescI18n`) and Items (`descI18n`).
 *   - Skip non-default Pokémon forms in v1 to keep the import scope manageable.
 *
 * Locale → language_id mapping in PokeAPI:
 *   en = 9,  ja-hrkt = 1,  ja = 11,  zh-Hant = 4,  zh-Hans = 12
 *   We prefer ja (11) over ja-hrkt (1), but fall back if missing.
 *
 * Run: `npm run db:import`
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { ABILITY_OVERRIDES } from "./ability-overrides";
import { ITEM_OVERRIDES } from "./item-overrides";
import { MOVE_OVERRIDES } from "./move-overrides";

const DATA = path.join(__dirname, "../data/pokeapi");
const prisma = new PrismaClient();

// ─── Language config ─────────────────────────────────────────────────────────

type Locale = "en" | "ja" | "zh-Hans" | "zh-Hant";
const LANG_IDS: Record<Locale, number[]> = {
  en: [9],
  ja: [11, 1], // prefer kanji form, fall back to hrkt
  "zh-Hans": [12],
  "zh-Hant": [4],
};

const SPRITE = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function readCsv<T extends Record<string, string>>(name: string): T[] {
  const file = fs.readFileSync(path.join(DATA, name));
  return parse(file, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as T[];
}

function num(s: string | undefined): number {
  return s ? parseInt(s, 10) : 0;
}
function maybeNum(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// Build {entityId → {locale → name}}. `entityIdField` is the column name in nameRows
// that points at the entity (e.g. "pokemon_species_id" / "move_id").
function buildNameI18n<T extends Record<string, string>>(
  nameRows: T[],
  entityIdField: string,
  nameField: string,
): Map<number, Record<Locale, string>> {
  const out = new Map<number, Record<Locale, string>>();
  for (const row of nameRows) {
    const eid = num(row[entityIdField]);
    const lid = num(row.local_language_id);
    const name = row[nameField];
    if (!eid || !lid || !name) continue;

    for (const [loc, ids] of Object.entries(LANG_IDS) as Array<[Locale, number[]]>) {
      const priority = ids.indexOf(lid);
      if (priority === -1) continue;
      let bucket = out.get(eid);
      if (!bucket) {
        bucket = { en: "", ja: "", "zh-Hans": "", "zh-Hant": "" } as Record<Locale, string>;
        out.set(eid, bucket);
      }
      // First-wins per priority order, so once en or ja[0] is set, ja[1] won't overwrite
      if (!bucket[loc]) bucket[loc] = name;
    }
  }
  return out;
}

// Detect placeholder flavor text that PokeAPI ships when a move/ability/item
// was dropped from a later game. PokeAPI keeps a row but uses fixed dummy text
// ("This move can't be used.", ダミーデータ, etc). Picking the highest vg would
// land on these placeholders for ~16% of moves — skip them so the algorithm
// falls back to the last real flavor available.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^this move can[’']t be used/i,
  /^this move cannot be used/i,
  /^cannot be used/i,
  /^ダミーデータ/,
  /^この技は\s*使えません/,
  /^このわざは\s*つかえません/,
  /^无法使用这个招式/,
  /^無法使用此招式/,
  /^무효한\s*기술/,
  /^cette capacité ne peut pas être utilisée/i,
];
function isPlaceholderFlavor(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

// Latest flavor text per (entity, locale). `entityIdField`: column name pointing at entity.
function buildFlavorI18n<T extends Record<string, string>>(
  rows: T[],
  entityIdField: string,
  textField = "flavor_text",
): Map<number, Record<Locale, string>> {
  // Pick row with highest version_group_id per (entity, language).
  // Note: flavor_text CSVs use `language_id` (no `local_` prefix), unlike the
  // `*_names.csv` files which use `local_language_id`. Handle both.
  const best = new Map<string, { vg: number; text: string }>();
  for (const r of rows) {
    const eid = num(r[entityIdField]);
    const lid = num(r.language_id) || num(r.local_language_id);
    const vg = num(r.version_group_id);
    const text = (r[textField] ?? "").replace(/[\n\r­​]+/g, " ").trim();
    if (!eid || !lid || !text) continue;
    if (isPlaceholderFlavor(text)) continue;
    const key = `${eid}|${lid}`;
    const prev = best.get(key);
    if (!prev || vg > prev.vg) best.set(key, { vg, text });
  }
  // Re-bucket into entity → locale → text
  const out = new Map<number, Record<Locale, string>>();
  for (const [key, { text }] of best) {
    const [eidStr, lidStr] = key.split("|");
    const eid = parseInt(eidStr, 10);
    const lid = parseInt(lidStr, 10);
    for (const [loc, ids] of Object.entries(LANG_IDS) as Array<[Locale, number[]]>) {
      if (!ids.includes(lid)) continue;
      let bucket = out.get(eid);
      if (!bucket) {
        bucket = { en: "", ja: "", "zh-Hans": "", "zh-Hant": "" } as Record<Locale, string>;
        out.set(eid, bucket);
      }
      // Higher-priority language id wins (the buildFlavorI18n sort above ensures
      // we keep latest version, but for ja we want id=11 > id=1)
      if (!bucket[loc] || ids.indexOf(lid) === 0) {
        bucket[loc] = text;
      }
    }
  }
  return out;
}

// Take a Record<Locale,string>, prune empties, JSON-stringify
function i18nJson(m: Record<Locale, string> | undefined): string {
  if (!m) return "{}";
  const out: Partial<Record<Locale, string>> = {};
  for (const [k, v] of Object.entries(m)) if (v) out[k as Locale] = v;
  return JSON.stringify(out);
}

function mergeI18n(
  base: Record<Locale, string> | undefined,
  override: Partial<Record<Locale, string>> | undefined,
): Record<Locale, string> {
  const out = {
    en: base?.en || "",
    ja: base?.ja || "",
    "zh-Hans": base?.["zh-Hans"] || "",
    "zh-Hant": base?.["zh-Hant"] || "",
  };
  if (!override) return out;
  for (const loc of ["en", "ja", "zh-Hans", "zh-Hant"] as Locale[]) {
    if (!out[loc] && override[loc]) out[loc] = override[loc];
  }
  return out;
}

// Same as mergeI18n but the override wins outright when set — used for names,
// where PokeAPI sometimes ships wrong-script text in the zh-Hant slot for Gen
// 9 moves (e.g. "晶光转转" — simplified chars in the traditional column). The
// hand-curated override is treated as authoritative.
function forceI18n(
  base: Record<Locale, string> | undefined,
  override: Partial<Record<Locale, string>> | undefined,
): Record<Locale, string> {
  const out = {
    en: base?.en || "",
    ja: base?.ja || "",
    "zh-Hans": base?.["zh-Hans"] || "",
    "zh-Hant": base?.["zh-Hant"] || "",
  };
  if (!override) return out;
  for (const loc of ["en", "ja", "zh-Hans", "zh-Hant"] as Locale[]) {
    if (override[loc]) out[loc] = override[loc]!;
  }
  return out;
}

// ─── Smogon usage stats overlay ──────────────────────────────────────────────

// Pokémon Champions chaos dumps from Smogon. We pull both formats because
// usage skews very differently between singles and doubles — players want
// to see the right stats for whichever format they're building for.
//   • VGC = official Pokémon Champions doubles (Regulation M-A)
//   • BSS = official Pokémon Champions singles (Regulation M-A)
// In each list we prefer the all-ladder (0) dump for the broadest roster /
// move / item coverage and fall back to higher cutoffs if the broader file
// isn't on disk yet.
const SMOGON_FILES_DOUBLES = [
  "smogon-championsvgc2026regma-0.json",
  "smogon-championsvgc2026regma-1500.json",
  "smogon-championsvgc2026regma-1760.json",
];
const SMOGON_FILES_SINGLES = [
  "smogon-championsbssregma-0.json",
  "smogon-championsbssregma-1500.json",
  "smogon-championsbssregma-1760.json",
];
const TOP_MOVE_COUNT = 16;
const TOP_ITEM_COUNT = 10;
const TOP_SPREAD_COUNT = 10;

type SmogonEntry = {
  "Raw count": number;
  Abilities: Record<string, number>;
  Items: Record<string, number>;
  Moves: Record<string, number>;
  Spreads: Record<string, number>;
  usage?: number;
};
type SmogonDump = { info: Record<string, unknown>; data: Record<string, SmogonEntry> };

// Smogon names use concatenated lowercase ("fakeout"), PokeAPI uses dashes
// ("fake-out"). Strip dashes from PokeAPI slugs to build a reverse index.
function condense(slug: string): string {
  return slug.replace(/-/g, "").toLowerCase();
}

// Normalize a Smogon Pokémon key to our slug.
// Examples: "Incineroar" → "incineroar", "Calyrex-Shadow" → "calyrex-shadow",
// "Indeedee-F" → "indeedee-female", "Iron Hands" → "iron-hands".
const SMOGON_NAME_FIXUPS: Record<string, string> = {
  "aegislash": "aegislash-shield",
  "basculegion": "basculegion-male",
  "indeedee-f": "indeedee-female",
  "indeedee-m": "indeedee-male",
  "basculegion-f": "basculegion-female",
  "lycanroc": "lycanroc-midday",
  "maushold": "maushold-family-of-four",
  "meowstic": "meowstic-male",
  "meowstic-f": "meowstic-female",
  "meowstic-f-mega": "meowstic-mega",
  "meowstic-m-mega": "meowstic-mega",
  "mimikyu": "mimikyu-disguised",
  "morpeko": "morpeko-full-belly",
  "oinkologne-f": "oinkologne-female",
  "palafin": "palafin-zero",
  "tauros-paldea-aqua": "tauros-paldea-aqua-breed",
  "tauros-paldea-blaze": "tauros-paldea-blaze-breed",
};
function smogonNameToSlug(smogonName: string, knownSlugs: Set<string>): string | null {
  const lower = smogonName.toLowerCase().replace(/\./g, "").replace(/\s+/g, "-");
  if (knownSlugs.has(lower)) return lower;
  if (SMOGON_NAME_FIXUPS[lower] && knownSlugs.has(SMOGON_NAME_FIXUPS[lower])) {
    return SMOGON_NAME_FIXUPS[lower];
  }
  // Fall back to species-only match (e.g. "Tornadus" → "tornadus-incarnate" doesn't
  // work; Smogon already disambiguates therian/origin where it matters, so default
  // forms map to the species slug).
  return null;
}

function smogonUsageRatio(entry: SmogonEntry, totalBattles: number): number {
  if (typeof entry.usage === "number" && Number.isFinite(entry.usage)) {
    return entry.usage;
  }
  const raw = entry["Raw count"] ?? 0;
  return totalBattles > 0 ? raw / totalBattles : 0;
}

function mergeNumberRecords(target: Record<string, number>, source: Record<string, number> | undefined) {
  for (const [k, v] of Object.entries(source ?? {})) {
    target[k] = (target[k] ?? 0) + v;
  }
}

function addWeightedUsage(
  out: Map<string, number>,
  raw: Record<string, number>,
  monUsageRatio: number,
  mapKey: (k: string) => string | null,
  kind: "single" | "moves",
) {
  const entries = Object.entries(raw);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0 || monUsageRatio <= 0) return;
  const denom = kind === "moves" ? total / 4 : total;
  if (denom <= 0) return;

  for (const [k, v] of entries) {
    const slug = mapKey(k);
    if (!slug) continue;
    const perMonRatio = Math.min(1, v / denom);
    out.set(slug, (out.get(slug) ?? 0) + monUsageRatio * perMonRatio);
  }
}

function normalizeWeightedUsage(weightBySlug: Map<string, number>, denominator: number): Map<string, number> {
  const out = new Map<string, number>();
  if (denominator <= 0) return out;
  for (const [slug, weight] of weightBySlug) {
    out.set(slug, +((weight / denominator) * 100).toFixed(6));
  }
  return out;
}

function smogonItemToSyntheticSlug(itemName: string): string {
  return itemName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Smogon's chaos JSON uses weighted occurrence counts, NOT percentages. Normalize:
// - Abilities / Items / Spreads each have one entry per Pokémon, so divide by sum-of-category.
// - Moves average ~4 per Pokémon (when known), so divide by sum/4 — yields per-mon %.
function topN<T extends string>(
  raw: Record<T, number>,
  n: number,
  mapKey: (k: T) => string | null,
  kind: "single" | "moves",
): Array<{ slug: string; pct: number }> {
  const entries = Object.entries(raw) as Array<[T, number]>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];
  const denom = kind === "moves" ? total / 4 : total;
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, n * 2)
    .flatMap(([k, v]) => {
      const slug = mapKey(k);
      if (!slug) return [];
      return [{ slug, pct: Math.min(100, +((v / denom) * 100).toFixed(1)) }];
    })
    .slice(0, n);
}

function parseSpread(key: string): { nature: string; vp: [number, number, number, number, number, number] } | null {
  // "Adamant:2/32/0/0/0/32"
  const [nature, evs] = key.split(":");
  if (!nature || !evs) return null;
  const parts = evs.split("/").map((s) => parseInt(s, 10));
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null;
  return { nature, vp: parts as [number, number, number, number, number, number] };
}

// ─── Static overlay: competitive top-20 usage rank & % ───────────────────────

const COMPETITIVE_OVERLAY: Array<{ slug: string; rank: number; usagePct: number }> = [
  { slug: "sneasler",   rank: 1,  usagePct: 43.80 },
  { slug: "incineroar", rank: 2,  usagePct: 62.40 },
  { slug: "garchomp",   rank: 3,  usagePct: 38.10 },
  { slug: "kingambit",  rank: 4,  usagePct: 35.70 },
  { slug: "basculegion", rank: 5, usagePct: 29.40 },
  { slug: "landorus",   rank: 6,  usagePct: 28.20 },
  { slug: "luxray",     rank: 7,  usagePct: 18.30 },
  { slug: "goodra",     rank: 8,  usagePct: 16.90 },
  { slug: "espeon",     rank: 9,  usagePct: 15.60 },
  { slug: "haxorus",    rank: 10, usagePct: 14.20 },
  { slug: "metagross",  rank: 11, usagePct: 13.50 },
  { slug: "tyranitar",  rank: 12, usagePct: 12.80 },
  { slug: "gardevoir",  rank: 13, usagePct: 12.10 },
  { slug: "jellicent",  rank: 14, usagePct: 11.40 },
  { slug: "excadrill",  rank: 15, usagePct: 10.90 },
  { slug: "entei",      rank: 16, usagePct:  9.60 },
  { slug: "regieleki",  rank: 17, usagePct:  9.10 },
  { slug: "charizard",  rank: 18, usagePct:  8.50 },
  { slug: "blastoise",  rank: 19, usagePct:  6.20 },
  { slug: "venusaur",   rank: 20, usagePct:  5.80 },
];

const TYPE_ID_TO_SLUG: Record<number, string> = {
  1: "normal", 2: "fighting", 3: "flying", 4: "poison", 5: "ground",
  6: "rock", 7: "bug", 8: "ghost", 9: "steel", 10: "fire",
  11: "water", 12: "grass", 13: "electric", 14: "psychic", 15: "ice",
  16: "dragon", 17: "dark", 18: "fairy", 19: "stellar",
};

const DAMAGE_CLASS_ID_TO_SLUG: Record<number, string> = {
  1: "status",
  2: "physical",
  3: "special",
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Importing PokeAPI dump…");

  // POKEMON ───────────────────────────────────────────────────────────────────
  const pokemonRows = readCsv<{
    id: string; identifier: string; species_id: string; is_default: string;
    height: string; weight: string;
  }>("pokemon.csv");
  const speciesNameRows = readCsv<Record<string, string>>("pokemon_species_names.csv");
  const statRows = readCsv<{ pokemon_id: string; stat_id: string; base_stat: string }>("pokemon_stats.csv");
  const typeRows = readCsv<{ pokemon_id: string; type_id: string; slot: string }>("pokemon_types.csv");
  const abilityRows = readCsv<{ pokemon_id: string; ability_id: string; slot: string; is_hidden: string }>("pokemon_abilities.csv");
  const abilitiesMeta = readCsv<{ id: string; identifier: string }>("abilities.csv");
  const formRows = readCsv<{
    id: string; identifier: string; form_identifier: string;
    pokemon_id: string; is_default: string; is_battle_only: string; is_mega: string;
  }>("pokemon_forms.csv");
  const formNameRows = readCsv<Record<string, string>>("pokemon_form_names.csv");
  const pokemonMoveRows = readCsv<{
    pokemon_id: string; version_group_id: string; move_id: string;
    pokemon_move_method_id: string;
  }>("pokemon_moves.csv");
  const moveRowsRaw = readCsv<{ id: string; identifier: string }>("moves.csv");

  const speciesNames = buildNameI18n(speciesNameRows, "pokemon_species_id", "name");
  const abilityIdToSlug = new Map(abilitiesMeta.map((a) => [num(a.id), a.identifier]));
  const moveIdToSlug = new Map(moveRowsRaw.map((m) => [num(m.id), m.identifier]));

  // Map pokemon.id (PokeAPI) → pokemon_form.id (the form's localized-name lookup key).
  const pokemonIdToFormId = new Map<number, number>();
  for (const f of formRows) {
    const pid = num(f.pokemon_id);
    if (!pokemonIdToFormId.has(pid)) pokemonIdToFormId.set(pid, num(f.id));
  }

  // Per-form localized name pieces, keyed by pokemon_form_id.
  type FormI18n = { formName: Record<Locale, string>; pokemonName: Record<Locale, string> };
  const formI18nByFormId = new Map<number, FormI18n>();
  for (const r of formNameRows) {
    const formId = num(r.pokemon_form_id);
    const lid = num(r.local_language_id);
    if (!formId || !lid) continue;
    let bucket = formI18nByFormId.get(formId);
    if (!bucket) {
      bucket = {
        formName: { en: "", ja: "", "zh-Hans": "", "zh-Hant": "" } as Record<Locale, string>,
        pokemonName: { en: "", ja: "", "zh-Hans": "", "zh-Hant": "" } as Record<Locale, string>,
      };
      formI18nByFormId.set(formId, bucket);
    }
    for (const [loc, ids] of Object.entries(LANG_IDS) as Array<[Locale, number[]]>) {
      if (!ids.includes(lid)) continue;
      if (!bucket.formName[loc] && r.form_name) bucket.formName[loc] = r.form_name;
      if (!bucket.pokemonName[loc] && r.pokemon_name) bucket.pokemonName[loc] = r.pokemon_name;
    }
  }

  // Learnsets: dedupe (pokemon_id, move_id) across version groups and methods.
  const learnsetByPokemonId = new Map<number, Set<string>>();
  for (const r of pokemonMoveRows) {
    const pid = num(r.pokemon_id);
    const moveSlug = moveIdToSlug.get(num(r.move_id));
    if (!pid || !moveSlug) continue;
    let bucket = learnsetByPokemonId.get(pid);
    if (!bucket) { bucket = new Set(); learnsetByPokemonId.set(pid, bucket); }
    bucket.add(moveSlug);
  }

  // Index stats/types/abilities by pokemon_id
  const statsByMon = new Map<number, Record<number, number>>(); // monId → statId → value
  for (const r of statRows) {
    const id = num(r.pokemon_id);
    let bucket = statsByMon.get(id);
    if (!bucket) { bucket = {}; statsByMon.set(id, bucket); }
    bucket[num(r.stat_id)] = num(r.base_stat);
  }
  const typesByMon = new Map<number, { slot1?: string; slot2?: string }>();
  for (const r of typeRows) {
    const id = num(r.pokemon_id);
    const ts = TYPE_ID_TO_SLUG[num(r.type_id)];
    const slot = num(r.slot);
    let bucket = typesByMon.get(id);
    if (!bucket) { bucket = {}; typesByMon.set(id, bucket); }
    if (slot === 1) bucket.slot1 = ts;
    else if (slot === 2) bucket.slot2 = ts;
  }
  const abilitiesByMon = new Map<number, { normal: string[]; hidden: string | null }>();
  for (const r of abilityRows) {
    const id = num(r.pokemon_id);
    const aSlug = abilityIdToSlug.get(num(r.ability_id));
    if (!aSlug) continue;
    let bucket = abilitiesByMon.get(id);
    if (!bucket) { bucket = { normal: [], hidden: null }; abilitiesByMon.set(id, bucket); }
    if (r.is_hidden === "1") bucket.hidden = aSlug;
    else bucket.normal.push(aSlug);
  }

  const overlayBySpecies = new Map<string, { rank: number; usagePct: number }>(
    COMPETITIVE_OVERLAY.map((o) => [o.slug, o]),
  );

  // ─── Smogon usage stats ─────────────────────────────────────────────────────
  // Build the condense-lookup maps once (file-independent); we'll mutate the
  // item-slug map as both files are scanned so synthetic items from either
  // format get a slug.
  const moveSlugByCondensed = new Map<string, string>(
    moveRowsRaw.map((m) => [condense(m.identifier), m.identifier]),
  );
  const abilitySlugByCondensed = new Map<string, string>(
    abilitiesMeta.map((a) => [condense(a.identifier), a.identifier]),
  );
  const itemMetaRaw = readCsv<{ id: string; identifier: string }>("items.csv");
  const itemSlugByCondensed = new Map<string, string>(
    itemMetaRaw.map((i) => [condense(i.identifier), i.identifier]),
  );
  const syntheticItemNameBySlug = new Map<string, string>();
  const mapSmogonAbility = (name: string) => abilitySlugByCondensed.get(condense(name)) ?? null;
  const mapSmogonItem = (name: string) => {
    if (condense(name) === "nothing") return null;
    return itemSlugByCondensed.get(condense(name)) ?? null;
  };
  const mapSmogonMove = (name: string) => moveSlugByCondensed.get(condense(name)) ?? null;
  const allPokemonSlugs = new Set(pokemonRows.map((p) => p.identifier));

  type UsageStats = {
    topAbilities: Array<{ slug: string; pct: number }>;
    topItems: Array<{ slug: string; pct: number }>;
    topMoves: Array<{ slug: string; pct: number }>;
    topSpreads: Array<{ nature: string; vp: [number, number, number, number, number, number]; pct: number }>;
    source: string;
  };
  type FormatStats = {
    smogonFile: string | null;
    usageBySlug: Map<string, UsageStats>;
    rawCountBySlug: Map<string, number>;
    observedMoveSlugsByPokemon: Map<string, Set<string>>;
    globalAbilityUsagePct: Map<string, number>;
    globalItemUsagePct: Map<string, number>;
    globalMoveUsagePct: Map<string, number>;
    smogonRankBySlug: Map<string, { rank: number; usagePct: number }>;
  };

  function processSmogonFiles(files: string[]): FormatStats {
    const empty: FormatStats = {
      smogonFile: null,
      usageBySlug: new Map(),
      rawCountBySlug: new Map(),
      observedMoveSlugsByPokemon: new Map(),
      globalAbilityUsagePct: new Map(),
      globalItemUsagePct: new Map(),
      globalMoveUsagePct: new Map(),
      smogonRankBySlug: new Map(),
    };
    const file = files.find((f) => fs.existsSync(path.join(DATA, f))) ?? null;
    if (!file) return empty;
    const smogon = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as SmogonDump;

    // Synthetic item slugs for items in the Smogon dump but missing from PokeAPI
    for (const entry of Object.values(smogon.data)) {
      for (const itemName of Object.keys(entry.Items ?? {})) {
        if (condense(itemName) === "nothing") continue;
        const condensed = condense(itemName);
        if (itemSlugByCondensed.has(condensed)) continue;
        const slug = smogonItemToSyntheticSlug(itemName);
        if (!slug) continue;
        itemSlugByCondensed.set(condensed, slug);
        syntheticItemNameBySlug.set(slug, itemName);
      }
    }

    const usageBySlug = new Map<string, UsageStats>();
    const rawCountBySlug = new Map<string, number>();
    const usageRatioBySlug = new Map<string, number>();
    const observedMoveSlugsByPokemon = new Map<string, Set<string>>();
    const moveUsageWeightBySlug = new Map<string, number>();
    const abilityUsageWeightBySlug = new Map<string, number>();
    const itemUsageWeightBySlug = new Map<string, number>();
    let moveSlotWeight = 0;
    let abilitySlotWeight = 0;
    let itemSlotWeight = 0;

    const totalBattles = (smogon.info?.["number of battles"] as number) ?? 1;
    const monEntries = Object.entries(smogon.data);
    const mergedBySlug = new Map<string, SmogonEntry>();
    let unmapped = 0;
    for (const [smogonName, entry] of monEntries) {
      const slug = smogonNameToSlug(smogonName, allPokemonSlugs);
      if (!slug) { unmapped++; continue; }
      let merged = mergedBySlug.get(slug);
      if (!merged) {
        merged = { "Raw count": 0, Abilities: {}, Items: {}, Moves: {}, Spreads: {}, usage: 0 };
        mergedBySlug.set(slug, merged);
      }
      merged["Raw count"] += entry["Raw count"] ?? 0;
      merged.usage = (merged.usage ?? 0) + smogonUsageRatio(entry, totalBattles);
      mergeNumberRecords(merged.Abilities, entry.Abilities);
      mergeNumberRecords(merged.Items, entry.Items);
      mergeNumberRecords(merged.Moves, entry.Moves);
      mergeNumberRecords(merged.Spreads, entry.Spreads);
    }

    for (const [slug, entry] of mergedBySlug) {
      const raw = entry["Raw count"] ?? 0;
      if (raw <= 0) continue;
      const monUsageRatio = smogonUsageRatio(entry, totalBattles);
      rawCountBySlug.set(slug, raw);
      usageRatioBySlug.set(slug, monUsageRatio);

      abilitySlotWeight += monUsageRatio;
      itemSlotWeight += monUsageRatio;
      moveSlotWeight += monUsageRatio * 4;
      addWeightedUsage(abilityUsageWeightBySlug, entry.Abilities ?? {}, monUsageRatio, mapSmogonAbility, "single");
      addWeightedUsage(itemUsageWeightBySlug, entry.Items ?? {}, monUsageRatio, mapSmogonItem, "single");
      addWeightedUsage(moveUsageWeightBySlug, entry.Moves ?? {}, monUsageRatio, mapSmogonMove, "moves");

      observedMoveSlugsByPokemon.set(
        slug,
        new Set(
          Object.keys(entry.Moves ?? {})
            .map(mapSmogonMove)
            .filter((moveSlug): moveSlug is string => !!moveSlug),
        ),
      );
      const spreadTotal = Object.values(entry.Spreads ?? {}).reduce((s, v) => s + v, 0);
      const stats: UsageStats = {
        topAbilities: topN(entry.Abilities ?? {}, 4, mapSmogonAbility, "single"),
        topItems: topN(entry.Items ?? {}, TOP_ITEM_COUNT, mapSmogonItem, "single"),
        topMoves: topN(entry.Moves ?? {}, TOP_MOVE_COUNT, mapSmogonMove, "moves"),
        topSpreads: Object.entries(entry.Spreads ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_SPREAD_COUNT)
          .flatMap(([k, v]) => {
            const parsed = parseSpread(k);
            if (!parsed) return [];
            return [{
              nature: parsed.nature,
              vp: parsed.vp,
              pct: spreadTotal > 0 ? +((v / spreadTotal) * 100).toFixed(1) : 0,
            }];
          }),
        source: file,
      };
      usageBySlug.set(slug, stats);
    }
    console.log(`  Smogon (${file}): ${monEntries.length} mons, ${unmapped} unmapped, ${usageBySlug.size} mapped`);

    const sortedByUsage = [...usageRatioBySlug.entries()].sort((a, b) => b[1] - a[1]);
    const smogonRankBySlug = new Map<string, { rank: number; usagePct: number }>();
    sortedByUsage.forEach(([slug, usageRatio], i) => {
      smogonRankBySlug.set(slug, {
        rank: i + 1,
        usagePct: +(usageRatio * 100).toFixed(1),
      });
    });

    return {
      smogonFile: file,
      usageBySlug,
      rawCountBySlug,
      observedMoveSlugsByPokemon,
      globalAbilityUsagePct: normalizeWeightedUsage(abilityUsageWeightBySlug, abilitySlotWeight),
      globalItemUsagePct: normalizeWeightedUsage(itemUsageWeightBySlug, itemSlotWeight),
      globalMoveUsagePct: normalizeWeightedUsage(moveUsageWeightBySlug, moveSlotWeight),
      smogonRankBySlug,
    };
  }

  const doublesStats = processSmogonFiles(SMOGON_FILES_DOUBLES);
  const singlesStats = processSmogonFiles(SMOGON_FILES_SINGLES);
  // For "any data was loaded" checks downstream
  const smogonFile = doublesStats.smogonFile ?? singlesStats.smogonFile;

  // Union the roster across both formats — a mon is "Champions-legal" if it
  // shows up in either singles or doubles usage data.
  const rawCountBySlug = new Map<string, number>();
  for (const [k, v] of doublesStats.rawCountBySlug) rawCountBySlug.set(k, v);
  for (const [k, v] of singlesStats.rawCountBySlug) {
    rawCountBySlug.set(k, (rawCountBySlug.get(k) ?? 0) + v);
  }

  // Per-Pokemon "observed moves" — union across formats for the learnset filter.
  const observedMoveSlugsByPokemon = new Map<string, Set<string>>();
  for (const [slug, set] of doublesStats.observedMoveSlugsByPokemon) {
    observedMoveSlugsByPokemon.set(slug, new Set(set));
  }
  for (const [slug, set] of singlesStats.observedMoveSlugsByPokemon) {
    const merged = observedMoveSlugsByPokemon.get(slug) ?? new Set<string>();
    for (const m of set) merged.add(m);
    observedMoveSlugsByPokemon.set(slug, merged);
  }

  // Move / ability / item global usage — take the max across formats so the
  // catalog shows a move's relevance in whichever format prefers it.
  function mergeMaxPct(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, v] of a) out.set(k, v);
    for (const [k, v] of b) out.set(k, Math.max(out.get(k) ?? 0, v));
    return out;
  }
  const globalAbilityUsagePct = mergeMaxPct(doublesStats.globalAbilityUsagePct, singlesStats.globalAbilityUsagePct);
  const globalItemUsagePct = mergeMaxPct(doublesStats.globalItemUsagePct, singlesStats.globalItemUsagePct);
  const globalMoveUsagePct = mergeMaxPct(doublesStats.globalMoveUsagePct, singlesStats.globalMoveUsagePct);

  // Pokemon row's rank + usagePct: prefer doubles (the primary Champions
  // format), fall back to singles if the mon is singles-only.
  const smogonRankBySlug = new Map<string, { rank: number; usagePct: number }>();
  for (const [slug, info] of singlesStats.smogonRankBySlug) smogonRankBySlug.set(slug, info);
  for (const [slug, info] of doublesStats.smogonRankBySlug) smogonRankBySlug.set(slug, info);

  // Mega / Primal forms — PokeAPI ships localized pokemon_name for some but
  // not all of them, leaving ~40% of mega forms with just the species name
  // (e.g. "龟足巨铠" instead of "超级龟足巨铠"). When the slug indicates a
  // Mega/Primal form and the constructed name doesn't already carry a known
  // mega/primal prefix in that locale, prepend the locale-appropriate one
  // and append the X/Y/Z suffix (full-width to match PokeAPI's house style).
  const MEGA_PREFIX: Record<Locale, string> = {
    en: "Mega ",
    ja: "メガ",
    "zh-Hans": "超级",
    "zh-Hant": "超級",
  };
  const PRIMAL_PREFIX: Record<Locale, string> = {
    en: "Primal ",
    ja: "ゲンシ",
    "zh-Hans": "原始",
    "zh-Hant": "原始",
  };
  const MEGA_PRIMAL_PREFIX_REGEX = /^(Mega |Primal |メガ|ゲンシ|超级|超級|原始)/;
  function applyMegaPrimalPrefix(
    names: Record<Locale, string>,
    identifier: string,
  ): Record<Locale, string> {
    const megaMatch = identifier.match(/-mega(?:-([xyz]))?$/i);
    const isPrimal = identifier.endsWith("-primal");
    if (!megaMatch && !isPrimal) return names;
    const prefixes = isPrimal ? PRIMAL_PREFIX : MEGA_PREFIX;
    const suffix = megaMatch?.[1] ? megaMatch[1].toUpperCase() : "";
    const fullwidth = suffix
      ? String.fromCharCode(suffix.charCodeAt(0) + 0xFEE0)
      : "";
    const out: Record<Locale, string> = { ...names };
    for (const loc of ["en", "ja", "zh-Hans", "zh-Hant"] as Locale[]) {
      let name = out[loc];
      if (!name) continue;
      if (!MEGA_PRIMAL_PREFIX_REGEX.test(name)) {
        name = prefixes[loc] + name;
      }
      if (suffix && !name.endsWith(suffix) && !name.endsWith(fullwidth)) {
        // English keeps the half-width letter (matches PokeAPI's "Mega Charizard X"),
        // ja/zh-* use full-width to match existing data (e.g. "超级喷火龙Ｘ").
        name = name + (loc === "en" ? suffix : fullwidth);
      }
      out[loc] = name;
    }
    return out;
  }

  // Build localized name for a Pokemon, combining species name + form descriptor.
  // For default forms, return the species name; for non-default forms, use form-specific
  // display name when available, else compose from species + form descriptor.
  function buildPokemonNames(
    monId: number,
    speciesId: number,
    isDefault: boolean,
  ): Record<Locale, string> {
    const speciesMap = speciesNames.get(speciesId) ?? ({} as Record<Locale, string>);
    if (isDefault) return { ...speciesMap } as Record<Locale, string>;

    const formId = pokemonIdToFormId.get(monId);
    const formI18n = formId != null ? formI18nByFormId.get(formId) : undefined;
    const out = { en: "", ja: "", "zh-Hans": "", "zh-Hant": "" } as Record<Locale, string>;

    for (const loc of ["en", "ja", "zh-Hans", "zh-Hant"] as Locale[]) {
      const species = speciesMap[loc] ?? "";
      const pName = formI18n?.pokemonName[loc] ?? "";
      const fName = formI18n?.formName[loc] ?? "";

      // Some locales (esp. JA / zh-*) put the full pokemon name in `form_name`
      // (e.g. "メガリザードンＸ"). When form_name already embeds the species
      // name, treat it as the full name; otherwise compose `species (form_name)`.
      const formNameIsFull = !!(fName && species && fName.includes(species));

      if (pName) out[loc] = pName;
      else if (formNameIsFull) out[loc] = fName;
      else if (species && fName) out[loc] = `${species}（${fName}）`;
      else if (species) out[loc] = species;
    }
    return out;
  }

  // For non-default forms that have NO pokemon_moves rows (common for Mega evolutions
  // and many cosmetic forms), inherit the species' default-form learnset.
  // PokeAPI's convention is inconsistent — some Megas have explicit entries, some don't.
  const defaultMonIdBySpecies = new Map<number, number>();
  for (const p of pokemonRows) {
    if (p.is_default === "1") defaultMonIdBySpecies.set(num(p.species_id), num(p.id));
  }

  // Construct Pokemon DB rows for ALL forms (default + non-default).
  const pokemonRowsToInsert = pokemonRows.map((p) => {
    const monId = num(p.id);
    const speciesId = num(p.species_id);
    const isDefault = p.is_default === "1";
    const stats = statsByMon.get(monId) ?? {};
    const types = typesByMon.get(monId) ?? {};
    const abs = abilitiesByMon.get(monId) ?? { normal: [], hidden: null };
    const namesMap = applyMegaPrimalPrefix(
      buildPokemonNames(monId, speciesId, isDefault),
      p.identifier,
    );
    const enName = namesMap.en || p.identifier;
    // Prefer real Smogon-derived rank/usage over the hand-curated overlay when present.
    // If Smogon data is loaded, never fall back to the static overlay — its ranks
    // collide with Smogon's, producing duplicate rank values.
    const smogonOverlay = smogonRankBySlug.get(p.identifier);
    const overlay = smogonFile
      ? smogonOverlay
      : (smogonOverlay ?? overlayBySpecies.get(p.identifier));
    // Per-format usage stats. UI reads usageStats[format] (singles | doubles).
    const usageStats = {
      singles: singlesStats.usageBySlug.get(p.identifier) ?? null,
      doubles: doublesStats.usageBySlug.get(p.identifier) ?? null,
    };
    const hasUsage = usageStats.singles || usageStats.doubles;
    const observedChampionsMoves = observedMoveSlugsByPokemon.get(p.identifier);
    let learnableMoves = observedChampionsMoves?.size
      ? Array.from(observedChampionsMoves).sort()
      : Array.from(learnsetByPokemonId.get(monId) ?? []).sort();
    if (!observedChampionsMoves?.size && !isDefault && learnableMoves.length === 0) {
      const defaultId = defaultMonIdBySpecies.get(speciesId);
      if (defaultId != null) {
        learnableMoves = Array.from(learnsetByPokemonId.get(defaultId) ?? []).sort();
      }
    }

    return {
      slug: p.identifier,
      dexNo: speciesId,
      name: enName,
      nameI18n: i18nJson(namesMap),
      type1: types.slot1 ?? "normal",
      type2: types.slot2 ?? null,
      hp: stats[1] ?? 0,
      atk: stats[2] ?? 0,
      def: stats[3] ?? 0,
      spa: stats[4] ?? 0,
      spd: stats[5] ?? 0,
      spe: stats[6] ?? 0,
      weight: num(p.weight),
      abilities: JSON.stringify(abs.normal),
      hiddenAbility: abs.hidden,
      // Use pokemon.id (not species_id) so non-default forms get their own art.
      spriteUrl: SPRITE(monId),
      usagePct: overlay?.usagePct ?? 0,
      rank: overlay?.rank ?? null,
      regulations: JSON.stringify([]),
      // Champions roster proxy: tag for "pokemon-champions" only if this
      // Pokémon actually showed up in the Smogon Reg M-A dump (i.e. people
      // play it competitively). Mons absent from the dump stay in the DB
      // as catalog reference but are filtered out of list views.
      games: JSON.stringify(
        rawCountBySlug.has(p.identifier) ? ["pokemon-champions"] : [],
      ),
      learnableMoves: JSON.stringify(learnableMoves),
      usageStats: hasUsage ? JSON.stringify(usageStats) : "{}",
    };
  });

  await prisma.pokemon.deleteMany();
  await prisma.pokemon.createMany({ data: pokemonRowsToInsert });
  console.log(`  → ${pokemonRowsToInsert.length} Pokémon`);

  // MOVES ─────────────────────────────────────────────────────────────────────
  const moveMeta = readCsv<{
    id: string; identifier: string; type_id: string;
    power: string; pp: string; accuracy: string; priority: string;
    target_id: string; damage_class_id: string;
    effect_id: string; effect_chance: string;
  }>("moves.csv");
  const moveNamesRows = readCsv<Record<string, string>>("move_names.csv");
  const moveFlavorRows = readCsv<Record<string, string>>("move_flavor_text.csv");
  const moveEffectProseRows = readCsv<Record<string, string>>("move_effect_prose.csv");

  const moveNames = buildNameI18n(moveNamesRows, "move_id", "name");
  const moveFlavor = buildFlavorI18n(moveFlavorRows, "move_id", "flavor_text");

  // Map move_effect_id → long-form effect description.
  // Many moves share the same effect_id (e.g. all generic damage moves share id=1),
  // so this dedupes nicely.
  const moveEffectById = new Map<number, { en: string }>();
  for (const r of moveEffectProseRows) {
    const eid = num(r.move_effect_id);
    if (!eid) continue;
    if (num(r.local_language_id) !== 9) continue; // English only
    moveEffectById.set(eid, { en: r.effect || r.short_effect || "" });
  }

  function substituteChance(text: string, chance: string | undefined): string {
    if (!text) return text;
    if (chance) return text.replace(/\$effect_chance\b/g, chance);
    return text;
  }

  const moveRowsToInsert = moveMeta.map((m) => {
    const id = num(m.id);
    const namesMap = moveNames.get(id);
    const flavor = moveFlavor.get(id);
    const override = MOVE_OVERRIDES[m.identifier];
    const enName = namesMap?.en ?? m.identifier;
    const effectEn = flavor?.en ?? "";
    // Long-form prose lookup by effect_id; substitute the $effect_chance placeholder.
    const proseEn = substituteChance(
      moveEffectById.get(num(m.effect_id))?.en ?? "",
      m.effect_chance,
    );
    const mergedName = forceI18n(namesMap, override?.name);
    const shortI18n = mergeI18n(flavor, override?.short);
    const longI18n = mergeI18n(
      { en: proseEn || effectEn, ja: flavor?.ja ?? "", "zh-Hans": flavor?.["zh-Hans"] ?? "", "zh-Hant": flavor?.["zh-Hant"] ?? "" },
      override?.long ?? override?.short,
    );
    return {
      slug: m.identifier,
      name: enName,
      nameI18n: i18nJson(mergedName),
      type: TYPE_ID_TO_SLUG[num(m.type_id)] ?? "normal",
      category: DAMAGE_CLASS_ID_TO_SLUG[num(m.damage_class_id)] ?? "status",
      power: maybeNum(m.power),
      accuracy: maybeNum(m.accuracy),
      pp: num(m.pp) || 1,
      priority: num(m.priority),
      targetShape: m.target_id, // raw target id for now; can map to slugs later
      makesContact: false, // PokeAPI puts this under move_flag_map; skip for v1
      effectText: effectEn,
      effectI18n: i18nJson(shortI18n),
      effectLongI18n: i18nJson(longI18n),
      effectChance: maybeNum(m.effect_chance),
      usagePct: globalMoveUsagePct.get(m.identifier) ?? 0,
    };
  });

  await prisma.move.deleteMany();
  await prisma.move.createMany({ data: moveRowsToInsert });
  console.log(`  → ${moveRowsToInsert.length} moves`);

  // ABILITIES ─────────────────────────────────────────────────────────────────
  const abilityMeta = readCsv<{ id: string; identifier: string; is_main_series: string }>("abilities.csv");
  const abilityNamesRows = readCsv<Record<string, string>>("ability_names.csv");
  const abilityFlavorRows = readCsv<Record<string, string>>("ability_flavor_text.csv");
  const abilityProseRows = readCsv<Record<string, string>>("ability_prose.csv");

  const abilityNames = buildNameI18n(abilityNamesRows, "ability_id", "name");
  const abilityFlavor = buildFlavorI18n(abilityFlavorRows, "ability_id", "flavor_text");

  // ability_prose.csv: per-locale short_effect + long-form effect (mostly EN+FR).
  // We pull English here since it's the only locale with consistent prose coverage
  // for the competitive ability list; non-English locales fall back to flavor.
  const abilityProseById = new Map<number, { short: string; long: string }>();
  for (const r of abilityProseRows) {
    if (num(r.local_language_id) !== 9) continue;
    const aid = num(r.ability_id);
    if (!aid) continue;
    abilityProseById.set(aid, {
      short: r.short_effect ?? "",
      long: r.effect ?? "",
    });
  }

  const abilityRowsToInsert = abilityMeta
    .filter((a) => a.is_main_series === "1")
    .map((a) => {
      const id = num(a.id);
      const namesMap = abilityNames.get(id);
      const flavor = abilityFlavor.get(id);
      const prose = abilityProseById.get(id);
      const enName = namesMap?.en ?? a.identifier;
      const shortDescEn = prose?.short || flavor?.en || "";
      const longDescEn = prose?.long || prose?.short || flavor?.en || "";

      // Apply hand-curated zh-Hans / zh-Hant overlay where PokeAPI ships nothing.
      // Use `||` (not `??`) because buildNameI18n / buildFlavorI18n initialise
      // missing locales with empty strings, not undefined.
      const override = ABILITY_OVERRIDES[a.identifier];
      const mergedName: Record<Locale, string> = {
        en: namesMap?.en || enName,
        ja: namesMap?.ja || "",
        "zh-Hans": namesMap?.["zh-Hans"] || override?.name?.["zh-Hans"] || "",
        "zh-Hant": namesMap?.["zh-Hant"] || override?.name?.["zh-Hant"] || "",
      };
      const longI18n: Record<Locale, string> = {
        en: longDescEn,
        ja: flavor?.ja || "",
        "zh-Hans": flavor?.["zh-Hans"] || override?.short?.["zh-Hans"] || "",
        "zh-Hant": flavor?.["zh-Hant"] || override?.short?.["zh-Hant"] || "",
      };
      const shortI18n: Record<Locale, string> = {
        en: shortDescEn,
        ja: flavor?.ja || "",
        "zh-Hans": flavor?.["zh-Hans"] || override?.short?.["zh-Hans"] || "",
        "zh-Hant": flavor?.["zh-Hant"] || override?.short?.["zh-Hant"] || "",
      };
      return {
        slug: a.identifier,
        name: enName,
        nameI18n: i18nJson(mergedName),
        shortDesc: shortDescEn,
        shortDescI18n: i18nJson(shortI18n),
        longDesc: longDescEn,
        longDescI18n: i18nJson(longI18n),
        usagePct: globalAbilityUsagePct.get(a.identifier) ?? 0,
      };
    });

  await prisma.ability.deleteMany();
  await prisma.ability.createMany({ data: abilityRowsToInsert });
  console.log(`  → ${abilityRowsToInsert.length} abilities`);

  // ITEMS ─────────────────────────────────────────────────────────────────────
  const itemMeta = readCsv<{ id: string; identifier: string; category_id: string }>("items.csv");
  const itemNamesRows = readCsv<Record<string, string>>("item_names.csv");
  const itemFlavorRows = readCsv<Record<string, string>>("item_flavor_text.csv");
  const itemProseRows = readCsv<Record<string, string>>("item_prose.csv");

  const itemNames = buildNameI18n(itemNamesRows, "item_id", "name");
  const itemFlavor = buildFlavorI18n(itemFlavorRows, "item_id", "flavor_text");

  const itemProseById = new Map<number, { short: string; long: string }>();
  for (const r of itemProseRows) {
    if (num(r.local_language_id) !== 9) continue;
    const iid = num(r.item_id);
    if (!iid) continue;
    itemProseById.set(iid, {
      short: r.short_effect ?? "",
      long: r.effect ?? "",
    });
  }

  // We don't have a categories table here; bucket items into our enum heuristically.
  function categoryFor(slug: string, categoryId: number): string {
    if (slug.endsWith("-berry") || slug.endsWith("berry")) return "berry";
    if (slug.endsWith("ite") && categoryId === 44) return "mega-stone";
    if (slug.startsWith("choice-")) return "choice";
    if (categoryId === 44) return "mega-stone";
    if (categoryId === 17 || categoryId === 19) return "type-boost";
    return "held"; // catch-all
  }

  const championsItemSlugs = new Set(globalItemUsagePct.keys());
  function gamesFor(slug: string): string[] {
    return championsItemSlugs.has(slug) ? ["pokemon-champions"] : [];
  }

  const itemRowsToInsert = itemMeta.map((it) => {
    const id = num(it.id);
    const namesMap = itemNames.get(id);
    const flavor = itemFlavor.get(id);
    const prose = itemProseById.get(id);
    const override = ITEM_OVERRIDES[it.identifier];
    const enName = namesMap?.en ?? it.identifier;
    const shortDescEn = prose?.short || flavor?.en || "";
    const longDescEn = prose?.long || prose?.short || flavor?.en || "";
    const mergedName = forceI18n(namesMap, override?.name);
    const shortI18n = mergeI18n({
      en: shortDescEn, ja: flavor?.ja ?? "", "zh-Hans": flavor?.["zh-Hans"] ?? "", "zh-Hant": flavor?.["zh-Hant"] ?? "",
    }, override?.short);
    const longI18n = mergeI18n({
      en: longDescEn, ja: flavor?.ja ?? "", "zh-Hans": flavor?.["zh-Hans"] ?? "", "zh-Hant": flavor?.["zh-Hant"] ?? "",
    }, override?.long ?? override?.short);
    const cid = num(it.category_id);
    return {
      slug: it.identifier,
      name: enName,
      nameI18n: i18nJson(mergedName),
      category: categoryFor(it.identifier, cid),
      description: shortDescEn || override?.short?.en || "",
      descI18n: i18nJson(shortI18n),
      descLongI18n: i18nJson(longI18n),
      games: JSON.stringify(gamesFor(it.identifier)),
      usagePct: globalItemUsagePct.get(it.identifier) ?? 0,
    };
  });

  for (const slug of syntheticItemNameBySlug.keys()) {
    if (!championsItemSlugs.has(slug)) continue;
    const override = ITEM_OVERRIDES[slug];
    const name = override?.name?.en ?? titleCaseFromSlug(slug);
    const desc = override?.short?.en ?? "Allows a compatible Pokémon to Mega Evolve in Pokémon Champions.";
    const nameI18n = mergeI18n(undefined, override?.name ?? { en: name });
    const descI18n = mergeI18n(undefined, override?.short ?? { en: desc });
    itemRowsToInsert.push({
      slug,
      name,
      nameI18n: i18nJson(nameI18n),
      category: "mega-stone",
      description: desc,
      descI18n: i18nJson(descI18n),
      descLongI18n: i18nJson(mergeI18n(descI18n, override?.long)),
      games: JSON.stringify(["pokemon-champions"]),
      usagePct: globalItemUsagePct.get(slug) ?? 0,
    });
  }

  await prisma.item.deleteMany();
  await prisma.item.createMany({ data: itemRowsToInsert });
  console.log(`  → ${itemRowsToInsert.length} items`);

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
