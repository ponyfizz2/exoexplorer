import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#shell:not([hidden])", { timeout: 90000 });
await page.waitForTimeout(4000);
// Face-on look at the galactic centre, to confirm the spiral reads.
await page.evaluate(() => {
  const g = window.__exo?.galaxy;
  const core = g?.scene?.getObjectByName("galactic-core");
  const cx = core ? core.position.x : 70;
  g.camera.position.set(cx, 260, 20);
  g.camera.lookAt(cx, 0, 0);
  g.camera.updateProjectionMatrix();
  if (g.controls) { g.controls.target.set(cx, 0, 0); g.controls.update(); }
});
await page.waitForTimeout(2500);
const b1 = await page.locator("#galaxy-canvas canvas").boundingBox();
await page.screenshot({ path: "/tmp/exoshots/final-topdown.png", clip: b1 });
await browser.close();
