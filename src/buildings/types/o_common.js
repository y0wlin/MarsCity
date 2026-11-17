// O-zone (富氧改造区) building family — shared helpers. OWNER: buildings-o.
// Not a type module (no default export with `uses`), imported by pumphouse / sluice_station / greenhouse /
// dorm / control_tower / maintenance / cold_storage / farm_station / water_treatment / service_depot /
// insulated_station / meltwater_pump.
//
// Everything is deterministic from spec.hash (ctx.sub(channel)), worker-safe, emits into ctx.b in the
// caller's current frame unless a function says otherwise. Units: metres. Vocabulary: kit materials.js.
//
//   oEnv(ctx)                 climate / province variant: polar | dry | wet, lee & windward sides, shell keys
//   yellowRail(b, pts, o)     safety railing (posts, top + knee rail, toe board) along a deck polyline
//   grating(b, x0,z0,x1,z1,y) grated walkway / platform deck with steel edge frame (+ collider)
//   steelStair(b, o)          straight steel stair (stringers, grating treads, yellow rails, ramp collider)
//   cagedLadder(b, x,y0,z,h,rot) fixed ladder with safety hoops
//   pipeRun(b, pts, r, o)     pipe with flanges + supports (heat-traced / insulated variant)
//   lampPost(b, x,y,z,h,rot)  pole + arm + luminaire (light_warm, night gated)
//   rollerDoor(b, o)          roller shutter in a wall opening (wall frame)
//   drift(ctx, side, w, d, o) lee-side dust drift / snow tongue strip along a facade (building frame)
//   roomMap(ctx, ...)         interior-mapping descriptor for window glass (same bay ids as the far facade)
//   facadeWall(ctx, ...)      wall with openings + units on one side of a rect (wall frame handled here)
//   flatRoof / vaultRoof      roofs for utility boxes / insulated halls
//   boxTrims(...)             grey top fascia, corner trims, base kick band (O02 utility box language)
//   equipmentBox / hvac       ground / roof equipment cabinets

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL } from '../kit/MeshBuilder.js';
import { sideGround } from '../kit/plinth.js';
import { hash4 } from '../../core/hash.js';

export { PX, NX, PY, NY, PZ, NZ, ALL };
export const SIDES = ['front', 'right', 'back', 'left'];
export const OPP = { front: 'back', back: 'front', left: 'right', right: 'left' };
export const isFB = (s) => s === 'front' || s === 'back';
export const BAY_W = 3.6;   // far-facade bay width used by every O massing volume (window light ids)

// prevailing wind (compass bearing the wind blows FROM) per province: canal plains get westerlies,
// OX4 katabatic flow off the northern ice cap, OX6 off the south pole (§2 / §3 冰缘, 积尘服从背风面)
const WIND_FROM = { OX1: 285, OX2: 250, OX3: 300, OX4: 15, OX5: 235, OX6: 175 };
const PROV_CODES = ['', 'OX1', 'OX2', 'OX3', 'OX4', 'OX5', 'OX6', 'ZR1', 'ZR2', 'ZR3', 'ZR4', 'ZR5', 'ZR6'];

/** Province code of a spec ('OX1'..'ZR6'). */
export function provOf(s) {
  if (typeof s.provinceCode === 'string' && s.provinceCode) return s.provinceCode;
  if (typeof s.province === 'string') return s.province;
  return PROV_CODES[s.province | 0] || (s.zone === 'O' ? 'OX1' : 'ZR1');
}

/** Facade side whose outward normal is closest to a compass bearing. */
export function sideFacing(s, bearing) {
  let best = 'front', bd = 1e9;
  for (const side of SIDES) {
    const d = Math.abs(((K.sideBearing(s, side) - bearing + 540) % 360) - 180);
    if (d < bd) { bd = d; best = side; }
  }
  return best;
}

/**
 * Climate / province variant and shared keys.
 * polar: OX4 / OX6 / O-polar style / meta.polar → frost-white insulated shells, recessed doors, snow lee drifts
 * dry:   OX2 / OX5 tablelands → red dust on lee sides
 * wet:   OX1 / OX3 canal and levee plains → algae / darker wet bases near water
 */
export function oEnv(ctx) {
  const s = ctx.spec, m = s._meta || {};
  const prov = provOf(s);
  const style = String(s.style || '').toLowerCase();
  const polar = !!(m.polar || /polar|cold|frost/.test(style) || prov === 'OX4' || prov === 'OX6' || Math.abs(s._lat) > 62);
  const dry = !polar && (prov === 'OX2' || prov === 'OX5' || (s.zone !== 'O' && Math.abs(s._lat) < 40 && prov !== 'ZR4' && prov !== 'ZR1'));
  const wet = !polar && !dry;
  const r = ctx.sub(9001);
  const windFrom = ((WIND_FROM[prov] ?? 270) + (r.next() - 0.5) * 40 + 360) % 360;
  const windward = sideFacing(s, windFrom);
  const lee = m.leeSide && SIDES.includes(m.leeSide) ? m.leeSide : OPP[windward];
  const age = ctx.inst ? ctx.inst.age : 0.3;
  const grime = 0.9 + 0.1 * (1 - age);
  // levelled pad (urban meta.pad on steep banks): the floor sits on the pad level (relative to the entrance)
  const padY = m.pad && Number.isFinite(+m.pad.level) && m.pad.level !== null && s.ground && Number.isFinite(+s.ground.entrance) ? +m.pad.level - +s.ground.entrance : null;
  const ffl0 = polar ? 0.45 : 0.25;
  return {
    prov, polar, dry, wet, windFrom, windward: m.leeSide ? OPP[lee] : windward, lee,
    shell: polar ? 'panel_insulated' : 'panel_white',
    trim: 'panel_grey', base: 'concrete', rail: 'steel_yellow',
    wallT: polar ? 0.46 : 0.32, reveal: polar ? 0.3 : 0.2,
    ffl: padY !== null ? Math.max(ffl0, Math.min(padY + 0.15, ffl0 + 4)) : ffl0, pad: padY !== null,
    shellTint: polar ? [0.99 * grime, 1.0 * grime, 1.02 * grime] : [0.97 * grime, 0.965 * grime, 0.95 * grime],
    trimTint: [0.92, 0.93, 0.95],
    roofKey: polar ? 'roof_metal' : 'roof_gravel',
    dustTint: [3.1, 1.75, 1.05],        // soil × tint = Martian red dust (linear)
    snowTint: [1.0, 1.02, 1.06],
    algaeTint: [0.62, 0.72, 0.55],
    glass: ctx.full ? 'glass_clear' : 'glass_window',
  };
}

// ---------------------------------------------------------------------------------------------
// railings, decks, stairs, ladders
// ---------------------------------------------------------------------------------------------
/**
 * Yellow safety railing along a polyline of deck points [[x,y,z],...] (current frame): posts every
 * ≤1.5 m, top rail 1.1 m, knee rail 0.55 m, toe board. o: {key, h=1.1, closed, toe=true, posts=1.5, collide=true}
 */
export function yellowRail(b, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const key = o.key || 'steel_yellow', H = o.h ?? 1.1, sp = o.posts ?? 1.5;
  const path = o.closed ? [...pts, pts[0]] : pts;
  const top = path.map((p) => [p[0], p[1] + H, p[2]]);
  const knee = path.map((p) => [p[0], p[1] + H * 0.5, p[2]]);
  b.tube(key, top, 0.024, 8, { transport: true });
  b.tube(key, knee, 0.017, 6, { transport: true });
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i], q = path[i + 1];
    const L = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / sp));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < path.length - 2) continue;
      const t = k / n, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
      b.box(key, x - 0.022, y, z - 0.022, x + 0.022, y + H, z + 0.022, PX | NX | PZ | NZ);
    }
    if (o.toe !== false && Math.abs(q[1] - p[1]) < 0.05) {
      // toe board: thin plate standing on the deck edge
      const dx = (q[0] - p[0]) / L, dz = (q[2] - p[2]) / L;
      b.push(); b.translate(p[0], p[1], p[2]); b.rotY(-Math.atan2(dz, dx));
      b.box(key, 0, 0, -0.006, L, 0.1, 0.006, PZ | NZ | PY);
      b.pop();
    }
    if (o.collide !== false && b.collecting) {
      const dx = (q[0] - p[0]) / L, dz = (q[2] - p[2]) / L;
      b.push(); b.translate(p[0], Math.min(p[1], q[1]), p[2]); b.rotY(-Math.atan2(dz, dx));
      b.colBox(0, 0, -0.04, L, H + Math.abs(q[1] - p[1]), 0.04);
      b.pop();
    }
  }
}

