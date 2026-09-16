// M-C: official roster and announcement, checked 2026-09-16.
// https://champions-news.pokemon-home.com/en/page/816.html
// https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178713870219xeaaio/en/pokemon.html
export const CURRENT_REGULATION = "M-C";
export const CURRENT_REGULATION_SLUG = "reg-m-c";
export const REGULATION_MC_START = "2026-09-09T02:00:00Z";
export const REGULATION_MC_END = "2026-12-02T01:59:00Z";
export const REGULATION_MC_SOURCE = "https://champions-news.pokemon-home.com/en/page/816.html";

// Include both genders, both Toxtricity forms and all four Squawkabilly colors.
export const CHAMPIONS_MC_ADDITIONS = [
  "wigglytuff",
  "persian",
  "persian-alola",
  "farfetchd",
  "mr-mime",
  "swalot",
  "salamence",
  "gogoat",
  "golisopod",
  "rillaboom",
  "cinderace",
  "inteleon",
  "thievul",
  "toxtricity-amped",
  "toxtricity-low-key",
  "grapploct",
  "perrserker",
  "sirfetchd",
  "pincurchin",
  "indeedee-male",
  "indeedee-female",
  "pawmot",
  "arboliva",
  "squawkabilly-green-plumage",
  "squawkabilly-blue-plumage",
  "squawkabilly-yellow-plumage",
  "squawkabilly-white-plumage",
  "mabosstiff",
  "baxcalibur",
  "absol-mega-z",
  "salamence-mega",
  "garchomp-mega-z",
  "lucario-mega-z",
  "golisopod-mega",
  "baxcalibur-mega"
] as const;

export const CHAMPIONS_MC_MEGAS = [
  "absol-mega-z",
  "salamence-mega",
  "garchomp-mega-z",
  "lucario-mega-z",
  "golisopod-mega",
  "baxcalibur-mega"
] as const;

// Read the actual imported source; historical statistics must not be labelled M-C.
export function usageRegulation(usageStats: string): string | null {
  try {
    const stats = JSON.parse(usageStats);
    const source = stats.doubles?.source ?? stats.singles?.source ?? stats.source;
    const match = typeof source === "string" ? source.match(/regm([a-z])/i) : null;
    return match ? `M-${match[1].toUpperCase()}` : null;
  } catch {
    return null;
  }
}
