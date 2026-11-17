// Window units for wall openings (walls.js). Work in the WALL FRAME: x = u along the wall,
// y = up, z = outward (outer face z = 0). Each unit fills an opening [u0,u1]×[v0,v1] whose
// reveal ends at depth R (frame plane): aluminium frame with crisp chamfers, mullions /
// transoms, sashes, recessed glass with interior-mapping attributes (materials.js), exterior
// sill with drip projection, optional blind box / half-lowered blind / louvres / Juliet rail.
//
// Interior mapping: pass `room` so the fake room behind the glass has the size and kind of the
// real room from the plan, and night lights follow occupancy (floor, bay, building hash):
//   room = { u0, w, d, h, sill, kind, seed, floor, bay, hash }
//     u0   distance from the room's left wall (seen from outside) to the opening's left edge
//     w,d,h room width (along facade), depth, floor-to-ceiling height
//     sill height of the opening bottom above the room floor
//     kind ROOM_KIND code (see below), seed 0..1, floor/bay ints, hash uint32 building hash,
//     profile occupancy profile (spec._profile: 0 residential, 1 office, 2 public, 3 industrial, 4 care)

/** Room kinds understood by the window glass shader (materials.js). */
export const ROOM_KIND = { living: 0, bedroom: 1, kitchen: 2, bath: 3, stair: 4, lobby: 5, shop: 6, office: 7, corridor: 8, storage: 9, plant: 10, classroom: 11, clinic: 12, hall: 13 };

/** Set the glass extra attributes for the following panes. */
export function setGlassRoom(b, room, paneU0, paneV0) {
  if (!room) { b.setExtra('iwin0', paneU0 + 0.6, 4, 5, 2.8); b.setExtra('iwin1', paneV0 + 0.9, 0.5, 0, 0); b.setExtra('iwin2', 0, 0, ROOM_KIND.office, 0); return; }
  const h = room.hash >>> 0;
  b.setExtra('iwin0', room.u0 + paneU0, room.w, room.d, room.h);
  b.setExtra('iwin1', room.sill + paneV0, room.seed ?? 0.5, room.floor ?? 0, room.bay ?? 0);
  b.setExtra('iwin2', (h >>> 16) & 0xffff, h & 0xffff, room.kind ?? 0, room.profile ?? 0);
}

/** Emit one glass pane quad at depth z (explicit uv in metres from pane corner). */
export function glassPane(b, key, u0, v0, u1, v1, z, room, opening) {
  const pu0 = opening ? u0 - opening.u0 : 0, pv0 = opening ? v0 - opening.v0 : 0;
  setGlassRoom(b, room, pu0, pv0);
  const w = u1 - u0, h = v1 - v0;
  b.quad(key, u0, v0, z, u1, v0, z, u1, v1, z, u0, v1, z, [0, 0, w, 0, w, h, 0, h]);
}

/**
 * A complete window in an opening.
 * @param {MeshBuilder} b
 * @param {object} o
 * @param {number} o.u0 @param {number} o.u1 @param {number} o.v0 @param {number} o.v1  opening
 * @param {number} [o.R=0.2]          frame plane depth behind the outer face
 * @param {string} [o.type='casement'] 'casement'|'tall'|'slider'|'small'|'fixed'|'strip'|'shop'
 * @param {number|number[]} [o.cols]   column count or explicit fractions summing to 1
 * @param {number[]} [o.transoms]      transom heights above v0 (bar centres)
 * @param {string} [o.frameKey='aluminium']  @param {string} [o.glassKey='glass_window']
 * @param {string|null} [o.sillKey='aluminium']  exterior sill (null = none)
 * @param {boolean} [o.sash=true]      draw opening sashes
 * @param {boolean} [o.blind=false]    roller-blind box in the head (+ blindDrop 0..1 lowered)
 * @param {number} [o.blindDrop=0]
 * @param {boolean} [o.louvres=false]  fixed horizontal louvres in front of the glass
 * @param {boolean} [o.juliet=false]   glass Juliet balustrade across the lower part
 * @param {object} [o.room]            interior mapping room (see file header)
 * @param {boolean} [o.inner=false]    'full' LOD: interior sill + back faces
 * @param {number} [o.T=0.3]           wall thickness (for the interior sill)
 * @param {number} [o.fw=0.06] frame face width  @param {number} [o.fd=0.08] frame depth
 * @param {number} [o.open=0]         'slider': 0..1 last panel slid open (walkable 'full' LOD openings)
 */
