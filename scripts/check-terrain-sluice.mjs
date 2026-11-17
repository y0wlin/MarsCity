#!/usr/bin/env node
// Sluice / canal-level invariants of hydro.canalsInTile over a large deterministic sample of O-zone tiles.
// OWNER: terrain-fn agent. Run from web/:  node scripts/check-terrain-sluice.mjs [--tiles N] [--level L] [--quick]
//
// For every sluice listed by canalsInTile (decision D2):
//   1. upLevel >= downLevel (upstream = higher water)
//   2. upLevel - downLevel <= 14 m (single step)
//   3. heading = downstream flow direction: waterAt 2-4 channel widths behind the sluice (against the heading)
//      reads the upLevel reach, ahead (along the heading) the downLevel reach (same canal id, +-0.15 m)
//   4. level bookkeeping: level0 - sluice drops + pump lifts = level1 along the flow; pumps lift (<= 20 m)
// Also checks that the canal levels between sluices are flat (waterAt along the polyline).
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const QUICK = args.includes('--quick');
const NT = opt('--tiles', QUICK ? 160 : 600), LEVEL = opt('--level', 11);

const { initWorldNode } = await import('./node-world.mjs');
initWorldNode();
const { canalsInTile, waterAt } = await import('../src/world/hydro.js');
const { sampleFields } = await import('../src/world/fields.js');
const { tileAt } = await import('../src/core/geo.js');

const DEG = Math.PI / 180;
const unit = (lat, lon) => { const la = lat * DEG, lo = lon * DEG, c = Math.cos(la); return { x: c * Math.sin(lo), y: Math.sin(la), z: c * Math.cos(lo) }; };
function seq(n, seed) { let a = seed >>> 0; const out = new Float64Array(n); for (let i = 0; i < n; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; } return out; }
// destination point (lat, lon) at bearing hdg (deg), distance d (m)
function dest(lat, lon, hdg, d) {
  const R = 3389500, la = lat * DEG, lo = lon * DEG, b = hdg * DEG, a = d / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(la2));
  return [la2 / DEG, lo2 / DEG];
}

// O-zone province anchors (OX1 OX2 OX3 OX5 OX6 + OX4) with spreads (deg)
const AREAS = [[8, 105, 7, 9], [-9, -105, 8, 9], [22, -135, 6, 9], [-28, -45, 8, 10], [-65, -165, 5, 18], [70, 45, 3, 12]];
const r = seq(NT * 3, 351165);
const tiles = new Map();
let tries = 0;
for (let i = 0; tiles.size < NT && tries < NT * 6; i++, tries++) {
  const A = AREAS[i % AREAS.length];
  const lat = A[0] + (r[(3 * i) % r.length] - 0.5) * 2 * A[2], lon = A[1] + (r[(3 * i + 1) % r.length] - 0.5) * 2 * A[3];
  const u = unit(lat, lon);
  const F = sampleFields(u.x, u.y, u.z, {});
  if (F.zone !== 'O' || F.coast <= 0) continue;
  const t = tileAt(u.x, u.y, u.z, LEVEL, {});
  tiles.set(`${t.face}/${t.x}/${t.y}`, t);
}

