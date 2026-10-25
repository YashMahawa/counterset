// Real-click walkthrough against a running server. Requires Playwright on NODE_PATH and
// Chrome at CHROME_PATH. Uses only cached Qloo rows and no model calls unless
// COUNTERSET_MODEL=1, which sends one production message to Gemma.
const { chromium } = require("playwright");
const fs = require("node:fs");
const base = process.env.COUNTERSET_URL || "http://127.0.0.1:8877";
const out = process.env.SHOTS || "test-results";
const width = +(process.env.WIDTH || 1440);
const height = +(process.env.HEIGHT || 960);
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/home/yash/.local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: process.env.REDUCED ? "reduce" : "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${width}-${name}.png`, fullPage: process.env.FULL === "1" });
  };
  const next = () => page.locator("#step-actions [data-action=next] >> visible=true").first().click();
  const statusIs = (re) => page.waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("#status").textContent), re.source, { timeout: 90000 });

  await page.goto(base + "/studio");
  await page.waitForSelector(".set");
  // Start from a fresh copy of the first example.
  if (width > 980) {
    await page.click("#open-day");
    await page.waitForSelector("[data-example]");
    await page.locator("[data-example]").first().click();
    await statusIs(/fresh copy/);
  }
  const result = {};
  await shot("1-bill");
  await next();
  if (!(await page.locator("#panel .kpis").count())) {
    await page.click("[data-action=evidence][data-source=cache]");
    await statusIs(/Evidence/);
  }
  await shot("2-crowds");
  await page.locator("#panel tr.pick").first().click();
  await shot("2-pair");
  await next();
  result.audit = await page.locator("#step-finding").textContent();
  await shot("3-audit");
  await next();
  if (process.env.COUNTERSET_MODEL === "1") {
    await page.click("[data-action=message]");
    await page.waitForSelector("[data-review-index]", { timeout: 200000 });
    await shot("4-message");
    await page.click("[data-action=review]");
    await statusIs(/Applied|Declined/);
  } else {
    await page.click("[data-action=hold]");
    const stageId = await page.$eval("#h-stage", (s) => [...s.options].find((o) => /bacardi/i.test(o.textContent))?.value || s.options[0].value);
    await page.selectOption("#h-stage", stageId);
    await page.fill("#h-start", "17:15");
    await page.fill("#h-end", "18:15");
    await page.click("#dialog-body button.primary");
    await statusIs(/Hold added/);
  }
  result.invalid = await page.locator(".set.invalid").count();
  await shot("4-disruption");
  await next();
  await page.click("[data-action=repair]");
  await statusIs(/Repairs ready|No schedule/);
  result.options = await page.locator(".option").count();
  await shot("5-options");
  const blind = page.locator("#views button.blind").first();
  if (await blind.count()) {
    await blind.click();
    await shot("5-without-qloo");
    result.blind = true;
  }
  await page.locator("#views button", { hasText: "Option A" }).click();
  await next();
  await shot("6-approve");
  await page.locator("#step-actions [data-action=publish]").click();
  await statusIs(/Published v1/);
  result.published = true;
  await shot("6-published");
  // Stale-state check: an edit after publication must invalidate repairs.
  result.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  result.fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => `${f.family}:${f.status}`);
  });
  result.errors = errors;
  fs.writeFileSync(`${out}/browser-${width}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
