// Main-thread building material library. OWNER: building-kit agent.
//
// CONTRACT
//   getBuildingMaterial(key, app) -> shared THREE.Material for a material key (vocabulary in
//       kit/README.md §5). Patched with app.lighting.patch(material) when available. Linear HDR:
//       no tone mapping inside materials; base colour textures are sRGB, data textures linear.
//   initBuildingMaterials(app, {workers?}) -> Promise: generates the procedural textures (in the
//       worker pool when given: job type 'buildingTextures') and upgrades every material. Safe to
//       call more than once; getBuildingMaterial works before it resolves (flat colours first).
//   createBuildingObject(data, app, opts) -> THREE.Group with one mesh per part (BuildingMeshData
//       from the 'building' worker job), shadows set, userData {bounds, anchors, stats, colliders}.
//   createColliderMesh(data) -> THREE.Mesh (invisible) whose geometry.boundsTree is a MeshBVH of the
//       'full' LOD colliders (building frame) — ready for controls/collide.js getColliders().
//   disposeBuildingObject(group)      — frees geometries (materials are shared, never disposed).
//   BUILDING_UNIFORMS                 — shared uniforms (local hour override, interior levels…).
//   setBuildingLighting({sunDir, planetCenter, localHour, sunE, skyE}) — dev benches without app.lighting.
//   windowLit(hash, floor, bay, hour, profile) / windowLitFallback(...) — JS twins of the shader decision.
//
// Units (same as the planet lighting patch, render/atmosphere/lighting.js): sun irradiance ≈ 8 ×
// transmittance, sky irradiance from the SH LUT. Emissive: author 1.0 for a typical lit window /
// street lamp; it is multiplied by EMISSIVE_SCALE (0.05) — by app.lighting when patched, by these
// shaders otherwise (BK_ES) — so dev benches and the app read identically at the same exposure
// (day ≈ 0.45, night ≈ 15, AgX). Night gating of facade lamps is done here (bkNight); window and
// ceiling-panel lights follow occupancy (occupancy.js windowLit GLSL twin) and need no gate
// (daylight exposure hides them, as in reality).
//
// Night lighting: window glass, frosted glass and ceiling panels carry per-vertex (floor, bay,
// building hash, room kind, occupancy profile) (iwin1/iwin2); the shader evaluates occupancy.js'
// OCCUPANCY_GLSL (windowLitMinute) when present, else a built-in fallback with the same inputs, at
// the local solar hour derived from the sun direction (or BUILDING_UNIFORMS.uBkLocalHour ≥ 0).

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { generateTexture } from './kit/texgen.js';
import { EXTRA_ATTRIBUTES } from './kit/MeshBuilder.js';

// ---------------------------------------------------------------------------
// optional occupancy module (written by the urban engineer): guarded, never required
// ---------------------------------------------------------------------------
let OCC = null;
try {
  const mods = import.meta.glob('../world/occupancy.js', { eager: true });
  OCC = mods['../world/occupancy.js'] || null;
} catch { OCC = null; }

// ---------------------------------------------------------------------------
// shared uniforms
// ---------------------------------------------------------------------------
export const BUILDING_UNIFORMS = {
  uBkLocalHour: { value: -1 },          // ≥ 0 overrides the local solar hour (dev benches)
  uBkSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
  uBkPlanetCenter: { value: new THREE.Vector3(0, -3389500, 0) },
  uBkSunE: { value: new THREE.Vector3(6.6, 6.2, 5.6) },   // unpatched only: sun irradiance (scene units)
  uBkSkyE: { value: new THREE.Vector3(0.95, 1.1, 1.35) }, // unpatched only: sky irradiance on a horizontal surface
  uBkInteriorDay: { value: 1.0 },       // multiplier of the daylight entering fake interiors
  uBkInteriorNight: { value: 1.0 },     // multiplier of interior lamp radiance (emissive units)
  uBkLightLevel: { value: 1.0 },        // global multiplier for exterior lamps / signage
  uBkDust: { value: 1.0 },              // red dust on ledges (0 = clean)
  uBkIndoorAO: { value: 0.42 },         // sky light reaching interior surfaces ('full' LOD rooms, via windows + bounce)
  uBkIndoorLampE: { value: 0.09 },      // emissive units of lamp irradiance on interior surfaces at night (× BK_ES)
  uBkMacro: { value: null },            // macro variation texture
};
let LINKED = false;
function linkLighting(app) {
  if (LINKED || !app || !app.lighting || !app.lighting.uniforms) return;
  const U = app.lighting.uniforms;
  if (U.uSunDir) BUILDING_UNIFORMS.uBkSunDir = U.uSunDir;
  if (U.uPlanetCenter) BUILDING_UNIFORMS.uBkPlanetCenter = U.uPlanetCenter;
  LINKED = true;
}
/** For dev benches without app.lighting: sun direction (render space), planet centre, hour, irradiances. */
export function setBuildingLighting({ sunDir, planetCenter, localHour, sunE, skyE } = {}) {
  if (sunDir) BUILDING_UNIFORMS.uBkSunDir.value.copy(sunDir).normalize();
  if (planetCenter) BUILDING_UNIFORMS.uBkPlanetCenter.value.copy(planetCenter);
  if (localHour !== undefined) BUILDING_UNIFORMS.uBkLocalHour.value = localHour;
  if (sunE) BUILDING_UNIFORMS.uBkSunE.value.copy(sunE);
  if (skyE) BUILDING_UNIFORMS.uBkSkyE.value.copy(skyE);
}

