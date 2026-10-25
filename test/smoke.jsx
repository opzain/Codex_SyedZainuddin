import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";

const dom = new JSDOM(
  `<!doctype html><html><body><div id="root"></div></body></html>`,
  { url: "http://localhost:5173/", pretendToBeVisual: true },
);
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLMediaElement = window.HTMLMediaElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.Blob = window.Blob ?? Blob;
globalThis.Image = window.Image;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// --- Audio + media stubs -------------------------------------------------
const playCalls = { count: 0 };
Object.defineProperty(window.HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
Object.defineProperty(window.HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 12 });
Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { configurable: true, get: () => true });
window.HTMLMediaElement.prototype.load = function load() {};
window.HTMLMediaElement.prototype.play = function play() {
  playCalls.count += 1;
  this.dispatchEvent(new window.Event("play"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function pause() {
  this.dispatchEvent(new window.Event("pause"));
};

class FakeAnalyser {
  constructor() {
    this.fftSize = 2048;
    this.smoothingTimeConstant = 0.72;
    this.frequencyBinCount = 1024;
  }
  getByteTimeDomainData(target) {
    for (let i = 0; i < target.length; i += 1) target[i] = 128 + Math.round(60 * Math.sin(i / 7));
  }
  getByteFrequencyData(target) {
    for (let i = 0; i < target.length; i += 1) target[i] = 80;
  }
  connect() {}
  disconnect() {}
}
class FakeSource {
  connect() {}
  disconnect() {}
}
class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.destination = { connect() {}, disconnect() {} };
  }
  createAnalyser() { return new FakeAnalyser(); }
  createMediaElementSource() { return new FakeSource(); }
  createMediaStreamSource() { return new FakeSource(); }
  resume() { this.state = "running"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}
window.AudioContext = FakeAudioContext;
globalThis.AudioContext = FakeAudioContext;
window.webkitAudioContext = FakeAudioContext;

window.URL.createObjectURL = () => "blob:mock-synthetic";
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

// jsdom ships no canvas backend; provide a no-op 2D context so the live
// waveform component can mount and paint without a native canvas package.
const fakeContext = {
  canvas: null,
  clearRect() {}, fillRect() {}, strokeRect() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
  stroke() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
  setLineDash() {}, getLineDash() { return []; },
  measureText() { return { width: 12 }; }, fillText() {}, strokeText() {},
  createLinearGradient() { return { addColorStop() {} }; },
  createRadialGradient() { return { addColorStop() {} }; },
  createPattern() { return null; },
  putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; },
  drawImage() {},
  set fillStyle(value) {}, get fillStyle() { return "#000"; },
  set strokeStyle(value) {}, get strokeStyle() { return "#000"; },
  set lineWidth(value) {}, get lineWidth() { return 1; },
  set shadowBlur(value) {}, get shadowBlur() { return 0; },
  set shadowColor(value) {}, get shadowColor() { return "#000"; },
  set font(value) {}, get font() { return "10px sans-serif"; },
  set globalAlpha(value) {}, get globalAlpha() { return 1; },
};
window.HTMLCanvasElement.prototype.getContext = function getContext() { return fakeContext; };
window.HTMLCanvasElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 640, height: 240, top: 0, left: 0, right: 640, bottom: 240, x: 0, y: 0, toJSON() { return {}; } };
};

