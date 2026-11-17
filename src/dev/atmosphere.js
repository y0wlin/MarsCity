// Atmosphere / pipeline test bench (dev/atmosphere.html). OWNER: atmosphere agent.
// Self-contained mini app: smooth planet (radius R, albedo + night lights from the control maps),
// an exact local ground patch and test objects at one site, the real Pipeline + AtmosphereSystem +
// CloudSystem, CameraRig poses, and the same window.__MARS__ automation as the main app.
//   ?preset=orbit|orbitL|night|oblique|noon|sunset|bluehour|below|above|dusk|morning
//   ?pose=lat,lon,alt,heading,pitch[,lens]&time=15.5&clean=1&cover=1.5&tone=aces
import * as THREE from 'three';
import { R, DEG } from '../core/constants.js';
import { setOrigin, origin } from '../core/origin.js';
import { ecefToLatLonH, enuBasis, latLonToUnit, latLonHToEcef, destination } from '../core/geo.js';
import { createNoise } from '../core/noise.js';
import { loadControlMaps, getControlMaps, waterAt, densityAt, zoneSmooth, emissionAt } from '../data/controlMaps.js';
import { EventBus } from '../app/events.js';
import { AppState } from '../app/state.js';
import { sunDirection, solTimeForLocal } from '../app/sun.js';
import { CameraRig } from '../controls/CameraRig.js';
import { Pipeline } from '../render/pipeline.js';
import { AtmosphereSystem } from '../render/atmosphere/index.js';
import { CloudSystem } from '../render/clouds/index.js';

export const SITE = { lat: 16.0, lon: -105.0 };

