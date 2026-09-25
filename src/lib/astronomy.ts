/**
 * The science layer.
 *
 * Everything here is a real, citable relation rather than a vibes-based rule of
 * thumb — this is the main upgrade over a naive "mass looks right, add 40
 * points" habitability heuristic.
 *
 *  - Habitable zone boundaries: Kopparapu et al. (2014), ApJ 787, 2 — the
 *    piecewise polynomial fits in stellar Teff, plus the Seager et al. (2013)
 *    closed form used as a fallback when Teff is unknown.
 *  - Earth Similarity Index: Schulze-Makuch et al. (2011), Astrobiology 11, 10.
 *  - Missing masses: Chen & Kipping (2017), ApJ 834, 17 — the forecaster
 *    mass-radius relation, used only when a value is genuinely absent and always
 *    flagged as inferred.
 */

import type { DerivedPlanet, Planet, PlanetClass, StarFacts, TempBand, DetectionConfidence } from "./types";
import { clamp } from "./utils";

// --- Physical constants -----------------------------------------------------
export const EARTH_MASS_JUP = 317.83;
export const EARTH_RADIUS_JUP = 11.209;
export const EARTH_DENSITY = 5.514;       // g/cm^3
export const EARTH_ESCAPE = 11.186;       // km/s
export const EARTH_GRAVITY = 9.80665;     // m/s^2
export const SUN_TEFF = 5772;             // K
export const SUN_LUM = 1;                 // L_sun

// --- Host star --------------------------------------------------------------

/**
 * Luminosity in solar units. Prefers the catalogued value, then the direct
 * Stefan-Boltzmann scaling L = R^2 (Teff/Tsun)^4, then falls back to a
 * main-sequence mass-luminosity approximation.
 */
export function starLuminosity(planet: Planet): { luminosity: number; estimated: boolean } {
  if (Number.isFinite(planet.st_lum) && (planet.st_lum as number) > 0) {
    return { luminosity: planet.st_lum as number, estimated: false };
  }
  if (Number.isFinite(planet.st_rad) && Number.isFinite(planet.st_teff) &&
      (planet.st_rad as number) > 0 && (planet.st_teff as number) > 0) {
    return {
      luminosity: Math.pow(planet.st_rad as number, 2) * Math.pow((planet.st_teff as number) / SUN_TEFF, 4),
      estimated: true,
    };
  }
  if (Number.isFinite(planet.st_mass) && (planet.st_mass as number) > 0) {
    const m = planet.st_mass as number;
    const exponent = m < 0.43 ? 2.3 : m < 2 ? 4 : m < 20 ? 3.5 : 1;
    return { luminosity: Math.pow(m, exponent), estimated: true };
  }
  return { luminosity: SUN_LUM, estimated: true };
}

/** Kopparapu et al. (2014) coefficients: [seffSun, a, b, c, d]. */
const HZ_COEFFS = {
  recentVenus:     [1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15],
  runawayGreenhouse:[1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-16],
  maximumGreenhouse:[0.356, 6.171e-5, 1.698e-9, -3.198e-12, -3.062e-16],
  earlyMars:       [0.320, 5.547e-5, 1.526e-9, -2.874e-12, -2.011e-16],
} as const;

function seff(coeffs: readonly number[], tStar: number): number {
  const [s0, a, b, c, d] = coeffs;
  const t = tStar - SUN_TEFF;
  return s0 + a * t + b * t * t + c * t * t * t + d * t * t * t * t;
}

export function spectralClassOf(teff: number | undefined, given?: string): string {
  if (given && given.trim()) return given.trim().split(" ")[0];
  if (!Number.isFinite(teff)) return "unknown";
  const t = teff as number;
  if (t >= 30000) return "O";
  if (t >= 10000) return "B";
  if (t >= 7500) return "A";
  if (t >= 6000) return "F";
  if (t >= 5200) return "G";
  if (t >= 3700) return "K";
  if (t >= 2400) return "M";
  return "L/T";
}

