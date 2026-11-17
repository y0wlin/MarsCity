// Ship wakes on the water surface (API for the props system). OWNER: water agent.
//
//   water.addWake(id, points, {width = 12, strength = 1, level = 0})
//     points: ship track in ECEF metres, NEWEST FIRST (points[0] = stern now), [{x,y,z}] or [[x,y,z]]
//     width: beam of the vessel (m); level: water surface height (m above sea level, 0 = sea)
//   water.removeWake(id)
// Each wake is a ribbon on the water plane, limited to the part of the track a wake is visible on
// (≈ 45 beams + 100 m): a turbulent white centre that widens (≈ 5° spread) and clears behind the stern, a
// wider trail of bubbles (lighter milky-turquoise water, ≈ 8.5° spread) and the two Kelvin arms (19.5° half
// angle: breaking crests near the stern, frayed crest lines with echelon feathers further back) fading out
// after ~25–40 beams, so the wake visibly widens behind the boat even from a low camera (fix round 2, W5). Side vectors are smoothed along the track and the ribbon edges never run backwards,
// so a track that turns (route waypoints) never folds the ribbon into a polygon; a track that jumps (a step
// longer than max(80 m, 8 beams) between two samples) is cut at the jump. The ribbon is a
// patched MeshStandardMaterial (lit like the surface foam), depth-tested, no depth write, animated
// with the water clock (frozen while the view is still, like the surface waves).
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { origin } from '../../core/origin.js';

const KELVIN = Math.tan(19.5 * Math.PI / 180);
const ARM_BEAMS = 26;       // Kelvin arms fade out within ~ARM_BEAMS beams behind the stern
const LEN_BEAMS = 45;       // ribbon length ≈ LEN_BEAMS beams + 100 m

const FRAG_PARS = /* glsl */`
varying vec2 vWkUv;     // x: across (-1..1 of the half width), y: distance behind the stern (m)
uniform float uWkLen;
uniform float uWkWidth;
uniform float uWkStrength;
uniform float uWkTime;
uniform float uWkArmLen;
float wkHash( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1030 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }
float wkNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wkHash( i ), wkHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wkHash( i + vec2( 0.0, 1.0 ) ), wkHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
`;
const FRAG_MAP = /* glsl */`
{
  float s = max( vWkUv.y, 0.0 );
  float B = uWkWidth;
  float hw = B * 0.5 + min( s, uWkArmLen ) * ${KELVIN.toFixed(4)};   // arm half width (geometry adds 2 m + 3 arm widths)
  float x = vWkUv.x * hw;                              // metres across
  float t = s / max( uWkLen, 1.0 );
  float px = max( length( fwidth( vec2( x, s ) ) ), 1e-3 );   // metres per pixel
  // Fix round 2 (W5, §5 05 逐渐展宽的尾迹): every part of the wake visibly widens behind the boat.
  // turbulent centre (propeller wash + hull wake): the beam at the stern, spreading to ~2.5 beams 20 beams back
  float cw = B * 0.5 + 0.09 * s + px;
  float centre = exp( - ( x * x ) / ( cw * cw ) * 1.6 ) * exp( - s / ( 17.0 * B ) );
  // bubble trail: lighter milky-turquoise band, wider and longer than the white water (the widening band that reads
  // from a low camera too)
  float bw = B * 0.8 + 0.15 * s + px;
  float bub = exp( - ( x * x ) / ( bw * bw ) ) * exp( - s / ( 34.0 * B ) );
  // Kelvin arms (cusp lines of the divergent waves, 19.5°): breaking crests near the stern, then frayed whitish crest
  // lines that keep the widening V readable far behind the boat
  float aw = 1.2 + 0.02 * s + 0.06 * B + px;
  float ao = abs( x ) - hw * 0.96;
  float arm = exp( - ( ao * ao ) / ( aw * aw ) ) * exp( - s / ( 22.0 * B ) ) * smoothstep( 0.0, 1.2 * B, s );
  // feathers: short divergent crests trailing inwards from the arms (echelon), fading towards the centre
  float fe = 0.5 + 0.5 * sin( ( s * 0.94 - abs( x ) * 0.34 ) * 6.2831853 / max( 0.9 * B, 4.0 ) );
  float feather = smoothstep( 0.55, 0.95, fe ) * smoothstep( hw * 0.35, hw * 0.92, abs( x ) ) * ( 1.0 - smoothstep( hw * 0.96, hw * 1.02, abs( x ) ) )
    * exp( - s / ( 14.0 * B ) ) * smoothstep( 0.5 * B, 2.0 * B, s ) * smoothstep( 6.0, 1.5, px / max( 0.9 * B, 4.0 ) * 6.0 );
  // broken foam pattern (screen filtered: averages to its mean when sub-pixel)
  float fq = smoothstep( 4.0, 0.6, px );
  float n1 = wkNoise( vec2( x * 0.35, s * 0.12 - uWkTime * 0.25 ) );
  float n2 = wkNoise( vec2( x * 1.6, s * 0.75 + uWkTime * 0.4 ) + 17.0 );
  float n3 = wkNoise( vec2( ( abs( x ) - hw ) * 0.5, s * 0.05 ) + 41.0 );
  float n = mix( 0.5, n1 * 0.6 + n2 * 0.4, fq );
  float white = centre * smoothstep( 0.12, 0.7, n * 0.85 + centre * 0.45 );
  white += arm * ( 0.75 * smoothstep( 0.25, 0.7, mix( 0.5, n3 * 0.6 + n2 * 0.4, fq ) ) + 0.12 );
  white += feather * 0.22 * smoothstep( 0.3, 0.7, n );
  white = clamp( white * uWkStrength, 0.0, 1.0 );
  float fade = smoothstep( 1.0, 0.72, t ) * smoothstep( -1.0, 3.0, s );
  white *= fade; bub *= fade * uWkStrength;
  float a = clamp( max( white, bub * 0.30 ), 0.0, 1.0 );
  vec3 col = mix( vec3( 0.20, 0.44, 0.45 ), vec3( 0.84, 0.85, 0.84 ), clamp( white / max( a, 1e-4 ), 0.0, 1.0 ) );
  diffuseColor = vec4( col, a * 0.92 );
}
`;

