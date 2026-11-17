#!/usr/bin/env node
// Fine-scale sea connectivity check of the ZR4 晨曦群岛 island sea (straits are 0.5-3 km wide, far
// below the global connectivity grid of check-terrain.mjs). OWNER: terrain-fn agent. Run from web/:
//   node scripts/check-terrain-arch.mjs [--step 1200] [--workers 8] [--png out.png]
// Samples the coast metric (fields.c, mw = step/2) on a grid in the archipelago's tangent frame,
// flood-fills the water from the mapped deep east sea and reports every water component that is
// not connected to it (isolated lagoons at sea level).
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import os from 'os';

const R = 3389500;
if (!isMainThread) {
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  const { computeFields, newFields } = await import('../src/world/terrain/field.js');
  const { REGION_DATA } = await import('../src/world/terrain/layout.js');
  const rd = REGION_DATA.zr4Arch;
  const { j0, j1, NU, NV, step, lim } = workerData;
  const F = newFields();
  const out = new Int8Array((j1 - j0) * NU);   // 1 water, 0 land, -1 outside, 2 deep mapped sea
  for (let j = j0; j < j1; j++) {
    const v = -rd.b * lim + (j + 0.5) * step;
    for (let i = 0; i < NU; i++) {
      const u = -rd.a * lim + (i + 0.5) * step;
      const k = (j - j0) * NU + i;
      if ((u / rd.a) ** 2 + (v / rd.b) ** 2 > lim * lim) { out[k] = -1; continue; }
      let x = rd.c[0] + (rd.ax[0] * u + rd.ay[0] * v) / R, y = rd.c[1] + (rd.ax[1] * u + rd.ay[1] * v) / R, z = rd.c[2] + (rd.ax[2] * u + rd.ay[2] * v) / R;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      computeFields(x, y, z, step * 0.5, F);
      out[k] = F.c < 0 ? (F.coastKm < -120 ? 2 : 1) : 0;
    }
  }
  parentPort.postMessage(out, [out.buffer]);
} else {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const step = +opt('step', 1200), lim = +opt('lim', 0.9);
  const { REGION_DATA } = await import('../src/world/terrain/layout.js');
  const rd = REGION_DATA.zr4Arch;
  const NU = Math.ceil((2 * rd.a * lim) / step), NV = Math.ceil((2 * rd.b * lim) / step);
  const nW = Math.max(1, Math.min(+opt('workers', 8), os.cpus().length));
  const grid = new Int8Array(NU * NV);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((res, rej) => {
    const j0 = Math.floor((w * NV) / nW), j1 = Math.floor(((w + 1) * NV) / nW);
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { j0, j1, NU, NV, step, lim } });
    wk.on('message', (a) => { grid.set(new Int8Array(a), j0 * NU); res(); });
    wk.on('error', rej);
  })));
  // flood fill (8-connected: a diagonal strait still connects) from the deep mapped sea
  const lab = new Int32Array(NU * NV), stack = new Int32Array(NU * NV);
  let sp = 0;
  for (let k = 0; k < NU * NV; k++) if (grid[k] === 2) { lab[k] = 1; stack[sp++] = k; }
  const seeds = sp;
  const fill = (id) => {
    let n = 0;
    while (sp) {
      const c = stack[--sp]; n++;
      const ci = c % NU, cj = (c / NU) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= NU || jj >= NV) continue;
        const q = jj * NU + ii;
        if (grid[q] >= 1 && !lab[q]) { lab[q] = id; stack[sp++] = q; }
      }
    }
    return n;
  };
  const main = fill(1);
  let water = 0, comps = [];
  for (let k = 0; k < NU * NV; k++) {
    if (grid[k] >= 1) water++;
    if (grid[k] >= 1 && !lab[k]) {
      stack[sp++] = k; lab[k] = 2 + comps.length;
      let si = 0, sj = 0, n = 0, touchesEdge = false;
      const id = lab[k];
      // collect component (re-run fill while tracking centroid)
      const list = [];
      while (sp) {
        const c = stack[--sp]; n++; list.push(c);
        const ci = c % NU, cj = (c / NU) | 0; si += ci; sj += cj;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= NU || jj >= NV) { touchesEdge = true; continue; }
          const q = jj * NU + ii;
          if (grid[q] === -1) touchesEdge = true;
          if (grid[q] >= 1 && !lab[q]) { lab[q] = id; stack[sp++] = q; }
        }
      }
      const u = -rd.a * lim + (si / n + 0.5) * step, v = -rd.b * lim + (sj / n + 0.5) * step;
      let x = rd.c[0] + (rd.ax[0] * u + rd.ay[0] * v) / R, y = rd.c[1] + (rd.ax[1] * u + rd.ay[1] * v) / R, z = rd.c[2] + (rd.ax[2] * u + rd.ay[2] * v) / R;
      const l = Math.hypot(x, y, z);
      comps.push({ n, km2: Math.round(n * step * step / 1e6), lat: +(Math.asin(y / l) * 180 / Math.PI).toFixed(2), lon: +(Math.atan2(x, z) * 180 / Math.PI).toFixed(2), edge: touchesEdge });
    }
  }
  comps.sort((a, b) => b.n - a.n);
  const iso = comps.filter((c) => !c.edge);
  const isoArea = iso.reduce((s, c) => s + c.km2, 0);
  console.log(`ZR4 island sea @ ${step} m: grid ${NU}x${NV}, ${seeds} deep-sea seeds, water ${Math.round(water * step * step / 1e6)} km2, connected to the east sea ${Math.round(main * step * step / 1e6)} km2 (${(100 * main / Math.max(1, water)).toFixed(1)} %)`);
  console.log(`unconnected water components inside the checked area: ${iso.length} (${isoArea} km2); touching the check boundary (may connect outside): ${comps.length - iso.length}`);
  for (const c of iso.slice(0, 12)) console.log(`  ${c.km2} km2 @ (${c.lat}, ${c.lon})`);
  console.log(`time ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const png = opt('png', null);
  if (png) {
    const { writePng } = await import('./node-world.mjs');
    const img = new Uint8Array(NU * NV * 4);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const k = j * NU + i, o = ((NV - 1 - j) * NU + i) * 4; img[o + 3] = 255;
      const g = grid[k];
      if (g === -1) { img[o] = 30; img[o + 1] = 30; img[o + 2] = 30; } else if (g === 0) { img[o] = 170; img[o + 1] = 120; img[o + 2] = 90; } else if (lab[k] === 1) { img[o] = 30; img[o + 1] = 80; img[o + 2] = 170; } else { img[o] = 255; img[o + 1] = 230; img[o + 2] = 0; }
    }
    await writePng(png, NU, NV, img);
    console.log('wrote', png);
  }
}
