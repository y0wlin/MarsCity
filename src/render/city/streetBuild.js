// Worker-side street / ground geometry of one city tile (pure JS, no THREE). OWNER: city agent.
// From CityTileData roads / areas / rails / docks (tile frame, y = height above sea level) builds:
//  * roads: cambered carriageway (crown ≤ 12 cm), gutters + grates, 15 cm kerbs, sidewalks with 1 %
//    crossfall, medians with planting strips on wide roads, lane / edge / centre markings and zebra
//    crossings at junctions (no text), sidewalks and kerbs cut where another street joins, lanes as
//    shared paved surfaces, farm / levee / service roads with gravel shoulders, highways with crash
//    barriers; retaining walls where the terrain beside the road is higher, embankment faces where
//    it is lower (terrain sampled at the road edges)
//  * bridges (road.bridge): deck slab, fascia beams, railings with posts, piers down to the bed
//  * rails (D1, STATION_GEOM): ballast bed, concrete sleepers, rails at standard gauge (1.435 m), rail
//    head 0.35 m above the bed ground at grade / = polyline y on viaducts and bridges (box girder,
//    parapets, piers); no parapets and a bed / deck ending at the platform edges over station platforms
//  * areas: paved plazas / station plazas, courtyard paths, school yards, pitches with lines,
//    parking with bay markings, industrial / container yards, park paths
//  * docks: quay / pier decks, faces down to the water, piles, bollards and fenders
//  * colliders: walkable surfaces (carriageways, sidewalks, plazas, decks) + kerbs / walls / railings
// Output: {parts:[{material, position, normal, uv, color, index, castShadow?}], colliders, stats}
// in the tile frame with origin at height h0 (same as the mass models).
import { R } from '../../core/constants.js';
import { tileCenterUnit, enuBasisFromUnit, latLonToUnit, buildingAxes } from '../../core/geo.js';
import { heightAt } from '../../world/terrain.js';
import { hash4 } from '../../core/hash.js';
import { STATION_GEOM } from '../../buildings/types/z_station_geom.js';

// ---------------------------------------------------------------------------------------------
// tiny mesh builder (per material key)
// ---------------------------------------------------------------------------------------------
class Buf {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
}
class Builder {
  constructor() { this.parts = new Map(); this.cp = []; this.ci = []; this.cv = 0; this.tint = [1, 1, 1]; this.down = false; this.uvRot = null; }
  part(k) { let b = this.parts.get(k); if (!b) { b = new Buf(); this.parts.set(k, b); } return b; }
  /**
   * quad a,b,c,d (CCW from the front), uv per corner [u,v]*4 (metres). Horizontal-ish faces (|n.y| > 0.5)
   * are oriented to face UP (DOWN while this.down is set: deck / girder soffits, box bottoms): the road,
   * bridge and rail strips are authored with "right of travel" offsets in a right-handed x east / z south
   * frame, which wound every carriageway, sidewalk, gutter, kerb top and marking face-down — culled from
   * above, so the terrain's painted road showed instead of the street geometry.
   */
  quad(k, a, b, c, d, uv, col = false) {
    const B = this.part(k);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (this.down ? ny > 0.5 : ny < -0.5) {
      const q = b; b = d; d = q; nx = -nx; ny = -ny; nz = -nz;
      uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
    }
    const t = this.tint;
    for (let q = 0; q < 4; q++) {
      const P = q === 0 ? a : q === 1 ? b : q === 2 ? c : d;
      B.p.push(P[0], P[1], P[2]); B.n.push(nx, ny, nz); B.u.push(uv[q * 2], uv[q * 2 + 1]); B.c.push(t[0], t[1], t[2]);
    }
    const o = B.v; B.i.push(o, o + 1, o + 2, o, o + 2, o + 3); B.v += 4;
    if (col) this.colQuad(a, b, c, d);
  }
  /** horizontal-ish quad with planar uv from x/z */
  hquad(k, a, b, c, d, col = false) { this.quad(k, a, b, c, d, [a[0], -a[2], b[0], -b[2], c[0], -c[2], d[0], -d[2]], col); }
  /** vertical-ish quad uv = (along, y) */
  vquad(k, a, b, c, d, col = false) {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    this.quad(k, a, b, c, d, [0, a[1], L, b[1], L, c[1], 0, d[1]], col);
  }
  tri(k, a, b, c, col = false) {
    const B = this.part(k);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (this.down ? ny > 0.5 : ny < -0.5) { const q = b; b = c; c = q; nx = -nx; ny = -ny; nz = -nz; }   // see quad()
    const t = this.tint, R = this.uvRot;
    // planar uv in metres: tile axes, or (uvRot) along a polygon edge — plaza slabs follow the plaza
    for (const P of [a, b, c]) {
      B.p.push(P[0], P[1], P[2]); B.n.push(nx, ny, nz); B.c.push(t[0], t[1], t[2]);
      if (R) { const dx = P[0] - R.ox, dz = P[2] - R.oz; B.u.push(dx * R.ux + dz * R.uz, dz * R.ux - dx * R.uz); } else B.u.push(P[0], -P[2]);
    }
    const o = B.v; B.i.push(o, o + 1, o + 2); B.v += 3;
    if (col) { const o2 = this.cv; this.cp.push(...a, ...b, ...c); this.ci.push(o2, o2 + 1, o2 + 2); this.cv += 3; }
  }
  /** axis-aligned box in a local frame: centre c, axes ex (unit, horizontal), up, ez; half sizes */
  obox(k, c, ex, ez, hx, hy, hz, col = false, bottom = false) {
    const P = (sx, sy, sz) => [c[0] + ex[0] * sx * hx + ez[0] * sz * hz, c[1] + sy * hy, c[2] + ex[2] * sx * hx + ez[2] * sz * hz];
    const p000 = P(-1, -1, -1), p100 = P(1, -1, -1), p110 = P(1, 1, -1), p010 = P(-1, 1, -1);
    const p001 = P(-1, -1, 1), p101 = P(1, -1, 1), p111 = P(1, 1, 1), p011 = P(-1, 1, 1);
    // every face outward: flip when (ex, up, ez) is right-handed, i.e. ex × ez points down (the old test
    // was inverted: all box faces pointed inward and the tops down)
    const flip = (ex[0] * ez[2] - ex[2] * ez[0]) > 0;
    const Q = (a, b, c2, d) => (flip ? this.vquad(k, a, b, c2, d, col) : this.vquad(k, d, c2, b, a, col));
    Q(p001, p101, p111, p011); Q(p100, p000, p010, p110); Q(p101, p100, p110, p111); Q(p000, p001, p011, p010);
    if (flip) this.hquad(k, p011, p111, p110, p010, col); else this.hquad(k, p010, p110, p111, p011, col);
    if (bottom) { this.down = true; if (flip) this.hquad(k, p000, p100, p101, p001, false); else this.hquad(k, p001, p101, p100, p000, false); this.down = false; }
  }
  colQuad(a, b, c, d) { const o = this.cv; this.cp.push(...a, ...b, ...c, ...d); this.ci.push(o, o + 1, o + 2, o, o + 2, o + 3); this.cv += 4; }
  finish() {
    const parts = [];
    for (const [k, B] of this.parts) {
      if (!B.i.length) continue;
      parts.push({ material: k, position: new Float32Array(B.p), normal: new Float32Array(B.n), uv: new Float32Array(B.u), color: new Float32Array(B.c), index: new Uint32Array(B.i), castShadow: CAST.has(k) });
    }
    const colliders = this.ci.length ? { position: new Float32Array(this.cp), index: new Uint32Array(this.ci) } : null;
    return { parts, colliders };
  }
}
const CAST = new Set(['concrete', 'concrete_smooth', 'steel', 'steel_dark', 'stone_wall', 'rail', 'kerb', 'yellow', 'timber', 'solar']);

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const CLASS_RANK = { lane: 0, farm: 0, levee: 0, service: 1, local: 1, collector: 2, arterial: 3, highway: 3, boulevard: 4 };
function profileOf(r) {
  const w = Math.max(2.5, r.width || 8), cls = r.cls || 'local';
  if (cls === 'lane') return { kind: 'lane', w, cw: w / 2, sw: 0, median: 0 };
  if (cls === 'farm' || cls === 'levee' || cls === 'service') return { kind: 'rural', w, cw: Math.max(1.5, w / 2 - 1.0), sw: 0, median: 0 };
  if (cls === 'highway') return { kind: 'highway', w, cw: w / 2 - 0.8, sw: 0, median: w >= 18 ? 2.4 : 0 };
  const sw = cls === 'boulevard' ? Math.min(6, Math.max(3.5, w * 0.12)) : cls === 'arterial' ? Math.min(5, Math.max(3, w * 0.15)) : Math.min(3.6, Math.max(1.8, w * 0.2));
  const cw = Math.max(2.5, w / 2 - sw);
  const median = cls === 'boulevard' ? Math.min(8, Math.max(3, w * 0.12)) : (cls === 'arterial' && w >= 30 ? 2.5 : 0);
  return { kind: 'urban', w, cw, sw, median };
}

