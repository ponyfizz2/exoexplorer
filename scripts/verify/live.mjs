import { chromium } from "playwright";
const URL = "https://exoexplorer-chi.vercel.app/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = []; const failed = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
page.on("requestfailed", (r) => failed.push(r.url().slice(0, 90) + " :: " + r.failure()?.errorText));
let apiStatus = null; let apiCount = null;
page.on("response", async (r) => {
  if (r.url().includes("/api/planets")) {
    apiStatus = r.status();
    try { const j = await r.json(); apiCount = j?.planets?.length ?? null; } catch { /* ignore */ }
  }
});

console.log("→", URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#shell:not([hidden])", { timeout: 90000 });
await page.waitForTimeout(6000);

console.log("API:", JSON.stringify({ apiStatus, apiCount }));
const head = await page.evaluate(() => ({
  feed: document.getElementById("feed-status-text")?.textContent,
  stats: [...document.querySelectorAll("#header-stats .stat-pill")].map((n) => n.textContent.trim()),
  toastCount: document.querySelectorAll(".toast").length,
}));
console.log("HEADER:", JSON.stringify(head));

const canvas = await page.evaluate(() => {
  const h = document.getElementById("galaxy-canvas");
  const c = h?.querySelector("canvas");
  return { host: h ? [h.clientWidth, h.clientHeight] : null, canvas: c ? [c.width, c.height] : null };
});
console.log("GALAXY CANVAS:", JSON.stringify(canvas));
await page.screenshot({ path: "/tmp/exoshots/live-01-galaxy.png" });

for (const [view, file] of [["atlas", "live-02-atlas"], ["lab", "live-03-analytics"], ["worlds", "live-04-worlds"], ["data", "live-05-archive"]]) {
  await page.click('[data-view="' + view + '"]');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "/tmp/exoshots/" + file + ".png" });
}
await page.click('[data-view="data"]');
await page.waitForTimeout(1200);
await page.click("table.data-table tbody tr");
await page.waitForTimeout(4500);
const detail = await page.evaluate(() => ({
  name: document.getElementById("detail-name")?.textContent,
  score: document.querySelector(".big-score b")?.textContent,
  canvas: document.querySelectorAll("#detail-canvas canvas").length,
}));
console.log("DETAIL:", JSON.stringify(detail));
await page.screenshot({ path: "/tmp/exoshots/live-06-detail.png" });

// Direct API check, bypassing the browser.
const raw = await fetch("https://exoexplorer-chi.vercel.app/api/planets");
const rawJson = await raw.json().catch(() => null);
console.log("RAW API:", JSON.stringify({
  status: raw.status,
  cacheHeader: raw.headers.get("cache-control"),
  xCache: raw.headers.get("x-exo-cache"),
  count: rawJson?.planets?.length,
  source: rawJson?.meta?.source?.slice(0, 60),
}));

console.log("PAGE ERRORS:", errs.length, errs.slice(0, 4));
console.log("FAILED REQUESTS:", failed.length, failed.slice(0, 4));
await browser.close();