/** Grated platform x0..x1 × z0..z1 with top at y: steel edge channels + grating + collider. */
export function grating(b, x0, z0, x1, z1, y, o = {}) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  const t = o.t ?? 0.16, ek = o.edgeKey || 'steel';
  b.rectY('grille_dark', x0 + 0.04, z0 + 0.04, x1 - 0.04, z1 - 0.04, y - 0.01, 1);
  b.rectY('grille_dark', x0 + 0.04, z0 + 0.04, x1 - 0.04, z1 - 0.04, y - 0.04, -1);
  b.box(ek, x0, y - t, z0, x1, y, z0 + 0.05, ALL);
  b.box(ek, x0, y - t, z1 - 0.05, x1, y, z1, ALL);
  b.box(ek, x0, y - t, z0 + 0.05, x0 + 0.05, y, z1 - 0.05, PX | NX | PY | NY);
  b.box(ek, x1 - 0.05, y - t, z0 + 0.05, x1, y, z1 - 0.05, PX | NX | PY | NY);
  // cross bearers every 1.2 m
  const along = x1 - x0 >= z1 - z0;
  const L = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.2));
  for (let i = 1; i < n; i++) {
    if (along) { const x = x0 + (L * i) / n; b.box(ek, x - 0.025, y - t * 0.8, z0 + 0.05, x + 0.025, y - 0.012, z1 - 0.05, PX | NX | NY); }
    else { const z = z0 + (L * i) / n; b.box(ek, x0 + 0.05, y - t * 0.8, z - 0.025, x1 - 0.05, y - 0.012, z + 0.025, PZ | NZ | NY); }
  }
  if (b.collecting) b.colQuad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
}

/**
 * Straight steel stair (current frame): foot centre (x, y0, z), climbing `rise` along direction
 * angle `dir` (radians about y; 0 = towards +x), width W. Grating treads, channel stringers, yellow
 * handrails both sides (o.rails = 'both'|'left'|'right'|'none'), landing at the top is the caller's.
 * Returns the top point [x, y1, z].
 */
export function steelStair(b, o) {
  const { x, z } = o, y0 = o.y0, rise = o.rise, W = o.W ?? 1.0;
  const n = Math.max(2, Math.ceil(rise / 0.19)), h = rise / n, tr = o.tread ?? 0.25;
  const run = (n - 1) * tr + (o.noTop ? tr : 0);
  b.push(); b.translate(x, y0, z); b.rotY(-(o.dir || 0));
  // local: x along the climb, z across (−W/2..W/2)
  for (let i = 0; i < n - (o.noTop ? 0 : 1); i++) {
    const x0 = i * tr, yt = (i + 1) * h;
    b.box('grille_dark', x0, yt - 0.035, -W / 2 + 0.04, x0 + tr, yt, W / 2 - 0.04, PY | NY | PX | NX);
    b.box('steel', x0 + tr - 0.03, yt - 0.04, -W / 2 + 0.04, x0 + tr, yt, W / 2 - 0.04, PX | PY);
  }
  // stringers (sloped channels)
  const ang = Math.atan2(rise, run), len = Math.hypot(rise, run);
  for (const sz of [-W / 2, W / 2]) {
    b.push(); b.translate(0, -0.05, sz); b.rotZ(ang);
    b.box('steel', -0.05, -0.18, -0.03, len + 0.05, 0.06, 0.03, ALL);
    b.pop();
  }
  const rails = o.rails ?? 'both';
  const rk = o.railKey || 'steel_yellow';
  const railAt = (sz) => {
    const pts = [[-0.15, 1.0, sz], [0.0, 1.0, sz], [run, rise + 1.0, sz], [run + 0.25, rise + 1.0, sz]];
    b.tube(rk, pts, 0.022, 8, { transport: true });
    b.tube(rk, pts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.016, 6, { transport: true });
    const np = Math.max(2, Math.round(len / 1.4));
    for (let k = 0; k <= np; k++) { const t = k / np; b.box(rk, run * t - 0.02, rise * t - 0.02, sz - 0.02, run * t + 0.02, rise * t + 1.0, sz + 0.02, PX | NX | PZ | NZ); }
  };
  if (rails === 'both' || rails === 'left') railAt(W / 2 - 0.02);
  if (rails === 'both' || rails === 'right') railAt(-W / 2 + 0.02);
  if (b.collecting) {
    b.colQuad(0, 0, W / 2, run, rise, W / 2, run, rise, -W / 2, 0, 0, -W / 2);
    if (rails !== 'none') { b.colBox(0, 0, W / 2 - 0.05, run, rise + 1.0, W / 2); b.colBox(0, 0, -W / 2, run, rise + 1.0, -W / 2 + 0.05); }
  }
  b.pop();
  // local +x maps to (cos dir, sin dir) in the caller's (x, z)
  const c = Math.cos(o.dir || 0), sn = Math.sin(o.dir || 0);
  return [x + c * run, y0 + rise, z + sn * run];
}

/** Fixed steel ladder with safety cage (current frame) standing at (x, y0, z) against a wall facing +z after rot. */
export function cagedLadder(b, x, y0, z, h, rot = 0, o = {}) {
  const k = o.key || 'steel', w = 0.46;
  b.push(); b.translate(x, y0, z); b.rotY(rot);
  for (const s of [-1, 1]) b.box(k, s * w / 2 - 0.022, 0, 0.14, s * w / 2 + 0.022, h + 1.0, 0.19, ALL);
  for (let yy = 0.3; yy < h + 0.2; yy += 0.3) b.box(k, -w / 2, yy - 0.012, 0.155, w / 2, yy + 0.012, 0.175, PY | NY | PZ | NZ);
  for (let yy = 0.8; yy < h; yy += 1.6) for (const s of [-1, 1]) b.box(k, s * w / 2 - 0.02, yy, 0, s * w / 2 + 0.02, yy + 0.05, 0.14, ALL);
  // cage hoops from 2.4 m up + vertical cage bars
  const ck = o.cageKey || 'steel_yellow';
  if (h > 3) {
    const r = 0.38, hs = [];
    for (let yy = 2.4; yy < h + 0.9; yy += 0.9) hs.push(yy);
    for (const yy of hs) {
      const pts = [];
      for (let i = 0; i <= 10; i++) { const a = Math.PI * (i / 10); pts.push([Math.cos(a) * (w / 2 + 0.05), yy, 0.17 + Math.sin(a) * r]); }
      b.tube(ck, [[w / 2 + 0.05, yy, 0.02], ...pts, [-w / 2 - 0.05, yy, 0.02]], 0.014, 5);
    }
    for (let i = 1; i < 5; i++) { const a = Math.PI * (i / 5); b.tube(ck, [[Math.cos(a) * (w / 2 + 0.05), hs[0], 0.17 + Math.sin(a) * r], [Math.cos(a) * (w / 2 + 0.05), hs[hs.length - 1], 0.17 + Math.sin(a) * r]], 0.012, 4); }
  }
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// pipes, lamps, equipment
// ---------------------------------------------------------------------------------------------
/**
 * Pipe along a polyline (current frame) with flanges at the vertices and saddle supports to y=ground
 * under horizontal runs (o.ground). o: {key='steel', insulated (aluminium jacket + bands, heat trace), ground, flange=true}
 */
export function pipeRun(b, pts, r, o = {}) {
  if (!pts || pts.length < 2) return;
  const key = o.insulated ? 'aluminium' : (o.key || 'steel');
  const rr = o.insulated ? r + 0.06 : r;
  b.tube(key, pts, rr, o.segs ?? (rr > 0.2 ? 16 : 10), { smoothAngle: 30 });
  const fk = o.flangeKey || (o.insulated ? 'steel_dark' : key);
  const flange = (p, q, t) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz) || 1;
    const c = [p[0] + dx * t, p[1] + dy * t, p[2] + dz * t], e = 0.025 / L;
    b.tube(fk, [[c[0] - dx * e, c[1] - dy * e, c[2] - dz * e], [c[0] + dx * e, c[1] + dy * e, c[2] + dz * e]], rr + 0.035, o.segs ?? 12);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (o.flange !== false && L > 0.6) { flange(p, q, Math.min(0.35, 0.25 / L + 0.02)); flange(p, q, Math.max(0.65, 1 - 0.25 / L - 0.02)); }
    if (o.insulated && L > 1.2) { const n = Math.floor(L / 1.2); for (let k = 1; k < n; k++) flange(p, q, k / n); }
    // supports under horizontal runs
    if (o.ground !== undefined && Math.abs(q[1] - p[1]) < 0.05 && L > 1.5) {
      const n = Math.max(1, Math.floor(L / 4));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = p[0] + (q[0] - p[0]) * t, z = p[2] + (q[2] - p[2]) * t, y = p[1] - rr;
        if (y - o.ground < 0.15) continue;
        b.box('steel_dark', x - 0.05, o.ground, z - 0.05, x + 0.05, y, z + 0.05, PX | NX | PZ | NZ);
        b.box('steel_dark', x - 0.06, y - 0.04, z - rr - 0.03, x + 0.06, y, z + rr + 0.03, ALL);
        b.box('concrete', x - 0.18, o.ground - 0.2, z - 0.18, x + 0.18, o.ground + 0.08, z + 0.18, ALL & ~NY);
      }
    }
  }
  if (o.insulated && o.trace !== false) {
    // heat-trace junction boxes (small orange-ish boxes) at the start
    const p = pts[0];
    b.withTint([1.0, 0.55, 0.25], () => b.cbox('plastic_bin', p[0] - 0.09, p[1] + rr + 0.02, p[2] - 0.07, p[0] + 0.09, p[1] + rr + 0.2, p[2] + 0.07, 0.01));
  }
}

