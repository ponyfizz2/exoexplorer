import { chromium } from "playwright";
const URL = process.env.URL ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#shell:not([hidden])", { timeout: 90000 });
await page.waitForTimeout(4500);
console.log("URL:", URL);
const rows = await page.evaluate(() => {
  const list = window.__exo?.state?.derived ?? [];
  const pick = ["Kepler-452 b", "Kepler-138 e", "Kepler-1126 c", "Kepler-69 c", "TRAPPIST-1 e", "Proxima Cen b", "TOI-700 d", "GJ 1002 c", "Kepler-442 b"];
  const out = pick.map((name) => {
    const d = list.find((x) => x.id === name);
    if (!d) return { name, missing: true };
    return {
      name, cls: d.cls,
      radius: d.radiusEarth === null ? null : +d.radiusEarth.toFixed(2),
      mass: d.massEarth === null ? null : +d.massEarth.toFixed(1),
      temp: d.equilibriumTemp === null ? null : Math.round(d.equilibriumTemp),
      insol: d.insolation === null || d.insolation === undefined ? null : +d.insolation.toFixed(3),
      hz: d.hzStatus, hzDist: d.hzDistance === null ? null : +d.hzDistance.toFixed(3),
      esi: d.esi === null ? null : +d.esi.toFixed(3),
      hi: d.habitability, pot: d.potentiallyHabitable,
    };
  });
  const top = list.slice(0, 12).map((d, i) => ({ rank: i + 1, name: d.id, hi: d.habitability, hz: d.hzStatus }));
  return { detail: out, top };
});
console.log(JSON.stringify(rows.detail, null, 0));
console.log("\nTOP 12 BY HABITABILITY:");
for (const t of rows.top) console.log("  " + String(t.rank).padStart(2) + ". " + t.name.padEnd(18) + String(t.hi).padStart(6) + "  " + t.hz);
await browser.close();
