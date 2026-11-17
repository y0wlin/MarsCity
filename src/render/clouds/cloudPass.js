// Half-resolution cloud march. OWNER: atmosphere agent.
// For every half-res pixel: the cloud-shell segment(s) of the view ray in front of the scene depth
// (farthest of the 4 covered full-res depths) are marched (distance-adaptive steps, light march,
// multiple scattering, sky / ground ambient, city glow at night, atmosphere inside the segment).
// Output RGBA16F: rgb = in-scattered radiance of [first shell entry, last shell exit] (absolute),
// a = mean transmittance of that interval. The composite re-derives the same interval analytically
// per full-res pixel and applies the atmosphere in front of / behind it.
import * as THREE from 'three';
import { atmosphereDefines } from '../atmosphere/model.js';
import { GLSL_MATH, GLSL_HASH } from '../shaders/common.glsl.js';
import { GLSL_ATMO_CORE, GLSL_ATMO_MS, GLSL_ATMO_MARCH } from '../shaders/atmosphere.glsl.js';
import { GLSL_CLOUD_PARS, GLSL_CLOUD_LIGHT, GLSL_CLOUD_INTERVALS } from '../shaders/clouds.glsl.js';
import { FullscreenPass, fsMaterial, halfFloatTarget } from '../atmosphere/gpu.js';