/** resample a polyline at ≤ step m, carrying y; returns {pts:[[x,y,z]], s:[arc length]} */
function resample(points, step) {
  const pts = [], s = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); s.push(acc + L * f);
    }
    acc += L;
  }
  const e = points[points.length - 1]; pts.push([e[0], e[1], e[2]]); s.push(acc);
  return { pts, s, len: acc };
}
/** right-hand horizontal normals (miter, limited) */
function normals(pts) {
  const n = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // right of travel with x east, z south: (−tz, tx) rotated: right = (-tz, tx)? travel north (tz=-1) → right = east (+x)
    n.push([-tz, tx, tx, tz]);
  }
  // miter scale at interior joints
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    let t1x = b[0] - a[0], t1z = b[2] - a[2]; let l1 = Math.hypot(t1x, t1z) || 1; t1x /= l1; t1z /= l1;
    let t2x = c[0] - b[0], t2z = c[2] - b[2]; let l2 = Math.hypot(t2x, t2z) || 1; t2x /= l2; t2z /= l2;
    const cosh = Math.max(0.5, Math.sqrt(Math.max(0, (1 + t1x * t2x + t1z * t2z) / 2)));
    n[i][0] /= cosh; n[i][1] /= cosh;
  }
  return n;
}

/** segment intersection (xz) → [ta, tb] params or null */
function segX(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

// ---------------------------------------------------------------------------------------------
export function buildStreets(payload) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { face, level, x, y } = payload;
  const h0 = Number.isFinite(payload.h0) ? payload.h0 : ((payload.center && payload.center.h) || 0);
  const c = tileCenterUnit(face, level, x, y, {});
  const Bs = enuBasisFromUnit(c.x, c.y, c.z, {});
  const E = Bs.east, U = Bs.up, S = Bs.south;
  const Q = {};
  let samples = 0;
  /** terrain height (m above sea) at a tile-frame point (x, z) */
  const terrain = (px, pz) => {
    const X = c.x * R + E[0] * px + S[0] * pz, Y = c.y * R + E[1] * px + S[1] * pz, Z = c.z * R + E[2] * px + S[2] * pz;
    const l = Math.hypot(X, Y, Z);
    samples++;
    return heightAt(X / l, Y / l, Z / l, 1.5);
  };
  void Q;
  const b = new Builder();
  const roads = (payload.roads || []).filter((r) => r && r.points && r.points.length >= 2);
  // ---- junctions: where another street's centreline crosses / ends on a road --------------------
  const prof = roads.map(profileOf);
  const bbox = roads.map((r) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of r.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); } return [x0 - 30, z0 - 30, x1 + 30, z1 + 30]; });
  const arc = roads.map((r) => { const s = [0]; for (let i = 1; i < r.points.length; i++) s.push(s[i - 1] + Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][2] - r.points[i - 1][2])); return s; });
  const cuts = roads.map(() => []);   // per road: [{s, half, side(-1,0,1), other}]
  for (let i = 0; i < roads.length; i++) {
    const A = roads[i].points;
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const bi = bbox[i], bj = bbox[j];
      if (bi[2] < bj[0] || bj[2] < bi[0] || bi[3] < bj[1] || bj[3] < bi[1]) continue;
      const Bp = roads[j].points;
      // extend B's ends by 1.5 m so T-junction ends touching A's centreline register
      const ext = (p, q) => { const dx = p[0] - q[0], dz = p[2] - q[2], l = Math.hypot(dx, dz) || 1; return [p[0] + dx / l * 1.5, p[1], p[2] + dz / l * 1.5]; };
      const Bx = Bp.slice(); Bx[0] = ext(Bp[0], Bp[1]); Bx[Bx.length - 1] = ext(Bp[Bp.length - 1], Bp[Bp.length - 2]);
      for (let a = 0; a < A.length - 1; a++) for (let k = 0; k < Bx.length - 1; k++) {
        const r = segX(A[a][0], A[a][2], A[a + 1][0], A[a + 1][2], Bx[k][0], Bx[k][2], Bx[k + 1][0], Bx[k + 1][2]);
        if (!r) continue;
        const sA = arc[i][a] + (arc[i][a + 1] - arc[i][a]) * r[0];
        // which side(s) of A does B occupy? B ends near A → one side
        const endB = k === 0 && r[1] < 0.5 * (1.5 / Math.max(1e-3, Math.hypot(Bx[1][0] - Bx[0][0], Bx[1][2] - Bx[0][2])) + 0.02) ? 0 : (k === Bx.length - 2 && r[1] > 0.98 ? 1 : -1);
        let side = 0;
        if (endB >= 0) {
          const far = endB === 0 ? Bp[Math.min(Bp.length - 1, 1)] : Bp[Math.max(0, Bp.length - 2)];
          let tx = A[a + 1][0] - A[a][0], tz = A[a + 1][2] - A[a][2];
          const cr = -tz * (far[0] - A[a][0]) + tx * (far[2] - A[a][2]);
          side = cr > 0 ? 1 : -1;
        }
        cuts[i].push({ s: sA, half: prof[j].w / 2, cw: prof[j].cw, sw: prof[j].sw, side, other: j });
      }
    }
  }
  // ---- roads -----------------------------------------------------------------------------------
  let nRoads = 0;
  for (let i = 0; i < roads.length; i++) {
    const r = roads[i], P = prof[i];
    if (r.bridge) { bridge(b, r, P, h0, terrain); nRoads++; continue; }
    road(b, r, P, h0, terrain, cuts[i], (CLASS_RANK[r.cls] || 1) * 0.012 + ((hash4(i, roads.length, 7, 1) & 255) / 255) * 0.004);
    nRoads++;
  }
  // ---- areas -----------------------------------------------------------------------------------
  for (const a of payload.areas || []) { try { area(b, a, h0, terrain); } catch { /* skip odd polygon */ } }
  // ---- rails -----------------------------------------------------------------------------------
  const zones = stationZones(payload.stationTracks || [], c, E, U, S);
  for (const rl of payload.rails || []) { try { rail(b, rl, h0, terrain, zones); } catch { /* skip */ } }
  // ---- docks -----------------------------------------------------------------------------------
  for (const d of payload.docks || []) { try { dock(b, d, h0, terrain); } catch { /* skip */ } }
  const out = b.finish();
  let tris = 0; for (const p of out.parts) tris += p.index.length / 3;
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { key: payload.key, h0, parts: out.parts, colliders: out.colliders, stats: { triangles: tris, roads: nRoads, samples, ms: Math.round((t1 - t0) * 10) / 10 } };
}

// ---------------------------------------------------------------------------------------------
// roads
// ---------------------------------------------------------------------------------------------
function inCut(cuts, s, side, pad) {
  for (const c of cuts) {
    if (c.side !== 0 && side !== 0 && c.side !== side) continue;
    if (Math.abs(s - c.s) < c.half + pad) return c;
  }
  return null;
}

