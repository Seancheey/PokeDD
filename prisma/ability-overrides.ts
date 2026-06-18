/**
 * Hand-curated zh-Hans / zh-Hant translations for Gen 9 (Scarlet/Violet) abilities.
 *
 * PokeAPI's `ability_names.csv` only ships EN + JA for these newer abilities, so
 * the importer applies this overlay AFTER the PokeAPI pass to fill the gaps.
 * Short descriptions are concise effect summaries — not direct copies of in-game
 * Chinese flavor text (PokeAPI ships none for these), so they prioritize clarity
 * over wording fidelity.
 *
 * Each entry: { name: {…}, short: {…} }
 * Both maps are partial — only the locales that need filling.
 */

type Locale = "en" | "ja" | "zh-Hans" | "zh-Hant";
type LocMap = Partial<Record<Locale, string>>;

export const ABILITY_OVERRIDES: Record<
  string,
  { name?: LocMap; short?: LocMap }
> = {
  "anger-shell": {
    name:  { "zh-Hans": "愤怒甲壳", "zh-Hant": "憤怒甲殼" },
    short: { "zh-Hans": "HP降到一半时,防御与特防下降,攻击、特攻、速度提升。", "zh-Hant": "HP降到一半時,防禦與特防下降,攻擊、特攻、速度提升。" },
  },
  "armor-tail": {
    name:  { "zh-Hans": "尾甲", "zh-Hant": "尾甲" },
    short: { "zh-Hans": "让对手无法对己方使出先制招式。", "zh-Hant": "讓對手無法對我方使出先制招式。" },
  },
  "beads-of-ruin": {
    name:  { "zh-Hans": "灾祸之珠", "zh-Hant": "災禍之珠" },
    short: { "zh-Hans": "除自己外所有宝可梦的特防下降。", "zh-Hant": "除自己外所有寶可夢的特防下降。" },
  },
  "commander": {
    name:  { "zh-Hans": "指令塔", "zh-Hant": "指令塔" },
    short: { "zh-Hans": "场上有米诺多龙时,进入其口中下达指令。", "zh-Hant": "場上有米諾多龍時,進入其口中下達指令。" },
  },
  "costar": {
    name:  { "zh-Hans": "同台共演", "zh-Hant": "同台共演" },
    short: { "zh-Hans": "登场时复制同伴的能力变化。", "zh-Hant": "登場時複製同伴的能力變化。" },
  },
  "cud-chew": {
    name:  { "zh-Hans": "反刍", "zh-Hant": "反芻" },
    short: { "zh-Hans": "吃下树果后,在下一回合结束时再次发动效果。", "zh-Hant": "吃下樹果後,在下一回合結束時再次發動效果。" },
  },
  "dragonize": {
    name:  { "zh-Hans": "龙化", "zh-Hant": "龍化" },
    short: { "zh-Hans": "一般属性招式变为龙属性,威力提升20%。", "zh-Hant": "一般屬性招式變為龍屬性,威力提升20%。" },
  },
  "earth-eater": {
    name:  { "zh-Hans": "食土", "zh-Hant": "食土" },
    short: { "zh-Hans": "受到地面属性招式时不会损血反而回复HP。", "zh-Hant": "受到地面屬性招式時不會損血反而回復HP。" },
  },
  "electromorphosis": {
    name:  { "zh-Hans": "电力转换", "zh-Hant": "電力轉換" },
    short: { "zh-Hans": "受到攻击时,下一次电属性招式威力翻倍。", "zh-Hant": "受到攻擊時,下一次電屬性招式威力翻倍。" },
  },
  "good-as-gold": {
    name:  { "zh-Hans": "黄金体躯", "zh-Hant": "黃金體軀" },
    short: { "zh-Hans": "免疫对手的变化招式。", "zh-Hant": "免疫對手的變化招式。" },
  },
  "guard-dog": {
    name:  { "zh-Hans": "看门犬", "zh-Hant": "看門犬" },
    short: { "zh-Hans": "被威吓时攻击提升;无法被强制替换。", "zh-Hant": "被威嚇時攻擊提升;無法被強制替換。" },
  },
  "hadron-engine": {
    name:  { "zh-Hans": "强子引擎", "zh-Hant": "強子引擎" },
    short: { "zh-Hans": "登场时展开电气场地;场地存在时特攻提升。", "zh-Hant": "登場時展開電氣場地;場地存在時特攻提升。" },
  },
  "lingering-aroma": {
    name:  { "zh-Hans": "残留之香", "zh-Hant": "殘留之香" },
    short: { "zh-Hans": "接触自己的对手特性变为残留之香。", "zh-Hant": "接觸自己的對手特性變為殘留之香。" },
  },
  "mega-sol": {
    name:  { "zh-Hans": "超级日光", "zh-Hant": "超級日光" },
    short: { "zh-Hans": "即使不是大晴天,也能像在强烈日照下一样使用招式。", "zh-Hant": "即使不是大晴天,也能像在強烈日照下一樣使用招式。" },
  },
  "mycelium-might": {
    name:  { "zh-Hans": "菌丝之力", "zh-Hant": "菌絲之力" },
    short: { "zh-Hans": "使用变化招式时必定后手,但无视对方特性。", "zh-Hant": "使用變化招式時必定後手,但無視對方特性。" },
  },
  "opportunist": {
    name:  { "zh-Hans": "顺手牵羊", "zh-Hant": "順手牽羊" },
    short: { "zh-Hans": "复制对手的能力提升。", "zh-Hant": "複製對手的能力提升。" },
  },
  "orichalcum-pulse": {
    name:  { "zh-Hans": "绯红脉动", "zh-Hant": "緋紅脈動" },
    short: { "zh-Hans": "登场时让天气变为大晴天;日照强烈时攻击提升。", "zh-Hant": "登場時讓天氣變為大晴天;日照強烈時攻擊提升。" },
  },
  "piercing-drill": {
    name:  { "zh-Hans": "贯通钻头", "zh-Hant": "貫通鑽頭" },
    short: { "zh-Hans": "接触类招式能贯穿守住类防护,但只造成原本1/4的伤害。", "zh-Hant": "接觸類招式能貫穿守住類防護,但只造成原本1/4的傷害。" },
  },
  "protosynthesis": {
    name:  { "zh-Hans": "古代活性", "zh-Hant": "古代活性" },
    short: { "zh-Hans": "大晴天或携带能量块时,最高的能力提升。", "zh-Hant": "大晴天或攜帶能量塊時,最高的能力提升。" },
  },
  "purifying-salt": {
    name:  { "zh-Hans": "洁净之盐", "zh-Hant": "潔淨之鹽" },
    short: { "zh-Hans": "免疫所有状态异常;受到幽灵属性招式的伤害减半。", "zh-Hant": "免疫所有狀態異常;受到幽靈屬性招式的傷害減半。" },
  },
  "quark-drive": {
    name:  { "zh-Hans": "夸克充能", "zh-Hant": "夸克充能" },
    short: { "zh-Hans": "电气场地或携带能量块时,最高的能力提升。", "zh-Hant": "電氣場地或攜帶能量塊時,最高的能力提升。" },
  },
  "rocky-payload": {
    name:  { "zh-Hans": "搬岩", "zh-Hant": "搬岩" },
    short: { "zh-Hans": "提升岩石属性招式的威力。", "zh-Hant": "提升岩石屬性招式的威力。" },
  },
  "seed-sower": {
    name:  { "zh-Hans": "掉出种子", "zh-Hant": "掉出種子" },
    short: { "zh-Hans": "受到攻击时,场地变为青草场地。", "zh-Hant": "受到攻擊時,場地變為青草場地。" },
  },
  "sharpness": {
    name:  { "zh-Hans": "锋锐", "zh-Hant": "鋒銳" },
    short: { "zh-Hans": "提升切斩类招式的威力。", "zh-Hant": "提升切斬類招式的威力。" },
  },
  "spicy-spray": {
    name:  { "zh-Hans": "辣味喷雾", "zh-Hant": "辣味噴霧" },
    short: { "zh-Hans": "受到招式伤害时,让攻击者灼伤。", "zh-Hant": "受到招式傷害時,讓攻擊者灼傷。" },
  },
  "supreme-overlord": {
    name:  { "zh-Hans": "大将", "zh-Hant": "大將" },
    short: { "zh-Hans": "每有一只倒下的伙伴,攻击与特攻提升10%。", "zh-Hant": "每有一隻倒下的夥伴,攻擊與特攻提升10%。" },
  },
  "sword-of-ruin": {
    name:  { "zh-Hans": "灾祸之剑", "zh-Hant": "災禍之劍" },
    short: { "zh-Hans": "除自己外所有宝可梦的防御下降。", "zh-Hant": "除自己外所有寶可夢的防禦下降。" },
  },
  "tablets-of-ruin": {
    name:  { "zh-Hans": "灾祸之简", "zh-Hant": "災禍之簡" },
    short: { "zh-Hans": "除自己外所有宝可梦的攻击下降。", "zh-Hant": "除自己外所有寶可夢的攻擊下降。" },
  },
  "thermal-exchange": {
    name:  { "zh-Hans": "热交换", "zh-Hant": "熱交換" },
    short: { "zh-Hans": "受到火属性招式时攻击提升;不会被灼伤。", "zh-Hant": "受到火屬性招式時攻擊提升;不會被灼傷。" },
  },
  "toxic-debris": {
    name:  { "zh-Hans": "毒满地", "zh-Hant": "毒滿地" },
    short: { "zh-Hans": "受到物理招式时,对方场地撒下毒菱。", "zh-Hant": "受到物理招式時,對方場地撒下毒菱。" },
  },
  "vessel-of-ruin": {
    name:  { "zh-Hans": "灾祸之器", "zh-Hant": "災禍之器" },
    short: { "zh-Hans": "除自己外所有宝可梦的特攻下降。", "zh-Hant": "除自己外所有寶可夢的特攻下降。" },
  },
  "well-baked-body": {
    name:  { "zh-Hans": "焦香之躯", "zh-Hant": "焦香之軀" },
    short: { "zh-Hans": "免疫火属性招式,且防御大幅提升。", "zh-Hant": "免疫火屬性招式,且防禦大幅提升。" },
  },
  "wind-power": {
    name:  { "zh-Hans": "风力发电", "zh-Hant": "風力發電" },
    short: { "zh-Hans": "受到风属性招式时,下一次电属性招式威力翻倍。", "zh-Hant": "受到風屬性招式時,下一次電屬性招式威力翻倍。" },
  },
  "wind-rider": {
    name:  { "zh-Hans": "风韵", "zh-Hant": "風韻" },
    short: { "zh-Hans": "受到风属性招式或顺风时不损血且攻击提升。", "zh-Hant": "受到風屬性招式或順風時不損血且攻擊提升。" },
  },
  "zero-to-hero": {
    name:  { "zh-Hans": "化身英雄", "zh-Hant": "化身英雄" },
    short: { "zh-Hans": "回到精灵球后,再次出场时变为强大形态。", "zh-Hant": "回到精靈球後,再次出場時變為強大形態。" },
  },

  // ─── Indigo Disk / The Hidden Treasure of Area Zero abilities ────────────
  "embody-aspect": {
    name:  { "zh-Hans": "面影辉映", "zh-Hant": "面影輝映" },
    short: { "zh-Hans": "太晶化时让面具映射出已逝精灵的力量,根据面具不同提升对应能力。", "zh-Hant": "太晶化時讓面具映射出已逝精靈的力量,根據面具不同提升對應能力。" },
  },
  "hospitality": {
    name:  { "zh-Hans": "款待", "zh-Hant": "款待" },
    short: { "zh-Hans": "登场时回复同伴宝可梦25%的最大HP。", "zh-Hant": "登場時回復同伴寶可夢25%的最大HP。" },
  },
  "minds-eye": {
    name:  { "zh-Hans": "心眼", "zh-Hant": "心眼" },
    short: { "zh-Hans": "无视对手的回避率变化和命中率下降,可用一般和格斗招式击中幽灵属性。", "zh-Hant": "無視對手的迴避率變化和命中率下降,可用一般和格鬥招式擊中幽靈屬性。" },
  },
  "poison-puppeteer": {
    name:  { "zh-Hans": "毒傀儡", "zh-Hant": "毒傀儡" },
    short: { "zh-Hans": "被自己招式中毒的对手同时也会陷入混乱状态。", "zh-Hant": "被自己招式中毒的對手同時也會陷入混亂狀態。" },
  },
  "supersweet-syrup": {
    name:  { "zh-Hans": "甘露之蜜", "zh-Hant": "甘露之蜜" },
    short: { "zh-Hans": "每场战斗中首次登场时,降低对手的回避率1级。", "zh-Hant": "每場戰鬥中首次登場時,降低對手的迴避率1級。" },
  },
  "tera-shell": {
    name:  { "zh-Hans": "太晶甲壳", "zh-Hant": "太晶甲殼" },
    short: { "zh-Hans": "HP全满时,所有受到的招式都变为效果不佳。", "zh-Hant": "HP全滿時,所有受到的招式都變為效果不佳。" },
  },
  "tera-shift": {
    name:  { "zh-Hans": "太晶变形", "zh-Hant": "太晶變形" },
    short: { "zh-Hans": "太乐巴戈斯登场时,变为太晶形态直至战斗结束。", "zh-Hant": "太樂巴戈斯登場時,變為太晶形態直至戰鬥結束。" },
  },
  "teraform-zero": {
    name:  { "zh-Hans": "归零化境", "zh-Hant": "歸零化境" },
    short: { "zh-Hans": "太乐巴戈斯变为星晶形态时,场上的天气和场地效果立即消除。", "zh-Hant": "太樂巴戈斯變為星晶形態時,場上的天氣和場地效果立即消除。" },
  },
  "toxic-chain": {
    name:  { "zh-Hans": "毒锁链", "zh-Hant": "毒鎖鏈" },
    short: { "zh-Hans": "用招式攻击命中时,有时会让对手陷入剧毒状态。", "zh-Hant": "用招式攻擊命中時,有時會讓對手陷入劇毒狀態。" },
  },

  // ─── Champions Regulation M-B original Mega abilities ────────────────────
  // Official localized names from the M-B launch coverage (うなぎのぼり/鰻鰻高升,
  // ほのおのたてがみ/火焰鬃毛). EN name + JA name/flavor live in the PokeAPI CSVs;
  // these fill the zh-Hans/zh-Hant gaps. (Raichu X/Y reuse stock electric-surge /
  // no-guard, which already ship full translations.)
  "eelevate": {
    name:  { "zh-Hans": "鳗鳗高升", "zh-Hant": "鰻鰻高升" },
    short: { "zh-Hans": "如同飘浮,免疫地面属性招式以及撒菱、毒菱、黏黏网,击倒对手时自身最高能力提升1阶。", "zh-Hant": "如同飄浮,免疫地面屬性招式以及撒菱、毒菱、黏黏網,擊倒對手時自身最高能力提升1階。" },
  },
  "fire-mane": {
    name:  { "zh-Hans": "火焰鬃毛", "zh-Hant": "火焰鬃毛" },
    short: { "zh-Hans": "火属性招式的威力始终变为1.5倍。", "zh-Hant": "火屬性招式的威力始終變為1.5倍。" },
  },
};
