// Street / ground / bridge materials (planet-lit MeshStandardMaterials, UVs in metres, vertex tint).
// Stone, concrete, steel and timber borrow the building kit's procedural PBR textures (buildings/materials.js,
// loaded lazily) so streets and plinths share one material language; asphalt, paint and pitch are generated
// here; plazas and sidewalks carry a procedural paving shader (analytic, anti-aliased joints, per-slab colour /
// roughness / tilt, wear, bevels, macro variation — readable from 1 m to the far street). Ground materials are
// lifted towards the camera in the vertex shader by a few cm + a distance term so road decks never z-fight with
// the terrain mesh (log depth disables polygon offset). Bridge structure materials (br_*, bridges.js): stay /
// light parts expand to a minimum pixel size (cables: coverage dither, lights: energy kept). OWNER: city agent.
import * as THREE from 'three';
import { CITY_UNIFORMS } from './massMaterial.js';

// asphalt: neutral dark grey (weathered binder + grey aggregate, albedo ≈ 0.09), matte (roughness
// 0.82–0.95 from the grain map, aggregate glints ≥ 0.7) — a bluish albedo plus a glossy sky
// reflection made streets read saturated blue at eye level
// cy: street-canyon occlusion (1 − sky view factor) of upward faces, see CANYON below
// pv: procedural paving [slab length, slab width, joint width (m), bond offset, colour var, wear, bevel (m)]
// px: minimum pixel size [r0 (authored half size, m), min full size (px), mode 1 dither / 2 energy (emissive)],
//     night: expansion only at night, near: [d0, d1] fade-in distance band (m)
const DEFS = {
  asphalt: { c: [0.092, 0.09, 0.087], r: 0.95, tex: 'asphalt', lift: 1, cy: 0.7 },
  asphalt_patch: { c: [0.076, 0.075, 0.073], r: 0.95, tex: 'asphalt', lift: 1.1, cy: 0.7 },
  marking: { c: [0.78, 0.78, 0.74], r: 0.62, lift: 1.6, cy: 0.7 },
  marking_yellow: { c: [0.72, 0.52, 0.12], r: 0.62, lift: 1.6, cy: 0.7 },
  // concrete pavers 0.6 × 0.3 m, running bond (u across the road, v along it)
  sidewalk: { c: [0.5, 0.49, 0.465], r: 0.88, lift: 1, cy: 0.7, pv: [0.3, 0.6, 0.006, 0.5, 0.07, 0.6, 0.004] },
  // natural stone slabs 1.2 × 0.6 m, running bond, warm light grey, worn walking lines
  plaza: { c: [0.47, 0.455, 0.43], r: 0.8, lift: 1, cy: 0.5, pv: [1.2, 0.6, 0.008, 0.5, 0.11, 1.0, 0.006] },
  gravel: { c: [0.5, 0.45, 0.38], r: 1, kit: 'roof_gravel', kitTint: 0.95, lift: 1, cy: 0.35 },
  kerb: { c: [0.7, 0.69, 0.66], r: 0.85, kit: 'stone_step', lift: 0.6, cy: 0.7 },
  concrete: { c: [0.62, 0.6, 0.57], r: 0.9, kit: 'concrete', lift: 0.3, cy: 0.45 },
  concrete_smooth: { c: [0.68, 0.66, 0.62], r: 0.8, kit: 'concrete_smooth', lift: 0.3, cy: 0.35 },
  gutter: { c: [0.32, 0.32, 0.31], r: 0.8, kit: 'concrete', lift: 1.05, cy: 0.7 },
  grate: { c: [0.16, 0.16, 0.17], r: 0.6, mt: 0.8, lift: 1.3, ho: false },
  steel: { c: [0.62, 0.64, 0.66], r: 0.45, mt: 1, kit: 'steel', lift: 0, ho: false },
  steel_dark: { c: [0.2, 0.21, 0.23], r: 0.55, mt: 0.5, kit: 'steel_dark', lift: 0, ho: false },
  rail: { c: [0.55, 0.53, 0.5], r: 0.35, mt: 1, kit: 'steel_brushed', lift: 0.5, ho: false },
  ballast: { c: [0.36, 0.33, 0.3], r: 1, kit: 'roof_gravel', kitTint: 0.62, lift: 0.8, cy: 0.4 },   // track ballast: darker than roof gravel
  sleeper: { c: [0.55, 0.54, 0.51], r: 0.9, kit: 'concrete_smooth', lift: 0.6, cy: 0.4 },
  timber: { c: [0.6, 0.5, 0.4], r: 0.9, kit: 'wood_deck', lift: 0.6, cy: 0.4 },
  planting: { c: [0.16, 0.2, 0.1], r: 1, kit: 'soil', lift: 1, cy: 0.55 },
  pitch: { c: [0.1, 0.24, 0.07], r: 0.95, tex: 'pitch', lift: 1.25, cy: 0.3 },
  court: { c: [0.42, 0.2, 0.14], r: 0.9, lift: 1, cy: 0.35 },
  stone_wall: { c: [0.56, 0.53, 0.5], r: 0.95, kit: 'stone_plinth', lift: 0 },
  rubber: { c: [0.05, 0.05, 0.05], r: 0.9, lift: 0 },
  yellow: { c: [0.75, 0.55, 0.08], r: 0.6, kit: 'steel_yellow', lift: 0, ho: false },
  glass_rail: { c: [0.5, 0.6, 0.62], r: 0.1, lift: 0, ho: false },
  solar: { c: [0.05, 0.07, 0.12], r: 0.22, mt: 0.2, kit: 'solar_panel', lift: 0, ho: false },
  basin_water: { c: [0.03, 0.08, 0.075], r: 0.05, lift: 0.2, ho: false },   // water keeps its sky reflection
  // ---- long bridges (bridgeBuild.js) ----
  br_deck: { c: [0.11, 0.108, 0.105], r: 0.92, tex: 'asphalt', lift: 0.4 },                         // far deck surface (under the street deck)
  br_steel: { c: [0.6, 0.615, 0.63], r: 0.5, lift: 0.1, ho: false },                               // painted steel box girder
  br_concrete: { c: [0.6, 0.59, 0.56], r: 0.85, kit: 'concrete_smooth', kitTint: 0.92, lift: 0, ho: false },
  br_pylon: { c: [0.72, 0.71, 0.68], r: 0.8, kit: 'concrete_smooth', kitTint: 1.05, lift: 0, ho: false },   // slender white pylons (R4)
  br_armour: { c: [0.24, 0.22, 0.2], r: 1, kit: 'stone_plinth', kitTint: 0.45, lift: 0, ho: false },  // rock-armour revetment
  br_paving: { c: [0.5, 0.49, 0.46], r: 0.9, lift: 0.3, pv: [0.9, 0.9, 0.008, 0.0, 0.06, 0.4, 0.004] },
  br_cable: { c: [0.78, 0.78, 0.76], r: 0.35, lift: 0, ho: false, px: [0.1, 1.0, 1] },
  br_light: { c: [0.06, 0.06, 0.06], r: 0.5, lift: 0, ho: false, e: [1.0, 0.86, 0.68], ei: 20, px: [0.32, 2.2, 2], night: true, near: [1300, 1800] },
  br_light_near: { c: [0.06, 0.06, 0.06], r: 0.5, lift: 0, ho: false, e: [1.0, 0.88, 0.72], ei: 6, px: [0.18, 1.8, 2], night: true },
  br_aviation: { c: [0.12, 0.03, 0.02], r: 0.5, lift: 0, ho: false, e: [1.0, 0.07, 0.03], ei: 30, px: [0.38, 2.6, 2], night: true },
};

