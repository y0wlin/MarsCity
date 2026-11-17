// Camera tour through the MAIN app in ONE page load (run from web/): the page starts once, then each
// stop moves the camera (__MARS__.goto), sets the time / settings, waits for app idle, screenshots and
// records time-to-terrain-idle / time-to-app-idle plus terrain tile stats. Much cheaper than one page
// load per shot on a busy machine, and it exercises real LOD transitions between stops.
//   node src/render/terrain/tools/tour.mjs --stops tour.json [--base http://127.0.0.1:5173]
//        [--width 1280 --height 720] [--ready 300000] [--query "clean=1"]
// tour.json: [{ "pose":[lat,lon,alt,heading,pitch,lens], "time": 9, "out": "shots/..png",
//              "idle": 240000, "settle": 800, "set": {"debugLayer":"lod"} , "bookmark": "S02"? }]
// OWNER: terrain-render agent.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../../../../scripts/chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const stops = JSON.parse(fs.readFileSync(opt('stops', 'tour.json'), 'utf8'));
const width = +opt('width', 1280), height = +opt('height', 720);
const readyMs = +opt('ready', 300000);
const query = opt('query', 'clean=1');

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
const errors = [], warnings = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error') errors.push(m.text()); else if (t === 'warning') warnings.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e)));
const s0 = stops[0];
const p0 = s0.pose ? `pose=${s0.pose.join(',')}&` : (s0.bookmark ? `bookmark=${s0.bookmark}&` : '');
const t0 = Date.now();
await page.goto(`${base}/?${p0}${s0.time != null ? `time=${s0.time}&` : ''}${query}`, { waitUntil: 'load', timeout: readyMs });
await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: readyMs, polling: 1000 });
console.log(`page ready after ${Date.now() - t0} ms`);
const report = [];
for (let i = 0; i < stops.length; i++) {
  const s = stops[i];
  const r = await page.evaluate(async (st) => {
    const M = window.__MARS__, app = M.app, T = app.systems.terrain;
    if (st.set) for (const [k, v] of Object.entries(st.set)) M.set(k, v);
    if (st.bookmark) M.goto(st.bookmark, { instant: true });
    if (st.pose) { const [lat, lon, alt, heading = 0, pitch = -90, lens] = st.pose; M.goto({ lat, lon, alt, heading, pitch, lens: lens || undefined }); }
    if (st.time != null) M.setTime(st.time);
    const t0 = performance.now(); let tIdleTerrain = -1, tIdleApp = -1, calm = 0, calmT = 0;
    const lim = st.idle || 240000;
    while (performance.now() - t0 < lim) {
      await new Promise((res) => setTimeout(res, 250));
      calmT = T.isIdle() ? calmT + 1 : 0;
      if (calmT >= 4 && tIdleTerrain < 0) tIdleTerrain = performance.now() - t0;
      calm = app.isIdle() ? calm + 1 : 0;
      if (calm >= 4) { tIdleApp = performance.now() - t0; break; }
    }
    const d = T.debugStats();
    const busy = {}; for (const [n, sys] of Object.entries(app.systems)) if (sys.isIdle && !sys.isIdle()) busy[n] = 1;
    return { tIdleTerrain: Math.round(tIdleTerrain), tIdleApp: Math.round(tIdleApp), busy, pending: app.workers.pending,
      drawn: d.drawn, ready: d.ready, built: d.built, upgrades: d.upgrades, levels: d.levels, gpuMB: d.gpuMB, failed: d.failed || 0,
      buildByTex: d.buildByTex, avgUploadMs: d.avgUploadMs, pose: M.pose() };
  }, s);
  await page.waitForTimeout(s.settle ?? 800);
  if (s.out) { fs.mkdirSync(path.dirname(s.out), { recursive: true }); await page.screenshot({ path: s.out, timeout: 240000 }); }
  console.log(`[${i}] ${s.out || ''} terrainIdle ${r.tIdleTerrain} ms appIdle ${r.tIdleApp} ms busy=${JSON.stringify(r.busy)} pending=${r.pending} drawn=${r.drawn} built=${r.built} upg=${r.upgrades} levels=${JSON.stringify(r.levels)} gpu=${r.gpuMB}MB failed=${r.failed}`);
  report.push({ stop: s, ...r });
}
const out = opt('report', null);
if (out) fs.writeFileSync(out, JSON.stringify({ report, errors, warnings }, null, 2));
console.log(JSON.stringify({ errors: errors.slice(0, 30), warnings: warnings.slice(0, 30), buildByTex: report.length ? report[report.length - 1].buildByTex : null }, null, 2));
await browser.close();
