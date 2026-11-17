// G01 orbit / regional LOD: the barrier crest as a bright line with a MINIMUM ON-SCREEN WIDTH (QS-09, decision DG).
// OWNER: megastructure agent.
//
// The 11 km caisson arc is physically 1–2 px from the full disc (S01 ≈ 9.6 km/px), and the far LOD chunks are
// hidden once sub-pixel, so the barrier vanished from orbit. This ribbon follows the crest of every caisson
// segment and both rock abutments (the lock gaps and the 560 m mouth stay open: they are real gaps that merge
// on screen once sub-pixel) and is expanded in the vertex shader across the view direction to
//     half width = max(true half width of the crest, 0.5 · uMegaLineMinPx · metres-per-pixel at the vertex)
// so it never falls below ~1.6 px out to orbit. Lit pale concrete by day (patched MeshStandardMaterial, same sun /
// sky / haze as everything else; the harbour basin behind it is tinted by terrain-render, surface.js harbourTint),
// cold-white working-light rows at night (night-gated emissive, dotted every lamp spacing up close, averaged when
// sub-pixel, brighter at the heads / locks). The ribbon is pulled toward the camera by 4e-5 of the distance (+2 m)
// so the log depth never lets the sea or the coast swallow it, and fades out stochastically (converges under the
// pipeline's accumulation) once the real crest is ≥ ~1.6–3.2 px wide, i.e. inside ~20–35 km where the chunk LODs
// carry the barrier — so S09 / S09b / S09c and every close view never see it.
import * as THREE from 'three';
import { SITES, G01_GEO, g01ToUV, g01FromUV } from '../world/sites.js';
import { siteToEcef, siteQuaternion, siteAxes } from './frame.js';

const S = SITES.tidalBarrier;
const A = G01_GEO.arc;
const DEG = Math.PI / 180;

export const ORBIT_LINE_CFG = {
  minPx: 1.6,             // minimum on-screen width (px of the final image)
  fade: [1.6, 3.2],       // fade out while the TRUE crest width grows from 1.6 to 3.2 px
  step: 70,               // sampling along the arc (m)
  albedo: [0.78, 0.785, 0.77],     // the wave-wall coping + deck read as one bright (white) line
  abutAlbedo: [0.56, 0.54, 0.5],
  emissive: 0xd6e4ff,     // cold white (harbour working light, decision DN)
  emissiveIntensity: 2.4, // lighting unit: 1.0 = one lit window; heads / locks ×1.6, plain caissons ×0.7
  lampSpacing: 96,        // m between the deck lamp heads (dotted up close)
  bias: 4e-5,             // camera-ward pull (fraction of the distance)
};

const thOfXZ = (x, z) => { const uv = g01ToUV(x, z, {}); return Math.atan2(uv.u, uv.v - A.cv); };
const xzOf = (th, off = 0) => { const r = A.r + off; return g01FromUV(r * Math.sin(th), A.cv + r * Math.cos(th)); };

/** crest pieces along the arc: caisson segments + abutments, [{th0, th1, half, crest, kind, weightA, weightB}] */
function crestPieces() {
  const out = [];
  for (const sg of S.segments) {
    const ta = thOfXZ(sg.a[0], sg.a[1]), tb = thOfXZ(sg.b[0], sg.b[1]);
    out.push({ id: sg.id, th0: Math.min(ta, tb), th1: Math.max(ta, tb), half: sg.width / 2, crest: sg.crest, kind: sg.kind });
  }
  return out.sort((a, b) => a.th0 - b.th0);
}

