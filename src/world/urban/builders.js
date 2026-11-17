// Block layout engine: plots and buildings of one block (pure, deterministic).
//
// A block is a convex polygon whose edges carry street labels (parcels.blockPoly). Most urban
// block types are built with FRONTAGE STRIPS: every street edge gets an inward strip of plot depth,
// corners go to the more important street, each strip is cut into plots of 6–40 m frontage, every
// plot gets one building that faces its street (main entrance there, service / back door to the
// courtyard, lane or yard), neighbours in a strip share party walls where they touch (共墙关系).
// What remains inside is the courtyard / yard / garden. Special uses (towers, sheds, schools,
// stations, greenhouses, fields, sites) have their own placement rules.
//
// Buildings are oriented rectangles in the district plane: centre (cu,cv), front normal (fu,fv),
// right vector (xu,xv) = (−fv, fu) (building +X), width w along the front, depth d.
import { hash4 } from '../../core/hash.js';
import { DC, BU, RoofKind as RK, FarmCrop, RAIL, SurfaceClass as SC, LightClass as LC, ROOF_STYLES } from './rules.js';
import { rasterLand, rasterSlope, rasterSample, rasterCoast, fromPlane, waterLinesNear, enToPlane, district1, rectSlope, keepsCliffsBare, promenadeDist, nearRiver, canalNearest, waterSite, nearCanal } from './districts.js';
import { isWet, height } from './probe.js';
import { pointInPoly, clipHalfPlane, polyArea, polyBounds, segDist } from './geom.js';
import { cropOf, blockYear, farmIrrigated, g02TerraceAt } from './parcels.js';

