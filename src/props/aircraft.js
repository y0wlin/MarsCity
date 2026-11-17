// Sparse flying traffic (brief §1 optional): eVTOL air taxis on air corridors above the rail lines.
// OWNER: props agent.
//   * corridors = the urban rail segments near the camera (trains.js segs): one lane per direction,
//     70–110 m to the right of the line, cruising 120–300 m above the rail level (same heights as the
//     rails the city draws), 42–58 m/s
//   * sparse: ~1 craft per 3.5 km of corridor and direction (max 4), positions a pure function of sol
//     time (phase from the segment key): identical on every reload, frozen when the clock is paused
//   * nav lights (glow sprites, night factor in the shader): red port / green starboard wing tips,
//     white tail strobe (short flash every 1.1 s) and a red top beacon (every 1.4 s), also sol-time
//     driven, so a still frame shows a deterministic blink state
import * as THREE from 'three';
import { origin } from '../core/origin.js';
import * as CORR from '../world/urban/corridors.js';
import { AIR_NAV } from './models.js';
import { pointFrame, ecefToFrame, mix32, u01 } from './util.js';
import { R } from '../core/constants.js';

const MAX_D = 9000;          // m: craft drawn within this distance of the camera
const CAP = 96;

export class Aircraft {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.group = new THREE.Group(); this.group.name = 'props-aircraft';
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this._key = '';
    this.visible = [];
  }

  init() {
    const L = this.sys.lib, mats = this.sys.mats;
    if (!L || !L.airTaxi || !mats) return;
    this.app.scene.add(this.group);
    this.meshes = Object.entries(L.airTaxi).filter(([, g]) => g && g.isBufferGeometry).map(([k, g]) => {
      const m = new THREE.InstancedMesh(g, mats.get(k), CAP);
      m.count = 0; m.frustumCulled = false; m.castShadow = k !== 'boatGlass'; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m); return m;
    });
    if (L.sprite && mats.glow) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', L.sprite.getAttribute('position').clone()); sg.setIndex(L.sprite.getIndex().clone());
      this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage);
      sg.setAttribute('aGlow', this.glowAttr);
      this.glow = new THREE.InstancedMesh(sg, mats.glow, CAP * 4);
      this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 6;
      this.group.add(this.glow);
    }
  }

  /** craft of one corridor segment at sol second T -> [{dir, s, alt, off, id, ph}] (pure) */
  static craftOf(sg, T) {
    const out = [];
    const h = mix32(sg.key % 2147483647, 0xa1c7);
    for (const dir of [1, -1]) {
      const hd = mix32(h, dir > 0 ? 11 : 23);
      const n = Math.max(1, Math.min(4, Math.round(sg.len / 3500)));
      const v = 42 + 16 * u01(mix32(hd, 1));
      const loop = sg.len + 4000;                          // fly 2 km beyond each end before wrapping
      for (let i = 0; i < n; i++) {
        const hi = mix32(hd, 100 + i);
        const s0 = u01(hi) * loop;
        let s = ((s0 + v * T) % loop + loop) % loop - 2000;
        if (dir < 0) s = sg.len - s;
        out.push({ dir, s, v, alt: 120 + 180 * u01(mix32(hi, 2)), off: 70 + 40 * u01(mix32(hi, 3)), id: `${sg.key.toString(36)}:${dir > 0 ? 'a' : 'b'}${i}`, ph: u01(mix32(hi, 4)) });
      }
    }
    return out;
  }

  update(frame, night) {
    if (!this.meshes) return;
    const cam = frame.camEcef, alt = frame.camAltGround;
    const trains = this.sys.trains;
    if (alt > 30000 || !trains || !trains.enabled) { this.group.visible = false; return; }
    this.group.visible = true;
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 3000) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.anchor.E), new THREE.Vector3(...this.anchor.U), new THREE.Vector3(...this.anchor.S)));
      this._key = '';
    }
    const A = this.anchor;
    this.group.quaternion.copy(this.anchorQuat);
    this.group.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    const T = frame.solTime * 3600;
    const key = `${T.toFixed(3)}|${trains.segs.size}|${A.ox}|${trains._polyVer}|${night > 0.002 ? 1 : 0}`;
    if (key === this._key) return;
    this._key = key;
    const l = Math.hypot(cam.x, cam.y, cam.z) || 1;
    const SD = {}, Q = {}, Q2 = {}, Lp = {}, Lf = {}, Lu = {};
    const m4 = new THREE.Matrix4(), gm = new THREE.Matrix4();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    let n = 0, nG = 0;
    this.visible.length = 0;
    const glowOn = night > 0.002 && this.glow;
    for (const sg of trains.segs.values()) {
      let d; try { d = CORR.segDistance(sg, cam.x / l, cam.y / l, cam.z / l, SD); } catch (e) { continue; }
      if (d > MAX_D + 2000) continue;
      for (const c of Aircraft.craftOf(sg, T)) {
        if (n >= CAP) break;
        // corridor point + lateral offset (right of travel) at cruise height above the rail level
        const tc = Math.max(0, Math.min(sg.len, c.s));
        const base = trains.railHeight(sg, tc);
        CORR.pointAt(sg, c.s, Q); CORR.pointAt(sg, c.s + 30 * c.dir, Q2);
        const off = (c.dir > 0 ? -c.off : c.off) / R;
        const ux = Q.x + sg.nx * off, uy = Q.y + sg.ny * off, uz = Q.z + sg.nz * off, ul = Math.hypot(ux, uy, uz);
        const r = R + base + c.alt;
        const px = ux / ul * r, py = uy / ul * r, pz = uz / ul * r;
        const dc = Math.hypot(px - cam.x, py - cam.y, pz - cam.z);
        if (dc > MAX_D) continue;
        ecefToFrame(A, px, py, pz, Lp);
        ecefToFrame(A, (Q2.x - Q.x) * R + A.ox, (Q2.y - Q.y) * R + A.oy, (Q2.z - Q.z) * R + A.oz, Lf);
        ecefToFrame(A, ux / ul + A.ox, uy / ul + A.oy, uz / ul + A.oz, Lu);
        Y.set(Lu.x, Lu.y, Lu.z).normalize();
        Z.set(Lf.x, Lf.y, Lf.z); Z.addScaledVector(Y, -Z.dot(Y)); if (Z.lengthSq() < 1e-10) continue; Z.normalize();
        X.crossVectors(Y, Z).normalize();
        // slight nose-down cruise attitude
        const pitch = 0.05;
        const Zp = Z.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(Y, -Math.sin(pitch));
        const Yp = Y.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(Z, Math.sin(pitch));
        m4.makeBasis(X, Yp, Zp); m4.setPosition(Lp.x, Lp.y, Lp.z);
        for (const m of this.meshes) m.setMatrixAt(n, m4);
        n++;
        this.visible.push({ id: c.id, distance: dc, alt: c.alt, ecef: { x: px, y: py, z: pz } });
        if (glowOn && nG + 4 <= CAP * 4) {
          const at = (p) => { gm.makeTranslation(Lp.x + X.x * p[0] + Yp.x * p[1] + Zp.x * p[2], Lp.y + X.y * p[0] + Yp.y * p[1] + Zp.y * p[2], Lp.z + X.z * p[0] + Yp.z * p[1] + Zp.z * p[2]); this.glow.setMatrixAt(nG, gm); };
          const tip = AIR_NAV.tip;
          at([tip[0], tip[1], tip[2]]); this.glowAttr.array.set([90, 4, 3, 0.35], nG * 4); nG++;        // port red
          at([-tip[0], tip[1], tip[2]]); this.glowAttr.array.set([4, 80, 30, 0.35], nG * 4); nG++;      // starboard green
          const strobe = ((T / 1.1 + c.ph) % 1 + 1) % 1 < 0.1, beacon = ((T / 1.4 + c.ph * 0.7) % 1 + 1) % 1 < 0.18;
          if (strobe) { at(AIR_NAV.strobe); this.glowAttr.array.set([260, 260, 250, 0.45], nG * 4); nG++; }
          if (beacon) { at(AIR_NAV.beacon); this.glowAttr.array.set([150, 8, 4, 0.4], nG * 4); nG++; }
        }
      }
    }
    for (const m of this.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    if (this.glow) { this.glow.count = glowOn ? nG : 0; this.glow.instanceMatrix.needsUpdate = true; this.glowAttr.needsUpdate = true; }
  }

  stats() { return { craft: this.visible.length }; }
}
