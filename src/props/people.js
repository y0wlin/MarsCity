// People for scale (1.7 m, a few clothing colours): walkers on sidewalks / plaza paths and standing
// groups at plazas, platforms and waterfronts, near the camera only (< ~300 m). OWNER: props agent.
// Positions are a pure function of sol time (walkers ping-pong along their path at their own pace),
// so a paused clock freezes them and every reload shows the same crowd.
import * as THREE from 'three';
import { origin } from '../core/origin.js';
import { pointFrame, frameToEcef, mix32, u01 } from './util.js';
import { HUMAN_TYPES, SKIN_TONES } from './humans.js';

const NEAR = 320;            // m: people are placed within this distance of the camera
const CAPS = [384, 1536, 4096];   // instances per body type at LOD 0 / 1 / 2
const LOD_D = [30, 110];          // m: LOD0 below 30 m, LOD1 below 110 m, LOD2 to NEAR

/** tile frame -> anchor frame transform (float64): p_a = M p_t + t */
function frameXf(F, A) {
  const M = new Float64Array(9), t = new Float64Array(3);
  const cols = [F.E, F.U, F.S], rows = [A.E, A.U, A.S];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r * 3 + c] = rows[r][0] * cols[c][0] + rows[r][1] * cols[c][1] + rows[r][2] * cols[c][2];
  const dx = F.ox - A.ox, dy = F.oy - A.oy, dz = F.oz - A.oz;
  for (let r = 0; r < 3; r++) t[r] = rows[r][0] * dx + rows[r][1] * dy + rows[r][2] * dz;
  return { M, t };
}

