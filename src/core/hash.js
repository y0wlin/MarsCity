// Deterministic hashing and seeded PRNGs. Pure JS, worker-safe, float64-free integer maths.
// All world generation derives randomness from these so that the same (seed, inputs)
// always produce the same object on every thread and every reload.

import { SEED } from './constants.js';

/** murmur3 finaliser */
export function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash up to 4 integers (+ world seed) into a uint32. Inputs are truncated to int32. */
export function hash4(a = 0, b = 0, c = 0, d = 0, seed = SEED) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a | 0), 0xcc9e2d51); h = (h << 15) | (h >>> 17);
  h = Math.imul(h ^ (b | 0), 0x1b873593); h = (h << 13) | (h >>> 19);
  h = Math.imul(h ^ (c | 0), 0xcc9e2d51); h = (h << 15) | (h >>> 17);
  h = Math.imul(h ^ (d | 0), 0x1b873593); h = (h << 13) | (h >>> 19);
  return fmix32(h ^ 16);
}

/** Hash an arbitrary list of integers. */
export function hashN(list, seed = SEED) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < list.length; i++) {
    h = Math.imul(h ^ (list[i] | 0), i & 1 ? 0x1b873593 : 0xcc9e2d51);
    h = (h << 15) | (h >>> 17);
  }
  return fmix32(h ^ list.length);
}

/** uniform [0,1) from 4 ints */
export function rand01(a = 0, b = 0, c = 0, d = 0, seed = SEED) {
  return hash4(a, b, c, d, seed) / 4294967296;
}

/** FNV-1a string hash */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small fast seeded PRNG. Returns a function producing [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience RNG object with helpers, seeded deterministically. */
export class Rng {
  constructor(seed) { this.next = mulberry32(seed >>> 0); }
  float(min = 0, max = 1) { return min + (max - min) * this.next(); }
  int(min, maxInclusive) { return min + Math.floor(this.next() * (maxInclusive - min + 1)); }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** weighted pick: items [{w, v}] or parallel arrays */
  weighted(values, weights) {
    let sum = 0; for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < values.length; i++) { r -= weights[i]; if (r <= 0) return values[i]; }
    return values[values.length - 1];
  }
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-12, this.next()), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Encode a 32-bit hash as a short base36 string, used in stable IDs. */
export function hashTag(h) {
  return (h >>> 0).toString(36).padStart(7, '0');
}