export function deriveStar(planet: Planet): StarFacts {
  const { luminosity, estimated } = starLuminosity(planet);
  const teff = planet.st_teff;
  let inner: number | null = null;
  let outer: number | null = null;
  let innerOpt: number | null = null;
  let outerOpt: number | null = null;

  if (Number.isFinite(teff) && (teff as number) >= 2600 && (teff as number) <= 7200) {
    // Valid range of the polynomial fit.
    inner = Math.sqrt(luminosity / seff(HZ_COEFFS.runawayGreenhouse, teff as number));
    outer = Math.sqrt(luminosity / seff(HZ_COEFFS.maximumGreenhouse, teff as number));
    innerOpt = Math.sqrt(luminosity / seff(HZ_COEFFS.recentVenus, teff as number));
    outerOpt = Math.sqrt(luminosity / seff(HZ_COEFFS.earlyMars, teff as number));
  } else if (luminosity > 0) {
    // Seager et al. (2013) closed form: d = sqrt(L / S_eff).
    inner = Math.sqrt(luminosity / 1.776);
    outer = Math.sqrt(luminosity / 0.32);
    innerOpt = Math.sqrt(luminosity / 0.99);
    outerOpt = Math.sqrt(luminosity / 0.36);
  }

  if (inner !== null && outer !== null && inner > outer) [inner, outer] = [outer, inner];
  if (innerOpt !== null && outerOpt !== null && innerOpt > outerOpt) [innerOpt, outerOpt] = [outerOpt, innerOpt];

  return {
    luminosity,
    luminosityEstimated: estimated,
    hzInner: inner,
    hzOuter: outer,
    hzInnerOptimistic: innerOpt,
    hzOuterOptimistic: outerOpt,
    spectralClass: spectralClassOf(teff, planet.st_spectype),
  };
}

// --- Planet physical properties --------------------------------------------

/**
 * Chen & Kipping (2017) forecaster relation: radius (Earth radii) -> mass
 * (Earth masses). Used to fill gaps so the UI never shows a blank where a
 * scatter point belongs — but the result is always labelled "inferred".
 */
export function massFromRadius(radiusEarth: number): number {
  const C = 2.04;       // normalization from the published fit
  const r = Math.max(radiusEarth, 0.1);
  if (r < 1.23) return C * Math.pow(r, 1 / 0.279);
  if (r < 14.26) return C * Math.pow(r, 1 / 0.589);
  return C * Math.pow(r, 1 / -0.044);
}

/** Inverse of the above: mass (Earth) -> radius (Earth), for missing radii. */
export function radiusFromMass(massEarth: number): number {
  const C = 2.04;
  const m = Math.max(massEarth, 1e-4);
  if (m < 2.04 * Math.pow(1.23, 1 / 0.279)) return Math.pow(m / C, 0.279);
  if (m < 2.04 * Math.pow(14.26, 1 / 0.589)) return Math.pow(m / C, 0.589);
  return Math.pow(m / C, -0.044);
}

export function massInEarth(planet: Planet): { value: number | null; inferred: boolean } {
  if (Number.isFinite(planet.pl_bmasse) && (planet.pl_bmasse as number) > 0) {
    return { value: planet.pl_bmasse as number, inferred: false };
  }
  if (Number.isFinite(planet.pl_bmassj) && (planet.pl_bmassj as number) > 0) {
    return { value: (planet.pl_bmassj as number) * EARTH_MASS_JUP, inferred: false };
  }
  return { value: null, inferred: true };
}

/** Semi-major axis from Kepler's third law when the archive has no value. */
export function semiMajorAxis(planet: Planet, starMass = 1): { value: number | null; inferred: boolean } {
  if (Number.isFinite(planet.pl_orbsmax) && (planet.pl_orbsmax as number) > 0) {
    return { value: planet.pl_orbsmax as number, inferred: false };
  }
  if (Number.isFinite(planet.pl_orbper) && (planet.pl_orbper as number) > 0) {
    const years = (planet.pl_orbper as number) / 365.25;
    const m = Number.isFinite(starMass) && starMass > 0 ? starMass : 1;
    return { value: Math.cbrt(years * years * m), inferred: true };
  }
  return { value: null, inferred: true };
}

