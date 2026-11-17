// Memory growth diagnostic for one bookmark: samples JS heap, three.js resources and per-system counters every
// N seconds until the page crashes or the time is up. ONE headless Chrome; wrap in scripts/slot.mjs.
//   node scripts/slot.mjs -- node scripts/diag-memory.mjs --bm C01 --secs 300 --sample 30 --throttle 8 --query "&workers=4"
// CHROME_LOG=1 DEBUG=pw:browser adds Chrome's own log (e.g. 'V8 javascript OOM') to the output.
import { chromium } from 'playwright-core';
import { CHROME, GPU_ARGS } from './chrome.mjs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:4378');
const bm = opt('bm', 'C01');
const secs = +opt('secs', 240);
const every = +opt('sample', 10);
const extra = opt('query', '&workers=8');
const throttle = +opt('throttle', 1);
const rss = () => {
  try {
    const out = execSync("ps -Ao rss,command | grep -E -- '--type=(renderer|gpu-process)' | grep -E 'playwright|enable-automation' | grep -v grep", { encoding: 'utf8' });
    let r = 0, g = 0;
    for (const l of out.trim().split('\n')) { const kb = +l.trim().split(/\s+/)[0]; if (l.includes('--type=gpu-process')) g = Math.max(g, kb); else r = Math.max(r, kb); }
    return `rendRSS=${(r / 1048576).toFixed(2)}G gpuRSS=${(g / 1048576).toFixed(2)}G`;
  } catch { return 'rss=?'; }
};
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: [...GPU_ARGS, ...(process.env.CHROME_LOG ? ['--enable-logging=stderr', '--v=0'] : [])] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  let crashed = false;
  page.on('crash', () => { crashed = true; console.log('PAGE CRASHED'); });
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' || /memory|alloc|OOM/i.test(m.text())) console.log('console', m.type(), m.text().slice(0, 160)); });
  await page.goto(`${base}/?clean=1${extra}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 180000 });
  const t0 = Date.now();
  await page.evaluate((id) => window.__MARS__.goto(id, { instant: true }), bm);
  while (!crashed && (Date.now() - t0) / 1000 < secs) {
    try { await page.evaluate(([ms, th]) => window.__MARS__.waitIdle(ms, 20, { throttle: th }), [every * 1000, throttle]); } catch (e) { console.log('waitIdle err', String(e).slice(0, 80)); break; }
    let s;
    try {
      s = await page.evaluate(() => {
        const a = window.__MARS__.app, st = window.__MARS__.stats(), m = performance.memory || {};
        const c = a.systems.city?.debugStats?.() || {}, p = a.systems.props?.stats?.() || {}, mg = a.systems.mega?.debugStats?.() || {}, tr = a.systems.terrain?.debugStats?.() || {};
        return {
          heap: Math.round((m.usedJSHeapSize || 0) / 1048576), heapTot: Math.round((m.totalJSHeapSize || 0) / 1048576), heapLim: Math.round((m.jsHeapSizeLimit || 0) / 1048576),
          tex: st.textures, geo: st.geometries, tris: Math.round(st.triangles / 1e6), calls: st.calls, fps: Math.round(st.fps),
          wDone: st.workers.completed, wPend: st.workers.pending, cDone: st.city?.completed, cPend: st.city?.pending,
          terr: { drawn: tr.drawn, gpuMB: tr.gpuMB, loading: tr.loading },
          city: { disp: c.tilesDisplayed, load: c.tilesLoading, cached: c.tilesCached, bld: c.buildings, massMB: Math.round((c.massBytes || 0) / 1048576), detail: c.detail },
          props: p.tiles, mega: mg && { chunks: mg.chunks, gpuMB: mg.gpuMB, tex: mg.textures },
        };
      });
    } catch (e) { console.log('stats err', String(e).slice(0, 80)); break; }
    const t = Math.round((Date.now() - t0) / 1000);
    console.log(`t=${t}s ${rss()} heap=${s.heap}/${s.heapTot}/${s.heapLim}MB tex=${s.tex} geo=${s.geo} tris=${s.tris}M calls=${s.calls} fps=${s.fps} W=${s.wDone}/${s.wPend} C=${s.cDone}/${s.cPend}`);
    console.log(`   terrain ${JSON.stringify(s.terr)} city ${JSON.stringify(s.city).slice(0, 420)}`);
    console.log(`   props ${JSON.stringify(s.props).slice(0, 200)} mega ${JSON.stringify(s.mega).slice(0, 120)}`);
  }
  console.log(`end t=${Math.round((Date.now() - t0) / 1000)}s crashed=${crashed}`);
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
}
process.exit(0);
