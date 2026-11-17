// Spray / mist below the discharging G02 spillway bays (泄流口白沫 + spray). OWNER: water agent.
//
// Every open bay gets a cluster of translucent spray streaks rising from the hydraulic jump at the chute
// outlet and drifting downstream while they fade (closed bays get none: 停用闸孔下方的水比泄流口平静). Each
// streak is a billboard stretched along the screen-space direction of its motion (drift + rise) with a
// streaky noise texture, so the mist reads as torn spray, not as round cotton balls.
// One InstancedMesh (patched MeshStandardMaterial: lit by the sun / sky like the foam, dark at night,
// cloud shadows, aerial perspective from the pipeline only where it writes no depth -> kept faint),
// placed in the G02 site's local tangent frame, animated with the water clock. Visible within ~9 km.
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { SITES, localToUnit } from '../../world/sites.js';
import { hash4 } from '../../core/hash.js';
import { g02Outlets, g02Version } from './tiles.js';

const PUFFS = 22;            // per open bay
const VERT_PARS = /* glsl */`
attribute vec4 aSpray;       // phase, size (m), rise (m), seed
uniform float uSpTime;
varying vec2 vSpUv;
varying float vSpA;
varying float vSpSeed;
`;
const VERT_PROJECT = /* glsl */`
float spT = fract( uSpTime * ( 0.055 + 0.03 * fract( aSpray.w * 7.31 ) ) + aSpray.x );
vec3 spC = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
// downstream unit is stored in the instance matrix X column (scaled by the drift length)
vec3 spDrift = ( instanceMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz;
spC += spDrift * spT + vec3( 0.0, aSpray.z * ( 0.15 + 0.85 * sqrt( spT ) ), 0.0 );
float spSize = aSpray.y * ( 0.45 + 0.9 * spT );
// motion direction (drift + rise) on screen: the streak's long axis
vec3 spVel = spDrift + vec3( 0.0, aSpray.z * 0.45, 0.0 );
vec2 spAx = ( modelViewMatrix * vec4( spVel, 0.0 ) ).xy;
spAx = length( spAx ) > 1e-4 ? normalize( spAx ) : vec2( 1.0, 0.0 );
vec2 spAy = vec2( - spAx.y, spAx.x );
float spStretch = 2.4 + 1.6 * fract( aSpray.w * 3.17 );
vec2 spQ = spAx * ( position.x * spSize * spStretch ) + spAy * ( position.y * spSize * 0.55 );
vec4 mvPosition = modelViewMatrix * vec4( spC, 1.0 ) + vec4( spQ, 0.0, 0.0 );
gl_Position = projectionMatrix * mvPosition;
vSpUv = position.xy + 0.5;
vSpA = smoothstep( 0.0, 0.18, spT ) * ( 1.0 - smoothstep( 0.55, 1.0, spT ) );
vSpSeed = aSpray.w;
transformed = spC;
`;
const FRAG_PARS = /* glsl */`
uniform float uSpOpacity;
varying vec2 vSpUv;
varying float vSpA;
varying float vSpSeed;
float spHash( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1030 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }
float spNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( spHash( i ), spHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( spHash( i + vec2( 0.0, 1.0 ) ), spHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
`;
const FRAG_MAP = /* glsl */`
{
  vec2 d = vSpUv - 0.5;
  float r = length( d * vec2( 2.0, 2.0 ) );
  // streaks along the long (motion) axis: noise stretched along x, fine across
  float n = spNoise( vec2( vSpUv.x * 2.5, vSpUv.y * 11.0 ) + vSpSeed * 37.0 ) * 0.65 + spNoise( vec2( vSpUv.x * 5.0, vSpUv.y * 23.0 ) - vSpSeed * 13.0 ) * 0.35;
  float streak = smoothstep( 0.35, 0.85, n );
  float a = ( 1.0 - smoothstep( 0.2, 1.0, r ) ) * ( 0.15 + 0.85 * streak ) * vSpA * uSpOpacity;
  if ( a < 0.003 ) discard;
  diffuseColor = vec4( 0.93, 0.95, 0.96, clamp( a, 0.0, 1.0 ) );
}
`;

/**
 * The spray streak material (shared with the canal sluice jets, sluicejet.js): InstancedMesh of PlaneGeometry(1, 1) with
 * the instanced attribute aSpray (phase, size m, rise m, seed) and instance matrices whose X column is the drift vector
 * (downstream × drift length) and translation the start point. u = { uSpTime, uSpOpacity }.
 */
