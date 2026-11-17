// Steps, ramps, handrails, switchback stair cores and lift shafts.
// Exterior steps: riser 0.15–0.17, tread 0.28–0.30; ramps ≤ 1:12 with landings and handrails
// (0.9 m + 0.7 m rails). Stair cores are real walkable switchback stairs with landings,
// balustrades and handrails; colliders get inclined ramps over each flight.
//
// Local frames: functions document their own frame. Facade-attached elements use the wall
// frame (x along facade, y up, z outward, facade plane z=0).

import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';
import { capIndices } from './primitives.js';

/** Riser count & height for a rise (target 0.16, max 0.17). */
export function risers(rise, max = 0.17) { const n = Math.max(1, Math.ceil(rise / max - 1e-6)); return { n, h: rise / n }; }

/**
 * Handrail along a polyline (rail top line) with posts every `spacing` dropping `height` to the
 * walking surface. o: {key='steel', r=0.021, height=0.9, spacing=1.2, posts=true, lower=false (0.7 m rail)}
 */
export function handrail(b, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const key = o.key || 'steel', r = o.r ?? 0.021, H = o.height ?? 0.9;
  // end returns: turn down 0.1 m at both ends
  const a = pts[0], z = pts[pts.length - 1];
  const path = [[a[0], a[1] - 0.12, a[2]], ...pts, [z[0], z[1] - 0.12, z[2]]];
  b.tube(key, path, r, 10, { transport: true });
  if (o.lower) b.tube(key, pts.map((p) => [p[0], p[1] - 0.2, p[2]]), r * 0.8, 8, { transport: true });
  if (o.posts !== false) {
    const spacing = o.spacing ?? 1.2;
    let acc = 0;
    const emitPost = (p) => b.tube(o.postKey || key, [[p[0], p[1] - H, p[2]], [p[0], p[1] - r, p[2]]], r * 0.85, 8);
    emitPost(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      let t = spacing - acc;
      while (t < L - 0.05) { const k = t / L; emitPost([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]); t += spacing; }
      acc = (acc + L) % spacing;
    }
    emitPost(pts[pts.length - 1]);
  }
}

/**
 * Exterior entrance steps in the WALL FRAME, running outward (+z) from the landing edge.
 * o: {u0, u1 (width along facade), z0 (landing front edge), y0 (ground at foot), y1 (top level),
 *     key='stone_step', buried=0.4, cheeks:boolean, cheekKey, rails:boolean}
 * Returns {zEnd} (z of the foot of the steps).
 */
export function steps(b, o) {
  const rise = o.y1 - o.y0;
  if (rise < 0.04) return { zEnd: o.z0 };
  const { n, h } = risers(rise, 0.165);
  const tread = o.tread ?? 0.3;
  const key = o.key || 'stone_step';
  const base = Math.min(o.y0, o.y1) - (o.buried ?? 0.45);
  // stepped profile in (z,y): s = t × up with t = +x → s = +z ✓; CCW with z right, y up
  const prof = [[o.z0 - 0.05, base], [o.z0 + n * tread, base]];
  for (let i = 0; i < n; i++) {
    const zf = o.z0 + (n - i) * tread, y = o.y0 + (i + 1) * h;
    prof.push([zf, y - h]); // already at riser foot
    prof.push([zf, y - 0.012]); prof.push([zf - 0.012, y]); // chamfered nosing
    prof.push([zf - tread, y]);
  }
  prof.push([o.z0 - 0.05, o.y1]);
  const clean = [];
  for (const p of prof) { const q = clean[clean.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) clean.push(p); }
  b.push(); b.translate(o.u0, 0, 0);
  b.extrudeX(key, clean, 0, o.u1 - o.u0);
  b.pop();
  const zEnd = o.z0 + n * tread;
  // cheek walls with sloped coping
  if (o.cheeks) {
    const ck = o.cheekKey || 'stone_plinth', t = 0.2;
    for (const [ua, ub] of [[o.u0 - t, o.u0], [o.u1, o.u1 + t]]) {
      const cp = [[o.z0 - 0.05, base], [zEnd + 0.05, base], [zEnd + 0.05, o.y0 + 0.15], [o.z0 + 0.15, o.y1 + 0.15], [o.z0 - 0.05, o.y1 + 0.15]];
      b.push(); b.translate(ua, 0, 0); b.extrudeX(ck, cp, 0, ub - ua); b.pop();
    }
  }
  if (o.rails && n >= 2) {
    for (const u of [o.u0 + 0.12, o.u1 - 0.12]) {
      handrail(b, [[u, o.y1 + 0.9, o.z0 - 0.3], [u, o.y1 + 0.9, o.z0 + 0.15], [u, o.y0 + 0.9, zEnd - 0.05], [u, o.y0 + 0.9, zEnd + 0.3]], { key: o.railKey || 'steel', spacing: 1.1 });
    }
  }
  if (b.collecting) b.colQuad(o.u0, o.y1, o.z0, o.u1, o.y1, o.z0, o.u1, o.y0, zEnd, o.u0, o.y0, zEnd);
  return { zEnd };
}