/** ribbon geometry in the site axes, relative to the site anchor (sea level at the arc centre) */
export function buildOrbitLineGeometry(cfg = ORBIT_LINE_CFG) {
  const anchor = siteToEcef(S, 0, 0, 0, {});
  const ax = siteAxes(S);
  const pos = [], nor = [], col = [], uv = [], line = [], idx = [];
  const P = {}, P2 = {};
  const toSite = (p, out) => {
    const dx = p.x - anchor.x, dy = p.y - anchor.y, dz = p.z - anchor.z;
    out[0] = dx * ax.east[0] + dy * ax.east[1] + dz * ax.east[2];
    out[1] = dx * ax.up[0] + dy * ax.up[1] + dz * ax.up[2];
    out[2] = dx * ax.south[0] + dy * ax.south[1] + dz * ax.south[2];
    return out;
  };
  const dirSite = (v, out) => {
    out[0] = v[0] * ax.east[0] + v[1] * ax.east[1] + v[2] * ax.east[2];
    out[1] = v[0] * ax.up[0] + v[1] * ax.up[1] + v[2] * ax.up[2];
    out[2] = v[0] * ax.south[0] + v[1] * ax.south[1] + v[2] * ax.south[2];
    return out;
  };
  const a = [0, 0, 0], b = [0, 0, 0], n = [0, 0, 0];
  const pieces = crestPieces();
  for (const pc of pieces) {
    const len = (pc.th1 - pc.th0) * A.r;
    const ns = Math.max(2, Math.ceil(len / cfg.step));
    const y = pc.crest + 3.0;                               // wave-wall coping height
    const alb = pc.kind === 'abutment' ? cfg.abutAlbedo : cfg.albedo;
    const base = pos.length / 3;
    for (let i = 0; i <= ns; i++) {
      const th = pc.th0 + ((pc.th1 - pc.th0) * i) / ns;
      const [x, z] = xzOf(th, 0);
      const [x2, z2] = xzOf(th + 1e-4, 0);
      siteToEcef(S, x, y, z, P); siteToEcef(S, x2, y, z2, P2);
      toSite(P, a); toSite(P2, b);
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const rl = Math.hypot(P.x, P.y, P.z);
      dirSite([P.x / rl, P.y / rl, P.z / rl], n);
      // station along the whole barrier (m): drives the lamp dots; head weight: brighter within 60 m of the piece
      // ends (head complexes, lock heads, mouth heads with towers) than along the plain caissons
      const s = (th - pieces[0].th0) * A.r;
      const dEnd = Math.min(th - pc.th0, pc.th1 - th) * A.r;
      const w = pc.kind === 'abutment' ? 0.35 : 0.7 + 0.9 * (1 - smooth01((dEnd - 30) / 60));
      for (const side of [-1, 1]) {
        pos.push(a[0], a[1], a[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(alb[0], alb[1], alb[2]);
        uv.push(s, w);
        line.push(tx, ty, tz, side * pc.half);
      }
    }
    for (let i = 0; i < ns; i++) {
      const v = base + i * 2;
      // the expansion side is cross(tangent, toward-camera): side +1 is always screen-right of the tangent's
      // screen direction rotated −90°, so this order is CCW (front-facing) from every view direction
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aMegaLine', new THREE.Float32BufferAttribute(line, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += 20000;          // the screen-space expansion grows with the distance
  return { geometry: g, anchor };
}
function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

const LINE_VERT_PARS = /* glsl */`
attribute vec4 aMegaLine;
uniform float uMegaPxAng;
uniform float uMegaLineMinPx;
uniform vec2 uMegaLineFade;
uniform float uMegaLineBias;
varying float vMegaLineFade;
varying vec2 vMegaLineUv;
varying float vMegaLineMpp;
`;
// runs before <project_vertex>: the expansion is applied to `transformed` (object space; the model matrix is a
// pure rotation + translation) so worldpos / view position / log depth downstream all see the drawn vertex
const LINE_VERT_EXPAND = /* glsl */`
{
  vec4 megaLw = modelMatrix * vec4( transformed, 1.0 );
  vec3 megaTw = normalize( mat3( modelMatrix ) * aMegaLine.xyz );
  vec3 megaToC = cameraPosition - megaLw.xyz;
  float megaD = max( length( megaToC ), 1.0 );
  vec3 megaV = megaToC / megaD;
  vec3 megaSide = cross( megaTw, megaV );
  float megaSl = length( megaSide );
  megaSide = megaSl > 1e-4 ? megaSide / megaSl : normalize( cross( megaTw, normalize( megaLw.xyz - uMegaPC ) ) );
  float megaMpp = megaD * uMegaPxAng;                       // metres per pixel at this vertex
  float megaHt = abs( aMegaLine.w );
  float megaHw = max( megaHt, 0.5 * uMegaLineMinPx * megaMpp );
  vec3 megaOff = megaSide * sign( aMegaLine.w ) * megaHw + megaV * ( megaD * uMegaLineBias + 2.0 );
  transformed += transpose( mat3( modelMatrix ) ) * megaOff;
  vMegaLineFade = 1.0 - smoothstep( uMegaLineFade.x, uMegaLineFade.y, 2.0 * megaHt / megaMpp );
  vMegaLineUv = uv;
  vMegaLineMpp = megaMpp;
}
`;
const LINE_FRAG_PARS = /* glsl */`
uniform float uMegaTime;
uniform float uMegaLampSpacing;
varying float vMegaLineFade;
varying vec2 vMegaLineUv;
varying float vMegaLineMpp;
float megaLineHash( vec2 p ) { p = fract( p * vec2( 443.897, 441.423 ) ); p += dot( p, p.yx + 19.19 ); return fract( ( p.x + p.y ) * p.x ); }
`;
const LINE_FRAG_FADE = /* glsl */`
if ( vMegaLineFade < 0.999 && megaLineHash( gl_FragCoord.xy + fract( uMegaTime * 7.31 ) * 173.0 ) > vMegaLineFade ) discard;
`;
const LINE_FRAG_EMISSIVE = /* glsl */`
{
  // lamp heads every uMegaLampSpacing m along the crest (short bright dots), averaged once a spacing is sub-pixel
  float megaPh = fract( vMegaLineUv.x / uMegaLampSpacing );
  float megaDot = 1.0 - smoothstep( 0.06, 0.16, abs( megaPh - 0.5 ) );
  float megaAvg = smoothstep( 0.25, 0.9, vMegaLineMpp / uMegaLampSpacing );
  float megaRow = mix( 0.25 + 2.6 * megaDot, 1.0, megaAvg );
  totalEmissiveRadiance *= megaRow * vMegaLineUv.y;
}
`;

/** the ribbon object + its material (patched by the planet lighting) */
export class G01OrbitLine {
  constructor(app, cfg = ORBIT_LINE_CFG) {
    this.app = app;
    this.cfg = cfg;
    const { geometry, anchor } = buildOrbitLineGeometry(cfg);
    this.anchor = anchor;
    this.uniforms = {
      uMegaPxAng: { value: 1 / 1400 },
      uMegaLineMinPx: { value: cfg.minPx },
      uMegaLineFade: { value: new THREE.Vector2(cfg.fade[0], cfg.fade[1]) },
      uMegaLineBias: { value: cfg.bias },
      uMegaLampSpacing: { value: cfg.lampSpacing },
    };
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0,
      emissive: new THREE.Color(cfg.emissive), emissiveIntensity: cfg.emissiveIntensity,
    });
    m.name = 'mega_orbitline';
    this.shared = null;          // shared mega uniforms (uMegaPC, uMegaTime) set by attach()
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms, { uMegaPC: this.shared.uMegaPC, uMegaTime: this.shared.uMegaTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uMegaPC;\n' + LINE_VERT_PARS)
        .replace('#include <project_vertex>', LINE_VERT_EXPAND + '\n#include <project_vertex>');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + LINE_FRAG_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + LINE_FRAG_FADE)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + LINE_FRAG_EMISSIVE);
    };
    m.customProgramCacheKey = () => 'mega-orbitline-v1';
    this.material = m;
    const mesh = new THREE.Mesh(geometry, m);
    mesh.name = 'mega:G01-orbit-line';
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.quaternion.set(...siteQuaternion(S));
    mesh.userData.megaOrbitLine = true;
    this.mesh = mesh;
  }
  /** hook into the system: shared uniforms + lighting patch + scene root */
  attach(root, mats) {
    this.shared = mats.uniforms;
    try { this.app.lighting?.patch?.(this.material, { nightEmissive: true, receiveCloudShadow: true }); } catch (e) { console.warn('[mega] orbit line patch failed', e); }
    root.add(this.mesh);
  }
  update(frame, origin) {
    const vp = frame.viewport || { height: 900, pixelRatio: 1 };
    const fov = (frame.camera?.fov || 35) * DEG;
    const H = this.app.pipeline?.pixelHeight || vp.height * (vp.pixelRatio || 1);
    this.uniforms.uMegaPxAng.value = (2 * Math.tan(fov / 2)) / Math.max(1, H);
    const a = this.anchor;
    // hidden while the camera is close (the chunk LODs carry the barrier; the shader fade has already removed it)
    const d = Math.hypot(a.x - frame.camEcef.x, a.y - frame.camEcef.y, a.z - frame.camEcef.z);
    this.mesh.visible = d > 9000;
    this.mesh.position.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}
