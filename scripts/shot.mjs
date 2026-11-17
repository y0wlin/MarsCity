#!/usr/bin/env node
// Headless verification tool (system Google Chrome via playwright-core, GPU on).
//
// Single shot:
//   node scripts/shot.mjs --url "/?pose=10,95,9e6,0,-90&time=9&clean=1" --out shots/s01.png
// Options:
//   --base http://127.0.0.1:5173   dev/preview server origin (default env MARS_BASE or 5173)
//   --url  <path or full url>      page to open (relative paths are joined to --base)
//   --out  <png>                   screenshot path (default shots/shot.png)
//   --width 1600 --height 900      viewport CSS px      --dpr 1   device pixel ratio
//   --idle 90000                   max ms to wait for __MARS__.waitIdle()
//   --settle 500                   extra ms after idle
//   --eval "<js>"                  run in page after ready, before waiting idle (await-able)
//   --batch shots.json             [{url, out, eval?, settle?}] run sequentially in one browser
// Prints a JSON report: console errors/warnings, page errors, __MARS__.stats(), timings.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const width = +opt('width', 1600), height = +opt('height', 900), dpr = +opt('dpr', 1);
const idle = +opt('idle', 90000);

let jobs;
if (opt('batch')) jobs = JSON.parse(fs.readFileSync(opt('batch'), 'utf8'));
else jobs = [{ url: opt('url', '/'), out: opt('out', 'shots/shot.png'), eval: opt('eval'), settle: +opt('settle', 500) }];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const report = [];
try {
  for (const job of jobs) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const logs = { errors: [], warnings: [], pageErrors: [], logs: [] };
    page.on('console', (m) => { const t = m.type(); const s = m.text(); if (t === 'error') logs.errors.push(s); else if (t === 'warning') logs.warnings.push(s); else if (logs.logs.length < 50) logs.logs.push(s); });
    page.on('pageerror', (e) => logs.pageErrors.push(String(e.stack || e)));
    const url = /^https?:/.test(job.url) ? job.url : base + (job.url.startsWith('/') ? '' : '/') + job.url;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    let ready = false;
    try { await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 60000 }); ready = true; } catch { /* page may be a dev bench */ }
    if (job.eval) { try { await page.evaluate(`(async () => { ${job.eval} })()`); } catch (e) { logs.pageErrors.push('eval: ' + e.message); } }
    let idleOk = null;
    if (ready) { try { idleOk = await page.evaluate((ms) => window.__MARS__.waitIdle(ms), idle); } catch (e) { logs.pageErrors.push('waitIdle: ' + e.message); } }
    else await page.waitForTimeout(3000);
    await page.waitForTimeout(job.settle ?? 500);
    const stats = ready ? await page.evaluate(() => window.__MARS__.stats?.()).catch(() => null) : null;
    const gl = await page.evaluate(() => { try { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { return 'n/a ' + e.message; } });
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    await page.screenshot({ path: job.out, timeout: 180000 });
    report.push({ url, out: job.out, ms: Date.now() - t0, ready, idleOk, gl, stats, ...logs });
    await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
  }
} finally {
  // never hang on shutdown (a stuck close kept browser slots occupied): bounded close, then hard exit
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n', () => process.exit(0));
