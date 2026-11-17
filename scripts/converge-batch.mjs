#!/usr/bin/env node
// Retake bookmarks until they are fully converged: one page per area group (capture-shots --reuse), one group at
// a time, each under scripts/slot.mjs (ONE headless Chrome machine-wide). Runs the same on macOS and Windows.
//   node scripts/converge-batch.mjs [--serve] [--groups scripts/converge-remaining.json] [--passes 2] [--gpu NVIDIA]
//        [--base http://127.0.0.1:4378] [--out shots/final] [--workers 4] [--query "&detailMB=1800"]
//        [--idle-min 45] [--throttle 8] [--log shots/final-capture-converge.log] [--dry-run] [GROUP ...]
// Paths are relative to the project folder (the script changes into it).
// GROUP: comma-separated bookmark ids shot in one page, "@minutes" = per-shot idle cap, e.g. "S06,S06b@100".
//   --groups FILE reads them from JSON instead ({"groups": ["S06,S06b@100", {"ids": "S08,S08b", "cap": 75,
//   "workers": 4, "query": "&detailMB=1800"}, ...]}), which also avoids PowerShell splitting unquoted commas.
// --serve       serves dist/ on --base from this process (vite preview; run npm run build first).
// --passes N    after the last group, go round again (up to N times) for whatever is not converged yet.
// --gpu REGEX   every page's WebGL renderer must match (e.g. NVIDIA), else the shot fails (see capture-shots).
// --dry-run     print what would be shot and exit (no server, no Chrome).
// - Bookmarks with a converged still (report row idle: true, not marked stale) are skipped: the batch can be rerun.
// - Create <out>/STOP to end the batch after the current group; it is removed when the batch stops on it.
// - New rows are merged into <out>/report.json; a failed retake keeps the earlier still (see capture-shots.mjs).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(here, '..'));
const args = process.argv.slice(2);
const named = new Set(['base', 'out', 'workers', 'idle-min', 'throttle', 'log', 'groups', 'passes', 'query', 'gpu']);
const flags = new Set(['serve', 'dry-run']);
const opts = {}, positional = [];
for (let i = 0; i < args.length; i++) {
  const k = args[i].startsWith('--') ? args[i].slice(2) : null;
  if (k && named.has(k)) opts[k] = args[++i];
  else if (k && flags.has(k)) opts[k] = true;
  else if (k) { console.error(`unknown option --${k}`); process.exit(2); }
  else positional.push(args[i]);
}
const base = opts.base || 'http://127.0.0.1:4378';
const out = opts.out || 'shots/final';
const workers = +(opts.workers || 4);
const idleMin = +(opts['idle-min'] || 45);
const throttle = +(opts.throttle || 8);
const passes = Math.max(1, +(opts.passes || 1));
const logFile = opts.log || 'shots/final-capture-converge.log';
const dryRun = !!opts['dry-run'];

// groups: positional "IDS@cap" strings and/or a JSON file
const parseGroup = (g) => {
  if (typeof g === 'string') { const [ids, cap] = g.split('@'); return { ids: ids.split(',').filter(Boolean), cap: +(cap || idleMin) }; }
  return { ids: (Array.isArray(g.ids) ? g.ids : String(g.ids).split(',')).filter(Boolean), cap: +(g.cap || idleMin), workers: g.workers, query: g.query };
};
let groups = positional.map(parseGroup);
if (opts.groups) groups = groups.concat(JSON.parse(fs.readFileSync(opts.groups, 'utf8')).groups.map(parseGroup));
if (!groups.length) { console.error('usage: node scripts/converge-batch.mjs [options] (--groups FILE | GROUP ...)'); process.exit(2); }