export function windowUnit(b, o) {
  const R = o.R ?? 0.2, fw = o.fw ?? 0.06, fd = o.fd ?? 0.08;
  const fk = o.frameKey || 'aluminium', gk = o.glassKey || 'glass_window';
  const type = o.type || 'casement';
  let { u0, u1, v0, v1 } = o;
  const W = u1 - u0;
  const zf = -R, zb = -R - fd, zg = -R - fd * 0.55;
  // --- exterior sill ---
  const sillK = o.sillKey === undefined ? 'aluminium' : o.sillKey;
  let vb = v0; // bottom of frame
  if (sillK && type !== 'slider' && type !== 'shop') {
    sill(b, sillK, u0, u1, v0, R);
    vb = v0 + 0.012;
  }
  // --- blind box ---
  let vt = v1;
  if (o.blind) {
    const bh = Math.min(0.2, (v1 - v0) * 0.12);
    b.cbox(fk, u0 - 0.002, v1 - bh, -R - 0.005, u1 + 0.002, v1 + 0.001, -0.04, 0.008);
    vt = v1 - bh;
    if (o.blindDrop > 0.02) {
      const drop = (vt - vb - 0.1) * Math.min(o.blindDrop, 0.95);
      // lowered blind curtain (aluminium slats) just inside the box face
      b.box('blind', u0 + 0.01, vt - drop, -R + 0.01, u1 - 0.01, vt, -R + 0.03, 1 | 2 | 16 | 8);
      b.box(fk, u0 + 0.005, vt - drop - 0.035, -R + 0.005, u1 - 0.005, vt - drop, -R + 0.04, 63);
    }
  }
  // --- outer frame ---
  frameRect(b, fk, u0, vb, u1, vt, zf, zb, fw, o.inner);
  // --- columns / rows ---
  const ci0 = u0 + fw, ci1 = u1 - fw, ri0 = vb + fw, ri1 = vt - fw;
  let fr;
  if (Array.isArray(o.cols)) fr = o.cols;
  else {
    let n = o.cols ?? (type === 'small' ? 1 : type === 'slider' ? (W > 3.2 ? 4 : W > 2.2 ? 3 : 2) : type === 'tall' || type === 'strip' || type === 'shop' ? Math.max(1, Math.round(W / (type === 'shop' ? 1.6 : 1.1))) : W > 2.1 ? 3 : W > 1.25 ? 2 : 1);
    if (type === 'casement' && n === 3) fr = [0.3, 0.4, 0.3];
    else fr = new Array(n).fill(1 / n);
  }
  const cu = [ci0]; let acc = 0;
  for (let i = 0; i < fr.length; i++) { acc += fr[i]; cu.push(ci0 + (ci1 - ci0) * acc); }
  cu[cu.length - 1] = ci1;
  let tr = o.transoms;
  if (!tr) {
    const H = vt - vb;
    if (type === 'tall' && H > 2.45) tr = [2.15];
    else if (type === 'casement' && H > 1.75) tr = [H - 0.45];
    else if (type === 'shop' && H > 3.0) tr = [Math.min(2.7, H - 0.5)];
    else tr = [];
  }
  const rv = [ri0];
  for (const t of tr) { const v = vb + t; if (v > ri0 + 0.25 && v < ri1 - 0.2) rv.push(v); }
  rv.push(ri1);
  const mw = type === 'shop' || type === 'strip' ? 0.07 : 0.055;
  if (type === 'slider') { sliderPanels(b, o, fk, gk, cu, ri0, ri1, zf, zb, fw); }
  else {
    // mullions
    for (let i = 1; i < cu.length - 1; i++) bar(b, fk, cu[i] - mw / 2, ri0, zb + 0.006, cu[i] + mw / 2, ri1, zf - 0.004, 'y', 0.005, o.inner);
    // transoms (between mullions to avoid overlap)
    for (let j = 1; j < rv.length - 1; j++) for (let i = 0; i < cu.length - 1; i++) {
      const a = i === 0 ? ci0 : cu[i] + mw / 2, c = i === cu.length - 2 ? ci1 : cu[i + 1] - mw / 2;
      bar(b, fk, a, rv[j] - mw / 2, zb + 0.006, c, rv[j] + mw / 2, zf - 0.004, 'x', 0.005, o.inner);
    }
    // panes
    for (let j = 0; j < rv.length - 1; j++) for (let i = 0; i < cu.length - 1; i++) {
      const a = i === 0 ? ci0 : cu[i] + mw / 2, c = i === cu.length - 2 ? ci1 : cu[i + 1] - mw / 2;
      const lo = j === 0 ? ri0 : rv[j] + mw / 2, hi = j === rv.length - 2 ? ri1 : rv[j + 1] - mw / 2;
      if (c - a < 0.05 || hi - lo < 0.05) continue;
      const operable = o.sash !== false && j === 0 && ((type === 'casement' && (fr.length === 1 || i === fr.length - 1 || (fr.length === 3 && i !== 1))) || type === 'small');
      if (operable) {
        const sw = 0.045;
        frameRect(b, fk, a, lo, c, hi, zf - 0.012, zf - 0.05, sw, o.inner, 0.004);
        glassPane(b, gk, a + sw, lo + sw, c - sw, hi - sw, zg + 0.012, o.room, o);
      } else glassPane(b, gk, a, lo, c, hi, zg, o.room, o);
    }
  }
  // --- louvres ---
  if (o.louvres) {
    const n = Math.max(3, Math.floor((vt - vb) / 0.14));
    for (let k = 0; k < n; k++) {
      const y = vb + 0.08 + ((vt - vb - 0.16) * (k + 0.5)) / n;
      b.push(); b.translate(0, y, -0.07); b.rotX(-0.45);
      b.box(o.louvreKey || fk, u0 + 0.004, -0.006, -0.05, u1 - 0.004, 0.006, 0.05, 1 | 2 | 4 | 8 | 16);
      b.pop();
    }
  }
  // --- Juliet balustrade (tall windows without balcony) ---
  if (o.juliet) {
    const top = v0 + 1.05;
    b.box('glass_railing', u0 + 0.02, v0 + 0.08, -0.07, u1 - 0.02, top - 0.04, -0.06, 16 | 32);
    b.cbox(o.railKey || 'steel_dark', u0 - 0.01, top - 0.045, -0.085, u1 + 0.01, top, -0.045, 0.006);
    for (const u of [u0 + 0.04, u1 - 0.04]) b.box(o.railKey || 'steel_dark', u - 0.015, v0 + 0.06, -0.09, u + 0.015, top - 0.04, -0.06, 63);
  }
  // --- interior sill ('full') ---
  if (o.inner && type !== 'slider' && type !== 'shop' && type !== 'strip') {
    const T = o.T ?? 0.3;
    b.cbox(o.innerSillKey || 'stone_sill', u0 - 0.03, v0 - 0.02, -T - 0.035, u1 + 0.03, v0 + 0.012, zb + 0.002, 0.006);
  }
  clearGlassRoom(b);
}

