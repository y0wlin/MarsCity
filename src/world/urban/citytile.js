// generateCityTile(face, x, y): everything of the plan inside one CITY_TILE_LEVEL (L13, ~650 m)
// quadtree tile, in the tile-local frame (origin = tile centre at sea level, +x east, +y up,
// +z south). Buildings / areas / docks / stations belong to the tile containing their anchor
// (centre); roads, rails and pipes are clipped exactly to the tile edges so neighbouring tiles join
// seamlessly (same polyline split at the shared edge).
import { R, CITY_TILE_LEVEL } from '../../core/constants.js';
import { tileBounds, faceToVec, unitToLatLon, enuBasisFromUnit, tileAt, tileKey, FACES, latLonToUnit } from '../../core/geo.js';
import { DC, CLASS, RAIL } from './rules.js';
import { nearestDistrict, chunkAt } from './dchunks.js';
import { district1, district2, toPlane, fromPlane, lineU, lineV, lineWidthU, lineWidthV, isCollU, isCollV, districtId, rasterLand, rasterCoast, rasterSample, planeHeading, slopeAt, keepsCliffsBare, promenadeOf } from './districts.js';
import { blockInfo, blockLayout, blockIdStr, farmIrrigated } from './parcels.js';
import { buildSpec, GroundMemo } from './specs.js';
import { chunkRails, segDistance, pointAt, inIntervals, railBedGround, stationRailLevel, bridgeAtT, bridgeDeckY } from './corridors.js';
import { bridgeType, finishBridge, deckAt, pieceFields, BRIDGE_MIN, BRIDGE_MAX, bridgeSeed } from './bridges.js';
import { harbourBridge } from './harbour.js';
import { clipSegHalfPlanes, polyHalfPlanes, polyArea } from './geom.js';
import { height, isWet } from './probe.js';

const ND = {}, Q = {}, P2 = {}, SD = {}, BI = {}, PR = {};
const QPI = Math.PI / 4;
const r3 = (x) => Math.round(x * 1000) / 1000;

