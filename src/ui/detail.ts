/**
 * The planet dossier — 3D system view on the left, everything we know on the right.
 *
 * Every number states whether it was measured or inferred, and the habitability
 * score is broken into its weighted parts rather than asserted as a single figure.
 */

import { CLASS_COLORS, habitabilityBreakdown } from "../lib/astronomy";
import type { DerivedPlanet } from "../lib/types";
import {
  PROPULSION, escapeHtml, formatDuration, formatLightYears, formatMass, formatPeriod,
  formatRadius, formatTemp, int, pcToLy, temperatureColor, warpToC,
} from "../lib/utils";
import { paletteFor } from "../render/planetTextures";
import { SystemView } from "../render/system";
import { ICONS } from "./icons";
import { CLASS_BLURB, confidenceChip, hzChip } from "./dom";

let systemView: SystemView | null = null;
let currentId: string | null = null;
let paused = false;

export function mountSystemView(container: HTMLElement): void {
  systemView = new SystemView(container);
}

export function destroySystemView(): void {
  systemView?.dispose();
  systemView = null;
  currentId = null;
}

export function setSystemPaused(value: boolean): void {
  paused = value;
  systemView?.setPaused(value);
}

export function isSystemPaused(): boolean { return paused; }

/** Diagnostics handle for the browser test suite. */
export function systemDebugState(): unknown {
  return systemView?.debugState() ?? null;
}

/** Renders the 3D system, reusing the existing scene when the planet has not changed. */
export function renderSystem(d: DerivedPlanet, siblings: DerivedPlanet[], force = false): void {
  if (!systemView) return;
  if (!force && currentId === d.id) return;
  currentId = d.id;
  systemView.setSystem(d, siblings);
  systemView.setPaused(paused);
}

