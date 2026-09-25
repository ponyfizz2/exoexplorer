/**
 * The Solar System, in exactly the same shape as the exoplanet feed so it can be
 * filtered, charted, compared and rendered by the same code paths.
 *
 * Values: NASA Planetary Fact Sheet (mass/radius/density/gravity/orbit).
 * `pl_eqt` values are the effective equilibrium temperature at the top of the
 * atmosphere using a bond albedo of 0.3 where a measured value is unavailable —
 * for Earth that lands near 255 K (the textbook zero-greenhouse figure), while
 * the catalogued 288 K is used as the ESI temperature reference.
 */

import type { Planet } from "../lib/types";

interface SolarEntry extends Planet {
  /** Mean surface temperature, K — the number a human cares about. */
  surfacetemp: number;
  moons: number;
  ringed?: boolean;
  blurb: string;
}

export const SOLAR_SYSTEM: SolarEntry[] = [
  {
    pl_name: "Mercury", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 87.969, pl_orbsmax: 0.3871, pl_orbeccen: 0.2056, pl_orbincl: 7.005,
    pl_rade: 0.3829, pl_bmasse: 0.0553, pl_bmassj: 0.000174, pl_dens: 5.427,
    pl_eqt: 440, pl_insol: 6.68, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 440, moons: 0,
    blurb: "Airless, cratered and tidally cooked: a day on Mercury lasts two of its own years.",
  },
  {
    pl_name: "Venus", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 224.701, pl_orbsmax: 0.7233, pl_orbeccen: 0.0068, pl_orbincl: 3.395,
    pl_rade: 0.9499, pl_bmasse: 0.815, pl_bmassj: 0.00256, pl_dens: 5.243,
    pl_eqt: 232, pl_insol: 1.911, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 737, moons: 0,
    blurb: "Earth's twin gone wrong — a runaway greenhouse with 92 bars of CO₂ and lead-melting surface heat.",
  },
  {
    pl_name: "Earth", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 365.256, pl_orbsmax: 1.0, pl_orbeccen: 0.0167, pl_orbincl: 0.0,
    pl_rade: 1.0, pl_bmasse: 1.0, pl_bmassj: 0.003146, pl_dens: 5.514,
    pl_eqt: 255, pl_insol: 1.0, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 288, moons: 1,
    blurb: "The only world where the habitable zone, liquid water and a magnetic field all overlap.",
  },
  {
    pl_name: "Mars", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 686.98, pl_orbsmax: 1.5237, pl_orbeccen: 0.0934, pl_orbincl: 1.85,
    pl_rade: 0.532, pl_bmasse: 0.107, pl_bmassj: 0.000337, pl_dens: 3.933,
    pl_eqt: 210, pl_insol: 0.431, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 210, moons: 2,
    blurb: "Cold, thin-aired and rusty — but with polar ice caps and the tallest volcano in the system.",
  },
  {
    pl_name: "Jupiter", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 4332.59, pl_orbsmax: 5.2044, pl_orbeccen: 0.0489, pl_orbincl: 1.303,
    pl_rade: 11.209, pl_bmasse: 317.83, pl_bmassj: 1.0, pl_dens: 1.326,
    pl_eqt: 110, pl_insol: 0.0345, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 165, moons: 95, ringed: true,
    blurb: "The system's vacuum cleaner: 2.5× the mass of every other planet combined.",
  },
  {
    pl_name: "Saturn", hostname: "Sol", discoverymethod: "Naked-eye observation", disc_year: -3000,
    disc_facility: "Prehistoric", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 10759.22, pl_orbsmax: 9.5826, pl_orbeccen: 0.0565, pl_orbincl: 2.485,
    pl_rade: 9.449, pl_bmasse: 95.16, pl_bmassj: 0.299, pl_dens: 0.687,
    pl_eqt: 81, pl_insol: 0.0109, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 134, moons: 146, ringed: true,
    blurb: "Less dense than water, wrapped in ice rings only tens of metres thick.",
  },
  {
    pl_name: "Uranus", hostname: "Sol", discoverymethod: "Direct observation", disc_year: 1781,
    disc_facility: "William Herschel", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 30688.5, pl_orbsmax: 19.2184, pl_orbeccen: 0.0457, pl_orbincl: 0.773,
    pl_rade: 4.007, pl_bmasse: 14.54, pl_bmassj: 0.0457, pl_dens: 1.27,
    pl_eqt: 59, pl_insol: 0.00259, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 76, moons: 28, ringed: true,
    blurb: "Knocked onto its side, so it rolls around the Sun with 42-year-long polar seasons.",
  },
  {
    pl_name: "Neptune", hostname: "Sol", discoverymethod: "Predicted then observed", disc_year: 1846,
    disc_facility: "Le Verrier / Galle", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 60182, pl_orbsmax: 30.11, pl_orbeccen: 0.0113, pl_orbincl: 1.77,
    pl_rade: 3.883, pl_bmasse: 17.15, pl_bmassj: 0.0539, pl_dens: 1.638,
    pl_eqt: 48, pl_insol: 0.00108, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 72, moons: 16,
    blurb: "Found with mathematics before anyone pointed a telescope at it — and it has 2,100 km/h winds.",
  },
  {
    pl_name: "Pluto", hostname: "Sol", discoverymethod: "Direct observation", disc_year: 1930,
    disc_facility: "Lowell Observatory", sy_dist: 0, ra: 0, dec: 0,
    pl_orbper: 90560, pl_orbsmax: 39.482, pl_orbeccen: 0.2488, pl_orbincl: 17.16,
    pl_rade: 0.1868, pl_bmasse: 0.00218, pl_bmassj: 0.0000069, pl_dens: 1.854,
    pl_eqt: 44, pl_insol: 0.00065, st_teff: 5772, st_rad: 1, st_mass: 1, st_spectype: "G2V",
    surfacetemp: 44, moons: 5,
    blurb: "A dwarf planet with nitrogen glaciers and a heart-shaped plain, reclassified in 2006.",
  },
];

export const SOLAR_BY_NAME = new Map(SOLAR_SYSTEM.map((p) => [p.pl_name, p]));
