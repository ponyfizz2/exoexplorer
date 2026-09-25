/**
 * EXOEXPLORER — application controller.
 *
 * Five views over one dataset:
 *   Galaxy    — every confirmed planet, in real 3D space, scrubbable through time
 *   Atlas     — the browsable catalogue
 *   Analytics — distributions, correlations and selection effects
 *   Worlds    — the habitability leaderboard
 *   Archive   — the raw sortable table, exportable to CSV
 *
 * State flows one way: a single `fleet` plus a `FilterState` produce a filtered
 * set, which every view renders from. The galaxy keeps its camera between updates.
 */

import { derive, CLASS_COLORS, PLANET_CLASSES } from "./lib/astronomy";
import { loadFleet } from "./lib/client";
import type { DerivedPlanet, Fleet, PlanetClass } from "./lib/types";
import { clamp, escapeHtml, formatLightYears, formatMass, formatPeriod, formatRadius, formatTemp, int } from "./lib/utils";
import { AXIS_PRESETS, axisSpec, createMethodDonut, createScatterChart, createTimeline, DEFAULT_COLOR_BY, type ChartHandle, type ColorMode } from "./render/charts";
import { GalaxyView, methodColor, type SizeMode } from "./render/galaxy";
import { Starfield } from "./render/starfield";
import { ICONS } from "./ui/icons";
import {
  classChip, emptyState, habitabilityBar, headerStats, icon, leaderRow, notice, planetCard,
  selectOptions, sortKeyFor, sortOptions, swatchStyle, TEMP_BAND_STYLE,
} from "./ui/dom";
import {
  destroySystemView, detailSidebarHtml, isSystemPaused, mountSystemView, renderSizeCompare,
  renderSystem, setSystemPaused, systemDebugState, wireTravel,
} from "./ui/detail";

// --- Small DOM helpers ------------------------------------------------------

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// --- State ------------------------------------------------------------------

interface FilterState {
  search: string;
  classes: Set<PlanetClass>;
  methods: Set<string>;
  maxDistance: number;
  yearFrom: number;
  yearTo: number;
  habitableOnly: boolean;
  rockyOnly: boolean;
  maxHabitabilityDistance: number;
  includeSolar: boolean;
  sort: string;
}

interface AppState {
  fleet: Fleet;
  derived: DerivedPlanet[];
  filtered: DerivedPlanet[];
  byHost: Map<string, DerivedPlanet[]>;
  filters: FilterState;
  view: ViewName;
  gridVisible: number;
  tablePage: number;
  tableSort: string;
  selected: string | null;
  galaxyYear: number;
  yearPlaying: boolean;
  warnings: string[];
}

type ViewName = "galaxy" | "atlas" | "lab" | "worlds" | "data";

const state: Partial<AppState> = {};
let galaxy: GalaxyView | null = null;
let detailOpen = false;

const VIEWS: { id: ViewName; label: string; icon: keyof typeof ICONS; hint: string }[] = [
  { id: "galaxy", label: "Galaxy Map", icon: "orbit", hint: "3D map" },
  { id: "atlas", label: "Atlas", icon: "grid", hint: "browse" },
  { id: "lab", label: "Analytics", icon: "chart", hint: "charts" },
  { id: "worlds", label: "Habitable Worlds", icon: "trophy", hint: "ranking" },
  { id: "data", label: "Archive", icon: "table", hint: "table" },
];

// --- Boot -------------------------------------------------------------------

async function boot(): Promise<void> {
  const starfield = new Starfield(document.getElementById("starfield") as HTMLCanvasElement);
  void starfield;

  const bootEl = $("boot");
  const statusEl = $("boot-status");
  const messages = [
    "Contacting the NASA Exoplanet Archive…",
    "Downloading confirmed-planet records…",
    "Computing habitable zones…",
    "Deriving masses, densities and escape velocities…",
    "Placing worlds in galactic coordinates…",
  ];
  let messageIndex = 0;
  const cycle = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    statusEl.textContent = messages[messageIndex];
  }, 900);

  let fleet: Fleet;
  let warnings: string[] = [];
  try {
    const result = await loadFleet();
    fleet = result.fleet;
    warnings = result.warnings;
  } catch (error) {
    window.clearInterval(cycle);
    statusEl.textContent = "Could not reach any data source.";
    showFatal(error instanceof Error ? error.message : String(error));
    return;
  }

  window.clearInterval(cycle);
  statusEl.textContent = `Analysing ${fleet.planets.length.toLocaleString("en-US")} worlds…`;

  // Derive everything once, off the critical path of first paint.
  await nextFrame();
  const derived = fleet.planets.map(derive);
  derived.sort((a, b) => b.habitability - a.habitability);

  const byHost = new Map<string, DerivedPlanet[]>();
  for (const d of derived) {
    const list = byHost.get(d.planet.hostname);
    if (list) list.push(d);
    else byHost.set(d.planet.hostname, [d]);
  }

  const distances = derived.map((d) => d.planet.sy_dist).filter((v): v is number => typeof v === "number");
  const years = derived.map((d) => d.planet.disc_year).filter((v) => Number.isFinite(v));
  const maxDistance = Math.ceil(Math.max(...distances, 100));

  Object.assign(state, {
    fleet,
    derived,
    filtered: derived,
    byHost,
    warnings,
    gridVisible: 60,
    tablePage: 0,
    tableSort: "habitability_desc",
    selected: null,
    galaxyYear: Math.max(...years),
    yearPlaying: false,
    view: "galaxy",
    filters: {
      search: "",
      classes: new Set<PlanetClass>(),
      methods: new Set<string>(),
      maxDistance,
      yearFrom: Math.min(...years),
      yearTo: Math.max(...years),
      habitableOnly: false,
      rockyOnly: false,
      maxHabitabilityDistance: 0,
      includeSolar: false,
      sort: "habitability_desc",
    } satisfies FilterState,
  });

  renderHeaderStats();
  renderTabs();
  applyFilters({ initial: true });

  bootEl.classList.add("hidden");
  $("shell").hidden = false;

  // Activate the starting view BEFORE anything measures the 3D stage. A .view is
  // display:none until .active lands, so without this the galaxy canvas is built
  // against a zero-height container and renders nothing.
  setViewInitial("galaxy");
  window.setTimeout(() => bootEl.remove(), 800);

  for (const warning of warnings) toast("warn", "Reduced mode", warning);
  if (fleet.meta.origin === "snapshot") {
    toast("info", "Bundled snapshot", "The live archive feed was unavailable, so the app is showing its last bundled snapshot of the catalogue.");
  }

  window.addEventListener("hashchange", applyHash);
  applyHash();
}

function showFatal(message: string): void {
  const bootEl = $("boot");
  bootEl.innerHTML = `
    <div class="boot-inner">
      <div style="width:52px;height:52px;margin:0 auto 18px;color:var(--rose)">${ICONS.warning}</div>
      <h2 style="color:var(--rose)">Uplink failed</h2>
      <p style="max-width:44ch;margin:0 auto 18px;line-height:1.6">${escapeHtml(message)}</p>
      <button class="btn btn--primary" onclick="location.reload()" type="button">Retry connection</button>
    </div>`;
}

// --- Header, tabs, toasts ---------------------------------------------------

