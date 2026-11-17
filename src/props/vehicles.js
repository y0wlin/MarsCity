// Moving road vehicles near the camera: a few cars / vans on city streets (sparse) and O02-style
// autonomous service rovers on farm / levee / service roads. Parked vehicles at loading docks and
// parking areas are static per tile (tiles.js). OWNER: props agent.
// Every vehicle is a pure function of sol time: per street polyline and direction a fixed number of
// vehicles moving in lockstep (no overlaps), right-hand traffic on the lanes the city draws
// (render/city/streetBuild.js profile), dithered fade at the polyline ends (tile seams / junctions).
import * as THREE from 'three';
import { origin } from '../core/origin.js';
import { pointFrame, mix32, u01, clamp } from './util.js';
import { frameXf } from './people.js';
import { roadProfile } from './place.js';

const NEAR = 750;
const CAP = 512;
const CLASS_RULE = {
  boulevard: { per: 75, v: 13.5, kinds: [0, 0, 0, 1] },
  arterial: { per: 95, v: 12.5, kinds: [0, 0, 1] },
  collector: { per: 170, v: 10, kinds: [0, 0, 1] },
  local: { per: 320, v: 7, kinds: [0, 0, 0, 1] },
  highway: { per: 160, v: 22, kinds: [0, 1, 1] },
  service: { per: 600, v: 6, kinds: [2] },
  farm: { per: 650, v: 5, kinds: [2] },
  levee: { per: 600, v: 5, kinds: [2] },
};

function lengths(d) {
  if (d._L) return d._L;
  const p = d.pts, n = p.length / 3, L = new Float64Array(n);
  for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]);
  d._L = L; return L;
}
function at(d, L, s, out) {
  const p = d.pts, n = L.length;
  if (s <= 0) s = 0; else if (s >= L[n - 1]) s = L[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const f = (s - L[lo]) / (L[hi] - L[lo] || 1), a = lo * 3, b = hi * 3;
  out.x = p[a] + (p[b] - p[a]) * f; out.y = p[a + 1] + (p[b + 1] - p[a + 1]) * f; out.z = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
  let tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2]; const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl; out.slope = ty / tl;
  return out;
}
function dhash(d) {
  if (d._h !== undefined) return d._h;
  let h = 0x811c9dc5; const s = d.id || '';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  d._h = h >>> 0; return d._h;
}

