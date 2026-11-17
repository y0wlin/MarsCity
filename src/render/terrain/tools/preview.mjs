// Node preview of terrain tiles (run from web/):
//   node src/render/terrain/tools/preview.mjs --lat 22 --lon 118 --level 6 --tex 256 [--grid 3] [--out shots/terrain-render/tiles]
// Writes albedo / normal / emission / ao PNGs of the tile(s) containing (lat, lon) and prints timings.
import { initWorldNode, writePng } from '../../../../scripts/node-world.mjs';
import { latLonToUnit, tileAt } from '../../../core/geo.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
initWorldNode();
const { buildTerrainTile, ensureTileBuilder, tileBuilderInfo } = await import('../tileBuilder.js');
await ensureTileBuilder();
console.log('modules', JSON.stringify(tileBuilderInfo()));
const lat = +opt('lat', 22), lon = +opt('lon', 118), level = +opt('level', 6), T = +opt('tex', 256);
const out = opt('out', 'shots/terrain-render/tiles');
const grid = +opt('grid', 1);
const u = latLonToUnit(lat, lon);
const t = tileAt(u.x, u.y, u.z, level);
const tiles = [];
const half = Math.floor((grid - 1) / 2);
for (let dy = -half; dy < grid - half; dy++) for (let dx = -half; dx < grid - half; dx++) tiles.push({ face: t.face, level, x: t.x + dx, y: t.y + dy });
const W = T * grid, H = T * grid;
const big = { albedo: new Uint8Array(W * H * 4), normal: new Uint8Array(W * H * 4), emission: new Uint8Array(W * H * 4), ao: new Uint8Array(W * H * 4) };
for (let ti = 0; ti < tiles.length; ti++) {
  const tt = tiles[ti];
  const t0 = performance.now();
  const { result } = buildTerrainTile({ ...tt, texRes: T });
  const ms = performance.now() - t0;
  console.log(`${tt.face}/${tt.level}/${tt.x}/${tt.y} T=${T} ${ms.toFixed(0)} ms  h[${result.minH.toFixed(0)},${result.maxH.toFixed(0)}] err ${result.geomErr.toFixed(2)} m urban=${result.anyUrban} water=${!!result.water} light=${!!result.emission}`, JSON.stringify(result.stats, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  const gx = ti % grid, gy = (ti / grid) | 0;
  for (const key of ['albedo', 'normal', 'emission', 'ao']) {
    const src = key === 'ao' ? result.albedo : result[key]; if (!src) continue;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      // flip so north (b1) is up in the PNG (face-dependent, good enough for previews)
      const s = (y * T + x) * 4; const dy2 = (grid - 1 - gy) * T + (T - 1 - y), dx2 = gx * T + x;
      const d = (dy2 * W + dx2) * 4;
      if (key === 'ao') { big.ao[d] = big.ao[d + 1] = big.ao[d + 2] = src[s + 3]; big.ao[d + 3] = 255; continue; }
      big[key][d] = src[s]; big[key][d + 1] = src[s + 1]; big[key][d + 2] = src[s + 2]; big[key][d + 3] = 255;
    }
  }
}
const tag = `${lat}_${lon}_L${level}`;
for (const key of ['albedo', 'normal', 'emission', 'ao']) await writePng(`${out}/${tag}_${key}.png`, W, H, big[key]);
console.log('wrote', `${out}/${tag}_*.png`);