function renderHeaderStats(): void {
  const s = state as AppState;
  const habitable = s.derived.filter((d) => d.potentiallyHabitable).length;
  const earthLike = s.derived.filter((d) => d.radiusEarth !== null && d.radiusEarth >= 0.8 && d.radiusEarth <= 1.5).length;
  const nearest = s.derived.reduce<number | null>((min, d) => {
    const dist = d.planet.sy_dist;
    if (typeof dist !== "number" || dist <= 0) return min;
    return min === null || dist < min ? dist : min;
  }, null);
  const methods = new Set(s.derived.map((d) => d.planet.discoverymethod)).size;
  $("header-stats").innerHTML = headerStats({ total: s.derived.length, habitable, earthLike, nearest, methods });

  const chip = $("feed-status");
  const text = $("feed-status-text");
  const origin = s.fleet.meta.origin ?? "network";
  chip.classList.toggle("warn", origin !== "network");
  text.textContent = origin === "network" ? "LIVE ARCHIVE" : origin === "snapshot" ? "SNAPSHOT" : "CACHED";
  chip.title = `${s.fleet.meta.source}\nFetched ${new Date(s.fleet.meta.fetchedAt).toLocaleString()}`;
}

function renderTabs(): void {
  const bar = $("tabbar");
  bar.innerHTML = VIEWS.map((v) => `
    <button class="tab" role="tab" id="tab-${v.id}" data-view="${v.id}" aria-selected="${v.id === state.view}" aria-controls="view-${v.id}" type="button">
      <span class="tab-icon" style="width:14px;height:14px;display:inline-flex">${ICONS[v.icon]}</span>
      ${v.label}
      ${v.id === "worlds" ? `<span class="tab-badge" id="worlds-badge">0</span>` : ""}
    </button>`).join("");

  bar.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view as ViewName));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const index = VIEWS.findIndex((v) => v.id === state.view);
      const next = VIEWS[(index + (event.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length];
      setView(next.id);
      bar.querySelector<HTMLButtonElement>(`[data-view="${next.id}"]`)?.focus();
    });
  });

  const badge = document.getElementById("worlds-badge");
  if (badge) badge.textContent = String((state as AppState).derived.filter((d) => d.potentiallyHabitable).length);
}

/** Same as setView but without writing the hash — used once during boot. */
function setViewInitial(view: ViewName): void {
  const s = state as AppState;
  s.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String((tab as HTMLElement).dataset.view === view));
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
}

function setView(view: ViewName): void {
  const s = state as AppState;
  s.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String((tab as HTMLElement).dataset.view === view));
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  location.hash = `#/${view}`;

  // The galaxy canvas needs a live size before it can be measured correctly.
  if (view === "galaxy") window.setTimeout(() => galaxy?.resizeIfNeeded(), 40);
  if (view === "atlas") renderAtlas();
  if (view === "lab") renderLab();
  if (view === "worlds") renderWorlds();
  if (view === "data") renderDataTable();
}

function toast(kind: "error" | "warn" | "info", title: string, message: string): void {
  const host = $("toasts");
  const node = document.createElement("div");
  node.className = `toast toast--${kind}`;
  node.innerHTML = `<div style="width:16px;height:16px;flex:0 0 auto;color:${kind === "error" ? "var(--rose)" : kind === "warn" ? "var(--amber)" : "var(--cyan)"}">${kind === "info" ? ICONS.info : ICONS.warning}</div>
    <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  host.appendChild(node);
  window.setTimeout(() => {
    node.style.transition = "opacity .4s ease, transform .4s ease";
    node.style.opacity = "0";
    node.style.transform = "translateX(26px)";
    window.setTimeout(() => node.remove(), 420);
  }, 7000);
}

// --- Filtering --------------------------------------------------------------

function isSolar(d: DerivedPlanet): boolean {
  return d.id === "Earth" || d.id === "Mars" || d.id === "Venus" || d.id === "Mercury"
    || d.id === "Jupiter" || d.id === "Saturn" || d.id === "Uranus" || d.id === "Neptune" || d.id === "Pluto";
}

function applyFilters(options: { initial?: boolean } = {}): void {
  const s = state as AppState;
  const f = s.filters;
  const search = f.search.trim().toLowerCase();

  const result = s.derived.filter((d) => {
    if (search && !(d.planet.pl_name.toLowerCase().includes(search) || d.planet.hostname.toLowerCase().includes(search))) return false;
    if (f.classes.size && !f.classes.has(d.cls)) return false;
    if (f.methods.size && !f.methods.has(d.planet.discoverymethod)) return false;
    if (typeof d.planet.sy_dist === "number" && d.planet.sy_dist > f.maxDistance) return false;
    if (d.planet.disc_year < f.yearFrom || d.planet.disc_year > f.yearTo) return false;
    if (f.habitableOnly && !d.potentiallyHabitable) return false;
    if (f.rockyOnly && !(d.radiusEarth !== null && d.radiusEarth <= 1.8)) return false;
    if (f.maxHabitabilityDistance > 0 && (d.hzStatus !== "inside" || (d.hzDistance ?? 0) > f.maxHabitabilityDistance)) return false;
    return true;
  });

  result.sort((a, b) => {
    const key = sortKeyFor(f.sort);
    const va = key(a);
    const vb = key(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb));
    return (va as number) - (vb as number);
  });

  s.filtered = result;
  s.gridVisible = 60;

  if (s.view === "galaxy") {
    galaxy?.setPlanets(result);
    renderGalaxySidebar();
  }
  if (s.view === "atlas") renderAtlas();
  if (s.view === "lab") renderLab();
  if (s.view === "worlds") renderWorlds();
  if (s.view === "data") renderDataTable();
}

// --- Galaxy view ------------------------------------------------------------

async function initGalaxy(): Promise<void> {
  const s = state as AppState;
  const stage = $("galaxy-stage");
  const canvasHost = $("galaxy-canvas");
  // Wait for real layout before constructing the renderer; a 0x0 canvas would
  // silently render nothing forever.
  for (let attempt = 0; attempt < 30 && (!stage.clientWidth || !stage.clientHeight); attempt += 1) {
    await nextFrame();
  }

  galaxy = new GalaxyView(canvasHost, { reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  galaxy.setPlanets(s.filtered);
  galaxy.setYear(s.galaxyYear);
  galaxy.onHoverChange((d, event) => {
    const tooltip = $("galaxy-tooltip");
    if (!d || !event) { tooltip.classList.remove("visible"); return; }
    const temp = formatTemp(d.equilibriumTemp);
    const radius = formatRadius(d.radiusEarth);
    tooltip.innerHTML = `
      <div class="tooltip-title">${escapeHtml(d.planet.pl_name)}</div>
      <div class="tooltip-sub">${escapeHtml(d.planet.hostname)} · ${d.cls}</div>
      <div class="tooltip-row"><span>Distance</span><b>${formatLightYears(d.planet.sy_dist)}</b></div>
      <div class="tooltip-row"><span>Radius</span><b>${radius.value} ${radius.unit}</b></div>
      <div class="tooltip-row"><span>Eq. temp</span><b>${temp.value} ${temp.unit}</b></div>
      <div class="tooltip-row"><span>Habitability</span><b>${d.habitability.toFixed(1)}</b></div>
      <div class="tooltip-row"><span>Discovered</span><b>${d.planet.disc_year}</b></div>
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-top:5px">click to open dossier</div>`;
    tooltip.classList.add("visible");
    const rect = stage.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left + 16, 8, rect.width - 240);
    const y = clamp(event.clientY - rect.top - 20, 8, rect.height - 140);
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
  });
  galaxy.onSelectPlanet((d) => openDetail(d.id));
  renderGalaxySidebar();
  renderGalaxyHud();
}

