// Post-processing shaders for the HDR pipeline. OWNER: atmosphere agent.
// TAA / static accumulation resolve, energy-conserving bloom (13-tap downsample with Karis average
// + tent upsample), exposure metering (log-average + highlight fraction) & adaptation, output with
// local exposure (coarse log-luminance pyramid), AgX/ACES, one display transform and dithering.
import { GLSL_MATH } from './common.glsl.js';

export const TAA_FRAG = GLSL_MATH + /* glsl */`
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform sampler2D tExposure;
uniform mat4 uInvProjNJ;      // current UNjittered inverse projection
uniform mat3 uCamRot;
uniform mat4 uPrevViewProj;   // previous unjittered view-projection, in current render space
uniform vec2 uTexel;
uniform float uBlend;         // weight of the current sample
uniform float uGamma;         // variance clipping width
uniform float uReset;
uniform float uLogFar;
in vec2 vUv;
out vec4 outColor;

float gK;
vec3 tmap(vec3 c) { return c / (1.0 + lpLum(c) * gK); }
vec3 itmap(vec3 c) { return c / max(1.0 - lpLum(c) * gK, 1e-4); }
vec3 toY(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromY(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 clipAABB(vec3 q, vec3 mn, vec3 mx) {
  vec3 pc = 0.5 * (mx + mn);
  vec3 ec = 0.5 * (mx - mn) + 1e-6;
  vec3 v = q - pc;
  vec3 a = abs(v / ec);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? pc + v / m : q;
}
vec3 sampleCatmullRom(sampler2D tex, vec2 uv) {
  vec2 texSize = 1.0 / uTexel;
  vec2 sp = uv * texSize;
  vec2 tp1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 tp0 = (tp1 - 1.0) * uTexel;
  vec2 tp3 = (tp1 + 2.0) * uTexel;
  vec2 tp12 = (tp1 + o12) * uTexel;
  vec3 r = texture(tex, vec2(tp12.x, tp0.y)).rgb * (w12.x * w0.y)
         + texture(tex, vec2(tp0.x, tp12.y)).rgb * (w0.x * w12.y)
         + texture(tex, vec2(tp12.x, tp12.y)).rgb * (w12.x * w12.y)
         + texture(tex, vec2(tp3.x, tp12.y)).rgb * (w3.x * w12.y)
         + texture(tex, vec2(tp12.x, tp3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, vec3(0.0));
}

void main() {
  gK = max(texture(tExposure, vec2(0.5)).r, 1e-4);
  vec3 cur = texture(tCurrent, vUv).rgb;
  if (uReset > 0.5) { outColor = vec4(cur, 1.0); return; }
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  float dmin = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
    vec3 c = toY(tmap(texture(tCurrent, uv).rgb));
    m1 += c; m2 += c * c;
    dmin = min(dmin, texture(tDepth, uv).r);
  }
  vec3 mean = m1 / 9.0;
  vec3 sig = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
  vec4 vp = uInvProjNJ * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 wdir = uCamRot * vdir;
  vec4 pc;
  if (dmin >= 0.9999999) pc = uPrevViewProj * vec4(wdir, 0.0);
  else {
    float w = exp2(dmin * uLogFar) - 1.0;
    pc = uPrevViewProj * vec4(wdir * (w / max(-vdir.z, 1e-6)), 1.0);
  }
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (pc.w <= 0.0 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { outColor = vec4(cur, 1.0); return; }
  vec3 hist = sampleCatmullRom(tHistory, puv);
  vec3 hy = clipAABB(toY(tmap(hist)), mean - uGamma * sig, mean + uGamma * sig);
  vec3 ht = fromY(hy);
  // motion in pixels: more weight on the current frame when reprojection moves far
  float motion = length((puv - vUv) / uTexel);
  float w = clamp(uBlend + motion * 0.01, uBlend, 1.0);
  vec3 res = itmap(mix(ht, tmap(cur), w));
  if (any(isnan(res)) || any(isinf(res))) res = cur;
  outColor = vec4(max(res, vec3(0.0)), 1.0);
}
`;

export const COPY_FRAG = /* glsl */`
uniform sampler2D tSrc;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = vec4(texture(tSrc, vUv).rgb, 1.0); }
`;

// single-channel grey view of a data texture's R channel (debugView 'ao' / 'aoRaw': the ambient
// occlusion as the §6 material channel, 1 = unoccluded white, written as is: no tone map, no OETF)
export const GREY_FRAG = /* glsl */`
uniform sampler2D tSrc;
in vec2 vUv;
out vec4 outColor;
void main() { float v = clamp(texture(tSrc, vUv).r, 0.0, 1.0); outColor = vec4(v, v, v, 1.0); }
`;

