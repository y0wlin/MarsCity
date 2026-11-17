// Curtain walls, lofted fins and glass-building facades for the Zhurong family (owner: buildings-z).
// Helper module (no default export): curtainRun (one facade run in a wall frame), curtainFacades
// (all sides of a rect PlanModel with doors), finLoft (lofted blade along a 3D centreline with an
// explicitly oriented section — robust for vertical fins), sweepFin (Z03-right white curved fins).
//
// Window-light ids: every vision pane carries the room info of its floor + bay
// (bay = floor((perimeterU(side) + u_centre) / bayW)), so occupancy lights agree with the far
// facade shader (mass LOD) when the massing uses the same bayW / floorH / groundH.

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, isFB } from './z_common.js';

/**
 * One curtain-wall run in the CURRENT WALL FRAME (x = u along the facade 0..L, y up, z outward;
 * glass plane at z = 0, mullions project to +mullD).
 * o: { L, floors:[{level,y,h}], y0 (bottom), y1 (top edge), bayW, perim (perimeter u of u = 0),
 *      slabT=0.25, spandrel=0.75 (opaque band below each slab), depth (room depth, interior mapping),
 *      frameKey, glassKey, spandrelKey, spandrelTint, mullD=0.16, mullW=0.07, kind ('office'),
 *      holes:[[u0,u1,v0,v1]] (door / opening cut-outs), back (emit inner faces), capStart, capEnd,
 *      vision(level) → [v0,v1] override, groupBays=3 }
 */
