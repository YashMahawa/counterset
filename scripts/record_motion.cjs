// Records a genuine screen capture of the studio: the same grid toggling between the
// draft, Option A and the same repair without Qloo. Output: web/assets/repair-motion.webm
const { chromium } = require("playwright");
const fs = require("node:fs");
const base = process.env.COUNTERSET_URL || "http://127.0.0.1:8877";
const H = { "Content-Type": "application/json", "X-Counterset": "workspace" };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/home/yash/.local/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const setup = await browser.newPage();
  await setup.goto(base + "/studio");
  const api = (path, body, method) => setup.evaluate(async ([path, body, method, H]) => (await fetch("/api" + path, { method: method || (body ? "POST" : "GET"), headers: H, body: body ? JSON.stringify(body) : undefined })).json(), [path, body, method, H]);
  const p = await api("/examples/lollapalooza-2024-saturday", {});
  let d = await api(`/projects/${p.id}`);
  await api(`/projects/${p.id}/hold`, { version: d.version, stage_id: "stage-bacardi", start: 1035, end: 1095, reason: "Lightning protocol" });
  d = await api(`/projects/${p.id}`);
  d.day.acts.find((a) => a.name === "Ethel Cain").earliest = 1080;
  await api(`/projects/${p.id}`, { version: d.version, day: d.day }, "PUT");
  d = await api(`/projects/${p.id}`);
  let j = await api(`/projects/${p.id}/repair`, { version: d.version, move_budget: 4, seconds: 8 });
  for (;;) { const s = await api("/jobs/" + j.job_id); if (s.status !== "RUNNING") break; await setup.waitForTimeout(300); }
  await setup.close();
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1100, height: 520 }, recordVideo: { dir: "test-results/video", size: { width: 1100, height: 520 } } });
  const page = await ctx.newPage();
  await page.addInitScript(([id]) => { localStorage.setItem("counterset-project", id); localStorage.setItem("counterset-step-" + id, "4"); localStorage.setItem("counterset-mode", "desk"); }, [p.id]);
  await page.goto(base + "/studio");
  await page.waitForSelector(".set");
  await page.addStyleTag({ content: ".top,.steps,.title-row,.work,.card-head,.card-foot{display:none!important} .sheet{border:0;margin:0;padding:12px 0 0;min-height:0}" });
  await page.waitForTimeout(800);
  const view = (t) => page.evaluate((t) => [...document.querySelectorAll("#views button")].find((b) => b.textContent.trim() === t)?.click(), t);
  for (const t of ["Current draft", "Option A", "A without Qloo", "Option A", "Current draft"]) {
    await view(t);
    await page.waitForTimeout(2200);
  }
  const video = page.video();
  await ctx.close();
  fs.copyFileSync(await video.path(), "web/assets/repair-motion.webm");
  await browser.close();
  console.log("recorded");
})();
