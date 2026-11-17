// Contract check of the per-tile water data (ARCHITECTURE.md §8 "Tile water data"), run from web/:
//   node src/render/terrain/tools/check-water.mjs [--tiles "4,120,9,128;22,118,12,128"]
// Builds the tiles containing each (lat, lon, level, texRes) in Node exactly like the workers do and
// validates array types / lengths / value ranges / flags against the documented layout.
// OWNER: terrain-render agent.
import { initWorldNode } from '../../../../scripts/node-world.mjs';
import { latLonToUnit, tileAt } from '../../../core/geo.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
initWorldNode();
const { buildTerrainTile, ensureTileBuilder } = await import('../tileBuilder.js');
await ensureTileBuilder();
const cases = opt('tiles', '4,120,9,128;22,118,12,128;8,105,11,128').split(';').map((s) => s.split(',').map(Number));
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL', msg); } };
for (const [lat, lon, level, T] of cases) {
  const u = latLonToUnit(lat, lon), t = tileAt(u.x, u.y, u.z, level);
  const t0 = performance.now();
  const { result: r, transfer } = buildTerrainTile({ face: t.face, level, x: t.x, y: t.y, texRes: T });
  const ms = performance.now() - t0;
  const n = 65, G = n * n, W = r.water;
  console.log(`${t.face}/${level}/${t.x}/${t.y} T${T} (${lat},${lon}) ${ms.toFixed(0)} ms water=${!!W}`);
  check(r.heights instanceof Float32Array && r.heights.length === G, 'heights Float32Array(n*n)');
  if (!W) continue;
  check(W.n === n, 'water.n === 65');
  check(W.type instanceof Uint8Array && W.type.length === G, 'type Uint8Array(n*n)');
  for (const k of ['level', 'depth', 'dist', 'width']) check(W[k] instanceof Float32Array && W[k].length === G, `${k} Float32Array(n*n)`);
  check(W.flow instanceof Float32Array && W.flow.length === G * 2, 'flow Float32Array(n*n*2)');
  check(W.mask === null || (W.mask instanceof Uint8Array && W.mask.length === T * T && W.maskRes === T), 'mask Uint8Array(T*T)|null, maskRes = T');
  let sea = false, canal = false, lake = false, minL = Infinity, maxL = -Infinity, badDepth = 0, badLevel = 0, dryPos = 0, wet = 0;
  // shoreline-dilated vertices (3 passes of 4-neighbour growth = Manhattan distance ≤ 3 from a water
  // vertex) carry the neighbouring level and may have depth > 0; only the other dry vertices must not
  const near = new Uint8Array(G);
  for (let o = 0; o < G; o++) {
    if (!W.type[o]) continue;
    const i0 = o % n, j0 = (o / n) | 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      if (Math.abs(di) + Math.abs(dj) > 3) continue;
      const i = i0 + di, j = j0 + dj;
      if (i >= 0 && i < n && j >= 0 && j < n) near[j * n + i] = 1;
    }
  }
  for (let o = 0; o < G; o++) {
    const ty = W.type[o];
    check(ty <= 3, 'type ∈ 0..3');
    if (ty === 1) sea = true; else if (ty === 2) canal = true; else if (ty === 3) lake = true;
    if (ty) {
      wet++;
      minL = Math.min(minL, W.level[o]); maxL = Math.max(maxL, W.level[o]);
      if (Math.abs(W.depth[o] - (W.level[o] - r.heights[o])) > 1e-2) badDepth++;
      if (ty === 1 && Math.abs(W.level[o]) > 1e-6) badLevel++;
    } else if (!near[o] && W.depth[o] > 1e-6) dryPos++;
    else if (!ty && near[o] && Math.abs(W.depth[o] - (W.level[o] - r.heights[o])) > 1e-2) badDepth++;
    const fx = W.flow[o * 2], fy = W.flow[o * 2 + 1];
    const fl = Math.hypot(fx, fy);
    check(fl < 1e-6 || Math.abs(fl - 1) < 0.05, 'flow is unit or zero');
    check(W.dist[o] <= 1e9 && W.dist[o] >= 0, 'dist ∈ [0, 1e9]');
  }
  check(sea === W.hasSea && canal === W.hasCanal && lake === W.hasLake, 'hasSea/hasCanal/hasLake flags');
  if (wet) check(Math.abs(minL - W.minLevel) < 1e-3 && Math.abs(maxL - W.maxLevel) < 1e-3, 'minLevel / maxLevel');
  check(badDepth === 0, `depth = level − ground on water vertices (${badDepth} bad)`);
  check(badLevel === 0, `sea level 0 (${badLevel} bad)`);
  check(dryPos === 0, `dry vertices away from the shoreline dilation have depth ≤ 0 (${dryPos} bad)`);
  const bufs = new Set(transfer);
  for (const k of ['type', 'level', 'depth', 'flow', 'dist', 'width']) check(bufs.has(W[k].buffer), `${k} buffer transferred`);
  if (W.mask) check(bufs.has(W.mask.buffer), 'mask buffer transferred');
  let m = 0; if (W.mask) for (let i = 0; i < W.mask.length; i++) if (W.mask[i]) m++;
  console.log(`  wet vertices ${wet}/${G}, sea=${sea} canal=${canal} lake=${lake} levels [${W.minLevel.toFixed(2)}, ${W.maxLevel.toFixed(2)}], mask texels ${m}/${T * T}`);
}
console.log(fails ? `${fails} contract violations` : 'water data contract OK');
process.exit(fails ? 1 : 0);
