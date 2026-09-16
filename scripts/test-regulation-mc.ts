/** Run after db:import: node --import tsx scripts/test-regulation-mc.ts */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { CHAMPIONS_MC_ADDITIONS, usageRegulation } from "../src/lib/champions-regulation";
import { EMPTY_TEAM, encodeTeam, decodeTeam } from "../src/lib/team-share";
import { parseShowdownText } from "../src/lib/showdown-import";

const db = new PrismaClient();
async function main() {
  const [pokemon, moves, abilities, items, regulation] = await Promise.all([
    db.pokemon.findMany({ where: { slug: { in: [...CHAMPIONS_MC_ADDITIONS] } } }),
    db.move.findMany({ select: { slug: true } }),
    db.ability.findMany({ select: { slug: true } }),
    db.item.findMany({ where: { games: { contains: '"pokemon-champions"' } } }),
    db.regulation.findUniqueOrThrow({ where: { slug: "reg-m-c" } }),
  ]);
  assert.equal(pokemon.length, 35);
  const moveSlugs = new Set(moves.map((m) => m.slug));
  const abilitySlugs = new Set(abilities.map((a) => a.slug));
  for (const p of pokemon) {
    assert.ok(JSON.parse(p.games).includes("pokemon-champions"), p.slug);
    assert.ok(JSON.parse(p.regulations).includes("reg-m-c"), p.slug);
    for (const locale of ["en", "ja", "zh-Hans", "zh-Hant"]) assert.ok(JSON.parse(p.nameI18n)[locale], `${p.slug}: ${locale}`);
    assert.ok([p.hp, p.atk, p.def, p.spa, p.spd, p.spe].every((stat) => stat > 0), p.slug);
    const learnset: string[] = JSON.parse(p.learnableMoves);
    assert.ok(learnset.length > 0, p.slug);
    assert.ok(learnset.every((move) => moveSlugs.has(move)), p.slug);
    assert.ok(JSON.parse(p.abilities).length > 0, p.slug);
    for (const ability of [...JSON.parse(p.abilities), p.hiddenAbility].filter(Boolean)) assert.ok(abilitySlugs.has(ability), `${p.slug}: ${ability}`);
  }
  const find = (slug: string) => pokemon.find((p) => p.slug === slug)!;
  assert.deepEqual(JSON.parse(find("lucario-mega-z").abilities), ["aura-guard"]);
  assert.equal(find("lucario-mega-z").spe, 151);
  assert.equal(find("garchomp-mega-z").type2, null);
  assert.deepEqual(JSON.parse(find("garchomp-mega-z").abilities), ["levitate"]);
  assert.equal(find("absol-mega-z").type2, "ghost");
  assert.equal(find("golisopod-mega").type2, "steel");
  assert.deepEqual(JSON.parse(find("golisopod-mega").abilities), ["tough-claws"]);
  assert.ok(JSON.parse(find("rillaboom").learnableMoves).includes("grassy-glide"));
  assert.ok(JSON.parse(find("indeedee-female").learnableMoves).includes("follow-me"));
  for (const slug of ["absolite-z", "salamencite", "garchompite-z", "lucarionite-z", "golisopite", "baxcalibrite", "stick", "rocky-helmet", "air-balloon", "red-card", "binding-band", "eject-button", "normal-gem", "terrain-extender", "electric-seed", "psychic-seed", "misty-seed", "grassy-seed"]) {
    assert.ok(items.some((item) => item.slug === slug), slug);
  }
  assert.equal(regulation.validFrom.toISOString(), "2026-09-09T02:00:00.000Z");
  assert.equal(regulation.validTo?.toISOString(), "2026-12-02T01:59:00.000Z");
  assert.equal(usageRegulation('{"doubles":{"source":"smogon-championsvgc2026regmb-0.json"}}'), "M-B");
  assert.equal(usageRegulation('{"doubles":{"source":"smogon-championsvgc2026regmc-0.json"}}'), "M-C");
  assert.equal(usageRegulation("invalid"), null);
  assert.equal(EMPTY_TEAM.reg, "M-C");
  const imported = parseShowdownText("Lucario-Mega-Z @ Lucarionite Z\nAbility: Aura Guard\nTimid Nature\n- Aura Sphere\n- Protect", {
    speciesSlugs: new Set(pokemon.map((p) => p.slug)), moveSlugs, abilitySlugs,
    itemSlugs: new Set(items.map((i) => i.slug)),
    learnableBySpecies: new Map(pokemon.map((p) => [p.slug, new Set<string>(JSON.parse(p.learnableMoves))])),
    validAbilitiesBySpecies: new Map(pokemon.map((p) => [p.slug, new Set<string>(JSON.parse(p.abilities))])),
  });
  assert.equal(imported.team.reg, "M-C");
  assert.equal(imported.team.slots[0].s, "lucario-mega-z");
  assert.equal(imported.team.slots[0].i, "lucarionite-z");
  assert.equal(imported.warnings.length, 0);
  const team = { ...EMPTY_TEAM, slots: [{ s: "lucario-mega-z", a: "aura-guard", i: "lucarionite-z" }] };
  assert.deepEqual(await decodeTeam(await encodeTeam(team)), team);
  console.log("M-C passed: 35 entries, six Megas, learnsets, abilities, stones, locales, dates and team sharing.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