export class Vehicles {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.group = new THREE.Group(); this.group.name = 'props-vehicles';
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this.dirty = true; this._camKey = ''; this._key = '';
    this.list = []; this.count = 0;
  }

  init() {
    const L = this.sys.lib, mats = this.sys.mats;
    this.app.scene.add(this.group);
    this.kinds = [];
    for (let k = 0; k < L.vehicles.length; k++) {
      const parts = [];
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
      for (const [mk, g0] of Object.entries(L.vehicles[k])) {
        if (!g0 || !g0.isBufferGeometry) continue;
        const g = new THREE.BufferGeometry();
        for (const a of ['position', 'normal', 'uv', 'color']) if (g0.getAttribute(a)) g.setAttribute(a, g0.getAttribute(a));
        g.setIndex(g0.getIndex());
        g.setAttribute('aFade', fade);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
        const m = new THREE.InstancedMesh(g, mats.dyn(mk), CAP);
        m.count = 0; m.frustumCulled = false;
        m.castShadow = mk !== 'headlight' && mk !== 'taillight'; m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (mk === 'carBody') { m.instanceColor = tint; }
        this.group.add(m);
        parts.push(m);
      }
      this.kinds.push({ parts, fade, tint, n: 0 });
    }
  }

  _collect() {
    const A = this.anchor;
    this.list.length = 0;
    for (const t of this.sys.tiles.tiles.values()) {
      if (t.state !== 'ready' || !t.place || t.dist > NEAR + 50) continue;
      const zoneO = t.place.climate && t.place.climate.zone === 'O';
      const xf = frameXf(t.F, A);
      for (const d of t.place.drives || []) {
        const rule = CLASS_RULE[d.cls]; if (!rule) continue;
        const L = lengths(d), len = L[L.length - 1];
        if (len < 25) continue;
        const h = dhash(d);
        const P = roadProfile({ cls: d.cls, width: d.width });
        const rural = rule.kinds[0] === 2;
        if (rural && !zoneO && d.cls !== 'service') continue;
        if (!rural && zoneO && d.cls !== 'highway' && d.cls !== 'boulevard' && d.cls !== 'arterial') continue;
        const mh = P.median / 2;
        const lanes = rural ? 1 : Math.max(1, Math.floor((P.cw - mh - 0.6) / 3.4));
        const laneW = rural ? P.cw : (P.cw - mh - 0.6) / lanes;
        for (const dir of [1, -1]) {
          for (let ln = 0; ln < lanes; ln++) {
            const hl = mix32(h, (dir + 2) * 31 + ln * 977);
            const expect = len / rule.per;
            const n = Math.floor(expect + u01(mix32(hl, 1)));
            if (n <= 0) continue;
            const v = rule.v * (0.85 + 0.3 * u01(mix32(hl, 2))) * (ln === 0 && lanes > 1 ? 0.92 : 1);
            const off = rural ? Math.max(0.9, P.cw * 0.45) : mh + 0.3 + (ln + 0.5) * laneW;
            for (let k = 0; k < n; k++) {
              const hk = mix32(hl, k * 131 + 5);
              const kinds = rule.kinds;
              this.list.push({ d, L, len, xf, t, dir, off, v, s0: ((k + 0.35 * u01(mix32(hk, 3))) / n) * (len + 30), kind: kinds[hk % kinds.length], h: hk, bridge: !!d.bridge });
            }
          }
        }
      }
    }
  }

  update(frame, night) {
    const cam = frame.camEcef;
    if (frame.camAltGround > 1500) { this.group.visible = false; return; }
    this.group.visible = true;
    let reanchor = false;
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 1500) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.anchor.E), new THREE.Vector3(...this.anchor.U), new THREE.Vector3(...this.anchor.S)));
      reanchor = true;
    }
    const A = this.anchor;
    this.group.quaternion.copy(this.anchorQuat);
    this.group.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    const camKey = `${Math.round(cam.x / 40)},${Math.round(cam.y / 40)},${Math.round(cam.z / 40)}|${this.sys.tiles.version}`;
    if (reanchor || this.dirty || camKey !== this._camKey) { this._camKey = camKey; this.dirty = false; this._collect(); this._key = ''; }
    const T = frame.solTime * 3600;
    const key = `${T.toFixed(3)}|${this.list.length}|${this.sys.tiles.seatVersion}|${this.sys.still ? 1 : 0}`;
    if (key === this._key) return;
    this._key = key;
    const C = {};
    { const dx = cam.x - A.ox, dy = cam.y - A.oy, dz = cam.z - A.oz; C.x = A.E[0] * dx + A.E[1] * dy + A.E[2] * dz; C.y = A.U[0] * dx + A.U[1] * dy + A.U[2] * dz; C.z = A.S[0] * dx + A.S[1] * dy + A.S[2] * dz; }
    for (const K of this.kinds) K.n = 0;
    const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const P = {}, col = new THREE.Color();
    for (const V of this.list) {
      const span = V.len + 30;
      let s = (V.s0 + V.v * T) % span; if (s < 0) s += span;
      s -= 15;                                     // -15 .. len + 15 (hidden beyond the ends)
      if (s < -2 || s > V.len + 2) continue;
      const sp = V.dir > 0 ? s : V.len - s;
      at(V.d, V.L, sp, P);
      const tx = P.tx * V.dir, tz = P.tz * V.dir;
      // right of travel (x east, z south): (-tz, tx)
      const x = P.x - tz * V.off, z = P.z + tx * V.off;
      const y = P.y + (V.bridge ? 0.04 : 0.05) + V.t.seatC;
      const M = V.xf.M, t = V.xf.t;
      const ax = M[0] * x + M[1] * y + M[2] * z + t[0], ay = M[3] * x + M[4] * y + M[5] * z + t[1], az = M[6] * x + M[7] * y + M[8] * z + t[2];
      const dx = ax - C.x, dy = ay - C.y, dz = az - C.z;
      if (dx * dx + dy * dy + dz * dz > NEAR * NEAR) continue;
      const K = this.kinds[V.kind];
      if (K.n >= CAP) continue;
      // forward with the road slope, tile up mapped to the anchor
      const fy = P.slope * V.dir;
      Z.set(M[0] * tx + M[1] * fy + M[2] * tz, M[3] * tx + M[4] * fy + M[5] * tz, M[6] * tx + M[7] * fy + M[8] * tz);
      if (!(Z.lengthSq() > 1e-8)) continue;
      Z.normalize();
      Y.set(M[1], M[4], M[7]);
      X.crossVectors(Y, Z).normalize(); Y.crossVectors(Z, X);
      m4.makeBasis(X, Y, Z); m4.setPosition(ax, ay, az);
      for (const m of K.parts) m.setMatrixAt(K.n, m4);
      // fade in / out over the first / last 12 m of the polyline
      const fd = clamp(Math.min(s, V.len - s) / 12, 0, 1);
      K.fade.array[K.n] = this.sys.still ? (fd > 0.5 ? 1 : 0) : fd;
      vehicleTint(V.h, V.kind, col);
      K.tint.array[K.n * 3] = col.r; K.tint.array[K.n * 3 + 1] = col.g; K.tint.array[K.n * 3 + 2] = col.b;
      K.n++;
    }
    let total = 0;
    for (const K of this.kinds) {
      for (const m of K.parts) { m.count = K.n; m.instanceMatrix.needsUpdate = true; }
      K.fade.needsUpdate = true; K.tint.needsUpdate = true;
      total += K.n;
    }
    this.count = total;
    void night;
  }

  stats() { return { candidates: this.list.length, drawn: this.count }; }
}

const CAR = [[0.93, 0.94, 0.95], [0.86, 0.87, 0.89], [0.6, 0.63, 0.67], [0.18, 0.2, 0.23], [0.5, 0.56, 0.65], [0.76, 0.79, 0.83], [0.28, 0.36, 0.48], [0.62, 0.2, 0.16], [0.86, 0.8, 0.7]];
function vehicleTint(h, kind, out) {
  if (kind === 2) return out.setRGB(0.95, 0.95, 0.93);
  if (kind === 1) { const c = [[0.95, 0.95, 0.95], [0.85, 0.88, 0.9], [0.3, 0.45, 0.62]][h % 3]; return out.setRGB(c[0], c[1], c[2]); }
  const c = CAR[h % CAR.length];
  return out.setRGB(c[0], c[1], c[2]);
}
