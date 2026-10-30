// Real clicks through the public page and the rescue desk at desktop and phone width.
// Needs a running server, Playwright on NODE_PATH and Chrome at CHROME_PATH. Uses recorded decisions and no model.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const fails = [];
const check = (name, ok, more = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${more ? " · " + more : ""}`);
  if (!ok) fails.push(name);
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  for (const size of WIDTHS) {
    const tag = size.width;
    console.log(`--- ${tag}px`);
    const context = await browser.newContext({ viewport: size, hasTouch: size.width < 500 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

    await page.goto(BASE + "/");
    await page.waitForSelector("#curfew button");
    check("public page: replay loads", (await page.textContent("#saved")).trim().length > 0);
    await page.click('#curfew button[data-value="1440"]');
    await page.click('#shortest button[data-value="75"]');
    const at75 = +(await page.textContent("#saved"));
    await page.click('#shortest button[data-value="100"]');
    const atFull = +(await page.textContent("#saved"));
    check("public page: gentler terms cannot play more sets", at75 >= atFull, `${atFull} full, ${at75} at 75%`);
    await page.click("#asrun");
    check("public page: what really happened shows 17", (await page.textContent("#saved")).trim() === "17");
    await page.click("#asrun");
    await page.evaluate(() => document.querySelector("#stage-range").scrollIntoView());
    await page.click('#stage-names button[data-i="2"]');
    await page.waitForTimeout(300);
    check("public page: stepping the agent changes the clause", (await page.textContent("#stage-clause")).includes("checks"));
    check("public page: no sideways scroll", (await overflow()) <= 1, `${await overflow()}px`);

    await page.goto(BASE + "/studio?day=bonnaroo-2026-sunday&watch=1");
    await page.waitForSelector(".trace li", { timeout: 60000 });
    check("desk: agent steps appear", true);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("finished"), null, { timeout: 240000 });
    const steps = await page.locator(".trace li").count();
    check("desk: agent finishes with a trace", steps >= 8, `${steps} steps`);
    const finding = await page.textContent("#step-finding");
    check("desk: finding names the outcome", /of 28 sets play/.test(finding), finding);
    const state = await page.evaluate(() => fetch("/api/projects").then((r) => r.json()));
    check("desk: nothing changed before approval", (await page.textContent("#day-meta")).includes("draft"));
    await page.click('#views button[data-view="asrun"]');
    await page.waitForTimeout(800);
    check("desk: as-run view shows cancelled sets", (await page.locator(".set.cut").count()) === 11);
    await page.click('#views button[data-view="blind0"]');
    await page.waitForTimeout(800);
    check("desk: without-Qloo view opens", (await page.locator(".set").count()) === 28);
    await page.click('#views button[data-view="opt0"]');
    await page.waitForTimeout(800);
    check("desk: no sideways scroll", (await overflow()) <= 1, `${await overflow()}px`);
    await page.screenshot({ path: `test-results/desk-${tag}-rescue.png` });
    await page.click('#step-actions button[data-action="publish"]');
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Published"), null, { timeout: 20000 });
    check("desk: approval publishes v1", (await page.textContent("#day-meta")).includes("v1 published"));
    await page.click('#steps button[data-index="6"]');
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-format="csv"]')]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    check("desk: CSV export carries status", csv.includes("status") && csv.includes("Noah Kahan"));

    await page.goto(BASE + "/studio?day=lollapalooza-2024-saturday");
    await page.waitForSelector(".set");
    await page.click('#steps button[data-index="5"]');
    await page.click('[data-action="repair"]');
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Repairs ready"), null, { timeout: 90000 });
    check("desk: an ordinary repair still works on another day", (await page.locator(".set.moved").count()) > 0);
    check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await context.close();
  }
  await browser.close();
  console.log(fails.length ? `FAILED: ${fails.join(", ")}` : "All checks passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
