#!/usr/bin/env node
// Urban plan previews (Node → PNG). Run from web/:
//   node scripts/preview-urban.mjs planet                 planet equirect: day composite, night lights, district classes
//   node scripts/preview-urban.mjs zoom [loc] [--size N]   2000 / 200 / 20 / 2 / 0.3 km views around anchors
//   node scripts/preview-urban.mjs tiles                   footprint plots of generateCityTile output
//   node scripts/preview-urban.mjs all
// Output: shots/urban-fn/*.png
import { initWorldNode } from './node-world.mjs';
import { Canvas, lin2srgb, terrainColor, CLS_COLORS, USE_COLORS, AREA_COLORS, CROP_COLORS, srgbBytes } from './preview-urban-lib.mjs';
import fs from 'fs';

initWorldNode();
const { sampleFields } = await import('../src/world/fields.js');
const U = await import('../src/world/urban.js');
const { latLonToUnit, enuBasis, tileAt, tileBounds, faceToVec, unitToLatLon, buildingAxes, latLonHToEcef, enuBasisFromUnit } = await import('../src/core/geo.js');
const { R } = await import('../src/core/constants.js');
const { fieldsAt } = await import('../src/world/urban/lattice.js');
const { heightAt } = await import('../src/world/terrain.js');
const { waterAt } = await import('../src/world/hydro.js');

const OUT = 'shots/urban-fn';
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const what = args[0] || 'all';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

export const LOCS = {
  ZR1: [22, 118], ZR2: [35, -105], ZR3: [22, -15], ZR4: [8, 165], ZR5: [-46, 105], ZR6: [-65, -105],
  OX1: [8, 105], OX4: [72, 45], OX6: [-65, -165], OZ: [-9.75, -105],
  ZR1c: [10, 57], ZR2c: [34, -105], ZR3p: [8, -15], ZR4c: [8, 164], ZR5c: [-41, 105], ZR6v: [-60, -108],
};
const SCALES = [2000e3, 200e3, 20e3, 2e3, 300];
const S = {}, F = {}, TC = [0, 0, 0];

const DCOL = [[150, 80, 50], [190, 160, 110], [235, 205, 150], [240, 225, 200], [255, 255, 255], [150, 150, 165], [110, 140, 190], [180, 220, 230],
  [60, 130, 60], [200, 160, 110], [120, 170, 60], [150, 230, 210], [230, 190, 120], [230, 240, 255], [255, 120, 80]];

function nightColor(s) {
  const L = s.light;
  if (L <= 0) return [0, 0, 0];
  const t = s.lightTemp;
  const warm = [1.0, 0.62, 0.26], cold = [0.80, 0.90, 1.0];
  const r = warm[0] * (1 - t) + cold[0] * t, g = warm[1] * (1 - t) + cold[1] * t, b = warm[2] * (1 - t) + cold[2] * t;
  const k = Math.min(1, L * 1.25);   // linear exposure (the renderer applies its own HDR scale)
  return [r * k, g * k, b * k];
}

function compose(s, F, out) {
  terrainColor(F, 0, out);
  if (s.water > 0.5 && F.coast >= 0) { out[0] = 0.015; out[1] = 0.05; out[2] = 0.11; }
  const f = Math.min(1, s.fabric);
  if (f > 0) { out[0] = out[0] * (1 - f) + s.fabricR * f; out[1] = out[1] * (1 - f) + s.fabricG * f; out[2] = out[2] * (1 - f) + s.fabricB * f; }
  return out;
}

async function planet() {
  const W = +opt('w', 2048), H = W / 2;
  const day = new Canvas(W, H), night = new Canvas(W, H), cls = new Canvas(W, H);
  const texel = (Math.PI * R) / H;
  const t0 = Date.now();
  let n = 0;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    for (let x = 0; x < W; x++) {
      const lon = -180 + ((x + 0.5) * 360) / W;
      const p = latLonToUnit(lat, lon, {});
      fieldsAt(p.x, p.y, p.z, texel, F);
      U.urbanSample(p.x, p.y, p.z, texel, S); n++;
      compose(S, F, TC);
      day.set(x, y, srgbBytes(TC[0] * 1.15, TC[1] * 1.15, TC[2] * 1.15));
      const nc = nightColor(S);
      night.set(x, y, srgbBytes(nc[0] + (F.coast < 0 ? 0.002 : 0.006), nc[1] + (F.coast < 0 ? 0.003 : 0.004), nc[2] + (F.coast < 0 ? 0.008 : 0.004)));
      const c = F.coast < 0 ? [20, 40, 80] : S.fabric < 0.05 ? [120, 70, 50] : DCOL[S.dclass] || [255, 0, 255];
      cls.set(x, y, c);
    }
  }
  const ms = Date.now() - t0;
  console.log(`planet ${W}x${H}: ${ms} ms, ${(ms * 1000 / n).toFixed(2)} µs/sample`);
  await day.save(`${OUT}/planet-day.png`);
  await night.save(`${OUT}/planet-night.png`);
  await cls.save(`${OUT}/planet-classes.png`);
}