const reportFile = path.join(out, 'report.json');
const stopFile = path.join(out, 'STOP');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (line) => { if (!dryRun) fs.appendFileSync(logFile, line + '\n'); console.log(line); };
// a report that exists but does not parse stops the batch (treating it as empty would retake and drop everything)
const readReport = () => {
  if (!fs.existsSync(reportFile)) return [];
  try { return JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch (e) {
    log(`[batch-error] ${reportFile} is not valid JSON (${e.message}); restore ${reportFile}.bak and rerun`);
    process.exit(2);
  }
};
const fileOf = (r) => (typeof r.file === 'string' ? r.file.replace(/\\/g, '/') : '');
const converged = (r) => !!(r && r.idle === true && !r.error && !r.stale && fileOf(r) && fs.existsSync(fileOf(r)));
const queryOf = (g) => `&workers=${g.workers ?? workers}${g.query ?? opts.query ?? ''}`;
const pending = () => { const m = new Map(readReport().map((r) => [r.id, r])); return groups.flatMap((g) => g.ids).filter((id) => !converged(m.get(id))); };

if (dryRun) {
  const rows = new Map(readReport().map((r) => [r.id, r]));
  console.log(`dry run: base ${base}, out ${out}, throttle ${throttle}, passes ${passes}${opts.gpu ? `, gpu /${opts.gpu}/` : ''}`);
  let n = 0;
  for (const g of groups) {
    const ids = g.ids.filter((id) => !converged(rows.get(id)));
    const why = g.ids.filter((id) => rows.get(id)?.stale).map((id) => `${id} stale`);
    n += ids.length;
    console.log(`${ids.length ? 'shoot' : 'skip '} ${g.ids.join(',')}  cap ${g.cap} min  query ${queryOf(g)}${ids.length && ids.length < g.ids.length ? `  (only ${ids.join(',')})` : ''}${why.length ? `  [${why.join(', ')}]` : ''}`);
  }
  console.log(`${n} bookmark(s) to shoot`);
  process.exit(0);
}

let server = null;
if (opts.serve) {
  if (!fs.existsSync('dist/index.html')) { console.error('[serve] dist/ is missing: run npm run build first'); process.exit(2); }
  const { preview } = await import('vite');
  const u = new URL(base);
  server = await preview({ root: process.cwd(), logLevel: 'warn', build: { outDir: 'dist' }, preview: { host: u.hostname, port: +u.port || 80, strictPort: true } });
  log(`[serve] dist/ on ${base}`);
}

log(`[batch] ${new Date().toISOString()} ${groups.length} group(s) x ${passes} pass(es), workers=${workers}, throttle=${throttle}, base=${base}${opts.gpu ? `, gpu=/${opts.gpu}/` : ''}`);
let stopped = false;
try {
  for (let pass = 1; pass <= passes && !stopped; pass++) {
    if (pass > 1) {
      const left = pending();
      if (!left.length) break;
      log(`[pass] ${pass} ${stamp()} still to converge: ${left.join(',')}`);
    }
    for (const g of groups) {
      if (fs.existsSync(stopFile)) { log(`[batch-stop] ${stamp()} ${stopFile} found, remaining groups not started`); fs.unlinkSync(stopFile); stopped = true; break; }
      const rows = new Map(readReport().map((r) => [r.id, r]));
      const ids = g.ids.filter((id) => !converged(rows.get(id)));
      if (!ids.length) { log(`[group-skip] ${g.ids.join(',')} already converged`); continue; }
      log(`[group] ${ids.join(',')} cap ${g.cap} min ${queryOf(g)} ${stamp()}`);
      const t0 = Date.now();
      const code = await new Promise((resolve) => {
        const fd = fs.openSync(logFile, 'a');
        const child = spawn(process.execPath, [path.join(here, 'slot.mjs'), '--', process.execPath, path.join(here, 'capture-shots.mjs'),
          '--base', base, '--out', out, '--width', '1920', '--height', '1080', '--query', queryOf(g),
          '--idle', String(g.cap * 60000), '--throttle', String(throttle), '--reuse', '--merge', '--only', ids.join(','),
          ...(opts.gpu ? ['--gpu', opts.gpu] : [])],
        { stdio: ['ignore', fd, fd] });
        child.on('exit', (c, sig) => { fs.closeSync(fd); resolve(c ?? sig); });
        child.on('error', (e) => { fs.closeSync(fd); log(`[group-error] ${e.message}`); resolve(127); });
      });
      const after = new Map(readReport().map((r) => [r.id, r]));
      const summary = ids.map((id) => {
        const r = after.get(id);
        if (!r) return `${id}:missing`;
        const s = r.lastAttempt && r.lastAttempt.at && Date.parse(r.lastAttempt.at) >= t0 ? 'FAILED(kept-old)' : r.error ? 'FAILED' : r.idle ? 'converged' : 'NOT-idle';
        return `${id}:${s}:${Math.round(((s.startsWith('FAILED(') ? r.lastAttempt.ms : r.ms) || 0) / 60000)}min`;
      });
      log(`[group-exit] ${g.ids.join(',')} code=${code} ${Math.round((Date.now() - t0) / 60000)} min ${stamp()} | ${summary.join(' ')}`);
    }
  }
} finally {
  if (server) await server.close().catch(() => {});
}
const left = pending();
log(`[batch-done] ${stamp()} not converged yet: ${left.length ? left.join(',') : 'none'}`);
process.exit(0);
