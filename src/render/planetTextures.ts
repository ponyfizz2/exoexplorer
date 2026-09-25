/**
 * Procedural planet surfaces.
 *
 * Every world in this app is generated from physics rather than a swapped-in
 * JPEG: the palette comes from equilibrium temperature and class, the terrain
 * from seeded fractal noise (value noise + fBm), clouds and storms are layered
 * separately so they can rotate at their own rate.
 *
 * The same seed always produces the same planet, so a world looks identical on
 * every visit and in every screenshot.
 */

import { clamp, hashSeed } from "../lib/utils";
import type { PlanetClass } from "../lib/types";

export interface Palette {
  name: string;
  /** Deepest terrain / ocean. */
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
  /** Atmosphere rim and scattering tint. */
  atmosphere: string;
  /** Emissive glow for molten worlds. */
  emissive?: string;
  oceanLevel: number;
  cloudAmount: number;
  cloudTint: string;
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function paletteFor(cls: PlanetClass, tempK: number | null, radiusEarth: number | null, seedText: string): Palette {
  const rand = hashSeed(seedText);
  const t = tempK ?? 288;
  const r = radiusEarth ?? 1;

  // Molten / lava world: rocky and roasting.
  if (t > 1000 && r < 3) {
    return {
      name: "Molten", low: [28, 10, 8], mid: [92, 26, 12], high: [230, 96, 24],
      atmosphere: "rgba(255,120,40,0.55)", emissive: "#ff5a12",
      oceanLevel: 0, cloudAmount: 0.1, cloudTint: "rgba(60,20,10,0.5)",
    };
  }
  // Ice world.
  if (t < 180) {
    return {
      name: "Glacial", low: [150, 178, 205], mid: [206, 224, 240], high: [255, 255, 255],
      atmosphere: "rgba(150,200,255,0.42)", oceanLevel: 0.42,
      cloudAmount: 0.45, cloudTint: "rgba(235,245,255,0.55)",
    };
  }
  // Ocean world — the good stuff.
  if (t >= 230 && t <= 320 && r <= 1.8) {
    return {
      name: "Oceanic", low: [6, 30, 78], mid: [16, 92, 140], high: [74, 128, 66],
      atmosphere: "rgba(90,170,255,0.6)", oceanLevel: 0.56,
      cloudAmount: 0.5, cloudTint: "rgba(255,255,255,0.62)",
    };
  }
  // Temperate terrestrial.
  if (r <= 2.2) {
    return {
      name: "Terrestrial", low: [58, 52, 44], mid: [126, 96, 62], high: [186, 158, 118],
      atmosphere: "rgba(120,180,255,0.45)", oceanLevel: 0.06,
      cloudAmount: 0.3, cloudTint: "rgba(255,255,255,0.5)",
    };
  }
  // Neptune-class: smooth, deep, faint banding.
  if (r <= 6) {
    const blue = rand() > 0.45;
    return {
      name: blue ? "Ice giant" : "Mini-Neptune",
      low: blue ? [10, 34, 92] : [30, 46, 96],
      mid: blue ? [30, 88, 168] : [64, 92, 160],
      high: blue ? [110, 178, 230] : [140, 168, 220],
      atmosphere: blue ? "rgba(90,170,255,0.55)" : "rgba(140,170,255,0.5)",
      oceanLevel: 0, cloudAmount: 0.34, cloudTint: "rgba(220,235,255,0.4)",
    };
  }
  // Gas giant: warm and banded.
  const hot = t > 700;
  return {
    name: hot ? "Hot Jupiter" : "Gas giant",
    low: hot ? [78, 30, 20] : [122, 82, 48],
    mid: hot ? [186, 84, 40] : [196, 152, 96],
    high: hot ? [244, 168, 96] : [238, 214, 172],
    atmosphere: hot ? "rgba(255,140,80,0.5)" : "rgba(255,210,160,0.4)",
    oceanLevel: 0, cloudAmount: 0.62, cloudTint: "rgba(255,245,225,0.45)",
  };
}

// --- Noise ------------------------------------------------------------------

function makeNoise(rand: () => number) {
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  const at = (x: number, y: number) => grid[((y & (size - 1)) * size + (x & (size - 1)))];
  const smooth = (t: number) => t * t * (3 - 2 * t);

  function noise2(x: number, y: number): number {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = smooth(x - xi); const yf = smooth(y - yi);
    const a = at(xi, yi); const b = at(xi + 1, yi);
    const c = at(xi, yi + 1); const d = at(xi + 1, yi + 1);
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
  }

  /** Fractal Brownian motion — the workhorse for terrain. */
  return function fbm(x: number, y: number, octaves = 6, gain = 0.5, lacunarity = 2.05): number {
    let amp = 1; let freq = 1; let sum = 0; let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  };
}

// --- Surface generation -----------------------------------------------------

export interface SurfaceMaps {
  /** Equirectangular base colour map (equirect: x = longitude, y = latitude). */
  surface: HTMLCanvasElement;
  /** Cloud / storm layer with alpha, rotated independently. */
  clouds: HTMLCanvasElement | null;
  /** Emissive map for molten worlds and city lights. */
  emissive: HTMLCanvasElement | null;
  palette: Palette;
}

const TEX_W = 1024;
const TEX_H = 512;

function canvas(w = TEX_W, h = TEX_H): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export function buildSurface(seedText: string, cls: PlanetClass, tempK: number | null, radiusEarth: number | null): SurfaceMaps {
  const palette = paletteFor(cls, tempK, radiusEarth, seedText);
  const rand = hashSeed(seedText + "|surface");
  const fbm = makeNoise(rand);

  const surface = canvas();
  const sctx = surface.getContext("2d")!;
  const image = sctx.createImageData(TEX_W, TEX_H);
  const data = image.data;

  const gaseous = cls === "Jovian" || cls === "Sub-Jovian" || cls === "Neptune-like";
  const bands = 5 + Math.floor(rand() * 7);
  const bandTilt = (rand() - 0.5) * 0.5;
  const turbScale = 2.4 + rand() * 2.5;
  const warpAmount = gaseous ? 0.55 + rand() * 0.5 : 0.34;
  const continentScale = 3.2 + rand() * 2.6;

  for (let y = 0; y < TEX_H; y += 1) {
    const v = y / TEX_H;
    const lat = (v - 0.5) * Math.PI;          // -pi/2 .. pi/2
    const polar = Math.abs(Math.sin(lat));     // 0 at equator, 1 at poles

    for (let x = 0; x < TEX_W; x += 1) {
      const u = x / TEX_W;
      const lon = u * Math.PI * 2;
      // Wrap the noise in longitude so the seam is invisible.
      const nx = Math.cos(lon) * 2 + 8;
      const ny = Math.sin(lon) * 2 + 8;
      const nz = v * 4 + 16;

      let h: number;
      if (gaseous) {
        const warped = v + bandTilt * (u - 0.5) * 0.5;
        const band = Math.sin((warped + 0.5) * bands * Math.PI);
        const swirl = fbm(nx * turbScale, nz * turbScale * 0.5, 5) - 0.5;
        h = clamp(0.5 + band * 0.34 + swirl * warpAmount, 0, 1);
        // Great storm: one big elliptical vortex per giant.
        const sx = 0.28 + rand() * 0.44;
        const sy = 0.55 + rand() * 0.2;
        const dx = ((u - sx + 0.5 + 1) % 1) - 0.5;
        const dy = (v - sy) * 1.9;
        const d = Math.sqrt(dx * dx * 1.6 + dy * dy);
        if (d < 0.05) h = clamp(h + (0.05 - d) * 6, 0, 1);
      } else {
        let n = fbm(nx * continentScale + nz * 0.4, nz * continentScale, 6);
        // Ice caps at high latitude, blended so they are not a hard line.
        const cap = clamp((polar - 0.72) / 0.28, 0, 1) * (0.55 + rand() * 0.05);
        n = clamp(n * (1 - cap * 0.85) + cap, 0, 1);
        h = n;
      }

      const idx = (y * TEX_W + x) * 4;
      let color: [number, number, number];
      if (gaseous || palette.oceanLevel === 0) {
        color = lerp3(palette.low, palette.mid, clamp(h * 1.6, 0, 1));
        color = lerp3(color, palette.high, clamp((h - 0.58) * 2.4, 0, 1));
      } else if (h < palette.oceanLevel) {
        const depth = h / palette.oceanLevel;
        color = lerp3(palette.low, palette.mid, clamp(depth * depth, 0, 1));
      } else {
        const land = (h - palette.oceanLevel) / (1 - palette.oceanLevel);
        color = lerp3(palette.mid, palette.high, clamp(land * 1.3, 0, 1));
        // Snow line on high ground.
        if (land > 0.72) color = lerp3(color, [245, 248, 255], clamp((land - 0.72) * 3.2, 0, 1));
      }

      // Subtle per-pixel grain keeps large flat regions from looking like plastic.
      const grain = (fbm(nx * 42, nz * 42, 2) - 0.5) * 14;
      data[idx] = clamp(color[0] + grain, 0, 255);
      data[idx + 1] = clamp(color[1] + grain, 0, 255);
      data[idx + 2] = clamp(color[2] + grain, 0, 255);
      data[idx + 3] = 255;
    }
  }
  sctx.putImageData(image, 0, 0);

  // --- Clouds ---------------------------------------------------------------
  let clouds: HTMLCanvasElement | null = null;
  if (palette.cloudAmount > 0.05) {
    clouds = canvas();
    const cctx = clouds.getContext("2d")!;
    const cimg = cctx.createImageData(TEX_W, TEX_H);
    const cfbm = makeNoise(hashSeed(seedText + "|clouds"));
    const [cr, cg, cb] = parseTint(palette.cloudTint);
    const cScale = 3.4 + rand() * 3;
    for (let y = 0; y < TEX_H; y += 1) {
      const v = y / TEX_H;
      for (let x = 0; x < TEX_W; x += 1) {
        const lon = (x / TEX_W) * Math.PI * 2;
        const nx = Math.cos(lon) * 2 + 5;
        const ny = Math.sin(lon) * 2 + 5;
        const nz = v * 4 + 11;
        let c = cfbm(nx * cScale, nz * cScale * 1.6, 6);
        // Clouds thin out at the poles for gas giants, thicken for rocky worlds.
        const lat = Math.abs(v - 0.5) * 2;
        c = gaseous ? c * (1 - lat * 0.35) : c * (0.7 + lat * 0.5);
        const alpha = clamp((c - 0.48) * 2.6, 0, 1) * palette.cloudAmount * 255;
        const idx = (y * TEX_W + x) * 4;
        cimg.data[idx] = cr; cimg.data[idx + 1] = cg; cimg.data[idx + 2] = cb;
        cimg.data[idx + 3] = alpha;
      }
    }
    cctx.putImageData(cimg, 0, 0);
  }

  // --- Emissive -------------------------------------------------------------
  let emissive: HTMLCanvasElement | null = null;
  const wantsLights = cls === "Terrestrial" || cls === "Super-Earth";
  if (palette.emissive || wantsLights) {
    emissive = canvas();
    const ectx = emissive.getContext("2d")!;
    if (palette.emissive) {
      // Molten cracks following the terrain height.
      const efbm = makeNoise(hashSeed(seedText + "|lava"));
      const eimg = ectx.createImageData(TEX_W, TEX_H);
      for (let y = 0; y < TEX_H; y += 1) {
        for (let x = 0; x < TEX_W; x += 1) {
          const lon = (x / TEX_W) * Math.PI * 2;
          const nx = Math.cos(lon) * 3 + 3;
          const ny = Math.sin(lon) * 3 + 3;
          const nz = (y / TEX_H) * 6 + 7;
          const crack = 1 - Math.abs(efbm(nx * 5, nz * 5, 4) - 0.5) * 4;
          const idx = (y * TEX_W + x) * 4;
          eimg.data[idx] = 255;
          eimg.data[idx + 1] = 120;
          eimg.data[idx + 2] = 20;
          eimg.data[idx + 3] = clamp(crack, 0, 1) * 255;
        }
      }
      ectx.putImageData(eimg, 0, 0);
    } else {
      // Night-side city lights, only on worlds that could plausibly have life.
      const lfbm = makeNoise(hashSeed(seedText + "|lights"));
      const eimg = ectx.createImageData(TEX_W, TEX_H);
      const cityCount = 40 + Math.floor(rand() * 90);
      const cities: { x: number; y: number; r: number }[] = [];
      for (let i = 0; i < cityCount; i += 1) {
        cities.push({ x: rand() * TEX_W, y: TEX_H * (0.22 + rand() * 0.56), r: 1 + rand() * 3.4 });
      }
      for (const city of cities) {
        const g = ectx.createRadialGradient(city.x, city.y, 0, city.x, city.y, city.r * 4);
        g.addColorStop(0, "rgba(255,214,140,0.95)");
        g.addColorStop(0.4, "rgba(255,180,90,0.35)");
        g.addColorStop(1, "rgba(255,160,60,0)");
        ectx.fillStyle = g;
        ectx.beginPath(); ectx.arc(city.x, city.y, city.r * 4, 0, Math.PI * 2); ectx.fill();
      }
      // Sparse coastal sparkle.
      for (let y = 0; y < TEX_H; y += 2) {
        for (let x = 0; x < TEX_W; x += 2) {
          if (lfbm(x * 0.06, y * 0.06, 3) > 0.78) {
            ectx.fillStyle = "rgba(255,200,120,0.30)";
            ectx.fillRect(x, y, 1, 1);
          }
        }
      }
    }
  }

  return { surface, clouds, emissive, palette };
}

// --- Helpers ----------------------------------------------------------------

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function parseTint(css: string): [number, number, number] {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255];
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255];
}

/** Star colour from effective temperature, clamped to a believable range. */
export function starColorFor(teff: number | null | undefined): string {
  if (!Number.isFinite(teff)) return "#ffd9a0";
  const t = teff as number;
  if (t < 2400) return "#ff7a4d";
  if (t < 3700) return "#ff9d5c";
  if (t < 5200) return "#ffd27a";
  if (t < 6000) return "#fff2c4";
  if (t < 7500) return "#ffffff";
  if (t < 10000) return "#dfe9ff";
  if (t < 30000) return "#c3d4ff";
  return "#a8c0ff";
}

/** CSS colour for the star's glow, matching the 3D scene. */
export function starGlowFor(teff: number | null | undefined): string {
  const base = starColorFor(teff);
  const [r, g, b] = hexToRgb(base);
  return `rgba(${r},${g},${b},0.55)`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export { rgb };
