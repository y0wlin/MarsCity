// Converts the control PNGs in ../参考图/03-control into raw Uint8 grayscale .bin files
// (row-major, top row = 90°N, left column = 180°W) plus a manifest. Raw bytes avoid any
// browser colour management / premultiplication when the data is read back.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

// in-repo copy (data-src/03-control) so a clean clone can regenerate the data; falls back to the brief's folder
const SRC = fs.existsSync(path.resolve('data-src/03-control/zone-O.png')) ? path.resolve('data-src/03-control') : path.resolve('../参考图/03-control');
const OUT = path.resolve('public/data');
fs.mkdirSync(OUT, { recursive: true });

const maps = {
  zone: 'zone-O.png',
  province: 'province-ID.png',
  water: 'water.png',
  density: 'built-density.png',
  emission: 'emission.png',
};
const manifest = {};
for (const [key, file] of Object.entries(maps)) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SRC, file)));
  const { width, height, data } = png;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = data[i * 4];
  fs.writeFileSync(path.join(OUT, `${key}.bin`), out);
  manifest[key] = { file: `${key}.bin`, width, height, source: file };
  console.log(key, width, height);
}
// precomputed terrain grids (terrain-fn): the coast distance grid (EDT + blurs, 0.5-2 s CPU per thread
// otherwise). world/terrain/maps.js verifies the key and falls back to computing it when stale.
{
  const { installControlMaps } = await import('../src/data/controlMaps.js');
  const { serializeCoast, GW, GH } = await import('../src/world/terrain/maps.js');
  const payload = {};
  for (const [k, m] of Object.entries(manifest)) payload[k] = { width: m.width, height: m.height, data: new Uint8Array(fs.readFileSync(path.join(OUT, m.file))) };
  const maps = installControlMaps(payload);
  const { bytes, key } = serializeCoast(maps);
  fs.writeFileSync(path.join(OUT, 'coast.bin'), bytes);
  manifest.coast = { file: 'coast.bin', width: GW, height: GH, format: 'MCST header 64 B + float32 LE (signed km to the sea shore, > 0 land)', key };
  console.log('coast', GW, GH, key);
}
// precomputed O-zone canal node table (terrain-fn): activity + P / farm of every order-0 node (irrigation.js), so orbit
// tiles do not build the canal network lazily. Validated at load (stale -> computed live). Re-run after terrain changes.
{
  const { serializeCanalNodes } = await import('../src/world/terrain/irrigation.js');
  const t0 = Date.now();
  const { bytes, count } = serializeCanalNodes();
  fs.writeFileSync(path.join(OUT, 'canalnodes.bin'), bytes);
  manifest.canalNodes = { file: 'canalnodes.bin', width: 0, height: 0, format: 'MCNT header 64 B + node bitset (6*N0*N0) + float64 [P, farm] per active node', count };
  console.log('canalNodes', count, 'active nodes', bytes.length, 'bytes', Date.now() - t0, 'ms');
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