function road(b, r, P, h0, terrain, cuts, rankLift) {
  const step = 4;
  const { pts, s } = resample(r.points, step);
  const N = normals(pts);
  const n = pts.length;
  // edge terrain samples every ~12 m (linear between) for retaining walls / embankments
  const half = P.w / 2;
  const tl = new Float64Array(n), tr = new Float64Array(n);
  const EV = 3;
  const sampleEdge = (k) => {
    tl[k] = terrain(pts[k][0] - N[k][0] * (half + 0.3), pts[k][2] - N[k][1] * (half + 0.3));
    tr[k] = terrain(pts[k][0] + N[k][0] * (half + 0.3), pts[k][2] + N[k][1] * (half + 0.3));
  };
  for (let k = 0; k < n; k += EV) sampleEdge(k);
  if ((n - 1) % EV) sampleEdge(n - 1);
  for (let k = 0; k < n; k++) {
    if (k % EV === 0 || k === n - 1) continue;
    const a = k - (k % EV), c = Math.min(n - 1, a + EV), f = (k - a) / (c - a);
    tl[k] = tl[a] + (tl[c] - tl[a]) * f; tr[k] = tr[a] + (tr[c] - tr[a]) * f;
  }
  const yc = pts.map((p) => p[1] - h0 + rankLift);
  const at = (k, off, dy) => [pts[k][0] + N[k][0] * off, yc[k] + dy, pts[k][2] + N[k][1] * off];
  const crown = Math.min(0.12, 0.02 * P.cw);
  const camb = (o) => crown * (1 - (o / P.cw) * (o / P.cw));
  // ---- carriageway: strips across the width with camber ---------------------------------------
  const isUrban = P.kind === 'urban';
  const medianHalf = P.median / 2;
  const offs = [];
  const ncs = 4;
  if (medianHalf > 0) {
    for (let q = 0; q <= ncs; q++) offs.push(-P.cw + (P.cw - medianHalf) * (q / ncs));
    offs.push(NaN);
    for (let q = 0; q <= ncs; q++) offs.push(medianHalf + (P.cw - medianHalf) * (q / ncs));
  } else for (let q = 0; q <= ncs * 2; q++) offs.push(-P.cw + 2 * P.cw * (q / (ncs * 2)));
  const surf = P.kind === 'lane' ? 'plaza' : 'asphalt';
  for (let k = 0; k < n - 1; k++) {
    for (let q = 0; q < offs.length - 1; q++) {
      const o0 = offs[q], o1 = offs[q + 1];
      if (Number.isNaN(o0) || Number.isNaN(o1)) continue;
      const cm0 = P.kind === 'lane' ? 0 : camb(Math.abs(o0) > medianHalf ? (Math.abs(o0) - medianHalf) / Math.max(0.01, P.cw - medianHalf) * P.cw - P.cw / 2 : 0);
      const cm1 = P.kind === 'lane' ? 0 : camb(Math.abs(o1) > medianHalf ? (Math.abs(o1) - medianHalf) / Math.max(0.01, P.cw - medianHalf) * P.cw - P.cw / 2 : 0);
      const a = at(k, o0, cm0), bb = at(k, o1, cm1), cc = at(k + 1, o1, cm1), d = at(k + 1, o0, cm0);
      b.quad(surf, d, cc, bb, a, [o0, -s[k + 1], o1, -s[k + 1], o1, -s[k], o0, -s[k]], true);
    }
  }
  // ---- rural / highway shoulders ----------------------------------------------------------------
  if (P.kind === 'rural' || P.kind === 'highway') {
    for (const sd of [-1, 1]) {
      for (let k = 0; k < n - 1; k++) {
        const o0 = sd * P.cw, o1 = sd * (P.w / 2);
        const a = at(k, o0, -0.01), bb = at(k, o1, -0.06), cc = at(k + 1, o1, -0.06), d = at(k + 1, o0, -0.01);
        if (sd > 0) b.quad('ballast', d, cc, bb, a, [o0, -s[k + 1], o1, -s[k + 1], o1, -s[k], o0, -s[k]]);
        else b.quad('ballast', a, bb, cc, d, [o0, -s[k], o1, -s[k], o1, -s[k + 1], o0, -s[k + 1]]);
      }
      if (P.kind === 'highway') {
        // crash barrier: posts every 4 m + W-beam
        b.tint = [1, 1, 1];
        for (let k = 0; k < n - 1; k++) {
          const o = sd * (P.cw + 0.5);
          const a = at(k, o, 0.45), d = at(k + 1, o, 0.45), a2 = at(k, o, 0.78), d2 = at(k + 1, o, 0.78);
          if (sd > 0) b.vquad('steel', d, a, a2, d2); else b.vquad('steel', a, d, d2, a2);
          if (k % 1 === 0) b.obox('steel', at(k, o + sd * 0.12, 0.35), [N[k][2], 0, N[k][3]], [N[k][0], 0, N[k][1]], 0.05, 0.35, 0.05);
        }
      }
    }
  }
  // ---- urban: gutters, kerbs, sidewalks, outer faces ---------------------------------------------
  if (isUrban) {
    for (const sd of [-1, 1]) {
      let runStart = -1;
      for (let k = 0; k < n - 1; k++) {
        const sm = (s[k] + s[k + 1]) / 2;
        const cut = inCut(cuts, sm, sd, 1.2);
        const ok = !cut;
        if (!ok) { runStart = -1; continue; }
        if (runStart < 0) runStart = k;
        const g0 = sd * (P.cw - 0.35), g1 = sd * P.cw;            // gutter strip
        const e0 = camb(P.cw - 0.35) - 0.015, e1 = -0.02;
        const kb0 = sd * P.cw, kb1 = sd * (P.cw + 0.16);            // kerb top
        const sw0 = kb1, sw1 = sd * half;                            // sidewalk
        const quadS = (key, o0, y0, o1, y1, col, uvS = true) => {
          const a = at(k, o0, y0), bb = at(k, o1, y1), cc = at(k + 1, o1, y1), d = at(k + 1, o0, y0);
          const uv = uvS ? [o0, -s[k], o1, -s[k], o1, -s[k + 1], o0, -s[k + 1]] : null;
          if (sd > 0) b.quad(key, d, cc, bb, a, uv ? [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]] : [0, 0, 1, 0, 1, 1, 0, 1], col);
          else b.quad(key, a, bb, cc, d, uv || [0, 0, 1, 0, 1, 1, 0, 1], col);
        };
        quadS('gutter', g0, e0, g1, e1, true);
        // kerb face (vertical, facing the road) and top
        {
          const a = at(k, kb0, e1), d = at(k + 1, kb0, e1), a2 = at(k, kb0, 0.15), d2 = at(k + 1, kb0, 0.15);
          if (sd > 0) b.vquad('kerb', d, a, a2, d2, true); else b.vquad('kerb', a, d, d2, a2, true);
        }
        quadS('kerb', kb0, 0.15, kb1, 0.15, true);
        // sidewalk (1 % crossfall towards the kerb)
        quadS('sidewalk', sw0, 0.15, sw1, 0.15 + 0.01 * (half - P.cw), true);
        // grates in the gutter every ~24 m
        if (Math.floor(s[k] / 24) !== Math.floor(s[k + 1] / 24)) {
          const kk = k;
          b.obox('grate', at(kk, sd * (P.cw - 0.2), e1 + 0.004), [N[kk][2], 0, N[kk][3]], [N[kk][0], 0, N[kk][1]], 0.45, 0.012, 0.18);
        }
        // outer edge: retaining wall (terrain higher) or embankment face (terrain lower)
        const yEdge0 = yc[k] + 0.15 + 0.01 * (half - P.cw), yEdge1 = yc[k + 1] + 0.15 + 0.01 * (half - P.cw);
        const tg0 = (sd < 0 ? tl[k] : tr[k]) - h0, tg1 = (sd < 0 ? tl[k + 1] : tr[k + 1]) - h0;
        const o = sd * half;
        const A0 = [pts[k][0] + N[k][0] * o, yEdge0, pts[k][2] + N[k][1] * o], A1 = [pts[k + 1][0] + N[k + 1][0] * o, yEdge1, pts[k + 1][2] + N[k + 1][1] * o];
        const up0 = tg0 - yEdge0, up1 = tg1 - yEdge1;
        if (up0 > 0.25 || up1 > 0.25) {
          // retaining wall up to the terrain + coping
          const top0 = Math.max(yEdge0 + 0.3, tg0 + 0.25), top1 = Math.max(yEdge1 + 0.3, tg1 + 0.25);
          const B0 = [A0[0], top0, A0[2]], B1 = [A1[0], top1, A1[2]];
          if (sd > 0) b.vquad('stone_wall', A1, A0, B0, B1, true); else b.vquad('stone_wall', A0, A1, B1, B0, true);
          const oo = sd * (half + 0.35);
          const C0 = [pts[k][0] + N[k][0] * oo, top0, pts[k][2] + N[k][1] * oo], C1 = [pts[k + 1][0] + N[k + 1][0] * oo, top1, pts[k + 1][2] + N[k + 1][1] * oo];
          if (sd > 0) b.hquad('concrete_smooth', B1, B0, C0, C1); else b.hquad('concrete_smooth', B0, B1, C1, C0);
        } else {
          const bot0 = Math.min(yEdge0 - 0.25, tg0 - 0.4), bot1 = Math.min(yEdge1 - 0.25, tg1 - 0.4);
          const B0 = [A0[0], bot0, A0[2]], B1 = [A1[0], bot1, A1[2]];
          if (sd > 0) b.vquad('concrete', B0, B1, A1, A0); else b.vquad('concrete', B1, B0, A0, A1);
        }
      }
    }
    // median with kerbs + planting strip
    if (medianHalf > 0) {
      for (let k = 0; k < n - 1; k++) {
        const sm = (s[k] + s[k + 1]) / 2;
        if (inCut(cuts, sm, 0, 0.5)) continue;
        for (const sd of [-1, 1]) {
          const o = sd * medianHalf;
          const a = at(k, o, -0.02), d = at(k + 1, o, -0.02), a2 = at(k, o, 0.18), d2 = at(k + 1, o, 0.18);
          if (sd > 0) b.vquad('kerb', a, d, d2, a2, true); else b.vquad('kerb', d, a, a2, d2, true);
        }
        const a = at(k, -medianHalf, 0.18), bb = at(k, medianHalf, 0.18), cc = at(k + 1, medianHalf, 0.18), d = at(k + 1, -medianHalf, 0.18);
        b.hquad('kerb', d, cc, cc.map((v, q) => q === 1 ? v : v), d);
        const ia = at(k, -medianHalf + 0.25, 0.2), ib = at(k, medianHalf - 0.25, 0.2), ic = at(k + 1, medianHalf - 0.25, 0.2), id = at(k + 1, -medianHalf + 0.25, 0.2);
        b.hquad('planting', id, ic, ib, ia, true);
        // kerb tops
        b.hquad('kerb', at(k + 1, -medianHalf, 0.18), id, ia, a);
        b.hquad('kerb', ic, cc, bb, ib);
      }
    }
  }
  // ---- markings -----------------------------------------------------------------------------------
  if (P.kind !== 'lane' && P.cw >= 2.8) {
    const mark = (off, wid, dash, gap, key = 'marking') => {
      for (let k = 0; k < n - 1; k++) {
        const s0 = s[k], s1 = s[k + 1];
        if (inCut(cuts, (s0 + s1) / 2, 0, 2.5)) continue;
        if (dash > 0) { const ph = ((s0 + s1) / 2) % (dash + gap); if (ph > dash) continue; }
        const a = at(k, off - wid / 2, camb(Math.abs(off)) + 0.004), bb = at(k, off + wid / 2, camb(Math.abs(off)) + 0.004);
        const cc = at(k + 1, off + wid / 2, camb(Math.abs(off)) + 0.004), d = at(k + 1, off - wid / 2, camb(Math.abs(off)) + 0.004);
        b.quad(key, d, cc, bb, a, [0, 0, 1, 0, 1, 1, 0, 1]);
      }
    };
    const urban = P.kind === 'urban' || P.kind === 'highway';
    if (urban) {
      // edge lines
      mark(-(P.cw - 0.55), 0.14, 0, 0); mark(P.cw - 0.55, 0.14, 0, 0);
      if (medianHalf <= 0) {
        if (P.cw >= 6.5) { mark(-0.12, 0.12, 0, 0, 'marking_yellow'); mark(0.12, 0.12, 0, 0, 'marking_yellow'); }
        else mark(0, 0.12, 3, 5);
      }
      // lane dividers on wide carriageways (3.5 m lanes)
      const lanes = Math.floor((P.cw - medianHalf - 0.6) / 3.4);
      for (let l = 1; l < lanes; l++) { const o = medianHalf + 0.3 + l * ((P.cw - medianHalf - 0.6) / lanes); mark(o, 0.12, 4, 8); mark(-o, 0.12, 4, 8); }
    } else if (P.kind === 'rural' && P.cw >= 3) mark(0, 0.1, 2, 8);
    // zebra crossings where another urban street joins (across this carriageway, on the joining sidewalks)
    if (urban) {
      for (const cu of cuts) {
        if (!(cu.sw > 0)) continue;
        for (const sgn of [-1, 1]) {
          const sc = cu.s + sgn * (cu.cw + cu.sw * 0.5);
          if (sc < 2 || sc > s[n - 1] - 2) continue;
          // find segment
          let k = 0; while (k < n - 2 && s[k + 1] < sc) k++;
          const f = (sc - s[k]) / Math.max(1e-6, s[k + 1] - s[k]);
          const base = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, yc[k] + (yc[k + 1] - yc[k]) * f, pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f];
          const nx = N[k][0], nz = N[k][1], tx = N[k][2], tz = N[k][3];
          const depth = Math.min(3.0, Math.max(2.0, cu.sw * 0.8));
          for (let o = -P.cw + 0.6; o < P.cw - 0.6; o += 1.0) {
            if (Math.abs(o) < medianHalf + 0.2) continue;
            const yy = base[1] + camb(Math.abs(o)) + 0.005;
            const p = (dx, dz) => [base[0] + nx * dx + tx * dz, yy, base[2] + nz * dx + tz * dz];
            b.quad('marking', p(o, depth / 2), p(o + 0.5, depth / 2), p(o + 0.5, -depth / 2), p(o, -depth / 2), [0, 0, 1, 0, 1, 1, 0, 1]);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// bridges
// ---------------------------------------------------------------------------------------------
function bridge(b, r, P, h0, terrain) {
  const { pts, s, len } = resample(r.points, 4);
  const N = normals(pts), n = pts.length;
  const half = P.w / 2 + 0.6;
  const yc = pts.map((p) => p[1] - h0);
  const at = (k, off, dy) => [pts[k][0] + N[k][0] * off, yc[k] + dy, pts[k][2] + N[k][1] * off];
  // long bridges (decision DB, r.bridgeType): only the walkable deck top here (asphalt, footways, kerbs,
  // railings, markings, median barrier, colliders); girder, piers, pylons, cables and lights are the whole-
  // bridge structure of bridges.js / bridgeBuild.js at every distance
  const long = !!r.bridgeType;
  const cw = P.sw > 0 ? P.cw : P.w / 2;
  if (long && cw >= 5.5) {
    // lane markings: edge lines, lane dividers (dashed), median barrier on wide decks / double centre line
    const lineQ = (off, wid, dash, gap) => {
      for (let k = 0; k < n - 1; k++) {
        if (dash > 0) { const ph = ((s[k] + s[k + 1]) / 2) % (dash + gap); if (ph > dash) continue; }
        b.quad('marking', at(k + 1, off - wid / 2, 0.034), at(k + 1, off + wid / 2, 0.034), at(k, off + wid / 2, 0.034), at(k, off - wid / 2, 0.034), [0, 0, 1, 0, 1, 1, 0, 1]);
      }
    };
    const barrier = cw >= 9;
    const inner = barrier ? 0.9 : 0.2;
    lineQ(-(cw - 0.45), 0.15, 0, 0); lineQ(cw - 0.45, 0.15, 0, 0);
    const lanes = Math.max(1, Math.floor((cw - inner - 0.5) / 3.5));
    for (let l = 1; l < lanes; l++) { const o = inner + l * ((cw - inner - 0.5) / lanes); lineQ(o, 0.13, 4, 8); lineQ(-o, 0.13, 4, 8); }
    if (barrier) {
      // concrete median barrier (0.6 m, 0.85 m high, sloped faces) with a collider wall
      for (let k = 0; k < n - 1; k++) {
        for (const sd of [-1, 1]) {
          const a0 = at(k, sd * 0.32, 0.03), a1 = at(k + 1, sd * 0.32, 0.03), a2 = at(k + 1, sd * 0.12, 0.88), a3 = at(k, sd * 0.12, 0.88);
          if (sd > 0) b.quad('concrete_smooth', a1, a0, a3, a2, [0, 0, 1, 0, 1, 1, 0, 1]); else b.quad('concrete_smooth', a0, a1, a2, a3, [0, 0, 1, 0, 1, 1, 0, 1]);
        }
        b.hquad('concrete_smooth', at(k, -0.12, 0.88), at(k, 0.12, 0.88), at(k + 1, 0.12, 0.88), at(k + 1, -0.12, 0.88));
        b.colQuad(at(k, 0, 0.03), at(k + 1, 0, 0.03), at(k + 1, 0, 0.9), at(k, 0, 0.9));
      }
    } else { lineQ(-0.12, 0.12, 0, 0); lineQ(0.12, 0.12, 0, 0); }
  }
  for (let k = 0; k < n - 1; k++) {
    const uvs = (o0, o1) => [o0, -s[k + 1], o1, -s[k + 1], o1, -s[k], o0, -s[k]];
    // deck surface: carriageway + footways
    b.quad('asphalt', at(k + 1, -cw, 0.03), at(k + 1, cw, 0.03), at(k, cw, 0.03), at(k, -cw, 0.03), uvs(-cw, cw), true);
    for (const sd of [-1, 1]) {
      const o0 = sd * cw, o1 = sd * half;
      if (sd > 0) b.quad('sidewalk', at(k + 1, o0, 0.18), at(k + 1, o1, 0.18), at(k, o1, 0.18), at(k, o0, 0.18), uvs(o0, o1), true);
      else b.quad('sidewalk', at(k, o0, 0.18), at(k, o1, 0.18), at(k + 1, o1, 0.18), at(k + 1, o0, 0.18), uvs(o0, o1).slice(4).concat(uvs(o0, o1).slice(0, 4)), true);
      // kerb face
      if (sd > 0) b.vquad('kerb', at(k + 1, o0, 0.03), at(k, o0, 0.03), at(k, o0, 0.18), at(k + 1, o0, 0.18), true);
      else b.vquad('kerb', at(k, o0, 0.03), at(k + 1, o0, 0.03), at(k + 1, o0, 0.18), at(k, o0, 0.18), true);
      // fascia beam (outer face + underside); long bridges: the structure's edge beam (bridgeBuild.js)
      const fo = sd * half;
      if (!long) {
        if (sd > 0) b.vquad('concrete_smooth', at(k, fo, -1.1), at(k + 1, fo, -1.1), at(k + 1, fo, 0.25), at(k, fo, 0.25));
        else b.vquad('concrete_smooth', at(k + 1, fo, -1.1), at(k, fo, -1.1), at(k, fo, 0.25), at(k + 1, fo, 0.25));
      }
      // railing: top rail + mid rail + posts every 2 m
      const ro = sd * (half - 0.12);
      for (const hh of [1.1, 0.55]) {
        const a = at(k, ro, hh), d = at(k + 1, ro, hh), a2 = at(k, ro, hh + 0.06), d2 = at(k + 1, ro, hh + 0.06);
        if (sd > 0) { b.vquad('steel', d, a, a2, d2); b.vquad('steel', a, d, d2, a2); } else { b.vquad('steel', a, d, d2, a2); b.vquad('steel', d, a, a2, d2); }
      }
      if (Math.floor(s[k] / 2) !== Math.floor(s[k + 1] / 2) || k === 0) b.obox('steel_dark', at(k, ro, 0.6), [N[k][2], 0, N[k][3]], [N[k][0], 0, N[k][1]], 0.04, 0.6, 0.04);
      // railing collider (low wall)
      b.colQuad(at(k, ro, 0.18), at(k + 1, ro, 0.18), at(k + 1, ro, 1.2), at(k, ro, 1.2));
    }
    // deck underside (faces down)
    if (!long) {
      b.down = true;
      b.quad('concrete_smooth', at(k, -half, -1.1), at(k, half, -1.1), at(k + 1, half, -1.1), at(k + 1, -half, -1.1), [0, 0, 1, 0, 1, 1, 0, 1]);
      b.down = false;
    }
  }
  if (long) return;
  // piers every ~26 m (not at the abutments)
  const nP = Math.floor(len / 26);
  for (let q = 1; q <= nP; q++) {
    const sc = (q * len) / (nP + 1);
    let k = 0; while (k < n - 2 && s[k + 1] < sc) k++;
    const f = (sc - s[k]) / Math.max(1e-6, s[k + 1] - s[k]);
    const cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, cz = pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f;
    const top = yc[k] + (yc[k + 1] - yc[k]) * f - 1.1;
    const bed = terrain(cx, cz) - h0 - 1.0;
    if (top - bed < 1.2) continue;
    const ex = [N[k][0], 0, N[k][1]], ez = [N[k][2], 0, N[k][3]];
    // cap beam + two columns
    b.obox('concrete_smooth', [cx, top - 0.5, cz], ex, ez, half * 0.92, 0.5, 0.8, false, true);
    for (const sd of [-1, 1]) {
      const px = cx + ex[0] * sd * half * 0.55, pz = cz + ex[2] * sd * half * 0.55;
      const h = (top - 1.0 - bed) / 2;
      b.obox('concrete', [px, bed + h, pz], ex, ez, 0.7, h, 0.7, true);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// areas (plazas, courtyards, yards, pitches, parking)
// ---------------------------------------------------------------------------------------------
function triangulate(poly) {
  // ear clipping for simple polygons (areas are small convex-ish quads / pentagons)
  const n = poly.length; if (n < 3) return [];
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], c = poly[(i + 1) % n]; area += a[0] * c[1] - c[0] * a[1]; }
  const idx = []; const V = []; for (let i = 0; i < n; i++) V.push(i);
  if (area < 0) V.reverse();
  let guard = 0;
  while (V.length > 3 && guard++ < 400) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const i0 = V[(i + V.length - 1) % V.length], i1 = V[i], i2 = V[(i + 1) % V.length];
      const a = poly[i0], bb = poly[i1], c = poly[i2];
      const cr = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
      if (cr <= 1e-9) continue;
      let inside = false;
      for (const j of V) { if (j === i0 || j === i1 || j === i2) continue; const p = poly[j]; if (ptInTri(p, a, bb, c)) { inside = true; break; } }
      if (inside) continue;
      idx.push(i0, i1, i2); V.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (V.length === 3) idx.push(V[0], V[1], V[2]);
  return idx;
}
function ptInTri(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function inset(poly, d) {
  const n = poly.length, out = [];
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], c = poly[(i + 1) % n]; area += a[0] * c[1] - c[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], q = poly[i], r = poly[(i + 1) % n];
    let ax = q[0] - p[0], az = q[1] - p[1]; const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
    let bx = r[0] - q[0], bz = r[1] - q[1]; const lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
    // inward normal for CCW (x right, z down… sign handled by sg)
    const n1x = -az * sg, n1z = ax * sg, n2x = -bz * sg, n2z = bx * sg;
    let mx = n1x + n2x, mz = n1z + n2z; const lm = Math.hypot(mx, mz) || 1; mx /= lm; mz /= lm;
    const k = 1 / Math.max(0.35, mx * n1x + mz * n1z);
    out.push([q[0] + mx * d * k, q[1] + mz * d * k]);
  }
  return out;
}

/** clip a convex polygon [[x,z]...] to the half-plane nx*x + nz*z <= d */
function clipConvex(poly, nx, nz, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const da = nx * a[0] + nz * a[1] - d, dc = nx * c[0] + nz * c[1] - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && dc > 0) || (da > 0 && dc < 0)) { const t = da / (da - dc); out.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]); }
  }
  return out;
}
/**
 * Terrain-following surface over a polygon [[x,z]...]: ear-clipped triangles × a grid of `cell` m
 * squares aligned to the longest edge, every vertex at terrain + lift (memoised samples, so shared
 * vertices match exactly). Returns the height function used (for edges / markings).
 */
