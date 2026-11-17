#!/usr/bin/env node
// Atmosphere agent's probe: open the app, wait for __MARS__.ready (optionally idle), evaluate JS
// expressions in the page and print their JSON results; optional screenshot.
//   node scripts/slot.mjs -- node scripts/atmo-probe.mjs --base http://127.0.0.1:5204 \
//        --url "/?pose=...&clean=1&workers=2" --eval "<async js returning a value>" [--idle 60000] [--out x.png]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:5204');
const width = +opt('width', 1280), height = +opt('height', 720);
const idle = +opt('idle', 0);
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const out = { errors: [], pageErrors: [] };
try {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); else if (/^\[probe\]/.test(m.text())) console.log(m.text()); });
  page.on('pageerror', (e) => out.pageErrors.push(String(e.stack || e)));
  const url = /^https?:/.test(opt('url', '/')) ? opt('url', '/') : base + opt('url', '/');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 300000 });
  out.readyMs = Date.now() - t0;
  if (opt('pre')) out.pre = await page.evaluate(`(async () => { ${opt('pre')} })()`).catch((e) => 'pre error: ' + e.message);
  if (idle > 0) { out.idle = await page.evaluate((ms) => window.__MARS__.waitIdle(ms), idle).catch((e) => 'idle error: ' + e.message); out.idleMs = Date.now() - t0; }
  if (opt('eval')) out.result = await page.evaluate(`(async () => { ${opt('eval')} })()`).catch((e) => 'eval error: ' + e.message);
  if (opt('out')) { fs.mkdirSync(path.dirname(opt('out')), { recursive: true }); await page.screenshot({ path: opt('out') }); }
  // --seq steps.json: [{eval?, idle?, wait?, out?}] run in order on the same page (eval results collected)
  if (opt('seq')) {
    out.seq = [];
    for (const st of JSON.parse(fs.readFileSync(opt('seq'), 'utf8'))) {
      const rec = {};
      if (st.eval) rec.result = await page.evaluate(`(async () => { ${st.eval} })()`).catch((e) => 'eval error: ' + e.message);
      if (st.idle) rec.idle = await page.evaluate((ms) => window.__MARS__.waitIdle(ms), st.idle).catch((e) => 'idle error: ' + e.message);
      if (st.wait) await page.waitForTimeout(st.wait);
      if (st.out) { fs.mkdirSync(path.dirname(st.out), { recursive: true }); await page.screenshot({ path: st.out }); rec.out = st.out; }
      out.seq.push(rec);
    }
  }
  await ctx.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
