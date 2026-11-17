// Controls test bench (OWNER: controls agent). Self-contained mini app that exercises the real
// CameraRig + ControlsSystem against:
//   * BenchTerrain — planet sphere + a 6.4 km relief patch at SITE (0.2 m vertex spacing at the
//     centre) with a flat building pad, a walkable 28° slope (east) and a 52° bank (north);
//     contract-compatible raycast / heightAtLatLon / groundHeightAt
//   * BenchCity — buildings with three-mesh-bvh colliders: B1 two-storey house (door, interior
//     stair 17×0.175 m, upper floor), B2 outdoor steps 0.30 m + blocks 0.30 / 0.45 m, B3 ramps
//     25° / 52°, B4 60 m tower; raycast / getColliders / focusInfo / getBuilding
// URL: /dev/controls.html?pose=lat,lon,alt,heading,pitch&mode=walk&clean=1
// Automation: window.__MARS__ (ready, waitIdle, pose, goto, stats) and window.__BENCH__ (tests).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R, DEG, RAD } from '../core/constants.js';
import { origin, setOrigin } from '../core/origin.js';
import { latLonToUnit, latLonHToEcef, ecefToLatLonH, enuBasis, buildingAxes, unitToLatLon, vecToFace, faceToVec } from '../core/geo.js';
import { FACE_ARC } from '../core/constants.js';
import { loadControlMaps, getControlMaps } from '../data/controlMaps.js';
import { EventBus } from '../app/events.js';
import { AppState } from '../app/state.js';
import { sunDirection, solTimeForLocal } from '../app/sun.js';
import { CameraRig } from '../controls/CameraRig.js';
import { ControlsSystem, CONTROLS_HELP, WALK } from '../controls/index.js';
import { quatAngle } from '../controls/math.js';

export const SITE = { lat: 22.0, lon: 118.0 };
const U0 = latLonToUnit(SITE.lat, SITE.lon);
const BAS = enuBasis(SITE.lat, SITE.lon);
const E = new THREE.Vector3(...BAS.east), N = new THREE.Vector3(...BAS.north), UP = new THREE.Vector3(...BAS.up);
const SITE_R = new THREE.Vector3(U0.x, U0.y, U0.z).multiplyScalar(R);
const BASE_H = 20;
const PATCH = 3200;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** local tangent coordinates (x east, y north) of a unit direction (central projection) */
function toLocalXY(ux, uy, uz, out) {
  const dot = ux * U0.x + uy * U0.y + uz * U0.z;
  if (dot < 0.5) { out.x = 1e9; out.y = 1e9; return out; }
  const k = R / dot;
  const qx = ux * k - SITE_R.x, qy = uy * k - SITE_R.y, qz = uz * k - SITE_R.z;
  out.x = qx * E.x + qy * E.y + qz * E.z;
  out.y = qx * N.x + qy * N.y + qz * N.z;
  return out;
}
/** ECEF of local (x east, y north) at height h above sea level */
export function localToEcef(x, y, h, out = new THREE.Vector3()) {
  out.copy(SITE_R).addScaledVector(E, x).addScaledVector(N, y);
  return out.multiplyScalar((R + h) / out.length());
}

export function hLocal(x, y) {
  const r = Math.max(Math.abs(x), Math.abs(y));
  if (r >= PATCH) return 0;
  let h = BASE_H + 5 * Math.sin(x / 41) * Math.cos(y / 57) + 2.2 * Math.sin((x + 2 * y) / 23) + 0.35 * Math.sin(x / 3.1) * Math.sin(y / 2.7);
  h += (BASE_H - h) * sm(150, 110, r);
  const rampE = x > 170 ? Math.min(x - 170, 40) * Math.tan(28 * DEG) * sm(42, 30, Math.abs(y)) : 0;
  const bankN = y > 180 ? Math.min(y - 180, 16) * Math.tan(52 * DEG) * sm(52, 40, Math.abs(x)) : 0;
  h = Math.max(h, BASE_H + rampE, BASE_H + bankN);
  // pond (water surface POND.level): deeper than 0.6 m inside ~20 m from its centre
  const dp = Math.hypot(x - POND.x, y - POND.y);
  if (dp < 26) h = Math.min(h, BASE_H - 2.2 * sm(26, 14, dp));
  return h * sm(PATCH, PATCH * 0.75, r);
}
export const POND = { x: 90, y: -90, level: BASE_H - 0.4, r: 26 };
const _ll = {};
function hAtUnit(ux, uy, uz) { toLocalXY(ux, uy, uz, _ll); return hLocal(_ll.x, _ll.y); }

// =================================================================================== terrain
class BenchTerrain {
  constructor(app) { this.app = app; }
  async init() {
    const app = this.app;
    // planet sphere coloured from the control maps (far views)
    const maps = getControlMaps();
    const W = 2048, H = 1024, data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = (H - 1 - y) * W + x;
      const water = maps.water.data[i] > 127, dens = maps.density.data[i] / 255;
      const zo = maps.zone.data[(y * 2) * 4096 + x * 2] > 127;
      let r = 168, g = 82, b = 48; if (zo) { r = 122; g = 98; b = 58; }
      r += (214 - r) * dens; g += (214 - g) * dens; b += (208 - b) * dens;
      if (water) { r = 22; g = 52; b = 112; }
      data[o * 4] = r; data[o * 4 + 1] = g; data[o * 4 + 2] = b; data[o * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
    const sg = new THREE.SphereGeometry(R - 2, 384, 192);
    const pos = sg.attributes.position, uv = sg.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setX(i, (Math.atan2(pos.getX(i), pos.getZ(i)) * RAD + 180) / 360);
    this.sphere = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    this.sphere.frustumCulled = false;
    app.scene.add(this.sphere);

    // relief patch: sinh-spaced grid, fine at the centre
    const NS = 600, k = 6.5, S = PATCH;
    const coord = (u) => (S * Math.sinh(k * u)) / Math.sinh(k);
    const nv = NS + 1;
    const P = new Float32Array(nv * nv * 3), C = new Float32Array(nv * nv * 3);
    const v = new THREE.Vector3();
    for (let j = 0; j < nv; j++) for (let i = 0; i < nv; i++) {
      const x = coord(-1 + (2 * i) / NS), y = coord(-1 + (2 * j) / NS);
      const h = hLocal(x, y);
      localToEcef(x, y, h, v).sub(SITE_R);
      const o = (j * nv + i) * 3;
      P[o] = v.x; P[o + 1] = v.y; P[o + 2] = v.z;
      const steep = Math.min(1, Math.abs(hLocal(x + 0.5, y) - h) / 0.5 + Math.abs(hLocal(x, y + 0.5) - h) / 0.5);
      const pad = sm(150, 110, Math.max(Math.abs(x), Math.abs(y)));
      const chk = ((Math.floor(x / 5) + Math.floor(y / 5)) & 1) ? 0.92 : 1.0;
      C[o] = (0.62 - 0.12 * steep) * chk * (1 - 0.25 * pad) + 0.25 * pad * chk; C[o + 1] = (0.36 - 0.06 * steep) * chk * (1 - 0.1 * pad) + 0.2 * pad * chk; C[o + 2] = 0.24 * chk * (1 - 0.2 * pad) + 0.2 * pad * chk;
    }
    const idx = new Uint32Array(NS * NS * 6);
    let t = 0;
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
      const a = j * nv + i, b = a + 1, c = a + nv, d = c + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.boundsTree = new MeshBVH(g);
    this.patch = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
    this.patch.frustumCulled = false;
    app.scene.add(this.patch);
    this._inv = new THREE.Matrix4(); this._ray = new THREE.Ray();
    // pond: water disc + a contract-shaped "displayed tile" carrying the water grid (ARCHITECTURE §8)
    const pc = localToEcef(POND.x, POND.y, POND.level);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(POND.r - 1, 64), new THREE.MeshStandardMaterial({ color: 0x1f5d8c, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.85 }));
    const up = pc.clone().normalize();
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    disc.userData.anchor = pc;
    app.scene.add(disc);
    this.pond = disc;
    const fc = vecToFace(up.x, up.y, up.z);
    const da = 220 / FACE_ARC, n = 65;
    const tile = { key: 'bench-pond', face: fc.face, level: 18, n, bounds: { a0: fc.a - da, a1: fc.a + da, b0: fc.b - da, b1: fc.b + da } };
    const type = new Uint8Array(n * n), level = new Float32Array(n * n), depth = new Float32Array(n * n);
    const q = {};
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = faceToVec(fc.face, tile.bounds.a0 + (2 * da * i) / (n - 1), tile.bounds.b0 + (2 * da * j) / (n - 1), q);
      const h = hAtUnit(v.x, v.y, v.z), k = j * n + i;
      level[k] = POND.level; depth[k] = POND.level - h; type[k] = h < POND.level ? 3 : 0;
    }
    tile.water = { type, level, depth, hasLake: true, minLevel: POND.level, maxLevel: POND.level };
    this.tiles = [tile];
  }
  drawnTiles() { return this.tiles; }
  update() {
    const a = this.pond.userData.anchor; this.pond.position.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
    this.sphere.position.set(-origin.x, -origin.y, -origin.z);
    this.patch.position.set(SITE_R.x - origin.x, SITE_R.y - origin.y, SITE_R.z - origin.z);
    this.patch.updateMatrixWorld(true);
  }
  isIdle() { return true; }
  heightAtLatLon(lat, lon) { const u = latLonToUnit(lat, lon); return hAtUnit(u.x, u.y, u.z); }
  /** displayed surface (mesh) like the real terrain's groundHeightAt */
  groundHeightAt(lat, lon) {
    const u = latLonToUnit(lat, lon);
    toLocalXY(u.x, u.y, u.z, _ll);
    if (Math.max(Math.abs(_ll.x), Math.abs(_ll.y)) >= PATCH * 0.99) return -2;
    // ray down onto the patch (local frame = ECEF offset from SITE_R)
    const top = R + 3000;
    this._ray.origin.set(u.x * top - SITE_R.x, u.y * top - SITE_R.y, u.z * top - SITE_R.z);
    this._ray.direction.set(-u.x, -u.y, -u.z);
    const hit = this.patch.geometry.boundsTree.raycastFirst(this._ray, THREE.DoubleSide);
    if (!hit) return hAtUnit(u.x, u.y, u.z);
    return 3000 - hit.distance;
  }
  raycast(o, d) {
    const ox = o.x + origin.x, oy = o.y + origin.y, oz = o.z + origin.z;
    this._ray.origin.set(ox - SITE_R.x, oy - SITE_R.y, oz - SITE_R.z);
    this._ray.direction.copy(d).normalize();
    const hit = this.patch.geometry.boundsTree.raycastFirst(this._ray, THREE.DoubleSide);
    let t = hit ? hit.distance : -1;
    if (t < 0) {
      const rr = R - 2, b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - rr * rr, disc = b * b - c;
      if (disc < 0) return null;
      t = -b - Math.sqrt(disc); if (t < 0) return null;
    }
    const ex = ox + d.x * t, ey = oy + d.y * t, ez = oz + d.z * t;
    const ll = ecefToLatLonH(ex, ey, ez);
    return { distance: t, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), ecef: { x: ex, y: ey, z: ez }, lat: ll.lat, lon: ll.lon, h: ll.h, tile: { bench: true } };
  }
}