function drapePoly(b, key, poly, h0, terrain, lift, cell) {
  const memo = new Map();
  const H = (x, z) => {
    const k = Math.round(x * 16) * 131072 + Math.round(z * 16);
    let h = memo.get(k);
    if (h === undefined) { h = terrain(x, z) - h0 + lift; memo.set(k, h); }
    return h;
  };
  // grid axes from the longest edge
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L > best) { best = L; ux = (c[0] - a[0]) / L; uz = (c[1] - a[1]) / L; }
  }
  const vx = -uz, vz = ux;
  const ox = poly[0][0], oz = poly[0][1];
  const tri = triangulate(poly);
  for (let i = 0; i < tri.length; i += 3) {
    let T = [poly[tri[i]], poly[tri[i + 1]], poly[tri[i + 2]]];
    const cr = (T[1][0] - T[0][0]) * (T[2][1] - T[0][1]) - (T[1][1] - T[0][1]) * (T[2][0] - T[0][0]);
    if (Math.abs(cr) < 1e-6) continue;
    if (cr < 0) T = [T[0], T[2], T[1]];
    // triangle half-planes (inside: n·p <= d) for CCW in (x, z) with cross > 0
    const planes = [];
    for (let e = 0; e < 3; e++) {
      const a = T[e], c = T[(e + 1) % 3];
      const nx = (c[1] - a[1]), nz = -(c[0] - a[0]);
      planes.push([nx, nz, nx * a[0] + nz * a[1]]);
    }
    let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
    for (const p of T) { const ss = (p[0] - ox) * ux + (p[1] - oz) * uz, tt = (p[0] - ox) * vx + (p[1] - oz) * vz; s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); t0 = Math.min(t0, tt); t1 = Math.max(t1, tt); }
    const i0 = Math.floor(s0 / cell), i1 = Math.ceil(s1 / cell), j0 = Math.floor(t0 / cell), j1 = Math.ceil(t1 / cell);
    for (let jj = j0; jj < j1; jj++) for (let ii = i0; ii < i1; ii++) {
      const P = (si, tj) => [ox + ux * si * cell + vx * tj * cell, oz + uz * si * cell + vz * tj * cell];
      let q = [P(ii, jj), P(ii + 1, jj), P(ii + 1, jj + 1), P(ii, jj + 1)];
      for (const pl of planes) { if (q.length < 3) break; q = clipConvex(q, pl[0], pl[1], pl[2]); }
      if (q.length < 3) continue;
      const V = q.map((p) => [p[0], H(p[0], p[1]), p[1]]);
      for (let k = 1; k < V.length - 1; k++) {
        const A = V[0], B = V[k], C = V[k + 1];
        const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        if (Math.abs(ny) < 1e-8) continue;
        if (ny > 0) b.tri(key, A, B, C, true); else b.tri(key, A, C, B, true);
      }
    }
  }
  return H;
}

