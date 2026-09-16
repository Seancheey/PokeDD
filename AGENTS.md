<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working in pokeDD

A Pokémon Champions companion app — Pokémon/move/ability/item database, team builder with URL sharing, damage calculator. Live at https://www.pokedd.com.

This document distills lessons from many rounds of building this codebase. Read it before you touch anything; the framework choices and data quirks are not obvious from the file tree alone.

## Stack at a glance

| Layer | Choice | Why it matters |
|---|---|---|
| Framework | **Next.js 16.2.6**, App Router, Turbopack default | Several breaking changes from older Next; see "Framework gotchas" |
| Language | TypeScript strict | `npx tsc --noEmit` catches real bugs the dev server skips |
| Styling | Tailwind v4 | New `@theme inline` + CSS vars (in `src/app/globals.css`) |
| i18n | **next-intl v4** with `localePrefix: "as-needed"` | English at `/foo`, others at `/<locale>/foo` |
| DB | **Neon Postgres** (`us-west-2`), accessed via Prisma 6 | Pooled + direct URLs both required |
| Deploy | **Vercel** (`pdx1` region, co-located with Neon) | Custom domain `www.pokedd.com` |
| Data | PokeAPI CSV dump + Smogon chaos JSON, imported into Postgres | Re-buildable from scratch in ~30s |

## Project layout

```
src/
  app/
    layout.tsx                       Minimal HTML shell; reads getLocale() for <html lang>
    icon.svg                         Pokéball favicon (auto-registered by Next)
    [locale]/                        Every user-facing route lives under here
      layout.tsx                     Wraps NextIntlClientProvider, Nav, Footer
      page.tsx                       redirects "/" → "/pokemon-champions"
      pokemon-champions/
        page.tsx                     Hub (Top 10 by usage, quick-tools)
        pokemon/page.tsx, [slug]/page.tsx
        moves/page.tsx,   [slug]/page.tsx
        abilities/...
        items/...
        team-builder/page.tsx + TeamBuilderClient.tsx
        damage-calc/page.tsx + DamageCalcClient.tsx
        teams/                       Still a placeholder
  components/
    Nav.tsx                          Top nav (server, async, with i18n)
    LocaleSwitcher.tsx               Client; preserves current path on lang change
    TypeChip.tsx                     Colored pill — auto-translated via Types.* keys
    CategoryBadge.tsx                Physical/Special/Status — auto-translated
    Combobox.tsx                     Searchable dropdown with usage % badges (THE primary dropdown)
    PlaceholderPage.tsx              Used only by /teams now
  lib/
    db.ts                            Prisma client singleton
    cn.ts                            clsx + tailwind-merge helper
    types.ts                         POKEMON_TYPES, TYPE_COLORS map
    type-chart.ts                    Full 18×18 effectivenessAgainst()
    damage.ts                        Full damage formula (nature/stages/abilities/items/...)
    team-share.ts                    gzip+base64url codec for ?share= URLs
    i18n-pokemon.ts                  localizedPokemonName / Move / Ability / Item helpers
  i18n/
    routing.ts                       defineRouting({ locales, defaultLocale: "en", localePrefix: "as-needed" })
    request.ts                       getRequestConfig — locale → messages bundle
    navigation.ts                    Locale-aware Link / redirect / useRouter
  proxy.ts                           Next 16: was middleware.ts, RENAMED to proxy.ts

messages/
  en.json | ja.json | zh-Hans.json | zh-Hant.json
                                     All UI strings. Same shape across locales.

prisma/
  schema.prisma                      Postgres schema. JSON-shaped fields stay TEXT.
  import-pokeapi.ts                  Main importer (PokeAPI CSVs + Smogon JSON)
  ability-overrides.ts               Hand-curated zh-Hans/Hant for Gen 9 abilities
  seed.ts                            Old SQLite-era seed; rarely used now
  migrations/                        Postgres migrations (5 so far)

data/pokeapi/                        Gitignored. Downloaded CSVs + Smogon JSON.

PRD.md                               Original product brief — internal planning doc only.
vercel.json                          { "regions": ["pdx1"] }
.env                                 Gitignored — real DATABASE_URL + DIRECT_URL
.env.example                         Tracked — placeholder values
```

## Framework gotchas you WILL hit

