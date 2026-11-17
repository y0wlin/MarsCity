// In-app preview of REAL city buildings (urban.generateCityTile specs on the real terrain) with the
// planet lighting patch, CSM shadows, GTAO and the atmosphere composite — i.e. exactly how the city
// streamer will show BuildingMeshData. Dev tool of the building-kit agent (not used by the app).
//
//   node scripts/shot.mjs --url "/?pose=22,118,2000,0,-30&time=10&clean=1" --idle 120000 \
//     --eval "const m = await import('/src/dev/buildings-inapp.js'); await m.run(window.__MARS__.app, {lat:22, lon:118, view:'street'})" \
//     --out shots/building-kit/app/street.png
//
// run(app, {lat, lon, id?, radius=180, lod='exterior', focusLod='full', view='street'|'entrance'|'lobby'|
//           'stair'|'living'|'back'|'roof'|'corner'|'aerial', pick=0, use?, city=false})
//   city=true: place nothing, only put the camera on the focus building (verifies render/city's own
//   streaming of the kit output); otherwise the city system's buildings are hidden while this runs.
//   loads the L13 city tile at (lat, lon), picks the focus building (spec id, or the pick-th nearest
//   building [of `use`]), generates every building within `radius` m of it ('mass' beyond), places them
//   with the floating origin and puts the camera on the focus building's anchors.cameras[view].
import * as THREE from 'three';
import { latLonToUnit, tileAt, latLonHToEcef, ecefToLatLonH, buildingAxes } from '../core/geo.js';
import { origin } from '../core/origin.js';
import { createBuildingObject, initBuildingMaterials, disposeBuildingObject } from '../buildings/materials.js';

const placed = [];
const state = { focus: null, fo: null };
let sys = null;

function placeMatrix(spec) {
  const e = latLonHToEcef(spec.lat, spec.lon, spec.ground.entrance);
  const A = buildingAxes(spec.lat, spec.lon, spec.heading);
  return { e, A };
}
function toEcef(P, p) {
  const { e, A } = P;
  return { x: e.x + A.x[0] * p[0] + A.y[0] * p[1] + A.z[0] * p[2], y: e.y + A.x[1] * p[0] + A.y[1] * p[1] + A.z[1] * p[2], z: e.z + A.x[2] * p[0] + A.y[2] * p[1] + A.z[2] * p[2] };
}