export function curtainRun(b, ctx, o) {
  const s = ctx.spec;
  const L = o.L;
  if (L < 0.3) return;
  const n = Math.max(1, Math.round(L / (o.bayW || 3.0)));
  const bay = L / n;
  const fk = o.frameKey || 'aluminium', gk = o.glassKey || (ctx.full ? 'glass_clear' : 'glass_window');
  const sk = o.spandrelKey || 'aluminium_dark';
  const md = o.mullD ?? 0.16, mw = o.mullW ?? 0.07, sp = o.spandrel ?? 0.75;
  const holes = o.holes || [];
  const kind = typeof o.kind === 'string' ? kindCode(o.kind) : (o.kind ?? kindCode('office'));
  const grp = o.groupBays ?? 3;
  const hidden = (u0, u1, v0, v1) => holes.some((h) => u0 < h[1] - 1e-3 && u1 > h[0] + 1e-3 && v0 < h[3] - 1e-3 && v1 > h[2] + 1e-3);
  const fl = o.floors;
  // horizontal zones: [v0, v1, type] — 'vision' or 'spandrel'
  const zones = [];
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    const top = i === fl.length - 1 ? o.y1 : fl[i + 1].y;
    const vb = i === 0 ? Math.max(o.y0, f.y) : f.y + 0.12;
    let v0 = vb, v1 = (i === fl.length - 1 ? Math.min(top, f.y + f.h) : top) - sp;
    if (o.vision) { const vv = o.vision(f.level); if (vv) { v0 = vv[0]; v1 = vv[1]; } }
    if (i === 0 && o.y0 < f.y - 0.01) zones.push([o.y0, f.y + 0.0, 'spandrel', f]);
    if (v1 - v0 > 0.4) zones.push([v0, v1, 'vision', f]);
    const s0 = Math.max(v1, v0), s1 = i === fl.length - 1 ? o.y1 : fl[i + 1].y + 0.12;
    if (s1 - s0 > 0.02) zones.push([s0, s1, 'spandrel', f]);
  }
  // panes
  for (const [v0, v1, type, f] of zones) {
    for (let k = 0; k < n; k++) {
      const a = k * bay + mw / 2, c = (k + 1) * bay - mw / 2;
      if (hidden(a, c, v0, v1)) continue;
      if (type === 'vision') {
        const uc = (k + 0.5) * bay;
        const bayId = Math.floor(((o.perim || 0) + uc) / (o.bayW || 3.0));
        const g = k % grp;
        const kk = o.kindFn ? kindCode(o.kindFn(f.level)) : kind;
        const room = { u0: g * bay + mw / 2, w: grp * bay, d: o.depth ?? 8, h: Math.max(2.6, f.h - (o.slabT ?? 0.25) - 0.3), sill: v0 - f.y, kind: kk, seed: (((s.hash >>> 5) % 991) / 991 + k * 0.381 + f.level * 0.137) % 1, floor: f.level, bay: bayId, hash: s.hash, profile: s._profile | 0 };
        K.setGlassRoom(b, room, 0, 0);
        b.quad(gk, a, v0 + mw / 2, 0, c, v0 + mw / 2, 0, c, v1 - mw / 2, 0, a, v1 - mw / 2, 0, [0, 0, c - a, 0, c - a, v1 - v0 - mw, 0, v1 - v0 - mw]);
        if (o.back) b.quad(gk, c, v0 + mw / 2, -0.002, a, v0 + mw / 2, -0.002, a, v1 - mw / 2, -0.002, c, v1 - mw / 2, -0.002, [0, 0, c - a, 0, c - a, v1 - v0 - mw, 0, v1 - v0 - mw]);
      } else {
        K.clearGlassRoom(b);
        if (o.spandrelTint) b.pushTint(o.spandrelTint);
        b.rectZ(sk, a, v0, c, v1, -0.02, 1);
        if (o.back) b.rectZ('plaster', a, v0, c, v1, -0.06, -1);
        if (o.spandrelTint) b.popTint();
      }
    }
  }
  K.clearGlassRoom(b);
  // mullions (full height, split around holes) + transoms at zone edges
  const vTop = o.y1, vBot = o.y0;
  for (let k = 0; k <= n; k++) {
    const u = k * bay;
    if ((k === 0 && o.capStart === false) || (k === n && o.capEnd === false)) continue;
    const segs = [[vBot, vTop]];
    for (const h of holes) {
      if (u < h[0] - 0.01 || u > h[1] + 0.01) continue;
      for (let i = segs.length - 1; i >= 0; i--) { const [p, q] = segs[i]; if (h[3] <= p || h[2] >= q) continue; segs.splice(i, 1); if (h[2] - p > 0.05) segs.push([p, h[2]]); if (q - h[3] > 0.05) segs.push([h[3], q]); }
    }
    const d = k === 0 || k === n ? md * 0.7 : md;
    for (const [p, q] of segs) b.box(fk, u - mw / 2, p, -0.06, u + mw / 2, q, d, 1 | 2 | 16 | 4);
  }
  const lines = new Set();
  for (const z of zones) { lines.add(+z[0].toFixed(3)); lines.add(+z[1].toFixed(3)); }
  for (const v of lines) {
    if (v <= vBot + 0.01 || v >= vTop - 0.01) continue;
    for (let k = 0; k < n; k++) {
      const a = k * bay + mw / 2, c = (k + 1) * bay - mw / 2;
      if (hidden(a, c, v - 0.04, v + 0.04)) continue;
      b.box(fk, a, v - mw / 2, -0.05, c, v + mw / 2, md * 0.55, 16 | 4 | 8);
    }
  }
  // top cap
  b.box(fk, 0, vTop - 0.02, -0.08, L, vTop + 0.06, md + 0.02, 63);
}

/**
 * Curtain-wall facades for every side of a rect PlanModel (setback groups honoured), with door
 * cut-outs + glazed doors for plan.extraOpenings of kind 'door' and solid party walls.
 * o: {bayW, depth, spandrel, frameKey, spandrelKey, spandrelTint, mullD, skipSides:{side:true}, top (y)}
 */
