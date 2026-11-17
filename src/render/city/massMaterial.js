// Far facade material for the city mass models (one material per city tile, shared program).
// OWNER: city agent.
//
// MeshStandardMaterial + planet lighting patch + this onBeforeCompile:
//  * facades: storey lines, slab bands, window grid with reveal shadow / sill highlight (depth cue),
//    ceramic / curtain-wall / insulated / utility panel looks by style id (kit STYLE_ID), shopfronts,
//    glazed lobbies, blank party walls, plinth, parapet coping; analytic filtering: when the window
//    grid is unresolved (window period < ~2.5 px) the facade blends to its EXACTLY box-filtered zone
//    composite (fix round 3): spandrels / slab bands / mullions / window reveals stay as filtered
//    storey and bay pulses (no flat grey box at 2–6 km), reveal + mullion depth hide glass with the
//    view angle, glass towers by family (massBuild.js farFamily: white 'banded' / silver / round, as
//    office.js), per-building ceramic / glass tones;
//  * specular: coated curtain glass F0 0.2–0.3 (tinted per building), aluminium, ceramic by coverage;
//    the environment reflection is mixed with a city / street reflection (cityReflect, the far twin
//    of the kit's BK_CURTAIN layers): low floors mirror the neighbours, high floors the sky;
//  * roofs: vertex colour = the terrain texture's roof albedo (massBuild.roofAlbedo) → seamless with
//    the texture-only city it replaces;
//  * night: window lights from world/occupancy.js OCCUPANCY_GLSL windowLitMinute(hash, floor, bay,
//    minute, profile) with the kit's (floor, bay) convention → identical to the near windows;
//  * per-building state texture (R mass visibility, G highlight, B size/2 m): dithered fade-in by
//    projected size and dithered cross-fade against detailed buildings (TAA resolves the dither);
//  * debug: uCityDebug 1 objectId (stable colour per building hash), 2 lod (mass = blue).
import * as THREE from 'three';
import { OCCUPANCY_GLSL } from '../../world/occupancy.js';

export const CITY_UNIFORMS = {
  uCityK: { value: 1400 },            // pixels per unit of (size / distance)
  uCityFadePx: { value: new THREE.Vector2(1.6, 4.0) },
  // camera distance band (m) over which mass models dissolve before the streaming radius ends
  // (tall towers would otherwise pop at the edge of the streamed disc)
  uCityMaxDist: { value: new THREE.Vector2(16000, 18500) },
  uCityFrame: { value: 0 },
  uCityDebug: { value: 0 },
  uCityHover: { value: new THREE.Color(0.55, 0.85, 1.0) },
};

const VERT_PARS = /* glsl */`
attribute vec4 facade;
attribute vec4 facadeId;
attribute float bidx;
attribute vec4 mcolor;
uniform sampler2D uCityState;
uniform float uCityStateW;
uniform float uCityK;
uniform vec2 uCityFadePx;
uniform vec2 uCityMaxDist;
varying vec4 vCFac;
varying vec4 vCFacId;
varying vec4 vCCol;
varying vec2 vCUv;
varying vec3 vCWorld;
varying vec3 vCNormalW;
varying float vCFade;
varying float vCHi;
`;
// per-building seat offset (state A): the far city sits on the DISPLAYED terrain (coarse tiles may
// be metres above / below the true ground the buildings are planned on); animated, ~0 near the camera
const VERT_SEAT = /* glsl */`
vec4 cityS;
{
  int bi = int(bidx + 0.5);
  int sw = int(uCityStateW);
  cityS = texelFetch(uCityState, ivec2(bi - (bi / sw) * sw, bi / sw), 0);
  { float q = cityS.a * (255.0 / 127.5) - 1.0; transformed.y += 250.0 * sign(q) * q * q; }   // tiles.js encodeSeat (SEAT_MAX 250)
}
`;
const VERT_MAIN = /* glsl */`
{
  vec4 cw = modelMatrix * vec4(transformed, 1.0);
  vCWorld = cw.xyz;
  vCNormalW = normalize(mat3(modelMatrix) * objectNormal);
  vCFac = facade; vCFacId = facadeId; vCCol = mcolor; vCUv = uv;
  vec4 S = cityS;
  float size = S.b * 510.0 + 2.0;
  float cd = length(cw.xyz);
  float px = size * uCityK / max(cd, 1.0);
  vCFade = smoothstep(uCityFadePx.x, uCityFadePx.y, px) * S.r * (1.0 - smoothstep(uCityMaxDist.x, uCityMaxDist.y, cd));
  vCHi = S.g;
}
`;

