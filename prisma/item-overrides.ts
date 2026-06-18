/**
 * Hand-curated translations for Champions-specific items that are absent from
 * PokeAPI, plus newer held items with missing localized names/descriptions.
 */

type Locale = "en" | "ja" | "zh-Hans" | "zh-Hant";
type LocMap = Partial<Record<Locale, string>>;

type ItemOverride = {
  name?: LocMap;
  short?: LocMap;
  long?: LocMap;
};

const MEGA_DESC: LocMap = {
  en: "Allows a compatible Pokémon to Mega Evolve in Pokémon Champions.",
  ja: "対応するポケモンをポケモンチャンピオンズでメガシンカさせる。",
  "zh-Hans": "让对应的宝可梦在《宝可梦冠军》中进行超级进化。",
  "zh-Hant": "讓對應的寶可夢在《寶可夢冠軍》中進行超級進化。",
};

export const ITEM_OVERRIDES: Record<string, ItemOverride> = {
  "fairy-feather": {
    name: { "zh-Hans": "妖精之羽", "zh-Hant": "妖精之羽" },
    short: {
      en: "Boosts the power of Fairy-type moves.",
      ja: "持たせるとフェアリータイプの技の威力が上がる。",
      "zh-Hans": "携带后，妖精属性招式的威力会提高。",
      "zh-Hant": "攜帶後，妖精屬性招式的威力會提高。",
    },
  },
  chandelurite: {
    name: { en: "Chandelurite", ja: "シャンデラナイト", "zh-Hans": "水晶灯火灵进化石", "zh-Hant": "水晶燈火靈進化石" },
    short: MEGA_DESC,
  },
  chesnaughtite: {
    name: { en: "Chesnaughtite", ja: "ブリガロナイト", "zh-Hans": "布里卡隆进化石", "zh-Hant": "布里卡隆進化石" },
    short: MEGA_DESC,
  },
  chimechite: {
    name: { en: "Chimechite", ja: "チリーンナイト", "zh-Hans": "风铃铃进化石", "zh-Hant": "風鈴鈴進化石" },
    short: MEGA_DESC,
  },
  clefablite: {
    name: { en: "Clefablite", ja: "ピクシナイト", "zh-Hans": "皮可西进化石", "zh-Hant": "皮可西進化石" },
    short: MEGA_DESC,
  },
  crabominite: {
    name: { en: "Crabominite", ja: "ケケンカニナイト", "zh-Hans": "好胜毛蟹进化石", "zh-Hant": "好勝毛蟹進化石" },
    short: MEGA_DESC,
  },
  delphoxite: {
    name: { en: "Delphoxite", ja: "マフォクシナイト", "zh-Hans": "妖火红狐进化石", "zh-Hant": "妖火紅狐進化石" },
    short: MEGA_DESC,
  },
  dragoninite: {
    name: { en: "Dragoninite", ja: "カイリューナイト", "zh-Hans": "快龙进化石", "zh-Hant": "快龍進化石" },
    short: MEGA_DESC,
  },
  drampanite: {
    name: { en: "Drampanite", ja: "ジジーロンナイト", "zh-Hans": "老翁龙进化石", "zh-Hant": "老翁龍進化石" },
    short: MEGA_DESC,
  },
  emboarite: {
    name: { en: "Emboarite", ja: "エンブオーナイト", "zh-Hans": "炎武王进化石", "zh-Hant": "炎武王進化石" },
    short: MEGA_DESC,
  },
  excadrite: {
    name: { en: "Excadrite", ja: "ドリュウズナイト", "zh-Hans": "龙头地鼠进化石", "zh-Hant": "龍頭地鼠進化石" },
    short: MEGA_DESC,
  },
  feraligite: {
    name: { en: "Feraligite", ja: "オーダイルナイト", "zh-Hans": "大力鳄进化石", "zh-Hant": "大力鱷進化石" },
    short: MEGA_DESC,
  },
  floettite: {
    name: { en: "Floettite", ja: "フラエッテナイト", "zh-Hans": "花叶蒂进化石", "zh-Hant": "花葉蒂進化石" },
    short: MEGA_DESC,
  },
  froslassite: {
    name: { en: "Froslassite", ja: "ユキメノコナイト", "zh-Hans": "雪妖女进化石", "zh-Hant": "雪妖女進化石" },
    short: MEGA_DESC,
  },
  glimmoranite: {
    name: { en: "Glimmoranite", ja: "キラフロルナイト", "zh-Hans": "晶光花进化石", "zh-Hant": "晶光花進化石" },
    short: MEGA_DESC,
  },
  golurkite: {
    name: { en: "Golurkite", ja: "ゴルーグナイト", "zh-Hans": "泥偶巨人进化石", "zh-Hant": "泥偶巨人進化石" },
    short: MEGA_DESC,
  },
  greninjite: {
    name: { en: "Greninjite", ja: "ゲッコウガナイト", "zh-Hans": "甲贺忍蛙进化石", "zh-Hant": "甲賀忍蛙進化石" },
    short: MEGA_DESC,
  },
  hawluchanite: {
    name: { en: "Hawluchanite", ja: "ルチャブルナイト", "zh-Hans": "摔角鹰人进化石", "zh-Hant": "摔角鷹人進化石" },
    short: MEGA_DESC,
  },
  meganiumite: {
    name: { en: "Meganiumite", ja: "メガニウムナイト", "zh-Hans": "大竺葵进化石", "zh-Hant": "大竺葵進化石" },
    short: MEGA_DESC,
  },
  meowsticite: {
    name: { en: "Meowsticite", ja: "ニャオニクスナイト", "zh-Hans": "超能妙喵进化石", "zh-Hant": "超能妙喵進化石" },
    short: MEGA_DESC,
  },
  scovillainite: {
    name: { en: "Scovillainite", ja: "スコヴィランナイト", "zh-Hans": "狠辣椒进化石", "zh-Hant": "狠辣椒進化石" },
    short: MEGA_DESC,
  },
  skarmorite: {
    name: { en: "Skarmorite", ja: "エアームドナイト", "zh-Hans": "盔甲鸟进化石", "zh-Hant": "盔甲鳥進化石" },
    short: MEGA_DESC,
  },
  starminite: {
    name: { en: "Starminite", ja: "スターミーナイト", "zh-Hans": "宝石海星进化石", "zh-Hant": "寶石海星進化石" },
    short: MEGA_DESC,
  },
  victreebelite: {
    name: { en: "Victreebelite", ja: "ウツボットナイト", "zh-Hans": "大食花进化石", "zh-Hant": "大食花進化石" },
    short: MEGA_DESC,
  },

  // ─── Regulation M-B Champions-original Mega stones ──────────────────────────
  // M-B launched 2026-06-16; Smogon has no usage data for these yet, so the
  // importer injects them from these curated entries. Names follow the same
  // convention as the M-A stones above ([species]ite / [species JA]ナイト /
  // [species zh]进化石・進化石). Reconcile against the authoritative names if the
  // July Smogon dump labels them differently.
  staraptorite: {
    name: { en: "Staraptorite", ja: "ムクホークナイト", "zh-Hans": "姆克鹰进化石", "zh-Hant": "姆克鷹進化石" },
    short: MEGA_DESC,
  },
  scolipedite: {
    name: { en: "Scolipedite", ja: "ペンドラーナイト", "zh-Hans": "蜈蚣王进化石", "zh-Hant": "蜈蚣王進化石" },
    short: MEGA_DESC,
  },
  scraftite: {
    name: { en: "Scraftite", ja: "ズルズキンナイト", "zh-Hans": "头巾混混进化石", "zh-Hant": "頭巾混混進化石" },
    short: MEGA_DESC,
  },
  eelektrossite: {
    name: { en: "Eelektrossite", ja: "シビルドンナイト", "zh-Hans": "麻麻鳗鱼王进化石", "zh-Hant": "麻麻鰻魚王進化石" },
    short: MEGA_DESC,
  },
  pyroarite: {
    name: { en: "Pyroarite", ja: "カエンジシナイト", "zh-Hans": "火炎狮进化石", "zh-Hant": "火炎獅進化石" },
    short: MEGA_DESC,
  },
  malamarite: {
    name: { en: "Malamarite", ja: "カラマネロナイト", "zh-Hans": "乌贼王进化石", "zh-Hant": "烏賊王進化石" },
    short: MEGA_DESC,
  },
  barbaraclite: {
    name: { en: "Barbaraclite", ja: "ガメノデスナイト", "zh-Hans": "龟足巨铠进化石", "zh-Hant": "龜足巨鎧進化石" },
    short: MEGA_DESC,
  },
  dragalgite: {
    name: { en: "Dragalgite", ja: "ドラミドロナイト", "zh-Hans": "毒藻龙进化石", "zh-Hant": "毒藻龍進化石" },
    short: MEGA_DESC,
  },
  falinksite: {
    name: { en: "Falinksite", ja: "タイレーツナイト", "zh-Hans": "列阵兵进化石", "zh-Hant": "列陣兵進化石" },
    short: MEGA_DESC,
  },
  // Raichu has two Megas (X = Electric Surge, Y = No Guard); each takes its own
  // stone, mirroring Charizardite X/Y (full-width Ｘ/Ｙ in ja/zh per house style).
  "raichunite-x": {
    name: { en: "Raichunite X", ja: "ライチュウナイトＸ", "zh-Hans": "雷丘进化石Ｘ", "zh-Hant": "雷丘進化石Ｘ" },
    short: MEGA_DESC,
  },
  "raichunite-y": {
    name: { en: "Raichunite Y", ja: "ライチュウナイトＹ", "zh-Hans": "雷丘进化石Ｙ", "zh-Hant": "雷丘進化石Ｙ" },
    short: MEGA_DESC,
  },
};
