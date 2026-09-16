# pokeDD

A Pokémon Champions competitive companion — Pokémon / move / ability / item
database, team builder with URL sharing, single-mon analyzer, and a
damage calculator that knows the meta.

🎮 **Live site:** **[www.pokedd.com](https://www.pokedd.com)**
⭐ **If pokeDD is useful, please star this repo!**

## What it does

- **Pokédex** — every Champions-legal Pokémon (`/pokemon-champions/pokemon`)
  with localized names, stats, learnsets, type matchups, and per-mon
  usage % drawn from monthly Smogon ladder dumps.
- **Move / ability / item catalogs** with sortable tables, multi-language
  search, and competitive usage badges.
- **Team Builder** — six slots, no account, share a team via URL. Type
  coverage + defense / offense matrices update live as you tweak.
- **Pokémon Builder** — focus on a single mon: speed tier vs the top 30,
  OHKO probability against the meta (your moves vs theirs), 1v1 outcome
  badges, custom comparison list.
- **Damage Calculator** — full damage formula with weather / terrain /
  screens / status / hazards / ~25 ability modifiers / item modifiers /
  always-crit + multi-hit handling.
- **My Pokémon** — localStorage stash of saved builds, surfaced as a
  floating Poké Ball bottom-left of every page. Load saved builds into
  either builder in one click.
- **Singles + Doubles** — the Nav toggle switches every usage stat
  (top moves / items / abilities / spreads) between the Champions BSS
  and VGC chaos dumps.
- **i18n** — full English / 日本語 / 简体中文 / 繁體中文 support, including
  hand-curated translations for Gen 9 abilities and moves that
  PokeAPI hasn't catalogued.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) App Router + Turbopack |
| Language | TypeScript strict |
| Styling | Tailwind v4 |
| i18n | [next-intl v4](https://next-intl.dev/) |
| DB | [Neon Postgres](https://neon.tech) accessed via Prisma 6 |
| Deploy | [Vercel](https://vercel.com) (pdx1 region, co-located with Neon) |
| Data sources | [PokeAPI](https://pokeapi.co) CSV dump + [Smogon](https://www.smogon.com/stats/) chaos JSON |

## Getting started locally

```bash
# 1. Install
npm install

# 2. Set up DB credentials
cp .env.example .env
#   ... then fill in DATABASE_URL (pooled) + DIRECT_URL (unpooled) for Neon

# 3. Pull the public data (PokeAPI CSVs + Smogon Champions chaos JSON)
bash scripts/refresh-data.sh

# 4. Apply migrations + seed
npx prisma migrate deploy
npm run db:import

# 5. Run the dev server
npm run dev
```

Visit `http://localhost:3000` — the app redirects `/` → `/pokemon-champions`.

For deeper architectural notes (framework gotchas, data import pipeline,
debugging recipes), see [`AGENTS.md`](./AGENTS.md).

## Contributing

Issues and PRs welcome. Translation fixes especially — Gen 9 abilities
and Champions-specific moves still need community review for accuracy.
If you spot something off in the live site, file an issue with a
screenshot and the page URL.

## Star me

If pokeDD has helped you build a team or won you a game, give the repo
a ⭐ — it helps me prioritize features and translations.

[![Star on GitHub](https://img.shields.io/github/stars/Seancheey/PokeDD?style=social)](https://github.com/Seancheey/PokeDD)

## License

MIT.

## Regulation M-C data update

M-C runs from 2026-09-09 02:00 UTC through 2026-12-02 01:59 UTC.
The [official rules](https://champions-news.pokemon-home.com/en/page/816.html)
and [eligible roster](https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178713870219xeaaio/en/pokemon.html)
are the eligibility sources. `src/lib/champions-regulation.ts` lists all new
entries, including alternate genders/colors and the six Mega Evolutions.

`prisma/data/champions-mc.json` contains the new forms' stats, types, weights,
abilities, and Champions learnsets, checked against Pokémon Showdown on
2026-09-16 (source URLs are recorded in the file). These tracked overrides
survive a fresh PokeAPI CSV download. Mega forms inherit their base form's
Champions learnset; Aura Guard and the five new stones are supplied by the
translated overrides. Salamencite already exists in PokeAPI.

```bash
npm run db:import -- --dry-run  # validates all additions without database writes
npm run db:import             # atomically replaces catalog data; keeps short links
node --import tsx scripts/test-regulation-mc.ts
```

The importer prefers M-C usage dumps, then M-B/M-A. Until Smogon publishes
M-C statistics, the landing page labels the imported historical regulation
and explicitly says M-C usage is pending. Roster eligibility never depends
on a new Pokémon appearing in those usage dumps.