function renderGalaxySidebar(): void {
  const s = state as AppState;
  const sidebar = $("galaxy-sidebar");
  const colorModes: { id: ColorMode; label: string }[] = [
    { id: "class", label: "Type" },
    { id: "temperature", label: "Temp" },
    { id: "method", label: "Method" },
    { id: "year", label: "Era" },
    { id: "habitability", label: "Habitability" },
  ];
  const sizeModes: { id: SizeMode; label: string }[] = [
    { id: "radius", label: "Radius" },
    { id: "mass", label: "Mass" },
    { id: "year", label: "Year" },
    { id: "distance", label: "Distance" },
    { id: "uniform", label: "Equal" },
  ];
  const currentColor = galaxy?.colorModeValue ?? "class";
  const currentSize = galaxy?.sizeModeValue ?? "radius";
  const top = s.filtered.slice(0, 6);
  const methods = [...new Set(s.derived.map((d) => d.planet.discoverymethod))].sort();
  const activeYear = s.galaxyYear;
  const visibleCount = s.filtered.filter((d) => d.planet.disc_year <= activeYear).length;

  const portal = galaxy?.portalValue ?? "local";
  const centredOnData = galaxy?.centredOnDataValue ?? false;

  sidebar.innerHTML = `
    <div class="side-section">
      <h3><i class="h3-mark"></i> Orbit around</h3>
      <div class="seg" style="width:100%" id="centre-mode">
        <button type="button" data-centre="sun" aria-pressed="${!centredOnData}" style="flex:1">The Sun</button>
        <button type="button" data-centre="data" aria-pressed="${centredOnData}" style="flex:1">Data centre</button>
      </div>
      <p style="margin:7px 0 0;font-size:10px;line-height:1.5;color:var(--text-faint)">
        The map is heliocentric, so Sol is the origin. The cloud looks lopsided because
        Kepler stared at one patch of sky at galactic latitude +44°.
      </p>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> View scale</h3>
      <div class="seg" style="width:100%" id="portal-mode">
        <button type="button" data-portal="local" aria-pressed="${portal === "local"}" style="flex:1">Local bubble</button>
        <button type="button" data-portal="galactic" aria-pressed="${portal === "galactic"}" style="flex:1">Whole galaxy</button>
      </div>
      <p style="margin:7px 0 0;font-size:10px;line-height:1.5;color:var(--text-faint)">
        ${portal === "local"
          ? "Linear scale out to 400 pc — real structure in the Sun's neighbourhood."
          : "Logarithmic scale out to 12 kpc — the whole surveyed galaxy in one frame."}
      </p>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Find a world</h3>
      <div class="search-box" style="flex:1">
        ${ICONS.search}
        <input class="field" id="galaxy-search" type="search" placeholder="Name or host star…" value="${escapeHtml(s.filters.search)}" />
      </div>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Colour by</h3>
      <div class="seg" style="width:100%;flex-wrap:wrap" id="color-mode">${colorModes.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === currentColor}">${m.label}</button>`).join("")}</div>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Size by</h3>
      <div class="seg" style="width:100%;flex-wrap:wrap" id="size-mode">${sizeModes.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === currentSize}">${m.label}</button>`).join("")}</div>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Narrow the field</h3>
      <div class="select-wrap" style="margin-bottom:8px">
        <select class="field field--sm" id="galaxy-class">${selectOptions([{ value: "", label: "All planet types" }, ...PLANET_CLASSES.map((c) => ({ value: c, label: c }))], [...s.filters.classes][0] ?? "")}</select>
      </div>
      <div class="select-wrap" style="margin-bottom:8px">
        <select class="field field--sm" id="galaxy-method">${selectOptions([{ value: "", label: "All discovery methods" }, ...methods.map((m) => ({ value: m, label: m }))], [...s.filters.methods][0] ?? "")}</select>
      </div>
      <label style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9.5px;color:var(--text-faint);letter-spacing:.1em;text-transform:uppercase">
        <span>Max distance</span><span id="distance-label" style="color:var(--cyan)">${int(s.filters.maxDistance)} pc</span>
      </label>
      <input class="range" type="range" id="galaxy-distance" min="10" max="${Math.ceil(s.filters.maxDistance)}" step="10" value="${s.filters.maxDistance}" aria-label="Maximum distance in parsecs" />
      <label class="switch" style="margin-top:8px">
        <input type="checkbox" id="galaxy-habitable" ${s.filters.habitableOnly ? "checked" : ""} />
        <span class="switch-track"></span>
        <span>Habitable-zone rocky worlds only</span>
      </label>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Most habitable</h3>
      <div style="display:flex;flex-direction:column;gap:6px" id="galaxy-top">
        ${top.map((d, i) => `
          <button class="btn btn--ghost" type="button" data-focus="${escapeHtml(d.id)}" style="justify-content:space-between;text-align:left;width:100%;padding:7px 9px">
            <span style="display:flex;align-items:center;gap:8px;min-width:0">
              <span class="planet-swatch" style="width:18px;height:18px;${swatchStyle(d)}"></span>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px">${escapeHtml(d.planet.pl_name)}</span>
            </span>
            <b style="font-family:var(--font-mono);font-size:11px;color:${CLASS_COLORS[d.cls]}">${d.habitability.toFixed(0)}</b>
          </button>`).join("") || `<p style="font-size:11px;color:var(--text-faint);margin:0">No worlds match the current filters.</p>`}
      </div>
    </div>

    <div class="side-section">
      <h3><i class="h3-mark"></i> Time machine</h3>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-faint);line-height:1.6;margin-bottom:8px">
        Showing <b style="color:var(--cyan)">${int(visibleCount)}</b> of ${int(s.filtered.length)} worlds<br />
        discovered by <b style="color:#fff">${activeYear}</b>
      </div>
      <input class="range" type="range" id="year-range" min="${s.filters.yearFrom}" max="${s.filters.yearTo}" step="1" value="${activeYear}" aria-label="Discovery year" />
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn--sm" type="button" id="year-play" style="flex:1;justify-content:center">${s.yearPlaying ? "❚❚ Pause" : "▶ Play history"}</button>
        <button class="btn btn--sm" type="button" id="year-reset" title="Reset to now">${ICONS.reset}</button>
      </div>
    </div>

    <div class="side-section" style="margin-top:auto">
      <button class="btn btn--ghost btn--sm" type="button" id="galaxy-reset" style="width:100%;justify-content:center">${ICONS.reset} Clear all filters</button>
    </div>
  `;

  // Wire it up.
  const searchInput = sidebar.querySelector<HTMLInputElement>("#galaxy-search");
  searchInput?.addEventListener("input", () => {
    s.filters.search = searchInput.value;
    applyFilters();
    const again = document.getElementById("galaxy-search") as HTMLInputElement | null;
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });

  sidebar.querySelectorAll<HTMLButtonElement>("#centre-mode button").forEach((button) => {
    button.addEventListener("click", () => {
      galaxy?.setCentredOnData(button.dataset.centre === "data");
      renderGalaxySidebar();
    });
  });

  sidebar.querySelectorAll<HTMLButtonElement>("#portal-mode button").forEach((button) => {
    button.addEventListener("click", () => {
      galaxy?.setPortal(button.dataset.portal as "local" | "galactic");
      renderGalaxySidebar();
      renderGalaxyHud();
    });
  });

  sidebar.querySelectorAll<HTMLButtonElement>("#color-mode button").forEach((button) => {
    button.addEventListener("click", () => {
      galaxy?.setColorMode(button.dataset.mode as ColorMode);
      renderGalaxySidebar(); renderGalaxyLegend(); renderGalaxyHud();
    });
  });
  sidebar.querySelectorAll<HTMLButtonElement>("#size-mode button").forEach((button) => {
    button.addEventListener("click", () => {
      galaxy?.setSizeMode(button.dataset.mode as SizeMode);
      renderGalaxySidebar();
    });
  });

  sidebar.querySelector<HTMLSelectElement>("#galaxy-class")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    s.filters.classes = new Set(value ? [value as PlanetClass] : []);
    applyFilters();
  });
  sidebar.querySelector<HTMLSelectElement>("#galaxy-method")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    s.filters.methods = new Set(value ? [value] : []);
    applyFilters();
  });

  const distanceSlider = sidebar.querySelector<HTMLInputElement>("#galaxy-distance");
  distanceSlider?.addEventListener("input", () => {
    s.filters.maxDistance = Number(distanceSlider.value);
    const label = document.getElementById("distance-label");
    if (label) label.textContent = `${int(s.filters.maxDistance)} pc`;
    galaxy?.setPlanets(filteredNow());
    renderGalaxyHud();
  });
  distanceSlider?.addEventListener("change", () => applyFilters());

  sidebar.querySelector<HTMLInputElement>("#galaxy-habitable")?.addEventListener("change", (event) => {
    s.filters.habitableOnly = (event.target as HTMLInputElement).checked;
    applyFilters();
  });

  sidebar.querySelectorAll<HTMLButtonElement>("[data-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.focus!;
      const index = filteredNow().findIndex((d) => d.id === id);
      if (index >= 0) {
        galaxy?.focusPlanet(index);
        const d = filteredNow()[index];
        if (d) window.setTimeout(() => openDetail(d.id), 500);
      }
    });
  });

  const yearSlider = sidebar.querySelector<HTMLInputElement>("#year-range");
  yearSlider?.addEventListener("input", () => {
    s.galaxyYear = Number(yearSlider.value);
    galaxy?.setYear(s.galaxyYear);
    renderGalaxyHud();
    const counter = sidebar.querySelector<HTMLElement>("#year-live");
    if (counter) counter.textContent = String(s.galaxyYear);
  });

  sidebar.querySelector<HTMLButtonElement>("#year-play")?.addEventListener("click", () => {
    s.yearPlaying ? stopYearPlay() : startYearPlay();
  });
  sidebar.querySelector<HTMLButtonElement>("#year-reset")?.addEventListener("click", () => {
    stopYearPlay();
    s.galaxyYear = s.filters.yearTo;
    galaxy?.setYear(s.galaxyYear);
    renderGalaxySidebar();
    renderGalaxyHud();
  });
  sidebar.querySelector<HTMLButtonElement>("#galaxy-reset")?.addEventListener("click", () => {
    s.filters.search = "";
    s.filters.classes = new Set();
    s.filters.methods = new Set();
    s.filters.habitableOnly = false;
    s.filters.maxDistance = 100000;
    galaxy?.clearFocus();
    applyFilters();
  });

  renderGalaxyLegend();
}

function filteredNow(): DerivedPlanet[] {
  return (state as AppState).filtered;
}

let yearTimer = 0;
function startYearPlay(): void {
  const s = state as AppState;
  s.yearPlaying = true;
  s.galaxyYear = s.filters.yearFrom;
  galaxy?.setYear(s.galaxyYear);
  renderGalaxySidebar();
  window.clearInterval(yearTimer);
  yearTimer = window.setInterval(() => {
    s.galaxyYear += 1;
    if (s.galaxyYear >= s.filters.yearTo) {
      s.galaxyYear = s.filters.yearTo;
      stopYearPlay();
    }
    galaxy?.setYear(s.galaxyYear);
    renderGalaxyHud();
    const slider = document.getElementById("year-range") as HTMLInputElement | null;
    if (slider) slider.value = String(s.galaxyYear);
  }, 320);
}

function stopYearPlay(): void {
  const s = state as AppState;
  s.yearPlaying = false;
  window.clearInterval(yearTimer);
  renderGalaxySidebar();
}

function renderGalaxyHud(): void {
  const s = state as AppState;
  const visible = s.filtered.filter((d) => d.planet.disc_year <= s.galaxyYear);
  $("galaxy-hud").innerHTML = `
    <div class="hud-card">
      <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-faint)">Worlds on screen</div>
      <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:#fff;line-height:1.2">${int(visible.length)}</div>
      <div style="font-size:10px;color:var(--text-faint)">of ${int(s.derived.length)} confirmed · up to ${s.galaxyYear}</div>
    </div>
    <div class="hud-card" style="font-family:var(--font-mono);font-size:9.5px;line-height:1.7">
      <div style="color:var(--cyan)">DRAG orbit · SCROLL zoom</div>
      <div style="color:var(--text-faint)">HOVER a world to probe it</div>
      <div style="color:var(--text-faint)">CLICK to open the dossier</div>
      <div style="color:var(--text-faint);margin-top:4px">${(galaxy?.portalValue ?? "local") === "local"
        ? "Linear scale · 400 pc horizon"
        : "Log scale · 1 pc → 12 kpc"}</div>
      <div style="color:var(--text-faint)">Centred on ${(galaxy?.centredOnDataValue ?? false) ? "the data" : "Sol (origin)"}</div>
      <div style="color:var(--text-faint);margin-top:4px;opacity:.75">Grey haze = Milky Way, not data</div>
    </div>`;
}

function renderGalaxyLegend(): void {
  const s = state as AppState;
  const mode = galaxy?.colorModeValue ?? "class";
  const existing = document.getElementById("galaxy-legend");
  existing?.remove();

  let rows: { color: string; label: string }[] = [];
  if (mode === "class") {
    rows = PLANET_CLASSES.map((c) => ({ color: CLASS_COLORS[c], label: c }));
  } else if (mode === "method") {
    const counts = new Map<string, number>();
    for (const d of s.filtered) counts.set(d.planet.discoverymethod, (counts.get(d.planet.discoverymethod) ?? 0) + 1);
    rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([m]) => ({ color: methodColor(m), label: m }));
  } else if (mode === "temperature") {
    rows = [
      { color: "#7c3aed", label: "< 100 K" }, { color: "#3b82f6", label: "250 K" },
      { color: "#22d3ee", label: "400 K" }, { color: "#facc15", label: "700 K" },
      { color: "#fb923c", label: "1,200 K" }, { color: "#ef4444", label: "> 2,500 K" },
    ];
  } else if (mode === "habitability") {
    rows = [
      { color: "#1e3a8a", label: "Uninhabitable" }, { color: "#facc15", label: "Marginal" },
      { color: "#22c55e", label: "Promising" },
    ];
  } else {
    rows = [
      { color: "hsl(223,85%,45%)", label: "1992–2005" }, { color: "hsl(180,85%,50%)", label: "2010" },
      { color: "hsl(120,85%,58%)", label: "2020" }, { color: "hsl(40,85%,63%)", label: "2026" },
    ];
  }

  const legend = document.createElement("div");
  legend.className = "galaxy-legend";
  legend.id = "galaxy-legend";
  legend.innerHTML = `<h4>${mode === "class" ? "Planet type" : mode === "method" ? "Discovery method" : mode === "temperature" ? "Equilibrium temperature" : mode === "year" ? "Discovery era" : "Habitability index"}</h4>
    ${rows.map((r) => `<div class="legend-row"><i class="dot" style="background:${r.color}"></i>${escapeHtml(r.label)}</div>`).join("")}`;
  $("galaxy-stage").appendChild(legend);
}

// --- Atlas ------------------------------------------------------------------

function renderAtlas(): void {
  const s = state as AppState;
  const host = $("atlas-body");
  const methods = [...new Set(s.derived.map((d) => d.planet.discoverymethod))].sort();
  const visible = s.filtered.slice(0, s.gridVisible);
  const solarData = s.filters.includeSolar ? SOLAR_ENTRIES() : [];

  host.innerHTML = `
    <div class="panel filter-bar">
      <div class="search-box">
        ${ICONS.search}
        <input class="field" id="atlas-search" type="search" placeholder="Search by planet or host star…" value="${escapeHtml(s.filters.search)}" />
      </div>
      <div class="select-wrap">
        <select class="field field--sm" id="atlas-sort" style="min-width:190px">${selectOptions(sortOptions.map((o) => ({ value: o.value, label: o.label })), s.filters.sort)}</select>
      </div>
      <div class="select-wrap">
        <select class="field field--sm" id="atlas-class" style="min-width:150px">${selectOptions([{ value: "", label: "All types" }, ...PLANET_CLASSES.map((c) => ({ value: c, label: c }))], [...s.filters.classes][0] ?? "")}</select>
      </div>
      <div class="select-wrap">
        <select class="field field--sm" id="atlas-method" style="min-width:180px">${selectOptions([{ value: "", label: "All methods" }, ...methods.map((m) => ({ value: m, label: m }))], [...s.filters.methods][0] ?? "")}</select>
      </div>
      <label class="switch"><input type="checkbox" id="atlas-habitable" ${s.filters.habitableOnly ? "checked" : ""} /><span class="switch-track"></span><span>Habitable zone</span></label>
      <label class="switch"><input type="checkbox" id="atlas-rocky" ${s.filters.rockyOnly ? "checked" : ""} /><span class="switch-track"></span><span>Rocky (≤1.8 R⊕)</span></label>
      <label class="switch"><input type="checkbox" id="atlas-solar" ${s.filters.includeSolar ? "checked" : ""} /><span class="switch-track"></span><span>Add Solar System</span></label>
      <button class="btn btn--sm" type="button" id="atlas-reset">${ICONS.reset} Reset</button>
      <div style="margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--text-dim)">
        <b style="color:var(--cyan)">${int(s.filtered.length)}</b> matching · showing ${int(visible.length)}
      </div>
    </div>

    ${s.filters.includeSolar ? notice("The Solar System planets are shown for reference and are included in the grid below, but they are not part of the exoplanet statistics.") : ""}

    ${s.filtered.length === 0
      ? emptyState("No worlds match those filters", "Try widening the distance, clearing the planet-type filter, or searching for a different star.", "Clear filters", "atlas-empty-reset")
      : `<div class="planet-grid">${solarData.map(planetCard).join("")}${visible.map(planetCard).join("")}</div>`}

    ${s.filtered.length > s.gridVisible ? `
      <div class="load-more-wrap">
        <button class="btn btn--primary" type="button" id="atlas-more">Load ${int(Math.min(60, s.filtered.length - s.gridVisible))} more of ${int(s.filtered.length - s.gridVisible)}</button>
      </div>` : ""}
  `;

  const rerender = () => { s.gridVisible = 60; renderAtlas(); };
  host.querySelector<HTMLInputElement>("#atlas-search")?.addEventListener("input", (event) => {
    s.filters.search = (event.target as HTMLInputElement).value;
    s.gridVisible = 60;
    renderAtlas();
    const input = document.getElementById("atlas-search") as HTMLInputElement | null;
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  });
  host.querySelector<HTMLSelectElement>("#atlas-sort")?.addEventListener("change", (event) => { s.filters.sort = (event.target as HTMLSelectElement).value; s.gridVisible = 60; renderAtlas(); });
  host.querySelector<HTMLSelectElement>("#atlas-class")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    s.filters.classes = new Set(value ? [value as PlanetClass] : []); rerender();
  });
  host.querySelector<HTMLSelectElement>("#atlas-method")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    s.filters.methods = new Set(value ? [value] : []); rerender();
  });
  host.querySelector<HTMLInputElement>("#atlas-habitable")?.addEventListener("change", (event) => { s.filters.habitableOnly = (event.target as HTMLInputElement).checked; rerender(); });
  host.querySelector<HTMLInputElement>("#atlas-rocky")?.addEventListener("change", (event) => { s.filters.rockyOnly = (event.target as HTMLInputElement).checked; rerender(); });
  host.querySelector<HTMLInputElement>("#atlas-solar")?.addEventListener("change", (event) => { s.filters.includeSolar = (event.target as HTMLInputElement).checked; rerender(); });
  host.querySelector<HTMLButtonElement>("#atlas-reset")?.addEventListener("click", resetAllFilters);
  host.querySelector<HTMLButtonElement>("#atlas-empty-reset")?.addEventListener("click", resetAllFilters);
  host.querySelector<HTMLButtonElement>("#atlas-more")?.addEventListener("click", () => { s.gridVisible += 60; renderAtlas(); });

  host.querySelectorAll<HTMLElement>("[data-planet]").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.planet!));
  });
}

/** Solar System rows, exposed alongside the exoplanets when requested. */
function SOLAR_ENTRIES(): DerivedPlanet[] {
  const s = state as unknown as { solar?: DerivedPlanet[] };
  return s.solar ?? [];
}

function resetAllFilters(): void {
  const s = state as AppState;
  s.filters.search = "";
  s.filters.classes = new Set();
  s.filters.methods = new Set();
  s.filters.habitableOnly = false;
  s.filters.rockyOnly = false;
  s.filters.includeSolar = false;
  s.filters.sort = "habitability_desc";
  s.gridVisible = 60;
  renderAtlas();
}

// --- Analytics --------------------------------------------------------------

const charts: ChartHandle[] = [];
let timelineHandle: { render: (p: DerivedPlanet[], year: number) => void; onYearChange: (cb: (y: number) => void) => void; destroy: () => void } | null = null;
let donutHandle: { render: (p: DerivedPlanet[]) => void; destroy: () => void } | null = null;
const axisChoice = { x: "radius", y: "mass", x2: "period", y2: "eqtemp", x3: "starTemp", y3: "luminosity" };

function renderLab(): void {
  const s = state as AppState;
  const host = $("lab-body");
  const data = s.filtered;

  const inHz = data.filter((d) => d.hzStatus === "inside").length;
  const rockyHz = data.filter((d) => d.potentiallyHabitable).length;
  const measuredRadius = data.filter((d) => !d.radiusInferred && d.radiusEarth !== null).length;
  const measuredMass = data.filter((d) => !d.massInferred && d.massEarth !== null).length;
  const medianDistance = median(data.map((d) => d.planet.sy_dist).filter((v): v is number => typeof v === "number"));
  const hzAccuracy = data.length ? (inHz / data.length) * 100 : 0;

  const axisSelect = (id: string, selected: string) =>
    selectOptions(Object.entries(AXIS_PRESETS).map(([key, preset]) => ({ value: key, label: preset.label })), selected);

  if (!host.dataset.built) {
    host.innerHTML = `
      <div class="section-title">
        <h2>Analytics</h2>
        <p>Distributions, correlations and the selection effects hiding inside the catalogue.</p>
      </div>

      <div class="kpi-grid" id="lab-kpis"></div>

      <div class="chart-grid">
        <div class="panel">
          <div class="panel-head"><h2>Discovery timeline</h2><div class="spacer"></div>
            <span class="chip chip--info" id="timeline-total">—</span>
          </div>
          <div class="panel-body"><div class="chart-host" id="chart-timeline" style="height:210px"></div>
            <p style="margin:10px 0 0;font-size:11px;color:var(--text-faint);line-height:1.5">Stacked by detection method. Click a bar to jump the galaxy map to that year.</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Discovery methods</h2></div>
          <div class="panel-body" style="display:grid;grid-template-columns:minmax(140px,180px) 1fr;gap:14px;align-items:center">
            <div class="chart-host" id="chart-donut" style="height:180px;position:relative"></div>
            <ul class="method-legend" id="donut-legend"></ul>
          </div>
        </div>

        <div class="panel" style="grid-column:1/-1">
          <div class="panel-head"><h2>Mass–radius diagram</h2><div class="spacer"></div>
            <div class="select-wrap"><select class="field field--sm" id="mr-x">${axisSelect("mr-x", axisChoice.x)}</select></div>
            <div class="select-wrap"><select class="field field--sm" id="mr-y">${axisSelect("mr-y", axisChoice.y)}</select></div>
          </div>
          <div class="panel-body">
            <div class="chart-host chart-host--tall" id="chart-mr"></div>
            <p style="margin:10px 0 0;font-size:11px;color:var(--text-faint);line-height:1.5">
              Dashed line: the Chen &amp; Kipping (2017) forecaster relation. Faint points are inferred from that relation rather than measured.
              The gap between rocky worlds and Neptunes near 1.6 R⊕ is the radius valley.
            </p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Orbit vs temperature</h2><div class="spacer"></div>
            <div class="select-wrap"><select class="field field--sm" id="pt-x">${axisSelect("pt-x", axisChoice.x2)}</select></div>
            <div class="select-wrap"><select class="field field--sm" id="pt-y">${axisSelect("pt-y", axisChoice.y2)}</select></div>
          </div>
          <div class="panel-body"><div class="chart-host" id="chart-pt"></div></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Host stars</h2><div class="spacer"></div>
            <div class="select-wrap"><select class="field field--sm" id="hr-x">${axisSelect("hr-x", axisChoice.x3)}</select></div>
            <div class="select-wrap"><select class="field field--sm" id="hr-y">${axisSelect("hr-y", axisChoice.y3)}</select></div>
          </div>
          <div class="panel-body"><div class="chart-host" id="chart-hr"></div></div>
        </div>
      </div>

      <div class="floating-tooltip" id="lab-tooltip"></div>
    `;
    host.dataset.built = "1";

    const tooltip = $("lab-tooltip");
    timelineHandle = createTimeline($("chart-timeline"), tooltip);
    timelineHandle.onYearChange((year) => {
      s.galaxyYear = year;
      galaxy?.setYear(year);
      setView("galaxy");
      startYearPlayFrom(year);
    });
    donutHandle = createMethodDonut($("chart-donut"), $("donut-legend"), tooltip);

    const makeScatter = (hostId: string, xKey: string, yKey: string): ChartHandle => {
      const data = state.filtered ?? [];
      const xAxis = axisSpec(xKey, data);
      const yAxis = axisSpec(yKey, data);
      const chart = createScatterChart($(hostId), {
        title: hostId,
        key: xKey, label: xAxis.label, scale: xAxis.scale, get: xAxis.get,
        xAxis, yAxis,
        colorBy: DEFAULT_COLOR_BY,
        onSelect: (p) => openDetail(p.id),
      }, tooltip);
      charts.push(chart);
      return chart;
    };
    scatterCharts.mr = makeScatter("chart-mr", axisChoice.x, axisChoice.y);
    scatterCharts.pt = makeScatter("chart-pt", axisChoice.x2, axisChoice.y2);
    scatterCharts.hr = makeScatter("chart-hr", axisChoice.x3, axisChoice.y3);

    const wireAxis = (id: string, key: "mr" | "pt" | "hr", axis: "x" | "y") => {
      $(id).addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        if (key === "mr") { if (axis === "x") axisChoice.x = value; else axisChoice.y = value; }
        if (key === "pt") { if (axis === "x") axisChoice.x2 = value; else axisChoice.y2 = value; }
        if (key === "hr") { if (axis === "x") axisChoice.x3 = value; else axisChoice.y3 = value; }
        redrawScatters();
      });
    };
    wireAxis("mr-x", "mr", "x"); wireAxis("mr-y", "mr", "y");
    wireAxis("pt-x", "pt", "x"); wireAxis("pt-y", "pt", "y");
    wireAxis("hr-x", "hr", "x"); wireAxis("hr-y", "hr", "y");
  }

  // Data-driven updates.
  const kpiHost = $("lab-kpis");
  if (kpiHost) {
    kpiHost.innerHTML = [
      { label: "Worlds in selection", value: int(data.length), accent: "var(--cyan)", note: `of ${int(s.derived.length)} in the catalogue` },
      { label: "Inside habitable zone", value: int(inHz), accent: "var(--emerald)", note: `${hzAccuracy.toFixed(1)}% of the selection` },
      { label: "Rocky + in HZ", value: int(rockyHz), accent: "var(--amber)", note: "the shortlist for follow-up" },
      { label: "Radius measured", value: `${((measuredRadius / Math.max(data.length, 1)) * 100).toFixed(0)}%`, accent: "var(--violet)", note: `${int(measuredRadius)} worlds with a transit depth` },
      { label: "Mass measured", value: `${((measuredMass / Math.max(data.length, 1)) * 100).toFixed(0)}%`, accent: "var(--rose)", note: `${int(measuredMass)} worlds with a dynamical mass` },
      { label: "Median distance", value: medianDistance === null ? "—" : `${medianDistance.toFixed(0)} pc`, accent: "var(--cyan)", note: "half the catalogue is closer than this" },
    ].map((kpi) => `<dl class="kpi" style="--kpi-accent:${kpi.accent}"><dt>${kpi.label}</dt><dd>${kpi.value}</dd><div class="kpi-note">${kpi.note}</div></dl>`).join("");
  }

  timelineHandle?.render(s.derived, s.galaxyYear);
  const totalChip = document.getElementById("timeline-total");
  if (totalChip) totalChip.textContent = `${int(data.length)} selected`;
  donutHandle?.render(data);
  redrawScatters();
}

const scatterCharts: { mr?: ChartHandle; pt?: ChartHandle; hr?: ChartHandle } = {};

function redrawScatters(): void {
  const data = filteredNow();
  if (scatterCharts.mr) {
    scatterCharts.mr.render(data);
    rebuildAxes("mr", axisChoice.x, axisChoice.y);
  }
  if (scatterCharts.pt) {
    scatterCharts.pt.render(data);
    rebuildAxes("pt", axisChoice.x2, axisChoice.y2);
  }
  if (scatterCharts.hr) {
    scatterCharts.hr.render(data);
    rebuildAxes("hr", axisChoice.x3, axisChoice.y3);
  }
}

/**
 * The chart component owns its scales, so changing an axis means recreating that
 * one chart with the new spec. Cheap, and it keeps the component stateless.
 * A signature string tells us whether an axis actually changed.
 */
const axisSignatures: Record<string, string> = {};

function rebuildAxes(key: "mr" | "pt" | "hr", xKey: string, yKey: string): void {
  const signature = `${xKey}|${yKey}`;
  if (axisSignatures[key] === signature) return;
  axisSignatures[key] = signature;

  const hostId = key === "mr" ? "chart-mr" : key === "pt" ? "chart-pt" : "chart-hr";
  const existing = key === "mr" ? scatterCharts.mr : key === "pt" ? scatterCharts.pt : scatterCharts.hr;
  const data = filteredNow();
  const xAxis = axisSpec(xKey, data);
  const yAxis = axisSpec(yKey, data);

  existing?.destroy();
  const index = existing ? charts.indexOf(existing) : -1;
  if (index >= 0) charts.splice(index, 1);

  const chart = createScatterChart($(hostId), {
    title: hostId,
    key: xKey, label: xAxis.label, scale: xAxis.scale, get: xAxis.get,
    xAxis, yAxis,
    colorBy: DEFAULT_COLOR_BY,
    onSelect: (p) => openDetail(p.id),
  }, $("lab-tooltip"));
  chart.render(data);
  charts.push(chart);
  if (key === "mr") scatterCharts.mr = chart;
  if (key === "pt") scatterCharts.pt = chart;
  if (key === "hr") scatterCharts.hr = chart;
}

function startYearPlayFrom(year: number): void {
  const s = state as AppState;
  s.galaxyYear = year;
  startYearPlay();
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Habitable worlds -------------------------------------------------------

function renderWorlds(): void {
  const s = state as AppState;
  const host = $("worlds-body");
  const candidates = s.derived
    .filter((d) => d.radiusEarth !== null && d.radiusEarth <= 2.5 && d.esi !== null)
    .filter((d) => d.planet.disc_year <= s.galaxyYear || true)
    .sort((a, b) => b.habitability - a.habitability)
    .slice(0, 40);

  const inHz = candidates.filter((d) => d.hzStatus === "inside").length;
  const best = candidates[0];

  host.innerHTML = `
    <div class="section-title">
      <h2>The Goldilocks List</h2>
      <p>Ranked by a composite habitability index — Earth similarity, habitable-zone position, equilibrium temperature, density and host-star stability.</p>
    </div>

    <div class="kpi-grid">
      <dl class="kpi" style="--kpi-accent:var(--emerald)"><dt>Top-ranked world</dt><dd style="font-size:19px">${best ? escapeHtml(best.planet.pl_name) : "—"}</dd><div class="kpi-note">${best ? `${best.habitability.toFixed(1)} / 100 · ${formatLightYears(best.planet.sy_dist)} away` : ""}</div></dl>
      <dl class="kpi" style="--kpi-accent:var(--cyan)"><dt>Ranked candidates</dt><dd>${int(candidates.length)}</dd><div class="kpi-note">rocky (≤2.5 R⊕) with a computable ESI</div></dl>
      <dl class="kpi" style="--kpi-accent:var(--amber)"><dt>Inside the HZ</dt><dd>${int(inHz)}</dd><div class="kpi-note">of the top ${int(candidates.length)}</div></dl>
      <dl class="kpi" style="--kpi-accent:var(--violet)"><dt>Best ESI</dt><dd>${candidates.reduce((m, d) => Math.max(m, d.esi ?? 0), 0).toFixed(2)}</dd><div class="kpi-note">1.00 would be Earth</div></dl>
    </div>

    <div class="notice" style="border-color:rgba(34,211,238,.3);background:rgba(34,211,238,.07);color:#a5f3fc">
      ${ICONS.info}
      <span><b>How to read this.</b> A high score means "worth pointing a telescope at", not "has life". Equilibrium temperature ignores greenhouse warming — Venus scores as a temperate world on temperature alone. ESI is computed only from properties we can actually measure or defensibly infer; mass and radius flagged <i>est</i> come from the Chen &amp; Kipping relation.</span>
    </div>

    <div class="leaderboard">${candidates.map((d, i) => leaderRow(d, i + 1)).join("")}</div>
  `;

  host.querySelectorAll<HTMLElement>("[data-planet]").forEach((row) => {
    row.addEventListener("click", () => openDetail(row.dataset.planet!));
  });
}

// --- Data table -------------------------------------------------------------

const TABLE_COLUMNS: { key: string; label: string; sort?: string; get: (d: DerivedPlanet) => string }[] = [
  { key: "name", label: "Planet", sort: "name_asc", get: (d) => d.planet.pl_name },
  { key: "host", label: "Host star", get: (d) => d.planet.hostname },
  { key: "class", label: "Type", get: (d) => d.cls },
  { key: "radius", label: "Radius (R⊕)", sort: "radius_asc", get: (d) => formatRadius(d.radiusEarth).value + (d.radiusInferred ? " est" : "") },
  { key: "mass", label: "Mass", sort: "mass_desc", get: (d) => { const m = formatMass(d.massEarth); return `${m.value} ${m.unit}${d.massInferred ? " est" : ""}`; } },
  { key: "period", label: "Period", sort: "period_asc", get: (d) => formatPeriod(d.planet.pl_orbper) },
  { key: "axis", label: "a (AU)", get: (d) => (d.semiMajorAxis === null ? "—" : d.semiMajorAxis < 0.01 ? d.semiMajorAxis.toExponential(2) : d.semiMajorAxis.toFixed(3)) },
  { key: "temp", label: "Teq (K)", get: (d) => formatTemp(d.equilibriumTemp).value },
  { key: "hz", label: "Zone", get: (d) => (d.hzStatus === "inside" ? "inside" : d.hzStatus === "outside-inner" ? "hot" : d.hzStatus === "outside-outer" ? "cold" : "—") },
  { key: "esi", label: "ESI", sort: "esi_desc", get: (d) => (d.esi === null ? "—" : d.esi.toFixed(3)) },
  { key: "hi", label: "HI", sort: "habitability_desc", get: (d) => d.habitability.toFixed(1) },
  { key: "dist", label: "Distance", sort: "dist_asc", get: (d) => formatLightYears(d.planet.sy_dist) },
  { key: "method", label: "Method", get: (d) => d.planet.discoverymethod },
  { key: "year", label: "Year", sort: "year_desc", get: (d) => String(d.planet.disc_year) },
];

const PAGE_SIZE = 50;

function renderDataTable(): void {
  const s = state as AppState;
  const host = $("data-body");
  const sorted = [...s.filtered].sort((a, b) => {
    const key = sortKeyFor(s.tableSort);
    const va = key(a); const vb = key(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb));
    return (va as number) - (vb as number);
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  s.tablePage = clamp(s.tablePage, 0, pageCount - 1);
  const page = sorted.slice(s.tablePage * PAGE_SIZE, s.tablePage * PAGE_SIZE + PAGE_SIZE);

  host.innerHTML = `
    <div class="panel panel--flush">
      <div class="panel-head">
        <h2>Archive</h2>
        <div class="spacer"></div>
        <span class="chip chip--info">${int(sorted.length)} rows</span>
        <span class="chip">page ${s.tablePage + 1} / ${int(pageCount)}</span>
        <button class="btn btn--sm" type="button" id="export-csv">${ICONS.layers} Export CSV</button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            ${TABLE_COLUMNS.map((c) => `<th data-sort="${c.sort ?? ""}" ${s.tableSort === c.sort ? 'data-sorted="1"' : ""}>${c.label}${s.tableSort === c.sort ? " ▾" : ""}</th>`).join("")}
          </tr></thead>
          <tbody>
            ${page.map((d) => `<tr data-planet="${escapeHtml(d.id)}">
              ${TABLE_COLUMNS.map((c, i) => `<td${i === 0 ? ' class="name"' : ""}>${escapeHtml(c.get(d))}</td>`).join("")}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button class="btn btn--sm" type="button" id="page-first" ${s.tablePage === 0 ? "disabled" : ""}>« First</button>
        <button class="btn btn--sm" type="button" id="page-prev" ${s.tablePage === 0 ? "disabled" : ""}>‹ Prev</button>
        <span>${int(s.tablePage * PAGE_SIZE + 1)}–${int(Math.min((s.tablePage + 1) * PAGE_SIZE, sorted.length))}</span>
        <button class="btn btn--sm" type="button" id="page-next" ${s.tablePage >= pageCount - 1 ? "disabled" : ""}>Next ›</button>
        <button class="btn btn--sm" type="button" id="page-last" ${s.tablePage >= pageCount - 1 ? "disabled" : ""}>Last »</button>
      </div>
    </div>
  `;

  host.querySelectorAll<HTMLTableCellElement>("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const sort = th.dataset.sort;
      if (!sort) return;
      s.tableSort = sort;
      s.tablePage = 0;
      renderDataTable();
    });
  });
  host.querySelectorAll<HTMLElement>("[data-planet]").forEach((row) => {
    row.addEventListener("click", () => openDetail(row.dataset.planet!));
  });
  host.querySelector<HTMLButtonElement>("#page-first")?.addEventListener("click", () => { s.tablePage = 0; renderDataTable(); });
  host.querySelector<HTMLButtonElement>("#page-prev")?.addEventListener("click", () => { s.tablePage -= 1; renderDataTable(); });
  host.querySelector<HTMLButtonElement>("#page-next")?.addEventListener("click", () => { s.tablePage += 1; renderDataTable(); });
  host.querySelector<HTMLButtonElement>("#page-last")?.addEventListener("click", () => { s.tablePage = pageCount - 1; renderDataTable(); });
  host.querySelector<HTMLButtonElement>("#export-csv")?.addEventListener("click", () => exportCsv(sorted));
}