function sstep(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
import { harbourAt } from './harbour.js';
const HBB = {};

const PRIO = { art: 4, coll: 3, street: 2, rail: 1, edge: 0 };
const QB = {};

// ---------------------------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------------------------
class Builder {
  constructor(G, i, j, info, bp, f) {
    this.G = G; this.D = G.D; this.i = i; this.j = j; this.info = info; this.bp = bp; this.f = f;
    this.P = bp ? bp.P : null;
    this.bld = []; this.areas = []; this.lanes = [];
    this.seed = hash4(G.key, i, j, 0xb10d);
    this.n = 0;
    this.frames = bp ? edgeFrames(bp) : [];
    // waterfront districts (U3 / G01): low by the water, heights rising inland (rasterCoast = smooth shore distance)
    this.hk = 1; this.peak = 0; this.sky = 0; this.crown = 0;
    if (bp && (this.D.waterfront || this.D.harbour)) {
      let cu = 0, cv = 0; for (let k = 0; k < bp.P.length; k += 2) { cu += bp.P[k]; cv += bp.P[k + 1]; }
      cu /= bp.P.length / 2; cv /= bp.P.length / 2;
      if (this.D.waterfront) this.hk = 0.42 + 0.58 * sstep(120, 1300, rasterCoast(G, cu, cv));
      // G01 harbour: the storey cap of the block's own position (tower clusters read as separate peaks)
      if (this.D.harbour) { fromPlane(this.D, cu, cv, QB); harbourAt(QB.x, QB.y, QB.z, HBB); this.peak = HBB.w > 0 ? HBB.peak : this.D.peakFloors || 0; this.sky = HBB.w > 0 ? HBB.peak : 0; this.crown = HBB.w > 0 && HBB.crown ? 1 : 0; }
    }
  }
  /** storeys scaled by the waterfront rise and capped by the block's peak (G01 harbour centres) */
  fl(n, min = 2) {
    let f = Math.max(min, Math.round(n * this.hk));
    const pk = this.peak || this.D.peakFloors || 0;
    if (pk && f > pk) f = Math.max(Math.min(min, pk), pk - ((this.seed >>> 0) % 5));
    return f;
  }
  rnd() { this.n++; return hash4(this.seed, this.n, 0x2b, 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.rnd(); }
  int(a, b) { return a + Math.floor(this.rnd() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  /**
   * Add an oriented building. o: {cu, cv, fu, fv, w, d, use, tier, floors, fh, gfh, roofKind, roofType,
   * roof, shape, local (footprint pts in local x,z), hole, circle, tower, podium, meta, lc, plot, frontage}
   */
  add(o) {
    if (!(o.w >= 3) || !(o.d >= 3)) return null;
    const fl = Math.hypot(o.fu, o.fv) || 1;
    const fu = o.fu / fl, fv = o.fv / fl, xu = -fv, xv = fu;
    const b = {
      idx: -1, use: o.use, tier: o.tier || 'lowrise', shape: o.shape || 'rect',
      cu: o.cu, cv: o.cv, fu, fv, xu, xv, w: o.w, d: o.d,
      floors: Math.max(1, Math.round(o.floors || 1)), fh: o.fh || 3.1, gfh: o.gfh || o.fh || 3.1,
      roofKind: o.roofKind !== undefined ? o.roofKind : RK.CERAMIC, roofType: o.roofType || 'flat', roof: o.roof !== undefined ? o.roof : 0.82,
      tower: o.tower || null, podium: o.podium || null, circle: o.circle || 0, local: o.local || null, pp: null,
      shared: { left: false, right: false, back: false }, nbr: { left: -1, right: -1, back: -1 },
      plot: o.plot || null, frontage: o.frontage || 'street', yearOff: Math.round((this.rnd() - 0.5) * 10),
      meta: o.meta || {}, basement: o.basement || 0, lc: o.lc || LC.RESIDENTIAL, site: !!o.site, station: o.station || null,
      bx0: 0, by0: 0, bx1: 0, by1: 0, height: 0,
    };
    b.height = b.gfh + (b.floors - 1) * b.fh;
    if (b.podium && b.tower) b.height = Math.max(b.height, b.podium.height);
    if (o.height) b.height = o.height;
    // plane footprint polygon for non-rect shapes
    if (b.local && b.shape !== 'rect') {
      const pp = [];
      for (const [x, z] of b.local) pp.push(b.cu + x * xu + z * fu, b.cv + x * xv + z * fv);
      b.pp = pp;
    }
    const hw = o.w / 2, hd = o.d / 2;
    const ex = Math.abs(xu) * hw + Math.abs(fu) * hd, ey = Math.abs(xv) * hw + Math.abs(fv) * hd;
    b.bx0 = b.cu - ex; b.bx1 = b.cu + ex; b.by0 = b.cv - ey; b.by1 = b.cv + ey;
    if (!b.plot) b.plot = rectPolyOf(b, 2, 2);
    this.bld.push(b);
    return b;
  }
  area(kind, poly, extra) {
    if (!poly || poly.length < 6) return null;
    const A = Math.abs(polyArea(poly));
    if (A < 4) return null;
    const bb = polyBounds(poly, {});
    const a = { kind, poly, x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, area: A, ...(extra || {}) };
    this.areas.push(a);
    return a;
  }
  lane(u0, v0, u1, v1, w) { this.lanes.push({ u0, v0, u1, v1, w }); }
}

function rectPolyOf(b, mx, mz) {
  const hw = b.w / 2 + mx, hd = b.d / 2 + mz, out = [];
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) out.push(b.cu + x * b.xu + z * b.fu, b.cv + x * b.xv + z * b.fv);
  return out;
}

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------
/** edge frames of a labelled block polygon: origin at the edge start, t along (CCW), n inward */
function edgeFrames(bp) {
  const P = bp.P, n = P.length >> 1, out = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const ou = P[2 * k], ov = P[2 * k + 1];
    const dx = P[2 * k1] - ou, dy = P[2 * k1 + 1] - ov, len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const tu = dx / len, tv = dy / len, nu = -tv, nv = tu;
    let depth = 0;
    for (let q = 0; q < P.length; q += 2) { const d = (P[q] - ou) * nu + (P[q + 1] - ov) * nv; if (d > depth) depth = d; }
    const lab = bp.L[k] || { kind: 'edge', w: 0 };
    out.push({ k, ou, ov, tu, tv, nu, nv, len, lab, kind: lab.kind, prio: PRIO[lab.kind] ?? 0, depth });
  }
  return out;
}
const isFront = (fr) => fr.kind === 'street' || fr.kind === 'coll' || fr.kind === 'art';

/** convex point-in-polygon with margin m (inside by at least m) for a CCW polygon */
function insideM(P, u, v, m = 0) {
  const n = P.length >> 1;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const ax = P[2 * i], ay = P[2 * i + 1], ex = P[2 * k] - ax, ey = P[2 * k + 1] - ay;
    const l = Math.hypot(ex, ey) || 1;
    if (((u - ax) * -ey + (v - ay) * ex) / l < m) return false;
  }
  return true;
}
/** are the 4 corners of an oriented rect inside convex P (margin m)? */
function rectIn(P, cu, cv, xu, xv, fu, fv, w, d, m = 0) {
  const hw = w / 2, hd = d / 2;
  for (let q = 0; q < 4; q++) {
    const x = q & 1 ? hw : -hw, z = q & 2 ? hd : -hd;
    if (!insideM(P, cu + x * xu + z * fu, cv + x * xv + z * fv, m)) return false;
  }
  return true;
}
/** clip convex P to {t in [ta,tb], n in [na,nb]} of a frame */
function clipFrame(P, fr, ta, tb, na, nb) {
  let p = P;
  // t ≥ ta : (u-ou)·t - ta ≥ 0  →  tu·u + tv·v - (tu·ou + tv·ov + ta) ≥ 0
  const ct = fr.tu * fr.ou + fr.tv * fr.ov, cn = fr.nu * fr.ou + fr.nv * fr.ov;
  if (ta > -1e8) p = clipHalfPlane(p, fr.tu, fr.tv, -(ct + ta));
  if (tb < 1e8) p = clipHalfPlane(p, -fr.tu, -fr.tv, ct + tb);
  if (na > -1e8) p = clipHalfPlane(p, fr.nu, fr.nv, -(cn + na));
  if (nb < 1e8) p = clipHalfPlane(p, -fr.nu, -fr.nv, cn + nb);
  return p;
}
/** frame coords → plane */
function fp(fr, t, n) { return [fr.ou + fr.tu * t + fr.nu * n, fr.ov + fr.tv * t + fr.nv * n]; }

/** the main frontage frame of a block (highest street class, longest) */
function mainFrame(Bd) {
  let best = null;
  for (const fr of Bd.frames) if (!best || fr.prio > best.prio || (fr.prio === best.prio && fr.len > best.len)) best = fr;
  return best;
}
/** frame of the block's longest axis aligned edge facing a street (for sheds, slabs) */
function longFrame(Bd) {
  let best = null;
  for (const fr of Bd.frames) { const s = fr.len * (isFront(fr) ? 1 : 0.6); if (!best || s > best.s) best = { fr, s }; }
  return best ? best.fr : null;
}

/**
 * Place an oriented rect in frame fr: t ∈ [ta,tb], n ∈ [na,nb] (n inward from the street edge).
 * Shrinks symmetrically along t, then the back along n until the rect fits P (margin m). Returns
 * {cu, cv, w, d, fu, fv} or null. Front faces the street (−n).
 */
function placeRect(P, fr, ta, tb, na, nb, m = 0.5, minW = 4, minD = 4) {
  let a = ta, b = tb, c = na, e = nb;
  for (let it = 0; it < 14; it++) {
    const w = b - a, d = e - c;
    if (w < minW || d < minD) return null;
    const tc = (a + b) / 2, nc = (c + e) / 2;
    const [cu, cv] = fp(fr, tc, nc);
    if (rectIn(P, cu, cv, fr.tu, fr.tv, -fr.nu, -fr.nv, w, d, m)) return { cu, cv, w, d, fu: -fr.nu, fv: -fr.nv, tc, nc };
    if (it % 3 === 2) e -= d * 0.12; else { a += w * 0.06; b -= w * 0.06; }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// frontage strips
// ---------------------------------------------------------------------------------------------
/**
 * Strips along the frontage edges. depthOf(fr) → plot depth; returns [{fr, ta, tb, dp, poly}]
 * with corner allocation by priority; also writes Bd.inner (courtyard polygon).
 */
function strips(Bd, depthOf, filter = isFront) {
  const F = Bd.frames.filter(filter);
  const out = [];
  if (!F.length) { Bd.inner = Bd.P; return out; }
  const dps = F.map((fr) => Math.max(4, Math.min(depthOf(fr), fr.depth * 0.5 - 1)));
  // courtyard = P minus all strips (convex)
  let inner = Bd.P;
  for (let q = 0; q < F.length; q++) {
    const fr = F[q], cn = fr.nu * fr.ou + fr.nv * fr.ov;
    inner = clipHalfPlane(inner, fr.nu, fr.nv, -(cn + dps[q]));
    if (inner.length < 6) break;
  }
  Bd.inner = inner.length >= 6 ? inner : null;
  for (let q = 0; q < F.length; q++) {
    const fr = F[q], dp = dps[q];
    let poly = clipFrame(Bd.P, fr, -1e9, 1e9, -0.01, dp);
    // corners: cut by the bands of adjacent higher-priority frontages
    for (let r = 0; r < F.length; r++) {
      if (r === q) continue;
      const o = F[r];
      const higher = o.prio > fr.prio || (o.prio === fr.prio && (o.len > fr.len || (o.len === fr.len && o.k < fr.k)));
      if (!higher) continue;
      // only edges whose band actually meets this strip
      const cn = o.nu * o.ou + o.nv * o.ov;
      poly = clipHalfPlane(poly, o.nu, o.nv, -(cn + dps[r]));
      if (poly.length < 6) break;
    }
    if (poly.length < 6) continue;
    // extent of the strip along t at the frontage line
    let ta = 1e9, tb = -1e9;
    for (let k = 0; k < poly.length; k += 2) { const t = (poly[k] - fr.ou) * fr.tu + (poly[k + 1] - fr.ov) * fr.tv; if (t < ta) ta = t; if (t > tb) tb = t; }
    if (tb - ta < 5) continue;
    out.push({ fr, ta, tb, dp, poly });
  }
  return out;
}

/** split a length into plots of width in [wmin,wmax], in groups of g plots separated by gaps */
function splitRow(B, len, wmin, wmax, gap, gmin, gmax) {
  const out = [];
  let x = 0;
  while (x < len - wmin * 0.8) {
    const g = B.int(gmin, gmax);
    let k = 0;
    for (; k < g && x < len - wmin * 0.8; k++) {
      let w = B.range(wmin, wmax);
      if (len - (x + w) < wmin * 0.8) w = len - x;
      out.push([x, x + w, k === 0 ? 'start' : 'mid']);
      x += w;
    }
    if (out.length) { const last = out[out.length - 1]; last[2] = last[2] === 'start' ? 'single' : 'end'; }
    x += gap;
  }
  return out;
}

/**
 * Fill one strip with a row of buildings. o: {wmin, wmax, gap, gmin, gmax, setback, depth(fn|num),
 * floors(fn|num), b (building options), sideGap, cornerBoost}. Returns created buildings in order.
 */
function fillStrip(B, s, o) {
  const fr = s.fr;
  const len = s.tb - s.ta;
  const parts = splitRow(B, len, o.wmin, o.wmax, o.gap || 0, o.gmin || 1, o.gmax || 1);
  const res = [];
  let prev = null;
  for (let pi = 0; pi < parts.length; pi++) {
    const [a0, a1, pos] = parts[pi];
    const ta = s.ta + a0, tb = s.ta + a1;
    const sb = typeof o.setback === 'function' ? o.setback() : (o.setback || 0);
    const dep = Math.min(typeof o.depth === 'function' ? o.depth() : o.depth, s.dp - sb - 0.5);
    if (dep < 5) { prev = null; continue; }
    const sg = o.sideGap || 0;
    const n0 = Math.max(0.05, sb);
    const r = placeRect(s.poly, fr, ta + sg, tb - sg, n0, n0 + dep, -0.03, Math.min(5, o.wmin * 0.7), 5);
    if (!r) { prev = null; continue; }
    let floors = typeof o.floors === 'function' ? o.floors(pi, parts.length) : o.floors;
    const corner = (pi === 0 || pi === parts.length - 1) && (o.gap || 0) === 0;
    if (corner && o.cornerBoost) floors += o.cornerBoost;
    if (B.sky && floors > B.sky + 1) floors = B.sky + 1;   // G01 harbour skyline cap (U2): low front row, mid-rise between the clusters
    // U8 (QY-03): no pencil towers on narrow plots — at most ~0.9 storeys per metre of the short side
    floors = Math.min(floors, Math.max(2, Math.round(Math.min(r.w, r.d) * 0.9)));
    const bo = typeof o.b === 'function' ? o.b(pi, corner, r) : o.b;
    // plot: the slice of the strip between ta and tb (full strip depth)
    const plot = clipFrame(s.poly, fr, ta, tb, -1e9, 1e9);
    const b = B.add({ ...bo, cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, floors, plot: plot.length >= 6 ? plot : null,
      frontage: fr.kind === 'art' ? 'arterial' : fr.kind === 'coll' ? 'collector' : 'street', meta: { ...(bo.meta || {}), corner: corner || undefined } });
    if (!b) { prev = null; continue; }
    b._t0 = r.tc - r.w / 2; b._t1 = r.tc + r.w / 2; b._fr = fr; b._nb = r.nc + r.d / 2;
    if (prev && (pos === 'mid' || pos === 'end') && Math.abs(prev._t1 - b._t0) < 0.6) { prev.nbr.right = b; b.nbr.left = prev; prev.shared.right = true; b.shared.left = true; }
    prev = b;
    res.push(b);
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------------------------
export function generateBlock(G, i, j, info, bp, f) {
  const B = new Builder(G, i, j, info, bp, f);
  const L = { G, i, j, use: info.use, active: info.active, poly: bp ? bp.P : null, labels: bp ? bp.L : null, rect: bp ? bp.rect : null,
    bld: B.bld, areas: B.areas, lanes: B.lanes, defaultCls: SC.YARD, year: info.year, info, canalSegs: null };
  if (bp && info.active) {
    const gen = GEN[info.use];
    if (gen) gen(B, L);
  }
  // sites (outposts, sluice stations, junction pumps) anchored in this block — also in inactive blocks
  if (f && f.sites) for (const s of f.sites) genSite(B, L, s);
  finalize(B, L);
  return L;
}

/** remove buildings on water / steep ground / rails, index them, resolve neighbours */
function finalize(B, L) {
  const G = B.G, D = G.D;
  const smax = D.terraced ? (D.rules.slopeTerrace || 0.6) : D.rules.slopeMax;
  const bare = keepsCliffsBare(D);
  const keep = [];
  for (const b of B.bld) {
    if (!b.site) {
      const c = cornersOf(b);
      let ok = true;
      for (let k = 0; k < 8 && ok; k += 2) if (rasterLand(G, c[k], c[k + 1]) < 0.5) ok = false;
      if (!ok) continue;
      if (rasterSlope(G, b.cu, b.cv) > smax * 1.08) continue;
      if (hitsRail(G, b)) continue;
      if (rasterCoast(G, b.cu, b.cv) < 160 && !cornersDry(D, c)) continue;
      // canyon walls stay bare red rock (Z04): nothing on fine slopes > 0.65 (raster fabric fades 0.5–0.8)
      if (bare && rectSlope(G, b.cu, b.cv, b.xu, b.xv, b.fu, b.fv, b.w, b.d) > 0.65) continue;
      // small O-zone utilities need a near-level site (★ corner spread ≤ 3 m, larger halls ≤ 4 m)
      if (D.zone === 'O' && O_UTIL.has(b.use) && cornerSpread(D, c) > (Math.max(b.w, b.d) > 26 ? 4 : 3)) continue;
      // never on top of a district site (water works, OX4 outlet ensembles), whatever block it sits in
      if (G.sites.length && hitsSite(G, b, c)) continue;
      // U12: river corridors stay free (half width + 15 m: banks, towpaths, flood margin)
      if (G.canals.length && G.canals.some((cn) => cn.kind === 'river')) {
        let wet = nearRiver(G, b.cu, b.cv, 15);
        for (let k = 0; k < 8 && !wet; k += 2) wet = nearRiver(G, c[k], c[k + 1], 15);
        if (wet) continue;
      }
      // never on canal water (fix round 3: greenhouse rows / sheds reaching into a canal beside their block)
      if (G.canals.length) {
        let wet = nearCanal(G, b.cu, b.cv, 0.5);
        for (let k = 0; k < 8 && !wet; k += 2) wet = nearCanal(G, c[k], c[k + 1], 0.5);
        if (wet) continue;
      }
      // the shaded waterfront promenade (12 m + 2 m clear) stays free
      if (D.waterfront && rasterCoast(G, b.cu, b.cv) < 400) {
        let near = promenadeDist(G, b.cu, b.cv) < Math.hypot(b.w, b.d) / 2 + 8;
        if (near) { near = false; for (let k = 0; k < 8 && !near; k += 2) if (promenadeDist(G, c[k], c[k + 1]) < 8) near = true; if (!near) near = promenadeDist(G, b.cu, b.cv) < Math.min(b.w, b.d) / 2 + 8; }
        if (near) continue;
      }
    }
    keep.push(b);
  }
  B.bld.length = 0;
  for (const b of keep) B.bld.push(b);
  for (let k = 0; k < B.bld.length; k++) B.bld[k].idx = k;
  for (const b of B.bld) {
    for (const s of ['left', 'right', 'back']) {
      const nb = b.nbr[s];
      if (nb && typeof nb === 'object' && nb.idx >= 0 && B.bld[nb.idx] === nb) { b.nbr[s] = nb.idx; }
      else { b.nbr[s] = -1; b.shared[s] = false; }
    }
    delete b._fr; delete b._t0; delete b._t1; delete b._nb;
  }
  // drop areas on water (quay aprons hug the shore: exact test)
  const ak = [];
  for (const a of B.areas) {
    const cu = (a.x0 + a.x1) / 2, cv = (a.y0 + a.y1) / 2;
    if (a.kind === 'dock') { fromPlane(D, cu, cv, QB); if (isWet(QB.x, QB.y, QB.z, 2)) continue; }
    else if (a.kind !== 'field' && rasterLand(G, cu, cv) < 0.5) continue;
    ak.push(a);
  }
  B.areas.length = 0; for (const a of ak) B.areas.push(a);
}

const O_UTIL = new Set(['pumphouse', 'sluice_station', 'meltwater_pump', 'water_treatment', 'control_tower', 'maintenance', 'insulated_station', 'service_depot', 'farm_station', 'cold_storage']);
/** terrain height spread (m, 2 m band limit) over the corners of a plane polygon c (flat u,v array) */
function cornerSpread(D, c) {
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < c.length; k += 2) { fromPlane(D, c[k], c[k + 1], QB); const h = height(QB.x, QB.y, QB.z, 2); if (h < lo) lo = h; if (h > hi) hi = h; }
  return hi - lo;
}

/** does generated building b (corners c) overlap a site footprint of district G (3 m clearance)? */
function hitsSite(G, b, c) {
  const rb = Math.hypot(b.w, b.d) / 2;
  for (const s of G.sites) {
    const w = s.w || 20, d = s.d || 14;
    if (Math.hypot(s.u - b.cu, s.v - b.cv) > rb + Math.hypot(w, d) / 2 + 3) continue;
    let fu = s.fu, fv = s.fv;
    if (fu === undefined) { const a = (s.rot || 0) * Math.PI / 2; fu = Math.sin(a); fv = Math.cos(a); }
    const xu = -fv, xv = fu;
    const inS = (u, v) => { const du = u - s.u, dv = v - s.v; return Math.abs(du * xu + dv * xv) < w / 2 + 3 && Math.abs(du * fu + dv * fv) < d / 2 + 3; };
    if (inS(b.cu, b.cv)) return true;
    for (let k = 0; k < 8; k += 2) if (inS(c[k], c[k + 1])) return true;
    // site corners inside b
    for (let q = 0; q < 4; q++) {
      const x = q & 1 ? w / 2 : -w / 2, z = q & 2 ? d / 2 : -d / 2;
      const u = s.u + x * xu + z * fu, v = s.v + x * xv + z * fv;
      const du = u - b.cu, dv = v - b.cv;
      if (Math.abs(du * b.xu + dv * b.xv) < b.w / 2 + 3 && Math.abs(du * b.fu + dv * b.fv) < b.d / 2 + 3) return true;
    }
  }
  return false;
}

function cornersOf(b) {
  const hw = b.w / 2, hd = b.d / 2, out = [];
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) out.push(b.cu + x * b.xu + z * b.fu, b.cv + x * b.xv + z * b.fv);
  return out;
}
function cornersDry(D, c) {
  for (let k = 0; k < 8; k += 2) {
    fromPlane(D, c[k], c[k + 1], QB);
    if (isWet(QB.x, QB.y, QB.z, 1) || isWet.h < 0.6) return false;
  }
  return true;
}
function hitsRail(G, b) {
  const c = cornersOf(b);
  for (const r of G.rails) {
    if (r.aligned) continue;
    const half = (r.rail ? RAIL.corridor / 2 : (r.roadW || 10) / 2) + 3;
    let minS = 1e9, maxS = -1e9, crossMin = 1e9, sgnPos = false, sgnNeg = false;
    for (let k = -2; k < 8; k += 2) {
      const u = k < 0 ? b.cu : c[k], v = k < 0 ? b.cv : c[k + 1];
      const du = u - r.pu, dv = v - r.pv;
      const s = du * r.du + dv * r.dv, cr = -du * r.dv + dv * r.du;
      if (s < minS) minS = s; if (s > maxS) maxS = s;
      if (Math.abs(cr) < crossMin) crossMin = Math.abs(cr);
      if (cr > 0) sgnPos = true; else sgnNeg = true;
    }
    if (maxS < r.s0 || minS > r.s1) continue;
    if ((sgnPos && sgnNeg) || crossMin < half) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------------------------
/** roof kind of ordinary housing from the district's roof palette (or an explicit list) */
function roofFor(B, list = null) { const L = list || ROOF_STYLES[B.D.roofStyle || 0]; return L[Math.floor(B.rnd() * L.length)]; }
function covered(B) { return B.D.covered ? { covered: true } : {}; }

// ---------------------------------------------------------------------------------------------
// generators
// ---------------------------------------------------------------------------------------------
const GEN = [];

GEN[BU.PERIMETER] = (B, L) => {
  const D = B.D;
  const core = D.cls === DC.CORE;
  const base = core ? B.int(9, 13) : Math.round(5 + 7 * Math.min(1, D.inten) * B.range(0.75, 1.1));
  const dep = B.range(12, 15.5);
  const roofK = B.rnd() < 0.25 ? RK.GARDEN : roofFor(B);
  const S = strips(B, () => dep);
  for (const s of S) {
    const main = s.fr.kind === 'art' || s.fr.kind === 'coll';
    const passage = !main && B.rnd() < 0.4;   // a gate / passage into the courtyard now and then
    fillStrip(B, s, {
      wmin: 14, wmax: core ? 38 : 30, gap: 0, gmin: passage ? 2 : 30, gmax: passage ? 4 : 30, setback: main ? 0 : B.range(0, 2), depth: () => dep * B.range(0.92, 1.05),
      floors: () => B.fl(Math.min(14, base + (main ? B.int(0, 2) : B.int(-1, 1)))), cornerBoost: B.int(1, 2),
      b: () => {
        const shop = main && B.rnd() < 0.8;
        return { use: shop && base <= 7 ? 'shop_row' : 'residential', tier: 'midrise', fh: 3.1, gfh: shop ? 4.8 : 3.6, roofKind: roofK, roofType: roofK === RK.GARDEN ? 'garden' : 'flat', lc: LC.RESIDENTIAL, meta: { courtyard: true, shops: shop || undefined, ...covered(B) } };
      },
    });
  }
  if (B.inner) B.area('courtyard', B.inner);
  if (!B.bld.length) GEN[BU.SLAB](B, L);
  L.defaultCls = SC.YARD;
};

GEN[BU.MIXED] = (B, L) => {
  const D = B.D;
  const core = D.cls === DC.CORE;
  const base = core ? B.int(8, 14) : Math.round(4 + 6 * Math.min(1, D.inten) * B.range(0.8, 1.15));
  const dep = B.range(13, 18);
  const S = strips(B, () => dep);
  let officeDone = false;
  for (const s of S) {
    const main = s.fr.kind === 'art' || s.fr.kind === 'coll';
    fillStrip(B, s, {
      wmin: 12, wmax: 34, gap: 0, gmin: 30, gmax: 30, setback: 0, depth: () => dep * B.range(0.9, 1.05),
      floors: () => B.fl(Math.max(3, base + B.int(-2, 2)), 3), cornerBoost: 2,
      b: (pi, corner, r) => {
        // offices need a real floor plate (QY-03): short side ≥ 12 m, else the corner stays housing / shops
        if (main && !officeDone && corner && B.rnd() < 0.6 && r && Math.min(r.w, r.d) >= 12) { officeDone = true; return { use: 'office', tier: base > 10 ? 'tower' : 'midrise', fh: 3.8, gfh: 5, roofKind: RK.SOLAR, lc: LC.COMMERCIAL, meta: { ...covered(B) } }; }
        const shop = main || B.rnd() < 0.5;
        return { use: shop && base <= 7 ? 'shop_row' : 'residential', tier: 'midrise', fh: 3.1, gfh: shop ? 4.8 : 3.6, roofKind: roofFor(B), lc: shop ? LC.COMMERCIAL : LC.RESIDENTIAL, meta: { shops: shop || undefined, ...covered(B) } };
      },
    });
  }
  if (B.inner) B.area(B.rnd() < 0.5 ? 'courtyard' : 'yard', B.inner);
  if (!B.bld.length) GEN[BU.SHOPS](B, L);
  L.defaultCls = SC.YARD;
};

GEN[BU.COURT] = (B, L) => {
  // low-rise courtyard blocks: 2–4 storey houses around a shared garden (old town grain)
  const dep = B.range(10, 12.5);
  const roofK = roofFor(B, [RK.CERAMIC, RK.WARM, RK.CERAMIC, RK.GARDEN]);
  const S = strips(B, () => dep);
  for (const s of S) {
    fillStrip(B, s, {
      wmin: 9, wmax: 17, gap: B.rnd() < 0.4 ? B.range(3, 5) : 0, gmin: 3, gmax: 8, setback: B.range(0, 3), depth: () => dep * B.range(0.9, 1.05),
      floors: () => B.int(2, 4), cornerBoost: 1,
      b: () => ({ use: 'residential', tier: 'lowrise', fh: 3.1, gfh: 3.3, roofKind: roofK, roofType: B.rnd() < 0.3 ? 'pitched' : 'flat', lc: LC.RESIDENTIAL, meta: { courtyard: true, ...covered(B) } }),
    });
  }
  if (B.inner) B.area('garden', B.inner);
  L.defaultCls = SC.YARD;
};

GEN[BU.ROW] = (B, L) => {
  // terraces back to back with gardens and a mid-block lane (巷道) on deep blocks
  const D = B.D;
  const F = B.frames.filter(isFront);
  if (!F.length) return;
  // the two long frontages carry the rows; short ends get corner shops
  const longest = F.reduce((a, b) => (b.len > a.len ? b : a));
  const depthAcross = longest.depth;
  const lane = D.lane > 0 && depthAcross > 36 ? D.lane : 0;
  const half = (depthAcross - lane) / 2;
  const terr = B.rnd() < 0.72;
  const roofK = roofFor(B);
  const pitched = B.rnd() < 0.3;
  const S = strips(B, (fr) => (Math.abs(fr.tu * longest.tu + fr.tv * longest.tv) > 0.9 ? half : B.range(12, 16)));
  for (const s of S) {
    const along = Math.abs(s.fr.tu * longest.tu + s.fr.tv * longest.tv) > 0.9;
    const coll = s.fr.kind === 'coll' || s.fr.kind === 'art';
    const setback = coll ? B.range(0.5, 2) : B.range(2.5, 5);
    const depth = Math.min(s.dp - setback - 3, B.range(9.5, 13));
    const blds = fillStrip(B, s, along ? {
      wmin: terr ? 6.2 : 10, wmax: terr ? 8.8 : 14, gap: terr ? B.range(3, 4.5) : B.range(4, 6), gmin: terr ? 3 : 1, gmax: terr ? 7 : 1,
      depth, setback, floors: () => (coll ? B.int(3, 4) : B.int(2, 3)),
      b: () => ({ use: coll && B.rnd() < 0.7 ? 'shop_row' : 'residential', tier: 'lowrise', fh: 3.1, gfh: coll ? 4.2 : 3.1, roofKind: roofK, roofType: pitched ? 'pitched' : (roofK === RK.GARDEN ? 'garden' : 'flat'), lc: LC.RESIDENTIAL, meta: { backLane: lane > 0 || undefined, ...covered(B) } }),
    } : {
      wmin: 8, wmax: 14, gap: 0, gmin: 1, gmax: 3, depth: Math.min(s.dp - 1, 12), setback: 1, floors: () => B.int(2, 4),
      b: () => ({ use: 'shop_row', tier: 'lowrise', fh: 3.1, gfh: 4.2, roofKind: roofK, roofType: 'flat', lc: LC.COMMERCIAL, meta: { corner: true, ...covered(B) } }),
    });
    // back gardens behind each house, down to the lane / the other half
    for (const b of blds) {
      const g = clipFrame(s.poly, s.fr, b._t0, b._t1, b._nb + 0.2, 1e9);
      if (g.length >= 6) B.area('garden', g);
    }
  }
  if (lane) {
    const fr = longest;
    const n0 = half, n1 = half + lane;
    const poly = clipFrame(B.P, fr, -1e9, 1e9, n0, n1);
    if (poly.length >= 6) {
      B.area('lane', poly);
      const [au, av] = fp(fr, 0, (n0 + n1) / 2), [bu, bv] = fp(fr, fr.len, (n0 + n1) / 2);
      B.lane(au, av, bu, bv, lane);
    }
  }
  if (B.inner) B.area('yard', B.inner);
  L.defaultCls = SC.YARD;
};

GEN[BU.DETACHED] = (B, L) => {
  const S = strips(B, () => B.range(26, 34));
  for (const s of S) {
    const blds = fillStrip(B, s, {
      wmin: 10, wmax: 15, gap: B.range(5, 9), gmin: 1, gmax: 2, depth: () => B.range(9, 12.5), setback: () => B.range(4, 7), sideGap: 0.5,
      floors: () => B.int(2, 3),
      b: () => ({ use: 'residential', tier: 'lowrise', fh: 3.1, gfh: 3.2, roofKind: roofFor(B), roofType: B.rnd() < 0.45 ? 'pitched' : 'flat', lc: LC.RESIDENTIAL, meta: { ...covered(B) } }),
    });
    for (const b of blds) { const g = clipFrame(s.poly, s.fr, b._t0 - 2, b._t1 + 2, b._nb + 0.3, 1e9); if (g.length >= 6) B.area('garden', g); }
  }
  if (B.inner) B.area('garden', B.inner);
  L.defaultCls = SC.YARD;
};

GEN[BU.VILLAGE] = (B, L) => {
  const D = B.D;
  const O = D.zone === 'O';
  const F = B.frames.filter(isFront);
  if (!F.length) return;
  const sel = F.slice().sort((a, b) => b.prio - a.prio || b.len - a.len).slice(0, B.rnd() < 0.5 ? 1 : 2);
  const S = strips(B, () => B.range(24, 34), (fr) => sel.includes(fr));
  for (const s of S) {
    const blds = fillStrip(B, s, {
      wmin: 10, wmax: 16, gap: B.range(8, 22), gmin: 1, gmax: 2, depth: () => B.range(9, 13), setback: () => B.range(4, 9), sideGap: 0.5,
      floors: () => B.int(1, 3),
      b: () => ({ use: O ? 'dorm' : 'residential', tier: 'lowrise', fh: 3.1, gfh: 3.2, roofKind: roofFor(B, [RK.CERAMIC, RK.WARM, RK.CERAMIC, RK.SOLAR]), roofType: B.rnd() < 0.5 ? 'pitched' : 'flat', lc: LC.RURAL, meta: { rural: true } }),
    });
    for (const b of blds) { const g = clipFrame(s.poly, s.fr, b._t0 - 3, b._t1 + 3, b._nb + 0.3, b._nb + 22); if (g.length >= 6) B.area('garden', g); }
  }
  // rest of the block: small fields / orchard behind the houses (Z) or yard (O)
  const rest = B.inner || B.P;
  if (rest && rest.length >= 6) {
    if (!O && B.rnd() < 0.6) { const c = cropOf(B.G, B.i, B.j, 7); B.area('field', rest, { crop: c.crop, stage: c.stage, strip: 0 }); }
    else B.area('green', rest);
  }
  L.defaultCls = SC.YARD;
};

GEN[BU.SHOPS] = (B, L) => {
  const D = B.D;
  const tall = D.cls === DC.CORE || D.cls === DC.MID;
  const dep = B.range(12, 18);
  const S = strips(B, () => dep);
  for (const s of S) {
    fillStrip(B, s, {
      wmin: 8, wmax: 18, gap: 0, gmin: 30, gmax: 30, depth: () => dep * B.range(0.9, 1.04), setback: 0,
      floors: () => (tall ? B.int(3, 6) : B.int(2, 4)), cornerBoost: 1,
      b: () => ({ use: 'shop_row', tier: tall ? 'midrise' : 'lowrise', fh: 3.1, gfh: 4.8, roofKind: roofFor(B), roofType: 'flat', lc: LC.COMMERCIAL, meta: { shops: true, ...covered(B) } }),
    });
  }
  if (B.inner) B.area('yard_service', B.inner);
  L.defaultCls = SC.YARD;
};

GEN[BU.SLAB] = (B, L) => {
  const D = B.D;
  const fr = longFrame(B);
  if (!fr) return;
  const dep = B.range(12, 15);
  const fl = B.fl(Math.round(D.cls === DC.CORE ? B.int(12, 18) : (D.cls === DC.LOW ? B.int(4, 6) : 6 + 8 * Math.min(1, D.inten) * B.range(0.7, 1.1))), 3);
  const H = 3.6 + (fl - 1) * 3.1;
  const spacing = Math.max(18, 0.85 * H);   // sun spacing between slabs
  const across = fr.depth;
  const n = Math.max(1, Math.min(5, Math.floor((across - 10 + spacing) / (dep + spacing))));
  const gap = n > 1 ? (across - 12 - n * dep) / (n - 1) : 0;
  const roofK = roofFor(B, [RK.CERAMIC, RK.CERAMIC, RK.GARDEN, RK.SOLAR]);
  for (let k = 0; k < n; k++) {
    const n0 = n === 1 ? (across - dep) / 2 : 6 + k * (dep + gap);
    // slabs face the street side they are closest to (front = the nearer long edge)
    const r = placeRect(B.P, fr, 7, fr.len - 7, n0, n0 + dep, 1, 18, 8);
    if (!r) continue;
    const towardStreet = n0 + dep / 2 < across / 2;
    const fu = towardStreet ? r.fu : -r.fu, fv = towardStreet ? r.fv : -r.fv;
    B.add({ cu: r.cu, cv: r.cv, fu, fv, w: r.w, d: r.d, use: 'residential', tier: 'midrise', floors: fl + B.int(-1, 1), fh: 3.1, gfh: 3.6, roofKind: roofK, roofType: roofK === RK.GARDEN ? 'garden' : 'flat', lc: LC.RESIDENTIAL, meta: { slab: true, ...covered(B) } });
  }
  B.area(B.rnd() < 0.5 ? 'yard' : 'green', B.P);
  L.defaultCls = SC.YARD;
};

GEN[BU.TOWER_PARK] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const across = fr.depth, len = fr.len;
  const n = len * across > 9000 ? B.int(2, 3) : 1;
  const cells = n === 1 ? [[0.5, 0.5]] : n === 2 ? (len > across ? [[0.28, 0.5], [0.72, 0.5]] : [[0.5, 0.3], [0.5, 0.72]]) : [[0.25, 0.32], [0.74, 0.3], [0.5, 0.74]];
  for (const [ft, fn] of cells) {
    const s = B.range(22, 30), round = B.rnd() < 0.28;
    const tc = len * ft, nc = across * fn;
    const r = placeRect(B.P, fr, tc - s / 2, tc + s / 2, nc - s / 2, nc + s / 2, 3, 16, 16);
    if (!r) continue;
    const floors = B.fl(B.int(18, 34) + (D.T > 0.5 ? B.int(0, 10) : 0), 8);
    const w = Math.min(r.w, r.d);
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w, d: w, use: 'residential_tower', tier: 'tower', shape: round ? 'round' : 'rect', circle: round ? w / 2 : 0, floors, fh: 3.1, gfh: 4.5,
      roofKind: B.rnd() < 0.5 ? RK.GARDEN : RK.CERAMIC, roofType: 'garden', lc: LC.RESIDENTIAL, basement: 2, meta: { ...covered(B) } });
  }
  B.area('park', B.P);
  L.defaultCls = SC.PARK;
};

GEN[BU.TOWER_PODIUM] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const inset = B.range(2, 4.5);
  const r = placeRect(B.P, fr, inset, fr.len - inset, inset, fr.depth - inset, 0.5, 20, 20);
  if (!r) { GEN[BU.OFFICE](B, L); return; }
  const pf = B.int(3, 5), pfh = 5.0;
  // (G01 harbour crown point, U2: the landmark tower of the CBD)
  const big = B.crown ? true : D.T > 0.72 && B.rnd() < 0.3;
  let floors = Math.round(20 + 48 * Math.pow(B.rnd(), 1.5) * (0.5 + 0.7 * Math.min(1, D.T + 0.2)));
  if (big) floors = B.int(72, 110);
  floors = B.fl(floors, pf + 6);
  // U5 (QY-03): the tower plate of a podium tower is never a pencil — ≥ 14 m (office floor plate), within the podium
  const ts = Math.max(Math.min(14, Math.min(r.w, r.d) - 3), Math.min(r.w, r.d) * B.range(0.42, 0.6));
  const round = B.rnd() < 0.25;
  // tower toward the back half so the podium front reads at street level
  const tcu = r.cu - r.fu * (r.d * 0.12), tcv = r.cv - r.fv * (r.d * 0.12);
  const use = B.rnd() < 0.65 ? 'office' : 'residential_tower';
  // U9 (QA-ID-03): the tower part uses the building's own storey height (office 3.8 m, residential 3.1 m)
  const th = use === 'office' ? 3.8 : 3.1;
  const towerH = pf * pfh + (floors - pf) * th;
  const b = B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use, tier: big || floors > 70 ? 'landmark' : 'tower', shape: 'tower',
    floors, fh: use === 'office' ? th : 3.1, gfh: pfh, roofKind: B.rnd() < 0.25 ? RK.GLASS : B.rnd() < 0.5 ? RK.GARDEN : RK.CERAMIC, roofType: 'garden', lc: LC.COMMERCIAL,
    podium: { floors: pf, height: pf * pfh, floorHeight: pfh }, tower: { w: ts, d: ts, round, cu: tcu, cv: tcv }, basement: 3, height: towerH,
    frontage: fr.kind === 'art' ? 'arterial' : 'street', meta: { landmark: big || undefined, ...covered(B) } });
  if (b) b.height = towerH;
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.OFFICE] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const n = Math.max(1, Math.min(2, Math.floor(fr.len / 55)));
  const dep = Math.min(fr.depth - 12, B.range(18, 26));
  for (let k = 0; k < n; k++) {
    const t0 = fr.len * k / n + 5, t1 = fr.len * (k + 1) / n - 5;
    const fl = B.fl(D.cls === DC.CORE ? B.int(12, 28) : D.cls === DC.INDUSTRIAL ? B.int(3, 6) : B.int(6, 14), 3);
    const r = placeRect(B.P, fr, t0, t1, 5, 5 + dep, 0.5, 14, 12);
    if (!r) continue;
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'office', tier: fl > 12 ? 'tower' : 'midrise', floors: fl, fh: 3.8, gfh: 5, roofKind: RK.SOLAR, roofType: 'flat', lc: LC.COMMERCIAL, basement: fl > 12 ? 2 : 1, meta: { ...covered(B) } });
  }
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.MARKET] = (B, L) => {
  const fr = mainFrame(B);
  if (!fr) return;
  const mw = Math.min(fr.len - 16, B.range(40, 70)), md = Math.min(fr.depth - 24, B.range(30, 50));
  const r = placeRect(B.P, fr, fr.len / 2 - mw / 2, fr.len / 2 + mw / 2, 18, 18 + md, 1, 16, 12);
  if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'market', tier: 'lowrise', floors: B.int(1, 2), fh: 6, gfh: 7, roofKind: RK.MEMBRANE, roofType: 'vault', lc: LC.COMMERCIAL, meta: { hall: true, ...covered(B) } });
  // small shop rows along the other frontages
  const S = strips(B, () => 12, (f2) => isFront(f2) && f2 !== fr);
  for (const s of S) fillStrip(B, s, { wmin: 8, wmax: 14, gap: 0, gmin: 30, gmax: 30, depth: 11, setback: 0, floors: () => B.int(2, 3), b: () => ({ use: 'shop_row', tier: 'lowrise', fh: 3.1, gfh: 4.5, roofKind: roofFor(B), lc: LC.COMMERCIAL, meta: { shops: true } }) });
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.SCHOOL] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  // classroom wing along the front street, schoolyard + pitch behind (校园地块)
  const dep = B.range(14, 17), fl = D.cls === DC.CORE ? B.int(4, 6) : B.int(2, 4);
  const wl = fr.len * B.range(0.6, 0.85);
  const r = placeRect(B.P, fr, fr.len / 2 - wl / 2, fr.len / 2 + wl / 2, 5, 5 + dep, 0.5, 20, 10);
  if (r) {
    const Lshape = B.rnd() < 0.5 && r.w > 34;
    const w = r.w, d = r.d, wing = Math.min(16, w * 0.3), back = Math.min(26, fr.depth * 0.35);
    const local = Lshape ? [[-w / 2, d / 2], [-w / 2, -d / 2 - back], [-w / 2 + wing, -d / 2 - back], [-w / 2 + wing, -d / 2], [w / 2, -d / 2], [w / 2, d / 2]] : null;
    const cu = Lshape ? r.cu - r.fu * back / 2 : r.cu, cv = Lshape ? r.cv - r.fv * back / 2 : r.cv;
    const dd = Lshape ? d + back : d;
    const loc = Lshape ? local.map(([x, z]) => [x, z + back / 2]) : null;
    B.add({ cu, cv, fu: r.fu, fv: r.fv, w, d: dd, use: 'school', tier: 'lowrise', shape: Lshape ? 'L' : 'rect', local: loc, floors: fl, fh: 4.0, gfh: 4.5, roofKind: RK.GARDEN, roofType: 'garden', lc: LC.CIVIC, meta: { yardSide: 'back', ...covered(B) } });
  }
  // pitch in the back half
  const pw = Math.min(fr.len - 16, 64), pd = Math.min(fr.depth * 0.42, 38);
  const pr = placeRect(B.P, fr, fr.len / 2 - pw / 2, fr.len / 2 + pw / 2, fr.depth - 6 - pd, fr.depth - 6, 1, 20, 14);
  if (pr) B.area('pitch', rectPolyOf({ ...pr, xu: fr.tu, xv: fr.tv, fu: pr.fu, fv: pr.fv }, 0, 0));
  B.area('schoolyard', B.P);
  L.defaultCls = SC.YARD;
};

