/**
 * Parses a Pokémon Showdown / PokePaste team export into our internal
 * TeamShare format.
 *
 * Showdown uses level-50 VGC mechanics (EVs 0–252 per stat, 510 total cap,
 * IVs 0–31, level configurable). Pokémon Champions uses Stat Points (0–32
 * per stat, 66 total cap, no IVs, level always 50). The EV→SP conversion is
 * therefore lossy; we surface a warning whenever we had to trim.
 *
 * The function is intentionally pure — pass in the lookup sets / maps and
 * raw text, get back a TeamShare and an array of warnings. Lets us unit-test
 * it from Node without spinning up Prisma or React.
 */

import type { TeamShare, ShareSlot } from "./team-share";

export type LookupSets = {
  speciesSlugs: Set<string>;
  abilitySlugs: Set<string>;
  itemSlugs: Set<string>;
  moveSlugs: Set<string>;
  /** For each species slug → the set of move slugs it can learn. */
  learnableBySpecies: Map<string, Set<string>>;
  /** For each species slug → the set of legal ability slugs (regular + hidden). */
  validAbilitiesBySpecies: Map<string, Set<string>>;
};

export type ImportWarningKind =
  | "unknown-species"
  | "unknown-ability"
  | "unknown-item"
  | "unknown-move"
  | "unlearnable-move"
  | "illegal-ability"
  | "ev-trimmed"
  | "ev-rescaled"
  | "iv-ignored"
  | "level-ignored"
  | "happiness-ignored"
  | "nature-unknown"
  | "empty-block";

export type ImportWarning = {
  slotIndex: number;
  /** Display name from the import (pre-slug), useful for user-facing messages. */
  speciesName?: string;
  kind: ImportWarningKind;
  detail: string;
};

export type ParseResult = {
  team: TeamShare;
  warnings: ImportWarning[];
};

// ─── Slug normalization ──────────────────────────────────────────────────────

/**
 * Species-name overrides where Showdown's naming differs from our (PokeAPI-derived)
 * slugs. Match against the *exact* Showdown form (post-trim), case-insensitive.
 *
 * Confirmed against the DB on 2026-05-17; see AGENTS.md §"Pokemon Showdown import".
 */
const SPECIES_OVERRIDES: Record<string, string> = {
  "indeedee-f": "indeedee-female",
  "indeedee-m": "indeedee-male",
  "ogerpon-wellspring": "ogerpon-wellspring-mask",
  "ogerpon-hearthflame": "ogerpon-hearthflame-mask",
  "ogerpon-cornerstone": "ogerpon-cornerstone-mask",
  "tauros-paldea-combat": "tauros-paldea-combat-breed",
  "tauros-paldea-blaze": "tauros-paldea-blaze-breed",
  "tauros-paldea-aqua": "tauros-paldea-aqua-breed",
  // Aliases users sometimes type
  "tauros-paldean-combat": "tauros-paldea-combat-breed",
  "tauros-paldean-blaze": "tauros-paldea-blaze-breed",
  "tauros-paldean-aqua": "tauros-paldea-aqua-breed",
};

/**
 * Move/item/ability quirks where Showdown's display name slugifies to something
 * different from the PokeAPI slug.
 */
const NAME_OVERRIDES: Record<string, string> = {
  // Moves
  "vise-grip": "vice-grip",
  // Items — Showdown uses Gen-8+ rename "Leek"; PokeAPI keeps Gen-2 "Stick"
  "leek": "stick",
};

const NATURE_NAMES = new Set([
  "Hardy", "Lonely", "Adamant", "Naughty", "Brave",
  "Bold", "Docile", "Impish", "Lax", "Relaxed",
  "Modest", "Mild", "Bashful", "Rash", "Quiet",
  "Calm", "Gentle", "Careful", "Sassy", "Quirky",
  "Timid", "Hasty", "Jolly", "Naive", "Serious",
]);

function toSlug(raw: string): string {
  return raw
    .trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’.:]/g, "")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function normalizeSpeciesSlug(name: string): string {
  const base = toSlug(name);
  return SPECIES_OVERRIDES[base] ?? base;
}