These are non-obvious; they tripped me up at some point.

### Next.js 16

- **`params` and `searchParams` are Promises.** Must `await` them.
  ```ts
  export default async function Page({
    params,
  }: {
    params: Promise<{ slug: string; locale: string }>;
  }) {
    const { slug, locale } = await params;
  }
  ```
- **`middleware.ts` is renamed `proxy.ts`.** The function name + matcher config moved too. Old name shows a deprecation warning at dev startup.
- **`PageProps<'/route'>` is a global helper** — generated by `next dev` / `next build` / `next typegen`. Use it for full type safety on `params` and `searchParams`.
- **Turbopack is the default builder.** No need to pass `--turbopack`. If a build fails because a webpack config is detected, switch to `--webpack` only as a fallback.
- **Look at `node_modules/next/dist/docs/` before guessing.** The local docs reflect this exact version; web docs and your training are likely stale.

### next-intl v4

- **Use `Link` from `@/i18n/navigation`, not `next/link`.** The i18n version prepends the locale prefix correctly. Native `<a href>` does not.
- **Our `Link` has `prefetch={false}` by default.** Entity pages render hundreds of links (a Pokémon's ~100-move learnset, a move's learners), and next/link's viewport prefetch turned one page view into hundreds of server requests. Every page is `force-dynamic` with no `loading.tsx`, so a prefetch only fetches the shared layout shell and the client discards it — there is nothing to gain. Do not opt links back in unless a route becomes static or gains a loading boundary.
- **Call `setRequestLocale(locale)` in every page that uses translations.** Without it, the page becomes dynamic and statically-rendered locales break.
- **Locales are `en`, `ja`, `zh-Hans`, `zh-Hant`.** Hyphenated; the routing uses BCP 47 script tags (`Hans`/`Hant`), not region codes.
- **Server components use `getTranslations()`** (async). Client components use `useTranslations()` (sync).
- **HTML `<link rel="alternate" hreflang>` is auto-emitted** for each locale — visible in response headers. Don't add it manually.

### Prisma 6 + Neon

- **Two URLs.** `DATABASE_URL` is the pooled (PgBouncer) connection used by the running app. `DIRECT_URL` is the unpooled one used by `prisma migrate`. Both must be set in `.env` AND on Vercel. The direct URL omits `-pooler` from the hostname.
- **Restart `next dev` after every `prisma migrate dev`.** The Prisma client is regenerated, but the running dev server holds the old module in memory.
- **JSON-shaped columns are TEXT, not jsonb.** Multi-lang search uses `contains:` against the raw JSON string. If you switch to `jsonb`, the substring search breaks; you'd need `@>` operators instead.
- **`contains:` is case-sensitive on Postgres by default.** Pass `mode: "insensitive"` on every list-page search. SQLite was case-insensitive by default — this changed when we migrated.

### Vercel

- **`.env*` matches `.env.example`** in `.gitignore` patterns. Use `!.env.example` to negate.
- **`.vercelignore`** controls what gets uploaded with each `vercel deploy`. Without it, the build warns about your local `.env` being uploaded (still safe — runtime uses encrypted Vercel env vars — but unnecessary).
- **`postinstall: prisma generate`** is required so the build can find the typed client.
- **`vercel-build: prisma migrate deploy && next build`** applies pending migrations on every prod deploy. Idempotent — safe to re-run.

## i18n data model

There are TWO i18n systems and you need to understand which is which.

### Static UI strings → `messages/<locale>.json`

App copy: nav labels, page titles, button text, etc. Read with `useTranslations("Namespace")` or `getTranslations("Namespace")`.

**Adding a new string** means editing all 4 message files. Skipping a locale doesn't fall back gracefully — it'll show the key name (e.g. `Hub.heroTitle`).

### Dynamic entity names → DB JSON columns

Pokémon / move / ability / item names + descriptions are stored as JSON-stringified maps:

```
nameI18n      '{"en":"Incineroar","ja":"ガオガエン","zh-Hans":"炽焰咆哮虎","zh-Hant":"熾焰咆哮虎"}'
shortDescI18n '{"en":"…","ja":"…",…}'
longDescI18n  '{"en":"…",…}'
```

