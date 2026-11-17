#!/usr/bin/env node
// Farmland edge preview (urban fix round 3, U5 / QY-05): urbanSample at fine texels over a square around (lat, lon):
// fields green by crop / fallow tan, canals + lakes blue (hydro), built roofs white, red earth elsewhere.
//   node scripts/preview-urban-farmedge.mjs --at 7.235,104.87 --size 6000 --px 25 --out shots/urban/fix3-farmedge.png
import { initWorldNode } from './node-world.mjs';
import { Canvas } from './preview-urban-lib.mjs';
initWorldNode();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const [lat, lon] = arg('at', '7.235,104.87').split(',').map(Number);
const SIZE = +arg('size', 6000), PX = +arg('px', 25), N = Math.round(SIZE / PX);
const geo = await import('../src/core/geo.js');
const U = await import('../src/world/urban.js');
const H = await import('../src/world/hydro.js');
const R = 3389500, E = geo.enuBasis(lat, lon, {}), O = geo.latLonToUnit(lat, lon, {});
const cv = new Canvas(N, N, [150, 80, 50]);
const o = {}, W = {};
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const e = (i + 0.5 - N / 2) * PX, n = (N / 2 - j - 0.5) * PX, k = 1 / R;
  const q = { x: O.x + (E.east[0] * e + E.north[0] * n) * k, y: O.y + (E.east[1] * e + E.north[1] * n) * k, z: O.z + (E.east[2] * e + E.north[2] * n) * k };
  const l = Math.hypot(q.x, q.y, q.z); q.x /= l; q.y /= l; q.z /= l;
  H.waterAt(q.x, q.y, q.z, W);
  if (W.type && W.depth > 0) { cv.set(i, j, W.type === 3 ? [30, 70, 130] : [50, 120, 190]); continue; }
  U.urbanSample(q.x, q.y, q.z, PX, o);
  if (o.coverage > 0.3) { cv.set(i, j, [235, 235, 230]); continue; }
  if (o.farm > 0.3) { const fallow = o.farmCrop === 4; cv.set(i, j, fallow ? [175, 150, 95] : [70 + 20 * (o.farmCrop % 3), 130 + 12 * (o.farmCrop % 4), 60]); continue; }
  if (o.road > 0.3) { cv.set(i, j, [200, 190, 170]); continue; }
}
await cv.save(arg('out', 'shots/urban/fix3-farmedge.png'));
console.log('ok', N, 'px');