// ---------------------------------------------------------------------------
// material definitions. tex = texgen name, m = world metres per tile override,
// c = base colour (sRGB hex), r = roughness, mt = metalness, ns = normal scale,
// macro = macro albedo variation, dust = red dust on upward faces, ei = emissive (emissive units)
// ---------------------------------------------------------------------------
const D = {
  // shells
  ceramic_white: { tex: 'ceramic', c: 0xf2efe8, r: 1, mt: 0, ns: 1.0, macro: 0.05, dust: 0.5, phys: { clearcoat: 0.35, clearcoatRoughness: 0.18 } },
  ceramic_band: { tex: 'ceramic_band', c: 0xf7f5f0, r: 1, mt: 0, ns: 0.8, macro: 0.035, dust: 0.45, phys: { clearcoat: 0.5, clearcoatRoughness: 0.12 } },
  ceramic_grey: { tex: 'ceramic', c: 0xa9aaa7, r: 1, mt: 0, ns: 1.0, macro: 0.05, dust: 0.4, phys: { clearcoat: 0.25, clearcoatRoughness: 0.2 } },
  panel_insulated: { tex: 'panel', c: 0xe4e4df, r: 1, mt: 0, ns: 1.0, macro: 0.06, dust: 0.6, norm: true },
  panel_white: { tex: 'panel', c: 0xeeeeea, r: 1, mt: 0, ns: 1.0, macro: 0.08, dust: 0.7, norm: true },
  panel_grey: { tex: 'panel', c: 0x9da1a4, r: 1, mt: 0, ns: 1.0, macro: 0.06, dust: 0.6, norm: true },
  render_white: { tex: 'render', c: 0xe8e6e0, r: 1, mt: 0, ns: 0.6, macro: 0.05, dust: 0.4, norm: true },
  plaster: { tex: 'render', c: 0xeae8e3, r: 1, mt: 0, ns: 0.4, indoor: true, norm: true },
  concrete: { tex: 'concrete', c: 0xb9b6ae, r: 1, mt: 0, ns: 1.0, macro: 0.1, dust: 0.8, norm: true },
  concrete_smooth: { tex: 'concrete', c: 0xc3c0b8, r: 0.85, mt: 0, ns: 0.5, macro: 0.08, dust: 0.7, norm: true },
  concrete_wet: { tex: 'concrete', c: 0x6f6c66, r: 0.35, mt: 0, ns: 0.8, macro: 0.1, norm: true },
  stone_plinth: { tex: 'stone_blocks', c: 0x9b9893, r: 1, mt: 0, ns: 1.0, macro: 0.08, dust: 0.8, norm: true },
  stone_sill: { tex: 'stone', c: 0xb8b5ae, r: 0.9, mt: 0, ns: 0.6, dust: 0.7, norm: true },
  stone_step: { tex: 'stone', c: 0xb4b1ab, r: 1, mt: 0, ns: 0.5, macro: 0.06, m: 0.6, dust: 0.5, norm: true },
  stone_dark: { tex: 'stone', c: 0x56575a, r: 0.7, mt: 0, ns: 0.6, dust: 0.4, norm: true },
  basalt: { tex: 'stone_blocks', c: 0x5a4a42, r: 1, mt: 0, ns: 1.3, macro: 0.16, m: 1.6, dust: 0.75, norm: true },   // oxidised (rust-skinned) local basalt: plinths, retaining walls, canyon bases
  stone_floor: { tex: 'tile_floor', c: 0xcfcbc3, r: 0.8, mt: 0, ns: 0.7, indoor: true, norm: true },
  paving: { tex: 'paving', c: 0xc2beb5, r: 1, mt: 0, ns: 1.0, macro: 0.08, dust: 0.35, norm: true },
  paving_stone: { tex: 'paving', c: 0xb2aea6, r: 1, mt: 0, ns: 1.0, macro: 0.08, m: 1.8, dust: 0.35, norm: true },
  // metals
  aluminium: { tex: 'brushed', c: 0xc9ccd0, r: 1.45, mt: 1, ns: 0.4, dust: 0.35, phys: { anisotropy: 0.5 }, norm: true },
  aluminium_dark: { tex: 'brushed', c: 0x4c5056, r: 1.3, mt: 1, ns: 0.4, dust: 0.3, phys: { anisotropy: 0.35 }, norm: true },
  steel: { tex: 'galvanised', c: 0xaeb2b5, r: 1, mt: 1, ns: 0.4, dust: 0.4, norm: true },
  steel_dark: { tex: 'paint', c: 0x3b3f44, r: 1.1, mt: 0.2, ns: 0.4, dust: 0.3 },
  steel_brushed: { tex: 'brushed', c: 0xd8dadc, r: 0.8, mt: 1, ns: 0.3, phys: { anisotropy: 0.6 }, norm: true },
  steel_yellow: { tex: 'paint', c: 0xe0b31e, r: 1, mt: 0, ns: 0.4, dust: 0.4 },
  steel_door: { tex: 'paint', c: 0x6f777e, r: 1, mt: 0.1, ns: 0.4 },
  chrome: { c: 0xe8e9ea, r: 0.12, mt: 1 },
  hvac: { tex: 'paint', c: 0xd9dbd8, r: 1, mt: 0.05, ns: 0.4, macro: 0.05, dust: 0.6 },
  tank_white: { tex: 'paint', c: 0xeeeeea, r: 1, mt: 0, ns: 0.3, dust: 0.6 },
  grille_dark: { tex: 'grille', c: 0xffffff, r: 1, mt: 1, ns: 1.0 },
  blind: { tex: 'brushed', c: 0xd5d6d2, r: 1.2, mt: 0.5, ns: 0.6, m: 0.2, rot: true, norm: true },
  // glass
  // window glass: insulated double glazing (IGU) reflects ≈ 12–15 % at normal incidence (4 surfaces +
  // low-e coat), shopfronts (low-iron) ≈ 10 %; f0 = reflectance at normal incidence, ft = spectral tint
  glass_window: { shader: 'interior', c: 0x0b0e12, f0: 0.125, ft: [0.86, 0.94, 1.0] },
  glass_shop: { shader: 'interior', c: 0x0b0e12, shop: true, f0: 0.1, ft: [0.9, 0.96, 1.0] },
  // blue-grey coated curtain wall (蓝灰幕墙): reflective coat f0 ≈ 0.3 with a blue cast, the room behind
  // still visible through the coat (interior mapping, blue-grey body tint) — towers / offices
  glass_curtain: { shader: 'interior', c: 0x0b0e12, curtain: true, f0: 0.3, ft: [0.7, 0.85, 1.0] },
  glass_clear: { shader: 'clear', c: 0x0a0d10, alpha: 0.1, f0: 0.1, ft: [0.86, 0.94, 1.0], iwin: true },
  glass_railing: { shader: 'clear', c: 0x0c1412, alpha: 0.1, railing: true },
  glass_agri: { shader: 'clear', c: 0x2a3430, alpha: 0.3, agri: true },   // agricultural (greenhouse) glazing: low-iron, slightly diffusing
  glass_frosted: { shader: 'frosted', tex: 'frost', c: 0xc8d2d8, r: 1, mt: 0 },
  mirror: { c: 0xffffff, r: 0.02, mt: 1, indoor: true },
  solar_panel: { tex: 'solar', c: 0xffffff, r: 1, mt: 1, ns: 0.4, m: 1, explicitUv: true, phys: { clearcoat: 1, clearcoatRoughness: 0.05 } },
  // timber & finishes
  wood: { tex: 'wood', c: 0xffffff, r: 1, mt: 0, ns: 0.6 },
  wood_deck: { tex: 'wood_deck', c: 0xffffff, r: 1, mt: 0, ns: 0.8, macro: 0.08, dust: 0.25 },
  wood_floor: { tex: 'wood_floor', c: 0xffffff, r: 0.9, mt: 0, ns: 0.6, indoor: true },
  wood_door: { tex: 'wood', c: 0xf2e8dc, r: 0.9, mt: 0, ns: 0.4, indoor: true },
  cabinet: { tex: 'paint', c: 0xe9e7e2, r: 0.9, mt: 0, ns: 0.2, indoor: true },
  counter: { tex: 'stone', c: 0x77777a, r: 0.5, mt: 0, ns: 0.3, indoor: true, norm: true },
  tile_floor: { tex: 'tile_floor', c: 0xd9d6d0, r: 1, mt: 0, ns: 0.8, indoor: true, norm: true },
  tile_wall: { tex: 'tile_wall', c: 0xf4f4f2, r: 1, mt: 0, ns: 0.8, indoor: true },
  porcelain: { c: 0xf5f5f3, r: 0.12, mt: 0, indoor: true },
  fabric: { tex: 'fabric', c: 0xffffff, r: 1, mt: 0, ns: 0.5, indoor: true },
  fabric_awning: { tex: 'fabric', c: 0xeae6dc, r: 1, mt: 0, ns: 0.6, side: 2, dust: 0.5 },
  black: { c: 0x101113, r: 0.3, mt: 0, indoor: true },
  rubber: { c: 0x1a1a1a, r: 0.9, mt: 0 },
  plastic_bin: { tex: 'paint', c: 0xffffff, r: 1.4, mt: 0, ns: 0.3 },
  mat_entrance: { tex: 'fabric', c: 0x3a3c3e, r: 1, mt: 0, ns: 1.0, m: 0.05 },
  // roof & ground
  roof_membrane: { tex: 'membrane', c: 0xb4b5b2, r: 1, mt: 0, ns: 1.0, macro: 0.1, dust: 0.6, norm: true },
  roof_gravel: { tex: 'gravel', c: 0xb0aaa0, r: 1, mt: 0, ns: 1.2, macro: 0.1, dust: 0.5, norm: true },
  roof_metal: { tex: 'metal_seam', c: 0x9aa2a9, r: 1, mt: 1, ns: 0.8, macro: 0.06, m: 2.2, dust: 0.4, norm: true },
  roof_tiles: { tex: 'tile_floor', c: 0xe2e0da, r: 0.9, mt: 0, ns: 0.6, macro: 0.06, dust: 0.5, norm: true },
  roof_shingle: { tex: 'rooftile', c: 0xf0eee8, r: 1, mt: 0, ns: 1.0, macro: 0.07, dust: 0.45, phys: { clearcoat: 0.3, clearcoatRoughness: 0.25 } },
  soil: { tex: 'soil', c: 0xffffff, r: 1, mt: 0, ns: 1.2 },
  // vegetation (QQ-03): like props' trees — physical leaves with a LOW specular (F0 and F90 × 0.22):
  // with the default F90 = 1 the up-bent leaf normals mirrored the blue sky at grazing angles and the
  // clumps read as pale cyan blobs. 'plant' keeps its colour × tint semantics (greenhouse crops,
  // megastructure planters tint it); kit clumps tint it dark green (≈ 0.05–0.12 linear).
  plant: { tex: 'leaf', c: 0xb8c8a8, r: 0.92, mt: 0, ns: 1.2, phys: { specularIntensity: 0.22 } },
  foliage: { tex: 'foliage', c: 0xffffff, r: 1, mt: 0, ns: 0.8, explicitUv: true, alphaTest: 0.45, a2c: false, side: 2, phys: { specularIntensity: 0.22 } },
  bark: { tex: 'bark', c: 0xffffff, r: 1, mt: 0, ns: 1.2 },
  // emissive (emissive units: 1.0 = typical lit window / street lamp at night)
  light_warm: { shader: 'lamp', c: 0xfff1d8, e: 0xffc98a, ei: 7.0 },
  light_cyan: { shader: 'lamp', c: 0xc8f4ff, e: 0x5fd8ff, ei: 5.0, always: true },
  light_red: { shader: 'lamp', c: 0xff6050, e: 0xff2a1a, ei: 8.0, always: true },
  signage_blank: { shader: 'lamp', c: 0xf4f6f6, e: 0xe8f4ff, ei: 2.5 },
  light_panel: { shader: 'panel', c: 0xf6f3ec, e: 0xfff0d8, ei: 4.0 },
  // far LOD
  mass_facade: { shader: 'mass', c: 0xffffff, r: 0.8, mt: 0 },
  mass_roof: { c: 0xffffff, r: 0.85, mt: 0, macro: 0.08 },
};
/** Keys in the vocabulary. */
export const BUILDING_MATERIAL_KEYS = Object.keys(D);
const TRANSPARENT = new Set(['glass_clear', 'glass_railing', 'glass_agri']);
const NO_SHADOW = new Set(['glass_clear', 'glass_railing', 'glass_agri', 'light_panel', 'light_warm', 'light_cyan', 'light_red']);

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
const TEX = new Map();      // name -> {color, normal, orm, metres}
const CACHE = new Map();    // key -> material
const PENDING = new Set();  // texture names being generated
let INIT = null;

function makeDataTex(arr, size, srgb) {
  const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 16;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}
// mean linear albedo of an sRGB colour texture (generators return it; computed here when missing)
function textureMean(res) {
  if (res.mean && res.mean.length === 3) return res.mean;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const a = res.color, m = [0, 0, 0]; let n = 0;
  for (let i = 0; i < a.length; i += 4 * 7) { m[0] += lut[a[i]]; m[1] += lut[a[i + 1]]; m[2] += lut[a[i + 2]]; n++; }
  return m.map((v) => v / Math.max(1, n));
}
function installTexture(res) {
  TEX.set(res.name, { color: makeDataTex(res.color, res.size, true), normal: makeDataTex(res.normal, res.size, false), orm: makeDataTex(res.orm, res.size, false), metres: res.metres, mean: textureMean(res) });
  if (res.name === 'macro') BUILDING_UNIFORMS.uBkMacro.value = TEX.get('macro').orm;
  for (const [key, m] of CACHE) { const d = D[key]; if (d && d.tex === res.name) applyTextures(m, d); }
}
function applyTextures(m, d) {
  const T = TEX.get(d.tex);
  if (!T) return;
  const metres = d.m ?? T.metres;
  const rep = d.explicitUv ? 1 : 1 / metres;
  const clone = (t) => { const c = t.clone(); c.repeat.set(rep, rep); if (d.rot) c.rotation = Math.PI / 2; c.needsUpdate = true; return c; };
  m.map = clone(T.color);
  // albedo normalisation (norm: true): the procedural colour texture only modulates detail, the
  // material colour d.c is the true mean albedo of the surface (sRGB hex → linear). Without it the
  // texture's own mean (e.g. concrete ≈ 0.34 linear) darkened every surface to a third of its colour.
  if (d.norm && T.mean) {
    const k = 0.2126 * T.mean[0] + 0.7152 * T.mean[1] + 0.0722 * T.mean[2];
    m.color.set(d.c ?? 0xffffff).multiplyScalar(1 / Math.max(0.05, k));
  }
  m.normalMap = clone(T.normal);
  m.normalScale = new THREE.Vector2(d.ns ?? 1, d.ns ?? 1);
  const orm = clone(T.orm);
  m.roughnessMap = orm; m.metalnessMap = orm; m.aoMap = orm; m.aoMapIntensity = 0.6;
  m.roughness = d.r ?? 1; m.metalness = d.mt ?? 0;
  m.needsUpdate = true;
}

/**
 * Generate all procedural textures. With app.workers (WorkerPool) jobs run in parallel in
 * workers ('buildingTextures' handler); otherwise they are generated on the main thread in
 * idle slices so the page stays responsive.
 */