export function curtainFacades(ctx, plan, o = {}) {
  const b = ctx.b, st = ctx.style, inst = ctx.inst;
  const w = plan.w, d = plan.d;
  const top = o.top ?? (plan.roof.y + (plan.roof.wallParapet ?? plan.roof.parapet ?? 1.1));
  const all = [];
  for (const f of plan.floors) for (const op of f.openings || []) all.push(op);
  for (const op of plan.extraOpenings || []) all.push(op);
  plan.allOpenings = all;
  for (const side of ['front', 'right', 'back', 'left']) {
    if (o.skipSides && o.skipSides[side]) continue;
    const L = isFB(side) ? w : d;
    b.push(); K.facadeFrame(b, side, w, d, 0);
    if (plan.shared[side]) {
      b.pushTint(inst.shellTint);
      K.wallWithOpenings(b, { L, y0: plan.ffl - 0.3, y1: top, T: 0.3, openings: [], outer: st.wall, inner: ctx.full ? 'plaster' : null, capStart: false, capEnd: false });
      b.popTint();
      b.pop();
      continue;
    }
    const doors = all.filter((op) => op.side === side && op.kind === 'door');
    const holes = doors.map((op) => [op.u0 - 0.04, op.u1 + 0.04, op.v0 - 0.05, op.v1 + 0.05]);
    const perim = K.perimeterU(side, w, d);
    curtainRun(b, ctx, { L, floors: plan.floors, y0: plan.ffl - 0.05, y1: top, bayW: o.bayW || plan.bayW, perim, slabT: plan.slabT, spandrel: o.spandrel ?? 0.75, depth: o.depth ?? Math.min(9, (isFB(side) ? d : w) * 0.45), frameKey: o.frameKey, spandrelKey: o.spandrelKey, spandrelTint: o.spandrelTint, mullD: o.mullD, holes, back: ctx.full && o.back !== false, glassKey: o.glassKey, kind: o.kind, kindFn: o.kindFn });
    for (const op of doors) {
      // door frame: head transom + jambs in the glass plane, then the door unit
      b.box('aluminium_dark', op.u0 - 0.08, op.v1, -0.08, op.u1 + 0.08, op.v1 + 0.12, 0.08, 63);
      for (const u of [op.u0 - 0.06, op.u1 + 0.06]) b.box('aluminium_dark', u - 0.04, op.v0, -0.08, u + 0.04, op.v1, 0.08, 63 & ~8);
      K.doorUnit(b, { u0: op.u0, u1: op.u1, v0: op.v0, v1: op.v1, R: 0.0, kind: op.doorKind || 'glazed_double', glassKey: ctx.full ? 'glass_clear' : 'glass_shop', open: 0 });
      // transom glass above the door up to the next zone line
      const tf = plan.floors[op.floor ?? 0];
      const tv1 = Math.min(tf.y + tf.h - (o.spandrel ?? 0.75), op.v1 + 2.5);
      if (tv1 - op.v1 > 0.4) {
        K.setGlassRoom(b, { u0: 0.4, w: op.u1 - op.u0 + 1, d: 6, h: 4, sill: op.v1 - plan.ffl + 0.12, kind: kindCode('lobby'), seed: 0.4, floor: 0, bay: 0, hash: ctx.spec.hash, profile: ctx.spec._profile | 0 }, 0, 0);
        b.quad(ctx.full ? 'glass_clear' : 'glass_shop', op.u0 - 0.04, op.v1 + 0.12, 0, op.u1 + 0.04, op.v1 + 0.12, 0, op.u1 + 0.04, tv1, 0, op.u0 - 0.04, tv1, 0, [0, 0, 1, 0, 1, 1, 0, 1]);
        K.clearGlassRoom(b);
      }
    }
    b.pop();
  }
  // corner posts (closing the mullion grid at the four corners)
  const fk = o.frameKey || 'aluminium';
  for (const [sx, sz, sh] of [[-1, 1, ['left', 'front']], [1, 1, ['front', 'right']], [1, -1, ['right', 'back']], [-1, -1, ['back', 'left']]]) {
    if (plan.shared[sh[0]] && plan.shared[sh[1]]) continue;
    const x = sx * w / 2, z = sz * d / 2;
    b.box(fk, x - 0.09, plan.ffl - 0.05, z - 0.09, x + 0.09, top, z + 0.09, 1 | 2 | 16 | 32);
  }
}

/**
 * Lofted blade along a centreline. pts [[x,y,z]...] (≥ 2), section in the horizontal plane spanned
 * by n (depth axis, unit [x,z]) and u = (n.z, −n.x) (thickness axis). o: {depth(t)|number, thick(t)|number,
 * seg=10 (section points; even), key, capTop, capBottom, shape:'ellipse'|'blade'}
 * Normals from the section (fins are near-vertical).
 */