GEN[BU.CLINIC] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const w = Math.min(fr.len - 12, B.range(32, 56)), d = Math.min(fr.depth - 16, B.range(18, 26));
  const fl = D.cls === DC.CORE ? B.int(6, 10) : B.int(3, 6);
  const r = placeRect(B.P, fr, fr.len / 2 - w / 2, fr.len / 2 + w / 2, 6, 6 + d, 0.5, 16, 10);
  if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'clinic', tier: 'midrise', floors: fl, fh: 4.2, gfh: 4.8, roofKind: RK.CERAMIC, roofType: 'flat', lc: LC.CIVIC, meta: { ambulanceSide: 'right', ...covered(B) } });
  const pk = clipFrame(B.P, fr, fr.len / 2 + w / 2 + 3, 1e9, 4, Math.min(fr.depth - 4, 40));
  if (pk.length >= 6) B.area('parking', pk);
  B.area('garden', B.P);
  L.defaultCls = SC.PARK;
};

GEN[BU.COMMUNITY] = (B, L) => {
  const fr = mainFrame(B);
  if (!fr) return;
  const w = Math.min(fr.len - 20, B.range(24, 40)), d = Math.min(fr.depth - 20, B.range(16, 24));
  const r = placeRect(B.P, fr, fr.len / 2 - w / 2, fr.len / 2 + w / 2, 6, 6 + d, 1, 12, 10);
  if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'community', tier: 'lowrise', floors: B.int(1, 3), fh: 4.5, roofKind: RK.GARDEN, roofType: 'garden', lc: LC.CIVIC, meta: { ...covered(B) } });
  B.area('park', B.P);
  L.defaultCls = SC.PARK;
};

