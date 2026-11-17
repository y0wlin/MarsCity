#!/usr/bin/env node
// Node-side skyline preview (urban, fix round 3 / U2): renders the city tiles seen from a camera pose as flat-shaded
// boxes (painter's algorithm) over a sea plane and a terrain silhouette, so the rhythm of a skyline (tower centres,
// gaps, front row) can be judged without a browser. Prints per-centre statistics for the G01 harbour city.
//   node scripts/preview-urban-skyline.mjs --pose 0.53127,129.95260,20,12.7,2,45 --dist 16000 \
//        --out shots/urban/fix3-skyline.png [--w 1600 --h 900] [--json out.json] [--map map.png]
import fs from 'fs';
import path from 'path';
import { initWorldNode } from './node-world.mjs';
import { Canvas, lin2srgb } from './preview-urban-lib.mjs';

initWorldNode();
const { generateCityTile, harbourCityAt } = await import('../src/world/urban.js');
const geo = await import('../src/core/geo.js');
const { heightAt } = await import('../src/world/terrain.js');
const { R } = await import('../src/core/constants.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const [lat, lon, alt, hdg, pitch, lens] = arg('pose', '0.53127,129.95260,20,12.7,2,45').split(',').map(Number);
const W = +arg('w', 1600), H = +arg('h', 900), DIST = +arg('dist', 16000);
const OUT = arg('out', 'shots/urban/skyline.png');
const DEG = Math.PI / 180;

// ---- camera ----
const C = geo.latLonHToEcef(lat, lon, alt, {});
const E = geo.enuBasis(lat, lon, {});
const add = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const h = hdg * DEG, p = pitch * DEG;
const hor = add([0, 0, 0], E.east, Math.sin(h)); const hor2 = add(hor, E.north, Math.cos(h));
const F = add(add([0, 0, 0], hor2, Math.cos(p)), E.up, Math.sin(p));
const Rt = add(add([0, 0, 0], E.east, Math.cos(h)), E.north, -Math.sin(h));
const U = [Rt[1] * F[2] - Rt[2] * F[1], Rt[2] * F[0] - Rt[0] * F[2], Rt[0] * F[1] - Rt[1] * F[0]];
const hfov = 2 * Math.atan(18 / lens), vfov = 2 * Math.atan(Math.tan(hfov / 2) / (W / H));
const fpx = (H / 2) / Math.tan(vfov / 2);
function proj(P) {
  const d = [P.x - C.x, P.y - C.y, P.z - C.z];
  const z = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
  if (z < 1) return null;
  const x = d[0] * Rt[0] + d[1] * Rt[1] + d[2] * Rt[2], y = d[0] * U[0] + d[1] * U[1] + d[2] * U[2];
  return [W / 2 + fpx * x / z, H / 2 - fpx * y / z, z];
}
/** ground point at distance s (m) along azimuth az (deg) from the camera */
function dest(az, s, out = {}) {
  const a = az * DEG, k = s / R;
  const dir = add(add([0, 0, 0], E.east, Math.sin(a)), E.north, Math.cos(a));
  const u0 = geo.latLonToUnit(lat, lon, {});
  out.x = u0.x * Math.cos(k) + dir[0] * Math.sin(k); out.y = u0.y * Math.cos(k) + dir[1] * Math.sin(k); out.z = u0.z * Math.cos(k) + dir[2] * Math.sin(k);
  return out;
}

// ---- tiles in the view wedge ----
const tiles = new Map();
const half = hfov / 2 / DEG + 3;
for (let az = hdg - half; az <= hdg + half; az += 0.4) {
  for (let s = 150; s <= DIST; s += 150) {
    const q = dest(az, s); const t = geo.tileAt(q.x, q.y, q.z, 13, {});
    const key = `${t.face}/${t.x}/${t.y}`; if (!tiles.has(key)) tiles.set(key, t);
  }
}
const t0 = Date.now();
const boxes = [];
let nb = 0;
for (const t of tiles.values()) {
  const d = generateCityTile(t.face, t.x, t.y, { buildingsOnly: true });
  for (const b of d.buildings) {
    nb++;
    const hgt = b.meta && b.meta.height ? b.meta.height : (b.groundFloorHeight || b.floorHeight) + (b.floors - 1) * b.floorHeight;
    const parts = [];
    if (b.meta && b.meta.podium && b.meta.tower) {
      parts.push({ x: 0, z: 0, w: b.footprint.w, d: b.footprint.d, h: b.meta.podium.height });
      parts.push({ x: b.meta.tower.x, z: b.meta.tower.z, w: b.meta.tower.w, d: b.meta.tower.d, h: hgt });
    } else parts.push({ x: 0, z: 0, w: b.footprint.w, d: b.footprint.d, h: hgt });
    const hc = harbourCityAt(b.lat, b.lon);
    boxes.push({ id: b.id, use: b.use, floors: b.floors, hgt, lat: b.lat, lon: b.lon, heading: b.heading, g: b.ground.entrance, parts, centre: hc.w > 0 ? (hc.cluster || 'mid') : '', ds: hc.ds, w: hc.w, U: hc.U, V: hc.V });
  }
}
const tGen = Date.now() - t0;

// ---- draw ----
const sky = [118, 150, 196], sea = [40, 110, 150];
const cv = new Canvas(W, H, sky);
// sea below the horizon (geometric horizon dip)
const dip = Math.acos(R / (R + alt));
for (let x = 0; x < W; x++) {
  const yh = H / 2 - fpx * Math.tan(-dip - p);
  for (let y = Math.max(0, Math.floor(yh)); y < H; y++) cv.set(x, y, sea);
}
// terrain silhouette: per column the max elevation angle of the ground along the ray (approximate: drawn as a fill)
const NCOL = 400;
for (let c = 0; c < NCOL; c++) {
  const xpx = (c + 0.5) * W / NCOL;
  const azr = Math.atan((xpx - W / 2) / fpx);
  const az = hdg + azr / DEG;
  let maxY = H + 10, nearY = -1;
  for (let s = 200; s <= DIST + 4000; s += s < 4000 ? 50 : 120) {
    const q = dest(az, s); const hg = heightAt(q.x, q.y, q.z, 30);
    if (hg <= 0) continue;
    const P = { x: q.x * (R + hg), y: q.y * (R + hg), z: q.z * (R + hg) };
    const pr = proj(P); if (!pr) continue;
    if (nearY < 0) { const P0 = { x: q.x * R, y: q.y * R, z: q.z * R }; const p0 = proj(P0); nearY = p0 ? p0[1] : H; }
    if (pr[1] < maxY) maxY = pr[1];
  }
  if (maxY < H && nearY > maxY) cv.rect(Math.floor(c * W / NCOL), Math.floor(maxY), Math.ceil(W / NCOL) + 1, Math.ceil(nearY - maxY) + 1, [150, 78, 52]);
}
// buildings far → near; flat shade by face orientation + distance haze
const sun = add(add(add([0, 0, 0], E.east, Math.sin(240 * DEG) * 0.6), E.north, Math.cos(240 * DEG) * 0.6), E.up, 0.8);
const items = [];
for (const b of boxes) {
  const Eb = geo.enuBasis(b.lat, b.lon, {});
  const hh = b.heading * DEG;
  const fz = add(add([0, 0, 0], Eb.east, Math.sin(hh)), Eb.north, Math.cos(hh));   // front normal (+Z)
  const fx = add(add([0, 0, 0], Eb.east, Math.cos(hh)), Eb.north, -Math.sin(hh));  // right (+X)
  const u0 = geo.latLonToUnit(b.lat, b.lon, {});
  for (const pt of b.parts) {
    const corners = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = pt.x + sx * pt.w / 2, lz = pt.z + sz * pt.d / 2;
      corners.push([u0.x * R + fx[0] * lx + fz[0] * lz, u0.y * R + fx[1] * lx + fz[1] * lz, u0.z * R + fx[2] * lx + fz[2] * lz]);
    }
    const up = Eb.up;
    const at = (c, y) => ({ x: c[0] + up[0] * y, y: c[1] + up[1] * y, z: c[2] + up[2] * y });
    const lo = corners.map((c) => proj(at(c, b.g - 1))), hi = corners.map((c) => proj(at(c, b.g + pt.h)));
    if (lo.some((q) => !q) || hi.some((q) => !q)) continue;
    const dist = lo[0][2];
    if (dist > DIST + 2000) continue;
    const faces = [];
    const nrm = [fz.map((v) => -v), fx, fz, fx.map((v) => -v)];   // edges 0-1 (back), 1-2 (right), 2-3 (front), 3-0 (left)
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      const n = nrm[k];
      const mid = [(corners[k][0] + corners[k1][0]) / 2 - C.x, (corners[k][1] + corners[k1][1]) / 2 - C.y, (corners[k][2] + corners[k1][2]) / 2 - C.z];
      if (mid[0] * n[0] + mid[1] * n[1] + mid[2] * n[2] > 0) continue;   // back face
      const lit = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
      faces.push({ pts: [lo[k], lo[k1], hi[k1], hi[k]], shade: 0.55 + 0.45 * lit });
    }
    faces.push({ pts: hi, shade: 0.95 });
    items.push({ dist, faces, b });
  }
}
items.sort((a, c) => c.dist - a.dist);
for (const it of items) {
  const haze = Math.min(0.75, it.dist / 30000);
  const base = it.b.use === 'office' || it.b.use === 'civic_tower' ? [0.62, 0.68, 0.76] : it.b.use === 'residential_tower' ? [0.80, 0.80, 0.82] : [0.86, 0.84, 0.80];
  for (const f of it.faces) {
    const c = base.map((v, i) => {
      const lin = v * f.shade * 0.85;
      const s = lin2srgb(lin) * 255;
      return Math.round(s * (1 - haze) + sky[i] * haze);
    });
    cv.poly(f.pts.map((q) => [q[0], q[1]]), c);
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await cv.save(OUT);

// ---- statistics (G01 harbour city) ----
const inView = boxes.filter((b) => b.centre);
const by = {};
for (const b of inView) {
  const k = b.centre; (by[k] = by[k] || []).push(b);
}
const stat = {};
for (const [k, list] of Object.entries(by)) {
  const fl = list.map((b) => b.floors).sort((a, c) => c - a);
  stat[k] = { n: list.length, max: fl[0], p90: fl[Math.floor(fl.length * 0.1)], median: fl[Math.floor(fl.length / 2)], over20: fl.filter((f) => f > 20).length, over35: fl.filter((f) => f > 35).length };
}
const front = inView.filter((b) => b.ds < 250);
const fr = front.map((b) => b.floors).sort((a, c) => c - a);
const top = [...boxes].sort((a, c) => c.floors - a.floors).slice(0, 15).map((b) => `${b.id} ${b.use} ${b.floors}F ${Math.round(b.hgt)}m ${b.centre} ds=${Math.round(b.ds)}`);
const res = { pose: [lat, lon, alt, hdg, pitch, lens], tiles: tiles.size, buildings: nb, msGen: tGen, centres: stat, frontRow: { n: fr.length, max: fr[0], median: fr[Math.floor(fr.length / 2)] }, top };
console.log(JSON.stringify(res, null, 1));
const J = arg('json', null);
if (J) fs.writeFileSync(J, JSON.stringify({ ...res, boxes: boxes.map((b) => ({ id: b.id, use: b.use, floors: b.floors, h: Math.round(b.hgt), lat: b.lat, lon: b.lon, c: b.centre, ds: Math.round(b.ds), U: Math.round(b.U), V: Math.round(b.V) })) }));

// optional plan map of storeys (G01 frame)
const MAP = arg('map', null);
if (MAP) {
  const M = new Canvas(900, 700, [20, 24, 30]);
  const u0 = -10000, u1 = 10000, v0 = -15000, v1 = 500;
  const sx = (u) => (u - u0) / (u1 - u0) * 900, sy = (v) => (v - v0) / (v1 - v0) * 700;
  for (const b of boxes) {
    if (!b.w) continue;
    const t = Math.min(1, b.floors / 80);
    const c = t < 0.1 ? [90, 90, 96] : t < 0.15 ? [60, 140, 220] : t < 0.35 ? [70, 200, 120] : t < 0.55 ? [240, 210, 60] : t < 0.75 ? [250, 130, 40] : [250, 40, 60];
    M.disc(sx(b.U), sy(b.V), b.floors > 20 ? 2.2 : 1.2, c);
  }
  await M.save(MAP);
}