/** street material keys that cast shadows (streetBuild.js CAST) */
export const STREET_CAST = new Set(['concrete', 'concrete_smooth', 'steel', 'steel_dark', 'stone_wall', 'rail', 'kerb', 'yellow', 'timber', 'solar']);
/** bridge structure keys that cast shadows (bridges.js) */
export const BRIDGE_CAST = new Set(['br_steel', 'br_concrete', 'br_pylon', 'br_deck', 'br_armour']);

const CACHE = new Map();
let KIT = null, KIT_TRIED = false, APP = null;
function kit() {
  if (!KIT_TRIED) { KIT_TRIED = true; import('../../buildings/materials.js').then((m) => { KIT = m; }).catch(() => { KIT = null; }); }
  return KIT;
}

// night factor for the min-pixel light parts (bridges.js sets it from the sun at the camera)
export const STREET_UNIFORMS = { uBrNight: { value: 0 } };

const LIFT_VERT = /* glsl */`
{
  // lift towards the camera: a few cm + distance term (terrain mesh band limit grows with distance).
  // Batching-safe: street parts are drawn through GPU batches (per-instance tile matrix).
  mat4 swM = modelMatrix;
  #ifdef USE_BATCHING
  swM = modelMatrix * batchingMatrix;
  #endif
  vec4 sw = swM * vec4(transformed, 1.0);
  float sd = length(sw.xyz);
  float lift = uStreetLift * (0.03 + 0.00045 * sd);
  vec3 toCam = -sw.xyz / max(sd, 1e-3);
  transformed += (inverse(mat3(swM)) * toCam) * lift;
}
`;

