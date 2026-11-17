// City tile records + candidate enumeration (main thread). OWNER: city agent.
import * as THREE from 'three';
import { R, CITY_TILE_LEVEL } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { tileKey, tileCenterUnit, enuBasisFromUnit, vecToFace, latLonToUnit } from '../../core/geo.js';
import { createMassMaterial, createMassDepthMaterial } from './massMaterial.js';
import { INFO_STRIDE } from './massBuild.js';

const L = CITY_TILE_LEVEL;
const _cand = [], _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vt = new THREE.Vector3();
const _u = {}, _f = {};
function releaseArray() { this.array = null; }
const NT = 1 << L;
const PICK_KEEP = 2600;   // m: tiles installed closer keep CPU mass position / index (exact picking)
export const STATE_W = 64;

/** One L13 city tile: data (CityTileData), mass mesh, per-building state texture, frame. */
// Seat offset code of state channel A (fix round 3, QZ2-06: coarse canyon terrain can sit > 60 m off the planned
// ground — the old linear ±64 m code clamped and the far blocks floated): q = sign(o)·sqrt(|o| / SEAT_MAX), byte =
// 127.5 + 127.5·q; decoded in massMaterial.js (VERT_SEAT + the depth material) as o = SEAT_MAX·sign(q)·q².
export const SEAT_MAX = 250;
export function encodeSeat(o) {
  const q = Math.sign(o) * Math.sqrt(Math.min(1, Math.abs(o) / SEAT_MAX));
  return Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * q)));
}
const SEAT_ZERO = encodeSeat(0);

