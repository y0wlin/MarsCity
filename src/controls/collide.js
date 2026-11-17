// Capsule / sphere / ray queries against three-mesh-bvh colliders supplied by the city (and
// megastructure) systems. OWNER: controls agent.
//
// Collider contract (requested from render/city and megastructures):
//   system.getColliders(nearEcef:{x,y,z}, radius:number) -> Array<{
//       mesh: THREE.Mesh,              // mesh.geometry.boundsTree is a three-mesh-bvh MeshBVH
//       // placement — ONE of (checked in this order):
//       anchor|anchorEcef: {x,y,z},    // ECEF (float64) of the geometry origin, with
//       quaternion: THREE.Quaternion   //   geometry axes -> ECEF axes (e.g. the building frame);
//                                      //   the render matrix is built here for the current origin
//       matrixWorld: THREE.Matrix4,    // geometry-local -> render space for the CURRENT core/origin
//       (none)                         // mesh.matrixWorld (the mesh is in the scene and up to date)
//       id?: string,                   // building id (optional, for diagnostics)
//   }>
// Rigid or uniformly scaled transforms only. All positions passed to these helpers are in render
// space (ECEF − core/origin), the space mesh.matrixWorld maps into. The controls query colliders
// before App moves the origin for the new frame, i.e. with the origin the city used last frame,
// so mesh.matrixWorld written in the city's update() is consistent.
import * as THREE from 'three';
import { origin } from '../core/origin.js';

const _inv = new THREE.Matrix4();
const _rot = new THREE.Matrix3();
const _seg = new THREE.Line3();
const _seg0 = new THREE.Line3();
const _box = new THREE.Box3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _push = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

function bvhOf(c) { return c && c.mesh && c.mesh.geometry && c.mesh.geometry.boundsTree; }

/** geometry-local -> render-space matrix of a collider (see the contract above) */
export function colliderMatrix(c) {
  const a = c.anchor || c.anchorEcef;
  if (a && c.quaternion) {
    let m = c._rm;
    if (!m) { m = c._rm = new THREE.Matrix4(); c._ro = { x: NaN, y: NaN, z: NaN, qx: NaN, qy: NaN, qz: NaN, qw: NaN }; }
    const o = c._ro, q = c.quaternion;
    if (o.x !== origin.x || o.y !== origin.y || o.z !== origin.z || o.qx !== q.x || o.qy !== q.y || o.qz !== q.z || o.qw !== q.w) {
      _tmp.set(a.x - origin.x, a.y - origin.y, a.z - origin.z); // float64 subtraction first
      m.compose(_tmp, q, _one);
      o.x = origin.x; o.y = origin.y; o.z = origin.z; o.qx = q.x; o.qy = q.y; o.qz = q.z; o.qw = q.w;
    }
    return m;
  }
  return c.matrixWorld || c.mesh.matrixWorld;
}

/**
 * Push a capsule (segment a→b, radius r, render space) out of every collider triangle.
 * a and b are modified in place. Returns info:
 *   { push: Vector3 (total displacement), hits, maxUp, minUp } where maxUp/minUp are the largest /
 *   smallest vertical components (dot with `up`) of the contact normals (ground / ceiling hints).
 */
export function resolveCapsule(colliders, a, b, r, up, info, iterations = 3) {
  info.push = info.push || new THREE.Vector3();
  info.push.set(0, 0, 0); info.hits = 0; info.maxUp = -1; info.minUp = 1;
  if (!colliders || !colliders.length) return info;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const bvh = bvhOf(c);
      if (!bvh) continue;
      const m = colliderMatrix(c);
      const s = m.getMaxScaleOnAxis() || 1;
      _inv.copy(m).invert();
      _seg.start.copy(a).applyMatrix4(_inv);
      _seg.end.copy(b).applyMatrix4(_inv);
      _seg0.copy(_seg);
      const rl = r / s;
      _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
      _box.min.addScalar(-rl); _box.max.addScalar(rl);
      let local = 0;
      _rot.setFromMatrix4(m);
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(_seg, _triPt, _capPt);
          if (d < rl) {
            const depth = rl - d;
            if (d > 1e-7) _dir.subVectors(_capPt, _triPt).multiplyScalar(1 / d);
            else { tri.getNormal(_dir); }
            _seg.start.addScaledVector(_dir, depth);
            _seg.end.addScaledVector(_dir, depth);
            local++;
            // contact normal in render space
            _n.copy(_dir).applyMatrix3(_rot).normalize();
            const vu = _n.dot(up);
            if (vu > info.maxUp) info.maxUp = vu;
            if (vu < info.minUp) info.minUp = vu;
          }
          return false;
        },
      });
      if (local) {
        // displacement of the segment start (local) -> render space
        _push.subVectors(_seg.start, _seg0.start).applyMatrix3(_rot);
        a.add(_push); b.add(_push); info.push.add(_push);
        info.hits += local; moved = true;
      }
    }
    if (!moved) break;
  }
  return info;
}

/** Sphere = degenerate capsule. center modified in place. */
const _b2 = new THREE.Vector3();
export function resolveSphere(colliders, center, r, up, info, iterations = 2) {
  _b2.copy(center);
  resolveCapsule(colliders, center, _b2, r, up, info, iterations);
  return info;
}

/**
 * Nearest ray hit against the colliders. origin/dir in render space (dir unit).
 * Returns {distance, point(render), normal(render, facing the ray origin), collider} or null.
 */
export function raycastColliders(colliders, rayOrigin, dir, far = Infinity, out = {}) {
  let best = null;
  if (!colliders) return null;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const bvh = bvhOf(c);
    if (!bvh) continue;
    const m = colliderMatrix(c);
    const s = m.getMaxScaleOnAxis() || 1;
    _inv.copy(m).invert();
    _ray.origin.copy(rayOrigin).applyMatrix4(_inv);
    _ray.direction.copy(dir).transformDirection(_inv);
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far / s);
    if (!hit) continue;
    const dist = hit.distance * s;
    if (dist > far || (best && dist >= best.distance)) continue;
    _rot.setFromMatrix4(m);
    _tmp.copy(hit.face.normal).applyMatrix3(_rot).normalize();
    if (_tmp.dot(dir) > 0) _tmp.negate();
    best = out;
    best.distance = dist;
    best.point = (best.point || new THREE.Vector3()).copy(rayOrigin).addScaledVector(dir, dist);
    best.normal = (best.normal || new THREE.Vector3()).copy(_tmp);
    best.collider = c;
  }
  return best;
}

/** true when the capsule overlaps any collider (no resolution) — used for crouch/stand checks. */
export function capsuleOverlaps(colliders, a, b, r) {
  if (!colliders) return false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const bvh = bvhOf(c);
    if (!bvh) continue;
    const m = colliderMatrix(c);
    const s = m.getMaxScaleOnAxis() || 1;
    _inv.copy(m).invert();
    _seg.start.copy(a).applyMatrix4(_inv);
    _seg.end.copy(b).applyMatrix4(_inv);
    const rl = r / s;
    _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
    _box.min.addScalar(-rl); _box.max.addScalar(rl);
    const hit = bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => tri.closestPointToSegment(_seg, _triPt, _capPt) < rl * 0.98,
    });
    if (hit) return true;
  }
  return false;
}