/** Valve (hand wheel + body) on a pipe point (current frame), axis 'x'|'z'. */
export function valve(b, x, y, z, r, axis = 'x', key = 'steel_dark') {
  b.cbox(key, x - r * 1.3, y - r * 1.2, z - r * 1.3, x + r * 1.3, y + r * 1.2, z + r * 1.3, r * 0.2);
  b.cylinder(key, x, y + r * 1.2, z, r * 0.25, r * 1.6, 8, { top: true });
  const R = r * 1.4 + 0.08;
  const pts = []; for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push([x + Math.cos(a) * R, y + r * 2.8, z + Math.sin(a) * R]); }
  b.withTint([0.85, 0.2, 0.15], () => b.tube('steel_yellow', pts, 0.018, 5));
  void axis;
}

/** Lamp post (current frame) standing at (x, y, z), arm towards rot (0 = +x). */
export function lampPost(b, x, y, z, h = 6, rot = 0, o = {}) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('concrete', -0.25, -0.3, -0.25, 0.25, 0.12, 0.25, 0.02, false);
  b.lathe(o.key || 'steel', [[0.09, 0.12], [0.075, 0.6], [0.06, h * 0.6], [0.045, h]], 10, { capTop: true });
  const arm = o.arm ?? 0.9;
  b.tube(o.key || 'steel', [[0, h - 0.15, 0], [arm * 0.5, h + 0.05, 0], [arm, h + 0.05, 0]], 0.035, 6);
  b.cbox('aluminium_dark', arm - 0.05, h - 0.08, -0.16, arm + 0.55, h + 0.1, 0.16, 0.02);
  b.rectY('light_warm', arm + 0.02, -0.12, arm + 0.48, 0.12, h - 0.085, -1);
  b.pop();
  if (b.collecting) b.colBox(x - 0.12, y, z - 0.12, x + 0.12, y + h, z + 0.12);
}

/** Electrical / control cabinet (current frame) on the ground at (x,y,z), facing +z after rot. */
export function cabinet(b, x, y, z, w = 0.8, h = 1.6, d = 0.45, rot = 0, key = 'hvac') {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('concrete', -w / 2 - 0.1, -0.2, -d / 2 - 0.1, w / 2 + 0.1, 0.1, d / 2 + 0.1, 0.015, false);
  b.cbox(key, -w / 2, 0.1, -d / 2, w / 2, 0.1 + h, d / 2, 0.015);
  b.box('steel_dark', -w / 2 + 0.04, 0.1 + h * 0.5 - 0.01, d / 2, -w / 2 + 0.08, 0.1 + h * 0.5 + 0.08, d / 2 + 0.02, ALL);
  b.box('grille_dark', -w / 2 + 0.1, 0.25, d / 2, w / 2 - 0.1, 0.4, d / 2 + 0.004, PZ);
  b.cbox('steel', -w / 2 - 0.03, 0.1 + h, -d / 2 - 0.05, w / 2 + 0.03, 0.14 + h, d / 2 + 0.06, 0.008);
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-w / 2, 0, -d / 2, w / 2, h + 0.1, d / 2); b.pop(); }
}

// ---------------------------------------------------------------------------------------------
// doors
// ---------------------------------------------------------------------------------------------
/**
 * Roller shutter door filling a wall opening (wall frame: x along the wall, z outward, face z=0).
 * o: {u0,u1,v0,v1,R=0.2, open=0..1, key='steel_door', inner}
 */
export function rollerDoor(b, o) {
  const { u0, u1, v0, v1 } = o, R = o.R ?? 0.2, key = o.key || 'steel_door';
  const open = Math.max(0, Math.min(0.92, o.open || 0));
  // guide channels at the jambs
  for (const [a, c] of [[u0, u0 + 0.09], [u1 - 0.09, u1]]) b.cbox('steel_dark', a, v0, -R - 0.12, c, v1, -R + 0.02, 0.006);
  const z = -R - 0.05, bottom = v0 + (v1 - v0) * open;
  // curtain: slats (ribbed) from the bottom rail to the head
  b.rectZ(key, u0 + 0.06, bottom, u1 - 0.06, v1, z, 1);
  if (o.inner) b.rectZ(key, u0 + 0.06, bottom, u1 - 0.06, v1, z - 0.02, -1);
  for (let y = bottom + 0.11; y < v1 - 0.02; y += 0.11) b.box(key, u0 + 0.06, y - 0.012, z, u1 - 0.06, y + 0.012, z + 0.018, PY | NY | PZ);
  // bottom rail with yellow / black safety edge + handle
  b.cbox('steel_dark', u0 + 0.06, bottom, z - 0.03, u1 - 0.06, bottom + 0.09, z + 0.04, 0.006);
  b.withTint([1, 1, 1], () => b.box('steel_yellow', u0 + 0.06, bottom + 0.09, z + 0.018, u1 - 0.06, bottom + 0.14, z + 0.026, PZ | PY));
  b.cbox('steel', (u0 + u1) / 2 - 0.12, bottom + 0.16, z, (u0 + u1) / 2 + 0.12, bottom + 0.2, z + 0.06, 0.005);
  // hood over the opening (outside, above the lintel) + yellow-black bollards each side of the opening
  b.cbox('steel_dark', u0 - 0.15, v1 + 0.02, -0.02, u1 + 0.15, v1 + 0.4, 0.32, 0.015);
  for (const u of [u0 - 0.35, u1 + 0.35]) {
    b.cylinder('steel_yellow', u, v0 - 0.2, 0.45, 0.1, 1.15, 12, { top: true });
    b.withTint([0.15, 0.15, 0.15], () => { b.lathe('steel_dark', [[0.102, 0], [0.102, 0.08]], 12, { x: u, y: v0 + 0.55, z: 0.45 }); b.lathe('steel_dark', [[0.102, 0], [0.102, 0.08]], 12, { x: u, y: v0 + 0.25, z: 0.45 }); });
  }
  // threshold
  b.cbox('steel', u0, v0 - 0.02, -R - 0.15, u1, v0 + 0.01, 0.05, 0.004);
  return bottom;
}

// ---------------------------------------------------------------------------------------------
// interior mapping for window glass
// ---------------------------------------------------------------------------------------------
/**
 * Room descriptor for K.windowUnit (glass interior mapping + occupancy lights).
 * side/w/d: facade of the full footprint (bay ids follow the far facade perimeter u).
 * r: {y (room floor), h (floor-to-ceiling), depth, u0, u1 (room extent along the facade), kind, floor}
 */
export function roomMap(ctx, side, w, d, o, r) {
  const s = ctx.spec;
  const uc = (o.u0 + o.u1) / 2;
  const ru0 = r.u0 ?? (o.u0 - 1.2), ru1 = r.u1 ?? (o.u1 + 1.2);
  return {
    u0: Math.max(0.05, o.u0 - ru0), w: Math.max(1, ru1 - ru0), d: Math.max(1.5, r.depth ?? 5), h: Math.max(2.2, r.h ?? 3),
    sill: o.v0 - (r.y ?? 0), kind: K.ROOM_KIND[r.kind] ?? K.ROOM_KIND.office,
    seed: (hash4(s.hash, r.floor ?? 0, Math.round(uc * 10), SIDES.indexOf(side)) & 1023) / 1023,
    floor: r.floor ?? 0, bay: Math.floor((K.perimeterU(side, w, d) + uc) / BAY_W), hash: s.hash, profile: s._profile | 0,
  };
}

// ---------------------------------------------------------------------------------------------
// walls with openings on one side of a rect (rect may be a sub-rect of the footprint)
// ---------------------------------------------------------------------------------------------
/**
 * Enter the wall frame of `side` of rect {x0,x1,z0,z1} (building frame). Returns the side length.
 * Caller must push()/pop().
 */
export function rectFrame(b, side, R) {
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  b.translate(cx, 0, cz);
  return K.facadeFrame(b, side, R.x1 - R.x0, R.z1 - R.z0, 0);
}

/**
 * Wall of one side of rect R with openings + units. o: {y0, y1, T, key, tint, inner ('plaster'|null),
 * ops:[{u0,u1,v0,v1,kind,...}], fb (front/back walls span the full length), full, glass, frameKey, reveal}
 * Opening kinds: 'win' (casement/fixed/strip via o.type), 'door' (doorKind), 'roller', 'louvre', 'blank'.
 * Each opening may carry `room` (from roomMap) for glass interior mapping.
 */
export function facadeWall(ctx, side, R, o) {
  const b = ctx.b;
  const T = o.T ?? 0.32, fb = isFB(side);
  const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
  const uS = fb ? 0 : T, uE = fb ? L : L - T;
  const ops = (o.ops || []).filter((p) => p.u0 > uS + 0.04 && p.u1 < uE - 0.04 && p.v1 > p.v0 + 0.05);
  const Rv = o.reveal ?? 0.2;
  b.push(); rectFrame(b, side, R);
  b.pushTint(o.tint || [1, 1, 1]);
  const wop = (list) => list.map((p) => ({ u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, reveal: p.kind === 'door' || p.kind === 'roller' ? Math.min(Rv, 0.22) : Rv, chamfer: 0.02, noSillReveal: p.kind === 'door' || p.kind === 'roller' }));
  const wbase = { L: uE - uS, u0: uS, T, outer: o.key || 'panel_white', inner: o.inner === undefined ? (ctx.full ? 'plaster' : null) : o.inner, innerReveals: ctx.full && o.inner !== null, capStart: fb, capEnd: fb, chamferStart: 0, chamferEnd: 0 };
  // optional two-material wall (o.lower = {key, y, tint}): e.g. a board-formed concrete ground storey under
  // the panel shell (flood-proof water works); only when no opening crosses the split line
  const ys = o.lower && o.lower.y;
  const split = ys > o.y0 + 0.3 && ys < o.y1 - 0.3 && ops.every((p) => p.v1 <= ys - 0.02 || p.v0 >= ys + 0.02);
  if (split) {
    b.pushTint(o.lower.tint || [1, 1, 1]);
    K.wallWithOpenings(b, { ...wbase, y0: o.y0, y1: ys, outer: o.lower.key || 'concrete', openings: wop(ops.filter((p) => p.v1 <= ys)) });
    b.popTint();
    K.wallWithOpenings(b, { ...wbase, y0: ys, y1: o.y1, openings: wop(ops.filter((p) => p.v0 >= ys)) });
  } else {
    K.wallWithOpenings(b, { ...wbase, y0: o.y0, y1: o.y1, openings: wop(ops) });
  }
  b.popTint();
  for (const p of ops) emitOpening(ctx, p, Rv, T, o);
  // walkable threshold across the wall thickness of every door / roller opening (walk colliders)
  if (b.collecting) for (const p of ops) if (p.kind === 'door' || p.kind === 'roller') b.colQuad(p.u0, p.v0, 0.06, p.u1, p.v0, 0.06, p.u1, p.v0, -T - 0.06, p.u0, p.v0, -T - 0.06);
  b.pop();
  return ops;
}