const local = (h) => (lon) => solTimeForLocal(lon, h);
export const PRESETS = {
  // full disc with ~10% margins (50 mm needs ~18,000 km; the S01/S02 bookmarks at 9,000 km overflow)
  orbit: { pose: { lat: 10, lon: 95, alt: 1.8e7, heading: 0, pitch: -90, lens: 50 }, time: local(8.6)(95) },
  orbitR: { pose: { lat: 10, lon: 95, alt: 1.8e7, heading: 0, pitch: -90, lens: 50 }, time: 9.0 },
  night: { pose: { lat: 5, lon: -100, alt: 1.8e7, heading: 0, pitch: -90, lens: 50 }, time: local(4.7)(-100) },
  nightSide: { pose: { lat: 5, lon: -100, alt: 1.8e7, heading: 0, pitch: -90, lens: 50 }, time: local(2.4)(-100) },
  nightLimb: { pose: { lat: 5, lon: -100, alt: 1.8e7, heading: 270, pitch: -80.9, lens: 600 }, time: local(0.5)(-100) },
  midnight: { pose: { lat: SITE.lat - 0.0008, lon: SITE.lon + 0.0014, alt: 1.65, heading: 300, pitch: 9, lens: 24 }, time: local(0.5)(SITE.lon) },
  limb: { pose: { lat: 10, lon: 95, alt: 1.8e7, heading: 90, pitch: -80.9, lens: 600 }, time: local(13.0)(95) },
  limbDusk: { pose: { lat: 10, lon: 95, alt: 1.8e7, heading: 270, pitch: -80.9, lens: 600 }, time: local(13.0)(95) },
  terminator: { pose: { lat: 10, lon: 95, alt: 3.0e6, heading: 270, pitch: -55, lens: 35 }, time: local(16.6)(95) },
  s01: { pose: { lat: 10, lon: 95, alt: 9.0e6, heading: 0, pitch: -90, lens: 50 }, time: 9.0 },
  oblique: { pose: { lat: SITE.lat - 1.6, lon: SITE.lon - 0.2, alt: 30000, heading: 8, pitch: -22, lens: 35 }, time: local(15.2)(SITE.lon) },
  balcony: { pose: { lat: SITE.lat + 75 / 59157, lon: SITE.lon - 35 / 56866, alt: 1.65, heading: 90, pitch: 14, lens: 28 }, time: local(10.5)(SITE.lon) },
  balconyNoon: { pose: { lat: SITE.lat + 75 / 59157, lon: SITE.lon - 35 / 56866, alt: 1.65, heading: 90, pitch: 14, lens: 28 }, time: local(12.6)(SITE.lon) },
  noon: { pose: { lat: SITE.lat, lon: SITE.lon - 0.0012, alt: 1.65, heading: 80, pitch: 6, lens: 28 }, time: local(12.4)(SITE.lon) },
  morning: { pose: { lat: SITE.lat - 0.0011, lon: SITE.lon - 0.0006, alt: 1.65, heading: 40, pitch: 8, lens: 28 }, time: local(8.6)(SITE.lon) },
  sunset: { pose: { lat: SITE.lat, lon: SITE.lon + 0.0016, alt: 1.65, heading: 272, pitch: 4, lens: 28 }, time: local(17.95)(SITE.lon) },
  dusk: { pose: { lat: SITE.lat, lon: SITE.lon + 0.0016, alt: 1.65, heading: 272, pitch: 5, lens: 28 }, time: local(18.28)(SITE.lon) },
  bluehour: { pose: { lat: SITE.lat - 0.0008, lon: SITE.lon + 0.0014, alt: 1.65, heading: 300, pitch: 9, lens: 24 }, time: local(18.62)(SITE.lon) },
  below: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 2500, heading: 30, pitch: 18, lens: 24 }, time: local(14.0)(SITE.lon), seek: [0.55, 0.85] },
  above: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 14500, heading: 250, pitch: -9, lens: 28 }, time: local(16.4)(SITE.lon), seek: [0.5, 0.8] },
  under: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 1500, heading: 200, pitch: 55, lens: 20 }, time: local(13.5)(SITE.lon), seek: [0.6, 0.85] },
  underSun: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 1500, heading: 260, pitch: 35, lens: 20 }, time: local(16.8)(SITE.lon), seek: [0.6, 0.85] },
  cumulus: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 300, heading: 120, pitch: 12, lens: 24 }, time: local(13.0)(SITE.lon), seek: [0.35, 0.7], seekType: 0.5 },
  // cloud tests with the heading relative to the sun azimuth (sunRel: 0 = towards the sun)
  ctop: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 15000, pitch: -24, lens: 28 }, sunRel: 180, time: local(15.0)(SITE.lon), seek: [0.7, 1.0], seekType: 0.6 },
  cside: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 15000, pitch: -14, lens: 28 }, sunRel: 95, time: local(16.6)(SITE.lon), seek: [0.7, 1.0], seekType: 0.6 },
  cback: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 15000, pitch: -8, lens: 28 }, sunRel: 8, time: local(16.9)(SITE.lon), seek: [0.7, 1.0], seekType: 0.6 },
  cgnd: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 2, pitch: 28, lens: 24 }, sunRel: 150, time: local(14.2)(SITE.lon), seek: [0.55, 0.9], seekType: 0.6 },
  cgndSun: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 2, pitch: 22, lens: 24 }, sunRel: 25, time: local(16.4)(SITE.lon), seek: [0.55, 0.9], seekType: 0.6 },
  chorizon: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 2, pitch: 3, lens: 35 }, sunRel: 120, time: local(15.5)(SITE.lon), seek: [0.0, 0.15], seekType: 0.0 },
  cloud30: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 30000, pitch: -28, lens: 35 }, sunRel: 120, time: local(15.6)(SITE.lon), seek: [0.45, 0.85] },
  cloud30b: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 30000, pitch: -40, lens: 35 }, sunRel: 200, time: local(10.5)(SITE.lon), seek: [0.3, 0.7], seekType: 0.5 },
  covercast: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 2, pitch: 35, lens: 20 }, sunRel: 90, time: local(13.0)(SITE.lon), seek: [0.85, 1.0], seekType: 0.0 },
  // cloud shadows: straight down from 25 km with the sun ~25 deg high (shadows offset ~18 km)
  cshadow: { pose: { lat: SITE.lat, lon: SITE.lon, alt: 25000, heading: 0, pitch: -90, lens: 24 }, time: local(16.4)(SITE.lon), seek: [0.3, 0.6] },
  // regional (1500 km) view of a cyclone and scattered cumulus, afternoon sun
  regional: { pose: { lat: 38, lon: 75, alt: 1.5e6, heading: 0, pitch: -90, lens: 35 }, time: local(15.6)(75) },
};

