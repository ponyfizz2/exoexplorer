/** Domain types for EXOEXPLORER. Field names mirror the NASA Exoplanet Archive `ps` table. */

export interface Planet {
  pl_name: string;
  hostname: string;
  discoverymethod: string;
  disc_year: number;
  disc_facility?: string;
  disc_telescope?: string;
  disc_locale?: string;
  disc_instrument?: string;

  /** Parsecs. */
  sy_dist?: number;
  /** Right ascension / declination in degrees (J2000). */
  ra?: number;
  dec?: number;

  /** Orbital period, days. */
  pl_orbper?: number;
  /** Semi-major axis, AU. */
  pl_orbsmax?: number;
  pl_orbeccen?: number;
  pl_orbincl?: number;

  /** Radius, Earth radii. */
  pl_rade?: number;
  /** Mass, Earth masses (best available). */
  pl_bmasse?: number;
  /** Mass, Jupiter masses. */
  pl_bmassj?: number;
  /** Bulk density, g/cm^3. */
  pl_dens?: number;
  /** Equilibrium temperature, K. */
  pl_eqt?: number;
  /** Insolation flux, Earth fluxes. */
  pl_insol?: number;

  /** Host star: effective temperature K, radius R_sun, mass M_sun. */
  st_teff?: number;
  st_rad?: number;
  st_mass?: number;
  st_spectype?: string;
  st_lum?: number;

  pl_controv_flag?: number;
  tran_flag?: number;
  rv_flag?: number;
}

export type PlanetClass =
  | "Sub-Earth" | "Terrestrial" | "Super-Earth" | "Neptune-like"
  | "Sub-Jovian" | "Jovian" | "Unknown";

export type TempBand =
  | "Scorching" | "Hot" | "Warm" | "Temperate" | "Cool" | "Cold" | "Frigid" | "Unknown";

export type DetectionConfidence = "Disputed" | "Tentative" | "Firm";

export interface StarFacts {
  /** Bolometric luminosity in solar units (derived when absent). */
  luminosity: number;
  luminosityEstimated: boolean;
  /** Conservative habitable zone (runaway greenhouse -> maximum greenhouse), AU. */
  hzInner: number | null;
  hzOuter: number | null;
  /** Optimistic habitable zone (recent Venus -> early Mars), AU. */
  hzInnerOptimistic: number | null;
  hzOuterOptimistic: number | null;
  spectralClass: string;
}

export interface DerivedPlanet {
  planet: Planet;
  id: string;
  cls: PlanetClass;
  star: StarFacts;
  /** Mass in Earth masses, measured or inferred from a mass-radius relation. */
  massEarth: number | null;
  massInferred: boolean;
  radiusEarth: number | null;
  radiusInferred: boolean;
  /** Surface gravity in g, escape velocity in km/s — null when mass is unknown. */
  gravity: number | null;
  escapeVelocity: number | null;
  density: number | null;
  /** Orbital semi-major axis in AU, measured or Kepler-derived from the period. */
  semiMajorAxis: number | null;
  semiMajorAxisInferred: boolean;
  equilibriumTemp: number | null;
  /** Where the planet sits relative to its star's habitable zone. */
  hzStatus: "inside" | "outside-inner" | "outside-outer" | "unknown";
  /** Only rocky worlds inside the conservative HZ qualify. */
  potentiallyHabitable: boolean;
  esi: number | null;
  esiComponents: { radius: number | null; density: number | null; escape: number | null; temp: number | null };
  habitability: number;
  tempBand: TempBand;
  confidence: DetectionConfidence;
  /** Habitable-zone distance of the planet, in AU. */
  hzDistance: number | null;
}

export interface FleetMeta {
  source: string;
  count: number;
  fetchedAt: string;
  cache?: string;
  /** Where the payload actually came from, resolved client-side. */
  origin?: "network" | "snapshot" | "cache";
}

export interface Fleet {
  planets: Planet[];
  meta: FleetMeta;
}