export function initBuildingMaterials(app, opts = {}) {
  if (INIT) return INIT;
  linkLighting(app);
  const names = [...new Set(Object.values(D).map((d) => d.tex).filter(Boolean)), 'macro'];
  const workers = opts.workers || app?.workers;
  const jobs = names.map((name) => {
    PENDING.add(name);
    const done = (res) => { PENDING.delete(name); installTexture(res); };
    if (workers && workers.submit) {
      return workers.submit('buildingTextures', { name }, { priority: -5 }).promise.then(done).catch((e) => { console.warn('[buildings] texture worker failed, main thread fallback', name, e); return idle().then(() => done(generateTexture(name))); });
    }
    if (opts.generate) return opts.generate(name).then(done);
    return idle().then(() => done(generateTexture(name)));
  });
  INIT = Promise.all(jobs).then(() => true);
  return INIT;
}
function idle() { return new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0))); }
/** True when all textures are installed. */
export function buildingMaterialsReady() { return INIT !== null && PENDING.size === 0; }

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */`
uniform float uBkLocalHour;
uniform vec3 uBkSunDir;
uniform vec3 uBkPlanetCenter;
uniform float uBkLightLevel;
uniform vec3 uBkSunE;
uniform vec3 uBkSkyE;
#ifdef LP_PATCHED
#define BK_ES uLpEmissiveScale
#else
#define BK_ES 0.05
#endif
uint bkHash(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float bkRand(uint h) { return float(h & 0xffffffu) / 16777216.0; }
// fallback occupancy (JS twin: windowLitFallback). inputs identical to occupancy.windowLit
float bkWindowLitFallback(uint bh, int floorI, int bay, float hour) {
  uint h = bkHash(bh ^ bkHash(uint(floorI) * 0x9e3779b9u + uint(bay) * 0x85ebca6bu + 0x51u));
  float occ = bkRand(h);
  if (occ < 0.16) return 0.0;
  float on = 16.6 + bkRand(bkHash(h + 1u)) * 3.4;
  float off = 21.3 + bkRand(bkHash(h + 2u)) * 4.2;
  float mOn = 5.4 + bkRand(bkHash(h + 3u)) * 1.4;
  float mOff = mOn + 0.5 + bkRand(bkHash(h + 4u)) * 1.6;
  bool morning = bkRand(bkHash(h + 5u)) < 0.45;
  bool lit = (hour >= on && hour < min(off, 24.0)) || (off > 24.0 && hour < off - 24.0) || (morning && hour >= mOn && hour < mOff);
  return lit ? 1.0 : 0.0;
}
__OCC_GLSL__
float bkWindowLit(uint bh, int floorI, int bay, float hour, int profile) { return __OCC_CALL__; }
float bkWindowTemp(uint bh, int floorI, int bay) { return __OCC_TEMP__; }
vec3 bkUp(vec3 wp) { return normalize(wp - uBkPlanetCenter); }
// sine of the sun elevation at a render-space position
float bkSunEl(vec3 wp) { return dot(bkUp(wp), normalize(uBkSunDir)); }
float bkLocalHour(vec3 wp) {
  if (uBkLocalHour >= 0.0) return uBkLocalHour;
  vec3 p = wp - uBkPlanetCenter;
  float lon = atan(p.x, p.z), slon = atan(uBkSunDir.x, uBkSunDir.z);
  return mod(12.0 + (lon - slon) * 3.81971863, 24.0);
}
// facade lamps: 0 by day → 1 at night (photocell, on at ~+2°)
float bkNight(vec3 wp) { return 1.0 - smoothstep(-0.02, 0.06, bkSunEl(wp)); }
// irradiance (scene units) on a surface with world normal n at the current fragment
vec3 bkSkyIrr(vec3 n, vec3 wp) {
#ifdef LP_PATCHED
  return lpSkyIrradianceN(n);
#else
  float k = dot(n, bkUp(wp)) * 0.5 + 0.5;
  float day = smoothstep(-0.1, 0.25, bkSunEl(wp));
  return mix(uBkSkyE * vec3(0.62, 0.42, 0.33) * 0.32, uBkSkyE, k) * day + vec3(0.003, 0.0034, 0.0046);
#endif
}
vec3 bkSunIrr(vec3 n, vec3 wp) {
#ifdef LP_PATCHED
  return lpSunIrradiance() * max(dot(n, uSunDir), 0.0);
#else
  return uBkSunE * max(dot(n, normalize(uBkSunDir)), 0.0);
#endif
}
`;

function occGlsl() {
  const G = OCC && typeof OCC.OCCUPANCY_GLSL === 'string' ? OCC.OCCUPANCY_GLSL : '';
  // urban-fn twin: float windowLitMinute(uint bh, int floorIdx, int bay, int minuteOfDay, int profile)
  if (/float\s+windowLitMinute\s*\(\s*uint[^,]*,\s*int[^,]*,\s*int[^,]*,\s*int[^,]*,\s*int[^)]*\)/.test(G)) {
    const temp = /float\s+windowTemp\s*\(\s*uint[^,]*,\s*int[^,]*,\s*int[^)]*\)/.test(G);
    return { glsl: G, call: 'windowLitMinute(bh, floorI, bay, int(floor(hour * 60.0)), profile)', temp: temp ? 'windowTemp(bh, floorI, bay)' : '0.0', ok: true };
  }
  if (/float\s+windowLit\s*\(\s*uint[^,]*,\s*int[^,]*,\s*int[^,]*,\s*float[^,]*,\s*int[^)]*\)/.test(G)) {
    return { glsl: G, call: 'windowLit(bh, floorI, bay, hour, profile)', temp: '0.0', ok: true };
  }
  return { glsl: '', call: 'bkWindowLitFallback(bh, floorI, bay, hour)', temp: 'bkRand(bkHash(bh ^ uint(bay * 131 + floorI)))', ok: false };
}
let COMMON_SRC = null;
function common() { if (!COMMON_SRC) { const o = occGlsl(); COMMON_SRC = GLSL_COMMON.replace('__OCC_GLSL__', o.glsl).replace('__OCC_CALL__', o.call).replace('__OCC_TEMP__', o.temp); } return COMMON_SRC; }

/** JS twin of bkWindowLitFallback (same integer maths). */
export function windowLitFallback(hash, floor, bay, hour) {
  const H = (x) => { x >>>= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0; };
  const R = (h) => (h & 0xffffff) / 16777216;
  const h = H((hash >>> 0) ^ H((Math.imul(floor >>> 0, 0x9e3779b9) + Math.imul(bay >>> 0, 0x85ebca6b) + 0x51) >>> 0));
  if (R(h) < 0.16) return 0;
  const on = 16.6 + R(H(h + 1)) * 3.4, off = 21.3 + R(H(h + 2)) * 4.2, mOn = 5.4 + R(H(h + 3)) * 1.4, mOff = mOn + 0.5 + R(H(h + 4)) * 1.6;
  const morning = R(H(h + 5)) < 0.45;
  return (hour >= on && hour < Math.min(off, 24)) || (off > 24 && hour < off - 24) || (morning && hour >= mOn && hour < mOff) ? 1 : 0;
}
/** windowLit from occupancy.js when present, else the fallback (same decision as the shaders). */
export function windowLit(hash, floor, bay, hour, profile = 0) {
  if (OCC && typeof OCC.windowLit === 'function') return OCC.windowLit(hash, floor, bay, hour, profile);
  return windowLitFallback(hash, floor, bay, hour);
}

const VERT_COMMON = /* glsl */`
varying vec3 vBkWorld;
varying vec3 vBkNormalW;
varying vec2 vBkUv;
`;
// world position / normal of the vertex. Batching-safe: the per-instance matrix of a BatchedMesh
// (USE_BATCHING) or InstancedMesh (USE_INSTANCING) is applied like three's own project_vertex, so
// building materials work unchanged in per-building meshes, merged tile geometry and BatchedMesh.
const VERT_XFORM = /* glsl */`
  vec4 bkP0 = vec4(transformed, 1.0); mat3 bkM3 = mat3(modelMatrix);
  #ifdef USE_BATCHING
  bkP0 = batchingMatrix * bkP0; bkM3 = bkM3 * mat3(batchingMatrix);
  #endif
  #ifdef USE_INSTANCING
  bkP0 = instanceMatrix * bkP0; bkM3 = bkM3 * mat3(instanceMatrix);
  #endif
  vec4 bkW0 = modelMatrix * bkP0;
  vBkWorld = bkW0.xyz; vBkUv = uv; vBkNormalW = normalize(bkM3 * objectNormal);
`;
const VERT_MAIN = '{' + VERT_XFORM + '}\n';

