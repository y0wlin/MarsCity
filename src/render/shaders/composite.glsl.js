// Atmosphere + cloud composite (full screen, after the scene pass). OWNER: atmosphere agent.
// Per pixel: reconstruct the view ray and the scene distance from the logarithmic depth buffer.
//  * camera inside the atmosphere: sky pixels read the per-frame sky-view LUT (+ transmittance LUT
//    for the sun disc / stars), surfaces read the froxel aerial-perspective LUT;
//  * camera in space: per-pixel ray march of the shell (thin cyan limb, terminator scattering);
//  * clouds come from the half-resolution cloud pass for the analytic shell interval
//    [first entry, last exit]; the atmosphere in front of / behind that interval is applied here.
// out = L_in + T * background (scene colour, or sun disc + stars, or the fallback ground).
import { atmosphereDefines } from '../atmosphere/model.js';
import { GLSL_MATH, GLSL_HASH } from './common.glsl.js';
import { GLSL_ATMO_CORE, GLSL_ATMO_MS, GLSL_ATMO_MARCH, GLSL_SKYVIEW } from './atmosphere.glsl.js';
import { GLSL_CLOUD_INTERVALS } from './clouds.glsl.js';
import { AP_D } from '../atmosphere/frameLuts.js';

const BODY = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tExposure;
uniform sampler2D tCloud;
uniform sampler2D uSkyView;
uniform sampler3D uApLut;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCamUp;
uniform float uCamR;
uniform float uCamH;
uniform vec3 uSunDir;
uniform vec3 uLpSunE;
uniform vec3 uLpNightAmbient;
uniform float uLogFar;
uniform float uFrame;
uniform float uPixelAngle;
uniform float uCloudsOn;
uniform float uStarScale;
uniform float uSunDiscScale;
uniform float uRefExposure;
uniform vec3 uFallbackAlbedo;
uniform float uApStrength;
uniform float uApDmax;
uniform float uInside;          // 1: camera inside the atmosphere (LUT path)
uniform sampler2D uLpEmission;  // control-map night emission (equirect, mipmapped)
uniform float uSkyGlow;         // light-pollution sky radiance at emission 1 (towards the horizon)
uniform float uDodgeK;          // orbit night-side dodge weight (0 inside the atmosphere)
uniform float uDodgeRef;        // exposure of a pure night-side orbit frame
uniform float uDodgeMax;        // maximum lift (linear)
uniform float uSkySat;          // saturation of the sky seen from inside the atmosphere (blue hour > 1)
in vec2 vUv;
out vec4 outColor;

float lpMax3(vec3 v) { return max(v.r, max(v.g, v.b)); }

// ---- stars: sparse, stable, crisp (hash per 3D cell, Gaussian footprint ~1 px) ----
vec3 lpStarLayer(vec3 rd, float cells, float prob, float gain, float expo, uint seed, float sigma) {
  vec3 p = rd * cells;
  vec3 fl = floor(p);
  vec3 f = p - fl;
  ivec3 base = ivec3(fl) + ivec3(step(vec3(0.5), f)) - 1;
  vec3 col = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    ivec3 c = base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 hs = lpHash33(c, seed);
    if (hs.x > prob) continue;
    vec3 sp = normalize(vec3(c) + lpHash33(c, seed + 101u));
    vec3 dv = sp - rd;
    float I = exp(-0.5 * dot(dv, dv) / (sigma * sigma));
    if (I < 1e-3) continue;
    float mag = pow(hs.y, expo);
    vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.84, 0.62), smoothstep(0.15, 0.95, hs.z));
    col += mix(vec3(1.0), tint, 0.65) * (mag * gain * I);
  }
  return col;
}
vec3 lpStars(vec3 rd, float expo) {
  float sigma = max(uPixelAngle * 0.62, 2e-6);
  vec3 s = lpStarLayer(rd, 260.0, 0.07, 1.0, 14.0, 9001u, sigma);
  s += lpStarLayer(rd, 70.0, 0.10, 5.0, 22.0, 9017u, sigma);
  return s * uStarScale * pow(uRefExposure / max(expo, 1e-4), 0.82);
}

vec3 lpSunDisc(float nu) {
  if (nu < LP_SUN_COS) return vec3(0.0);
  float x = clamp(sqrt(max(0.0, 1.0 - nu * nu)) / LP_SUN_SIN, 0.0, 1.0);
  float m = sqrt(max(0.0, 1.0 - x * x));
  float limb = 1.0 - 0.56 * (1.0 - m) - 0.22 * (1.0 - m * m);
  return vec3(1.0, 0.985, 0.95) * limb * uSunDiscScale;
}

