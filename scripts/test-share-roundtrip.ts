import { encodeTeam, decodeTeam, type TeamShare } from "../src/lib/team-share";

async function main() {
  const team: TeamShare = {
    v: 1,
    reg: "M-A",
    fmt: "doubles",
    slots: [
      {
        s: "garchomp",
        a: "rough-skin",
        i: "choice-scarf",
        m: ["earthquake", "dragon-claw"],
        v: [1, 32, 0, 0, 1, 32],
        n: "Jolly",
      },
      { s: "indeedee-female", a: "psychic-surge", n: "Calm" },
    ],
  };
  const enc = await encodeTeam(team);
  console.log("encoded length:", enc.length);
  const dec = await decodeTeam(enc);
  const match = JSON.stringify(dec) === JSON.stringify(team);
  console.log("round-trip match:", match);
  if (!match) {
    console.log("got:", JSON.stringify(dec));
    console.log("want:", JSON.stringify(team));
    process.exit(1);
  }
}
main();
