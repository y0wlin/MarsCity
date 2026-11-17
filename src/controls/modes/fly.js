// Fly mode — 6-DOF free flight. WASD/arrows move along the view, Space/C along the local
// vertical, Q/E roll (horizon re-levels when released), mouse look by drag (grab) or pointer lock
// (FPS). Speed ∝ height above ground (×10 Shift, ÷10 Alt). Wheel dollies towards the cursor.
// Collision-safe: 1.7 m above terrain / roofs, sphere vs building colliders, swept rays. The water
// surface is no floor here: fly mode dives below it (underwater views; orbit / walk stay above it).
// OWNER: controls agent.
import * as THREE from 'three';
import { R, DEG } from '../../core/constants.js';
import { clamp, damp } from '../math.js';
import { resolveSphere } from '../collide.js';
import { origin } from '../../core/origin.js';

const CLEAR = 1.7;
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _t = new THREE.Vector3(), _mv = new THREE.Vector3(), _p0 = new THREE.Vector3(), _c = new THREE.Vector3();
const _info = {};

export class FlyMode {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.name = 'fly';
    this.vel = new THREE.Vector3();
    this.look = { dx: 0, dy: 0, locked: false };
    this.drag = null;
    this.zoomPending = 0;
    this.zoomAnchor = new THREE.Vector3();
    this.zoomAt = { x: -1e9, y: -1e9, t: 0 };
    this.horizonLock = true;
    this.speed = 0;
    this.anchorDist = 1;
    this.anchorVirtual = false;
  }
  get rig() { return this.ctrl.app.rig; }

  enter() { this.stop(); }
  exit() { this.stop(); this.drag = null; }
  stop() { this.vel.set(0, 0, 0); this.look.dx = this.look.dy = 0; this.zoomPending = 0; }
  isMoving() { return !!this.drag || this.vel.lengthSq() > 1e-6 || Math.abs(this.zoomPending) > 1e-4 || this.ctrl.anyNavKey(); }

  onDragStart(kind, x, y) { this.drag = { x, y, kind }; }
  onDragMove(x, y, dx, dy) { if (this.drag) { this.look.dx += dx; this.look.dy += dy; this.look.locked = false; } }
  onDragEnd() { this.drag = null; }
  onLookDelta(dx, dy) { this.look.dx += dx; this.look.dy += dy; this.look.locked = true; }

  onWheel(x, y, step) {
    const now = performance.now();
    const P = this.rig.position;
    const near = Math.hypot(P.x - this.zoomAnchor.x, P.y - this.zoomAnchor.y, P.z - this.zoomAnchor.z) < 0.4 * this.anchorDist;
    if (Math.abs(x - this.zoomAt.x) + Math.abs(y - this.zoomAt.y) > 3 || now - this.zoomAt.t > 260 || (this.anchorVirtual && near)) {
      this.pickAnchor(x, y);
      this.zoomAt.x = x; this.zoomAt.y = y;
    }
    this.zoomAt.t = now;
    this.zoomPending = clamp(this.zoomPending + step, -6, 6);
  }

  /** dolly anchor: the visible surface under the cursor, or (sky) a point along the cursor ray */
  pickAnchor(x, y) {
    const ctrl = this.ctrl;
    const ray = ctrl.rayAt(x, y);
    const s = ctrl.ground.surfacePoint(ray.o, ray.d);
    this.anchorVirtual = s.kind === 'silhouette';
    if (this.anchorVirtual) {
      this.anchorDist = clamp(20 * Math.max(ctrl.heightAboveGround(), 1), 50, 2e6);
      this.zoomAnchor.copy(ray.d).multiplyScalar(this.anchorDist).add(ray.o);
    } else { this.anchorDist = s.distance; this.zoomAnchor.copy(s.point); }
  }

  onGesture(g) {
    if (g.phase === 'start') { this.pickAnchor(g.x, g.y); return; }
    if (g.phase !== 'move') return;
    if (g.scale && Math.abs(Math.log(g.scale)) > 1e-5) this.ctrl.zoomTowards(this.zoomAnchor, Math.log(g.scale), { minDist: CLEAR, clearance: CLEAR, water: false });
    if (g.rotation) this.yawPitch(g.rotation, 0);
  }

  onKeyDown(code) {
    if (code === 'KeyL') { this.horizonLock = !this.horizonLock; return true; }
    return false;
  }

  /** dYaw > 0 turns right; dPitch > 0 looks up */
  yawPitch(dYaw, dPitch) {
    const rig = this.rig;
    rig.localUp(_up);
    if (dYaw) { _q.setFromAxisAngle(_up, -dYaw); rig.rotateInPlace(_q); }
    if (dPitch) {
      rig.forward(_f);
      const p = Math.asin(clamp(_f.dot(_up), -1, 1));
      const np = clamp(p + dPitch, -89 * DEG, 89 * DEG);
      if (np !== p) {
        rig.right(_r); _r.addScaledVector(_up, -_r.dot(_up));
        if (_r.lengthSq() < 1e-12) rig.right(_r);
        _r.normalize();
        _q.setFromAxisAngle(_r, np - p); rig.rotateInPlace(_q);
      }
    }
  }

  update(dt) {
    const ctrl = this.ctrl, rig = this.rig, k = ctrl.keys;
    const has = (c) => k.has(c);
    // ---- look
    if (this.look.dx || this.look.dy) {
      const vp = ctrl.viewport();
      if (this.look.locked) this.yawPitch(this.look.dx * 0.0021, -this.look.dy * 0.0021);
      else { const s = (rig.vfov(ctrl.aspect()) * DEG) / vp.height; this.yawPitch(-this.look.dx * s, this.look.dy * s); }
      this.look.dx = this.look.dy = 0;
    }
    // ---- roll
    const roll = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    if (roll) { rig.forward(_f); _q.setFromAxisAngle(_f, roll * 70 * DEG * dt); rig.rotateInPlace(_q); }
    else if (this.horizonLock) ctrl.levelRoll(2.2 * dt, null, 'roll');

    // ---- translation (speed ∝ height above the ground; under water: above the bed)
    let hAG = ctrl.heightAboveGround();
    if (hAG < 0.5) { const P = rig.position; hAG = Math.max(hAG, Math.hypot(P.x, P.y, P.z) - R - ctrl.ground.terrainHeightAt(P, 0.05)); }
    let speed = clamp(hAG * 0.9, 1.2, 4e6);
    if (has('ShiftLeft') || has('ShiftRight')) speed *= 10;
    if (has('AltLeft') || has('AltRight')) speed *= 0.1;
    const fw = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    const rt = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
    const vu = (has('Space') ? 1 : 0) - (has('KeyC') ? 1 : 0);
    rig.forward(_f); rig.right(_r); rig.localUp(_up);
    _t.set(0, 0, 0).addScaledVector(_f, fw).addScaledVector(_r, rt).addScaledVector(_up, vu);
    if (_t.lengthSq() > 1) _t.normalize();
    _t.multiplyScalar(speed);
    this.vel.lerp(_t, damp(dt, _t.lengthSq() > 0 ? 0.22 : 0.3));
    if (this.vel.lengthSq() < 1e-8 && _t.lengthSq() === 0) this.vel.set(0, 0, 0);
    this.speed = this.vel.length();
    if (this.speed > 0) {
      const P = rig.position;
      _p0.set(P.x, P.y, P.z);
      _mv.copy(this.vel).multiplyScalar(dt);
      if (hAG < 2500 || _mv.length() > hAG * 0.5) {
        const f = ctrl.ground.sweep(_p0, _c.copy(_p0).add(_mv), 1.0, { terrain: _mv.length() > 20, water: false });
        if (f < 1) { _mv.multiplyScalar(f); this.vel.multiplyScalar(f); }
      }
      rig.setPosition(P.x + _mv.x, P.y + _mv.y, P.z + _mv.z);
    }
    // ---- dolly towards the cursor
    if (Math.abs(this.zoomPending) > 1e-5) {
      const s = this.zoomPending * damp(dt, 0.11);
      this.zoomPending -= s;
      const res = ctrl.zoomTowards(this.zoomAnchor, s, { minDist: CLEAR, clearance: CLEAR, water: false });
      if (res.clamped) this.zoomPending = 0;
    } else this.zoomPending = 0;

    // ---- building colliders (sphere around the eye)
    if (hAG < 300) {
      const P = rig.position;
      const cols = ctrl.collidersNear(P, 25);
      if (cols.length) {
        _c.set(P.x - origin.x, P.y - origin.y, P.z - origin.z);
        rig.localUp(_up);
        resolveSphere(cols, _c, 0.9, _up, _info, 3);
        if (_info.hits) {
          rig.setPosition(_c.x + origin.x, _c.y + origin.y, _c.z + origin.z);
          const n = _info.push; const l = n.length();
          if (l > 1e-9) { _u.copy(n).multiplyScalar(1 / l); const vn = this.vel.dot(_u); if (vn < 0) this.vel.addScaledVector(_u, -vn); }
        }
      }
    }
    // ---- ground clearance (terrain / roofs; the water surface is no floor in fly mode)
    const pushed = ctrl.clampAbove(CLEAR, { water: false });
    if (pushed > 0) { rig.localUp(_up); const vn = this.vel.dot(_up); if (vn < 0) this.vel.addScaledVector(_up, -vn); }
  }
}
