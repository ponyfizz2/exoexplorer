/**
 * ANALYTICS.
 *
 * Rendering strategy: 6,366 points is too many DOM nodes for SVG, and too pretty
 * to be left to a blurry canvas. So every chart is a crisp SVG axes/grid layer
 * sitting on top of a device-pixel-ratio-aware canvas for the data itself. Tens
 * of elements, thousands of marks, sharp on retina, and it can redraw on every
 * axis change without a hitch.
 *
 * All five charts share one interaction model: hover to probe, drag to brush-zoom,
 * double-click to reset.
 */

import type { DerivedPlanet } from "../lib/types";
import { CLASS_COLORS, PLANET_CLASSES } from "../lib/astronomy";
import { clamp, formatDuration, temperatureColor } from "../lib/utils";
import { methodColor, type ColorMode } from "../render/galaxy";

export type { ColorMode };

type Scale = (value: number) => number;

interface ScaleSpec {
  type: "linear" | "log";
  domain: [number, number];
  range: [number, number];
  nice?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function makeScale(spec: ScaleSpec): Scale {
  let [d0, d1] = spec.domain;
  if (!Number.isFinite(d0) || !Number.isFinite(d1) || d0 === d1) { d0 = 0; d1 = 1; }
  const [r0, r1] = spec.range;
  if (spec.type === "log") {
    const a = Math.log10(Math.max(d0, 1e-6));
    const b = Math.log10(Math.max(d1, 1e-5));
    const span = b - a || 1;
    return (v: number) => r0 + ((Math.log10(Math.max(v, 1e-6)) - a) / span) * (r1 - r0);
  }
  if (spec.nice && d1 > d0) { d1 = niceCeil(d1); }
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function niceCeil(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

function ticksFor(spec: ScaleSpec, count = 6): number[] {
  if (spec.type === "log") {
    const out: number[] = [];
    const lo = Math.floor(Math.log10(Math.max(spec.domain[0], 1e-6)));
    const hi = Math.ceil(Math.log10(Math.max(spec.domain[1], 1e-5)));
    for (let e = lo; e <= hi; e += 1) {
      const v = Math.pow(10, e);
      if (v >= spec.domain[0] && v <= spec.domain[1]) out.push(v);
    }
    return out;
  }
  const [d0, d1] = spec.domain;
  const span = d1 - d0;
  if (!Number.isFinite(span) || span <= 0) return [d0];
  const raw = span / count;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const norm = raw / base;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * base;
  const out: number[] = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 0.001; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

function fmt(value: number, kind: "int" | "num" | "log" = "num"): string {
  if (!Number.isFinite(value)) return "—";
  if (kind === "int") return Math.round(value).toLocaleString("en-US");
  if (kind === "log") {
    if (value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e4 || abs < 1e-3) {
      const exp = Math.floor(Math.log10(abs));
      const mant = value / Math.pow(10, exp);
      return `${mant.toFixed(mant % 1 === 0 ? 0 : 1)}×10${sup(exp)}`;
    }
    return abs >= 100 ? value.toFixed(0) : value.toFixed(abs < 1 ? 2 : 1);
  }
  return Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Number(value.toFixed(3)));
}

const SUPERSCRIPTS: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n: number) => String(n).split("").map((c) => SUPERSCRIPTS[c] ?? c).join("");

// --- Chart scaffolding ------------------------------------------------------

export interface AxisSpec {
  key: string;
  label: string;
  scale: ScaleSpec;
  format?: "int" | "num" | "log";
  /** Where the value comes from on a DerivedPlanet. */
  get: (p: DerivedPlanet) => number | null;
}

export interface ChartHandle {
  render: (planets: DerivedPlanet[]) => void;
  destroy: () => void;
  /** Currently brushed subset, or null when unzoomed. */
  filtered: () => DerivedPlanet[] | null;
  onBrushChange: (cb: (subset: DerivedPlanet[] | null) => void) => void;
}

interface ChartOptions extends AxisSpec {
  colorBy?: (p: DerivedPlanet) => string;
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  /** Human label for the chart. */
  title: string;
  /** Category for the legend in stacked/bar modes. */
  mode?: "scatter" | "bars";
  onSelect?: (p: DerivedPlanet) => void;
}

const MARGIN = { top: 18, right: 22, bottom: 42, left: 58 };

interface HoverDetail { lines: [string, string][]; title: string; x: number; y: number }

export function createScatterChart(host: HTMLElement, options: ChartOptions, tooltip: HTMLElement): ChartHandle {
  host.innerHTML = "";
  host.classList.add("chart-host");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "chart-svg");
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  host.append(canvas, svg);

  let planets: DerivedPlanet[] = [];
  let width = 320;
  let height = 240;
  let brush: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let subset: DerivedPlanet[] | null = null;
  let brushCallback: ((s: DerivedPlanet[] | null) => void) | null = null;
  let hover: HoverDetail | null = null;

  const ctx = canvas.getContext("2d")!;

  function resize(): void {
    const rect = host.getBoundingClientRect();
    width = Math.max(220, rect.width);
    height = Math.max(180, rect.height || 240);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  function plotArea() {
    return {
      x0: MARGIN.left, y0: MARGIN.top,
      x1: width - MARGIN.right, y1: height - MARGIN.bottom,
      w: width - MARGIN.left - MARGIN.right,
      h: height - MARGIN.top - MARGIN.bottom,
    };
  }

  function activeX(): AxisSpec {
    if (!brush) return options.xAxis;
    return { ...options.xAxis, scale: { ...options.xAxis.scale, domain: [brush.x0, brush.x1] } };
  }
  function activeY(): AxisSpec {
    if (!brush) return options.yAxis;
    return { ...options.yAxis, scale: { ...options.yAxis.scale, domain: [brush.y0, brush.y1] } };
  }

  function draw(): void {
    const area = plotArea();
    const xSpec = { ...activeX().scale, range: [area.x0, area.x1] as [number, number] };
    const ySpec = { ...activeY().scale, range: [area.y1, area.y0] as [number, number] };
    const sx = makeScale(xSpec);
    const sy = makeScale(ySpec);
    const xAxis = activeX();
    const yAxis = activeY();

    ctx.clearRect(0, 0, width, height);

    // --- grid -------------------------------------------------------------
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.10)";
    ctx.lineWidth = 1;
    for (const t of ticksFor(xSpec, 6)) {
      const x = Math.round(sx(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, area.y0); ctx.lineTo(x, area.y1); ctx.stroke();
    }
    for (const t of ticksFor(ySpec, 5)) {
      const y = Math.round(sy(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(area.x0, y); ctx.lineTo(area.x1, y); ctx.stroke();
    }
    ctx.restore();

    // --- data -------------------------------------------------------------
    // Inferred values are drawn as hollow-ish, dimmer marks so the reader can
    // always tell measurement from extrapolation.
    const drawPoint = (p: DerivedPlanet) => {
      const vx = xAxis.get(p);
      const vy = yAxis.get(p);
      if (vx === null || vy === null || !Number.isFinite(vx) || !Number.isFinite(vy)) return false;
      const cx = sx(vx);
      const cy = sy(vy);
      if (cx < area.x0 - 2 || cx > area.x1 + 2 || cy < area.y0 - 2 || cy > area.y1 + 2) return false;
      const inferred = p.massInferred || p.radiusInferred;
      const color = options.colorBy ? options.colorBy(p) : "#22d3ee";
      ctx.globalAlpha = inferred ? 0.34 : 0.82;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, inferred ? 1.5 : 2.1, 0, Math.PI * 2);
      ctx.fill();
      return true;
    };

    for (const p of planets) drawPoint(p);
    ctx.globalAlpha = 1;

    // --- special-case overlay: the mass-radius relation -------------------
    drawOverlays(ctx, area, sx, sy, xAxis.key, yAxis.key);

    // --- hover highlight ---------------------------------------------------
    if (hover) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.moveTo(hover.x, area.y0); ctx.lineTo(hover.x, area.y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(area.x0, hover.y); ctx.lineTo(area.x1, hover.y); ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#00f3ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 7, 0, Math.PI * 2); ctx.stroke();
    }

    // --- brush rectangle ---------------------------------------------------
    if (drag) {
      ctx.fillStyle = "rgba(0,243,255,0.14)";
      ctx.strokeStyle = "rgba(0,243,255,0.65)";
      const rx = Math.min(drag.x0, drag.x1);
      const ry = Math.min(drag.y0, drag.y1);
      ctx.fillRect(rx, ry, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.strokeRect(rx, ry, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }

    // --- SVG axes ----------------------------------------------------------
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const text = (x: number, y: number, content: string, anchor = "middle", cls = "chart-tick") => {
      const el = document.createElementNS(SVG_NS, "text");
      el.setAttribute("x", String(x)); el.setAttribute("y", String(y));
      el.setAttribute("text-anchor", anchor);
      el.setAttribute("class", cls);
      el.textContent = content;
      svg.appendChild(el);
    };

    for (const t of ticksFor(xSpec, 6)) {
      text(sx(t), area.y1 + 18, fmt(t, xAxis.format ?? "num"), "middle", "chart-tick chart-tick-x");
    }
    for (const t of ticksFor(ySpec, 5)) {
      text(area.x0 - 10, sy(t) + 4, fmt(t, yAxis.format ?? "num"), "end", "chart-tick chart-tick-y");
    }
    text(area.x0 + area.w / 2, height - 5, xAxis.label, "middle", "chart-axis-label");
    const yLabel = document.createElementNS(SVG_NS, "text");
    yLabel.setAttribute("x", String(-(area.y0 + area.h / 2)));
    yLabel.setAttribute("y", "13");
    yLabel.setAttribute("text-anchor", "middle");
    yLabel.setAttribute("transform", "rotate(-90)");
    yLabel.setAttribute("class", "chart-axis-label");
    yLabel.textContent = yAxis.label;
    svg.appendChild(yLabel);

    if (brush) {
      const reset = document.createElementNS(SVG_NS, "text");
      reset.setAttribute("x", String(area.x1 - 6));
      reset.setAttribute("y", String(area.y0 + 12));
      reset.setAttribute("text-anchor", "end");
      reset.setAttribute("class", "chart-reset");
      reset.textContent = "⤢ double-click to reset zoom";
      svg.appendChild(reset);
    }
  }

  function drawOverlays(
    g: CanvasRenderingContext2D, area: ReturnType<typeof plotArea>,
    sx: Scale, sy: Scale, xKey: string, yKey: string,
  ): void {
    // Mass-radius: overlay the Chen & Kipping forecaster curve for reference.
    if ((xKey === "radius" && yKey === "mass") || (xKey === "mass" && yKey === "radius")) {
      g.save();
      g.strokeStyle = "rgba(244,114,182,0.55)";
      g.lineWidth = 1.6;
      g.setLineDash([5, 4]);
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 120; i += 1) {
        const r = 0.3 * Math.pow(30 / 0.3, i / 120);
        const mass = 2.04 * Math.pow(r, 1 / 0.279);
        const m = r < 1.23 ? mass : r < 14.26 ? 2.04 * Math.pow(r, 1 / 0.589) : 2.04 * Math.pow(r, 1 / -0.044);
        const px = xKey === "radius" ? sx(r) : sx(m);
        const py = xKey === "radius" ? sy(m) : sy(r);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
      }
      g.stroke();
      g.restore();
    }

    // Earth reference crosshair on mass/radius plots.
    const markers: { x?: number; y?: number; label: string; color: string }[] = [];
    if (xKey === "radius") markers.push({ x: 1, label: "Earth", color: "#60a5fa" });
    if (xKey === "mass") markers.push({ x: 1, label: "Earth", color: "#60a5fa" });
    if (yKey === "radius") markers.push({ y: 1, label: "", color: "#60a5fa" });
    if (yKey === "mass") markers.push({ y: 1, label: "", color: "#60a5fa" });
    for (const marker of markers) {
      if (marker.x !== undefined) {
        const px = sx(marker.x);
        g.save(); g.setLineDash([3, 3]); g.strokeStyle = marker.color; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(px, area.y0); g.lineTo(px, area.y1); g.stroke(); g.restore();
      }
      if (marker.y !== undefined) {
        const py = sy(marker.y);
        g.save(); g.setLineDash([3, 3]); g.strokeStyle = marker.color; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(area.x0, py); g.lineTo(area.x1, py); g.stroke(); g.restore();
      }
    }
  }

  function pickAt(mx: number, my: number): { planet: DerivedPlanet; x: number; y: number } | null {
    const area = plotArea();
    const xSpec = { ...activeX().scale, range: [area.x0, area.x1] as [number, number] };
    const ySpec = { ...activeY().scale, range: [area.y1, area.y0] as [number, number] };
    const sx = makeScale(xSpec);
    const sy = makeScale(ySpec);
    const xAxis = activeX(); const yAxis = activeY();
    let best: { planet: DerivedPlanet; x: number; y: number; d: number } | null = null;
    for (const p of planets) {
      const vx = xAxis.get(p); const vy = yAxis.get(p);
      if (vx === null || vy === null) continue;
      const px = sx(vx); const py = sy(vy);
      const d = (px - mx) ** 2 + (py - my) ** 2;
      if (!best || d < best.d) best = { planet: p, x: px, y: py, d };
    }
    if (!best || best.d > 26 * 26) return null;
    return { planet: best.planet, x: best.x, y: best.y };
  }

  function showTooltip(p: DerivedPlanet, mx: number, my: number): void {
    const xAxis = activeX(); const yAxis = activeY();
    const fmtValue = (axis: AxisSpec) => {
      const v = axis.get(p);
      if (v === null) return "—";
      return fmt(v, axis.format ?? "num");
    };
    tooltip.innerHTML = `
      <div class="tooltip-title">${escapeText(p.planet.pl_name)}</div>
      <div class="tooltip-sub">${escapeText(p.planet.hostname)} · ${p.cls}</div>
      <div class="tooltip-row"><span>${escapeText(xAxis.label)}</span><b>${fmtValue(xAxis)}</b></div>
      <div class="tooltip-row"><span>${escapeText(yAxis.label)}</span><b>${fmtValue(yAxis)}</b></div>
      <div class="tooltip-row"><span>Habitability</span><b>${p.habitability.toFixed(1)}</b></div>
    `;
    tooltip.classList.add("visible");
    const rect = tooltip.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = clamp(mx + 16, 8, hostRect.width - rect.width - 8);
    const top = clamp(my - rect.height - 12, 8, hostRect.height - rect.height - 8);
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
  }

  const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

  // --- Events ---------------------------------------------------------------

  const onPointerMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    if (drag) {
      drag.x1 = mx; drag.y1 = my;
      draw();
      return;
    }
    const hit = pickAt(mx, my);
    if (hit) {
      hover = { lines: [], title: hit.planet.planet.pl_name, x: hit.x, y: hit.y };
      showTooltip(hit.planet, mx, my);
      canvas.style.cursor = "pointer";
    } else {
      hover = null;
      tooltip.classList.remove("visible");
      canvas.style.cursor = "crosshair";
    }
    draw();
  };

  const onPointerDown = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    drag = { x0: event.clientX - rect.left, y0: event.clientY - rect.top, x1: event.clientX - rect.left, y1: event.clientY - rect.top };
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag) return;
    const area = plotArea();
    const dx = Math.abs(drag.x1 - drag.x0);
    const dy = Math.abs(drag.y1 - drag.y0);
    if (dx > 12 && dy > 12) {
      const xSpec = { ...activeX().scale, range: [area.x0, area.x1] as [number, number] };
      const ySpec = { ...activeY().scale, range: [area.y1, area.y0] as [number, number] };
      const invX = invert(xSpec);
      const invY = invert(ySpec);
      const nx0 = invX(Math.min(drag.x0, drag.x1));
      const nx1 = invX(Math.max(drag.x0, drag.x1));
      const ny1 = invY(Math.min(drag.y0, drag.y1));
      const ny0 = invY(Math.max(drag.y0, drag.y1));
      brush = { x0: Math.min(nx0, nx1), x1: Math.max(nx0, nx1), y0: Math.min(ny0, ny1), y1: Math.max(ny0, ny1) };
      const xAxis = activeX(); const yAxis = activeY();
      subset = planets.filter((p) => {
        const vx = xAxis.get(p); const vy = yAxis.get(p);
        if (vx === null || vy === null) return false;
        return vx >= brush!.x0 && vx <= brush!.x1 && vy >= brush!.y0 && vy <= brush!.y1;
      });
      brushCallback?.(subset);
    } else {
      const rect = canvas.getBoundingClientRect();
      const hit = pickAt(event.clientX - rect.left, event.clientY - rect.top);
      if (hit) options.onSelect?.(hit.planet);
    }
    drag = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    draw();
  };

  const onDoubleClick = (): void => {
    brush = null; subset = null; brushCallback?.(null); draw();
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", () => { hover = null; tooltip.classList.remove("visible"); draw(); });
  canvas.addEventListener("dblclick", onDoubleClick);

  function invert(spec: ScaleSpec): Scale {
    const [d0, d1] = spec.domain;
    const [r0, r1] = spec.range;
    if (spec.type === "log") {
      const a = Math.log10(Math.max(d0, 1e-6));
      const b = Math.log10(Math.max(d1, 1e-5));
      return (v: number) => Math.pow(10, a + ((v - r0) / (r1 - r0 || 1)) * (b - a));
    }
    return (v: number) => d0 + ((v - r0) / (r1 - r0 || 1)) * (d1 - d0);
  }

  resize();
  draw();

  return {
    render(next: DerivedPlanet[]) { planets = next; resize(); draw(); },
    destroy() {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      host.innerHTML = "";
    },
    filtered: () => subset,
    onBrushChange(cb) { brushCallback = cb; },
  };
}

// --- Discovery timeline -----------------------------------------------------

export interface TimelineHandle {
  render: (planets: DerivedPlanet[], upToYear: number) => void;
  onYearChange: (cb: (year: number) => void) => void;
  destroy: () => void;
}

export function createTimeline(host: HTMLElement, tooltip: HTMLElement): TimelineHandle {
  host.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  let planets: DerivedPlanet[] = [];
  let upTo = 2026;
  let width = 320; let height = 160;
  let hoverYear: number | null = null;
  let yearCallback: ((year: number) => void) | null = null;
  let stacks: { year: number; methods: Map<string, number>; total: number; cumulative: number }[] = [];

  function resize(): void {
    const rect = host.getBoundingClientRect();
    width = Math.max(240, rect.width);
    height = Math.max(120, rect.height || 160);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function compute(): void {
    const byYear = new Map<number, Map<string, number>>();
    for (const p of planets) {
      const year = p.planet.disc_year;
      if (!Number.isFinite(year)) continue;
      if (!byYear.has(year)) byYear.set(year, new Map());
      const bucket = byYear.get(year)!;
      const method = p.planet.discoverymethod || "Other";
      bucket.set(method, (bucket.get(method) ?? 0) + 1);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    let cumulative = 0;
    stacks = years.map((year) => {
      const methods = byYear.get(year)!;
      const total = [...methods.values()].reduce((a, b) => a + b, 0);
      cumulative += total;
      return { year, methods, total, cumulative };
    });
  }

  function draw(): void {
    const area = { x0: 46, y0: 14, x1: width - 12, y1: height - 26 };
    const w = area.x1 - area.x0;
    const h = area.y1 - area.y0;
    ctx.clearRect(0, 0, width, height);
    if (!stacks.length) return;

    const maxTotal = Math.max(...stacks.map((s) => s.total));
    const barWidth = Math.max(2, (w / stacks.length) * 0.74);

    // Grid
    ctx.strokeStyle = "rgba(148,163,184,0.10)";
    for (let i = 0; i <= 4; i += 1) {
      const y = Math.round(area.y0 + (h / 4) * i) + 0.5;
      ctx.beginPath(); ctx.moveTo(area.x0, y); ctx.lineTo(area.x1, y); ctx.stroke();
    }

    stacks.forEach((stack, i) => {
      const cx = area.x0 + (i + 0.5) * (w / stacks.length);
      let yCursor = area.y1;
      const methods = [...stack.methods.entries()].sort((a, b) => b[1] - a[1]);
      const revealed = stack.year <= upTo;
      for (const [method, count] of methods) {
        const barHeight = (count / maxTotal) * h;
        ctx.fillStyle = methodColor(method);
        ctx.globalAlpha = revealed ? (hoverYear === null || hoverYear === stack.year ? 0.95 : 0.35) : 0.1;
        ctx.fillRect(cx - barWidth / 2, yCursor - barHeight, barWidth, Math.max(barHeight, 0.5));
        yCursor -= barHeight;
      }
      ctx.globalAlpha = 1;
    });

    // Axis labels
    ctx.fillStyle = "rgba(148,163,184,0.85)";
    ctx.font = "500 10px ui-monospace, monospace";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) {
      const value = Math.round((maxTotal / 4) * (4 - i));
      ctx.fillText(String(value), area.x0 - 6, area.y0 + (h / 4) * i + 3);
    }
    ctx.textAlign = "center";
    const first = stacks[0].year;
    const last = stacks[stacks.length - 1].year;
    for (let year = Math.ceil(first / 5) * 5; year <= last; year += 5) {
      const index = stacks.findIndex((s) => s.year === year);
      if (index < 0) continue;
      ctx.fillText(String(year), area.x0 + (index + 0.5) * (w / stacks.length), area.y1 + 15);
    }

    if (hoverYear !== null) {
      const index = stacks.findIndex((s) => s.year === hoverYear);
      if (index >= 0) {
        const cx = area.x0 + (index + 0.5) * (w / stacks.length);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath(); ctx.moveTo(cx, area.y0); ctx.lineTo(cx, area.y1); ctx.stroke();
      }
    }
  }

  const onMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const area = { x0: 46, x1: width - 12 };
    const w = area.x1 - area.x0;
    if (!stacks.length || mx < area.x0 || mx > area.x1) { hoverYear = null; tooltip.classList.remove("visible"); draw(); return; }
    const index = clamp(Math.floor(((mx - area.x0) / w) * stacks.length), 0, stacks.length - 1);
    const stack = stacks[index];
    hoverYear = stack.year;
    const top = [...stack.methods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    tooltip.innerHTML = `
      <div class="tooltip-title">${stack.year}</div>
      <div class="tooltip-row"><span>Discovered</span><b>${stack.total}</b></div>
      <div class="tooltip-row"><span>Running total</span><b>${stack.cumulative.toLocaleString("en-US")}</b></div>
      ${top.map(([m, c]) => `<div class="tooltip-row"><span><i class="dot" style="background:${methodColor(m)}"></i>${escapeText(m)}</span><b>${c}</b></div>`).join("")}
    `;
    tooltip.classList.add("visible");
    tooltip.style.transform = `translate(${clamp(mx + 14, 8, width - 220)}px, 8px)`;
    draw();
  };

  const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

  const onClick = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const area = { x0: 46, x1: width - 12 };
    const w = area.x1 - area.x0;
    if (!stacks.length || mx < area.x0 || mx > area.x1) return;
    const index = clamp(Math.floor(((mx - area.x0) / w) * stacks.length), 0, stacks.length - 1);
    yearCallback?.(stacks[index].year);
  };

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", () => { hoverYear = null; tooltip.classList.remove("visible"); draw(); });
  canvas.addEventListener("click", onClick);

  resize();
  return {
    render(next, upToYear) { planets = next; upTo = upToYear; resize(); compute(); draw(); },
    onYearChange(cb) { yearCallback = cb; },
    destroy() { canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("click", onClick); host.innerHTML = ""; },
  };
}

// --- Discovery-method donut -------------------------------------------------

export function createMethodDonut(host: HTMLElement, legend: HTMLElement, tooltip: HTMLElement): {
  render: (planets: DerivedPlanet[]) => void;
  destroy: () => void;
} {
  host.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  let planets: DerivedPlanet[] = [];
  let hoverSlice: number | null = null;
  let slices: { method: string; count: number; start: number; end: number }[] = [];
  let size = 180;

  function resize(): void {
    const rect = host.getBoundingClientRect();
    size = Math.max(140, Math.min(rect.width, rect.height || 180));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(): void {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2; const cy = size / 2;
    const outer = size * 0.46;
    const inner = size * 0.3;
    slices.forEach((slice, index) => {
      ctx.beginPath();
      ctx.arc(cx, cy, outer, slice.start, slice.end);
      ctx.arc(cx, cy, inner, slice.end, slice.start, true);
      ctx.closePath();
      ctx.fillStyle = methodColor(slice.method);
      ctx.globalAlpha = hoverSlice === null || hoverSlice === index ? 0.95 : 0.35;
      ctx.fill();
      if (hoverSlice === index) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    const total = slices.reduce((a, s) => a + s.count, 0);
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "center";
    ctx.font = "700 20px ui-monospace, monospace";
    ctx.fillText(total.toLocaleString("en-US"), cx, cy + 2);
    ctx.font = "500 9px ui-monospace, monospace";
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.fillText("CONFIRMED", cx, cy + 16);
  }

  function compute(): void {
    const counts = new Map<string, number>();
    for (const p of planets) {
      const m = p.planet.discoverymethod || "Other";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    slices = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, count]) => {
        const span = (count / total) * Math.PI * 2;
        const slice = { method, count, start: angle, end: angle + span };
        angle += span;
        return slice;
      });

    legend.innerHTML = slices.map((slice, index) => `
      <li data-index="${index}">
        <span class="dot" style="background:${methodColor(slice.method)}"></span>
        <span class="legend-name">${slice.method}</span>
        <span class="legend-count">${slice.count.toLocaleString("en-US")}</span>
        <span class="legend-pct">${((slice.count / total) * 100).toFixed(1)}%</span>
      </li>
    `).join("");
    legend.querySelectorAll("li").forEach((li) => {
      li.addEventListener("pointerenter", () => { hoverSlice = Number((li as HTMLElement).dataset.index); draw(); });
      li.addEventListener("pointerleave", () => { hoverSlice = null; draw(); });
    });
  }

  const onMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left - size / 2;
    const my = event.clientY - rect.top - size / 2;
    const dist = Math.hypot(mx, my);
    const outer = size * 0.46; const inner = size * 0.3;
    if (dist < inner || dist > outer) { hoverSlice = null; tooltip.classList.remove("visible"); draw(); return; }
    let angle = Math.atan2(my, mx);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    const index = slices.findIndex((s) => angle >= s.start && angle <= s.end);
    if (index !== hoverSlice) { hoverSlice = index; draw(); }
    const slice = slices[index];
    if (!slice) return;
    tooltip.innerHTML = `<div class="tooltip-title">${slice.method}</div><div class="tooltip-row"><span>Planets</span><b>${slice.count.toLocaleString("en-US")}</b></div>`;
    tooltip.classList.add("visible");
    tooltip.style.transform = `translate(${clamp(event.clientX - host.getBoundingClientRect().left + 12, 8, size + 120)}px, ${event.clientY - host.getBoundingClientRect().top - 20}px)`;
  };

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", () => { hoverSlice = null; tooltip.classList.remove("visible"); draw(); });
  resize();

  return {
    render(next) { planets = next; resize(); compute(); draw(); },
    destroy() { canvas.removeEventListener("pointermove", onMove); host.innerHTML = ""; },
  };
}

// --- Prebuilt axis presets --------------------------------------------------

function getter(path: string): (p: DerivedPlanet) => number | null {
  switch (path) {
    case "radius": return (p) => p.radiusEarth;
    case "mass": return (p) => p.massEarth;
    case "density": return (p) => p.density;
    case "period": return (p) => p.planet.pl_orbper ?? null;
    case "insolation": return (p) => p.planet.pl_insol ?? null;
    case "distance": return (p) => p.planet.sy_dist ?? null;
    case "year": return (p) => p.planet.disc_year;
    case "eqtemp": return (p) => p.equilibriumTemp;
    case "starTemp": return (p) => p.planet.st_teff ?? null;
    case "starRadius": return (p) => p.planet.st_rad ?? null;
    case "starMass": return (p) => p.planet.st_mass ?? null;
    case "luminosity": return (p) => p.star.luminosity;
    case "habitability": return (p) => p.habitability;
    case "esi": return (p) => p.esi;
    case "hzDistance": return (p) => (p.hzStatus === "inside" ? 0 : p.hzDistance ?? null);
    case "semiMajorAxis": return (p) => p.semiMajorAxis;
    default: return () => null;
  }
}

export const AXIS_PRESETS: Record<string, { label: string; scale: ScaleSpec["type"]; format: "int" | "num" | "log"; defaultDomain?: [number, number] }> = {
  radius: { label: "Radius (R⊕)", scale: "log", format: "log" },
  mass: { label: "Mass (M⊕)", scale: "log", format: "log" },
  density: { label: "Density (g/cm³)", scale: "log", format: "log" },
  period: { label: "Orbital period (days)", scale: "log", format: "log" },
  insolation: { label: "Insolation (S⊕)", scale: "log", format: "log" },
  distance: { label: "Distance (pc)", scale: "log", format: "log" },
  year: { label: "Discovery year", scale: "linear", format: "int" },
  eqtemp: { label: "Equilibrium temp (K)", scale: "linear", format: "int" },
  starTemp: { label: "Star Teff (K)", scale: "linear", format: "int" },
  starRadius: { label: "Star radius (R☉)", scale: "log", format: "log" },
  starMass: { label: "Star mass (M☉)", scale: "log", format: "log" },
  luminosity: { label: "Star luminosity (L☉)", scale: "log", format: "log" },
  habitability: { label: "Habitability index", scale: "linear", format: "num" },
  esi: { label: "Earth Similarity Index", scale: "linear", format: "num" },
  semiMajorAxis: { label: "Semi-major axis (AU)", scale: "log", format: "log" },
  hzDistance: { label: "Distance from HZ edge (AU)", scale: "linear", format: "num" },
};

/** Builds an AxisSpec (with a data-driven domain) for a preset key. */
export function axisSpec(key: string, planets: DerivedPlanet[]): AxisSpec {
  const preset = AXIS_PRESETS[key] ?? AXIS_PRESETS.radius;
  const get = getter(key);
  const values = planets.map(get).filter((v): v is number => v !== null && Number.isFinite(v) && (preset.scale === "log" ? v > 0 : true));
  let domain: [number, number];
  if (preset.scale === "log") {
    const min = values.length ? Math.min(...values) : 0.1;
    const max = values.length ? Math.max(...values) : 100;
    domain = [Math.max(min * 0.85, 1e-4), max * 1.15];
  } else {
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 100;
    const pad = (max - min) * 0.04 || 1;
    domain = [min - pad, max + pad];
  }
  return { key, label: preset.label, scale: { type: preset.scale, domain, range: [0, 1] }, format: preset.format, get };
}

export { makeScale, ticksFor, fmt as formatTick };
export type { ScaleSpec, AxisSpec as ChartAxisSpec };

export const DEFAULT_COLOR_BY = (p: DerivedPlanet): string => CLASS_COLORS[p.cls] ?? "#64748b";
export { CLASS_COLORS, PLANET_CLASSES };