const WAKE_LOGDEPTH = /* glsl */`
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( max( vFragDepth * ( 1.0 - 3.5e-4 ), 1.0 ) ) * logDepthBufFC * 0.5;
#endif
`;

export class WakeLayer {
  constructor(app, water) {
    this.app = app;
    this.water = water;
    this.group = new THREE.Group();
    this.group.name = 'water.wakes';
    this.group.matrixAutoUpdate = false;
    this.wakes = new Map();
  }

  add(id, points, opts = {}) {
    if (!points || points.length < 2) { this.remove(id); return false; }
    const P0 = points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p));
    const width = Math.max(1, opts.width ?? 12), level = opts.level ?? 0, strength = opts.strength ?? 1;
    // ---- track: cumulative distance, limited to the visible wake length; a track that jumps (a step
    // longer than any vessel covers between two samples) is cut there, so a broken track never turns into
    // a huge ribbon polygon
    const maxLen = LEN_BEAMS * width + 100;
    const maxStep = Math.max(80, 8 * width);
    const P = [P0[0]], S = [0];
    for (let i = 1; i < P0.length; i++) {
      const p = P0[i], q = P0[i - 1];
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (!(d < maxStep)) break;
      if (d < 1e-3) continue;
      const s = S[S.length - 1] + d;
      if (s > maxLen) {
        const f = (maxLen - S[S.length - 1]) / d;
        if (f > 0.05) { P.push({ x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f, z: q.z + (p.z - q.z) * f }); S.push(maxLen); }
        break;
      }
      P.push(p); S.push(s);
    }
    const n = P.length;
    if (n < 2) { this.remove(id); return false; }
    let w = this.wakes.get(id);
    if (!w) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, transparent: true, depthWrite: false });
      mat.name = 'water.wake';
      const u = { uWkLen: { value: 100 }, uWkWidth: { value: width }, uWkStrength: { value: strength }, uWkTime: { value: 0 }, uWkArmLen: { value: ARM_BEAMS * width } };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aWkUv;\nvarying vec2 vWkUv;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWkUv = aWkUv;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
          .replace('#include <map_fragment>', FRAG_MAP)
          // in front of the (camera-biased) water surface: pull 3.5e-4 of the distance towards the eye
          .replace('#include <logdepthbuf_fragment>', WAKE_LOGDEPTH);
      };
      mat.customProgramCacheKey = () => 'water-wake-v4';
      try { this.app.lighting?.patch?.(mat, { receiveCloudShadow: true }); } catch { /* optional */ }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      w = { mesh, mat, u, anchor: { x: 0, y: 0, z: 0 } };
      this.wakes.set(id, w);
    }
    const armLen = ARM_BEAMS * width;
    w.u.uWkWidth.value = width; w.u.uWkStrength.value = strength; w.u.uWkArmLen.value = armLen;
    // ---- ribbon geometry relative to the stern point, on the water surface
    const a = P[0];
    const ar = Math.hypot(a.x, a.y, a.z) || 1;
    w.anchor = { x: a.x / ar * (R + level), y: a.y / ar * (R + level), z: a.z / ar * (R + level) };
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nrm = new Float32Array(n * 2 * 3);
    const rr = R + level + 0.04;
    const U = new Float64Array(n * 3), Q = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = P[i], pr = Math.hypot(p.x, p.y, p.z) || 1;
      U[i * 3] = p.x / pr; U[i * 3 + 1] = p.y / pr; U[i * 3 + 2] = p.z / pr;
      Q[i * 3] = U[i * 3] * rr; Q[i * 3 + 1] = U[i * 3 + 1] * rr; Q[i * 3 + 2] = U[i * 3 + 2] * rr;
    }
    // point on the track at distance s (linear between samples)
    const at = (s, out) => {
      if (s <= 0) { out[0] = Q[0]; out[1] = Q[1]; out[2] = Q[2]; return; }
      let k = 1;
      while (k < n - 1 && S[k] < s) k++;
      const s0 = S[k - 1], s1 = S[k], f = Math.min(1, Math.max(0, (s - s0) / Math.max(s1 - s0, 1e-6)));
      for (let c = 0; c < 3; c++) out[c] = Q[(k - 1) * 3 + c] + (Q[k * 3 + c] - Q[(k - 1) * 3 + c]) * f;
    };
    const ta = [0, 0, 0], tb = [0, 0, 0];
    const prev = [null, null];
    const total = S[n - 1];
    for (let i = 0; i < n; i++) {
      const s = S[i];
      const ux = U[i * 3], uy = U[i * 3 + 1], uz = U[i * 3 + 2];
      const px = Q[i * 3], py = Q[i * 3 + 1], pz = Q[i * 3 + 2];
      // shader half width (arm line at 0.96·hwS) + 2 m + three arm widths, so the arm / bubble profiles fade out before
      // the ribbon edge (no straight cut along the wake's outer edges)
      const hwS = width * 0.5 + Math.min(s, armLen) * KELVIN;
      const hw = hwS + 2 + 3 * (1.2 + 0.02 * s + 0.06 * width);
      // tangent smoothed over a window that grows with the ribbon half width (no folding at turns)
      const win = Math.max(4, 0.7 * hw);
      at(Math.max(0, s - win), ta); at(Math.min(total, s + win), tb);
      let tx = tb[0] - ta[0], ty = tb[1] - ta[1], tz = tb[2] - ta[2];
      // side = up × tangent
      let sx = uy * tz - uz * ty, sy = uz * tx - ux * tz, sz = ux * ty - uy * tx;
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      for (let k = 0; k < 2; k++) {
        const sg = k === 0 ? -1 : 1, o = i * 2 + k;
        let qx = px + sx * hw * sg, qy = py + sy * hw * sg, qz = pz + sz * hw * sg;
        // the edge must keep moving away from the stern (tangent points to older samples)
        const pv = prev[k];
        if (pv) {
          const adv = (qx - pv[0]) * tx + (qy - pv[1]) * ty + (qz - pv[2]) * tz;
          const minAdv = 0.15 * (s - S[i - 1]);
          if (adv < minAdv) { const d = minAdv - adv; qx += tx * d; qy += ty * d; qz += tz * d; }
        }
        prev[k] = [qx, qy, qz];
        pos[o * 3] = qx - w.anchor.x; pos[o * 3 + 1] = qy - w.anchor.y; pos[o * 3 + 2] = qz - w.anchor.z;
        uv[o * 2] = sg * (hw / Math.max(hwS, 1e-3)); uv[o * 2 + 1] = s;
        nrm[o * 3] = ux; nrm[o * 3 + 1] = uy; nrm[o * 3 + 2] = uz;
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a0 = i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3; idx.push(a0, a1, b0, b0, a1, b1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aWkUv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    w.mesh.geometry.dispose();
    w.mesh.geometry = g;
    w.u.uWkLen.value = Math.max(1, total);
    return true;
  }

  remove(id) {
    const w = this.wakes.get(id);
    if (!w) return false;
    this.group.remove(w.mesh); w.mesh.geometry.dispose(); w.mat.dispose();
    this.wakes.delete(id);
    return true;
  }

  update() {
    const t = (this.water?.time || 0) % 4096;
    for (const w of this.wakes.values()) {
      w.mesh.position.set(w.anchor.x - origin.x, w.anchor.y - origin.y, w.anchor.z - origin.z);
      w.mesh.updateMatrix(); w.mesh.updateMatrixWorld();
      w.u.uWkTime.value = t;
    }
  }

  dispose() { for (const id of [...this.wakes.keys()]) this.remove(id); }
}
