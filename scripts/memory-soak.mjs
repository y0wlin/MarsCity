#!/usr/bin/env node
// Long-session memory soak (fix round 3, owner: memory). ONE page cycles a zoom ladder across scales and
// sites (orbit → 1000 km → 100 km → 20 km → 5 km → 1 km → street → 200 m lateral → next site …) for
// --minutes, alternating day / night and the viewport size, and logs after every step:
//   renderer.info.memory {geometries, textures}, renderer.info.programs, scene object counts, the main-thread
//   JS heap (after a forced GC), worker queue, per-system debug stats, and the OS footprint of the
//   renderer / GPU processes of this browser (macOS `footprint`, plus RSS).
// Healthy = every curve plateaus after the first 2–3 cycles (bounded caches), and the page never crashes.
//
//   node scripts/slot.mjs -- node scripts/memory-soak.mjs --base http://127.0.0.1:5401 --minutes 25 \
//        --dwell 30 --out shots/memory/base --query "&workers=2"
// Output: <out>/soak.jsonl (one JSON line per step), <out>/soak.csv, <out>/summary.json (per-cycle maxima).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:5401');
const minutes = +opt('minutes', 25);
const dwell = +opt('dwell', 30) * 1000;
const out = opt('out', 'shots/memory/soak');
const query = opt('query', '&workers=2');
const W1 = +opt('width', 1600), H1 = +opt('height', 900);
fs.mkdirSync(out, { recursive: true });
const jsonl = path.join(out, 'soak.jsonl');
fs.writeFileSync(jsonl, '');

// sites: lat, lon, street heading; each visit shifts the fine poses laterally so new fine tiles are needed
const SITES = [
  { name: 'ZR5-S07', lat: 21.871898, lon: 117.997485, hdg: 193.67 },
  { name: 'G01-harbour', lat: 0.5005, lon: 129.9420, hdg: 14 },
  { name: 'ZR2-canyon', lat: 34.8905, lon: -105.286, hdg: 245 },
  { name: 'OX1-basin', lat: 7.23351, lon: 104.86894, hdg: 35 },
];
// ladder: alt above sea level (alt) or above the analytic ground (agl); lateral offset (m) along the heading
const LADDER = [
  { name: 'orbit', alt: 1.79e7, pitch: -90, lens: 50 },
  { name: '1000km', alt: 1e6, pitch: -70, lens: 35 },
  { name: '100km', alt: 1e5, pitch: -50, lens: 35 },
  { name: '20km', agl: 2e4, pitch: -35, lens: 35 },
  { name: '5km', agl: 5000, pitch: -25, lens: 35 },
  { name: '1km', agl: 1000, pitch: -15, lens: 35 },
  { name: 'street', agl: 1.7, pitch: 5, lens: 28, dwellX: 1.5 },
  { name: '200m-lateral', agl: 200, pitch: -20, lens: 35, ahead: 1500 },
];

const tag = `--mars-soak-${process.pid}`;
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info', '--js-flags=--expose-gc', tag],
});

function procs() {
  // this browser's main process = the one carrying our tag; renderer / GPU = its children
  let txt = '';
  try { txt = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return null; }
  const rows = txt.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3] * 1024, cmd: m[4] }));
  const main = rows.find((r) => r.cmd.includes(tag) && !r.cmd.includes('--type='));
  if (!main) return null;
  const kids = rows.filter((r) => r.ppid === main.pid);
  const fp = (pid) => { try { const s = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 20000 }); const m = s.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/); return m ? +m[1] * ({ KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : null; } catch { return null; } };
  const res = { browserRssMB: Math.round(main.rss / 1048576), renderer: [], gpu: null };
  for (const k of kids) {
    if (k.cmd.includes('--type=gpu-process')) res.gpu = { pid: k.pid, rssMB: Math.round(k.rss / 1048576), fpMB: fp(k.pid) };
    else if (k.cmd.includes('--type=renderer') && !k.cmd.includes('--extension-process')) res.renderer.push({ pid: k.pid, rssMB: Math.round(k.rss / 1048576), fpMB: fp(k.pid) });
  }
  res.rendererFpMB = Math.round(res.renderer.reduce((s, r) => s + (r.fpMB || 0), 0));
  res.gpuFpMB = res.gpu ? Math.round(res.gpu.fpMB || 0) : null;
  return res;
}

const ctx = await browser.newContext({ viewport: { width: W1, height: H1 } });
const page = await ctx.newPage();
const logs = { errors: [], pageErrors: [], crashed: false };
page.on('console', (m) => { if (m.type() === 'error' && logs.errors.length < 200) logs.errors.push(m.text()); });
page.on('pageerror', (e) => { if (logs.pageErrors.length < 200) logs.pageErrors.push(String(e.stack || e)); });
page.on('crash', () => { logs.crashed = true; });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable').catch(() => {});