// ---- interior mapping (fake rooms behind window glass) ----
const INTERIOR_VERT = /* glsl */`
attribute vec4 iwin0;
attribute vec4 iwin1;
attribute vec4 iwin2;
varying vec4 vI0; varying vec4 vI1; varying vec4 vI2;
varying vec3 vRoomPos; varying vec3 vRoomDir;
`;
const INTERIOR_VERT_MAIN = /* glsl */`
{
` + VERT_XFORM + `
  // room frame from the pane in its own (building / batch) frame: +y up, tangent along the facade
  vec3 nO = normalize(objectNormal);
  vec3 tO = normalize(cross(vec3(0.0, 1.0, 0.0), nO) + vec3(1e-5, 0.0, 0.0));
  vec3 vdO = transpose(bkM3) * (bkW0.xyz - cameraPosition);
  vRoomDir = vec3(dot(vdO, tO), vdO.y, -dot(vdO, nO));
  vRoomPos = vec3(iwin0.x + uv.x, iwin1.x + uv.y, 0.0);
  vI0 = iwin0; vI1 = iwin1; vI2 = iwin2;
}
`;
const INTERIOR_FRAG_PARS = /* glsl */`
varying vec4 vI0; varying vec4 vI1; varying vec4 vI2;
varying vec3 vRoomPos; varying vec3 vRoomDir;
uniform float uBkInteriorDay;
uniform float uBkInteriorNight;
float bkTempG = 0.0;
float bkBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out vec3 nrm) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tf < 0.0) return 1e9;
  if (tn == tmin.x) nrm = vec3(-sign(rd.x), 0.0, 0.0); else if (tn == tmin.y) nrm = vec3(0.0, -sign(rd.y), 0.0); else nrm = vec3(0.0, 0.0, -sign(rd.z));
  return tn;
}
vec3 bkPal(float s, vec3 a, vec3 b, vec3 c) { return s < 0.33 ? a : s < 0.66 ? b : c; }
float bkHash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
// interior radiance seen through the pane (room box + furniture + curtains).
// p: room-space point on the pane (x from the room's left wall, y above the floor, z = 0 at the
// glass, +z into the room); d: view direction in room space; lit: 0 or occupancy level 0.55..1;
// dayE: irradiance (scene units) arriving at the window from outside.
vec3 bkInterior(vec3 p, vec3 d, float lit, vec3 dayE, out float coverage) {
  float W = max(vI0.y, 0.6), Dp = max(vI0.z, 1.0), H = max(vI0.w, 2.2);
  float seed = vI1.y; float kind = vI2.z;
  bool shop = kind > 5.5 && kind < 6.5;
  bool office = (kind > 6.5 && kind < 7.5) || kind > 10.5;
  bool stair = kind > 3.5 && kind < 4.5;
  bool lobby = kind > 4.5 && kind < 5.5;
  // residents' mailboxes only in housing lobbies (occupancy profile 0 = residential, residential_tower,
  // dorm, shop_row — interior/index.js HOUSING_USES); offices / stations / clinics / schools get a
  // reception desk and a backlit directory board instead (QY-02)
  bool housing = vI2.w < 0.5;
  d = normalize(d); d.z = max(d.z, 0.02);
  p.x = clamp(p.x, 0.01, W - 0.01); p.y = clamp(p.y, 0.01, H - 0.01);
  coverage = 0.0;
  float s1 = bkHash1(seed * 17.0 + 1.0), s2 = bkHash1(seed * 31.0 + 2.0), s3 = bkHash1(seed * 7.0 + 3.0), s4 = bkHash1(seed * 13.0 + 4.0);
  // ---- curtains / blinds 8 cm behind the glass ----
  vec3 q = p + d * (0.08 / d.z);
  vec3 curtainCol = bkPal(s2, vec3(0.86, 0.82, 0.74), vec3(0.6, 0.64, 0.7), vec3(0.78, 0.66, 0.55));
  bool homey = kind < 1.5;
  float cl = homey ? (s1 < 0.72 ? 0.12 + s3 * 0.22 : 0.0) : 0.0;
  float blind = (kind < 2.5 && !shop) ? (s4 > 0.55 ? 0.08 + s3 * 0.45 : 0.0) : office ? (s4 > 0.5 ? s3 * 0.35 : 0.0) : 0.0;
  // curtain folds: soft vertical shading
  float fold = 0.82 + 0.18 * sin(q.x * 26.0 + seed * 40.0);
  bool inCurtain = (q.x < cl * W || q.x > W - cl * W) && q.y > 0.0 && q.y < H;
  bool inBlind = q.y > H - blind * H;
  // ---- room box ----
  vec3 inv = 1.0 / d;
  float tx = d.x > 0.0 ? (W - p.x) * inv.x : -p.x * inv.x;
  float ty = d.y > 0.0 ? (H - p.y) * inv.y : -p.y * inv.y;
  float tz = (Dp - p.z) * inv.z;
  float t = min(min(tx, ty), tz);
  vec3 h = p + d * t;
  vec3 wallC = bkPal(s3, vec3(0.8, 0.78, 0.73), vec3(0.72, 0.76, 0.78), vec3(0.82, 0.76, 0.68));
  if (office || shop || lobby) wallC = vec3(0.82, 0.82, 0.8);
  vec3 woodC = mix(vec3(0.42, 0.29, 0.19), vec3(0.62, 0.47, 0.32), s4);
  vec3 floorC = (kind > 1.5 && kind < 3.5) || shop || stair || lobby ? vec3(0.62, 0.6, 0.57) : woodC;
  vec3 col; vec3 n; float id = 0.0;
  if (t == ty && d.y < 0.0) {
    float plank = floor(h.x / 0.19);
    col = floorC * (0.86 + 0.14 * bkHash1(plank + floor(h.z / 1.4 + plank * 0.37)));
    if (homey && abs(h.x - W * 0.5) < min(1.1, W * 0.35) && abs(h.z - (Dp - 1.9)) < 0.8) col = bkPal(s1, vec3(0.52, 0.44, 0.38), vec3(0.34, 0.38, 0.44), vec3(0.62, 0.6, 0.54));
    n = vec3(0, 1, 0); id = 1.0;
  } else if (t == ty) {
    col = vec3(0.88); n = vec3(0, -1, 0); id = 2.0;
  } else if (t == tz) {
    col = wallC; n = vec3(0, 0, -1); id = 3.0;
    float dx = W * (0.12 + 0.62 * s2);
    if ((kind < 0.5 || kind > 7.5 || office) && abs(h.x - dx) < 0.45 && h.y < 2.1) col = vec3(0.12, 0.11, 0.1);   // doorway
    if (homey && abs(h.x - W * (0.3 + 0.4 * s4)) < 0.38 && abs(h.y - 1.55) < 0.27) col = bkPal(s3, vec3(0.25, 0.32, 0.42), vec3(0.55, 0.38, 0.26), vec3(0.3, 0.42, 0.3)); // picture
    if (kind < 0.5 && h.x > W - 1.0 && h.y < 1.9) col = mix(woodC * 0.8, bkPal(fract(floor(h.y * 4.0) * 0.37 + floor(h.x * 9.0) * 0.21), vec3(0.6, 0.3, 0.25), vec3(0.25, 0.35, 0.5), vec3(0.75, 0.68, 0.45)), step(0.04, fract(h.y * 4.0)) * 0.7); // bookshelf
    if (shop && h.y > 0.3 && h.y < 2.2) col = mix(col * 0.6, bkPal(fract(floor(h.x * 2.5) * 0.37 + floor(h.y * 3.0) * 0.21), vec3(0.75, 0.35, 0.3), vec3(0.3, 0.5, 0.7), vec3(0.85, 0.75, 0.4)), step(0.12, fract(h.y * 3.0)) * 0.8);
    if (lobby) {
      // lift lobby at the back: brushed steel doors in a dark reveal, call button, warm timber panelling
      if (abs(h.x - W * 0.5) < 0.62 && h.y < 2.25) col = abs(h.x - W * 0.5) < 0.55 && h.y < 2.15 ? (abs(h.x - W * 0.5) < 0.008 ? vec3(0.2) : vec3(0.62, 0.64, 0.67)) : vec3(0.15, 0.15, 0.16);
      else if (abs(h.x - W * 0.5 - 0.8) < 0.04 && abs(h.y - 1.1) < 0.08) col = vec3(0.9, 0.9, 0.85);
      else if (h.y < 2.4) col = woodC * 1.15;
    }
  } else { col = wallC * 0.92; n = vec3(-sign(d.x), 0, 0); id = 4.0;
    // lobby side wall: the mailbox wall (信报区) — rows of small steel doors with name slots (housing)
    if (lobby && housing && h.y > 0.55 && h.y < 1.95 && h.z > Dp * 0.25 && h.z < Dp * 0.8) {
      vec2 mb = vec2(fract(h.z / 0.32), fract((h.y - 0.55) / 0.28));
      col = (mb.x < 0.06 || mb.y < 0.07) ? vec3(0.22, 0.23, 0.25) : (mb.y > 0.72 && mb.y < 0.8 && mb.x > 0.3 && mb.x < 0.7 ? vec3(0.95) : vec3(0.58, 0.6, 0.63));
    }
    // public lobbies: backlit directory / wayfinding board (dark glass, a lit header, entry rows)
    if (lobby && !housing && h.y > 0.9 && h.y < 2.4 && abs(h.z - Dp * 0.62) < 0.62) {
      float ry = fract((h.y - 0.95) / 0.17);
      bool rowL = ry > 0.32 && ry < 0.56 && h.y < 2.12 && abs(h.z - Dp * 0.62 + 0.12) < 0.38 + 0.1 * bkHash1(floor((h.y - 0.95) / 0.17) + seed);
      col = h.y > 2.18 ? vec3(0.92, 0.94, 0.97) : rowL ? vec3(0.78, 0.8, 0.84) : vec3(0.05, 0.06, 0.07);
      if (h.y > 2.18 || rowL) id = 6.0;
    }
    if (kind > 1.5 && kind < 2.5 && h.y > 1.45 && h.y < 2.15) col = vec3(0.86, 0.85, 0.81); // wall cabinets
  }
  // ---- furniture (two boxes) ----
  vec3 bn = vec3(0.0); float tb = 1e9; vec3 bc = vec3(0.0); vec3 bn2 = vec3(0.0); float tb2 = 1e9; vec3 bc2 = vec3(0.0);
  // per-window layout variants (s1 picks, s3 shifts / mirrors) so neighbouring windows of the same
  // room kind do not repeat one arrangement (QA-ASSETS-04 / C06)
  float vr = s1 * 3.0; float mx = s3 < 0.5 ? 1.0 : -1.0;
  float sx = mx > 0.0 ? 0.0 : 1.0;   // mirror helper: x' = sx*W + mx*x
  if (kind < 0.5) {
    vec3 sofaC = bkPal(s2, vec3(0.32, 0.35, 0.4), vec3(0.55, 0.46, 0.36), vec3(0.28, 0.34, 0.3));
    if (vr < 1.0) {        // sofa against the back wall + coffee table
      tb = bkBox(p, d, vec3(W * 0.5 - min(1.05, W * 0.38), 0.0, Dp - 0.92), vec3(W * 0.5 + min(1.05, W * 0.38), 0.84, Dp - 0.04), bn); bc = sofaC;
      tb2 = bkBox(p, d, vec3(W * 0.5 - 0.5, 0.0, Dp - 2.2), vec3(W * 0.5 + 0.5, 0.42, Dp - 1.6), bn2); bc2 = woodC * 0.9;
    } else if (vr < 2.0) { // sofa side-on along one side wall, low TV unit on the other
      float a0 = sx * W + mx * 0.04, a1 = sx * W + mx * 0.94;
      tb = bkBox(p, d, vec3(min(a0, a1), 0.0, Dp * 0.35), vec3(max(a0, a1), 0.84, min(Dp - 0.1, Dp * 0.35 + 2.1)), bn); bc = sofaC;
      float c0 = sx * W + mx * (W - 0.45), c1 = sx * W + mx * (W - 0.05);
      tb2 = bkBox(p, d, vec3(min(c0, c1), 0.0, Dp * 0.4), vec3(max(c0, c1), 0.5, min(Dp - 0.1, Dp * 0.4 + 1.8)), bn2); bc2 = woodC * 0.75;
    } else {               // dining table in the room, sideboard on the back wall
      tb = bkBox(p, d, vec3(W * 0.5 - 0.8 + (s4 - 0.5) * 0.6, 0.0, Dp * 0.45), vec3(W * 0.5 + 0.8 + (s4 - 0.5) * 0.6, 0.76, Dp * 0.45 + 0.9), bn); bc = woodC;
      tb2 = bkBox(p, d, vec3(W * 0.5 - 0.9, 0.0, Dp - 0.48), vec3(W * 0.5 + 0.9, 0.86, Dp - 0.04), bn2); bc2 = mix(woodC, vec3(0.85, 0.84, 0.8), s2);
    }
  } else if (kind < 1.5) {
    vec3 cover = bkPal(s4, vec3(0.88, 0.87, 0.84), vec3(0.62, 0.68, 0.74), vec3(0.78, 0.7, 0.62));
    if (vr < 1.6) {        // bed with its head against the back wall
      float bx = W * (0.5 + (s4 - 0.5) * 0.25);
      tb = bkBox(p, d, vec3(bx - 0.8, 0.0, Dp - 2.05), vec3(bx + 0.8, 0.55, Dp - 0.04), bn); bc = cover;
      tb2 = bkBox(p, d, vec3(bx - 0.85, 0.0, Dp - 0.08), vec3(bx + 0.85, 1.05, Dp - 0.02), bn2); bc2 = woodC;
    } else {               // bed along a side wall, wardrobe on the back wall
      float a0 = sx * W + mx * 0.02, a1 = sx * W + mx * 1.62;
      tb = bkBox(p, d, vec3(min(a0, a1), 0.0, max(0.6, Dp - 2.15)), vec3(max(a0, a1), 0.55, Dp - 0.06), bn); bc = cover;
      float c0 = sx * W + mx * (W - 0.1), c1 = sx * W + mx * max(1.8, W - 1.9);
      tb2 = bkBox(p, d, vec3(min(c0, c1), 0.0, Dp - 0.62), vec3(max(c0, c1), 2.15, Dp - 0.02), bn2); bc2 = mix(woodC, vec3(0.9, 0.89, 0.86), s2);
    }
  } else if (kind < 2.5) {
    tb = bkBox(p, d, vec3(sx * W + mx * 0.0 - (mx < 0.0 ? 0.62 : 0.0), 0.0, 0.5), vec3(sx * W + mx * 0.0 + (mx > 0.0 ? 0.62 : 0.0), 0.92, Dp), bn); bc = vec3(0.84, 0.83, 0.8);
    tb2 = bkBox(p, d, vec3(W * (0.35 + 0.2 * s4), 0.0, Dp * 0.4), vec3(W * (0.35 + 0.2 * s4) + 0.8, 0.76, Dp * 0.4 + 0.8), bn2); bc2 = woodC;
  } else if (kind > 10.5 && kind < 11.5) {
    // classroom: rows of small desks (repeat along x / z) + a board on the back wall
    vec2 cell = vec2(1.3, 1.5);
    float zc = clamp(floor((p.z + d.z * 2.0 - 1.2) / cell.y), 0.0, 3.0) * cell.y + 1.4;
    float xc = (floor(clamp(p.x + d.x * 2.0, 0.0, W) / cell.x) + 0.5) * cell.x;
    tb = bkBox(p, d, vec3(xc - 0.5, 0.0, zc), vec3(xc + 0.5, 0.72, zc + 0.5), bn); bc = vec3(0.7, 0.62, 0.5);
    tb2 = bkBox(p, d, vec3(0.3, 0.9, Dp - 0.06), vec3(W - 0.3, 2.1, Dp - 0.02), bn2); bc2 = vec3(0.16, 0.24, 0.2);
  } else if (kind > 11.5 && kind < 12.5) {
    // clinic: examination couch + cabinet / screen
    float a0 = sx * W + mx * 0.3, a1 = sx * W + mx * 1.0;
    tb = bkBox(p, d, vec3(min(a0, a1), 0.0, Dp * 0.4), vec3(max(a0, a1), 0.7, Dp * 0.4 + 1.9), bn); bc = vec3(0.55, 0.68, 0.72);
    float c0 = sx * W + mx * (W - 0.1), c1 = sx * W + mx * (W - 1.3);
    tb2 = bkBox(p, d, vec3(min(c0, c1), 0.0, Dp - 0.5), vec3(max(c0, c1), 1.9, Dp - 0.04), bn2); bc2 = vec3(0.9, 0.9, 0.88);
  } else if (office) {
    if (vr < 1.2) {        // desk row facing the window, monitors
      tb = bkBox(p, d, vec3(0.4, 0.0, 1.3), vec3(W - 0.4, 0.75, 2.0), bn); bc = mix(vec3(0.74, 0.7, 0.64), vec3(0.9, 0.9, 0.88), s2);
      tb2 = bkBox(p, d, vec3(0.4 + s4 * 0.3, 0.75, 1.75), vec3(W - 0.4 - (1.0 - s4) * 0.3, 1.12, 1.8), bn2); bc2 = vec3(0.08);
    } else if (vr < 2.1) { // meeting table, shelving on the back wall
      tb = bkBox(p, d, vec3(W * 0.5 - min(1.3, W * 0.35), 0.0, Dp * 0.35), vec3(W * 0.5 + min(1.3, W * 0.35), 0.74, Dp * 0.35 + 1.1), bn); bc = woodC;
      tb2 = bkBox(p, d, vec3(0.3, 0.0, Dp - 0.42), vec3(W - 0.3, 1.9, Dp - 0.04), bn2); bc2 = vec3(0.86, 0.85, 0.82);
    } else {               // desks perpendicular to the window along one side wall, a screen partition
      float a0 = sx * W + mx * 0.05, a1 = sx * W + mx * 0.85;
      tb = bkBox(p, d, vec3(min(a0, a1), 0.0, 0.9), vec3(max(a0, a1), 0.75, min(Dp - 0.3, 4.2)), bn); bc = vec3(0.82, 0.8, 0.76);
      float c0 = sx * W + mx * 0.85, c1 = sx * W + mx * 0.9;
      tb2 = bkBox(p, d, vec3(min(c0, c1), 0.0, 0.9), vec3(max(c0, c1), 1.3, min(Dp - 0.3, 4.2)), bn2); bc2 = bkPal(s4, vec3(0.35, 0.42, 0.5), vec3(0.55, 0.52, 0.45), vec3(0.4, 0.5, 0.42));
    }
  } else if (shop) {
    tb = bkBox(p, d, vec3(W * 0.25, 0.0, Dp * 0.45), vec3(W * 0.75, 1.4, Dp * 0.6), bn); bc = vec3(0.8, 0.8, 0.82);
    tb2 = bkBox(p, d, vec3(0.3, 0.0, 0.9), vec3(1.6, 1.0, 1.5), bn2); bc2 = woodC;
  } else if (stair) {
    tb = bkBox(p, d, vec3(0.1, 0.0, Dp * 0.35), vec3(W * 0.48, H * 0.5, Dp - 0.1), bn); bc = vec3(0.64, 0.62, 0.59);
  } else if (lobby && housing) {
    tb = bkBox(p, d, vec3(0.15, 0.6, Dp * 0.3), vec3(0.5, 1.9, Dp * 0.75), bn); bc = vec3(0.45, 0.47, 0.5);   // mailbox wall
  } else if (lobby) {
    // reception desk across the lobby, light stone counter top on a timber front, a screen on it
    float r0 = W * (0.18 + 0.12 * s3), r1 = min(W - 0.4, r0 + max(1.6, W * 0.42));
    tb = bkBox(p, d, vec3(r0, 0.0, Dp * 0.48), vec3(r1, 1.08, Dp * 0.48 + 0.7), bn); bc = woodC * 1.1;
    tb2 = bkBox(p, d, vec3(r0 + 0.3, 1.08, Dp * 0.48 + 0.35), vec3(r0 + 0.85, 1.42, Dp * 0.48 + 0.4), bn2); bc2 = vec3(0.07, 0.08, 0.09);
  }
  if (tb2 < tb) { tb = tb2; bn = bn2; bc = bc2; }
  if (tb < t) { col = bc; n = bn; h = p + d * tb; t = tb; id = 5.0; }
  // ---- lighting ----
  vec3 lampC = mix(vec3(1.0, 0.62, 0.34), vec3(1.0, 0.84, 0.66), bkTempG);
  if (shop || office || lobby || stair) lampC = mix(vec3(1.0, 0.9, 0.78), vec3(0.94, 0.97, 1.0), bkTempG);
  // common-area lights stay on by day (the lobby seen through the street door); at night the
  // occupancy decides as for every window (same lit windows near and far)
  if (lobby || stair) lit = max(lit, 0.8 * smoothstep(0.05, 0.4, dot(dayE, vec3(0.2126, 0.7152, 0.0722))));
  float nearWin = exp(-max(h.z, 0.0) / 2.0);
  float edge = min(min(h.x, W - h.x), min(h.y, H - h.y));
  float ao = 0.5 + 0.5 * smoothstep(0.0, 0.6, edge + (id > 4.5 ? 0.3 : 0.0));
  // daylight: diffuse light from the window, falling off with depth (radiance = albedo E / pi)
  vec3 dayL = dayE * uBkInteriorDay * (0.085 + 0.5 * nearWin) * (0.55 + 0.45 * max(n.y, 0.0) + 0.25 * max(-n.z, 0.0)) * 0.3183;
  vec3 lc = vec3(W * 0.5, H - 0.05, Dp * 0.5);
  vec3 ld = lc - h; float dist2 = dot(ld, ld);
  float fall = 1.7 / (1.0 + 0.3 * dist2);
  float ndl = max(dot(n, normalize(ld)), 0.0) * 0.7 + 0.3;
  vec3 lampL = lampC * uBkInteriorNight * BK_ES * lit * fall * ndl;
  vec3 rad = col * (dayL + lampL) * ao;
  if (id == 2.0 && lit > 0.0 && abs(h.x - W * 0.5) < 0.3 && abs(h.z - Dp * 0.5) < 0.3) rad = lampC * 6.0 * uBkInteriorNight * BK_ES * lit;
  // lobby: a row of downlights along the depth, glowing by day too
  if (lobby && id == 2.0 && length(vec2(h.x - W * 0.5, (fract(h.z / 1.6) - 0.5) * 1.6)) < 0.11) rad = lampC * 9.0 * uBkInteriorNight * BK_ES * lit + dayE * 0.05;
  // backlit directory board (public lobbies): self-lit, readable by day through the glass
  if (id == 6.0) rad = col * (vec3(0.95, 0.97, 1.0) * 2.2 * uBkInteriorNight * BK_ES * max(lit, 0.6) + dayE * 0.12);
  if (inCurtain || inBlind) {
    vec3 cc = inBlind && !inCurtain ? vec3(0.88, 0.87, 0.84) : curtainCol * fold;
    // curtains are lit from the room behind (translucent) and by the window
    rad = cc * (dayL * 1.4 + lampC * uBkInteriorNight * BK_ES * lit * 0.85);
    coverage = 1.0;
  }
  return rad;
}
`;
const INTERIOR_FRAG_MAIN = /* glsl */`
{
  float bkHour = bkLocalHour(vBkWorld);
  uint bkBh = (uint(vI2.x + 0.5) << 16u) | uint(vI2.y + 0.5);
  float bkLit = bkWindowLit(bkBh, int(vI1.z + 0.5), int(vI1.w + 0.5), bkHour, int(vI2.w + 0.5));
  bkTempG = bkWindowTemp(bkBh, int(vI1.z + 0.5), int(vI1.w + 0.5));
  vec3 bkNW = normalize(vBkNormalW);
  vec3 bkDayE = bkSkyIrr(bkNW, vBkWorld) + bkSunIrr(bkNW, vBkWorld) * 0.3;
  float bkCov;
  vec3 bkRad = bkInterior(vRoomPos, vRoomDir, bkLit, bkDayE, bkCov);
  float bkNV = saturate(dot(geometryNormal, geometryViewDir));
  vec3 bkF = F_Schlick(material.specularColor, material.specularF90, bkNV);
#ifdef BK_CURTAIN
  outgoingLight += bkRad * vec3(0.4, 0.5, 0.58) * (1.0 - bkF);     // through the blue-grey coat
#else
  outgoingLight += bkRad * vec3(0.66, 0.73, 0.76) * (1.0 - bkF);
#endif
}
`;

