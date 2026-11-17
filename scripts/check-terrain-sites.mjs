#!/usr/bin/env node
// Megastructure-site landform checks (fix round 3: G01 quays T1, G02 natural walls / canyon mouth T2).
// OWNER: terrain-fn agent. Run from web/:  node scripts/check-terrain-sites.mjs
//  G01: quay platform level / width along the harbour shore, land > 0 / sea < 0, no cliff within the quay band,
//       ramp slopes, berth depth, band-limit (coarse vs fine), barrier crest shelf / mouth / channel depths unchanged.
//  G02: continuity across the dam-6 line beside the dam, no regular bench rhythm on the natural left-bank slope,
//       canyon-mouth walls not planar (curvature), spill channel water along the axis, reservoirs contained,
//       coarse vs fine rms.
import { initWorldNode } from './node-world.mjs';
initWorldNode();
const { heightAt, sampleTerrain } = await import('../src/world/terrain.js');
const { waterAt } = await import('../src/world/hydro.js');
const S = await import('../src/world/sites.js');
const { SITES, localToUnit, g01FromUV, g01ShoreV, g01ArcV, G01_GEO, G02_AXIS, G02_DAMS, G02_LEVELS, g02HalfWidth } = S;
const G1 = SITES.tidalBarrier, G2 = SITES.waterStairs;

