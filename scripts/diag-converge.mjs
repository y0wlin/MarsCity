// Convergence diagnostic: open one bookmark, sample the loading stats every N s until idle (or timeout),
// then screenshot and close. ONE headless Chrome; wrap in scripts/slot.mjs.
//   node scripts/slot.mjs -- node scripts/diag-converge.mjs --bm S03 --secs 420 --sample 30 --throttle 8 --query "&workers=8" --out shots/diag/S03.png
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { CHROME, GPU_ARGS } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:4378');
const bm = opt('bm', 'S03');
const secs = +opt('secs', 420);
const every = +opt('sample', 20);
const throttle = +opt('throttle', 1);
const extra = opt('query', '&workers=8');
const out = opt('out', `shots/diag/${bm}.png`);
const W = +opt('width', 1920), H = +opt('height', 1080);
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: GPU_ARGS });
const log = [];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(`${base}/?clean=1${extra}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 180000 });
  const t0 = Date.now();
  await page.evaluate((id) => window.__MARS__.goto(id, { instant: true }), bm);
  let idle = false;
  while ((Date.now() - t0) / 1000 < secs) {
    idle = await page.evaluate(([ms, th]) => window.__MARS__.waitIdle(ms, 20, { throttle: th }), [every * 1000, throttle]);
    const s = await page.evaluate(() => window.__MARS__.stats());
    const t = Math.round((Date.now() - t0) / 1000);
    const w = s.workers || {}, c = s.city || {}, tr = s.terrain || {};
    const notIdle = Object.entries(s.idle || {}).filter(([, v]) => !v).map(([k]) => k);
    const bt = (o) => Object.entries(o || {}).map(([k, b]) => `${k}:${b.n}x${b.avg}ms(w${b.wait},l${b.lag})`).join(' ');
    const line = `t=${t}s fps=${(s.fps || 0).toFixed(1)} W done=${w.completed} pend=${w.pending} canc=${w.cancelled} | city done=${c.completed} pend=${c.pending} | terrain drawn=${tr.drawn} loading=${tr.loading} queued=${tr.queued} upg=${tr.upgrading} | busy=[${notIdle.join(',')}]`;
    console.log(line);
    console.log(`   W: ${bt(w.byType)}`);
    if (c.byType) console.log(`   C: ${bt(c.byType)}`);
    log.push({ t, stats: s });
    if (idle) break;
  }
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => window.__MARS__.stats());
  console.log('terrain buildByTex', JSON.stringify(s.terrain && s.terrain.buildByTex));
  await page.screenshot({ path: out, timeout: 180000 });
  console.log(`${bm} ${idle ? 'IDLE' : 'NOT-IDLE'} after ${Math.round((Date.now() - t0) / 1000)} s -> ${out}`);
  fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(log, null, 1));
  await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
}
process.exit(0);
