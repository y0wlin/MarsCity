#!/usr/bin/env node
// Building-kit in-app preview (OWNER: building-kit). Opens the real app, loads the L13 city tile at
// (lat, lon) through src/dev/buildings-inapp.js (real specs on real terrain, planet lighting patch,
// CSM, GTAO, atmosphere composite) and screenshots several views of one building in ONE page load.
//
//   node scripts/bk-inapp.mjs --lat 22 --lon 118 --views street,corner,entrance --time 10 --out shots/building-kit/app
//   options: --use residential  --pick 0  --id <specId>  --radius 180  --lod exterior  --focusLod full
//            --width 1600 --height 900  --wait 240000 (max ms for terrain + buildings)  --frames 90
//            --city  (place nothing: verify render/city's own streaming of the kit output)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const width = +opt('width', 1600), height = +opt('height', 900);
const lat = +opt('lat', 22), lon = +opt('lon', 118), time = opt('time', '10');
const views = opt('views', 'street,corner').split(',');
const out = opt('out', 'shots/building-kit/app');
const wait = +opt('wait', 240000);
const frames = +opt('frames', 90);
const runOpts = { lat, lon, use: opt('use'), pick: +opt('pick', 0), id: opt('id'), radius: +opt('radius', 180), lod: opt('lod', 'exterior'), focusLod: opt('focusLod', 'full'), view: views[0], city: args.includes('--city') };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const report = { errors: [], warnings: [], pageErrors: [], logs: [], shots: [] };
try {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(wait);
  page.on('console', (m) => { const t = m.type(), s = m.text(); if (t === 'error') report.errors.push(s); else if (t === 'warning') report.warnings.push(s); else if (report.logs.length < 40) report.logs.push(s); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e.stack || e)));
  const t0 = Date.now();
  // start low over the target so the terrain refines where the building stands
  await page.goto(`${base}/?pose=${lat},${lon},600,0,-25&time=${time}&clean=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 120000 });
  report.run = await page.evaluate(async (o) => { const m = await import('/src/dev/buildings-inapp.js'); return m.run(window.__MARS__.app, o); }, runOpts);
  report.loadMs = Date.now() - t0;
  for (const v of views) {
    await page.evaluate(async (v) => { const m = await import('/src/dev/buildings-inapp.js'); return m.setView(window.__MARS__.app, v); }, v);
    const idle = await page.evaluate((ms) => window.__MARS__.waitIdle(ms), wait).catch((e) => 'err ' + e.message);
    // let TAA / exposure converge
    await page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);
    const file = path.join(out, `${v}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, timeout: wait });
    report.shots.push({ view: v, file, idle, ms: Date.now() - t0 });
  }
  report.stats = await page.evaluate(() => window.__MARS__.stats?.()).catch(() => null);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
