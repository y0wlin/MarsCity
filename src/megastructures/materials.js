// Megastructure materials (main thread). OWNER: megastructure agent.
//   mega_concrete / mega_rock / mega_steel / mega_asphalt : MeshStandardMaterial + procedural texture
//       (buildings/kit/texgen, generated in the mega worker) + per-vertex aMega =
//       (height above the local water level, exposure, highest splash line, mooring wear):
//       wet darkening + gloss up to an irregular splash line, intertidal marine growth with
//       barnacle speckle on sea faces, salt bloom above the splash line, rubber scuffs on mooring
//       faces, red dust on dry upward faces and in leeward recesses (uMegaWind).
//   mega_water        : aerated spillway sheet (animated whitewater), lit by the planet model.
//   mega_window(_lit) : dark tinted glass; the lit variant glows warm at night (nightEmissive).
//   mega_grating      : see-through steel bar grating (alpha-tested, double sided).
//   mega_paint_red / mega_paint_green / mega_light_green : navigation paint & lights.
//   mega_screen / mega_chart : harbour-office displays / paper chart (screens.js atlas, generated in a worker).
// Every other key is the building vocabulary (getBuildingMaterial). All materials are patched by
// app.lighting.patch (sun, sky, AO, cloud shadows, night gating; haze is applied by the pipeline).
import * as THREE from 'three';
import { getBuildingMaterial, initBuildingMaterials } from '../buildings/materials.js';

