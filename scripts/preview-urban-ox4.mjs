#!/usr/bin/env node
// OX4 北冠冰缘 check / S04 viewpoints (fix round 1): lists the meltwater outlets of hydro.iceFootSystem with the
// plan's ensembles (meltwater pump on the forebay pool + lee greenhouse row, station settlement) and proposes
// a §5 04 camera per outlet: from the lowland ~1.4 km out, across the water, looking back at the pump house,
// the greenhouse row and the ice cliff (60 mm). Run from web/:  node scripts/preview-urban-ox4.mjs [--json out]
import { initWorldNode } from './node-world.mjs';
import fs from 'fs';
initWorldNode();
const U = await import('../src/world/urban.js');
const M = await import('../src/world/urban/melt.js');
const S = await import('../src/world/urban/settlements.js');
const { latLonToUnit, tileAt, unitToLatLon, enuBasisFromUnit } = await import('../src/core/geo.js');
const { heightAt } = await import('../src/world/terrain.js');
const { waterAt } = await import('../src/world/hydro.js');
const R = 3389500, D2R = Math.PI / 180;
const args = process.argv.slice(2);
const outs = M.meltOutlets();
const c0 = latLonToUnit(74.3, 45, {});
const towns = S.townsNear(c0.x, c0.y, c0.z, 1400000).filter((t) => t.outlet >= 0);
const byOutlet = new Map(towns.map((t) => [t.outlet, t]));
const offset = (p, e, n) => { const E = enuBasisFromUnit(p.x, p.y, p.z, {}); const k = 1 / R; let x = p.x + (E.east[0] * e + E.north[0] * n) * k, y = p.y + (E.east[1] * e + E.north[1] * n) * k, z = p.z + (E.east[2] * e + E.north[2] * n) * k; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
const rows = [];
for (const o of outs) {
  const t = tileAt(o.x, o.y, o.z, 13, {});
  const ens = [];
  const seen = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const d = U.generateCityTile(t.face, t.x + dx, t.y + dy);
    for (const b of d.buildings) if (b.meta.outletId === o.id && !seen.has(b.id)) { seen.add(b.id); ens.push(b); }
  }
  const pump = ens.find((b) => b.use === 'meltwater_pump');
  const gh = ens.filter((b) => b.use === 'greenhouse');
  const town = byOutlet.get(o.idx);
  const ll = unitToLatLon(o.x, o.y, o.z, {});
  const row = { id: o.id, lat: +ll.lat.toFixed(5), lon: +ll.lon.toFixed(5), poolR: o.r, level: o.level, heading: o.hdg, pump: pump ? pump.id : null, servesSide: pump ? pump.meta.servesSide : null, greenhouses: gh.length, station: !!town };
  if (pump) {
    // §5 04 camera: on the far side of the forebay pool (opposite flank to the pump house), ~600 m out
    // toward the lowland, ~10 m above ground / water, 55 mm, looking across the pool at the pump house and
    // the greenhouse row with the ice cliff behind them
    const tE = Math.cos(o.hdg * D2R), tN = -Math.sin(o.hdg * D2R);           // along the foot (+90° of outward)
    const P = { x: o.x, y: o.y, z: o.z };
    const pp = latLonToUnit(pump.lat, pump.lon, {});
    const Ee = enuBasisFromUnit(P.x, P.y, P.z, {});
    const dx = (pp.x - P.x) * R, dy = (pp.y - P.y) * R, dz = (pp.z - P.z) * R;
    const side = Math.sign((dx * Ee.east[0] + dy * Ee.east[1] + dz * Ee.east[2]) * tE + (dx * Ee.north[0] + dy * Ee.north[1] + dz * Ee.north[2]) * tN) || 1;
    const C = offset(P, o.oe * 600 - tE * side * 350, o.on * 600 - tN * side * 350);
    const A = offset(P, o.oe * 30 + tE * side * (o.r + 40), o.on * 30 + tN * side * (o.r + 40));
    const cl = unitToLatLon(C.x, C.y, C.z, {});
    let g = heightAt(C.x, C.y, C.z, 2);
    const Wt = waterAt(C.x, C.y, C.z, {});
    if (Wt.type && Wt.level > g) g = Wt.level;
    const Ec = enuBasisFromUnit(C.x, C.y, C.z, {});
    const ax = (A.x - C.x), ay = (A.y - C.y), az = (A.z - C.z);
    const hdg = (Math.atan2(ax * Ec.east[0] + ay * Ec.east[1] + az * Ec.east[2], ax * Ec.north[0] + ay * Ec.north[1] + az * Ec.north[2]) / D2R + 360) % 360;
    row.camera = { lat: +cl.lat.toFixed(5), lon: +cl.lon.toFixed(5), alt: +(g + 10).toFixed(1), heading: +hdg.toFixed(1), pitch: 6, lens: 55, ground: +g.toFixed(1), onWater: !!Wt.type };
    row.pose = `${row.camera.lat},${row.camera.lon},${row.camera.alt},${row.camera.heading},${row.camera.pitch},55`;
    row.time8 = +(((8 - row.camera.lon / 15) % 24 + 24) % 24).toFixed(3);
  }
  rows.push(row);
}
console.table(rows.map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, pump: !!r.pump, gh: r.greenhouses, station: r.station, pose: r.pose || '', time: r.time8 })));
if (args.includes('--json')) { fs.mkdirSync('shots/urban', { recursive: true }); fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(rows, null, 1)); }