/** sun azimuth (deg from north, clockwise) at lat/lon for a sol time */
export function sunAzimuth(lat, lon, solTime, subsolarLat = 12) {
  const s = sunDirection(solTime, subsolarLat, new THREE.Vector3());
  const B = enuBasis(lat, lon);
  const e = s.x * B.east[0] + s.y * B.east[1] + s.z * B.east[2];
  const n = s.x * B.north[0] + s.y * B.north[1] + s.z * B.north[2];
  return (Math.atan2(e, n) / DEG + 360) % 360;
}

// ---------------------------------------------------------------------------------------------
// bench planet: global cube sphere + exact local patch + test objects
// ---------------------------------------------------------------------------------------------
const NOISE = createNoise(4242);

function buildPlanetTextures() {
  const maps = getControlMaps();
  const W = 2048, H = 1024;
  const alb = new Uint8Array(W * H * 4);
  const par = new Uint8Array(W * H * 4);
  const srgb = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  const lin = (s) => Math.pow(s / 255, 2.2);
  const C = {
    rock: [lin(150), lin(68), lin(38)], ochre: [lin(176), lin(104), lin(62)], basalt: [lin(70), lin(44), lin(36)],
    city: [lin(196), lin(194), lin(188)], farm: [lin(78), lin(92), lin(44)], sea: [lin(12), lin(34), lin(70)], shelf: [lin(22), lin(70), lin(98)], ice: [lin(228), lin(232), lin(236)],
  };
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const lon = -180 + ((x + 0.5) / W) * 360;
      const i = y * W + x;
      const u = latLonToUnit(lat, lon);
      const w = waterAt(lat, lon), d = densityAt(lat, lon), zo = zoneSmooth(lat, lon);
      const n1 = NOISE.fbm3(u.x * 9, u.y * 9, u.z * 9, 5), n2 = NOISE.fbm3(u.x * 40 + 3, u.y * 40, u.z * 40, 4);
      let c = [0, 0, 0];
      const t = THREE.MathUtils.clamp(0.5 + n1 * 0.9, 0, 1);
      for (let k = 0; k < 3; k++) c[k] = C.rock[k] * (1 - t) + C.ochre[k] * t;
      const bas = THREE.MathUtils.smoothstep(n2, 0.25, 0.6) * 0.6;
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - bas) + C.basalt[k] * bas;
      const farm = THREE.MathUtils.clamp(zo * 1.2 - 0.15, 0, 1) * THREE.MathUtils.smoothstep(n2 + 0.3, 0.1, 0.5) * 0.85;
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - farm) + C.farm[k] * farm;
      const city = THREE.MathUtils.smoothstep(d, 0.12, 0.55) * (1 - zo * 0.6);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - city) + C.city[k] * city;
      const ice = THREE.MathUtils.smoothstep(Math.abs(lat) + n1 * 6, 70, 78);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - ice) + C.ice[k] * ice;
      const sea = THREE.MathUtils.smoothstep(w, 0.45, 0.6);
      const shelf = 1 - THREE.MathUtils.smoothstep(w, 0.6, 0.97);
      const sc = [0, 1, 2].map((k) => C.sea[k] * (1 - shelf) + C.shelf[k] * shelf);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - sea) + sc[k] * sea;
      alb[i * 4] = srgb(c[0]); alb[i * 4 + 1] = srgb(c[1]); alb[i * 4 + 2] = srgb(c[2]); alb[i * 4 + 3] = 255;
      const e = maps.emission.data[i] / 255;
      par[i * 4] = Math.round(sea * 255);                                  // water mask -> roughness
      par[i * 4 + 1] = Math.round(255 * Math.min(1, e * e * (1 - sea)));  // night lights
      par[i * 4 + 2] = Math.round(city * 255);
      par[i * 4 + 3] = 255;
    }
  }
  const mk = (data, cs) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = cs; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, THREE.SRGBColorSpace), params: mk(par, THREE.NoColorSpace) };
}

function planetMaterial(tex, { detail = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveIntensity: 1 });
  m.name = detail ? 'bench.ground' : 'bench.planet';
  // parametrised onBeforeCompile closures share the same source text: give each variant its own
  // program cache key (app.lighting.patch() chains it)
  m.customProgramCacheKey = () => (detail ? 'bench-ground-v1' : 'bench-globe-v1');
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tAlbedo = { value: tex.albedo };
    shader.uniforms.tParams = { value: tex.params };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDir;\nvarying vec3 vDir;\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDir = aDir;\nvLocalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tAlbedo;
