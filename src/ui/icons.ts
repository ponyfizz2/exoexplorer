/** Inline SVG icon set — no icon font, no network request, full styling control. */

const wrap = (path: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;

/** Icons — all 24x24, stroked, no external font. */
export const ICONS = {
  search: wrap('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  orbit: wrap('<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.5"/><circle cx="21.5" cy="12" r="1.4" fill="currentColor"/>'),
  grid: wrap('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
  chart: wrap('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  trophy: wrap('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 5"/><path d="M17 6h2.5a2.5 2.5 0 0 1-2.5 5"/><path d="M9 20h6"/><path d="M12 14v6"/>'),
  table: wrap('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11"/>'),
  scale: wrap('<path d="M12 3v18"/><path d="M5 7h14"/><path d="M8 7 4 15h8z"/><path d="M16 7l-4 8h8z"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: wrap('<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>'),
  target: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  rocket: wrap('<path d="M5 15c-1 1-1.5 3.5-1.5 5.5 2 0 4.5-.5 5.5-1.5"/><path d="M9 19c-1.5-1.5-4-4-4-7 0-5 5-9.5 13-9.5 0 8-4.5 13-9.5 13-3 0-5.5-2.5-7-4z"/><circle cx="14.5" cy="9.5" r="1.6"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>'),
  globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>'),
  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>'),
  warning: wrap('<path d="M12 3.5 21.5 20H2.5z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>'),
  star: wrap('<path d="m12 3.5 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 17.3 6.7 20.2l1.1-6.1L3.4 9.9l6-.8z"/>'),
  thermometer: wrap('<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4.5 4.5 0 1 1-4 0z"/>'),
  layers: wrap('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  expand: wrap('<path d="M9 3H4v5M15 3h5v5M9 21H4v-5M15 21h5v-5"/>'),
  reset: wrap('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4.5V10h5.5"/>'),
  filter: wrap('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
};

export type IconName = keyof typeof ICONS;
