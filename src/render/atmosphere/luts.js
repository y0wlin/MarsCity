// Precomputed atmosphere LUTs (GPU, once at start-up). OWNER: atmosphere agent.
//   atlas  (RGBA16F 320x72): transmittance LUT (256x64, Bruneton parameterisation) at y<64, the
//          horizontal ground irradiance row (sun + sky vs mu_s, 64x1) at x>=256, y=0, and the
//          sky-irradiance SH LUT (64 sun angles x 8 altitudes x 5 packed texels) at y>=64.
//   ms     (RGBA16F 32x32): Hillaire multiple-scattering LUT Psi_ms(h, mu_s).
//   ground (RGBA16F 64x1) : horizontal ground irradiance (sun + sky) vs mu_s (copied into the atlas).
// The SH LUT stores 6 cosine-convolved real-SH coefficients (l<=2, the ones that survive the
// symmetry about the sun's vertical plane) of the incident radiance of the SKY at a point (rays
// that hit the ground carry only the haze in front of it). The ground bounce ("背阴处接受蓝天和红土的
// 反射") is added per fragment from the ground row with the local ground albedo (lighting patch).
import * as THREE from 'three';
import { atmosphereDefines, LUT } from './model.js';
import { GLSL_MATH } from '../shaders/common.glsl.js';
import { GLSL_ATMO_MEDIUM, GLSL_ATMO_CORE, GLSL_ATMO_MS, GLSL_ATMO_MARCH } from '../shaders/atmosphere.glsl.js';
import { fsMaterial, FullscreenPass, halfFloatTarget } from './gpu.js';

const HEAD = () => atmosphereDefines() + GLSL_MATH;

const TRANS_FRAG = () => HEAD() + GLSL_ATMO_MEDIUM + /* glsl */`
out vec4 outColor;
void main() {
  vec2 px = gl_FragCoord.xy;
  float xmu = (px.x - 0.5) / (LP_TRANS_W - 1.0);
  float xr = (px.y - 0.5) / (LP_TRANS_H - 1.0);
  float rho = LP_HT * xr;
  float h = rho * rho / (sqrt(rho * rho + LP_R * LP_R) + LP_R);
  float r = LP_R + h;
  float dmin = LP_ATMO_H - h;
  float dmax = rho + LP_HT;
  float d = dmin + xmu * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : (LP_HT * LP_HT - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
  vec3 od = vec3(0.0);
  const int N = 480;
  float dt = d / float(N);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * dt;
    float rs;
    float hs = lpAltAt(r, h, mu, t, rs);
    vec3 sR, sM, ext;
    lpMedium(hs, sR, sM, ext);
    od += ext * dt;
  }
  outColor = vec4(exp(-od), 1.0);
}
`;

// Multiple scattering (Hillaire 2020, isotropic phase, 64 directions, ground bounce included)
const MS_FRAG = () => HEAD() + GLSL_ATMO_CORE + /* glsl */`
out vec4 outColor;
void main() {
  vec2 px = gl_FragCoord.xy;
  float xm = (px.x - 0.5) / (LP_MS_SIZE - 1.0);
  float xh = (px.y - 0.5) / (LP_MS_SIZE - 1.0);
  float mus = xm * 2.0 - 1.0;
  float h = max(LP_ATMO_H * xh * xh, 0.5);
  float r = LP_R + h;
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - mus * mus)), 0.0, mus);
  const int SQ = 8;
  vec3 L2 = vec3(0.0), F2 = vec3(0.0);
  for (int i = 0; i < SQ; i++) for (int j = 0; j < SQ; j++) {
    float u = (float(i) + 0.5) / float(SQ);
    float v = (float(j) + 0.5) / float(SQ);
    float cosT = 1.0 - 2.0 * v;
    float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    float phi = 2.0 * LP_PI * u;
    vec3 w = vec3(sinT * cos(phi), sinT * sin(phi), cosT);
    float mu = w.z;
    float nu = dot(w, sun);
    vec2 tg = lpRaySphere(r, h, mu, 0.0);
    vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
    bool hitG = mu < 0.0 && tg.x <= tg.y && tg.y > 0.0;
    float tEnd = hitG ? max(tg.x, 0.0) : max(tt.y, 0.0);
    const int N = 32;
    vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
    float tPrev = 0.0;
    for (int k = 0; k < N; k++) {
      float tn = tEnd * pow((float(k) + 1.0) / float(N), 1.5);
      float dt = tn - tPrev;
      float t = tPrev + 0.5 * dt;
      float rs;
      float hs = lpAltAt(r, h, mu, t, rs);
      float muss = clamp((r * mus + t * nu) / rs, -1.0, 1.0);
      vec3 sR, sM, ext;
      lpMedium(hs, sR, sM, ext);
      vec3 sc = sR + sM;
      vec3 sunT = lpSunTransmittance(rs, hs, muss);
      vec3 S = sc * sunT * 0.0795774715;
      vec3 Ts = exp(-ext * dt);
      vec3 ie = 1.0 / max(ext, vec3(1e-20));
      L += T * (S - S * Ts) * ie;
      F += T * (sc - sc * Ts) * ie;
      T *= Ts;
      tPrev = tn;
    }
    if (hitG) {
      vec3 pg = vec3(0.0, 0.0, r) + w * tEnd;
      float musg = dot(normalize(pg), sun);
      L += T * lpSunTransmittance(LP_R, 0.0, musg) * max(musg, 0.0) * LP_MS_ALBEDO / LP_PI;
    }
    L2 += L; F2 += F;
  }
  float invN = 1.0 / float(SQ * SQ);
  L2 *= invN; F2 *= invN;
  outColor = vec4(L2 / max(vec3(1.0) - F2, vec3(1e-3)), 1.0);
}
`;

