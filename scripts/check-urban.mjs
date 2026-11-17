#!/usr/bin/env node
// Urban plan checks: performance, statistics, ID round-trip, determinism. Run from web/:
//   node scripts/check-urban.mjs [perf] [cold] [stats] [roundtrip] [determinism] [links]   (default: all but links)
//   perf   in-process timings (caches dropped with clearUrbanCaches → "cold caches", then warm)
//   cold   TRUE cold starts: every measurement runs in a fresh Node process (nothing cached, like a
//          fresh worker); the lower layers' one-time init (fields coast grid, terrain) is measured
//          separately and excluded from the urban numbers
// Times are CPU times of the measuring process (process.cpuUsage), robust to a loaded machine.
import { initWorldNode } from './node-world.mjs';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ARGV = process.argv.slice(2);
const cpuNow = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };   // ms
if (ARGV[0] === '--child') {
  // fresh process: one cold measurement, JSON on stdout
  const t0 = cpuNow(), w0 = performance.now();
  initWorldNode();
  const { latLonToUnit } = await import('../src/core/geo.js');
  const { sampleFields } = await import('../src/world/fields.js');
  const { heightAt } = await import('../src/world/terrain.js');
  const { waterAt } = await import('../src/world/hydro.js');
  const U = await import('../src/world/urban.js');
  const tImport = cpuNow();
  // lower layers' one-time initialisation (not urban): a far-away point (south polar sea)
  { const p = latLonToUnit(-85, 0, {}); sampleFields(p.x, p.y, p.z, {}); heightAt(p.x, p.y, p.z, 0); waterAt(p.x, p.y, p.z, {}); }
  const tLower = cpuNow();
  const mode = ARGV[1];
  const r = { mode, importMs: +(tImport - t0).toFixed(1), lowerInitMs: +(tLower - tImport).toFixed(1) };
  const c0 = cpuNow(), wc0 = performance.now();
  if (mode === 'spec') {
    const s = U.buildingSpecById(ARGV[2]);
    r.coldMs = +(cpuNow() - c0).toFixed(2); r.coldWallMs = +(performance.now() - wc0).toFixed(1); r.ok = !!s && s.id === ARGV[2];
    const c1 = cpuNow(); U.buildingSpecById(ARGV[2]); r.warmMs = +(cpuNow() - c1).toFixed(3);
    if (ARGV[3]) { const c2 = cpuNow(); const s2 = U.buildingSpecById(ARGV[3]); r.otherMs = +(cpuNow() - c2).toFixed(2); r.ok2 = !!s2; }
    const c3 = cpuNow(); r.garbageNull = U.buildingSpecById('ZR9-0.9.zz.zz-1.1-0') === null && U.buildingSpecById('nonsense') === null; r.garbageMs = +(cpuNow() - c3).toFixed(2);
  } else if (mode === 'tile') {
    const [f, x, y] = ARGV.slice(2, 5).map(Number);
    const d = U.generateCityTile(f, x, y);
    r.coldMs = +(cpuNow() - c0).toFixed(1); r.coldWallMs = +(performance.now() - wc0).toFixed(1); r.buildings = d.buildings.length;
    const c1 = cpuNow(); U.generateCityTile(f, x, y); r.warmSameMs = +(cpuNow() - c1).toFixed(1);
    const c2 = cpuNow(); const d2 = U.generateCityTile(f, x + 1, y); r.neighbourMs = +(cpuNow() - c2).toFixed(1); r.nbBuildings = d2.buildings.length;
  } else if (mode === 'sample') {
    const [lat, lon, L, N] = ARGV.slice(2, 6).map(Number);
    const { tileAt, tileBounds, faceToVec } = await import('../src/core/geo.js');
    const p = latLonToUnit(lat, lon, {}), t = tileAt(p.x, p.y, p.z, L, {}), b = tileBounds(t.face, L, t.x, t.y);
    const tex = (2 * 2662124 / (1 << L)) / N, S = {}, Q = {};
    const run = () => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { faceToVec(t.face, b.a0 + (b.a1 - b.a0) * (i + 0.5) / N, b.b0 + (b.b1 - b.b0) * (j + 0.5) / N, Q); U.urbanSample(Q.x, Q.y, Q.z, tex, S); } };
    run(); r.coldUs = +((cpuNow() - c0) * 1000 / (N * N)).toFixed(2); r.coldTileMs = +(cpuNow() - c0).toFixed(1); r.texel = +tex.toFixed(2);
    const c1 = cpuNow(); run(); r.warmUs = +((cpuNow() - c1) * 1000 / (N * N)).toFixed(2);
  }
  r.totalWallMs = +(performance.now() - w0).toFixed(0);
  console.log(JSON.stringify(r));
  process.exit(0);
}