GEN[BU.CIVIC] = (B, L) => {
  const fr = mainFrame(B);
  if (!fr) return;
  const s = Math.min(fr.len, fr.depth) * 0.48;
  const round = B.rnd() < 0.55;
  const r = placeRect(B.P, fr, fr.len / 2 - s / 2, fr.len / 2 + s / 2, fr.depth / 2 - s / 2, fr.depth / 2 + s / 2, 2, 20, 20);
  if (r) {
    const w = Math.min(r.w, r.d);
    // slenderness (buildings-z request): a landmark tower needs a ≥ 36 m square, else ≤ 3.5 storeys per metre of width
    let floors = B.int(100, 150);
    if (w < 36) floors = Math.min(floors, Math.round(3.5 * w));
    if (B.sky) floors = Math.min(floors, B.sky);   // G01 harbour skyline cap (U2)
    else if (B.peak || B.D.peakFloors) floors = Math.min(floors, (B.peak || B.D.peakFloors) + 12);
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w, d: w, use: 'civic_tower', tier: floors > 40 ? 'landmark' : 'tower', shape: round ? 'round' : 'rect', circle: round ? w / 2 : 0, floors, fh: 4.0, gfh: 7,
      roofKind: RK.GLASS, roofType: 'spire', lc: LC.CIVIC, basement: 4, meta: { landmark: true } });
  }
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.STATION] = (B, L) => {
  const D = B.D;
  const st = B.f && B.f.station;
  if (!st) return;
  const halfL = st.plen / 2, halfD = st.depth / 2;
  const nu = -st.dv * st.side, nv = st.du * st.side;           // from the track toward the building
  // front faces away from the track (street / plaza side); platforms behind
  const use = st.kind === 'pipe' || st.halt ? (D.zone === 'O' ? (D.polar ? 'insulated_station' : 'service_depot') : 'station') : 'station';
  B.add({ cu: st.bu, cv: st.bv, fu: nu, fv: nv, w: st.plen, d: st.depth, use, tier: st.main ? 'landmark' : 'lowrise', floors: st.main ? 3 : (st.halt ? 1 : 2), fh: st.halt ? 3.4 : 6, gfh: st.halt ? 3.4 : 7,
    roofKind: RK.MEMBRANE, roofType: 'canopy', lc: LC.TRANSIT, site: true, station: st,
    meta: { trackHeading: Math.round(st.heading * 100) / 100, platformSide: 'back', platformLength: st.plen, elevated: !!st.elev, main: !!st.main, stationId: st.id, segKey: st.segKey, tracks: 2, bridging: !!D.terraced || undefined, ...covered(B) } });
  void halfL; void halfD;
  B.area('station_plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.FERRY] = (B, L) => {
  const G = B.G, D = B.D;
  const f = (B.f && B.f.ferry) || G.ferry;
  if (!f) return;
  const cu = f.coastU - f.du * 26, cv = f.coastV - f.dv * 26;
  const w = B.range(34, 52), d = B.range(18, 24);
  const hdg = ((Math.atan2(f.du * D.cosT - f.dv * D.sinT, f.du * D.sinT + f.dv * D.cosT) * 180 / Math.PI) + 360) % 360;
  B.add({ cu, cv, fu: -f.du, fv: -f.dv, w, d, use: D.zone === 'Z' ? 'ferry_terminal' : 'maintenance', tier: 'lowrise', floors: 2, fh: 5, gfh: 6, roofKind: RK.MEMBRANE, roofType: 'canopy', lc: LC.TRANSIT, site: true,
    meta: { pierHeading: Math.round(hdg * 100) / 100, waterSide: 'back' } });
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.PLAZA] = (B, L) => {
  const fr = mainFrame(B);
  if (fr && B.rnd() < 0.6) {
    const r = placeRect(B.P, fr, fr.len / 2 - 6, fr.len / 2 + 6, fr.depth / 2 - 4, fr.depth / 2 + 4, 1, 8, 6);
    if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'community', tier: 'lowrise', floors: 1, fh: 4, roofKind: RK.MEMBRANE, roofType: 'canopy', lc: LC.CIVIC, meta: { kiosk: true } });
  }
  B.area('plaza', B.P);
  L.defaultCls = SC.PLAZA;
};