export function generateCityTile(face, tx, ty, opts = null) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  // opts.buildingsOnly: far mass tiles need only buildings + stations (no roads / areas / lanes / docks /
  // rails / pipes); the buildings are bit-identical to a full call
  const bOnly = !!(opts && opts.buildingsOnly);
  let tB = 0, tS = 0;
  const level = CITY_TILE_LEVEL;
  const bnd = tileBounds(face, level, tx, ty);
  const c = faceToVec(face, (bnd.a0 + bnd.a1) / 2, (bnd.b0 + bnd.b1) / 2, {});
  const LLc = unitToLatLon(c.x, c.y, c.z, {});
  const E = enuBasisFromUnit(c.x, c.y, c.z, {});
  const ox = c.x * R, oy = c.y * R, oz = c.z * R;
  const ex = E.east, up = E.up, so = E.south;
  const local = (p, h) => {
    const rr = R + h;
    const dx = p.x * rr - ox, dy = p.y * rr - oy, dz = p.z * rr - oz;
    return [r3(dx * ex[0] + dy * ex[1] + dz * ex[2]), r3(dx * up[0] + dy * up[1] + dz * up[2]), r3(dx * so[0] + dy * so[1] + dz * so[2])];
  };
  const inTile = (p) => { const t = tileAt(p.x, p.y, p.z, level, P2); return t.face === face && t.x === tx && t.y === ty; };
  const key = tileKey(face, level, tx, ty);
  const memo = new GroundMemo();
  const hmemo = new Map();
  // street-level heights (2 m band limit): bilinear on a 2 m lattice of the district plane with memoised
  // lattice nodes — continuous, and independent of evaluation order, so neighbouring tiles that share
  // a polyline end point compute the same height there (no seams)
  const node2 = (D, iu, iv) => {
    const k = `${D.key}:${iu}:${iv}`;
    let h = hmemo.get(k);
    if (h === undefined) { fromPlane(D, iu * 2, iv * 2, Q); h = height(Q.x, Q.y, Q.z, 2); hmemo.set(k, h); }
    return h;
  };
  const groundUV = (D, u, v) => {
    const fu = u / 2, fv = v / 2, iu = Math.floor(fu), iv = Math.floor(fv), tu = fu - iu, tv = fv - iv;
    return (node2(D, iu, iv) * (1 - tu) + node2(D, iu + 1, iv) * tu) * (1 - tv) + (node2(D, iu, iv + 1) * (1 - tu) + node2(D, iu + 1, iv + 1) * tu) * tv;
  };
  const out = {
    key, face, x: tx, y: ty, level, center: { lat: LLc.lat, lon: LLc.lon, h: height(c.x, c.y, c.z, 4) },
    buildings: [], roads: [], areas: [], rails: [], stations: [], docks: [], pipes: [], lanes: [],
    stats: { districts: 0, blocks: 0, ms: 0, msBlocks: 0, msStreets: 0, msRails: 0, buildingsOnly: bOnly || undefined },
  };
  // ---- districts overlapping the tile ----
  const dset = new Map();
  const NS = 7;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const a = bnd.a0 + (bnd.a1 - bnd.a0) * (i / (NS - 1)), b = bnd.b0 + (bnd.b1 - bnd.b0) * (j / (NS - 1));
    faceToVec(face, a, b, Q);
    nearestDistrict(Q.x, Q.y, Q.z, ND);
    if (!dset.has(ND.key)) dset.set(ND.key, null);
  }
  // thin slivers: Voronoi neighbours whose cell might clip a tile corner
  for (const k of [...dset.keys()]) {
    const D = district1(k);
    if (D.cls === DC.WILD) continue;
    const G = district2(k);
    for (const e of G.edges) if (e.nkey >= 0 && !dset.has(e.nkey)) {
      const N1 = district1(e.nkey);
      if (N1.cls === DC.WILD) continue;
      const N = district2(e.nkey);
      if (quadInPlane(N, face, bnd).hit) dset.set(e.nkey, null);
    }
  }
  // ---- per district ----
  for (const dk of dset.keys()) {
    const D1 = district1(dk);
    if (D1.cls === DC.WILD) continue;
    const G = district2(dk);
    const D = G.D;
    const qp = quadInPlane(G, face, bnd);
    if (!qp.hit) continue;
    out.stats.districts++;
    const C = CLASS[D.cls];
    const did = districtId(dk);
    const qhp = qp.hp;
    const ground = (u, v) => groundUV(D, u, v);
    // blocks (anchors) ------------------------------------------------------------------------
    const margin = 90;
    const sites = !C.grid && (G.sites.length || G.stations.length);
    const tb0 = now();
    if (C.grid || sites) {
      const i0 = blockIndexUc(D, qp.u0 - margin), i1 = blockIndexUc(D, qp.u1 + margin);
      const j0 = blockIndexVc(D, qp.v0 - margin), j1 = blockIndexVc(D, qp.v1 + margin);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) < 6000) {
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const L = blockLayout(G, i, j);
          if (!L.bld.length && !L.areas.length && !L.lanes.length) continue;
          out.stats.blocks++;
          const bid = `${did}/${blockIdStr(i, j)}`;
          for (const b of L.bld) {
            fromPlane(D, b.cu, b.cv, Q);
            if (!inTile(Q)) continue;
            out.buildings.push(buildSpec(G, L, b, memo));
          }
          if (bOnly) continue;
          for (let ai = 0; ai < L.areas.length; ai++) {
            const a = L.areas[ai];
            let cu = 0, cv = 0; const n = a.poly.length >> 1;
            for (let q = 0; q < a.poly.length; q += 2) { cu += a.poly[q]; cv += a.poly[q + 1]; }
            cu /= n; cv /= n;
            fromPlane(D, cu, cv, Q);
            if (!inTile(Q)) continue;
            const hy = ground(cu, cv);
            const poly = [];
            for (let q = 0; q < a.poly.length; q += 2) { fromPlane(D, a.poly[q], a.poly[q + 1], Q); const l = local(Q, hy); poly.push([l[0], l[2]]); }
            const rec = { id: `${bid}/a${ai}`, kind: a.kind, polygon: poly, y: r3(hy), block: bid };
            if (a.crop !== undefined) { rec.crop = a.crop; rec.stage = a.stage; }
            out.areas.push(rec);
          }
          for (let li = 0; li < L.lanes.length; li++) {
            const ln = L.lanes[li];
            fromPlane(D, (ln.u0 + ln.u1) / 2, (ln.v0 + ln.v1) / 2, Q);
            if (!inTile(Q)) continue;
            const pts = polyline(D, ln.u0, ln.v0, ln.u1, ln.v1, 20, local, ground);
            out.roads.push({ id: `${bid}/l${li}`, cls: 'lane', width: ln.w, points: pts, covered: !!D.covered || undefined, district: did });
          }
        }
      }
    }
    const ts0 = now(); tB += ts0 - tb0;
    // grid streets ------------------------------------------------------------------------------
    if (C.grid && G.ihp.length && !bOnly) {
      const farm = D.zone === 'O' && (D.cls === DC.FARM || D.cls === DC.GREENHOUSE || D.cls === DC.POLAR);
      // farm grid roads end with the irrigated farmland, as on the ground texture (urban/raster.js)
      const keepAt = D.zone === 'O' && D.cls === DC.FARM ? (pu, pv) => farmIrrigated(G, pu, pv) > 0 : null;
      const ia = blockIndexUc(D, qp.u0) , ib = blockIndexUc(D, qp.u1) + 1;
      for (let i = ia; i <= ib; i++) {
        const U = lineU(D, i), w = lineWidthU(D, i);
        if (w <= 0 || U < qp.u0 - 1 || U > qp.u1 + 1) continue;
        const r = clipLine(G.ihp, qhp, U, qp.v0 - 10, U, qp.v1 + 10);
        if (!r) continue;
        emitStreet(out, G, D, 'u', i, U, r, (jj) => blockInfo(G, i - 1, jj, BI).active || blockInfo(G, i, jj, BI).active, w, farm ? 'farm' : isCollU(D, i) ? 'collector' : 'local', local, ground, did, '', keepAt);
      }
      const ja = blockIndexVc(D, qp.v0), jb = blockIndexVc(D, qp.v1) + 1;
      for (let j = ja; j <= jb; j++) {
        const V = lineV(D, j), w = lineWidthV(D, j);
        if (w <= 0 || V < qp.v0 - 1 || V > qp.v1 + 1) continue;
        if (D.railKey && j === D.railJ && !D.railElev) {
          // at-grade rail in this slot: service streets on both sides of the corridor
          for (const sgn of [-1, 1]) {
            const off = sgn * (RAIL.corridor / 2 + 4.5);
            const r = clipLine(G.ihp, qhp, qp.u0 - 10, V + off, qp.u1 + 10, V + off);
            if (r) emitStreet(out, G, D, 'v', j, V + off, r, () => true, 9, 'local', local, ground, did, sgn < 0 ? 's' : 'n');
          }
          continue;
        }
        const r = clipLine(G.ihp, qhp, qp.u0 - 10, V, qp.u1 + 10, V);
        if (!r) continue;
        emitStreet(out, G, D, 'v', j, V, r, (ii) => blockInfo(G, ii, j - 1, BI).active || blockInfo(G, ii, j, BI).active, w, farm ? 'farm' : isCollV(D, j) ? 'collector' : 'local', local, ground, did, '', keepAt);
      }
    }
    // levee roads along canals (O farm country; one bank per lateral, both banks of main canals) ---
    if (G.canals.length && (D.zone === 'O' || D.border) && C.grid && !bOnly) {
      for (const cn of G.canals) {
        if (cn.kind === 'river' || cn.kind === 'spillway') continue;
        const sides = (cn.order || 0) === 0 ? [1, -1] : [1];
        for (const sd of sides) {
          const off = ((cn.width || 20) / 2 + 11) * sd;
          const p = cn.pts;
          let k = 0;
          for (let q = 0; q + 3 < p.length; q += 2) {
            let nx = -(p[q + 3] - p[q + 1]), ny = p[q + 2] - p[q]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
            const ua = p[q] + nx * off, va = p[q + 1] + ny * off, ub = p[q + 2] + nx * off, vb = p[q + 3] + ny * off;
            const r1 = clipLine(G.hp, qhp, ua, va, ub, vb);
            if (!r1) continue;
            for (const run of wetSplit(G, D, r1.ua, r1.va, r1.ub, r1.vb, local, ground)) {
              out.roads.push({ id: `L${cn.id}:${sd > 0 ? 'l' : 'r'}:${did}:${q / 2}:${k++}`, cls: 'levee', width: 8, points: run.pts, bridge: run.bridge || undefined, district: did, canal: cn.id });
            }
          }
        }
      }
    }
    // OX1 basin town streets (U1, basin.js): pieces inside this district and tile ---------------------
    if (G.basinRoads && !bOnly) {
      for (const rd of G.basinRoads) {
        let k = 0;
        for (let q = 0; q + 1 < rd.pts.length; q++) {
          latLonToUnit(rd.pts[q][0], rd.pts[q][1], Q); const A = toPlane(D, Q.x, Q.y, Q.z, {});
          latLonToUnit(rd.pts[q + 1][0], rd.pts[q + 1][1], Q); const Bp = toPlane(D, Q.x, Q.y, Q.z, {});
          const r1 = clipLine(G.hp, qhp, A.u, A.v, Bp.u, Bp.v);
          if (!r1) continue;
          for (const run of wetSplit(G, D, r1.ua, r1.va, r1.ub, r1.vb, local, ground)) {
            out.roads.push({ id: `${rd.id}:${did}:${q}:${k++}`, cls: rd.cls, width: rd.width, points: run.pts, bridge: run.bridge || undefined, district: did });
          }
        }
      }
    }
    // arterials (district edges) --------------------------------------------------------------
    for (let ei = 0; ei < (bOnly ? 0 : G.edges.length); ei++) {
      const e = G.edges[ei];
      if (e.w <= 0) continue;
      if (e.nkey >= 0 && dset.has(e.nkey) && e.nkey < dk && district1(e.nkey).cls !== DC.WILD) continue;   // emitted by the neighbour
      const r = clipSegHalfPlanes(qhp, e.x0, e.y0, e.x1, e.y1);
      if (!r || r[1] - r[0] < 1e-6) continue;
      const pieces = edgePieces(G, e);
      for (let pk = 0; pk < pieces.length; pk++) {
        const pc = pieces[pk];
        if (pc.water && !pc.bridgeable) continue;
        const f0 = Math.max(r[0], pc.f0), f1 = Math.min(r[1], pc.f1);
        if (f1 - f0 < 1e-6) continue;
        const u0 = e.x0 + (e.x1 - e.x0) * f0, v0 = e.y0 + (e.y1 - e.y0) * f0, u1 = e.x0 + (e.x1 - e.x0) * f1, v1 = e.y0 + (e.y1 - e.y0) * f1;
        const ka = Math.min(dk, e.nkey), kb = Math.max(dk, e.nkey);
        const cls = e.w >= 44 ? 'boulevard' : e.w >= 20 ? 'arterial' : 'collector';
        // canyon walls: the arterial stops at cliff faces (pieces on the benches only)
        const spans = !pc.water && keepsCliffsBare(D) ? gentleSpans(G, u0, v0, u1, v1) : [[0, 1]];
        const elen = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        const rec = pc.water ? pc.rec : null;
        // deck: long bridges follow the record's profile (abutments → clearance), short ones the old +6 m slab
        const deckFn = rec ? ((u, v) => { const f = ((u - e.x0) * (e.x1 - e.x0) + (v - e.y0) * (e.y1 - e.y0)) / (elen * elen); return Math.max(deckAt(rec, (f - rec.fa) * elen), Math.max(ground(u, v), 0) + 6); })
          : pc.water ? ((u, v) => Math.max(ground(u, v), 0) + 6) : ground;
        for (let sp = 0; sp < spans.length; sp++) {
          const [g0, g1] = spans[sp];
          const pts = polyline(D, u0 + (u1 - u0) * g0, v0 + (v1 - v0) * g0, u0 + (u1 - u0) * g1, v0 + (v1 - v0) * g1, 20, local, deckFn);
          const road = { id: `A${ka.toString(36)}.${kb.toString(36)}.${pk}${spans.length > 1 || g0 > 0 ? '.' + sp : ''}`, cls, width: e.w, points: pts, bridge: pc.water || undefined, covered: !!D.covered || undefined, district: did };
          if (rec) Object.assign(road, pieceFields(rec, (f0 - rec.fa) * elen, (f1 - rec.fa) * elen));
          out.roads.push(road);
        }
      }
    }
    // shaded waterfront promenade (遮阳步廊, U3): covered walkway street along the shore ---------------
    if (D.waterfront && !bOnly) {
      const runs = promenadeOf(G);
      for (let ri = 0; ri < runs.length; ri++) {
        const p = runs[ri].pts;
        let pts = null, k = 0, s0 = 0;
        const flushP = () => { if (pts && pts.length >= 2) out.roads.push({ id: `${did}:prom${ri}.${k++}.${s0}`, cls: 'promenade', width: 12, points: pts, covered: true, canopy: 'shade', waterSide: 'sea', district: did }); pts = null; };
        for (let q = 0; q + 3 < p.length; q += 2) {
          const r = clipSegHalfPlanes(qhp, p[q], p[q + 1], p[q + 2], p[q + 3]);
          if (!r || r[1] - r[0] < 1e-6) { flushP(); continue; }
          const ua = p[q] + (p[q + 2] - p[q]) * r[0], va = p[q + 1] + (p[q + 3] - p[q + 1]) * r[0];
          const ub = p[q] + (p[q + 2] - p[q]) * r[1], vb = p[q + 1] + (p[q + 3] - p[q + 1]) * r[1];
          if (!pts) { pts = []; s0 = q >> 1; fromPlane(D, ua, va, Q); pts.push(local(Q, ground(ua, va))); }
          fromPlane(D, ub, vb, Q); pts.push(local(Q, ground(ub, vb)));
          if (r[1] < 1 - 1e-9) flushP();
        }
        flushP();
      }
    }
    tS += now() - ts0;
    // stations ---------------------------------------------------------------------------------
    for (const st of G.stations) {
      fromPlane(D, st.u, st.v, Q);
      if (!inTile(Q)) continue;
      let bid = null;
      if (st.bu !== undefined) {
        const L = blockLayout(G, blockIndexUc(D, st.bu), blockIndexVc(D, st.bv));
        const b = L.bld.find((x) => x.station === st);
        if (b) bid = buildSpec(G, L, b, memo).id;
      }
      // on the level rail bed of the station (same number as the rails polyline and meta.railLevel)
      const gh = st.ref ? stationRailLevel(st.ref) : ground(st.u, st.v);
      const pos = local(Q, gh + (st.elev ? RAIL.elevatedHeight : 0));
      out.stations.push({ id: st.id, buildingId: bid, x: pos[0], y: pos[1], z: pos[2], heading: Math.round(st.heading * 100) / 100, platformLength: st.plen, elevated: !!st.elev, main: !!st.main, kind: st.kind, side: st.side });
    }
    // docks ------------------------------------------------------------------------------------
    for (let pi = 0; pi < (bOnly ? 0 : G.piers.length); pi++) {
      const p = G.piers[pi];
      fromPlane(D, p.cu, p.cv, Q);
      if (!inTile(Q)) continue;
      const hl = p.len / 2, hw = p.wid / 2;
      const tu = -p.dv, tv = p.du;
      const poly = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => { fromPlane(D, p.cu + p.du * a + tu * b, p.cv + p.dv * a + tv * b, Q); const l = local(Q, 2.5); return [l[0], l[2]]; });
      out.docks.push({ id: `${did}/d${pi}`, kind: p.kind, polygon: poly, y: 2.5, heading: Math.round(planeHeading(D, p.du, p.dv) * 100) / 100, length: r3(p.len), width: r3(p.wid) });
    }
  }
  // ---- G01 inner-bay harbour bridge (U2): bridgehead approach, cable-stayed crossing, bridgehead approach ----
  if (!bOnly) emitHarbourBridge(out, face, bnd, key, local);
  // ---- rails, pipes and corridor roads ----
  const tr0 = now();
  const chunk = chunkAt(c.x, c.y, c.z);
  const rails = bOnly ? [] : chunkRails(chunk);
  const N = FACES[face][0], U = FACES[face][1], V = FACES[face][2];
  const s0 = Math.tan(bnd.a0 * QPI), s1 = Math.tan(bnd.a1 * QPI), q0 = Math.tan(bnd.b0 * QPI), q1 = Math.tan(bnd.b1 * QPI);
  const st2 = (p) => { const dn = p.x * N[0] + p.y * N[1] + p.z * N[2]; return [(p.x * U[0] + p.y * U[1] + p.z * U[2]) / dn, (p.x * V[0] + p.y * V[1] + p.z * V[2]) / dn]; };
  const tileHalf = 650;
  const gAt = (p) => height(p.x, p.y, p.z, 2);
  for (const sg of rails) {
    const d = segDistance(sg, c.x, c.y, c.z, SD);
    if (d > tileHalf + 200) continue;
    const ta = Math.max(0, SD.along - 2000), tb = Math.min(sg.len, SD.along + 2000);
    if (tb - ta < 1) continue;
    pointAt(sg, ta, Q); const A = st2(Q); pointAt(sg, tb, Q); const B = st2(Q);
    const hp = [1, 0, -s0, -1, 0, s1, 0, 1, -q0, 0, -1, q1];
    const r = clipSegHalfPlanes(hp, A[0], A[1], B[0], B[1]);
    if (!r) continue;
    const stAt = (f) => { const s = A[0] + (B[0] - A[0]) * f, t = A[1] + (B[1] - A[1]) * f; const x = N[0] + s * U[0] + t * V[0], y = N[1] + s * U[1] + t * V[1], z = N[2] + s * U[2] + t * V[2]; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
    const pa = stAt(r[0]), pb = stAt(r[1]);
    segDistance(sg, pa.x, pa.y, pa.z, SD); const ra = Math.max(0, Math.min(sg.len, SD.along));
    segDistance(sg, pb.x, pb.y, pb.z, SD); const rb = Math.max(0, Math.min(sg.len, SD.along));
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    if (hi - lo < 0.5) continue;
    // sample at a global 20 m lattice along the segment so both tiles cut the same polyline
    const ts = [lo]; for (let t = Math.ceil(lo / 20) * 20; t < hi; t += 20) if (t > lo + 0.01) ts.push(t); ts.push(hi);
    const segId = sg.key.toString(36);
    if (sg.rail || sg.kind === 'pipe') {
      let cur = null, part = 0;
      const flush = () => {
        if (cur && cur.points.length >= 2) {
          if (sg.kind === 'pipe') out.pipes.push({ id: cur.id, points: cur.points, diameter: 1.6, insulated: true });
          else {
            // long bridges (decision DB): structure type, span, clearance, pylons on this piece
            if (cur.bridge) { const rec = bridgeAtT(sg, (cur._ta + cur._tb) / 2); if (rec) Object.assign(cur, pieceFields(rec, cur._ta - rec.t0, cur._tb - rec.t0)); }
            delete cur._k; delete cur._ta; delete cur._tb; out.rails.push(cur);
          }
        }
        cur = null;
      };
      let lastT = 0;
      for (const t of ts) {
        pointAt(sg, t, Q);
        const br = inIntervals(sg.bridge, t);
        const elev = !br && sg.kind === 'metro' && inIntervals(sg.elev, t);   // over water the bridge wins (no viaduct on the sea bed)
        const gh = sg.rail ? railBedGround(sg, t, gAt(Q)) : gAt(Q);   // level beds over station platforms (D1)
        const y = elev ? gh + RAIL.elevatedHeight : br ? bridgeDeckY(sg, t, gh) : (sg.kind === 'pipe' ? gh + 1.2 : gh);
        const kind = elev ? 'e' : br ? 'b' : 'g';
        if (!cur || cur._k !== kind) {
          const last = cur && cur.points[cur.points.length - 1];
          flush();
          cur = { id: `R${segId}.${key.replace(/\//g, '_')}.${part++}`, segment: segId, kind: sg.kind, points: last ? [last] : [], elevated: elev, bridge: br, tracks: sg.tracks, _k: kind, _ta: last ? lastT : t, _tb: t };
        }
        cur.points.push(local(Q, y));
        cur._tb = t; lastT = t;
      }
      flush();
    }
    // corridor road: beside the rail outside dense districts, or on the centreline for road links
    const off = sg.rail ? RAIL.highwayOffset : sg.kind === 'pipe' ? 14 : 0, hw = sg.roadW || 12;
    let road = null, rp = 0;
    const pushRoad = () => {
      if (road && road.points.length >= 2) {
        if (road.bridge) { const rec = bridgeAtT(sg, (road._ta + road._tb) / 2); if (rec) Object.assign(road, pieceFields(rec, road._ta - rec.t0, road._tb - rec.t0)); }
        delete road._ta; delete road._tb; out.roads.push(road);
      }
      road = null;
    };
    for (const t of ts) {
      pointAt(sg, t, Q);
      const kx = Q.x + sg.nx * (off / R), ky = Q.y + sg.ny * (off / R), kz = Q.z + sg.nz * (off / R);
      const l = Math.hypot(kx, ky, kz); const p = { x: kx / l, y: ky / l, z: kz / l };
      nearestDistrict(p.x, p.y, p.z, ND);
      const Dd = district1(ND.key);
      const dense = (Dd.cls === DC.CORE || Dd.cls === DC.MID || Dd.cls === DC.INDUSTRIAL || Dd.cls === DC.PORT) && sg.rail;
      const br = inIntervals(sg.bridge, t);
      if (dense) { pushRoad(); continue; }
      if (road && !!road.bridge !== br) { const last = road.points[road.points.length - 1], lt = road._tb; pushRoad(); road = { id: `H${segId}.${key.replace(/\//g, '_')}.${rp++}`, cls: sg.kind === 'metro' ? 'highway' : 'service', width: hw, points: [last], bridge: br || undefined, corridor: sg.kind, _ta: lt, _tb: lt }; }
      if (!road) road = { id: `H${segId}.${key.replace(/\//g, '_')}.${rp++}`, cls: sg.kind === 'metro' ? 'highway' : 'service', width: hw, points: [], bridge: br || undefined, corridor: sg.kind, _ta: t, _tb: t };
      road.points.push(local(p, br ? bridgeDeckY(sg, t, gAt(p)) : gAt(p)));
      road._tb = t;
    }
    pushRoad();
  }
  const t1 = now();
  out.stats.ms = Math.round((t1 - t0) * 10) / 10;
  out.stats.msBlocks = Math.round(tB * 10) / 10; out.stats.msStreets = Math.round(tS * 10) / 10; out.stats.msRails = Math.round((t1 - tr0) * 10) / 10;
  return out;
}

