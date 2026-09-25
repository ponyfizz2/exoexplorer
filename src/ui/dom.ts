/** Presentation helpers. Pure functions returning HTML strings, plus a tiny DOM helper. */

import { CLASS_COLORS, PLANET_CLASSES } from "../lib/astronomy";
import type { DerivedPlanet, PlanetClass, TempBand } from "../lib/types";
import { escapeHtml, formatDistance, formatLightYears, formatMass, formatPeriod, formatRadius, formatTemp, int, temperatureColor } from "../lib/utils";
import { ICONS, type IconName } from "./icons";
import { paletteFor } from "../render/planetTextures";

export const icon = (name: IconName, size = 13): string =>
  `<span class="icon" style="width:${size}px;height:${size}px">${ICONS[name]}</span>`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export const CLASS_BLURB: Record<PlanetClass, string> = {
  "Sub-Earth": "Smaller than Earth — most are scorched remnants of evaporated atmospheres.",
  Terrestrial: "Earth-sized and rocky. The size we think life needs.",
  "Super-Earth": "Bigger than Earth, still likely rocky. The most interesting mass class.",
  "Neptune-like": "Volatile-rich and shrouded — too big to be rocky, too small to be a giant.",
  "Sub-Jovian": "Saturn-mass worlds, often with rings and moons of their own.",
  Jovian: "Gas giants. Hostile to life, but they shepherd entire planetary systems.",
  Unknown: "Not enough measured data to place this world on the mass-radius diagram.",
};

export const TEMP_BAND_STYLE: Record<TempBand, string> = {
  Scorching: "chip--bad", Hot: "chip--bad", Warm: "chip--warn",
  Temperate: "chip--good", Cool: "chip--info", Cold: "chip--info",
  Frigid: "chip--violet", Unknown: "",
};

/** A disc that reads as a world: class colour for exotic types, palette for the rest. */
export function swatchStyle(d: DerivedPlanet): string {
  const palette = paletteFor(d.cls, d.equilibriumTemp, d.radiusEarth, d.id);
  const c = (rgb: [number, number, number]) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const glow = CLASS_COLORS[d.cls];
  return `background: radial-gradient(circle at 33% 28%, ${c(palette.high)} 0%, ${c(palette.mid)} 48%, ${c(palette.low)} 100%); --swatch-glow: ${glow}88;`;
}

export function classChip(d: DerivedPlanet): string {
  return `<span class="chip" style="color:${CLASS_COLORS[d.cls]};border-color:${CLASS_COLORS[d.cls]}55;background:${CLASS_COLORS[d.cls]}18">
    <i class="dot" style="background:${CLASS_COLORS[d.cls]}"></i>${d.cls}</span>`;
}

export function habitabilityChip(d: DerivedPlanet): string {
  const tone = d.habitability >= 60 ? "chip--good" : d.habitability >= 35 ? "chip--warn" : "chip--bad";
  return `<span class="chip ${tone}">HI ${d.habitability.toFixed(0)}</span>`;
}

export function hzChip(d: DerivedPlanet): string {
  if (d.hzStatus === "inside") return `<span class="chip chip--good">Inside HZ</span>`;
  if (d.hzStatus === "outside-inner") return `<span class="chip chip--bad">Too hot</span>`;
  if (d.hzStatus === "outside-outer") return `<span class="chip chip--info">Too cold</span>`;
  return "";
}

export function confidenceChip(d: DerivedPlanet): string {
  if (d.confidence === "Disputed") return `<span class="chip chip--bad">Disputed</span>`;
  if (d.confidence === "Tentative") return `<span class="chip chip--warn">Tentative</span>`;
  return "";
}

export function habitabilityBar(d: DerivedPlanet): string {
  const score = d.habitability;
  const color = score >= 60 ? "linear-gradient(90deg,#34d399,#22d3ee)"
    : score >= 35 ? "linear-gradient(90deg,#fbbf24,#fb923c)"
      : "linear-gradient(90deg,#f43f5e,#a855f7)";
  return `<div class="habitability-bar">
    <div class="habitability-bar__track"><div class="habitability-bar__fill" style="width:${score}%;background:${color}"></div></div>
    <div class="habitability-bar__label"><span>Habitability</span><span style="color:#fff">${score.toFixed(1)}<span style="color:var(--text-faint)">/100</span></span></div>
  </div>`;
}

export function planetCard(d: DerivedPlanet): string {
  const mass = formatMass(d.massEarth);
  const radius = formatRadius(d.radiusEarth);
  const temp = formatTemp(d.equilibriumTemp);
  return `<button class="planet-card" data-planet="${escapeHtml(d.id)}" type="button" style="--card-glow:${CLASS_COLORS[d.cls]}22">
    <div class="planet-card__top">
      <div class="planet-swatch" style="${swatchStyle(d)}"></div>
      <div style="min-width:0">
        <div class="planet-card__name">${escapeHtml(d.planet.pl_name)}</div>
        <div class="planet-card__host">${escapeHtml(d.planet.hostname)} · ${escapeHtml(d.planet.discoverymethod)}</div>
      </div>
    </div>
    <dl class="planet-card__metrics">
      <div class="metric"><dt>Radius</dt><dd>${radius.value}<small>${radius.unit}${d.radiusInferred ? " est" : ""}</small></dd></div>
      <div class="metric"><dt>Mass</dt><dd>${mass.value}<small>${mass.unit}${d.massInferred ? " est" : ""}</small></dd></div>
      <div class="metric"><dt>Distance</dt><dd style="font-size:11.5px">${formatLightYears(d.planet.sy_dist)}</dd></div>
      <div class="metric"><dt>Equil. temp</dt><dd style="color:${temperatureColor(d.equilibriumTemp)}">${temp.value}<small>${temp.unit}</small></dd></div>
    </dl>
    ${habitabilityBar(d)}
    <div class="card-badges">${classChip(d)}${hzChip(d)}${confidenceChip(d)}</div>
  </button>`;
}