// airglow shell: emission along the part of the ray inside [alt - hw, alt + hw] (vertical path = LP_AG_RAD)
vec3 lpAirglow(float r, float h, float mu, float tMax) {
  vec2 a = lpRaySphere(r, h, mu, LP_AG_ALT + LP_AG_HW);
  if (!(a.x <= a.y) || a.y <= 0.0) return vec3(0.0);
  float len = max(min(a.y, tMax) - max(a.x, 0.0), 0.0);
  vec2 b = lpRaySphere(r, h, mu, LP_AG_ALT - LP_AG_HW);
  if (b.x <= b.y && b.y > 0.0) len -= max(min(b.y, tMax) - max(b.x, 0.0), 0.0);
  return LP_AG_RAD * (max(len, 0.0) / (2.0 * LP_AG_HW));
}

// city light pollution scattered in the lower atmosphere (night, seen from inside the atmosphere).
// Fix round 2 (QQ-07): it lives low over the horizon (long paths through the lit lower air) and the
// sky towards the zenith stays dark (~6 % of the horizon glow); through twilight it is hidden under
// the much brighter twilight sky (blue hour keeps its blue-violet zenith), full once the sun is ~14 deg
// down. uSkyGlow follows the emissive gain of the ground night regime (atmosphere/index.js).
vec3 lpSkyGlow(vec3 up, float mu, float mus) {
  float night = smoothstep(-0.07, -0.24, mus);
  if (night <= 0.0 || uSkyGlow <= 0.0) return vec3(0.0);
  float lon = atan(up.x, up.z), lat = asin(clamp(up.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 0.15915494 + 0.5, 0.5 - lat * 0.31830989);
  float e = textureLod(uLpEmission, uv, 3.5).r * 0.6 + textureLod(uLpEmission, uv, 5.5).r * 0.4;
  float m = max(mu, 0.0);
  float hz = 0.06 + 0.94 * exp(-m * 9.0);
  return vec3(1.0, 0.70, 0.46) * (e * e * uSkyGlow * hz * night);
}

vec3 lpFallbackGround(vec3 up, float mus) {
  vec3 sunT = lpSunTransmittance(LP_R, 0.0, mus);
  vec3 E = (sunT * max(mus, 0.0) + lpIrradianceSH(0.0, mus, vec3(0.0, 0.0, 1.0))) * uLpSunE + uLpNightAmbient;
  return uFallbackAlbedo * E / LP_PI;
}

// froxel aerial perspective: rgb in-scatter (unit sun), a = mean transmittance, camera -> distance t
vec4 lpAp(vec2 uv, float t) {
  float s = sqrt(max(t, 0.0) / uApDmax) * float(${AP_D}) - 1.0;
  float w = clamp((s + 0.5) / float(${AP_D}), 0.5 / float(${AP_D}), 1.0 - 0.5 / float(${AP_D}));
  vec4 a = texture(uApLut, vec3(uv, w));
  if (s < 0.0) { float f = clamp(s + 1.0, 0.0, 1.0); a.rgb *= f; a.a = mix(1.0, a.a, f); }
  return a;
}

// atmosphere-only march segment, absolute radiance (space path)
void lpAtmoSeg(float r, float h, float mu, float mus0, float nu, float ta, float tb, int N, float jitter, float dexp, float k, inout vec3 L, inout vec3 T) {
  if (tb <= ta) return;
  vec3 Ls = vec3(0.0), Ts = vec3(1.0);
  lpIntegrate(r, h, mu, mus0, nu, ta, tb, N, jitter, dexp, Ls, Ts);
  L += T * Ls * uLpSunE * k;
  T *= k < 1.0 ? pow(Ts, vec3(k)) : Ts;
}

void main() {
  vec3 sceneC = texture(tColor, vUv).rgb;
  float depth = texture(tDepth, vUv).r;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);   // near plane: z=1 underflows (far/near=4e9)
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 rd = normalize(uCamRot * vdir);
  bool sky = depth >= 0.9999999;
  float tScene = sky ? 1e30 : (exp2(depth * uLogFar) - 1.0) / max(-vdir.z, 1e-6);
  float r = uCamR, h = uCamH;
  float mu = dot(uCamUp, rd);
  float mus0 = dot(uCamUp, uSunDir);
  float nu = dot(rd, uSunDir);
  float expo = texture(tExposure, vec2(0.5)).r;

  bool fallback = false;
  float tEnd = tScene;
  float muh = lpHorizonMu(r, h);
  if (sky) {
    vec2 tg = lpRaySphere(r, h, mu, 0.0);
    if (mu < 0.0 && tg.x <= tg.y && tg.y > 0.0) { fallback = true; tEnd = max(tg.x, 0.0); }
  }
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  bool inAtmo = tt.x <= tt.y && tt.y > 0.0;
  // cloud interval in front of the scene
  vec4 cl = vec4(0.0, 0.0, 0.0, 1.0);
  float c0 = 0.0, c1 = 0.0;
  bool hasCloud = false;
  if (uCloudsOn > 0.5 && inAtmo) {
    vec2 i0, i1;
    int n = lpCloudIntervals(r, h, mu, max(tt.x, 0.0), min(tt.y, tEnd), i0, i1);
    if (n > 0) {
      c0 = i0.x; c1 = n > 1 ? i1.y : i0.y;
      cl = texture(tCloud, vUv);
      hasCloud = cl.a < 0.9995 || lpMax3(cl.rgb) > 1e-7;
    }
  }
  float k = sky ? 1.0 : uApStrength;
  vec3 L = vec3(0.0), T = vec3(1.0);
  vec3 bg = sceneC;

  if (uInside > 0.5) {
    if (!sky) {
      vec4 apE = lpAp(vUv, tScene);
      if (hasCloud) {
        vec4 a0 = lpAp(vUv, c0), a1 = lpAp(vUv, c1);
        float Tf = pow(a0.a, k);
        vec3 Lb = max(apE.rgb - a1.rgb, 0.0) / max(a1.a, 1e-4) * uLpSunE * k;
        float Tb = pow(clamp(apE.a / max(a1.a, 1e-4), 0.0, 1.0), k);
        L = a0.rgb * uLpSunE * k + Tf * (cl.rgb + cl.a * Lb);
        T = vec3(Tf * cl.a * Tb);
      } else {
        L = apE.rgb * uLpSunE * k;
        T = vec3(pow(apE.a, k));
      }
    } else {
      vec3 sx = uSunDir - uCamUp * mus0;
      float sl = length(sx);
      vec3 sxn = sl > 1e-5 ? sx / sl : normalize(cross(uCamUp, vec3(0.0, 1.0, 0.0)));
      vec3 sy = cross(uCamUp, sxn);
      float azim = abs(atan(dot(rd, sy), dot(rd, sxn)));
      vec3 Lsky = texture(uSkyView, lpSkyViewUV(mu, muh, azim)).rgb * uLpSunE;
      // blue hour chroma (fix round 2): sky pixels only, 1 by day (exposure.js skySaturation)
      if (uSkySat > 1.0) {
        float ly = lpLum(Lsky);
        Lsky = max(vec3(ly) + (Lsky - vec3(ly)) * uSkySat, vec3(0.0));
        // the model's multiply-scattered twilight above the horizon band is nearly neutral; a blue hour
        // reads deep blue-violet there (Z04) while the band over the horizon keeps its orange
        float tk = clamp((uSkySat - 1.0) / 0.75, 0.0, 1.0) * smoothstep(0.03, 0.30, mu);
        Lsky *= mix(vec3(1.0), vec3(0.80, 0.90, 1.50), tk);
      }
      vec3 Tsky;
      if (fallback) {
        // transmittance camera -> ground (Bruneton: ratio of reversed rays)
        vec3 pg = uCamUp * r + rd * tEnd;
        float mug = dot(normalize(pg), rd);
        Tsky = clamp(lpTransmittance(LP_R, 0.0, -mug) / max(lpTransmittance(r, h, -mu), vec3(1e-6)), 0.0, 1.0);
      } else {
        Tsky = mu > muh ? lpTransmittance(r, h, mu) : vec3(0.0);
      }
      if (hasCloud) {
        vec4 a0 = lpAp(vUv, c0), a1 = lpAp(vUv, c1);
        vec3 Lbey = max(Lsky - a1.rgb * uLpSunE, 0.0) / max(a1.a, 1e-3);
        L = a0.rgb * uLpSunE + a0.a * (cl.rgb + cl.a * Lbey);
        T = Tsky * cl.a;
      } else {
        L = Lsky;
        T = Tsky;
      }
    }
  } else if (inAtmo) {
    float t0 = max(tt.x, 0.0), t1 = min(tt.y, tEnd);
    if (t1 > t0) {
      float seg = t1 - t0;
      float jitter = lpIGN(gl_FragCoord.xy, uFrame);
      int N = (sky && !fallback) ? 40 : int(clamp(4.0 + 5.0 * log2(1.0 + seg / 800.0), 4.0, 28.0));
      if (hasCloud) {
        int Na = int(clamp(float(N) * (c0 - t0) / seg + 2.0, 2.0, float(N)));
        lpAtmoSeg(r, h, mu, mus0, nu, t0, c0, Na, jitter, 1.0, k, L, T);
        L += T * cl.rgb; T *= cl.a;
        if (lpMax3(T) > 0.002) {
          int Nb = int(clamp(float(N) * (t1 - c1) / seg + 2.0, 2.0, float(N)));
          lpAtmoSeg(r, h, mu, mus0, nu, c1, t1, Nb, jitter, 1.0, k, L, T);
        }
      } else {
        lpAtmoSeg(r, h, mu, mus0, nu, t0, t1, N, jitter, 1.0, k, L, T);
      }
    }
  }
  if (sky) {
    if (fallback) {
      vec3 pg = uCamUp * r + rd * tEnd;
      vec3 up = normalize(pg);
      bg = lpFallbackGround(up, dot(up, uSunDir));
    } else {
      // stars drown in a bright sky; skip them entirely when invisible
      float skyL = lpLum(L) * expo;
      float starVis = 1.0 / (1.0 + skyL * skyL * 2500.0);
      bg = lpSunDisc(nu) * uLpSunE;
      if (starVis * lpMax3(T) > 0.01) bg += lpStars(rd, expo) * starVis;
    }
    // airglow (night side only: gated by the sun at the ray's closest approach, so the sunlit limb
    // shows no green line above the blue) and city sky glow
    if (!fallback) {
      vec3 pT = uCamUp * r + rd * max(-r * mu, 0.0);
      float agN = 1.0 - smoothstep(-0.06, 0.10, dot(normalize(pT), uSunDir));
      if (agN > 0.0) L += lpAirglow(r, h, mu, 1e30) * agN * (uInside > 0.5 ? T : vec3(1.0));
    }
    if (uInside > 0.5 && !fallback) L += lpSkyGlow(uCamUp, mu, mus0) * (1.0 - smoothstep(2000.0, 20000.0, h));
  }
  vec3 c = L + T * bg;
  // orbit night-side dodge (art-directed HDR dodge, A01 / A02 / §5 shots 01-02): from orbit the
  // exposure is ONE locked day-side baseline; the night side (surface or cloud point with the local sun
  // below ~-1 deg, full below ~-11.5 deg) is lifted to the night-orbit exposure (uDodgeRef), so city
  // lights and the dim relief read next to a correctly exposed day side and look the same in every
  // frame of a turntable. Geometric (per surface point), so it rotates with the planet and never halos
  // like a screen-space local exposure.
  if (uDodgeK > 0.0) {
    float tD = -1.0;
    if (!sky) tD = tScene;
    else if (fallback) tD = tEnd;
    else if (hasCloud) tD = 0.5 * (c0 + c1);
    float boost = clamp(uDodgeRef / max(expo, 1e-4), 1.0, uDodgeMax);
    if (tD <= 0.0 && sky && !fallback) {
      // the shell beyond the limb (airglow, faint night-side scattering) is lifted like the surface
      // below it, judged at the ray's closest approach; stars and the sun disc are not
      vec3 pT = uCamUp * r + rd * max(-r * mu, 0.0);
      float kSky = mix(1.0, boost, smoothstep(-0.02, -0.20, dot(normalize(pT), uSunDir)) * uDodgeK);
      c = L * kSky + T * bg;
    }
    if (tD > 0.0) {
      vec3 pD = uCamUp * r + rd * tD;
      float musD = dot(normalize(pD), uSunDir);
      float kGround = mix(1.0, boost, smoothstep(-0.02, -0.20, musD) * uDodgeK);
      // the cloud layer in front is lifted by the sun at the CLOUD point, shifted by ~4 deg: cloud tops
      // (8-9.5 km) still catch the reddened sun after ground sunset and must not glow like embers
      // along the terminator; the surface behind keeps its own factor
      float kFront = kGround;
      if (hasCloud) {
        vec3 pC = uCamUp * r + rd * (0.5 * (c0 + c1));
        float musC = dot(normalize(pC), uSunDir) + 0.075;
        kFront = mix(1.0, boost, smoothstep(-0.02, -0.20, musC) * uDodgeK);
      }
      c = L * kFront + T * bg * kGround;
    }
  }
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  outColor = vec4(min(c, vec3(60000.0)), 1.0);
}
`;

export function compositeFragment() {
  return atmosphereDefines() + GLSL_MATH + GLSL_HASH + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + GLSL_SKYVIEW + GLSL_CLOUD_INTERVALS + BODY;
}
