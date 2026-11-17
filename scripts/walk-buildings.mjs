#!/usr/bin/env node
// Building-kit walkability check of the 'full' LOD colliders (OWNER: building-kit).
// 2.5-D flood fill over the collider mesh (three-mesh-bvh): a walker with the app's walk-mode capsule
// (WALK from src/controls/modes/walk.js: radius 0.28 m, step 0.35 m, height 1.8 m, eye 1.65 m) starts
// on the street in front of the main entrance and may step up/down ≤ WALK.step per 0.25 m cell, needs
// WALK.height + 0.1 m headroom and is blocked by any collider crossed at step / waist / head height.
// Reports which anchors are reachable: lobby, stair (floor 0), every floor's landing / corridor,
// the 2nd-floor living room and the back door.
//
//   node scripts/walk-buildings.mjs                 bench specs R10-ZR1, SR4-ZR5, RW2-ZR1, T24-ZR1
//   node scripts/walk-buildings.mjs --only R10-ZR1 --png shots/building-kit/walk_r10.png
//   node scripts/walk-buildings.mjs --only RW2-ZR1 --verbose      (lists the rooms that were not reached)
//   node scripts/walk-buildings.mjs --only R5-ZR6 --png out.png --floor 0 --scale 4   (plan map of one floor)
//   node scripts/walk-buildings.mjs --id ZR1-0.3.1a5.17w-n8.n6-7      (real city building by id, e.g. shot 07)
//   node scripts/walk-buildings.mjs --around ZR5-0.3.12d.p-5.n8-5 --family slab --n 50 --quiet
//        regression over real buildings: L13 city tiles spiralling out from the seed building's tile,
//        family slab | house | tower | dorm | shop | narrow (short side < 8 m, ≥ 4 storeys) | any (plan
//        families of the residential pipeline);
//        prints only failures with --quiet, always a SUMMARY line (buildings fully walkable / total)
//   --ids-file <path>   ids separated by commas / whitespace
//   --floors N          (diagnostics) regenerate the given real buildings with N storeys (fast tower checks)
//   reports also `roof` (anchors.roof.access reached, ≥ 4 storeys) next to lobby / stair / living / back door
//   --zfight [full|exterior|both]   instead of walking: find coplanar overlapping faces (z-fighting) of
//        different parts / materials facing the same way (≥ 2 cm², planes < 3 mm apart); foliage cards skipped
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateBuilding, registerTypeModules } from '../src/buildings/index.js';
import { normalizeSpec, groundAt } from '../src/buildings/kit/spec.js';
import { writePng } from './node-world.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
const typeDir = path.resolve(here, '../src/buildings/types');
const rec = {};
for (const f of fs.readdirSync(typeDir)) if (f.endsWith('.js')) rec[f] = await import(pathToFileURL(path.join(typeDir, f)).href);
registerTypeModules(rec);

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const LOTS = [
  { id: 'R10-ZR1', use: 'residential', prov: 'ZR1', floors: 10, w: 30, d: 14, roof: 'garden', rk: 'garden' },
  { id: 'SR4-ZR5', use: 'shop_row', prov: 'ZR5', floors: 4, w: 28, d: 14, shared: { right: true }, rk: 'ceramic' },
  { id: 'RW2-ZR1', use: 'residential', prov: 'ZR1', floors: 3, w: 8.6, d: 11, shared: { left: true, right: true }, roof: 'pitched', rk: 'warm', tier: 'lowrise' },
  { id: 'R5-ZR6', use: 'residential', prov: 'ZR6', floors: 5, w: 20, d: 12, roof: 'pitched', rk: 'metal' },
  { id: 'T24-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 24, w: 26, d: 24, roof: 'garden', rk: 'ceramic' },
  { id: 'R6W-ZR1', use: 'residential', prov: 'ZR1', floors: 6, w: 46, d: 14, roof: 'flat', rk: 'ceramic' },
];
const PROV = { ZR1: 7, ZR2: 8, ZR3: 9, ZR4: 10, ZR5: 11, ZR6: 12 };
const makeSpec = (L) => ({
  id: L.id, hash: fnv(L.id), version: 1, use: L.use, province: PROV[L.prov] || 7, provinceCode: L.prov, zone: 'Z', style: '',
  lat: 22, lon: 118, heading: 180, ground: { entrance: 0, min: 0, max: 0 }, footprint: { shape: 'rect', w: L.w, d: L.d }, tier: L.tier || (L.floors > 12 ? 'tower' : 'midrise'),
  floors: L.floors, floorHeight: 3.1, basement: 0, roof: L.roof || 'flat', sharedWalls: L.shared || {},
  entrances: [{ kind: 'main', side: 'front', offset: 0 }, ...(L.shared && L.shared.back ? [] : [{ kind: 'service', side: 'back', offset: 0 }])], occupancy: 0.8, yearBuilt: 2380, meta: { roofKind: L.rk || 'ceramic' },
});

// walker = the app's walk mode (src/controls/modes/walk.js WALK: capsule radius 0.28 m, step 0.35 m,
// height 1.8 m); fallback values if that module cannot load in Node
let WALK = { radius: 0.28, step: 0.35, height: 1.8, eye: 1.65 };
try { const m = await import('../src/controls/modes/walk.js'); if (m.WALK) WALK = { ...WALK, ...m.WALK }; } catch (e) { console.warn('[walk] WALK constants not importable, using defaults:', e.message.split('\n')[0]); }
if (opt('radius')) WALK.radius = +opt('radius');      // diagnostics: --radius 0.22 --step 0.42
if (opt('step')) WALK.step = +opt('step');
const CELL = 0.25, STEP = WALK.step, HEAD = WALK.height + 0.1, RAD = WALK.radius;
// capsule probe heights above the feet: just over the step height, waist, head
const PROBE = opt("probe") ? opt("probe").split(",").map(Number) : [WALK.step + 0.1, 1.0, WALK.height - 0.1];
const _ray = new THREE.Raycaster();
_ray.firstHitOnly = false;

function walk(data, spec) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.colliders.position, 3));
  g.setIndex(new THREE.BufferAttribute(data.colliders.index, 1));
  const bvh = new MeshBVH(g, { targetLeafSize: 8 });
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const b = data.bounds;
  const x0 = b.min[0] - 3, x1 = b.max[0] + 3, z0 = b.min[2] - 3, z1 = b.max[2] + 5;
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const top = b.max[1] + 2;
  // ground outside the footprint (the street / yard): the terrain relative to the entrance level,
  // bilinear over the spec's corner heights and extended outwards (kit/spec.js groundAt: a sloping
  // site keeps its street at the level the entrance steps were built down to, not at the lowest corner)
  const ns = normalizeSpec(spec);
  const groundOf = (x, z) => groundAt(ns, x, z);
  const groundY = Math.min(0, (spec.ground.min ?? 0) - (spec.ground.entrance ?? 0));
  const ray = new THREE.Ray();
  const dn = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  // nodes: per column a sorted list of floor heights with headroom
  const cols = new Array(nx * nz);
  let nNodes = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL;
    ray.origin.set(x, top, z); ray.direction.copy(dn);
    const hits = bvh.raycast(ray, THREE.DoubleSide).map((h) => h.point.y).sort((a, c) => c - a);
    const inside = spec.footprint.shape === 'round' ? Math.hypot(x, z) < spec.footprint.w / 2 : x > -spec.footprint.w / 2 && x < spec.footprint.w / 2 && z > -spec.footprint.d / 2 && z < spec.footprint.d / 2;
    if (!inside) { const gy = groundOf(x, z); hits.push(gy); hits.sort((a, c) => c - a); }
    const ys = [];
    for (let k = 0; k < hits.length; k++) {
      const y = hits[k];
      if (ys.length && Math.abs(ys[ys.length - 1] - y) < 0.05) continue;
      // headroom: next surface above
      ray.origin.set(x, y + 0.03, z); ray.direction.copy(up);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance < HEAD) continue;
      ys.push(y);
    }
    cols[j * nx + i] = { ys, id0: nNodes };
    nNodes += ys.length;
  }
  const visited = new Uint8Array(nNodes);
  const nodeY = new Float32Array(nNodes), nodeI = new Int32Array(nNodes), nodeJ = new Int32Array(nNodes);
  for (let c = 0; c < cols.length; c++) { const C = cols[c]; for (let k = 0; k < C.ys.length; k++) { nodeY[C.id0 + k] = C.ys[k]; nodeI[C.id0 + k] = c % nx; nodeJ[C.id0 + k] = Math.floor(c / nx); } }
  const blocked = (xa, za, ya, xb, zb) => {
    const dx = xb - xa, dz = zb - za, L = Math.hypot(dx, dz);
    for (const hh of PROBE) {
      ray.origin.set(xa, ya + hh, za); ray.direction.set(dx / L, 0, dz / L);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance < L + RAD) return true;
    }
    return false;
  };
  const nodeAt = (x, z, y) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return -1;
    const C = cols[j * nx + i];
    let best = -1, bd = 0.6;
    for (let k = 0; k < C.ys.length; k++) { const d = Math.abs(C.ys[k] - y); if (d < bd) { bd = d; best = C.id0 + k; } }
    return best;
  };
  // start on the street 3 m in front of the main entrance
  const ent = (data.anchors.entrances || []).find((e) => e.kind === 'main') || { pos: [0, 0, spec.footprint.d / 2 + 0.6] };
  let s0 = nodeAt(ent.pos[0], spec.footprint.d / 2 + 2.5, groundOf(ent.pos[0], spec.footprint.d / 2 + 2.5));
  if (s0 < 0) s0 = nodeAt(ent.pos[0], spec.footprint.d / 2 + 2.5, groundY);
  if (s0 < 0) s0 = nodeAt(ent.pos[0], spec.footprint.d / 2 + 2.5, 0);          // entrance landing / forecourt level
  if (s0 < 0) s0 = nodeAt(ent.pos[0], ent.pos[2], ent.pos[1]);                // the entrance anchor itself
  const q = s0 >= 0 ? [s0] : []; if (s0 >= 0) visited[s0] = 1;
  while (q.length) {
    const n = q.pop();
    const i = nodeI[n], j = nodeJ[n], y = nodeY[n];
    const xa = x0 + (i + 0.5) * CELL, za = z0 + (j + 0.5) * CELL;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const C = cols[jj * nx + ii];
      for (let k = 0; k < C.ys.length; k++) {
        const m = C.id0 + k;
        if (visited[m] || Math.abs(C.ys[k] - y) > STEP) continue;
        const xb = x0 + (ii + 0.5) * CELL, zb = z0 + (jj + 0.5) * CELL;
        if (blocked(xa, za, Math.max(y, C.ys[k]), xb, zb)) continue;
        visited[m] = 1; q.push(m);
      }
    }
  }
  const reach = (p) => { const n = nodeAt(p[0], p[2], p[1]); return n >= 0 && visited[n] === 1; };
  const A = data.anchors, C = A.cameras || {};
  const out = { nodes: nNodes, reached: visited.reduce((a, v) => a + v, 0), start: s0 >= 0 };
  if (C.lobby) out.lobby = reach([C.lobby.pos[0], C.lobby.pos[1] - 1.65, C.lobby.pos[2]]);
  if (C.stair) out.stairFoot = reach([C.stair.pos[0], C.stair.pos[1] - 1.65, C.stair.pos[2]]);
  if (C.living) out.living2F = reach([C.living.pos[0], C.living.pos[1] - 1.65, C.living.pos[2]]);
  const back = (A.entrances || []).find((e) => e.kind === 'service' || e.kind === 'back');
  // back door: a reached node outside it — on the landing, the steps down a sloping yard or the ground
  // 1–4 m out along the door's normal, at any height between the yard and the door sill (the old single
  // probe 1.5 m out at ground level missed doors whose steps run further out: sloped sites)
  if (back) {
    let ok = false;
    for (let t = 1.0; t <= 4.01 && !ok; t += 0.25) {
      const bx = back.pos[0] + back.dir[0] * t, bz = back.pos[2] + back.dir[2] * t;
      const i = Math.floor((bx - x0) / CELL), j = Math.floor((bz - z0) / CELL);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const Cc = cols[j * nx + i], ylo = Math.min(groundOf(bx, bz), back.pos[1]) - 0.4, yhi = back.pos[1] + 0.4;
      for (let k = 0; k < Cc.ys.length && !ok; k++) if (Cc.ys[k] >= ylo && Cc.ys[k] <= yhi && visited[Cc.id0 + k]) ok = true;
    }
    out.backDoorOutside = ok;
  }
  // roof exit (stair house door / hatch): any reached node within 1 m of anchors.roof.access
  if (A.roof && A.roof.access && (A.floors || []).length >= 4) {
    const [ax, ay, az] = A.roof.access;
    let ok = false;
    for (let dx = -1; dx <= 1 && !ok; dx += 0.25) for (let dz = -1; dz <= 1 && !ok; dz += 0.25) { const n = nodeAt(ax + dx, az + dz, ay + 0.3); ok = n >= 0 && visited[n] === 1 && Math.abs(nodeY[n] - ay) < 0.9; }
    out.roof = ok;
  }
  // every floor: is any node at that floor level reached?
  const fl = [];
  for (const f of A.floors || []) {
    let hit = 0, tot = 0;
    for (let n = 0; n < nNodes; n++) if (Math.abs(nodeY[n] - f.y) < 0.06) { tot++; hit += visited[n]; }
    fl.push(tot ? Math.round((100 * hit) / tot) : -1);
  }
  out.floorsReachedPct = fl;
  // rooms reached (centre within 0.6 m of a visited node, search a small window)
  let rr = 0, rt = 0;
  for (const r of A.rooms || []) {
    if (r.kind === 'lift' || r.kind === 'stair' || r.kind === 'shaft') continue;
    rt++;
    let ok = false;
    for (let dx = -1; dx <= 1 && !ok; dx += 0.5) for (let dz = -1; dz <= 1 && !ok; dz += 0.5) ok = reach([r.center[0] + dx, r.center[1], r.center[2] + dz]);
    if (ok) rr++;
    else if (args.includes('--verbose')) (out.unreached || (out.unreached = [])).push(`${r.floor}:${r.kind}@${r.center.map((v) => v.toFixed(1)).join(',')}`);
  }
  out.roomsReached = `${rr}/${rt}`;
  return { out, cols, visited, nx, nz, nodeY, x0, z0 };
}