const FRAG_PARS = /* glsl */`
varying vec4 vCFac;
varying vec4 vCFacId;
varying vec4 vCCol;
varying vec2 vCUv;
varying vec3 vCWorld;
varying vec3 vCNormalW;
varying float vCFade;
varying float vCHi;
uniform float uCityFrame;
uniform float uCityDebug;
uniform vec3 uCityHover;
#ifndef LP_PATCHED
uniform vec3 uSunDir;
uniform vec3 uPlanetCenter;
#define CITY_ES 0.05
#else
#define CITY_ES uLpEmissiveScale
#endif
${OCCUPANCY_GLSL}
float cityIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float cityDither() { return cityIGN(gl_FragCoord.xy + vec2(mod(uCityFrame, 64.0) * 7.0, mod(uCityFrame, 37.0) * 13.0)); }
uint cityH(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float cityR(uint h) { return float(h & 0xffffffu) / 16777216.0; }
float cityLocalHour(vec3 wp) {
  vec3 p = wp - uPlanetCenter;
  float lon = atan(p.x, p.z), slon = atan(uSunDir.x, uSunDir.z);
  return mod(12.0 + (lon - slon) * 3.81971863, 24.0);
}
vec3 cityHue(float h) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return k; }
// window layout of a ground-storey cell. returns (wx half width frac, y0, y1, kind) kind 0 plain, 1 shop, 2 lobby, 3 curtain
vec4 cityWinLayout(float sid, float fl, int flags, float r) {
  bool zr = sid < 2.5 || sid > 5.5;
  if ((flags & 2) != 0 && fl < 0.5) return vec4(0.46, 0.06, 0.78, 1.0);
  if ((flags & 8) != 0 && fl < 0.5) return vec4(r < 0.5 ? 0.43 : 0.3, 0.04, 0.82, 2.0);
  if (sid > 4.5 && sid < 5.5) return vec4(0.47, 0.1, 0.93, 3.0);           // zr_glass curtain wall
  if (sid > 3.5 && sid < 4.5) return vec4(0.17, 0.42, 0.78, 0.0);          // o_utility small high windows
  if (sid > 2.5 && sid < 3.5) return vec4(0.21, 0.3, 0.8, 0.0);            // zr_cold
  if (zr) return vec4(r < 0.45 ? 0.44 : r < 0.8 ? 0.31 : 0.2, 0.15, 0.92, 0.0);
  return vec4(0.2, 0.32, 0.8, 0.0);
}
// ---- far facade (fix round 3, C1): storey / bay structure as EXACTLY box-filtered periodic pulses, so bands,
// spandrels, mullions and window reveals survive into the distance and average correctly once sub-pixel
// (no flat grey box beyond the window-grid resolution). x in periods, w = filter width in periods.
float cityF0k(float k) { return k > 2.5 && k < 3.5 ? 0.14 : (k > 1.5 && k < 2.5 ? 0.5 : 0.04); }
float cityPI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x) - a, 0.0, b - a); }
float cityPulse(float x, float w, float a, float b) {
  if (b <= a + 1e-5) return 0.0;
  w = max(w, 1e-3);
  return clamp((cityPI(x + 0.5 * w, a, b) - cityPI(x - 0.5 * w, a, b)) / w, 0.0, 1.0);
}
// zones of an UPPER storey (fractions of the storey above its floor level) per facade family:
//   Z = (window rows start, end, low band end, high band start)   bands [0, Z.z) / [Z.w, 1) span the full width
//   K = (window half width as a fraction of the bay (mean over bays), reveal / mullion depth m, low band kind,
//        high band kind)   kinds: 0 wall, 1 white ceramic, 2 silver aluminium, 3 dark aluminium, 4 slab shadow line
//   returns the top of the balcony glass-rail zone (0 = none)
// Glass towers follow buildings/types/office.js (curtain spandrel 1.1 m white 'banded' / 0.9 m silver / 0.75 m
// round + slab ring bands); zr ceramic blocks the kit's punched windows + balcony bands.
float cityZones(float sid, int flags, int fam, int prof, float fh, float bw, out vec4 Z, out vec4 K) {
  bool bands = (flags & 4) != 0;
  float mull = 0.5 - 0.035 / bw;
  if (sid > 4.5 && sid < 5.5) {
    if (fam == 1) { Z = vec4(0.44 / fh, 1.0 - 1.1 / fh, 0.44 / fh, 1.0 - 1.1 / fh); K = vec4(mull, 0.2, 1.0, 1.0); return 0.0; }
    if (fam == 2) { Z = vec4(0.12 / fh, 1.0 - 0.9 / fh, 0.12 / fh, 1.0 - 0.9 / fh); K = vec4(mull, 0.2, 2.0, 2.0); return 0.0; }
    if (fam == 3) { Z = vec4(0.26 / fh, 1.0 - 0.75 / fh, 0.26 / fh, 1.0 - 0.75 / fh); K = vec4(mull, 0.2, 1.0, 1.0); return 0.0; }
    if (prof == 0) {   // glass-language housing (residential towers): tall windows in white ceramic, balcony bands
      Z = vec4(0.12, 0.93, bands ? 0.11 : 0.035, 1.0); K = vec4(0.43, 0.22, bands ? 1.0 : 4.0, 0.0); return bands ? 0.42 : 0.0;
    }
    // offices / research blocks: curtain wall, white bullnose slab band, dark aluminium spandrel
    if (bands) { Z = vec4(0.36 / fh, 1.0 - 0.85 / fh, 0.36 / fh, 1.0 - 0.85 / fh); K = vec4(mull, 0.18, 1.0, 3.0); return 0.0; }
    Z = vec4(0.1, 0.93, 0.1, 0.93); K = vec4(mull, 0.18, 2.0, 2.0); return 0.0;
  }
  if (sid > 3.5 && sid < 4.5) { Z = vec4(0.42, 0.78, 0.035, 1.0); K = vec4(0.17, 0.15, 4.0, 0.0); return 0.0; }
  if (sid > 2.5 && sid < 3.5) { Z = vec4(0.3, 0.8, 0.035, 1.0); K = vec4(0.21, 0.35, 4.0, 0.0); return 0.0; }
  // zr ceramic family: per-bay window widths 0.44 / 0.31 / 0.2 (45 / 35 / 20 %) → mean 0.3465
  Z = bands ? vec4(0.16, 0.93, 0.11, 1.0) : vec4(0.15, 0.92, 0.035, 1.0);
  K = vec4(0.3465, 0.25, bands ? 1.0 : 4.0, 0.0);
  return bands ? 0.42 : 0.0;
}
#ifdef LP_PATCHED
// Street / city reflection of a facade (fix round 3, C1; the far-LOD twin of the kit's BK_CURTAIN layers in
// buildings/materials.js bkStreetReflect): the reflected ray r from height hz (m above the street) meets a near
// and a far ring of neighbouring buildings (statistical skyline scaled to this building's height Hb: a tower
// stands among towers, a 4-storey block among blocks; 25 / 35 % gaps), the streets / roofs below, else the
// sky (environment map). Analytic expectation over the panes under the pixel: low floors mirror the city,
// high floors the sky. Returns radiance (scene units) + coverage.
vec4 cityReflect(vec3 r, vec3 up, float hz, float seed, float Hb) {
  float sE = dot(r, up);
  vec3 rh = r - up * sE; float lh = length(rh);
  if (lh < 0.05) return vec4(0.0);
  rh /= lh;
  float tanE = clamp(sE / lh, -20.0, 20.0);
  float Hm = clamp(Hb * 0.8, 12.0, 260.0);          // neighbours: mostly lower than a tower, like a block's
  float D1 = (0.35 + 0.25 * fract(seed * 3.7)) * clamp(Hm, 30.0, 200.0), D2 = D1 * (2.3 + 0.6 * fract(seed * 7.1));
  float pG = tanE < -1e-4 ? hz / -tanE : 1e9;       // horizontal distance where the ray reaches the street
  float y1 = hz + D1 * tanE, y2 = hz + D2 * tanE;
  float c1 = 0.75 * clamp((Hm - y1) / (0.8 * Hm), 0.0, 1.0) * smoothstep(0.6 * D1, D1, pG);
  float c2 = 0.65 * clamp((1.2 * Hm - y2) / (0.9 * Hm), 0.0, 1.0) * smoothstep(0.6 * D2, D2, pG);
  float cg = 1.0 - smoothstep(-0.03, 0.0, tanE);
  vec3 L = normalize(uSunDir);
  vec3 Ev = lpSkyIrradianceN(-rh) + lpSunIrradiance() * max(dot(-rh, L), 0.0) * 0.6;     // facades facing back
  vec3 Eg = lpSkyIrradianceN(up) * 0.8 + lpSunIrradiance() * max(dot(up, L), 0.0) * 0.5;  // streets / roofs
  float nightK = 1.0 - smoothstep(-0.02, 0.06, dot(up, L));
  vec3 bld = vec3(0.36, 0.365, 0.37) * Ev * 0.3183 + vec3(1.0, 0.76, 0.5) * 0.12 * CITY_ES * nightK;
  vec3 grd = vec3(0.2, 0.195, 0.19) * Eg * 0.3183 + vec3(1.0, 0.8, 0.6) * 0.05 * CITY_ES * nightK;
  float a1 = c1, a2 = (1.0 - c1) * c2, a3 = (1.0 - c1) * (1.0 - c2) * cg;
  float cov = a1 + a2 + a3;
  vec3 col = (a1 * bld + a2 * bld * 0.9 + a3 * grd) / max(cov, 1e-4);
  return vec4(col, cov);
}
#endif
`;