const NOISE_GLSL = /* glsl */`
float megaHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float megaNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(megaHash(i), megaHash(i + vec2(1.0, 0.0)), u.x), mix(megaHash(i + vec2(0.0, 1.0)), megaHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const SURF_VERT_PARS = /* glsl */`
attribute vec4 aMega;
varying vec4 vMega;
varying vec3 vMegaW;
varying vec3 vMegaN;
varying vec2 vMegaUv;
`;
const SURF_VERT = /* glsl */`
vMega = aMega; vMegaUv = uv;
vMegaW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vMegaN = normalize(mat3(modelMatrix) * objectNormal);
`;
const SURF_FRAG_PARS = /* glsl */`
varying vec4 vMega;
varying vec3 vMegaW;
varying vec3 vMegaN;
varying vec2 vMegaUv;
uniform vec3 uMegaPC;
uniform vec3 uMegaWind;
uniform float uMegaDust;
uniform float uMegaGrowth;
uniform float uMegaWetRough;
float megaWet = 0.0;
float megaGrowth = 0.0;
float megaDrops = 0.0;
float megaScuff = 0.0;
${NOISE_GLSL}
`;
const SURF_FRAG_COLOR = /* glsl */`
{
  float h = vMega.x, expo = vMega.y, spl = vMega.z, wear = vMega.w;
  vec3 nW = normalize(vMegaN);
  vec3 upW = normalize(vMegaW - uMegaPC);
  float nUp = dot(nW, upW);
  vec2 q = vMegaUv;
  float n1 = megaNoise(q * vec2(0.31, 0.45) + 3.1);
  float n2 = megaNoise(q * vec2(1.7, 2.3) + 7.7);
  float n3 = megaNoise(q * 6.5 + 1.3);
  float wet = 0.0, growth = 0.0, scour = 0.0;
  // top of the intertidal growth band: sea faces ~1 m, lock / harbour faces thinner
  float gTop = (expo > 0.9 && expo < 1.5 ? 0.95 : expo > 0.6 ? 0.35 : 0.12) + 0.4 * n2 - 0.15;
  if (expo > 0.01) {
    // irregular highest splash line + drip streaks below it
    float line = spl * (0.74 + 0.26 * n1) + 0.18 * sin(q.x * 1.3 + n2 * 2.0);
    wet = 1.0 - smoothstep(line - 0.5, line + 0.2, h);
    float streak = smoothstep(0.58, 0.82, megaNoise(vec2(q.x * 2.6, h * 0.12 + n1)));
    wet = max(wet, (1.0 - smoothstep(line, line + 1.6, h)) * streak * 0.55);
    wet *= 0.75 + 0.25 * n2;
    if (expo > 1.5) wet = max(wet, 0.92);                     // spillway chute: always running wet
    // droplets cling only in the intermittent splash band just below the highest splash line
    float band = smoothstep(line - 2.2, line - 0.6, h) * (1.0 - smoothstep(line - 0.1, line + 0.5, h));
    float dn = megaNoise(q * 46.0 + 17.0) * 0.7 + megaNoise(q * 97.0 + 3.0) * 0.3;
    megaDrops = smoothstep(0.7, 0.8, dn) * band * step(expo, 1.5);
    // intertidal marine growth (sea faces), thinner on lock / harbour faces
    growth = (1.0 - smoothstep(gTop - 0.3, gTop + 0.08, h)) * smoothstep(-7.0, -1.0, h) * step(expo, 1.5) * uMegaGrowth;
    // outer waterline scour band just above the growth: wave-abraded paste, exposed aggregate (§5 09)
    if (expo > 0.6 && expo < 1.5) {
      float sTop = gTop + (expo > 0.9 ? 2.1 : 1.0) + 0.6 * n1;
      scour = smoothstep(gTop - 0.2, gTop + 0.2, h) * (1.0 - smoothstep(sTop - 0.5, sTop + 0.25, h));
    }
  }
  float sub = 1.0 - smoothstep(-0.35, 0.05, h);
  wet = max(wet, sub);
  vec3 col = diffuseColor.rgb;
  col *= mix(1.0, 0.55, wet);
  col = mix(col, vec3(0.085, 0.095, 0.055) * (0.65 + 0.7 * n2), clamp(growth * 0.92, 0.0, 1.0));
  col = mix(col, vec3(0.5, 0.48, 0.43), growth * step(0.8, n3) * 0.55);          // barnacles
  col = mix(col, vec3(0.16, 0.11, 0.06) * (0.7 + 0.6 * n1), growth * (1.0 - smoothstep(-2.5, -0.6, h)) * 0.5);   // brown weed lower down
  if (scour > 0.0) {
    float ag = megaNoise(q * 11.0 + 5.3), ag2 = megaNoise(q * 29.0 + 1.7);
    vec3 agg = mix(vec3(0.6, 0.58, 0.54), vec3(0.26, 0.25, 0.24), step(0.52, ag * 0.6 + ag2 * 0.4));
    col = mix(col, col * 0.72 + agg * 0.3, scour * 0.8);
  }
  // dark tide line along the top of the growth band on sea / lock faces
  float tideL = (1.0 - smoothstep(0.0, 0.16, abs(h - gTop - 0.06))) * step(0.6, expo) * step(expo, 1.5);
  col *= 1.0 - 0.4 * tideL;
  col *= mix(1.0, 0.7, sub);                                                     // submerged parts darker
  col *= 1.0 - 0.35 * megaDrops;
  // salt bloom just above the splash line on sea faces
  if (expo > 0.9 && expo < 1.5) { float sl = h - spl * 0.85; col = mix(col, vec3(0.84, 0.83, 0.79), 0.22 * n1 * smoothstep(0.0, 0.8, sl) * (1.0 - smoothstep(0.8, 4.0, sl))); }
  // berth wear on quay / lock faces (§5 09 内侧系泊面有靠船磨痕): long horizontal black rubber smears and
  // pale scrape marks in the fender band, clustered along the berth; rust streaks below the fittings
  float scuff = 0.0;
  if (wear > 0.01) {
    float band = smoothstep(0.1, 0.7, h) * (1.0 - smoothstep(3.4, 4.8, h));
    float cl = smoothstep(0.3, 0.7, megaNoise(vec2(q.x * 0.07, 1.7)));
    float st1 = megaNoise(vec2(q.x * 0.2, h * 4.5) + 3.0) * 0.7 + megaNoise(vec2(q.x * 1.1, h * 11.0) + 6.0) * 0.3;
    float st2 = megaNoise(vec2(q.x * 0.8, h * 9.0) + 8.0);
    scuff = smoothstep(0.58, 0.82, st1) * cl * band * wear;
    float scrape = smoothstep(0.72, 0.9, st2) * (1.0 - scuff) * cl * band * wear;
    col = mix(col, vec3(0.03, 0.03, 0.034), scuff * 0.85);
    col = mix(col, min(col * 1.3 + 0.04, vec3(0.8)), scrape * 0.45);
    float rs = smoothstep(0.8, 0.95, megaNoise(vec2(q.x * 1.3, 0.0) + 21.0)) * smoothstep(0.5, 5.0, h) * smoothstep(0.35, 0.7, megaNoise(vec2(q.x * 1.3, h * 0.22) + 4.0));
    col = mix(col, vec3(0.3, 0.15, 0.07), rs * wear * 0.35);
  }
  // red dust: dry upward faces and leeward recesses (orm AO = recess)
  float dry = 1.0 - wet;
  float lee = clamp(dot(nW, uMegaWind), 0.0, 1.0);
  float recess = 0.0;
#ifdef USE_AOMAP
  recess = 1.0 - texture2D(aoMap, vAoMapUv).r;
#endif
  // (brief: only a little red dust — leeward sills, bolt recesses; windward edges stay clean)
  float dust = dry * (smoothstep(0.6, 0.97, nUp) * 0.10 + lee * (1.0 - abs(nUp)) * 0.10 + recess * (0.2 + 0.8 * lee) * 0.85) * (0.45 + 0.9 * n1) * uMegaDust;
  col = mix(col, vec3(0.56, 0.34, 0.21), clamp(dust, 0.0, 0.5));
  diffuseColor.rgb = col;
  megaWet = wet; megaGrowth = max(growth, scour * 0.6); megaScuff = scuff;
}
`;
const SURF_FRAG_ROUGH = /* glsl */`
roughnessFactor = mix(roughnessFactor, uMegaWetRough, megaWet * 0.85);
roughnessFactor = mix(roughnessFactor, 0.85, megaGrowth * 0.8);
roughnessFactor = mix(roughnessFactor, 0.035, megaDrops);
roughnessFactor = mix(roughnessFactor, 0.55, megaScuff * 0.7);
`;

const WATER_FRAG_PARS = /* glsl */`
varying vec2 vMegaUv;
uniform float uMegaTime;
float megaFoam = 0.0;
float megaH = 0.0;
${NOISE_GLSL}
`;
// G02 spillway sheet (fix round 2): vertex colour r = aeration (0 glassy … 1 white water), g = pier-wall proximity;
// uv = (across, along) m. Flow-aligned streaks (stretched noise scrolling with the flow, ≈ 6 → 17 m/s), roll-wave
// bands, glassy dark-teal water torn into white streaks around the aeration inception point, full white water with
// grey-blue streak troughs below it, bright pile-up along the piers; the same height field bumps the normal
// (Mikkelsen derivative bump, faded once a streak is sub-pixel) so the sheet catches light like a rough surface.
const WATER_FRAG_COLOR = /* glsl */`
{
  float a = vColor.r, wall = vColor.g;
  vec2 q = vMegaUv;
  float V = mix(6.0, 17.0, a);
  float sl = q.y - uMegaTime * V;
  float st = megaNoise(vec2(q.x * 1.7, sl * 0.09)) * 0.5 + megaNoise(vec2(q.x * 4.3 + 3.1, sl * 0.21)) * 0.3 + megaNoise(vec2(q.x * 11.0 + 7.0, sl * 0.62)) * 0.2;
  float roll = pow(max(0.0, sin(6.2832 * (q.y + 0.35 * q.x - uMegaTime * V * 1.15) / 11.3 + 2.0 * megaNoise(vec2(q.x * 0.3, q.y * 0.05)))), 3.0);
  float fine = megaNoise(vec2(q.x * 23.0, sl * 2.2)) * 0.6 + megaNoise(vec2(q.x * 47.0 + 1.3, sl * 5.0)) * 0.4;
  float cover = smoothstep(0.15, 0.85, a + (st - 0.5) * 0.9 + roll * 0.25 * a + wall * 0.62);
  float foam = clamp(cover * (0.8 + 0.2 * fine) + wall * 0.2 * a, 0.0, 1.0);
  vec3 glassy = mix(vec3(0.012, 0.042, 0.046), vec3(0.03, 0.088, 0.084), st);
  vec3 white = mix(vec3(0.5, 0.58, 0.6), vec3(0.92, 0.94, 0.94), smoothstep(0.25, 0.8, st * 0.55 + fine * 0.35 + roll * 0.35));
  diffuseColor.rgb = mix(glassy, white, foam);
  megaFoam = foam;
  float fw = length(fwidth(q));
  megaH = (st - 0.5) * 0.12 * (0.25 + a) * (1.0 - smoothstep(0.2, 0.9, fw)) + roll * 0.07 * a * (1.0 - smoothstep(2.0, 6.0, fw)) + (fine - 0.5) * 0.025 * a * (1.0 - smoothstep(0.02, 0.1, fw));
}
`;
const WATER_FRAG_NORMAL = /* glsl */`
{
  vec3 megaPx = dFdx(-vViewPosition), megaPy = dFdy(-vViewPosition);
  float megaHx = dFdx(megaH), megaHy = dFdy(megaH);
  vec3 megaR1 = cross(megaPy, normal), megaR2 = cross(normal, megaPx);
  float megaDet = dot(megaPx, megaR1);
  vec3 megaG = sign(megaDet) * (megaHx * megaR1 + megaHy * megaR2);
  normal = normalize(abs(megaDet) * normal - megaG);
}
`;

const SCREEN_TEX = 'mega_screens';
const SCREEN_EMISSIVE = 2.6;           // lighting unit (1.0 = one lit window): a monitor page reads indoors at dusk
const NO_SHADOW = new Set(['mega_chart', 'mega_dust', 'mega_deposit', 'mega_water', 'mega_window', 'mega_window_lit', 'mega_light_green', 'mega_screen', 'mega_lightpool', 'mega_lightpool_cool', 'light_warm', 'light_red', 'light_cyan', 'glass_clear', 'glass_railing']);

function makeDataTex(arr, size, srgb, repeat) {
  const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 16; t.flipY = false;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

/** see-through bar grating (30×100 mm mesh) 64×64 RGBA tile = 0.6 m */
function gratingTexture() {
  const N = 64, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const bar = (x % 4) < 1 || (y % 16) < 1;
    const o = (y * N + x) * 4;
    d[o] = 150; d[o + 1] = 152; d[o + 2] = 150; d[o + 3] = bar ? 255 : 0;
  }
  return makeDataTex(d, N, true, 1 / 0.6);
}

// albedo = target mean linear albedo of the surface; the material colour is albedo / (mean linear
// value of its texture) once the texture is installed (flat albedo before), so the precast caisson
// concrete reads pale grey-white as in the G01 / G02 references whatever the texture's own tone.
const SURFACES = {
  mega_concrete: { tex: 'concrete', albedo: [0.56, 0.565, 0.565], rough: 1.0, metal: 0, ns: 0.9, wet: 0.24 },
  mega_rock: { tex: 'stone', albedo: [0.2, 0.182, 0.168], rough: 1.0, metal: 0, ns: 1.4, m: 2.6, wet: 0.38 },
  mega_steel: { tex: 'paint', albedo: [0.07, 0.085, 0.1], rough: 0.9, metal: 0.35, ns: 0.5, wet: 0.2 },
  mega_asphalt: { tex: 'gravel', albedo: [0.105, 0.1, 0.095], rough: 1.0, metal: 0, ns: 0.6, m: 1.6, wet: 0.3 },
  // G02 switchback roads: pale dusty gravel-concrete pavement (reads on the red slopes as in the G02 reference),
  // sunk a little with camera distance (up to 3 m beyond ~5 km) so a road on its carved bench never floats
  // above the band-limited (coarser) terrain tiles seen from afar
  mega_road: { tex: 'gravel', albedo: [0.34, 0.33, 0.31], rough: 1.0, metal: 0, ns: 0.6, m: 1.6, wet: 0.3, offset: '-clamp((megaCd - 900.0) * 0.0006, 0.0, 3.0)' },
};
/** vertex placement with a distance-dependent offset along the local vertical (render space) */
const projectOffset = (expr) => /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
vec4 megaWp0 = modelMatrix * mvPosition;
float megaCd = length( megaWp0.xyz - cameraPosition );
megaWp0.xyz += normalize( megaWp0.xyz - uMegaPC ) * ( ${expr} );
mvPosition = viewMatrix * megaWp0;
gl_Position = projectionMatrix * mvPosition;
`;
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** mean linear RGB of an sRGB8 RGBA texture (sampled) */
function meanLinear(arr) {
  const n = arr.length / 4, step = Math.max(1, Math.floor(n / 16384));
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < n; i += step) { r += srgbToLin(arr[i * 4] / 255); g += srgbToLin(arr[i * 4 + 1] / 255); b += srgbToLin(arr[i * 4 + 2] / 255); k++; }
  return [r / k || 1, g / k || 1, b / k || 1];
}