function normalizeNameSlug(name: string): string {
  const base = toSlug(name);
  // Strip parenthesized clarifications, e.g. "As One (Glastrier)" → "as-one-glastrier"
  // (already handled by toSlug which keeps content & removes parens; but parens may
  // produce "()" empties — normalize.)
  const cleaned = base.replace(/[()]/g, "").replace(/--+/g, "-").replace(/^-|-$/g, "");
  return NAME_OVERRIDES[cleaned] ?? cleaned;
}

// ─── EV → SP conversion ──────────────────────────────────────────────────────

const PER_STAT_SP_CAP = 32;
const TOTAL_SP_CAP = 66;

/**
 * Convert a Showdown EV spread (0..252 per stat) into a Champions Stat Point
 * spread (0..32 per stat, ≤66 total). Returns the converted spread plus
 * whether any clamping/trimming happened (so the caller can warn).
 */
export function convertEvToSp(
  ev: [number, number, number, number, number, number],
): {
  sp: [number, number, number, number, number, number];
  changed: boolean;
  trimmedBy: number;
} {
  const raw = ev.map((e) => Math.round(Math.max(0, e) / 8));
  const clamped = raw.map((v) => Math.min(PER_STAT_SP_CAP, v));
  let sp = [...clamped] as number[];

  // Trim total down to 66 by removing 1 SP at a time from the highest stat.
  // Ties broken by index so trims are deterministic (HP first if HP and Atk tie).
  let trimmed = 0;
  while (sp.reduce((a, b) => a + b, 0) > TOTAL_SP_CAP) {
    let maxIdx = 0;
    for (let i = 1; i < sp.length; i++) if (sp[i] > sp[maxIdx]) maxIdx = i;
    if (sp[maxIdx] === 0) break;
    sp[maxIdx] -= 1;
    trimmed += 1;
  }

  const changed =
    trimmed > 0 ||
    clamped.some((v, i) => v !== raw[i]);

  return {
    sp: sp as [number, number, number, number, number, number],
    changed,
    trimmedBy: trimmed,
  };
}

// ─── Block splitter ──────────────────────────────────────────────────────────

function splitBlocks(text: string): string[] {
  // Normalize line endings, then split on one or more blank lines.
  const norm = text.replace(/\r\n?/g, "\n");
  return norm
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

// ─── Header line parser ──────────────────────────────────────────────────────

type Header = {
  nickname?: string;
  speciesName: string;
  gender?: "M" | "F" | "N";
  itemName?: string;
};

/**
 * Parses the species/item line.
 *
 * Examples:
 *   "Garchomp @ Choice Scarf"
 *   "Garchomp (M) @ Choice Scarf"
 *   "Nicky (Garchomp) @ Choice Scarf"
 *   "Nicky (Garchomp) (M) @ Choice Scarf"
 *   "Indeedee-F"  (no item)
 *   "Mr. Mime-Galar @ Eviolite"
 */
function parseHeader(line: string): Header | null {
  if (!line) return null;

  let rest = line;
  let itemName: string | undefined;

  const atIdx = rest.lastIndexOf(" @ ");
  if (atIdx !== -1) {
    itemName = rest.slice(atIdx + 3).trim();
    rest = rest.slice(0, atIdx).trim();
  }

  // Trailing gender? "Foo (M)" / "Foo (F)" / "Foo (N)"
  let gender: "M" | "F" | "N" | undefined;
  const genderMatch = rest.match(/^(.*)\s+\(([MFN])\)\s*$/);
  if (genderMatch) {
    gender = genderMatch[2] as "M" | "F" | "N";
    rest = genderMatch[1].trim();
  }

  // Nickname (Species)
  let nickname: string | undefined;
  let speciesName = rest;
  const nickMatch = rest.match(/^(.+?)\s+\((.+)\)\s*$/);
  if (nickMatch) {
    nickname = nickMatch[1].trim();
    speciesName = nickMatch[2].trim();
  }

  if (!speciesName) return null;

  return { nickname, speciesName, gender, itemName };
}

// ─── Block parser ────────────────────────────────────────────────────────────

type ParsedBlock = {
  header: Header;
  ability?: string;
  level?: number;
  teraType?: string;
  shiny?: boolean;
  happiness?: number;
  gigantamax?: boolean;
  evs?: [number, number, number, number, number, number];
  ivs?: [number, number, number, number, number, number];
  nature?: string;
  moves: string[];
};

const STAT_INDEX: Record<string, number> = {
  hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5,
};

function parseStatLine(raw: string): [number, number, number, number, number, number] | null {
  // "4 HP / 252 Atk / 252 Spe"
  const out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  let any = false;
  for (const part of raw.split("/").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s+([A-Za-z]+)$/);
    if (!m) continue;
    const val = parseInt(m[1], 10);
    const key = m[2].toLowerCase();
    const idx = STAT_INDEX[key];
    if (idx == null) continue;
    out[idx] = val;
    any = true;
  }
  return any ? out : null;
}