export class CityTile {
  constructor(face, x, y) {
    this.face = face; this.x = x; this.y = y; this.level = L;
    this.key = tileKey(face, L, x, y);
    const c = tileCenterUnit(face, L, x, y, {});
    this.cu = c;                                  // centre unit vector
    this.state = 'empty';                         // empty | loading | ready | failed
    this.job = null; this.data = null; this.mesh = null; this.group = null;
    this.info = null; this.n = 0; this.h0 = 0;
    this.stateData = null; this.stateTex = null; this.stateDirty = false;
    this.wantFrame = -1; this.shownFrame = -1; this.displayed = false;
    this.priority = 1e9; this.dist = 1e9; this.bytes = 0; this.maxTop = 0;
    this.origin = { x: c.x * R, y: c.y * R, z: c.z * R };
    const B = enuBasisFromUnit(c.x, c.y, c.z, {});
    this.E = B.east; this.U = B.up; this.S = B.south;
    this.quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...B.east), new THREE.Vector3(...B.up), new THREE.Vector3(...B.south)));
    this.fades = new Map();                       // building index -> {from, to, t0, dur}
    this.radius = 560;                            // horizontal bounding radius (m)
    this.streets = null;                          // StreetTile (streets.js)
  }

  /** ECEF of a tile-frame point */
  toEcef(x, y, z, out = {}) {
    const E = this.E, U = this.U, S = this.S, o = this.origin;
    out.x = o.x + x * E[0] + y * U[0] + z * S[0];
    out.y = o.y + x * E[1] + y * U[1] + z * S[1];
    out.z = o.z + x * E[2] + y * U[2] + z * S[2];
    return out;
  }
  /** tile-frame point of an ECEF position */
  fromEcef(p, out = {}) {
    const dx = p.x - this.origin.x, dy = p.y - this.origin.y, dz = p.z - this.origin.z;
    const E = this.E, U = this.U, S = this.S;
    out.x = dx * E[0] + dy * E[1] + dz * E[2]; out.y = dx * U[0] + dy * U[1] + dz * U[2]; out.z = dx * S[0] + dy * S[1] + dz * S[2];
    return out;
  }

  /** build GPU objects from a worker result (returns false when the tile has no mass) */
  install(data, app, parent) {
    this.data = data;
    const m = data.mass;
    this.h0 = m ? m.h0 : ((data.center && data.center.h) || 0);
    const r = R + this.h0;
    this.origin = { x: this.cu.x * r, y: this.cu.y * r, z: this.cu.z * r };
    this.group = new THREE.Group();
    this.group.name = 'city:' + this.key;
    this.group.matrixAutoUpdate = false;
    this.group.quaternion.copy(this.quat);
    this.n = data.buildings.length;
    this.byId = new Map();
    for (let i = 0; i < this.n; i++) this.byId.set(data.buildings[i].id, i);
    if (!m || !m.index || !m.index.length) { this.info = m ? m.info : new Float32Array(0); this.bytes = 4096 + 2600 * this.n + 1800 * ((data.roads ? data.roads.length : 0) + (data.areas ? data.areas.length : 0)); parent.add(this.group); return false; }
    this.info = m.info;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 4, true));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('mcolor', new THREE.BufferAttribute(m.color, 4, true));
    g.setAttribute('facade', new THREE.BufferAttribute(m.facade, 4, false));
    g.setAttribute('facadeId', new THREE.BufferAttribute(m.facadeId, 4, false));
    g.setAttribute('bidx', new THREE.BufferAttribute(m.bidx, 1, false));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    // bounds from the per-building AABBs (no pass over the vertices)
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < this.n; i++) {
      const o = i * INFO_STRIDE, I = this.info;
      if (!(I[o + 13] > 0)) continue;
      x0 = Math.min(x0, I[o + 14]); x1 = Math.max(x1, I[o + 15]);
      z0 = Math.min(z0, I[o + 16]); z1 = Math.max(z1, I[o + 17]);
      y0 = Math.min(y0, I[o + 18] - 65); y1 = Math.max(y1, I[o + 4] + 65);   // ± max seat offset
    }
    if (!(x1 > x0)) { x0 = -400; x1 = 400; z0 = -400; z1 = 400; y0 = -50; y1 = 50; }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.maxTop = y1 - 65;
    this.bsphere = g.boundingSphere;
    // GPU-only attributes: drop the CPU copies once uploaded. position / index stay for exact picking
    // and the wireframe debug view on tiles installed within PICK_KEEP of the camera; farther tiles
    // drop them too and are picked through each building's oriented box (info yaw / w / d / base / top;
    // at that range a box is sub-pixel exact). The selection outline uses the GPU buffers either way.
    const keepCpu = !(this.dist > PICK_KEEP);
    for (const k of keepCpu ? ['normal', 'uv', 'mcolor', 'facade', 'facadeId', 'bidx'] : ['normal', 'uv', 'mcolor', 'facade', 'facadeId', 'bidx', 'position']) g.attributes[k].onUpload(releaseArray);
    if (!keepCpu) g.index.onUpload(releaseArray);
    this.cpuMass = keepCpu;
    // per-building state texture: R mass visibility, G highlight, B size/2 m, A seat offset (encodeSeat: signed
    // square-root code, ±SEAT_MAX m, 1.5 cm steps near 0)
    const h = Math.max(1, Math.ceil(this.n / STATE_W));
    this.stateData = new Uint8Array(STATE_W * h * 4);
    for (let i = 0; i < this.n; i++) {
      const o = i * INFO_STRIDE;
      this.stateData[i * 4] = 255;
      this.stateData[i * 4 + 2] = Math.min(255, Math.max(0, Math.round((this.info[o + 6] - 2) / 2)));
      this.stateData[i * 4 + 3] = SEAT_ZERO;      // seat offset 0 m
    }
    // seat offsets (m) of the mass models onto COARSE displayed terrain: target / current, the planned
    // (analytic, full-detail) ground at each footprint, and each centre in cube-face coordinates (for
    // the terrain tile lookup in CitySystem._seatTarget)
    this.seatT = new Float32Array(this.n); this.seatC = new Float32Array(this.n);
    this.trueG = new Float32Array(this.n);
    this.bFace = new Uint8Array(this.n); this.bA = new Float64Array(this.n); this.bB = new Float64Array(this.n);
    this.terrL = -1;                              // terrain level found last (lookup hint)
    for (let i = 0; i < this.n; i++) {
      const s = data.buildings[i], g = s.ground || {};
      const c = g.corners;
      this.trueG[i] = c && c.length === 4 ? (c[0] + c[1] + c[2] + c[3]) / 4 : (Number.isFinite(g.min) && Number.isFinite(g.max) ? (g.min + g.max) / 2 : (g.entrance || 0));
      latLonToUnit(s.lat, s.lon, _u); vecToFace(_u.x, _u.y, _u.z, _f);
      this.bFace[i] = _f.face; this.bA[i] = _f.a; this.bB[i] = _f.b;
    }
    this.seatCursor = 0; this.seatMoving = false;
    this.stateTex = new THREE.DataTexture(this.stateData, STATE_W, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.stateTex.magFilter = THREE.NearestFilter; this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.generateMipmaps = false; this.stateTex.needsUpdate = true;
    const mat = createMassMaterial(app, this.stateTex, STATE_W);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'city-mass';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = createMassDepthMaterial(this.stateTex, STATE_W);
    mesh.userData.cityTile = this;
    this.mesh = mesh;
    this.group.add(mesh);
    parent.add(this.group);
    this.gpuBytes = m.position.byteLength + m.normal.byteLength + m.uv.byteLength + m.color.byteLength + m.facade.byteLength + m.facadeId.byteLength + m.bidx.byteLength + m.index.byteLength;
    // CPU side after upload: mass position + index (picking / wireframe) + the tile data itself
    // (measured in V8: ≈ 2.5 KB per BuildingSpec, ≈ 1.8 KB per road / area record)
    this.bytes = (keepCpu ? m.position.byteLength + m.index.byteLength : 0) + 2600 * this.n + 1800 * ((data.roads ? data.roads.length : 0) + (data.areas ? data.areas.length : 0)) + 4096;
    // the typed arrays now live in the geometry; keep only the small per-building data in data.mass
    data.mass = { h0: m.h0, info: m.info, stats: m.stats };
    return true;
  }

  /**
   * Nearest building hit by a ray in the tile frame (THREE.Ray, unit direction) closer than maxT:
   * AABB slab test per building (with its seat offset), then the triangles of the candidates in
   * order of entry distance. accept(i, t) may reject a building (e.g. faded out). -> {i, t} | null
   */
  raycastLocal(ray, maxT, accept) {
    const I = this.info, n = this.n;
    if (!I || !this.mesh) return null;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
    const ix = 1 / (Math.abs(dx) > 1e-12 ? dx : 1e-12), iy = 1 / (Math.abs(dy) > 1e-12 ? dy : 1e-12), iz = 1 / (Math.abs(dz) > 1e-12 ? dz : 1e-12);
    const cand = _cand; cand.length = 0;
    for (let i = 0; i < n; i++) {
      const o = i * INFO_STRIDE;
      if (!(I[o + 13] > 0)) continue;
      const s = this.seatC ? this.seatC[i] : 0;
      let t0 = 0, t1 = maxT, a, b;
      a = (I[o + 14] - 0.05 - ox) * ix; b = (I[o + 15] + 0.05 - ox) * ix; if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      a = (I[o + 18] + s - 0.05 - oy) * iy; b = (I[o + 4] + s + 0.05 - oy) * iy; if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      a = (I[o + 16] - 0.05 - oz) * iz; b = (I[o + 17] + 0.05 - oz) * iz; if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      cand.push({ t: t0, i });
    }
    if (!cand.length) return null;
    cand.sort((p, q) => p.t - q.t);
    const pos = this.mesh.geometry.attributes.position.array, idx = this.mesh.geometry.index.array;
    let best = null;
    if (!pos || !idx) {
      // no CPU mass (far tile): oriented box of each candidate (building axes in the tile x/z plane)
      for (const c of cand) {
        if (best && c.t > best.t) break;
        if (accept && !accept(c.i, c.t)) continue;
        const o = c.i * INFO_STRIDE, s = this.seatC ? this.seatC[c.i] : 0;
        const ca = I[o + 7], sa = I[o + 8], hw = I[o + 9] / 2 + 0.05, hd = I[o + 10] / 2 + 0.05;
        // ray in the building's horizontal axes: u along +x (ca, sa), w along +z (−sa, ca)
        const rx = ox - I[o], rz = oz - I[o + 2];
        const ou = rx * ca + rz * sa, ow = -rx * sa + rz * ca, du = dx * ca + dz * sa, dw = -dx * sa + dz * ca;
        let t0 = 0, t1 = best ? best.t : maxT, a, b;
        const iu = 1 / (Math.abs(du) > 1e-12 ? du : 1e-12), iw = 1 / (Math.abs(dw) > 1e-12 ? dw : 1e-12);
        a = (-hw - ou) * iu; b = (hw - ou) * iu; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
        a = (-hd - ow) * iw; b = (hd - ow) * iw; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
        a = (I[o + 11] + s - oy) * iy; b = (I[o + 4] + s - oy) * iy; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
        if (!best || t0 < best.t) best = { i: c.i, t: t0 };
      }
      return best;
    }
    for (const c of cand) {
      if (best && c.t > best.t) break;
      if (accept && !accept(c.i, c.t)) continue;
      const o = c.i * INFO_STRIDE, k0 = I[o + 12], k1 = k0 + I[o + 13];
      const s = this.seatC ? this.seatC[c.i] : 0;
      for (let k = k0; k < k1; k++) {
        const a3 = idx[k * 3] * 3, b3 = idx[k * 3 + 1] * 3, c3 = idx[k * 3 + 2] * 3;
        _va.set(pos[a3], pos[a3 + 1] + s, pos[a3 + 2]); _vb.set(pos[b3], pos[b3 + 1] + s, pos[b3 + 2]); _vc.set(pos[c3], pos[c3 + 1] + s, pos[c3 + 2]);
        if (!ray.intersectTriangle(_va, _vb, _vc, false, _vt)) continue;
        const t = _vt.sub(ray.origin).dot(ray.direction);
        if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { i: c.i, t };
      }
    }
    return best;
  }

  /** debug wireframe (the CPU index is kept for it); wire meshes cast no shadow */
  setWire(on) {
    if (!this.mesh) return;
    if (on && !this.mesh.geometry.index.array) on = false;   // far tile without CPU index: solid
    if (this.mesh.material.wireframe !== on) this.mesh.material.wireframe = on;
    this.mesh.castShadow = !on;
  }

  /** camera-relative placement */
  place() {
    if (!this.group) return;
    this.group.position.set(this.origin.x - origin.x, this.origin.y - origin.y, this.origin.z - origin.z);
    this.group.updateMatrix();
    this.group.updateMatrixWorld(true);
  }

  setVisibility(i, v) {
    if (!this.stateData || i < 0 || i >= this.n) return;
    const b = Math.max(0, Math.min(255, Math.round(v * 255)));
    if (this.stateData[i * 4] !== b) { this.stateData[i * 4] = b; this.stateDirty = true; }
  }
  setHighlight(i, h) {
    if (!this.stateData || i < 0 || i >= this.n) return;
    if (this.stateData[i * 4 + 1] !== h) { this.stateData[i * 4 + 1] = h; this.stateDirty = true; }
  }
  /** animate visibility of building i to `to` over dur seconds */
  fade(i, to, dur, now) {
    if (!this.stateData) return;
    const cur = this.stateData[i * 4] / 255;
    if (Math.abs(cur - to) < 1e-3) { this.fades.delete(i); return; }
    this.fades.set(i, { from: cur, to, t0: now, dur: Math.max(0.01, dur * Math.abs(to - cur)) });
  }
  stepFades(now) {
    if (!this.fades.size) return false;
    for (const [i, f] of this.fades) {
      const t = Math.min(1, (now - f.t0) / f.dur);
      this.setVisibility(i, f.from + (f.to - f.from) * t);
      if (t >= 1) this.fades.delete(i);
    }
    return this.fades.size > 0;
  }
  /**
   * Re-evaluate the seat target of up to `budget` buildings (round robin); returns the count
   * processed. target(tile, i) -> metres (CitySystem._seatTarget: the displayed terrain minus the
   * planned ground while the displayed tile is coarse, 0 once it is refined).
   */
  seatSample(target, budget) {
    if (!this.seatT || !this.n) return 0;
    let k = 0;
    for (; k < budget && k < this.n; k++) {
      const i = this.seatCursor; this.seatCursor = (this.seatCursor + 1) % this.n;
      let t;
      try { t = target(this, i); } catch { t = 0; }
      if (!Number.isFinite(t)) t = 0;
      if (t !== this.seatT[i]) { this.seatT[i] = t; this.seatMoving = true; }
    }
    return k;
  }
  /** animate current seat offsets towards their targets (rate m/s); writes state channel A */
  seatStep(dt, rate = 25) {
    if (!this.seatMoving || !this.stateData) return false;
    let moving = false;
    for (let i = 0; i < this.n; i++) {
      const c = this.seatC[i], t = this.seatT[i];
      if (c === t) continue;
      const d = t - c;
      // ≥ rate m/s, faster for big errors (a coarse canyon tile can be > 100 m off: converge within ~0.3 s)
      const st = Math.max(0.01, Math.max(rate, Math.abs(d) * 3.5) * dt);
      const nc = Math.abs(d) <= st ? t : c + Math.sign(d) * st;
      this.seatC[i] = nc;
      if (nc !== t) moving = true;
      const b = encodeSeat(nc);
      if (this.stateData[i * 4 + 3] !== b) { this.stateData[i * 4 + 3] = b; this.stateDirty = true; }
    }
    this.seatMoving = moving;
    return moving;
  }
  seatOffset(i) { return this.seatC ? this.seatC[i] : 0; }

  flushState() { if (this.stateDirty && this.stateTex) { this.stateTex.needsUpdate = true; this.stateDirty = false; } }

  /** building centre ECEF (from the info array) */
  buildingCenter(i, out = {}) {
    const o = i * INFO_STRIDE, I = this.info;
    return this.toEcef(I[o], I[o + 1], I[o + 2], out);
  }

  dispose(parent) {
    if (this.job) { try { this.job.cancel(); } catch { /* done */ } this.job = null; }
    if (this.group) parent.remove(this.group);
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.customDepthMaterial?.dispose();
    }
    this.stateTex?.dispose();
    this.mesh = null; this.group = null; this.data = null; this.info = null; this.stateData = null; this.stateTex = null;
    this.state = 'empty'; this.displayed = false;
  }
}

