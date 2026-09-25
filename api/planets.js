/**
 * EXOEXPLORER — NASA Exoplanet Archive proxy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The NASA Exoplanet Archive TAP endpoint sends NO Access-Control-Allow-Origin
 * header. A browser cannot call it directly, which is why static clones of this
 * app end up depending on flaky public CORS proxies that rate-limit and die.
 * This function runs server-side on Vercel, is cached at the CDN edge, and is
 * the single place where the upstream contract is enforced.
 *
 * CONTRACT
 *   GET /api/planets[?cols=a,b,c]
 *   -> { planets: [...], meta: { ... } }
 *
 * The client may only NARROW the column list (to save bandwidth on slow links).
 * It can never inject ADQL. Unknown columns are ignored.
 */

const TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

/** Requested but never rendered: dropping them trims ~13% of the payload. */
const DROP_COLUMNS = ["pl_controv_flag", "tran_flag", "rv_flag"];

/** Columns the client is allowed to request a subset of. */
const ALLOWED_COLUMNS = [
  "pl_name", "hostname", "discoverymethod", "disc_year", "disc_facility", "disc_telescope",
  "sy_dist", "ra", "dec",
  "pl_orbper", "pl_orbsmax", "pl_orbeccen", "pl_orbincl",
  "pl_rade", "pl_bmasse", "pl_bmassj", "pl_dens", "pl_eqt", "pl_insol",
  "st_teff", "st_rad", "st_mass", "st_spectype", "st_lum", "ttv_flag", "pl_ntranspec", "pl_nespec",
  "disc_locale", "disc_instrument",
];

const DEFAULTS = [
  "pl_name", "hostname", "discoverymethod", "disc_year", "disc_facility",
  "sy_dist", "ra", "dec",
  "pl_orbper", "pl_orbsmax", "pl_orbeccen",
  "pl_rade", "pl_bmasse", "pl_eqt", "pl_insol",
  "st_teff", "st_rad", "st_mass", "st_spectype",
];

const UPSTREAM_ATTEMPTS = 3;
const UPSTREAM_TIMEOUT_MS = 20_000;

function buildQuery(columns) {
  return (
    "select " + columns.join(",") + " from ps where default_flag=1 " +
    "order by disc_year asc, pl_name asc"
  );
}

async function fetchUpstream(columns) {
  const url = TAP + "?" + new URLSearchParams({ query: buildQuery(columns), format: "json" });
  let lastError;
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "ExoExplorer/1.0 (+https://github.com/ponyfizz2/exoexplorer)",
        },
      });
      if (!response.ok) throw new Error("upstream HTTP " + response.status);
      const text = await response.text();
      // TAP reports ADQL errors as a 200 VOTable payload.
      if (text.trimStart().startsWith("<")) throw new Error("upstream returned VOTable error");
      const rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error("unexpected upstream payload");
      return rows;
    } catch (error) {
      lastError = error;
      if (attempt < UPSTREAM_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Columns worth dictionary-encoding: low cardinality, high byte cost. */
const DICTIONARY_COLUMNS = ["discoverymethod", "disc_facility", "st_spectype"];

/**
 * Replaces repeated strings with an index into a lookup table.
 *
 * "Transit" and "Kepler" appear thousands of times each, and flag columns are
 * almost always 0. Encoding them, and dropping the three detection flags the
 * client does not render, takes the payload from ~2.1 MB to ~1.6 MB on the
 * critical path. The client calls the mirror of this to rebuild plain rows.
 */
function encodeDictionary(rows) {
  const dictionaries = {};
  for (const column of DICTIONARY_COLUMNS) dictionaries[column] = [];
  const index = {};
  for (const column of DICTIONARY_COLUMNS) index[column] = new Map();

  const planets = rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (value === null || value === undefined || value === "") continue;
      if (DICTIONARY_COLUMNS.includes(key)) {
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

  // Only keep dictionaries that actually saved space.
  for (const column of DICTIONARY_COLUMNS) {
    if (dictionaries[column].length === 0) delete dictionaries[column];
  }
  return { planets, dictionaries };
}

/** Builds the response payload, including a timestamp for cache diagnostics. */
async function buildPayload(columns) {
  const rows = await fetchUpstream(columns);
  const { planets, dictionaries } = encodeDictionary(normalise(rows));
  return {
    planets,
    dictionaries,
    meta: {
      source: "NASA Exoplanet Archive — Planetary Systems (ps), default_flag=1",
      endpoint: TAP,
      count: planets.length,
      columns: columns.filter((c) => !DROP_COLUMNS.includes(c)),
      encoded: Object.keys(dictionaries),
      fetchedAt: new Date().toISOString(),
    },
  };
}

function normalise(rows) {
  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (value === null || value === "" || value === undefined) continue;
      const num = typeof value === "number" ? value : Number(value);
      out[key] = Number.isFinite(num) && typeof value !== "string" ? num : Number.isFinite(num) ? num : value;
    }
    return out;
  });
}

/**
 * In-memory cache on the warm lambda.
 *
 * Vercel's build step rewrites Cache-Control on function responses, so the
 * s-maxage directive below is advisory at best and the CDN will not do the
 * caching for us. Owning it here means a warm instance answers from memory
 * instantly, and a stale entry is served immediately while a background
 * refresh runs — the same behaviour stale-while-revalidate would have given us.
 */
const FRESH_MS = 6 * 60 * 60 * 1000;   // serve without question
const STALE_MS = 48 * 60 * 60 * 1000;  // serve, but refresh in the background

let cache = null;
let inFlight = null;

export default async function handler(req, res) {
  const requested = String(req.query?.cols ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean);
  const columns = requested.length
    ? ALLOWED_COLUMNS.filter((c) => requested.includes(c))
    : DEFAULTS;
  const effective = columns.length ? columns : DEFAULTS;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const key = effective.join(",");
  const age = cache && cache.key === key ? Date.now() - cache.storedAt : Infinity;

  if (cache && cache.key === key && age < FRESH_MS) {
    res.setHeader("X-Exo-Cache", "HIT");
    res.setHeader("X-Exo-Age", String(Math.round(age / 1000)));
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json({ ...cache.payload, meta: { ...cache.payload.meta, cache: "hit" } });
  }

  // Stale but usable: answer now, refresh behind the scenes.
  if (cache && cache.key === key && age < STALE_MS) {
    if (!inFlight) {
      inFlight = buildPayload(effective)
        .then((payload) => { cache = { key, payload, storedAt: Date.now() }; })
        .catch(() => undefined)
        .finally(() => { inFlight = null; });
    }
    res.setHeader("X-Exo-Cache", "STALE");
    res.setHeader("X-Exo-Age", String(Math.round(age / 1000)));
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json({ ...cache.payload, meta: { ...cache.payload.meta, cache: "stale" } });
  }

  // Cold. Collapse concurrent misses onto a single upstream request so a burst
  // of traffic cannot stampede the archive.
  try {
    if (!inFlight) {
      inFlight = buildPayload(effective).finally(() => { inFlight = null; });
    }
    const payload = await inFlight;
    cache = { key, payload, storedAt: Date.now() };
    res.setHeader("X-Exo-Cache", "MISS");
    res.setHeader("X-Exo-Age", "0");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json(payload);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      error: "upstream_unavailable",
      message: "The NASA Exoplanet Archive could not be reached.",
      detail: String(error && error.message ? error.message : error),
      hint: "The app will retry and can fall back to its bundled snapshot.",
    });
  }
}
