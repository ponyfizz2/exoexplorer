import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://127.0.0.1:5173/";
const OUT = process.env.OUT ?? "/tmp/exoshots";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
page.on("requestfailed", (r) => failedRequests.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));

console.log("→ loading", URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// Wait for boot to finish (shell becomes visible).
try {
  await page.waitForSelector("#shell:not([hidden])", { timeout: 90000 });
  console.log("✓ boot complete");
} catch (error) {
  console.log("✗ boot did not complete:", String(error).slice(0, 200));
  await page.screenshot({ path: `${OUT}/00-boot-failed.png` });
}

await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/01-galaxy.png` });

// Probe the header stats + feed status.
const header = await page.evaluate(() => ({
  stats: [...document.querySelectorAll("#header-stats .stat-pill")].map((n) => n.textContent.trim()),
  feed: document.getElementById("feed-status-text")?.textContent,
  hud: document.getElementById("galaxy-hud")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160),
  legend: document.getElementById("galaxy-legend")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
  canvasCount: document.querySelectorAll("#galaxy-canvas canvas").length,
}));
console.log("HEADER:", JSON.stringify(header, null, 1));

// Atlas
await page.click('[data-view="atlas"]');
await page.waitForTimeout(1200);
const atlas = await page.evaluate(() => ({
  cards: document.querySelectorAll(".planet-card").length,
  firstCard: document.querySelector(".planet-card__name")?.textContent,
  count: document.querySelector(".filter-bar div[style*='margin-left']")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("ATLAS:", JSON.stringify(atlas));
await page.screenshot({ path: `${OUT}/02-atlas.png` });

// Analytics
await page.click('[data-view="lab"]');
await page.waitForTimeout(2500);
const lab = await page.evaluate(() => ({
  kpis: [...document.querySelectorAll("#lab-kpis .kpi")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  charts: document.querySelectorAll("#lab-body canvas").length,
  legendRows: document.querySelectorAll("#donut-legend li").length,
}));
console.log("LAB:", JSON.stringify(lab, null, 1));
await page.screenshot({ path: `${OUT}/03-analytics.png` });

// Habitable worlds
await page.click('[data-view="worlds"]');
await page.waitForTimeout(1200);
const worlds = await page.evaluate(() => ({
  rows: document.querySelectorAll(".leader-row").length,
  top: document.querySelector(".leader-name")?.textContent,
  score: document.querySelector(".leader-score b")?.textContent,
}));
console.log("WORLDS:", JSON.stringify(worlds));
await page.screenshot({ path: `${OUT}/04-worlds.png` });

// Archive table
await page.click('[data-view="data"]');
await page.waitForTimeout(1200);
const table = await page.evaluate(() => ({
  rows: document.querySelectorAll("table.data-table tbody tr").length,
  headers: [...document.querySelectorAll("table.data-table thead th")].map((n) => n.textContent.trim()).slice(0, 6),
  page: document.querySelector(".pagination")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log("TABLE:", JSON.stringify(table));
await page.screenshot({ path: `${OUT}/05-archive.png` });

// Detail overlay
await page.click("table.data-table tbody tr");
await page.waitForTimeout(4000);
const detail = await page.evaluate(() => ({
  open: document.getElementById("detail")?.classList.contains("open"),
  name: document.getElementById("detail-name")?.textContent,
  sub: document.getElementById("detail-sub")?.textContent,
  score: document.querySelector(".big-score b")?.textContent,
  facts: document.querySelectorAll(".fact").length,
  travelRows: document.querySelectorAll(".travel-row").length,
  sizeBalls: document.querySelectorAll(".size-ball").length,
  canvas: document.querySelectorAll("#detail-canvas canvas").length,
  scoreRows: document.querySelectorAll(".score-row").length,
}));
console.log("DETAIL:", JSON.stringify(detail, null, 1));
await page.screenshot({ path: `${OUT}/06-detail.png` });

// Resize the warpslider for a sanity check on the travel calculator.
const warp = await page.evaluate(async () => {
  const slider = document.getElementById("warp-slider");
  if (!slider) return null;
  slider.value = "9";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  return {
    value: document.getElementById("warp-value")?.textContent,
    speed: document.getElementById("warp-speed")?.textContent,
    eta: document.getElementById("warp-eta")?.textContent,
  };
});
console.log("WARP:", JSON.stringify(warp));
await page.screenshot({ path: `${OUT}/07-detail-warp.png` });

// Close, then test the galaxy timeline playback.
await page.click("#detail-close");
await page.waitForTimeout(900);
await page.click('[data-view="galaxy"]');
await page.waitForTimeout(600);
const timeline = await page.evaluate(async () => {
  const slider = document.getElementById("year-range");
  if (!slider) return null;
  slider.value = "2000";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  return {
    year: slider.value,
    hud: document.getElementById("galaxy-hud")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 90),
  };
});
console.log("TIMELINE:", JSON.stringify(timeline));
await page.screenshot({ path: `${OUT}/08-timeline-2000.png` });

// Colour-mode switch
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("#color-mode button")];
  const target = buttons.find((b) => b.textContent.trim() === "Temp");
  target?.click();
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/09-colour-temp.png` });

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await mobile.waitForSelector("#shell:not([hidden])", { timeout: 90000 }).catch(() => {});
await mobile.waitForTimeout(3500);
await mobile.screenshot({ path: `${OUT}/10-mobile-galaxy.png` });
await mobile.click('[data-view="worlds"]');
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${OUT}/11-mobile-worlds.png` });
const mobileOverflow = await mobile.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log("MOBILE:", JSON.stringify(mobileOverflow));

console.log("\n--- CONSOLE ERRORS (" + consoleErrors.length + ") ---");
consoleErrors.slice(0, 12).forEach((e) => console.log("  !", e));
console.log("--- PAGE ERRORS (" + pageErrors.length + ") ---");
pageErrors.slice(0, 12).forEach((e) => console.log("  !!", e));
console.log("--- FAILED REQUESTS (" + failedRequests.length + ") ---");
failedRequests.slice(0, 12).forEach((e) => console.log("  ~", e));

await browser.close();
console.log("\nshots in " + OUT);