/** Reset the glass extra attributes (later frosted / skylight glass must not inherit a room). */
export function clearGlassRoom(b) { b.clearExtra('iwin0'); b.clearExtra('iwin1'); b.clearExtra('iwin2'); }

/**
 * Exterior sill board: falls outwards, drip nose projecting `proj` beyond the facade, ends
 * tucked 35 mm into the jambs. Direct emission (≈12 triangles).
 */
export function sill(b, key, u0, u1, v0, R, proj = 0.05) {
  const a = u0 - 0.035, c = u1 + 0.035;
  const zb = -R - 0.01, zf = proj + 0.008;
  const yBack = v0 + 0.016, yFront = v0 + 0.002, yNose = v0 - 0.032;
  // sloped top (back high → front low)
  b.quad(key, a, yFront, zf - 0.012, c, yFront, zf - 0.012, c, yBack, zb, a, yBack, zb);
  // rounded-ish nose: chamfer + front face
  b.quad(key, a, yFront - 0.006, zf, c, yFront - 0.006, zf, c, yFront, zf - 0.012, a, yFront, zf - 0.012);
  b.quad(key, a, yNose, zf, c, yNose, zf, c, yFront - 0.006, zf, a, yFront - 0.006, zf);
  // underside of the projecting part (drip)
  b.quad(key, a, yNose, 0.0, c, yNose, 0.0, c, yNose, zf, a, yNose, zf);
  // end caps of the projecting part
  b.quad(key, a, yNose, 0.0, a, yNose, zf, a, yFront, zf - 0.012, a, yBack - 0.008, 0.0);
  b.quad(key, c, yNose, zf, c, yNose, 0.0, c, yBack - 0.008, 0.0, c, yFront, zf - 0.012);
}