function parseBlock(raw: string): ParsedBlock | null {
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const header = parseHeader(lines[0]);
  if (!header) return null;

  const block: ParsedBlock = { header, moves: [] };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Move
    if (line.startsWith("- ") || line.startsWith("-\t")) {
      const move = line.replace(/^-\s+/, "").trim();
      if (move) block.moves.push(move);
      continue;
    }

    // Nature is "<Word> Nature"
    const natureMatch = line.match(/^([A-Z][a-z]+)\s+Nature\s*$/);
    if (natureMatch) {
      block.nature = natureMatch[1];
      continue;
    }

    // Field: prefix
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (key) {
      case "ability":
        block.ability = value;
        break;
      case "level":
        block.level = parseInt(value, 10) || undefined;
        break;
      case "tera type":
        block.teraType = value;
        break;
      case "shiny":
        block.shiny = /yes|true/i.test(value);
        break;
      case "happiness":
        block.happiness = parseInt(value, 10);
        break;
      case "gigantamax":
        block.gigantamax = /yes|true/i.test(value);
        break;
      case "evs":
        block.evs = parseStatLine(value) ?? undefined;
        break;
      case "ivs":
        block.ivs = parseStatLine(value) ?? undefined;
        break;
      default:
        break;
    }
  }

  return block;
}

// ─── Top-level parse ─────────────────────────────────────────────────────────

