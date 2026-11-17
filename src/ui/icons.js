// Stroke icon set for the UI (24×24 grid, 1.6 px strokes, currentColor). OWNER: ui agent.
// Drawn for this project: plain geometric glyphs so they sit quietly on the glass panels.

const P = {
  search: '<circle cx="11" cy="11" r="6.25"/><path d="M15.8 15.8l4.4 4.4"/>',
  bookmark: '<path d="M7.2 4.5h9.6c.4 0 .7.3.7.7v14.6l-5.5-3.7-5.5 3.7V5.2c0-.4.3-.7.7-.7z"/>',
  layers: '<path d="M12 4.2l8.3 4.3L12 12.8 3.7 8.5z"/><path d="M3.7 12.4L12 16.7l8.3-4.3"/><path d="M3.7 16.2L12 20.5l8.3-4.3"/>',
  sliders: '<path d="M4 7.5h9M17.8 7.5H20M4 16.5h2.2M10.8 16.5H20"/><circle cx="15.4" cy="7.5" r="2.3"/><circle cx="8.5" cy="16.5" r="2.3"/>',
  help: '<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.5a2.4 2.4 0 0 1 4.7.7c0 1.7-2.4 2.1-2.4 3.7"/><path d="M12 16.9v.2"/>',
  camera: '<path d="M4.2 8.7c0-.8.7-1.5 1.5-1.5h2.1l1.5-2.1h5.4l1.5 2.1h2.1c.8 0 1.5.7 1.5 1.5v8.8c0 .8-.7 1.5-1.5 1.5H5.7c-.8 0-1.5-.7-1.5-1.5z"/><circle cx="12" cy="12.9" r="3.3"/>',
  frame: '<path d="M4.2 9V5.7c0-.8.7-1.5 1.5-1.5H9M15 4.2h3.3c.8 0 1.5.7 1.5 1.5V9M19.8 15v3.3c0 .8-.7 1.5-1.5 1.5H15M9 19.8H5.7c-.8 0-1.5-.7-1.5-1.5V15"/>',
  close: '<path d="M6.8 6.8l10.4 10.4M17.2 6.8L6.8 17.2"/>',
  play: '<path d="M8.4 5.6v12.8c0 .4.4.6.7.4l10-6.4c.3-.2.3-.6 0-.8l-10-6.4c-.3-.2-.7 0-.7.4z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5.4" width="3.4" height="13.2" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.4" width="3.4" height="13.2" rx="1" fill="currentColor" stroke="none"/>',
  back: '<path d="M9.2 14.2L4.6 9.6 9.2 5"/><path d="M4.6 9.6h10.2a4.5 4.5 0 0 1 0 9h-2.9"/>',
  copy: '<rect x="8.6" y="8.6" width="10.8" height="10.8" rx="2"/><path d="M15.4 8.6V6.2c0-.9-.7-1.6-1.6-1.6H6.2c-.9 0-1.6.7-1.6 1.6v7.6c0 .9.7 1.6 1.6 1.6h2.4"/>',
  pin: '<path d="M12 20.8s-6.3-5.5-6.3-10.6a6.3 6.3 0 0 1 12.6 0c0 5.1-6.3 10.6-6.3 10.6z"/><circle cx="12" cy="10.1" r="2.2"/>',
  globe: '<circle cx="12" cy="12" r="5.2"/><ellipse cx="12" cy="12" rx="9.6" ry="3.4" transform="rotate(-22 12 12)"/>',
  plus: '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
  trash: '<path d="M5 7.2h14M10 7.2V5.1h4v2.1M7 7.2l.8 12.2h8.4L17 7.2"/>',
  edit: '<path d="M4.8 19.2l.9-3.8L15.6 5.5a1.9 1.9 0 0 1 2.9 2.9l-9.9 9.9z"/><path d="M13.9 7.2l2.9 2.9"/>',
  download: '<path d="M12 4.6v10.6M7.6 11l4.4 4.4 4.4-4.4M5 19.4h14"/>',
  upload: '<path d="M12 15.4V4.8M7.6 9.2L12 4.8l4.4 4.4M5 19.4h14"/>',
  chevron: '<path d="M7.2 10l4.8 4.8 4.8-4.8"/>',
  activity: '<path d="M3.6 12h3.8l2.4-5.6 4.2 11.2 2.4-5.6h4"/>',
  menu: '<path d="M4.6 7.2h14.8M4.6 12h14.8M4.6 16.8h14.8"/>',
  building: '<path d="M5.2 19.8V6.6L12 4.2v15.6M12 9.2h6.8v10.6M3.6 19.8h16.8"/><path d="M8.2 9.4v.2M8.2 12.8v.2M8.2 16.2v.2M15.4 12.8v.2M15.4 16.2v.2"/>',
  enter: '<path d="M13.6 4.6h4.4c.4 0 .8.4.8.8v13.2c0 .4-.4.8-.8.8h-4.4"/><path d="M4.6 12h9.2M10.4 8.4L14 12l-3.6 3.6"/>',
  orbit: '<path d="M18.9 13.4a7 7 0 1 1-1.9-6.3"/><path d="M18.6 4.6v3.6H15"/><rect x="10" y="10" width="4" height="4" rx=".6"/>',
  check: '<path d="M5.6 12.6l4 4 8.8-9"/>',
  target: '<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3"/>',
  region: '<path d="M3.4 18.6l5.9-8.8 3.9 5.4 2.6-3.1 4.8 6.5z"/><circle cx="16.4" cy="6.6" r="1.6"/>',
  list: '<path d="M9.2 7h10.4M9.2 12h10.4M9.2 17h10.4"/><path d="M4.8 7h.4M4.8 12h.4M4.8 17h.4"/>',
  more: '<circle cx="6.4" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="17.6" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.2 4.6v3.8h-3.8"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.2v1.9M12 18.9v1.9M3.2 12h1.9M18.9 12h1.9M5.8 5.8l1.3 1.3M16.9 16.9l1.3 1.3M5.8 18.2l1.3-1.3M16.9 7.1l1.3-1.3"/>',
  moon: '<path d="M18.6 14.6A7.3 7.3 0 0 1 9.4 5.4a7.3 7.3 0 1 0 9.2 9.2z"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1"/>',
};

const NS = 'http://www.w3.org/2000/svg';

/** Returns a fresh <svg> element for the named icon. */
export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('mui-ico');
  svg.innerHTML = P[name] || P.more;
  return svg;
}

export const ICON_NAMES = Object.keys(P);