function area(b, a, h0, terrain) {
  const kind = a.kind;
  const SURF = { plaza: 'plaza', station_plaza: 'plaza', schoolyard: 'court', pitch: 'pitch', parking: 'asphalt', yard_industrial: 'concrete', yard_service: 'concrete', container_yard: 'concrete', dock: 'concrete', courtyard: 'sidewalk', yard: 'concrete', lane: 'plaza' };
  const poly = a.polygon;
  if (!poly || poly.length < 3) return;
  if (kind === 'park' || kind === 'green') { parkPaths(b, poly, h0, terrain); return; }
  if (kind === 'garden') { edging(b, poly, h0, terrain); return; }
  if (kind === 'solar') { solarRows(b, poly, h0, terrain); return; }
  if (kind === 'basins') { basins(b, poly, h0, terrain); return; }
  const key = SURF[kind];
  if (!key) return;
  // stacking order of overlapping areas (a pitch inside a schoolyard, parking inside a yard):
  // distinct heights so coplanar surfaces never z-fight
  const lift = kind === 'plaza' || kind === 'station_plaza' ? 0.12 : kind === 'pitch' ? 0.1 : kind === 'parking' ? 0.085 : kind === 'schoolyard' ? 0.07 : 0.055;
  const P = kind === 'courtyard' ? inset(poly, 0.5) : poly;
  // plaza slabs run along the longest edge of the plaza (uv rotated), other surfaces keep tile-axis uv
  if (key === 'plaza') {
    let best = 0;
    for (let i = 0; i < P.length; i++) {
      const p0 = P[i], p1 = P[(i + 1) % P.length], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (L > best) { best = L; b.uvRot = { ux: (p1[0] - p0[0]) / L, uz: (p1[1] - p0[1]) / L, ox: p0[0], oz: p0[1] }; }
    }
  }
  // terrain-following surface (grid draped over the polygon, ~6 m cells)
  const H = drapePoly(b, key, P, h0, terrain, lift, 8);
  b.uvRot = null;
  // edge face down into the ground (kerb-like for plazas), subdivided along the terrain
  const ek = kind === 'plaza' || kind === 'station_plaza' ? 'kerb' : 'concrete';
  for (let i = 0; i < P.length; i++) {
    const p0 = P[i], p1 = P[(i + 1) % P.length];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = Math.max(1, Math.ceil(L / 6));
    for (let k = 0; k < n; k++) {
      const ax = p0[0] + (p1[0] - p0[0]) * k / n, az = p0[1] + (p1[1] - p0[1]) * k / n;
      const bx = p0[0] + (p1[0] - p0[0]) * (k + 1) / n, bz = p0[1] + (p1[1] - p0[1]) * (k + 1) / n;
      const A = [ax, H(ax, az), az], B = [bx, H(bx, bz), bz];
      const A0 = [ax, A[1] - lift - 0.35, az], B0 = [bx, B[1] - lift - 0.35, bz];
      b.vquad(ek, A0, B0, B, A);
      b.vquad(ek, B0, A0, A, B);
    }
  }
  // lines: pitch / schoolyard court lines, parking bays
  if (kind === 'pitch' || kind === 'schoolyard') {
    const I = inset(P, 2.0);
    for (let i = 0; i < I.length; i++) stripe(b, I[i], I[(i + 1) % I.length], 0.1, terrain, h0, lift + 0.01);
    if (I.length >= 4) stripe(b, mid(I[0], I[1]), mid(I[2], I[3]), 0.1, terrain, h0, lift + 0.01);
  } else if (kind === 'parking') {
    // bays perpendicular to the longest edge, every 2.6 m, 5 m deep
    let best = 0, bi = 0;
    for (let i = 0; i < P.length; i++) { const L = Math.hypot(P[(i + 1) % P.length][0] - P[i][0], P[(i + 1) % P.length][1] - P[i][1]); if (L > best) { best = L; bi = i; } }
    const A = P[bi], B = P[(bi + 1) % P.length];
    const tx = (B[0] - A[0]) / best, tz = (B[1] - A[1]) / best;
    let nx = -tz, nz = tx;
    const cen = P.reduce((m, p) => [m[0] + p[0] / P.length, m[1] + p[1] / P.length], [0, 0]);
    if ((cen[0] - A[0]) * nx + (cen[1] - A[1]) * nz < 0) { nx = -nx; nz = -nz; }
    for (let s2 = 1.5; s2 < best - 1.5; s2 += 2.6) {
      const p0 = [A[0] + tx * s2 + nx * 0.5, A[1] + tz * s2 + nz * 0.5], p1 = [p0[0] + nx * 5, p0[1] + nz * 5];
      stripe(b, p0, p1, 0.12, terrain, h0, lift + 0.01);
    }
  }
}
function mid(a, c) { return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; }