export class MegaMaterials {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.textures = new Map();
    this.uniforms = {
      uMegaPC: { value: new THREE.Vector3(0, -3389500, 0) },
      uMegaWind: { value: new THREE.Vector3(1, 0, 0) },
      uMegaDust: { value: 1.0 },
      uMegaGrowth: { value: 1.0 },
      uMegaTime: { value: 0 },
    };
    try { initBuildingMaterials(app); } catch (e) { console.warn('[mega] building materials init failed', e); }
  }
  /** texture names the surfaces need (generated by the worker) */
  textureRequests() { return [...new Set(Object.values(SURFACES).map((s) => s.tex)), SCREEN_TEX]; }
  installTexture(res) {
    this.textures.set(res.name, res);
    if (res.name === SCREEN_TEX) { this._applyScreens(); return; }
    for (const [key, d] of Object.entries(SURFACES)) if (d.tex === res.name && this.cache.has(key)) this._applyTex(this.cache.get(key), d);
  }
  /** harbour-office display atlas (screens.js): emissive map of mega_screen, base map of the paper chart */
  _applyScreens() {
    const T = this.textures.get(SCREEN_TEX); if (!T) return;
    if (!this._screenTex) {
      const t = new THREE.DataTexture(T.color, T.width, T.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 16; t.flipY = false;
      t.needsUpdate = true;
      this._screenTex = t;
    }
    const scr = this.cache.get('mega_screen');
    if (scr && scr.emissiveMap !== this._screenTex) { scr.emissiveMap = this._screenTex; scr.emissive.setRGB(1, 1, 1); scr.needsUpdate = true; }
    const ch = this.cache.get('mega_chart');
    if (ch && ch.map !== this._screenTex) { ch.map = this._screenTex; ch.color.setRGB(1, 1, 1); ch.needsUpdate = true; }
  }
  get texturesReady() { return this.textureRequests().every((n) => this.textures.has(n)); }

  _applyTex(m, d) {
    const T = this.textures.get(d.tex); if (!T) return;
    if (!T.mean) T.mean = meanLinear(T.color);
    m.color.setRGB(d.albedo[0] / Math.max(0.05, T.mean[0]), d.albedo[1] / Math.max(0.05, T.mean[1]), d.albedo[2] / Math.max(0.05, T.mean[2]));
    const rep = 1 / (d.m ?? T.metres);
    m.map = makeDataTex(T.color, T.size, true, rep);
    m.normalMap = makeDataTex(T.normal, T.size, false, rep);
    m.normalScale = new THREE.Vector2(d.ns, d.ns);
    const orm = makeDataTex(T.orm, T.size, false, rep);
    m.roughnessMap = orm; m.metalnessMap = d.metal > 0 ? orm : null; m.aoMap = orm; m.aoMapIntensity = 0.7;
    m.needsUpdate = true;
  }

  isNoShadow(key) { return NO_SHADOW.has(key); }

  get(key) {
    let m = this.cache.get(key);
    if (m) return m;
    if (!key.startsWith('mega_')) return getBuildingMaterial(key, this.app);
    m = this._make(key);
    this.cache.set(key, m);
    return m;
  }

  _patch(m, opts) { try { this.app.lighting?.patch?.(m, opts); } catch (e) { console.warn('[mega] lighting patch failed', e); } }

  _make(key) {
    const U = this.uniforms;
    const d = SURFACES[key];
    if (d) {
      const m = new THREE.MeshStandardMaterial({ roughness: d.rough, metalness: d.metal, vertexColors: true });
      m.color.setRGB(d.albedo[0], d.albedo[1], d.albedo[2]);     // linear working space
      m.name = key;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uMegaPC: U.uMegaPC, uMegaWind: U.uMegaWind, uMegaDust: U.uMegaDust, uMegaGrowth: U.uMegaGrowth, uMegaWetRough: { value: d.wet ?? 0.25 } });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SURF_VERT_PARS + (d.offset ? 'uniform vec3 uMegaPC;\n' : ''))
          .replace('#include <project_vertex>', (d.offset ? projectOffset(d.offset) : '#include <project_vertex>') + '\n' + SURF_VERT);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + SURF_FRAG_PARS)
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + SURF_FRAG_COLOR)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + SURF_FRAG_ROUGH);
      };
      m.customProgramCacheKey = () => 'mega-surface-v4' + (d.offset ? '-off' : '');
      this._patch(m, { nightEmissive: false });
      if (this.textures.has(d.tex)) this._applyTex(m, d);
      return m;
    }
    let m;
    switch (key) {
      case 'mega_water':
        m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uMegaTime = U.uMegaTime;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMegaUv;').replace('#include <project_vertex>', '#include <project_vertex>\nvMegaUv = uv;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WATER_FRAG_PARS)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAG_COLOR)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.05, 0.72, megaFoam);')
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WATER_FRAG_NORMAL);
        };
        m.customProgramCacheKey = () => 'mega-water-v3';
        this._patch(m, { nightEmissive: false });
        break;
      case 'mega_window':
      case 'mega_window_lit':
        m = new THREE.MeshPhysicalMaterial({ color: 0x0c1317, roughness: 0.06, metalness: 0.0, ior: 1.52, specularIntensity: 1, specularColor: new THREE.Color(1.4, 1.55, 1.7), envMapIntensity: 1.0 });
        if (key === 'mega_window_lit') { m.emissive = new THREE.Color(0xffd29a); m.emissiveIntensity = 1.6; }
        this._patch(m, { nightEmissive: key === 'mega_window_lit' });
        break;
      case 'mega_grating':
        m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.6, map: gratingTexture(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
        this._patch(m, { nightEmissive: false });
        break;
      case 'mega_paint_red':
        m = new THREE.MeshStandardMaterial({ color: 0xb8231b, roughness: 0.55, metalness: 0, vertexColors: true });
        this._patch(m, {});
        break;
      case 'mega_paint_green':
        m = new THREE.MeshStandardMaterial({ color: 0x1d7a3a, roughness: 0.55, metalness: 0, vertexColors: true });
        this._patch(m, {});
        break;
      case 'mega_light_green':
        m = new THREE.MeshStandardMaterial({ color: 0x60ff90, roughness: 0.4, emissive: new THREE.Color(0x30ff70), emissiveIntensity: 8 });
        this._patch(m, { nightEmissive: false });
        break;
      case 'mega_deposit':
        // G02 old-water-line deposit band (旧水位沉积线): pale calcite / salt crust draped on the bank, lifted
        // with camera distance (≤ 4 m) so the coarser terrain tiles of a far view never swallow it
        m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.5, 0.47, 0.42), roughness: 0.95, metalness: 0, vertexColors: true });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uMegaPC = U.uMegaPC;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uMegaPC;')
            .replace('#include <project_vertex>', projectOffset('clamp(megaCd * 0.0005, 0.1, 4.0)'));
        };
        m.customProgramCacheKey = () => 'mega-deposit-v1';
        this._patch(m, {});
        break;
      case 'mega_dust':
        // dry red dust drifts (lee side of bolt heads, recess corners): matte, slightly lifted albedo
        m = new THREE.MeshStandardMaterial({ color: 0xb0643a, roughness: 1.0, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        this._patch(m, {});
        break;
      case 'mega_screen':
        // console displays (S09c 港务工作间): self-lit pages of the screens.js atlas (radar, ECDIS, AIS, tide, locks,
        // CCTV...) behind a glossy dark glass; always on (not night-gated). Until the atlas arrives: dim blue glass.
        m = new THREE.MeshStandardMaterial({ color: 0x030507, roughness: 0.14, metalness: 0, emissive: new THREE.Color(0x10283a), emissiveIntensity: SCREEN_EMISSIVE });
        m.customProgramCacheKey = () => 'mega-screen-v3';
        this._patch(m, { nightEmissive: false, receiveCloudShadow: false });
        break;
      case 'mega_chart':
        // paper nautical chart / log sheet on the chart desk (atlas page, matte paper)
        m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.75, 0.73, 0.66), roughness: 0.92, metalness: 0 });
        this._patch(m, { nightEmissive: false });
        break;
      case 'mega_lightpool':
      case 'mega_lightpool_cool':
        // lamp light on the deck seen from the air at night: additive, emissive-only, night-gated
        // (D3: 1.0 = one lit window; the pool peak ≈ 1.6 so the deck lamp rows read at night from a few km)
        m = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: new THREE.Color(key === 'mega_lightpool_cool' ? 0xd8e6ff : 0xffbf78), emissiveIntensity: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        m.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMegaUv;').replace('#include <project_vertex>', '#include <project_vertex>\nvMegaUv = uv;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMegaUv;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float r2 = dot(vMegaUv, vMegaUv); totalEmissiveRadiance *= exp(-r2 * 3.0) * (1.0 - smoothstep(0.75, 1.0, r2)); }');
        };
        m.customProgramCacheKey = () => 'mega-pool-v1';
        this._patch(m, { nightEmissive: true, receiveCloudShadow: false });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.8, vertexColors: true });
        console.warn('[mega] unknown material', key);
        this._patch(m, {});
    }
    m.name = key;
    if (key === 'mega_screen' || key === 'mega_chart') { this.cache.set(key, m); this._applyScreens(); }
    return m;
  }

  update(frame) {
    const U = this.uniforms;
    U.uMegaTime.value = frame.time || 0;
    U.uMegaPC.value.copy(frame.planetCenter);
  }
}