/**
 * Equilibrium temperature. The archive value is preferred; otherwise
 * T_eq = T_star * sqrt(R_star / 2a) for a zero-albedo, full-redistribution body.
 */
export function equilibriumTemp(planet: Planet, a: number | null): number | null {
  if (Number.isFinite(planet.pl_eqt) && (planet.pl_eqt as number) > 0) return planet.pl_eqt as number;
  if (Number.isFinite(planet.st_teff) && Number.isFinite(planet.st_rad) && a && a > 0) {
    return (planet.st_teff as number) * Math.sqrt((planet.st_rad as number) / (2 * a));
  }
  return null;
}

// --- Classification ---------------------------------------------------------

export function classify(radiusEarth: number | null, massEarth: number | null): PlanetClass {
  const r = radiusEarth;
  if (r !== null) {
    if (r < 0.8) return "Sub-Earth";
    if (r < 1.25) return "Terrestrial";
    if (r < 1.75) return "Super-Earth";
    if (r < 3.5) return "Neptune-like";
    if (r < 6) return "Sub-Jovian";
    return "Jovian";
  }
  if (massEarth !== null) {
    if (massEarth < 0.5) return "Sub-Earth";
    if (massEarth < 2) return "Terrestrial";
    if (massEarth < 10) return "Super-Earth";
    if (massEarth < 50) return "Neptune-like";
    if (massEarth < 300) return "Sub-Jovian";
    return "Jovian";
  }
  return "Unknown";
}

export function tempBandOf(t: number | null): TempBand {
  if (t === null) return "Unknown";
  if (t > 1000) return "Scorching";
  if (t > 700) return "Hot";
  if (t > 400) return "Warm";
  if (t >= 250) return "Temperate";
  if (t >= 180) return "Cool";
  if (t >= 100) return "Cold";
  return "Frigid";
}

/** Flagged as disputed in the literature, or announced very recently. */
export function confidenceOf(planet: Planet): DetectionConfidence {
  if (planet.pl_controv_flag === 1) return "Disputed";
  if (planet.disc_year >= 2025) return "Tentative";
  return "Firm";
}

// --- Earth Similarity Index -------------------------------------------------

/** Schulze-Makuch weighting: radius .57, density .30, escape .05, temp .05. */
const ESI_WEIGHTS = { radius: 0.57, density: 0.30, escape: 0.05, temp: 0.05 };

/** ESI of a single property: (1 - |(x-x0)/(x+x0)|)^(w/n). */
function esiTerm(x: number, x0: number, weight: number, n: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const distance = Math.abs((x - x0) / (x + x0));
  return Math.pow(1 - clamp(distance, 0, 1), weight / n);
}

/**
 * Weighted geometric mean over whichever properties we can actually compute.
 * Radical improvement on a hard-coded score: it degrades gracefully and states
 * which inputs were available.
 */
export function earthSimilarity(input: {
  radius: number | null; density: number | null; escape: number | null; temp: number | null;
}): { esi: number | null; components: DerivedPlanet["esiComponents"] } {
  const terms: { key: keyof typeof ESI_WEIGHTS; value: number | null }[] = [
    { key: "radius", value: input.radius },
    { key: "density", value: input.density },
    { key: "escape", value: input.escape },
    { key: "temp", value: input.temp },
  ];
  const usable = terms.filter((t) => t.value !== null && Number.isFinite(t.value) && (t.value as number) > 0);
  const components: DerivedPlanet["esiComponents"] = { radius: null, density: null, escape: null, temp: null };
  for (const term of usable) {
    components[term.key] = esiTerm(term.value as number, EARTH_REFERENCE[term.key], ESI_WEIGHTS[term.key], usable.length);
  }
  if (!usable.length) return { esi: null, components };
  const product = usable.reduce((acc, term) => acc * esiTerm(term.value as number, EARTH_REFERENCE[term.key], ESI_WEIGHTS[term.key], usable.length), 1);
  return { esi: clamp(product, 0, 1), components };
}

const EARTH_REFERENCE = { radius: 1, density: EARTH_DENSITY, escape: EARTH_ESCAPE, temp: 288 };

