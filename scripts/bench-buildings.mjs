#!/usr/bin/env node
// Building-kit benchmark / robustness check (Node, same V8 maths as the workers). OWNER: building-kit.
//
//   node scripts/bench-buildings.mjs                 timings per LOD for the bench specs (R10 = 10-storey block)
//   node scripts/bench-buildings.mjs --runs 12       more runs per measurement
//   node scripts/bench-buildings.mjs --city          generate every building of a few real city tiles
//                                                    (urban.generateCityTile) at all LODs: errors, timings
//   node scripts/bench-buildings.mjs --city --tiles "4,2340,4321;..."   explicit L13 tiles face,x,y
//   node --cpu-prof --cpu-prof-dir=/tmp/prof scripts/bench-buildings.mjs --only R10-ZR1 --lod exterior --runs 30
import { initWorldNode } from './node-world.mjs';
import { generateBuilding, registerTypeModules, registeredTypes } from '../src/buildings/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(`--${k}`);
const here = path.dirname(fileURLToPath(import.meta.url));

// register every type module (Vite's import.meta.glob does this in the browser / workers)
const typeDir = path.resolve(here, '../src/buildings/types');
const rec = {};
for (const f of fs.readdirSync(typeDir)) if (f.endsWith('.js')) rec[f] = await import(pathToFileURL(path.join(typeDir, f)).href);
registerTypeModules(rec);

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const PROV = { ZR1: 7, ZR2: 8, ZR3: 9, ZR4: 10, ZR5: 11, ZR6: 12, OX1: 1 };
// same lots as src/dev/buildings.js (flat ground here)
const LOTS = [
  { id: 'R4-ZR1', use: 'residential', prov: 'ZR1', floors: 4, w: 22, d: 13 },
  { id: 'R10-ZR1', use: 'residential', prov: 'ZR1', floors: 10, w: 30, d: 14 },
  { id: 'T24-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 24, w: 26, d: 24 },
  { id: 'SR4-ZR5', use: 'shop_row', prov: 'ZR5', floors: 4, w: 28, d: 14, shared: { right: true } },
  { id: 'R6-ZR2', use: 'residential', prov: 'ZR2', floors: 6, w: 24, d: 14, style: 'zr_terrace' },
  { id: 'R5-ZR6', use: 'residential', prov: 'ZR6', floors: 5, w: 20, d: 12 },
  { id: 'R3-ZR4', use: 'residential', prov: 'ZR4', floors: 3, w: 16, d: 11 },
  { id: 'C3-ZR1', use: 'clinic', prov: 'ZR1', floors: 3, w: 26, d: 16 },
  { id: 'D3-OX1', use: 'dorm', prov: 'OX1', zone: 'O', floors: 3, w: 20, d: 11 },
  { id: 'RW2-ZR1', use: 'residential', prov: 'ZR1', floors: 3, w: 8.6, d: 11, shared: { left: true, right: true }, roof: 'pitched', rk: 'warm', tier: 'lowrise' },
  { id: 'H2-ZR3', use: 'residential', prov: 'ZR3', floors: 2, w: 13, d: 10, roof: 'pitched', rk: 'ceramic', tier: 'lowrise' },
  { id: 'SH3-ZR1', use: 'shop_row', prov: 'ZR1', floors: 3, w: 7.5, d: 12, shared: { left: true, right: true }, roof: 'flat', rk: 'ceramic', tier: 'lowrise' },
  { id: 'T30R-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 30, w: 28, d: 28, roof: 'garden', rk: 'garden', shape: 'round', tier: 'tower' },
  { id: 'TP26-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 26, w: 48, d: 40, roof: 'garden', rk: 'garden', shape: 'tower', tier: 'tower', meta: { podium: { floors: 4, height: 20, floorHeight: 5 }, tower: { w: 24, d: 24, x: 0, z: -4, shape: 'rect' } } },
  { id: 'TPR30-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 30, w: 52, d: 44, roof: 'garden', rk: 'glass', shape: 'tower', tier: 'tower', meta: { podium: { floors: 3, height: 15, floorHeight: 5 }, tower: { w: 26, d: 26, x: 3, z: -5, shape: 'round' } } },
];
function makeSpec(L) {
  return {
    id: L.id, hash: fnv(L.id), version: 1, use: L.use, province: PROV[L.prov] || 7, provinceCode: L.prov, zone: L.zone || 'Z', style: L.style || '',
    lat: 22, lon: 118, heading: 180, ground: { entrance: 0, min: 0, max: 0 }, footprint: { shape: L.shape || 'rect', w: L.w, d: L.d }, tier: L.tier || (L.floors > 12 ? 'tower' : 'midrise'),
    floors: L.floors, floorHeight: 3.1, basement: 0, roof: L.roof || 'flat', sharedWalls: L.shared || {},
    entrances: [{ kind: 'main', side: 'front', offset: 0 }, { kind: 'service', side: 'back', offset: 0 }], occupancy: 0.8, yearBuilt: 2380, meta: { roofKind: L.rk || 'ceramic', ...(L.meta || {}) },
  };
}

// wall time AND process CPU time (robust when the machine is loaded by other jobs)
function time(spec, lod, runs) {
  const ms = [], cpu = [];
  let data = null;
  for (let i = 0; i < runs; i++) {
    const c0 = process.cpuUsage(), t0 = performance.now();
    data = generateBuilding(spec, lod);
    ms.push(performance.now() - t0);
    const c = process.cpuUsage(c0); cpu.push((c.user + c.system) / 1000);
  }
  ms.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
  return { median: +ms[Math.floor(ms.length / 2)].toFixed(2), min: +ms[0].toFixed(2), cpu: +cpu[Math.floor(cpu.length / 2)].toFixed(2), tris: data.stats.triangles, verts: data.stats.vertices, parts: data.stats.parts, col: data.stats.colliderTriangles || 0, type: data.stats.type, error: data.stats.error ? data.stats.error.split('\n')[0] : undefined };
}

const runs = +opt('runs', 8);
if (!has('city')) {
  const only = opt('only');
  const lods = opt('lod') ? [opt('lod')] : ['mass', 'exterior', 'full'];
  // warm up (JIT) once on everything
  for (const L of LOTS) for (const lod of lods) generateBuilding(makeSpec(L), lod);
  const out = {};
  for (const L of LOTS) {
    if (only && L.id !== only) continue;
    const s = makeSpec(L);
    out[L.id] = {};
    for (const lod of lods) out[L.id][lod] = time(s, lod, runs);
  }
  for (const [id, r] of Object.entries(out)) {
    console.log(id.padEnd(10), Object.entries(r).map(([lod, x]) => `${lod}: ${String(x.median).padStart(7)} ms (min ${x.min}, cpu ${x.cpu}) ${String(x.tris).padStart(7)} tris${x.col ? ` col ${x.col}` : ''}${x.error ? ' ERR ' + x.error : ''}`).join(' | '));
  }
  if (has('json')) console.log(JSON.stringify(out));
} else {
  initWorldNode();
  const { generateCityTile } = await import('../src/world/urban.js');
  const tiles = (opt('tiles') || '').split(';').filter(Boolean).map((t) => t.split(',').map(Number));
  if (!tiles.length) {
    // find some populated L13 tiles around a few anchors (ZR1 coast, ZR2 canyon, ZR6, OX1)
    const { latLonToUnit, tileAt } = await import('../src/core/geo.js');
    for (const [lat, lon] of [[22, 118], [35, -105], [22, -15], [8, 165], [-46, 105], [-65, -105], [8, 105], [-28, -45]]) {
      const p = latLonToUnit(lat, lon, {}); const t = tileAt(p.x, p.y, p.z, 13, {}); tiles.push([t.face, t.x, t.y]);
    }
  }
  const stats = { buildings: 0, errors: 0, byUse: {}, slow: [] };
  const maxN = +opt('max', 400);
  for (const [face, x, y] of tiles) {
    let T;
    try { T = generateCityTile(face, x, y); } catch (e) { console.log('tile fail', face, x, y, e.message); continue; }
    const list = T.buildings.slice(0, maxN);
    console.log(`tile ${face}/${x}/${y}: ${T.buildings.length} buildings`);
    for (const spec of list) {
      for (const lod of ['mass', 'exterior', 'full']) {
        if (lod === 'full' && list.indexOf(spec) % 5) continue;   // sample interiors
        if (globalThis.gc && has('gc')) globalThis.gc();
        const t0 = performance.now();
        const d = generateBuilding(spec, lod);
        const ms = performance.now() - t0;
        stats.buildings++;
        const u = stats.byUse[spec.use] || (stats.byUse[spec.use] = { n: 0, ms: { mass: 0, exterior: 0, full: 0 }, tris: { mass: 0, exterior: 0, full: 0 }, cnt: { mass: 0, exterior: 0, full: 0 }, err: 0, shapes: {}, roofs: {} });
        u.n++; u.ms[lod] += ms; u.tris[lod] += d.stats.triangles; u.cnt[lod]++;
        u.shapes[spec.footprint.shape] = (u.shapes[spec.footprint.shape] || 0) + 1; u.roofs[spec.roof] = (u.roofs[spec.roof] || 0) + 1;
        if (d.stats.error) { stats.errors++; u.err++; if (u.err <= 2) console.log('ERR', spec.id, spec.use, lod, d.stats.error.split('\n').slice(0, 3).join(' | ')); }
        if (!d.stats.triangles) console.log('EMPTY', spec.id, spec.use, lod);
        if (ms > 150) stats.slow.push(`${spec.id} ${spec.use} ${lod} ${ms.toFixed(0)}ms f${spec.floors} ${spec.footprint.w}x${spec.footprint.d}`);
      }
    }
  }
  console.log(`generated ${stats.buildings}, errors ${stats.errors}`);
  for (const [use, u] of Object.entries(stats.byUse)) {
    const f = (k) => (u.cnt[k] ? `${(u.ms[k] / u.cnt[k]).toFixed(1)}ms/${Math.round(u.tris[k] / u.cnt[k])}t` : '-');
    console.log(use.padEnd(18), String(u.n).padStart(4), 'mass', f('mass').padEnd(14), 'ext', f('exterior').padEnd(16), 'full', f('full').padEnd(16), JSON.stringify(u.shapes), JSON.stringify(u.roofs), u.err ? 'ERR ' + u.err : '');
  }
  if (stats.slow.length) console.log('slow:', stats.slow.slice(0, 20).join('\n  '));
  void registeredTypes;
}