// ---------------------------------------------------------------------------------------------
// G01 harbour bridge (harbour.js harbourBridge): one road record per tile piece, exactly clipped at the tile edges
// in face st coordinates (the chord is straight there to < 1 m), points on a global 20 m lattice from landing A
// ---------------------------------------------------------------------------------------------
// Designated long bridges: BG01 (G01 inner bay, harbour.js) and BZ5 (ZR5 南盆港群, a 2 km navigable channel in the
// dense port-city fan at 38.35S 103.18E) — the cable-stayed crossings of the coastal provinces that the corridor
// graph does not produce by itself (decision DB: one per coastal Z province; ZR4 has many inter-island ones).
const ZR5_BRIDGE = { id: 'BZ5', a: [-38.35, 103.1487], b: [-38.35, 103.2113], mainSpan: 640, h: 165, shape: 'H', baseR: 55, width: 30 };
let DBR = null;
function slerpLL(a, b, f) {
  const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f, l = Math.hypot(x, y, z);
  const p = { x: x / l, y: y / l, z: z / l };
  p.lat = Math.asin(p.y) * 180 / Math.PI; p.lon = Math.atan2(p.x, p.z) * 180 / Math.PI;
  return p;
}
function makeDesignated(id, a, b, at, L, mainSpan, pylonsAt, width) {
  // water ends along the chord (exact terrain, 10 m); abutments just inland of the shores
  let w0 = -1, w1 = -1;
  for (let sm = 0; sm <= L; sm += 10) { const p = at(sm); if (height(p.x, p.y, p.z, 8) < 0) { if (w0 < 0) w0 = sm; w1 = sm; } }
  if (w0 < 0) return null;
  const sA = Math.max(0, w0 - 30), sB = Math.min(L, w1 + 40);
  const pa = at(sA), pb = at(sB);
  const gA = Math.max(0, height(pa.x, pa.y, pa.z, 2)), gB = Math.max(0, height(pb.x, pb.y, pb.z, 2));
  const rec = { id, kind: 'road', type: 'cable', span: w1 - w0 + 10, length: sB - sA, mainSpan, clearance: 52, pylons: [], at, L, w0, w1, sA, sB, a, b, width };
  finishBridge(rec, gA, gB, 0, w0 - sA, w1 + 10 - sA);
  rec.pylons = pylonsAt(rec);
  rec.deck = (sm) => deckAt(rec, sm - sA);
  rec.clearance = Math.round((rec.deck((rec.pylons[0].s + rec.pylons[1].s) / 2) - rec.level) * 10) / 10;
  return rec;
}
export function designatedBridges() {
  if (DBR) return DBR;
  DBR = [];
  {
    const hb = harbourBridge;
    const L = Math.hypot(hb.B[0] - hb.A[0], hb.B[1] - hb.A[1]);
    const at = (sm) => { const f = sm / L; return hb.toLL(hb.A[0] + (hb.B[0] - hb.A[0]) * f, hb.A[1] + (hb.B[1] - hb.A[1]) * f); };
    // pylons where the harbour layout puts them (pylon islands); s = chord position
    const rec = makeDesignated(hb.id, hb.a, hb.b, at, L, hb.mainSpan, () => hb.pylons.map((py) => ({ s: ((py.U - hb.A[0]) * (hb.B[0] - hb.A[0]) + (py.V - hb.A[1]) * (hb.B[1] - hb.A[1])) / L, h: py.h, shape: py.shape, base: py.base, baseR: py.baseR, lat: py.lat, lon: py.lon })), hb.width);
    if (rec) DBR.push(rec);
  }
  {
    const z = ZR5_BRIDGE;
    const a = latLonToUnit(z.a[0], z.a[1], {}), b = latLonToUnit(z.b[0], z.b[1], {});
    const L = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * R;
    const at = (sm) => slerpLL(a, b, sm / L);
    const rec = makeDesignated(z.id, a, b, at, L, z.mainSpan, (r) => {
      const mid = (r.w0 + r.w1) / 2;
      return [-1, 1].map((sg) => { const sp = mid + sg * z.mainSpan / 2, q = at(sp); return { s: sp, h: z.h, shape: z.shape, base: 'island', baseR: z.baseR, lat: q.lat, lon: q.lon }; });
    }, z.width);
    if (rec) DBR.push(rec);
  }
  return DBR;
}
/** the G01 harbour bridge record (BG01) */
export function harbourBridgeRecord() { return designatedBridges()[0]; }

