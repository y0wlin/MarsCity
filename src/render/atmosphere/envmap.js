// Sky environment map for specular reflections (scene.environment). OWNER: atmosphere agent.
// The sky (single + multiple scattering), the cloud layer (coarse march with the same density and
// lighting functions as the rendered clouds) and the lit red ground below the horizon are rendered
// into a cubemap at the camera's location and prefiltered with PMREM. One cube face is rendered per
// frame (a refresh never stalls a frame); the finished cube replaces the previous one. Patched
// materials scale the reflection per fragment by the local sky brightness (uLpEnvRef), so the same
// environment stays plausible on the dusk / night side seen from orbit.
import * as THREE from 'three';
import { atmosphereDefines } from './model.js';
import { GLSL_MATH, GLSL_HASH } from '../shaders/common.glsl.js';
import { GLSL_ATMO_CORE, GLSL_ATMO_MS, GLSL_ATMO_MARCH } from '../shaders/atmosphere.glsl.js';
import { GLSL_CLOUD_PARS, GLSL_CLOUD_LIGHT, GLSL_CLOUD_INTERVALS } from '../shaders/clouds.glsl.js';

const VERT = /* glsl */`
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = () => atmosphereDefines() + GLSL_MATH + GLSL_HASH + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + /* glsl */`
uniform vec3 uUp;
uniform float uH;
uniform vec3 uSunDir;
uniform vec3 uLpSunE;
uniform vec3 uLpNightAmbient;
uniform vec3 uGroundAlbedo;
uniform float uCloudsOn;
` + GLSL_CLOUD_PARS + GLSL_CLOUD_LIGHT + GLSL_CLOUD_INTERVALS + /* glsl */`
in vec3 vDir;
out vec4 outColor;

float lpMax3(vec3 v) { return max(v.r, max(v.g, v.b)); }

// cheap two-tap light term for reflections (same phase / multiple-scattering model)
vec3 envCloudLight(vec3 p, float h, float mus, float nu, vec3 sunT, float fp) {
  if (lpMax3(sunT) <= 1e-6) return vec3(0.0);
  float od = (lpCloudDensity(p + uSunDir * 250.0, h + 250.0 * mus, max(fp, 60.0), false) * 500.0
            + lpCloudDensity(p + uSunDir * 1100.0, h + 1100.0 * mus, max(fp, 280.0), false) * 1300.0) * uCloudSigma;
  float a = 1.0, b = 1.0, c = 1.0, ms = 0.0;
  for (int o = 0; o < 6; o++) {
    float ph = mix(lpPhaseHG(nu, -0.30 * c), lpPhaseHG(nu, 0.82 * c), 0.55);
    ms += a * ph * exp(-b * od);
    a *= 0.62; b *= 0.26; c *= 0.55;
  }
  return sunT * ms * 2.0;
}

// coarse cloud segment (reflections only): 28 steps, shared density / light functions
void envCloudSeg(float r, float h, float mu, float mus0, float nu, vec3 rd, float ta, float tb, inout vec3 L, inout vec3 T) {
  float seg = tb - ta;
  if (seg <= 0.0) return;
  float tMid = 0.5 * (ta + tb);
  float rsM;
  float hM = lpAltAt(r, h, mu, tMid, rsM);
  float musM = clamp((r * mus0 + tMid * nu) / rsM, -1.0, 1.0);
  vec3 Eup = lpIrradianceSH(max(hM, 0.0), musM, vec3(0.0, 0.0, 1.0)) * uLpSunE + uLpNightAmbient;
  vec3 Edn = (lpIrradianceSH(max(hM, 0.0), musM, vec3(0.0, 0.0, -1.0)) + LP_ORBIT_GROUND_ALBEDO * lpGroundIrradiance(musM)) * uLpSunE + uLpNightAmbient * 0.3;
  vec3 camP = uUp * r;
  const int N = 20;
  float dt = seg / float(N);
  for (int i = 0; i < N; i++) {
    float t = ta + (float(i) + 0.5) * dt;
    float rs;
    float hs = lpAltAt(r, h, mu, t, rs);
    vec3 p = camP + rd * t;
    float fp = max(t * 0.006, 30.0);
    vec3 pr; float hf; vec4 w;
    float base = lpCloudBase(p, hs, fp, pr, hf, w);
    if (base <= 0.0) continue;
    float dens = base * w.w;
    float sigma = dens * uCloudSigma;
    float muss = clamp((r * mus0 + t * nu) / rs, -1.0, 1.0);
    vec3 sunT = lpSunTransmittance(rs, hs, muss);
    float hn = clamp(hf / mix(0.16, 1.0, w.z), 0.0, 1.0);
    vec3 Lc = envCloudLight(p, hs, muss, nu, sunT, fp) * uLpSunE
            + (Eup * mix(0.30, 1.0, hn) + Edn * mix(0.90, 0.30, hn)) * (1.0 / (2.0 * LP_PI));
    float Ts = exp(-sigma * dt);
    L += T * Lc * (1.0 - Ts);
    T *= Ts;
    if (lpMax3(T) < 0.01) break;
  }
}

