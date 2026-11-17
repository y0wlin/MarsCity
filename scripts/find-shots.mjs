#!/usr/bin/env node
// Lead tool: search the frozen world for shot-card locations (prompt §5) and print bookmark poses.
//   node scripts/find-shots.mjs s07 [--lat 21.8705 --lon 117.9971]     ordinary residential near a station
//   node scripts/find-shots.mjs view <buildingId> <view>                pose from a building camera anchor
import { initWorldNode } from './node-world.mjs';
import { generateCityTile, buildingSpecById } from '../src/world/urban.js';
import { generateBuilding, registerTypeModules } from '../src/buildings/index.js';
import { tileAt, tileBounds, faceToVec, unitToLatLon, enuBasis, localToEcef, latLonHToEcef, ecefToLatLonH, buildingAxes, latLonToUnit } from '../src/core/geo.js';
import { CITY_TILE_LEVEL } from '../src/core/constants.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

initWorldNode();
const here = path.dirname(fileURLToPath(import.meta.url));
const typeDir = path.resolve(here, '../src/buildings/types');
const rec = {};
for (const f of fs.readdirSync(typeDir)) if (f.endsWith('.js')) rec[f] = await import(pathToFileURL(path.join(typeDir, f)).href);
registerTypeModules(rec);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DEG = Math.PI / 180;

function tileCenter(face, x, y) {
  const b = tileBounds(face, CITY_TILE_LEVEL, x, y);
  const c = faceToVec(face, (b.a0 + b.a1) / 2, (b.b0 + b.b1) / 2);
  const ll = unitToLatLon(c.x, c.y, c.z);
  return { lat: ll.lat, lon: ll.lon, ecef: latLonHToEcef(ll.lat, ll.lon, 0), basis: enuBasis(ll.lat, ll.lon) };
}
function tileLocalToLatLonH(tc, p) {
  const e = localToEcef(tc.ecef, tc.basis, p[0], p[1], p[2]);
  const g = ecefToLatLonH(e.x, e.y, e.z);
  return g;
}
/** building-local point -> ECEF */
function bLocalToEcef(spec, p) {
  const O = latLonHToEcef(spec.lat, spec.lon, spec.ground.entrance);
  const A = buildingAxes(spec.lat, spec.lon, spec.heading);
  return { x: O.x + A.x[0] * p[0] + A.y[0] * p[1] + A.z[0] * p[2], y: O.y + A.x[1] * p[0] + A.y[1] * p[1] + A.z[1] * p[2], z: O.z + A.x[2] * p[0] + A.y[2] * p[1] + A.z[2] * p[2] };
}
/** camera pose from ECEF eye + target */
function poseFrom(eye, target, lens = 32) {
  const g = ecefToLatLonH(eye.x, eye.y, eye.z);
  const B = enuBasis(g.lat, g.lon);
  const d = [target.x - eye.x, target.y - eye.y, target.z - eye.z];
  const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
  const fe = d[0] * B.east[0] + d[1] * B.east[1] + d[2] * B.east[2];
  const fn = d[0] * B.north[0] + d[1] * B.north[1] + d[2] * B.north[2];
  const fu = d[0] * B.up[0] + d[1] * B.up[1] + d[2] * B.up[2];
  return { lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7), alt: +g.h.toFixed(2), heading: +(((Math.atan2(fe, fn) / DEG) + 360) % 360).toFixed(2), pitch: +(Math.asin(fu) / DEG).toFixed(2), lens };
}

const mode = args[0];
if (mode === 's07') {
  const lat0 = +opt('lat', 21.8705), lon0 = +opt('lon', 117.9971);
  const u = latLonToUnit(lat0, lon0);
  const t0 = tileAt(u.x, u.y, u.z, CITY_TILE_LEVEL);
  const cands = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tile = generateCityTile(t0.face, t0.x + dx, t0.y + dy);
    const tc = tileCenter(t0.face, t0.x + dx, t0.y + dy);
    const stations = (tile.stations || []).map((s) => ({ ...s, geo: tileLocalToLatLonH(tc, [s.x, s.y, s.z]) }));
    for (const s of stations) console.log('station', s.id, s.buildingId, s.elevated ? 'elevated' : 'grade', s.geo.lat.toFixed(5), s.geo.lon.toFixed(5), 'h', s.geo.h.toFixed(1), 'heading', s.heading);
    cands.push({ tile, tc, stations });
  }
  const allStations = cands.flatMap((c) => c.stations);
  const res = [];
  for (const c of cands) for (const b of c.tile.buildings) {
    if (b.use !== 'residential' || b.floors < 4 || b.floors > 9) continue;
    for (const s of allStations) {
      const P = latLonHToEcef(b.lat, b.lon, 0), S = latLonHToEcef(s.geo.lat, s.geo.lon, 0);
      const d = Math.hypot(P.x - S.x, P.y - S.y, P.z - S.z);
      if (d < 45 || d > 170) continue;
      const A = buildingAxes(b.lat, b.lon, b.heading);
      const toS = [(S.x - P.x) / d, (S.y - P.y) / d, (S.z - P.z) / d];
      const facing = A.z[0] * toS[0] + A.z[1] * toS[1] + A.z[2] * toS[2];
      if (facing < 0.55) continue;
      res.push({ id: b.id, floors: b.floors, w: b.footprint.w, d: b.footprint.d, dist: +d.toFixed(0), facing: +facing.toFixed(2), station: s.id, elevated: !!s.elevated, entrances: b.entrances.map((e) => e.kind + ':' + e.side).join(',') });
    }
  }
  res.sort((a, b) => (b.facing - a.facing) || (a.dist - b.dist));
  console.log(JSON.stringify(res.slice(0, 15), null, 1));
} else if (mode === 'view') {
  const id = args[1];
  const spec = buildingSpecById(id);
  if (!spec) { console.log('no spec'); process.exit(1); }
  const data = generateBuilding(spec, 'exterior');
  const cams = data.anchors.cameras || {};
  console.log('building', id, spec.use, spec.floors, 'heading', spec.heading, 'ground', spec.ground);
  for (const [k, c] of Object.entries(cams)) {
    const eye = bLocalToEcef(spec, c.pos), tgt = bLocalToEcef(spec, c.target);
    console.log(k, JSON.stringify(poseFrom(eye, tgt, k === 'street' ? 32 : 28)));
  }
} else {
  console.log('usage: s07 | view <id>');
}
