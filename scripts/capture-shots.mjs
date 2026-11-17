#!/usr/bin/env node
// Capture every bookmark (shot cards S01–S09 + sub-views, turntable) from the running app as
// clean stills. Usage:
//   node scripts/capture-shots.mjs [--base http://127.0.0.1:5173] [--out shots/final] [--only S01,S05]
//                                   [--width 1920 --height 1080] [--dpr 1] [--idle 180000] [--throttle 8]
//                                   [--query "&workers=6"] [--reuse] [--settle 800] [--missing] [--merge]
//                                   [--gpu NVIDIA]
// Bookmarks are read from the page (window.__MARS__.bookmarks()), so this script never drifts
// from src/app/bookmarks.js. Each still is taken after __MARS__.waitIdle() (all tiles/buildings
// at final quality) with ?clean=1. By default every bookmark gets a FRESH page (a cold landing,
// as a visitor opening the bookmark would see it, and no memory carried over between shots);
// --reuse keeps one page for all shots. Every step has a timeout and a crashed/hung page is
// replaced, so one bad shot never blocks the batch. Wrap in scripts/slot.mjs when agents run.
// Resume an interrupted batch with --missing: only the bookmarks without a good still in <out>/report.json are
// taken, and the new rows are merged into that report (--merge alone keeps the other rows of an existing report).
// --gpu <regex>: the WebGL renderer of every page must match (e.g. NVIDIA on a hybrid-GPU laptop), otherwise the
// shot fails instead of being taken on the integrated GPU or in software. Report rows store '/'-separated paths
// and the renderer, so reports from a Mac and a Windows machine can be merged.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { CHROME, GPU_ARGS, webglRenderer } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
const outDir = opt('out', 'shots/final');
const only = opt('only') ? opt('only').split(',') : null;
const width = +opt('width', 1920), height = +opt('height', 1080), dpr = +opt('dpr', 1);
const idle = +opt('idle', 180000);
const settle = +opt('settle', 800);
const throttle = +opt('throttle', 1);   // draw every Nth frame while waiting for idle (see __MARS__.waitIdle)
const extra = opt('query', '');   // extra URL params, e.g. '&workers=6'
const reuse = flag('reuse');
const missing = flag('missing');            // resume: only bookmarks without a good still in <out>/report.json
const merge = flag('merge') || missing;     // keep the rows of an existing report.json for the other bookmarks
const gpuRe = opt('gpu') ? new RegExp(opt('gpu'), 'i') : null;

const withTimeout = (p, ms, what) => {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms} ms: ${what}`)), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
};
const toPosix = (p) => p.split(path.sep).join('/');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

fs.mkdirSync(outDir, { recursive: true });
const reportFile = path.join(outDir, 'report.json');
let prior = [];
if (merge && fs.existsSync(reportFile)) {
  // a damaged report is never treated as empty: that would drop every earlier row on the next write
  try { prior = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch (e) {
    console.error(`[capture] ${reportFile} is not valid JSON (${e.message}): not touching it. Restore ${reportFile}.bak or move the file away.`);
    process.exit(2);
  }
  for (const r of prior) if (r && typeof r.file === 'string') r.file = r.file.replace(/\\/g, '/');
}
const good = (r) => !!(r && r.file && !r.error && fs.existsSync(r.file));
let order = new Map();                      // bookmark id -> position in the app's list (report row order)
let browser = null, ctx = null;
async function closeBrowser() {
  // bounded shutdown: a hung close must not keep the process (and its browser slot) alive
  if (ctx) await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
  browser = ctx = null;
}
// (re)launch the browser when it is not running, so a dead browser process does not fail the rest of the batch
async function ensureBrowser() {
  if (browser && browser.isConnected()) return;
  await closeBrowser();
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GPU_ARGS });
  ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
}
const errors = [];
let crashed = false, renderer = '';

async function openPage() {
  await ensureBrowser();
  const page = await ctx.newPage();
  crashed = false;
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || (t === 'warning' && /context (lost|restored)/i.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => { crashed = true; errors.push('PAGE CRASHED'); });
  await page.goto(`${base}/?clean=1${extra}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 180000 });
  const r = await webglRenderer(page);
  if (r !== renderer) console.error(`[capture] Chrome ${browser.version()} | WebGL: ${r}`);
  renderer = r;
  if (gpuRe && !gpuRe.test(r)) throw new Error(`WebGL renderer "${r}" does not match --gpu ${gpuRe} (integrated GPU or software rendering?)`);
  return page;
}
async function closePage(page) { try { await withTimeout(page.close(), 15000, 'close'); } catch { /* ignore */ } }

