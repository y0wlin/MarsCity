// Quick CPU preview of the planet look (surface.js + terrain + urban + hydro), run from web/:
//   node src/render/terrain/tools/globe.mjs --lat 10 --lon 95 --size 640 --time 9 [--exag 3.2] [--out file.png]
//   node src/render/terrain/tools/globe.mjs --lat 22 --lon 118 --alt 1e6 --size 640     (perspective, nadir)
// Orthographic / nadir perspective view, per-pixel world sampling at the pixel footprint, Lambert sun +
// sky ambient × AO, footprint relief exaggeration like the GPU material, night lights on the dark
// side, simple ACES tone map. Parallel (worker_threads). OWNER: terrain-render agent.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url);
const R = 3389500;

if (isMainThread) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const job = {
    lat0: +opt('lat', 10), lon0: +opt('lon', 95), size: +opt('size', 640), time: +opt('time', 9), sub: +opt('sub', 12),
    alt: +opt('alt', 0), fov: +opt('fov', 39.6), exag: +opt('exag', 3.2), exposure: +opt('exposure', 1.0),
    night: +opt('night', 1),
  };
  const out = opt('out', `shots/terrain-render/globe_${job.lat0}_${job.lon0}${job.alt ? '_' + job.alt : ''}.png`);
  const nW = Math.max(2, Math.min(+opt('threads', os.cpus().length), 12));
  const { writePng } = await import('../../../../scripts/node-world.mjs');
  const S = job.size, img = new Uint8Array(S * S * 4);
  const rows = Array.from({ length: S }, (_, i) => i);
  let next = 0, done = 0;
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const ws = [];
    const feed = (w) => { if (next >= S) { w.postMessage(null); return; } const r0 = next; next = Math.min(S, next + 4); w.postMessage({ r0, r1: next }); };
    for (let i = 0; i < nW; i++) {
      const w = new Worker(here, { workerData: job });
      w.on('message', (m) => {
        if (m.ready) { feed(w); return; }
        img.set(new Uint8Array(m.px), m.r0 * S * 4); done += m.r1 - m.r0;
        if (done >= S) { ws.forEach((x) => x.terminate()); resolve(); } else feed(w);
      });
      w.on('error', reject);
      ws.push(w);
    }
    void rows;
  });
  await writePng(out, S, S, img);
  console.log('wrote', out, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
} else {
  const job = workerData;
  const { initWorldNode } = await import('../../../../scripts/node-world.mjs');
  initWorldNode();
  const { latLonToUnit, enuBasis } = await import('../../../core/geo.js');
  const { sampleTerrain, heightAt } = await import('../../../world/terrain.js');
  const { waterAt } = await import('../../../world/hydro.js');
  const SF = await import('../../../world/surface.js');
  await SF.initSurfaceModules();
  const urbanSample = SF.getUrbanSampler();
  const { sunDirection } = await import('../../../app/sun.js');
  const sun = {}; sunDirection(job.time, job.sub, sun);
  const S = job.size;
  const c = latLonToUnit(job.lat0, job.lon0);
  const B = enuBasis(job.lat0, job.lon0);
  const E = B.east, Nn = B.north, U = B.up;
  const camR = R + (job.alt || 0);
  const tanH = Math.tan((job.fov * Math.PI / 180) / 2);
  const T = {}, US = {}, WS = {}, O = { albedo: [0, 0, 0], emission: [0, 0, 0] };
  const ctx = { ...SF.SHADE_CTX };
  const srgb = (x) => { x = Math.max(0, Math.min(1, x)); return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255); };
  const aces = (x) => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  const step = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  parentPort.on('message', (m) => {
    if (!m) { process.exit(0); }
    const { r0, r1 } = m;
    const px = new Uint8Array((r1 - r0) * S * 4);
    for (let row = r0; row < r1; row++) for (let col = 0; col < S; col++) {
      const o = ((row - r0) * S + col) * 4;
      let p = null, foot = 1;
      if (!job.alt) {
        // orthographic disc
        const u = (col + 0.5) / S * 2 - 1, v = 1 - (row + 0.5) / S * 2;
        const rr = u * u + v * v;
        if (rr >= 1) { px[o + 3] = 255; continue; }
        const w = Math.sqrt(1 - rr);
        p = { x: E[0] * u + Nn[0] * v + U[0] * w, y: E[1] * u + Nn[1] * v + U[1] * w, z: E[2] * u + Nn[2] * v + U[2] * w };
        foot = (2 * R / S) / Math.max(0.08, w);
      } else {
        // nadir perspective from altitude alt
        const u = ((col + 0.5) / S * 2 - 1) * tanH, v = (1 - (row + 0.5) / S * 2) * tanH;
        let dx = E[0] * u + Nn[0] * v - U[0], dy = E[1] * u + Nn[1] * v - U[1], dz = E[2] * u + Nn[2] * v - U[2];
        const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
        const ox = c.x * camR, oy = c.y * camR, oz = c.z * camR;
        const b = ox * dx + oy * dy + oz * dz, cc = ox * ox + oy * oy + oz * oz - R * R;
        const disc = b * b - cc; if (disc < 0) { px[o + 3] = 255; continue; }
        const t = -b - Math.sqrt(disc);
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        p = { x: hx / R, y: hy / R, z: hz / R };
        const cosI = Math.abs(dx * p.x + dy * p.y + dz * p.z);
        foot = t * (2 * tanH / S) / Math.max(0.08, cosI);
      }
      const texel = Math.max(0.05, foot);
      sampleTerrain(p.x, p.y, p.z, texel, T);
      // slope / normal from finite differences at the footprint
      const Bp = enuBasis(Math.asin(p.y) * 180 / Math.PI, Math.atan2(p.x, p.z) * 180 / Math.PI);
      const d = texel / R;
      const hE = heightAt(p.x + Bp.east[0] * d, p.y + Bp.east[1] * d, p.z + Bp.east[2] * d, texel);
      const hN = heightAt(p.x + Bp.north[0] * d, p.y + Bp.north[1] * d, p.z + Bp.north[2] * d, texel);
      const gx = (hE - T.h) / texel, gy = (hN - T.h) / texel;
      const cUp = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      ctx.slope = 1 - cUp; ctx.ao = -1; ctx.waterFrac = -1; ctx.depth = 0; ctx.waterResolved = true; ctx.canalResolved = true; ctx.coastal = T.h < 6;
      let Uo = null; if (urbanSample) { try { Uo = urbanSample(p.x, p.y, p.z, texel, US); } catch { Uo = null; } }
      let W = null;
      if ((T.water | 0) === 1) W = { type: 1, level: 0, depth: -T.h, dist: 1e9, width: 0 };
      else if ((T.water | 0) !== 0 || (typeof T.coast === 'number' && T.coast < texel * 2 + 25)) { try { W = waterAt(p.x, p.y, p.z, WS); } catch { W = null; } }
      SF.shadeSurface(p.x, p.y, p.z, texel, T, Uo, W, ctx, O);
      // exaggerated normal (footprint driven, like the GPU material); water flat
      const ex = 1 + (job.exag - 1) * step(5.5, 11.5, Math.log2(foot));
      const wflat = O.gloss >= 0.86 ? 0 : 1;
      const tx = -gx * ex * wflat, ty = -gy * ex * wflat;
      let nx = Bp.east[0] * tx + Bp.north[0] * ty + p.x, ny = Bp.east[1] * tx + Bp.north[1] * ty + p.y, nz = Bp.east[2] * tx + Bp.north[2] * ty + p.z;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const mus = p.x * sun.x + p.y * sun.y + p.z * sun.z;           // local sun elevation (sine)
      const trans = step(-0.02, 0.12, mus);
      const redden = step(-0.02, 0.35, mus);
      const ndl = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z) * trans;
      const sky = 0.18 * step(-0.1, 0.25, mus) * O.ao;
      const sunC = [1.0, 0.86 + 0.14 * redden, 0.70 + 0.30 * redden];
      const skyC = [0.55, 0.70, 1.0];
      const A = O.albedo;
      const night = 1 - step(-0.12, 0.04, mus);
      const k = job.exposure * 2.2;
      const rgb = [0, 1, 2].map((i) => {
        let L = A[i] * (ndl * sunC[i] + sky * skyC[i]) * k;
        L += A[i] * 0.004 * job.night;                                 // faint night readability
        L += O.emission[i] * 0.225 * night * job.night;                // window units × 0.05 × night exposure ≈ 4.5
        return srgb(aces(L));
      });
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
    parentPort.postMessage({ r0, r1, px: px.buffer }, [px.buffer]);
  });
  parentPort.postMessage({ ready: true });
}
