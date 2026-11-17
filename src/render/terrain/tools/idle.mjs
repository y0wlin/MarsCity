// Time-to-idle / tile timing probe for the terrain system in the MAIN app (run from web/):
//   node src/render/terrain/tools/idle.mjs --url "/?pose=22,118,1000,0,-30,35&time=10&clean=1" [--out shots/terrain-render/x.png]
//        [--base http://127.0.0.1:5173] [--timeout 240000] [--every 5000] [--width 1600 --height 900]
// Polls app.systems.terrain.debugStats() / isIdle() and app.isIdle() and prints a timeline plus the
// final tile timings (build ms by texture size, upload ms, counts). OWNER: terrain-render agent.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../../../../scripts/chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const url0 = opt('url', '/?clean=1');
const url = /^https?:/.test(url0) ? url0 : base + url0;
const timeout = +opt('timeout', 240000), every = +opt('every', 5000);
const width = +opt('width', 1600), height = +opt('height', 900);
const out = opt('out', null);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [], warnings = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e)));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 90000 });
const tReady = Date.now() - t0;
console.log(`ready after ${tReady} ms`);
let tTerrainIdle = -1, tAppIdle = -1, calmT = 0, calmA = 0;
const timeline = [];
const tPoll = Date.now();
while (Date.now() - tPoll < timeout) {
  const s = await page.evaluate(() => {
    const app = window.__MARS__.app; const t = app.systems.terrain;
    const d = t.debugStats ? t.debugStats() : {};
    const jobs = {}; for (const j of app.workers.queue) jobs['q:' + j.type] = (jobs['q:' + j.type] || 0) + 1; for (const j of app.workers.running.values()) jobs['r:' + j.type] = (jobs['r:' + j.type] || 0) + 1;
    return { jobs, tIdle: t.isIdle(), aIdle: app.isIdle(), pending: app.workers.pending, drawn: d.drawn, ready: d.ready, loading: d.loading, queued: d.queued, built: d.built, upgrades: d.upgrades, levels: d.levels, gpuMB: d.gpuMB, fps: Math.round(app.fps) };
  });
  const el = Date.now() - t0;
  calmT = s.tIdle ? calmT + 1 : 0; calmA = s.aIdle ? calmA + 1 : 0;
  if (calmT >= 2 && tTerrainIdle < 0) tTerrainIdle = el;
  if (calmA >= 2 && tAppIdle < 0) tAppIdle = el;
  timeline.push({ t: el, ...s });
  console.log(`${(el / 1000).toFixed(1)}s terrainIdle=${s.tIdle} appIdle=${s.aIdle} pending=${s.pending} drawn=${s.drawn} ready=${s.ready} loading=${s.loading} queued=${s.queued} built=${s.built} upg=${s.upgrades} gpu=${s.gpuMB}MB fps=${s.fps} levels=${JSON.stringify(s.levels)} jobs=${JSON.stringify(s.jobs)}`);
  if (tTerrainIdle >= 0 && tAppIdle >= 0) break;
  await page.waitForTimeout(tTerrainIdle >= 0 ? 1000 : every);
}
const fin = await page.evaluate(() => {
  const t = window.__MARS__.app.systems.terrain; const d = t.debugStats();
  return { drawn: d.drawn, ready: d.ready, built: d.built, avgBuildMs: d.avgBuildMs, maxBuildMs: Math.round(d.maxBuildMs), buildByTex: d.buildByTex, avgUploadMs: d.avgUploadMs, maxUploadMs: +(d.maxUploadMs || 0).toFixed(1), upgrades: d.upgrades, evicted: d.evicted, cancelled: d.cancelled, gpuMB: d.gpuMB, tris: d.tris, levels: d.levels, phases: d.phases };
});
console.log(JSON.stringify({ url, readyMs: tReady, terrainIdleMs: tTerrainIdle, appIdleMs: tAppIdle, final: fin, errors: errors.slice(0, 20), warnings: warnings.slice(0, 20) }, null, 2));
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); await page.screenshot({ path: out }); console.log('wrote', out); }
await browser.close();