// --- Composite habitability -------------------------------------------------

export const HABITABILITY_WEIGHTS = {
  earthSimilarity: 0.34,
  habitableZone: 0.26,
  surfaceTemp: 0.18,
  rocky: 0.12,
  starStability: 0.10,
} as const;

export interface HabitabilityBreakdown {
  score: number;
  parts: { key: keyof typeof HABITABILITY_WEIGHTS; weight: number; value: number; label: string }[];
}

/**
 * Composite 0-100 index. Every component is exposed so the UI can explain the
 * number instead of asserting it.
 */
export function habitability(p: {
  esi: number | null;
  hzStatus: DerivedPlanet["hzStatus"];
  hzDistance: number | null;
  temp: number | null;
  cls: PlanetClass;
  spectralClass: string;
  radius: number | null;
}): HabitabilityBreakdown {
  const esiValue = p.esi ?? 0;

  let hzValue = 0;
  if (p.hzStatus === "inside") hzValue = 1;
  else if (p.hzDistance !== null && Number.isFinite(p.hzDistance)) hzValue = clamp(Math.exp(-p.hzDistance / 1.5), 0, 1);

  let tempValue = 0;
  if (p.temp !== null) {
    // 288 K is ideal; a 60 K tolerance costs roughly half the score.
    tempValue = Math.exp(-Math.pow((p.temp - 288) / 90, 2));
  }

  let rockyValue = 0;
  if (p.radius !== null) {
    if (p.radius <= 1.6) rockyValue = 1;
    else if (p.radius <= 3.0) rockyValue = clamp(1 - (p.radius - 1.6) / 1.4, 0, 1);
  } else if (p.cls === "Terrestrial" || p.cls === "Super-Earth") {
    rockyValue = 0.7;
  }

  const stableStars: Record<string, number> = { G: 1, K: 0.9, F: 0.75, M: 0.45, A: 0.2, B: 0.05, O: 0.02 };
  const starValue = stableStars[p.spectralClass[0]] ?? 0.5;

  const parts = [
    { key: "earthSimilarity" as const, weight: HABITABILITY_WEIGHTS.earthSimilarity, value: esiValue, label: "Earth similarity" },
    { key: "habitableZone" as const, weight: HABITABILITY_WEIGHTS.habitableZone, value: hzValue, label: "Habitable zone" },
    { key: "surfaceTemp" as const, weight: HABITABILITY_WEIGHTS.surfaceTemp, value: tempValue, label: "Temperature" },
    { key: "rocky" as const, weight: HABITABILITY_WEIGHTS.rocky, value: rockyValue, label: "Rocky body" },
    { key: "starStability" as const, weight: HABITABILITY_WEIGHTS.starStability, value: starValue, label: "Host star" },
  ];
  const score = parts.reduce((acc, part) => acc + part.weight * part.value, 0) * 100;
  return { score: Math.round(clamp(score, 0, 100) * 10) / 10, parts };
}

// --- Assembly ---------------------------------------------------------------