/** garden bed edging: 0.22 m kerb stones 0.12 m proud along the polygon (planting itself: props) */
function edging(b, poly, h0, terrain) {
  const I = inset(poly, 0.35);
  for (let i = 0; i < I.length; i++) {
    const p0 = I[i], p1 = I[(i + 1) % I.length];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (L < 0.5) continue;
    const n = Math.max(1, Math.ceil(L / 6));
    const tx = (p1[0] - p0[0]) / L, tz = (p1[1] - p0[1]) / L;
    for (let k = 0; k < n; k++) {
      const s0 = (L * k) / n, s1 = (L * (k + 1)) / n;
      const cx = p0[0] + tx * (s0 + s1) / 2, cz = p0[1] + tz * (s0 + s1) / 2;
      const y = terrain(cx, cz) - h0;
      b.obox('kerb', [cx, y + 0.02, cz], [tx, 0, tz], [-tz, 0, tx], (s1 - s0) / 2, 0.14, 0.11, true);
    }
  }
}

/** solar field: rows of panels tilted 25° towards the equator on steel posts */
function solarRows(b, poly, h0, terrain) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const south = 1;   // tile +z = south (northern hemisphere default; panels face the equator)
  const depth = 3.2, tilt = 25 * Math.PI / 180, dy = depth * Math.sin(tilt), dz = depth * Math.cos(tilt);
  for (let z = z0 + 3; z < z1 - 3; z += 6.5) {
    for (let x = x0 + 3; x < x1 - 3; x += 4.2) {
      if (!ptInPoly([x, z], poly) || !ptInPoly([x + 4, z], poly) || !ptInPoly([x, z + dz], poly)) continue;
      const y = terrain(x + 2, z + dz / 2) - h0;
      const lo = y + 0.8, hi = lo + dy;
      // panel (front = up/south facing), frame underside
      const A = [x, hi, z], B = [x + 4.0, hi, z], C = [x + 4.0, lo, z + south * dz], D = [x, lo, z + south * dz];
      b.quad('solar', A, D, C, B, [0, 0, 0, 1, 1, 1, 1, 0]);
      b.down = true; b.quad('steel_dark', A, B, C, D, [0, 0, 1, 0, 1, 1, 0, 1]); b.down = false;   // frame underside
      for (const px of [x + 0.4, x + 3.6]) {
        b.obox('steel', [px, (y + hi) / 2 - 0.05, z + 0.3], [1, 0, 0], [0, 0, 1], 0.05, (hi - y) / 2, 0.05);
        b.obox('steel', [px, (y + lo) / 2, z + dz - 0.3], [1, 0, 0], [0, 0, 1], 0.05, (lo - y) / 2, 0.05);
      }
    }
  }
}

/** treatment basins: concrete tanks (1.3 m walls) with still dark water */
function basins(b, poly, h0, terrain) {
  const I = inset(poly, 0.5);
  if (I.length < 3) return;
  let y = 1e9; for (const p of I) y = Math.min(y, terrain(p[0], p[1]) - h0);
  const top = y + 1.3;
  const W = inset(I, 0.45);
  for (let i = 0; i < I.length; i++) {
    const a = I[i], c = I[(i + 1) % I.length], ai = W[i], ci = W[(i + 1) % W.length];
    const A0 = [a[0], y - 0.3, a[1]], C0 = [c[0], y - 0.3, c[1]], A1 = [a[0], top, a[1]], C1 = [c[0], top, c[1]];
    b.vquad('concrete', A0, C0, C1, A1, true); b.vquad('concrete', C0, A0, A1, C1, true);
    const Ai = [ai[0], top, ai[1]], Ci = [ci[0], top, ci[1]];
    b.hquad('concrete_smooth', A1, C1, Ci, Ai); b.hquad('concrete_smooth', Ai, Ci, C1, A1);
    const Ai0 = [ai[0], top - 0.35, ai[1]], Ci0 = [ci[0], top - 0.35, ci[1]];
    b.vquad('concrete', Ci0, Ai0, Ai, Ci); b.vquad('concrete', Ai0, Ci0, Ci, Ai);
  }
  const tri = triangulate(W);
  for (let i = 0; i < tri.length; i += 3) {
    const A = [W[tri[i]][0], top - 0.35, W[tri[i]][1]], B = [W[tri[i + 1]][0], top - 0.35, W[tri[i + 1]][1]], C = [W[tri[i + 2]][0], top - 0.35, W[tri[i + 2]][1]];
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (ny >= 0) b.tri('basin_water', A, B, C); else b.tri('basin_water', A, C, B);
  }
}
function stripe(b, p0, p1, w, terrain, h0, lift) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (L < 0.2) return;
  const tx = (p1[0] - p0[0]) / L, tz = (p1[1] - p0[1]) / L, nx = -tz * w / 2, nz = tx * w / 2;
  const y0 = terrain(p0[0], p0[1]) - h0 + lift, y1 = terrain(p1[0], p1[1]) - h0 + lift;
  const A = [p0[0] - nx, y0, p0[1] - nz], B = [p0[0] + nx, y0, p0[1] + nz], C = [p1[0] + nx, y1, p1[1] + nz], D = [p1[0] - nx, y1, p1[1] - nz];
  const ny = (B[2] - A[2]) * (D[0] - A[0]) - (B[0] - A[0]) * (D[2] - A[2]);
  if (ny >= 0) b.quad('marking', A, B, C, D, [0, 0, 1, 0, 1, 1, 0, 1]); else b.quad('marking', A, D, C, B, [0, 0, 1, 0, 1, 1, 0, 1]);
}
function parkPaths(b, poly, h0, terrain) {
  // 2.0–2.6 m gravel / paved paths; the layout varies per park (hash of the centroid) so a green
  // district never shows the same figure on every block: small parks get one crossing path, larger
  // ones a loop and / or a cross between edge midpoints, some only a path along one side
  if (poly.length < 3) return;
  let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of poly) { cx += p[0] / poly.length; cz += p[1] / poly.length; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const span = Math.min(x1 - x0, z1 - z0);
  if (span < 14) return;
  const h = hash4(Math.round(cx * 4), Math.round(cz * 4), poly.length, 0x9a7c);
  const pick = h & 7, gravel = (h >>> 3) & 1;
  const w = 1.0 + ((h >>> 4) & 3) * 0.1;
  const tint0 = b.tint;
  b.tint = gravel ? [1, 1, 1] : [0.8, 0.78, 0.74];
  const key = gravel ? 'gravel' : 'sidewalk';
  const path = (p0, p1) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (L < 2) return;
    const n = Math.max(1, Math.ceil(L / 6));
    for (let k = 0; k < n; k++) {
      const a = [p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n], c = [p0[0] + (p1[0] - p0[0]) * (k + 1) / n, p0[1] + (p1[1] - p0[1]) * (k + 1) / n];
      const tx = (c[0] - a[0]) / (L / n), tz = (c[1] - a[1]) / (L / n), nx = -tz * w, nz = tx * w;
      const ya = terrain(a[0], a[1]) - h0 + 0.05, yc2 = terrain(c[0], c[1]) - h0 + 0.05;
      const A = [a[0] - nx, ya, a[1] - nz], B = [a[0] + nx, ya, a[1] + nz], C = [c[0] + nx, yc2, c[1] + nz], D = [c[0] - nx, yc2, c[1] - nz];
      // uv (across, along) in metres: pavers follow the path
      const s0 = (L * k) / n, s1 = (L * (k + 1)) / n;
      b.quad(key, A, B, C, D, [-w, s0, w, s0, w, s1, -w, s1], true);
    }
  };
  const I = inset(poly, 3 + ((h >>> 6) & 3));
  const m = I.length;
  const midI = (i) => [(I[i % m][0] + I[(i + 1) % m][0]) / 2, (I[i % m][1] + I[(i + 1) % m][1]) / 2];
  const r = (h >>> 9) % m;
  if (span < 45 || pick === 0) {
    // one path across, between two opposite edge midpoints (or corner to corner)
    if (pick & 1 || m < 4) path(midI(r), midI(r + Math.floor(m / 2))); else path(I[r], I[(r + 2) % m]);
  } else if (pick <= 2) {
    for (let i = 0; i < m; i++) path(I[i], I[(i + 1) % m]);                 // loop
  } else if (pick <= 4) {
    path(midI(r), midI(r + Math.floor(m / 2)));                            // cross
    if (m >= 4) path(midI(r + 1), midI(r + 1 + Math.floor(m / 2)));
  } else if (pick === 5) {
    for (let i = 0; i < m; i++) path(I[i], I[(i + 1) % m]);                 // loop + one cross path
    path(midI(r), midI(r + Math.floor(m / 2)));
  } else {
    path(I[r], I[(r + 1) % m]);                                             // along one side + a spur
    path(midI(r), [cx + (midI(r)[0] - cx) * -0.2, cz + (midI(r)[1] - cz) * -0.2]);
  }
  b.tint = tint0;
}