const report = [];
let backedUp = false;
// With --merge a failed retake never replaces a good still from an earlier run: the earlier row is kept and the
// failure is noted on it as lastAttempt. Written atomically (temp file + rename) after a one-time .bak copy, so a
// killed process cannot leave a truncated report behind.
function writeReport() {
  let rows = [...report];
  if (merge) {
    const byId = new Map(prior.map((r) => [r.id, r]));
    rows = rows.map((r) => (r.error && good(byId.get(r.id))
      ? { ...byId.get(r.id), lastAttempt: { error: r.error, ms: r.ms, at: r.at } } : r));
    const fresh = new Set(rows.map((r) => r.id));
    rows = [...prior.filter((r) => !fresh.has(r.id)), ...rows];
  }
  rows.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  if (!backedUp && fs.existsSync(reportFile)) { try { fs.copyFileSync(reportFile, `${reportFile}.bak`); } catch { /* best effort */ } }
  backedUp = true;
  const tmp = `${reportFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  for (let k = 0; ; k++) {          // Windows: a virus scanner or the indexer may hold the file for a moment
    try { fs.renameSync(tmp, reportFile); break; } catch (e) {
      if (k >= 30 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      sleepSync(100);
    }
  }
}
try {
  let page = await openPage();
  const all = (await page.evaluate(() => window.__MARS__.bookmarks().map((b) => ({ id: b.id, name: b.name, group: b.group }))))
    .filter((b) => b.group !== 'user');
  order = new Map(all.map((b, i) => [b.id, i]));
  let list = all.filter((b) => !only || only.includes(b.id));
  if (missing) { const done = new Set(prior.filter(good).map((r) => r.id)); list = list.filter((b) => !done.has(b.id)); }
  if (only) list.sort((a, b) => only.indexOf(a.id) - only.indexOf(b.id));
  console.error(`[capture] ${list.length} bookmark(s): ${list.map((b) => b.id).join(',')}`);
  for (let i = 0; i < list.length; i++) {
    const bm = list[i];
    const t0 = Date.now();
    errors.length = 0;
    const file = path.join(outDir, `${bm.id}.png`);
    try {
      if (!page || crashed || page.isClosed() || !browser?.isConnected() || (!reuse && i > 0)) {
        if (page) await closePage(page);
        page = null;
        page = await openPage();
      }
      await withTimeout(page.evaluate((id) => window.__MARS__.goto(id, { instant: true }), bm.id), 300000, `goto ${bm.id}`);
      const ok = await withTimeout(page.evaluate(([ms, th]) => window.__MARS__.waitIdle(ms, 20, { throttle: th }), [idle, throttle]), idle + 90000, `waitIdle ${bm.id}`);
      await page.waitForTimeout(settle);
      const stats = await withTimeout(page.evaluate(() => { try { return { pose: window.__MARS__.pose(), stats: window.__MARS__.stats() }; } catch (e) { return { err: String(e) }; } }), 30000, 'stats').catch((e) => ({ err: String(e) }));
      const lost = await page.evaluate(() => !!window.__MARS__?.app?.pipeline?.contextLost).catch(() => true);
      if (lost) throw new Error('WebGL context lost (GPU reset) before the screenshot');
      await withTimeout(page.screenshot({ path: file, timeout: 180000 }), 200000, `screenshot ${bm.id}`);
      report.push({ id: bm.id, name: bm.name, file: toPosix(file), idle: ok, ms: Date.now() - t0, renderer, pose: stats.pose, stats: stats.stats, errors: [...errors] });
      console.error(`${bm.id} ${ok ? 'idle' : 'NOT-IDLE'} ${Date.now() - t0} ms -> ${toPosix(file)}`);
    } catch (e) {
      // keep whatever is on screen as a diagnostic still, then replace the page
      if (page) { try { await withTimeout(page.screenshot({ path: file.replace(/\.png$/, '.FAILED.png'), timeout: 60000 }), 70000, 'fail-shot'); } catch { /* page gone */ } }
      report.push({ id: bm.id, name: bm.name, error: String(e), ms: Date.now() - t0, at: new Date().toISOString(), renderer, errors: [...errors] });
      console.error(`${bm.id} FAILED ${Date.now() - t0} ms: ${e.message}`);
      if (page) await closePage(page);
      page = null;
    }
    writeReport();
  }
  if (page) await closePage(page);
} finally {
  await closeBrowser();
}
writeReport();
process.stdout.write(JSON.stringify(report.map(({ stats, ...r }) => r), null, 2) + '\n', () => process.exit(0));
