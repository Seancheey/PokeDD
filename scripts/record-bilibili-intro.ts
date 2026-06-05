/**
 * Bilibili intro recorder. Drives Chromium through the demo flow, timed to
 * the per-segment Tingting TTS audio durations.
 * Run:  npx tsx scripts/record-bilibili-intro.ts
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("video-out");
const VIDEO_DIR = path.join(OUT_DIR, "raw-frames");
const BASE = "http://localhost:3000";

const D = { s1: 8.0, s2: 12.6, s3: 8.7, s4: 26.5, s5: 16.4, s6: 6.2 };
const GAP = 0.4;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

// Pick from a Combobox: click the trigger by aria-label, type into the popup
// search input (which auto-focuses), then click the first matching option.
// Clicking the option (vs Enter) is more reliable when the filtered list
// changes asynchronously after fill().
async function pickCombo(page: Page, ariaLabel: string, query: string, which: "first" | "last" = "first") {
  const triggers = page.locator(`button[aria-label="${ariaLabel}"]`);
  const trigger = which === "first" ? triggers.first() : triggers.last();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await sleep(0.5);
  const dialog = page.locator('div[role="dialog"]').last();
  const input = dialog.locator('input').first();
  await input.waitFor({ state: "visible", timeout: 5000 });
  // Type each character so React re-filters between keystrokes.
  await input.pressSequentially(query, { delay: 40 });
  await sleep(0.6);
  // Click the first remaining option. role="option" elements inside the dialog.
  const firstOption = dialog.locator('li[role="option"]').first();
  await firstOption.click({ timeout: 3000 });
  await sleep(0.3);
}

async function main() {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  // Belt-and-suspenders: hide the Next.js dev overlay if it ever appears.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }`;
    document.documentElement.appendChild(style);
  });

  // ── SEG 1 (≈7.7s): Hook — load hub ─────────────────────────────────────────
  await page.goto(`${BASE}/zh-Hans/pokemon-champions`);
  await page.waitForLoadState("networkidle");
  await sleep(D.s1);

  // ── SEG 2 (≈10.3s): Pain — slow scroll the hub ────────────────────────────
  const wheelSteps = 6;
  for (let i = 0; i < wheelSteps; i++) {
    await page.mouse.wheel(0, 180);
    await sleep((D.s2 - 1.5) / wheelSteps);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(GAP + 1.2);

  // ── SEG 3 (≈8.7s): Solution — stay on hub (default Chinese), briefly hover
  // the language picker to acknowledge multi-language support without dwelling.
  await page.mouse.move(900, 100); // approximate position of the language switcher
  await sleep(1.0);
  // Slow gentle pan across the hub to keep the frame alive.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(D.s3 - 1.0);

  // ── SEG 4 (≈26.5s): Team-builder — Garchomp build + share ────────────────
  // Dismiss the onboarding hint cookie before navigating, so the page renders
  // without the orange "可以保存这套配置" overlay covering the Garchomp slot.
  await page.evaluate(() => {
    try {
      // Common hint keys; cover all the variants the codebase might use.
      ["saveHintDismissed", "tb-save-hint", "pokedd-save-hint"].forEach((k) =>
        localStorage.setItem(k, "1"),
      );
    } catch { /* noop */ }
  });
  await page.goto(`${BASE}/zh-Hans/pokemon-champions/team-builder`);
  await page.waitForLoadState("networkidle");
  await sleep(1.5);

  // Add Garchomp via the empty-slot picker.
  try {
    await pickCombo(page, "添加宝可梦", "garchomp", "first");
  } catch (e) {
    console.warn("addPokemon click failed:", (e as Error).message);
  }
  await sleep(2.0);

  // Try to close the onboarding popover if it shows (best-effort).
  try {
    await page.getByRole("button", { name: /知道了|got it|了解/i }).first().click({ timeout: 1500 });
  } catch { /* no popover — fine */ }
  await sleep(0.6);

  // Linger on the Garchomp slot — keep the SlotCard fully in view.
  // The slot card is the first one near the top after the regulation header.
  for (const top of [100, 250, 450, 650, 450]) {
    await page.evaluate((t) => window.scrollTo({ top: t, behavior: "smooth" }), top);
    await sleep(3.2);
  }

  // Scroll back to top and click share button (try a few common labels).
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(2.0);
  const shareBtn = page.getByRole("button", { name: /分享|share|シェア|分享連結|分享链接/i }).first();
  try {
    await shareBtn.click({ timeout: 1500 });
    await sleep(2.0);
    await page.keyboard.press("Escape");
  } catch {
    /* no share button visible — fine */
  }
  await sleep(0.8);

  // ── SEG 5 (≈16.4s): Damage calc — Hisuian Goodra Heavy Slam ──────────────
  await page.goto(`${BASE}/zh-Hans/pokemon-champions/damage-calc`);
  await page.waitForLoadState("networkidle");
  await sleep(1.5);

  // Attacker = goodra-hisui (first 宝可梦 picker)
  try {
    await pickCombo(page, "宝可梦", "goodra-hisui", "first");
  } catch (e) {
    console.warn("attacker pick failed:", (e as Error).message);
  }
  await sleep(2.0);

  // Move = heavy-slam. Verify selection took effect; retry once if not.
  try {
    await pickCombo(page, "招式", "heavy-slam", "first");
  } catch (e) {
    console.warn("move pick failed:", (e as Error).message);
  }
  let movePicked = await page.locator(`button[aria-label="招式"]`).first().innerText();
  if (!movePicked.includes("重磅")) {
    console.warn(`move pick wrong (${movePicked.trim()}); retrying...`);
    await sleep(0.5);
    try {
      await pickCombo(page, "招式", "heavy-slam", "first");
    } catch (e) {
      console.warn("retry failed:", (e as Error).message);
    }
    movePicked = await page.locator(`button[aria-label="招式"]`).first().innerText();
    console.log("after retry:", movePicked.trim().slice(0, 30));
  }
  await sleep(2.0);

  // Defender = mimikyu-disguised (light Pokémon in Champions roster ⇒ Heavy
  // Slam hits the 120 BP cap, which is the demo's payoff moment).
  try {
    await pickCombo(page, "宝可梦", "mimikyu-disguised", "last");
  } catch (e) {
    console.warn("defender pick failed:", (e as Error).message);
  }
  await sleep(2.5);

  // Scroll just enough to show the result hero + the "Modifiers applied"
  // section with the Heavy Slam BP 120 note.
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: "smooth" }));
  await sleep(2.5);
  await page.evaluate(() => window.scrollTo({ top: 500, behavior: "smooth" }));
  await sleep(2.5);

  // ── SEG 6 (≈5.4s): CTA ────────────────────────────────────────────────────
  await page.goto(`${BASE}/zh-Hans/pokemon-champions`);
  await page.waitForLoadState("networkidle");
  await sleep(D.s6);

  await context.close();
  await browser.close();

  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  if (files.length === 0) throw new Error("No video recorded");
  const dst = path.join(OUT_DIR, "raw.webm");
  fs.renameSync(path.join(VIDEO_DIR, files[0]), dst);
  console.log(`✔ recording saved to ${dst}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