const only = opt('only');
const C_OUT = opt('json') ? [] : null;
// --id <buildingId>[,<id>…]: real city buildings (urban.buildingSpecById, control maps loaded in Node)
const REAL = [];
if (opt('id') || opt('ids-file') || opt('around')) {
  const { initWorldNode } = await import('./node-world.mjs');
  initWorldNode();
  const { buildingSpecById, generateCityTile } = await import('../src/world/urban.js');
  const ids = [];
  if (opt('id')) ids.push(...opt('id').split(','));
  if (opt('ids-file')) ids.push(...fs.readFileSync(opt('ids-file'), 'utf8').split(/[\s,]+/).filter(Boolean));
  // --floors N: diagnostics only — regenerate the real spec with N storeys (fast checks of tall towers)
  for (const id of ids) { const sp = buildingSpecById(id); if (sp) REAL.push({ id, spec: opt('floors') ? { ...sp, floors: +opt('floors') } : sp }); else console.log(id, 'no spec'); }
  if (opt('around')) {
    const geo = await import('../src/core/geo.js');
    const { isHouse } = await import('../src/buildings/types/residential_plan.js');
    const fam = opt('family', 'any'), N = +opt('n', 50);
    const famOf = (sp) => {
      if (sp.use === 'residential_tower') return 'tower';
      if (sp.use === 'dorm') return 'dorm';
      if (sp.use === 'residential' || sp.use === 'shop_row') {
        const ns = normalizeSpec(sp);
        return isHouse(ns, { ground: sp.use === 'shop_row' ? 'shops' : undefined }) ? 'house' : sp.use === 'shop_row' ? 'shop' : 'slab';
      }
      return 'other';
    };
    const seen = new Set(REAL.map((r) => r.id));
    for (const seedId of opt('around').split(',')) {
      const seed = buildingSpecById(seedId);
      if (!seed) { console.log(seedId, 'no spec'); continue; }
      const u = geo.latLonToUnit(seed.lat, seed.lon), t = geo.tileAt(u.x, u.y, u.z, 13);
      let got = 0;
      for (let ring = 0; ring < 12 && got < N; ring++) {
        for (let dx = -ring; dx <= ring && got < N; dx++) for (let dy = -ring; dy <= ring && got < N; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const tx = t.x + dx, ty = t.y + dy;
          if (tx < 0 || ty < 0 || tx >= 1 << 13 || ty >= 1 << 13) continue;
          const tile = generateCityTile(t.face, tx, ty, { buildingsOnly: true });
          for (const sp of tile.buildings || []) {
            if (got >= N || seen.has(sp.id)) continue;
            const f = famOf(sp);
            // 'narrow': residential / shop_row / dorm with a short side < 8 m and ≥ 4 storeys (QQ2-01 sample:
            // narrow plots and shallow blocks, whatever plan family they generate as)
            if (fam === 'narrow') { if (f === 'other' || f === 'tower' || Math.min(sp.footprint.w, sp.footprint.d) >= 8 || sp.floors < 4) continue; }
            else if (fam === 'any' ? f === 'other' : f !== fam) continue;
            seen.add(sp.id); REAL.push({ id: sp.id, spec: opt('floors') ? { ...sp, floors: Math.min(sp.floors, +opt('floors')) } : sp }); got++;
          }
        }
      }
      console.log(`[sample] ${got} ${fam} buildings around ${seedId}`);
    }
  }
}
/**
 * Coplanar overlapping faces (z-fighting candidates): triangles facing the same way whose planes are
 * < `tol` apart and whose projections overlap by ≥ `minArea`. Returns [{a, b, area, at}] grouped per
 * material pair (largest first). Skips alpha-tested foliage cards (they overlap by design).
 */