const COPY_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uOffset;
out vec4 outColor;
void main() { outColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy - uOffset), 0); }
`;

const SH_COMMON = /* glsl */`
float lpShMuFromX(float xm) { float s = 2.0 * xm - 1.0; return sign(s) * s * s; }
// sky radiance arriving at a point (radius r, altitude h) from direction w (local frame, z up); rays
// towards the ground carry the in-scattered haze only -- the lit ground itself is added per fragment
// with the local albedo (lpGroundBounceN), so the bounce can be pavement-grey in a city and red in a
// canyon instead of one baked regolith colour
vec3 lpRadianceLocal(float r, float h, float mus, vec3 sun, vec3 w) {
  float mu = w.z;
  vec2 tg = lpRaySphere(r, h, mu, 0.0);
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  bool hitG = mu < 0.0 && tg.x <= tg.y && tg.y > 0.0;
  float tEnd = hitG ? max(tg.x, 0.0) : max(tt.y, 0.0);
  vec3 L = vec3(0.0), T = vec3(1.0);
  lpIntegrate(r, h, mu, mus, dot(w, sun), 0.0, tEnd, 24, 0.5, 1.6, L, T);
  return L;
}
`;

// ground irradiance (horizontal, unit sun) vs mu_s: direct sun + hemisphere of sky
const GROUND_FRAG = () => HEAD() + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + /* glsl */`
out vec4 outColor;
float lpShMuFromX(float xm) { float s = 2.0 * xm - 1.0; return sign(s) * s * s; }
void main() {
  float xm = (gl_FragCoord.x - 0.5) / (LP_SH_MU - 1.0);
  float mus = lpShMuFromX(xm);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - mus * mus)), 0.0, mus);
  float r = LP_R, h = 0.0;
  vec3 E = lpSunTransmittance(r, h, mus) * max(mus, 0.0);
  const int NA = 24, NB = 12;
  for (int a = 0; a < NA; a++) for (int b = 0; b < NB; b++) {
    float z = (float(b) + 0.5) / float(NB);           // uniform hemisphere in cos
    float s = sqrt(max(0.0, 1.0 - z * z));
    float phi = 2.0 * LP_PI * (float(a) + 0.5) / float(NA);
    vec3 w = vec3(s * cos(phi), s * sin(phi), z);
    vec2 tt = lpRaySphere(r, h, w.z, LP_ATMO_H);
    vec3 L = vec3(0.0), T = vec3(1.0);
    lpIntegrate(r, h, w.z, mus, dot(w, sun), 0.0, max(tt.y, 0.0), 24, 0.5, 1.6, L, T);
    E += L * z * (2.0 * LP_PI / float(NA * NB));
  }
  outColor = vec4(E, 1.0);
}
`;

const SH_FRAG = () => HEAD() + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + SH_COMMON + /* glsl */`
out vec4 outColor;
void main() {
  vec2 px = gl_FragCoord.xy;
  int col = int(px.x);
  int k = col / int(LP_SH_MU);
  int i = col - k * int(LP_SH_MU);
  int j = int(px.y);
  float xm = float(i) / (LP_SH_MU - 1.0);
  float xh = float(j) / (LP_SH_ALT - 1.0);
  float mus = lpShMuFromX(xm);
  float h = LP_SH_HMAX * xh * xh;
  float r = LP_R + h;
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - mus * mus)), 0.0, mus);
  vec3 c0 = vec3(0.0), c1 = vec3(0.0), c2 = vec3(0.0), c3 = vec3(0.0), c4 = vec3(0.0), c5 = vec3(0.0);
  const int NA = 32, NB = 16;
  for (int a = 0; a < NA; a++) for (int b = 0; b < NB; b++) {
    float z = 1.0 - 2.0 * (float(b) + 0.5) / float(NB);
    float s = sqrt(max(0.0, 1.0 - z * z));
    float phi = 2.0 * LP_PI * (float(a) + 0.5) / float(NA);
    vec3 w = vec3(s * cos(phi), s * sin(phi), z);
    vec3 L = lpRadianceLocal(r, h, mus, sun, w);
    c0 += L * 0.282095;
    c1 += L * (0.488603 * w.z);
    c2 += L * (0.488603 * w.x);
    c3 += L * (0.315392 * (3.0 * w.z * w.z - 1.0));
    c4 += L * (1.092548 * w.x * w.z);
    c5 += L * (0.546274 * (w.x * w.x - w.y * w.y));
  }
  float dOmega = 4.0 * LP_PI / float(NA * NB);
  // cosine-lobe convolution: A0 = pi, A1 = 2pi/3, A2 = pi/4
  c0 *= dOmega * LP_PI;
  c1 *= dOmega * (2.0 * LP_PI / 3.0);
  c2 *= dOmega * (2.0 * LP_PI / 3.0);
  c3 *= dOmega * (LP_PI / 4.0);
  c4 *= dOmega * (LP_PI / 4.0);
  c5 *= dOmega * (LP_PI / 4.0);
  vec4 o;
  if (k == 0) o = vec4(c0, c1.r);
  else if (k == 1) o = vec4(c1.gb, c2.rg);
  else if (k == 2) o = vec4(c2.b, c3);
  else if (k == 3) o = vec4(c4, c5.r);
  else o = vec4(c5.gb, 0.0, 1.0);
  outColor = o;
}
`;

export class AtmosphereLUTs {
  constructor(renderer) {
    this.renderer = renderer;
    this.atlas = halfFloatTarget(LUT.atlasW, LUT.atlasH);
    this.ms = halfFloatTarget(LUT.msSize, LUT.msSize);
    this.ground = halfFloatTarget(LUT.shMu, 1);
    this.sh = halfFloatTarget(LUT.shMu * LUT.shTexels, LUT.shAlt, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.atlas.texture.name = 'lp.atlas';
    this.ms.texture.name = 'lp.msLut';
    this.ready = false;
  }

  /** Compute everything (synchronous GPU work, a few ms). */
  compute() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    const atlasU = { value: this.atlas.texture };
    const msU = { value: this.ms.texture };

    const trans = new FullscreenPass(fsMaterial({ fragmentShader: TRANS_FRAG() }));
    trans.render(r, this.atlas, [0, 0, LUT.transW, LUT.transH]);

    const ms = new FullscreenPass(fsMaterial({ fragmentShader: MS_FRAG(), uniforms: { uLpAtlas: atlasU } }));
    ms.render(r, this.ms);

    const ground = new FullscreenPass(fsMaterial({ fragmentShader: GROUND_FRAG(), uniforms: { uLpAtlas: atlasU, uLpMsLut: msU } }));
    ground.render(r, this.ground);

    const sh = new FullscreenPass(fsMaterial({ fragmentShader: SH_FRAG(), uniforms: { uLpAtlas: atlasU, uLpMsLut: msU } }));
    sh.render(r, this.sh);
    const copy = new FullscreenPass(fsMaterial({ fragmentShader: COPY_FRAG, uniforms: { tSrc: { value: this.sh.texture }, uOffset: { value: new THREE.Vector2(0, LUT.transH) } } }));
    copy.render(r, this.atlas, [0, LUT.transH, LUT.shMu * LUT.shTexels, LUT.shAlt]);
    // ground irradiance row into the free corner of the atlas (one sampler for patched materials)
    copy.material.uniforms.tSrc.value = this.ground.texture;
    copy.material.uniforms.uOffset.value.set(LUT.groundX, 0);
    copy.render(r, this.atlas, [LUT.groundX, 0, LUT.shMu, 1]);

    for (const p of [trans, ms, ground, sh, copy]) p.dispose();
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    this.ready = true;
  }

  /** Read the LUTs back (debug / node-side checks): returns Float32Arrays. */
  readback() {
    const r = this.renderer;
    const read = (rt) => { const a = new Float32Array(rt.width * rt.height * 4); r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, a); return a; };
    return { atlas: read(this.atlas), ms: read(this.ms), ground: read(this.ground) };
  }

  dispose() { this.atlas.dispose(); this.ms.dispose(); this.ground.dispose(); this.sh.dispose(); }
}
