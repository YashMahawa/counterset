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
    page.on("console", (m) => m.type() === "error" && !/status of (4\d\d|503)/.test(m.text()) && errors.push(m.text()));
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
      await set.scrollIntoViewIfNeeded();
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
    check("storm: the real day says it plays a saved run", /saved run/i.test(await page.textContent("#ask-note")));
    await page.focus("#agent-message");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#flow").dataset.stage === "running");
    check("storm: enter starts it", true);
    await page.waitForSelector("#approve", { timeout: RUN });
    check("storm: labelled as a saved run", /saved run/i.test(await page.textContent("#flow .eyebrow")));
    check("storm: more sets play than on the day", /27 of 28|28 sets/.test(await headline()), (await headline()).trim());
    check("storm: it compares with the real day", (await page.textContent(".tally")).includes("on the real day"));
    await page.reload();
    await page.waitForSelector("#approve");
    check("storm: a reload keeps the plan", true);

    // ---------- What a plan shows below the timetable ----------
    check("plan: a coloured summary shows by default", (await page.locator("#agent-summary").isVisible()) && (await page.textContent("#agent-summary p")).length > 20);
    await page.click('[data-action="summary-more"]');
    check("plan: the summary opens to the changes", (await page.locator("#agent-summary li").count()) > 0, await page.textContent("#agent-summary li"));
    await page.click('[data-action="summary-more"]');
    check("plan: no rescue numbers reach the programmer", !/rescue \d/i.test(await page.textContent("#agent-summary")));
    check("plan: the ask box is there", await page.locator("#ask-agent-form").isVisible());
    check("plan: it compares before, without and with Qloo, clashes first", /Before\s*Without Qloo\s*With Qloo/.test(await page.textContent(".qloo-card thead")) && (await page.textContent(".qloo-card tbody tr:first-child th")) === "Clashes" && (await page.locator(".qloo-card td.best").count()) === 1, (await page.textContent(".qloo-card p")).trim());
    for (const tab of ["messages", "steps", "changes"]) {
      await page.click(`[data-action="lower"][data-tab="${tab}"]`);
      check(`plan: the ${tab} tab opens`, (await page.getAttribute(`[data-action="lower"][data-tab="${tab}"]`, "aria-selected")) === "true" && (await page.textContent(".lower-panel")).trim().length > 10);
    }
    check("plan: suggested questions are offered", (await page.locator('.ask-chips [data-action="ask-chip"]').count()) >= 2);
    // Closed slots hide what cannot play there, and nothing is drawn over a set.
    const closed = await page.evaluate(() => {
      const holds = [...document.querySelectorAll(".frame.hold")];
      const sets = [...document.querySelectorAll(".set")];
      const over = sets.some((s) => holds.some((h) => {
        const a = s.getBoundingClientRect();
        const b = h.getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2 && +getComputedStyle(h).zIndex >= +getComputedStyle(s).zIndex;
      }));
      return { holds: holds.length, over };
    });
    check("plan: closed bands never cover a set", closed.holds > 0 && !closed.over, JSON.stringify(closed));
    await sideways("plan");

    // ---------- Approving twice ----------
    await page.dblclick("#approve");
    await page.waitForFunction(() => document.querySelector("#flow").dataset.stage === "sent", null, { timeout: 30000 });
    check("approve: a double press gives one approval and no error", !errors.some((e) => /proposal_id/.test(e)) && !(await page.textContent("#flow")).includes("Cannot read"), (await headline()).trim());

    // ---------- Every untouched example plays its saved run ----------
    for (const id of TEMPLATES) {
      await page.goto(`${BASE}/studio?template=${id}`);
      await page.waitForSelector(".template");
      await page.click("#l-go");
      await page.waitForSelector("#agent-message", { timeout: 30000 });
      check(`${id}: untouched says saved run`, (await page.textContent("#ask-note")).includes("Saved run") && (await page.textContent("#ask-go")).includes("saved run"));
      await page.selectOption("#lim-short", "75");
      check(`${id}: an option makes it live`, (await page.textContent("#ask-note")).includes("Live run"));
      await page.selectOption("#lim-short", "");
      check(`${id}: undoing the option makes it saved again`, (await page.textContent("#ask-note")).includes("Saved run"));
      await page.click("#ask-go");
      await page.waitForSelector("#approve", { timeout: RUN });
      check(`${id}: says it is a saved run`, /saved run/i.test(await page.textContent("#flow .eyebrow")), (await headline()).trim());
    }

    // ---------- Saved or live ----------
    await page.goto(`${BASE}/studio?template=${TEMPLATES[0]}`);
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#think-switch");
    check("facts: supplied and assumed are both named before a run", /Supplied/.test(await page.textContent(".facts")) && /Assumed, not confirmed/.test(await page.textContent(".facts")) && /Stage swaps/.test(await page.textContent(".facts")));
    check("facts: closed on an example, so the path stays short", !(await page.getAttribute(".facts", "open") !== null));
    check("switch: no thinking level or speed is shown", !(await page.locator("#think-level, .think-lane").count()) && !/thinking/i.test(await page.textContent("#ask-note")));
    await page.click("#think-switch");
    check("switch: running live is one click", (await page.textContent("#ask-go")).includes("Fix this day"));
    let sent = null;
    await page.route("**/agent", (route) => {
      sent = route.request().postDataJSON();
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Test stop" }) });
    });
    await page.click("#ask-go");
    await page.waitForFunction(() => document.querySelector(".run-failed"));
    check("switch: a live request goes out", sent?.mode === "live");
    await page.unroute("**/agent");
    await page.click("#think-switch");
    check("switch: back to the saved run", (await page.textContent("#ask-go")).includes("saved run"));

    // ---------- Before, without Qloo, with Qloo on the plan ----------
    await page.click("#ask-go");
    await page.waitForSelector("#approve", { timeout: RUN });
    check("views: before, without Qloo, with Qloo, in that order", (await page.$$eval("#views button", (x) => x.map((e) => e.textContent).join("|"))) === "Before|Without Qloo|With Qloo");
    await page.click('#views [data-view="blind0"]');
    const banner = await page.textContent("#view-note");
    check("views: the banner says it once", (banner.match(/Without Qloo/g) || []).length === 1, banner);
    check("views: without Qloo lights the clashes", (await page.locator(".set.clash").count()) >= 2);
    await page.click('#views [data-view="opt0"]');
    check("views: with Qloo has none", (await page.locator(".set.clash").count()) === 0);

    // ---------- The home page comparison ----------
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".proof-state");
    check("home: three states with clash counts", /Before[\s\S]*Without Qloo[\s\S]*With Qloo/.test(await page.textContent("#proof-states")) && (await page.locator(".proof-state").count()) === 3);
    check("home: leads with Lollapalooza", /Lollapalooza/.test(await page.textContent('#proof-days [aria-pressed="true"]')) && /Ethel Cain/.test(await page.textContent("#proof-problem")));
    check("home: without Qloo names the pairs and why", (await page.locator("#proof-pairs li").count()) === 4 && /minutes at once/.test(await page.textContent("#proof-pairs")) && /closest match/.test(await page.textContent("#proof-pairs")));
    check("home: the clashing sets are lit", (await page.locator(".p-tile.clash").count()) >= 4);
    await page.click('[data-state="with"]');
    check("home: with Qloo nothing clashes and the pairs are kept apart", (await page.locator(".p-tile.clash").count()) === 0 && /kept apart/.test(await page.textContent("#proof-pairs-title")));
    check("home: says what Qloo costs", /5 sets move/.test(await page.textContent("#proof-cost")));
    check("home: the try link follows the day", (await page.getAttribute("#proof-try", "href")).includes("lollapalooza"));
    await page.click("#proof-days button:nth-child(3)");
    await page.click('[data-state="without"]');
    check("home: another day swaps the board", (await page.locator(".p-tile").count()) > 0 && (await page.locator("#proof-pairs li").count()) > 0);
    const noSideways = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check("home: no sideways page scroll", noSideways);

    // ---------- The mark moves on every switch ----------
    await page.evaluate(() => sessionStorage.setItem("counterset-moving", "1"));
    await page.goto(`${BASE}/studio`);
    const arriving = await page.evaluate(() => {
      const m = document.querySelector(".loader .l-set");
      return document.documentElement.classList.contains("loader-arrive") && (getComputedStyle(m).animationName === "loader-settle-set" || matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    check("mark: arriving, the orange set still slides in", arriving);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".loader")).visibility === "hidden");
    await page.waitForSelector("#try-days a[href*=template]");
    const leave = page.waitForNavigation();
    await page.click("#try-days a[href*=template]");
    const leaving = await page.evaluate(() => {
      const m = document.querySelector(".loader.leaving .l-set");
      return !!m && getComputedStyle(m).animationName.includes("loader-shuttle");
    }).catch(() => false);
    await leave;
    check("mark: leaving, the orange set keeps moving", leaving);

    // ---------- Scrollbars ----------
    const bar = await page.evaluate(() => {
      const out = [];
      for (const s of document.styleSheets) for (const r of s.cssRules) if (r.selectorText?.includes("::-webkit-scrollbar-button")) out.push(r.style.display);
      return out;
    });
    check("scrollbars: no arrows anywhere", bar.includes("none"));

    // ---------- Cancel ----------
    await page.goto(`${BASE}/studio?template=${TEMPLATES[0]}`);
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#ask-go");
    await page.click("#ask-go");
    await page.waitForSelector("#approve", { timeout: RUN });
    await page.click('[data-action="retry"]');
    await page.focus("#agent-message");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#approve");
    check("cancel: esc goes back to the plan", (await stage()) === "plan");
    await page.click('[data-action="retry"]');
    await page.click('[data-action="cancel-edit"]');
    await page.waitForSelector("#approve");
    check("cancel: the button goes back to the plan", (await stage()) === "plan");

    // ---------- Hover keeps text readable ----------
    if (!phone) {
      await page.goto(BASE + "/studio?template=lollapalooza-2024-saturday");
      await page.waitForSelector(".template");
      const luminance = (rgb) => {
        const [r, g, b] = rgb.match(/[\d.]+/g).map(Number).map((v) => v / 255).map((v) => (v < 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = async (selector) => {
        await page.hover(selector);
        await page.waitForTimeout(350);
        const [fg, bg] = await page.evaluate((s) => {
          const c = getComputedStyle(document.querySelector(s));
          return [c.color, c.backgroundColor];
        }, selector);
        const [x, y] = [luminance(fg), luminance(bg)];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const t = await contrast('.template[aria-pressed="true"]');
      check("hover: the chosen day stays readable", t >= 4.5, t.toFixed(1));
      await page.click("#l-go");
      await page.waitForSelector("#agent-message");
      const pathItem = await contrast('#path button:not(:disabled)');
      check("hover: a step in the path stays readable", pathItem >= 4.5, pathItem.toFixed(1));
    }

    // ---------- A live run that fails says so and offers a saved run ----------
    await page.goto(BASE + "/studio?template=outside-lands-2026-friday");
    await page.waitForSelector(".template");
    await page.click("#l-go");
    await page.waitForSelector("#agent-message");
    await page.fill("#agent-message", "Twin Peaks is closed 17:00 to 18:00.");
    await page.route("**/agent", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Gemini did not answer on any of the 3 keys (HTTP 429). Nothing was applied." }) }));
    await page.click("#ask-go");
    await page.waitForSelector(".run-failed");
    await page.unroute("**/agent");
    check("failure: it names the reason", (await page.textContent(".run-failed")).includes("3 keys"), (await page.textContent(".run-failed h2")).trim());
    check("failure: what was typed is still there", (await page.inputValue("#agent-message")).includes("Twin Peaks"));
    await sideways("failure");
    await page.click(".run-failed .watch-saved");
    await page.waitForSelector("#approve", { timeout: RUN });
    check("failure: a saved run plays from there", /saved run/i.test(await page.textContent("#flow .eyebrow")), (await headline()).trim());

    // ---------- Watching the agent on the public page ----------
    await page.goto(BASE + "/");
    await page.waitForSelector("#watch-play");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".loader")).visibility === "hidden");
    let live = 0;
    const counted = (r) => /\/agent|\/ask|\/models/.test(r.url()) && !/agent-replay/.test(r.url()) && live++;
    page.on("request", counted);
    await page.evaluate(() => document.querySelector("#watch").scrollIntoView({ behavior: "instant" }));
    check("watch: says what recorded it", /3\.8 Flash/.test(await page.textContent("#watch-tag")), (await page.textContent("#watch-tag")).trim());
    await page.click("#watch-play");
    await page.waitForFunction(() => document.querySelector("#watch-line").textContent.length > 3, null, { timeout: 15000 });
    check("watch: the agent's steps play", true, (await page.textContent("#watch-line")).trim().slice(0, 80));
    await page.waitForTimeout(1500);
    page.off("request", counted);
    check("watch: it makes no live calls", live === 0, `${live} calls`);
    await sideways("watch");
    await page.click("#watch-back");

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
      // ---------- Asking the agent ----------
      await page.click('.ask-chips [data-action="ask-chip"]');
      await page.waitForSelector(".chat-a", { timeout: RUN });
      check("ask: it answers from the plan", (await page.textContent(".chat-a")).length > 10, (await page.textContent(".chat-a")).slice(0, 120));
      await page.fill("#ask-agent-text", "Keep Djo in their original slot");
      await page.click('#ask-agent-form button');
      await page.waitForFunction(() => document.querySelectorAll(".chat-a").length >= 2 || document.querySelector(".ask-agent .status.error"), null, { timeout: RUN });
      check("ask: a request can change the plan", (await page.locator(".chat-new").count()) >= 1, (await page.textContent(".chat li:last-child")).slice(0, 160));
      check("ask: the last plan stays reachable", (await page.locator('[data-action="plan-back"]').count()) >= 1);
      // ---------- Asking the agent ----------
      await page.click('.ask-chips [data-action="ask-chip"]');
      await page.waitForSelector(".chat-a", { timeout: RUN });
      check("ask: it answers from the plan", (await page.textContent(".chat-a")).length > 10, (await page.textContent(".chat-a")).slice(0, 120));
      await page.fill("#ask-agent-text", "Keep Djo in their original slot");
      await page.click('#ask-agent-form button');
      await page.waitForFunction(() => document.querySelectorAll(".chat-a").length >= 2 || document.querySelector(".ask-agent .run-failed"), null, { timeout: RUN });
      check("ask: a request can change the plan", (await page.locator(".chat-new").count()) >= 1, (await page.textContent(".chat li:last-child")).slice(0, 160));
      check("ask: the last plan stays reachable", (await page.locator('[data-action="plan-back"]').count()) >= 1);
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