export function detailSidebarHtml(d: DerivedPlanet, siblings: DerivedPlanet[]): string {
  const mass = formatMass(d.massEarth);
  const radius = formatRadius(d.radiusEarth);
  const temp = formatTemp(d.equilibriumTemp);
  const breakdown = habitabilityBreakdown(d);
  const star = d.star;

  const fact = (label: string, value: string, unit = "", inferred = false, color?: string) => `
    <div class="fact${inferred ? " fact--inferred" : ""}">
      <dt>${escapeHtml(label)}${inferred ? ' <span title="Inferred from a mass–radius relation">est</span>' : ""}</dt>
      <dd${color ? ` style="color:${color}"` : ""}>${value}${unit ? `<small>${unit}</small>` : ""}</dd>
    </div>`;

  return `
    <div class="detail-section">
      <h3>${ICONS.target} Verdict</h3>
      <div class="big-score"><b>${d.habitability.toFixed(0)}</b><span>Habitability index<br />out of 100</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span class="chip" style="color:${CLASS_COLORS[d.cls]};border-color:${CLASS_COLORS[d.cls]}55;background:${CLASS_COLORS[d.cls]}18">${d.cls}</span>
        ${hzChip(d)}${confidenceChip(d)}
        ${d.esi !== null ? `<span class="chip chip--violet">ESI ${d.esi.toFixed(3)}</span>` : ""}
      </div>
      <p style="margin:0 0 12px;font-size:11.5px;line-height:1.55;color:var(--text-dim)">${escapeHtml(CLASS_BLURB[d.cls])}</p>
      ${breakdown.parts.map((part) => `
        <div class="score-row">
          <span>${part.label}</span>
          <div class="score-row__track"><div class="score-row__fill" style="width:${(part.value * 100).toFixed(0)}%;background:linear-gradient(90deg,#22d3ee,#a855f7)"></div></div>
          <b>${(part.value * 100).toFixed(0)}%</b>
        </div>`).join("")}
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-top:9px;line-height:1.6">
        Weighted from Earth Similarity Index (Schulze-Makuch 2011), habitable-zone position
        (Kopparapu 2014), equilibrium temperature, bulk density and host-star stability.
      </div>
    </div>

    <div class="detail-section">
      <h3>${ICONS.layers} Physical profile</h3>
      <dl class="fact-grid">
        ${fact("Radius", radius.value, radius.unit, d.radiusInferred)}
        ${fact("Mass", mass.value, mass.unit, d.massInferred)}
        ${fact("Bulk density", d.density === null ? "—" : d.density.toFixed(2), "g/cm³")}
        ${fact("Surface gravity", d.gravity === null ? "—" : d.gravity.toFixed(2), "g", false)}
        ${fact("Escape velocity", d.escapeVelocity === null ? "—" : d.escapeVelocity.toFixed(1), "km/s")}
        ${fact("Equil. temp", temp.value, temp.unit, false, temperatureColor(d.equilibriumTemp))}
      </dl>
    </div>

    <div class="detail-section">
      <h3>${ICONS.orbit} Orbit &amp; host star</h3>
      <dl class="fact-grid">
        ${fact("Semi-major axis", d.semiMajorAxis === null ? "—" : d.semiMajorAxis < 0.01 ? d.semiMajorAxis.toExponential(2) : d.semiMajorAxis.toFixed(3), "AU", d.semiMajorAxisInferred)}
        ${fact("Orbital period", formatPeriod(d.planet.pl_orbper), "")}
        ${fact("Eccentricity", d.planet.pl_orbeccen === undefined ? "—" : d.planet.pl_orbeccen.toFixed(3), "")}
        ${fact("Insolation", d.planet.pl_insol === undefined ? "—" : d.planet.pl_insol.toFixed(2), "S⊕")}
        ${fact("Star class", escapeHtml(star.spectralClass), "")}
        ${fact("Star Teff", star ? int(d.planet.st_teff) : "—", "K")}
        ${fact("Star mass", d.planet.st_mass === undefined ? "—" : d.planet.st_mass.toFixed(3), "M☉")}
        ${fact("Luminosity", star.luminosity.toFixed(star.luminosity < 1 ? 3 : 2), "L☉", star.luminosityEstimated)}
      </dl>
      ${star.hzInner !== null && star.hzOuter !== null ? `
      <div style="margin-top:9px;padding:9px 11px;border-radius:9px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.25);font-size:11px;line-height:1.55;color:#a7f3d0">
        <b>Habitable zone</b> ${star.hzInner.toFixed(2)}–${star.hzOuter.toFixed(2)} AU
        (optimistic ${star.hzInnerOptimistic?.toFixed(2)}–${star.hzOuterOptimistic?.toFixed(2)} AU).
        ${d.hzStatus === "inside" ? "This planet orbits inside it." : d.hzStatus === "outside-inner" ? `This planet is ${d.hzDistance?.toFixed(2)} AU too close.` : d.hzStatus === "outside-outer" ? `This planet is ${d.hzDistance?.toFixed(2)} AU too far out.` : ""}
      </div>` : ""}
    </div>

    <div class="detail-section">
      <h3>${ICONS.star} Discovery</h3>
      <dl class="fact-grid">
        ${fact("Method", escapeHtml(d.planet.discoverymethod), "")}
        ${fact("Year", String(d.planet.disc_year), "")}
        ${fact("Distance", d.planet.sy_dist === undefined ? "—" : d.planet.sy_dist.toFixed(2), "pc")}
        ${fact("Light years", formatLightYears(d.planet.sy_dist), "")}
      </dl>
      ${d.planet.disc_facility ? `<div style="font-size:11px;color:var(--text-faint);margin-top:8px">Facility: <span style="color:var(--text-dim)">${escapeHtml(d.planet.disc_facility)}</span></div>` : ""}
      ${siblings.length ? `<div style="font-size:11px;color:var(--text-faint);margin-top:6px">${siblings.length} other confirmed planet${siblings.length === 1 ? "" : "s"} in this system</div>` : ""}
    </div>

    <div class="detail-section">
      <h3>${ICONS.scale} Size comparison</h3>
      <div class="size-compare" id="size-compare"></div>
    </div>

    <div class="detail-section">
      <h3>${ICONS.rocket} Travel time</h3>
      ${renderTravel(d)}
    </div>

    <details class="detail-section">
      <summary style="cursor:pointer;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-faint)">Raw archive record</summary>
      <pre style="margin:10px 0 0;padding:11px;background:rgba(2,6,16,.75);border:1px solid var(--line-soft);border-radius:9px;font-family:var(--font-mono);font-size:10px;color:#86efac;overflow-x:auto;line-height:1.55">${escapeHtml(JSON.stringify(d.planet, null, 2))}</pre>
    </details>
  `;
}

