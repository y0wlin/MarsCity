#!/usr/bin/env node
// ZR2 canyon wall check (fix round 1): top-down urbanSample map around a point — built fabric on the
// terrace benches, bare red rock on the risers (fine slope > 0.8) — plus the 3D building count on steep
// ground. Run from web/:  node scripts/preview-urban-canyon.mjs [lat lon sizeKm px] [--out file.png]
import { initWorldNode, writePng } from './node-world.mjs';
initWorldNode();
const U = await import('../src/world/urban.js');
const { heightAt } = await import('../src/world/terrain.js');
const { latLonToUnit, enuBasisFromUnit } = await import('../src/core/geo.js');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : 'shots/urban/canyon-map.png';
const nums = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1)).map(Number);
const [lat0, lon0, km, N] = [nums[0] ?? 34.893, nums[1] ?? -105.24, nums[2] ?? 6, nums[3] ?? 300];
const R = 3389500, c = latLonToUnit(lat0, lon0, {}), E = enuBasisFromUnit(c.x, c.y, c.z, {});
const tex = km * 1000 / N, px = new Uint8Array(N * N * 4), S = {};
const H = new Float64Array((N + 1) * (N + 1));
const at = (i, j) => { const e = (i / N - 0.5) * km * 1000, n = (0.5 - j / N) * km * 1000; let x = c.x + (E.east[0] * e + E.north[0] * n) / R, y = c.y + (E.east[1] * e + E.north[1] * n) / R, z = c.z + (E.east[2] * e + E.north[2] * n) / R; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = at(i, j); H[j * (N + 1) + i] = heightAt(p.x, p.y, p.z, tex); }
let built = 0, steepBuilt = 0, steep = 0;
const enc = (v) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)));
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const p = at(i + 0.5, j + 0.5);
  U.urbanSample(p.x, p.y, p.z, tex, S);
  const h00 = H[j * (N + 1) + i], h10 = H[j * (N + 1) + i + 1], h01 = H[(j + 1) * (N + 1) + i];
  const gx = (h10 - h00) / tex, gy = (h01 - h00) / tex, sl = Math.hypot(gx, gy);
  const shade = Math.max(0.25, Math.min(1.2, 0.85 - 0.5 * (gx * 0.6 - gy * 0.8) / Math.sqrt(1 + sl * sl)));
  // terrain base: red rock on steep ground, ochre on gentle
  const rock = Math.min(1, sl / 0.8);
  let r = (0.32 + 0.12 * rock) * shade, g = (0.16 + 0.02 * rock) * shade, b = (0.09) * shade;
  if (S.water > 0.5) { r = 0.03; g = 0.08; b = 0.14; }
  const f = Math.min(1, S.fabric || 0);
  r = r * (1 - f) + (S.fabricR || 0) * f * shade; g = g * (1 - f) + (S.fabricG || 0) * f * shade; b = b * (1 - f) + (S.fabricB || 0) * f * shade;
  if (sl > 0.8) { steep++; if (f > 0.3) steepBuilt++; }
  if (f > 0.3) built++;
  const o = (j * N + i) * 4; px[o] = enc(r); px[o + 1] = enc(g); px[o + 2] = enc(b); px[o + 3] = 255;
}
await writePng(out, N, N, px);
console.log(JSON.stringify({ out, lat0, lon0, km, texel: +tex.toFixed(1), builtPct: +(100 * built / N / N).toFixed(1), steepPct: +(100 * steep / N / N).toFixed(1), steepBuiltPct: +(100 * steepBuilt / Math.max(1, steep)).toFixed(1) }));