initWorldNode();
const U = await import('../src/world/urban.js');
const { sampleFields } = await import('../src/world/fields.js');
const { heightAt } = await import('../src/world/terrain.js');
const { latLonToUnit, tileAt, tileBounds, faceToVec, unitToLatLon } = await import('../src/core/geo.js');
const { mulberry32 } = await import('../src/core/hash.js');
const { PROVINCE_CODES } = await import('../src/core/constants.js');

const args = ARGV;
const want = (k) => args.length === 0 || args.includes(k);
const cpu = cpuNow;
const report = {};

// warm the lower world layers (their one-time grids are not ours)
{ const p = latLonToUnit(10, 10, {}); sampleFields(p.x, p.y, p.z, {}); heightAt(p.x, p.y, p.z, 0); }

const SITES = { ZR1c: [10, 57], ZR1: [22, 118], ZR3: [22, -15], ZR5c: [-41, 105], OX1: [8, 105], ZR4c: [8, 164] };

/** sample a terrain-like tile texture (N×N texels) at quadtree level L around (lat,lon) */
function tileRaster(lat, lon, L, N) {
  const p = latLonToUnit(lat, lon, {});
  const t = tileAt(p.x, p.y, p.z, L, {});
  const b = tileBounds(t.face, L, t.x, t.y);
  const tex = (2 * 2662124 / (1 << L)) / N;
  const S = {}, Q = {};
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    faceToVec(t.face, b.a0 + (b.a1 - b.a0) * (i + 0.5) / N, b.b0 + (b.b1 - b.b0) * (j + 0.5) / N, Q);
    U.urbanSample(Q.x, Q.y, Q.z, tex, S);
  }
  return tex;
}