// =================================================================================== city
function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
/** solid ramp rising from z0 (h=0) to z1 (h=h) over x∈[x0,x1] */
function wedge(x0, x1, z0, z1, h) {
  const p = [];
  const A = [x0, 0, z0], B = [x1, 0, z0], C = [x1, 0, z1], D = [x0, 0, z1], Ct = [x1, h, z1], Dt = [x0, h, z1];
  const tri = (a, b, c) => p.push(...a, ...b, ...c);
  tri(A, C, B); tri(A, D, C);            // bottom
  tri(A, B, Ct); tri(A, Ct, Dt);         // slope
  tri(D, Dt, Ct); tri(D, Ct, C);         // back
  tri(A, Dt, D); tri(B, C, Ct);          // sides
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  // make every face front-facing outward regardless of the slope direction
  g.computeVertexNormals();
  return g;
}
function merge(parts) {
  const list = parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); if (!n.attributes.normal) n.computeVertexNormals(); return n; });
  const m = mergeGeometries(list, false);
  m.computeBoundingBox(); m.computeBoundingSphere();
  return m;
}

function houseB1() {
  const t = 0.25, H1 = 3.1, H = 6.2, th = 0.15;
  const parts = [
    box(-6, 6, -0.4, th, -5, 5),
    box(-6, -0.75, th, H, 5 - t, 5), box(0.75, 6, th, H, 5 - t, 5), box(-0.75, 0.75, th + 2.25, H, 5 - t, 5),
    box(-6, 6, th, H, -5, -5 + t), box(-6, -6 + t, th, H, -5, 5), box(6 - t, 6, th, H, -5, 5),
    // upper floor slab with the stair opening x∈[2.75,4.35], z∈[-1.6,3.8]
    box(-6 + t, 2.75, H1, H1 + 0.2, -5 + t, 5 - t), box(4.35, 6 - t, H1, H1 + 0.2, -5 + t, 5 - t),
    box(2.75, 4.35, H1, H1 + 0.2, -5 + t, -1.6), box(2.75, 4.35, H1, H1 + 0.2, 3.8, 5 - t),
    box(-6, 6, H, H + 0.3, -5, 5),
  ];
  for (let i = 0; i < 17; i++) parts.push(box(2.9, 4.2, th, th + 0.175 * (i + 1), 3.5 - (i + 1) * 0.3, 3.5 - i * 0.3));
  return merge(parts);
}
function stepsB2() {
  const parts = [];
  for (let i = 0; i < 10; i++) parts.push(box(-1, 1, 0, 0.3 * (i + 1), 3 - (i + 1) * 0.4, 3 - i * 0.4));
  parts.push(box(-1, 1, 0, 3, -5, -1));
  parts.push(box(2, 4, 0, 0.45, -1, 3));    // too tall to step on
  parts.push(box(5, 7, 0, 0.3, -1, 3));     // climbable
  return merge(parts);
}
function rampsB3() {
  const r25 = 3 / Math.tan(25 * DEG), r52 = 3 / Math.tan(52 * DEG);
  return merge([
    wedge(-1, 1, 4, 4 - r25, 3), box(-1, 1, 0, 3, 4 - r25 - 4, 4 - r25),
    wedge(3, 5, 4, 4 - r52, 3), box(3, 5, 0, 3, 4 - r52 - 4, 4 - r52),
  ]);
}
function towerB4() { return merge([box(-10, 10, 0, 60, -10, 10)]); }

