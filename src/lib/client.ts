/**
 * Three-tier data loader.
 *
 *   1. /api/planets      — our own serverless proxy (6h CDN cache). Authoritative.
 *   2. /snapshot.json    — a build-time snapshot committed to the repo, so the app
 *                          still works if the archive is down or the function is cold-failing.
 *   3. localStorage      — the last successful payload, so repeat visits are instant
 *                          and offline.
 *
 * If all three fail the caller gets a structured error, never a blank screen.
 */

import type { Fleet, FleetMeta, Planet } from "./types";

const API = "/api/planets";
const SNAPSHOT = "/snapshot.json";
/** Bump when the payload shape changes, so stale caches are ignored rather than mis-read. */
const LS_KEY = "exoexplorer.fleet.v2";
const LS_TTL_MS = 12 * 60 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 20_000;

export interface LoadResult {
  fleet: Fleet;
  /** Non-fatal problems worth surfacing (e.g. "live feed unavailable"). */
  warnings: string[];
}

interface CacheShape { savedAt: number; fleet: Fleet }

function readCache(): Fleet | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed?.fleet?.planets?.length) return null;
    if (Date.now() - parsed.savedAt > LS_TTL_MS) return null;
    return parsed.fleet;
  } catch {
    return null;
  }
}

function writeCache(fleet: Fleet): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), fleet } satisfies CacheShape));
  } catch {
    // Quota exceeded or private mode — caching is a nicety, not a requirement.
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Mirror of the encoder in api/planets.js.
 *
 * Low-cardinality strings (discovery method, facility, spectral type) ship as
 * indices into `dictionaries`, which takes the payload from ~2.1 MB to ~1.9 MB
 * and matters far more once the snapshot is committed to the repo. Plain rows
 * pass through untouched, so both shapes are accepted.
 */
function decodeDictionaries(
  rows: Planet[],
  dictionaries: Record<string, string[]> | undefined,
): Planet[] {
  if (!dictionaries) return rows;
  const columns = Object.keys(dictionaries).filter((key) => Array.isArray(dictionaries[key]));
  if (!columns.length) return rows;

  return rows.map((row) => {
    let copy: Planet | null = null;
    for (const column of columns) {
      const value = (row as unknown as Record<string, unknown>)[column];
      if (typeof value !== "number") continue;
      const resolved = dictionaries[column][value];
      if (resolved === undefined) continue;
      if (!copy) copy = { ...row };
      (copy as unknown as Record<string, unknown>)[column] = resolved;
    }
    return copy ?? row;
  });
}

function validate(payload: unknown, origin: FleetMeta["origin"]): Fleet {
  const data = payload as {
    planets?: unknown;
    dictionaries?: Record<string, string[]>;
    meta?: Partial<FleetMeta>;
  } | null;
  if (!data || !Array.isArray(data.planets) || data.planets.length === 0) {
    throw new Error("payload contained no planets");
  }
  const planets = decodeDictionaries(data.planets as Planet[], data.dictionaries)
    .filter((p) => p && typeof p.pl_name === "string");
  if (!planets.length) throw new Error("payload contained no usable rows");
  return {
    planets,
    meta: {
      source: data.meta?.source ?? "NASA Exoplanet Archive",
      count: planets.length,
      fetchedAt: data.meta?.fetchedAt ?? new Date().toISOString(),
      cache: data.meta?.cache,
      origin,
    },
  };
}

/** Refresh a stale-but-usable cached fleet in the background. */
function refreshInBackground(): void {
  fetchJson(API, NETWORK_TIMEOUT_MS)
    .then((payload) => writeCache(validate(payload, "network")))
    .catch(() => undefined);
}

export async function loadFleet(): Promise<LoadResult> {
  const warnings: string[] = [];

  const cached = readCache();
  if (cached) {
    refreshInBackground();
    return { fleet: { ...cached, meta: { ...cached.meta, origin: "cache" } }, warnings };
  }

  try {
    const fleet = validate(await fetchJson(API, NETWORK_TIMEOUT_MS), "network");
    writeCache(fleet);
    return { fleet, warnings };
  } catch (error) {
    warnings.push("Live archive feed unavailable — using the bundled snapshot.");
  }

  try {
    const fleet = validate(await fetchJson(SNAPSHOT, NETWORK_TIMEOUT_MS), "snapshot");
    return { fleet, warnings };
  } catch {
    warnings.push("Bundled snapshot could not be read either.");
  }

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { fleet: { ...(JSON.parse(raw) as CacheShape).fleet, meta: { source: "local cache", count: 0, fetchedAt: new Date().toISOString(), origin: "cache" } }, warnings };
  } catch {
    // fall through
  }

  throw new Error("No exoplanet data could be loaded from the live feed, the snapshot, or the local cache.");
}
