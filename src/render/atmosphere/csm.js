// Cascaded sun shadows near the camera. OWNER: atmosphere agent.
// N DirectionalLights (intensity 0, castShadow) carry the shadow maps; patched materials pick the
// cascade by view depth (dithered blend bands, rotated Vogel PCF that converges under TAA).
// Stability: each cascade is a sphere fit of its frustum slice (rotation invariant radius, radius
// quantised in ~9% steps) and its centre is snapped to the shadow texel grid in a light frame
// anchored in ECEF (float64), so the grid does not move with the floating origin -> no shimmer.
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);

export class PlanetCSM {
  constructor(app, { cascades = 4, mapSize = 4096 } = {}) {
    this.app = app;
    this.cascades = cascades;
    this.mapSize = mapSize;
    this.enabled = false;
    this.lights = [];
    this.splits = new Array(cascades + 1).fill(0);
    this.radii = new Array(cascades).fill(1);
    this.maxAltitude = 8000;       // m above ground: above this, no cascades
    this.penumbra = 0.05;          // m, world-space PCF radius target
    this.version = 0;
    for (let i = 0; i < cascades; i++) {
      const l = new THREE.DirectionalLight(0xffffff, 0);
      l.name = `csm.cascade${i}`;
      l.castShadow = true;
      l.shadow.mapSize.set(mapSize, mapSize);
      l.shadow.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
      l.shadow.autoUpdate = true;
      l.target.name = `csm.target${i}`;
      app.scene.add(l, l.target);
      this.lights.push(l);
    }
    this._right = new THREE.Vector3(); this._upL = new THREE.Vector3(); this._L = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  /** compatibility with three's CSM API: patched materials need no setup */
  setupMaterial() {}

  _computeSplits(near, far) {
    const n = this.cascades, lambda = 0.92;
    this.splits[0] = near;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const log = near * Math.pow(far / near, f), uni = near + (far - near) * f;
      this.splits[i] = lambda * log + (1 - lambda) * uni;
    }
    this.splits[n] = far;
  }

  update(frame, uniforms, wantShadows) {
    const app = this.app, cam = app.camera, r = app.renderer;
    const hg = Math.max(0, frame.camAltGround ?? frame.camAlt);
    const mus = frame.camUp.dot(frame.sunDir);
    const on = wantShadows && hg < this.maxAltitude && mus > -0.035;
    this.enabled = on;
    uniforms.uLpShadowOn.value = on ? 1 : 0;
    for (const l of this.lights) l.visible = true;   // keep the light count stable (no recompiles)
    if (!on) { r.shadowMap.needsUpdate = false; return; }

    const near = Math.max(cam.near, 0.45 * hg, 0.05);
    // fix round 2 (QQ-01): a high camera sees the ground from ~hg to the horizon, and its pixels are
    // large there, so the cascades reach much further (2 km above ground: ~20 km, texels of the last
    // cascade ~7 m < 1 px); ridges and escarpments keep their cast shadows instead of losing them
    // a few km out. Street level is unchanged (~2.6 km).
    const far = Math.min(2600 + 9 * hg, 30000);
    this._computeSplits(near, far);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanX = tanY * cam.aspect;
    const k2 = tanX * tanX + tanY * tanY;
    const L = this._L.copy(frame.sunDir).normalize();
    const right = this._right.crossVectors(Y, L);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const upL = this._upL.crossVectors(L, right).normalize();
    const camEcef = frame.camEcef;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);

    for (let i = 0; i < this.cascades; i++) {
      const dn = this.splits[i], df = this.splits[i + 1];
      // analytic minimal sphere of a symmetric frustum slice
      let zc = 0.5 * (df + dn) * (1 + k2), rad;
      if (zc >= df) { zc = df; rad = df * Math.sqrt(k2); }
      else rad = Math.sqrt((zc - dn) * (zc - dn) + dn * dn * k2);
      rad = Math.pow(2, Math.ceil(Math.log2(rad * 1.02) * 8) / 8);       // quantised radius
      this.radii[i] = rad;
      const texel = (2 * rad) / this.mapSize;
      // centre in render space, then ECEF (float64), snap in the light frame
      const cx = fwd.x * zc, cy = fwd.y * zc, cz = fwd.z * zc;
      const ex = cx + camEcef.x, ey = cy + camEcef.y, ez = cz + camEcef.z;
      let px = ex * right.x + ey * right.y + ez * right.z;
      let py = ex * upL.x + ey * upL.y + ez * upL.z;
      const pz = ex * L.x + ey * L.y + ez * L.z;
      px = Math.round(px / texel) * texel;
      py = Math.round(py / texel) * texel;
      const sx = right.x * px + upL.x * py + L.x * pz - camEcef.x;
      const sy = right.y * px + upL.y * py + L.y * pz - camEcef.y;
      const sz = right.z * px + upL.z * py + L.z * pz - camEcef.z;
      const zExtra = Math.max(2500, rad * 1.5);
      const l = this.lights[i];
      l.target.position.set(sx, sy, sz);
      l.position.set(sx + L.x * (rad + zExtra), sy + L.y * (rad + zExtra), sz + L.z * (rad + zExtra));
      const sc = l.shadow.camera;
      sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad;
      sc.near = 0.5; sc.far = 2 * rad + zExtra + 50;
      sc.updateProjectionMatrix();
      const range = sc.far - sc.near;
      l.shadow.normalBias = texel * 1.2;
      l.shadow.bias = -(texel * 1.0 + 0.002) / range;
      l.updateMatrixWorld(); l.target.updateMatrixWorld();
    }
    const u = uniforms;
    u.uLpCascadeFar.value.set(this.splits[1], this.splits[2] ?? 1e9, this.splits[3] ?? 1e9, this.splits[4] ?? 1e9);    const pr = (i) => (i < this.cascades ? Math.max(1.0, Math.min(6.0, this.penumbra / ((2 * this.radii[i]) / this.mapSize))) : 1);
    u.uLpPcfRadius.value.set(pr(0), pr(1), pr(2), pr(3));
    r.shadowMap.needsUpdate = true;
    this.version++;
  }

  dispose() {
    for (const l of this.lights) { this.app.scene.remove(l, l.target); l.shadow.map?.dispose(); l.dispose?.(); }
  }
}
