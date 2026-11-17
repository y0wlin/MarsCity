// Priority worker pool (main thread). All heavy deterministic generation (terrain tiles,
// tile textures, city tiles, building geometry) runs in these module workers.
//
//   const job = app.workers.submit('terrainTile', payload, { priority, transfer });
//   job.promise.then(result => ...); job.cancel(); job.priority = newValue;  // lower runs first
//
// Handlers live in src/workers/handlers/*.js and are registered in handlers/index.js.

let NEXT_ID = 1;

/**
 * Default pool size: all cores but two for a real visitor, at most MAX_DEFAULT_WORKERS. Automated sessions
 * (headless test browsers set navigator.webdriver) default to 3 so that many concurrent verification runs do
 * not oversubscribe the machine. `?workers=N` overrides both.
 *
 * Why the cap (final-capture diagnosis, notes/final-capture.md): every world worker keeps its own world-function
 * caches and scratch buffers, and all JS heaps of the page live in one renderer process. In the densest ZR1 views
 * (C01–C04: 1 km over the public tower / main station) 8 workers ran the tab into a V8 out-of-memory crash
 * within 90–150 s and 6 workers within ~270 s, while 4 workers stayed stable. On a 4 performance + 6 efficiency
 * core laptop 4 → 8 workers only adds ~20–30 % tile throughput, so the cap costs little speed.
 */
export const MAX_DEFAULT_WORKERS = 4;
export function defaultPoolSize() {
  const hw = Math.max(2, (navigator.hardwareConcurrency || 8) - 2);
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    const n = parseInt(q.get('workers'), 10);
    if (n > 0) return Math.min(32, n);
  } catch { /* no location */ }
  if (navigator.webdriver) return Math.min(3, hw);
  return Math.min(MAX_DEFAULT_WORKERS, hw);
}

export class WorkerPool {
  constructor(size = defaultPoolSize()) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.queue = [];      // pending jobs
    this.running = new Map(); // id -> job
    this.ready = null;
    this.stats = { submitted: 0, completed: 0, cancelled: 0, failed: 0 };
    // per job type: n, compute ms in the worker (sum / max), queue wait and result delivery lag (sum, ms)
    this.byType = {};
  }

  /** Spawn workers and install shared world data (control maps) in each. */
  init(initPayload) {
    const readies = [];
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module', name: `world-${i}` });
      w.onmessage = (e) => this._onMessage(w, e.data);
      w.onerror = (e) => console.error('[worker error]', e.message || e);
      this.workers.push(w);
      readies.push(new Promise((res) => { w._readyResolve = res; }));
      // structured clone copies the typed arrays into each worker
      w.postMessage({ id: 0, type: '__init', payload: initPayload });
    }
    this.ready = Promise.all(readies).then(() => { this.idle.push(...this.workers); this._pump(); });
    return this.ready;
  }

  submit(type, payload, { priority = 0, transfer = [] } = {}) {
    const job = { id: NEXT_ID++, type, payload, transfer, priority, cancelled: false, started: false, t: performance.now() };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.cancel = () => {
      if (job.cancelled) return; job.cancelled = true; this.stats.cancelled++;
      if (!job.started) { const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1); }
      job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    };
    this.queue.push(job); this.stats.submitted++;
    this._pump();
    return job;
  }

  /** convenience */
  run(type, payload, opts) { return this.submit(type, payload, opts).promise; }

  get pending() { return this.queue.length + this.running.size; }

  /** rounded per-type summary: {type: {n, avg, max, wait, lag}} (avg/wait/lag are means in ms) */
  typeStats() {
    const o = {};
    for (const [k, b] of Object.entries(this.byType)) o[k] = { n: b.n, avg: Math.round(b.ms / b.n), max: Math.round(b.max), wait: Math.round(b.wait / b.n), lag: Math.round(b.lag / b.n) };
    return o;
  }

  _pump() {
    if (!this.idle.length || !this.queue.length) return;
    // lowest priority value first; stable by id
    this.queue.sort((a, b) => (a.priority - b.priority) || (a.id - b.id));
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift();
      if (job.cancelled) continue;
      const w = this.idle.pop();
      job.started = true; job.worker = w; job.ts = performance.now();
      this.running.set(job.id, job);
      w.postMessage({ id: job.id, type: job.type, payload: job.payload }, job.transfer);
    }
  }

  _onMessage(w, msg) {
    if (msg.type === '__ready') { w._readyResolve?.(); return; }
    if (msg.type === '__log') { console.log(`[${w.name || 'worker'}]`, ...msg.args); return; }
    const job = this.running.get(msg.id);
    this.running.delete(msg.id);
    this.idle.push(w);
    if (job && msg.ms !== undefined) {
      const b = this.byType[job.type] || (this.byType[job.type] = { n: 0, ms: 0, max: 0, wait: 0, lag: 0 });
      b.n++; b.ms += msg.ms; if (msg.ms > b.max) b.max = msg.ms;
      b.wait += (job.ts || job.t) - job.t;
      if (msg.done) b.lag += Math.max(0, performance.timeOrigin + performance.now() - msg.done);
    }
    if (job && !job.cancelled) {
      if (msg.ok) { this.stats.completed++; job.resolve(msg.result); }
      else { this.stats.failed++; console.error(`[worker job ${job.type} failed]`, msg.error); job.reject(new Error(msg.error)); }
    }
    this._pump();
  }
}