/** gnomonic view around (lat,lon), width W metres, N px */
async function zoomView(name, lat, lon, W, N, tag) {
  const B = enuBasis(lat, lon);
  const c = latLonToUnit(lat, lon, {});
  const day = new Canvas(N, N), night = new Canvas(N, N), cls = new Canvas(N, N);
  const texel = W / N;
  const t0 = Date.now();
  const p = {};
  for (let j = 0; j < N; j++) {
    const nn = (0.5 - (j + 0.5) / N) * W;
    for (let i = 0; i < N; i++) {
      const e = ((i + 0.5) / N - 0.5) * W;
      const x = c.x + (B.east[0] * e + B.north[0] * nn) / R, y = c.y + (B.east[1] * e + B.north[1] * nn) / R, z = c.z + (B.east[2] * e + B.north[2] * nn) / R;
      const l = Math.hypot(x, y, z); p.x = x / l; p.y = y / l; p.z = z / l;
      fieldsAt(p.x, p.y, p.z, Math.max(texel, 60), F);
      U.urbanSample(p.x, p.y, p.z, texel, S);
      compose(S, F, TC);
      day.set(i, j, srgbBytes(TC[0] * 1.15, TC[1] * 1.15, TC[2] * 1.15));
      const nc = nightColor(S);
      night.set(i, j, srgbBytes(nc[0] + 0.004, nc[1] + 0.004, nc[2] + 0.006));
      let cc;
      if (texel >= 120) cc = S.water > 0.5 ? [20, 40, 80] : S.fabric < 0.05 ? [120, 70, 50] : DCOL[S.dclass];
      else cc = S.water > 0.5 && S.cls !== 12 && S.cls !== 20 ? [20, 40, 80] : (S.cls === 9 && S.farmCrop ? (CROP_COLORS[S.farmCrop] || CROP_COLORS[1])[S.farmStage] : CLS_COLORS[S.cls] || [255, 0, 255]);
      cls.set(i, j, cc);
    }
  }
  const ms = Date.now() - t0;
  console.log(`${name} ${tag}: ${ms} ms (${(ms * 1000 / (N * N)).toFixed(2)} µs/sample)`);
  await day.save(`${OUT}/${name}-${tag}-day.png`);
  await night.save(`${OUT}/${name}-${tag}-night.png`);
  await cls.save(`${OUT}/${name}-${tag}-cls.png`);
}