/**
 * Ramp along the facade (wall frame). Rises from (uStart, y0) to (uEnd, y1) at distance z0..z1
 * from the facade (z0 < z1). Slope clamped to ≤ 1:12 by extending its length if needed (returns
 * the actual start u). Side upstands, handrails both sides at 0.9 m (+0.7 m lower rail).
 */
export function rampAlong(b, o) {
  const rise = o.y1 - o.y0;
  if (rise < 0.03) return o.uEnd;
  const dir = o.uStart < o.uEnd ? 1 : -1;
  const minLen = rise * 12;
  let L = Math.abs(o.uEnd - o.uStart);
  if (L < minLen) L = minLen;
  const uS = o.uEnd - dir * L;
  const key = o.key || 'concrete_smooth';
  const base = o.y0 - 0.45;
  const za = o.z0, zb = o.z1;
  // ramp body: profile in (u, y) extruded across z
  b.push();
  // frame: x' = z (across), we want extrusion along z: use sweep with path along z
  const ua = Math.min(uS, o.uEnd), ub = Math.max(uS, o.uEnd);
  const yA = dir > 0 ? o.y0 : o.y1, yB = dir > 0 ? o.y1 : o.y0;
  // top surface + sides as a prism-like extrusion: path along +z from za to zb, profile (s,y) with s = t×up = z×y = −x
  const prof = [[-ua, base], [-ua, yA], [-ub, yB], [-ub, base]].map((p) => [p[0], p[1]]);
  // ensure CCW in (s,y): s = −u. compute signed area and reverse if needed
  let ar = 0; for (let i = 0, j = prof.length - 1; i < prof.length; j = i++) ar += prof[j][0] * prof[i][1] - prof[i][0] * prof[j][1];
  b.sweep(key, [[0, 0, za], [0, 0, zb]], ar > 0 ? prof : prof.slice().reverse(), { smoothAngle: 5 });
  b.pop();
  // upstands (kerbs) on the open side + handrails both sides
  const rk = o.railKey || 'steel';
  const zr = [za + 0.1, zb - 0.1];
  for (const z of zr) {
    handrail(b, [[uS - dir * 0.3, o.y0 + 0.9, z], [uS, o.y0 + 0.9, z], [o.uEnd, o.y1 + 0.9, z], [o.uEnd + dir * 0.25, o.y1 + 0.9, z]], { key: rk, lower: true, spacing: 1.2 });
  }
  b.cbox(o.kerbKey || 'stone_plinth', ua, base, zb - 0.02, ub, Math.max(yA, yB) + 0.1, zb + 0.12, 0.01);
  if (b.collecting) b.colQuad(ua, yA, zb, ub, yB, zb, ub, yB, za, ua, yA, za);
  return uS;
}

/**
 * Switchback stair for one storey of a stair well (real, walkable).
 * Local frame: x across the well (0..W), z along the flights (0 = floor-landing side, Lz =
 * half-landing end), y up from this floor's FFL. The floor landing occupies z∈[0,landD]
 * (drawn by the caller as part of the floor). Flight A rises from z=landD towards +z on the
 * x∈[0,fw] side to the half landing; flight B returns on the x∈[W−fw,W] side and arrives at
 * the next floor's landing edge (z=landD). Ground floors may pass split:[n1,n2] so the half
 * landing is high enough (≥2.35 m) to walk under flight B to a back door.
 * o: { W, Lz, landD=1.4, halfD=1.3, rise, fw, key (treads), soffitKey='plaster' (waist, edges,
 *      landing soffit), railKey, top (no flight B), split }
 */
