#!/usr/bin/env node
// Combine PNGs into one grid image for review.
//   node scripts/preview-urban-montage.mjs out.png cols cellPx a.png b.png ...
import fs from 'fs';
import { PNG } from 'pngjs';

const [out, colsS, cellS, ...files] = process.argv.slice(2);
const cols = +colsS || 3, cell = +cellS || 400;
const rows = Math.ceil(files.length / cols);
const W = cols * cell + (cols + 1) * 4, H = rows * cell + (rows + 1) * 4;
const dst = new PNG({ width: W, height: H });
dst.data.fill(30);
for (let i = 0; i < dst.data.length; i += 4) dst.data[i + 3] = 255;
files.forEach((f, k) => {
  if (!fs.existsSync(f)) return;
  const src = PNG.sync.read(fs.readFileSync(f));
  const ox = 4 + (k % cols) * (cell + 4), oy = 4 + Math.floor(k / cols) * (cell + 4);
  const sc = Math.max(src.width, src.height) / cell;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const sx = Math.floor(x * sc), sy = Math.floor(y * sc);
    if (sx >= src.width || sy >= src.height) continue;
    const si = (sy * src.width + sx) * 4, di = ((oy + y) * W + ox + x) * 4;
    dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
  }
});
fs.writeFileSync(out, PNG.sync.write(dst));
console.log(`montage ${out} ${W}x${H} (${files.length} images)`);