const c0 = process.cpuUsage();
let nPump = 0, pumpBad = 0;
let nCanal = 0, nSl = 0, upLtDown = 0, bigStep = 0, maxStep = 0, headBad = 0, headChecked = 0, flowBad = 0, flatBad = 0, flatChecked = 0;
const seen = new Set();
const examples = [];
const W = {};
for (const t of tiles.values()) {
  const list = canalsInTile(t.face, LEVEL, t.x, t.y);
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    nCanal++;
    if (c.flow !== undefined && c.kind === 'canal') {
      // level bookkeeping along the flow: level0 - drops + pump lifts = level1 (flow +1)
      let L = c.flow > 0 ? c.level0 : c.level1;
      for (const q of c.sluices || []) L -= q.upLevel - q.downLevel;
      for (const q of c.pumps || []) L += q.upLevel - q.downLevel;
      if (Math.abs(L - (c.flow > 0 ? c.level1 : c.level0)) > 0.05 + 0.01 * ((c.sluices || []).length + (c.pumps || []).length)) { flowBad++; if (examples.length < 20) examples.push(`bookkeeping ${c.id} ${c.level0}->${c.level1} got ${L.toFixed(2)}`); }
    }
    for (const q of c.pumps || []) {
      nPump++;
      if (!(q.upLevel > q.downLevel) || q.upLevel - q.downLevel > 20.0001) pumpBad++;
    }
    for (const s of c.sluices || []) {
      nSl++;
      const step = s.upLevel - s.downLevel;
      if (step < -1e-6) { upLtDown++; if (examples.length < 6) examples.push(`up<down ${c.id} ${s.upLevel}/${s.downLevel}`); }
      if (step > 14.0001) { bigStep++; if (examples.length < 12) examples.push(`step ${step.toFixed(1)} ${c.id}`); }
      maxStep = Math.max(maxStep, step);
      // heading: behind = upstream, ahead = downstream (main canals and laterals; skip ditches)
      // (outfalls into the sea, level clamped to 0.8 m at the shore, are skipped: the shore lifts the bed)
      if (c.order <= 1 && step >= 0.3 && s.downLevel > 0.81) {
        const off = Math.max(25, Math.min(90, (c.width || 10) * 2.5));
        const B = dest(s.lat, s.lon, s.heading + 180, off), Aq = dest(s.lat, s.lon, s.heading, off);
        const ub = unit(B[0], B[1]), ua = unit(Aq[0], Aq[1]);
        const wb = waterAt(ub.x, ub.y, ub.z, W), lb = wb.type === 2 && wb.id === c.id ? wb.level : null;
        const wa = waterAt(ua.x, ua.y, ua.z, W), la = wa.type === 2 && wa.id === c.id ? wa.level : null;
        if (lb !== null && la !== null) {
          headChecked++;
          // exact reach levels; inside a staircase (next sluice closer than the probe) the probes see the reaches
          // beyond the neighbouring steps: then the order (behind >= up, ahead <= down) is what must hold
          const near = (q) => q !== s && Math.hypot((q.lat - s.lat) * 59157, (q.lon - s.lon) * 59157 * Math.cos(s.lat * DEG)) < off * 1.2;
          const stair = (c.sluices || []).some(near) || (c.pumps || []).some(near);
          if (stair && (c.pumps || []).some(near)) { headChecked--; continue; }   // a pump right beside the gate: probes see other reaches
          const ok = stair ? lb >= s.upLevel - 0.15 && la <= s.downLevel + 0.15 : Math.abs(lb - s.upLevel) < 0.15 && Math.abs(la - s.downLevel) < 0.15;
          if (!ok) {
            headBad++;
            if (examples.length < 18) examples.push(`heading ${c.id} sl ${s.upLevel}/${s.downLevel} behind ${lb.toFixed(2)} ahead ${la.toFixed(2)}`);
          }
        }
      }
    }
    // flat reaches: level at polyline points must be one of the reach levels
    if (c.order <= 1 && c.kind === 'canal' && c.points.length >= 3) {
      const levels = new Set([c.level0, c.level1, ...(c.sluices || []).flatMap((s) => [s.upLevel, s.downLevel]), ...(c.pumps || []).flatMap((s) => [s.upLevel, s.downLevel])].map((v) => v.toFixed(2)));
      for (let i = 1; i < c.points.length - 1; i += Math.max(1, Math.floor(c.points.length / 4))) {
        const u = unit(c.points[i][0], c.points[i][1]);
        const w = waterAt(u.x, u.y, u.z, W);
        if (w.type !== 2 || w.id !== c.id) continue;
        flatChecked++;
        let ok = false;
        for (const v of levels) if (Math.abs(+v - w.level) < 0.02) ok = true;
        if (!ok) flatBad++;
      }
    }
  }
}
const cpu = process.cpuUsage(c0);
let fails = 0;
const rep = (name, ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${msg}`); if (!ok) fails++; };
console.log(`tiles L${LEVEL}: ${tiles.size}, canals ${nCanal}, sluices ${nSl}, cpu ${((cpu.user + cpu.system) / 1000).toFixed(0)} ms`);
rep('sluice up >= down', upLtDown === 0, `${upLtDown}/${nSl} with up < down`);
rep('sluice step <= 14 m', bigStep === 0, `${bigStep}/${nSl} steps > 14 m (max ${maxStep.toFixed(2)} m)`);
rep('sluice heading = downstream', headBad === 0, `${headBad}/${headChecked} checked sluices disagree with waterAt up/down reaches`);
rep('canal level bookkeeping (level0 - drops + lifts = level1)', flowBad === 0, `${flowBad}/${nCanal}`);
rep('pumps lift (up > down, <= 20 m)', pumpBad === 0, `${pumpBad}/${nPump} pumps`);
rep('flat reaches between sluices', flatBad <= Math.max(2, flatChecked * 0.01), `${flatBad}/${flatChecked} polyline samples off the reach levels`);
for (const e of examples) console.log('   ', e);
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) process.exit(fails ? 1 : 0);
