#!/usr/bin/env node
// OX1 东泽汇水盆地 programme check (urban fix round 3, U1): generates the L13 city tiles around the outlet main and
// the lake, lists the basin programme sites found in the tiles, checks that no building stands in the lake / on water /
// on steep ground, and draws a plan map (lake, canals, fields, roads, buildings by use).
//   node scripts/check-urban-basin.mjs [--r 3500] [--out shots/urban/fix3-ox1-basin-map.png] [--json out.json]
import fs from 'fs';
import { initWorldNode } from './node-world.mjs';
import { Canvas } from './preview-urban-lib.mjs';

initWorldNode();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const H = await import('../src/world/hydro.js');
const geo = await import('../src/core/geo.js');
const U = await import('../src/world/urban.js');
const { heightAt } = await import('../src/world/terrain.js');
const { basinProgram } = await import('../src/world/urban/basin.js');
const R = 3389500, DEG = Math.PI / 180;
const B = H.ox1Basin();
const oc = B.outlet;
// map frame: ENU at the canal midpoint
const mid = [(oc.points[0][0] + oc.points[oc.points.length - 1][0]) / 2, (oc.points[0][1] + oc.points[oc.points.length - 1][1]) / 2];
const RAD = +arg('r', 3800);
const E = geo.enuBasis(mid[0], mid[1], {}), O = geo.latLonToUnit(mid[0], mid[1], {});
const en = (q) => { const dx = q.x - O.x, dy = q.y - O.y, dz = q.z - O.z; return [(dx * E.east[0] + dy * E.east[1] + dz * E.east[2]) * R, (dx * E.north[0] + dy * E.north[1] + dz * E.north[2]) * R]; };
const fromEn = (e, n) => { const k = 1 / R; const q = { x: O.x + (E.east[0] * e + E.north[0] * n) * k, y: O.y + (E.east[1] * e + E.north[1] * n) * k, z: O.z + (E.east[2] * e + E.north[2] * n) * k }; const l = Math.hypot(q.x, q.y, q.z); q.x /= l; q.y /= l; q.z /= l; return q; };
// tiles
const tiles = new Map();
for (let e = -RAD; e <= RAD; e += 250) for (let n = -RAD; n <= RAD; n += 250) { const q = fromEn(e, n); const t = geo.tileAt(q.x, q.y, q.z, 13, {}); tiles.set(`${t.face}/${t.x}/${t.y}`, t); }
const P = basinProgram();
const W = {};
const res = { tiles: tiles.size, buildings: 0, basinSites: 0, programme: P ? P.sites.length : 0, uses: {}, wet: [], steep: [], lakeNear: [], roads: { levee: 0, town: 0 } };
const S = 1000, sc = S / (2 * RAD), px = (e, n) => [S / 2 + e * sc, S / 2 - n * sc];
const cv = new Canvas(S, S, [150, 84, 56]);
// background: lake / canal / ground
for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
  const e = (x - S / 2) / sc, n = (S / 2 - y) / sc; const q = fromEn(e, n);
  H.waterAt(q.x, q.y, q.z, W);
  const h = heightAt(q.x, q.y, q.z, 40);
  const wet = W.type && (W.depth !== undefined ? W.depth : W.level - h) > 0;
  const c = wet ? (W.type === 3 ? [30, 70, 120] : [40, 110, 170]) : [Math.min(255, 120 + h * 0.25), Math.min(255, 70 + h * 0.15), 50];
  cv.rect(x, y, 2, 2, c);
}
const seenIds = new Set();
for (const t of tiles.values()) {
  const d = U.generateCityTile(t.face, t.x, t.y);
  const c0 = geo.latLonToUnit(d.center.lat, d.center.lon, {});
  const Et = geo.enuBasis(d.center.lat, d.center.lon, {});
  const toEn = (lx, lz) => { const k = 1 / R; const q = { x: c0.x + (Et.east[0] * lx - Et.north[0] * lz) * k, y: c0.y + (Et.east[1] * lx - Et.north[1] * lz) * k, z: c0.z + (Et.east[2] * lx - Et.north[2] * lz) * k }; return en(q); };
  for (const a of d.areas) if (a.kind === 'field') cv.poly(a.polygon.map(([x, z]) => px(...toEn(x, z))), [96, 140, 70]);
  for (const r of d.roads) {
    const pts = r.points.map((p) => px(...toEn(p[0], p[2])));
    cv.polyline(pts, Math.max(1, r.width * sc), r.cls === 'levee' ? [235, 225, 180] : r.id.startsWith('OX1T') ? [255, 255, 255] : [200, 190, 170]);
    if (r.cls === 'levee' && r.canal === oc.id) res.roads.levee++;
    if (r.id.startsWith('OX1T')) res.roads.town++;
  }
  for (const b of d.buildings) {
    if (seenIds.has(b.id)) continue; seenIds.add(b.id);
    res.buildings++;
    const isBasin = b.meta && b.meta.basin === 'OX1-BL1';
    if (isBasin) { res.basinSites++; res.uses[b.use] = (res.uses[b.use] || 0) + 1; }
    // corner tests
    const q = geo.latLonToUnit(b.lat, b.lon, {}); const [be, bn] = en(q);
    const h = b.heading * DEG, fe = Math.sin(h), fn = Math.cos(h);
    const rx = -Math.cos(h), ry = Math.sin(h);   // building +X in (e, n) = (−f_n, f_e)
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [be + rx * a * b.footprint.w / 2 + fe * c * b.footprint.d / 2, bn + ry * a * b.footprint.w / 2 + fn * c * b.footprint.d / 2]);
    let wet = false, lo = 1e9, hi = -1e9, lake = false;
    for (const [ce, cn] of corners) {
      const p = fromEn(ce, cn); H.waterAt(p.x, p.y, p.z, W); const hh = heightAt(p.x, p.y, p.z, 2);
      if (W.type && (W.depth !== undefined ? W.depth : W.level - hh) > 0) { wet = true; if (W.type === 3) lake = true; }
      if (hh < lo) lo = hh; if (hh > hi) hi = hh;
    }
    if (wet) res.wet.push(`${b.id} ${b.use}${lake ? ' LAKE' : ''}`);
    const lim = b.meta && b.meta.pad ? 9.5 : 6;
    if (hi - lo > lim) res.steep.push(`${b.id} ${b.use} spread ${(hi - lo).toFixed(1)}`);
    const col = isBasin ? (b.use === 'sluice_station' ? [255, 60, 60] : b.use === 'control_tower' ? [255, 200, 0] : b.use === 'dorm' ? [255, 255, 255] : [210, 220, 255]) : [120, 120, 120];
    cv.poly(corners.map(([ce, cn]) => px(ce, cn)), col);
  }
}
const out = arg('out', 'shots/urban/fix3-ox1-basin-map.png');
await cv.save(out);
// programme sites missing from the tiles?
if (P) res.missing = P.sites.length - res.basinSites;
console.log(JSON.stringify({ ...res, wet: res.wet.slice(0, 30), steep: res.steep.slice(0, 30), nWet: res.wet.length, nSteep: res.steep.length }, null, 1));
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(res, null, 1));
