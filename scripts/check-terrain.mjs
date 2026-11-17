#!/usr/bin/env node
// Determinism / continuity / sanity checks + micro-benchmark for the terrain-fn world modules.
// OWNER: terrain-fn agent. Run from web/:  node scripts/check-terrain.mjs [--bench-only] [--quick]
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';

const DEG = Math.PI / 180;
function unit(lat, lon) { const la = lat * DEG, lo = lon * DEG, c = Math.cos(la); return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)]; }
// deterministic pseudo-random sequence (no Math.random for reproducible checks)
function seq(n, seed) { let a = seed >>> 0; const out = new Float64Array(n); for (let i = 0; i < n; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; } return out; }
function randomPoints(n, seed) {
  const r = seq(2 * n, seed); const pts = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) { const z = 2 * r[2 * i] - 1, phi = 2 * Math.PI * r[2 * i + 1], s = Math.sqrt(1 - z * z); pts[3 * i] = s * Math.cos(phi); pts[3 * i + 1] = z; pts[3 * i + 2] = s * Math.sin(phi); }
  return pts;
}

if (!isMainThread) {
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  const { heightAt } = await import('../src/world/terrain.js');
  const { pts, mw } = workerData;
  const out = new Float64Array(pts.length / 3);
  for (let i = 0; i < out.length; i++) out[i] = heightAt(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], mw);
  parentPort.postMessage(out, [out.buffer]);
} else {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const benchOnly = args.includes('--bench-only');
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  const t0 = process.cpuUsage();
  const { heightAt, sampleTerrain } = await import('../src/world/terrain.js');
  const { sampleFields } = await import('../src/world/fields.js');
  const { waterAt, canalsInTile } = await import('../src/world/hydro.js');
  const { faceToVec, vecToFace, FACES } = await import('../src/core/geo.js');
  heightAt(0, 0, 1, 0);
  const tInit = process.cpuUsage(t0);
  console.log(`init (module load + derived grids): ${((tInit.user + tInit.system) / 1000).toFixed(0)} ms CPU`);
  let fails = 0;
  const report = (name, ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${msg}`); if (!ok) fails++; };

  if (!benchOnly) {
    // ---- 1. determinism: same value twice in this thread, and in a fresh worker (cold caches, other order)
    const N = quick ? 2000 : 8000;
    const P = randomPoints(N, 12345);
    for (const mw of [0, 30, 2000]) {
      const a = new Float64Array(N), b = new Float64Array(N);
      for (let i = 0; i < N; i++) a[i] = heightAt(P[3 * i], P[3 * i + 1], P[3 * i + 2], mw);
      for (let i = N - 1; i >= 0; i--) b[i] = heightAt(P[3 * i], P[3 * i + 1], P[3 * i + 2], mw);
      const wres = await new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { pts: P, mw } }); w.on('message', res); w.on('error', rej); });
      let same = 0, sameW = 0, nan = 0;
      for (let i = 0; i < N; i++) { if (Object.is(a[i], b[i])) same++; if (Object.is(a[i], wres[i])) sameW++; if (!Number.isFinite(a[i])) nan++; }
      report(`determinism mw=${mw}`, same === N && sameW === N && nan === 0, `${same}/${N} same twice, ${sameW}/${N} same in fresh worker, ${nan} non-finite`);
    }

    // ---- 2. continuity across the ±180° seam and near the poles (1 cm apart)
    {
      let worst = 0, wl = 0;
      for (let k = 0; k < (quick ? 200 : 900); k++) {
        const lat = -89 + 178 * (k + 0.5) / (quick ? 200 : 900);
        const d = 0.01 / (3389500 * Math.cos(lat * DEG)) / DEG; // 1 cm in degrees of longitude
        for (const mw of [0, 50]) {
          // jump across the seam vs. the same 1 cm step taken on one side (steep cliffs are fine)
          const p = unit(lat, 180 - d / 2), q = unit(lat, -180 + d / 2), r2 = unit(lat, 180 - 1.5 * d);
          const hp = heightAt(p[0], p[1], p[2], mw);
          const dh = Math.abs(hp - heightAt(q[0], q[1], q[2], mw));
          const ref = Math.abs(hp - heightAt(r2[0], r2[1], r2[2], mw));
          const ex = dh - 2 * ref;
          if (ex > worst) { worst = ex; wl = lat; }
        }
      }
      report('seam ±180° continuity', worst < 0.01, `max excess |dh| over 1 cm (beyond 2x the local 1 cm slope) = ${worst.toFixed(4)} m (lat ${wl.toFixed(1)})`);
      let worstP = 0;
      for (const sgn of [1, -1]) for (let k = 0; k < 64; k++) {
        const a = 2 * Math.PI * k / 64, r = 1e-8; // ~3 cm around the pole
        const p = [r * Math.cos(a), sgn * Math.sqrt(1 - r * r), r * Math.sin(a)];
        const q = [-r * Math.cos(a), sgn * Math.sqrt(1 - r * r), -r * Math.sin(a)];
        for (const mw of [0, 50]) worstP = Math.max(worstP, Math.abs(heightAt(p[0], p[1], p[2], mw) - heightAt(q[0], q[1], q[2], mw)));
      }
      report('pole continuity', worstP < 0.1, `max |dh| across 6 cm at the poles = ${worstP.toFixed(4)} m`);
    }

    // ---- 3. cube-face edges (incl. O-zone canal grids): pairs 1 cm apart straddling every edge
    {
      let worst = 0, where = '';
      const M = quick ? 120 : 400;
      for (let f = 0; f < 6; f++) for (const edge of [0, 1, 2, 3]) for (let k = 0; k < M; k++) {
        const t = -1 + 2 * (k + 0.5) / M;
        const a = edge === 0 ? 1 : edge === 1 ? -1 : t, b = edge === 2 ? 1 : edge === 3 ? -1 : t;
        const p = faceToVec(f, a, b);
        // tangent direction across the edge
        const q2 = faceToVec(f, edge < 2 ? a * 0.999 : a, edge >= 2 ? b * 0.999 : b);
        let dx = p.x - q2.x, dy = p.y - q2.y, dz = p.z - q2.z; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
        const e = 0.005 / 3389500;
        const A = [p.x + dx * e, p.y + dy * e, p.z + dz * e], B = [p.x - dx * e, p.y - dy * e, p.z - dz * e];
        const C2 = [p.x + dx * 3 * e, p.y + dy * 3 * e, p.z + dz * 3 * e];
        for (const mw of [0, 8]) {
          const hA = heightAt(A[0], A[1], A[2], mw);
          const dh = Math.abs(hA - heightAt(B[0], B[1], B[2], mw));
          const ref = Math.abs(hA - heightAt(C2[0], C2[1], C2[2], mw));
          const ex = dh - 2 * ref;
          if (ex > worst) { worst = ex; where = `face ${f} edge ${edge} t ${t.toFixed(3)} mw ${mw} (|dh| ${dh.toFixed(4)}, local ${ref.toFixed(4)})`; }
        }
      }
      report('cube-face edge continuity', worst < 0.01, `max excess |dh| over 1 cm across edges = ${worst.toFixed(4)} m (${where})`);
    }

    // ---- 4. band-limit continuity: heights change smoothly with minWavelength (no pops)
    {
      const P2 = randomPoints(quick ? 300 : 1500, 777);
      let worst = 0, wInfo = '';
      for (let i = 0; i < P2.length / 3; i++) {
        let prev = heightAt(P2[3 * i], P2[3 * i + 1], P2[3 * i + 2], 1);
        for (let mw = 1.02; mw < 20000; mw *= 1.02) {
          const h = heightAt(P2[3 * i], P2[3 * i + 1], P2[3 * i + 2], mw);
          const rel = Math.abs(h - prev) / Math.max(1, mw * 0.2);
          if (rel > worst) { worst = rel; const la = Math.asin(P2[3 * i + 1]) * 180 / Math.PI, lo = Math.atan2(P2[3 * i], P2[3 * i + 2]) * 180 / Math.PI; wInfo = `at (${la.toFixed(4)}, ${lo.toFixed(4)}) mw ${mw.toFixed(2)} dh ${(h - prev).toFixed(3)}`; }
          prev = h;
          if (quick && mw > 3000) break;
        }
      }
      report('band-limit smoothness', worst < 1.0, `max |dh| per 2% step of minWavelength = ${worst.toFixed(3)} x (0.2*mw) ${wInfo}`);
    }

    // ---- 5. sea consistency + connectivity on a 1440x720 grid (mw = 7 km)
    {
      const W = quick ? 720 : 1440, H = W / 2;
      const sea = new Uint8Array(W * H); let landNeg = 0, seaPos = 0;
      const T = {};
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const lat = 90 - (j + 0.5) * 180 / H, lon = -180 + (i + 0.5) * 360 / W;
        const u = unit(lat, lon);
        sampleTerrain(u[0], u[1], u[2], 3389500 * Math.PI / H * 0.5, T);
        const isSea = T.coast < 0;
        sea[j * W + i] = isSea ? 1 : 0;
        if (!isSea && T.h < 0) landNeg++;
        if (isSea && T.h >= 0) seaPos++;
      }
      report('sea <=> h<0 consistency', landNeg === 0 && seaPos === 0, `${landNeg} land samples below 0, ${seaPos} sea samples at/above 0`);
      // connected components of sea (wrap in x)
      const lab = new Int32Array(W * H); let ncomp = 0; const sizes = [];
      const stack = new Int32Array(W * H);
      for (let s = 0; s < W * H; s++) {
        if (!sea[s] || lab[s]) continue;
        ncomp++; let sp = 0, size = 0; stack[sp++] = s; lab[s] = ncomp;
        while (sp) {
          const c = stack[--sp]; size++;
          const ci = c % W, cj = (c / W) | 0;
          const nb = [cj * W + (ci + 1) % W, cj * W + (ci + W - 1) % W, cj > 0 ? c - W : -1, cj < H - 1 ? c + W : -1];
          for (const n of nb) if (n >= 0 && sea[n] && !lab[n]) { lab[n] = ncomp; stack[sp++] = n; }
        }
        sizes.push(size);
      }
      sizes.sort((a, b) => b - a);
      const small = sizes.filter((s) => s < 0.0005 * W * H);
      report('sea connectivity', sizes.length > 0, `${sizes.length} sea components on this ${W}x${H} grid; largest ${sizes.slice(0, 4).join(', ')} px; ${small.length} small (< 0.05% of map). Straits narrower than the ${Math.round(3389500 * Math.PI / H / 1000)} km grid (ZR4 island straits, OX1 estuaries) break up here: scripts/check-terrain-arch.mjs checks the ZR4 island sea at 1.5 km. The OX3 赤岸海 is an intended inland sea at level 0.`);
    }

    // ---- 6. hydro sanity
    {
      const u = unit(4.6, 104.4); const w = {}; waterAt(u[0], u[1], u[2], w);
      report('waterAt shape', typeof w.type === 'number' && Array.isArray(w.flow) && w.flow.length === 2, JSON.stringify({ type: w.type, level: +w.level.toFixed?.(2), depth: +(w.depth ?? 0).toFixed?.(2) }));
      // canal network in farmland tiles (OX1 东泽, OX5 below the water stairs, OX3 赤岸)
      const msg = [];
      let okC = true;
      for (const [name, la, lo, L] of [['OX1', 4.5, 104.0, 9], ['OX1', 4.5, 104.0, 13], ['OX5', -27.6, -47.2, 9], ['OX3', 24.5, -128.0, 9]]) {
        const v = unit(la, lo); const fv = vecToFace(v[0], v[1], v[2]);
        const n = 1 << L, tx = Math.min(n - 1, Math.floor((fv.a + 1) / 2 * n)), ty = Math.min(n - 1, Math.floor((fv.b + 1) / 2 * n));
        const list = canalsInTile(fv.face, L, tx, ty);
        if (!Array.isArray(list)) okC = false;
        const by = {}; let sl = 0;
        for (const c of list) { by[c.kind + c.order] = (by[c.kind + c.order] || 0) + 1; sl += c.sluices.length; if (!(c.points.length >= 2 && Number.isFinite(c.level0) && Number.isFinite(c.level1))) okC = false; }
        msg.push(`${name} ${fv.face}/${L}/${tx}/${ty}: ${list.length} channels ${JSON.stringify(by)} ${sl} sluices`);
      }
      report('canalsInTile', okC, msg.join('; '));
    }
  }

  // ---- benchmark (CPU time; the machine may be shared, so CPU time not wall time)
  {
    // calibration: CPU cost of one 3D simplex noise evaluation in this process right now. On a shared
    // / oversubscribed machine CPU time per instruction inflates several-fold, so every figure is
    // also given in noise-evaluation units (load independent) and scaled to an unloaded core
    // (REF_NOISE_NS: one simplex evaluation on an idle Apple M-series core under V8).
    const REF_NOISE_NS = +(process.env.REF_NOISE_NS || 30);
    const { makeNoise } = await import('../src/world/terrain/noise.js');
    const NZ = makeNoise(999);
    let calSink = 0;
    const calibrate = () => {
      const n = 2e6, c0 = process.cpuUsage();
      for (let i = 0; i < n; i++) calSink += NZ.n3(i * 0.0131, i * 0.0071, i * 0.0113);
      const c = process.cpuUsage(c0);
      return ((c.user + c.system) * 1000) / n;
    };
    calibrate();
    let noiseNs = calibrate();
    console.log(`CALIBRATION one simplex noise3 = ${noiseNs.toFixed(1)} ns CPU now (unloaded reference ${REF_NOISE_NS} ns -> load factor ${(noiseNs / REF_NOISE_NS).toFixed(2)})`);
    const fmt = (us) => `${us.toFixed(2)} µs CPU = ${(us * 1000 / noiseNs).toFixed(0)} noise-evals ≈ ${(us * REF_NOISE_NS / noiseNs).toFixed(2)} µs unloaded`;
    const NB = quick ? 20000 : 200000;
    const P = randomPoints(NB, 4242);
    const run = (label, mw, filterFn) => {
      let n = 0, s = 0;
      const c0 = process.cpuUsage();
      for (let i = 0; i < NB; i++) { if (filterFn && !filterFn(i)) continue; s += heightAt(P[3 * i], P[3 * i + 1], P[3 * i + 2], mw); n++; }
      const c = process.cpuUsage(c0);
      const us = (c.user + c.system) / n;
      noiseNs = 0.5 * noiseNs + 0.5 * calibrate();                // track the machine load
      console.log(`BENCH ${label}: ${fmt(us)} per heightAt (${n} calls)`);
      return us;
    };
    // warm-up JIT
    for (let i = 0; i < 20000; i++) heightAt(P[3 * i], P[3 * i + 1], P[3 * i + 2], 0);
    run('random points, full detail (mw=0), incl. cold canal/lake caches', 0);
    run('random points, full detail (mw=0), 2nd pass', 0);
    run('random points, mw=10 m', 10);
    run('random points, mw=1 km', 1000);
    run('random points, mw=20 km', 20000);
    // tile-coherent sampling (like the terrain renderer): 65x65 vertices per tile, mw = vertex spacing.
    // The canal / lake networks are built lazily per 18 km planning cell (cached), so the first pass
    // over new ground ("cold") pays the one-time network construction; later passes ("warm") show
    // the steady per-call cost.
    const tiles = quick ? 40 : 160;
    const r = seq(4 * tiles, 99);
    const grids = [];
    for (let k = 0; k < tiles; k++) {
      const f = Math.floor(r[4 * k] * 6), L = 6 + Math.floor(r[4 * k + 1] * 14);
      const nT = 1 << L, tx = Math.floor(r[4 * k + 2] * nT), ty = Math.floor(r[4 * k + 3] * nT);
      const P2 = new Float64Array(65 * 65 * 3);
      for (let j = 0; j <= 64; j++) for (let i = 0; i <= 64; i++) {
        const v = faceToVec(f, -1 + 2 * (tx + i / 64) / nT, -1 + 2 * (ty + j / 64) / nT);
        const o = 3 * (j * 65 + i); P2[o] = v.x; P2[o + 1] = v.y; P2[o + 2] = v.z;
      }
      grids.push({ P: P2, spacing: (2 * 2662124) / nT / 64, L });
    }
    const T = {};
    const tilePass = (label, mwOf, useSample, filt) => {
      let calls = 0; const c0 = process.cpuUsage();
      for (const g of grids) {
        if (filt && !filt(g)) continue;
        const mw = mwOf(g);
        for (let q = 0; q < 65 * 65; q++) {
          if (useSample) sampleTerrain(g.P[3 * q], g.P[3 * q + 1], g.P[3 * q + 2], mw, T);
          else heightAt(g.P[3 * q], g.P[3 * q + 1], g.P[3 * q + 2], mw);
          calls++;
        }
      }
      const ct = process.cpuUsage(c0);
      noiseNs = 0.5 * noiseNs + 0.5 * calibrate();
      console.log(`BENCH ${label}: ${fmt((ct.user + ct.system) / calls)} per call (${calls} calls)`);
    };
    tilePass('tile-coherent 65x65 grids (L6..L19, mw = vertex spacing), cold caches, heightAt', (g) => g.spacing, false);
    tilePass('tile-coherent 65x65 grids (L6..L19, mw = vertex spacing), warm, heightAt', (g) => g.spacing, false);
    tilePass('tile-coherent 65x65 grids (L6..L19, mw = vertex spacing), warm, sampleTerrain', (g) => g.spacing, true);
    tilePass('tile-coherent 65x65 grids (L13..L19 street tiles), FULL DETAIL mw = 0, warm, heightAt', () => 0, false, (g) => g.L >= 13);
    tilePass('tile-coherent 65x65 grids (L13..L19 street tiles), FULL DETAIL mw = 0, warm, sampleTerrain', () => 0, true, (g) => g.L >= 13);
  }
  console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
}
