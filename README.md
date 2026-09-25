# EXOEXPLORER

**Every confirmed exoplanet, explorable.** A live, real-data console for the 6,366 worlds humanity has confirmed beyond the Solar System — mapped in true 3D, rendered procedurally, and scored with published astrophysics.

A complete rebuild of an earlier single-file prototype, with the science, the rendering, and the data pipeline all replaced.

---

## What it does

| View | What you get |
| --- | --- |
| **Galaxy Map** | All 6,366 planets placed in real galactic coordinates, orbitable in 3D, recolourable by type / temperature / method / era / habitability, with a discovery-year time machine that replays the history of the field from 1992 to today. |
| **Atlas** | The browsable catalogue — filter by type, discovery method, distance, habitable zone, rocky size. |
| **Analytics** | Discovery timeline stacked by method, mass–radius diagram with the Chen & Kipping relation overlaid, orbit-vs-temperature, host-star diagram, method breakdown. Brush-drag any chart to zoom. |
| **Habitable Worlds** | The Goldilocks List — a ranked shortlist with a fully explained score. |
| **Archive** | The sortable raw table with per-row derived values, exportable to CSV. |

Click any world for a **dossier**: a to-scale 3D system view with the real habitable zone drawn as geometry, a physical profile, an Earth-similarity breakdown, a size comparison, and honest interstellar travel times.

---

## What makes it more than a catalogue

### The data pipeline is built to survive

The NASA Exoplanet Archive TAP endpoint **sends no Access-Control-Allow-Origin header**, so a browser cannot call it directly. That single fact is why static clones of this app end up depending on public CORS proxies that rate-limit and die.

This project solves it properly, with three fallbacks:

1. **\`/api/planets\`** — a Vercel serverless function that proxies the archive, validates the response, and caches it at the CDN edge for 6 hours (with stale-while-revalidate). The client can only *narrow* the column list; it can never inject ADQL.
2. **\`/snapshot.json\`** — a build-time snapshot of 6,366 real planets committed to the repo, so the site stays fully functional even if the archive is down.
3. **\`localStorage\`** — the last successful payload, so repeat visits are instant and offline works.

The UI always states which source it is showing.

### The science is real, and labelled as such

No invented heuristics. Every derived number cites its source:

- **Habitable zones** — Kopparapu et al. (2014) piecewise polynomial fits in stellar effective temperature, with the Seager et al. (2013) closed form as a fallback. Both the conservative (runaway greenhouse → maximum greenhouse) and optimistic (recent Venus → early Mars) boundaries are computed; the conservative zone decides membership, the optimistic zone softens the verdict.
- **Stellar luminosity** — catalogued value, else Stefan–Boltzmann from radius and temperature, else a main-sequence mass–luminosity relation. Flagged *est* when inferred.
- **Earth Similarity Index** — Schulze-Makuch et al. (2011), as a weighted geometric mean over whichever of radius / density / escape velocity / temperature can actually be computed.
- **Missing masses** — Chen & Kipping (2017) forecaster mass–radius relation, used *only* where a value is genuinely absent, and always rendered differently from measured data.
- **Habitability index** — a transparent weighted composite (Earth similarity 34%, habitable zone 26%, temperature 18%, rocky 12%, host-star stability 10%), displayed with its full breakdown rather than as a bare number.

### The rendering is generated, not downloaded

Every world is built from its own physics: palette from equilibrium temperature and class, terrain from seeded fractal noise, independently rotating cloud decks, molten emissive cracks, ring systems, and a stellar photosphere with granulation. The same seed always produces the same planet, so a world looks identical on every visit.

The Solar System is included as first-class data in the same shape as the exoplanet feed, so it flows through the same filters, charts and renderer.

---

## Stack

- **Vite** + **TypeScript** (strict), no framework — the DOM is built directly, keeping the app bundle at ~44 KB gzipped plus Three.js.
- **Three.js** for the 3D map and system views, with a hand-written additive point shader for the 6,366-world cloud and adaptive bloom that disables itself if frame time slips.
- **Canvas + SVG** for the charts — thousands of marks on a DPR-aware canvas, crisp axes in SVG. No charting library.
- **Vercel** serverless function for the archive proxy.

---

## Running it

    npm install
    npm run dev        # http://127.0.0.1:5173

    npm run build      # typecheck + production bundle to dist/
    npm run preview    # serve the built bundle

\`npm run dev\` runs Vite alone, so \`/api/planets\` does not exist and the app falls back to the bundled snapshot — the "Reduced mode" notice in that case is expected. To exercise the real pipeline locally, use \`vercel dev\` instead.

Refresh the committed snapshot from the live archive:

    npm run fetch:snapshot

Browser smoke test, with a dev server running on port 5173:

    node scripts/verify/smoke.mjs

---

## Deploying

The repo is Vercel-ready. Import it, or:

    vercel --prod

\`vercel.json\` sets the Vite framework preset, long-lived caching for hashed assets, a SPA rewrite, and security headers. \`api/planets.js\` is picked up automatically as a serverless function.

---

## Project layout

    api/planets.js              NASA TAP proxy: allow-list, retries, edge cache
    scripts/build-fallback.mjs  Builds public/snapshot.json from the live archive
    scripts/verify/smoke.mjs    Playwright smoke test across all five views
    src/lib/astronomy.ts        Habitable zones, ESI, mass-radius, classification
    src/lib/client.ts           Three-tier data loader
    src/render/galaxy.ts        3D map of every confirmed planet
    src/render/system.ts        To-scale system view with the real habitable zone
    src/render/planetTextures.ts Procedural surfaces, clouds, emissive maps
    src/render/charts.ts        Canvas + SVG analytics
    src/render/structure.ts     Schematic Milky Way and distance rings
    src/ui/detail.ts            The planet dossier
    src/main.ts                 Application controller

### A note on the schematic galaxy

The spiral backdrop in the map is **not data**. The archive provides position, not an image, so the Milky Way is drawn from a standard four-arm logarithmic model purely as a navigation aid, at low opacity. Real confirmed planets are drawn on top at full brightness.

---

## Accessibility and performance

- Full keyboard navigation, including arrow keys across the tab bar and \`Escape\` to close a dossier. Press \`/\` to jump to search.
- \`prefers-reduced-motion\` is respected — the starfield stops drifting and orbit animation halts.
- The 3D scenes pause when the tab is hidden, and drop post-processing if they cannot hold roughly 45 fps.
- Colour is never the only signal: planet class, habitable-zone status and detection confidence all carry text labels.

## Data credit

Planet data from the [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), operated by Caltech under contract with NASA. This project is not affiliated with or endorsed by NASA.

## License

MIT
