// Real clicks through the public page and the rescue desk at desktop and phone width.
// Needs a running server, Playwright on NODE_PATH and Chrome at CHROME_PATH. LIVE=1 also runs a visitor's own lineup through real Qloo calls and the real model.
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
let active;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  for (const size of WIDTHS) {
    const tag = size.width;
    console.log(`--- ${tag}px`);
    const context = await browser.newContext({ viewport: size, hasTouch: size.width < 500 });
    const page = await context.newPage();
    active = page;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

    await page.goto(BASE + "/");
    await page.waitForSelector("#curfew button");
    for (const at of ["#start", "#replay", "#agent", "#qloo", "#questions"]) {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ behavior: "instant" }), at);
      await page.waitForTimeout(350);
      const bar = await page.evaluate(() => {
        const b = document.querySelector(".bar");
        const c = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return { bg: c.backgroundColor, color: c.color, top: r.top };
      });
      check(`public page: bar stays solid over ${at}`, bar.bg === "rgb(0, 0, 0)" && bar.color === "rgb(255, 255, 255)" && bar.top === 0, `${bar.bg} on ${bar.color}`);
    }
    check("public page: replay loads", (await page.textContent("#saved")).trim().length > 0);
    await page.click('#curfew button[data-value="1440"]');
    await page.click('#shortest button[data-value="75"]');
    const at75 = +(await page.textContent("#saved"));
    await page.click('#shortest button[data-value="100"]');
    const atFull = +(await page.textContent("#saved"));
    check("public page: gentler terms cannot play more sets", at75 >= atFull, `${atFull} full, ${at75} at 75%`);
    await page.click("#asrun");
    check("public page: what really happened shows 17", (await page.textContent("#saved")).trim() === "17");
    await page.click("#yours");
    check("public page: back to your choices", (await page.textContent("#saved")).trim() === String(atFull));
    await page.evaluate(() => document.querySelector("#stage-names").scrollIntoView());
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
    await page.waitForFunction(() => document.querySelector("#share-link")?.value.includes("/schedule#"), null, { timeout: 20000 });
    const link = await page.inputValue("#share-link");
    check("desk: approval offers messages for each act", (await page.locator('[data-action="copy-note"]').count()) > 5);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-format="csv"]')]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    check("desk: CSV export carries status", csv.includes("status") && csv.includes("Noah Kahan"));
    const shared = await context.newPage();
    await shared.goto(link);
    await shared.waitForSelector(".tile");
    check("share link: the timetable opens from the link alone", (await shared.locator(".tile").count()) >= 20 && (await shared.textContent("#name")).includes("Bonnaroo"));
    check("share link: no sideways scroll", (await shared.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    await shared.screenshot({ path: `test-results/share-${tag}.png` });
    await shared.close();

    // A visitor's own lineup, live: real Qloo lookups and ranks, then the real model and solver.
    if (process.env.LIVE) {
      // From the public page, as a visitor would: the sample is already filled in.
      await page.goto(BASE + "/");
      await page.evaluate(() => document.querySelector("#start").scrollIntoView({ behavior: "instant" }));
      await page.click("#start-form button");
      await page.waitForSelector('#dialog [data-direct="yes"]', { timeout: 120000 });
      check("own lineup: Qloo finds the acts", /Qloo found \d+ of 11 acts/.test(await page.textContent("#dialog-title")), await page.textContent("#dialog-title"));
      await page.click('#dialog [data-direct="yes"]');
      await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Live Qloo rows loaded"), null, { timeout: 180000 });
      check("own lineup: live rows load", (await page.locator(".set").count()) === 11);
      if (size.width > 800) {
        // Drag a set on the timetable: it saves, the audit answers, and undo puts it back.
        const set = page.locator('.set.movable', { hasText: "Dijon" });
        await set.scrollIntoViewIfNeeded();
        const box = await set.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + 20, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("moved to"), null, { timeout: 30000 });
        check("own lineup: dragging a set moves it and re-audits", /clashes: \d+ before, \d+ now/.test(await page.textContent("#status")), (await page.textContent("#status")).slice(0, 90));
        await page.click('#status [data-action="undo"]');
        await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("undone"), null, { timeout: 30000 });
        check("own lineup: undo restores it", true);
      }
      await page.goto(page.url());
      await page.waitForSelector(".set");
      check("own lineup: a reload keeps the day", (await page.locator(".set").count()) === 11);
      await page.goto(BASE + "/studio");
      await page.waitForSelector(".day-list a");
      check("your days: the day is listed", (await page.textContent(".day-list")).includes("My festival"));
      await page.click(".day-list a");
      await page.waitForSelector(".set");
      await page.click('#steps button[data-index="3"]');
      await page.fill("#agent-message", "Sound desk failure: Sutro stage is closed 17:30 to 18:30. Ethel Cain cannot go on before 18:30. What can we do?");
      await page.click('#step-actions button[data-mode="live"]');
      await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("agent has finished"), null, { timeout: 280000 });
      check("own lineup: live agent finishes with a plan", /of 11 sets play/.test(await page.textContent("#step-finding")), (await page.textContent("#step-finding")).slice(0, 80));
      await page.screenshot({ path: `test-results/own-${tag}.png` });
      await page.click('#step-actions button[data-action="publish"]');
      await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Published"), null, { timeout: 30000 });
      check("own lineup: a person approves it", true);
      await page.waitForFunction(() => document.querySelector("#share-link")?.value.includes("/schedule#"), null, { timeout: 20000 });
      check("own lineup: the approved day has a share link", true);
    }

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
})().catch(async (e) => {
  console.error(e);
  const seen = await active?.evaluate(() => [location.href, document.querySelector("#status")?.textContent, document.querySelector(".note.bad")?.textContent, document.querySelector("#step-finding")?.textContent]).catch(() => null);
  console.error("On screen:", seen);
  process.exit(1);
});