Always read via the helpers in `src/lib/i18n-pokemon.ts`:
```ts
const name = localizedPokemonName(p, locale);   // never read p.name directly in UI
const desc = localizedAbilityShortDesc(a, locale);
```

These fall back: `parsed[locale] ?? parsed.en ?? rawFallback`. So missing locales degrade to English.

**Multi-lang search**: I do `OR: [{ name }, { nameI18n }, { slug }]` with `contains: q, mode: "insensitive"`. The raw JSON column matches because the localized values are embedded as substrings in the text.

## Component patterns

### Every dropdown should use `<Combobox>`

`src/components/Combobox.tsx` is the canonical searchable dropdown. Features built-in:
- Search input with keyboard nav (↑/↓ + Enter, Esc)
- Per-option `usagePct` badge (green ≥50%, amber ≥10%, gray below)
- `prefix` and `suffix` slots (sprites, type chips, etc.)
- `allowClear` for "(none)" option
- Caps visible list at 80; prompts "type to filter" when over

Used everywhere: species pickers, ability/item/move pickers, nature picker, spread preset picker, damage calc move picker.

Pattern for building options:
```ts
const options: ComboboxOption[] = items.map((it) => ({
  value: it.slug,
  label: it.name,
  searchText: it.slug,        // matches even when UI is non-English
  usagePct: pctByItem.get(it.slug),
}));
```

### Localized type display: `<TypeChip>`

Renders a colored pill with the type name. Localized via `Types.*` translation keys. Always pass the type slug:
```tsx
<TypeChip type={p.type1 as PokemonType} />
<TypeChip type={p.type2 as PokemonType} size="sm" />
```

### Localized category display: `<CategoryBadge>`

For move categories (physical / special / status). Auto-translates via `Moves.category*` keys. Shared client component — DON'T inline a CategoryBadge in a page; you'll have to convert the page to a client component, and you'll forget the translation.

## Data import pipeline

Everything in the DB is rebuildable from public sources. Nothing is hand-edited inside Postgres.

### Sources

1. **PokeAPI CSV dump** — https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
   - 1,025 Pokémon species + form variants (1350 total entities)
   - 937 moves, 311 abilities, 2176 items
   - en / ja / zh-Hans / zh-Hant names for most entries
   - Long-form English mechanic descriptions in `ability_prose.csv`, `move_effect_prose.csv`, `item_prose.csv`

2. **Smogon chaos JSON** — https://www.smogon.com/stats/2026-04/chaos/gen9vgc2026regi-1760.json
   - Per-Pokémon top abilities / items / moves / EV spreads with weighted counts
   - Used for `usagePct`, `rank`, and the `usageStats` JSON blob

### Running the import

```bash
# First time: download the CSVs + JSON manually (already on disk if you've worked here before)
mkdir -p data/pokeapi
# ...then:
npm run db:import     # rebuilds Pokemon/Move/Ability/Item tables from scratch
```

The importer does `deleteMany` + `createMany` — idempotent and fast on Postgres (~30s).

### Quirks you'll hit

- **`*_flavor_text.csv` files use column `language_id`** (no `local_` prefix), but `*_names.csv` files use `local_language_id`. `buildFlavorI18n` falls back between them. This bit me hard once.
- **Move flavor text spans multiple lines in quoted fields.** `csv-parse` handles it as long as you use the standard options (`columns: true`, `relax_quotes: true`).
- **Move effects are keyed by `move_effect_id`, not `move_id`.** Two-step lookup: `moves.csv` → `effect_id` → `move_effect_prose.csv`.
- **`$effect_chance` placeholder** in move prose needs substitution from the move row's `effect_chance` column.
- **PokeAPI ships only EN + JA names for Gen 9 abilities.** zh-Hans/Hant are missing for ~35 entries (Lingering Aroma, Protosynthesis, Quark Drive, …). Workaround: `prisma/ability-overrides.ts` hand-curates them. Same pattern can apply to moves/items if needed (not yet built).
- **`||` not `??` when merging** name maps. `buildNameI18n` initializes missing locales with empty strings (not undefined), and `"" ?? override` evaluates to `""`, not the override. Use `||` so empty falls through.
- **Mega forms often have empty `pokemon_moves` rows** in PokeAPI. The importer falls back to the species' default-form learnset to avoid empty Team Builder move dropdowns on Megas.
- **Form names sometimes embed the species name** already (JA "メガリザードンＸ" contains "リザードン"). The importer detects this and uses `form_name` directly instead of wrapping as `species (form_name)`.