uniform sampler2D tParams;
varying vec3 vDir;
varying vec3 vLocalPos;
vec4 benchSample(sampler2D t, vec3 d) {
  d = normalize(d);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float u1 = atan(d.x, d.z) * 0.15915494 + 0.5;
  float u2 = fract(u1 + 0.5) - 0.5;
  vec2 uv = vec2(u1, 0.5 - lat * 0.31830989);
  vec2 dx = vec2(dFdx(u1), dFdx(uv.y)), dy = vec2(dFdy(u1), dFdy(uv.y));
  vec2 dx2 = vec2(dFdx(u2), dx.y), dy2 = vec2(dFdy(u2), dy.y);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
  return textureGrad(t, uv, dx, dy);
}
float benchHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float benchNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(benchHash(i), benchHash(i + vec2(1, 0)), f.x), mix(benchHash(i + vec2(0, 1)), benchHash(i + vec2(1, 1)), f.x), f.y); }
`)
      .replace('#include <map_fragment>', `
vec4 benchP = benchSample(tParams, vDir);
vec3 benchAlb = benchSample(tAlbedo, vDir).rgb;   // sRGB texture: hardware-decoded to linear
${detail ? `
{ float dist = length(vViewPosition);
  float fine = benchNoise(vLocalPos.xz * 0.9) * 0.5 + benchNoise(vLocalPos.xz * 0.11) * 0.35 + benchNoise(vLocalPos.xz * 0.013) * 0.15;
  vec3 soil = mix(vec3(0.20, 0.085, 0.045), vec3(0.34, 0.17, 0.09), fine);
  float k = 1.0 - smoothstep(2500.0, 40000.0, dist);
  benchAlb = mix(benchAlb, soil, k * (1.0 - benchP.r) * 0.85);
  benchP.g *= 1.0 - k; }` : ''}
diffuseColor.rgb *= benchAlb;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.07, benchP.r);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= benchP.g * 2.2;\n#include <emissivemap_fragment>');
  };
  return m;
}

