// Time terrainTile jobs in N bare browser workers (no app, no rendering) to compare with Node.
//   node scripts/slot.mjs -- node scripts/bench-worker.mjs --workers 1
import fs from 'fs';
import { chromium } from 'playwright-core';
import { CHROME, GPU_ARGS } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:4378');
const nW = +opt('workers', 1);
const worker = fs.readdirSync('dist/assets').find((f) => /^world\.worker-.*\.js$/.test(f));
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: GPU_ARGS });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/data/manifest.json`);
  const res = await page.evaluate(async ({ worker, nW }) => {
    const man = await (await fetch('/data/manifest.json')).json();
    const maps = {};
    for (const [k, m] of Object.entries(man)) maps[k] = { width: m.width, height: m.height, data: new Uint8Array(await (await fetch('/data/' + m.file)).arrayBuffer()) };
    const ws = [];
    for (let i = 0; i < nW; i++) {
      const w = new Worker('/assets/' + worker, { type: 'module' });
      await new Promise((r) => { w.onmessage = (e) => { if (e.data.type === '__ready') r(); }; w.postMessage({ id: 0, type: '__init', payload: { maps } }); });
      ws.push(w);
    }
    let id = 1;
    const run = (w, payload) => new Promise((r) => { const my = id++; w.onmessage = (e) => { if (e.data.id === my) r(e.data); }; w.postMessage({ id: my, type: 'terrainTile', payload }); });
    // S03 area tiles (face 0, from the in-app diagnosis): level 13 x 5448 y 4777, level 12 x 2724 y 2390
    const jobs = [{ face: 0, level: 13, x: 5448, y: 4777, texRes: 128 }, { face: 0, level: 13, x: 5448, y: 4777, texRes: 256 }, { face: 0, level: 12, x: 2724, y: 2390, texRes: 512 }];
    const out = [];
    for (const j of jobs) {
      const t0 = performance.now();
      const rs = await Promise.all(ws.map((w) => run(w, j)));
      out.push({ ...j, wall: Math.round(performance.now() - t0), workerMs: rs.map((r) => Math.round(r.ms)), stMs: rs.map((r) => Math.round(r.result?.stats?.ms || 0)) });
    }
    return out;
  }, { worker, nW });
  for (const r of res) console.log(JSON.stringify(r));
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
}
process.exit(0);
