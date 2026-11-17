// Floating render origin (prompt §4: 以观察者为原点). The camera always sits at render-space
// (0,0,0); every planet-anchored object is placed at (ecef - origin) each frame, computed in
// float64 and only then narrowed to float32. Read `origin` anywhere; only App writes it.

export const origin = { x: 0, y: 0, z: 0 };

export function setOrigin(x, y, z) { origin.x = x; origin.y = y; origin.z = z; }

/** Write (ecef - origin) into a THREE.Vector3-like target. */
export function toRender(ecef, target) {
  target.x = ecef.x - origin.x; target.y = ecef.y - origin.y; target.z = ecef.z - origin.z;
  return target;
}

/** Same with raw numbers. */
export function toRenderXYZ(x, y, z, target) {
  target.x = x - origin.x; target.y = y - origin.y; target.z = z - origin.z;
  return target;
}

/** render-space -> ECEF (float64) */
export function toEcef(v, out = {}) {
  out.x = v.x + origin.x; out.y = v.y + origin.y; out.z = v.z + origin.z;
  return out;
}
