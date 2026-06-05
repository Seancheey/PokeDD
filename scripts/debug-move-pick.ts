import { chromium } from "playwright";
import fs from "node:fs";

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/zh-Hans/pokemon-champions/damage-calc");
  await page.waitForLoadState("networkidle");
  await sleep(1);

  // Pick attacker
  await page.locator(`button[aria-label="宝可梦"]`).first().click();
  await sleep(0.5);
  const atkInput = page.locator('div[role="dialog"] input').first();
  await atkInput.pressSequentially("goodra-hisui", { delay: 40 });
  await sleep(0.5);
  await page.locator('div[role="dialog"] li[role="option"]').first().click();
  await sleep(2);

  await page.screenshot({ path: "video-out/dbg-after-attacker.png" });

  // Pick move
  console.log("move-label buttons:", await page.locator(`button[aria-label="招式"]`).count());
  await page.locator(`button[aria-label="招式"]`).first().click();
  await sleep(0.5);
  await page.screenshot({ path: "video-out/dbg-move-dialog-empty.png" });

  const moveInput = page.locator('div[role="dialog"] input').first();
  await moveInput.pressSequentially("heavy-slam", { delay: 40 });
  await sleep(0.8);
  await page.screenshot({ path: "video-out/dbg-move-typed.png" });

  // Log all visible options
  const optTexts = await page.locator('div[role="dialog"] li[role="option"]').allInnerTexts();
  console.log("options after 'heavy-slam' query:", optTexts);

  // Try clicking with force (since the option might be obscured by something).
  await page.locator('div[role="dialog"] li[role="option"]').first().click();
  await sleep(0.5);
  await page.screenshot({ path: "video-out/dbg-after-click.png" });

  // Re-open and check trigger label
  const triggerText = await page.locator(`button[aria-label="招式"]`).first().innerText();
  console.log("trigger after click:", triggerText);

  await browser.close();
}
main().catch(console.error);