let fails = 0;
const report = (name, ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${msg}`); if (!ok) fails++; };
const U = {};
const h1 = (x, z, mw = 0) => { localToUnit(G1, x, z, U); return heightAt(U.x, U.y, U.z, mw); };
const h2 = (x, z, mw = 0) => { localToUnit(G2, x, z, U); return heightAt(U.x, U.y, U.z, mw); };
const uvh = (u, v, mw = 0) => { const [x, z] = g01FromUV(u, v); return h1(x, z, mw); };
const ST = {};
const uvs = (u, v, mw = 0) => { const [x, z] = g01FromUV(u, v); localToUnit(G1, x, z, U); sampleTerrain(U.x, U.y, U.z, mw, ST); return ST; };

// ---------------------------------------------------------------------------------- G01 quays
{
  // walk inland from the true waterline (coast metric = 0) along -v for every u
  let nQ = 0, badLevel = 0, badCliff = 0, maxRamp = 0, minWidth = 1e9, maxWidth = 0, badBerth = 0, sumBerth = 0, nB = 0;
  const levels = [];
  for (let u = -4400; u <= 4400; u += 100) {
    const sv = g01ShoreV(u);
    // waterline: first land point going inland
    let vw = null;
    for (let dv = 400; dv >= -400; dv -= 2) { const s = uvs(u, sv + dv, 0); if (s.coast > 0) { vw = sv + dv; break; } }
    if (vw === null) continue;
    nQ++;
    // quay: from 10 m inland until the ground leaves [2, 4.2]
    let w = 0, prev = null;
    for (let dq = 10; dq <= 950; dq += 5) {
      const h = uvh(u, vw - dq * 1.0, 0);
      if (dq >= 10 && dq <= 250) { levels.push(h); if (h < 2.0 || h > 4.2) badLevel++; }
      if (h >= 2.0 && h <= 4.2 && w === dq - 5) w = dq; else if (w === 0 && dq === 10 && h >= 2 && h <= 4.2) w = 10;
      if (prev !== null) { const sl = Math.abs(h - prev) / 5; if (dq > 15 && sl > maxRamp) maxRamp = sl; }
      prev = h;
    }
    // the v walk is not perpendicular on the curved flanks: convert by the shore slope
    const s = (g01ShoreV(u + 20) - g01ShoreV(u - 20)) / 40, wp = w / Math.sqrt(1 + s * s);
    minWidth = Math.min(minWidth, wp); maxWidth = Math.max(maxWidth, wp);
    const st = uvs(u, vw - 40, 0);
    if (st.cliff > 0.2) badCliff++;
    // berth: 25 m offshore of the waterline
    const hb = uvh(u, vw + 25, 0); sumBerth += -hb; nB++;
    if (hb > -4) badBerth++;
  }
  levels.sort((a, b) => a - b);
  report('G01 quay level', badLevel === 0, `${nQ} transects, quay ground 10-250 m inland p0 ${levels[0].toFixed(2)} p50 ${levels[levels.length >> 1].toFixed(2)} p100 ${levels[levels.length - 1].toFixed(2)} m (2.0-4.2), ${badLevel} out of range`);
  report('G01 quay width', minWidth >= 280 && maxWidth <= 680, `perpendicular quay width ${minWidth.toFixed(0)}-${maxWidth.toFixed(0)} m (300-600 design; walk step 5 m)`);
  report('G01 no sea cliff on the quay', badCliff === 0, `${badCliff} transects with cliff > 0.2 at 40 m inland`);
  report('G01 ramp slope', maxRamp < 0.65, `max |dh/dx| over 5 m from the quay wall to 950 m inland ${maxRamp.toFixed(2)} (< 0.65; round 2: 3.5-4.4 sea cliff)`);
  report('G01 berth', badBerth <= 3, `mean depth 25 m off the quay wall ${(sumBerth / nB).toFixed(1)} m, ${badBerth} transects shallower than 4 m`);
  // coarse vs fine (band limit): rms over the quay band at mw 40 / 160 vs full detail
  for (const mw of [10, 40, 160]) {
    let s2 = 0, n = 0, mx = 0;
    for (let u = -4400; u <= 4400; u += 220) for (let dq = 0; dq <= 1200; dq += 60) {
      const v = g01ShoreV(u) - dq; const a = uvh(u, v, 0), b = uvh(u, v, mw);
      if (a <= 0 || b <= 0) continue;
      s2 += (a - b) ** 2; n++; mx = Math.max(mx, Math.abs(a - b));
    }
    const rms = Math.sqrt(s2 / n);
    report(`G01 band limit mw ${mw}`, rms < Math.max(3, 0.12 * mw), `rms(fine - coarse) ${rms.toFixed(2)} m, max ${mx.toFixed(1)} m over ${n} land points`);
  }
  // barrier shelf / mouth / channel unchanged: sea-floor depths under the caissons and in the channel
  const A = G01_GEO.arc;
  let shelfBad = 0;
  for (let u = -A.half + 600; u <= A.half - 600; u += 400) { const hh = uvh(u, g01ArcV(u), 0); if (hh > -8.9 || hh < -32.5) shelfBad++; }
  const ch = G1.channel.mouthCentre; const hc = h1(ch[0], ch[1], 0);
  report('G01 barrier shelf / channel', shelfBad === 0 && hc < -31, `arc points shallower than the -9.5 m shelf (or below the -32 m channel): ${shelfBad}; mouth channel ${hc.toFixed(1)} m`);
}

// ---------------------------------------------------------------------------------- G02
{
  const P = G02_AXIS.pts, C = G02_AXIS.cum;
  const at = (s) => { let i = 0; while (i < C.length - 2 && C[i + 1] < s) i++; const t = (s - C[i]) / (C[i + 1] - C[i]); const ex = P[i + 1][0] - P[i][0], ez = P[i + 1][1] - P[i][1], l = Math.hypot(ex, ez); return { x: P[i][0] + ex * t, z: P[i][1] + ez * t, tx: ex / l, tz: ez / l }; };
  // side +1 = sites.js 'right' (south bank here), -1 = 'left' (north bank)
  const pos = (s, side, e) => { const p = at(s); return side > 0 ? [p.x + p.tz * e, p.z - p.tx * e] : [p.x - p.tz * e, p.z + p.tx * e]; };
  const sE = G02_DAMS[5] * 1000;
  // continuity across the dam-6 line outside the dam / shoulders
  let maxJump = 0;
  for (const side of [-1, 1]) for (let e = 460; e <= 2400; e += 40) {
    const a = h2(...pos(sE - 4, side, e)), b = h2(...pos(sE + 4, side, e));
    maxJump = Math.max(maxJump, Math.abs(a - b));
  }
  report('G02 dam-6 line continuity', maxJump < 6, `max |h(sE+4) - h(sE-4)| beside the dam (e 460-2400 m) ${maxJump.toFixed(1)} m (< 6; round 2: ~195 m scarp)`);
  // bench rhythm on the natural left-bank slope (R6, above the terrace belt): benches = flat treads (slope < 0.08 over 4 m)
  // between risers; a natural 0.24 slope (with gullies) has few treads
  let treads = 0, risers = 0, nT = 0;
  for (let s = 13200; s <= 14600; s += 200) {
    const w = g02HalfWidth(5, s, -1);
    let prev = null;
    for (let e = 650; e <= 1100; e += 4) {
      const hh = h2(...pos(s, -1, w + e));
      if (prev !== null) { const sl = (hh - prev) / 4; nT++; if (Math.abs(sl) < 0.08) treads++; if (sl > 0.45) risers++; }
      prev = hh;
    }
  }
  report('G02 left bank: no regular benches above the belt', treads / nT < 0.25, `tread share ${(100 * treads / nT).toFixed(0)} % (benches ~55 %), riser samples ${(risers / (nT * 4 / 1000)).toFixed(1)} per km (gully walls; round 2: 65 per km)`);
  // canyon-mouth walls not planar: second differences across the north wall at 3 stations
  let curv = 0, nc = 0;
  for (const s of [sE + 300, sE + 600, sE + 900]) {
    const hs = []; for (let e = 300; e <= 900; e += 30) hs.push(h2(...pos(s, -1, e)));
    for (let k = 1; k < hs.length - 1; k++) { curv += Math.abs(hs[k + 1] - 2 * hs[k] + hs[k - 1]); nc++; }
  }
  report('G02 canyon-mouth wall irregular', curv / nc > 0.5, `mean |2nd difference| along the north wall (30 m steps) ${(curv / nc).toFixed(2)} m (a plane: 0)`);
  // spill channel water along the axis
  let dry = 0;
  for (let ds = 150; ds <= 5500; ds += 150) { const p = at(sE + ds); localToUnit(G2, p.x, p.z, U); const w = waterAt(U.x, U.y, U.z, {}); if (w.type !== 2) dry++; }
  report('G02 spill channel', dry === 0, `${dry} dry samples of G02-OUT along 150-5500 m below dam 6`);
  // reservoirs contained: ground just outside every shore >= level
  let leak = 0;
  for (let i = 0; i < 6; i++) {
    const s0 = (i === 0 ? 0.3 : G02_DAMS[i - 1]) * 1000 + 300, s1 = G02_DAMS[i] * 1000 - 300;
    for (let s = s0; s <= s1; s += 250) for (const side of [-1, 1]) {
      const w = g02HalfWidth(i, s, side) * 1.06 + 8;
      const hh = h2(...pos(s, side, w));
      if (hh < G02_LEVELS[i] + 0.3) leak++;
    }
  }
  report('G02 reservoirs contained', leak === 0, `${leak} bank points below their level + 0.3 m`);
  // coarse vs fine over the walls / canyon mouth
  for (const mw of [10, 40, 160]) {
    let s2 = 0, n = 0;
    for (let s = 12600; s <= 17600; s += 250) for (const side of [-1, 1]) for (let e = 150; e <= 1500; e += 75) {
      const [x, z] = pos(s, side, e); const a = h2(x, z, 0), b = h2(x, z, mw); s2 += (a - b) ** 2; n++;
    }
    const rms = Math.sqrt(s2 / n);
    report(`G02 band limit mw ${mw}`, rms < Math.max(4, 0.15 * mw), `rms(fine - coarse) ${rms.toFixed(2)} m over ${n} points`);
  }
}
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
