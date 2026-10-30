// Real clicks and keys through the public page and the desk at desktop and phone width.
// Needs a running server, Playwright on NODE_PATH and Chrome at CHROME_PATH.
// LIVE=1 also runs live agent runs and a replaced lineup through real Qloo calls and the real model.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
const LIVE = !!process.env.LIVE;
const RUN = 300000;
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const TEMPLATES = ["outside-lands-2026-saturday", "bonnaroo-2026-sunday", "lollapalooza-2024-saturday", "outside-lands-2026-friday"];
const fails = [];
const check = (name, ok, more = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${more ? " · " + more : ""}`);
  if (!ok) fails.push(name);
};
let active;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: (process.env.CHROME_ARGS || "").split(" ").filter(Boolean) });
  for (const size of WIDTHS) {
    const tag = size.width;
    const phone = tag < 500;
    console.log(`--- ${tag}px`);
    const context = await browser.newContext({ viewport: size, hasTouch: phone });
    const page = await context.newPage();
    active = page;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const sideways = async (name) => check(`${name}: no sideways scroll`, (await overflow()) <= 1, `${await overflow()}px`);
    const headline = () => page.textContent(".headline");
    const stage = () => page.getAttribute("#flow", "data-stage");

    // ---------- The opening ----------
    await page.goto(BASE + "/");
    const shown = await page.evaluate(() => {
      const l = document.querySelector(".loader");
      return !!l && getComputedStyle(l).display !== "none" && l.querySelector("svg").getBoundingClientRect().width > 150;
    });
    check("opening: a big icon shows on first load", shown);
    await page.waitForTimeout(2400);
    const gone = await page.evaluate(() => getComputedStyle(document.querySelector(".loader")).visibility === "hidden" || getComputedStyle(document.querySelector(".loader")).display === "none");
    check("opening: it clears by itself", gone);

    // ---------- The public page ----------
    await page.waitForSelector("#curfew button");
    await page.waitForSelector("#try-days a[href*=template]");
    check("public page: lists four days to try", (await page.locator("#try-days a").count()) === 4);
    for (const at of ["#try", "#replay", "#qloo", "#questions"]) {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ behavior: "instant" }), at);
      await page.waitForTimeout(250);
      const bar = await page.evaluate(() => {
        const b = document.querySelector(".bar");
        const c = getComputedStyle(b);
        return { bg: c.backgroundColor, top: b.getBoundingClientRect().top };
      });
      check(`public page: bar stays solid over ${at}`, bar.bg === "rgb(0, 0, 0)" && bar.top === 0);
    }
    await page.click('#curfew button[data-value="1440"]');
    await page.click('#shortest button[data-value="75"]');
    const at75 = +(await page.textContent("#saved"));
    await page.click('#shortest button[data-value="100"]');
    const atFull = +(await page.textContent("#saved"));
    check("public page: gentler terms cannot play more sets", at75 >= atFull, `${atFull} full, ${at75} at 75%`);
    await page.click("#asrun");
    check("public page: what really happened shows 17", (await page.textContent("#saved")).trim() === "17");
    await sideways("public page");

    // ---------- From the public page to step 1 ----------
    await page.evaluate(() => document.querySelector("#try").scrollIntoView({ behavior: "instant" }));
    await page.click('#try-days a[href*="lollapalooza"]');
    await page.waitForTimeout(250);
    check("switch: the mark covers the screen on the way out", await page.evaluate(() => {
      const l = document.querySelector(".loader.leaving");
      return !!l && l.getBoundingClientRect().top < innerHeight && getComputedStyle(l).visibility !== "hidden";
    }));
    await page.waitForSelector(".template");
    check("step 1: the chosen day is selected", (await page.getAttribute('.template[data-id="lollapalooza-2024-saturday"]', "aria-pressed")) === "true");
    check("step 1: its lines are in the box", (await page.inputValue("#l-text")).includes("Ethel Cain"));
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".loader")).visibility === "hidden");
    check("switch: the cover lifts on the new page", true);
    await page.reload();
    check("opening: it plays again on reload", await page.evaluate(() => {
      const l = document.querySelector(".loader");
      return getComputedStyle(l).display !== "none" && getComputedStyle(l.querySelector(".l-set")).animationName !== "none";
    }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".loader")).visibility === "hidden");
    await sideways("step 1");

    // ---------- Every template opens with real clashes ----------
    const clashesOf = {};
    for (const id of TEMPLATES) {
      await page.goto(BASE + "/studio");
      await page.waitForSelector(".template");
      await page.click(`.template[data-id="${id}"]`);
      const text = await page.inputValue("#l-text");
      check(`${id}: lines fill the box`, text.split("\n").length >= 13, `${text.split("\n").length} lines`);
      await page.click("#l-go");
      await page.waitForSelector("#agent-message", { timeout: 30000 });
      await page.waitForTimeout(400);
      const n = await page.locator(".clash-row").count();
      clashesOf[id] = await headline();
      check(`${id}: shows real clashes at once`, n > 0 && (await page.locator(".set.clash").count()) >= 2, (await headline()).trim());
      check(`${id}: says why in Qloo's terms`, /(closest match|top \d+ of \d+)/.test(await page.textContent(".clash-row span")), (await page.textContent(".clash-row span")).trim());
      check(`${id}: an example problem is ready to edit`, (await page.inputValue("#agent-message")).length > 20);
      await sideways(id);
    }

    // ---------- A clash explains itself ----------
    await page.goto(BASE + "/studio?template=outside-lands-2026-saturday");
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#agent-message");
    await page.click(".clash-row");
    await page.waitForSelector("#flow-detail .rank");
    check("clash: selecting one shows both ranks", (await page.textContent("#flow-detail")).includes("#1 of 11"));
    await page.click('#flow-detail [data-action="deselect"]');
    check("clash: it closes again", await page.locator("#flow-detail").isHidden());

    // ---------- Enter ----------
    await page.fill("#agent-message", "");
    await page.focus("#agent-message");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    check("enter: an empty box asks for words and starts nothing", (await stage()) === "fix" && (await page.textContent("#status")).includes("what went wrong"));
    await page.keyboard.type("first line");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    await page.waitForTimeout(200);
    check("enter: shift+enter makes a new line", (await stage()) === "fix" && (await page.inputValue("#agent-message")) === "first line\nsecond line");

    // ---------- Editing a template keeps its Qloo rows ----------
    await page.click('#flow [data-action="path-day"]');
    await page.waitForSelector("#l-text");
    const lines = await page.inputValue("#l-text");
    check("edit: back on step 1 with the same lines", lines.includes("The xx"));
    // The xx moves to an hour clear of The Strokes: one clash gone, nothing asked of Qloo.
    await page.fill("#l-text", lines.replace("Twin Peaks | The xx | 20:10 | 21:25", "Twin Peaks | The xx | 19:30 | 20:30"));
    let spent = 0;
    const counter = (r) => /\/identify|\/evidence/.test(r.url()) && spent++;
    page.on("request", counter);
    await page.click("#l-go");
    await page.waitForSelector("#agent-message", { timeout: 30000 });
    page.off("request", counter);
    check("edit: moving a set asks Qloo nothing", spent === 0, `${spent} calls`);
    check("edit: the clash count follows the edit", (await headline()).includes("2 clashes"), (await headline()).trim());
    check("edit: the example problem stays", (await page.inputValue("#agent-message")).includes("Sutro"));

    // ---------- Bad input ----------
    await page.goto(BASE + "/studio");
    await page.waitForSelector(".template");
    await page.click("#l-clear");
    check("replace: clearing empties the box and the choice", (await page.inputValue("#l-text")) === "" && (await page.locator('.template[aria-pressed="true"]').count()) === 0);
    await page.fill("#l-text", "this is not a lineup");
    await page.click("#l-go");
    await page.waitForFunction(() => document.querySelector("#new-error").textContent.includes("Line 1"));
    check("replace: a bad line says which line and how", true, await page.textContent("#new-error"));

    // ---------- Moving a set by hand ----------
    if (!phone) {
      await page.goto(BASE + "/studio?template=outside-lands-2026-friday");
      await page.waitForSelector(".template");
      await page.click("#l-go");
      await page.waitForSelector("#agent-message");
      const before = (await headline()).trim();
      const set = page.locator(".set", { hasText: "Odd Mob" });
      const box = await set.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 340, box.y + 20, { steps: 8 });
      await page.mouse.up();
      await page.waitForSelector('#status [data-action="undo"]');
      check("drag: moving a set re-counts the clashes", (await page.textContent("#status")).includes("clashes"), (await page.textContent("#status")).trim().slice(0, 90));
      await page.click('[data-action="undo"]');
      await page.waitForFunction((t) => document.querySelector(".headline").textContent.trim() === t, before);
      check("drag: undo restores the day", true);
    }

    // ---------- All the details ----------
    await page.goto(BASE + "/studio?template=outside-lands-2026-friday");
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#agent-message");
    if (!phone) {
      await page.click("#ui-toggle");
      check("details: the full desk opens", (await page.locator("#steps").isVisible()) && (await page.locator("#step-title").isVisible()));
      await page.click("#ui-toggle");
      check("details: back to the simple path", (await page.locator("#flow").isVisible()) && (await page.locator("#steps").isHidden()));
    }

    // ---------- The saved run ----------
    await page.goto(BASE + "/studio?template=bonnaroo-2026-sunday");
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#agent-message");
    check("storm: the real day says it plays a saved run", (await page.textContent("#ask-note")).includes("saved run"));
    await page.focus("#agent-message");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#flow").dataset.stage === "running");
    check("storm: enter starts it", true);
    await page.waitForSelector("#approve", { timeout: RUN });
    check("storm: labelled as a saved run", (await page.textContent("#flow .eyebrow")).includes("saved run"));
    check("storm: more sets play than on the day", /27 of 28|28 sets/.test(await headline()), (await headline()).trim());
    check("storm: it compares with the real day", (await page.textContent(".tally")).includes("on the real day"));
    await page.reload();
    await page.waitForSelector("#approve");
    check("storm: a reload keeps the plan", true);

    if (LIVE) {
      // ---------- A live run, by Enter alone ----------
      const id = phone ? "outside-lands-2026-friday" : "outside-lands-2026-saturday";
      await page.goto(`${BASE}/studio?template=${id}`);
      await page.waitForSelector(".template");
      await page.click("#l-go");
      await page.waitForSelector("#agent-message");
      await page.focus("#agent-message");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#flow").dataset.stage === "running");
      check("live: enter starts the agent", (await page.textContent("#flow .eyebrow")).includes("Live"));
      await page.waitForSelector("#approve", { timeout: RUN });
      await page.waitForTimeout(800);
      check("live: a plan comes back", true, (await headline()).trim());
      check("live: labelled live", (await page.textContent("#flow .eyebrow")).includes("live"));
      check("live: no clash left on the plan", (await page.locator(".set.clash").count()) === 0 && (await page.textContent(".tally")).includes("→ 0"), (await page.textContent(".tally")).replace(/\s+/g, " "));
      check("live: says what Qloo changed", (await page.textContent(".flow-say")).includes("Without Qloo"), (await page.textContent(".flow-say")).trim());
      await page.click('#views [data-view="blind0"]');
      await page.waitForTimeout(800);
      check("live: without Qloo shows the clashes", (await page.locator(".set.clash").count()) >= 2);
      await page.click('#views [data-view="draft"]');
      await page.waitForTimeout(300);
      await page.click('#views [data-view="opt0"]');
      await page.click("#approve");
      await page.waitForFunction(() => document.querySelector("#flow").dataset.stage === "sent");
      check("live: a person approves it", (await headline()).includes("version 1"));
      await page.waitForFunction(() => document.querySelector("#share-link")?.value.includes("/schedule#"));
      const link = await page.inputValue("#share-link");
      check("live: messages are drafted", (await page.locator('[data-action="copy-note"]').count()) > 0);
      const shared = await context.newPage();
      await shared.goto(link);
      await shared.waitForSelector(".tile");
      check("share link: the timetable opens from the link alone", (await shared.locator(".tile").count()) >= 13);
      await shared.close();
      await page.click('[data-action="again"]');
      await page.waitForSelector("#agent-message");
      check("live: something else can go wrong after", (await page.inputValue("#agent-message")) === "");

      // ---------- Replacing a template with anything ----------
      await page.goto(BASE + "/studio");
      await page.waitForSelector(".template");
      await page.click("#l-clear");
      await page.fill("#l-name", "My own day");
      await page.fill("#l-text", "Main | Mitski | 20:30 | 21:30\nMain | Djo | 18:30 | 19:30\nTent | Weyes Blood | 20:45 | 21:45\nTent | Khruangbin | 18:45 | 19:45\nField | Japanese Breakfast | 20:15 | 21:15\nField | Beach House | 19:00 | 20:00");
      await page.click("#l-go");
      await page.waitForFunction(() => document.querySelector("#flow")?.dataset.stage === "loading");
      check("own day: it goes straight to reading", true);
      await page.waitForSelector("#agent-message", { timeout: RUN });
      check("own day: Qloo reads it with no other button", true, (await headline()).trim());
      await page.fill("#agent-message", "Tent is closed 18:45 to 19:45 for a sound fault. Curfew is 23:00.");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => ["plan", "noplan"].includes(document.querySelector("#flow").dataset.stage), null, { timeout: RUN });
      check("own day: the agent finishes", (await stage()) === "plan", (await headline()).trim());
      await page.reload();
      await page.waitForSelector("#flow[data-stage]");
      check("own day: a reload keeps it", (await page.title()).includes("My own day"));
      await page.goto(BASE + "/studio");
      await page.waitForSelector("#days-list a");
      check("own day: it is listed", (await page.textContent("#days-list")).includes("My own day"));
    }

    await sideways("end of run");
    check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await context.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED:\n` + fails.join("\n") : "\nAll checks passed");
  process.exit(fails.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  try {
    console.error("On screen:", (await active.textContent("#flow, body")).slice(0, 400));
  } catch {}
  process.exit(1);
});