// ---------------------------------------------------------------------------------------------
// rails (D1: buildings/types/z_station_geom.js STATION_GEOM is canonical)
//   track centres ±TRACK_HALF_SPACING (2.0 m) per track pair, standard gauge;
//   at grade: polyline y = rail-bed ground (urban levels it over station platforms) and the rail head is
//   RAIL_HEAD_AT_GRADE (0.35 m) above it: ballast top head − 0.30, sleepers head − 0.35..−0.17, rail
//   head − 0.17..head;
//   viaducts / rail bridges: polyline y IS the rail head (ground + ELEVATED_DECK 9.0 m / water + 7 m),
//   slab track on a deck whose top is 0.35 m below; deck width VIADUCT (11 m, 2 tracks).
//   Over station platforms (stationZones): no parapets / barriers, the deck / ballast top ends at the
//   platform edges (PLATFORM_EDGE 1.6 m beyond the outer track centres), so the station building's
//   platforms (top = rail head + 1.0 m) meet the track bed without a gap or overlap.
// ---------------------------------------------------------------------------------------------
const RAIL_H = 0.17, SLEEPER_H = 0.18, RAIL_HEAD_W = 0.07;

/**
 * Station track lines of the tile (and its neighbours) in the tile frame from the station building
 * specs: {ax, az, bx, bz (track centreline ends at ±w/2 along the building x), y (rail head, m above
 * sea level), elevated}. Track z in the building frame: meta.trackOffset (urban: building-frame z,
 * negative behind the back facade; a positive value is read as the distance behind it) else
 * STATION_GEOM's default offset.
 */
function stationZones(list, c, E, U, S) {
  const out = [];
  const G = STATION_GEOM;
  for (const st of list) {
    if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lon)) continue;
    const w = st.w || 60, d = st.d || 26;
    let zt;
    if (Number.isFinite(st.trackOffset)) zt = st.trackOffset <= 0 ? st.trackOffset : -st.trackOffset;
    else zt = -((st.elevated ? G.VIADUCT / 2 + 4 : G.CORRIDOR / 2 + 6) + d / 2);
    const ent = st.entrance || 0;
    const p = latLonToUnit(st.lat, st.lon, {});
    const r = R + ent;
    const X = p.x * r - c.x * R, Y = p.y * r - c.y * R, Z = p.z * r - c.z * R;
    const ox = X * E[0] + Y * E[1] + Z * E[2], oz = X * S[0] + Y * S[1] + Z * S[2];
    const A = buildingAxes(st.lat, st.lon, st.heading || 0);
    const ax = A.x[0] * E[0] + A.x[1] * E[1] + A.x[2] * E[2], axz = A.x[0] * S[0] + A.x[1] * S[1] + A.x[2] * S[2];
    const az = A.z[0] * E[0] + A.z[1] * E[1] + A.z[2] * E[2], azz = A.z[0] * S[0] + A.z[1] * S[1] + A.z[2] * S[2];
    const cx = ox + az * zt, cz = oz + azz * zt;
    out.push({ ax: cx - ax * w / 2, az: cz - axz * w / 2, bx: cx + ax * w / 2, bz: cz + axz * w / 2, len: w, elevated: !!st.elevated, id: st.id });
  }
  return out;
}

/** 0..1 platform-zone weight of a rail point (x, z): 1 along a station track line, ramps over 8 m past its ends */
function zoneAt(zones, x, z) {
  let wmax = 0;
  for (const Z of zones) {
    const vx = Z.bx - Z.ax, vz = Z.bz - Z.az, L = Z.len || Math.hypot(vx, vz) || 1;
    const f = ((x - Z.ax) * vx + (z - Z.az) * vz) / (L * L);
    const px = Z.ax + vx * f, pz = Z.az + vz * f;
    if (Math.hypot(x - px, z - pz) > 6) continue;   // not this track (parallel lines 30+ m apart)
    const along = f < 0 ? -f * L : f > 1 ? (f - 1) * L : 0;
    const w = along <= 0.5 ? 1 : Math.max(0, 1 - (along - 0.5) / 8);
    if (w > wmax) wmax = w;
  }
  return wmax;
}