function emitHarbourBridge(out, face, bnd, key, local) {
  for (const rec of designatedBridges()) emitDesignated(out, face, bnd, key, local, rec);
}
function emitDesignated(out, face, bnd, key, local, rec) {
  const N = FACES[face][0], U = FACES[face][1], V = FACES[face][2];
  const st2 = (p) => { const dn = p.x * N[0] + p.y * N[1] + p.z * N[2]; return dn > 0.1 ? [(p.x * U[0] + p.y * U[1] + p.z * U[2]) / dn, (p.x * V[0] + p.y * V[1] + p.z * V[2]) / dn] : null; };
  const A = st2(rec.a), B = st2(rec.b);
  if (!A || !B) return;
  const s0 = Math.tan(bnd.a0 * QPI), s1 = Math.tan(bnd.a1 * QPI), q0 = Math.tan(bnd.b0 * QPI), q1 = Math.tan(bnd.b1 * QPI);
  const r = clipSegHalfPlanes([1, 0, -s0, -1, 0, s1, 0, 1, -q0, 0, -1, q1], A[0], A[1], B[0], B[1]);
  if (!r || r[1] - r[0] < 1e-9) return;
  const L = rec.L, lo = r[0] * L, hi = r[1] * L;
  // pieces: land approach A | bridge | land approach B
  const cuts = [lo, hi, rec.sA, rec.sB].sort((a, b) => a - b);
  const ys = (sm) => { const p = rec.at(sm); const g = height(p.x, p.y, p.z, 2); const onBr = sm > rec.sA && sm < rec.sB; return { p, y: onBr ? Math.max(rec.deck(sm), Math.max(g, 0) + 6) : g }; };
  let k = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = Math.max(lo, cuts[c]), b = Math.min(hi, cuts[c + 1]);
    if (b - a < 0.5) continue;
    const onBr = (a + b) / 2 > rec.sA && (a + b) / 2 < rec.sB;
    const ss = [a]; for (let t = Math.ceil(a / 20) * 20; t < b; t += 20) if (t > a + 0.01) ss.push(t); ss.push(b);
    const pts = ss.map((sm) => { const e = ys(sm); return local(e.p, e.y); });
    const road = { id: `${rec.id}.${key.replace(/\//g, '_')}.${k++}`, cls: 'boulevard', width: rec.width, points: pts, bridge: onBr || undefined, district: rec.id };
    if (onBr) Object.assign(road, pieceFields(rec, a, b));
    else road.bridgehead = true;
    out.roads.push(road);
  }
}

