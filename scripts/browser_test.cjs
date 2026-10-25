const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.COUNTERSET_URL || "http://127.0.0.1:8877";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || "/home/yash/.local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/studio");
  await page.waitForSelector(".set");
  await page.getByRole("button", { name: "New day", exact: true }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole("button", { name: "Load recorded Qloo", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("Evidence loaded"),
  );
  if (!(await page.locator("#coverage").textContent()).includes("12/12"))
    throw Error("Coverage gate did not pass");
  await page
    .locator(".workspace-main")
    .screenshot({ path: "web/assets/grid.png" });
  await page
    .getByRole("button", { name: "Find a repair", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#notice").textContent.includes("Repair ready"),
    {},
    { timeout: 45000 },
  );
  if (
    !(await page.locator("#proposal-summary").textContent()).includes("OPTIMAL")
  )
    throw Error("Fixture did not solve optimally");
  await page
    .locator(".workspace-main")
    .screenshot({ path: "web/assets/proposal.png" });
  await page.screenshot({
    path: ".private/studio-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  const box = await page.locator("#evidence-view").boundingBox();
  await page.screenshot({
    path: "web/assets/evidence.png",
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: Math.min(720, box.height),
    },
  });
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve & publish", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#notice")
      .textContent.includes("Published immutable"),
  );
  await page.setViewportSize({ width: 640, height: 1100 });
  await page
    .locator(".stage-column")
    .first()
    .screenshot({ path: "web/assets/grid-portrait.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".private/studio-mobile.png", fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw Error("Studio overflows mobile viewport");
  await page.goto(base + "/");
  await page.evaluate(() =>
    document.querySelectorAll("img").forEach((i) => (i.loading = "eager")),
  );
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth),
  );
  await page.screenshot({
    path: ".private/landing-mobile.png",
    fullPage: true,
  });
  const fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  const cfg = await page.request
    .get(base + "/api/config")
    .then((r) => r.json());
  let real = null;
  if (cfg.real_day_available) {
    await page.goto(base + "/studio");
    await page.waitForSelector(".set");
    await page
      .getByRole("button", { name: "Historical day", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#day-name").textContent.includes("Pitchfork"),
    );
    await page
      .getByRole("button", { name: "Find a repair", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("#notice").textContent.includes("Repair ready"),
      {},
      { timeout: 45000 },
    );
    if (
      !(await page.locator("#proposal-summary").textContent()).includes(
        "0 acts move",
      )
    )
      throw Error("Published historical grid should be left unchanged");
    await page.getByRole("button", { name: "Stage hold", exact: true }).click();
    await page.locator("#f-stage").selectOption("blue");
    await page.locator("#f-start").fill("18:15");
    await page.locator("#f-end").fill("19:00");
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#notice").textContent.includes("Facts updated"),
    );
    await page
      .getByRole("button", { name: "Find a repair", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("#notice").textContent.includes("Repair ready"),
      {},
      { timeout: 45000 },
    );
    if (
      !(await page.locator("#proposal-summary").textContent()).includes(
        "1 acts move",
      )
    )
      throw Error("Fewest-acts hold repair should move one act");
    await page.locator("#repair-priority").selectOption("least_time_shift");
    await page
      .getByRole("button", { name: "Find a repair", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("#notice").textContent.includes("Repair ready"),
      {},
      { timeout: 45000 },
    );
    if (
      !(await page.locator("#proposal-summary").textContent()).includes(
        "2 acts move",
      )
    )
      throw Error("Least-time-shift hold repair should move two acts");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: ".private/historical-repair.png",
      fullPage: true,
    });
    real = {
      project_id: await page.evaluate(() =>
        localStorage.getItem("counterset-project"),
      ),
      flow: "historical grid unchanged → hypothetical hold → one changed act → alternative two-act small-shift repair",
    };
  }
  if (errors.length) throw Error(errors.join("\n"));
  const result = {
    browser: "Chrome",
    flow: "new day → recorded Qloo → optimal repair → evidence → publish",
    historical: real,
    mobileOverflow: overflow,
    fonts,
    errors,
  };
  fs.writeFileSync(
    ".private/browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