export function stairFlights(b, o) {
  const W = o.W, fw = o.fw ?? Math.min(1.25, (W - 0.12) / 2), gap = W - 2 * fw;
  const rise = o.rise, landD = o.landD ?? 1.4, halfD = o.halfD ?? 1.3, Lz = o.Lz;
  const run = Math.max(1.0, Lz - landD - halfD);
  let { n } = risers(rise, 0.172);
  if (n % 2) n++;
  const n1 = o.split ? o.split[0] : n / 2, n2 = o.split ? o.split[1] : n - n / 2;
  const h = rise / (n1 + n2);
  const t1 = Math.min(0.3, run / Math.max(1, n1 - 1)), t2 = Math.min(0.3, run / Math.max(1, n2 - 1));
  const key = o.key || 'stone_step';
  const yHalf = n1 * h;
  const slab = 0.18;
  const zA1 = landD + (n1 - 1) * t1;          // flight A top riser
  const zB0 = landD + (n2 - 1) * t2;          // flight B bottom riser
  const sk = o.soffitKey || 'plaster';
  flight(b, key, 0, fw, landD, +1, n1, h, t1, 0, sk);
  if (!o.top) flight(b, key, W - fw, W, zB0, -1, n2, h, t2, yHalf, sk);
  // half landing: A side from zA1, B side from zB0, both to Lz; stone top, plastered edge + soffit
  const landing = (xa, za, xb) => {
    b.box(key, xa, yHalf - slab, za, xb, yHalf, Lz, PY);
    b.withTint([0.95, 0.95, 0.93], () => b.box(sk, xa, yHalf - slab, za, xb, yHalf, Lz, PX | NX | NY | PZ | NZ));
  };
  landing(0, zA1 - 0.02, fw + gap / 2);
  landing(fw + gap / 2 - 0.001, (o.top ? zA1 : zB0) - 0.02, W);
  if (b.collecting) { b.colBox(0, yHalf - slab, zA1, fw + gap / 2, yHalf, Lz); b.colBox(fw + gap / 2, yHalf - slab, o.top ? zA1 : zB0, W, yHalf, Lz); }
  // balustrade on the well side + handrails
  const rk = o.railKey || 'steel';
  const xa = fw + 0.02, xb = W - fw - 0.02;
  const railH = 0.92;
  const zt = Math.max(zA1, o.top ? zA1 : zB0) + 0.12;
  const pts = [[xa, h + railH, landD], [xa, yHalf + railH - h * 0.3, zA1], [xa, yHalf + railH, zt], [xb, yHalf + railH, zt]];
  if (!o.top) { pts.push([xb, yHalf + railH - h * 0.3 + h, zB0]); pts.push([xb, rise + railH, landD]); }
  else pts.push([xb, yHalf + railH, landD + 0.1]);
  b.tube(rk, pts, 0.022, 10, { transport: true });
  const bal = (x, y0, z, hh = railH - 0.02) => b.box(rk, x - 0.008, y0, z - 0.008, x + 0.008, y0 + hh, z + 0.008, PX | NX | PZ | NZ);
  for (let i = 0; i < n1; i++) bal(xa, (i + 1) * h, landD + i * t1 + t1 * 0.5);
  if (!o.top) for (let i = 0; i < n2; i++) bal(xb, yHalf + (i + 1) * h, zB0 - i * t2 - t2 * 0.5);
  for (let x = xa; x <= xb + 1e-6; x += Math.max(0.1, (xb - xa) / Math.max(1, Math.round((xb - xa) / 0.12)))) bal(x, yHalf, zt);
  if (o.top) for (let z = zt; z > landD + 0.1; z -= 0.12) bal(xb, yHalf, z);
  // wall-side handrails on brackets
  const wr = o.wallRailKey || rk;
  b.tube(wr, [[0.055, h + railH - 0.04, landD - 0.25], [0.055, h + railH - 0.04, landD], [0.055, yHalf + railH - 0.04 - h * 0.3, zA1], [0.055, yHalf + railH - 0.04 - h * 0.3, zA1 + 0.25]], 0.02, 8, { transport: true });
  if (!o.top) b.tube(wr, [[W - 0.055, yHalf + railH - 0.04 + h * 0.7, zB0 + 0.25], [W - 0.055, yHalf + railH - 0.04 + h * 0.7, zB0], [W - 0.055, rise + railH - 0.04, landD], [W - 0.055, rise + railH - 0.04, landD - 0.25]], 0.02, 8, { transport: true });
  // colliders: flights as ramps (nosing line) + well guard
  if (b.collecting) {
    b.colQuad(0, 0, landD - 0.02, fw, 0, landD - 0.02, fw, yHalf, zA1 + 0.02, 0, yHalf, zA1 + 0.02);
    if (!o.top) b.colQuad(W - fw, yHalf, zB0 + 0.02, W, yHalf, zB0 + 0.02, W, rise, landD - 0.02, W - fw, rise, landD - 0.02);
    if (gap > 0.02) b.colBox(xa - 0.02, 0, landD, xb + 0.02, rise + 1.0, zt - 0.1);
  }
  return { n1, n2, h, yHalf, zA1, zB0 };
}