// replaces diffuseColor / sets roughness & emissive inputs. Runs after <color_fragment>.
const FRAG_COLOR = /* glsl */`
float cityRough = 0.75;
vec3 cityEmit = vec3(0.0);
float cityGlass = 0.0;
// specular override of facades (after <lights_physical_fragment>): F0 of coated glass / aluminium / ceramic by
// coverage; cityReflW > 0 → the environment reflection is mixed with the city reflection (cityReflect)
vec3 cityF0 = vec3(0.04);
float cityF0W = 0.0;
float cityReflW = 0.0;
float citySeed = 0.5;
float cityHb = 20.0;
{
  if (vCFade < 0.999 && cityDither() >= vCFade) discard;
  vec3 alb;
  uint bh = (uint(vCFacId.x + 0.5) << 16u) | uint(vCFacId.y + 0.5);
  if (vCFac.x < 1.0) {
    // ---- roof (terrain-matched colour) ----
    alb = vCCol.rgb;
    cityRough = 0.82;
  } else {
    float fh = max(vCFac.x * 0.01, 2.4), bw = max(vCFac.y * 0.01, 1.2), sid = vCFac.z, gh = max(vCFac.w * 0.01, 2.4);
    float eave = (vCFacId.z - 1000.0) * 0.1;
    int flags = int(vCFacId.w + 0.5);
    int prof = (flags >> 4) & 7;
    int fam = (flags >> 10) & 3;            // city far family (massBuild.js farFamily)
    float u = vCUv.x, v = vCUv.y;
    bool zr = sid < 2.5 || sid > 5.5;
    bool glassy = sid > 4.5 && sid < 5.5;
    bool util = sid > 3.5 && sid < 4.5;
    bool cold = sid > 2.5 && sid < 3.5;
    // per-building tones: ceramic warmth, glass tint and lightness, small albedo variation (varied skyline)
    float tw = cityR(cityH(bh ^ 0x51edu));
    float tg = cityR(cityH(bh ^ 0x2c1bu));
    float tl = cityR(cityH(bh ^ 0x7a31u));
    float tv = 0.94 + 0.09 * cityR(cityH(bh ^ 0x19f3u));
    vec3 wallC = util ? vec3(0.86, 0.86, 0.84) : cold ? vec3(0.8, 0.81, 0.8) : mix(vec3(0.86, 0.885, 0.9), vec3(0.92, 0.89, 0.83), tw);
    wallC *= tv;
    vec3 whiteC = mix(vec3(0.915, 0.93, 0.945), vec3(0.95, 0.935, 0.9), tw) * mix(1.0, tv, 0.5);   // kit bandTint ceramic
    vec3 siluC = vec3(0.44, 0.46, 0.49) * (0.95 + 0.1 * tl);                                     // matte silver aluminium (+ F0 0.5)
    vec3 darkC = vec3(0.075, 0.08, 0.088);
    bool curtainF = glassy && !(fam == 0 && prof == 0);
    vec3 frameC = curtainF ? siluC : wallC;                     // mullions of curtain walls / wall between windows
    vec3 glassC = vec3(0.05, 0.068, 0.088);
    // glass seen from afar: the room behind (dark); the reflection is the specular term (F0 + city reflection)
    vec3 glassD = (curtainF ? vec3(0.055, 0.064, 0.074) : vec3(0.032, 0.041, 0.05)) * (0.8 + 0.5 * tl);   // lit office ceilings read through
    vec3 gTint = mix(vec3(0.6, 0.79, 1.0), vec3(0.8, 0.88, 0.95), tg);
    vec3 glassF0 = curtainF ? gTint * (0.26 + 0.12 * tl) : vec3(0.085, 0.095, 0.105);
    vec2 fw = max(fwidth(vCUv), vec2(1e-4));
    // pixel footprint (m) along u / v for the box filter (L2 of the screen derivatives)
    vec2 fwf = max(vec2(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(v), dFdy(v)))), vec2(1e-4));
    // resolution of the window grid (0 resolved .. 1 sub-pixel): per-pixel details fade before they alias
    float unres = smoothstep(0.15, 0.5, max(fw.x / bw, fw.y / fh));
    float hour = cityLocalHour(vCWorld);
    int minute = int(floor(hour * 60.0));
    bool blank = (flags & 1) != 0;
    citySeed = fract(float(bh & 0xffffu) * 0.0001373 + float(bh >> 16u) * 0.0000171);
    cityHb = max(eave, 6.0);
    // view / sun geometry of the facade (render space: the camera is at the origin)
    vec3 cN = normalize(vCNormalW);
    vec3 cV = normalize(-vCWorld);
    vec3 cUp = normalize(vCWorld - uPlanetCenter);
    vec3 cT = cross(cUp, cN); float ltn = length(cT); cT = ltn > 1e-3 ? cT / ltn : vec3(1.0, 0.0, 0.0);
    float vn = max(dot(cV, cN), 0.08);
    float tanH = min(abs(dot(cV, cT)) / vn, 6.0), tanV = min(abs(dot(cV, cUp)) / vn, 6.0);
    vec3 cL = normalize(uSunDir);
    float dayK = smoothstep(-0.05, 0.1, dot(cUp, cL));
    vec3 sideN = cT * (dot(cV, cT) >= 0.0 ? 1.0 : -1.0);      // reveal / mullion face seen by the camera
    float sunF = max(dot(cN, cL), 0.0), sunS = max(dot(sideN, cL), 0.0);
    float revShade = mix(0.6, 0.8 * clamp((0.3 + 1.2 * sunS) / (0.3 + 1.2 * sunF), 0.45, 1.6), dayK);
    if (v < 0.35) {
      alb = vec3(0.5, 0.49, 0.47);                       // plinth / base course
      cityRough = 0.9;
    } else if (v > eave + 0.02) {
      alb = mix(wallC * 0.97, vec3(0.78, 0.79, 0.8), step(eave + 0.12, v) * step(v, eave + 0.3)); // parapet + coping line
    } else if (blank && vCFac.y > 5.0 && v >= gh) {
      // sky-garden / refuge storey (kit mass flag 1 WITH a bay width, buildings-z towers; mirrors the kit
      // MASS_FRAG): white slab edge, glass rail, planting crowns, shaded set-back, white soffit
      float fv = fract((v - gh) / fh);
      float n1 = cityR(cityH(bh ^ (uint(floor(u / 2.3)) * 0x27d4eb2du)));
      float n2 = cityR(cityH(bh ^ (uint(floor(u / 0.9)) * 0x165667b1u)));
      float crown = 0.42 + 0.34 * n1 + 0.08 * n2;
      vec3 green = mix(vec3(0.13, 0.24, 0.08), vec3(0.3, 0.42, 0.15), n2) * (0.85 + 0.3 * n1);
      vec3 c = fv < 0.07 ? vec3(0.95, 0.94, 0.92) : fv < 0.13 ? mix(vec3(0.62, 0.7, 0.72), green, 0.5) : fv < crown ? green : fv > 0.9 ? vec3(0.92, 0.91, 0.89) : vec3(0.27, 0.3, 0.3);
      // far: white slab edge / soffit bands stay (filtered), the planted set-back averages
      float xv = (v - gh) / fh, wv = fwf.y / fh;
      float cw = cityPulse(xv, wv, 0.0, 0.07) + cityPulse(xv, wv, 0.9, 1.0);
      vec3 cFar = mix(vec3(0.07, 0.11, 0.06) + green * 0.7, whiteC, cw);
      alb = mix(c, cFar, unres);
      cityRough = 0.85;
    } else if (blank) {
      alb = wallC * 0.93;
      float xv = v / fh, wv = fwf.y / fh;
      alb *= 1.0 - 0.06 * cityPulse(xv, wv, 0.0, 0.03);
    } else {
      float fl = v < gh ? 0.0 : 1.0 + floor((v - gh) / fh);
      float fv = v < gh ? v / gh : fract((v - gh) / fh);
      float fu = fract(u / bw);
      float bay = floor(u / bw);
      float r = cityR(cityH(bh ^ (uint(bay) * 0x9e3779b9u) ^ 0x6a3du));
      vec4 Z, K;
      float railTop = cityZones(sid, flags, fam, prof, fh, bw, Z, K);
      vec4 L;
      if (fl < 0.5) L = cityWinLayout(sid, fl, flags, r);
      else if (curtainF) L = vec4(K.x, Z.x, Z.y, 3.0);
      else if (zr) L = vec4(r < 0.45 ? 0.44 : r < 0.8 ? 0.31 : 0.2, Z.x, Z.y, 0.0);
      else L = vec4(K.x, Z.x, Z.y, 0.0);
      float wx = L.x, wy0 = L.y, wy1 = L.z;
      float winFrac = 2.0 * wx * (wy1 - wy0);
      // ---------------- per-pixel (resolved) look ----------------
      vec3 c = wallC;
      float inWin = 0.0;
      float du = abs(fu - 0.5);
      if (du < wx && fv > wy0 && fv < wy1) {
        inWin = 1.0;
        float wv = (fv - wy0) / (wy1 - wy0);
        float wu = (fu - 0.5 + wx) / (2.0 * wx);
        c = glassC;
        // interior depth cue: curtains / furniture brightness varies per window, darker at the top
        uint wh = cityH(bh ^ cityH(uint(fl) * 0x85ebca6bu + uint(bay)));
        float cur = cityR(wh);
        if (cur > 0.62 && L.w < 0.5) c = mix(c, vec3(0.42, 0.38, 0.33), 0.35 * smoothstep(0.0, 0.25, min(wu, 1.0 - wu) - (cur - 0.62)));
        c *= 0.85 + 0.3 * wv;
        // reveal shadow (lintel + one jamb) and mullions
        float rv = smoothstep(0.88, 0.97, wv) + smoothstep(0.1, 0.0, wu) * 0.6;
        c = mix(c, c * 0.35, clamp(rv, 0.0, 1.0) * (1.0 - unres));
        float nm = L.w > 2.5 ? 2.0 : (wx > 0.35 ? 3.0 : 2.0);
        float mu = fract(wu * nm);
        if ((mu < 0.035 || mu > 0.965 || abs(wv - 0.78) < 0.012) && L.w < 0.5) c = mix(c, vec3(0.62, 0.64, 0.67), 1.0 - unres);
        if (L.w > 2.5 && (mu < 0.02 || mu > 0.98)) c = mix(c, siluC, 1.0 - unres);
        cityGlass = 1.0 - unres;
      } else {
        // sill highlight under the window, storey / slab line, family spandrels and bands
        if (du < wx + 0.03 && fv < wy0 && fv > wy0 - 0.045) c = wallC * 1.06;
        if (fv < 0.035 && fl > 0.5) c = wallC * 0.8;
        if (curtainF) c = frameC;
        if (fl > 0.5) {
          float kb = fv < Z.z ? K.z : fv >= Z.w ? K.w : -1.0;
          if (kb > 0.5) c = kb < 1.5 ? whiteC : kb < 2.5 ? siluC : kb < 3.5 ? darkC : wallC * 0.8;
          if (railTop > 0.0 && fv >= Z.z && fv < railTop) c = mix(c, vec3(0.58, 0.68, 0.72), 0.3);   // glass railing tint
        }
        if (util) { float pj = fract(u / 1.2); if (pj < 0.02) c *= 0.9; }
        if (L.w > 0.5 && L.w < 1.5 && fv > 0.82 && fv < 0.94) c = vec3(0.95);   // shop sign band
      }
      // ---------------- far composite: exactly filtered zones (+ reveal / mullion parallax) ----------------
      vec3 cFar;
      float gAmt;                 // glass coverage
      vec3 specFar;               // coverage-weighted F0
      if (fl > 0.5) {
        float xv = (v - gh) / fh, wvf = fwf.y / fh;
        float xu = u / bw, wuf = fwf.x / bw;
        float shV = min(K.y * tanV / fh, 0.45 * (Z.y - Z.x));
        float shH = min(K.y * tanH / bw, 2.0 * K.x);
        float rowW = cityPulse(xv, wvf, Z.x, Z.y);
        float rowG = cityPulse(xv, wvf, Z.x + 0.4 * shV, Z.y - 0.6 * shV);
        float colW = cityPulse(xu, wuf, 0.5 - K.x, 0.5 + K.x);
        float colG = cityPulse(xu, wuf, 0.5 - K.x + shH, 0.5 + K.x);
        float cG = rowG * colG;                                 // glass seen through the openings
        float cR = max(rowW * colW - cG, 0.0);                  // reveal / mullion side faces seen in them
        float cLo = cityPulse(xv, wvf, 0.0, Z.z), cHi = cityPulse(xv, wvf, Z.w, 1.0);
        float cW = max(1.0 - cG - cR - cLo - cHi, 0.0);
        vec3 lo = K.z < 0.5 ? wallC : K.z < 1.5 ? whiteC : K.z < 2.5 ? siluC : K.z < 3.5 ? darkC : wallC * 0.8;
        vec3 hi = K.w < 0.5 ? wallC : K.w < 1.5 ? whiteC : K.w < 2.5 ? siluC : K.w < 3.5 ? darkC : wallC * 0.8;
        vec3 wallMix = frameC;
        if (railTop > 0.0) wallMix = mix(frameC, mix(frameC, vec3(0.58, 0.68, 0.72), 0.3), clamp(cityPulse(xv, wvf, Z.z, railTop) * (1.0 - colW) / max(cW, 1e-3), 0.0, 1.0));
        cFar = cG * glassD + cR * frameC * revShade + cLo * lo + cHi * hi + cW * wallMix;
        gAmt = cG;
        float fr = curtainF ? 0.5 : 0.04;
        specFar = cG * glassF0 + vec3(cLo * cityF0k(K.z) + cHi * cityF0k(K.w) + (cW + cR) * fr);
      } else {
        // ground storey: shopfronts / lobbies / plain windows, area average
        cFar = mix(wallC, glassD, winFrac);
        gAmt = winFrac;
        specFar = winFrac * glassF0 + vec3((1.0 - winFrac) * (curtainF ? 0.5 : 0.04));
      }
      // night window lights (same (hash, floor, bay) as the near windows)
      float lit = 0.0, temp = 0.0;
      if (unres < 0.999) {
        lit = windowLitMinute(bh, int(fl), int(bay), minute, prof) * inWin;
        temp = windowTemp(bh, int(fl), int(bay));
      }
      float litAvg = 0.0;
      if (unres > 0.001) {
        // area average over the bays / floors under the pixel footprint (8 taps on a rotated grid:
        // smooth patches of lit / dark flats instead of per-pixel blotches)
        for (int k = 0; k < 8; k++) {
          vec2 o = vec2(fract(float(k) * 0.618034) - 0.5, (float(k) + 0.5) / 8.0 - 0.5);
          float uu = u + o.x * max(fw.x * 2.0, bw * 1.5), vv = v + o.y * max(fw.y * 2.0, fh * 1.5);
          float fl2 = vv < gh ? 0.0 : 1.0 + floor((vv - gh) / fh);
          if (vv > eave || vv < 0.0) continue;
          litAvg += 0.125 * windowLitMinute(bh, int(fl2), int(floor(uu / bw)), minute, prof);
        }
        litAvg *= winFrac;
      }
      vec3 lampW = mix(vec3(1.0, 0.64, 0.36), vec3(1.0, 0.86, 0.7), temp);
      // far average: warmer than a single lamp so the mean of many lit rooms keeps its colour
      // through the tone curve (warm residential glow, §1 住宅的细密暖光)
      cityEmit = mix(lampW * lit, vec3(1.0, 0.6, 0.3) * litAvg, unres) * 1.15;
      alb = mix(c, cFar, unres);
      // specular: coated glass / aluminium / glazed ceramic by coverage (near: the pixel's own material)
      float kbN = fl > 0.5 ? (fv < Z.z ? K.z : (fv >= Z.w ? K.w : -1.0)) : -1.0;
      float f0N = inWin > 0.5 ? 0.0 : (kbN > 0.5 ? cityF0k(kbN) : (curtainF ? 0.5 : 0.04));
      vec3 specNear = inWin > 0.5 ? glassF0 : vec3(f0N);
      cityF0 = mix(specNear, specFar, unres);
      cityF0W = 1.0;
      cityReflW = 1.0;
      float gA = mix(inWin, gAmt, unres);
      float mA = clamp((max(max(cityF0.r, cityF0.g), cityF0.b) - 0.04 - gA * 0.2) / 0.46, 0.0, 1.0);
      cityRough = gA * mix(0.05, 0.09, unres) + mA * 0.38 + max(1.0 - gA - mA, 0.0) * mix(0.62, 0.5, unres);
    }
  }
  if (vCHi > 0.3 && vCHi < 0.7) { alb = mix(alb, uCityHover, 0.18); }
  if (uCityDebug > 0.5) {
    if (uCityDebug < 1.5) alb = cityHue(cityR(cityH(bh))) * 0.75 + 0.1;
    else alb = vec3(0.15, 0.35, 1.0);
    cityEmit = alb * 2.0;
    cityF0W = 0.0; cityReflW = 0.0;
  }
  diffuseColor.rgb = alb;
}
`;

