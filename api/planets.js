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

/** Columns the client is allowed to request a subset of. */
const ALLOWED_COLUMNS = [
  "pl_name", "hostname", "discoverymethod", "disc_year", "disc_facility", "disc_telescope",
  "sy_dist", "ra", "dec",
  "pl_orbper", "pl_orbsmax", "pl_orbeccen", "pl_orbincl",
  "pl_rade", "pl_bmasse", "pl_bmassj", "pl_dens", "pl_eqt", "pl_insol",
  "st_teff", "st_rad", "st_mass", "st_spectype", "st_lum",
  "pl_controv_flag", "tran_flag", "rv_flag", "ttv_flag", "pl_ntranspec", "pl_nespec",
  "disc_locale", "disc_instrument",
];

const DEFAULTS = [
  "pl_name", "hostname", "discoverymethod", "disc_year", "disc_facility",
  "sy_dist", "ra", "dec",
  "pl_orbper", "pl_orbsmax", "pl_orbeccen",
  "pl_rade", "pl_bmasse", "pl_eqt", "pl_insol",
  "st_teff", "st_rad", "st_mass", "st_spectype",
  "pl_controv_flag", "tran_flag", "rv_flag",
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

/** Warm-lambda cache so repeat visits never touch NASA. */
let cache = null;

export default async function handler(req, res) {
  const requested = String(req.query?.cols ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean);
  const columns = requested.length
    ? ALLOWED_COLUMNS.filter((c) => requested.includes(c))
    : DEFAULTS;
  const effective = columns.length ? columns : DEFAULTS;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (cache && cache.key === effective.join(",")) {
    res.setHeader("X-Exo-Cache", "HIT");
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ ...cache.payload, meta: { ...cache.payload.meta, cache: "hit" } });
  }

  try {
    const rows = await fetchUpstream(effective);
    const payload = {
      planets: normalise(rows),
      meta: {
        source: "NASA Exoplanet Archive — Planetary Systems (ps), default_flag=1",
        endpoint: TAP,
        count: rows.length,
        columns: effective,
        fetchedAt: new Date().toISOString(),
        cache: "miss",
      },
    };
    cache = { key: effective.join(","), payload };
    // 6h at the edge: the archive changes a few times a day at most.
    res.setHeader("X-Exo-Cache", "MISS");
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
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