// minimum pixel size (bridge cables / lights): grow along the vertex normal so the part is at least uBrPx.y px
// across; coverage (cables: dither) or energy (lights: emissive / area) keeps the far average right
const PX_VERT = /* glsl */`
{
  vec4 pxW = modelMatrix * vec4(transformed, 1.0);
  float pxD = max(distance(pxW.xyz, cameraPosition), 0.05);
  float pxNeed = 0.5 * uBrPx.y * pxD / max(uCityK, 1.0);
  float pxGrow = max(0.0, pxNeed - uBrPx.x) * (uBrPxNight > 0.5 ? uBrNight : 1.0);
  transformed += objectNormal * pxGrow;   // unit radial normals (cables) / corner normals (light boxes, bridgeBuild lightBox)
  vBrCov = uBrPx.x / (uBrPx.x + pxGrow);
  // stay cables (dither mode): keep >= 45 % coverage out to ~5 km, fading to the physical value by 18 km, so the
  // fans read as a fine texture in the mid / far ground (a 0.2 m stay is 1/7 px at 1.6 km)
  if ( uBrPx.z < 1.5 ) vBrCov = max( vBrCov, 0.45 * ( 1.0 - smoothstep( 5000.0, 18000.0, pxD ) ) );
  vBrDist = pxD;
}
`;
const PX_FRAG_DITHER = /* glsl */`
{
  // interleaved gradient noise, shifted per frame (TAA resolves the coverage)
  float pxN = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(uCityFrame * 5.588238, uCityFrame * 1.723), vec2(0.06711056, 0.00583715))));
  if (pxN > vBrCov) discard;
}
`;
// lights: radiance × coverage (1/d fall-off beyond the min-pixel distance instead of the physical 1/d²: a
// luminaire is ~10^3 × a lit window, which the near look cannot carry — the far dot stays readable at 5–10 km)
const PX_FRAG_ENERGY = /* glsl */`
totalEmissiveRadiance *= vBrCov * (uBrNear.y > 0.0 ? smoothstep(uBrNear.x, uBrNear.y, vBrDist) : 1.0);
`;
// far-only parts (deck light heads: props' lamps own the near range): gone inside the near band, dithered in
const PX_FRAG_NEAR = /* glsl */`
if ( uBrNear.y > 0.0 ) {
  float pxF = smoothstep( uBrNear.x, uBrNear.y, vBrDist );
  float pxN2 = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + vec2( uCityFrame * 5.588238, uCityFrame * 1.723 ), vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( pxN2 >= pxF ) discard;
}
`;