// facades: F0 by material coverage (coated curtain glass ≈ 0.2–0.3, aluminium, ceramic) after three's
// MeshStandard set-up (which fixes F0 at 0.04)
const FRAG_SPEC = /* glsl */`
if (cityF0W > 0.0) { material.specularColor = mix(material.specularColor, cityF0, cityF0W); material.specularF90 = 1.0; }
`;
// facades: the environment reflection is mixed with the city / street reflection (after <lights_fragment_maps>)
const FRAG_REFL = /* glsl */`
#if defined( RE_IndirectSpecular ) && defined( LP_PATCHED )
if (cityReflW > 0.001) {
  vec3 cRw = reflect(-normalize(-vCWorld), normalize(vCNormalW));
  vec4 cSR = cityReflect(cRw, normalize(vCWorld - uPlanetCenter), max(vCUv.y, 0.5), citySeed, cityHb);
  cSR.rgb *= lpAO;
  radiance = mix(radiance, cSR.rgb, cSR.a * cityReflW);
}
#endif
`;

const FRAG_ROUGH = /* glsl */`
roughnessFactor = cityRough;
`;
const FRAG_EMIT = /* glsl */`
#ifdef LP_PATCHED
// lit rooms barely read through glass in daylight: soft photometric gate (twilight → full)
totalEmissiveRadiance += cityEmit * CITY_ES * mix(0.08, 1.0, lpNightGate(lpMuS, 0.35));
#else
totalEmissiveRadiance += cityEmit * CITY_ES;
#endif
`;