function zfightPairs(data, tol = 0.003, minArea = 2e-4) {
  const tris = [];   // [part, i0, i1, i2, nx, ny, nz, d]
  const P = [];
  data.parts.forEach((p, pi) => {
    if (p.material === 'foliage') return;
    const pos = p.position, idx = p.index;
    const n = idx ? idx.length : pos.length / 3;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx[t] : t, c = idx ? idx[t + 1] : t + 1, e = idx ? idx[t + 2] : t + 2;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const ux = pos[c * 3] - ax, uy = pos[c * 3 + 1] - ay, uz = pos[c * 3 + 2] - az;
      const vx = pos[e * 3] - ax, vy = pos[e * 3 + 1] - ay, vz = pos[e * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz);
      if (L < 2e-5) continue;                                   // degenerate (< 0.1 cm²)
      nx /= L; ny /= L; nz /= L;
      tris.push(pi, a, c, e, nx, ny, nz, nx * ax + ny * ay + nz * az);
    }
    P.push(p);
  });
  const N = tris.length / 8;
  const buckets = new Map();
  const qn = (v) => Math.round(v * 400);
  for (let t = 0; t < N; t++) {
    const o = t * 8, key = `${qn(tris[o + 4])},${qn(tris[o + 5])},${qn(tris[o + 6])},${Math.round(tris[o + 7] / tol)}`;
    let B = buckets.get(key); if (!B) buckets.set(key, (B = [])); B.push(t);
  }
  const vert = (t, k) => { const o = t * 8, p = data.parts[tris[o]].position, i = tris[o + 1 + k]; return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]; };
  // convex clip (Sutherland–Hodgman) of 2D polygons → overlap area
  const clip = (poly, a, b2) => { const out = []; const side = (p) => (b2[0] - a[0]) * (p[1] - a[1]) - (b2[1] - a[1]) * (p[0] - a[0]); for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q); if (sp >= 0) out.push(p); if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return out; };
  const area = (poly) => { let s2 = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s2 += p[0] * q[1] - q[0] * p[1]; } return s2 / 2; };
  const res = new Map();
  const seenPair = new Set();
  for (const [key, B0] of buckets) {
    // the bucket and its neighbour in d (planes closer than tol may straddle a bucket edge)
    const [kx, ky, kz, kd] = key.split(',').map(Number);
    const B1 = buckets.get(`${kx},${ky},${kz},${kd + 1}`) || [];
    const B = B0.concat(B1);
    if (B.length < 2) continue;
    const o0 = B[0] * 8, nx = tris[o0 + 4], ny = tris[o0 + 5], nz = tris[o0 + 6];
    // plane basis
    let ux = -nz, uy = 0, uz = nx; if (Math.hypot(ux, uz) < 0.3) { ux = 0; uy = nz; uz = -ny; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const pr = B.map((t) => { const pts = [0, 1, 2].map((k) => { const v = vert(t, k); return [v[0] * ux + v[1] * uy + v[2] * uz, v[0] * vx + v[1] * vy + v[2] * vz]; }); if (area(pts) < 0) pts.reverse(); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { t, pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
    pr.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < pr.length; i++) {
      const A = pr[i];
      for (let j = i + 1; j < pr.length && pr[j].x0 < A.x1 - 1e-4; j++) {
        const C = pr[j];
        if (C.y0 > A.y1 - 1e-4 || C.y1 < A.y0 + 1e-4) continue;
        const ta = A.t * 8, tc = C.t * 8;
        if (Math.abs(tris[ta + 7] - tris[tc + 7]) > tol) continue;
        if (tris[ta + 4] * tris[tc + 4] + tris[ta + 5] * tris[tc + 5] + tris[ta + 6] * tris[tc + 6] < 0.9995) continue;
        const pk = A.t < C.t ? `${A.t}:${C.t}` : `${C.t}:${A.t}`; if (seenPair.has(pk)) continue; seenPair.add(pk);
        let poly = A.pts;
        for (let k = 0; k < 3 && poly.length; k++) poly = clip(poly, C.pts[k], C.pts[(k + 1) % 3]);
        if (poly.length < 3) continue;
        const ar = area(poly);
        if (ar < minArea) continue;
        const ma = data.parts[tris[ta]].material, mc = data.parts[tris[tc]].material;
        const pair = ma < mc ? `${ma} | ${mc}` : `${mc} | ${ma}`;
        const r = res.get(pair) || { pair, area: 0, n: 0, at: vert(A.t, 0).map((v) => +v.toFixed(2)), normal: [nx, ny, nz].map((v) => +v.toFixed(2)), tris: [[0, 1, 2].map((k) => vert(A.t, k).map((v) => +v.toFixed(3))), [0, 1, 2].map((k) => vert(C.t, k).map((v) => +v.toFixed(3)))], parts: [tris[ta], tris[tc]] };
        r.area += ar; r.n++; res.set(pair, r);
      }
    }
  }
  return [...res.values()].sort((a, b) => b.area - a.area);
}

if (opt('zfight') !== undefined || args.includes('--zfight')) {
  const which = (opt('zfight') && !opt('zfight').startsWith('--')) ? opt('zfight') : 'both';
  const lods = which === 'both' ? ['exterior', 'full'] : [which];
  let total = 0;
  for (const L of REAL.length ? REAL : LOTS) {
    if (only && L.id !== only) continue;
    const spec = L.spec || makeSpec(L);
    for (const lod of lods) {
      const data = generateBuilding(spec, lod);
      const t0 = performance.now();
      const zp = zfightPairs(data);
      const a = zp.reduce((s2, r) => s2 + r.area, 0);
      total += a;
      console.log(`${L.id} ${lod} ${(performance.now() - t0).toFixed(0)}ms coplanar overlap ${a.toFixed(3)} m² in ${zp.length} material pairs`);
      for (const r of zp.slice(0, +opt('top', 8))) { console.log(`   ${r.area.toFixed(3)} m² ×${r.n}  ${r.pair}  at ${r.at.join(',')} n ${r.normal.join(',')}`); if (args.includes('--verbose')) console.log('      parts', r.parts.join(','), 'A', JSON.stringify(r.tris[0]), 'B', JSON.stringify(r.tris[1])); }
    }
  }
  console.log(`ZFIGHT total ${total.toFixed(3)} m²`);
  process.exit(0);
}

const SUM = { n: 0, ok: 0, rooms: 0, roomsReached: 0, fail: [] };
for (const L of REAL.length ? REAL : LOTS) {
  if (only && L.id !== only) continue;
  const spec = L.spec || makeSpec(L);
  const data = generateBuilding(spec, 'full');
  if (!data.colliders) { console.log(L.id, 'no colliders'); continue; }
  const t0 = performance.now();
  const r = walk(data, spec);
  const [rr, rt] = r.out.roomsReached.split('/').map(Number);
  const good = rr === rt && r.out.start && r.out.lobby !== false && r.out.stairFoot !== false && r.out.living2F !== false;
  SUM.n++; SUM.rooms += rt; SUM.roomsReached += rr; if (good) SUM.ok++; else SUM.fail.push(`${L.id} ${spec.use} ${r.out.roomsReached}${r.out.lobby === false ? ' lobby✗' : ''}${r.out.stairFoot === false ? ' stair✗' : ''}${r.out.living2F === false ? ' living✗' : ''}`);
  if (data.meta && data.meta.unreachableRooms) r.out.planUnreachable = data.meta.unreachableRooms;
  if (!args.includes('--quiet') || !good) console.log(L.id.padEnd(9), `${(performance.now() - t0).toFixed(0)}ms`, JSON.stringify(r.out));
  if (C_OUT) C_OUT.push({ id: L.id, ...r.out });
  if (opt('png')) {
    // plan map of the reachable nodes: brightness = height, red = unreachable walkable surface.
    // --floor N: the surface nearest to that floor's level (−1 m … +2.5 m) instead of the top one;
    // --scale S: pixels per cell (default 4)
    const S = +opt('scale', 4), fl = opt('floor') != null ? data.anchors.floors[+opt('floor')] : null;
    const W = r.nx, H = r.nz, img = new Uint8Array(W * H * S * S * 4);
    const maxY = data.bounds.max[1];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const C = r.cols[j * W + i];
      let best = null, vis = 0;
      for (let k = 0; k < C.ys.length; k++) {
        const y = C.ys[k];
        if (fl) { if (y < fl.y - 1.0 || y > fl.y + 2.5) continue; if (best === null || Math.abs(y - fl.y) < Math.abs(best - fl.y)) { best = y; vis = r.visited[C.id0 + k]; } }
        else if (best === null || y > best) { best = y; vis = r.visited[C.id0 + k]; }
      }
      let c;
      if (best === null) c = [20, 20, 24];
      else { const t = 60 + 180 * Math.max(0, fl ? (best - fl.y + 1) / 3.5 : best / Math.max(1, maxY)); c = vis ? [t * 0.6, t, t * 0.7] : [200, 40, 40]; }
      for (let a = 0; a < S; a++) for (let q = 0; q < S; q++) { const o = (((H - 1 - j) * S + a) * W * S + i * S + q) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; }
    }
    writePng(opt('png'), W * S, H * S, img);
  }
}

if (C_OUT) fs.writeFileSync(opt('json'), JSON.stringify({ walk: WALK, results: C_OUT }, null, 1));
console.log(`SUMMARY ${SUM.ok}/${SUM.n} buildings fully walkable, rooms ${SUM.roomsReached}/${SUM.rooms}${SUM.fail.length ? '\n  FAIL ' + SUM.fail.join('\n  FAIL ') : ''}`);
