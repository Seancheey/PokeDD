import { encodeTeam, decodeTeam, type TeamShare } from "../src/lib/team-share";

const team: TeamShare = {
  v: 1,
  reg: "M-B",
  fmt: "doubles",
  slots: [
    { s: "charizard-mega-y", a: "drought", m: ["heat-wave", "solar-beam", "protect", "tailwind"], v: [4, 0, 0, 252, 0, 252], n: "Timid" },
    { s: "incineroar", a: "intimidate", i: "safety-goggles", m: ["fake-out", "flare-blitz", "knock-off", "parting-shot"], v: [252, 4, 0, 0, 252, 0], n: "Careful" },
    { s: "venusaur", a: "chlorophyll", i: "life-orb", m: ["sludge-bomb", "giga-drain", "sleep-powder", "protect"], v: [4, 0, 0, 252, 0, 252], n: "Modest" },
    { s: "garchomp", a: "rough-skin", i: "clear-amulet", m: ["earthquake", "dragon-claw", "stomping-tantrum", "protect"], v: [4, 252, 0, 0, 0, 252], n: "Jolly" },
    { s: "sinistcha", a: "hospitality", i: "leftovers", m: ["matcha-gotcha", "rage-powder", "calm-mind", "protect"], v: [252, 0, 156, 0, 100, 0], n: "Bold" },
    { s: "kingambit", a: "supreme-overlord", i: "black-glasses", m: ["kowtow-cleave", "sucker-punch", "iron-head", "protect"], v: [252, 252, 0, 0, 4, 0], n: "Adamant" },
  ],
};

const payload = await encodeTeam(team);
const url = `https://www.pokedd.com/pokemon-champions/team-builder?share=${payload}`;
console.log("payload length:", payload.length);
console.log(url);

// round-trip verify
const back = await decodeTeam(payload);
console.log("decode ok:", back?.reg === "M-B" && back?.slots.length === 6);
console.log("slots:", back?.slots.map((s) => s.s).join(", "));