function emitOpening(ctx, p, R, T, o) {
  const b = ctx.b;
  const fk = o.frameKey || 'aluminium_dark';
  switch (p.kind) {
    case 'door':
      K.doorUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: Math.min(R, 0.22), kind: p.doorKind || 'service', open: p.open ?? 0, glassKey: ctx.full ? 'glass_clear' : 'glass_shop', room: p.room || null, T });
      break;
    case 'roller':
      rollerDoor(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: Math.min(R, 0.22), open: p.open ?? 0, inner: ctx.full });
      break;
    case 'louvre':
      K.louvrePanel(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: Math.min(0.12, R), key: p.key || 'aluminium' });
      break;
    case 'blank':
      break;
    default:
      K.windowUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R, type: p.type || 'casement', cols: p.cols, transoms: p.transoms, frameKey: fk, glassKey: p.glassKey || o.glass || (ctx.full ? 'glass_clear' : 'glass_window'), sillKey: p.sill === false ? null : 'aluminium', room: p.room || null, inner: ctx.full, T, sash: p.sash });
  }
}

/** All four walls of a rect: ops = {front:[...], ...}. Returns the opening lists. */
export function boxWalls(ctx, R, o) {
  const out = {};
  for (const side of SIDES) {
    if (o.skip && o.skip[side]) continue;
    out[side] = facadeWall(ctx, side, R, { ...o, ops: (o.ops && o.ops[side]) || [] });
  }
  return out;
}

/**
 * O02 utility-box trims on rect R: grey top fascia band (proud 30 mm) under the coping, vertical
 * corner trims, grey kick band above the plinth, optional mid storey band. o: {y0 (ffl), y1 (top), band (y)}
 */
export function boxTrims(ctx, R, o) {
  const b = ctx.b, E = o.env || oEnv(ctx);
  const key = o.key || E.trim;
  const p = 0.035, y1 = o.y1, y0 = o.y0;
  const sk = o.skip || {};
  b.pushTint(E.trimTint);
  const fh = o.fascia ?? 0.42;
  const band = (y, h) => {
    if (!sk.front) b.box(key, R.x0 - (sk.left ? 0 : p), y, R.z1, R.x1 + (sk.right ? 0 : p), y + h, R.z1 + p, PZ | PY | NY | PX | NX);
    if (!sk.back) b.box(key, R.x0 - (sk.left ? 0 : p), y, R.z0 - p, R.x1 + (sk.right ? 0 : p), y + h, R.z0, NZ | PY | NY | PX | NX);
    if (!sk.right) b.box(key, R.x1, y, R.z0, R.x1 + p, y + h, R.z1, PX | PY | NY);
    if (!sk.left) b.box(key, R.x0 - p, y, R.z0, R.x0, y + h, R.z1, NX | PY | NY);
  };
  if (o.top !== false) band(y1 - fh, fh);
  if (o.kick !== false) band(y0, 0.45);
  if (o.band) band(o.band - 0.1, 0.2);
  if (o.corners !== false) {
    // square corner trims wrapping each external corner, proud p on both faces (none next to skipped sides)
    const c = 0.16;
    for (const [x, z, sx, sz, s1, s2] of [[R.x0, R.z1, -1, 1, 'left', 'front'], [R.x1, R.z1, 1, 1, 'right', 'front'], [R.x1, R.z0, 1, -1, 'right', 'back'], [R.x0, R.z0, -1, -1, 'left', 'back']]) {
      if (sk[s1] || sk[s2]) continue;
      const xa = x - sx * (c - p), xb = x + sx * p, za = z - sz * (c - p), zb = z + sz * p;
      b.cbox(key, Math.min(xa, xb), y0 + 0.45, Math.min(za, zb), Math.max(xa, xb), y1 - fh, Math.max(za, zb), 0.012, false);
    }
  }
  b.popTint();
}

// ---------------------------------------------------------------------------------------------
// roofs
// ---------------------------------------------------------------------------------------------
/**
 * Flat roof on rect R (outer wall line) at y: parapet inner faces + copings, gravel / membrane deck with
 * falls + drains, scuppers + downpipes on side `dp`, optional snow cap (polar). Returns {yr, inner}.
 * Walls must already rise to y + parapet. o: {parapet=0.9, T, key, snow, dp:'back', ffl, env, sides}
 */
export function flatRoof(ctx, R, y, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const ph = o.parapet ?? 0.9, T = o.T ?? 0.32;
  if (ph > 0.05) K.parapets(b, R, y, ph, T, { innerKey: o.innerKey || 'render_white', copingKey: o.copingKey || 'steel', sides: o.sides });
  // sides without a parapet (abutting a taller hall) run the deck to the outer line
  const ins = (sd) => (o.sides && o.sides[sd] === 'none' ? 0 : T);
  const inner = { x0: R.x0 + ins('left'), x1: R.x1 - ins('right'), z0: R.z0 + ins('back'), z1: R.z1 - ins('front') };
  const yr = K.roofDeck(b, inner, y, { key: o.key || 'roof_gravel', mode: 'ridge', drains: true });
  if (o.snow) {
    // snow cap: thin white blanket stopping short of the parapets (wind-scoured edge, melt ring at drains)
    const m = 0.45;
    b.withTint(o.env ? o.env.snowTint : [1, 1.02, 1.06], () => {
      const zm = (inner.z0 + inner.z1) / 2;
      b.quad('render_white', inner.x0 + m, y + 0.06, inner.z1 - m, inner.x1 - m, y + 0.06, inner.z1 - m, inner.x1 - m, yr + 0.07, zm, inner.x0 + m, yr + 0.07, zm);
      b.quad('render_white', inner.x0 + m, yr + 0.07, zm, inner.x1 - m, yr + 0.07, zm, inner.x1 - m, y + 0.06, inner.z0 + m, inner.x0 + m, y + 0.06, inner.z0 + m);
    });
  }
  // downpipes
  const dp = o.dp || 'back';
  if (o.downpipes !== false) {
    const L = isFB(dp) ? R.x1 - R.x0 : R.z1 - R.z0;
    const n = Math.max(2, Math.round(L / 12));
    const [g0, g1] = sideGround(s, dp);
    for (let i = 0; i < n; i++) {
      const u = i === 0 ? 0.6 : i === n - 1 ? L - 0.6 : (L * i) / (n - 1);
      b.push(); rectFrame(b, dp, R);
      K.scupper(b, u, y + 0.05);
      K.downpipe(b, u, y + 0.2, Math.max(g0 + ((g1 - g0) * u) / L, (o.ffl ?? 0.2) - 0.3), { key: 'aluminium_dark' });
      b.pop();
    }
  }
  return { yr, inner };
}

/**
 * Barrel-vault roof over rect R with springing line at y (walls up to y), axis along the longer side
 * (or o.axis). Standing-seam / insulated metal skin with thickness, gable end walls (shell key) closing the
 * arch, eave gutters, ridge vents. o: {rise, key='roof_metal', gableKey, axis, overhang=0.35, snow, env}
 * Returns the crown height.
 */