// ---- glass: reflections of the street scene ----
// The planet sky environment shows bare red ground below the horizon, so façade glass seen from
// above or from far away read as black holes. A glazed façade in a street really reflects the
// opposite frontage (light ceramic with window bands), the street trees in front of it and the
// paving; open sky above the skyline keeps the environment map. Ray-traced against a simple street
// section (tree line 6–9.5 m, frontage 19–36 m, skyline 9–43 m with gaps) in the façade frame, so the
// reflection has parallax and the lower floors pick up the trees (brief §3 玻璃同时保留街树反射).
// r: reflected ray (world), up: local up, n: glass normal (world), hz: height of the fragment above
// the street (m), seed: per building 0..1. Returns radiance (scene units) + coverage (0 = sky).
const GLASS_PARS = /* glsl */`
float bkH1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec4 bkStreetReflect(vec3 r, vec3 up, vec3 n, vec3 wp, float hz, float seed) {
  float sE = dot(r, up);
  vec3 rh = r - up * sE; float lh = length(rh);
  vec3 nh = n - up * dot(n, up); float ln = length(nh);
  if (lh < 0.02 || ln < 0.35) return vec4(0.0);          // steep rays, skylights: environment only
  rh /= lh; nh /= ln;
  float cosA = dot(rh, nh);
  if (cosA < 0.06) return vec4(0.0);
  float tanE = sE / lh;
  float tanA = clamp(dot(rh, cross(up, nh)) / cosA, -40.0, 40.0);
  hz = clamp(hz, 0.3, 400.0);
  vec3 Ev = bkSkyIrr(-rh, wp) + bkSunIrr(-rh, wp) * 0.6;   // frontage faces looking back at the glass
  vec3 Eg = bkSkyIrr(up, wp) * 0.8 + bkSunIrr(up, wp) * 0.5;  // street, partly in the frontage shadow
  float Dt = 6.0 + seed * 3.5, Do = 19.0 + fract(seed * 7.13) * 17.0;
  float pG = sE < -1e-4 ? hz / -tanE * cosA : 1e9;          // perpendicular distance where the ray meets the ground
  vec3 col = vec3(0.0); float cov = 0.0;
  if (pG > Do) {
    // opposite frontage: storeys with window bands, irregular skyline with gaps (cross streets)
    float y = hz + Do / cosA * tanE;
    float x = Do * tanA + seed * 97.0;
    float cell = floor(x / 18.0);
    float Ho = bkH1(cell * 5.3 + seed) < 0.22 ? 0.0 : 9.0 + 34.0 * bkH1(cell + seed * 17.0);
    float dy = fwidth(y) + 0.05;
    float hit = (1.0 - smoothstep(Ho - dy, Ho + dy, y)) * step(0.0, y);
    float fy = fract(y / 3.2), fx = fract(x / 1.6 + 0.5 * cell);
    float win = smoothstep(0.3, 0.38, fy) * (1.0 - smoothstep(0.86, 0.92, fy)) * smoothstep(0.12, 0.2, fx) * (1.0 - smoothstep(0.8, 0.88, fx));
    win = mix(win, 0.42, smoothstep(0.1, 0.5, fwidth(y / 3.2) + fwidth(x / 1.6)));
    vec3 front = mix(vec3(0.6, 0.59, 0.56) + 0.1 * bkH1(cell * 3.1), vec3(0.1, 0.12, 0.14), win) * Ev * 0.3183;
    // a downward ray passing over the frontage ends on the city beyond (roofs / streets)
    vec3 beyond = 0.3 * Eg * 0.3183;
    if (sE < 0.0) { col = mix(beyond, front, hit); cov = 1.0; } else { col = front; cov = hit; }
  } else {
    col = vec3(0.2, 0.19, 0.18) * Eg * 0.3183; cov = 1.0;     // paving / road in front of the frontage
  }
#ifdef BK_CURTAIN
  // curtain walls (towers / offices, QQ-15 / QQ2-06): rays from high panes clear the street frontage →
  // two rings of towers round the square — a NEAR ring 42–75 m out, 60–260 m tall (it catches the steep
  // reflections of upper panes seen from the plaza: looking up, the front panes mirror the opposite tower
  // bodies, not only the sky) and a FAR ring 120–210 m out, 90–320 m tall seen through its gaps — and,
  // beyond them, the hazy city silhouette (fixed by world azimuth, so every pane agrees); lit windows at night
  if (cov < 0.99) {
    for (int L = 0; L < 2; L++) {
      float nr = L == 0 ? 1.0 : 0.0;
      float Dn = nr > 0.5 ? 42.0 + 33.0 * fract(seed * 3.7) : 120.0 + 90.0 * fract(seed * 2.3 + 0.4);
      float pT = Dn / cosA;                                     // horizontal travel to the tower line
      float yT = hz + pT * tanE;
      float cw = nr > 0.5 ? 40.0 : 56.0;
      float xT = Dn * tanA + seed * (nr > 0.5 ? 211.0 : 157.0);
      // derivatives first (uniform control flow), then the per-pixel early outs
      float fwx = fwidth(xT), fwy = fwidth(yT);
      float cT = floor(xT / cw) + (nr > 0.5 ? 0.0 : 517.0);
      float hT = bkH1(cT * 2.9 + seed * 3.0);
      float wT = (nr > 0.5 ? 20.0 : 26.0) + 16.0 * bkH1(cT * 1.9 + seed);
      float HT = nr > 0.5 ? 60.0 + 200.0 * pow(bkH1(cT * 4.1 + seed * 7.0), 0.8) : 90.0 + 230.0 * bkH1(cT * 4.1 + seed * 7.0);
      float ax = abs(xT - (floor(xT / cw) + 0.5) * cw) - wT * 0.5;
      float aw = fwx + 0.05, ay = fwy + 0.05;
      // (step(Dn, pG): a downward ray that met the ground first reaches no tower)
      float hit = step(Dn, pG) * step(nr > 0.5 ? 0.22 : 0.3, hT) * (1.0 - smoothstep(-aw, aw, ax)) * (1.0 - smoothstep(HT - ay, HT + ay, yT)) * step(0.0, yT);
      // an if-block, not 'continue': ANGLE's D3D11 backend treats a loop with continue/break as discontinuous and
      // emits every dFdx/dFdy/fwidth inside it as 0, which would drop the tower-edge and pane filtering above
      if (hit > 0.0 && cov < 0.99) {
        bool glassT = bkH1(cT * 6.7 + seed) < 0.6;
        float sy = glassT ? 4.0 : 3.4;
        float fy = fract(yT / sy), fx = fract(xT / (glassT ? 1.5 : 2.4));
        float mull = glassT ? max(smoothstep(0.9, 0.96, fx), smoothstep(0.86, 0.94, fy)) : 0.0;
        float win = glassT ? 1.0 - mull : smoothstep(0.32, 0.4, fy) * (1.0 - smoothstep(0.84, 0.9, fy)) * smoothstep(0.15, 0.22, fx) * (1.0 - smoothstep(0.78, 0.85, fx));
        win = mix(win, glassT ? 0.85 : 0.45, smoothstep(0.1, 0.5, fwy / sy + fwx / 1.5));
        // white ceramic slab-edge bands every few storeys and a lighter crown (the silver-white skyline)
        float band = glassT ? (1.0 - smoothstep(0.0, 0.08, abs(fract(yT / (sy * 4.0)) - 0.5) - 0.44)) : 0.0;
        float crown = smoothstep(HT - 9.0, HT - 6.0, yT);
        vec3 shell = glassT ? vec3(0.2, 0.25, 0.3) : vec3(0.62, 0.6, 0.57);
        vec3 pane = glassT ? mix(vec3(0.1, 0.14, 0.19), vec3(0.3, 0.38, 0.48), smoothstep(0.0, 1.0, (yT - hz) / max(HT - hz, 1.0)) * 0.6) : vec3(0.1, 0.12, 0.14);
        vec3 tc = mix(shell, pane, win);
        tc = mix(tc, vec3(0.7, 0.69, 0.66), max(band * 0.85, crown * 0.6));
        tc *= Ev * 0.3183;
        float lit = step(0.64, bkH1(floor(xT / 1.5) * 3.1 + floor(yT / sy) * 7.7 + cT));
        tc += vec3(1.0, 0.78, 0.52) * 0.6 * BK_ES * bkNight(wp) * lit * win * (1.0 - band);
        float haze = 1.0 - exp(-pT / 2600.0);
        tc = mix(tc, bkSkyIrr(-rh, wp) * 0.25, haze);
        col = mix(col, tc, hit * (1.0 - cov)); cov = max(cov, hit * (1.0 - haze * 0.5));
      }
    }
    // distant city silhouette ~0.6–1 km away, by world azimuth; mostly haze-blended into the sky
    if (cov < 0.99 && sE > -0.02) {
      float Df = 650.0 + 350.0 * fract(seed * 5.1);
      float yF = hz + Df * tanE;
      vec3 rw = normalize(rh);
      float az = atan(rw.x, rw.z) * 9.549;                    // ≈ 6° cells (60 per turn)
      float cF = floor(az * 2.0);
      float HF = bkH1(cF * 1.37) < 0.25 ? 12.0 : 18.0 + 95.0 * bkH1(cF * 3.11) * bkH1(cF * 0.71 + 5.0);
      float ayF = fwidth(yF) + 0.3;
      float hitF = (1.0 - smoothstep(HF - ayF, HF + ayF, yF)) * step(-8.0, yF);
      if (hitF > 0.0) {
        vec3 fc = mix(vec3(0.5, 0.5, 0.5), vec3(0.3, 0.33, 0.38), bkH1(cF * 2.3)) * Ev * 0.3183;
        fc += vec3(1.0, 0.8, 0.55) * 0.25 * BK_ES * bkNight(wp) * step(0.55, bkH1(floor(yF / 4.0) + cF * 17.0));
        col = mix(col, fc, hitF * (1.0 - cov)); cov = max(cov, hitF * 0.45);
      }
    }
  }
#endif
  // street trees (8.5 m spacing, ~25 % gaps), crowns 3–9 m, in front of everything else
  if (pG > Dt * 0.5) {
    float y = hz + Dt / cosA * tanE;
    float x = Dt * tanA + seed * 53.0;
    float cell = floor(x / 8.5);
    float cx = (cell + 0.5) * 8.5 + (bkH1(cell + seed * 5.0) - 0.5) * 2.5;
    float rad = 2.0 + bkH1(cell * 1.7 + seed) * 1.1, yc = 5.4 + bkH1(cell * 2.3 + seed) * 1.6;
    float dx = (x - cx) / rad, dz = (y - yc) / (rad * 1.1);
    float e = dx * dx + dz * dz + 0.16 * sin(x * 2.3 + y * 1.7) * sin(x * 1.3 - y * 2.9);
    float w = fwidth(e) + 0.05;
    float crown = 1.0 - smoothstep(1.0 - w, 1.0 + w, e);
    float trunk = (1.0 - smoothstep(0.12, 0.2 + fwidth(x), abs(x - cx))) * step(0.0, y) * step(y, yc - rad * 0.6);
    float t = max(crown, trunk) * step(0.25, bkH1(cell * 4.7 + seed * 9.0));
    if (t > 0.0) {
      float leaf = 0.7 + 0.6 * bkH1(floor(x * 1.7) + floor(y * 1.9) * 7.0);
      vec3 tc = (crown >= trunk ? vec3(0.1, 0.15, 0.06) * leaf : vec3(0.09, 0.075, 0.06)) * (bkSkyIrr(-rh, wp) + bkSunIrr(-rh, wp) * 0.5) * 0.3183;
      col = mix(col, tc, t); cov = max(cov, t);
    }
  }
  return vec4(col, cov);
}
`;
// after <lights_fragment_maps>: replace the environment radiance where the reflected ray meets the
// street scene (outer faces only; specular occlusion from the planet patch's AO)
const GLASS_REFL = /* glsl */`
#if defined( RE_IndirectSpecular )
if (gl_FrontFacing && BK_GLASS_ON > 0.5) {
  vec3 bkRw = normalize(inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix));
  vec3 bkGn = normalize(inverseTransformDirection(geometryNormal, viewMatrix));
  vec4 bkSR = bkStreetReflect(bkRw, bkUp(vBkWorld), bkGn, vBkWorld, BK_GLASS_HZ, BK_GLASS_SEED);
#ifdef LP_PATCHED
  bkSR.rgb *= lpAO;
#endif
  radiance = mix(radiance, bkSR.rgb, bkSR.a);
}
#endif
`;