GEN[BU.PARK] = (B, L) => {
  const fr = mainFrame(B);
  B.area('park', B.P);
  if (fr && B.rnd() < 0.25) {
    const r = placeRect(B.P, fr, fr.len / 2 - 7, fr.len / 2 + 7, fr.depth / 2 - 5, fr.depth / 2 + 5, 1, 8, 6);
    if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'community', tier: 'lowrise', floors: 1, fh: 4, roofKind: RK.GARDEN, roofType: 'garden', lc: LC.CIVIC, meta: { pavilion: true } });
  }
  L.defaultCls = SC.PARK;
};

GEN[BU.SPORTS] = (B, L) => {
  const fr = mainFrame(B);
  if (fr) {
    const pw = Math.min(fr.len * 0.42, 100), pd = Math.min(fr.depth - 20, 64);
    for (const ft of [0.27, 0.73]) {
      const r = placeRect(B.P, fr, fr.len * ft - pw / 2, fr.len * ft + pw / 2, 10, 10 + pd, 1, 20, 14);
      if (r) B.area('pitch', rectPolyOf({ ...r, xu: fr.tu, xv: fr.tv }, 0, 0));
    }
    const r = placeRect(B.P, fr, fr.len / 2 - 9, fr.len / 2 + 9, 2, 12, 0.5, 8, 6);
    if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'community', tier: 'lowrise', floors: 1, fh: 4, roofKind: RK.MEMBRANE, roofType: 'canopy', lc: LC.CIVIC, meta: { clubhouse: true } });
  }
  B.area('park', B.P);
  L.defaultCls = SC.PARK;
};