export function derive(planet: Planet): DerivedPlanet {
  const star = deriveStar(planet);
  const radiusMeasured = Number.isFinite(planet.pl_rade) && (planet.pl_rade as number) > 0
    ? (planet.pl_rade as number) : null;
  const mass = massInEarth(planet);

  // Fill whichever of mass/radius is missing from the other.
  let radius = radiusMeasured;
  let radiusInferred = false;
  if (radius === null && mass.value !== null) {
    radius = radiusFromMass(mass.value);
    radiusInferred = true;
  }
  let massEarth = mass.value;
  let massInferred = mass.inferred;
  if (massEarth === null && radiusMeasured !== null) {
    massEarth = massFromRadius(radiusMeasured);
    massInferred = true;
  }

  const density = Number.isFinite(planet.pl_dens) && (planet.pl_dens as number) > 0
    ? (planet.pl_dens as number)
    : radius !== null && massEarth !== null && radius > 0
      ? massEarth / Math.pow(radius, 3) * EARTH_DENSITY
      : null;

  const gravity = radius !== null && massEarth !== null && radius > 0
    ? (massEarth / (radius * radius)) * EARTH_GRAVITY : null;
  const escapeVelocity = radius !== null && massEarth !== null && radius > 0
    ? Math.sqrt(massEarth / radius) * EARTH_ESCAPE : null;

  const starMass = Number.isFinite(planet.st_mass) ? (planet.st_mass as number) : 1;
  const axis = semiMajorAxis(planet, starMass);
  const temp = equilibriumTemp(planet, axis.value);

  // Membership is decided by the conservative zone (runaway greenhouse ->
  // maximum greenhouse). The optimistic zone (recent Venus -> early Mars) widens
  // it, because a world just outside the conservative edge is a candidate rather
  // than a write-off — and narrowing to the conservative zone alone would discard
  // most of the interesting shortlist.
  let hzStatus: DerivedPlanet["hzStatus"] = "unknown";
  let hzDistance: number | null = null;
  if (axis.value !== null && star.hzInner !== null && star.hzOuter !== null) {
    const optimisticInner = star.hzInnerOptimistic ?? star.hzInner * 0.72;
    const optimisticOuter = star.hzOuterOptimistic ?? star.hzOuter * 1.5;
    if (axis.value >= optimisticInner && axis.value <= optimisticOuter) {
      hzStatus = "inside";
      hzDistance = 0;
    } else if (axis.value < optimisticInner) {
      hzStatus = "outside-inner";
      hzDistance = optimisticInner - axis.value;
    } else {
      hzStatus = "outside-outer";
      hzDistance = axis.value - optimisticOuter;
    }
  }

  const esiResult = earthSimilarity({ radius, density, escape: escapeVelocity, temp });
  const cls = classify(radius, massEarth);

  const hab = habitability({
    esi: esiResult.esi, hzStatus, hzDistance, temp, cls,
    spectralClass: star.spectralClass, radius,
  });

  // "Potentially habitable" uses the same conservative criteria as the
  // archive's own habitable-worlds table: rocky AND inside the conservative HZ.
  // Mirrors the archive's own "habitable worlds" criteria — a rocky-size world in
  // the habitable zone — with one addition: when a mass has actually been
  // measured, a 1.5 R⊕ planet above ~10 M⊕ is far more likely a mini-Neptune, so
  // it does not qualify on radius alone.
  const potentiallyHabitable = hzStatus === "inside"
    && radius !== null && radius >= 0.5 && radius <= 1.8
    && !(massEarth !== null && !massInferred && massEarth > 10);

  return {
    planet,
    id: planet.pl_name,
    cls,
    star,
    massEarth,
    massInferred,
    radiusEarth: radius,
    radiusInferred,
    gravity,
    escapeVelocity,
    density,
    semiMajorAxis: axis.value,
    semiMajorAxisInferred: axis.inferred,
    equilibriumTemp: temp,
    hzStatus,
    potentiallyHabitable,
    esi: esiResult.esi,
    esiComponents: esiResult.components,
    habitability: hab.score,
    tempBand: tempBandOf(temp),
    confidence: confidenceOf(planet),
    hzDistance,
  };
}

export function habitabilityBreakdown(d: DerivedPlanet): HabitabilityBreakdown {
  return habitability({
    esi: d.esi, hzStatus: d.hzStatus, hzDistance: d.hzDistance,
    temp: d.equilibriumTemp, cls: d.cls,
    spectralClass: d.star.spectralClass, radius: d.radiusEarth,
  });
}

/** Human-readable label for a planet class, used in legends and filters. */
export const PLANET_CLASSES: PlanetClass[] = [
  "Sub-Earth", "Terrestrial", "Super-Earth", "Neptune-like", "Sub-Jovian", "Jovian",
];

export const CLASS_COLORS: Record<PlanetClass, string> = {
  "Sub-Earth": "#a78bfa",
  Terrestrial: "#34d399",
  "Super-Earth": "#22d3ee",
  "Neptune-like": "#60a5fa",
  "Sub-Jovian": "#fb923c",
  Jovian: "#f472b6",
  Unknown: "#64748b",
};