if (want('perf')) {
  const levels = [3, 6, 9, 11, 13, 15, 17, 19];
  const N = 128;
  const rows = [];
  let totS = 0, totMs = 0, warmS = 0, warmMs = 0;
  for (const [name, [lat, lon]] of Object.entries(SITES)) {
    U.clearUrbanCaches();
    for (const L of levels) {
      const c0 = cpu(); const tex = tileRaster(lat, lon, L, N); const c1 = cpu();
      tileRaster(lat, lon, L, N); const c2 = cpu();
      const cold = (c1 - c0) * 1000 / (N * N), warm = (c2 - c1) * 1000 / (N * N);
      rows.push({ site: name, L, texel: +tex.toFixed(2), coldUs: +cold.toFixed(2), warmUs: +warm.toFixed(2) });
      totS += N * N; totMs += c1 - c0; warmS += N * N; warmMs += c2 - c1;
    }
  }
  console.table(rows);
  report.urbanSample = { avgColdUs: +(totMs * 1000 / totS).toFixed(3), avgWarmUs: +(warmMs * 1000 / warmS).toFixed(3), tileTexels: N * N, levels, rows };
  console.log(`urbanSample average over ${Object.keys(SITES).length} sites × ${levels.length} tile levels: cold ${report.urbanSample.avgColdUs} µs, warm ${report.urbanSample.avgWarmUs} µs per sample`);

  // generateCityTile: dense tiles, cold caches per tile neighbourhood
  const dense = [];
  const tl = [];
  for (const [name, [lat, lon]] of Object.entries(SITES)) {
    for (let k = 0; k < 3; k++) {
      U.clearUrbanCaches();
      const la = lat + (k - 1) * 0.07, lo = lon + (k - 1) * 0.05;
      const p = latLonToUnit(la, lo, {}); const t = tileAt(p.x, p.y, p.z, 13, {});
      const c0 = cpu(); const d = U.generateCityTile(t.face, t.x, t.y); const c1 = cpu();
      const d2 = U.generateCityTile(t.face, t.x + 1, t.y); const c2 = cpu();
      tl.push({ site: name, tile: d.key, buildings: d.buildings.length, roads: d.roads.length, coldMs: +(c1 - c0).toFixed(1), neighbourMs: +(c2 - c1).toFixed(1), nb2: d2.buildings.length });
      if (d.buildings.length > 80) dense.push(c2 - c1);
    }
  }
  console.table(tl);
  dense.sort((a, b) => a - b);
  report.generateCityTile = { rows: tl, denseNeighbourMsMedian: dense.length ? +dense[dense.length >> 1].toFixed(1) : null, denseColdMsMax: +Math.max(...tl.filter((r) => r.buildings > 80).map((r) => r.coldMs)).toFixed(1) };

  // buildingSpecById: cold (all caches dropped) and warm
  const ids = [];
  for (const r of tl) { const [f, , x, y] = r.tile.split('/').map(Number); const d = U.generateCityTile(f, x, y); for (const b of d.buildings.slice(0, 6)) ids.push(b.id); }
  const cold = [], warm = [];
  for (const id of ids.slice(0, 40)) {
    U.clearUrbanCaches();
    const c0 = cpu(); const s = U.buildingSpecById(id); const c1 = cpu(); U.buildingSpecById(id); const c2 = cpu();
    if (!s) console.log('missing', id);
    cold.push(c1 - c0); warm.push(c2 - c1);
  }
  cold.sort((a, b) => a - b); warm.sort((a, b) => a - b);
  report.buildingSpecById = { n: cold.length, coldMsMedian: +cold[cold.length >> 1].toFixed(2), coldMsMax: +cold[cold.length - 1].toFixed(2), warmMsMedian: +warm[warm.length >> 1].toFixed(3) };
  console.log('buildingSpecById', report.buildingSpecById);
}

if (want('cold')) {
  // ids / tiles from a warm pass in this process; every measurement then runs in a fresh process
  const here = fileURLToPath(import.meta.url);
  const child = (...a) => { try { return JSON.parse(execFileSync(process.execPath, [here, '--child', ...a.map(String)], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop()); } catch (e) { return { error: String(e.message).slice(0, 200) }; } };
  const coldSites = { ...SITES, ZR2: [34.2, -105.1], ZR5: [-45.6, 105.4], OX6: [-65.0, -165.0], ZR6: [-64.6, -105.2] };
  const specIds = [], tiles = [];
  for (const [name, [lat, lon]] of Object.entries(coldSites)) {
    for (let k = 0; k < 4; k++) {
      const p = latLonToUnit(lat + (k - 1.5) * 0.03, lon + (k - 1.5) * 0.02, {}); const t = tileAt(p.x, p.y, p.z, 13, {});
      const d = U.generateCityTile(t.face, t.x, t.y);
      if (d.buildings.length) { specIds.push([name, d.buildings[(d.buildings.length * 0.41) | 0].id, d.buildings[d.buildings.length - 1].id]); tiles.push([name, t.face, t.x, t.y, d.buildings.length]); break; }
    }
  }
  const specRows = [], tileRows = [], sampleRows = [];
  for (const [name, id, id2] of specIds) { const r = child('spec', id, id2); specRows.push({ site: name, id, ...r }); console.log('cold spec', name, JSON.stringify(r)); }
  for (const [name, f, x, y, nb] of tiles) { const r = child('tile', f, x, y); tileRows.push({ site: name, tile: `${f}/13/${x}/${y}`, ...r }); console.log('cold tile', name, JSON.stringify(r)); }
  for (const [name, [lat, lon]] of Object.entries({ ZR1: SITES.ZR1, OX1: SITES.OX1 })) for (const L of [3, 7, 10, 13, 16, 19]) { const r = child('sample', lat, lon, L, 64); sampleRows.push({ site: name, L, ...r }); console.log('cold sample', name, L, JSON.stringify(r)); }
  const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : null; };
  const max = (a) => Math.max(...a.filter(Number.isFinite));
  report.cold = {
    note: 'each number from a fresh Node process (CPU ms); lowerInitMs = one-time init of fields/terrain/hydro (not urban), excluded',
    lowerInitMsMedian: med(specRows.map((r) => r.lowerInitMs)),
    buildingSpecById: { n: specRows.length, coldMsMedian: med(specRows.map((r) => r.coldMs)), coldMsMax: max(specRows.map((r) => r.coldMs)), warmMsMedian: med(specRows.map((r) => r.warmMs)), secondIdMsMedian: med(specRows.map((r) => r.otherMs)), allOk: specRows.every((r) => r.ok && r.ok2 && r.garbageNull), rows: specRows },
    generateCityTile: { n: tileRows.length, coldMsMedian: med(tileRows.map((r) => r.coldMs)), coldMsMax: max(tileRows.map((r) => r.coldMs)), warmSameMsMedian: med(tileRows.map((r) => r.warmSameMs)), neighbourMsMedian: med(tileRows.map((r) => r.neighbourMs)), rows: tileRows },
    urbanSample: { coldUsMean: +(sampleRows.reduce((a, r) => a + (r.coldUs || 0), 0) / sampleRows.length).toFixed(2), warmUsMean: +(sampleRows.reduce((a, r) => a + (r.warmUs || 0), 0) / sampleRows.length).toFixed(2), rows: sampleRows },
  };
  console.log('COLD', JSON.stringify({ lowerInitMsMedian: report.cold.lowerInitMsMedian, spec: { ...report.cold.buildingSpecById, rows: undefined }, tile: { ...report.cold.generateCityTile, rows: undefined }, sample: { ...report.cold.urbanSample, rows: undefined } }));
}