GEN[BU.WAREHOUSE] = (B, L) => {
  const D = B.D;
  const fr = longFrame(B);
  if (!fr) return;
  const n = Math.max(1, Math.min(3, Math.floor(fr.len / 95)));
  const port = D.cls === DC.PORT;
  for (let k = 0; k < n; k++) {
    const t0 = fr.len * k / n + 8, t1 = fr.len * (k + 1) / n - 8;
    const dep = fr.depth * B.range(0.48, 0.66);
    const n0 = B.range(10, 18);
    const r = placeRect(B.P, fr, t0, t1, n0, n0 + dep, 1, 24, 18);
    if (!r) continue;
    const use = D.cls === DC.LOGISTICS && B.rnd() < 0.4 ? 'cold_storage' : 'warehouse';
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use, tier: 'shed', floors: 1, fh: B.range(8, 12), roofKind: RK.METAL, roofType: B.rnd() < 0.4 ? 'sawtooth' : 'flat', lc: LC.INDUSTRIAL, meta: { loadingSide: 'right', port: port || undefined } });
  }
  B.area('yard_industrial', B.P);
  L.defaultCls = SC.INDUSTRIAL;
};

GEN[BU.PORT_SHEDS] = (B, L) => {
  const G = B.G, D = B.D;
  const sd = enToPlane(D, D.seaE, D.seaN, {});
  // frame on the landward street: its inward normal points TOWARD the sea, so the far side of the block
  // (n ≈ across) is the quay apron and the sheds' fronts (quaySide 'front') face the water
  let fr = null, best = -2;
  for (const f2 of B.frames) { const s = f2.nu * sd.du + f2.nv * sd.dv; if (s > best) { best = s; fr = f2; } }
  if (!fr) return;
  const across = fr.depth;
  const apron = 36;
  // quay apron along the water side (the far side of this frame), transit sheds parallel behind it
  const quay = clipFrame(B.P, fr, -1e9, 1e9, across - apron, 1e9);
  if (quay.length >= 6) B.area('dock', quay);
  const d = Math.min(across - apron - 30, B.range(40, 70));
  const n0 = across - apron - 8 - d;
  const n = Math.max(1, Math.floor(fr.len / 110));
  for (let k = 0; k < n; k++) {
    const t0 = fr.len * k / n + 4, t1 = fr.len * (k + 1) / n - 4;
    const r = placeRect(B.P, fr, t0, t1, n0, n0 + d, 0.5, 30, 20);
    if (!r) continue;
    // the shed's front faces the quay (cargo side), back to the yard
    B.add({ cu: r.cu, cv: r.cv, fu: -r.fu, fv: -r.fv, w: r.w, d: r.d, use: 'port_shed', tier: 'shed', floors: 1, fh: B.range(10, 14), roofKind: RK.METAL, roofType: 'vault', lc: LC.PORT, meta: { quaySide: 'front' } });
  }
  const yard = clipFrame(B.P, fr, -1e9, 1e9, -1e9, Math.max(4, n0 - 4));
  if (yard.length >= 6) B.area('container_yard', yard);
  L.defaultCls = SC.INDUSTRIAL;
  void G;
};

GEN[BU.RESEARCH] = (B, L) => {
  const fr = mainFrame(B);
  if (!fr) return;
  const n = B.int(2, 4);
  const pos = [[0.27, 0.3], [0.73, 0.32], [0.3, 0.74], [0.72, 0.72]];
  for (let k = 0; k < n; k++) {
    const w = Math.min(fr.len * 0.4, B.range(26, 44)), d = Math.min(fr.depth * 0.36, B.range(16, 26));
    const tc = fr.len * pos[k][0], nc = fr.depth * pos[k][1];
    const r = placeRect(B.P, fr, tc - w / 2, tc + w / 2, nc - d / 2, nc + d / 2, 1, 14, 10);
    if (!r) continue;
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'research', tier: 'midrise', floors: B.int(3, 8), fh: 4.0, gfh: 5, roofKind: RK.SOLAR, roofType: 'flat', lc: LC.COMMERCIAL, meta: {} });
  }
  B.area('green', B.P);
  L.defaultCls = SC.PARK;
};

GEN[BU.LOGISTICS] = (B, L) => {
  // farm_station + cold_storage + warehouse along the yard, dorm near the street (§1 自然交接)
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const O = D.zone === 'O';
  const items = [
    { use: 'farm_station', w: 30, d: 22, fl: 2, fh: 4.5, rk: RK.CERAMIC, tier: 'lowrise' },
    { use: 'cold_storage', w: 46, d: 30, fl: 1, fh: 9, rk: RK.METAL, tier: 'shed' },
    { use: O ? 'service_depot' : 'warehouse', w: 52, d: 34, fl: 1, fh: 9, rk: RK.METAL, tier: 'shed' },
    { use: 'dorm', w: 40, d: 13, fl: 3, fh: 3.1, rk: RK.CERAMIC, tier: 'lowrise' },
  ];
  let a = 6;
  for (const it of items) {
    if (a + it.w > fr.len - 6) break;
    const r = placeRect(B.P, fr, a, a + it.w, 6, 6 + it.d, 0.5, it.w * 0.6, it.d * 0.6);
    if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: it.use, tier: it.tier, floors: it.fl, fh: it.fh, roofKind: it.rk, roofType: 'flat', lc: it.use === 'dorm' ? LC.RESIDENTIAL : LC.INDUSTRIAL, meta: {} });
    a += it.w + B.range(8, 14);
  }
  B.area('yard_industrial', B.P);
  L.defaultCls = SC.INDUSTRIAL;
};

/** canal segments (plane coords) crossing a rect (+margin): [{x0,y0,x1,y1,hw,canal,ditch}] */
function canalSegsIn(lines, u0, v0, u1, v1, margin) {
  const out = [];
  for (const c of lines) {
    const p = c.pts, hw = (c.width || 20) / 2;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
      if (Math.max(ax, bx) < u0 - margin - hw || Math.min(ax, bx) > u1 + margin + hw || Math.max(ay, by) < v0 - margin - hw || Math.min(ay, by) > v1 + margin + hw) continue;
      out.push({ x0: ax, y0: ay, x1: bx, y1: by, hw, canal: c.id, order: c.order || 0, ditch: c.kind === 'ditch' || (c.order || 0) >= 2 });
    }
  }
  return out;
}

/** irrigated runs of a convex field piece along axis (au, av): [[poly, irr (1 | 0.5)], …] (state sampled every 12 m) */
function reachRuns(G, pg, au, av) {
  let s0 = 1e9, s1 = -1e9, cu = 0, cv = 0;
  const n = pg.length >> 1;
  for (let q = 0; q < pg.length; q += 2) { const sv = pg[q] * au + pg[q + 1] * av; if (sv < s0) s0 = sv; if (sv > s1) s1 = sv; cu += pg[q]; cv += pg[q + 1]; }
  cu /= n; cv /= n;
  const c0 = cu * au + cv * av, len = s1 - s0;
  const steps = Math.max(1, Math.ceil(len / 12));
  const st = [];
  for (let k = 0; k < steps; k++) {
    const sm = s0 + (k + 0.5) * len / steps - c0;
    st.push(farmIrrigated(G, cu + au * sm, cv + av * sm));
  }
  const out = [];
  let a = 0;
  for (let k = 1; k <= steps; k++) {
    if (k < steps && st[k] === st[a]) continue;
    if (st[a] > 0) {
      const lo = s0 + a * len / steps, hi = s0 + k * len / steps;
      let pc = a > 0 ? clipHalfPlane(pg, au, av, -lo) : pg;
      if (k < steps) pc = clipHalfPlane(pc, -au, -av, hi);
      if (pc.length >= 6 && Math.abs(polyArea(pc)) > 60) out.push([pc, st[a]]);
    }
    a = k;
  }
  return out;
}

/** convex field pieces minus the footprints (+ 8 m) of the district sites near bounds bb */
function cutSites(G, polys, bb) {
  for (const st of G.sites) {
    const w = st.w || 20, d = st.d || 14, m = 8, r = Math.hypot(w, d) / 2 + m;
    if (st.u + r < bb.x0 || st.u - r > bb.x1 || st.v + r < bb.y0 || st.v - r > bb.y1) continue;
    let fu = st.fu, fv = st.fv;
    if (fu === undefined) { const a = (st.rot || 0) * Math.PI / 2; fu = Math.sin(a); fv = Math.cos(a); }
    const xu = -fv, xv = fu, hw = w / 2 + m, hd = d / 2 + m;
    const cx = st.u * xu + st.v * xv, cz = st.u * fu + st.v * fv;
    const next = [];
    for (const pg of polys) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let q = 0; q < pg.length; q += 2) { const x = pg[q] * xu + pg[q + 1] * xv - cx, z = pg[q] * fu + pg[q + 1] * fv - cz; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      if (x1 <= -hw || x0 >= hw || z1 <= -hd || z0 >= hd) { next.push(pg); continue; }
      const keep = (pc) => { if (pc.length >= 6 && Math.abs(polyArea(pc)) > 120) next.push(pc); };
      keep(clipHalfPlane(pg, -xu, -xv, cx - hw));
      keep(clipHalfPlane(pg, xu, xv, -cx - hw));
      let mid = clipHalfPlane(pg, xu, xv, -cx + hw); mid = clipHalfPlane(mid, -xu, -xv, cx + hw);
      if (mid.length >= 6) { keep(clipHalfPlane(mid, -fu, -fv, cz - hd)); keep(clipHalfPlane(mid, fu, fv, -cz - hd)); }
    }
    polys = next;
  }
  return polys;
}