/**
 * Top-floor end of a switchback stair well (no flight above, e.g. a house under a pitched roof).
 * The floor landing (z∈[0,landD], drawn by the caller) is the only floor: the well above flight A
 * and the half landing stays OPEN up to the ceiling — a floor there would leave ≈1.3 m of headroom
 * over the half landing below. A guard rail with balusters runs along the landing edge (z = landD)
 * from the wall to where the last flight (B, x∈[W−fw,W]) arrives, meeting that flight's
 * balustrade. Same local frame as stairFlights (y = 0 at this floor's FFL).
 * o: {W, Lz, landD=1.4, fw, railKey='steel', slabT=0.22, edgeKey='plaster'}
 */
export function stairTop(b, o) {
  const W = o.W, fw = o.fw ?? Math.min(1.25, (W - 0.12) / 2), landD = o.landD ?? 1.4;
  const rk = o.railKey || 'steel', slab = o.slabT ?? 0.22;
  const xr = W - fw - 0.02;                       // inner edge of the arriving flight B / the well side
  const zr = landD - 0.05;                        // guard line just inside the landing edge
  // (the landing slab, its soffit and its edge facing the void are drawn by the caller with the
  // floor landing — interior/index.js; pass o.edge = true to draw the edge here)
  if (o.edge) b.withTint([0.95, 0.95, 0.93], () => b.rectZ(o.edgeKey || 'plaster', 0.0, -slab, xr, 0.0, landD + 0.02, 1));
  const H = 1.0;
  b.tube(rk, [[0.05, H - 0.12, zr], [0.05, H, zr], [xr, H, zr], [xr, H - 0.08, zr - 0.0]], 0.022, 10, { transport: true });
  b.box(rk, 0.02, 0.4, zr - 0.035, 0.05, 0.47, zr + 0.035);                         // wall bracket
  const n = Math.max(2, Math.round((xr - 0.1) / 0.12));
  for (let i = 0; i <= n; i++) { const x = 0.1 + ((xr - 0.12) * i) / n; b.box(rk, x - 0.008, 0, zr - 0.008, x + 0.008, H - 0.02, zr + 0.008, PX | NX | PZ | NZ); }
  b.box(rk, 0.05, 0.06, zr - 0.012, xr, 0.09, zr + 0.012, PY | NY | PZ | NZ);         // bottom rail
  if (b.collecting) b.colBox(0, 0, zr - 0.05, xr, H, zr + 0.05);
}

/**
 * One straight flight of n risers: dir +1 rises along +z from zStart, −1 along −z.
 * Treads, risers and nosings in `key` (stone); the waist (soffit seen from below), the top end
 * face and both side faces (stringers seen from the well) in `soffitKey` (plaster), like a
 * cast concrete flight with stone treads.
 */
function flight(b, key, x0, x1, zStart, dir, n, h, t, yBase, soffitKey = 'plaster') {
  const c = 0.012;
  const zn = (n - 1) * t, yn = yBase + n * h;
  // outline (z right, y up), CCW: bottom → underside (waist) → top end → stepped line back down
  const waist = [[0, yBase], [0.18, yBase], [zn + 0.03, yn - 0.24], [zn + 0.03, yn]];
  const raw = [[zn + 0.03, yn]];
  for (let k = n; k >= 1; k--) {
    const zk = (k - 1) * t, yk = yBase + k * h;
    if (k < n) raw.push([zk + t, yk]);
    raw.push([zk + c, yk]); raw.push([zk, yk - c]);
  }
  raw.push([0, yBase]);
  const steps = [];
  for (const p of raw) { const q = steps[steps.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) steps.push(p); }
  const outline = waist.concat(steps.slice(1, -1));
  b.push();
  if (dir > 0) b.translate(0, 0, zStart);
  else { b.translate(x0 + x1, 0, zStart); b.rotY(Math.PI); }
  const path = [[x0, 0, 0], [x1, 0, 0]];
  b.sweep(key, path, steps, { closedProfile: false, smoothAngle: 20 });
  b.sweep(soffitKey, path, waist, { closedProfile: false, smoothAngle: 20 });
  sideFace(b, soffitKey, outline, x0, -1);
  sideFace(b, soffitKey, outline, x1, 1);
  b.pop();
}