const FRAG = () => atmosphereDefines() + GLSL_MATH + GLSL_HASH + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uLpSunE;
uniform vec3 uLpNightAmbient;
` + GLSL_CLOUD_PARS + GLSL_CLOUD_LIGHT + GLSL_CLOUD_INTERVALS + /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uFullTexel;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCamUp;
uniform float uCamR;
uniform float uCamH;
uniform float uLogFar;
uniform float uFrame;
uniform float uPixelAngle;
uniform float uQuality;        // 1 = static (converging), < 1 while moving
uniform float uInterleave;     // 1: march only the pixels of this frame's 2x2 phase (static view)
uniform float uPhase;          // 0..3
in vec2 vUv;
out vec4 outColor;

float lpMax3(vec3 v) { return max(v.r, max(v.g, v.b)); }

// far-field relief (orbit / regional views): the domes and heaps of a cloud field are far below the
// pixel size there, so the homogeneous far-field slab alone looks flat white (it read as snow from
// orbit). The weather top field F = coverage * top height is used as a bump map along the sun's
// horizontal direction: flanks rising towards the sun brighten, flanks behind a higher neighbour
// darken, so heaps, bands and cyclone arms read as 3D with the same sun as the ground (A01).
float lpCloudRelief(vec3 p, float fp, float mus) {
  vec3 up = normalize(p);
  vec3 sH = uSunDir - up * mus;
  float l = length(sH);
  if (l < 1e-4 || mus <= 0.0) return 1.0;
  sH /= l;
  float d = max(fp * 1.5, 3500.0);
  vec4 wa = lpCloudWeatherP(p + sH * d, fp);
  vec4 wb = lpCloudWeatherP(p - sH * d, fp);
  float Fa = clamp(lpCoverageMul(wa.x), 0.0, 1.0) * mix(0.16, 1.0, wa.z);
  float Fb = clamp(lpCoverageMul(wb.x), 0.0, 1.0) * mix(0.16, 1.0, wb.z);
  float slope = (Fa - Fb) * LP_CL_THICK / (2.0 * d);         // > 0: the field rises towards the sun
  float tanE = max(mus, 0.04) / max(l, 0.04);
  return clamp(1.0 - 5.0 * slope / tanE, 0.35, 1.35);
}

void lpCloudSeg(float r, float h, float mu, float mus0, float nu, vec3 rd, float ta, float tb, float jitter, inout vec3 L, inout vec3 T) {
  float seg = tb - ta;
  if (seg <= 0.0) return;
  // atmosphere + ambient light, evaluated once in the middle of the segment
  float tMid = 0.5 * (ta + tb);
  float rsM;
  float hM = lpAltAt(r, h, mu, tMid, rsM);
  float musM = clamp((r * mus0 + tMid * nu) / rsM, -1.0, 1.0);
  vec3 sR, sM, extA;
  lpMedium(hM, sR, sM, extA);
  vec3 sunTM = lpSunTransmittance(rsM, hM, musM);
  vec3 msA = lpMultiScat(max(hM, 0.0), musM);
  vec3 Satm = (sR * (sunTM * lpPhaseR(nu) + msA) + sM * (sunTM * lpPhaseM(nu) + msA)) * uLpSunE;
  vec3 camP = uCamUp * r;
  vec3 upM = normalize(camP + rd * tMid);
  vec3 Eup = lpIrradianceSH(max(hM, 0.0), musM, vec3(0.0, 0.0, 1.0)) * uLpSunE + uLpNightAmbient * 0.35;
  // light from below: haze (sky SH, down) + the lit ground (planet-average albedo, attenuated from the
  // ground up to the segment) + city glow at night
  vec3 Tg = lpTransmittance(LP_R, 0.0, 1.0) / max(lpTransmittance(rsM, max(hM, 0.0), 1.0), vec3(1e-4));
  vec3 Edn = (lpIrradianceSH(max(hM, 0.0), musM, vec3(0.0, 0.0, -1.0)) + LP_ORBIT_GROUND_ALBEDO * lpGroundIrradiance(musM) * min(Tg, vec3(1.0))) * uLpSunE
           + uLpNightAmbient * 0.08 + lpCityGlow(upM, musM);
  // distance-adaptive steps: ~pixel footprint x 2.5, at least ~16 samples per segment (the thin
  // shell seen from orbit), at most the step budget of the segment
  float minStep = max(seg / (150.0 * uQuality), 8.0);
  float maxStep = max(min(2500.0, seg / (16.0 * uQuality)), minStep);
  float t = ta;
  float dt0 = clamp(t * uPixelAngle * 2.5, minStep, maxStep);
  t += dt0 * jitter;
  int maxI = int(170.0 * uQuality) + 16;
  for (int i = 0; i < 200; i++) {
    if (i >= maxI || t >= tb) break;
    float rs;
    float hs = lpAltAt(r, h, mu, t, rs);
    vec3 p = camP + rd * t;
    float fp = max(t * uPixelAngle, 0.5);
    float stepFine = clamp(t * uPixelAngle * 2.5, minStep, maxStep);
    vec3 pr; float hf; vec4 w;
    float base = lpCloudBase(p, hs, fp, pr, hf, w);
    float dt = min(base > 0.0 ? stepFine : min(stepFine * 2.5, maxStep * 1.5), tb - t);
    vec3 S = Satm, ext = extA;
    if (base > 0.0) {
      float fk = gLpClFar;      // far-field weight of this sample (the light march overwrites it)
      float dens = lpCloudDetail(base, pr, hf, w, fp) * w.w;
      if (dens > 0.0) {
        float sigma = dens * uCloudSigma;
        float muss = clamp((r * mus0 + t * nu) / rs, -1.0, 1.0);
        vec3 sunT = lpSunTransmittance(rs, hs, muss);
        float hn = clamp(hf / mix(0.16, 1.0, w.z), 0.0, 1.0);
        float relief = fk > 0.0 ? mix(1.0, lpCloudRelief(p, fp, muss), fk) : 1.0;
        vec3 Lc = lpCloudSunTerm(p, hs, muss, nu, sunT, dens, fp) * (uLpSunE * relief)
                + (Eup * mix(0.30, 1.0, hn) + Edn * mix(0.90, 0.30, hn)) * (1.0 / (2.0 * LP_PI));
        S += sigma * Lc;
        ext += vec3(sigma);
      }
    }
    vec3 Ts = exp(-ext * dt);
    L += T * (S - S * Ts) / max(ext, vec3(1e-20));
    T *= Ts;
    if (lpMax3(T) < 0.003) break;
    t += dt;
  }
}

void main() {
  // static view: interleaved full-resolution march, one 8x8 tile of every 16x16 block per frame; the
  // others keep their previous (equally converged) value in the persistent target. Whole 8x8 tiles
  // (not single pixels): GPUs shade 2x2 quads in 32-wide SIMD groups, so a per-pixel pattern would
  // still run the march in every group and save nothing
  if (uInterleave > 0.5) {
    ivec2 q = (ivec2(gl_FragCoord.xy) >> 3) & 1;
    if (float(q.x + 2 * q.y) != uPhase) discard;
  }
  vec2 o = uFullTexel * 0.5;
  float depth = max(max(texture(tDepth, vUv + vec2(-o.x, -o.y)).r, texture(tDepth, vUv + vec2(o.x, -o.y)).r),
                    max(texture(tDepth, vUv + vec2(-o.x, o.y)).r, texture(tDepth, vUv + vec2(o.x, o.y)).r));
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 rd = normalize(uCamRot * vdir);
  bool sky = depth >= 0.9999999;
  float tEnd = 1e30;
  if (!sky) tEnd = (exp2(depth * uLogFar) - 1.0) / max(-vdir.z, 1e-6);
  float r = uCamR, h = uCamH;
  float mu = dot(uCamUp, rd);
  if (sky) {
    vec2 tg = lpRaySphere(r, h, mu, 0.0);
    if (mu < 0.0 && tg.x <= tg.y && tg.y > 0.0) tEnd = max(tg.x, 0.0);
  }
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  vec3 L = vec3(0.0), T = vec3(1.0);
  if (tt.x <= tt.y && tt.y > 0.0) {
    vec2 c0, c1;
    int n = lpCloudIntervals(r, h, mu, max(tt.x, 0.0), min(tt.y, tEnd), c0, c1);
    if (n > 0) {
      float mus0 = dot(uCamUp, uSunDir), nu = dot(rd, uSunDir);
      float jitter = lpIGN(gl_FragCoord.xy, uFrame);
      lpCloudSeg(r, h, mu, mus0, nu, rd, c0.x, c0.y, jitter, L, T);
      if (n > 1 && lpMax3(T) > 0.003) {
        vec3 Lg = vec3(0.0), Tg = vec3(1.0);
        lpIntegrate(r, h, mu, mus0, nu, c0.y, c1.x, 6, jitter, 1.0, Lg, Tg);
        L += T * Lg * uLpSunE; T *= Tg;
        lpCloudSeg(r, h, mu, mus0, nu, rd, c1.x, c1.y, jitter, L, T);
      }
    }
  }
  if (any(isnan(L)) || any(isinf(L))) { L = vec3(0.0); T = vec3(1.0); }
  outColor = vec4(min(L, vec3(60000.0)), dot(T, vec3(0.3333333)));
}
`;