/**
 * Window-profile bar: box [x0,x1]×[y0,y1]×[z0,z1] running along `axis` ('x' or 'y') with the
 * front face at z1 and 45° chamfers c on the two front long edges (crisp highlights at ~10
 * triangles instead of 44). Ends are omitted (hidden by the neighbouring bars); the back face
 * only when `back` (interiors visible at 'full').
 */
export function bar(b, key, x0, y0, z0, x1, y1, z1, axis = 'y', c = 0.006, back = false) {
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
  if (axis === 'y') {
    c = Math.min(c, (x1 - x0) * 0.4, (z1 - z0) * 0.4);
    b.rectZ(key, x0 + c, y0, x1 - c, y1, z1, 1);
    b.quad(key, x0, y0, z1 - c, x0 + c, y0, z1, x0 + c, y1, z1, x0, y1, z1 - c);
    b.quad(key, x1 - c, y0, z1, x1, y0, z1 - c, x1, y1, z1 - c, x1 - c, y1, z1);
    b.rectX(key, z0, y0, z1 - c, y1, x0, -1);
    b.rectX(key, z0, y0, z1 - c, y1, x1, 1);
    if (back) b.rectZ(key, x0, y0, x1, y1, z0, -1);
  } else {
    c = Math.min(c, (y1 - y0) * 0.4, (z1 - z0) * 0.4);
    b.rectZ(key, x0, y0 + c, x1, y1 - c, z1, 1);
    b.quad(key, x0, y1 - c, z1, x1, y1 - c, z1, x1, y1, z1 - c, x0, y1, z1 - c);
    b.quad(key, x1, y0 + c, z1, x0, y0 + c, z1, x0, y0, z1 - c, x1, y0, z1 - c);
    b.rectY(key, x0, z0, x1, z1 - c, y1, 1);
    b.rectY(key, x0, z0, x1, z1 - c, y0, -1);
    if (back) b.rectZ(key, x0, y0, x1, y1, z0, -1);
  }
}

/** Rectangular frame of four bars between z0 (front, larger z) and z1 (back). */
export function frameRect(b, key, u0, v0, u1, v1, z0, z1, fw, inner = false, c = 0.006) {
  if (u1 - u0 < 2 * fw + 0.01 || v1 - v0 < 2 * fw + 0.01) { b.cbox(key, u0, v0, z1, u1, v1, z0, c); return; }
  bar(b, key, u0, v0, z1, u0 + fw, v1, z0, 'y', c, inner);
  bar(b, key, u1 - fw, v0, z1, u1, v1, z0, 'y', c, inner);
  bar(b, key, u0 + fw, v1 - fw, z1, u1 - fw, v1, z0, 'x', c, inner);
  bar(b, key, u0 + fw, v0, z1, u1 - fw, v0 + fw, z0, 'x', c, inner);
}

function sliderPanels(b, o, fk, gk, cu, lo, hi, zf, zb, fw) {
  // two tracks: even panels in front track, odd panels in back track, overlapping 4 cm.
  // o.open (0..1, 'full' LOD where the wall collider leaves the opening): the last panel slides
  // behind / in front of its neighbour on the other track, leaving a walkable gap
  const n = cu.length - 1;
  const zt = [zf - 0.008, zf - 0.046];
  for (let i = 0; i < n; i++) {
    let a = cu[i] - (i > 0 ? 0.02 : 0), c = cu[i + 1] + (i < n - 1 ? 0.02 : 0);
    if (o.open > 0 && n > 1 && i === n - 1) { const sh = (c - a - 0.1) * Math.min(1, o.open); a -= sh; c -= sh; }
    const z0 = zt[i % 2], z1 = z0 - 0.034;
    const sw = 0.055;
    frameRect(b, fk, a, lo, c, hi, z0, z1, sw, o.inner, 0.004);
    glassPane(b, gk, a + sw, lo + sw, c - sw, hi - sw, (z0 + z1) / 2, o.room, o);
    // pull handle on the meeting stile
    const hu = i % 2 === 0 ? c - sw * 0.5 : a + sw * 0.5;
    b.box('chrome', hu - 0.008, lo + 0.95, z0, hu + 0.008, lo + 1.25, z0 + 0.025, 63);
  }
  // threshold track
  b.cbox(fk, cu[0] - fw, o.v0 - 0.005, zb - 0.02, cu[n] + fw, lo + 0.002, zf + 0.01, 0.004);
}