export function vaultRoof(ctx, R, y, o = {}) {
  const b = ctx.b;
  const W = R.x1 - R.x0, D = R.z1 - R.z0;
  const alongX = o.axis ? o.axis === 'x' : W >= D;
  const span = alongX ? D : W, L = alongX ? W : D;
  const rise = o.rise ?? Math.min(span * 0.22, 3.2);
  const ov = o.overhang ?? 0.35, t = 0.22, key = o.key || 'roof_metal';
  const half = span / 2 + ov;
  // circular arc through (±half, y−ov·k) and (0, y+rise)
  const rad = (half * half + rise * rise) / (2 * rise);
  const yc = y + rise - rad;
  const a0 = Math.asin(Math.min(1, half / rad));
  const n = Math.max(10, Math.round(span / 1.2));
  const arc = (r) => { const pts = []; for (let i = 0; i <= n; i++) { const a = -a0 + (2 * a0 * i) / n; pts.push([Math.sin(a) * r, yc + Math.cos(a) * r]); } return pts; };
  const outer = arc(rad), innerA = arc(rad - t);
  b.push();
  b.translate((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
  if (!alongX) b.rotY(Math.PI / 2);
  // local: x along the vault axis (−L/2..L/2), z across the span
  const xa = -L / 2 - ov * 0.6, xb = L / 2 + ov * 0.6;
  b.pushTint(o.tint || [1, 1, 1]);
  for (let i = 0; i < n; i++) {
    const [z0, y0] = outer[i], [z1, y1] = outer[i + 1];
    b.quad(key, xa, y0, z0, xb, y0, z0, xb, y1, z1, xa, y1, z1, [xa, i * 1.2, xb, i * 1.2, xb, (i + 1) * 1.2, xa, (i + 1) * 1.2]);
    const [iz0, iy0] = innerA[i], [iz1, iy1] = innerA[i + 1];
    b.quad(o.soffitKey || 'panel_grey', xb, iy0, iz0, xa, iy0, iz0, xa, iy1, iz1, xb, iy1, iz1);
    // standing seams across... (seams run with the curve, every 0.6 m along x)
  }
  const nS = Math.max(4, Math.round((xb - xa) / 0.6));
  for (let k = 1; k < nS; k++) {
    const x = xa + ((xb - xa) * k) / nS;
    const path = outer.map(([z, yy]) => [x, yy + 0.02, z]);
    b.sweep(key, path, SEAM, { smoothAngle: 60, caps: false });
  }
  // edge (verge) faces at both ends + eave fascia
  for (const [x, sx] of [[xa, -1], [xb, 1]]) {
    for (let i = 0; i < n; i++) {
      const [z0, y0] = outer[i], [z1, y1] = outer[i + 1], [iz0, iy0] = innerA[i], [iz1, iy1] = innerA[i + 1];
      if (sx < 0) b.quad('steel_dark', x, iy0, iz0, x, y0, z0, x, y1, z1, x, iy1, iz1);
      else b.quad('steel_dark', x, y0, z0, x, iy0, iz0, x, iy1, iz1, x, y1, z1);
    }
  }
  b.popTint();
  // gable end walls (arched infill above the springing line), in the shell key
  const gk = o.gableKey || 'panel_white';
  for (const [x, sx] of [[-L / 2, -1], [L / 2, 1]]) {
    const pts = arc(rad - t - 0.01).filter((p) => p[1] >= y - 0.001);
    const poly = [[-span / 2, y], ...pts.filter((p) => Math.abs(p[0]) < span / 2).map((p) => [p[0], p[1]]), [span / 2, y]];
    // fan triangulation from the base midpoint
    b.pushTint(o.gableTint || [1, 1, 1]);
    for (let i = 0; i < poly.length - 1; i++) {
      const A = poly[i], B = poly[i + 1];
      if (sx > 0) b.triangle(gk, x, y, 0, x, A[1], A[0], x, B[1], B[0]);
      else b.triangle(gk, x, y, 0, x, B[1], B[0], x, A[1], A[0]);
      if (ctx.full) {
        // inner face of the gable infill (visible from inside the hall)
        const xi = x - sx * (o.T ?? 0.32);
        if (sx > 0) b.triangle('plaster', xi, y, 0, xi, B[1], B[0], xi, A[1], A[0]);
        else b.triangle('plaster', xi, y, 0, xi, A[1], A[0], xi, B[1], B[0]);
      }
    }
    b.popTint();
  }
  // eave gutters
  for (const sz of [1, -1]) {
    const [ez, ey] = outer[sz > 0 ? n : 0];
    K.gutter(b, [[xa + 0.05, ey - 0.05, ez + sz * 0.06], [xb - 0.05, ey - 0.05, ez + sz * 0.06]], { key: 'aluminium_dark' });
  }
  // snow on the upper part of the vault (polar): thin white skin on the crown band
  if (o.snow) {
    b.withTint(o.env ? o.env.snowTint : [1, 1.02, 1.06], () => {
      const m = Math.floor(n * 0.3), M = n - m;
      for (let i = m; i < M; i++) {
        const [z0, y0] = outer[i], [z1, y1] = outer[i + 1];
        const k0 = 0.03 + 0.06 * Math.sin(Math.PI * (i - m) / (M - m)), k1 = 0.03 + 0.06 * Math.sin(Math.PI * (i + 1 - m) / (M - m));
        b.quad('render_white', xa + 0.3, y0 + k0, z0, xb - 0.3, y0 + k0, z0, xb - 0.3, y1 + k1, z1, xa + 0.3, y1 + k1, z1);
      }
    });
  }
  b.pop();
  return y + rise;
}
const SEAM = [[-0.012, 0], [0.012, 0], [0.012, 0.035], [-0.012, 0.035]];

// ---------------------------------------------------------------------------------------------
// weathering: lee-side dust drifts, snow tongues, wet bases
// ---------------------------------------------------------------------------------------------
/**
 * Drift strip along `side` of the footprint (or of rect o.rect) at the wall foot: red dust (o.kind 'dust')
 * or a snow tongue (o.kind 'snow') on the lee side. Height h at the wall falling to 0 at `reach`.
 * Deterministic undulation from the spec hash. Building frame.
 */
export function drift(ctx, side, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const R = o.rect || { x0: -s._w / 2, x1: s._w / 2, z0: -s._d / 2, z1: s._d / 2 };
  const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
  const [g0, g1] = sideGround(s, side);
  const snow = o.kind === 'snow';
  const h0 = o.h ?? (snow ? 0.75 : 0.16), reach = o.reach ?? (snow ? 5.5 : 1.1);
  const key = snow ? 'render_white' : 'soil';
  const tint = o.tint || (snow ? [1.0, 1.02, 1.06] : [3.1, 1.75, 1.05]);
  const rng = ctx.sub(9100 + SIDES.indexOf(side), o.seed || 0);
  const ph1 = rng.next() * 6.28, ph2 = rng.next() * 6.28;
  const N = Math.max(6, Math.round(L / (snow ? 1.2 : 0.8)));
  const a = o.u0 ?? 0, c = o.u1 ?? L;
  const skip = o.skip || [];       // [[u0,u1]] (doors kept clear)
  b.push(); rectFrame(b, side, R);
  b.pushTint(tint);
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const u = a + ((c - a) * i) / N;
    const gy = g0 + ((g1 - g0) * u) / L;
    let k = 0.65 + 0.25 * Math.sin(u * 0.9 + ph1) + 0.12 * Math.sin(u * 2.3 + ph2);
    const tEnd = Math.min(1, (u - a) / 1.5, (c - u) / 1.5);
    k *= Math.max(0, tEnd);
    for (const [s0, s1] of skip) { const dd = Math.max(s0 - u, u - s1); if (dd < 1.2) k *= Math.max(0, dd / 1.2); }
    const hh = h0 * k, rr = reach * (0.55 + 0.45 * k);
    rows.push([u, gy, hh, rr]);
  }
  for (let i = 0; i < N; i++) {
    const [u0, y0, h0a, r0] = rows[i], [u1, y1, h1a, r1] = rows[i + 1];
    if (h0a < 0.01 && h1a < 0.01) continue;
    const e0 = y0 - 0.04, e1 = y1 - 0.04;
    // upper (steep) part near the wall, lower long tail
    const m0 = r0 * (snow ? 0.3 : 0.4), m1 = r1 * (snow ? 0.3 : 0.4);
    b.quad(key, u0, y0 + h0a * 0.45, m0, u1, y1 + h1a * 0.45, m1, u1, y1 + h1a, 0.01, u0, y0 + h0a, 0.01);
    b.quad(key, u0, e0, r0, u1, e1, r1, u1, y1 + h1a * 0.45, m1, u0, y0 + h0a * 0.45, m0);
  }
  b.popTint();
  b.pop();
}

/**
 * Wet / algae band at the foot of a wall facing water (wall frame of `side` of rect R): concrete_wet
 * strip up to `yWet` with an algae-tinted lower edge. Emitted slightly proud of the wall (5 mm).
 */
export function wetBand(ctx, side, R, y0, yWet, o = {}) {
  const b = ctx.b;
  const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
  b.push(); rectFrame(b, side, R);
  b.withTint(o.tint || [0.9, 0.95, 0.9], () => b.rectZ('concrete_wet', o.u0 ?? 0, y0, o.u1 ?? L, yWet, 0.006, 1));
  if (o.algae) b.withTint(o.algae, () => b.rectZ('concrete_wet', o.u0 ?? 0, y0, o.u1 ?? L, y0 + (yWet - y0) * 0.35, 0.008, 1));
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------------------------
/** Concrete apron / pad (top at y) with a chamfered edge, optional painted bay lines (turning area). */
export function apron(b, x0, z0, x1, z1, y, o = {}) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  b.cbox(o.key || 'concrete', x0, y - (o.depth ?? 0.5), z0, x1, y, z1, 0.03, false);
  if (b.collecting) b.colQuad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
  if (o.lines) {
    // yellow edge / bay lines (turning circle hatch omitted: two guide lines + a stop bar)
    const lk = 'steel_yellow';
    for (const l of o.lines) b.box(lk, l[0], y, l[1], l[2], y + 0.004, l[3], PY);
  }
}

/** Ground-level pad under an equipment item. */
export function plinthPad(b, x0, z0, x1, z1, y, h = 0.2) { b.cbox('concrete', x0, y - 0.3, z0, x1, y + h, z1, 0.02, false); }

/** Sign plate (blank) with frame on a facade (wall frame) — station name plates beside doors. */
export function namePlate(b, u, y, w = 1.4, h = 0.36) { K.signPanel(b, u, y, w, h, { frameKey: 'aluminium_dark' }); }

/** Terrain height at facade u of a side (relative to entrance). */
export function groundAtU(s, side, u, L) { const [g0, g1] = sideGround(s, side); return g0 + ((g1 - g0) * u) / L; }

/** Mass LOD helper: a plain coloured box (mass_roof tint) — for tanks, gates, canopies, glass. */
export function massBox(b, x0, y0, z0, x1, y1, z1, tint, faces = ALL & ~NY) {
  b.pushTint(tint); b.box('mass_roof', x0, y0, z0, x1, y1, z1, faces); b.popTint();
}
/** Mass LOD helper: plain cylinder (mass_roof tint). */
export function massCyl(b, x, y0, z, r, h, tint, segs = 20) {
  b.pushTint(tint); b.cylinder('mass_roof', x, y0, z, r, h, segs, { top: true }); b.popTint();
}
/** Mass LOD helper: a utility box volume with far-facade windows (emitMass volume). */
/**
 * 'mass' LOD barrel vault (mass_roof, tinted) over rect x0..x1 × z0..z1 springing at ys with crown rise `rise`,
 * axis along the longer side (or o.axis 'x'|'z'): circular arc of n facets + the two gable segments, all
 * CCW seen from outside. Pair it with a massVol box topped at ys (parapet 0).
 */
export function massVault(b, x0, x1, z0, z1, ys, rise, tint, o = {}) {
  const W = x1 - x0, D = z1 - z0;
  const alongX = o.axis ? o.axis === 'x' : W >= D;
  const Lx = alongX ? W : D, span = alongX ? D : W;
  const n = o.n ?? 10;
  const R0 = (span / 2) ** 2 / (2 * rise) + rise / 2, yc = ys + rise - R0;
  b.push(); b.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); if (!alongX) b.rotY(Math.PI / 2);
  b.pushTint(tint || [0.86, 0.88, 0.9]);
  const pts = [];
  for (let i = 0; i <= n; i++) { const z = -span / 2 + (span * i) / n; pts.push([z, yc + Math.sqrt(Math.max(0, R0 * R0 - z * z))]); }
  for (let i = 0; i < n; i++) {
    const [za, ya] = pts[i], [zb, yb] = pts[i + 1];
    b.quad('mass_roof', -Lx / 2, yb, zb, Lx / 2, yb, zb, Lx / 2, ya, za, -Lx / 2, ya, za);
    b.triangle('mass_roof', Lx / 2, ys, 0, Lx / 2, ya, za, Lx / 2, yb, zb);
    b.triangle('mass_roof', -Lx / 2, ys, 0, -Lx / 2, yb, zb, -Lx / 2, ya, za);
  }
  b.popTint();
  b.pop();
}