export function parseShowdownText(
  text: string,
  lookup: LookupSets,
  opts?: { format?: "singles" | "doubles"; regulation?: string },
): ParseResult {
  const warnings: ImportWarning[] = [];
  const slots: ShareSlot[] = [];

  const blocks = splitBlocks(text);
  if (blocks.length === 0) {
    return {
      team: {
        v: 1,
        reg: opts?.regulation ?? "M-A",
        fmt: opts?.format ?? "doubles",
        slots: [],
      },
      warnings,
    };
  }

  let slotIndex = -1;
  for (const blockText of blocks) {
    const parsed = parseBlock(blockText);
    if (!parsed) {
      slotIndex += 1;
      warnings.push({
        slotIndex,
        kind: "empty-block",
        detail: "Block was empty or had no parseable header.",
      });
      continue;
    }
    slotIndex += 1;

    const speciesName = parsed.header.speciesName;
    const speciesSlug = normalizeSpeciesSlug(speciesName);

    if (!lookup.speciesSlugs.has(speciesSlug)) {
      warnings.push({
        slotIndex,
        speciesName,
        kind: "unknown-species",
        detail: `Could not match "${speciesName}" to a known Pokémon.`,
      });
      // Skip the slot entirely — without a species we can't legality-check anything.
      continue;
    }

    const slot: ShareSlot = { s: speciesSlug };

    // Ability
    if (parsed.ability) {
      const abilitySlug = normalizeNameSlug(parsed.ability);
      if (!lookup.abilitySlugs.has(abilitySlug)) {
        warnings.push({
          slotIndex,
          speciesName,
          kind: "unknown-ability",
          detail: `Ability "${parsed.ability}" was not found.`,
        });
      } else {
        const validAbilities = lookup.validAbilitiesBySpecies.get(speciesSlug);
        if (validAbilities && !validAbilities.has(abilitySlug)) {
          warnings.push({
            slotIndex,
            speciesName,
            kind: "illegal-ability",
            detail: `${speciesName} can't legally have "${parsed.ability}". Kept anyway.`,
          });
        }
        slot.a = abilitySlug;
      }
    }

    // Item
    if (parsed.header.itemName) {
      const itemSlug = normalizeNameSlug(parsed.header.itemName);
      if (lookup.itemSlugs.has(itemSlug)) {
        slot.i = itemSlug;
      } else {
        warnings.push({
          slotIndex,
          speciesName,
          kind: "unknown-item",
          detail: `Item "${parsed.header.itemName}" was not found.`,
        });
      }
    }

    // Moves
    const learnable = lookup.learnableBySpecies.get(speciesSlug);
    const moves: string[] = [];
    for (const mv of parsed.moves.slice(0, 4)) {
      const moveSlug = normalizeNameSlug(mv);
      if (!lookup.moveSlugs.has(moveSlug)) {
        warnings.push({
          slotIndex,
          speciesName,
          kind: "unknown-move",
          detail: `Move "${mv}" was not found.`,
        });
        continue;
      }
      if (learnable && !learnable.has(moveSlug)) {
        warnings.push({
          slotIndex,
          speciesName,
          kind: "unlearnable-move",
          detail: `${speciesName} cannot learn "${mv}" in our data. Kept anyway.`,
        });
      }
      moves.push(moveSlug);
    }
    if (moves.length > 0) slot.m = moves;

    // EVs → SPs
    if (parsed.evs) {
      const { sp, changed, trimmedBy } = convertEvToSp(parsed.evs);
      slot.v = sp;
      if (changed) {
        const totalIn = parsed.evs.reduce((a, b) => a + b, 0);
        const totalOut = sp.reduce((a, b) => a + b, 0);
        warnings.push({
          slotIndex,
          speciesName,
          kind: trimmedBy > 0 ? "ev-trimmed" : "ev-rescaled",
          detail:
            trimmedBy > 0
              ? `EV ${parsed.evs.join("/")} → SP ${sp.join("/")} (trimmed ${trimmedBy} to fit 66-SP cap).`
              : `EV ${parsed.evs.join("/")} (total ${totalIn}) → SP ${sp.join("/")} (total ${totalOut}).`,
        });
      }
    }

    // IVs — Champions has none; warn only if any were non-default (31).
    if (parsed.ivs && parsed.ivs.some((iv) => iv !== 31)) {
      warnings.push({
        slotIndex,
        speciesName,
        kind: "iv-ignored",
        detail: `IVs ${parsed.ivs.join("/")} ignored (Champions has no IVs).`,
      });
    }

    // Level — Champions assumes 50.
    if (parsed.level != null && parsed.level !== 50) {
      warnings.push({
        slotIndex,
        speciesName,
        kind: "level-ignored",
        detail: `Level ${parsed.level} ignored (Champions VGC is level 50).`,
      });
    }

    // Nature
    if (parsed.nature) {
      if (NATURE_NAMES.has(parsed.nature)) {
        slot.n = parsed.nature;
      } else {
        warnings.push({
          slotIndex,
          speciesName,
          kind: "nature-unknown",
          detail: `Nature "${parsed.nature}" was not recognized.`,
        });
      }
    }

    // Tera Type — Champions disables Terastallization, so silently drop any
    // pasted "Tera Type:" line. We still parse it for future use (warning-free).

    slots.push(slot);
  }

  return {
    team: {
      v: 1,
      reg: opts?.regulation ?? "M-A",
      fmt: opts?.format ?? "doubles",
      slots,
    },
    warnings,
  };
}

// ─── PokePaste URL helper ────────────────────────────────────────────────────

/**
 * Extracts the paste ID from a `pokepast.es/<id>` URL, returning null for
 * anything that doesn't match. Used by the API proxy route to validate input.
 */
export function extractPokePasteId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "pokepast.es" && u.hostname !== "www.pokepast.es") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    // First segment is the paste ID; second may be "raw" or absent.
    const id = parts[0];
    if (!/^[A-Za-z0-9]+$/.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}