function walkLengths(w) {
  if (w._L) return w._L;
  const p = w.pts, n = p.length / 3, L = new Float64Array(n);
  for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]);
  w._L = L;
  return L;
}
function walkPoint(w, L, s, out) {
  const p = w.pts, n = L.length;
  if (s <= 0) s = 0; else if (s >= L[n - 1]) s = L[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const f = (s - L[lo]) / (L[hi] - L[lo] || 1);
  const a = lo * 3, b = hi * 3;
  out.x = p[a] + (p[b] - p[a]) * f; out.y = p[a + 1] + (p[b + 1] - p[a + 1]) * f; out.z = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
  let tx = p[b] - p[a], tz = p[b + 2] - p[a + 2]; const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl;
  return out;
}

export class People {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.group = new THREE.Group(); this.group.name = 'props-people';
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this.dirty = true; this._camKey = ''; this._key = '';
    this.walkers = []; this.idlers = [];
    this.count = 0;
  }

  init() {
    const L = this.sys.lib, mats = this.sys.mats;
    this.app.scene.add(this.group);
    // one InstancedMesh per body type × LOD (humans.js), instanced pose / look attributes
    this.meshes = [];          // [type][lod] -> {mesh, aWalk, aPose, aLook, n, cap}
    for (let ti = 0; ti < L.humans.length; ti++) {
      const row = [];
      for (let l = 0; l < 3; l++) {
        const H = L.humans[ti];
        const g0 = H.lods[l];
        const cap = CAPS[l];
        const g = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv', 'color', 'aSkin']) g.setAttribute(k, g0.getAttribute(k));
        g.setIndex(g0.getIndex());
        const aWalk = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
        const aPose = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
        const aLook = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aWalk', aWalk); g.setAttribute('aPose', aPose); g.setAttribute('aLook', aLook);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
        const m = new THREE.InstancedMesh(g, H.material, cap);
        m.count = 0; m.frustumCulled = false; m.castShadow = l < 2; m.receiveShadow = true;
        m.customDepthMaterial = H.depth;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.name = `props-human-${H.id}-L${l}`;
        this.group.add(m);
        row.push({ mesh: m, aWalk, aPose, aLook, n: 0, cap });
      }
      this.meshes.push(row);
    }
    this.nTypes = L.humans.length;
  }

  /** collect walk paths / idle groups of ready tiles near the camera */
  _collect(cam) {
    const A = this.anchor;
    this.walkers.length = 0; this.idlers.length = 0;
    for (const t of this.sys.tiles.tiles.values()) {
      if (t.state !== 'ready' || !t.place || t.dist > NEAR + 50) continue;
      const xf = frameXf(t.F, A);
      const P = t.place;
      for (const w of P.walks || []) {
        const L = walkLengths(w), len = L[L.length - 1];
        if (len < 8) continue;
        const h = strHashCached(w);
        const n = Math.max(0, Math.round(len * (w.density || 0.5) / 9 + u01(mix32(h, 1)) - 0.5));
        for (let k = 0; k < n; k++) {
          const hk = mix32(h, k * 7919 + 13);
          // lateral offset from the path centre line: |lat ± keep-right| stays 0.4 m inside the paved width
          const keep = Math.min(0.3, Math.max(0, (w.w || 3) / 2 - 0.4)), spread = Math.max(0, (w.w || 3) / 2 - 0.4 - keep);
          const look = pickLook(hk, P.climate && P.climate.zone === 'O', false);
          const ty = HUMAN_TYPES[look.type];
          const v = (ty.id === 'elder' ? 0.95 : ty.child ? 1.15 : 1.08) + 0.42 * u01(mix32(hk, 2));
          this.walkers.push({ w, L, len, xf, t, h: hk, v, s0: u01(mix32(hk, 3)) * 2 * len, lat: (u01(mix32(hk, 4)) - 0.5) * 2 * spread, keep, sc: 0.97 + 0.06 * u01(mix32(hk, 79)), look, stride: (ty.id === 'elder' ? 0.82 : 1.0) * (0.92 + 0.16 * u01(mix32(hk, 5))) });
        }
      }
      const I = P.idle;
      if (I) for (let i = 0; i + 6 < I.length + 1; i += 7) {
        const cx = I[i], cy = I[i + 1], cz = I[i + 2], rad = I[i + 3], cnt = I[i + 4] | 0, kind = I[i + 5] | 0, hd = I[i + 6];
        const h0 = mix32(Math.round(cx * 10) * 73856093 ^ Math.round(cz * 10) * 19349663, 0x1d1e);
        const placed = [];
        for (let k = 0; k < cnt; k++) {
          let hk = mix32(h0, k * 104729 + 7);
          let x, z, face, ok = false;
          for (let attempt = 0; attempt < 5 && !ok; attempt++) {
            if (attempt) hk = mix32(hk, 0x5bd1e995 + attempt);
            if (kind === 1) {
              // platform: spread along the platform axis (perpendicular to the facing yaw hd), facing the track
              const along = (u01(mix32(hk, 5)) - 0.5) * 2 * rad, across = (u01(mix32(hk, 6)) - 0.5) * 1.4;
              const fx = Math.sin(hd), fz = Math.cos(hd);          // facing (towards the track)
              x = cx + fz * along + fx * across; z = cz - fx * along + fz * across;
              face = hd + (u01(mix32(hk, 10)) - 0.5) * 1.1 + (u01(mix32(hk, 9)) < 0.15 ? Math.PI : 0);
            } else {
              const a = u01(mix32(hk, 5)) * Math.PI * 2, r = Math.sqrt(u01(mix32(hk, 6))) * rad;
              x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
              // small groups face each other; waterfront people face the water (hd) more often
              face = kind === 2 && u01(mix32(hk, 11)) < 0.6 ? hd + (u01(mix32(hk, 10)) - 0.5) * 1.2 : Math.atan2(cx - x, cz - z) + (u01(mix32(hk, 10)) - 0.5) * 1.4;
            }
            // keep a personal distance (no intersecting figures)
            ok = true;
            for (let q = 0; q < placed.length; q += 2) if ((placed[q] - x) ** 2 + (placed[q + 1] - z) ** 2 < 0.8 * 0.8) { ok = false; break; }
          }
          if (!ok) continue;
          placed.push(x, z);
          const look = pickLook(hk, P.climate && P.climate.zone === 'O', true);
          this.idlers.push({ x, y: cy, z, xf, t, face, sc: 0.97 + 0.06 * u01(mix32(hk, 79)), look, h: hk, pose: idlePose(hk, kind), yawH: (u01(mix32(hk, 12)) - 0.5) * 0.9 });
        }
      }
    }
  }

  update(frame) {
    const cam = frame.camEcef;
    if (!this.meshes || frame.camAltGround > 450) { this.group.visible = false; return; }
    this.group.visible = true;
    let reanchor = false;
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 1200) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.anchor.E), new THREE.Vector3(...this.anchor.U), new THREE.Vector3(...this.anchor.S)));
      reanchor = true;
    }
    const A = this.anchor;
    this.group.quaternion.copy(this.anchorQuat);
    this.group.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    const camKey = `${Math.round(cam.x / 25)},${Math.round(cam.y / 25)},${Math.round(cam.z / 25)}|${this.sys.tiles.version}`;
    if (reanchor || this.dirty || camKey !== this._camKey) { this._camKey = camKey; this.dirty = false; this._collect(cam); this._key = ''; }
    const T = frame.solTime * 3600;
    const key = `${T.toFixed(3)}|${this.walkers.length}|${this.idlers.length}|${this.sys.debugMode}|${this.sys.tiles.seatVersion}`;
    if (key === this._key) return;
    this._key = key;
    // camera in the anchor frame (distance cull)
    const C = {};
    { const dx = cam.x - A.ox, dy = cam.y - A.oy, dz = cam.z - A.oz; C.x = A.E[0] * dx + A.E[1] * dy + A.E[2] * dz; C.y = A.U[0] * dx + A.U[1] * dy + A.U[2] * dz; C.z = A.S[0] * dx + A.S[1] * dy + A.S[2] * dz; }
    for (const row of this.meshes) for (const M of row) M.n = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const P = {};
    const put = (xf, x, y, z, yawT, sc, look, phase, amp, pose, va, headYaw, stride) => {
      // tile -> anchor
      const M = xf.M, t = xf.t;
      const ax = M[0] * x + M[1] * y + M[2] * z + t[0], ay = M[3] * x + M[4] * y + M[5] * z + t[1], az = M[6] * x + M[7] * y + M[8] * z + t[2];
      const dx = ax - C.x, dy = ay - C.y, dz = az - C.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > NEAR * NEAR) return;
      const lod = d2 < LOD_D[0] * LOD_D[0] ? 0 : d2 < LOD_D[1] * LOD_D[1] ? 1 : 2;
      // heading: tile-frame direction (sin yaw, cos yaw) mapped to the anchor frame
      const fx = Math.sin(yawT), fz = Math.cos(yawT);
      const gx = M[0] * fx + M[2] * fz, gz = M[6] * fx + M[8] * fz;
      const R = this.meshes[look.type][lod];
      if (R.n >= R.cap) return;
      q.setFromAxisAngle(Y, Math.atan2(gx, gz)); s3.setScalar(sc); p3.set(ax, ay, az);
      m4.compose(p3, q, s3);
      R.mesh.setMatrixAt(R.n, m4);
      R.aWalk.array[R.n * 2] = phase; R.aWalk.array[R.n * 2 + 1] = amp;
      const o4 = R.n * 4;
      R.aPose.array[o4] = pose; R.aPose.array[o4 + 1] = va; R.aPose.array[o4 + 2] = headYaw; R.aPose.array[o4 + 3] = stride;
      R.aLook.array[o4] = look.outfit; R.aLook.array[o4 + 1] = look.skin; R.aLook.array[o4 + 2] = look.hair; R.aLook.array[o4 + 3] = look.face;
      R.n++;
    };
    for (const W of this.walkers) {
      const L2 = 2 * W.len;
      let s = (W.s0 + W.v * T) % L2; if (s < 0) s += L2;
      const back = s > W.len;
      const sl = back ? L2 - s : s;
      walkPoint(W.w, W.L, sl, P);
      const dir = back ? -1 : 1;
      const lat = W.lat + dir * W.keep;                       // + keep right in the walking direction
      const x = P.x - P.tz * lat, z = P.z + P.tx * lat;
      const yaw = Math.atan2(P.tx * dir, P.tz * dir);
      // gait: one cycle (two steps) per ~1.42 m of travel at stride 1 (scaled with stature and stride)
      const ty = HUMAN_TYPES[W.look.type];
      const cyc = 1.42 * (ty.H / 1.75) * W.sc * W.stride;
      const phase = ((W.s0 + W.v * T) / cyc) * Math.PI * 2;
      put(W.xf, x, P.y + W.t.seatC, z, yaw, W.sc, W.look, phase % (Math.PI * 2000), 1, 0, u01(mix32(W.h, 31)), 0, W.stride);
    }
    for (const I of this.idlers) put(I.xf, I.x, I.y + I.t.seatC, I.z, I.face, I.sc, I.look, 0, 0, I.pose, u01(mix32(I.h, 31)), I.yawH, 1);
    let total = 0;
    for (const row of this.meshes) for (const M of row) {
      M.mesh.count = M.n; total += M.n;
      if (!M.n) continue;
      M.mesh.instanceMatrix.needsUpdate = true; M.aWalk.needsUpdate = true; M.aPose.needsUpdate = true; M.aLook.needsUpdate = true;
    }
    this.count = total;
  }

  stats() { return { walkers: this.walkers.length, idle: this.idlers.length, drawn: this.count, loaded: !!this.meshes }; }
}