// facade lamps / signage gated by night (photocell)
const LAMP_FRAG = /* glsl */`
{
  float bkN = bkNight(vBkWorld);
  totalEmissiveRadiance *= mix(bkN, 1.0, bkAlways) * uBkLightLevel;
}
`;
// glass_clear: room ids of the pane (street-reflection height / seed)
const CLEAR_VERT = /* glsl */`
attribute vec4 iwin0;
attribute vec4 iwin1;
attribute vec4 iwin2;
varying vec4 vC0; varying vec4 vC1; varying vec4 vC2;
`;
// ceiling panels (and frosted windows) gated by the occupancy of the room's window
const OCC_VERT = /* glsl */`
attribute vec4 iwin1;
attribute vec4 iwin2;
varying vec4 vP1; varying vec4 vP2;
`;
const PANEL_FRAG = /* glsl */`
{
  uint bkBh = (uint(vP2.x + 0.5) << 16u) | uint(vP2.y + 0.5);
  float bkLit = bkWindowLit(bkBh, int(vP1.z + 0.5), int(vP1.w + 0.5), bkLocalHour(vBkWorld), int(vP2.w + 0.5));
  totalEmissiveRadiance *= mix(vec3(1.0, 0.78, 0.56), vec3(1.0, 0.92, 0.82), bkWindowTemp(bkBh, int(vP1.z + 0.5), int(vP1.w + 0.5)));
  totalEmissiveRadiance *= max(bkLit, 0.0);
}
`;
const FROSTED_FRAG = /* glsl */`
{
  uint bkBh = (uint(vP2.x + 0.5) << 16u) | uint(vP2.y + 0.5);
  float bkLit = vP2.x + vP2.y > 0.0 ? bkWindowLit(bkBh, int(vP1.z + 0.5), int(vP1.w + 0.5), bkLocalHour(vBkWorld), int(vP2.w + 0.5)) : 0.0;
  vec3 bkC = mix(vec3(1.0, 0.8, 0.6), vec3(0.95, 0.96, 1.0), bkWindowTemp(bkBh, int(vP1.z + 0.5), int(vP1.w + 0.5)) * 0.6);
  totalEmissiveRadiance += bkC * 0.9 * bkLit * BK_ES;
  // daylight glowing through the frosted pane from inside is negligible; sky reflection via env
}
`;