// conservative block index range (grid jitter ≤ module/2)
function blockIndexUc(D, u) { let i = Math.floor((u - D.u0) / D.bw); if (u < lineU(D, i)) i--; else if (u >= lineU(D, i + 1)) i++; return i; }
function blockIndexVc(D, v) { let j = Math.floor((v - D.v0) / D.bd); if (v < lineV(D, j)) j--; else if (v >= lineV(D, j + 1)) j++; return j; }

/** tile quad in a district plane: bounds + half-planes; hit = overlaps the district polygon bounds */
function quadInPlane(G, face, bnd) {
  const D = G.D;
  const pts = [];
  for (const [a, b] of [[bnd.a0, bnd.b0], [bnd.a1, bnd.b0], [bnd.a1, bnd.b1], [bnd.a0, bnd.b1]]) {
    faceToVec(face, a, b, Q); toPlane(D, Q.x, Q.y, Q.z, PR); pts.push(PR.u, PR.v);
  }
  if (polyArea(pts) < 0) { const r = []; for (let k = pts.length - 2; k >= 0; k -= 2) r.push(pts[k], pts[k + 1]); pts.length = 0; pts.push(...r); }
  let u0 = 1e30, v0 = 1e30, u1 = -1e30, v1 = -1e30;
  for (let k = 0; k < 8; k += 2) { u0 = Math.min(u0, pts[k]); u1 = Math.max(u1, pts[k]); v0 = Math.min(v0, pts[k + 1]); v1 = Math.max(v1, pts[k + 1]); }
  const hp = polyHalfPlanes(pts);
  const gb = G.bb;
  const hit = !(gb.x1 < u0 || gb.x0 > u1 || gb.y1 < v0 || gb.y0 > v1);
  return { hit, u0, v0, u1, v1, hp, pts };
}

