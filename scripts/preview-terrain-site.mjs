#!/usr/bin/env node
// Site-scale terrain previews (Node, worker threads). OWNER: terrain-fn agent. Run from web/:
//   node scripts/preview-terrain-site.mjs map --site G01|G02 [--cx m --cz m] [--ext m] [--size px] [--mw m]
//        [--sun az,el] [--layer mat|h|strata|cliff] [--out file] [--workers 2]
//     north-up hillshade map in the site's local tangent frame (x east, z south), coloured by material / water
//   node scripts/preview-terrain-site.mjs ray --pose lat,lon,alt,heading,pitch[,lens] [--w 480 --h 270]
//        [--sun az,el] [--far m] [--out file] [--workers 2]
//     terrain-only perspective ray cast from a camera pose (alt = m a.s.l.), Lambert shading + materials + water
// The sun is given as compass azimuth / elevation (deg) of the direction TO the sun.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;
const R = 3389500;

const MATC = [
  [70, 96, 128],    // SEAFLOOR (dry view: not used for water)
  [214, 196, 160],  // BEACH
  [196, 150, 104],  // SAND
  [168, 84, 54],    // ROCK_RED
  [92, 74, 70],     // BASALT
  [150, 120, 92],   // SOIL
  [96, 140, 70],    // FARM
  [150, 150, 150],  // URBAN
  [236, 242, 250],  // ICE
  [210, 214, 222],  // FROST
];