// far-facade shader for the 'mass' LOD (see kit/mass.js for the attribute layout)
const MASS_VERT = /* glsl */`
attribute vec4 facade;
attribute vec4 facadeId;
varying vec4 vFac; varying vec4 vFacId;
`;
const MASS_FRAG_PARS = /* glsl */`
varying vec4 vFac; varying vec4 vFacId;
`;
const MASS_FRAG = /* glsl */`
float bkWin = 0.0; float bkBand = 0.0; float bkLitM = 0.0; float bkTempM = 0.0; float bkRail = 0.0;
{
  float fh = vFac.x, bw = max(vFac.y, 1.0), sid = vFac.z, gh = vFac.w;
  float eave = vFacId.z; int flags = int(vFacId.w + 0.5);
  float u = vBkUv.x, v = vBkUv.y;
  bool zr = sid < 2.5 || sid > 4.5;           // ZR ceramic family (0,1,2,5,6)
  bool cold = sid > 2.5 && sid < 3.5, util = sid > 3.5 && sid < 4.5;
  vec3 wallC = util ? vec3(0.9, 0.9, 0.88) : cold ? vec3(0.87, 0.87, 0.85) : vec3(0.94, 0.925, 0.89);
  vec3 c = wallC;
  // sky-garden storey (flag 1 = blank band on a façade that keeps its bay width, i.e. the refuge /
  // plant storeys of loftMass towers; kit party walls and windowless volumes carry bayW 0): planted
  // terrace behind a glass balustrade, white slab edge and soffit, shaded set-back sky lobby
  bool skyG = (flags & 1) != 0 && vFac.y > 0.05 && v >= gh && v < eave;
  if (v < 0.3) c = vec3(0.6, 0.59, 0.57);
  else if (skyG) {
    float fv = fract((v - gh) / fh);
    uint bh0 = (uint(vFacId.x + 0.5) << 16u) | uint(vFacId.y + 0.5);
    float n1 = bkRand(bkHash(bh0 ^ (uint(floor(u / 2.3)) * 0x27d4eb2du)));
    float n2 = bkRand(bkHash(bh0 ^ (uint(floor(u / 0.9)) * 0x165667b1u)));
    float crown = 0.42 + 0.34 * n1 + 0.08 * n2;
    vec3 green = mix(vec3(0.13, 0.24, 0.08), vec3(0.3, 0.42, 0.15), n2) * (0.85 + 0.3 * n1);
    c = fv < 0.07 ? vec3(0.95, 0.94, 0.92) : fv < 0.13 ? mix(vec3(0.62, 0.7, 0.72), green, 0.5) : fv < crown ? green : fv > 0.9 ? vec3(0.92, 0.91, 0.89) : vec3(0.27, 0.3, 0.3);
    bkRail = fv > 0.07 && fv < 0.13 ? 1.0 : 0.0;
  }
  else if (v < eave && (flags & 1) == 0) {
    float fl = v < gh ? 0.0 : 1.0 + floor((v - gh) / fh);
    float fv = v < gh ? v / gh : fract((v - gh) / fh);
    float fu = fract(u / bw);
    float bay = floor(u / bw);
    uint bh = (uint(vFacId.x + 0.5) << 16u) | uint(vFacId.y + 0.5);
    float r = bkRand(bkHash(bh ^ (uint(bay) * 0x9e3779b9u) ^ 0x6a3du));
    bool shopG = (flags & 2) != 0 && fl < 0.5;
    bool glazedG = (flags & 8) != 0 && fl < 0.5;
    bool bands = (flags & 4) != 0;
    float wx, wy0, wy1;
    if (shopG) { wx = 0.92; wy0 = 0.06; wy1 = 0.78; if (fv > 0.82 && fv < 0.93 && fu > 0.15 && fu < 0.85) c = vec3(0.98); }
    else if (glazedG) { wx = r < 0.5 ? 0.85 : 0.5; wy0 = 0.04; wy1 = 0.8; }
    else if (zr) { wx = r < 0.45 ? 0.9 : r < 0.8 ? 0.62 : 0.4; wy0 = bands ? 0.16 : 0.14; wy1 = 0.93; }
    else if (cold) { wx = 0.42; wy0 = 0.3; wy1 = 0.82; }
    else { wx = 0.36; wy0 = 0.34; wy1 = 0.8; }
    if (abs(fu - 0.5) < wx * 0.5 && fv > wy0 && fv < wy1) {
      bkWin = 1.0;
      // mullions
      float mu = fract((fu - 0.5 + wx * 0.5) / max(wx, 0.01) * (wx > 0.7 ? 3.0 : 2.0));
      if (mu < 0.04 || (zr && abs(fv - 0.78) < 0.012)) bkWin = 0.6;
      bkLitM = bkWindowLit(bh, int(fl), int(bay), bkLocalHour(vBkWorld), (flags >> 4) & 7);
      bkTempM = bkWindowTemp(bh, int(fl), int(bay));
    }
    if (bands && fl > 0.5) {
      if (fv < 0.12 || fv > 0.985) { bkBand = 1.0; bkWin = 0.0; }
      else if (fv < 0.45 && zr) bkRail = 1.0;
    }
  }
  if (bkWin > 0.5) c = vec3(0.11, 0.14, 0.17);
  else if (bkWin > 0.1) c = vec3(0.6, 0.62, 0.65);
  if (bkBand > 0.5) c = vec3(0.98, 0.97, 0.945);
  if (bkRail > 0.5 && bkBand < 0.5) c = mix(c, vec3(0.62, 0.72, 0.76), 0.35);
  diffuseColor.rgb *= c;
}
`;

// dust / weathering on upward faces (red Martian dust settling on ledges, sills, copings)
const DUST_FRAG = /* glsl */`
{
  float bkUpN = dot(normalize(vBkNormalW), bkUp(vBkWorld));
  float bkM = uBkMacroOn > 0.5 ? texture2D(uBkMacro, vBkUv * 0.11).g : 0.5;
  float bkD = smoothstep(0.55, 0.97, bkUpN) * bkDustAmt * uBkDust * (0.35 + 0.9 * bkM);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.36, 0.25) * 0.85, clamp(bkD, 0.0, 0.6));
}
`;


// interiors: rooms see little of the sky (occlusion) and are lit by lamps at night
const INDOOR_FRAG = /* glsl */`
{
  // Inside a room the bounce light comes from the room's own warm-neutral surfaces, not from the
  // blue sky / red ground outside: keep the irradiance level (albedo factored out, so it works for
  // the planet patch and plain three lights alike) but drop most of the outdoor hue — otherwise
  // ceilings (which "see" the red ground hemisphere) turn brown and walls go grey-blue.
  vec3 bkDc = max(material.diffuseColor, vec3(0.004));
  vec3 bkIrr = reflectedLight.indirectDiffuse / bkDc;
  float bkL = dot(bkIrr, vec3(0.2126, 0.7152, 0.0722));
  bkIrr = mix(bkIrr, vec3(bkL) * vec3(1.0, 0.95, 0.88), 0.8);
  // daylight factor of the surface: per-vertex falloff from the room's windows ('idl', 'full'
  // interiors) — bright beside the glass, dim at the back of deep rooms; 0 = not set → uniform level
  float bkDL = vBkIdl > 0.001 ? vBkIdl : uBkIndoorAO;
  reflectedLight.indirectDiffuse = bkIrr * bkDc * bkDL;   // daylight bounced off warm floors / walls
  reflectedLight.indirectSpecular *= bkDL;
}
reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.86, 0.7) * uBkIndoorLampE * 20.0 * BK_ES * bkNight(vBkWorld) * 0.3183;
`;

// ---------------------------------------------------------------------------
// material construction
// ---------------------------------------------------------------------------
function newMaterial(key) {
  const d = D[key] || null;
  if (!d) {
    if (!WARNED.has(key)) { WARNED.add(key); console.warn('[buildings] unknown material key', key); }
    return new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.8, vertexColors: true });
  }
  const color = new THREE.Color(d.c ?? 0xffffff);
  let m;
  const base = { color, roughness: Math.min(1, d.r ?? 0.8), metalness: d.mt ?? 0, vertexColors: true, envMapIntensity: d.env ?? 1.0 };
  switch (d.shader) {
    case 'interior':
      // architectural glass units: reflectance at normal incidence d.f0 (IGU ≈ 0.125, coated curtain
      // wall ≈ 0.2) with a blue cast d.ft — the blue-grey glass of R2 / Z03 reads from its sky and
      // street reflection (GLASS_REFL); the room behind is added with (1 − F) in the shader
      m = new THREE.MeshPhysicalMaterial({ ...base, roughness: d.curtain ? 0.04 : 0.03, metalness: 0, ior: 1.52, specularIntensity: 1, specularColor: f0Color(d), envMapIntensity: 1.0 });
      break;
    case 'clear':
      m = new THREE.MeshPhysicalMaterial({ ...base, roughness: d.agri ? 0.2 : 0.04, metalness: 0, ior: 1.5, specularIntensity: 1, specularColor: d.railing ? new THREE.Color(0.86 * 1.4, 0.94 * 1.4, 0.9 * 1.4) : d.agri ? new THREE.Color(1.6, 1.7, 1.65) : f0Color(d), transparent: true, opacity: d.alpha ?? 0.15, depthWrite: false, side: d.railing ? THREE.FrontSide : THREE.DoubleSide, envMapIntensity: 0.9 });
      m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendEquation = THREE.AddEquation;
      m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case 'frosted':
      m = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.3, metalness: 0, ior: 1.5, transmission: 0 });
      break;
    case 'lamp':
      m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.4, emissive: new THREE.Color(d.e), emissiveIntensity: d.ei ?? 4 });
      break;
    case 'panel':
      m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.5, emissive: new THREE.Color(d.e), emissiveIntensity: d.ei ?? 3 });
      break;
    case 'mass':
      m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.75, metalness: 0 });
      break;
    default:
      m = d.phys ? new THREE.MeshPhysicalMaterial({ ...base }) : new THREE.MeshStandardMaterial({ ...base });
      if (d.phys) {
        const p = d.phys;
        if (p.clearcoat) { m.clearcoat = p.clearcoat; m.clearcoatRoughness = p.clearcoatRoughness ?? 0.1; }
        if (p.anisotropy) { m.anisotropy = p.anisotropy; m.anisotropyRotation = 0; }
        if (p.sheen) { m.sheen = p.sheen; m.sheenRoughness = p.sheenRoughness ?? 0.5; m.sheenColor = new THREE.Color(p.sheenColor ?? 0xffffff); }
        if (p.specularIntensity != null) m.specularIntensity = p.specularIntensity;
      }
  }
  if (d.side === 2) m.side = THREE.DoubleSide;
  // alpha-tested cut-outs: crisp leaf edges (alpha-to-coverage + TAA turned the foliage cards into
  // soft, half-transparent ghosts), d.a2c true opts back in
  if (d.alphaTest) { m.alphaTest = d.alphaTest; m.alphaToCoverage = d.a2c === true; }
  m.name = 'bk:' + key;
  if (d.tex) applyTextures(m, d);
  patchMaterial(m, key, d);
  return m;
}
const WARNED = new Set();

