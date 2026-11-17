#!/usr/bin/env node
// Urban site checks (fix round 1): steep utility sites, water-facing utility meta, station meta,
// canyon buildings on cliff faces, OX4 cliff-foot placement. Run from web/:
//   node scripts/check-urban-sites.mjs [--out shots/urban/sites-<tag>.json] [--quick]
// Generates L13 city tiles in fixed sample areas and reports per-use corner-spread statistics.
import { initWorldNode } from './node-world.mjs';
import fs from 'fs';
import path from 'path';
initWorldNode();
const U = await import('../src/world/urban.js');
const { latLonToUnit, tileAt } = await import('../src/core/geo.js');
const { heightAt } = await import('../src/world/terrain.js');
const { waterAt } = await import('../src/world/hydro.js');
let iceQAt = null;
try { const FM = await import('../src/world/terrain/field.js'); const F = FM.newFields(); iceQAt = (p) => { FM.computeFields(p.x, p.y, p.z, 100, F); return F.iceQ; }; } catch { /* optional */ }

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const quick = args.includes('--quick');
const AREAS = {
  OX1: { c: [7.30, 104.91], n: quick ? 3 : 6, step: 0.006 },     // the two bad sluice stations of the lead's list
  OX1b: { c: [8.0, 105.6], n: quick ? 3 : 5, step: 0.006 },
  OX5: { c: [-28.4, -45.6], n: quick ? 2 : 4, step: 0.006 },
  OX4: { c: [73.95, 54.7], n: quick ? 3 : 6, step: 0.006 },
  ZR2: { c: [34.89, -105.24], n: quick ? 3 : 6, step: 0.006 },
  ZR1: { c: [21.87, 118.0], n: quick ? 2 : 3, step: 0.006 },
};
const WATER_USES = new Set(['sluice_station', 'pumphouse', 'meltwater_pump']);
const out = { areas: {}, uses: {}, steep: [], waterMeta: [], stations: [], canyon: {}, ids: [] };
const W = {};
for (const [name, a] of Object.entries(AREAS)) {
  const seen = new Set();
  let nb = 0, tiles = 0, ms = 0;
  for (let i = 0; i < a.n; i++) for (let j = 0; j < a.n; j++) {
    const lat = a.c[0] + (i - a.n / 2) * a.step, lon = a.c[1] + (j - a.n / 2) * a.step / Math.cos(a.c[0] * Math.PI / 180);
    const p = latLonToUnit(lat, lon, {}); const t = tileAt(p.x, p.y, p.z, 13, {});
    const k = `${t.face}/${t.x}/${t.y}`; if (seen.has(k)) continue; seen.add(k);
    const d = U.generateCityTile(t.face, t.x, t.y); tiles++; ms += d.stats.ms;
    for (const b of d.buildings) {
      nb++;
      const c = b.ground.corners, spread = Math.max(...c) - Math.min(...c);
      const diag = Math.hypot(b.footprint.w, b.footprint.d);
      const u = out.uses[b.use] || (out.uses[b.use] = { n: 0, spreadGt3: 0, spreadGt6: 0, max: 0, slopeGt08: 0 });
      u.n++; if (spread > 3) u.spreadGt3++; if (spread > 6) u.spreadGt6++; if (spread > u.max) u.max = +spread.toFixed(2);
      if (spread / diag > 0.8) u.slopeGt08++;
      if (name === 'ZR2') { const cz = out.canyon; cz.n = (cz.n || 0) + 1; if (spread / diag > 0.8) cz.onCliff = (cz.onCliff || 0) + 1; if (spread > 6) cz.gt6 = (cz.gt6 || 0) + 1; }
      if (b.zone === 'O' && spread > 3 && out.steep.length < 40) out.steep.push({ id: b.id, use: b.use, spread: +spread.toFixed(2), corners: c, pad: b.meta.pad || undefined });
      if (WATER_USES.has(b.use) && out.waterMeta.length < 60) {
        const m = b.meta;
        const rec = { id: b.id, use: b.use, spread: +spread.toFixed(2), water: m.water || null, sluice: m.sluice || null, servesSide: m.servesSide, intakeSide: m.intakeSide, poolSide: m.poolSide, pad: m.pad };
        if (m.sluice) rec.sluiceOk = m.sluice.up >= m.sluice.down && (m.sluice.upSide === 'left' || m.sluice.upSide === 'right');
        // is the water really behind the building? probe waterAt at the pool-side point (dist along -z)
        if (m.water && Number.isFinite(m.water.dist)) {
          const hdg = b.heading * Math.PI / 180, side = m.poolSide || m.intakeSide || 'back';
          const fz = { back: -1, front: 1 }[side] || 0, fx = { left: -1, right: 1 }[side] || 0;
          const de = Math.sin(hdg) * fz + Math.cos(hdg) * fx, dn = Math.cos(hdg) * fz - Math.sin(hdg) * fx;
          const kk = m.water.dist / 3389500, la = b.lat + dn * kk * 180 / Math.PI, lo = b.lon + de * kk * 180 / Math.PI / Math.cos(b.lat * Math.PI / 180);
          const q = latLonToUnit(la, lo, {}); waterAt(q.x, q.y, q.z, W);
          rec.probe = { type: W.type, kind: W.kind, level: +(W.level || 0).toFixed(2) };
        }
        if (iceQAt && b.use === 'meltwater_pump') rec.iceQ = +iceQAt(latLonToUnit(b.lat, b.lon, {})).toFixed(2);
        out.waterMeta.push(rec);
      }
      if (b.use === 'station' && out.stations.length < 30) out.stations.push({ id: b.id, railGround: b.meta.railGround, trackOffset: b.meta.trackOffset, railLevel: b.meta.railLevel, d: b.footprint.d, entrance: b.ground.entrance, elevated: b.meta.elevated });
      if (out.ids.length < 400 && (b.zone === 'O' || name === 'ZR2')) out.ids.push(b.id);
    }
    for (const st of d.stations) if (out.stations.length < 60) out.stations.push({ station: st.id, y: st.y, elevated: st.elevated, buildingId: st.buildingId });
  }
  out.areas[name] = { tiles, buildings: nb, msPerTile: +(ms / Math.max(1, tiles)).toFixed(1) };
  console.log(name, JSON.stringify(out.areas[name]));
}
// OX4 towns vs the cliff
if (iceQAt) {
  const S = await import('../src/world/urban/settlements.js');
  const c = latLonToUnit(73.6, 50, {});
  out.ox4Towns = S.townsNear(c.x, c.y, c.z, 320000).filter((t) => t.code === 'OX4').map((t) => ({ kind: t.kind, lat: +t.lat.toFixed(4), lon: +t.lon.toFixed(4), r: Math.round(t.radius), iceQ: +iceQAt(t).toFixed(2) }));
}
console.table(Object.entries(out.uses).map(([k, v]) => ({ use: k, ...v })));
console.log('canyon', out.canyon);
const sm = out.waterMeta;
console.log('water meta', sm.length, 'with water', sm.filter((r) => r.water).length, 'sluiceOk', sm.filter((r) => r.sluiceOk).length, '/', sm.filter((r) => r.sluice).length, 'probe wet', sm.filter((r) => r.probe && r.probe.type).length);
if (out.ox4Towns) console.log('ox4 towns', JSON.stringify(out.ox4Towns));
const file = opt('out', 'shots/urban/sites.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('wrote', file);