const s0 = SITES[0];
const url = `${base}/?pose=${s0.lat},${s0.lon},1.79e7,0,-90,50&time=12&clean=1${query}`;
const T0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 120000 });
await page.waitForTimeout(8000);

async function sample() {
  let heap = null;
  try { await cdp.send('HeapProfiler.collectGarbage'); const u = await cdp.send('Runtime.getHeapUsage'); heap = { usedMB: +(u.usedSize / 1048576).toFixed(1), totalMB: +(u.totalSize / 1048576).toFixed(1), backingMB: u.backingStorageSize != null ? +(u.backingStorageSize / 1048576).toFixed(1) : null, embedderMB: u.embedderHeapUsedSize != null ? +(u.embedderHeapUsedSize / 1048576).toFixed(1) : null }; } catch { /* */ }
  const st = await page.evaluate(() => {
    const M = window.__MARS__, app = M.app, r = app.renderer, S = app.systems;
    const safe = (f) => { try { return f(); } catch (e) { return { err: String(e.message || e) }; } };
    let objs = 0, meshes = 0;
    app.scene.traverse((o) => { objs++; if (o.isMesh || o.isPoints || o.isLine) meshes++; });
    const pm = performance.memory || {};
    const t = S.terrain;
    const pick = (o, keys) => { const q = {}; if (o) for (const k of keys) if (o[k] !== undefined) q[k] = o[k]; return q; };
    return {
      geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: (r.info.programs || []).length,
      calls: r.info.render.calls, tris: r.info.render.triangles, objs, meshes,
      heapUsedMB: pm.usedJSHeapSize ? +(pm.usedJSHeapSize / 1048576).toFixed(1) : null,
      workers: { ...app.workers.stats, pending: app.workers.pending },
      cityPool: S.city && S.city.pool && S.city.pool !== app.workers ? { ...(S.city.pool.stats || {}), pending: S.city.pool.pending } : null,
      terrain: safe(() => pick(t.debugStats ? t.debugStats() : null, ['ready', 'drawn', 'loading', 'gpuMB', 'evicted', 'built', 'upgrades', 'levels'])),
      terrainReady: t.ready ? t.ready.size : null, terrainGpuMB: t.gpuBytes ? Math.round(t.gpuBytes / 1048576) : null,
      city: safe(() => S.city.debugStats ? S.city.debugStats() : null),
      water: safe(() => S.water.debugStats ? S.water.debugStats() : null),
      mega: safe(() => S.mega.debugStats ? S.mega.debugStats() : null),
      props: safe(() => S.props.stats ? S.props.stats() : null),
      pose: M.pose(), idle: app.isIdle(),
    };
  });
  // worker heaps (world / city / props / mega workers live in the renderer process): performance.memory where the
  // worker exposes it; a worker busy with a long job answers late → 3 s timeout (null)
  const wk = [];
  for (const w of page.workers()) {
    const v = await Promise.race([
      w.evaluate(() => { const m = self.performance && self.performance.memory; return m ? m.usedJSHeapSize : -1; }).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]);
    let name = ''; try { name = (w.url() || '').split('/').pop().split('?')[0].replace(/-[A-Za-z0-9_]{6,}\.js$/, '.js'); } catch { /* */ }
    wk.push({ name, mb: v > 0 ? +(v / 1048576).toFixed(1) : v });
  }
  const known = wk.filter((x) => x.mb > 0);
  return { heap, workersHeapMB: known.length ? +known.reduce((s, x) => s + x.mb, 0).toFixed(1) : null, workerHeaps: wk, ...st };
}