function clipLine(ihp, qhp, ua, va, ub, vb) {
  const r1 = clipSegHalfPlanes(ihp, ua, va, ub, vb);
  if (!r1) return null;
  const r2 = clipSegHalfPlanes(qhp, ua, va, ub, vb);
  if (!r2) return null;
  const t0 = Math.max(r1[0], r2[0]), t1 = Math.min(r1[1], r2[1]);
  if (t1 - t0 < 1e-6) return null;
  return { ua: ua + (ub - ua) * t0, va: va + (vb - va) * t0, ub: ua + (ub - ua) * t1, vb: va + (vb - va) * t1 };
}

/** emit street pieces along a grid line, only where an adjacent block is active */
/** split [lo, hi] pieces along a grid line into the runs where keepAt(u, v) holds (10 m steps) */
function keepRuns(pieces, axis, coord, keepAt) {
  const out = [];
  for (const [lo, hi] of pieces) {
    let a = -1;
    const n = Math.max(1, Math.ceil((hi - lo) / 10));
    for (let k = 0; k <= n; k++) {
      const t = lo + ((hi - lo) * k) / n;
      const ok = axis === 'u' ? keepAt(coord, t) : keepAt(t, coord);
      if (ok && a < 0) a = t;
      if ((!ok || k === n) && a >= 0) { const b = ok ? t : t - (hi - lo) / n; if (b - a >= 5) out.push([a, b]); a = -1; }
    }
  }
  return out;
}
function emitStreet(out, G, D, axis, idx, coord, r, activeAt, w, cls, local, ground, did, tag, keepAt = null) {
  let pieces = [];
  if (axis === 'u') {
    const a = Math.min(r.va, r.vb), b = Math.max(r.va, r.vb);
    let j = blockIndexVc(D, a);
    for (; lineV(D, j) < b; j++) {
      const lo = Math.max(a, lineV(D, j)), hi = Math.min(b, lineV(D, j + 1));
      if (hi - lo < 0.5) continue;
      const ok = activeAt(j);
      if (ok && pieces.length && Math.abs(pieces[pieces.length - 1][1] - lo) < 0.01) pieces[pieces.length - 1][1] = hi; else if (ok) pieces.push([lo, hi]);
    }
    if (keepAt) pieces = keepRuns(pieces, 'u', coord, keepAt);
    for (const [lo, hi] of pieces) {
      for (const run of wetSplit(G, D, coord, lo, coord, hi, local, ground)) {
        out.roads.push({ id: `${did}:u${idx}${tag}:${Math.round(lo)}${run.k ? '.' + run.k : ''}`, cls, width: w, points: run.pts, bridge: run.bridge || undefined, covered: !!D.covered || undefined, district: did });
      }
    }
  } else {
    const a = Math.min(r.ua, r.ub), b = Math.max(r.ua, r.ub);
    let i = blockIndexUc(D, a);
    for (; lineU(D, i) < b; i++) {
      const lo = Math.max(a, lineU(D, i)), hi = Math.min(b, lineU(D, i + 1));
      if (hi - lo < 0.5) continue;
      const ok = activeAt(i);
      if (ok && pieces.length && Math.abs(pieces[pieces.length - 1][1] - lo) < 0.01) pieces[pieces.length - 1][1] = hi; else if (ok) pieces.push([lo, hi]);
    }
    if (keepAt) pieces = keepRuns(pieces, 'v', coord, keepAt);
    for (const [lo, hi] of pieces) {
      for (const run of wetSplit(G, D, lo, coord, hi, coord, local, ground)) {
        out.roads.push({ id: `${did}:v${idx}${tag}:${Math.round(lo)}${run.k ? '.' + run.k : ''}`, cls, width: w, points: run.pts, bridge: run.bridge || undefined, covered: !!D.covered || undefined, district: did, rail: tag ? true : undefined });
      }
    }
  }
}