class BenchCity {
  constructor(app) { this.app = app; this.list = []; this.byId = new Map(); this._inv = new THREE.Matrix4(); this._ray = new THREE.Ray(); }
  async init() {
    this.add('B1', 0, 40, 180, houseB1(), 0xd9d4ca, { w: 12, d: 10, floors: 2, entrances: [{ kind: 'main', pos: [0, 0.15, 5], dir: [0, 0, 1], width: 1.5 }],
      // §5 shot-07 viewpoints in the building frame (like BuildingMeshData anchors.cameras)
      cameras: {
        street: { pos: [-4, 1.65, 27], target: [0, 2.8, 0] }, entrance: { pos: [2.2, 1.8, 10.5], target: [0, 1.45, 3] },
        lobby: { pos: [0.5, 1.8, 3.6], target: [-1.5, 1.3, -3] }, stair: { pos: [3.55, 1.8, 4.3], target: [3.55, 2.5, -1] },
        living: { pos: [-3, 4.95, -3.6], target: [-3, 4.3, 8] }, back: { pos: [3.6, 1.65, -17], target: [0, 4, -5] },
        roof: { pos: [1.5, 8.15, 2.5], target: [0, 7, -2] },
      } });
    this.add('B2', 40, 0, 90, stepsB2(), 0xbfc6cc, { w: 14, d: 10, floors: 1, entrances: [{ kind: 'main', pos: [0, 0, 3], dir: [0, 0, 1], width: 2 }] });
    this.add('B3', -40, 0, 270, rampsB3(), 0xc9c0b0, { w: 8, d: 14, floors: 1, entrances: [{ kind: 'main', pos: [0, 0, 4], dir: [0, 0, 1], width: 2 }] });
    this.add('B4', 0, -70, 0, towerB4(), 0xa9b8c4, { w: 20, d: 20, floors: 19, entrances: [{ kind: 'main', pos: [0, 0, 10], dir: [0, 0, 1], width: 3 }] });
  }
  add(id, x, y, heading, geo, color, meta) {
    const u = localToEcef(x, y, 0).normalize();
    const ll = unitToLatLon(u.x, u.y, u.z, {});
    const g0 = hLocal(x, y);
    const ax = buildingAxes(ll.lat, ll.lon, heading);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...ax.x), new THREE.Vector3(...ax.y), new THREE.Vector3(...ax.z));
    const anchor = new THREE.Vector3().copy(u).multiplyScalar(R + g0);
    geo.boundsTree = new MeshBVH(geo);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.frustumCulled = false;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x2a2f36 }));
    mesh.add(edges);
    this.app.scene.add(mesh);
    const bb = geo.boundingBox;
    const cL = bb.getCenter(new THREE.Vector3());
    const spec = { id, lat: ll.lat, lon: ll.lon, heading, ground: { entrance: g0, min: g0, max: g0 }, footprint: { shape: 'rect', w: meta.w, d: meta.d }, floors: meta.floors, floorHeight: 3.1, use: 'bench', entrances: [{ kind: 'main', side: 'front', offset: 0, width: meta.entrances[0].width }] };
    const b = { id, spec, mesh, anchor, quat: mesh.quaternion.clone(), centerLocal: cL, radius: bb.getSize(new THREE.Vector3()).length() / 2, meta };
    this.list.push(b); this.byId.set(id, b);
    return b;
  }
  update() {
    for (const b of this.list) { b.mesh.position.set(b.anchor.x - origin.x, b.anchor.y - origin.y, b.anchor.z - origin.z); b.mesh.updateMatrixWorld(true); }
  }
  isIdle() { return true; }
  raycast(o, d) {
    let best = null;
    for (const b of this.list) {
      this._inv.copy(b.mesh.matrixWorld).invert();
      this._ray.origin.copy(o).applyMatrix4(this._inv);
      this._ray.direction.copy(d).transformDirection(this._inv);
      const hit = b.mesh.geometry.boundsTree.raycastFirst(this._ray, THREE.DoubleSide);
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, buildingId: b.id, spec: b.spec, point: new THREE.Vector3().copy(o).addScaledVector(d, hit.distance) };
    }
    return best;
  }
  /** colliderForm 'matrix' (mesh.matrixWorld) or 'anchor' ({anchor ECEF, quaternion} placement) */
  getColliders(near, radius) {
    const out = [];
    for (const b of this.list) {
      if (this.withheld && this.withheld.has(b.id)) continue; // simulates a 'full' LOD still loading
      if (Math.hypot(b.anchor.x - near.x, b.anchor.y - near.y, b.anchor.z - near.z) >= radius + b.radius + 5) continue;
      if (this.colliderForm === 'anchor') {
        const c = b._anchorCol || (b._anchorCol = { mesh: new THREE.Mesh(b.mesh.geometry), anchor: { x: b.anchor.x, y: b.anchor.y, z: b.anchor.z }, quaternion: b.quat.clone(), id: b.id });
        out.push(c);
      } else out.push({ mesh: b.mesh, matrixWorld: b.mesh.matrixWorld, id: b.id });
    }
    return out;
  }
  localToWorld(b, l, out = new THREE.Vector3(), dir = false) {
    out.set(l[0], l[1], l[2]).applyQuaternion(b.quat);
    if (!dir) out.add(b.anchor);
    return out;
  }
  focusInfo(id) {
    const b = this.byId.get(id); if (!b) return null;
    const c = this.localToWorld(b, [b.centerLocal.x, b.centerLocal.y, b.centerLocal.z]);
    const entrances = b.meta.entrances.map((e) => ({ kind: e.kind, positionEcef: this.localToWorld(b, e.pos), dirEcef: this.localToWorld(b, e.dir, new THREE.Vector3(), true), width: e.width }));
    // cameras in the building frame (anchors form); `frame` gives that frame explicitly
    return { centerEcef: { x: c.x, y: c.y, z: c.z }, radius: b.radius, heading: b.spec.heading, spec: b.spec, entrances,
      anchors: b.meta.cameras ? { cameras: b.meta.cameras } : undefined, frame: { originEcef: { x: b.anchor.x, y: b.anchor.y, z: b.anchor.z }, quaternion: b.quat } };
  }
  getBuilding(id) { const b = this.byId.get(id); return b ? { spec: b.spec, object3d: b.mesh } : null; }
}

// =================================================================================== app
const container = document.getElementById('app');
const hud = document.getElementById('bench-hud');
const helpEl = document.getElementById('bench-help');
const q = new URLSearchParams(location.search);

const app = {
  events: new EventBus(), rig: new CameraRig(), scene: new THREE.Scene(), frame: null, frameNo: 0, fps: 60,
};
app.state = new AppState(app.events);
app.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2e8);
window.__BENCH_APP__ = app;

async function start() {
  const base = import.meta.env.BASE_URL || '/';
  await loadControlMaps(base.endsWith('/') ? base : base + '/');
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'mars-canvas';
  app.renderer = renderer;

  app.sun = new THREE.DirectionalLight(0xfff1e0, 2.6);
  app.scene.add(app.sun, app.sun.target);
  app.hemi = new THREE.HemisphereLight(0x9fb8d8, 0x7a5040, 0.85);
  app.scene.add(app.hemi);
  app.state.setTime(solTimeForLocal(SITE.lon, 10.2));

  app.systems = { terrain: new BenchTerrain(app), city: new BenchCity(app), mega: null };
  app.systems.controls = new ControlsSystem(app);
  app.controls = app.systems.controls;
  for (const k of ['terrain', 'city', 'controls']) await app.systems[k].init();

  const resize = () => {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    app.camera.aspect = w / h; app.camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  // default: looking at the site from 600 m
  app.rig.setPose({ lat: SITE.lat - 0.004, lon: SITE.lon, alt: 420, heading: 0, pitch: -38 });
  if (q.get('pose')) { const [lat, lon, alt, heading = 0, pitch = -90, lens] = q.get('pose').split(',').map(Number); app.rig.setPose({ lat, lon, alt, heading, pitch, lens: lens || undefined }); }
  if (q.get('clean') === '1') { app.state.set('clean', true); document.body.classList.add('clean'); }
  if (q.get('mode')) app.controls.setMode(q.get('mode'));
  helpEl.textContent = CONTROLS_HELP;
  expose();
  const clock = new THREE.Timer();
  renderer.setAnimationLoop(() => tick(clock));
}

const _sun = new THREE.Vector3();
function tick(clock) {
  clock.update();
  const dt = Math.min(0.1, clock.getDelta());
  app.frameNo++; app.fps = app.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  app.controls.update({ dt, pre: true });
  const p = app.rig.position;
  setOrigin(p.x, p.y, p.z);
  const cam = app.camera;
  cam.quaternion.copy(app.rig.quaternion); cam.position.set(0, 0, 0);
  const vf = app.rig.vfov(cam.aspect);
  if (Math.abs(cam.fov - vf) > 1e-6) { cam.fov = vf; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld(true);
  const g = ecefToLatLonH(p.x, p.y, p.z);
  const frame = { dt, frameNo: app.frameNo, camLat: g.lat, camLon: g.lon, camAlt: g.h, camera: cam };
  app.frame = frame;
  app.systems.terrain.update(frame);
  app.systems.city.update(frame);
  app.controls.update(frame);
  sunDirection(app.state.solTime, app.state.subsolarLat, _sun);
  app.sun.position.copy(_sun).multiplyScalar(1000); app.sun.target.position.set(0, 0, 0);
  const alt = g.h;
  const sky = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(alt, 10)) / 5.2));
  app.scene.background = new THREE.Color(0.02 + 0.33 * sky, 0.03 + 0.43 * sky, 0.06 + 0.6 * sky);
  app.renderer.render(app.scene, cam);
  if (!app.state.settings.clean && (app.frameNo & 3) === 0) {
    const c = app.controls, info = c.cameraInfo(), ps = info.pose;
    const w = info.walk;
    hud.textContent = `mode ${info.mode}${info.transition ? `  ✈ ${(info.transition.progress * 100).toFixed(0)}%` : ''}  back ${info.backDepth}  autoTilt ${info.autoTilt}\n` +
      `lat ${ps.lat.toFixed(6)}  lon ${ps.lon.toFixed(6)}  alt ${ps.alt.toFixed(2)} m  hAG ${info.heightAboveGround.toFixed(2)} m\n` +
      `heading ${ps.heading.toFixed(1)}°  pitch ${ps.pitch.toFixed(1)}°  roll ${ps.roll.toFixed(3)}°  focus ${info.focusDistance.toFixed(1)} m  fps ${app.fps.toFixed(0)}` +
      (w ? `\nwalk grounded ${w.grounded} on ${w.groundKind}  feet ${w.feetH.toFixed(3)}  ground ${w.groundH.toFixed(3)}  v ${w.speed.toFixed(2)} m/s  colliders ${w.colliders}${w.inWater ? '  WATER' : ''}` : '') +
      (app.lastTest ? `\n${app.lastTest}` : '');
  }
}