## Common tasks — recipes

### Add a new translated UI string

1. Edit all 4 of `messages/{en,ja,zh-Hans,zh-Hant}.json` with the same key.
2. Server component: `const t = await getTranslations("Namespace"); t("yourKey")`.
3. Client component: `const t = useTranslations("Namespace"); t("yourKey")`.

If you forget a locale, the page shows the literal key name. Run `for f in messages/*.json; do python3 -c "import json; json.load(open('$f'))"; done` to validate JSON.

### Add a new column to Pokemon/Move/Ability/Item

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name short_description_of_change` (against Neon — uses `DIRECT_URL`).
3. Update `prisma/import-pokeapi.ts` to populate the new column.
4. Run `npm run db:import`.
5. **Kill and restart `npm run dev`** — Prisma Client regen alone doesn't refresh the running server.
6. Update any UI that should display the new column. Use `localizedXxx` helpers if it's locale-aware.

### Add a new route under `/pokemon-champions/...`

1. Create `src/app/[locale]/pokemon-champions/your-route/page.tsx`.
2. Add `setRequestLocale(locale)` at the top (after awaiting params).
3. Add new translation keys for the page title, headings, etc. to all 4 message files.
4. Add the route to `src/components/Nav.tsx`'s `SECTION_LINKS` if it should appear in the global nav.

### Wire up a new ability/item/move modifier in the damage calc

`src/lib/damage.ts` has clearly-marked sections:
- Attacker ability boosts (around `// Attacker ability boosts on move type / kind`)
- Defender ability damping
- Item modifiers

Add one line in the appropriate section. The `notes` array surfaces the modifier in the UI's "Modifiers applied" pills, so use a recognizable label.

If the modifier needs to know move flags (contact, punch, bite, etc.), use the hardcoded sets at the top of `damage.ts` (`CONTACT_MOVES`, `PUNCH_MOVES`, …). PokeAPI ships flag data in `move_flag_map.csv` but the importer doesn't ingest it yet.

### Add zh-Hans/zh-Hant for a Gen 9 ability/item/move

Follow `prisma/ability-overrides.ts`. The pattern is reusable — copy it to `prisma/item-overrides.ts` or `prisma/move-overrides.ts` if needed.

### Deploy to production

```bash
vercel --prod     # local files uploaded directly, no git push required
# OR
git push          # if Git integration is enabled on the Vercel project
```

Custom domain: `www.pokedd.com`. Region: `pdx1`. Build verifies migrations apply before bundling.

## Debugging recipes

### "My change isn't showing up locally"

```bash
kill $(pgrep -f "next dev"); npm run dev
```

Especially after Prisma migrations. The dev server caches the Prisma module.

### "The localized name is showing English"

The DB row likely has an empty value for that locale. Verify:
```bash
psql "$DIRECT_URL" -c "SELECT slug, \"nameI18n\" FROM \"Pokemon\" WHERE slug='whatever';"
```

If the JSON lacks the locale: it's a data gap, not a UI bug. Hand-curate via an overrides file or accept the English fallback.

### "Search isn't finding a Japanese name"

`url-encode the query`. Curl with `--data-urlencode "q=ガオガエン"`. Browsers do this automatically; only the test harness needs manual encoding.

### "The page isn't rendering the data I just imported"

The dev server keeps an in-memory snapshot. Restart `npm run dev`. If still wrong, check the DB directly with `psql` to confirm the data is there.

### "TypeScript errors only show in build, not dev"

Run `npx tsc --noEmit` before committing. Or `npm run build`. Dev mode is permissive.

### "React serialization is breaking my grep tests"

React inserts `<!-- -->` between adjacent text expressions to separate them after hydration. Tests need to allow for this:
```python
re.search(r'>([0-9]+\.[0-9])<!-- -->%<', html)   # not >X.X%<
```

### "I need to query Neon directly"

The pooled URL (`-pooler` in hostname) handles app queries fine, but for ad-hoc psql sessions use the direct URL:
```bash
DIRECT_URL=$(grep DIRECT_URL .env | cut -d'"' -f2)
psql "$DIRECT_URL"
```