/**
 * Street points every ≤ 20 m with ground heights; parts over water become short bridges (≤ 160 m,
 * dry on both sides) or are dropped. Land / water from the district raster, refined with exact
 * probes only near shores.
 */
function wetSplit(G, D, u0, v0, u1, v1, local, ground) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.ceil(len / 20));
  const P = [];
  const bare = keepsCliffsBare(D);
  for (let k = 0; k <= n; k++) {
    const f = k / n, u = u0 + (u1 - u0) * f, v = v0 + (v1 - v0) * f;
    let wet = rasterLand(G, u, v) < 0.5;
    const nearShore = Math.abs(rasterCoast(G, u, v)) < 150 || rasterSample(G.raster, G.raster.inl, u, v) > 0.02;
    if (nearShore) { fromPlane(D, u, v, Q); wet = isWet(Q.x, Q.y, Q.z, 2); }
    // canyon walls: streets stop at the cliff edge (risers stay bare rock), never bridged
    const cut = !wet && bare && slopeAt(G, u, v, 0) > 0.8;
    P.push({ u, v, wet: wet || cut, cut });
  }
  const runs = [];
  let cur = null;
  for (let k = 0; k <= n; k++) {
    if (!cur || cur.wet !== P[k].wet) { cur = { wet: P[k].wet, cut: P[k].cut, a: k, b: k }; runs.push(cur); } else { cur.b = k; if (P[k].cut) cur.cut = true; }
  }
  const res = [];
  let acc = null, part = 0;
  const step = len / n;
  for (let r = 0; r < runs.length; r++) {
    const R0 = runs[r];
    const bridge = R0.wet && !R0.cut && r > 0 && r < runs.length - 1 && (R0.b - R0.a + 2) * step <= 160;
    if (R0.wet && !bridge) { if (acc && acc.pts.length >= 2) res.push(acc); acc = null; continue; }
    if (!acc) acc = { pts: [], bridge: false, k: part++ };
    const a = acc.pts.length ? R0.a : Math.max(0, R0.a - (r > 0 ? 1 : 0));
    for (let k = a; k <= R0.b; k++) {
      const e = P[k];
      fromPlane(D, e.u, e.v, Q);
      const h = ground(e.u, e.v);
      acc.pts.push(local(Q, R0.wet ? Math.max(h, 0) + 3.5 : h));
    }
    if (bridge) acc.bridge = true;
  }
  if (acc && acc.pts.length >= 2) res.push(acc);
  return res;
}