async function zoom() {
  const N = +opt('size', 640);
  const only = args[1] && !args[1].startsWith('--') ? args[1].split(',') : Object.keys(LOCS);
  const scales = opt('scales') ? opt('scales').split(',').map(Number) : SCALES;
  for (const name of only) {
    const [lat, lon] = LOCS[name];
    for (const W of scales) {
      const tag = W >= 1000 ? `${W / 1000}km` : `${W}m`;
      await zoomView(name, lat, lon, W, N, tag);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// tile footprint plots
// ---------------------------------------------------------------------------------------------
export function findTile(lat, lon, pred, radiusDeg = 1.5, tries = 700, pre = null) {
  // spiral search for a tile satisfying pred(tileData); pre(districtInfo) is a cheap prescreen of the
  // district class at the candidate point so only promising tiles are generated
  const seen = new Set();
  for (let k = 0; k < tries; k++) {
    const a = k * 2.399, r = radiusDeg * Math.sqrt(k / tries);
    const la = lat + r * Math.sin(a), lo = lon + r * Math.cos(a) / Math.cos(lat * Math.PI / 180);
    const di = U.districtInfo(la, lo);
    if (di.class === 'wild' || (pre && !pre(di))) continue;
    const p = latLonToUnit(la, lo, {});
    const t = tileAt(p.x, p.y, p.z, 13, {});
    const tk = `${t.face}/${t.x}/${t.y}`;
    if (seen.has(tk)) continue; seen.add(tk);
    const d = U.generateCityTile(t.face, t.x, t.y);
    if (pred(d)) return d;
  }
  return null;
}

async function plotTile(d, file, title) {
  const N = 1100, M = 700;   // metres across the plot
  const cv = new Canvas(N, N, [205, 128, 92]);
  const sc = N / M;
  const X = (x) => N / 2 + x * sc, Z = (z) => N / 2 + z * sc;   // +z south → down
  // water (terrain below sea level / hydro water) sampled every 4 px
  {
    const c0 = latLonToUnit(d.center.lat, d.center.lon, {});
    const E0 = enuBasisFromUnit(c0.x, c0.y, c0.z, {});
    const W = {};
    for (let py = 0; py < N; py += 4) for (let px = 0; px < N; px += 4) {
      const lx = (px + 2 - N / 2) / sc, lz = (py + 2 - N / 2) / sc;
      const vx = c0.x + (E0.east[0] * lx + E0.south[0] * lz) / R, vy = c0.y + (E0.east[1] * lx + E0.south[1] * lz) / R, vz = c0.z + (E0.east[2] * lx + E0.south[2] * lz) / R;
      const l = Math.hypot(vx, vy, vz);
      const h = heightAt(vx / l, vy / l, vz / l, 3);
      let wet = h < 0;
      if (!wet) { waterAt(vx / l, vy / l, vz / l, W); wet = W.type > 0 && W.depth > 0; }
      if (wet) cv.rect(px, py, 4, 4, [28, 58, 96]);
    }
  }
  // areas
  for (const a of d.areas) {
    let c = AREA_COLORS[a.kind] || [180, 180, 180];
    if (a.kind === 'field' && a.crop) c = (CROP_COLORS[a.crop] || CROP_COLORS[1])[a.stage || 0];
    cv.poly(a.polygon.map(([x, z]) => [X(x), Z(z)]), c, 0.9);
  }
  // docks
  for (const k of d.docks) cv.poly(k.polygon.map(([x, z]) => [X(x), Z(z)]), [215, 210, 200], 1);
  // roads
  const RW = { boulevard: [60, 60, 66], arterial: [70, 70, 78], collector: [95, 95, 102], local: [120, 120, 126], lane: [150, 140, 128], farm: [178, 140, 100], highway: [50, 50, 56], service: [150, 130, 110] };
  for (const r of d.roads) cv.polyline(r.points.map((p) => [X(p[0]), Z(p[2])]), Math.max(1, r.width * sc), RW[r.cls] || [100, 100, 100], r.bridge ? 0.7 : 1);
  for (const r of d.rails) cv.polyline(r.points.map((p) => [X(p[0]), Z(p[2])]), Math.max(2, (r.elevated ? 11 : 16) * sc), r.elevated ? [150, 90, 200] : [120, 60, 150], 1);
  for (const p of d.pipes) cv.polyline(p.points.map((q) => [X(q[0]), Z(q[2])]), Math.max(2, 3 * sc), [235, 235, 240], 1);
  // buildings
  const c = latLonToUnit(d.center.lat, d.center.lon, {});
  const E = enuBasisFromUnit(c.x, c.y, c.z, {});
  for (const b of d.buildings) {
    const ax = buildingAxes(b.lat, b.lon, b.heading);
    const P = latLonToUnit(b.lat, b.lon, {});
    const dx = (P.x - c.x) * R, dy = (P.y - c.y) * R, dz = (P.z - c.z) * R;
    const cx = dx * E.east[0] + dy * E.east[1] + dz * E.east[2], cz = dx * E.south[0] + dy * E.south[1] + dz * E.south[2];
    // building axes in tile-local (east, south)
    const xe = ax.x[0] * E.east[0] + ax.x[1] * E.east[1] + ax.x[2] * E.east[2], xs = ax.x[0] * E.south[0] + ax.x[1] * E.south[1] + ax.x[2] * E.south[2];
    const ze = ax.z[0] * E.east[0] + ax.z[1] * E.east[1] + ax.z[2] * E.east[2], zs = ax.z[0] * E.south[0] + ax.z[1] * E.south[1] + ax.z[2] * E.south[2];
    const L2W = ([x, z]) => [X(cx + x * xe + z * ze), Z(cz + x * xs + z * zs)];
    const w = b.footprint.w, dd = b.footprint.d;
    let pts = b.footprint.points || [[-w / 2, -dd / 2], [w / 2, -dd / 2], [w / 2, dd / 2], [-w / 2, dd / 2]];
    if (b.footprint.shape === 'round') { pts = []; for (let k = 0; k < 24; k++) { const t = k / 24 * Math.PI * 2; pts.push([Math.cos(t) * w / 2, Math.sin(t) * w / 2]); } }
    const col = USE_COLORS[b.use] || [255, 0, 255];
    // shade by height
    const hgt = b.meta.height || b.floors * b.floorHeight;
    const k = Math.max(0.55, Math.min(1, 1.05 - Math.log10(1 + hgt) * 0.18));
    cv.poly(pts.map(L2W), col.map((v) => Math.round(v * k)), 1);
    // outline
    const op = pts.map(L2W); for (let i = 0; i < op.length; i++) { const a = op[i], q = op[(i + 1) % op.length]; cv.line(a[0], a[1], q[0], q[1], 1, [40, 40, 40], 0.8); }
    if (b.meta.tower) {
      const t = b.meta.tower; const tp = t.shape === 'round' ? Array.from({ length: 20 }, (_, i) => [t.x + Math.cos(i / 20 * 6.283) * t.w / 2, t.z + Math.sin(i / 20 * 6.283) * t.w / 2]) : [[t.x - t.w / 2, t.z - t.d / 2], [t.x + t.w / 2, t.z - t.d / 2], [t.x + t.w / 2, t.z + t.d / 2], [t.x - t.w / 2, t.z + t.d / 2]];
      cv.poly(tp.map(L2W), col.map((v) => Math.round(v * 0.62)), 1);
    }
    // entrances
    for (const e of b.entrances) {
      let ex, ez;
      if (e.side === 'front') { ex = e.offset; ez = dd / 2; } else if (e.side === 'back') { ex = -e.offset; ez = -dd / 2; } else if (e.side === 'left') { ex = -w / 2; ez = -e.offset; } else { ex = w / 2; ez = e.offset; }
      const [px, py] = L2W([ex, ez]);
      const ec = e.kind === 'main' ? [255, 40, 40] : e.kind === 'shop' ? [255, 160, 0] : e.kind === 'platform' ? [180, 0, 255] : e.kind === 'loading' ? [0, 120, 255] : [20, 20, 20];
      cv.disc(px, py, e.kind === 'main' ? 3 : 2, ec, 1);
    }
  }
  // stations
  for (const s of d.stations) cv.disc(X(s.x), Z(s.z), 6, [255, 255, 0], 1);
  // tile border (650 m approx) and scale bar 100 m
  const half = 650 / 2;
  cv.polyline([[X(-half), Z(-half)], [X(half), Z(-half)], [X(half), Z(half)], [X(-half), Z(half)], [X(-half), Z(-half)]], 1, [255, 255, 255], 0.5);
  cv.rect(20, N - 30, 100 * sc, 6, [255, 255, 255]);
  await cv.save(file);
  const uses = {}; for (const b of d.buildings) uses[b.use] = (uses[b.use] || 0) + 1;
  console.log(`${title}: tile ${d.key} @${d.center.lat.toFixed(3)},${d.center.lon.toFixed(3)} buildings ${d.buildings.length} roads ${d.roads.length} areas ${d.areas.length} rails ${d.rails.length} stations ${d.stations.length} docks ${d.docks.length} ${JSON.stringify(uses)} (${d.stats.ms} ms)`);
}

async function tiles() {
  const isCls = (...c) => (di) => c.includes(di.class);
  const cases = [
    ['zr1-coast', 22, 118, (d) => d.buildings.length > 40 && d.docks.length > 0, 3, (di) => di.class === 'port' && di.coastal],
    ['zr1-core', 22, 118, (d) => d.buildings.some((b) => b.tier === 'tower' || b.tier === 'landmark') && d.buildings.length > 40, 1.5, isCls('core')],
    ['zr1-station', 22, 118, (d) => d.stations.length > 0 && d.buildings.length > 30, 2.5, isCls('mid', 'core', 'low')],
    ['canyon', 34, -105, (d) => d.buildings.some((b) => b.meta.terraced) && d.buildings.length > 20, 1.5, (di) => di.terraced],
    ['island', 8, 164, (d) => d.buildings.length > 15 && (d.docks.length > 0), 2, (di) => di.coastal && ['low', 'mid', 'core', 'port'].includes(di.class)],
    ['farm-sluice', 8, 105, (d) => d.buildings.filter((b) => ['dorm', 'farm_station', 'cold_storage', 'maintenance', 'pumphouse', 'sluice_station', 'water_treatment'].includes(b.use)).length >= 2 && d.areas.some((a) => a.kind === 'field'), 4, isCls('farm', 'otown', 'greenhouse')],
    ['farm-town', 8, 105, (d) => d.buildings.filter((b) => b.use === 'dorm').length >= 4, 4, isCls('otown')],
    ['farm-fields', 8, 105, (d) => d.areas.filter((a) => a.kind === 'field').length > 6, 2, isCls('farm')],
    ['polar-station', -65, -165, (d) => d.buildings.some((b) => b.use === 'insulated_station'), 4, isCls('polar')],
    ['ice-margin', 72, 45, (d) => d.buildings.some((b) => b.use === 'greenhouse' || b.use === 'insulated_station' || b.use === 'meltwater_pump'), 5, isCls('polar', 'greenhouse', 'outpost')],
    ['cold-valley', -65, -105, (d) => d.buildings.length > 30, 3, isCls('low', 'mid', 'core')],
    ['harbour-zr5', -46, 105, (d) => d.buildings.some((b) => b.use === 'port_shed') && d.docks.length > 0, 4, (di) => di.class === 'port' && di.coastal],
    ['plateau-zr3', 22, -15, (d) => d.buildings.length > 40, 1, isCls('mid', 'core', 'low')],
  ];
  const only = args[1] && !args[1].startsWith('--') ? args[1].split(',') : null;
  // direct targets (small features a random search rarely hits): the nearest polar supply station
  // settlement, and the nearest PORT-class district seeds of a coast
  const { townsNear } = await import('../src/world/urban/settlements.js');
  const { seedsNear } = await import('../src/world/urban/dchunks.js');
  const { district1 } = await import('../src/world/urban/districts.js');
  const { DC } = await import('../src/world/urban/rules.js');
  const targets = (lat, lon, name) => {
    const c = latLonToUnit(lat, lon, {}), out = [];
    if (name === 'polar-station') {
      for (const t of townsNear(c.x, c.y, c.z, 600000)) if (t.kind === 'station') out.push([t.x, t.y, t.z, (t.x - c.x) ** 2 + (t.y - c.y) ** 2 + (t.z - c.z) ** 2]);
    } else if (name === 'zr1-coast' || name === 'harbour-zr5') {
      for (let r = 0; r < 12 && out.length < 6; r++) {
        const la = lat + (r % 4 - 1.5) * 1.2, lo = lon + (Math.floor(r / 4) - 1) * 1.5, q = latLonToUnit(la, lo, {});
        seedsNear(q.x, q.y, q.z, 60000, (k, sx, sy, sz) => { const D = district1(k); if (D.cls === DC.PORT) out.push([sx, sy, sz, (sx - c.x) ** 2 + (sy - c.y) ** 2 + (sz - c.z) ** 2]); });
      }
    }
    return out.sort((a, b) => a[3] - b[3]).slice(0, 6);
  };
  for (const [name, lat, lon, pred, rad, pre] of cases) {
    if (only && !only.includes(name)) continue;
    let d = null;
    for (const [x, y, z] of targets(lat, lon, name)) {
      for (const [da, db] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = tileAt(x, y, z, 13, {});
        const dd = U.generateCityTile(t.face, t.x + da, t.y + db);
        if (pred(dd)) { d = dd; break; }
      }
      if (d) break;
    }
    if (!d) d = findTile(lat, lon, pred, rad, 700, pre);
    if (!d) { console.log(`${name}: no tile matched near ${lat},${lon}`); continue; }
    await plotTile(d, `${OUT}/tile-${name}.png`, name);
  }
}

if (what === 'planet' || what === 'all') await planet();
if (what === 'zoom' || what === 'all') await zoom();
if (what === 'tiles' || what === 'all') await tiles();