GEN[BU.FARM] = (B, L) => {
  // field strips: narrow side toward the canal (u runs along the canal), crops and stages per strip;
  // canals crossing the block cut the strips, leaving bank + levee road bands (堤路)
  const G = B.G, D = B.D;
  const fr = B.frames.length ? B.frames.reduce((a, b) => (b.len > a.len ? b : a)) : null;
  if (!fr) return;
  const sw = D.rules.longStrips ? B.range(26, 40) : B.range(30, 60);
  // G02 bench terraces (U3, fix round 3): long narrow parcels along the contour (the district grid runs along it),
  // stacked across the block like the 9 m benches, instead of strips running down the slope
  let terr = false;
  if (D.g02) { let cu = 0, cv = 0; for (let q = 0; q < B.P.length; q += 2) { cu += B.P[q]; cv += B.P[q + 1]; } terr = g02TerraceAt(D, cu / (B.P.length / 2), cv / (B.P.length / 2)) > 0.3; }
  const tw = terr ? B.range(14, 22) : 0;
  const n = terr ? Math.max(1, Math.round(fr.depth / tw)) : Math.max(1, Math.round(fr.len / sw));
  const w = terr ? fr.depth / n : fr.len / n;
  const bb = polyBounds(B.P, {});
  const segs = canalSegsIn(waterLinesNear(G, bb.x0, bb.y0, bb.x1, bb.y1), bb.x0, bb.y0, bb.x1, bb.y1, 20);
  L.canalSegs = segs;
  for (let k = 0; k < n; k++) {
    const c = cropOf(G, B.i, B.j, k);
    let polys = [terr ? clipFrame(B.P, fr, 1, fr.len - 1, k * w + 0.8, (k + 1) * w - 0.8) : clipFrame(B.P, fr, k * w + 0.8, (k + 1) * w - 0.8, 1, fr.depth - 1)];
    if (polys[0].length < 6) continue;
    for (const sg of segs) {
      let nx = -(sg.y1 - sg.y0), ny = sg.x1 - sg.x0; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const cc = -(nx * sg.x0 + ny * sg.y0), band = sg.ditch ? sg.hw + 1.5 : sg.hw + 15;
      const tx = -ny, ty = nx, t0 = tx * sg.x0 + ty * sg.y0, t1 = tx * sg.x1 + ty * sg.y1;
      const tmin = Math.min(t0, t1) - band, tmax = Math.max(t0, t1) + band;
      const next = [];
      for (const pg of polys) {
        let hit = false;
        for (let q = 0; q < pg.length; q += 2) {
          const d = nx * pg[q] + ny * pg[q + 1] + cc, t = tx * pg[q] + ty * pg[q + 1];
          if (Math.abs(d) < band + 60 && t > tmin - 60 && t < tmax + 60) { hit = true; break; }
        }
        if (!hit) { next.push(pg); continue; }
        const a = clipHalfPlane(pg, nx, ny, cc - band), b2 = clipHalfPlane(pg, -nx, -ny, -cc - band);
        const before = clipHalfPlane(pg, -tx, -ty, tmin), after = clipHalfPlane(pg, tx, ty, -tmax);
        for (const piece of [a, b2]) {
          let pc = clipHalfPlane(piece, tx, ty, -tmin); pc = clipHalfPlane(pc, -tx, -ty, tmax);
          if (pc.length >= 6 && Math.abs(polyArea(pc)) > 120) next.push(pc);
        }
        if (before.length >= 6 && Math.abs(polyArea(before)) > 120) next.push(before);
        if (after.length >= 6 && Math.abs(polyArea(after)) > 120) next.push(after);
      }
      polys = next;
    }
    // fields never run under district sites (sluice stations, pump houses, levee settlements, the OX1 basin town):
    // the site footprint + an 8 m yard is cut out of the strip pieces (fix round 3)
    if (G.sites.length) polys = cutSites(G, polys, bb);
    for (const pg0 of polys) {
      // U7: only the parts within the irrigation reach are fields; the last 150 m lie fallow; beyond: red earth.
      // U5 (QY-05, fix round 3): each strip piece is cut ALONG its length where the reach ends (sampled every 12 m on
      // the strip axis), so the farmland edge follows the canal-distance line instead of stepping by whole strips
      for (const [pg, irr] of reachRuns(G, pg0, terr ? fr.tu : fr.nu, terr ? fr.tv : fr.nv)) {
        if (irr < 1) B.area('field', pg, { crop: FarmCrop.FALLOW, stage: 1, strip: k });
        else B.area('field', pg, { crop: c.crop, stage: c.stage, strip: k });
      }
    }
  }
  L.defaultCls = SC.NATURAL;
};

GEN[BU.GREENHOUSES] = (B, L) => {
  const D = B.D;
  const fr = longFrame(B);
  if (!fr) return;
  const span = B.range(8, 12), gap = B.range(2.5, 4);
  const len = Math.min(fr.depth - 14, B.range(30, 80));
  const n = Math.max(1, Math.floor((fr.len - 22) / (span + gap)));
  const polar = D.polar;
  // service strip + water distribution (配水) at the head of the rows: a feed pump only where a real canal runs
  // past the block (U7 / QY-07: back on the canal, meta.water from it); otherwise a dry service shed
  const head = placeRect(B.P, fr, 4, 16, 3, 13, 0.5, 8, 6);
  if (head) {
    const feed = !polar ? feedPump(B, head) : null;
    if (feed) B.add(feed);
    else B.add({ cu: head.cu, cv: head.cv, fu: head.fu, fv: head.fv, w: head.w, d: head.d, use: 'maintenance', tier: 'utility', floors: 1, fh: 4.5, roofKind: polar ? RK.INSULATED : RK.CERAMIC, roofType: 'flat', lc: LC.UTILITY, meta: { serves: 'greenhouses', servesSide: 'right', distribution: true } });
  }
  for (let k = 0; k < n; k++) {
    const t0 = 20 + k * (span + gap);
    const r = placeRect(B.P, fr, t0, t0 + span, 10, 10 + len, 0.3, span * 0.9, 12);
    if (!r) continue;
    // greenhouse rows run perpendicular to the street; the gable end with the door faces the street
    B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: 'greenhouse', tier: 'shed', floors: 1, fh: B.range(4.5, 6), roofKind: RK.GLASS, roofType: 'gable', lc: LC.UTILITY, meta: { span: Math.round(span * 10) / 10, polar: polar || undefined } });
  }
  B.area('yard_service', B.P);
  L.defaultCls = SC.YARD;
};

/** greenhouse-row feed pump on the nearest canal within 120 m of the row head (waterSite placement), or null */
const CNF = {};
function feedPump(B, head) {
  const G = B.G;
  let best = null, bd = 120;
  for (const c of G.canals) {
    if (c.kind === 'river' || c.kind === 'spillway') continue;
    canalNearest(c, head.cu, head.cv, CNF);
    if (CNF.d < bd) { bd = CNF.d; best = { c, qu: CNF.qu, qv: CNF.qv, du: CNF.du, dv: CNF.dv }; }
  }
  if (!best) return null;
  const s = waterSite(G, best.c, best.qu, best.qv, best.du, best.dv, 'pumphouse', 12, 10, 0, 90 + B.i * 7 + B.j, null);
  if (!s || !s.meta || !s.meta.water) return null;
  return { cu: s.u, cv: s.v, fu: s.fu, fv: s.fv, w: s.w, d: s.d, use: 'pumphouse', tier: 'utility', floors: 1, fh: 4.5, roofKind: RK.CERAMIC, roofType: 'flat', lc: LC.UTILITY,
    meta: { ...s.meta, serves: 'greenhouses', poolSide: 'back', feedsBlock: true }, site: true };
}

GEN[BU.DORMS] = (B, L) => {
  const D = B.D;
  const O = D.zone === 'O';
  const F = B.frames.filter(isFront);
  if (!F.length) return;
  const sel = F.slice().sort((a, b) => b.len - a.len).slice(0, 2);
  const S = strips(B, () => B.range(18, 24), (fr) => sel.includes(fr));
  for (const s of S) {
    fillStrip(B, s, {
      wmin: 24, wmax: 42, gap: B.range(6, 12), gmin: 1, gmax: 1, depth: () => B.range(11, 14), setback: () => B.range(3, 6),
      floors: () => B.int(2, 4),
      b: () => ({ use: O ? (B.rnd() < 0.82 ? 'dorm' : 'maintenance') : 'residential', tier: 'lowrise', fh: 3.1, gfh: 3.4, roofKind: O && D.polar ? RK.INSULATED : RK.CERAMIC, roofType: 'flat', lc: LC.RESIDENTIAL, meta: {} }),
    });
  }
  B.area('yard', B.P);
  L.defaultCls = SC.YARD;
};

GEN[BU.UTILITY] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  const O = D.zone === 'O';
  const h = B.rnd();
  let main = O ? (h < 0.35 ? 'pumphouse' : h < 0.6 ? 'water_treatment' : h < 0.8 ? 'maintenance' : 'service_depot') : 'warehouse';
  const w = Math.min(fr.len - 16, B.range(24, 40)), d = Math.min(fr.depth - 16, B.range(16, 26));
  const r = placeRect(B.P, fr, fr.len / 2 - w / 2, fr.len / 2 + w / 2, 8, 8 + d, 1, 12, 10);
  // U7 / QY-07: a pump house only where a real canal runs by (its pump on the bank, meta.water); else a depot
  let pump = null;
  if (r && main === 'pumphouse') { pump = feedPump(B, r); if (pump) { pump.meta.serves = 'district'; delete pump.meta.feedsBlock; } else main = 'maintenance'; }
  const floorsU = B.int(1, 2);
  if (pump) B.add(pump);
  else if (r) B.add({ cu: r.cu, cv: r.cv, fu: r.fu, fv: r.fv, w: r.w, d: r.d, use: main, tier: 'utility', floors: floorsU, fh: 5, roofKind: D.polar ? RK.INSULATED : RK.CERAMIC, roofType: 'flat', lc: LC.UTILITY, meta: {} });
  if (O && B.rnd() < 0.5) {
    const t = placeRect(B.P, fr, 6, 14, fr.depth - 16, fr.depth - 8, 1, 6, 6);
    if (t) B.add({ cu: t.cu, cv: t.cv, fu: t.fu, fv: t.fv, w: 8, d: 8, use: 'control_tower', tier: 'utility', shape: 'round', circle: 4, floors: 4, fh: 4, roofKind: RK.CERAMIC, roofType: 'flat', lc: LC.UTILITY, meta: {} });
  }
  if (main === 'water_treatment' && r) {
    const bas = clipFrame(B.P, fr, fr.len / 2 - w / 2, fr.len / 2 + w / 2, 8 + d + 6, Math.min(fr.depth - 6, 8 + d + 46));
    if (bas.length >= 6) B.area('basins', bas);
  }
  B.area('yard_service', B.P);
  L.defaultCls = SC.INDUSTRIAL;
};

