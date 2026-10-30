// A real screen recording of the recorded agent run in the studio, for the public page.
// Needs ffmpeg, a running server, Playwright on NODE_PATH and Chrome at CHROME_PATH.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: "/tmp/counterset-video", size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  await page.goto(`${BASE}/studio?day=bonnaroo-2026-sunday&watch=1`);
  await page.waitForSelector("#grid .set");
  await page.evaluate(() => {
    document.querySelector(".card.timetable").scrollIntoView({ block: "start" });
    scrollBy(0, -160);
  });
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("finished"), null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  await page.click('#views button[data-view="blind0"]');
  await page.waitForTimeout(3000);
  await page.click('#views button[data-view="opt0"]');
  await page.waitForTimeout(3000);
  const file = await page.video().path();
  await context.close();
  await browser.close();
  execFileSync("ffmpeg", ["-y", "-i", file, "-vf", "setpts=0.25*PTS", "-an", "-c:v", "libvpx-vp9", "-b:v", "500k", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "web/assets/agent-run.webm"], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-sseof", "-1.2", "-i", "web/assets/agent-run.webm", "-frames:v", "1", "-q:v", "4", "web/assets/agent-run.jpg"], { stdio: "ignore" });
  fs.rmSync("/tmp/counterset-video", { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
