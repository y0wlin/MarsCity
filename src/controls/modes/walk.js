// Walk mode — first person on the ground and inside buildings.
//  * eye height 1.65 m, capsule r 0.28 m from 0.35 m (step height) to 1.80 m above the feet
//  * WASD walk 1.4 m/s, Shift run 4 m/s, Space jump, Mars gravity (3.72 m/s²)
//  * ground = max(final full-detail terrain (analytic world height, never the loaded tiles: Ground.walkTerrainAt),
//    walkable collider surfaces found by downward rays);
//    step-up ≤ 0.35 m (stairs) with eye smoothing, snap-down on stairs/slopes, slopes ≤ 40°
//  * capsule vs three-mesh-bvh colliders from the city (walls, doors, floors, stairs): walls slide,
//    ceilings stop jumps; deep water (> 0.6 m) is not walkable; terrain steeper than 40° blocks
//  * pointer-lock look (FPS), drag look (grab) when unlocked; view kept as a parallel-transported
//    horizontal vector + pitch, so walking over the poles never flips
// OWNER: controls agent.
import * as THREE from 'three';
import { R, DEG } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { clamp, damp, tangentBasis } from '../math.js';
import { resolveCapsule, raycastColliders } from '../collide.js';

export const WALK = {
  eye: 1.65, height: 1.8, radius: 0.28, step: 0.35, slopeMax: 40, gravity: 3.72,
  walk: 1.4, run: 4.0, jump: 2.4, accGround: 14, accAir: 2.0, snap: 0.42, substep: 1 / 120,
  colliderRadius: 14,
};

const _up = new THREE.Vector3(), _r = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3();
const _mv = new THREE.Vector3(), _vh = new THREE.Vector3(), _nf = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _wq = new THREE.Quaternion();
const _p0 = new THREE.Vector3(), _gu = new THREE.Vector3(), _gm = new THREE.Vector3(), _gd = new THREE.Vector3(), _go = new THREE.Vector3();
const _info = {};
const _hit = {};

