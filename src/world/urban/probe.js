// Guarded access to the lower world layers (terrain + hydro) used by the plan.
// hydro.canalsInTile is optional (not every hydro version provides it): accessed through the
// module namespace so a missing export never breaks linking.
import { heightAt } from '../terrain.js';
import * as hydro from '../hydro.js';
import { onClearAll } from './lru.js';

const W = { type: 0, level: 0, depth: 0, dist: 1e9, width: 0, flow: [0, 0] };

export const hasCanals = () => typeof hydro.canalsInTile === 'function';

/**
 * Probe ground + water at a unit vector. out: h (m), water (0 none | 1 sea | 2 canal | 3 lake;
 * only when submerged), level, depth, cdist (m to canal centreline, 1e9 unknown), cwidth, fe, fn.
 */
export function probe(x, y, z, minWl, out) {
  const h = heightAt(x, y, z, minWl);
  out.h = h;
  let t = 0, level = 0, depth = -h, cdist = 1e9, cw = 0, fe = 0, fn = 0;
  try {
    hydro.waterAt(x, y, z, W);
    level = W.level || 0;
    depth = W.depth !== undefined ? W.depth : level - h;
    if (W.type && depth > 0) t = W.type;
    if (W.dist !== undefined && W.dist < 1e8) { cdist = W.dist; cw = W.width || 0; }
    if (W.flow) { fe = W.flow[0] || 0; fn = W.flow[1] || 0; }
  } catch (e) { if (h < 0) { t = 1; depth = -h; } }
  if (!t && h < -0.5 && W.type === undefined) t = 1;
  out.water = t; out.level = level; out.depth = depth; out.cdist = cdist; out.cwidth = cw; out.fe = fe; out.fn = fn;
  return out;
}

/** height only */
export function groundAt(x, y, z, minWl = 0) { return heightAt(x, y, z, minWl); }

/** canals clipped to a quadtree tile, or [] when hydro has no vector canal network */
export function canalsIn(face, level, x, y) {
  if (!hasCanals()) return [];
  try { return hydro.canalsInTile(face, level, x, y) || []; } catch (e) { return []; }
}

const W2 = { type: 0, level: 0, depth: 0, dist: 1e9, width: 0, flow: [0, 0] };
/**
 * Is the ground at p under water as the water renderer will show it? (terrain below 0.3 m or a
 * hydro water body covering it). Returns the ground height in wet.h.
 */
export function isWet(x, y, z, minWl = 2) {
  const h = heightAt(x, y, z, minWl);
  isWet.h = h;
  if (h < 0.3) return true;
  try { hydro.waterAt(x, y, z, W2); if (W2.type && (W2.depth !== undefined ? W2.depth : W2.level - h) > 0) return true; } catch (e) { /* ignore */ }
  return false;
}
isWet.h = 0;

// ---- v2 helpers (urban plan 2.x) ------------------------------------------------------------
/** lakes / reservoirs clipped to a tile ([] when hydro does not provide the helper) */
const lakeMemo = new Map();
onClearAll(() => lakeMemo.clear());
export function lakesIn(face, level, x, y) {
  if (typeof hydro.lakesInTile !== 'function') return [];
  const k = `${face}/${level}/${x}/${y}`;
  let v = lakeMemo.get(k);
  if (v !== undefined) return v;
  try { v = hydro.lakesInTile(face, level, x, y) || []; } catch (e) { v = []; }
  if (lakeMemo.size > 4096) lakeMemo.clear();
  lakeMemo.set(k, v);
  return v;
}

const W3 = { type: 0, level: 0, depth: 0, dist: 1e9, width: 0, flow: [0, 0] };
/** hydro water type at p when submerged (0 none | 1 sea | 2 canal/river | 3 lake), depth in waterProbe.depth */
export function waterProbe(x, y, z) {
  let t = 0;
  try {
    hydro.waterAt(x, y, z, W3);
    const depth = W3.depth !== undefined ? W3.depth : (W3.level || 0) - (W3.ground || 0);
    waterProbe.depth = depth;
    waterProbe.level = W3.level || 0; waterProbe.kind = W3.kind || ''; waterProbe.rawType = W3.type || 0;
    waterProbe.dist = W3.dist !== undefined ? W3.dist : 1e9;
    waterProbe.width = W3.width || 0;
    waterProbe.fe = W3.flow ? W3.flow[0] || 0 : 0; waterProbe.fn = W3.flow ? W3.flow[1] || 0 : 0;
    if (W3.type && depth > 0) t = W3.type;
  } catch (e) { waterProbe.depth = 0; waterProbe.dist = 1e9; waterProbe.width = 0; waterProbe.fe = 0; waterProbe.fn = 0; waterProbe.level = 0; waterProbe.kind = ''; waterProbe.rawType = 0; }
  return t;
}
waterProbe.depth = 0; waterProbe.dist = 1e9; waterProbe.width = 0; waterProbe.fe = 0; waterProbe.fn = 0; waterProbe.level = 0; waterProbe.kind = ''; waterProbe.rawType = 0;

let heightCalls = 0;
/** terrain height with call accounting (performance reports separate own time from terrain time) */
export function height(x, y, z, minWl = 0) { heightCalls++; return heightAt(x, y, z, minWl); }
export function heightCallCount() { return heightCalls; }

/** hydro.ox1Basin() (OX1 东泽汇水盆地: lake, outlet main with its sluices, sill) or null when hydro has none */
let basinMemo;
export function ox1BasinInfo() {
  if (basinMemo === undefined) { try { basinMemo = typeof hydro.ox1Basin === 'function' ? hydro.ox1Basin() : null; } catch (e) { basinMemo = null; } }
  return basinMemo;
}