// Street-canyon horizon occlusion of the environment reflection on ground surfaces. The specular
// environment is the SKY captured at the camera; from street level a ground reflection points a few
// degrees above the horizon, where the street really reflects facades, trees and the far street, not
// open sky — a sky-only reflection there turned shaded asphalt saturated blue at eye level. Full sky
// reflection from ~30° up (aerial views see the sky dome mirrored), 12 % at grazing. Upward-facing
// faces only (kerb / wall sides keep theirs); metals and glass are exempt (DEFS ho: false).
//
// CANYON (fix round 2, QQ-04): the planet lighting gives an upward face the whole sky dome (deep blue in the
// shade: shaded asphalt read linear B/R ≈ 6–8). In a street the lower (1 − SVF) of that hemisphere is facades
// and street: they hide that part of the sky and reflect sunlit / skylit ceramic, glass, trees and paving
// instead. Facade irradiance = sun × (azimuth-averaged cos ≈ 0.318 × cos(elevation)) + half the sky + the
// sunlit ground bounced off them (local ground albedo uLpGroundAlbedo × sun × sin(elevation) / 2); facade mix
// albedo RHO (warm white ceramic, glass, trees). Upward faces only, × ambient occlusion like the sky term;
// night light untouched. uStreetCanyon = 1 − SVF per material (streets 0.7, plazas 0.5, pitches 0.3; S07 shaded
// asphalt: linear B/R 8.0 without the term, 2.7 at 0.5, 1.9 at 0.7 — tuned in-app, fix round 2).
const HORIZON_FRAG = /* glsl */`
#ifdef LP_PATCHED
if ( uStreetHorizon > 0.5 ) {
  vec3 csR = inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix );
  vec3 csN = inverseTransformDirection( geometryNormal, viewMatrix );
  float csG = smoothstep( 0.55, 0.85, dot( csN, lpUp ) );
  lpEnvScale *= mix( 1.0, mix( 0.12, 1.0, smoothstep( 0.03, 0.5, dot( csR, lpUp ) ) ), csG );
}
#if defined( STANDARD )
if ( uStreetCanyon > 0.0 ) {
  float cyUp = clamp( dot( lpNormalW, lpUp ), 0.0, 1.0 );
  if ( cyUp > 0.0 ) {
    vec3 cySun = uLpSunE * lpSunTransmittance( lpR, lpH, lpMuS ) * lpCloud.x;
    vec3 cySky = lpSkyIrradiance( lpUp, uSunDir, lpH, lpUp ) * uLpSunE * ( 1.0 - 0.38 * lpCloud.y );
    float cyMu = max( lpMuS, 0.0 ), cyCos = sqrt( max( 0.0, 1.0 - cyMu * cyMu ) );
    vec3 cyFac = cySun * ( 0.318 * cyCos ) + 0.5 * uLpGroundAlbedo * cySun * cyMu + 0.5 * cySky;
    vec3 cyRho = vec3( 0.56, 0.53, 0.5 );
    iblIrradiance += uStreetCanyon * ( cyRho * cyFac - cySky ) * cyUp * lpAO;
  }
}
#endif
#endif
`;

// procedural paving (plaza / sidewalk / island): slabs in a running bond in uv metres, joints analytic and
// box-filtered by the pixel footprint (crisp near, averaged into the tone far away), per-slab albedo / hue /
// roughness / tilt, dirt in the joints, worn walking lines, edge bevels, macro variation (5–40 m) for distance
const PAVE_PARS = /* glsl */`
uniform vec4 uPv;     // slab length (u), slab width (v), joint width, bond offset
uniform vec4 uPv2;    // colour variation, wear, bevel depth, -
varying vec2 vPvUv;
float pvH1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pvN1(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pvH1(i), pvH1(i + vec2(1.0, 0.0)), f.x), mix(pvH1(i + vec2(0.0, 1.0)), pvH1(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 pvPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float fd) {
  vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - g);
}
`;
const PAVE_FRAG = /* glsl */`
float pvRough = 1.0, pvHgt = 0.0;
{
  vec2 p = vPvUv;
  vec2 fw = max(fwidth(p), vec2(1e-5));
  float row = floor(p.y / uPv.y);
  float off = mod(row, 2.0) * uPv.w * uPv.x;
  float col = floor((p.x + off) / uPv.x);
  vec2 cell = vec2(col, row);
  vec2 loc = vec2(p.x + off - col * uPv.x, p.y - row * uPv.y);
  vec2 dE = min(loc, uPv.xy - loc);                       // distance to the slab edges (m)
  // box-filtered joints: drawn at >= one pixel footprint, intensity j / footprint below that
  vec2 wj = max(vec2(uPv.z), fw);
  vec2 jc = (uPv.z / wj) * (1.0 - smoothstep(0.5 * wj - 0.5 * fw, 0.5 * wj + 0.5 * fw, dE));
  float joint = max(jc.x, jc.y);
  // per-slab variation (faded once a slab is sub-pixel, so far paving never shimmers)
  float slabRes = 1.0 - smoothstep(0.25, 1.0, max(fw.x / uPv.x, fw.y / uPv.y));
  float h1 = pvH1(cell), h2 = pvH1(cell + 17.3), h3 = pvH1(cell + 41.7);
  float tone = 1.0 + uPv2.x * slabRes * ((h1 - 0.5) * 1.6 + (h2 > 0.93 ? -0.9 : 0.0));
  vec3 hue = mix(vec3(1.0), vec3(1.03, 1.0, 0.95), h3 * slabRes);
  // mottling inside a slab (stone grain), faded with the footprint
  float grain = (pvN1(p * 7.3) - 0.5) * 0.08 * (1.0 - smoothstep(0.02, 0.12, max(fw.x, fw.y)));
  // macro variation (dust / weathering patches) for distance
  float macro = (pvN1(p / 13.0) - 0.5) * 0.10 + (pvN1(p / 41.0) - 0.5) * 0.08;
  // worn walking lines: darker, smoother bands
  float wear = smoothstep(0.58, 0.86, pvN1(p / 3.7 + vec2(3.1, 7.7))) * uPv2.y;
  // dirt along the slab edges (within ~3 cm), box-filtered like the joints
  vec2 de2 = max(dE, fw * 0.5);
  float edgeDirt = (1.0 - smoothstep(0.0, 0.035, min(de2.x, de2.y))) * (1.0 - smoothstep(0.03, 0.12, max(fw.x, fw.y)));
  float alb = tone * (1.0 + grain + macro) * (1.0 - 0.07 * wear) * (1.0 - 0.12 * edgeDirt);
  alb = mix(alb, 0.42, joint);                              // joint sand / mortar, dark
  diffuseColor.rgb *= hue * alb;
  pvRough = (1.0 + (h2 - 0.5) * 0.12 * slabRes) * (1.0 - 0.18 * wear) * mix(1.0, 1.08, joint);
  // bevel (edges rounded down) + slight per-slab tilt; faded once sub-pixel
  float bev = uPv2.z * (1.0 - smoothstep(uPv2.z * 0.5, uPv2.z * 4.0, max(fw.x, fw.y)));
  float bw = 0.012;
  pvHgt = -bev * (1.0 - smoothstep(0.0, bw, min(dE.x, dE.y))) + slabRes * 0.0012 * ((h1 - 0.5) * loc.x + (h3 - 0.5) * loc.y);
}
`;