const rnd = mulberry32(351165);
function randomTilesIn(code, n, minFabric = 0.3) {
  // rejection-sample tile anchors inside a province where the plan is built up
  const out = []; const S = {}, F = {};
  let tries = 0;
  while (out.length < n && tries < n * 400) {
    tries++;
    const z = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const x = r * Math.cos(th), y = z, zz = r * Math.sin(th);
    const ll = unitToLatLon(x, y, zz, {});
    // cheap province test via the urban sample (exact province lookup)
    U.urbanSample(x, y, zz, 2000, S);
    if (PROVINCE_CODES[S.province] !== code || S.fabric < minFabric) continue;
    const t = tileAt(x, y, zz, 13, {});
    out.push(t);
  }
  return out;
}

if (want('stats')) {
  // buildings per tile and use distribution per province
  const prov = {};
  for (let id = 1; id <= 12; id++) {
    const code = PROVINCE_CODES[id];
    const tiles = randomTilesIn(code, 12, code.startsWith('OX') ? 0.15 : 0.4);
    const uses = {}; let nb = 0, nt = 0;
    const per = [];
    for (const t of tiles) {
      const d = U.generateCityTile(t.face, t.x, t.y);
      nt++; nb += d.buildings.length; per.push(d.buildings.length);
      for (const b of d.buildings) uses[b.use] = (uses[b.use] || 0) + 1;
    }
    per.sort((a, b) => a - b);
    prov[code] = { tiles: nt, buildingsPerTileMean: nt ? +(nb / nt).toFixed(1) : 0, median: per.length ? per[per.length >> 1] : 0, max: per.length ? per[per.length - 1] : 0, uses };
    console.log(code, JSON.stringify(prov[code]));
  }
  report.provinces = prov;
  // share of Z land that is built (fabric) and roof coverage, sampled on a 0.5° grid (area weighted)
  const S = {}; let zl = 0, zb = 0, zc = 0, ol = 0, of = 0, wsum = 0;
  for (let lat = -89.75; lat < 90; lat += 0.5) {
    const w = Math.cos(lat * Math.PI / 180);
    for (let lon = -179.75; lon < 180; lon += 0.5) {
      const p = latLonToUnit(lat, lon, {});
      U.urbanSample(p.x, p.y, p.z, 2500, S);
      if (S.water > 0.5) continue;
      if (S.zone === 'Z') { zl += w; zb += w * Math.min(1, S.fabric); zc += w * S.coverage; }
      else { ol += w; of += w * S.farm; }
      wsum += w;
    }
  }
  report.landShares = { zBuiltFabricPct: +(100 * zb / zl).toFixed(2), zRoofCoveragePct: +(100 * zc / zl).toFixed(2), oFarmPct: +(100 * of / ol).toFixed(2) };
  console.log('land shares', report.landShares);
}