function exportCsv(rows: DerivedPlanet[]): void {
  const header = ["pl_name", "hostname", "discoverymethod", "disc_year", "sy_dist_pc", "light_years", "radius_earth", "radius_inferred", "mass_earth", "mass_inferred", "density_g_cm3", "surface_gravity_g", "escape_km_s", "semi_major_axis_au", "semi_major_axis_inferred", "orbital_period_days", "eq_temp_k", "star_teff_k", "star_spectral", "hz_inner_au", "hz_outer_au", "hz_status", "potentially_habitable", "esi", "habitability_index", "class"];
  const lines = rows.map((d) => [
    d.planet.pl_name, d.planet.hostname, d.planet.discoverymethod, d.planet.disc_year,
    d.planet.sy_dist ?? "", d.planet.sy_dist ? (d.planet.sy_dist * 3.261564).toFixed(3) : "",
    d.radiusEarth?.toFixed(4) ?? "", d.radiusInferred, d.massEarth?.toFixed(4) ?? "", d.massInferred,
    d.density?.toFixed(4) ?? "", d.gravity?.toFixed(4) ?? "", d.escapeVelocity?.toFixed(4) ?? "",
    d.semiMajorAxis?.toFixed(6) ?? "", d.semiMajorAxisInferred, d.planet.pl_orbper?.toFixed(6) ?? "",
    d.equilibriumTemp?.toFixed(2) ?? "", d.planet.st_teff ?? "", d.star.spectralClass,
    d.star.hzInner?.toFixed(4) ?? "", d.star.hzOuter?.toFixed(4) ?? "", d.hzStatus,
    d.potentiallyHabitable, d.esi?.toFixed(4) ?? "", d.habitability.toFixed(2), d.cls,
  ].map((v) => {
    const text = String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(","));

  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `exoexplorer-${rows.length}-worlds-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast("info", "Export ready", `${rows.length.toLocaleString("en-US")} rows written to CSV, including derived values and habitable-zone boundaries.`);
}

// --- Detail overlay ---------------------------------------------------------

function openDetail(id: string): void {
  const s = state as AppState;
  const d = s.derived.find((x) => x.id === id);
  if (!d) return;

  s.selected = id;
  const overlay = $("detail");
  const siblings = (s.byHost.get(d.planet.hostname) ?? []).slice(0, 8).filter((x) => x.id !== d.id);

  $("detail-name").textContent = d.planet.pl_name;
  $("detail-sub").textContent = `${d.cls} · ${d.planet.hostname} · ${d.planet.discoverymethod} ${d.planet.disc_year}`;
  $("detail-blurb").textContent = detailBlurb(d);
  $("detail-close-icon").innerHTML = ICONS.back;
  $("detail-side").innerHTML = detailSidebarHtml(d, siblings);

  if (!detailOpen) {
    mountSystemView($("detail-canvas"));
    detailOpen = true;
  }
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");

  const tabs = $("detail-view-tabs");
  tabs.innerHTML = ["Orbit view", "Close-up", "Wide system"]
    .map((label) => `<button type="button" aria-pressed="false">${label}</button>`).join("");

  window.requestAnimationFrame(() => {
    renderSystem(d, siblings, true);
    renderSizeCompare($("detail-side"), d);
    wireTravel(d, $("detail-side"));
  });

  history.replaceState(null, "", `#/planet/${encodeURIComponent(id)}`);
}

function detailBlurb(d: DerivedPlanet): string {
  const parts: string[] = [];
  const mass = formatMass(d.massEarth);
  const temp = formatTemp(d.equilibriumTemp);
  parts.push(`${d.cls} of ${mass.value} ${mass.unit} orbiting ${d.planet.hostname}`);
  if (d.equilibriumTemp !== null) parts.push(`with an equilibrium temperature of ${temp.value} K`);
  if (d.planet.sy_dist) parts.push(`${formatLightYears(d.planet.sy_dist)} away`);
  parts.push(`found by ${d.planet.discoverymethod.toLowerCase()} in ${d.planet.disc_year}`);
  let sentence = parts.join(", ") + ".";
  if (d.potentiallyHabitable) sentence += " It sits inside its star's conservative habitable zone and is small enough to be rocky.";
  else if (d.hzStatus === "inside") sentence += " It orbits inside the habitable zone but is likely too large to be a rocky world.";
  else if (d.hzStatus === "outside-inner") sentence += " It orbits too close to its star for liquid surface water.";
  else if (d.hzStatus === "outside-outer") sentence += " It orbits beyond the habitable zone, where water freezes.";
  return sentence;
}

function closeDetail(): void {
  const overlay = $("detail");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  destroySystemView();
  detailOpen = false;
  (state as AppState).selected = null;
  history.replaceState(null, "", `#/${state.view}`);
}

// --- Routing ----------------------------------------------------------------

function applyHash(): void {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return;
  const [section, value] = hash.split("/");
  if (section === "planet" && value) {
    const id = decodeURIComponent(value);
    if ((state as AppState).derived.some((d) => d.id === id)) { openDetail(id); return; }
  }
  if (VIEWS.some((v) => v.id === section) && state.view !== section) setView(section as ViewName);
}

// --- Global wiring ----------------------------------------------------------

function wireGlobal(): void {
  $("detail-close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && detailOpen) closeDetail();
    if (event.key === "/" && !detailOpen) {
      const target = document.activeElement;
      if (target instanceof HTMLInputElement) return;
      event.preventDefault();
      const search = document.getElementById("atlas-search") ?? document.getElementById("galaxy-search");
      if (state.view !== "atlas" && state.view !== "galaxy") setView("atlas");
      window.setTimeout(() => (document.getElementById("atlas-search") as HTMLInputElement | null)?.focus(), 60);
      void search;
    }
  });
  $("detail-pause").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const next = !isSystemPaused();
    setSystemPaused(next);
    button.setAttribute("aria-pressed", String(next));
    button.textContent = next ? "Resume orbits" : "Pause orbits";
  });
  window.addEventListener("resize", () => galaxy?.resizeIfNeeded());
}

// --- Go ---------------------------------------------------------------------

declare global {
  interface Window {
    /** Debug surface — lets tooling (and curious visitors) inspect live state. */
    __exo?: Record<string, unknown>;
  }
}
window.__exo = {
  get galaxy() { return galaxy; },
  get state() { return state; },
  get system() { return systemDebugState(); },
  version: "1.0.0",
};

document.addEventListener("DOMContentLoaded", () => {
  wireGlobal();
  void boot().then(async () => {
    await initGalaxy();
    // Solar System rows are only needed if the user asks for them.
    const { SOLAR_SYSTEM } = await import("./data/solarSystem");
    (state as unknown as { solar: DerivedPlanet[] }).solar = SOLAR_SYSTEM.map(derive);
    renderGalaxyHud();
    renderGalaxyLegend();
  });
});