function noiseTexture(kind) {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  let s = kind === 'pitch' ? 91 : 17;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const base = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) base[i] = rnd();
  // blur once for grain clusters
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let v = base[i] * 0.5 + 0.125 * (base[y * N + ((x + 1) % N)] + base[y * N + ((x + N - 1) % N)] + base[((y + 1) % N) * N + x] + base[((y + N - 1) % N) * N + x]);
    let b;
    if (kind === 'pitch') b = Math.round((0.86 + 0.18 * v + ((x % 32) < 16 ? 0.05 : -0.03)) * 180);
    // asphalt roughness factor 0.86–1.0 (× material roughness 0.95), sparse aggregate glints at 0.74
    else b = Math.round((rnd() < 0.015 ? 0.74 : 0.86 + 0.14 * v) * 255);
    b = Math.max(0, Math.min(255, b));
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.repeat.set(kind === 'pitch' ? 0.1 : 0.35, kind === 'pitch' ? 0.1 : 0.35);
  t.needsUpdate = true;
  return t;
}
const NOISE = {};

export function getStreetMaterial(key, app) {
  if (app) APP = app;
  let m = CACHE.get(key);
  if (m) { if (!m.userData.kitDone) borrow(m, key); return m; }
  const d = DEFS[key] || DEFS.concrete;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.c[0], d.c[1], d.c[2]), roughness: d.r, metalness: d.mt || 0, vertexColors: true });
  m.name = 'city:street-' + key;
  if (d.tex) {
    const nt = NOISE[d.tex] || (NOISE[d.tex] = noiseTexture(d.tex));
    m.roughnessMap = nt;   // grain in the roughness, albedo variation through the bump of the same map
    m.bumpMap = nt; m.bumpScale = d.tex === 'pitch' ? 0.4 : 1.8;   // asphalt map: half the old value range
  }
  if (d.e) { m.emissive = new THREE.Color(d.e[0], d.e[1], d.e[2]); m.emissiveIntensity = d.ei ?? 1; }
  const lift = { value: d.lift || 0 };
  m.userData.lift = lift;
  const horizon = { value: d.ho === false ? 0 : 1 };
  m.userData.horizon = horizon;
  const canyon = { value: d.cy || 0 };
  m.userData.canyon = canyon;
  const pave = d.pv ? { a: { value: new THREE.Vector4(d.pv[0], d.pv[1], d.pv[2], d.pv[3]) }, b: { value: new THREE.Vector4(d.pv[4], d.pv[5], d.pv[6], 0) } } : null;
  const px = d.px ? { value: new THREE.Vector3(d.px[0], d.px[1], d.px[2]) } : null;
  const pxNight = { value: d.night ? 1 : 0 };
  const pxNear = { value: new THREE.Vector2(d.near ? d.near[0] : 0, d.near ? d.near[1] : 0) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uStreetLift = lift;
    sh.uniforms.uStreetHorizon = horizon;
    sh.uniforms.uStreetCanyon = canyon;
    let vs = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uStreetLift;');
    let fs = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uStreetHorizon;\nuniform float uStreetCanyon;');
    if (px) {
      sh.uniforms.uBrPx = px; sh.uniforms.uBrPxNight = pxNight; sh.uniforms.uBrNear = pxNear;
      sh.uniforms.uBrNight = STREET_UNIFORMS.uBrNight; sh.uniforms.uCityK = CITY_UNIFORMS.uCityK; sh.uniforms.uCityFrame = CITY_UNIFORMS.uCityFrame;
      vs = vs.replace('#include <common>', '#include <common>\nuniform vec3 uBrPx;\nuniform float uBrPxNight;\nuniform float uBrNight;\nuniform float uCityK;\nvarying float vBrCov;\nvarying float vBrDist;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + PX_VERT);
      fs = fs.replace('#include <common>', '#include <common>\nuniform vec3 uBrPx;\nuniform vec2 uBrNear;\nuniform float uCityFrame;\nvarying float vBrCov;\nvarying float vBrDist;');
      if (d.px[2] === 1) fs = fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + PX_FRAG_DITHER);
      else fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + PX_FRAG_ENERGY).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + PX_FRAG_NEAR);
    }
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + LIFT_VERT);
    if (pave) {
      sh.uniforms.uPv = pave.a; sh.uniforms.uPv2 = pave.b;
      vs = vs.replace('#include <common>', '#include <common>\nvarying vec2 vPvUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPvUv = uv;');
      fs = fs.replace('#include <common>', '#include <common>\n' + PAVE_PARS)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + PAVE_FRAG)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor * pvRough, 0.3, 1.0 );')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = pvPerturb( - vViewPosition, normal, vec2( dFdx( pvHgt ), dFdy( pvHgt ) ), faceDirection );');
    }
    // runs before the lighting patch replaces <lights_fragment_maps> (lpEnvScale / lpUp / lpCloud / lpAO /
    // iblIrradiance are its globals)
    fs = fs.replace('#include <lights_fragment_maps>', HORIZON_FRAG + '\n#include <lights_fragment_maps>');
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
  const variant = (pave ? 'p' : '') + (px ? 'x' + d.px[2] : '');
  m.customProgramCacheKey = () => 'city-street-4' + variant;
  try { app?.lighting?.patch?.(m, { nightEmissive: !!d.e, receiveCloudShadow: true }); } catch { /* optional */ }
  CACHE.set(key, m);
  borrow(m, key);
  return m;
}

