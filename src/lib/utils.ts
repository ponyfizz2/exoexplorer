/** Small, dependency-free helpers shared across the UI. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Format a number with fixed precision, or an em-dash when absent. */
export function num(value: number | null | undefined, digits = 2, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(1).replace("e+", "×10^").replace("e-", "×10^-");
  return value.toFixed(digits);
}

/** Compact integer formatting: 6366 -> "6,366". */
export const int = (value: number | null | undefined, fallback = "—"): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.round(value).toLocaleString("en-US");

/** Distance in parsecs -> light years. */
export const pcToLy = (pc: number) => pc * 3.261564;

export function formatDistance(pc: number | null | undefined): string {
  if (pc === null || pc === undefined || !Number.isFinite(pc)) return "—";
  if (pc < 1) return `${(pc * 1000).toFixed(0)} pc`;
  return `${pc.toFixed(2)} pc`;
}

export function formatLightYears(pc: number | null | undefined): string {
  if (pc === null || pc === undefined || !Number.isFinite(pc)) return "—";
  const ly = pcToLy(pc);
  if (ly < 100) return `${ly.toFixed(1)} ly`;
  return `${Math.round(ly).toLocaleString("en-US")} ly`;
}

/** Orbital period in days -> human readable. */
export function formatPeriod(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "—";
  if (days < 1) return `${(days * 24).toFixed(1)} h`;
  if (days < 400) return `${days.toFixed(days < 10 ? 2 : 1)} d`;
  const years = days / 365.25;
  return years < 1000 ? `${years.toFixed(1)} yr` : `${Math.round(years).toLocaleString("en-US")} yr`;
}

/** Mass in Earth masses -> the unit a human would actually use. */
export function formatMass(earthMasses: number | null | undefined): { value: string; unit: string } {
  if (earthMasses === null || earthMasses === undefined || !Number.isFinite(earthMasses)) {
    return { value: "—", unit: "" };
  }
  if (earthMasses < 0.05) {
    const lunar = earthMasses * 81.3;
    if (lunar < 1) return { value: (lunar * 1000).toPrecision(3), unit: "Moon ×10⁻³" };
    return { value: lunar.toFixed(lunar < 10 ? 2 : 1), unit: "Moon" };
  }
  if (earthMasses < 50) return { value: earthMasses.toFixed(earthMasses < 10 ? 2 : 1), unit: "M⊕" };
  if (earthMasses < 3000) {
    const neptune = earthMasses / 17.15;
    return { value: neptune.toFixed(neptune < 10 ? 2 : 1), unit: "M♆" };
  }
  const jup = earthMasses / 317.83;
  return { value: jup.toFixed(jup < 10 ? 2 : 1), unit: "M♃" };
}

export function formatRadius(earthRadii: number | null | undefined): { value: string; unit: string } {
  if (earthRadii === null || earthRadii === undefined || !Number.isFinite(earthRadii)) {
    return { value: "—", unit: "" };
  }
  if (earthRadii < 12) return { value: earthRadii.toFixed(earthRadii < 10 ? 2 : 1), unit: "R⊕" };
  const jup = earthRadii / 11.209;
  return { value: jup.toFixed(jup < 10 ? 2 : 1), unit: "R♃" };
}

export function formatTemp(kelvin: number | null | undefined): { value: string; unit: string; celsius: number | null } {
  if (kelvin === null || kelvin === undefined || !Number.isFinite(kelvin)) {
    return { value: "—", unit: "", celsius: null };
  }
  const celsius = kelvin - 273.15;
  return { value: Math.round(kelvin).toLocaleString("en-US"), unit: "K", celsius };
}

export const temperatureColor = (kelvin: number | null | undefined): string => {
  if (kelvin === null || kelvin === undefined || !Number.isFinite(kelvin)) return "#64748b";
  const stops: [number, string][] = [
    [100, "#7c3aed"], [250, "#3b82f6"], [400, "#22d3ee"], [700, "#facc15"],
    [1200, "#fb923c"], [2500, "#ef4444"], [5000, "#f43f5e"],
  ];
  if (kelvin <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (kelvin <= stops[i][0]) {
      const [k0, c0] = stops[i - 1];
      const [k1, c1] = stops[i];
      return mixHex(c0, c1, (kelvin - k0) / (k1 - k0));
    }
  }
  return stops[stops.length - 1][1];
};

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a); const pb = hexToRgb(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(t, 0, 1)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Deterministic 0..1 hash so a planet always looks the same. */
export function hashSeed(text: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: never[]) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Travelling across light years, for a few honest propulsion options. */
export const PROPULSION = [
  { name: "Voyager 1", speedC: 0.0000572, note: "fastest object ever launched" },
  { name: "Project Orion", speedC: 0.033, note: "nuclear pulse, 1960s design" },
  { name: "Solar sail", speedC: 0.002, note: "lightsail demonstrator class" },
  { name: "Breakthrough Starshot", speedC: 0.2, note: "laser-driven gram-scale probe" },
  { name: "Fusion ramjet", speedC: 0.12, note: "theoretical" },
  { name: "Antimatter drive", speedC: 0.5, note: "theoretical, fuel-limited" },
] as const;

/** Warp factors use the Star Trek TNG cubic scale: v = wf^(10/3) × c. */
export const warpToC = (warp: number) => Math.pow(warp, 10 / 3);

export function formatDuration(years: number): string {
  if (!Number.isFinite(years)) return "—";
  if (years < 1 / 365.25 / 24) return `${(years * 365.25 * 24 * 3600).toPrecision(3)} s`;
  if (years < 1 / 365.25) return `${(years * 365.25 * 24).toPrecision(3)} hours`;
  if (years < 1) return `${(years * 365.25).toPrecision(3)} days`;
  if (years < 1000) return `${years.toPrecision(3)} years`;
  if (years < 1e6) return `${Math.round(years).toLocaleString("en-US")} years`;
  if (years < 1e9) return `${(years / 1e6).toPrecision(3)} million years`;
  return `${(years / 1e9).toPrecision(3)} billion years`;
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
