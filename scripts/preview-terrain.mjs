#!/usr/bin/env node
// Terrain previews for the terrain-fn world modules (fields / terrain / hydro / sites).
// OWNER: terrain-fn agent. Run from web/:
//   node scripts/preview-terrain.mjs global [--w 2048]                 equirect: hypsometric tint + hillshade + materials
//   node scripts/preview-terrain.mjs globe [--size 1024] [--lat 15]    orthographic globes centred on 0, 90E, 180, 90W
//   node scripts/preview-terrain.mjs zoom --lat L --lon L --name N [--ext 2000,200,20,2,0.2,0.02] [--size 512] [--head deg]
//   node scripts/preview-terrain.mjs zooms [--only ZR1,OX5] [--ext ...]   predefined targets x extents (+ contact sheets)
// Options: --out <dir> (default shots/terrain-fn), --tag <prefix>, --exag <hillshade exaggeration>, --sun <az,el>
// Output PNGs; zoom series also write a contact sheet per target (<tag>sheet_<name>.png, extents left->right).
import { Worker, isMainThread, parentPort } from 'worker_threads';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const TARGETS = [
  ['ZR1', 22.0, 118.0], ['ZR2', 34.4, -104.4], ['ZR3', 22.0, -15.0], ['ZR4', 8.3, 165.0], ['ZR5', -42.0, 103.0], ['ZR6', -64.6, -105.0],
  ['OX1', 4.5, 104.0], ['OX2', -8.0, -105.5], ['OX3', 22.0, -133.5], ['OX4', 73.6, 45.0], ['OX5', -28.0, -45.0], ['OX6', -65.0, -165.0],
  ['G01', 0.5619, 129.9419], ['G02', -27.95, -44.9],
  ['RIDGEPASS', 21.6, 112.1], ['RIFT', 16.9, 126.1], ['CANYONWALL', 34.8155, -105.0167], ['OX2GORGE', -8.0, -106.2], ['VOLCANO', 32.0, -158.0], ['HIGHLAND', 36.5, 150.0],
];

