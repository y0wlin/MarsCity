// Tiny approximate-LRU cache (two generations of Map). O(1) get/set, no per-hit reordering.
// A hit in the old generation is promoted; when the young generation is full it becomes the old
// one and the previous old generation is dropped. Keys are numbers or strings.
const ALL = [];
const HOOKS = [];
/** register an extra reset for module-level memo state that is not an Lru (single-entry caches, Maps) */
export function onClearAll(fn) { HOOKS.push(fn); }
/** drop every urban cache (benchmarks, memory pressure); results are unchanged (pure functions) */
export function clearAllLru() { for (const c of ALL) c.clear(); for (const f of HOOKS) f(); }
/** cache occupancy (diagnostics): [{name, size, hits, misses}] */
export function lruStats() { return ALL.map((c) => ({ name: c.name, size: c.size, hits: c.hits, misses: c.misses })); }

export class Lru {
  constructor(capacity = 1024, name = '') {
    ALL.push(this);
    this.name = name;
    this.cap = Math.max(8, capacity | 0);
    this.young = new Map();
    this.old = new Map();
    this.hits = 0; this.misses = 0;
  }
  get(key) {
    let v = this.young.get(key);
    if (v !== undefined) { this.hits++; return v; }
    v = this.old.get(key);
    if (v !== undefined) { this.hits++; this.old.delete(key); this._put(key, v); return v; }
    this.misses++;
    return undefined;
  }
  set(key, value) { this._put(key, value); return value; }
  _put(key, value) {
    if (this.young.size >= this.cap) { this.old = this.young; this.young = new Map(); }
    this.young.set(key, value);
  }
  /** get or compute */
  use(key, fn) {
    let v = this.get(key);
    if (v === undefined) { v = fn(key); this._put(key, v); }
    return v;
  }
  clear() { this.young.clear(); this.old.clear(); }
  get size() { return this.young.size + this.old.size; }
}