/** copy the kit's textures into a street material once they exist */
function borrow(m, key) {
  const d = DEFS[key];
  if (!d || !d.kit) { m.userData.kitDone = true; return; }
  const K = kit();
  if (!K || !K.getBuildingMaterial || !APP) return;
  let src;
  try { src = K.getBuildingMaterial(d.kit, APP); } catch { src = null; }
  if (!src || !src.map) return;
  m.map = src.map; m.normalMap = src.normalMap; m.normalScale = src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1);
  m.roughnessMap = src.roughnessMap; m.metalnessMap = src.metalnessMap; m.aoMap = src.aoMap; m.aoMapIntensity = 0.6;
  // kit colours are true mean albedos (building-kit ★2 normalisation); kitTint adapts a few ground uses
  m.color.copy(src.color).multiplyScalar(d.kitTint ?? 1.0);
  m.roughness = src.roughness; m.metalness = src.metalness;
  m.needsUpdate = true;
  m.userData.kitDone = true;
}

/** retry texture borrowing (called each frame by the street manager until all are done) */
export function refreshStreetMaterials() {
  let pending = false;
  for (const [k, m] of CACHE) if (!m.userData.kitDone) { borrow(m, k); if (!m.userData.kitDone) pending = true; }
  return pending;
}

/**
 * True once every street material exists with its final textures (the kit's procedural textures are
 * generated asynchronously): installing streets before that would recompile every program in the
 * frame the textures arrive. Creates the materials on first call.
 */
export function streetMaterialsReady(app) {
  for (const k of Object.keys(DEFS)) getStreetMaterial(k, app);
  return !refreshStreetMaterials();
}