## What's NOT done (intentional and unintentional gaps)

Worth knowing before you assume something exists.

### Intentional (deferred to a later phase)

- **`/teams` is a placeholder.** Tournament/community team browser is on the roadmap (PRD §5.8) but not built.
- **No accounts.** Personal teams persist only via `?share=` URL. Auth + saved teams is out of scope per the PRD.
- **No damage-calc parity test suite vs Pikalytics.** PRD §13 asks for 200 hand-computed scenarios. We have ~5 spot-checks inline in the commit history.

### Known data gaps

- **zh-Hans/Hant for Gen 9 moves and items** — not curated. Currently fall back to English. Pattern from `ability-overrides.ts` would extend cleanly.
- **Tournament-team data.** No DB table for `Team` yet. Schema sketched in PRD §6.
- **Move flags in DB.** Currently hardcoded sets in `damage.ts`. PokeAPI has the data in `move_flag_map.csv`; importing would unlock universal Strong Jaw / Iron Fist / etc. behavior.
- **TM-number column on Pokémon learnsets.** Bulbapedia/52poke list moves by TM number; we list by all-learnable. Would need `machines.csv` import + Champions-mapping.
- **Cosmetic forms clutter the team-builder species picker.** All 20 Vivillon patterns / Burmy cloaks / etc. appear. Not filtered out.
- **Item category badges** show raw slugs ("held", "choice", etc.) — not translated like move categories are. Easy follow-up.

### Architectural shortcuts to revisit

- **Pokemon.learnableMoves is denormalized JSON** (~75 move slugs per mon, ~1MB total). Fine for our scale; if learnsets ever query-able by move (e.g. "which mons learn Earthquake?"), a proper `PokemonMove` join table would be better.
- **Team Builder ships ~2MB of HTML** to hydrate the species picker with learnsets. After gzip ~300-500KB. For now acceptable; lazy-loading via server actions is the upgrade path.
- **The Smogon dump is a static April 2026 snapshot.** A monthly cron to refresh would keep usage stats current. PRD §7 sketches this; not built.

## Safety conventions

- **Never commit `.env`.** Verified gitignored. `.env.example` is the placeholder template (committed).
- **Don't echo `DATABASE_URL` in logs or screenshots.** Treat it as a credential even though Neon's URLs are scoped to a single DB.
- **Production deploys via `vercel --prod` should be explicit.** Don't auto-deploy on every commit unless the user wires up Git integration. Current setup: Vercel CLI from local.
- **Read `node_modules/next/dist/docs/` before changing framework conventions.** The local docs match the installed Next version.
- **Restart dev after migrations.** Forgetting this is the #1 source of "my change doesn't work" debugging sessions.

## Quick command cheat-sheet

```bash
# Local dev
npm run dev                              # start dev server (Turbopack)
npx tsc --noEmit                         # typecheck
npm run build                            # production build (catches more than dev does)

# Database
npx prisma migrate dev --name foo        # add a migration
npx prisma migrate reset --force         # nuke + reapply (also re-runs seed if hooked)
npm run db:import                        # rebuild Pokemon/Move/Ability/Item from PokeAPI+Smogon
psql "$DIRECT_URL"                       # ad-hoc query Neon

# Deploy
vercel --prod                            # deploy local files to production
vercel env ls                            # list env vars on Vercel
vercel inspect <deployment-url> --logs   # check function logs

# Refresh PokeAPI source data
cd data/pokeapi && for f in $(ls *.csv *.json); do
  curl -sf "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/$f" -o "$f"
done
```

## When in doubt

- **Confirm DB state before changing UI**: `psql "$DIRECT_URL" -c "SELECT … FROM \"Ability\" WHERE slug='x';"` — empty descriptions often mean the import has a bug, not the renderer.
- **Run `npm run build` before claiming "it works"** — dev mode skips many type and lint checks.
- **Read git log for recent commits before refactoring** — many decisions have context that isn't in the code (form-name heuristics, the `??` vs `||` bug, the SQLite→Postgres migration's ripple effects).
- **The PRD (`PRD.md`) is a planning doc**, not a spec. It describes the original intent; the code is the current truth.

— Drafted from the working notes of the agent who built this. Updates welcome as the codebase evolves.