const stepsPerCycle = LADDER.length;
let step = 0, visit = 0;
const rows = [];
try {
  while (Date.now() - T0 < minutes * 60000) {
    const cycle = Math.floor(step / stepsPerCycle);
    const li = step % stepsPerCycle;
    if (li === 0 && step > 0) visit++;
    const site = SITES[visit % SITES.length];
    const L = LADDER[li];
    const night = cycle % 2 === 1;
    const localHour = night ? 21.5 : 10.5;
    const solTime = ((localHour - site.lon / 15) % 24 + 24) % 24;
    const lateral = Math.floor(visit / SITES.length) * 400;           // m, new fine tiles on every revisit
    if (li === 0) {
      // resize every cycle (render targets re-created): alternate 1600×900 / 1280×720
      const big = cycle % 2 === 0;
      await page.setViewportSize(big ? { width: W1, height: H1 } : { width: Math.round(W1 * 0.8), height: Math.round(H1 * 0.8) });
    }
    const t1 = Date.now();
    await page.evaluate(({ site, L, solTime, lateral }) => {
      const M = window.__MARS__, app = M.app;
      const dest = (lat, lon, brg, d) => {   // small-distance destination (spherical)
        const R = 3389500, b = brg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180, a = d / R;
        const p2 = Math.asin(Math.sin(p1) * Math.cos(a) + Math.cos(p1) * Math.sin(a) * Math.cos(b));
        const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(p1), Math.cos(a) - Math.sin(p1) * Math.sin(p2));
        return { lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI };
      };
      let p = { lat: site.lat, lon: site.lon };
      if (L.agl !== undefined) p = dest(p.lat, p.lon, site.hdg + 90, lateral);
      if (L.ahead) p = dest(p.lat, p.lon, site.hdg, L.ahead);
      let alt = L.alt;
      if (L.agl !== undefined) { const g = app.systems.terrain.heightAtLatLon(p.lat, p.lon); alt = Math.max(0, g) + L.agl; }
      M.setTime(solTime);
      M.goto({ lat: p.lat, lon: p.lon, alt, heading: L.name === 'orbit' ? 0 : site.hdg, pitch: L.pitch, roll: 0, lens: L.lens });
    }, { site, L, solTime, lateral });
    await page.waitForTimeout(dwell * (L.dwellX || 1));
    const s = await sample();
    const proc = procs();
    const row = { step, cycle, site: site.name, pose: L.name, night, tMin: +((Date.now() - T0) / 60000).toFixed(2), stepMs: Date.now() - t1, ...s, proc };
    rows.push(row);
    fs.appendFileSync(jsonl, JSON.stringify(row) + '\n');
    console.log(`[${row.tMin.toFixed(1)}m c${cycle} ${site.name}/${L.name}${night ? ' night' : ''}] tex=${s.textures} geo=${s.geometries} prog=${s.programs} heap=${s.heap?.usedMB}MB ab=${s.heap?.backingMB}MB objs=${s.objs} terrReady=${s.terrainReady} terrGpu=${s.terrainGpuMB}MB wq=${s.workers.pending} wkHeap=${s.workersHeapMB}MB rendFp=${proc?.rendererFpMB}MB gpuFp=${proc?.gpuFpMB}MB`);
    step++;
  }
} catch (e) {
  logs.pageErrors.push('soak: ' + (e.stack || e.message || e));
  console.error('[soak] stopped:', e.message || e);
}

// per-cycle maxima
const cyc = {};
for (const r of rows) {
  const c = cyc[r.cycle] || (cyc[r.cycle] = { cycle: r.cycle, steps: 0 });
  c.steps++;
  const mx = (k, v) => { if (v != null && Number.isFinite(v)) c[k] = Math.max(c[k] ?? -Infinity, v); };
  mx('textures', r.textures); mx('geometries', r.geometries); mx('programs', r.programs); mx('heapMB', r.heap?.usedMB);
  mx('objs', r.objs); mx('terrainReady', r.terrainReady); mx('terrainGpuMB', r.terrainGpuMB); mx('workersPending', r.workers?.pending);
  mx('rendererFpMB', r.proc?.rendererFpMB); mx('workersHeapMB', r.workersHeapMB); mx('gpuFpMB', r.proc?.gpuFpMB); mx('tMin', r.tMin);
}
const csvKeys = ['step', 'cycle', 'tMin', 'site', 'pose', 'night', 'textures', 'geometries', 'programs', 'objs', 'meshes', 'heapMB', 'terrainReady', 'terrainGpuMB', 'workersPending', 'workersHeapMB', 'rendererFpMB', 'gpuFpMB'];
const csv = [csvKeys.join(',')].concat(rows.map((r) => [r.step, r.cycle, r.tMin, r.site, r.pose, r.night, r.textures, r.geometries, r.programs, r.objs, r.meshes, r.heap?.usedMB, r.terrainReady, r.terrainGpuMB, r.workers?.pending, r.workersHeapMB, r.proc?.rendererFpMB, r.proc?.gpuFpMB].join(','))).join('\n');
fs.writeFileSync(path.join(out, 'soak.csv'), csv + '\n');
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ url, minutes: +((Date.now() - T0) / 60000).toFixed(1), steps: rows.length, crashed: logs.crashed, errors: logs.errors.slice(0, 50), pageErrors: logs.pageErrors.slice(0, 50), cycles: Object.values(cyc) }, null, 1));
console.log(JSON.stringify({ crashed: logs.crashed, steps: rows.length, errors: logs.errors.length, pageErrors: logs.pageErrors.length, cycles: Object.values(cyc) }, null, 1));
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
process.exit(0);