export function headerStats(stats: {
  total: number; habitable: number; earthLike: number; nearest: number | null; methods: number;
}): string {
  const pills = [
    { label: "Confirmed", value: int(stats.total), cls: "" },
    { label: "In habitable zone", value: int(stats.habitable), cls: "accent" },
    { label: "Earth-sized", value: int(stats.earthLike), cls: "violet" },
    { label: "Nearest", value: stats.nearest === null ? "—" : `${stats.nearest.toFixed(1)} pc`, cls: "emerald" },
    { label: "Methods", value: int(stats.methods), cls: "" },
  ];
  return pills.map((p) => `<div class="stat-pill ${p.cls}"><b>${p.value}</b><span>${p.label}</span></div>`).join("");
}

export function leaderRow(d: DerivedPlanet, rank: number): string {
  const radius = formatRadius(d.radiusEarth);
  const temp = formatTemp(d.equilibriumTemp);
  return `<button class="leader-row" data-planet="${escapeHtml(d.id)}" type="button">
    <div class="leader-rank">${rank}</div>
    <div style="min-width:0">
      <div class="leader-name">${escapeHtml(d.planet.pl_name)}</div>
      <div class="leader-host">${escapeHtml(d.planet.hostname)} · ${escapeHtml(d.star.spectralClass)} · ${d.cls}</div>
      <div class="card-badges" style="margin-top:6px">${hzChip(d)}${confidenceChip(d)}</div>
    </div>
    <div class="leader-metrics">
      <span>R <b>${radius.value}${radius.unit}</b></span>
      <span>T<b>eq</b> <b>${temp.value} ${temp.unit}</b></span>
      <span>ESI <b>${d.esi === null ? "—" : d.esi.toFixed(2)}</b></span>
    </div>
    <div class="leader-score"><b>${d.habitability.toFixed(0)}</b><span>Habitability</span></div>
  </button>`;
}

export const sortOptions = [
  { value: "habitability_desc", label: "Habitability · best first", key: (d: DerivedPlanet) => -d.habitability },
  { value: "esi_desc", label: "Earth similarity · best first", key: (d: DerivedPlanet) => -(d.esi ?? 0) },
  { value: "year_desc", label: "Discovery · newest first", key: (d: DerivedPlanet) => -d.planet.disc_year },
  { value: "year_asc", label: "Discovery · oldest first", key: (d: DerivedPlanet) => d.planet.disc_year },
  { value: "dist_asc", label: "Distance · nearest first", key: (d: DerivedPlanet) => d.planet.sy_dist ?? Number.POSITIVE_INFINITY },
  { value: "radius_asc", label: "Radius · smallest first", key: (d: DerivedPlanet) => d.radiusEarth ?? Number.POSITIVE_INFINITY },
  { value: "radius_desc", label: "Radius · largest first", key: (d: DerivedPlanet) => -(d.radiusEarth ?? 0) },
  { value: "mass_desc", label: "Mass · heaviest first", key: (d: DerivedPlanet) => -(d.massEarth ?? 0) },
  { value: "period_asc", label: "Orbital period · shortest first", key: (d: DerivedPlanet) => d.planet.pl_orbper ?? Number.POSITIVE_INFINITY },
  { value: "name_asc", label: "Name · A to Z", key: (d: DerivedPlanet) => d.planet.pl_name.toLowerCase() },
];

export function sortKeyFor(value: string): (d: DerivedPlanet) => number | string {
  return sortOptions.find((o) => o.value === value)?.key ?? sortOptions[0].key;
}

export { PLANET_CLASSES, CLASS_COLORS };

export const selectOptions = (items: { value: string; label: string }[], selected?: string): string =>
  items.map((i) => `<option value="${escapeHtml(i.value)}"${i.value === selected ? " selected" : ""}>${escapeHtml(i.label)}</option>`).join("");

export function emptyState(title: string, message: string, actionLabel?: string, actionId?: string): string {
  return `<div class="empty-state">
    <div style="width:44px;height:44px;margin:0 auto 14px;opacity:.5">${ICONS.orbit}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    ${actionLabel && actionId ? `<button class="btn btn--primary" id="${actionId}" type="button">${escapeHtml(actionLabel)}</button>` : ""}
  </div>`;
}

export function notice(message: string): string {
  return `<div class="notice">${ICONS.warning}<span>${message}</span></div>`;
}
