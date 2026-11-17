// Rainwater: downpipes with brackets and shoes, rainwater heads, scuppers, eaves gutters,
// roof drains. Downpipes run in the WALL FRAME (x along facade, z outward) unless noted.

/**
 * Downpipe on a facade (wall frame) at u from yTop down to yBottom (ground), standing off the
 * wall by `off`. Brackets every ~2 m, rainwater head at the top, shoe kicking out at the foot.
 */
export function downpipe(b, u, yTop, yBottom, o = {}) {
  const r = o.r ?? 0.055, off = o.off ?? 0.09, key = o.key || 'aluminium_dark';
  const z = off + r;
  // pipe
  b.cylinder(key, u, yBottom + 0.28, z, r, yTop - yBottom - 0.28 - 0.25, 12, { top: false });
  // shoe (bend outwards)
  b.tube(key, [[u, yBottom + 0.32, z], [u, yBottom + 0.16, z], [u, yBottom + 0.07, z + 0.1], [u, yBottom + 0.04, z + 0.2]], r, 12);
  // brackets
  for (let y = yBottom + 1.2; y < yTop - 0.5; y += 2.2) {
    b.box(key, u - r - 0.012, y, z - r - 0.012, u + r + 0.012, y + 0.04, z + r + 0.012, 63);
    b.box(key, u - 0.015, y, 0, u + 0.015, y + 0.04, z - r, 63);
  }
  // rainwater head (hopper)
  if (o.head !== false) {
    const hy = yTop - 0.25;
    b.cbox(key, u - 0.16, hy, 0.0, u + 0.16, hy + 0.3, 0.3, 0.01);
    b.tube(key, [[u, hy + 0.02, z], [u, hy - 0.06, z]], r * 1.15, 12);
  }
}

/** Scupper through a parapet (wall frame): outlet spout at height y. */
export function scupper(b, u, y, o = {}) {
  const key = o.key || 'aluminium_dark';
  b.box(key, u - 0.09, y - 0.06, -0.05, u + 0.09, y + 0.06, 0.16, 63 & ~32);
  b.rectZ('grille_dark', u - 0.07, y - 0.045, u + 0.07, y + 0.045, 0.1605, 1);
}

/** Eaves gutter along a path (current frame), half-round section opening up. */
export function gutter(b, path, o = {}) {
  const key = o.key || 'aluminium_dark', r = o.r ?? 0.075;
  // half-round outer profile (s,y) CCW: from inner top edge around the bottom to the outer lip
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI + (Math.PI * i) / 8; prof.push([Math.cos(a) * r, Math.sin(a) * r]); }
  prof.push([r + 0.012, 0.0]); prof.push([r + 0.012, 0.012]); prof.push([r - 0.006, 0.012]);
  for (let i = 8; i >= 0; i--) { const a = Math.PI + (Math.PI * i) / 8; prof.push([Math.cos(a) * (r - 0.006), Math.sin(a) * (r - 0.006)]); }
  b.sweep(key, path, prof, { smoothAngle: 40 });
}

/** Roof drain (current frame) at (x, y, z): ring + dome grate. */
export function roofDrain(b, x, y, z, o = {}) {
  b.lathe(o.key || 'steel_dark', [[0.16, 0], [0.16, 0.025], [0.1, 0.03], [0.09, 0.07], [0.05, 0.1], [0.0, 0.11]], 14, { x, y, z });
}