export function finLoft(b, key, pts, n, o = {}) {
  const m = pts.length;
  if (m < 2) return;
  const seg = o.seg ?? 12;
  const D = typeof o.depth === 'function' ? o.depth : () => o.depth ?? 0.6;
  const Th = typeof o.thick === 'function' ? o.thick : () => o.thick ?? 0.3;
  const N = typeof n === 'function' ? n : () => n;
  const p = b.part(key);
  const prev = b.uvMode; b.uvMode = 1;
  const rings = [];
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1);
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const nn = N(t), nx = nn[0], nz = nn[1], ux = nz, uz = -nx;
    const dd = D(t), th = Th(t);
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      let cn = Math.cos(a), cu = Math.sin(a);
      // 'blade': pointed front, rounded back
      const sx = cn * dd * 0.5, su = cu * th * 0.5;
      let gn = cn / Math.max(dd, 1e-3), gu = cu / Math.max(th, 1e-3);
      const gl = Math.hypot(gn, gu) || 1; gn /= gl; gu /= gl;
      const x = pts[i][0] + nx * sx + ux * su, z = pts[i][2] + nz * sx + uz * su;
      const NX = nx * gn + ux * gu, NZ = nz * gn + uz * gu;
      ring.push(b.vert(p, x, pts[i][1], z, NX, 0, NZ, (k / seg) * (dd + th) * 1.6, acc));
    }
    rings.push(ring);
  }
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    b.q(p, rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]);
  }
  b.uvMode = prev;
  // caps
  const cap = (i, up) => {
    const ring = rings[i];
    const c = pts[i];
    const ci = b.vert(p, c[0], c[1], c[2], 0, up ? 1 : -1, 0, 0, 0);
    const ids = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, nn = N(i / (m - 1)), dd = D(i / (m - 1)), th = Th(i / (m - 1));
      const x = c[0] + nn[0] * Math.cos(a) * dd * 0.5 + nn[1] * Math.sin(a) * th * 0.5, z = c[2] + nn[1] * Math.cos(a) * dd * 0.5 - nn[0] * Math.sin(a) * th * 0.5;
      ids.push(b.vert(p, x, c[1], z, 0, up ? 1 : -1, 0, 0, 0));
    }
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; if (up) b.tri(p, ci, ids[k], ids[k2]); else b.tri(p, ci, ids[k2], ids[k]); }
    void ring;
  };
  if (o.capTop !== false) cap(m - 1, true);
  if (o.capBottom) cap(0, false);
}

/**
 * Z03-right fins: tall white blades in front of a facade (wall frame of `side`), rising from the
 * ground, swelling outwards in the middle and leaning sideways (S-curve). o: {us:[u...], y0, y1,
 * off (distance in front of the glass), bulge, lean, depth, thick, key}
 */
export function facadeFins(ctx, plan, side, o) {
  const b = ctx.b;
  const w = plan.w, d = plan.d;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  for (let i = 0; i < o.us.length; i++) {
    const u = o.us[i];
    const lean = (o.lean ?? 1.2) * (o.leanDir ? o.leanDir[i] : (i % 2 ? -1 : 1));
    const pts = [];
    const N = 16;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const y = o.y0 + (o.y1 - o.y0) * t;
      const bul = Math.sin(t * Math.PI) * (o.bulge ?? 0.9);
      const lu = lean * (Math.sin((t - 0.5) * Math.PI) * 0.5 + 0.5) - lean * 0.5;
      pts.push([u + lu, y, (o.off ?? 0.6) + bul]);
    }
    b.withTint(o.tint || ctx.inst.bandTint, () => finLoft(b, o.key || 'ceramic_band', pts, [0, 1], {
      depth: (t) => (o.depth ?? 0.9) * (0.75 + 0.5 * Math.sin(t * Math.PI)), thick: o.thick ?? 0.32, seg: 14, capTop: true, capBottom: false,
    }));
  }
  b.pop();
}

export { clamp };
