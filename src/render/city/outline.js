// Selection outline: a constant-width rim (px) around the silhouette of exactly what is drawn for the
// selected building — its detailed parts (balconies, canopies, railings) when the building is drawn
// detailed, its mass model otherwise. Each frame the building's triangles are rendered into a small
// coverage + depth mask with the frame's camera, through proxy meshes that share the GPU buffers of
// the detail batches / the tile mass geometry (no CPU geometry); a full-screen pass in the scene then
// draws the rim where a pixel lies outside the mask but within the rim width of it, at the depth of the
// nearest covered neighbour, depth-tested against the scene (the rim hides behind nearer objects and
// never fills gaps of the building itself). Hidden when settings.clean or !settings.outlines.
// OWNER: city agent.
import * as THREE from 'three';
import { INFO_STRIDE } from './massBuild.js';

const MASK_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLift;
void main() {
  vec3 p = position;
  p.y += uLift;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const MASK_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float d = gl_FragCoord.z;
  #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  d = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
  #endif
  gl_FragColor = vec4(1.0, d, 0.0, 1.0);
}
`;
const RIM_VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const RIM_FRAG = /* glsl */`
uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uWidth;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOn;
void main() {
  if (uOn < 0.5) discard;          // only in the main view (never in the water's planar reflection / env passes)
  vec2 p = gl_FragCoord.xy;
  if (texture2D(uMask, p / uRes).r > 0.5) discard;
  float dmin = 2.0;
  for (int k = 0; k < 16; k++) {
    float a = float(k) * 0.39269908;
    vec2 dir = vec2(cos(a), sin(a));
    for (int j = 1; j <= 2; j++) {
      vec4 m = texture2D(uMask, (p + dir * uWidth * float(j) * 0.5) / uRes);
      if (m.r > 0.5) dmin = min(dmin, m.g);
    }
  }
  if (dmin > 1.5) discard;
  gl_FragDepth = dmin;
  gl_FragColor = vec4(uColor * uIntensity, 1.0);
}
`;

export class SelectionOutline {
  constructor(city) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'city-outline';
    this.group.matrixAutoUpdate = false;
    this.id = null;
    this.maskMat = new THREE.ShaderMaterial({ vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, side: THREE.DoubleSide, uniforms: { uLift: { value: 0 } } });
    this.maskMat.name = 'city:outline-mask';
    this.maskScene = new THREE.Scene();
    this.maskScene.matrixAutoUpdate = false;
    this.maskRT = null;
    this.proxies = [];           // pooled meshes sharing GPU buffers (never disposed: they share them)
    this.rimMat = new THREE.ShaderMaterial({
      vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, depthWrite: false, depthTest: true, transparent: true,
      uniforms: { uMask: { value: null }, uRes: { value: new THREE.Vector2(1600, 900) }, uWidth: { value: 2.4 }, uColor: { value: new THREE.Color(0.55, 0.9, 1.0) }, uIntensity: { value: 1.0 }, uOn: { value: 1 } },
    });
    this.rimMat.name = 'city:outline';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.rim = new THREE.Mesh(g, this.rimMat);
    this.rim.frustumCulled = false; this.rim.renderOrder = 3; this.rim.name = 'city-outline-rim';
    this.rim.raycast = () => {};   // a clip-space triangle: never a pick target
    this.rim.visible = false;
    // the mask was rendered with the frame's camera: any other camera (water planar reflection, environment
    // captures) would draw a mirrored / misplaced rim — the shader discards there (C6)
    this._cam = null;
    this.rim.onBeforeRender = (renderer, scene, camera) => {
      const on = camera === this._cam ? 1 : 0;
      if (this.rimMat.uniforms.uOn.value !== on) { this.rimMat.uniforms.uOn.value = on; this.rimMat.uniformsNeedUpdate = true; }
    };
    this.group.add(this.rim);
    this._clr = new THREE.Color();
    this._m = new THREE.Matrix4();
  }

  setTarget(id) { this.id = id; }
  refresh() { /* state is rebuilt every frame */ }

  _proxy(k) {
    let m = this.proxies[k];
    if (!m) {
      const g = new THREE.BufferGeometry();
      // GLBufferAttribute geometry: three cannot compute bounds (renderer sorting asks for them)
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e9, -1e9, -1e9), new THREE.Vector3(1e9, 1e9, 1e9));
      m = new THREE.Mesh(g, this.maskMat);
      m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.frustumCulled = false;
      this.proxies[k] = m;
      this.maskScene.add(m);
    }
    m.visible = true;
    return m;
  }
  _setProxy(m, position, index, start, count, matrixWorld) {
    const g = m.geometry;
    if (g.attributes.position !== position) g.attributes.position = position;
    if (g.index !== index) g.index = index;
    g.drawRange.start = start; g.drawRange.count = count;
    m.matrix.copy(matrixWorld); m.matrixWorld.copy(matrixWorld);
  }

  /** fill the proxies with the selected building's drawn triangles; returns false if none */
  _gather() {
    for (const m of this.proxies) m.visible = false;
    const s = this.city.app.state.settings;
    if (!this.id || s.clean || s.outlines === false) return false;
    const city = this.city;
    const rec = city.detail.get(this.id);
    let n = 0;
    this.maskMat.uniforms.uLift.value = 0;
    if (rec && rec.entries.length) {
      const M = city.detail.matrixOf(rec, this._m);
      for (const e of rec.entries) {
        const I = e.batch.inst[e.slot];
        const g = e.batch.geometry;
        if (!I || !g.index) continue;
        this._setProxy(this._proxy(n++), g.attributes.position, g.index, I.iStart, I.iCount, M);
      }
      return n > 0;
    }
    const loc = city._locate(this.id);
    if (!loc || !loc.tile.mesh || !loc.tile.displayed || !loc.tile.group) return false;
    const t = loc.tile, bi = loc.index, g = t.mesh.geometry;
    const k0 = t.info[bi * INFO_STRIDE + 12], kn = t.info[bi * INFO_STRIDE + 13];
    if (!(kn > 0)) return false;
    this.maskMat.uniforms.uLift.value = t.seatOffset ? t.seatOffset(bi) : 0;
    this._setProxy(this._proxy(n++), g.attributes.position, g.index, k0 * 3, kn * 3, t.group.matrixWorld);
    return true;
  }

  /** coverage + depth of the selected building with the frame's camera (skipped for tiled captures) */
  _renderMask(frame, W, H) {
    const app = this.city.app, r = app.renderer, cam = frame.camera || app.camera;
    if (!r || !cam || (cam.view && cam.view.enabled) || !(W > 0 && H > 0)) return false;
    if (!this.maskRT || this.maskRT.width !== W || this.maskRT.height !== H) {
      this.maskRT?.dispose();
      this.maskRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      this.maskRT.texture.name = 'city.outline-mask';
    }
    const prev = r.getRenderTarget(), ca = r.getClearAlpha(), ac = r.autoClear, sm = r.shadowMap.autoUpdate;
    r.getClearColor(this._clr);
    let ok = true;
    try {
      r.shadowMap.autoUpdate = false;
      r.autoClear = true;
      r.setRenderTarget(this.maskRT);
      r.setClearColor(0x000000, 0);
      r.render(this.maskScene, cam);
      this.rimMat.uniforms.uMask.value = this.maskRT.texture;
    } catch (e) {
      ok = false;
    } finally {
      r.setRenderTarget(prev);
      r.setClearColor(this._clr, ca);
      r.autoClear = ac;
      r.shadowMap.autoUpdate = sm;
    }
    return ok;
  }

  update(frame) {
    this._cam = frame.camera || this.city.app.camera;
    const on = this._gather();
    if (!on) { this.rim.visible = false; return; }
    const vp = frame.viewport;
    const app = this.city.app, pipe = app.pipeline, rt = pipe && pipe.sceneRT;
    const W = rt ? rt.width : Math.round(vp.width * (vp.pixelRatio || 1)), H = rt ? rt.height : Math.round(vp.height * (vp.pixelRatio || 1));
    this.rimMat.uniforms.uRes.value.set(W, H);
    this.rimMat.uniforms.uWidth.value = 2.4 * (vp.pixelRatio || 1);
    this.rim.visible = this._renderMask(frame, W, H);
    // brighter at night so it stays readable
    const day = Math.max(0, frame.sunDir.dot(frame.camUp));
    this.rimMat.uniforms.uIntensity.value = day > 0.05 ? 1.2 : 0.06;
  }
}