function rail(b, rl, h0, terrain, zones) {
  if (!rl.points || rl.points.length < 2) return;
  const G = STATION_GEOM;
  const { pts, s, len } = resample(rl.points, 3);
  const N = normals(pts), n = pts.length;
  const tracks = Math.max(1, Math.min(4, rl.tracks || 2));
  const spacing = 2 * G.TRACK_HALF_SPACING;
  const elevated = !!rl.elevated || !!rl.bridge;
  // long rail bridges (decision DB): deck slab + parapets + track here, the box girder / piers / pylons /
  // cables are the whole-bridge structure (bridgeBuild.js)
  const long = !!rl.bridge && !!rl.bridgeType;
  // rail head (tile frame y) per sample
  const head = pts.map((p) => p[1] - h0 + (elevated ? 0 : G.RAIL_HEAD_AT_GRADE));
  const outer = ((tracks - 1) / 2) * spacing;                     // outer track centre offset
  const zw = pts.map((p) => (zones.length ? zoneAt(zones, p[0], p[2]) : 0));
  const at = (k, off, y) => [pts[k][0] + N[k][0] * off, y, pts[k][2] + N[k][1] * off];
  if (elevated) {
    // deck half width: VIADUCT/2 (2 tracks) away from stations, the platform edge inside platform zones
    const hFree = Math.max(G.VIADUCT / 2, outer + 3.5), hPlat = outer + G.PLATFORM_EDGE - 0.05;
    const half = zw.map((w) => hFree + (hPlat - hFree) * w);
    const top = head.map((y) => y - 0.35);
    for (let k = 0; k < n - 1; k++) {
      const h0k = half[k], h1k = half[k + 1];
      b.quad('concrete_smooth', at(k + 1, -h1k, top[k + 1]), at(k + 1, h1k, top[k + 1]), at(k, h0k, top[k]), at(k, -h0k, top[k]), [-h1k, -s[k + 1], h1k, -s[k + 1], h0k, -s[k], -h0k, -s[k]], true);
      const parapet = zw[k] < 0.01 && zw[k + 1] < 0.01;
      for (const sd of [-1, 1]) {
        const o0 = sd * h0k, o1 = sd * h1k;
        // fascia down to the box girder soffit (long bridges: the parapet's outer face only)
        const fb = long ? 0 : -2.2;
        if (!long || parapet) {
          if (sd > 0) b.quad('concrete_smooth', at(k, o0, top[k] + fb), at(k + 1, o1, top[k + 1] + fb), at(k + 1, o1, top[k + 1] + (parapet ? 1.1 : 0)), at(k, o0, top[k] + (parapet ? 1.1 : 0)), [0, 0, 1, 0, 1, 1, 0, 1]);
          else b.quad('concrete_smooth', at(k + 1, o1, top[k + 1] + fb), at(k, o0, top[k] + fb), at(k, o0, top[k] + (parapet ? 1.1 : 0)), at(k + 1, o1, top[k + 1] + (parapet ? 1.1 : 0)), [0, 0, 1, 0, 1, 1, 0, 1]);
        }
        if (!parapet) continue;
        const i0 = o0 - sd * 0.25, i1 = o1 - sd * 0.25;
        if (sd > 0) b.vquad('concrete_smooth', at(k + 1, i1, top[k + 1]), at(k, i0, top[k]), at(k, i0, top[k] + 1.1), at(k + 1, i1, top[k + 1] + 1.1), true);
        else b.vquad('concrete_smooth', at(k, i0, top[k]), at(k + 1, i1, top[k + 1]), at(k + 1, i1, top[k + 1] + 1.1), at(k, i0, top[k] + 1.1), true);
        const t0 = at(k, o0, top[k] + 1.1), t1 = at(k + 1, o1, top[k + 1] + 1.1), q0 = at(k, i0, top[k] + 1.1), q1 = at(k + 1, i1, top[k + 1] + 1.1);
        if (sd > 0) b.hquad('concrete_smooth', q1, t1, t0, q0); else b.hquad('concrete_smooth', t0, t1, q1, q0);
      }
      // box girder soffit (faces down)
      if (!long) {
        b.down = true;
        b.quad('concrete_smooth', at(k, -h0k * 0.7, top[k] - 2.2), at(k, h0k * 0.7, top[k] - 2.2), at(k + 1, h1k * 0.7, top[k + 1] - 2.2), at(k + 1, -h1k * 0.7, top[k + 1] - 2.2), [0, 0, 1, 0, 1, 1, 0, 1]);
        b.down = false;
      }
    }
    const nP = long ? -1 : Math.floor(len / 32);
    for (let q = 0; q <= nP; q++) {
      const sc = nP ? (q * len) / nP : len / 2;
      let k = 0; while (k < n - 2 && s[k + 1] < sc) k++;
      const f = Math.min(1, (sc - s[k]) / Math.max(1e-6, s[k + 1] - s[k]));
      const cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, cz = pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f;
      const ty = top[k] + (top[k + 1] - top[k]) * f - 2.2;
      const bed = terrain(cx, cz) - h0 - 0.8;
      if (ty - bed < 1) continue;
      const hh = half[k];
      const ex = [N[k][0], 0, N[k][1]], ez = [N[k][2], 0, N[k][3]];
      const h = (ty - bed) / 2;
      b.obox('concrete', [cx, bed + h, cz], ex, ez, Math.min(2.2, hh * 0.35), h, 1.0, true);
      b.obox('concrete_smooth', [cx, ty - 0.6, cz], ex, ez, hh * 0.75, 0.6, 1.2, false, true);
    }
  } else {
    // ballast bed (trapezoid): top 0.30 below the rail head; at platforms the top ends at the platform
    // edge and drops straight to the formation (hidden under the platform overhang)
    const tFree = outer + 2.0, tPlat = outer + G.PLATFORM_EDGE - 0.08;
    for (let k = 0; k < n - 1; k++) {
      const uv = (o0, o1) => [o0, -s[k + 1], o1, -s[k + 1], o1, -s[k], o0, -s[k]];
      const tA = tFree + (tPlat - tFree) * zw[k], tB = tFree + (tPlat - tFree) * zw[k + 1];
      const yA = head[k] - 0.30, yB = head[k + 1] - 0.30;
      const gA = head[k] - G.RAIL_HEAD_AT_GRADE - 0.15, gB = head[k + 1] - G.RAIL_HEAD_AT_GRADE - 0.15;
      const sA = 1.0 - 0.95 * zw[k], sB = 1.0 - 0.95 * zw[k + 1];   // shoulder run (steep at platforms)
      b.quad('ballast', at(k + 1, -tB, yB), at(k + 1, tB, yB), at(k, tA, yA), at(k, -tA, yA), uv(-tA, tA));
      b.quad('ballast', at(k, -tA, yA), at(k + 1, -tB, yB), at(k + 1, -tB - sB, gB), at(k, -tA - sA, gA), [0, 0, 1, 0, 1, 1, 0, 1]);
      b.quad('ballast', at(k + 1, tB, yB), at(k, tA, yA), at(k, tA + sA, gA), at(k + 1, tB + sB, gB), [0, 0, 1, 0, 1, 1, 0, 1]);
    }
  }
  // sleepers + rails per track
  for (let tI = 0; tI < tracks; tI++) {
    const tc = (tI - (tracks - 1) / 2) * spacing;
    // sleepers every 0.65 m (2.6 × 0.26 × 0.18 m monoblock), top at the rail foot
    let next = Math.ceil(s[0] / 0.65) * 0.65;
    for (let k = 0; k < n - 1; k++) {
      while (next < s[k + 1]) {
        const f = (next - s[k]) / Math.max(1e-6, s[k + 1] - s[k]);
        const cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f + N[k][0] * tc, cz = pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f + N[k][1] * tc;
        const cy = head[k] + (head[k + 1] - head[k]) * f - RAIL_H - SLEEPER_H / 2;
        b.obox('sleeper', [cx, cy, cz], [N[k][0], 0, N[k][1]], [N[k][2], 0, N[k][3]], 1.3, SLEEPER_H / 2, 0.13);
        next += 0.65;
      }
    }
    // standard gauge = distance between the INNER faces of the rail heads (1.435 m): rail centrelines at
    // ±(gauge + head width) / 2 (QA-ASSETS-03: centres at ±gauge/2 left only 1.365 m between the heads)
    for (const rs of [-(G.GAUGE + RAIL_HEAD_W) / 2, (G.GAUGE + RAIL_HEAD_W) / 2]) {
      const o = tc + rs;
      for (let k = 0; k < n - 1; k++) {
        const y1a = head[k], y1b = head[k + 1], y0a = y1a - RAIL_H, y0b = y1b - RAIL_H;
        const A = at(k, o - 0.035, y1a), B2 = at(k, o + 0.035, y1a), C = at(k + 1, o + 0.035, y1b), D = at(k + 1, o - 0.035, y1b);
        b.quad('rail', D, C, B2, A, [0, s[k + 1], 0.07, s[k + 1], 0.07, s[k], 0, s[k]]);
        b.vquad('rail', at(k, o + 0.035, y0a), at(k + 1, o + 0.035, y0b), at(k + 1, o + 0.035, y1b), at(k, o + 0.035, y1a));
        b.vquad('rail', at(k + 1, o - 0.035, y0b), at(k, o - 0.035, y0a), at(k, o - 0.035, y1a), at(k + 1, o - 0.035, y1b));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// docks
// ---------------------------------------------------------------------------------------------
function dock(b, d, h0, terrain) {
  const poly = d.polygon; if (!poly || poly.length < 3) return;
  const top = (d.y ?? 2.5) - h0;
  const V = poly.map((p) => [p[0], top, p[1]]);
  const tri = triangulate(poly);
  for (let i = 0; i < tri.length; i += 3) {
    const A = V[tri[i]], B = V[tri[i + 1]], C = V[tri[i + 2]];
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (ny >= 0) b.tri('concrete', A, B, C, true); else b.tri('concrete', A, C, B, true);
  }
  let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length]; area += a[0] * c[1] - c[0] * a[1]; }
  for (let i = 0; i < V.length; i++) {
    const A = V[i], B = V[(i + 1) % V.length];
    const L = Math.hypot(B[0] - A[0], B[2] - A[2]); if (L < 0.5) continue;
    const bedA = Math.min(top - 1.2, terrain(A[0], A[2]) - h0), bedB = Math.min(top - 1.2, terrain(B[0], B[2]) - h0);
    const A0 = [A[0], d.kind === 'pier' ? top - 1.2 : bedA, A[2]], B0 = [B[0], d.kind === 'pier' ? top - 1.2 : bedB, B[2]];
    if (area > 0) b.vquad('concrete', B0, A0, A, B, true); else b.vquad('concrete', A0, B0, B, A, true);
    // bollards every 12 m and fenders every 6 m along edges
    const tx = (B[0] - A[0]) / L, tz = (B[2] - A[2]) / L;
    let nx = tz, nz = -tx; if (area < 0) { nx = -nx; nz = -nz; }
    for (let s2 = 3; s2 < L - 2; s2 += 6) {
      const px = A[0] + tx * s2, pz = A[2] + tz * s2;
      b.obox('rubber', [px + nx * 0.18, top - 0.7, pz + nz * 0.18], [tx, 0, tz], [nx, 0, nz], 0.35, 0.5, 0.15);
      if (Math.round(s2 / 6) % 2 === 0) {
        b.obox('steel_dark', [px - nx * 0.7, top + 0.3, pz - nz * 0.7], [tx, 0, tz], [nx, 0, nz], 0.16, 0.3, 0.16, true);
        b.obox('steel_dark', [px - nx * 0.7, top + 0.62, pz - nz * 0.7], [tx, 0, tz], [nx, 0, nz], 0.22, 0.04, 0.22);
      }
    }
  }
  // piles under piers
  if (d.kind === 'pier') {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let px = x0 + 3; px < x1 - 1; px += 8) for (let pz = z0 + 3; pz < z1 - 1; pz += 8) {
      if (!ptInPoly([px, pz], poly)) continue;
      const bed = terrain(px, pz) - h0 - 0.5;
      const h = (top - 1.2 - bed) / 2; if (h <= 0.2) continue;
      b.obox('concrete', [px, bed + h, pz], [1, 0, 0], [0, 0, 1], 0.3, h, 0.3);
    }
  }
}
function ptInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], c = poly[j];
    if ((a[1] > p[1]) !== (c[1] > p[1]) && p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function streetsTransferList(out) {
  const t = new Set();
  for (const p of out.parts || []) for (const k of ['position', 'normal', 'uv', 'color', 'index']) if (p[k]) t.add(p[k].buffer);
  if (out.colliders) { t.add(out.colliders.position.buffer); t.add(out.colliders.index.buffer); }
  return [...t];
}