if (want('roundtrip')) {
  // 1000 random buildings from random built tiles across all provinces
  U.clearUrbanCaches();
  const pool = [];
  const codes = PROVINCE_CODES.slice(1);
  let k = 0;
  while (pool.length < 1000 && k < 400) {
    const code = codes[k % codes.length]; k++;
    const [t] = randomTilesIn(code, 1, code.startsWith('OX') ? 0.1 : 0.3);
    if (!t) continue;
    const d = U.generateCityTile(t.face, t.x, t.y);
    const n = d.buildings.length;
    for (let i = 0; i < Math.min(n, 12) && pool.length < 1000; i++) pool.push(d.buildings[Math.floor(rnd() * n)]);
  }
  let ok = 0, bad = 0; const fails = [];
  for (let i = 0; i < pool.length; i++) {
    if (i % 50 === 0) U.clearUrbanCaches();          // force regeneration from nothing
    const a = pool[i], b = U.buildingSpecById(a.id);
    if (b && JSON.stringify(a) === JSON.stringify(b)) ok++; else { bad++; if (fails.length < 5) fails.push(a.id); }
  }
  const uniq = new Set(pool.map((b) => b.id)).size;
  report.roundtrip = { tested: pool.length, unique: uniq, identical: ok, failed: bad, fails };
  console.log('ID round-trip', report.roundtrip);
}

if (want('determinism')) {
  const p = latLonToUnit(10.02, 57.03, {}); const t = tileAt(p.x, p.y, p.z, 13, {});
  const noTime = (k, v) => (/^ms/.test(k) ? 0 : v);   // stats.ms / msBlocks / msStreets / msRails are timings
  U.clearUrbanCaches(); const a = JSON.stringify(U.generateCityTile(t.face, t.x, t.y), noTime);
  U.clearUrbanCaches(); const b = JSON.stringify(U.generateCityTile(t.face, t.x, t.y), noTime);
  report.determinism = { tile: `${t.face}/13/${t.x}/${t.y}`, identical: a === b, bytes: a.length };
  console.log('determinism', report.determinism);
}

if (args.includes('links')) {
  // the lazy corridor query (validates only the settlements it needs) must equal the full one
  const CO = await import('../src/world/urban/corridors.js');
  let same = 0, diff = 0;
  for (let k = 0; k < 40; k++) {
    const lat = Math.asin(rnd() * 2 - 1) * 180 / Math.PI, lon = rnd() * 360 - 180;
    const c = latLonToUnit(lat, lon, {});
    U.clearUrbanCaches(); const a = CO.linksNearLazy(c, 18500);
    U.clearUrbanCaches(); const b = CO.linksNearFull(c, 18500);
    const ka = []; for (let i = 0; i < a.length; i += 2) ka.push(`${a[i]}:${a[i + 1]}`);
    const kb = []; for (let i = 0; i < b.length; i += 2) kb.push(`${b[i]}:${b[i + 1]}`);
    if (ka.sort().join() === kb.sort().join()) same++; else diff++;
  }
  report.links = { tested: same + diff, identical: same, different: diff };
  console.log('lazy vs full corridor links', report.links);
}

fs.mkdirSync('shots/urban-fn', { recursive: true });
let prev = {};
try { prev = JSON.parse(fs.readFileSync('shots/urban-fn/check-report.json', 'utf8')); } catch { /* first run */ }
fs.writeFileSync('shots/urban-fn/check-report.json', JSON.stringify({ ...prev, ...report, updated: new Date().toISOString() }, null, 1));
console.log('wrote shots/urban-fn/check-report.json');