/** Planar polygon [[z,y]…] in the plane x = const facing ±x (box-projected uvs). */
function sideFace(b, key, poly, x, sgn) {
  const p = b.part(key);
  const idx = capIndices(poly);
  const v = poly.map((q) => b.vert(p, x, q[1], q[0], sgn, 0, 0, 0, 0));
  for (let i = 0; i < idx.length; i += 3) {
    const A = poly[idx[i]], B = poly[idx[i + 1]], C = poly[idx[i + 2]];
    // x-component of (B−A)×(C−A) in (x, y=q[1], z=q[0]) space
    const cx = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    if (cx * sgn >= 0) b.tri(p, v[idx[i]], v[idx[i + 1]], v[idx[i + 2]]);
    else b.tri(p, v[idx[i]], v[idx[i + 2]], v[idx[i + 1]]);
  }
}

/**
 * Lift shaft for one storey + landing doors. Local frame: shaft occupies x∈[0,W], z∈[0,D],
 * doors on the z=D face (towards the landing). o: {W, D, h (storey), doorW=1.0, doorH=2.1,
 * key (shaft walls), doorKey='steel_brushed', t=0.2, inner:boolean, car:boolean}
 */
export function liftStorey(b, o) {
  const W = o.W, D = o.D, h = o.h, t = o.t ?? 0.2, key = o.key || 'concrete';
  const dw = o.doorW ?? 1.0, dh = o.doorH ?? 2.1, du0 = (W - dw) / 2;
  // walls (outer faces): back z=0, sides x=0/x=W, front z=D with door opening
  b.box(key, 0, 0, 0, W, h, t, PZ | NZ | PY);
  b.box(key, 0, 0, t, t, h, D - t, PX | NX | PY);
  b.box(key, W - t, 0, t, W, h, D - t, PX | NX | PY);
  b.box(key, 0, 0, D - t, du0, h, D, PZ | NZ | PY | PX);
  b.box(key, du0 + dw, 0, D - t, W, h, D, PZ | NZ | PY | NX);
  b.box(key, du0, dh, D - t, du0 + dw, h, D, PZ | NZ | NY | PY);
  // landing doors (two leaves, closed) + frame + call button
  const dk = o.doorKey || 'steel_brushed';
  b.cbox(dk, du0 - 0.06, 0, D, du0, dh + 0.06, D + 0.03, 0.004);
  b.cbox(dk, du0 + dw, 0, D, du0 + dw + 0.06, dh + 0.06, D + 0.03, 0.004);
  b.cbox(dk, du0 - 0.06, dh, D, du0 + dw + 0.06, dh + 0.06, D + 0.03, 0.004);
  b.box(dk, du0, 0.01, D - t * 0.5, du0 + dw / 2 - 0.004, dh, D - t * 0.5 + 0.03, PZ | NZ);
  b.box(dk, du0 + dw / 2 + 0.004, 0.01, D - t * 0.5, du0 + dw, dh, D - t * 0.5 + 0.03, PZ | NZ);
  b.cbox('steel_brushed', du0 + dw + 0.15, 1.0, D, du0 + dw + 0.24, 1.22, D + 0.015, 0.003);
  b.box('light_cyan', du0 + dw + 0.18, 1.12, D + 0.015, du0 + dw + 0.21, 1.15, D + 0.02, 63);
  if (b.collecting) { b.colBox(0, 0, 0, W, h, t); b.colBox(0, 0, 0, t, h, D); b.colBox(W - t, 0, 0, W, h, D); b.colBox(0, 0, D - t, W, h, D); }
}

export { PX, NX, PY, NY, PZ, NZ, ALL };