if (isMainThread) {
  const args = process.argv.slice(2);
  const mode = args[0] || 'global';
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const OUT = path.resolve(process.cwd(), opt('out', 'shots/terrain-fn'));
  const tag = opt('tag', '');
  fs.mkdirSync(OUT, { recursive: true });
  const nW = Math.max(2, Math.min(+opt('workers', 8), os.cpus().length - 1));
  const sun = (opt('sun', '315,35')).split(',').map(Number);
  const jobs = [];
  if (mode === 'global') {
    const W = +opt('w', 2048), H = W / 2;
    jobs.push({ kind: 'equirect', W, H, out: path.join(OUT, `${tag}global_${W}.png`), exag: +opt('exag', 8), sun });
  } else if (mode === 'globe') {
    const S = +opt('size', 1024);
    const lons = (opt('lons', '0,90,180,-90')).split(',').map(Number);
    for (const lon of lons) jobs.push({ kind: 'globe', W: S, H: S, lat0: +opt('lat', 15), lon0: lon, out: path.join(OUT, `${tag}globe_${lon < 0 ? 'W' + (-lon) : 'E' + lon}.png`), exag: +opt('exag', 6), sun });
  } else if (mode === 'zoom' || mode === 'zooms') {
    const S = +opt('size', 512);
    const exts = (opt('ext', '2000,200,20,2,0.2,0.02')).split(',').map(Number);
    let targets = TARGETS;
    if (mode === 'zoom') targets = [[opt('name', 'Z'), +opt('lat', 0), +opt('lon', 0)]];
    const only = opt('only', null);
    if (only) targets = targets.filter((t) => only.split(',').includes(t[0]));
    for (const [name, lat, lon] of targets) {
      const sheet = [];
      for (const e of exts) {
        const file = path.join(OUT, `${tag}zoom_${name}_${e >= 1 ? e + 'km' : Math.round(e * 1000) + 'm'}.png`);
        jobs.push({ kind: 'zoom', W: S, H: S, lat0: lat, lon0: lon, extKm: e, head: +opt('head', 0), out: file, exag: +opt('exag', e > 500 ? 4 : 2), sun });
        sheet.push(file);
      }
      if (sheet.length > 1) jobs.push({ kind: 'sheet', files: sheet, out: path.join(OUT, `${tag}sheet_${name}.png`), S });
    }
  }
  const { writePng } = await import('./node-world.mjs');
  const { PNG } = await import('pngjs');
  const t0 = Date.now();
  const pool = [];
  for (let i = 0; i < nW; i++) pool.push(new Worker(fileURLToPath(import.meta.url)));
  for (const job of jobs) {
    if (job.kind === 'sheet') {
      const cols = job.files.length, S = job.S, W = cols * S + (cols - 1) * 4;
      const img = new Uint8Array(W * S * 4);
      img.fill(255);
      job.files.forEach((f, k) => {
        const p = PNG.sync.read(fs.readFileSync(f));
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const s = (y * p.width + x) * 4, d = (y * W + k * (S + 4) + x) * 4;
          img[d] = p.data[s]; img[d + 1] = p.data[s + 1]; img[d + 2] = p.data[s + 2]; img[d + 3] = 255;
        }
      });
      await writePng(job.out, W, S, img);
      console.log('wrote', path.relative(process.cwd(), job.out));
      continue;
    }
    const rows = job.H;
    const img = new Uint8Array(job.W * job.H * 4);
    const chunk = Math.max(1, Math.ceil(rows / (nW * 6)));
    let next = 0, done = 0;
    await new Promise((resolve, reject) => {
      const feed = (w) => {
        if (next >= rows) return;
        const r0 = next, r1 = Math.min(rows, next + chunk); next = r1;
        w.postMessage({ job, r0, r1 });
      };
      for (const w of pool) {
        w.removeAllListeners('message'); w.removeAllListeners('error');
        w.on('message', (m) => {
          img.set(new Uint8Array(m.px), m.r0 * job.W * 4);
          done += m.r1 - m.r0;
          if (done >= rows) resolve(); else feed(w);
        });
        w.on('error', reject);
        feed(w);
      }
    });
    await writePng(job.out, job.W, job.H, img);
    console.log('wrote', path.relative(process.cwd(), job.out), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  for (const w of pool) w.terminate();
} else {
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  // TERRAIN_MOD=../src/world/terrain/core.js previews the development core directly
  const T = await import(process.env.TERRAIN_MOD || '../src/world/terrain.js');
  const sampleTerrain = T.sampleTerrain || T.sampleCore;
  const R = 3389500, DEG = Math.PI / 180;
  // LAYER=mount|rough|oBasin|urban|farmBase|ridge|... colours by a field of the core (debug)
  const LAYER = process.env.LAYER || '';
  let LASTF = null;
  if (LAYER) { const core = await import('../src/world/terrain/core.js'); LASTF = core.LAST; }
  const S = {};

  // one sampleTerrain per pixel (+1 row/column); hillshade from the shared height grid
  function sampleColor(ux, uy, uz, mw, H, C, k) {
    sampleTerrain(ux, uy, uz, mw, S);
    const h = S.h; H[k] = h;
    let r, g, b, sea = 0;
    if (S.coast < 0 && S.seafloor > 0.5) {
      const d = -h;
      const t1 = Math.min(1, d / 70), t2 = Math.min(1, Math.max(0, (d - 70) / 2600));
      r = 52 + (20 - 52) * t1 + (8 - 20) * t2; g = 150 + (92 - 150) * t1 + (34 - 92) * t2; b = 168 + (158 - 168) * t1 + (96 - 158) * t2;
      sea = 1;
    } else {
      const st = 0.86 + 0.28 * (S.strata - 0.5);
      const urban = S.mat === 7;
      const farm = S.mat === 6 || (S.soil > 0.3 && !urban);
      const soilR = urban ? 206 : farm ? 86 : 120, soilG = urban ? 204 : farm ? 118 : 96, soilB = urban ? 198 : farm ? 58 : 70;
      r = S.rock * 168 * st + S.sand * 200 + S.basalt * 74 + S.soil * soilR + S.ice * 236 + S.beach * 216;
      g = S.rock * 80 * st + S.sand * 132 + S.basalt * 62 + S.soil * soilG + S.ice * 241 + S.beach * 192;
      b = S.rock * 50 * st + S.sand * 84 + S.basalt * 58 + S.soil * soilB + S.ice * 246 + S.beach * 150;
      const fr = S.frost * 0.75;
      r += (224 - r) * fr; g += (229 - g) * fr; b += (236 - b) * fr;
      if (S.park > 0.3) { r = r * 0.55 + 30; g = g * 0.55 + 56; b = b * 0.55 + 26; }
      if (S.waterline > 0.3) { r = r * 0.5 + 118; g = g * 0.5 + 110; b = b * 0.5 + 98; }
      if (S.water >= 2) { r = 32; g = 98; b = 150; sea = 2; }
      const hyp = 0.88 + 0.12 * Math.min(1, Math.max(0, h / 5000));
      r *= hyp; g *= hyp; b *= hyp;
    }
    if (LAYER && LASTF && S.coast >= 0) {
      const v = Math.max(0, Math.min(1, +LASTF[LAYER] || 0));
      r = 40 + 215 * v; g = 60 + 120 * (1 - Math.abs(v - 0.5) * 2); b = 200 * (1 - v) + 30;
    }
    C[4 * k] = r; C[4 * k + 1] = g; C[4 * k + 2] = b; C[4 * k + 3] = sea;
  }
  function shadePx(px, o, C, k, gx, gy, sunV) {
    const nl = Math.hypot(gx, gy, 1);
    const d = Math.max(0, (-gx * sunV[0] - gy * sunV[1] + sunV[2]) / nl);
    const sea = C[4 * k + 3];
    const sh = sea === 1 ? 0.8 + 0.2 * d / sunV[2] : sea === 2 ? 0.9 + 0.1 * d : (0.28 + 0.78 * d / sunV[2] * 0.92);
    px[o] = Math.min(255, Math.max(0, C[4 * k] * sh)); px[o + 1] = Math.min(255, Math.max(0, C[4 * k + 1] * sh)); px[o + 2] = Math.min(255, Math.max(0, C[4 * k + 2] * sh)); px[o + 3] = 255;
  }

  parentPort.on('message', (m) => {
    const { job, r0, r1 } = m;
    const W = job.W, W1 = W + 1, rows = r1 - r0 + 1;
    const az = job.sun[0] * DEG, el = job.sun[1] * DEG;
    const sunV = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const H = new Float64Array(W1 * rows).fill(NaN), C = new Float64Array(4 * W1 * rows);
    const px = new Uint8Array((r1 - r0) * W * 4);
    if (job.kind === 'equirect') {
      const stepM = (Math.PI * R) / job.H;
      for (let j = r0; j <= r1; j++) {
        const lat = 90 - ((Math.min(j, job.H - 1) + 0.5) * 180) / job.H;
        for (let i = 0; i <= W; i++) {
          const lon = -180 + ((i + 0.5) * 360) / W;
          const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
          sampleColor(c * Math.sin(lo), Math.sin(la), c * Math.cos(lo), stepM * 0.5, H, C, (j - r0) * W1 + i);
        }
      }
      for (let j = r0; j < r1; j++) {
        const lat = 90 - ((j + 0.5) * 180) / job.H;
        const sx = stepM * Math.max(0.05, Math.cos(lat * DEG));
        for (let i = 0; i < W; i++) {
          const k = (j - r0) * W1 + i, h = H[k];
          shadePx(px, ((j - r0) * W + i) * 4, C, k, ((H[k + 1] - h) / sx) * job.exag, ((h - H[k + W1]) / stepM) * job.exag, sunV);
        }
      }
    } else if (job.kind === 'globe' || job.kind === 'zoom') {
      const la0 = job.lat0 * DEG, lo0 = job.lon0 * DEG;
      const c0 = [Math.cos(la0) * Math.sin(lo0), Math.sin(la0), Math.cos(la0) * Math.cos(lo0)];
      const E = [Math.cos(lo0), 0, -Math.sin(lo0)], N = [-Math.sin(la0) * Math.sin(lo0), Math.cos(la0), -Math.sin(la0) * Math.cos(lo0)];
      let stepM;
      const inside = new Uint8Array(W1 * rows);
      if (job.kind === 'globe') {
        const rad = W * 0.46; stepM = R / rad;
        for (let j = r0; j <= r1; j++) for (let i = 0; i <= W; i++) {
          const sx = (i + 0.5 - W / 2) / rad, sy = (job.H / 2 - j - 0.5) / rad, r2 = sx * sx + sy * sy;
          if (r2 >= 1) continue;
          const sz = Math.sqrt(1 - r2);
          const k = (j - r0) * W1 + i; inside[k] = 1;
          sampleColor(E[0] * sx + N[0] * sy + c0[0] * sz, E[1] * sx + N[1] * sy + c0[1] * sz, E[2] * sx + N[2] * sy + c0[2] * sz, stepM * 0.5 / Math.max(0.25, sz), H, C, k);
        }
      } else {
        const hd = (job.head || 0) * DEG;
        stepM = (job.extKm * 1000) / W;
        for (let j = r0; j <= r1; j++) for (let i = 0; i <= W; i++) {
          const e0 = (i + 0.5 - W / 2) * stepM, n0 = (job.H / 2 - j - 0.5) * stepM;
          const e = e0 * Math.cos(hd) - n0 * Math.sin(hd), n = e0 * Math.sin(hd) + n0 * Math.cos(hd);
          let ux = c0[0] + (E[0] * e + N[0] * n) / R, uy = c0[1] + (N[1] * n) / R, uz = c0[2] + (E[2] * e + N[2] * n) / R;
          const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
          const k = (j - r0) * W1 + i; inside[k] = 1;
          sampleColor(ux, uy, uz, stepM * 0.5, H, C, k);
        }
      }
      for (let j = r0; j < r1; j++) for (let i = 0; i < W; i++) {
        const k = (j - r0) * W1 + i, o = ((j - r0) * W + i) * 4;
        if (!inside[k]) { px[o] = 6; px[o + 1] = 8; px[o + 2] = 12; px[o + 3] = 255; continue; }
        const h = H[k];
        const hE = inside[k + 1] ? H[k + 1] : h, hS = inside[k + W1] ? H[k + W1] : h;
        shadePx(px, o, C, k, ((hE - h) / stepM) * job.exag, ((h - hS) / stepM) * job.exag, sunV);
        if (job.kind === 'globe') {
          const sx = (i + 0.5 - W / 2) / (W * 0.46), sy = (job.H / 2 - j - 0.5) / (W * 0.46);
          const ld = 0.55 + 0.45 * Math.pow(Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)), 0.4);
          px[o] *= ld; px[o + 1] *= ld; px[o + 2] *= ld;
        }
      }
    }
    parentPort.postMessage({ r0, r1, px: px.buffer }, [px.buffer]);
  });
}
