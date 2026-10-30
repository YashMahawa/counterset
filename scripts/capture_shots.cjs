// Real screenshots of the studio for the public page. Runs the recorded agent, then frames three moments.
// NODE_PATH must reach playwright; CHROME_PATH points at Chrome.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/studio?day=bonnaroo-2026-sunday&watch=1`);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("finished"), null, { timeout: 240000 });
  await page.waitForTimeout(900);
  const shot = (name, el) => page.locator(el).screenshot({ path: `web/assets/shot-${name}.png` });
  await page.locator(".trace").evaluate((n) => (n.scrollTop = 0));
  await shot("trace", ".trace");
  await page.click('#views button[data-view="blind0"]').catch(() => {});
  await page.waitForTimeout(900);
  await shot("blind", ".card.timetable");
  await page.click('#views button[data-view="opt0"]');
  await page.waitForTimeout(900);
  await shot("rescue", ".card.timetable");
  await page.click('#steps button[data-index="2"]');
  await page.waitForTimeout(400);
  await page.click('#panel tr.pick[data-a]');
  await page.waitForTimeout(600);
  await shot("pair", "#inspector");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