export class WalkMode {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.name = 'walk';
    this.feet = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwdH = new THREE.Vector3(0, 0, -1);
    this.pitch = 0;
    this.grounded = false;
    this.eyeOffset = 0;
    this.look = { dx: 0, dy: 0, locked: false };
    this.drag = null;
    this.jumpReq = 0;
    this.touchWalk = 0;
    this.colliders = [];
    this._colAt = new THREE.Vector3(NaN, NaN, NaN);
    this._colT = 0;
    this.lastDry = new THREE.Vector3();
    this.lastDryValid = false;
    this.cosSlope = Math.cos(WALK.slopeMax * DEG);
    this.tanSlope = Math.tan(WALK.slopeMax * DEG);
    this.slope = { tan: 0, dir: new THREE.Vector3() };
    // picking-hull surface under the feet (roof / deck of a building or megastructure whose walk
    // colliders are still loading), refreshed once per frame (updateHull)
    this.hull = { valid: false, h: 0, kind: null, at: new THREE.Vector3() };
    this.info = { grounded: false, groundKind: 'terrain', groundH: 0, terrainH: 0, feetH: 0, speed: 0, inWater: false, colliders: 0 };
  }
  get rig() { return this.ctrl.app.rig; }

  enter() { this.syncFromRig(); }
  exit() { this.drag = null; this.vel.set(0, 0, 0); }
  stop() { this.vel.set(0, 0, 0); this.look.dx = this.look.dy = 0; }
  isMoving() { return !!this.drag || this.vel.lengthSq() > 1e-6 || !this.grounded || this.ctrl.anyNavKey() || Math.abs(this.eyeOffset) > 1e-3; }

  /** adopt the current camera pose: feet 1.65 m below the eye, settle onto nearby ground */
  syncFromRig() {
    const rig = this.rig;
    this._held = this.ctrl.walkHoldFeet ? this.ctrl.walkHoldFeet() : null;
    rig.localUp(_up);
    const P = rig.position;
    this.feet.set(P.x, P.y, P.z).addScaledVector(_up, -WALK.eye);
    rig.forward(_f);
    const fu = clamp(_f.dot(_up), -1, 1);
    this.pitch = clamp(Math.asin(fu), -85 * DEG, 85 * DEG);
    this.fwdH.copy(_f).addScaledVector(_up, -fu);
    if (this.fwdH.lengthSq() < 1e-10) { rig.up(this.fwdH); this.fwdH.multiplyScalar(-Math.sign(fu) || 1); this.fwdH.addScaledVector(_up, -this.fwdH.dot(_up)); }
    if (this.fwdH.lengthSq() < 1e-10) tangentBasis(_up, _e, this.fwdH);
    this.fwdH.normalize();
    this.vel.set(0, 0, 0);
    this.eyeOffset = 0;
    this._colAt.set(NaN, NaN, NaN);
    this.refreshColliders(true);
    if (this._held != null) { this._freeze(); this.writeCamera(); return; }
    this.updateHull(0.6);
    const g = this.groundAt(this.feet, _up, WALK.step + 0.05, 0.6);
    const feetH = this.feet.length() - R;
    if (g.h >= feetH - 0.6 && g.h <= feetH + WALK.step + 0.05) { this.feet.copy(_up).multiplyScalar(R + g.h); this.grounded = true; }
    else if (feetH < g.terrain) { this.feet.copy(_up).multiplyScalar(R + g.terrain); this.grounded = true; }
    else this.grounded = false;
    this.lastDry.copy(this.feet);
    const wl0 = this.ctrl.ground.waterLevelAt(this.feet, 0.25);
    this.lastDryValid = !(wl0 - g.terrain > 0.6);
    if (!this.lastDryValid && this.feet.length() - R < wl0) { this.feet.copy(_up).multiplyScalar(R + wl0); this.grounded = true; }
    const info = this.info;
    info.grounded = this.grounded; info.groundKind = g.kind; info.groundH = g.h; info.terrainH = g.terrain; info.feetH = this.feet.length() - R; info.speed = 0;
    this.writeCamera();
  }

  /**
   * Held programmatic walking pose (bookmark / building view, no user input yet): the walker stands
   * exactly at the requested feet height, untouched by the physics. Streaming colliders are not final
   * while the scene refines — the city seats buildings onto the displayed (possibly still coarse)
   * terrain, so their floors move metres up and down until the terrain has refined — and a walker
   * carried by them would end on the wrong storey or fall through one that has not loaded. The
   * request itself comes from final geometry (kit camera anchors in the building frame, the analytic
   * terrain); user input releases the hold and the normal walk physics take over.
   */
  _freeze() {
    _up.copy(this.feet).normalize();
    this.feet.copy(_up).multiplyScalar(R + this._held);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.eyeOffset = 0;
    const info = this.info;
    // (the held floor is the walker's ground while held: info stays consistent for HUD / tests)
    info.grounded = true; info.groundKind = 'hold'; info.groundH = this._held; info.feetH = this._held; info.speed = 0; info.inWater = false;
  }

  // ------------------------------------------------------------------------------ input
  onDragStart(kind, x, y) { this.drag = { x, y }; }
  onDragMove(x, y, dx, dy) { if (this.drag) { this.look.dx += dx; this.look.dy += dy; this.look.locked = false; } }
  onDragEnd() { this.drag = null; }
  onLookDelta(dx, dy) { this.look.dx += dx; this.look.dy += dy; this.look.locked = true; }
  onWheel(x, y, step) { this.touchWalk = clamp(this.touchWalk + step * 2.5, -12, 12); } // wheel nudges forward/back
  onGesture(g) {
    if (g.phase !== 'move') return;
    if (g.scale) this.touchWalk = clamp(this.touchWalk + Math.log(g.scale) * 8, -12, 12);
    if (g.rotation) this.turn(g.rotation, 0);
  }
  onKeyDown(code) {
    if (code === 'Space') { this.jumpReq = 0.2; return true; }
    return false;
  }

  /** set the view: heading (deg, compass), pitch (deg) */
  setLook(headingDeg, pitchDeg) {
    _up.copy(this.feet).normalize();
    tangentBasis(_up, _e, _n);
    const h = headingDeg * DEG;
    this.fwdH.copy(_n).multiplyScalar(Math.cos(h)).addScaledVector(_e, Math.sin(h)).normalize();
    this.pitch = clamp(pitchDeg * DEG, -88 * DEG, 88 * DEG);
    this.writeCamera();
    this.ctrl._markInternal?.();   // a controls-side view change, not an external (programmatic) pose
  }

  /** dYaw > 0 turns right, dPitch > 0 looks up */
  turn(dYaw, dPitch) {
    _up.copy(this.feet).normalize();
    if (dYaw) this.fwdH.applyAxisAngle(_up, -dYaw).normalize();
    if (dPitch) this.pitch = clamp(this.pitch + dPitch, -88 * DEG, 88 * DEG);
  }

  // ------------------------------------------------------------------------------ queries
  refreshColliders(force) {
    const now = performance.now();
    if (!force && this._colAt.distanceTo(this.feet) < 3 && now - this._colT < 250) return;
    this.colliders = this.ctrl.collidersNear(this.feet, WALK.colliderRadius);
    this._colAt.copy(this.feet); this._colT = now;
    this.info.colliders = this.colliders.length;
    this._megaCols = this.colliders.some((c) => c._src === 'mega');
  }

  /**
   * Roof / deck of a building or megastructure under the feet that has no walk colliders yet (its
   * 'full' LOD is still loading): the picking hull carries the walker meanwhile, so landing on a
   * roof never falls through it. Buildings with colliders are skipped (the colliders are exact).
   */
  updateHull(reachDown = WALK.snap) {
    const hf = this.hull;
    hf.valid = false;
    let hb = null;
    try {
      hb = this.ctrl.ground.hullBelow(this.feet, WALK.step + 0.05, reachDown + 0.5,
        (kind, id) => (kind === 'building' && id != null && this.hasCollider(id)) || (kind === 'mega' && this._megaCols));
    } catch { hb = null; }
    if (!hb) return;
    hf.valid = true; hf.h = hb.h; hf.kind = hb.kind; hf.at.copy(this.feet);
  }

  /**
   * Ground under the feet: max(terrain, highest walkable collider surface within
   * [feet − reachDown, feet + reachUp]). Returns {h, terrain, kind, normalUp}.
   */
  groundAt(feet, up, reachUp, reachDown, out = this._g || (this._g = {})) {
    // the final (analytic) terrain, never a coarse tile above it (Z-02; see Ground.walkTerrainAt)
    const terrain = this.ctrl.ground.walkTerrainAt(feet, 0.002);
    out.terrain = terrain; out.h = terrain; out.kind = 'terrain'; out.normalUp = 1;
    const cols = this.colliders;
    if (cols && cols.length) {
      tangentBasis(up, _e, _n);
      _d.copy(up).negate();
      const off = WALK.radius * 0.72;
      const len = reachUp + reachDown;
      for (let i = 0; i < 5; i++) {
        const ox = i === 1 ? off : i === 2 ? -off : 0, oz = i === 3 ? off : i === 4 ? -off : 0;
        _o.set(feet.x - origin.x, feet.y - origin.y, feet.z - origin.z)
          .addScaledVector(_e, ox).addScaledVector(_n, oz).addScaledVector(up, reachUp);
        const hit = raycastColliders(cols, _o, _d, len, _hit);
        if (!hit) continue;
        const nu = hit.normal.dot(up);
        if (nu < this.cosSlope) continue; // too steep to stand on
        const h = reachUp - hit.distance + (feet.length() - R);
        if (h > out.h) { out.h = h; out.kind = 'collider'; out.normalUp = nu; }
      }
    }
    // hull of a building / megastructure without colliders yet (measured this frame near these feet)
    const hf = this.hull;
    if (hf.valid && hf.h > out.h && hf.at.distanceToSquared(feet) < 0.25) {
      const fh = feet.length() - R;
      if (hf.h <= fh + reachUp && hf.h >= fh - reachDown) { out.h = hf.h; out.kind = 'hull'; out.normalUp = 1; }
    }
    return out;
  }

  /** terrain slope (tan) and uphill direction at the feet */
  terrainSlope(feet, up) {
    const G = this.ctrl.ground;
    tangentBasis(up, _e, _n);
    const h0 = G.walkTerrainAt(feet, 0.002);
    const s = 0.4;
    _t.copy(feet).addScaledVector(_e, s); const hE = G.walkTerrainAt(_t, 0.0005);
    _t.copy(feet).addScaledVector(_n, s); const hN = G.walkTerrainAt(_t, 0.0005);
    const gx = (hE - h0) / s, gz = (hN - h0) / s;
    this.slope.tan = Math.hypot(gx, gz);
    this.slope.dir.copy(_e).multiplyScalar(gx).addScaledVector(_n, gz);
    if (this.slope.tan > 1e-9) this.slope.dir.multiplyScalar(1 / this.slope.tan);
    return this.slope;
  }

  // ------------------------------------------------------------------------------ simulation
  update(dt) {
    const ctrl = this.ctrl, k = ctrl.keys;
    const has = (c) => k.has(c);
    // look
    if (this.look.dx || this.look.dy) {
      if (this.look.locked) this.turn(this.look.dx * 0.0021, -this.look.dy * 0.0021);
      else { const s = (this.rig.vfov(ctrl.aspect()) * DEG) / ctrl.viewport().height; this.turn(-this.look.dx * s, this.look.dy * s); }
      this.look.dx = this.look.dy = 0;
    }
    let fw = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    const rt = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
    if (!fw && Math.abs(this.touchWalk) > 0.05) { fw = Math.sign(this.touchWalk); this.touchWalk -= Math.sign(this.touchWalk) * Math.min(Math.abs(this.touchWalk), WALK.walk * dt); }
    else if (Math.abs(this.touchWalk) <= 0.05) this.touchWalk = 0;
    const run = has('ShiftLeft') || has('ShiftRight');
    if (this.jumpReq > 0) this.jumpReq -= dt;

    this._held = this.ctrl.walkHoldFeet ? this.ctrl.walkHoldFeet() : null;
    this.refreshColliders(false);   // (also keeps the city's 'full' LOD wanted around the walker)
    // held programmatic pose: stand exactly at the requested height until user input (see _freeze)
    if (this._held != null) { this._freeze(); this.writeCamera(); return; }
    this.updateHull();
    _up.copy(this.feet).normalize();
    this.terrainSlope(this.feet, _up);

    // ≤ 6 substeps per frame (≤ 1/60 s each at the 0.1 s dt clamp: 7 cm at a run, well under the
    // capsule radius) so a slow frame does not make the next one slower
    const n = Math.min(6, Math.max(1, Math.ceil(dt / WALK.substep)));
    const h = dt / n;
    _p0.copy(this.feet);
    for (let i = 0; i < n; i++) this.step(h, fw, rt, run);
    this.guardWalls(_p0);

    // deep water (> 0.6 m) is not walkable: return to the last dry position; a walker that started
    // in deep water (no dry position yet) stays on the water surface until reaching land
    const wl = ctrl.ground.waterLevelAt(this.feet, 0.25);
    const feetH = this.feet.length() - R;
    const deep = wl > -1e9 && wl - this.info.terrainH > 0.6 && this.info.groundKind === 'terrain';
    const inWater = deep && feetH < wl - 0.3;
    this.info.inWater = inWater;
    if (inWater) {
      if (this.lastDryValid) this.feet.copy(this.lastDry);
      else { _up.copy(this.feet).normalize(); this.feet.copy(_up).multiplyScalar(R + wl); this.grounded = true; }
      _up.copy(this.feet).normalize();
      const vu = this.vel.dot(_up);
      if (this.lastDryValid) this.vel.copy(_up).multiplyScalar(Math.min(0, vu));
      else this.vel.addScaledVector(_up, -vu);
    } else if (!deep) { this.lastDry.copy(this.feet); this.lastDryValid = true; }
    else if (!this.lastDryValid && feetH <= wl + 0.05) { // floating start: keep the feet on the surface
      _up.copy(this.feet).normalize(); this.feet.copy(_up).multiplyScalar(R + wl); this.grounded = true;
      const vu = this.vel.dot(_up); if (vu < 0) this.vel.addScaledVector(_up, -vu);
    }

    this.eyeOffset *= Math.exp(-dt / 0.09);
    if (Math.abs(this.eyeOffset) < 1e-4) this.eyeOffset = 0;
    this.info.speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    this.writeCamera();
  }

  step(h, fw, rt, run) {
    const up = _up.copy(this.feet).normalize();
    // parallel-transport the view direction onto the current tangent plane
    this.fwdH.addScaledVector(up, -this.fwdH.dot(up)).normalize();
    _r.crossVectors(this.fwdH, up);
    _mv.copy(this.fwdH).multiplyScalar(fw).addScaledVector(_r, rt);
    if (_mv.lengthSq() > 1) _mv.normalize();
    _mv.multiplyScalar(run ? WALK.run : WALK.walk);
    let vv = this.vel.dot(up);
    _vh.copy(this.vel).addScaledVector(up, -vv);
    const acc = this.grounded ? WALK.accGround : WALK.accAir;
    _t.subVectors(_mv, _vh);
    const dl = _t.length(), maxd = acc * h;
    if (dl > maxd) _t.multiplyScalar(maxd / dl);
    _vh.add(_t);
    // terrain steeper than the walkable slope: no uphill progress, slide down
    const onTerrain = this.info.groundKind === 'terrain';
    if (onTerrain && this.slope.tan > this.tanSlope) {
      const c = _vh.dot(this.slope.dir);
      if (c > 0) _vh.addScaledVector(this.slope.dir, -c);
      if (this.grounded) _vh.addScaledVector(this.slope.dir, -WALK.gravity * 0.6 * h);
    }
    // jump / gravity
    if (this.jumpReq > 0 && this.grounded) { vv = WALK.jump; this.grounded = false; this.jumpReq = 0; }
    if (!this.grounded) vv -= WALK.gravity * h;
    else if (vv < 0) vv = 0;
    this.vel.copy(_vh).addScaledVector(up, vv);
    _nf.copy(this.feet).addScaledVector(this.vel, h);

    // capsule vs colliders
    if (this.colliders.length) {
      const u2 = _u.copy(_nf).normalize();
      _a.set(_nf.x - origin.x, _nf.y - origin.y, _nf.z - origin.z).addScaledVector(u2, WALK.step + WALK.radius);
      _b.set(_nf.x - origin.x, _nf.y - origin.y, _nf.z - origin.z).addScaledVector(u2, WALK.height - WALK.radius);
      resolveCapsule(this.colliders, _a, _b, WALK.radius, u2, _info, 3);
      if (_info.hits) {
        const push = _info.push;
        const pv = push.dot(u2);
        if (this.grounded && pv > 0) push.addScaledVector(u2, -pv); // never climb via the capsule
        _nf.add(push);
        const pl = push.length();
        if (pl > 1e-9) {
          _t.copy(push).multiplyScalar(1 / pl);
          const vn = this.vel.dot(_t);
          if (vn < 0) this.vel.addScaledVector(_t, -vn);
        }
        if (pv < -1e-5 && this.vel.dot(u2) > 0) this.vel.addScaledVector(u2, -this.vel.dot(u2)); // head hit
      }
    }

    // ground
    const up2 = _u.copy(_nf).normalize();
    vv = this.vel.dot(up2);
    const reachDown = this.grounded ? WALK.snap : Math.max(0.05, -vv * h + 0.02);
    const g = this.groundAt(_nf, up2, WALK.step + 0.05, reachDown);
    const feetH = _nf.length() - R;
    const wasGrounded = this.grounded;
    if (g.h >= feetH - 1e-4) {
      const dh = g.h - feetH;
      _nf.copy(up2).multiplyScalar(R + g.h);
      if (wasGrounded && g.kind !== 'terrain' && dh > 0.03) this.eyeOffset = clamp(this.eyeOffset - dh, -0.45, 0.45);
      if (vv < 0) this.vel.addScaledVector(up2, -vv);
      this.grounded = true;
    } else if (wasGrounded && vv <= 1e-3 && feetH - g.h <= WALK.snap) {
      const dh = feetH - g.h;
      _nf.copy(up2).multiplyScalar(R + g.h);
      if (g.kind !== 'terrain' && dh > 0.03) this.eyeOffset = clamp(this.eyeOffset + dh, -0.45, 0.45);
      this.grounded = true;
    } else this.grounded = false;
    // never below the terrain surface
    const fh = _nf.length() - R;
    if (fh < g.terrain) { _nf.copy(up2).multiplyScalar(R + g.terrain); if (this.vel.dot(up2) < 0) this.vel.addScaledVector(up2, -this.vel.dot(up2)); this.grounded = true; }
    this.feet.copy(_nf);
    const info = this.info;
    info.grounded = this.grounded; info.groundKind = g.kind; info.groundH = g.h; info.terrainH = g.terrain; info.feetH = this.feet.length() - R;
  }

  /** a collider of building `id` is among the walker's colliders */
  hasCollider(id) {
    const s = String(id), cols = this.colliders;
    for (let i = 0; i < cols.length; i++) if (cols[i].id != null && String(cols[i].id) === s) return true;
    return false;
  }

  /**
   * Buildings whose colliders have not streamed in yet (the city builds the 'full' LOD with
   * interiors and colliders on demand) are still solid: the frame's horizontal move is stopped
   * `radius` before their visible surface (the city's picking geometry, rays at knee and chest
   * height), so the walker never passes through a facade while that LOD loads. Buildings that
   * have colliders are handled by the capsule (doors, stairs) and ignored here.
   */
  guardWalls(p0) {
    const G = this.ctrl.ground;
    const up = _gu.copy(p0).normalize();
    _gm.subVectors(this.feet, p0);
    const dv = _gm.dot(up);
    _gm.addScaledVector(up, -dv);
    const len = _gm.length();
    if (len < 1e-5) return;
    _gd.copy(_gm).multiplyScalar(1 / len);
    let best = Infinity, bestId = null;
    for (let k = 0; k < 2; k++) {
      _go.copy(p0).addScaledVector(up, k === 0 ? 0.45 : 1.25);
      let hit = null;
      try { hit = G.raycast(_go, _gd, { terrain: false, water: false, city: true, mega: false, maxDist: len + WALK.radius }); } catch { hit = null; }
      if (!hit || hit.kind !== 'building') continue;
      const id = hit.raw ? (hit.raw.buildingId ?? hit.raw.id) : null;
      if (id != null && this.hasCollider(id)) continue;
      if (hit.distance < best) { best = hit.distance; bestId = id; }
    }
    if (best === Infinity) return;
    const allow = Math.max(0, best - WALK.radius);
    if (allow >= len) return;
    // tell the UI why the walker stops at this facade (its interior / walk colliders are still loading)
    const now = performance.now();
    if (bestId != null && (String(bestId) !== this._hintId || now - (this._hintT || 0) > 4000)) {
      this._hintId = String(bestId); this._hintT = now;
      try { this.ctrl.app.events?.emit('controls:hint', { kind: 'building-loading', id: bestId }); } catch { /* */ }
    }
    this.feet.copy(p0).addScaledVector(_gd, allow).addScaledVector(up, dv);
    const vn = this.vel.dot(_gd);
    if (vn > 0) this.vel.addScaledVector(_gd, -vn);
    if (this.grounded) {
      const up2 = _gu.copy(this.feet).normalize();
      const g = this.groundAt(this.feet, up2, WALK.step + 0.05, WALK.snap);
      const fh = this.feet.length() - R;
      if (g.h >= fh - WALK.snap && g.h <= fh + WALK.step + 0.05) this.feet.copy(up2).multiplyScalar(R + g.h);
    }
    this.info.wallGuard = (this.info.wallGuard || 0) + 1;
  }

  /** camera = feet + eye height (smoothed on steps), oriented by fwdH + pitch */
  writeCamera() {
    const rig = this.rig;
    _up.copy(this.feet).normalize();
    this.fwdH.addScaledVector(_up, -this.fwdH.dot(_up)).normalize();
    const eyeH = WALK.eye + this.eyeOffset;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _f.copy(this.fwdH).multiplyScalar(cp).addScaledVector(_up, sp);
    _u.copy(this.fwdH).multiplyScalar(-sp).addScaledVector(_up, cp);
    _r.crossVectors(_f, _u).normalize();
    _t.copy(_f).negate();
    _m4.makeBasis(_r, _u, _t);
    _wq.setFromRotationMatrix(_m4);
    // a walker standing still leaves the rig (and its version) untouched: the view converges
    rig.setStateIfChanged(this.feet.x + _up.x * eyeH, this.feet.y + _up.y * eyeH, this.feet.z + _up.z * eyeH, _wq);
  }
}