void main() {
  vec3 rd = normalize(vDir);
  float h = uH, r = LP_R + uH;
  float mu = dot(uUp, rd), mus0 = dot(uUp, uSunDir), nu = dot(rd, uSunDir);
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  vec2 tg = lpRaySphere(r, h, mu, 0.0);
  bool hitG = mu < 0.0 && tg.x <= tg.y && tg.y > 0.0;
  float tEnd = hitG ? max(tg.x, 0.0) : max(tt.y, 0.0);
  float tBeg = max(tt.x, 0.0);
  vec3 L = vec3(0.0), T = vec3(1.0);
  vec2 c0 = vec2(0.0), c1 = vec2(0.0);
  int nc = uCloudsOn > 0.5 ? lpCloudIntervals(r, h, mu, tBeg, tEnd, c0, c1) : 0;
  if (nc > 0) {
    float cEnd = nc > 1 ? c1.y : c0.y;
    vec3 La = vec3(0.0), Ta = vec3(1.0);
    lpIntegrate(r, h, mu, mus0, nu, tBeg, c0.x, 14, 0.5, 1.6, La, Ta);
    L = La * uLpSunE; T = Ta;
    vec3 Lc = vec3(0.0), Tc = vec3(1.0);
    envCloudSeg(r, h, mu, mus0, nu, rd, c0.x, c0.y, Lc, Tc);
    if (nc > 1) envCloudSeg(r, h, mu, mus0, nu, rd, c1.x, c1.y, Lc, Tc);
    L += T * Lc; T *= Tc;
    vec3 Lb = vec3(0.0), Tb = vec3(1.0);
    lpIntegrate(r, h, mu, mus0, nu, cEnd, tEnd, 14, 0.5, 1.6, Lb, Tb);
    L += T * Lb * uLpSunE; T *= Tb;
  } else {
    lpIntegrate(r, h, mu, mus0, nu, tBeg, tEnd, 28, 0.5, 1.6, L, T);
    L *= uLpSunE;
  }
  vec3 col = L;
  if (hitG) {
    vec3 pg = uUp * r + rd * tEnd;
    vec3 up = normalize(pg);
    float musg = dot(up, uSunDir);
    vec3 E = (lpSunTransmittance(LP_R, 0.0, musg) * max(musg, 0.0) + lpIrradianceSH(0.0, musg, vec3(0.0, 0.0, 1.0))) * uLpSunE + uLpNightAmbient;
    col += T * uGroundAlbedo * E / LP_PI;
  } else {
    col += T * uLpNightAmbient * 0.05;
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  outColor = vec4(min(col, vec3(30000.0)), 1.0);
}
`;

export class SkyEnvironment {
  constructor(renderer, lightingUniforms, { size = 256 } = {}) {
    this.renderer = renderer;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.cubeRT);
    const lu = lightingUniforms;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG(),
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uLpAtlas: lu.uLpAtlas,
        uLpMsLut: { value: null },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uH: { value: 2 },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uLpSunE: lu.uLpSunE,
        uLpNightAmbient: lu.uLpNightAmbient,
        uGroundAlbedo: lu.uLpGroundAlbedo || { value: new THREE.Vector3(0.20, 0.115, 0.075) },   // local ground (reflected below the horizon)
        uCloudsOn: { value: 0 },
        uCloudWeather: lu.uCloudWeather, uCloudShape: lu.uCloudShape, uCloudDetail: lu.uCloudDetail,
        uCloudRot: { value: new THREE.Matrix3() }, uCloudOffA: { value: new THREE.Vector3() }, uCloudOffB: { value: new THREE.Vector3() },
        uCloudRot2: { value: new THREE.Matrix3() }, uCloudOffA2: { value: new THREE.Vector3() }, uCloudOffB2: { value: new THREE.Vector3() }, uCloudMix: { value: 0 },
        uCloudCoverage: lu.uCloudCoverage, uCloudSigma: lu.uCloudSigma,
        uLpEmission: { value: null }, uCityGlow: { value: 0 },
      },
    });
    this.lu = lu;
    this.scene = new THREE.Scene();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material);
    sphere.frustumCulled = false;
    this.scene.add(sphere, this.cubeCam);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmremRT = null;
    this.ref = { h: -1, mus: 2, up: new THREE.Vector3(), cloudTime: null, clouds: -1 };
    this.face = -1;            // next face to render (-1 = idle)
    this.ready = false;
    this.version = 0;
    this._inited = false;
  }

  setMsLut(tex) { this.material.uniforms.uLpMsLut.value = tex; }

  /**
   * Refresh when the sun elevation, the altitude or the position at the camera, or the cloud field
   * changed noticeably. Renders one face per call; returns true when a new cube became current.
   */
  update(frame, uniforms, cloudTime = null, force = false) {
    const renderer = this.renderer;
    const h = THREE.MathUtils.clamp(frame.camAlt, 2, 30000);
    const up = frame.camUp;
    const mus = up.dot(frame.sunDir);
    const lu = this.lu;
    const cloudsOn = lu.uLpCloudsOn?.value > 0.5 && !!lu.uCloudWeather.value ? 1 : 0;
    const r = this.ref;
    if (this.face < 0) {
      const dAlt = Math.abs(h - r.h) / Math.max(200, r.h);
      const moved = r.up.dot(up) < Math.cos(THREE.MathUtils.degToRad(0.5));
      const cloudsChanged = cloudsOn !== r.clouds || (cloudsOn && cloudTime !== null && Math.abs(cloudTime - (r.cloudTime ?? cloudTime)) > 0.02);
      if (!force && this.ready && Math.abs(mus - r.mus) < 0.0015 && dAlt < 0.15 && !moved && !cloudsChanged) return false;
      // start a refresh: freeze the parameters for all six faces
      r.h = h; r.mus = mus; r.up.copy(up); r.cloudTime = cloudTime; r.clouds = cloudsOn;
      const u = this.material.uniforms;
      u.uUp.value.copy(up); u.uH.value = h; u.uSunDir.value.copy(frame.sunDir);
      u.uCloudsOn.value = cloudsOn;
      u.uCloudRot.value.copy(lu.uCloudRot.value); u.uCloudOffA.value.copy(lu.uCloudOffA.value); u.uCloudOffB.value.copy(lu.uCloudOffB.value);
      if (lu.uCloudRot2) {
        u.uCloudRot2.value.copy(lu.uCloudRot2.value); u.uCloudOffA2.value.copy(lu.uCloudOffA2.value); u.uCloudOffB2.value.copy(lu.uCloudOffB2.value);
        u.uCloudMix.value = lu.uCloudMix.value;
      }
      this.face = 0;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.needsUpdate;
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    if (!this._inited) {
      // sets the cube cameras' orientation for this renderer's coordinate system (sky only)
      const prevClouds = this.material.uniforms.uCloudsOn.value;
      this.material.uniforms.uCloudsOn.value = 0;
      this.cubeCam.update(renderer, this.scene);
      this.material.uniforms.uCloudsOn.value = prevClouds;
      this._inited = true;
    }
    // one face per frame (a full cube with clouds is heavy on a busy GPU)
    const cams = this.cubeCam.children;
    this.cubeCam.updateMatrixWorld(true);
    renderer.setRenderTarget(this.cubeRT, this.face);
    renderer.render(this.scene, cams[this.face]);
    this.face++;
    renderer.shadowMap.needsUpdate = prevShadow;
    renderer.shadowMap.autoUpdate = prevAuto;
    let done = false;
    if (this.face >= 6) {
      this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.pmremRT);
      uniforms.uLpEnvRef.value.set(r.h, r.mus);
      uniforms.uLpEnvOn.value = 1;
      this.ready = true;
      this.version++;
      this.face = -1;
      done = true;
    }
    renderer.setRenderTarget(prevTarget);
    return done;
  }

  get busy() { return this.face >= 0; }
  get texture() { return this.pmremRT ? this.pmremRT.texture : null; }

  dispose() { this.cubeRT.dispose(); this.pmremRT?.dispose(); this.pmrem.dispose(); this.material.dispose(); }
}