const metadata = JSON.parse(fs.readFileSync("sample_calls/call_metadata.json", "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => metadata });
window.fetch = globalThis.fetch;

// --- Render --------------------------------------------------------------
await import("../src/main.jsx");
const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
await settle(400);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const results = [];
const check = (name, condition, detail = "") => {
  results.push({ name, ok: Boolean(condition), detail });
  assert.ok(condition, `${name} ${detail}`);
};

// 1. Sidebar renders five navigation buttons
const navButtons = $$(".nav-item");
check("sidebar has 5 navigation buttons", navButtons.length === 5, `found ${navButtons.length}`);

// 2. Every sidebar button switches the view
const expectedTitles = {
  "Triage Queue": "queue",
  "Live Monitor": "monitor",
  "Intelligence": "intelligence",
  "Case Files": "cases",
  "Overview": "overview",
};
for (const [label, id] of Object.entries(expectedTitles)) {
  const button = navButtons.find((node) => node.textContent.includes(label));
  check(`sidebar button exists: ${label}`, Boolean(button));
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(80);
  const activeButton = $(".nav-item.active");
  check(`sidebar click activates ${label}`, activeButton && activeButton.textContent.includes(label), activeButton?.textContent?.trim());
  const heading = $(".topbar-title h1")?.textContent || "";
  check(`heading reflects ${label}`, heading.toLowerCase().includes(label.split(" ")[0].toLowerCase()), heading);
  const activeTab = $(".topbar-tab.active");
  check(`header quick-nav stays in sync for ${label}`, activeTab && activeTab.textContent.includes(label.split(" ")[0]), activeTab?.textContent?.trim());
}

// 3. Header quick-nav buttons also switch views
const headerTabs = $$(".topbar-tab");
check("header quick-nav has 5 tabs", headerTabs.length === 5, `found ${headerTabs.length}`);
const monitorTab = headerTabs.find((node) => node.textContent.includes("Live Monitor"));
monitorTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(80);
check("header quick-nav switches to Live Monitor", $(".topbar-title h1")?.textContent.includes("Live Monitor"), $(".topbar-title h1")?.textContent);

// 4. Live clock ticks every second
const clockBefore = $(".clock-digits")?.textContent;
check("live clock renders HH:MM:SS", /^\d{2}:\d{2}:\d{2}$/.test(clockBefore || ""), clockBefore);
await settle(1300);
const clockAfter = $(".clock-digits")?.textContent;
check("live clock advances", clockAfter !== clockBefore, `${clockBefore} -> ${clockAfter}`);

// 5. Audio transport plays the demo asset
const playButton = $(".transport-play");
check("audio transport play button exists", Boolean(playButton));
playButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(200);
check("audio element play() was invoked", playCalls.count > 0, `calls=${playCalls.count}`);
check("transport flips to pause state", $(".transport-play")?.textContent === "Ⅱ", $(".transport-play")?.textContent);

// 6. Waveform canvas and radar react to playback
check("waveform canvas present", Boolean($(".signal-scope")));
const radar = $(".radar-chart");
check("radar chart present", Boolean(radar));
check("radar switches to live tracking", radar?.classList.contains("radar-active"), radar?.className);

// 7. Live transcript is rendered and follows the playhead
const segments = $$(".transcript-segment");
check("transcript segments rendered", segments.length > 0, `found ${segments.length}`);
check("one transcript segment is active", $$(".transcript-segment.active").length === 1);

// 8. Timeline graph renders all five emotion traces
check("emotion timeline has 5 traces", $$(".emotion-line").length === 5, `found ${$$(".emotion-line").length}`);
check("timeline playhead present", Boolean($(".timeline-playhead")));

// 9. Playback can be paused
$(".transport-play").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(120);
check("transport returns to play state", $(".transport-play")?.textContent === "▶", $(".transport-play")?.textContent);

// 10. Case selection updates the focused case
const queueTab = $$(".topbar-tab").find((node) => node.textContent.includes("Triage Queue"));
queueTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(100);
const queueRows = $$(".full-queue-row");
check("triage queue rows render", queueRows.length === 4, `found ${queueRows.length}`);
queueRows[2].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(100);
const selectedRow = $(".full-queue-row.selected");
check("clicking a queue row selects it", Boolean(selectedRow), selectedRow?.textContent?.trim());

// 11. Settings drawer opens and closes
$(".settings-button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(100);
check("settings drawer opens", Boolean($(".settings-drawer")));
$(".settings-drawer header button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(100);
check("settings drawer closes", !$(".settings-drawer"));

// 12. Command toolbar actions open a confirmation modal
const escalate = $$(".command-actions button")[0];
escalate.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(100);
check("confirmation modal opens", Boolean($(".confirm-modal")));
$(".ghost-button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(80);
check("confirmation modal closes", !$(".confirm-modal"));

// 13. PII toggle is present and interactive
$$(".topbar-tab").find((node) => node.textContent.includes("Live Monitor"))
  .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(120);
const piiToggle = $(".transcript-panel .toggle");
check("PII toggle present", Boolean(piiToggle), piiToggle?.textContent?.trim());
const piiBefore = piiToggle.textContent;
piiToggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await settle(80);
check("PII toggle changes state", $(".transcript-panel .toggle")?.textContent !== piiBefore, `${piiBefore} -> ${$(".transcript-panel .toggle")?.textContent}`);

console.log("\n=== SMOKE RESULTS ===");
for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