export function massVol(x0, x1, z0, z1, y0, y1, o = {}) {
  return { x0, x1, z0, z1, y0, y1, parapet: o.parapet ?? 0.9, floorH: o.floorH ?? 4.5, groundH: o.groundH ?? 4.8, bayW: BAY_W, blank: o.blank || {}, flags: o.flags ?? 4, roofColor: o.roofColor || [0.55, 0.53, 0.5], ...o.extra };
}

/**
 * Water body beside a water-works building (pool / canal / melt forebay), in the building frame.
 * From spec.meta: poolSide|intakeSide ('back' default), water {dist, width, level, flow}, sluice {up, down}
 * (absolute levels → relative to ground.entrance). Defaults: canal edge 3 m behind the pool facade, width
 * 16–20 m, level 1.3 m below the entrance ground. Returns the pool frame rotation (b.rotY(rot) makes
 * local −z point at the water), half depth `hd` (centre → pool facade), half width `hw` along the bank.
 */
export function waterInfo(ctx) {
  const s = ctx.spec, m = s._meta || {};
  const side = SIDES.includes(m.poolSide) ? m.poolSide : SIDES.includes(m.intakeSide) ? m.intakeSide : 'back';
  const W = m.water || {};
  const r = ctx.sub(9200);
  const width = +W.width || +m.canalWidth || (16 + Math.round(r.next() * 4));
  // without explicit numbers use the urban placement rule (districts.js sites): the station centre sits
  // canal width/2 + 22 m (sluice) / + 20 m (junction pump) from the centreline → bank 22 − d/2 m behind
  const hd0 = isFB(side) ? s._d / 2 : s._w / 2;
  const off = s.use === 'sluice_station' ? 22 : s.use === 'pumphouse' ? 20 : hd0 + 4;
  const gap = Number.isFinite(+W.dist) && W.dist !== null && W.dist !== '' ? Math.max(0.5, +W.dist - width / 2 - hd0) : Math.max(2, off - hd0);
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : +v);
  const e = Number.isFinite(num(s.ground && s.ground.entrance)) ? +s.ground.entrance : 0;
  // levels relative to the entrance ground (urban fix 1, D2: meta.sluice {up ≥ down, upSide}, meta.water {level,
  // width, dist, flow}); the gates retain the HIGHER level whatever the data calls it. Real canals lie anywhere
  // from a deep cutting (−20 m) to a perched reach on a levee (+10 m above the station ground): the structure
  // follows the real levels (sanity range −35…+15 m, single step ≤ 16 m) so it agrees with the water renderer.
  const sl = m.sluice || null;
  let upR = sl && Number.isFinite(num(sl.up)) ? num(sl.up) - e : num(W.level) - e;
  let dnR = sl ? num(sl.down) - e : NaN;
  if (Number.isFinite(upR) && Number.isFinite(dnR) && dnR > upR) { const t = upR; upR = dnR; dnR = t; }
  const up = Number.isFinite(upR) ? Math.max(-35, Math.min(15, upR)) : -1.3;
  const down = Number.isFinite(dnR) ? Math.max(up - 16, Math.min(up - 0.15, dnR)) : Math.min(up - 1.6, -2.6);
  const rot = side === 'back' ? 0 : side === 'front' ? Math.PI : side === 'left' ? Math.PI / 2 : -Math.PI / 2;
  // flow along building +x: sluice upSide wins (upstream on the left → water flows towards +x), then water.flow;
  // the pool frame's +x is building −x on the front side
  let fb = 1;
  if (sl && (sl.upSide === 'left' || sl.upSide === 'right')) fb = sl.upSide === 'left' ? 1 : -1;
  else if (W.flow === -1 || W.flow === 'left') fb = -1;
  const flow = side === 'front' ? -fb : fb;                      // +1: water flows towards +x of the pool frame
  const hd = isFB(side) ? s._d / 2 : s._w / 2, hw = isFB(side) ? s._w / 2 : s._d / 2;
  // structure levels: yard beside the house, deck / walkway with ≥ 1.1 m freeboard over the retained level,
  // canal beds ~1.9 m under each level (hydro channels are ~1.7 m deep)
  // levelled pad on steep banks (meta.pad {level (m a.s.l.), spread, retaining}): the yard sits on the pad too
  const pad = m.pad && Number.isFinite(num(m.pad.level)) ? { y: num(m.pad.level) - e, spread: +m.pad.spread || 0, retaining: m.pad.retaining !== false } : null;
  const yard = pad ? Math.max(0.3, Math.min(pad.y, 4)) : 0.3;
  const deck = Math.max(yard + 0.6, up + 1.1);
  const depth = Math.max(1.6, Math.min(3.2, 1.5 + width * 0.02));
  const bedU = up - depth, bedD = down - depth;
  return { side, width, gap, up, down, flow, rot, hd, hw, yard, deck, bedU, bedD, bed: Math.min(bedU, bedD) - 0.9, pad, explicit: !!(m.water || sl), levels: Number.isFinite(upR) };
}

/**
 * Ground works of the full footprint (building frame): basalt retaining terraces on every side where the terrain
 * rises above the floor (kit retainingSteps: stepped walls 1.2 m out with copings, drainage channel, guard rails);
 * on a levelled pad (urban meta.pad, steep banks) a basalt-faced pad skirt 1.6 m wide on the sides where the ground
 * falls ≥ 0.45 m below the floor, door landings left clear (their steps start at the skirt edge). o.skip: {side:true}
 */
export function siteWorks(ctx, ffl, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const w = s._w, d = s._d;
  K.retainingSteps(b, s, ffl, { key: 'basalt', copingKey: 'concrete_smooth' });
  if (!o.pad) return;
  const sk = o.skip || {};
  for (const side of SIDES) {
    if (sk[side] || s._shared[side]) continue;
    const [g0, g1] = sideGround(s, side);
    if (Math.min(g0, g1) > ffl - 0.45) continue;
    const L = isFB(side) ? w : d, dep = 1.6, yt = ffl - 0.04;
    const clear = (o.doors && o.doors[side]) || [];
    b.push(); K.facadeFrame(b, side, w, d, 0);
    // skirt pieces between the door landings
    const cuts = clear.map(([a, c]) => [a - 0.7, c + 0.7]).sort((p, q) => p[0] - q[0]);
    let u = -dep;
    const pieces = [];
    for (const [a, c] of cuts) { if (a > u + 0.3) pieces.push([u, a]); u = Math.max(u, c); }
    if (L + dep > u + 0.3) pieces.push([u, L + dep]);
    for (const [a, c] of pieces) {
      const ga = Math.min(g0, g1) - 0.35;
      b.withTint([0.92, 0.9, 0.88], () => b.box('concrete', a, yt - 0.25, 0.0, c, yt, dep, PY));
      b.box('basalt', a, ga, dep - 0.35, c, yt, dep, PZ | PX | NX);
      b.cbox('concrete_smooth', a - 0.02, yt, dep - 0.4, c + 0.02, yt + 0.08, dep + 0.03, 0.01);
      if (yt - Math.max(g0, g1) > 0.6) yellowRail(b, [[a + 0.15, yt + 0.08, dep - 0.2], [c - 0.15, yt + 0.08, dep - 0.2]], { toe: false });
      if (b.collecting) b.colQuad(a, yt, dep, c, yt, dep, c, yt, 0, a, yt, 0);
    }
    b.pop();
  }
}