export class CloudPass {
  constructor(lightingUniforms, msTex, emissionUniform, cityGlowUniform) {
    const lu = lightingUniforms;
    this.uniforms = {
      tDepth: { value: null }, uFullTexel: { value: new THREE.Vector2() },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uCamUp: { value: new THREE.Vector3() },
      uCamR: { value: 0 }, uCamH: { value: 0 }, uLogFar: { value: 1 }, uFrame: { value: 0 }, uPixelAngle: { value: 0.001 }, uQuality: { value: 1 },
      uInterleave: { value: 0 }, uPhase: { value: 0 },
      uSunDir: lu.uSunDir, uLpSunE: lu.uLpSunE, uLpNightAmbient: lu.uLpNightAmbient,
      uLpAtlas: lu.uLpAtlas, uLpMsLut: { value: msTex },
      uCloudWeather: lu.uCloudWeather, uCloudShape: lu.uCloudShape, uCloudDetail: lu.uCloudDetail, uCloudRot: lu.uCloudRot,
      uCloudOffA: lu.uCloudOffA, uCloudOffB: lu.uCloudOffB, uCloudCoverage: lu.uCloudCoverage, uCloudSigma: lu.uCloudSigma,
      uCloudRot2: lu.uCloudRot2, uCloudOffA2: lu.uCloudOffA2, uCloudOffB2: lu.uCloudOffB2, uCloudMix: lu.uCloudMix,
      uLpEmission: emissionUniform, uCityGlow: cityGlowUniform,
    };
    this.pass = new FullscreenPass(fsMaterial({ fragmentShader: FRAG(), uniforms: this.uniforms }));
    this.half = null; this.full = null; this.rt = null;
    this._fullValid = false;      // the full-res target holds a complete march of the current view
    this.interleaved = false;     // last frame marched a quarter of the pixels
    this.allowInterleave = true;  // debug / benchmarks: false = march every pixel every static frame
    this.frames = 0;
  }
  get texture() { return this.rt ? this.rt.texture : null; }
  /** half resolution while the view moves, full resolution while it converges (crisp edges) */
  setSize(fullW, fullH, fullRes) {
    const w = Math.max(1, Math.ceil(fullW / 2)), h = Math.max(1, Math.ceil(fullH / 2));
    if (!this.half || this.half.width !== w || this.half.height !== h) {
      this.half?.dispose(); this.half = halfFloatTarget(w, h); this.half.texture.name = 'clouds.half';
    }
    if (fullRes && (!this.full || this.full.width !== fullW || this.full.height !== fullH)) {
      this.full?.dispose(); this.full = halfFloatTarget(fullW, fullH); this.full.texture.name = 'clouds.full';
      this._fullValid = false;
    }
    this.rt = fullRes ? this.full : this.half;
  }
  /**
   * Moving view: half resolution, every pixel, reduced step budget. Static view (camera, time and
   * settings unchanged; animated scene content does not count): full resolution, first frame
   * complete, then interleaved -- one 8x8 tile of each 16x16 block per frame in a rotating order,
   * the others keep their last march (the view is static, so it is still exact) -> ~1/4 of the cost
   * per frame (it was 300-680 ms through dense decks), same converged image: the temporal
   * accumulation averages 64 jittered marches per pixel over 256 frames. Captures march every pixel.
   */
  render(renderer, depthTex, camera, frame, pipeline, camR, camH, pixelAngleFull) {
    const capturing = !!pipeline._capturing;
    const a = pipeline.accum;
    const fullRes = capturing || !!(a && (a.viewStatic ?? a.n > 0));
    // frames without a cloud march (clouds off, converged still): the stored march stays valid only if
    // the view stayed static all along
    const gap = pipeline.frameIndex - (this._lastFrame ?? -1e9);
    if (gap > 1 && !(a && a.viewStatic && (a.staticFrames || 0) > gap)) this._fullValid = false;
    this._lastFrame = pipeline.frameIndex;
    this.setSize(pipeline.width, pipeline.height, fullRes);
    const interleave = this.allowInterleave && fullRes && !capturing && this._fullValid;
    this._fullValid = fullRes;
    this.interleaved = interleave;
    const k = fullRes ? 1 : 2;
    const u = this.uniforms;
    u.uInterleave.value = interleave ? 1 : 0;
    u.uPhase.value = [0, 3, 1, 2][this.frames++ & 3];
    u.tDepth.value = depthTex;
    u.uFullTexel.value.set(fullRes ? 0 : 1 / pipeline.width, fullRes ? 0 : 1 / pipeline.height);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    u.uCamUp.value.copy(frame.camUp);
    u.uCamR.value = camR; u.uCamH.value = camH;
    u.uLogFar.value = Math.log2(camera.far + 1);
    u.uFrame.value = pipeline.frameIndex % 4096;
    u.uPixelAngle.value = pixelAngleFull * k;
    const q = pipeline.quality || { cloudStatic: 1.0, cloudMoving: 0.6 };
    u.uQuality.value = fullRes ? q.cloudStatic : q.cloudMoving;
    this.pass.render(renderer, this.rt);
  }
  dispose() { this.half?.dispose(); this.full?.dispose(); this.pass.dispose(); }
}