// copy of a sub-rectangle (uv = vUv * uRect.xy + uRect.zw), nearest texel: capture tiles drop their
// guard band (overscan) exactly on the texel grid
export const CROP_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec4 uRect;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 sz = vec2(textureSize(tSrc, 0));
  vec2 uv = vUv * uRect.xy + uRect.zw;
  outColor = vec4(texelFetch(tSrc, clamp(ivec2(uv * sz), ivec2(0), ivec2(sz) - 1), 0).rgb, 1.0);
}
`;

export const BLOOM_DOWN_FRAG = GLSL_MATH + /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uSrcTexel;
uniform float uKaris;
uniform float uClampLum;
in vec2 vUv;
out vec4 outColor;
vec3 s(vec2 o) {
  vec3 c = texture(tSrc, vUv + o * uSrcTexel).rgb;
  float l = lpLum(c);
  return l > uClampLum ? c * (uClampLum / l) : c;
}
float kw(vec3 c) { return 1.0 / (1.0 + lpLum(c)); }
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 o;
  if (uKaris > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = vec4(o, 1.0);
}
`;

export const BLOOM_UP_FRAG = /* glsl */`
uniform sampler2D tLow;     // upsampled chain (lower resolution)
uniform sampler2D tBase;    // downsample chain at this level
uniform vec2 uLowTexel;
uniform float uScatter;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 t = uLowTexel;
  vec3 c = texture(tLow, vUv).rgb * 4.0;
  c += (texture(tLow, vUv + vec2(t.x, 0.0)).rgb + texture(tLow, vUv - vec2(t.x, 0.0)).rgb + texture(tLow, vUv + vec2(0.0, t.y)).rgb + texture(tLow, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(tLow, vUv + t).rgb + texture(tLow, vUv - t).rgb + texture(tLow, vUv + vec2(t.x, -t.y)).rgb + texture(tLow, vUv + vec2(-t.x, t.y)).rgb;
  c *= 1.0 / 16.0;
  outColor = vec4(mix(texture(tBase, vUv).rgb, c, uScatter), 1.0);
}
`;

