// Load the control maps for Node-side scripts (previews, benchmarks, data checks).
//   import { initWorldNode } from './node-world.mjs'; await initWorldNode();
// After this, every src/world/* module can be imported and evaluated exactly as in workers.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { installControlMaps } from '../src/data/controlMaps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export function initWorldNode() {
  const dir = path.resolve(here, '../public/data');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const payload = {};
  for (const [k, m] of Object.entries(manifest)) payload[k] = { width: m.width, height: m.height, data: new Uint8Array(fs.readFileSync(path.join(dir, m.file))) };
  installControlMaps(payload);
  return payload;
}

/** Write an RGB(A) float/byte buffer to PNG. pixels: Uint8Array(w*h*4) */
export async function writePng(file, w, h, pixels) {
  const { PNG } = await import('pngjs');
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}