/** parameter spans [f0, f1] of the plane segment that do not cross a cliff face (fine slope ≤ 0.8), ≥ 30 m */
function gentleSpans(G, u0, v0, u1, v1) {
  const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.ceil(len / 10));
  const out = [];
  let a = -1;
  for (let k = 0; k <= n; k++) {
    const f = k / n, ok = slopeAt(G, u0 + (u1 - u0) * f, v0 + (v1 - v0) * f, 0) <= 0.8;
    if (ok && a < 0) a = f;
    if ((!ok || k === n) && a >= 0) { const b = ok ? f : (k - 1) / n; if ((b - a) * len >= 30) out.push([a, b]); a = -1; }
  }
  return out;
}

function polyline(D, u0, v0, u1, v1, step, local, ground) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.ceil(len / step));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n, u = u0 + (u1 - u0) * f, v = v0 + (v1 - v0) * f;
    fromPlane(D, u, v, Q);
    pts.push(local(Q, ground(u, v)));
  }
  return pts;
}

/**
 * Water pieces along a full district edge (param f 0..1), cached on the edge. A water piece is a
 * bridge when it is shorter than 1.4 km and has land on both sides; otherwise the road stops.
 * Decided per edge, never per tile, so neighbouring tiles agree.
 */
export function edgePieces(G, e) {
  if (e._pieces) return e._pieces;
  const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
  const n = Math.max(1, Math.ceil(len / 25));
  const res = [];
  let cur = null;
  for (let k = 0; k <= n; k++) {
    const f = k / n, u = e.x0 + (e.x1 - e.x0) * f, v = e.y0 + (e.y1 - e.y0) * f;
    const wet = rasterLand(G, u, v) < 0.5;
    if (!cur || cur.water !== wet) {
      if (cur) { cur.f1 = f; res.push(cur); }
      cur = { water: wet, f0: f, f1: f };
    }
  }
  if (cur) { cur.f1 = 1; res.push(cur); }
  for (let k = 0; k < res.length; k++) {
    const p = res[k];
    if (!p.water) continue;
    const span = (p.f1 - p.f0) * len;
    p.bridgeable = span < BRIDGE_MAX && k > 0 && k < res.length - 1;
    // long crossings (≥ 300 m of water, decision DB) get a structure record and a deck profile
    if (p.bridgeable && span >= BRIDGE_MIN) {
      const fm = (p.f0 + p.f1) / 2;
      const sea = rasterCoast(G, e.x0 + (e.x1 - e.x0) * fm, e.y0 + (e.y1 - e.y0) * fm) < 0;
      const ka = Math.min(G.key, e.nkey), kb = Math.max(G.key, e.nkey);
      const ty = bridgeType(span, 'road', sea, false, bridgeSeed(ka % 1000003, kb % 1000003, k));
      if (ty) {
        // abutments on the last dry samples (cliff tops stay cliff tops)
        const fa = Math.max(0, p.f0 - 25 / len), fb = Math.min(1, p.f1 + 25 / len);
        const gA = abutGround(G, e, fa), gB = abutGround(G, e, fb);
        const rec = { id: `BA${ka.toString(36)}.${kb.toString(36)}.${k}`, kind: 'road', span, length: (fb - fa) * len, fa, fb, ...ty };
        finishBridge(rec, Math.max(0, gA), Math.max(0, gB), 0, (p.f0 - fa) * len, (p.f1 - fa) * len);
        p.rec = rec;
      }
    }
  }
  e._pieces = res;
  return res;
}
const QAB = {};
function abutGround(G, e, f) { fromPlane(G.D, e.x0 + (e.x1 - e.x0) * f, e.y0 + (e.y1 - e.y0) * f, QAB); return height(QAB.x, QAB.y, QAB.z, 2); }