function cubeSphere(N) {
  const pos = [], dir = [], idx = [];
  const F = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  for (let f = 0; f < 6; f++) {
    const [Nn, U, V] = F[f]; const base = pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = Math.tan((i / N * 2 - 1) * Math.PI / 4), b = Math.tan((j / N * 2 - 1) * Math.PI / 4);
      let x = Nn[0] + a * U[0] + b * V[0], y = Nn[1] + a * U[1] + b * V[1], z = Nn[2] + a * U[2] + b * V[2];
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      pos.push(x * R, y * R, z * R); dir.push(x, y, z);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(dir, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
  return g;
}

/** exact ground around the site: polar grid, ECEF-axis offsets from the anchor (float64 -> 32) */
function groundPatch(anchor, radius = 260000, rings = 300, segs = 512) {
  const pos = [], dir = [], nor = [], idx = [];
  const U = latLonToUnit(anchor.lat, anchor.lon);
  const A = { x: U.x * R, y: U.y * R, z: U.z * R };
  const B = enuBasis(anchor.lat, anchor.lon);
  const rr = [0];
  for (let i = 1; i <= rings; i++) rr.push(0.6 * Math.pow(radius / 0.6, i / rings));
  // centre vertex
  pos.push(0, 0, 0); dir.push(U.x, U.y, U.z); nor.push(U.x, U.y, U.z);
  for (let i = 1; i <= rings; i++) {
    const d = rr[i], ang = d / R;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const e = Math.sin(th), n = Math.cos(th);
      // point on the sphere at great-circle distance d, bearing th
      const tx = B.east[0] * e + B.north[0] * n, ty = B.east[1] * e + B.north[1] * n, tz = B.east[2] * e + B.north[2] * n;
      const ux = U.x * Math.cos(ang) + tx * Math.sin(ang), uy = U.y * Math.cos(ang) + ty * Math.sin(ang), uz = U.z * Math.cos(ang) + tz * Math.sin(ang);
      pos.push(ux * R - A.x, uy * R - A.y, uz * R - A.z); dir.push(ux, uy, uz); nor.push(ux, uy, uz);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s1, a0 + s, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, anchorEcef: A };
}

function windowTexture() {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cols = 12, rows = 10;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = rnd() < 0.68, warm = rnd(), onset = rnd();
    const col = lit ? (warm < 0.75 ? [255, 196, 120] : [210, 225, 255]) : [6, 6, 8];
    const x0 = Math.floor(c * W / cols + 3), x1 = Math.floor((c + 1) * W / cols - 3);
    const y0 = Math.floor(r * H / rows + 5), y1 = Math.floor((r + 1) * H / rows - 3);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = Math.round(onset * 255); }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

class BenchPlanet {
  constructor(app) { this.app = app; }
  async init() {
    const app = this.app;
    const tex = buildPlanetTextures();
    this.globe = new THREE.Mesh(cubeSphere(200), planetMaterial(tex));
    this.globe.frustumCulled = false;
    this.globe.receiveShadow = true;
    app.lighting.patch(this.globe.material, { nightEmissive: true });
    app.scene.add(this.globe);

    const gp = groundPatch(SITE);
    this.anchor = gp.anchorEcef;
    this.patch = new THREE.Mesh(gp.geometry, planetMaterial(tex, { detail: true }));
    this.patch.frustumCulled = false;
    this.patch.receiveShadow = true;
    app.lighting.patch(this.patch.material, { nightEmissive: true });
    app.scene.add(this.patch);

    // test objects in the local frame (x east, y up, z south)
    const B = enuBasis(SITE.lat, SITE.lon);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...B.east), new THREE.Vector3(...B.up), new THREE.Vector3(...B.south));
    const g = this.objects = new THREE.Group();
    g.quaternion.setFromRotationMatrix(m);
    const add = (geo, mat, x, y, z, opts = {}) => {
      app.lighting.patch(mat, opts.lp || {});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
      if (opts.ry) mesh.rotation.y = opts.ry;
      g.add(mesh); return mesh;
    };
    const ceramic = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86, 0.84, 0.80), roughness: 0.38 });
    const glass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.62, 0.68, 0.74), roughness: 0.08, metalness: 0.85, clearcoat: 0.6 });
    const basalt = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.045, 0.045), roughness: 0.85 });
    const rock = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.36, 0.14, 0.07), roughness: 0.95 });
    const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.95, 0.95, 0.95), roughness: 0.04, metalness: 1 });
    const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.18, 0.18), roughness: 0.6 });
    const win = windowTexture();
    const lit = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.72, 0.70, 0.66), roughness: 0.5, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 1.6 });
    add(new THREE.BoxGeometry(36, 18, 24), ceramic, 0, 9, -70);
    // balcony slabs on the west face (ground-bounce / AO check on down-facing surfaces, preset 'balcony')
    for (const y of [5.5, 10.5, 15.5]) add(new THREE.BoxGeometry(2.4, 0.3, 20), ceramic, -19.2, y, -70);
    add(new THREE.BoxGeometry(16, 90, 16), glass, 50, 45, -40);
    add(new THREE.BoxGeometry(30, 10, 20), basalt, -45, 5, -40, { ry: 0.4 });
    const mound = add(new THREE.SphereGeometry(30, 48, 24), rock, -80, -14, -120); mound.scale.set(1.6, 0.9, 1.2);
    add(new THREE.BoxGeometry(30, 24, 20), lit, 10, 12, 30, { lp: { nightEmissive: true, emissiveOnsetAlpha: true } });
    add(new THREE.SphereGeometry(5, 64, 32), chrome, -12, 5, -12);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) add(new THREE.BoxGeometry(2, 2 + ((i + j) % 3), 2), grey, -30 + i * 4, 1 + ((i + j) % 3) / 2, 8 + j * 4);
    add(new THREE.CylinderGeometry(0.22, 0.25, 1.7, 16), grey, 2, 0.85, -4);
    // a 300 m ridge for long low-sun shadows
    const ridge = new THREE.Mesh(new THREE.ConeGeometry(220, 300, 6), rock.clone());
    app.lighting.patch(ridge.material); ridge.position.set(-900, 120, -1500); ridge.castShadow = ridge.receiveShadow = true; g.add(ridge);
    app.scene.add(g);
  }
  update(frame) {
    const o = origin;
    this.globe.position.set(-o.x, -o.y, -o.z);
    const a = this.anchor;
    this.patch.position.set(a.x - o.x, a.y - o.y, a.z - o.z);
    this.objects.position.copy(this.patch.position);
  }
  isIdle() { return true; }
}