/**
 * New mass material for a city tile with its own state texture (shared program).
 * @param {object} app
 * @param {THREE.DataTexture} stateTex per-building state (RGBA8, width w)
 */
export function createMassMaterial(app, stateTex, stateW) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
  m.name = 'city:mass';
  const own = { uCityState: { value: stateTex }, uCityStateW: { value: stateW } };
  m.userData.cityUniforms = own;
  m.onBeforeCompile = (sh) => {
    for (const [k, v] of Object.entries(CITY_UNIFORMS)) sh.uniforms[k] = v;
    sh.uniforms.uCityState = own.uCityState;
    sh.uniforms.uCityStateW = own.uCityStateW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SEAT)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMIT)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + FRAG_SPEC)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + FRAG_REFL);
  };
  m.customProgramCacheKey = () => 'city-mass-7';
  try { app?.lighting?.patch?.(m, { nightEmissive: false, receiveCloudShadow: true }); } catch (e) { console.warn('[city] lighting patch failed', e); }
  return m;
}

/**
 * Shadow depth material of a tile's mass models: buildings whose mass is hidden (detailed version
 * shown, state R < 0.5) cast no mass shadow; the distance fade is ignored (shadows stay solid).
 */
export function createMassDepthMaterial(stateTex, stateW) {
  const m = new THREE.MeshDepthMaterial();
  m.name = 'city:mass-depth';
  const own = { uCityState: { value: stateTex }, uCityStateW: { value: stateW } };
  m.userData.cityUniforms = own;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCityState = own.uCityState;
    sh.uniforms.uCityStateW = own.uCityStateW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float bidx;\nuniform sampler2D uCityState;\nuniform float uCityStateW;\nvarying float vCVis;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ int bi = int(bidx + 0.5); int sw = int(uCityStateW); vec4 S = texelFetch(uCityState, ivec2(bi - (bi / sw) * sw, bi / sw), 0); vCVis = S.r; float q = S.a * (255.0 / 127.5) - 1.0; transformed.y += 250.0 * sign(q) * q * q; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCVis;')
      .replace('void main() {', 'void main() {\n  if (vCVis < 0.5) discard;');
  };
  m.customProgramCacheKey = () => 'city-mass-depth-3';
  return m;
}