/**
 * Enumerate L13 tiles whose centre lies within `radius` m (great-circle, sea level) of the unit
 * vector p. Index window on p's cube face; tiles beyond the face edge are found by sampling.
 */
export function tilesAround(p, radius, out = []) {
  out.length = 0;
  const f = vecToFace(p.x, p.y, p.z, {});
  const tx = Math.floor((f.a + 1) * 0.5 * NT), ty = Math.floor((f.b + 1) * 0.5 * NT);
  const span = Math.ceil(radius / 455) + 1;
  const cosMax = Math.cos(Math.min(Math.PI, (radius + 470) / R));
  const seen = new Set();
  const c = {};
  let crosses = false;
  for (let j = ty - span; j <= ty + span; j++) {
    if (j < 0 || j >= NT) { crosses = true; continue; }
    for (let i = tx - span; i <= tx + span; i++) {
      if (i < 0 || i >= NT) { crosses = true; continue; }
      tileCenterUnit(f.face, L, i, j, c);
      if (c.x * p.x + c.y * p.y + c.z * p.z < cosMax) continue;
      const k = tileKey(f.face, L, i, j);
      seen.add(k); out.push({ face: f.face, x: i, y: j, key: k, cx: c.x, cy: c.y, cz: c.z });
    }
  }
  if (crosses) {
    // sample the disc on the tangent plane (440 m step < smallest tile edge) for the other faces
    const B = enuBasisFromUnit(p.x, p.y, p.z, {});
    const n = Math.ceil(radius / 440);
    const q = {};
    for (let jj = -n; jj <= n; jj++) for (let ii = -n; ii <= n; ii++) {
      const ex = ii * 440, ny = jj * 440;
      if (ex * ex + ny * ny > (radius + 440) * (radius + 440)) continue;
      const x = p.x + (B.east[0] * ex + B.north[0] * ny) / R, y = p.y + (B.east[1] * ex + B.north[1] * ny) / R, z = p.z + (B.east[2] * ex + B.north[2] * ny) / R;
      const l = Math.hypot(x, y, z);
      const g = vecToFace(x / l, y / l, z / l, q);
      if (g.face === f.face) continue;
      const i = Math.min(NT - 1, Math.max(0, Math.floor((g.a + 1) * 0.5 * NT))), j = Math.min(NT - 1, Math.max(0, Math.floor((g.b + 1) * 0.5 * NT)));
      const k = tileKey(g.face, L, i, j);
      if (seen.has(k)) continue;
      seen.add(k);
      tileCenterUnit(g.face, L, i, j, c);
      out.push({ face: g.face, x: i, y: j, key: k, cx: c.x, cy: c.y, cz: c.z });
    }
  }
  return out;
}
