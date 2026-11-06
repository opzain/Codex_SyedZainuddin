// Real-browser playback smoke test.
// Reproduces the failure mode where `onTimeUpdate` read `event.currentTarget`
// inside a React state updater, throwing after the handler returned and
// blanking the whole console.
//
// Requires a local Edge or Chrome. Install playwright-core (dev dependency)
// and run: npm run test:play
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";

const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const executablePath = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!executablePath) {
  console.log("SKIP: no Edge/Chrome binary found. Set BROWSER_PATH to run the playback smoke test.");
  process.exit(0);
}

const URL = process.env.APP_URL || "http://localhost:5173";
const results = [];
const check = (name, condition, detail = "") => {
  results.push({ name, ok: Boolean(condition), detail });
  assert.ok(condition, `${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".transport-play", { timeout: 15000 });
  check("console renders before playback", (await page.locator("#root > *").count()) === 1);

  await page.click(".transport-play");
  await page.waitForTimeout(2600);

  check("page has no runtime errors during playback", pageErrors.length === 0, pageErrors.join(" | "));
  check("root still mounted during playback", (await page.locator("#root > *").count()) === 1);
  check("transport shows pause state", (await page.locator(".transport-play").textContent()).trim() === "Ⅱ");
  check("no buffering notice stuck", (await page.locator(".audio-loading").count()) === 0);

  const timeLabel = (await page.locator(".transport-time strong").textContent()).trim();
  check("playback clock advances", timeLabel !== "00:00", timeLabel);

  const canvasBefore = await page.evaluate(() => document.querySelector(".signal-scope")?.toDataURL().length ?? 0);
  await page.waitForTimeout(700);
  const canvasAfter = await page.evaluate(() => document.querySelector(".signal-scope")?.toDataURL().length ?? 0);
  check("waveform keeps painting", canvasBefore > 1000 && canvasAfter > 1000, `${canvasBefore} -> ${canvasAfter}`);

  await page.click(".transport-play");
  await page.waitForTimeout(300);
  check("transport returns to play state", (await page.locator(".transport-play").textContent()).trim() === "▶");
  check("no console errors during playback", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
}

console.log("\n=== PLAYBACK SMOKE ===");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.filter((result) => result.ok).length}/${results.length} checks passed`);