// ---------------------------------------------------------------------------------------------
// minimal app shell (mirrors App.tick)
// ---------------------------------------------------------------------------------------------
class BenchApp {
  constructor(container) {
    this.container = container;
    this.events = new EventBus();
    this.state = new AppState(this.events);
    this.rig = new CameraRig();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2.0e8);
    this.timer = new THREE.Timer();
    this.timer.connect?.(document);
    this.frameNo = 0; this.fps = 60; this.frame = null;
  }
  async start() {
    await loadControlMaps(import.meta.env.DEV ? '/' : '../');
    this.pipeline = new Pipeline(this, this.container);
    this.renderer = this.pipeline.renderer;
    this.systems = { atmosphere: new AtmosphereSystem(this), clouds: new CloudSystem(this), bench: new BenchPlanet(this) };
    this.systems.terrain = { groundHeightCached: () => 0 };
    for (const [name, s] of Object.entries(this.systems)) if (s.init) { try { await s.init(); } catch (e) { console.error(`[init ${name}]`, e); } }
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyUrl();
    this.expose();
    this.initControls();
    this.renderer.setAnimationLoop(() => this.tick());
  }
  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  applyPreset(name) {
    const p = PRESETS[name]; if (!p) return false;
    this.state.set('cloudCoverage', p.cover || 1);
    this.state.setTime(p.time);
    let pose = { ...p.pose };
    if (p.seek) {
      // move the camera to the nearest spot whose cloud coverage (at this time) is in range
      const c = this.systems.clouds;
      c.syncTime(p.time);
      let best = null;
      for (let ring = 0; ring <= 40 && !best; ring++) for (let k = 0; k < Math.max(1, ring * 8); k++) {
        const a = (k / Math.max(1, ring * 8)) * Math.PI * 2, d = ring * 0.25;
        const lat = pose.lat + d * Math.cos(a), lon = pose.lon + d * Math.sin(a);
        const w = c.weatherAt(lat, lon);
        if (w && w.coverage >= p.seek[0] && w.coverage <= p.seek[1] && w.type >= (p.seekType || 0)) { best = { lat, lon }; break; }
      }
      if (best) { pose.lat = best.lat; pose.lon = best.lon; }
    }
    if (p.sunRel !== undefined) pose.heading = (sunAzimuth(pose.lat, pose.lon, p.time, this.state.subsolarLat) + p.sunRel) % 360;
    this.rig.setPose(pose);
    this.pipeline.snapExposure(4);
    return true;
  }
  applyUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('clean') === '1') { this.state.set('clean', true); document.body.classList.add('clean'); }
    if (q.get('tone')) this.state.set('toneMap', q.get('tone'));
    if (q.get('exposure')) this.state.set('exposure', parseFloat(q.get('exposure')));
    if (q.get('taa') === '0') this.state.set('taa', false);
    if (q.get('dview')) this.state.set('debugView', q.get('dview'));
    if (q.get('ao') === '0') this.state.set('ao', false);
    if (q.get('bloom') === '0') this.state.set('bloom', false);
    if (q.get('preset')) this.applyPreset(q.get('preset'));
    if (q.get('pose')) { const [lat, lon, alt, heading = 0, pitch = -90, lens] = q.get('pose').split(',').map(Number); this.rig.setPose({ lat, lon, alt, heading, pitch, lens: lens || undefined }); }
    if (q.get('time')) this.state.setTime(parseFloat(q.get('time')));
    if (q.get('cover')) this.state.set('cloudCoverage', parseFloat(q.get('cover')));
    if (q.get('clouds') === '0') this.state.set('clouds', false);
    if (q.get('shadows') === '0') this.state.set('shadows', false);
    if (q.get('speed')) this.state.setTimeSpeed(parseFloat(q.get('speed')));
    if (q.get('fixedExposure')) this.state.set('fixedExposure', parseFloat(q.get('fixedExposure')));
    if (q.get('ap')) this.systems.atmosphere.composite.apStrength = parseFloat(q.get('ap'));
    if (q.get('view') === 'weather') this.showWeather(+(q.get('ch') || 0), q.get('win') ? q.get('win').split(',').map(Number) : undefined);
    const pd = document.getElementById('presets');
    if (pd) for (const k of Object.keys(PRESETS)) { const b = document.createElement('button'); b.textContent = k; b.onclick = () => this.applyPreset(k); pd.appendChild(b); }
  }
  /** dev: equirect view of the weather cubemap (cloud frame) over the canvas */
  showWeather(ch = 0, win) {
    const img = this.systems.clouds.weatherImage(ch, 2048, win);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const id = new ImageData(img.width, img.height);
    const row = img.width * 4;
    for (let y = 0; y < img.height; y++) id.data.set(img.data.subarray((img.height - 1 - y) * row, (img.height - y) * row), y * row);
    c.getContext('2d').putImageData(id, 0, 0);
    c.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:${(100 * img.height / img.width).toFixed(2)}vw;z-index:5;image-rendering:auto`;
    document.body.appendChild(c);
    console.log(`[bench] weather channel ${ch} mean ${(img.mean * 100).toFixed(2)}% gen ${this.systems.clouds.genMs.toFixed(0)} ms`);
  }
  isIdle() { for (const s of Object.values(this.systems)) if (s.isIdle && !s.isIdle()) return false; return true; }
  expose() {
    const app = this;
    window.__MARS__ = {
      app, ready: true,
      goto(t) { if (typeof t === 'string') return app.applyPreset(t); app.rig.setPose(t); return true; },
      setTime(h) { app.state.setTime(h); }, set(k, v) { app.state.set(k, v); }, pose() { return app.rig.getPose(); },
      async waitIdle(timeoutMs = 60000, settle = 10) { const t0 = performance.now(); let calm = 0; while (performance.now() - t0 < timeoutMs) { await new Promise((r) => requestAnimationFrame(r)); calm = app.isIdle() ? calm + 1 : 0; if (calm >= settle) return true; } return false; },
      async capture(opts = {}) { const blob = await app.pipeline.capture(opts); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); },
      stats() { const i = app.renderer.info; const p = app.pipeline; return { fps: app.fps, frame: app.frameNo, calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, gpuMs: +p.gpuTimeMs.toFixed(2), exposure: p.exposure, accum: p.accum.n, csm: app.csm?.enabled, programs: i.programs?.length }; },
      presets: () => Object.keys(PRESETS),
      /** linear HDR (pre-exposure) at CSS pixel (x, y), plus the current exposure */
      probe(x, y, r = 2) {
        const p = app.pipeline, rt = p.lastHDR; if (!rt) return null;
        const k = p.width / p.cssW;
        const px = Math.round(x * k), py = Math.round(p.height - 1 - y * k), n = 2 * r + 1;
        const buf = new Uint16Array(n * n * 4);
        app.renderer.readRenderTargetPixels(rt, px - r, py - r, n, n, buf);
        const h2f = (h) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; return e === 0 ? s * 6.103515625e-5 * (m / 1024) : s * Math.pow(2, e - 15) * (1 + m / 1024); };
        const c = [0, 0, 0]; for (let i = 0; i < n * n; i++) for (let j = 0; j < 3; j++) c[j] += h2f(buf[i * 4 + j]) / (n * n);
        return { rgb: c.map((v) => +v.toPrecision(4)), lum: +(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toPrecision(4), exposure: +p.exposure.value.toPrecision(4) };
      },
    };
  }
  initControls() {
    const el = this.renderer.domElement; let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, b: e.button }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const p = this.rig.getPose();
      if (p.alt > 2e5 && drag.b === 0) { // orbit the planet
        const k = (this.rig.vfov(this.camera.aspect) / innerHeight) * Math.min(1, p.alt / R) * 1.2;
        this.rig.setPose({ ...p, lat: THREE.MathUtils.clamp(p.lat + dy * k, -89, 89), lon: p.lon - dx * k, lens: p.lens || undefined });
      } else this.rig.setPose({ ...p, heading: p.heading - dx * 0.15, pitch: THREE.MathUtils.clamp(p.pitch + dy * 0.15, -90, 90), lens: p.lens || undefined });
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault(); const p = this.rig.getPose(); const f = Math.pow(1.0015, e.deltaY);
      if (p.alt > 2e5) this.rig.setPose({ ...p, alt: THREE.MathUtils.clamp(p.alt * f, 2e5, 4e7), lens: p.lens || undefined });
      else { const fw = this.rig.forward(new THREE.Vector3()); const step = Math.max(1, p.alt) * (1 - f) * 2; const pos = this.rig.position; this.rig.setPosition(pos.x + fw.x * step, pos.y + fw.y * step, pos.z + fw.z * step); const g = this.rig.geo; if (g.h < 1) { const s = (R + 1) / Math.hypot(pos.x, pos.y, pos.z); this.rig.setPosition(pos.x * s, pos.y * s, pos.z * s); } }
    }, { passive: false });
  }
  tick() {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    this.frameNo++;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const st = this.state;
    if (st.timeSpeed) st.setTime(st.solTime + st.timeSpeed * dt);
    const p = this.rig.position;
    setOrigin(p.x, p.y, p.z);
    this.camera.quaternion.copy(this.rig.quaternion);
    this.camera.position.set(0, 0, 0);
    const vfov = this.rig.vfov(this.camera.aspect);
    if (Math.abs(this.camera.fov - vfov) > 1e-6) { this.camera.fov = vfov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
    const g = ecefToLatLonH(p.x, p.y, p.z);
    const B = enuBasis(g.lat, g.lon);
    const f = this.frame || (this.frame = { sunDir: new THREE.Vector3(), planetCenter: new THREE.Vector3(), camUp: new THREE.Vector3(), frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(), viewport: { width: 1, height: 1, pixelRatio: 1 } });
    f.app = this; f.dt = dt; f.time = this.timer.getElapsed(); f.frameNo = this.frameNo; f.fps = this.fps;
    f.solTime = st.solTime;
    sunDirection(st.solTime, st.subsolarLat, f.sunDir);
    f.camEcef = origin; f.camLat = g.lat; f.camLon = g.lon; f.camAlt = g.h; f.camAltGround = g.h;
    f.camUp.set(B.up[0], B.up[1], B.up[2]);
    f.planetCenter.set(-p.x, -p.y, -p.z);
    f.camera = this.camera;
    const size = this.renderer.getSize(new THREE.Vector2());
    f.viewport.width = size.x; f.viewport.height = size.y; f.viewport.pixelRatio = this.renderer.getPixelRatio();
    f.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    f.frustum.setFromProjectionMatrix(f.projScreen);
    f.rigVersion = this.rig.version; f.moving = f.rigVersion !== this._lastRig; this._lastRig = f.rigVersion;
    f.settings = st.settings;
    for (const [name, s] of Object.entries(this.systems)) {
      if (!s.update) continue;
      try { s.update(f); } catch (e) { if (!s._errored) { console.error(`[update ${name}]`, e); s._errored = true; } }
    }
    this.pipeline.render(f);
    this.hud(f);
  }
  hud(f) {
    if ((this.frameNo & 7) !== 0 || this.state.settings.clean) return;
    const el = document.getElementById('hud'); if (!el) return;
    const e = this.pipeline.exposure;
    el.textContent = `lat ${f.camLat.toFixed(4)} lon ${f.camLon.toFixed(4)} alt ${f.camAlt.toFixed(1)} m\nsol ${f.solTime.toFixed(2)} h  sun elev ${(Math.asin(f.camUp.dot(f.sunDir)) / DEG).toFixed(2)} deg\nexposure ${e.value.toFixed(3)} (ev ${e.ev.toFixed(2)} -> ${e.target.toFixed(2)})  accum ${this.pipeline.accum.n}\ngpu ${this.pipeline.gpuTimeMs.toFixed(1)} ms  fps ${f.fps.toFixed(0)}  csm ${this.csm?.enabled ? 'on' : 'off'}`;
  }
}

const app = new BenchApp(document.getElementById('app'));
app.start().catch((e) => { console.error(e); const d = document.createElement('pre'); d.style.cssText = 'position:fixed;inset:20px;color:#f88;font:12px monospace;white-space:pre-wrap'; d.textContent = 'Start failed: ' + (e.stack || e); document.body.appendChild(d); });