export function createSprayMaterial(app, u, name = 'water.spray') {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.name = name;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( 1.0, 0.0, 0.0 );\n#endif')
      .replace('#include <project_vertex>', VERT_PROJECT)
      // world position for shadows / lighting: the puff centre
      .replace('#include <worldpos_vertex>', '#if defined( USE_SHADOWMAP ) || defined( USE_ENVMAP ) || defined( DISTANCE ) || defined( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0\nvec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP);
  };
  mat.customProgramCacheKey = () => 'water-spray-v2';
  try { app.lighting?.patch?.(mat, { receiveCloudShadow: true }); } catch { /* optional */ }
  return mat;
}

export class SprayLayer {
  constructor(app, water) {
    this.app = app;
    this.water = water;
    this.group = new THREE.Group();
    this.group.name = 'water.spray';
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.mesh = null;
    this.version = null;
    this.u = { uSpTime: { value: 0 }, uSpOpacity: { value: 0.3 } };
    const S = SITES.waterStairs;
    // site frame: x east, y up, z south (localToUnit convention), anchored at the site centre, sea level
    const c = localToUnit(S, 0, 0, {});
    this.anchor = { x: c.x * R, y: c.y * R, z: c.z * R };
    const la = S.lat * Math.PI / 180, lo = S.lon * Math.PI / 180;
    const east = new THREE.Vector3(Math.cos(lo), 0, -Math.sin(lo));
    const up = new THREE.Vector3(c.x, c.y, c.z);
    const north = new THREE.Vector3(-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo));
    const south = north.clone().negate();
    this.quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, south));
    this.site = S;
  }

  _build() {
    this.version = g02Version();
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    const S = this.site;
    const outlets = g02Outlets().filter((o) => o.open);
    if (!outlets.length) return;
    const count = outlets.length * PUFFS;
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSpray = new Float32Array(count * 4);
    const mat = createSprayMaterial(this.app, this.u);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = 'water.spray';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    const m4 = new THREE.Matrix4();
    let k = 0;
    const a = new THREE.Vector3();
    for (const o of outlets) {
      // outlet position in the site frame (x east, y up, z south): localToUnit -> back to the tangent frame
      const uo = localToUnit(S, o.x, o.z, {});
      const p = new THREE.Vector3(uo.x * (R + o.level) - this.anchor.x, uo.y * (R + o.level) - this.anchor.y, uo.z * (R + o.level) - this.anchor.z);
      p.applyQuaternion(this.quat.clone().invert());
      for (let j = 0; j < PUFFS; j++) {
        const h = (q) => hash4(o.dam, Math.round(o.x), j, q) / 4294967296;
        const along = 4 + h(1) * 26, across = (h(2) - 0.5) * 12;
        // downstream (dx, dz) in the site frame: x east, z south
        const ox = o.dx * along - o.dz * across, oz = o.dz * along + o.dx * across;
        a.set(p.x + ox, p.y + 1.0 + h(3) * 3.0, p.z + oz);
        const driftL = 18 + h(4) * 30;
        m4.set(
          o.dx * driftL, 0, 0, a.x,
          0, 1, 0, a.y,
          o.dz * driftL, 0, 1, a.z,
          0, 0, 0, 1,
        );
        mesh.setMatrixAt(k, m4);
        const f = 0.6 + 0.4 * (o.flow || 1);
        aSpray[k * 4] = h(5); aSpray[k * 4 + 1] = (5 + h(6) * 10) * f; aSpray[k * 4 + 2] = (6 + h(7) * 16) * f; aSpray[k * 4 + 3] = h(8);
        k++;
      }
    }
    geo.setAttribute('aSpray', new THREE.InstancedBufferAttribute(aSpray, 4));
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.mesh = mesh;
  }

  update(frame) {
    const cam = frame.camEcef;
    const d = Math.hypot(cam.x - this.anchor.x, cam.y - this.anchor.y, cam.z - this.anchor.z);
    const on = d < this.site.radius + 9000 && !(frame.settings?.debugLayer && frame.settings.debugLayer !== 'none' && !frame.settings.clean && frame.settings.debugLayer !== 'emission');
    this.group.visible = on;
    if (!on) return;
    if (this.version !== g02Version() || (!this.mesh && this.version === null)) this._build();
    this.group.position.set(this.anchor.x - origin.x, this.anchor.y - origin.y, this.anchor.z - origin.z);
    this.group.quaternion.copy(this.quat);
    this.group.updateMatrix();
    this.group.updateMatrixWorld(true);
    this.u.uSpTime.value = (this.water?.time || 0) % 4096;
  }

  dispose() {
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
  }
}