// specularColor giving reflectance d.f0 at normal incidence (ior 1.52 → 0.0426) with spectral tint d.ft
function f0Color(d) {
  const f = (d.f0 ?? 0.08) / 0.0426, t = d.ft || [0.8, 0.9, 1.0];
  return new THREE.Color(t[0] * f, t[1] * f, t[2] * f);
}

function patchMaterial(m, key, d) {
  const shader = d.shader || 'std';
  const macro = d.macro || 0, dust = d.dust || 0;
  const occ = shader === 'panel' || shader === 'frosted';
  // façade glass with street reflections; glass_clear carries the room ids (iwin*) for its height
  const glass = shader === 'interior' || (shader === 'clear' && !d.agri);
  const clearIds = shader === 'clear' && !!d.iwin;
  const hook = function (sh) {
    if (sh.__bk) return; sh.__bk = true;
    for (const [k, v] of Object.entries(BUILDING_UNIFORMS)) sh.uniforms[k] = v;
    sh.uniforms.bkAlways = { value: d.always ? 1 : 0 };
    sh.uniforms.bkMacroAmt = { value: macro };
    sh.uniforms.bkDustAmt = { value: dust };
    sh.uniforms.uBkMacroOn = { get value() { return BUILDING_UNIFORMS.uBkMacro.value ? 1 : 0; } };
    // vertex: world position / normal + raw uv varyings for every building material
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_COMMON + (shader === 'interior' ? INTERIOR_VERT : '') + (occ ? OCC_VERT : '') + (shader === 'mass' ? MASS_VERT : '') + (clearIds ? CLEAR_VERT : '') + (d.indoor ? 'attribute float idl;\nvarying float vBkIdl;\n' : ''));
    let vmain = VERT_MAIN;
    if (shader === 'interior') vmain = INTERIOR_VERT_MAIN;
    if (occ) vmain += 'vP1 = iwin1; vP2 = iwin2;\n';
    if (clearIds) vmain += 'vC0 = iwin0; vC1 = iwin1; vC2 = iwin2;\n';
    if (d.indoor) vmain += 'vBkIdl = idl;\n';
    if (shader === 'mass') vmain += 'vFac = facade; vFacId = facadeId;\n';
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + vmain);
    // fragment
    let pars = '\n' + common() + '\nvarying vec3 vBkWorld;\nvarying vec3 vBkNormalW;\nvarying vec2 vBkUv;\nuniform sampler2D uBkMacro;\nuniform float uBkMacroOn;\nuniform float uBkDust;\nuniform float bkAlways;\nuniform float bkMacroAmt;\nuniform float bkDustAmt;\nuniform float uBkIndoorAO;\nuniform float uBkIndoorLampE;\n';
    if (shader === 'interior') pars += INTERIOR_FRAG_PARS;
    if (occ) pars += 'varying vec4 vP1; varying vec4 vP2;\n';
    if (shader === 'mass') pars += MASS_FRAG_PARS;
    if (clearIds) pars += 'varying vec4 vC0; varying vec4 vC1; varying vec4 vC2;\n';
    if (d.indoor) pars += 'varying float vBkIdl;\n';
    if (glass) {
      // height of the fragment above the street (storey index × storey height + height in the room)
      // and a per-building seed, from the room ids of the pane
      if (shader === 'interior') pars += '#define BK_GLASS_HZ (vI1.z * (max(vI0.w, 2.2) + 0.35) + vRoomPos.y + 0.35)\n#define BK_GLASS_SEED fract(vI2.y * 0.0001373 + vI2.x * 0.0000171)\n#define BK_GLASS_ON 1.0\n';
      else if (clearIds) pars += '#define BK_GLASS_HZ (vC1.z * (max(vC0.w, 2.2) + 0.35) + vC1.x + vBkUv.y + 0.35)\n#define BK_GLASS_SEED fract(vC2.y * 0.0001373 + vC2.x * 0.0000171)\n#define BK_GLASS_ON step(0.5, vC0.w)\n';
      else pars += '#define BK_GLASS_HZ 6.0\n#define BK_GLASS_SEED 0.5\n#define BK_GLASS_ON 1.0\n';
      if (d.curtain) pars += '#define BK_CURTAIN 1\n';
      pars += GLASS_PARS;
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + pars);
    if (glass) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + GLASS_REFL);
    let colorAdd = '';
    if (macro > 0) colorAdd += '{ float bkM = uBkMacroOn > 0.5 ? texture2D(uBkMacro, vBkUv * 0.025).g : 0.5; diffuseColor.rgb *= 1.0 + (bkM - 0.5) * 2.0 * bkMacroAmt; }\n';
    if (shader === 'mass') colorAdd += MASS_FRAG;
    if (dust > 0) colorAdd += DUST_FRAG;
    if (colorAdd) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + colorAdd);
    if (shader === 'mass') sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (bkWin > 0.5) roughnessFactor = 0.06; if (bkBand > 0.5) roughnessFactor = 0.32; if (bkRail > 0.5) roughnessFactor = min(roughnessFactor, 0.25);\n');
    if (shader === 'mass') sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nif (bkWin > 0.5) material.specularColor = vec3(0.065, 0.075, 0.088);\n');
    // emissive: unpatched materials get the emissive unit here (patched: app.lighting does it before our code)
    let emi = '#ifndef LP_PATCHED\ntotalEmissiveRadiance *= BK_ES;\n#endif\n';
    if (shader === 'mass') emi += 'totalEmissiveRadiance += mix(vec3(1.0, 0.64, 0.36), vec3(1.0, 0.86, 0.7), bkTempM) * 1.1 * bkLitM * BK_ES * step(0.5, bkWin);\n';
    if (shader === 'lamp') emi += LAMP_FRAG;
    if (shader === 'panel') emi += PANEL_FRAG;
    if (shader === 'frosted') emi += FROSTED_FRAG;
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emi);
    if (shader === 'interior') sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', INTERIOR_FRAG_MAIN + '\n#include <opaque_fragment>');
    if (d.indoor) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + INDOOR_FRAG);
  };
  m.onBeforeCompile = hook;
  const variant = 'bk4:' + shader + ':' + (macro > 0 ? 'm' : '') + (dust > 0 ? 'd' : '') + (d.always ? 'a' : '') + (d.indoor ? 'i' : '') + (glass ? 'g' : '') + (clearIds ? 'c' : '') + (d.curtain ? 'w' : '') + (d.railing ? 'r' : '') + ':' + occGlsl().call.length;
  m.customProgramCacheKey = () => variant;
}

/** Shared material for a key (created on first use, lighting-patched). */
export function getBuildingMaterial(key, app) {
  let m = CACHE.get(key);
  if (m) return m;
  linkLighting(app);
  m = newMaterial(key);
  if (app && app.lighting && typeof app.lighting.patch === 'function') {
    const d = D[key] || {};
    // patch() chains our onBeforeCompile (ours runs first) and extends customProgramCacheKey.
    // nightEmissive stays false: lamps are gated here, window lights follow occupancy.
    app.lighting.patch(m, { nightEmissive: false, receiveCloudShadow: !d.shader || d.shader === 'mass' || d.shader === 'interior' });
  }
  CACHE.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// mesh helpers
// ---------------------------------------------------------------------------
/**
 * Build a THREE.Group from BuildingMeshData. opts {castShadow=true, receiveShadow=true, name}
 */
export function createBuildingObject(data, app, opts = {}) {
  const group = new THREE.Group();
  group.name = opts.name || data.stats?.id || 'building';
  const bmin = data.bounds.min, bmax = data.bounds.max;
  const box = new THREE.Box3(new THREE.Vector3(...bmin), new THREE.Vector3(...bmax));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  for (const p of data.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(p.color || new Float32Array((p.position.length / 3) * 3).fill(1), 3));
    if (p.attributes) for (const [n, a] of Object.entries(p.attributes)) g.setAttribute(n, new THREE.BufferAttribute(a.array, a.itemSize));
    if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
    g.boundingBox = box.clone(); g.boundingSphere = sphere.clone();
    const mat = getBuildingMaterial(p.material, app);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = p.material;
    mesh.castShadow = opts.castShadow !== false && !NO_SHADOW.has(p.material);
    mesh.receiveShadow = opts.receiveShadow !== false;
    if (TRANSPARENT.has(p.material)) mesh.renderOrder = 2;
    mesh.userData.materialKey = p.material;
    group.add(mesh);
  }
  group.userData.bounds = data.bounds;
  group.userData.anchors = data.anchors;
  group.userData.stats = data.stats;
  if (data.colliders) group.userData.colliders = data.colliders;
  return group;
}

/**
 * Invisible collision mesh (building frame) with a three-mesh-bvh MeshBVH in geometry.boundsTree,
 * built from data.colliders ('full' LOD). Parent it to the building group (same transform) and
 * hand {mesh} to the controls' getColliders(). Returns null when there are no colliders.
 */
export function createColliderMesh(data) {
  const c = data && data.colliders;
  if (!c || !c.index || !c.index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
  g.setIndex(new THREE.BufferAttribute(c.index, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.boundsTree = new MeshBVH(g, { targetLeafSize: 8 });
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  mesh.name = 'colliders';
  mesh.visible = false;
  mesh.userData.isCollider = true;
  return mesh;
}

/** Dispose the geometries of a building group (materials are shared). */
export function disposeBuildingObject(group) {
  group.traverse((o) => { if (o.isMesh) { if (o.geometry.boundsTree) o.geometry.boundsTree = null; o.geometry.dispose(); } });
}

/** Material keys that are transparent (render after opaque, no shadow casting). */
export function isTransparentKey(key) { return TRANSPARENT.has(key); }

// ---------------------------------------------------------------------------
// batching support (city BatchedMesh / merged tile geometry, decision D5) — see kit/README.md "Batching"
// ---------------------------------------------------------------------------
/** Keys that never cast shadows (glass, lamps, light panels) — same rule as createBuildingObject. */
export const NO_SHADOW_KEYS = NO_SHADOW;
/** True when parts of this key cast shadows (createBuildingObject: castShadow unless NO_SHADOW_KEYS). */
export function castsShadow(key) { return !NO_SHADOW.has(key); }
/** renderOrder createBuildingObject gives meshes of this key (transparent glass 2, else 0). */
export function renderOrderOf(key) { return TRANSPARENT.has(key) ? 2 : 0; }
/**
 * Vertex attributes every part of `key` carries (same set for every building, so all parts of one key
 * can share a BatchedMesh / merged geometry): position, normal, uv, color + the key's extras.
 */
export function attributeNamesOf(key) { return ['position', 'normal', 'uv', 'color', ...Object.keys(EXTRA_ATTRIBUTES[key] || {})]; }
