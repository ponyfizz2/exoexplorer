#!/usr/bin/env node
/**
 * Refreshes public/snapshot.json from the NASA Exoplanet Archive and prunes the
 * payload to the fields the app actually renders (the raw table is 355 columns
 * wide, which would be a ~9 MB snapshot).
 *
 * The result is committed to the repo on purpose: it is what keeps the deployed
 * site useful when the archive is slow, rate-limiting or down.
 *
 *   node scripts/build-fallback.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/snapshot.json");

const COLUMNS = [
  "pl_name", "hostname", "discoverymethod", "disc_year", "disc_facility",
  "sy_dist", "ra", "dec",
  "pl_orbper", "pl_orbsmax", "pl_orbeccen",
  "pl_rade", "pl_bmasse", "pl_eqt", "pl_insol",
  "st_teff", "st_rad", "st_mass", "st_spectype",
  "pl_controv_flag", "tran_flag", "rv_flag",
];

const QUERY =
  "select " + COLUMNS.join(",") + " from ps where default_flag=1 " +
  "order by disc_year asc, pl_name asc";

const url =
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?" +
  new URLSearchParams({ query: QUERY, format: "json" });

console.log("Fetching NASA Exoplanet Archive…");
const response = await fetch(url, {
  headers: { Accept: "application/json", "User-Agent": "ExoExplorer-snapshot-builder/1.0" },
});
if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
const text = await response.text();
if (text.trimStart().startsWith("<")) throw new Error("upstream returned a VOTable error");
const rows = JSON.parse(text);
if (!Array.isArray(rows) || !rows.length) throw new Error("upstream returned no rows");

const planets = rows.map((row) => {
  const out = {};
  for (const key of COLUMNS) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    out[key] = typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : String(value);
  }
  // Round the noisy floats so the snapshot stays small.
  for (const key of ["sy_dist", "ra", "dec", "pl_orbper", "pl_orbsmax", "pl_orbeccen", "pl_rade", "pl_bmasse", "pl_eqt", "pl_insol", "st_teff", "st_rad", "st_mass"]) {
    if (typeof out[key] === "number") out[key] = Number(out[key].toPrecision(7));
  }
  return out;
});

/**
 * Dictionary-encode low-cardinality strings, mirroring api/planets.js. The
 * snapshot is committed to the repo and served to every visitor who arrives
 * while the archive is down, so its size is worth the small amount of fiddling.
 */
const ENCODE_COLUMNS = ["discoverymethod", "disc_facility", "st_spectype"];
const dictionaries = {};
const index = {};
for (const column of ENCODE_COLUMNS) {
  dictionaries[column] = [];
  index[column] = new Map();
}

const encoded = planets.map((row) => {
  const out = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (index[key]) {
      const map = index[key];
      if (!map.has(value)) {
        map.set(value, dictionaries[key].length);
        dictionaries[key].push(value);
      }
      out[key] = map.get(value);
      continue;
    }
    out[key] = value;
  }
  return out;
});
for (const column of ENCODE_COLUMNS) {
  if (!dictionaries[column].length) delete dictionaries[column];
}

const payload = {
  meta: {
    source: "NASA Exoplanet Archive — Planetary Systems (ps), default_flag=1",
    endpoint: "https://exoplanetarchive.ipac.caltech.edu/TAP/sync",
    count: encoded.length,
    encoded: Object.keys(dictionaries),
    fetchedAt: new Date().toISOString(),
  },
  dictionaries,
  planets: encoded,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload));

const bytes = JSON.stringify(payload).length;
console.log(`Wrote ${planets.length} planets -> ${OUT} (${(bytes / 1024).toFixed(0)} KB)`);