// body-type mix (humans.js HUMAN_TYPES order): city crowds vs. O-zone work towns (more work clothes)
const MIX_Z = [0.17, 0.1, 0.08, 0.16, 0.12, 0.1, 0.07, 0.03, 0.13, 0.04];
const MIX_O = [0.14, 0.06, 0.1, 0.12, 0.05, 0.05, 0.08, 0.3, 0.07, 0.03];
const MIX_IDLE = [0.17, 0.11, 0.08, 0.15, 0.12, 0.11, 0.08, 0.02, 0.12, 0.04];
/** deterministic look of a person: body type, outfit row, skin tone, hair colour, face cell */
function pickLook(h, oZone, idle) {
  const mix = idle ? MIX_IDLE : oZone ? MIX_O : MIX_Z;
  let u = u01(mix32(h, 41)), type = 0;
  for (let i = 0; i < mix.length; i++) { u -= mix[i]; if (u <= 0) { type = i; break; } type = i; }
  const T = HUMAN_TYPES[type];
  const outfit = T.outfits[mix32(h, 42) % T.outfits.length];
  const skin = mix32(h, 43) % SKIN_TONES.length;
  let hair;
  const hu = u01(mix32(h, 44));
  if (T.id === 'elder') hair = hu < 0.6 ? 5 : 6;
  else if (T.child) hair = hu < 0.5 ? 1 : hu < 0.8 ? 2 : 4;
  else hair = hu < 0.34 ? 0 : hu < 0.62 ? 1 : hu < 0.8 ? 2 : hu < 0.88 ? 3 : hu < 0.96 ? 4 : 7;
  if (skin >= 5 && hair === 4) hair = 1;
  const face = T.face[mix32(h, 45) & 1];
  return { type, outfit, skin, hair, face };
}
/** idle pose (materials.js HUMAN_VS): 0 relaxed, 1 weight shift, 2 phone, 3 hands in pockets, 4 arms crossed, 5 cup */
function idlePose(h, kind) {
  const u = u01(mix32(h, 51));
  if (kind === 1) return u < 0.25 ? 0 : u < 0.5 ? 1 : u < 0.8 ? 2 : u < 0.9 ? 3 : 4;        // platform: waiting, phones
  if (kind === 2) return u < 0.35 ? 0 : u < 0.6 ? 1 : u < 0.75 ? 3 : u < 0.88 ? 4 : 5;      // waterfront
  return u < 0.28 ? 0 : u < 0.5 ? 1 : u < 0.66 ? 2 : u < 0.76 ? 3 : u < 0.88 ? 4 : 5;       // plaza groups
}
function strHashCached(w) {
  if (w._h !== undefined) return w._h;
  let h = 0x811c9dc5; const s = w.id || '';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  w._h = h >>> 0;
  return w._h;
}

export { frameXf, frameToEcef };