if (isMainThread) {
  const args = process.argv.slice(2);
  const mode = args[0] || 'map';
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const nW = Math.max(1, Math.min(4, +opt('workers', 2)));
  const sun = opt('sun', '290,14').split(',').map(Number);
  let job;
  if (mode === 'map') {
    const S = +opt('size', 600);
    job = { mode, site: opt('site', 'G02'), cx: +opt('cx', 0), cz: +opt('cz', 0), ext: +opt('ext', 4000), S, W: S, H: S, mw: +opt('mw', 0), sun, layer: opt('layer', 'mat') };
  } else {
    const p = opt('pose', '').split(',').map(Number);
    job = { mode, pose: { lat: p[0], lon: p[1], alt: p[2], heading: p[3], pitch: p[4], lens: p[5] || 35 }, W: +opt('w', 480), H: +opt('h', 270), sun, far: +opt('far', 60000) };
  }
  const out = path.resolve(process.cwd(), opt('out', `shots/terrain-fn/site-${mode}.png`));
  const rows = new Array(job.H);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((resolve, reject) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { ...job, w, nW } });
    wk.on('message', (m) => { if (m.row !== undefined) rows[m.row] = m.px; else if (m.done) resolve(); });
    wk.on('error', reject);
  })));
  const img = new Uint8Array(job.W * job.H * 4);
  for (let j = 0; j < job.H; j++) img.set(rows[j], j * job.W * 4);
  const { writePng } = await import('./node-world.mjs');
  await writePng(out, job.W, job.H, img);
  console.log(`${out} ${job.W}x${job.H} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} else {
  const J = workerData;
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  const T = await import('../src/world/terrain/index.js');
  const { SITES, localToUnit } = await import('../src/world/sites.js');
  const { newFields } = await import('../src/world/terrain/field.js');
  const { newMat } = await import('../src/world/terrain/relief.js');
  const F = newFields(), M = newMat(), ST = {};
  const sunE = Math.sin(J.sun[0] * DEG) * Math.cos(J.sun[1] * DEG), sunU = Math.sin(J.sun[1] * DEG), sunN = Math.cos(J.sun[0] * DEG) * Math.cos(J.sun[1] * DEG);
  const shade = (nE, nU, nN) => { const l = Math.hypot(nE, nU, nN); const d = (nE * sunE + nU * sunU + nN * sunN) / l; return 0.18 + 0.82 * Math.max(0, d); };
  if (J.mode === 'map') {
    const site = J.site === 'G01' ? SITES.tidalBarrier : SITES.waterStairs;
    const px = J.ext / J.S;
    const U = {};
    const hAt = (x, z) => { localToUnit(site, x, z, U); return T.heightCore(U.x, U.y, U.z, J.mw); };
    for (let j = J.w; j < J.H; j += J.nW) {
      const row = new Uint8Array(J.W * 4);
      const z = J.cz + (j - J.S / 2 + 0.5) * px;
      for (let i = 0; i < J.W; i++) {
        const x = J.cx + (i - J.S / 2 + 0.5) * px;
        localToUnit(site, x, z, U);
        T.sampleCore(U.x, U.y, U.z, J.mw, ST);
        const W = T.WATER_INFO;
        const h = ST.h;
        const e = 0.5 * px;
        const dhx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e), dhz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
        const sh = shade(-dhx, 1, dhz);   // z is south: d/dnorth = -d/dz
        let c;
        if (J.layer === 'h') { const t = Math.max(0, Math.min(1, (h + 50) / 1000)); c = [60 + 190 * t, 90 + 120 * t, 60 + 60 * t]; }
        else if (J.layer === 'strata' || J.layer === 'cliff') {
          T.heightWithFields(U.x, U.y, U.z, J.mw, F, M);
          const v = J.layer === 'strata' ? M.strataW : M.cliff;
          c = [255 * v, 80, 255 * (1 - v)];
        } else c = MATC[ST.mat] || [255, 0, 255];
        const water = W.type > 0 && W.level > h;
        let r = c[0] * sh, g = c[1] * sh, b = c[2] * sh;
        if (water) { const d = Math.min(1, (W.level - h) / 12); r = 40 + 30 * (1 - d); g = 90 + 50 * (1 - d); b = 150 + 40 * (1 - d); }
        row[i * 4] = Math.min(255, r); row[i * 4 + 1] = Math.min(255, g); row[i * 4 + 2] = Math.min(255, b); row[i * 4 + 3] = 255;
      }
      parentPort.postMessage({ row: j, px: row });
    }
  } else {
    const P = J.pose;
    const la = P.lat * DEG, lo = P.lon * DEG;
    const up = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    const east = [Math.cos(lo), 0, -Math.sin(lo)];
    const north = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
    const C = up.map((u) => u * (R + P.alt));
    const hf = Math.tan(Math.atan(18 / P.lens)), vf = hf * J.H / J.W;
    const hd = P.heading * DEG, pt = P.pitch * DEG;
    const fwd = [0, 1, 2].map((k) => Math.cos(pt) * (Math.sin(hd) * east[k] + Math.cos(hd) * north[k]) + Math.sin(pt) * up[k]);
    const right = [0, 1, 2].map((k) => Math.cos(hd) * east[k] - Math.sin(hd) * north[k]);
    const cu = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
    const pixAng = 2 * hf / J.W;
    const Q = [0, 0, 0];
    const surf = (t, d, mw) => {
      Q[0] = C[0] + d[0] * t; Q[1] = C[1] + d[1] * t; Q[2] = C[2] + d[2] * t;
      const r = Math.hypot(Q[0], Q[1], Q[2]);
      const h = T.heightWithFields(Q[0] / r, Q[1] / r, Q[2] / r, mw, F, null);
      const W = T.WATER_INFO;
      const lev = W.type > 0 ? W.level : -1e9;
      return { ray: r - R, g: Math.max(h, lev), water: lev > h, ux: Q[0] / r, uy: Q[1] / r, uz: Q[2] / r };
    };
    for (let j = J.w; j < J.H; j += J.nW) {
      const row = new Uint8Array(J.W * 4);
      for (let i = 0; i < J.W; i++) {
        const sx = ((i + 0.5) / J.W * 2 - 1) * hf, sy = (1 - (j + 0.5) / J.H * 2) * vf;
        const d = [0, 1, 2].map((k) => fwd[k] + right[k] * sx + cu[k] * sy);
        const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
        let t = 5, hit = null, prev = null;
        while (t < J.far) {
          const mw = Math.max(0.5, t * pixAng * 0.5);
          const s = surf(t, d, mw);
          const above = s.ray - s.g;
          if (above <= 0) {
            // refine between prev and t
            let a = prev ? prev.t : t * 0.9, b = t;
            for (let k = 0; k < 8; k++) { const m = 0.5 * (a + b); const q = surf(m, d, mw); if (q.ray - q.g > 0) a = m; else b = m; }
            hit = { t: b, mw };
            break;
          }
          prev = { t };
          t += Math.max(0.6, Math.min(above * 0.45, 400), t * 0.0015);
        }
        let r, g, b;
        if (!hit) { const k = Math.max(0, sy / vf); r = 150 - 60 * k; g = 180 - 40 * k; b = 220 - 10 * k; }
        else {
          const s = surf(hit.t, d, hit.mw);
          T.sampleCore(s.ux, s.uy, s.uz, hit.mw, ST);
          // normal from the local tangent frame at the hit
          const hl = Math.asin(s.uy), hlo = Math.atan2(s.ux, s.uz);
          const E = [Math.cos(hlo), 0, -Math.sin(hlo)], N = [-Math.sin(hl) * Math.sin(hlo), Math.cos(hl), -Math.sin(hl) * Math.cos(hlo)];
          const e = Math.max(0.5, hit.t * pixAng);
          const hAt = (de, dn) => { const ux = s.ux + (E[0] * de + N[0] * dn) / R, uy = s.uy + (N[1] * dn) / R, uz = s.uz + (E[2] * de + N[2] * dn) / R; const l = Math.hypot(ux, uy, uz); return T.heightCore(ux / l, uy / l, uz / l, hit.mw); };
          let sh;
          if (s.water) sh = 1;
          else { const dhe = (hAt(e, 0) - hAt(-e, 0)) / (2 * e), dhn = (hAt(0, e) - hAt(0, -e)) / (2 * e); sh = shade(-dhe, 1, -dhn); }
          const c = s.water ? [50, 110, 170] : (MATC[ST.mat] || [255, 0, 255]);
          const fog = 1 - Math.exp(-hit.t / 90000);
          r = c[0] * sh * (1 - fog) + 170 * fog; g = c[1] * sh * (1 - fog) + 185 * fog; b = c[2] * sh * (1 - fog) + 215 * fog;
        }
        row[i * 4] = Math.min(255, r); row[i * 4 + 1] = Math.min(255, g); row[i * 4 + 2] = Math.min(255, b); row[i * 4 + 3] = 255;
      }
      parentPort.postMessage({ row: j, px: row });
    }
  }
  parentPort.postMessage({ done: true });
}