// Metering input, mipmapped down to 1x1 (global) and read at a coarse level by the output pass
// (local exposure). R = sum(w * log2 L) and G = sum(w) over lit pixels; B = sum(w * highlight) where
// highlight = the pixel would sit deep in the shoulder at the physically expected exposure;
// A = sum(w) over all pixels. w = gentle centre weight.
export const LUM_FRAG = GLSL_MATH + /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uSrcTexel;
uniform float uPriorExposure;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv + vec2(-1.5, -1.5) * uSrcTexel).rgb + texture(tSrc, vUv + vec2(1.5, -1.5) * uSrcTexel).rgb
         + texture(tSrc, vUv + vec2(-1.5, 1.5) * uSrcTexel).rgb + texture(tSrc, vUv + vec2(1.5, 1.5) * uSrcTexel).rgb;
  float l = min(lpLum(c * 0.25), 4000.0);
  vec2 d = (vUv - 0.5) * vec2(1.6, 1.0);
  float wc = mix(0.45, 1.0, exp(-dot(d, d) * 3.0));
  float lit = l > 1e-5 ? 1.0 : 0.0;
  float lg = log2(max(l, 1e-5));
  float hi = smoothstep(2.0, 6.0, l * uPriorExposure);
  outColor = vec4(lg * wc * lit, wc * lit, hi * wc, wc);
}
`;

// Exposure = physically motivated prior (CPU: key illuminance of the view, day side / night side /
// ground) + gentle metered corrections: dark scenes in daylight (interiors) brighten up to uUpCap EV,
// bright scenes darken a little, and a highlight fraction protects sunset skies / bright decks.
export const ADAPT_FRAG = /* glsl */`
uniform sampler2D tLum;
uniform float uLumLod;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uReset;
uniform float uMinEV;
uniform float uMaxEV;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uKey;
uniform float uFixed;     // > 0: fixed exposure (no metering)
uniform float uPhysEV;
uniform float uUpCap;
uniform float uMeterK;    // weight of the metered corrections (0 from orbit: locked baseline)
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 m = textureLod(tLum, vec2(0.5), uLumLod);
  float avgLog = m.g > 1e-7 ? m.r / m.g : -16.0;
  float hiFrac = m.a > 1e-7 ? m.b / m.a : 0.0;
  float evMeter = log2(uKey) - avgLog;
  float dEv = evMeter - uPhysEV;
  float up = clamp(dEv, 0.0, uUpCap) * 0.6;
  float down = max(min(dEv, 0.0) * 0.25, -0.6);
  float hiCorr = -2.0 * smoothstep(0.01, 0.20, hiFrac);
  float ev = clamp(uPhysEV + (up + down + hiCorr) * uMeterK, uMinEV, uMaxEV);
  if (uFixed > 0.0) ev = log2(uFixed);
  float prev = texture(tPrev, vec2(0.5)).g;
  float speed = ev > prev ? uSpeedUp : uSpeedDown;
  float a = uReset > 0.5 ? 1.0 : 1.0 - exp(-uDt * speed);
  float e = mix(prev, ev, a);
  outColor = vec4(exp2(e), e, ev, avgLog);
}
`;

export const OUTPUT_FRAG = GLSL_MATH + /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform sampler2D tLum;
uniform float uBloom;
uniform float uUserExposure;
uniform float uLocal;        // local exposure strength (0 = off)
uniform float uLocalLod;
uniform int uToneMap;        // 0 AgX (with look), 1 ACES (Hill fit)
uniform float uOrbitLook;    // 0..1 weight of the orbit look (exposure lockK: views of the disc from space)
uniform float uFrame;
uniform vec4 uBloomUv;       // capture tiles: overview uv = vUv * xy + zw
in vec2 vUv;
out vec4 outColor;

// AgX (Troy Sobotka) - Benjamin Wrensch's polynomial fit
const mat3 AGX_IN = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                         0.0784335999999992, 0.878468636469772, 0.0784336,
                         0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_OUT = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                          -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                          -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// orbit look (fix round 3, QQ-14: the locked orbit day disc read grey / dull): midtone contrast above the
// land level (log slope x1.14 per EV above LP_ORBIT_PIVOT; below it a dip of <= 0.1 EV that returns to 0, so
// the deep shadows and the dodged night side keep their exposure), saturation 1.20 -> 1.32, and a soft
// display shoulder from 0.84 so the brightest cloud tops / glints stay below white (<= ~245 sRGB, no
// clipping). The pivot is in exposed linear log2 (land p50 ~ -1.8 EV at the locked baseline).
#define LP_ORBIT_PIVOT (-2.0)
#define LP_ORBIT_W 2.0
#define LP_ORBIT_K 1.14
#define LP_ORBIT_SAT 1.32
#define LP_ORBIT_SH0 0.84
vec3 agx(vec3 c) {
  const float minEv = -12.47393, maxEv = 4.026069;
  c = AGX_IN * max(c, vec3(0.0));
  c = clamp(log2(max(c, vec3(1e-10))), minEv, maxEv);
  if (uOrbitLook > 0.0) {
    vec3 u = c - LP_ORBIT_PIVOT;
    vec3 s = mix(u * exp(min(u, 0.0) / LP_ORBIT_W), u, step(0.0, u));
    c = clamp(c + (uOrbitLook * (LP_ORBIT_K - 1.0)) * s, minEv, maxEv);
  }
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  // look: gentle punch (between AgX base and Blender "punchy")
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, vec3(0.0)), vec3(1.10));
  c = luma + mix(1.20, LP_ORBIT_SAT, uOrbitLook) * (c - luma);
  if (uOrbitLook > 0.0) {
    vec3 t = max(c - LP_ORBIT_SH0, 0.0) * (1.0 / (1.0 - LP_ORBIT_SH0));
    c = mix(c, min(c, LP_ORBIT_SH0 + (1.0 - LP_ORBIT_SH0) * tanh(t)), uOrbitLook);
  }
  c = AGX_OUT * c;
  return clamp(pow(max(c, vec3(0.0)), vec3(2.2)), 0.0, 1.0);   // back to linear Rec.709
}
vec3 aces(vec3 c) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = ACESIn * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
vec3 srgbOETF(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec2 ouv = vUv * uBloomUv.xy + uBloomUv.zw;
  vec3 c = texture(tColor, vUv).rgb;
  if (uBloom > 0.0) c = mix(c, texture(tBloom, ouv).rgb, uBloom);
  vec4 ex = texture(tExposure, vec2(0.5));
  float e = ex.r * uUserExposure;
  // local exposure (dodge & burn on a very coarse log-luminance grid): large regions far darker
  // than the frame average are lifted (the night side next to a lit crescent, a dark canyon under
  // a bright sky), far brighter ones gently compressed; a +-1 EV dead zone leaves normal scenes alone
  if (uLocal > 0.0) {
    vec4 lm = textureLod(tLum, ouv, uLocalLod);
    if (lm.g > 1e-5) {
      float dl = lm.r / lm.g - ex.a;
      float evL = 0.30 * max(0.0, -dl - 1.5) - 0.25 * max(0.0, dl - 1.0);
      e *= exp2(clamp(evL, -0.9, 0.9) * uLocal);
    }
  }
  c *= e;
  c = uToneMap == 1 ? aces(c * 0.8) : agx(c);
  c = srgbOETF(c);
  // triangular dither, 1 LSB
  float n1 = lpIGN(gl_FragCoord.xy, uFrame), n2 = lpIGN(gl_FragCoord.xy + 17.0, uFrame + 3.0);
  c += (n1 + n2 - 1.0) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
