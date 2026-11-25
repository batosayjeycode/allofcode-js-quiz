// Inline SVG icons (stroke = currentColor) — no icon font dependency.
const svg = (body, size = 16) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  play: (s) => svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>', s),
  check: (s) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  cross: (s) => svg('<path d="M18 6 6 18M6 6l12 12"/>', s),
  alert: (s) => svg('<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  left: (s) => svg('<path d="m15 18-6-6 6-6"/>', s),
  right: (s) => svg('<path d="m9 18 6-6-6-6"/>', s),
  restart: (s) => svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', s),
  flag: (s) => svg('<path d="M4 22V4m0 0h13l-2 4 2 4H4"/>', s),
  lock: (s) => svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', s),
  terminal: (s) => svg('<path d="m4 17 6-5-6-5m8 12h8"/>', s),
  book: (s) => svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>', s),
  spinner: (s) => svg('<path d="M21 12a9 9 0 1 1-6.2-8.6"/>', s).replace('class="icon"', 'class="icon spin"'),
};
