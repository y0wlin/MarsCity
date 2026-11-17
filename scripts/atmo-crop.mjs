#!/usr/bin/env node
// Crop + nearest-neighbour zoom of a PNG (atmosphere agent's inspection helper).
//   node scripts/atmo-crop.mjs in.png x y w h zoom out.png
// Also prints the mean sRGB colour of the crop.
import fs from 'fs';
import { PNG } from 'pngjs';
const [inp, xs, ys, ws, hs, zs, out] = process.argv.slice(2);
const x0 = +xs, y0 = +ys, w = +ws, h = +hs, z = +(zs || 1);
const src = PNG.sync.read(fs.readFileSync(inp));
const dst = new PNG({ width: w * z, height: h * z });
let r = 0, g = 0, b = 0, n = 0;
for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) {
  const sx = Math.min(src.width - 1, x0 + Math.floor(x / z)), sy = Math.min(src.height - 1, y0 + Math.floor(y / z));
  const si = (sy * src.width + sx) * 4, di = (y * w * z + x) * 4;
  for (let k = 0; k < 4; k++) dst.data[di + k] = src.data[si + k];
  if (x % z === 0 && y % z === 0) { r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; n++; }
}
if (out) fs.writeFileSync(out, PNG.sync.write(dst));
console.log(JSON.stringify({ mean: [r / n, g / n, b / n].map((v) => +v.toFixed(1)) }));