// ---------------------------------------------------------------------------------------------
// sub-rects of the footprint (hall + annex plans)
// ---------------------------------------------------------------------------------------------
/** Footprint facade u (0 at the facade's left end seen from outside) of a building-frame point on `side`. */
export function fpU(side, w, d, x, z) {
  return side === 'front' ? x + w / 2 : side === 'right' ? d / 2 - z : side === 'back' ? w / 2 - x : z + d / 2;
}
/** Footprint facade u at which side `side` of sub-rect R starts (R's own facade u = fpU − this). */
export function rectStartU(side, w, d, R) {
  const p = side === 'front' ? [R.x0, R.z1] : side === 'right' ? [R.x1, R.z1] : side === 'back' ? [R.x1, R.z0] : [R.x0, R.z0];
  return fpU(side, w, d, p[0], p[1]);
}
export function rectLen(side, R) { return isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0; }
/** Split rect R along `side` into {strip (depth t against that side), rest}. */
export function splitRect(R, side, t) {
  const r = { ...R }, s = { ...R };
  if (side === 'front') { s.z0 = R.z1 - t; r.z1 = R.z1 - t; }
  else if (side === 'back') { s.z1 = R.z0 + t; r.z0 = R.z0 + t; }
  else if (side === 'right') { s.x0 = R.x1 - t; r.x1 = R.x1 - t; }
  else { s.x1 = R.x0 + t; r.x0 = R.x0 + t; }
  return { strip: s, rest: r };
}
/** Free u-intervals of a wall of length L where no opening overlaps the height band [y0, y1]. */
export function freeSpans(ops, L, y0, y1, margin = 0.35) {
  const cuts = (ops || []).filter((o) => o.v1 > y0 && o.v0 < y1).map((o) => [o.u0 - margin, o.u1 + margin]).sort((a, c) => a[0] - c[0]);
  const out = [];
  let u = 0.4;
  for (const [a, c] of cuts) { if (a > u + 0.1) out.push([u, a]); u = Math.max(u, c); }
  if (L - 0.4 > u + 0.1) out.push([u, L - 0.4]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// raised control room bay (闸务站 / 泵房: 抬高的控制室能看见闸池)
// ---------------------------------------------------------------------------------------------
/**
 * Glazed control-room bay projecting from the upper floor of footprint side `side` (wall frame of the
 * footprint): floor slab at yF, roof slab top at yT, glazed front (raked out 0.25 m like a tower cab) and
 * glazed cheeks, upstand, sunshade lip, steel cantilever beams + diagonal struts under the floor. 'full' adds
 * the floor finish, consoles + chairs at the window and colliders. The wall behind needs a 'blank' opening.
 * o: {dep=2.1, bayId (window-light bay), roomDepth}
 */
export function glazedBay(ctx, side, u0, u1, yF, yT, E, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const w = s._w, d = s._d;
  const dep = o.dep ?? 2.1, y0 = yF - 0.32, y1 = yT;
  const shell = E.shell === 'panel_insulated' ? 'panel_insulated' : 'panel_white';
  b.push(); K.facadeFrame(b, side, w, d, 0);
  // floor slab (with a soffit) + roof slab
  b.pushTint(E.shellTint);
  b.cbox(shell, u0, y0, -0.3, u1, yF + 0.05, dep, 0.02);
  b.cbox(shell, u0 - 0.15, y1 - 0.5, -0.3, u1 + 0.15, y1, dep + 0.2, 0.02);
  b.popTint();
  b.withTint(E.trimTint, () => b.box('panel_grey', u0 - 0.17, y1 - 0.12, -0.3, u1 + 0.17, y1 + 0.02, dep + 0.22, PY | PZ | PX | NX));
  b.withTint(E.trimTint, () => b.box('panel_grey', u0 - 0.02, y0 - 0.02, dep - 0.02, u1 + 0.02, y0 + 0.2, dep + 0.02, PZ | NY | PX | NX));
  const vg0 = yF + 0.95, vg1 = y1 - 0.55, zg0 = dep - 0.32, zg1 = dep - 0.07;
  // upstand under the glass (front + cheeks), solid corner posts
  b.withTint(E.shellTint, () => {
    b.box(shell, u0, yF + 0.05, dep - 0.4, u1, vg0, dep, PZ | PY | PX | NX);
    b.box(shell, u0, yF + 0.05, -0.05, u0 + 0.16, vg0, dep - 0.4, PY | NX);
    b.box(shell, u1 - 0.16, yF + 0.05, -0.05, u1, vg0, dep - 0.4, PY | PX);
  });
  for (const u of [u0 + 0.1, u1 - 0.1]) b.box('panel_grey', u - 0.1, vg0, zg0 - 0.06, u + 0.1, y1 - 0.5, dep, ALL);
  const room = { u0: 0.5, w: u1 - u0, d: dep + (o.roomDepth ?? 4), h: 2.9, sill: 0.95, kind: K.ROOM_KIND.office, seed: 0.4, floor: o.floor ?? 1, bay: o.bayId ?? Math.floor((perimU(side, w, d) + (u0 + u1) / 2) / BAY_W), hash: s.hash, profile: s._profile | 0 };
  const glass = ctx.full ? 'glass_clear' : 'glass_window';
  const n = Math.max(3, Math.round((u1 - u0 - 0.4) / 1.35));
  const ga = u0 + 0.2, gc = u1 - 0.2, hh = Math.hypot(vg1 - vg0, zg1 - zg0);
  for (let i = 0; i < n; i++) {
    const a = ga + ((gc - ga) * i) / n, c = ga + ((gc - ga) * (i + 1)) / n;
    K.setGlassRoom(b, { ...room, u0: a - u0 }, 0, 0);
    b.quad(glass, a, vg0, zg0, c, vg0, zg0, c, vg1, zg1, a, vg1, zg1, [0, 0, c - a, 0, c - a, hh, 0, hh]);
    if (i > 0) b.tube('aluminium_dark', [[a, vg0, zg0 + 0.02], [a, vg1, zg1 + 0.02]], 0.035, 6);
  }
  K.clearGlassRoom(b);
  b.box('aluminium_dark', ga, vg0 - 0.04, zg0 - 0.06, gc, vg0 + 0.03, zg0 + 0.06, ALL);
  b.box('aluminium_dark', ga, vg1 - 0.03, zg1 - 0.06, gc, vg1 + 0.04, zg1 + 0.06, ALL);
  // cheek glazing (trapezoids following the rake), outward normals ∓u
  K.setGlassRoom(b, { ...room, u0: 0.2, w: dep }, 0, 0);
  b.quad(glass, u0 + 0.01, vg0, 0.0, u0 + 0.01, vg0, zg0 - 0.06, u0 + 0.01, vg1, zg1 - 0.06, u0 + 0.01, vg1, 0.0, [0, 0, zg0, 0, zg1, vg1 - vg0, 0, vg1 - vg0]);
  b.quad(glass, u1 - 0.01, vg0, zg0 - 0.06, u1 - 0.01, vg0, 0.0, u1 - 0.01, vg1, 0.0, u1 - 0.01, vg1, zg1 - 0.06, [0, 0, zg0, 0, zg1, vg1 - vg0, 0, vg1 - vg0]);
  K.clearGlassRoom(b);
  for (const u of [u0 + 0.02, u1 - 0.02]) { b.box('aluminium_dark', u - 0.03, vg0 - 0.03, 0.0, u + 0.03, vg0 + 0.03, zg0 - 0.06, ALL); b.box('aluminium_dark', u - 0.03, vg1 - 0.03, 0.0, u + 0.03, vg1 + 0.03, zg1 - 0.06, ALL); }
  // sunshade lip over the glass
  b.withTint(E.trimTint, () => b.box('panel_grey', u0, vg1 + 0.05, dep - 0.05, u1, vg1 + 0.13, dep + 0.6, ALL));
  // steel cantilever beams under the floor + diagonal struts back to the wall
  const nB = Math.max(2, Math.round((u1 - u0) / 3.2) + 1);
  for (let k = 0; k < nB; k++) {
    const u = u0 + 0.35 + ((u1 - u0 - 0.7) * k) / (nB - 1);
    b.box('steel_dark', u - 0.08, y0 - 0.32, -0.02, u + 0.08, y0, dep - 0.05, PX | NX | NY | PZ);
    b.box('steel_dark', u - 0.15, y0 - 0.34, -0.02, u + 0.15, y0 - 0.3, dep - 0.05, ALL);
    b.box('steel_dark', u - 0.2, y0 - 2.2, 0.0, u + 0.2, y0 - 1.75, 0.04, ALL);
    b.tube('steel_dark', [[u, y0 - 1.95, 0.05], [u, y0 - 0.33, dep - 0.35]], 0.07, 8);
  }
  if (ctx.full) {
    b.rectY('tile_floor', u0 + 0.16, -0.25, u1 - 0.16, dep - 0.4, yF + 0.06, 1);
    const zi = -((E.wallT ?? 0.32) + 0.06);          // bay floor runs through the wall opening onto the room slab
    if (b.collecting) b.colQuad(u0, yF + 0.06, dep, u1, yF + 0.06, dep, u1, yF + 0.06, zi, u0, yF + 0.06, zi);
    b.withTint([0.95, 0.95, 0.94], () => b.rectY('plaster', u0 + 0.16, -0.25, u1 - 0.16, dep - 0.1, y1 - 0.5 - 0.005, -1));
    if (o.consoles !== false) {
      consoleRow(b, (u0 + u1) / 2, yF + 0.06, dep - 0.95, Math.min(5, u1 - u0 - 1.2));
      chairAt(b, (u0 + u1) / 2 - 1.0, yF + 0.06, dep - 1.9);
      chairAt(b, (u0 + u1) / 2 + 1.1, yF + 0.06, dep - 1.8);
    }
    if (b.collecting) { b.colBox(u0, yF, dep - 0.4, u1, vg1, dep); b.colBox(u0, yF, 0, u0 + 0.16, vg1, dep); b.colBox(u1 - 0.16, yF, 0, u1, vg1, dep); }
  }
  b.pop();
  return { dep, vg0, vg1 };
}
function perimU(side, w, d) { return K.perimeterU(side, w, d); }
/** Console desk with monitors facing +z (window), local helper for glazedBay (current frame). */
function consoleRow(b, x, y, z, w) {
  b.push(); b.translate(x, y, z);
  b.cbox('cabinet', -w / 2, 0, -0.35, w / 2, 0.72, 0.35, 0.01, false);
  b.push(); b.translate(0, 0.72, 0.2); b.rotX(0.35); b.cbox('steel_dark', -w / 2 + 0.05, 0, -0.12, w / 2 - 0.05, 0.03, 0.12, 0.005); b.pop();
  const n = Math.max(1, Math.round(w / 0.8));
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (w * (i + 0.5)) / n;
    b.cbox('black', cx - 0.3, 0.78, 0.26, cx + 0.3, 1.18, 0.3, 0.005);
    b.withTint([0.35, 0.6, 0.75], () => b.rectZ('light_cyan', cx - 0.27, 0.81, cx + 0.27, 1.15, 0.258, -1));
    b.box('steel_dark', cx - 0.03, 0.72, 0.28, cx + 0.03, 0.8, 0.32, ALL);
  }
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.colBox(-w / 2, 0, -0.35, w / 2, 0.75, 0.35); b.pop(); }
}
function chairAt(b, x, y, z) {
  b.push(); b.translate(x, y, z);
  b.cylinder('steel_dark', 0, 0.05, 0, 0.03, 0.4, 6, { top: false });
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.box('steel_dark', Math.cos(a) * 0.25 - 0.02, 0.02, Math.sin(a) * 0.25 - 0.02, Math.cos(a) * 0.25 + 0.02, 0.06, Math.sin(a) * 0.25 + 0.02, ALL); }
  b.withTint([0.25, 0.28, 0.32], () => { b.cbox('fabric', -0.24, 0.44, -0.24, 0.24, 0.52, 0.24, 0.02); b.cbox('fabric', -0.22, 0.55, -0.27, 0.22, 1.0, -0.22, 0.02); });
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// outside monorail hoist over a maintenance door (泵房的检修门通到设备吊装面)
// ---------------------------------------------------------------------------------------------
/**
 * Wall frame of the facade (x = u, z outward, wall face z = 0): yellow I-beam monorail leaving the wall
 * above the door at soffit height y, projecting `out` m, tie rod to the wall, end stops, trolley with an
 * electric chain hoist and hook block at hookY, wall plate; yellow hatched lifting square on the apron at gy.
 * o: {u, y, out=3.8, inside=1.2 ('full' stub inside), hookY, gy, tieY (wall anchor of the tie rod)}
 */