export async function run(app, opts = {}) {
  const { lat = 22, lon = 118, radius = 180, lod = 'exterior', focusLod = 'full', view = 'street', pick = 0 } = opts;
  await initBuildingMaterials(app);
  const u = latLonToUnit(lat, lon, {});
  const t = tileAt(u.x, u.y, u.z, 13, {});
  const tile = await app.workers.submit('cityTile', { face: t.face, x: t.x, y: t.y }, { priority: -10 }).promise;
  const specs = tile.buildings || [];
  if (!specs.length) return { error: 'no buildings in tile', tile: [t.face, t.x, t.y] };
  const dist = (s) => { const dl = (s.lat - lat) * 59158, dn = (s.lon - lon) * 59158 * Math.cos(lat * Math.PI / 180); return Math.hypot(dl, dn); };
  let focus = opts.id ? specs.find((s) => s.id === opts.id) : null;
  if (!focus) {
    const cand = specs.filter((s) => !opts.use || s.use === opts.use).sort((a, b) => dist(a) - dist(b));
    focus = cand[Math.min(pick, cand.length - 1)] || specs[0];
  }
  const fd = (s) => { const dl = (s.lat - focus.lat) * 59158, dn = (s.lon - focus.lon) * 59158 * Math.cos(focus.lat * Math.PI / 180); return Math.hypot(dl, dn); };
  for (const o of placed) { app.scene.remove(o.group); disposeBuildingObject(o.group); }
  placed.length = 0;
  // The city streamer (render/city) renders the same buildings: either hide its buildings while this
  // tool places its own (default — otherwise both z-fight), or (opts.city) place nothing and only
  // drive the camera so the city system's own streaming is what gets verified.
  const city = app.systems.city;
  if (opts.city) {
    const data = await app.workers.submit('building', { spec: focus, lod: 'exterior' }, { priority: -9 }).promise;
    state.focus = focus; state.fo = { spec: focus, data, P: placeMatrix(focus), lod: 'city' };
    setView(app, view, opts);
    return { focus: focus.id, use: focus.use, style: focus.style, floors: focus.floors, n: specs.length, tile: [t.face, t.x, t.y], mode: 'city' };
  }
  if (city) { if (city.massGroup) city.massGroup.visible = false; if (city.detail && city.detail.group) city.detail.group.visible = false; }
  const jobs = specs.map(async (s) => {
    const d = fd(s);
    const l = s === focus ? focusLod : d < radius ? lod : 'mass';
    const data = await app.workers.submit('building', { spec: s, lod: l }, { priority: s === focus ? -9 : -8 + d / 1000 }).promise;
    const group = createBuildingObject(data, app, { name: s.id });
    group.matrixAutoUpdate = false;
    const P = placeMatrix(s);
    placed.push({ spec: s, group, data, P, lod: l });
    app.scene.add(group);
    return data;
  });
  const datas = await Promise.all(jobs);
  if (!sys) {
    sys = {
      update() {
        for (const o of placed) {
          const { e, A } = o.P;
          o.group.matrix.set(A.x[0], A.y[0], A.z[0], e.x - origin.x, A.x[1], A.y[1], A.z[1], e.y - origin.y, A.x[2], A.y[2], A.z[2], e.z - origin.z, 0, 0, 0, 1);
          o.group.matrixWorldNeedsUpdate = true;
        }
      },
      isIdle() { return true; },
    };
    app.systems.bkInApp = sys;
  }
  state.focus = focus; state.fo = placed.find((o) => o.spec === focus);
  if (opts.compile !== false && app.renderer.compileAsync) { try { await app.renderer.compileAsync(app.scene, app.camera); } catch (e) { console.warn('[bk-inapp] compileAsync', e); } }
  setView(app, view, opts);
  const tris = datas.reduce((a, d) => a + d.stats.triangles, 0);
  return { focus: focus.id, use: focus.use, style: focus.style, floors: focus.floors, n: specs.length, tris, tile: [t.face, t.x, t.y], focusStats: state.fo.data.stats };
}

/** Put the camera on the focus building: anchors.cameras[view] or corner / aerial / front / back3 presets. */
export function setView(app, view = 'street', opts = {}) {
  const fo = state.fo; if (!fo) return null;
  const focus = fo.spec;
  const cams = fo.data.anchors.cameras || {};
  const b = fo.data.bounds, H = b.max[1], w = focus.footprint.w, dd = focus.footprint.d, R = Math.max(w, dd, H);
  let cam = cams[view];
  if (view === 'corner') cam = { pos: [w / 2 + R * 0.8, H * 0.6 + 4, dd / 2 + R * 0.9], target: [0, H * 0.4, 0] };
  if (view === 'aerial') cam = { pos: [-w * 1.2, H + R * 1.4 + 40, dd / 2 + R * 2.2 + 60], target: [0, H * 0.3, 0] };
  if (view === 'front') cam = { pos: [-w * 0.3, H * 0.45 + 2, dd / 2 + R * 1.25 + 6], target: [0, H * 0.42, 0] };
  if (view === 'back3') cam = { pos: [w * 0.4, H * 0.45 + 2, -dd / 2 - R * 1.1 - 6], target: [0, H * 0.4, 0] };
  if (opts.cam) cam = { pos: opts.cam, target: opts.target };
  if (!cam) cam = cams.street || { pos: [0, 1.65, dd / 2 + 20], target: [0, 4, 0] };
  const pe = toEcef(fo.P, cam.pos), te = toEcef(fo.P, cam.target);
  if (opts.setMode !== false) app.controls.setMode?.('fly');
  const g = ecefToLatLonH(pe.x, pe.y, pe.z);
  app.rig.setPose({ lat: g.lat, lon: g.lon, alt: g.h, heading: 0, pitch: 0, lens: opts.lens || 30 });
  app.rig.lookAtEcef(new THREE.Vector3(te.x, te.y, te.z));
  return { view, cam: g };
}
