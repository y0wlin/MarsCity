// Debug-layer sweep for the terrain in the MAIN app (run from web/): loads one pose once, waits for
// idle, then screenshots every settings.debugLayer value (and clean mode) without reloading.
//   node src/render/terrain/tools/layers.mjs --url "/?pose=22,118,2e6,0,-90,50&time=9" --out shots/terrain-render/layers
//        [--base http://127.0.0.1:5173] [--idle 200000] [--layers province,zone,density,emission,wireframe,lod,normals]
// OWNER: terrain-render agent.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../../../../scripts/chrome.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const url0 = opt('url', '/?pose=22,118,2e6,0,-90,50&time=9');
const url = /^https?:/.test(url0) ? url0 : base + url0;
const outDir = opt('out', 'shots/terrain-render/layers');
const idle = +opt('idle', 200000);
const layers = opt('layers', 'none,province,zone,density,emission,wireframe,lod,normals,clean').split(',');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await (await browser.newContext({ viewport: { width: +opt('width', 1280), height: +opt('height', 720) } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 90000 });
const t0 = Date.now();
const ok = await page.evaluate((ms) => window.__MARS__.waitIdle(ms), idle);
console.log('idle', ok, Date.now() - t0, 'ms');
for (const l of layers) {
  await page.evaluate((layer) => {
    const M = window.__MARS__;
    if (layer === 'clean') { M.set('debugLayer', 'lod'); M.set('clean', true); }
    else { M.set('clean', false); M.set('debugLayer', layer); }
  }, l);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${l}.png` });
  console.log('wrote', `${outDir}/${l}.png`);
}
console.log(JSON.stringify({ errors: errors.slice(0, 30) }, null, 2));
await browser.close();