function renderTravel(d: DerivedPlanet): string {
  const pc = d.planet.sy_dist;
  if (pc === undefined || !Number.isFinite(pc) || pc <= 0) {
    return `<p style="font-size:11.5px;color:var(--text-faint);margin:0">Distance is unknown for this system, so travel time cannot be computed.</p>`;
  }
  const ly = pcToLy(pc);
  const rows = PROPULSION.map((option) => {
    const years = ly / option.speedC;
    return `<div class="travel-row">
      <span>${escapeHtml(option.name)}<small>${(option.speedC * 100).toFixed(option.speedC < 0.01 ? 4 : 1)}% c · ${escapeHtml(option.note)}</small></span>
      <b>${formatDuration(years)}</b>
    </div>`;
  }).join("");

  return `
    <div style="font-size:11.5px;color:var(--text-dim);margin-bottom:9px">
      <b style="color:#fff">${ly.toFixed(1)} light years</b> away. Light itself needs ${formatDuration(ly)}.
    </div>
    <div class="travel-grid">${rows}</div>
    <div style="margin-top:12px">
      <label style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-faint);letter-spacing:.1em;text-transform:uppercase">
        <span>Warp factor (TNG scale)</span><span id="warp-value" style="color:var(--cyan)">1.0</span>
      </label>
      <input class="range" type="range" id="warp-slider" min="1" max="9.9" step="0.1" value="1" aria-label="Warp factor" />
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-faint)" id="warp-speed">1× the speed of light</span>
        <span style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--cyan)" id="warp-eta">—</span>
      </div>
    </div>
  `;
}

/** Wires the warp slider; called after the sidebar HTML lands in the DOM. */
export function wireTravel(d: DerivedPlanet, root: HTMLElement): void {
  const slider = root.querySelector<HTMLInputElement>("#warp-slider");
  if (!slider) return;
  const valueEl = root.querySelector<HTMLElement>("#warp-value");
  const speedEl = root.querySelector<HTMLElement>("#warp-speed");
  const etaEl = root.querySelector<HTMLElement>("#warp-eta");
  const pc = d.planet.sy_dist ?? 0;
  const ly = pcToLy(pc);

  const update = (): void => {
    const warp = Number(slider.value);
    const speedC = warpToC(warp);
    const years = ly / speedC;
    if (valueEl) valueEl.textContent = warp.toFixed(1);
    if (speedEl) speedEl.textContent = speedC >= 1000
      ? `${Math.round(speedC).toLocaleString("en-US")}× the speed of light`
      : `${speedC.toFixed(speedC < 10 ? 2 : 0)}× the speed of light`;
    if (etaEl) etaEl.textContent = formatDuration(years);
  };
  slider.addEventListener("input", update);
  update();
}

/** Draws the to-scale size comparison strip. */
export function renderSizeCompare(root: HTMLElement, d: DerivedPlanet): void {
  const host = root.querySelector<HTMLElement>("#size-compare");
  if (!host) return;

  const earthRadii = d.radiusEarth ?? 1;
  const bodies = [
    { name: "Earth", r: 1, color: "#60a5fa" },
    { name: d.planet.pl_name, r: earthRadii, color: CLASS_COLORS[d.cls], target: true },
    { name: "Neptune", r: 3.883, color: "#3b82f6" },
    { name: "Jupiter", r: 11.209, color: "#fb923c" },
    { name: d.planet.hostname, r: (d.planet.st_rad ?? 1) * 109.2, color: "#fde68a", star: true },
  ];
  const maxLatin = Math.log10(Math.max(...bodies.map((b) => b.r)) + 1);
  host.innerHTML = bodies.map((b) => {
    const size = 16 + (Math.log10(b.r + 1) / maxLatin) * 62;
    return `<div class="size-item">
      <div class="size-ball" style="width:${size}px;height:${size}px;background:radial-gradient(circle at 33% 28%, ${b.color}, ${b.color}44);box-shadow:0 0 ${b.target ? 20 : 10}px ${b.color}66${b.target ? ", 0 0 0 2px rgba(255,255,255,.5)" : ""}"></div>
      <em>${b.star ? "★ " : ""}${b.r >= 100 ? b.r.toFixed(0) : b.r.toFixed(2)} R⊕</em>
      <span>${escapeHtml(b.name)}</span>
    </div>`;
  }).join("");
}