GEN[BU.POLAR_STATION] = (B, L) => {
  const D = B.D;
  const fr = mainFrame(B);
  if (!fr) return;
  // insulated main station with an inset entrance (门斗) on the lee side, depot, greenhouse shed
  const m = placeRect(B.P, fr, fr.len / 2 - 22, fr.len / 2 + 22, fr.depth / 2 - 14, fr.depth / 2 + 14, 1, 20, 14);
  if (m) B.add({ cu: m.cu, cv: m.cv, fu: m.fu, fv: m.fv, w: m.w, d: m.d, use: 'insulated_station', tier: 'utility', floors: 2, fh: 3.6, gfh: 4, roofKind: RK.INSULATED, roofType: 'vault', lc: LC.UTILITY, meta: { vestibule: true, leeSide: 'front' } });
  const dpt = placeRect(B.P, fr, 6, 38, 6, 28, 1, 16, 12);
  if (dpt) B.add({ cu: dpt.cu, cv: dpt.cv, fu: dpt.fu, fv: dpt.fv, w: dpt.w, d: dpt.d, use: 'service_depot', tier: 'shed', floors: 1, fh: 6.5, roofKind: RK.INSULATED, roofType: 'flat', lc: LC.UTILITY, meta: { vehicleBay: true } });
  const gh = placeRect(B.P, fr, fr.len - 46, fr.len - 8, 8, 19, 1, 20, 8);
  if (gh) B.add({ cu: gh.cu, cv: gh.cv, fu: gh.fu, fv: gh.fv, w: gh.w, d: gh.d, use: 'greenhouse', tier: 'shed', floors: 1, fh: 4.5, roofKind: RK.GLASS, roofType: 'gable', lc: LC.UTILITY, meta: { polar: true, span: 11 } });
  if (D.rules.meltwater && !B.G.meltSite) {   // OX4 outlet districts have their pump on the forebay pool (meltEnsemble)
    const mp = placeRect(B.P, fr, fr.len - 26, fr.len - 8, fr.depth - 24, fr.depth - 8, 1, 10, 10);
    if (mp) B.add({ cu: mp.cu, cv: mp.cv, fu: mp.fu, fv: mp.fv, w: mp.w, d: mp.d, use: 'meltwater_pump', tier: 'utility', floors: 1, fh: 5, roofKind: RK.INSULATED, roofType: 'flat', lc: LC.UTILITY, meta: { intakeSide: 'back' } });
  }
  B.area('yard_service', B.P);
  L.defaultCls = SC.YARD;
};

GEN[BU.TERRACE] = (B, L) => {
  // ZR2 canyon / ZR6 slopes: long stepped rows along the contour, fronts facing downhill (valley
  // view); the roof of each row is the garden terrace of the street above (退台)
  const G = B.G, D = B.D;
  const P = B.P;
  let sx = 0, sy = 0; for (let k = 0; k < P.length; k += 2) { sx += P[k]; sy += P[k + 1]; }
  const cu = sx / (P.length / 2), cv = sy / (P.length / 2);
  rasterSlope(G, cu, cv);
  let gu = rasterSlope.gu, gv = rasterSlope.gv;
  if (Math.hypot(gu, gv) < 0.02) { const g = enToPlane(D, D.gE, D.gN, {}); gu = g.du; gv = g.dv; }
  // frame whose inward normal points uphill: rows parallel to that edge, front facing downhill
  let fr = null, best = -2;
  for (const f2 of B.frames) { const gl = Math.hypot(gu, gv) || 1; const s = (f2.nu * gu + f2.nv * gv) / gl; if (s > best) { best = s; fr = f2; } }
  if (!fr) return;
  const rowStep = B.range(22, 28);
  const rows = Math.max(1, Math.floor(fr.depth / rowStep));
  const step = fr.depth / rows;
  if (keepsCliffsBare(D)) { terraceCanyon(B, L, fr, rows, step); B.area('yard', P); L.defaultCls = SC.YARD; return; }
  for (let k = 0; k < rows; k++) {
    const s = { fr, ta: 0, tb: fr.len, dp: step, poly: clipFrame(P, fr, -1e9, 1e9, k * step, (k + 1) * step) };
    if (s.poly.length < 6) continue;
    let ta = 1e9, tb = -1e9;
    for (let q = 0; q < s.poly.length; q += 2) { const t = (s.poly[q] - fr.ou) * fr.tu + (s.poly[q + 1] - fr.ov) * fr.tv; if (t < ta) ta = t; if (t > tb) tb = t; }
    s.ta = ta + 3; s.tb = tb - 3;
    // shift the strip frame so n starts at the row's own street line
    const frk = { ...fr, ou: fr.ou + fr.nu * k * step, ov: fr.ov + fr.nv * k * step };
    s.fr = frk;
    const blds = fillStrip(B, s, {
      wmin: 16, wmax: 34, gap: B.range(3, 6), gmin: 1, gmax: 3, depth: () => Math.min(step - 6, B.range(11, 15)), setback: 2.5,
      floors: () => B.int(3, 6),
      b: () => ({ use: 'residential', tier: 'midrise', fh: 3.1, gfh: 3.6, roofKind: RK.TERRACE, roofType: 'terrace', lc: LC.RESIDENTIAL, meta: { terraced: true, uphill: 'back', ...covered(B) } }),
    });
    void blds;
  }
  B.area('yard', P);
  L.defaultCls = SC.YARD;
};

/**
 * ZR2 canyon benches (U5, §5 06 / Z04): contour-terraced housing on the treads only. Along each row the builder
 * walks the frontage and slides every house up / down the row band (±6 m) to the position whose footprint sits on
 * the tread (fine slope ≤ 0.5 at the corners), so the rows step with the bench edge; risers stay free red rock.
 * Ground-floor doors face downhill onto the bench walkway (front), the uphill back is the retaining wall.
 */
function terraceCanyon(B, L, fr, rows, step) {
  const G = B.G, D = B.D, P = B.P;
  for (let k = 0; k < rows; k++) {
    const poly = clipFrame(P, fr, -1e9, 1e9, k * step, (k + 1) * step);
    if (poly.length < 6) continue;
    let ta = 1e9, tb = -1e9;
    for (let q = 0; q < poly.length; q += 2) { const t = (poly[q] - fr.ou) * fr.tu + (poly[q + 1] - fr.ov) * fr.tv; if (t < ta) ta = t; if (t > tb) tb = t; }
    let t = ta + 3, prev = null;
    const dep = Math.min(step - 5, B.range(10.5, 14));
    while (t < tb - 10) {
      const w = B.range(12, 26);
      if (t + w > tb - 2) break;
      let best = null;
      for (const dn of [0, -3, 3, -6, 6]) {
        const n0 = k * step + 2.5 + dn;
        if (n0 < k * step - 4 || n0 + dep > (k + 1) * step + 4) continue;
        const [cu, cv] = fp(fr, t + w / 2, n0 + dep / 2);
        if (!rectIn(P, cu, cv, fr.tu, fr.tv, -fr.nu, -fr.nv, w, dep, 0.3)) continue;
        const sl = rectSlope(G, cu, cv, fr.tu, fr.tv, -fr.nu, -fr.nv, w, dep);
        if (sl <= 0.5 && (!best || sl < best.sl)) best = { cu, cv, sl };
      }
      if (best) {
        const b = B.add({ cu: best.cu, cv: best.cv, fu: -fr.nu, fv: -fr.nv, w, d: dep, use: 'residential', tier: 'midrise', floors: B.int(2, 5), fh: 3.1, gfh: 3.6,
          roofKind: RK.TERRACE, roofType: 'terrace', lc: LC.RESIDENTIAL, meta: { terraced: true, uphill: 'back', retaining: 'back', walkway: 'front', ...covered(B) } });
        if (b && prev && B.rnd() < 0.55 && Math.abs(prev._t1 - (t)) < 0.6) { prev.nbr.right = b; b.nbr.left = prev; prev.shared.right = true; b.shared.left = true; }
        if (b) { b._t1 = t + w; prev = b; }
        t += w + (B.rnd() < 0.55 ? 0 : B.range(3, 7));
      } else { prev = null; t += 8; }
    }
  }
}

GEN[BU.PARKING] = (B, L) => { B.area('parking', B.P); L.defaultCls = SC.PARKING; };
GEN[BU.SOLAR] = (B, L) => { B.area('solar', B.P); L.defaultCls = SC.INDUSTRIAL; };
GEN[BU.GREENBELT] = (B, L) => { B.area('park', B.P); L.defaultCls = SC.PARK; };

// ---------------------------------------------------------------------------------------------
// single sites (outposts, sluice stations, junction pumps)
// ---------------------------------------------------------------------------------------------
function genSite(B, L, s) {
  const D = B.D;
  let fu = s.fu, fv = s.fv;
  if (fu === undefined) { const a = (s.rot || 0) * Math.PI / 2; fu = Math.sin(a); fv = Math.cos(a); }
  let w = 16, d = 12, floors = 1, fh = 4, rk = RK.CERAMIC, tier = 'utility', shape = 'rect', meta = {};
  const sm = s.meta || {};
  switch (s.use) {
    // water sites (districts.js waterSite / OX4 melt sites): (fu,fv) is already the FRONT normal pointing
    // away from the water; the pool / canal / intake lies behind the back facade (poolSide | intakeSide)
    case 'sluice_station': w = s.w || 22; d = s.d || 14; floors = 2; fh = 4.5; meta = { poolSide: 'back', controlRoom: 'upper', ...sm }; break;
    case 'pumphouse': w = s.w || 18; d = s.d || 14; floors = 2; fh = 4.5; meta = { poolSide: 'back', ...sm }; break;
    case 'meltwater_pump': w = s.w || 18; d = s.d || 12; floors = 1; fh = 5; rk = RK.INSULATED; meta = { intakeSide: 'back', ...sm }; break;
    case 'insulated_station': w = 30; d = 18; floors = 1; fh = 3.8; rk = RK.INSULATED; meta = { vestibule: true, ...sm }; break;
    case 'control_tower': w = 9; d = 9; floors = 5; fh = 3.6; shape = 'round'; meta = { ...sm }; break;
    case 'community': w = 14; d = 10; floors = 1; fh = 4; break;
    case 'greenhouse': w = s.w || 11; d = s.d || 48; floors = 1; fh = 5; rk = RK.GLASS; tier = 'shed'; meta = { polar: !!D.polar || undefined, span: s.w || 11, ...sm }; break;
    // levee settlement (U7): low utility housing along the levee road
    case 'dorm': w = s.w || 30; d = s.d || 12; floors = 2 + ((Math.round(s.u * 7 + s.v * 3) & 3) === 0 ? 1 : 0); fh = 3.1; tier = 'lowrise'; meta = { ...sm }; break;
    case 'maintenance': w = s.w || 24; d = s.d || 16; floors = 1; fh = 5; meta = { ...sm }; break;
    case 'farm_station': w = s.w || 30; d = s.d || 20; floors = 2; fh = 4.5; meta = { ...sm }; break;
    case 'cold_storage': w = s.w || 40; d = s.d || 24; floors = 1; fh = 8; rk = RK.METAL; tier = 'shed'; meta = { ...sm }; break;
    default: w = s.w || 20; d = s.d || 12; floors = 1; fh = 4.5; meta = { ...sm };
  }
  const b = B.add({ cu: s.u, cv: s.v, fu, fv, w, d, use: s.use, tier, shape, circle: shape === 'round' ? w / 2 : 0, floors, fh, gfh: s.use === 'dorm' ? 3.4 : fh, roofKind: rk, roofType: s.use === 'greenhouse' ? 'gable' : 'flat', lc: s.use === 'dorm' ? LC.RESIDENTIAL : LC.UTILITY, meta, site: true });
  if (b && s.use !== 'greenhouse') B.area('yard_service', rectPolyOf(b, 10, 10));
  if (D.zone === 'O' && !L.active) L.defaultCls = SC.NATURAL;
  void tier;
}

export { rectPolyOf, segDist };