// =================================================================================== automation
const frames = async (n = 1) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
const until = async (fn, timeout = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < timeout) { if (fn()) return true; await frames(1); } return false; };
function canvasRect() { return app.renderer.domElement.getBoundingClientRect(); }
const rc = canvasRect;
function project(p) {
  const r = canvasRect();
  const n = app.rig.projectNdc(p, r.width / r.height);
  return { x: r.left + (n.x + 1) / 2 * r.width, y: r.top + (1 - n.y) / 2 * r.height, depth: n.z };
}
function ptr(type, x, y, o = {}) {
  app.renderer.domElement.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: o.button ?? 0, buttons: o.buttons ?? (type === 'pointerup' ? 0 : 1 << (o.button === 2 ? 1 : o.button === 1 ? 2 : 0)), pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', isPrimary: (o.id ?? 1) === 1, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, bubbles: true, cancelable: true }));
}
function wheel(x, y, deltaY, o = {}) { app.renderer.domElement.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY, deltaMode: o.mode ?? 0, ctrlKey: !!o.ctrl, bubbles: true, cancelable: true })); }
function key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true, cancelable: true })); }
function surfaceAt(x, y) { const c = app.controls; const r = c.rayAt(x, y); return c.ground.surfacePoint(r.o.clone(), r.d.clone()); }
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
function localOf(b, p) { const l = v3(p).sub(b.anchor).applyQuaternion(b.quat.clone().invert()); return l; }
const r3 = (x) => Math.round(x * 1000) / 1000;

