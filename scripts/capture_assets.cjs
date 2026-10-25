// Captures genuine interface images for the public page from a running server.
const { chromium } = require("playwright");
const base = process.env.COUNTERSET_URL || "http://127.0.0.1:8877";
const H = { "Content-Type": "application/json", "X-Counterset": "workspace" };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/home/yash/.local/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const api = (path, body, method) => page.evaluate(async ([path, body, method, H]) => (await fetch("/api" + path, { method: method || (body ? "POST" : "GET"), headers: H, body: body ? JSON.stringify(body) : undefined })).json(), [path, body, method, H]);
  const wait = async (j) => { for (;;) { const s = await api("/jobs/" + j.job_id); if (s.status !== "RUNNING") return s; await page.waitForTimeout(300); } };
  await page.goto(base + "/studio");
  await page.waitForSelector(".set");
  const open = async (id, chapter, setup) => {
    const p = await api(`/examples/${id}`, {});
    if (setup) await setup(p.id);
    await page.evaluate(([id, ch]) => { localStorage.setItem("counterset-project", id); localStorage.setItem("counterset-chapter-" + id, ch); }, [p.id, chapter]);
    await page.goto(base + "/studio");
    await page.waitForSelector(".set");
    await page.waitForTimeout(1400);
    return p.id;
  };
  const shot = async (sel, name) => { await page.locator(sel).first().screenshot({ path: `web/assets/${name}.png` }); };
  // 1. The real Lollapalooza grid with its clashes.
  await open("lollapalooza-2024-saturday", "2");
  await shot("#grid-wrap", "grid-clashes");
  await shot(".chapter.active", "audit-row");
  await page.evaluate(() => document.querySelector("[data-action=chapter][data-index='0']").click());
  await page.waitForTimeout(900);
  await shot(".chapter.active", "bill-row");
  await page.evaluate(() => document.querySelector("[data-action=chapter][data-index='2']").click());
  await page.waitForTimeout(900);
  // 2. Evidence for the hero pair.
  await page.locator(".chapter.active .list button.hot").nth(1).click();
  await page.waitForTimeout(900);
  await shot("#inspector", "pair-evidence");
  // 3. Disruption, repair, counterfactual.
  const pid = await open("lollapalooza-2024-saturday", "4", async (id) => {
    let d = await api(`/projects/${id}`);
    await api(`/projects/${id}/hold`, { version: d.version, stage_id: "stage-bacardi", start: 1035, end: 1095, reason: "Lightning protocol" });
    d = await api(`/projects/${id}`);
    d.day.acts.find((a) => a.name === "Ethel Cain").earliest = 1080;
    await api(`/projects/${id}`, { version: d.version, day: d.day }, "PUT");
    d = await api(`/projects/${id}`);
    await wait(await api(`/projects/${id}/repair`, { version: d.version, move_budget: 4, seconds: 8 }));
  });
  await page.locator("#views button", { hasText: "Option A" }).click();
  await page.waitForTimeout(1200);
  await shot("#grid-wrap", "grid-repaired");
  await shot(".chapter.active", "options-row");
  await page.locator("#views button.blind").first().click();
  await page.waitForTimeout(1400);
  await shot("#grid-wrap", "grid-without-qloo");
  // 4. Multi-arts bill with cross-kind cues.
  await open("crosswinds-multi-arts", "1");
  await page.waitForTimeout(1800);
  await shot("#grid-wrap", "grid-multi-arts");
  // 5. Phone view.
  await page.setViewportSize({ width: 390, height: 844 });
  await open("lollapalooza-2024-saturday", "2");
  await page.screenshot({ path: "web/assets/phone-audit.png" });
  console.log("captured", pid);
  await browser.close();
})();
