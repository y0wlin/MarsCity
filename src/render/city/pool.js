// Dedicated worker pool of the city streamer (city.worker.js). Same API as app.workers
// (workers/pool.js WorkerPool: submit(type, payload, {priority, transfer}) → job {promise, cancel(),
// priority, started}); only the worker script differs. Falls back to the shared pool when module
// workers cannot be created. OWNER: city agent.
import { WorkerPool } from '../../workers/pool.js';
import { getControlMaps } from '../../data/controlMaps.js';

export class CityWorkerPool extends WorkerPool {
  init(initPayload) {
    const readies = [];
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('./city.worker.js', import.meta.url), { type: 'module', name: `city-${i}` });
      w.onmessage = (e) => this._onMessage(w, e.data);
      w.onerror = (e) => console.error('[city worker error]', e.message || e);
      this.workers.push(w);
      readies.push(new Promise((res) => { w._readyResolve = res; }));
      w.postMessage({ id: 0, type: '__init', payload: initPayload });
    }
    this.ready = Promise.all(readies).then(() => { this.idle.push(...this.workers); this._pump(); });
    return this.ready;
  }
}

/**
 * City pool size: `?cityWorkers=N` overrides; with `?workers=N` (final captures) half of N (2..6);
 * automated sessions (navigator.webdriver: many verification runs share one machine) 2; a real
 * visitor 2 (the configuration verified in the densest ZR1 views together with the world pool's default cap of 4,
 * see workers/pool.js MAX_DEFAULT_WORKERS: more workers in one tab ran it out of memory there).
 */
export function cityPoolSize() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    const c = parseInt(q.get('cityWorkers'), 10);
    if (c > 0) return Math.min(16, c);
    const w = parseInt(q.get('workers'), 10);
    if (w > 0) return Math.max(2, Math.min(6, Math.round(w / 2)));
  } catch { /* no location */ }
  return 2;
}

/**
 * Create the city pool (cityPoolSize() workers). Returns null when it cannot be created (the caller
 * then uses app.workers).
 */
export function createCityPool() {
  try {
    const n = cityPoolSize();
    const pool = new CityWorkerPool(n);
    pool.init({ maps: getControlMaps() });
    return pool;
  } catch (e) {
    console.warn('[city] dedicated worker pool unavailable, using the shared pool', e);
    return null;
  }
}