export function hoistBeam(b, o) {
  const u = o.u, y = o.y, out = o.out ?? 3.8, ins = o.inside ?? 0;
  const k = 'steel_yellow';
  const z0 = -ins;
  b.box(k, u - 0.055, y + 0.04, z0, u + 0.055, y + 0.38, out, PX | NX | PZ);
  b.box(k, u - 0.16, y, z0, u + 0.16, y + 0.045, out, ALL);
  b.box(k, u - 0.16, y + 0.375, z0, u + 0.16, y + 0.42, out, ALL);
  b.box('steel_dark', u - 0.35, y - 0.25, 0.0, u + 0.35, y + 0.7, 0.03, ALL);                 // wall plate
  b.box('steel_dark', u - 0.2, y - 0.12, out - 0.12, u + 0.2, y + 0.05, out - 0.04, ALL);    // end stop
  const tieY = o.tieY ?? y + 1.7;
  b.tube('steel', [[u, y + 0.42, out - 0.35], [u, tieY, 0.06]], 0.025, 6);
  b.box('steel_dark', u - 0.12, tieY - 0.12, 0.0, u + 0.12, tieY + 0.12, 0.05, ALL);
  // trolley + hoist + chain + hook block
  const tz = o.trolley ?? out * 0.62;
  b.box('steel_dark', u - 0.2, y - 0.2, tz - 0.22, u + 0.2, y + 0.03, tz + 0.22, ALL);
  for (const sx of [-1, 1]) b.box('steel_dark', u + sx * 0.17 - 0.02, y + 0.03, tz - 0.2, u + sx * 0.17 + 0.02, y + 0.2, tz + 0.2, ALL);
  b.withTint([1, 1, 1], () => b.cbox(k, u - 0.22, y - 0.78, tz - 0.3, u + 0.22, y - 0.2, tz + 0.25, 0.02));
  b.cbox('steel_dark', u - 0.12, y - 0.68, tz + 0.25, u + 0.12, y - 0.3, tz + 0.42, 0.01);   // motor
  const hookY = o.hookY ?? y - 2.6;
  b.cylinder('steel_dark', u, hookY + 0.3, tz, 0.012, Math.max(0.1, y - 0.78 - hookY - 0.3), 4, { top: false });
  b.withTint([1, 1, 1], () => b.cbox(k, u - 0.11, hookY, tz - 0.14, u + 0.11, hookY + 0.32, tz + 0.14, 0.015));
  b.tube('steel_dark', [[u, hookY, tz], [u, hookY - 0.18, tz], [u + 0.07, hookY - 0.28, tz], [u + 0.13, hookY - 0.2, tz]], 0.028, 6);
  // lifting zone (yellow hatched square on the apron under the hook)
  if (o.gy !== undefined) {
    const gy = o.gy + 0.012, h = 1.3;
    for (const [a, c, e, f] of [[u - h, tz - h, u + h, tz - h + 0.1], [u - h, tz + h - 0.1, u + h, tz + h], [u - h, tz - h, u - h + 0.1, tz + h], [u + h - 0.1, tz - h, u + h, tz + h]]) b.box(k, a, gy - 0.008, c, e, gy, f, PY);
    for (let i = -2; i <= 2; i++) { b.push(); b.translate(u + i * 0.45, gy - 0.004, tz); b.rotY(Math.PI / 4); b.box(k, -0.05, -0.004, -0.62 + Math.abs(i) * 0.18, 0.05, 0.0, 0.62 - Math.abs(i) * 0.18, PY); b.pop(); }
  }
}

/** Standard anchors for utility types (cameras on the front, back, roof; entrances from a list). */
export function utilAnchors(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const A = b.anchors;
  const w = s._w, d = s._d;
  A.floors = o.floors || [{ level: 0, y: o.ffl ?? 0.2, height: o.h ?? 4.5 }];
  A.roof = { y: o.roofY ?? 5, access: o.access || [0, o.roofY ?? 5, 0] };
  for (const e of o.entrances || []) A.entrances.push(e);
  if (o.rooms) A.rooms = o.rooms;
  const H = o.roofY ?? 5;
  const C = A.cameras;
  C.street = { pos: [-w * 0.15, 1.65, d / 2 + Math.max(16, w * 0.9)], target: [0, Math.min(H * 0.45, 8), 0] };
  const me = (o.entrances || [])[0];
  if (me) {
    const p = me.pos, n = me.dir;
    C.entrance = { pos: [p[0] + n[0] * 5 + n[2] * 1.5, p[1] + 1.65, p[2] + n[2] * 5 - n[0] * 1.5], target: [p[0] - n[0] * 2, p[1] + 1.3, p[2] - n[2] * 2] };
  }
  C.back = { pos: [w * 0.25, 1.65 + Math.max(0, s._ground.br), -d / 2 - Math.max(12, w * 0.6)], target: [0, H * 0.4, -d / 2] };
  C.roof = { pos: [-w * 0.3, H + Math.max(8, w * 0.5), d / 2 + w * 0.4], target: [0, H, 0] };
  if (o.cameras) Object.assign(C, o.cameras);
}