const tests = {
  /** wheel zoom at (x,y): the surface point under the cursor must stay under it */
  async zoom({ x, y, notches = 8, delta = -100, ctrl = false } = {}) {
    const c = app.controls; const rc = canvasRect();
    x = x ?? rc.left + rc.width * 0.62; y = y ?? rc.top + rc.height * 0.58;
    const s = surfaceAt(x, y); const A = s.point.clone();
    const h0 = c.heightAboveGround(true);
    let maxErr = 0;
    for (let i = 0; i < notches; i++) { wheel(x, y, delta, { ctrl }); await frames(2); const p = project(A); maxErr = Math.max(maxErr, Math.hypot(p.x - x, p.y - y)); }
    await until(() => c.isIdle(), 6000);
    const p = project(A);
    return { kind: s.kind, h0: r3(h0), h1: r3(c.heightAboveGround(true)), pxErrEnd: r3(Math.hypot(p.x - x, p.y - y)), pxErrMax: r3(Math.max(maxErr, Math.hypot(p.x - x, p.y - y))) };
  },
  /** left-drag from (x0,y0) to (x1,y1): the grabbed point must follow the cursor */
  async drag({ x0, y0, x1, y1, steps = 24, button = 0, ctrl = false } = {}) {
    const c = app.controls; const rc = canvasRect();
    x0 = x0 ?? rc.left + rc.width * 0.45; y0 = y0 ?? rc.top + rc.height * 0.55; x1 = x1 ?? rc.left + rc.width * 0.62; y1 = y1 ?? rc.top + rc.height * 0.4;
    const G = surfaceAt(x0, y0).point.clone();
    ptr('pointerdown', x0, y0, { button, ctrl });
    let maxErr = 0; const errs = [];
    for (let i = 1; i <= steps; i++) {
      const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
      ptr('pointermove', x, y, { button, ctrl });
      const f0 = app.frameNo;
      await frames(2);
      await until(() => app.frameNo >= f0 + 2, 500); // the app must have ticked after the move
      if (button === 0 && !ctrl) { const p = project(G); const e = Math.hypot(p.x - x, p.y - y); errs.push(r3(e)); maxErr = Math.max(maxErr, e); }
    }
    await frames(8); // rest so no fling
    ptr('pointerup', x1, y1, { button, ctrl });
    await frames(2);
    const pose = app.rig.getPose();
    return { pxErrMax: r3(maxErr), roll: r3(pose.roll), pitch: r3(pose.pitch), heading: r3(pose.heading), errs: maxErr > 0.5 ? errs : undefined };
  },
  async flyto(target, opts = {}) {
    const c = app.controls;
    const want = c.resolveTarget(target);
    const t0 = performance.now();
    const res = await c.flyTo(target, opts);
    const P = app.rig.position;
    return { arrived: res.arrived, secs: r3((performance.now() - t0) / 1000), posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z), angErr: quatAngle(app.rig.quaternion, want.quaternion) };
  },
  async back() {
    const c = app.controls; const rig = app.rig;
    await until(() => c.isIdle(), 6000);
    const s0 = rig.snapshot(); const m0 = c.modeName;
    await c.flyTo({ lat: SITE.lat + 0.3, lon: SITE.lon - 0.5, alt: 52000, heading: 40, pitch: -50 }, { duration: 1.2 });
    await tests.zoom({ notches: 3 });
    const r = await c.back();
    await frames(3);
    const P = rig.position;
    return { arrived: r.arrived, mode: c.modeName, modeOk: c.modeName === m0, posErr: Math.hypot(P.x - s0.position.x, P.y - s0.position.y, P.z - s0.position.z), angErr: quatAngle(rig.quaternion, s0.quaternion) };
  },
  /** place the walker in front of B1, walk through the door, cross to the stair, climb to the upper floor */
  async walkHouse() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B1'), w = c.modes.walk;
    const start = city.localToWorld(b, [0, 0, 9]);
    const up = start.clone().normalize();
    app.rig.setPosition(start.x + up.x * WALK.eye, start.y + up.y * WALK.eye, start.z + up.z * WALK.eye);
    app.rig.lookAtEcef(city.localToWorld(b, [0, 1.65, 0]));
    c.setMode('walk', { instant: true });
    await frames(3);
    const log = { errMax: 0, samples: 0 };
    const track = () => { if (w.grounded) { log.errMax = Math.max(log.errMax, Math.abs(w.info.feetH - w.info.groundH)); log.samples++; } };
    const walkUntil = async (cond, ms) => { key('KeyW', true); const ok = await until(() => { track(); return cond(); }, ms); key('KeyW', false); await frames(10); return ok; };
    const L = () => localOf(b, w.feet);
    const toward = (lx, lz) => { const p = city.localToWorld(b, [lx, 0, lz]); const h = w.feet.clone().normalize(); const d = p.sub(w.feet); d.addScaledVector(h, -d.dot(h)); const e = new THREE.Vector3(), n = new THREE.Vector3(); const { tangentBasis } = { tangentBasis: (u, ee, nn) => { ee.set(u.z, 0, -u.x).normalize(); nn.crossVectors(u, ee).normalize(); } }; tangentBasis(h, e, n); w.setLook(Math.atan2(d.dot(e), d.dot(n)) * RAD, 0); };
    toward(0, 0);
    const door = await walkUntil(() => L().z < 3.9, 9000);
    const zDoor = L().z;
    toward(3.55, 3.9);
    const cross = await walkUntil(() => L().x > 3.4, 6000);
    toward(3.55, -3);
    const climb = await walkUntil(() => L().z < -2.6, 12000);
    const top = L();
    return { door, zDoor: r3(zDoor), cross, climb, upperFloorY: r3(top.y), expectY: 3.3, groundErrMax: r3(log.errMax), samples: log.samples, grounded: w.grounded, onKind: w.info.groundKind };
  },
  /** B2: 0.30 m steps up to 3 m; a 0.45 m block blocks; a 0.30 m block is climbable */
  async walkSteps() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B2'), w = c.modes.walk;
    const place = async (lx, lz, tx, tz) => {
      const s = city.localToWorld(b, [lx, 0, lz]); const up = s.clone().normalize();
      app.rig.setPosition(s.x + up.x * WALK.eye, s.y + up.y * WALK.eye, s.z + up.z * WALK.eye);
      app.rig.lookAtEcef(city.localToWorld(b, [tx, 1.65, tz]));
      if (c.modeName === 'walk') w.syncFromRig(); else c.setMode('walk', { instant: true });
      c._markInternal(); await frames(3);
    };
    const go = async (ms) => { key('KeyW', true); await until(() => false, ms); key('KeyW', false); await frames(15); return localOf(b, w.feet); };
    await place(0, 6, 0, -3); const stairs = await go(4500);
    await place(3, 6, 3, -3); const tall = await go(3000);
    await place(6, 6, 6, -3); const low = await go(3000);
    return { stairsY: r3(stairs.y), stairsZ: r3(stairs.z), tallBlockY: r3(tall.y), tallZ: r3(tall.z), lowBlockY: r3(low.y), lowZ: r3(low.z) };
  },
  /**
   * A building without colliders yet (its 'full' LOD still loading) is still solid: walking at the
   * B4 tower facade stops one capsule radius before it; once its colliders arrive the capsule takes over.
   */
  async wallGuard() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B4'), w = c.modes.walk;
    const place = async () => {
      const s = city.localToWorld(b, [0, 0, 16]); const up = s.clone().normalize();
      app.rig.setPosition(s.x + up.x * WALK.eye, s.y + up.y * WALK.eye, s.z + up.z * WALK.eye);
      app.rig.lookAtEcef(city.localToWorld(b, [0, 1.65, 0]));
      if (c.modeName === 'walk') w.syncFromRig(); else c.setMode('walk', { instant: true });
      c._markInternal(); await frames(3);
    };
    const go = async (ms) => { key('KeyW', true); await until(() => false, ms); key('KeyW', false); await frames(15); return localOf(b, w.feet); };
    city.withheld = new Set(['B4']);
    try {
      await place(); w.refreshColliders(true);
      const guarded = await go(6000);
      const guardHits = w.info.wallGuard || 0;
      city.withheld = null; w.refreshColliders(true);
      await place(); const capsule = await go(6000);
      return { withheldGapToFacade: r3(guarded.z - 10), guardHits, capsuleGapToFacade: r3(capsule.z - 10), feetY: r3(guarded.y) };
    } finally { city.withheld = null; }
  },
  /** B3: 25° ramp walkable, 52° ramp not; terrain 28° slope walkable, 52° bank not */
  async walkSlopes() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B3'), w = c.modes.walk;
    const place = async (s, t) => {
      const up = s.clone().normalize();
      app.rig.setPosition(s.x + up.x * WALK.eye, s.y + up.y * WALK.eye, s.z + up.z * WALK.eye);
      app.rig.lookAtEcef(t);
      if (c.modeName === 'walk') w.syncFromRig(); else c.setMode('walk', { instant: true });
      c._markInternal(); await frames(3);
    };
    const go = async (ms, run) => { if (run) key('ShiftLeft', true); key('KeyW', true); await until(() => false, ms); key('KeyW', false); key('ShiftLeft', false); await frames(15); };
    await place(city.localToWorld(b, [0, 0, 7]), city.localToWorld(b, [0, 1.65, -8])); await go(7000);
    const r25 = localOf(b, w.feet).y;
    await place(city.localToWorld(b, [4, 0, 7]), city.localToWorld(b, [4, 1.65, -8])); await go(5000);
    const r52 = localOf(b, w.feet).y;
    await place(localToEcef(160, 0, hLocal(160, 0)), localToEcef(260, 0, 40)); await go(9000, true);
    const t28 = w.info.feetH - BASE_H;
    await place(localToEcef(0, 168, hLocal(0, 168)), localToEcef(0, 260, 40)); await go(6000, true);
    const t52 = w.info.feetH - BASE_H;
    return { ramp25Y: r3(r25), ramp52Y: r3(r52), terrain28Rise: r3(t28), terrain52Rise: r3(t52) };
  },
  async focus() {
    const c = app.controls;
    const r = await c.focusBuilding('B1');
    const fm = c.modes.focus;
    const res = { arrived: r.arrived, mode: c.modeName };
    key('Digit2', true); key('Digit2', false); await until(() => !fm.isMoving(), 4000);
    res.backAz = r3(((fm.az * RAD) % 360 + 360) % 360); res.expectBackAz = 0; // B1 faces south → back view from the north
    key('Digit5', true); key('Digit5', false); await until(() => !fm.isMoving(), 4000);
    res.roofEl = r3(fm.el * RAD);
    const e = await c.enterBuilding('B1');
    res.enter = { arrived: e.arrived, mode: c.modeName, feet: r3(c.modes.walk.info.feetH - BASE_H) };
    return res;
  },
  /** fly mode: fly into the tower facade and into the ground — must stay clear of both */
  async fly() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B4');
    const s = city.localToWorld(b, [0, 15, -45]);
    app.rig.setPosition(s.x, s.y, s.z); app.rig.lookAtEcef(city.localToWorld(b, [0, 15, 0]));
    c._markInternal(); c.setMode('fly', { pushBack: false }); await frames(3);
    let minGap = Infinity;
    key('KeyW', true);
    await until(() => { const l = localOf(b, app.rig.position); minGap = Math.min(minGap, -10 - l.z); return false; }, 4000);
    key('KeyW', false); await until(() => c.isIdle(), 3000);
    key('KeyC', true); key('ShiftLeft', true);
    let minH = Infinity;
    await until(() => { minH = Math.min(minH, c.heightAboveGround(true)); return false; }, 3000);
    key('KeyC', false); key('ShiftLeft', false); await until(() => c.isIdle(), 3000);
    const sp = c.modes.fly.speed;
    c.setMode('orbit', { pushBack: false });
    return { facadeGapMin: r3(minGap), groundMin: r3(minH), endSpeed: r3(sp) };
  },
  /** walk mode: double-click a ground point → walk there */
  async walkTo() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B1');
    const s = city.localToWorld(b, [-4, 0, 16]); const up = s.clone().normalize();
    app.rig.setPosition(s.x + up.x * WALK.eye, s.y + up.y * WALK.eye, s.z + up.z * WALK.eye);
    app.rig.lookAtEcef(city.localToWorld(b, [-4, 0, 9]));
    c._markInternal(); c.setMode('walk', { instant: true, pushBack: false }); await frames(5);
    const goal = city.localToWorld(b, [-4, 0, 10.5]);
    const p = project(goal);
    ptr('pointerdown', p.x, p.y); ptr('pointerup', p.x, p.y); await frames(2);
    ptr('pointerdown', p.x, p.y); ptr('pointerup', p.x, p.y);
    await until(() => !c.transition, 100); await until(() => c.isIdle(), 6000);
    const l = localOf(b, c.modes.walk.feet);
    return { mode: c.modeName, x: r3(l.x), z: r3(l.z), y: r3(l.y), expect: [-4, 10.5] };
  },
  /** two-finger touch: spread → zoom in, twist → heading, parallel swipe up → tilt */
  async touch() {
    const c = app.controls; const rc = canvasRect();
    await c.flyTo({ lat: SITE.lat, lon: SITE.lon, alt: 2000, heading: 0, pitch: -90 }, { duration: 0.6 });
    await until(() => c.isIdle(), 3000);
    const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
    const h0 = c.heightAboveGround(true);
    const t = { type: 'touch' };
    const two = async (ax, ay, bx, by, steps, fn) => {
      ptr('pointerdown', ax, ay, { ...t, id: 11 }); ptr('pointerdown', bx, by, { ...t, id: 12 }); await frames(2);
      let a = [ax, ay], bb = [bx, by];
      for (let i = 1; i <= steps; i++) { [a, bb] = fn(i / steps); ptr('pointermove', a[0], a[1], { ...t, id: 11 }); ptr('pointermove', bb[0], bb[1], { ...t, id: 12 }); await frames(2); }
      ptr('pointerup', a[0], a[1], { ...t, id: 11 }); ptr('pointerup', bb[0], bb[1], { ...t, id: 12 }); await frames(4);
    };
    await two(cx - 100, cy, cx + 100, cy, 12, (k) => [[cx - 100 - 100 * k, cy], [cx + 100 + 100 * k, cy]]);
    const h1 = c.heightAboveGround(true);
    const hd0 = app.rig.getPose().heading;
    await two(cx - 150, cy, cx + 150, cy, 12, (k) => { const a = Math.PI / 6 * k; return [[cx - 150 * Math.cos(a), cy - 150 * Math.sin(a)], [cx + 150 * Math.cos(a), cy + 150 * Math.sin(a)]]; });
    const hd1 = app.rig.getPose().heading;
    const p0 = app.rig.getPose().pitch;
    await two(cx - 120, cy + 100, cx + 120, cy + 100, 12, (k) => [[cx - 120, cy + 100 - 160 * k], [cx + 120, cy + 100 - 160 * k]]);
    const p1 = app.rig.getPose().pitch;
    return { zoomRatio: r3(h0 / h1), headingDelta: r3(((hd1 - hd0 + 540) % 360) - 180), pitchDelta: r3(p1 - p0) };
  },
  /** long flights: over the north pole (smooth orientation, no flip) and to the antipode */
  async flights() {
    const c = app.controls; const rig = app.rig;
    await c.flyTo({ lat: 80, lon: 0, alt: 5e5, heading: 0, pitch: -90 }, { duration: 0.5 });
    await frames(3);
    let prev = rig.quaternion.clone(), maxRate = 0, n = 0, nan = false, tPrev = performance.now();
    const p = c.flyTo({ lat: 80, lon: 180, alt: 5e5, heading: 0, pitch: -90 }, { duration: 4 });
    let done = false; p.then(() => { done = true; });
    while (!done) {
      await frames(1);
      const t = performance.now(), a = quatAngle(prev, rig.quaternion), dtt = Math.max(1, t - tPrev) / 1000;
      if (a / dtt > maxRate) maxRate = a / dtt;
      prev = rig.quaternion.clone(); tPrev = t; n++; if (!rig.isValid()) nan = true;
    }
    const polar = { maxDegPerSec: r3(maxRate * RAD), frames: n, nan };
    let maxAlt = 0;
    const q = c.flyTo({ lat: -80, lon: -180 + 1e-9, alt: 3e5, heading: 90, pitch: -60 }, { duration: 4 });
    done = false; q.then(() => { done = true; });
    while (!done) { await frames(1); maxAlt = Math.max(maxAlt, rig.geo.h); if (!rig.isValid()) nan = true; }
    const want = c.resolveTarget({ lat: -80, lon: -180 + 1e-9, alt: 3e5, heading: 90, pitch: -60 });
    const P = rig.position;
    const anti = { maxAltKm: r3(maxAlt / 1000), posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z), nan };
    // ceiling: zoom far out
    for (let i = 0; i < 60; i++) { wheel(rc().left + 300, rc().top + 300, 400); await frames(1); }
    await until(() => c.isIdle(), 8000);
    return { polar, anti, ceilingKm: r3(rig.geo.h / 1000) };
  },
  /** walking into the pond stops at the shore where the water gets deeper than 0.6 m */
  async walkPond() {
    const c = app.controls, w = c.modes.walk;
    const s = localToEcef(POND.x, POND.y + 45, hLocal(POND.x, POND.y + 45)); const up = s.clone().normalize();
    app.rig.setPosition(s.x + up.x * WALK.eye, s.y + up.y * WALK.eye, s.z + up.z * WALK.eye);
    app.rig.lookAtEcef(localToEcef(POND.x, POND.y, POND.level + 1.65));
    c.setMode('walk', { instant: true, pushBack: false }); await frames(3); // external pose change → walk resyncs
    key('KeyW', true); key('ShiftLeft', true); await until(() => false, 9000); key('KeyW', false); key('ShiftLeft', false); await frames(10);
    const l = {}; toLocalXY(w.feet.x / w.feet.length(), w.feet.y / w.feet.length(), w.feet.z / w.feet.length(), l);
    const dist = Math.hypot(l.x - POND.x, l.y - POND.y);
    // orbit: the camera may not go below the water surface either
    c.setMode('orbit', { pushBack: false });
    await c.flyTo({ lookAt: localToEcef(POND.x, POND.y, POND.level), range: 60, heading: 0, tilt: 10 }, { duration: 0.5 });
    const rcv = canvasRect();
    for (let i = 0; i < 40; i++) { wheel(rcv.left + rcv.width / 2, rcv.top + rcv.height / 2, -120); await frames(2); }
    await until(() => c.isIdle(), 5000);
    return { stopDistFromCentre: r3(dist), expect: '≈20.3 (depth 0.6 m)', inWater: w.info.inWater, orbitAltAboveWater: r3(app.rig.geo.h - POND.level) };
  },
  /** same walk through the house with colliders given as {anchor, quaternion} (no scene matrix) */
  async walkHouseAnchor() {
    const city = app.systems.city;
    city.colliderForm = 'anchor';
    try { return await tests.walkHouse(); } finally { city.colliderForm = 'matrix'; }
  },
  /** orbit at street level: wheel with the cursor in the sky glides forward and stays low */
  async skyWheel() {
    const c = app.controls; const rcv = canvasRect();
    const s = localToEcef(-300, 400, hLocal(-300, 400) + 1.7); const r = s.length();
    await c.flyTo({ lat: Math.asin(s.y / r) * RAD, lon: Math.atan2(s.x, s.z) * RAD, alt: r - R, heading: 0, pitch: -4 }, { duration: 0.4, mode: 'orbit' });
    await until(() => c.isIdle(), 3000);
    const P0 = v3(app.rig.position);
    for (let i = 0; i < 8; i++) { wheel(rcv.left + rcv.width / 2, rcv.top + 40, -100); await frames(2); }
    await until(() => c.isIdle(), 5000);
    const P = v3(app.rig.position), up = P.clone().normalize(), d = P.clone().sub(P0), vert = d.dot(up);
    return { kind: c.modes.orbit.zoomAnchorKind, horizontal: r3(Math.sqrt(Math.max(0, d.lengthSq() - vert * vert))), hAG: r3(c.heightAboveGround(true)) };
  },
  /** agl pose: eye height above the local ground */
  async agl() {
    const c = app.controls;
    const s = localToEcef(30, -40, 0).normalize(); const lat = Math.asin(s.y) * RAD, lon = Math.atan2(s.x, s.z) * RAD;
    const r = await c.flyTo({ lat, lon, agl: 1.65, heading: 0, pitch: 0 }, { duration: 0.5, mode: 'walk' });
    await frames(5);
    return { arrived: r.arrived, mode: c.modeName, eye: r3(app.rig.geo.h - hLocal(30, -40)) };
  },
  /** flyPath: 3 waypoints, exact arrival, smooth (no stop) through the waypoints */
  async path() {
    const c = app.controls; const rig = app.rig;
    const pts = [{ lat: SITE.lat + 0.01, lon: SITE.lon, alt: 900, heading: 0, pitch: -40 }, { lat: SITE.lat + 0.05, lon: SITE.lon + 0.05, alt: 6000, heading: 90, pitch: -60 }, { lat: SITE.lat + 0.2, lon: SITE.lon + 0.3, alt: 60000, heading: 180, pitch: -85, lens: 50 }];
    const want = c.resolveTarget(pts[2]);
    let minSpeed = Infinity, n = 0, prev = v3(rig.position), tPrev = performance.now(), done = false, mid = 0;
    const p = c.flyPath(pts, { duration: 5 }); p.then(() => { done = true; });
    while (!done) {
      await frames(1); const t = performance.now(); const P = v3(rig.position);
      const sp = P.distanceTo(prev) / Math.max(1e-3, (t - tPrev) / 1000); prev = P; tPrev = t; n++;
      const prog = c.transition ? c.transition.progress : 0;
      if (n > 15 && c.transition && prog > 0.02 && prog < 0.98) { minSpeed = Math.min(minSpeed, sp); mid++; }
    }
    const r = await p; const P = rig.position;
    return { arrived: r.arrived, posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z), angErr: quatAngle(rig.quaternion, want.quaternion), minMidSpeed: r3(minSpeed), frames: n };
  },
  /** bookmark-style focus: setMode('focus', {bookmark}) keeps the bookmark framing (no snap, no flight) */
  async focusKeep() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B1');
    // a framing that looks 3 m to the side of the building centre
    const info = city.focusInfo('B1');
    const C = v3(info.centerEcef); const up = C.clone().normalize();
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(b.quat).cross(up).normalize();
    const eye = city.localToWorld(b, [14, 9, 26]);
    app.rig.setPosition(eye.x, eye.y, eye.z); app.rig.lookAtEcef(C.clone().addScaledVector(side, 3));
    c.setMode('orbit', { pushBack: false });
    const s0 = app.rig.snapshot();
    const ok = c.setMode('focus', { bookmark: { id: 'BM', buildingId: 'B1' } });
    await until(() => c.modeName === 'focus', 3000); await frames(20);
    const r = { ok, mode: c.modeName, posErr: r3(v3(app.rig.position).distanceTo(v3(s0.position))), angErrDeg: r3(quatAngle(app.rig.quaternion, s0.quaternion) * RAD) };
    // orbit a bit and check the distance to the building stays sensible, then the back preset re-centres
    key('Digit2', true); key('Digit2', false); await until(() => !c.modes.focus.isMoving(), 5000);
    r.recentred = r3(c.modes.focus.C.distanceTo(C));
    c.setMode('orbit', { pushBack: false });
    return r;
  },
  /** while the walk-drop flight runs, state.mode already shows 'walk'; an interrupted flight restores orbit */
  async modeShown() {
    const c = app.controls;
    await c.flyTo({ lat: SITE.lat - 0.004, lon: SITE.lon, alt: 420, heading: 0, pitch: -38 }, { duration: 0.4, mode: 'orbit' });
    const modes = []; const off = app.events.on('mode', (e) => modes.push(e.mode));
    c.setMode('walk'); await frames(3);
    const during = { shown: app.state.mode, active: c.modeName, flying: !!c.transition };
    wheel(800, 450, -100); await frames(3); // interrupt
    const after = { shown: app.state.mode, active: c.modeName };
    c.setMode('walk'); await until(() => !c.transition, 8000); await frames(5);
    off();
    const final = { shown: app.state.mode, active: c.modeName };
    c.setMode('orbit', { pushBack: false });
    return { during, after, final, modes };
  },
  /** unknown building: focusBuilding / enterBuilding resolve false and the shown mode is restored */
  async unknown() {
    const c = app.controls;
    const saved = app.workers; app.workers = null; // the bench has no worker pool
    const f = await c.focusBuilding('NO-SUCH-BUILDING'); const m1 = app.state.mode;
    const e = await c.enterBuilding('NO-SUCH-BUILDING'); const m2 = app.state.mode;
    app.workers = saved;
    return { focus: f, enter: e, shownAfterFocus: m1, shownAfterEnter: m2, active: c.modeName };
  },
  /** building viewpoints (§5 07) from the city's camera anchors, and synthesised from a bare spec */
  async views() {
    const c = app.controls, city = app.systems.city, b = city.byId.get('B1'), w = c.modes.walk;
    await c.focusBuilding('B1', { duration: 0.6 });
    const res = { available: c.buildingViews('B1') };
    for (const name of ['street', 'lobby', 'living', 'roof', 'back']) {
      // entering from the street: the camera must pass through the doorway (x ∈ ±0.75, y < 2.4 at z = 5)
      let cross = null, prev = localOf(b, app.rig.position), done = false;
      const p = c.buildingView('B1', name, { duration: 0.6 }); p.then(() => { done = true; });
      while (!done) {
        await frames(1);
        const l = localOf(b, app.rig.position);
        if (!cross && (prev.z - 5) * (l.z - 5) <= 0 && Math.abs(prev.z - l.z) > 1e-9) { const t = (5 - prev.z) / (l.z - prev.z); cross = { x: r3(prev.x + (l.x - prev.x) * t), y: r3(prev.y + (l.y - prev.y) * t) }; }
        prev = l;
      }
      const r = await p;
      await frames(25);
      const l = localOf(b, w.feet), le = localOf(b, app.rig.position);
      res[name] = { arrived: r && r.arrived, mode: c.modeName, view: r && r.view, feetY: r3(l.y), eyeY: r3(le.y), grounded: w.grounded, on: w.info.groundKind, frontCrossing: cross };
    }
    // a bare spec (no city focus data): exterior views synthesised from footprint + entrance
    const b4 = city.byId.get('B4');
    const spec = { ...b4.spec, id: 'SPEC-ONLY', entrances: [{ kind: 'main', side: 'front', offset: 0, width: 3 }] };
    const r = await c.buildingView('SPEC-ONLY', 'street', { spec, duration: 0.6 }); await frames(25);
    const P = v3(app.rig.position), f = app.rig.forward(new THREE.Vector3());
    const C = localToEcef(0, -70, hLocal(0, -70) + 25);
    const toC = C.clone().sub(P); toC.addScaledVector(P.clone().normalize(), -toC.dot(P.clone().normalize())).normalize();
    const fh = f.clone().addScaledVector(P.clone().normalize(), -f.dot(P.clone().normalize())).normalize();
    const lf = localOf(b4, P);
    res.specStreet = { arrived: r && r.arrived, mode: c.modeName, eyeAboveGround: r3(c.heightAboveGround(true)), facing: r3(fh.dot(toC)), localZ: r3(lf.z), localX: r3(lf.x) };
    c.setMode('orbit', { pushBack: false });
    return res;
  },
  /** keyboard ownership + speeds: digits stay with the UI outside focus mode; orbit key pan saturates in orbit */
  async keysMisc() {
    const c = app.controls; const rig = app.rig;
    await c.flyTo({ lat: 15, lon: 100, alt: 9.5e6, heading: 0, pitch: -90 }, { duration: 0.3, mode: 'orbit' }); await until(() => c.isIdle(), 3000);
    const ev = new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true, cancelable: true });
    window.dispatchEvent(ev); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1', key: '1', bubbles: true }));
    const digitPreventedInOrbit = ev.defaultPrevented;
    const g0 = rig.geo; key('KeyW', true); const t0 = performance.now(); await until(() => false, 1500); key('KeyW', false);
    const secs = (performance.now() - t0) / 1000; const g1 = rig.geo; await until(() => c.isIdle(), 4000);
    // fly mode keys: Shift ×10 / Alt ÷10 at the same height (steady-state speeds)
    await c.flyTo({ lat: SITE.lat, lon: SITE.lon + 0.01, alt: BASE_H + 100, heading: 90, pitch: 0 }, { duration: 0.3, mode: 'fly' }); await until(() => c.isIdle(), 3000);
    const speedWith = async (mods) => { for (const m of mods) key(m, true); key('KeyW', true); await until(() => false, 1200); const v = c.modes.fly.speed; key('KeyW', false); for (const m of mods) key(m, false); await until(() => c.isIdle(), 3000); return v; };
    const v1 = await speedWith([]); const v10 = await speedWith(['ShiftLeft']); const v01 = await speedWith(['AltLeft']);
    c.setMode('orbit', { pushBack: false });
    // back(): a mode switch without moving, then back → same pose, instant, previous mode
    const s0 = rig.snapshot(); c.setMode('fly'); await frames(2); const t1 = performance.now(); const r = await c.back(); const backMs = performance.now() - t1;
    return { digitPreventedInOrbit, orbitPanDegPerSec: r3(Math.abs(g1.lat - g0.lat) / secs), fly: { base: r3(v1), shift: r3(v10 / v1), alt: r3(v01 / v1) }, backSamePose: { arrived: r.arrived, mode: c.modeName, ms: Math.round(backMs), posErr: v3(rig.position).distanceTo(v3(s0.position)) } };
  },
  /**
   * keyboard ownership next to a UI root (#mars-ui): focus inside the UI keeps every key there, Tab
   * cycles modes only while the 3D view is the active surface, M always cycles, Esc / Enter are
   * consumed (defaultPrevented) only when they act, held keys are released when focus enters a control
   */
  async keyRules() {
    const c = app.controls;
    await c.flyTo({ lat: SITE.lat, lon: SITE.lon, alt: BASE_H + 600, heading: 0, pitch: -50 }, { duration: 0.3, mode: 'orbit' }); await until(() => c.isIdle(), 3000);
    let ui = document.getElementById('mars-ui'); const made = !ui;
    if (made) { ui = document.createElement('div'); ui.id = 'mars-ui'; ui.style.cssText = 'position:fixed;left:8px;bottom:8px;opacity:0.01'; ui.innerHTML = '<button type="button">b</button><input type="text">'; document.body.appendChild(ui); }
    const btn = ui.querySelector('button'), input = ui.querySelector('input');
    const send = (code, o = {}) => {
      const ev = new KeyboardEvent('keydown', { code, key: o.key ?? code, shiftKey: !!o.shift, bubbles: true, cancelable: true });
      (o.target || window).dispatchEvent(ev); (o.target || window).dispatchEvent(new KeyboardEvent('keyup', { code, key: o.key ?? code, shiftKey: !!o.shift, bubbles: true }));
      return ev.defaultPrevented;
    };
    const res = {};
    // focus inside the UI: Tab / W are left alone
    btn.focus();
    res.ui = { tabPrevented: send('Tab', { target: btn, key: 'Tab' }), wPrevented: send('KeyW', { target: btn, key: 'w' }), mode: c.modeName };
    btn.blur();
    // a press outside the view: Tab is focus navigation again
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    res.afterUiPress = { tabPrevented: send('Tab', { key: 'Tab' }), mode: c.modeName };
    // a press on the view: Tab / Shift+Tab cycle, M / Shift+M cycle
    const r = canvasRect(); ptr('pointerdown', r.left + 40, r.top + 40); ptr('pointerup', r.left + 40, r.top + 40); await frames(2);
    const seq = [];
    res.viewTabPrevented = send('Tab', { key: 'Tab' }); seq.push(c.modeName);
    send('Tab', { key: 'Tab', shift: true }); seq.push(c.modeName);
    send('KeyM', { key: 'm' }); seq.push(c.modeName);
    send('KeyM', { key: 'M', shift: true }); seq.push(c.modeName);
    res.seq = seq;
    // Esc: not consumed in orbit (UI closes panels), consumed in focus (→ orbit)
    res.escOrbitPrevented = send('Escape', { key: 'Escape' });
    await c.focusBuilding('B2', { duration: 0.3 }); await until(() => c.isIdle(), 4000);
    res.escFocus = { prevented: send('Escape', { key: 'Escape' }), mode: c.modeName };
    // Enter: not consumed without a selected building, consumed with one (→ focus)
    app.state.select(null);
    res.enterNoSelPrevented = send('Enter', { key: 'Enter' });
    app.state.select({ type: 'building', id: 'B2', spec: app.systems.city.byId.get('B2').spec, distance: 100 });
    res.enterSel = { prevented: send('Enter', { key: 'Enter' }) };
    await until(() => c.isIdle() && c.modeName === 'focus', 5000); res.enterSel.mode = c.modeName;
    c.setMode('orbit', { pushBack: false }); app.state.select(null);
    // held W released when focus moves into a text field (its keyup never reaches the window)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true, cancelable: true }));
    const held = c.keys.has('KeyW');
    input.focus();
    res.heldReleased = { heldBefore: held, heldAfter: c.keys.has('KeyW') };
    input.blur();
    if (made) ui.remove();
    await until(() => c.isIdle(), 3000);
    return res;
  },
  /** short eye-level flights glide (no swing out and back), long ones arc */
  async glide() {
    const c = app.controls; const rig = app.rig;
    const at = (x, y, hd, pitch) => { const p = localToEcef(x, y, hLocal(x, y) + 1.65); const r = p.length(); return { lat: Math.asin(p.y / r) * RAD, lon: Math.atan2(p.x, p.z) * RAD, alt: r - R, heading: hd, pitch }; };
    await c.flyTo(at(-200, 300, 0, -2), { duration: 0.3, mode: 'walk' }); await until(() => c.isIdle(), 3000);
    const P0 = v3(rig.position), want = c.resolveTarget(at(-200, 340, 30, -5));
    let maxH = 0, maxBack = 0; const p = c.flyTo(at(-200, 340, 30, -5), { mode: 'walk' }); const kind = c.transition && c.transition.kind;
    let done = false; p.then(() => { done = true; });
    const dir = want.position.clone().sub(P0).normalize();
    while (!done) { await frames(1); maxH = Math.max(maxH, c.heightAboveGround(true)); maxBack = Math.max(maxBack, -v3(rig.position).sub(P0).dot(dir)); }
    const P = rig.position;
    const near = { kind, maxHAG: r3(maxH), maxBackwards: r3(maxBack), posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z) };
    const q = c.flyTo(at(900, -1500, 0, -2), { mode: 'walk' }); const kind2 = c.transition && c.transition.kind; await q;
    c.setMode('orbit', { pushBack: false });
    return { near, far: { kind: kind2 } };
  },
  /** wheel from orbit down to the ground at the screen centre: no NaN, clearance kept */
  async dive({ notches = 120 } = {}) {
    const c = app.controls; const rc = canvasRect();
    const x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
    let minH = Infinity, nan = false;
    for (let i = 0; i < notches; i++) { wheel(x, y, -120); await frames(2); const h = c.heightAboveGround(true); minH = Math.min(minH, h); if (!app.rig.isValid()) nan = true; }
    await until(() => c.isIdle(), 6000);
    const pose = app.rig.getPose();
    return { minHAG: r3(minH), endHAG: r3(c.heightAboveGround(true)), pitch: r3(pose.pitch), roll: r3(pose.roll), nan };
  },
};

function expose() {
  window.__BENCH__ = { app, SITE, tests, frames, until, project, ptr, wheel, key, surfaceAt, localToEcef, hLocal, localOf };
  window.__MARS__ = {
    app, ready: true,
    pose: () => app.rig.getPose(),
    goto: (p) => { app.rig.setPose(p); return true; },
    async waitIdle(timeoutMs = 60000, settle = 10) {
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < timeoutMs) { await frames(1); calm = app.controls.isIdle() ? calm + 1 : 0; if (calm >= settle) return true; }
      return false;
    },
    stats: () => ({ fps: app.fps, frame: app.frameNo, calls: app.renderer.info.render.calls, triangles: app.renderer.info.render.triangles }),
  };
}

start().catch((e) => { console.error(e); const d = document.createElement('pre'); d.style.cssText = 'position:fixed;inset:20px;color:#f88;font:12px monospace'; d.textContent = 'Bench failed: ' + (e.stack || e); document.body.appendChild(d); });