/**
 * Shopfront: big glass panes with slim mullions, transom, solid stall riser, optional signage
 * band above (blank panel + light). Opening as for windowUnit. Returns the door slot [ud0,ud1]
 * when o.doorWidth given (caller puts a door unit there).
 */
export function shopfront(b, o) {
  const R = o.R ?? 0.12, fk = o.frameKey || 'aluminium_dark', gk = o.glassKey || 'glass_shop';
  const { u0, u1, v0, v1 } = o;
  const W = u1 - u0;
  const zf = -R, zb = -R - 0.1, zg = -R - 0.055;
  const riser = o.riser ?? 0.35;
  const transomV = o.transom ?? Math.min(v1 - 0.55, v0 + 2.75);
  let door = null;
  if (o.doorWidth) {
    const dw = o.doorWidth, du = o.doorAt ?? (u0 + W * 0.5 - dw / 2);
    door = [Math.max(u0 + 0.1, du), Math.min(u1 - 0.1, du + dw)];
  }
  // outer frame
  frameRect(b, fk, u0, v0, u1, v1, zf, zb, 0.07, o.inner);
  // stall riser panel (stone) under the glass, except at door
  const segs = door ? [[u0 + 0.07, door[0]], [door[1], u1 - 0.07]] : [[u0 + 0.07, u1 - 0.07]];
  for (const [a, c] of segs) if (c - a > 0.05) b.cbox(o.riserKey || 'stone_dark', a, v0, zb, c, v0 + riser, zf + 0.03, 0.01);
  // transom bar across
  bar(b, fk, u0 + 0.07, transomV - 0.04, zb + 0.005, u1 - 0.07, transomV + 0.04, zf - 0.003, 'x', 0.006, o.inner);
  // mullions + panes for each segment
  const room = o.room;
  for (const [a, c] of segs) {
    const L = c - a; if (L < 0.1) continue;
    const n = Math.max(1, Math.round(L / (o.paneWidth ?? 1.8)));
    for (let i = 0; i <= n; i++) {
      const u = a + (L * i) / n;
      if (i > 0 && i < n) bar(b, fk, u - 0.035, v0 + riser, zb + 0.005, u + 0.035, transomV - 0.04, zf - 0.003, 'y', 0.005, o.inner);
      if (i < n) {
        const p0 = u + (i === 0 ? 0 : 0.035), p1 = a + (L * (i + 1)) / n - (i === n - 1 ? 0 : 0.035);
        glassPane(b, gk, p0, v0 + riser, p1, transomV - 0.04, zg, room, o);
      }
    }
  }
  // transom lights above (full width)
  const m = Math.max(1, Math.round((W - 0.14) / 1.2));
  for (let i = 0; i < m; i++) {
    const p0 = u0 + 0.07 + ((W - 0.14) * i) / m + (i ? 0.02 : 0), p1 = u0 + 0.07 + ((W - 0.14) * (i + 1)) / m - (i < m - 1 ? 0.02 : 0);
    if (i > 0) b.box(fk, p0 - 0.04, transomV + 0.04, zb + 0.005, p0 - 0.0, v1 - 0.07, zf - 0.003, 63);
    glassPane(b, gk, p0, transomV + 0.04, p1, v1 - 0.07, zg, room, o);
  }
  clearGlassRoom(b);
  return door;
}

/**
 * Louvred vent / grille filling an opening (plant rooms, AC screens, stair-core vents).
 * Real slats (blades) at 45°, frame around.
 */
export function louvrePanel(b, o) {
  const R = o.R ?? 0.08, k = o.key || 'aluminium', { u0, u1, v0, v1 } = o;
  frameRect(b, k, u0, v0, u1, v1, -R + 0.02, -R - 0.06, 0.05, false);
  const pitch = o.pitch ?? 0.1;
  const n = Math.max(2, Math.floor((v1 - v0 - 0.1) / pitch));
  for (let i = 0; i < n; i++) {
    const y = v0 + 0.05 + ((v1 - v0 - 0.1) * (i + 0.5)) / n;
    b.push(); b.translate(0, y, -R - 0.02); b.rotX(-0.7);
    b.box(k, u0 + 0.05, -0.004, -0.045, u1 - 0.05, 0.004, 0.045, 1 | 2 | 4 | 8 | 16 | 32);
    b.pop();
  }
  if (o.backKey !== null) b.rectZ(o.backKey || 'grille_dark', u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, -R - 0.075, 1);
}
