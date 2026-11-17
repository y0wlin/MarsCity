#!/usr/bin/env node
// Compare city tiles of this tree against a baseline copy of the project (urban fix rounds: "ids outside X unchanged").
//   node scripts/check-urban-diff.mjs --base <dir with src/ scripts/node-world.mjs public/> --tiles "f/x/y,f/x/y" |
//        --around lat,lon,r1,r2[,step] (L13 tiles in a ring)  [--json out.json]
// Prints per tile: identical | changed (ids added / removed / spec changed) with the district classes involved.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { initWorldNode } from './node-world.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = path.resolve(arg('base', ''));
initWorldNode();
const cur = await import('../src/world/urban.js');
const geo = await import('../src/core/geo.js');
const bw = await import(pathToFileURL(path.join(BASE, 'scripts/node-world.mjs')).href);
bw.initWorldNode();
const old = await import(pathToFileURL(path.join(BASE, 'src/world/urban.js')).href);

const tiles = [];
if (arg('tiles')) for (const t of arg('tiles').split(',')) { const [f, x, y] = t.split('/').map(Number); tiles.push({ face: f, x, y }); }
if (arg('around')) {
  const [lat, lon, r1, r2, step = 700] = arg('around').split(',').map(Number);
  const seen = new Set();
  const E = geo.enuBasis(lat, lon, {}), u0 = geo.latLonToUnit(lat, lon, {});
  for (let s = r1; s <= r2; s += step) {
    const n = Math.max(8, Math.round(2 * Math.PI * s / step));
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n, kk = s / 3389500;
      const d = [E.east[0] * Math.sin(a) + E.north[0] * Math.cos(a), E.east[1] * Math.sin(a) + E.north[1] * Math.cos(a), E.east[2] * Math.sin(a) + E.north[2] * Math.cos(a)];
      const q = { x: u0.x * Math.cos(kk) + d[0] * Math.sin(kk), y: u0.y * Math.cos(kk) + d[1] * Math.sin(kk), z: u0.z * Math.cos(kk) + d[2] * Math.sin(kk) };
      const t = geo.tileAt(q.x, q.y, q.z, 13, {}); const key = `${t.face}/${t.x}/${t.y}`;
      if (!seen.has(key)) { seen.add(key); tiles.push({ face: t.face, x: t.x, y: t.y }); }
    }
  }
}
const strip = (b) => { const c = { ...b }; delete c.version; return JSON.stringify(c); };
const res = []; let same = 0, diff = 0;
for (const t of tiles) {
  const A = old.generateCityTile(t.face, t.x, t.y, { buildingsOnly: true }), B = cur.generateCityTile(t.face, t.x, t.y, { buildingsOnly: true });
  const ma = new Map(A.buildings.map((b) => [b.id, b])), mb = new Map(B.buildings.map((b) => [b.id, b]));
  let add = 0, rem = 0, chg = 0, outOv = 0; const cls = new Set();
  const ov = (b) => cur.harbourCityAt(b.lat, b.lon).w > 0;
  for (const [id, b] of mb) { const a = ma.get(id); if (!a) { add++; cls.add(b.meta.districtClass); if (!ov(b)) outOv++; } else if (strip(a) !== strip(b)) { chg++; cls.add(b.meta.districtClass); if (!ov(b)) outOv++; } }
  for (const [id, a] of ma) if (!mb.has(id)) { rem++; cls.add(a.meta.districtClass); if (!ov(a)) outOv++; }
  const ok = !add && !rem && !chg;
  if (ok) same++; else diff++;
  res.push({ tile: `${t.face}/${t.x}/${t.y}`, n: B.buildings.length, ok, add, rem, chg, outOv, cls: [...cls], lat: B.center.lat, lon: B.center.lon });
  if (!ok) console.log(`changed ${t.face}/${t.x}/${t.y} (${B.center.lat.toFixed(4)}, ${B.center.lon.toFixed(4)}) n=${B.buildings.length} +${add} -${rem} ~${chg} outsideG01overlay=${outOv} [${[...cls].join(',')}]`);
}
console.log(`tiles ${tiles.length}: identical ${same}, changed ${diff}`);
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(res, null, 1));
