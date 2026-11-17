// Zhurong public & commercial family bench (owner: buildings-z): rows of synthetic BuildingSpecs per
// type (sizes, styles, headings, slopes) generated in module workers, sun + sky light, orbit camera,
// bench-only scenery for context (rail tracks / viaduct + a train at stations, water behind ferry
// terminals). Lighting/worker code is a copy of src/dev/buildings.js (building-kit bench).
// Keys: L = cycle LOD (mass/exterior/full)  C = cut-away  W = wireframe  N = night  T = +1 h
//       [ ] = prev/next building  F = frame  1..9 = views
// URL:  ?b=<index|id>&view=front|back|side|corner|roof|aerial|interior|platform|lobby|street|entrance|stair|living|plan
//       &row=station|civic|glass|corridor|hall|shed&only=1&lod=full&time=15&night=1&cut=7.5&wire=1&clean=1
//       &cam=x,y,z&tgt=x,y,z (building frame)&fov=50&bench=1 (timings per type/LOD → stats().bench)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildingObject, disposeBuildingObject, initBuildingMaterials, setBuildingLighting, getBuildingMaterial } from '../buildings/materials.js';

const Q = new URLSearchParams(location.search);
const R_PLANET = 3389500;
const LAT = 22;
const stats = { gen: {} };

// ---------------------------------------------------------------------------
// worker pool (bench-local, same protocol as app.workers)
// ---------------------------------------------------------------------------
class BenchPool {
  constructor(n) {
    this.ws = []; this.idle = []; this.q = []; this.jobs = new Map(); this.id = 1; this.pending = 0;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./buildings.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._done(w, e.data);
      w.onerror = (e) => console.error('[bench worker]', e.message || e);
      this.ws.push(w); this.idle.push(w);
    }
  }
  submit(type, payload, opts = {}) {
    const job = { id: this.id++, type, payload, priority: opts.priority ?? 0 };
    job.promise = new Promise((res, rej) => { job.res = res; job.rej = rej; });
    this.q.push(job); this.pending++; this._pump();
    return job;
  }
  _pump() {
    this.q.sort((a, b) => a.priority - b.priority || a.id - b.id);
    while (this.idle.length && this.q.length) { const j = this.q.shift(), w = this.idle.pop(); this.jobs.set(j.id, j); w.postMessage({ id: j.id, type: j.type, payload: j.payload }); }
  }
  _done(w, msg) {
    const j = this.jobs.get(msg.id); this.jobs.delete(msg.id); this.idle.push(w); this.pending--;
    if (j) { if (msg.ok) { if (msg.result && typeof msg.result === 'object') msg.result.__workerMs = msg.ms; j.res(msg.result); } else { console.error('[bench job failed]', msg.error); j.rej(new Error(msg.error)); } }
    this._pump();
  }
}
const pool = new BenchPool(+(Q.get('workers') || 0) || Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 8) - 2)));   // &workers=N (shared machine)

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------
const container = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;          // the app's output pass uses AgX too
renderer.toneMappingExposure = 0.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);
if (Q.get('clean') === '1') document.body.classList.add('clean');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(+(Q.get('fov') || 45), window.innerWidth / window.innerHeight, 0.05, 20000);
camera.position.set(-40, 30, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 8, 0);
controls.enableDamping = true;

// ---------------------------------------------------------------------------
// lighting in the app's units (render/atmosphere/model.js): extraterrestrial sun 8.0 scene units,
// atmospheric transmittance of the terraformed atmosphere, sky radiance model with red ground
// bounce, exposure prior K / E (noon ≈ 0.45, night 15), AgX. Emissive authored in "emissive units"
// (materials.js applies EMISSIVE_SCALE 0.05) so what is seen here matches the app.
// ---------------------------------------------------------------------------
const SUN_E = 8.0, SUN_COLOR = [1.0, 0.955, 0.905];
const TAU = [0.063, 0.143, 0.256];               // zenith optical depth (Rayleigh + Mie + ozone tent 15 km)
const GROUND_ALB = [0.24, 0.17, 0.125];          // paved city ground mixed with red soil (bench env)
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function sunTransmittance(el) {
  const deg = Math.asin(Math.max(-1, Math.min(1, el))) * 180 / Math.PI;
  if (deg < -1) return [0, 0, 0];
  const m = 1 / (Math.max(el, 0) + 0.15 * Math.pow(Math.max(deg, 0) + 3.885, -1.253));
  const disc = smoothstep(-0.9, 0.3, deg);
  return TAU.map((t) => Math.exp(-t * m) * disc);
}
// sky radiance (scene units) — JS twin of SKY_GLSL below
function skyRadiance(d, s, out) {
  const el = s[1];
  const day = smoothstep(-0.16, 0.22, el), T = sunTransmittance(el);
  const up = Math.max(d[1], 0);
  const t = Math.pow(1 - up, 3.2);
  const cosT = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  const g = 0.76, mie = 0.018 * (1 - g * g) / Math.pow(1 + g * g - 2 * g * cosT, 1.5);
  const tw = Math.pow(Math.max(0, 1 - Math.abs(el) * 4), 2) * Math.max(0, cosT * 0.5 + 0.5);
  for (let i = 0; i < 3; i++) {
    const Z = [0.07, 0.17, 0.46][i], Hc = [0.42, 0.5, 0.6][i], tw0 = [0.55, 0.26, 0.1][i];
    let L = (Z + (Hc - Z) * t) * day + mie * SUN_E * SUN_COLOR[i] * T[i] * day + tw0 * tw * 0.6 * (1 - day * 0.5);
    if (d[1] < 0) {
      const Eg = SUN_E * SUN_COLOR[i] * T[i] * Math.max(el, 0) + 1.25 * [0.95, 1.1, 1.35][i] * day;
      const Lg = GROUND_ALB[i] * Eg / Math.PI;
      L = L + (Lg - L) * Math.min(1, -d[1] * 6);
    }
    out[i] = L + [0.0010, 0.0011, 0.0015][i];
  }
  return out;
}
const SKY_GLSL = /* glsl */`
uniform vec3 uSun; uniform vec3 uT; uniform float uDay; uniform float uTw;
varying vec3 vDir;
vec3 skyRad(vec3 d) {
  float up = max(d.y, 0.0);
  float t = pow(1.0 - up, 3.2);
  float cosT = dot(d, uSun);
  float g = 0.76; float mie = 0.018 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  float tw = uTw * max(0.0, cosT * 0.5 + 0.5);
  vec3 L = mix(vec3(0.07, 0.17, 0.46), vec3(0.42, 0.5, 0.6), t) * uDay + mie * 8.0 * vec3(1.0, 0.955, 0.905) * uT * uDay + vec3(0.55, 0.26, 0.1) * tw * 0.6 * (1.0 - uDay * 0.5);
  if (d.y < 0.0) {
    vec3 Eg = 8.0 * vec3(1.0, 0.955, 0.905) * uT * max(uSun.y, 0.0) + 1.25 * vec3(0.95, 1.1, 1.35) * uDay;
    vec3 Lg = vec3(0.24, 0.17, 0.125) * Eg / 3.14159265;
    L = mix(L, Lg, min(1.0, -d.y * 6.0));
  }
  // the sun disc itself (bright, blooms in the app)
  L += step(0.99996, cosT) * 8.0 * uT * 600.0;
  return L + vec3(0.0010, 0.0011, 0.0015);
}`;
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uT: { value: new THREE.Vector3(1, 1, 1) }, uDay: { value: 1 }, uTw: { value: 0 } },
  vertexShader: /* glsl */`varying vec3 vDir;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: SKY_GLSL + /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      gl_FragColor = vec4(skyRad(normalize(vDir)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 32), skyMat);
skyDome.renderOrder = -10;
scene.add(skyDome);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const envScene = new THREE.Scene();
const envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), new THREE.ShaderMaterial({ uniforms: skyMat.uniforms, vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: SKY_GLSL + '\nvoid main(){ vec3 d = normalize(vDir); vec3 L = skyRad(d); L -= step(0.99996, dot(d, uSun)) * 8.0 * uT * 600.0; gl_FragColor = vec4(L, 1.0); }', side: THREE.BackSide }));
envScene.add(envDome);

const sun = new THREE.DirectionalLight(0xffffff, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);

let hour = +(Q.get('time') || 11.0);
let night = Q.get('night') === '1';
if (night && !Q.get('time')) hour = 21.5;

function sunVector(h) {
  const d = 12 * Math.PI / 180, p = LAT * Math.PI / 180, H = (h - 12) * 15 * Math.PI / 180;
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H);
  const up = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  return new THREE.Vector3(east, up, -north).normalize();
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function applyTime() {
  const s = sunVector(hour);
  const el = s.y, T = sunTransmittance(el);
  const sv = [s.x, s.y, s.z];
  const sunE = [0, 1, 2].map((i) => SUN_E * SUN_COLOR[i] * T[i]);
  const mx = Math.max(...sunE, 1e-6);
  sun.color.setRGB(sunE[0] / mx, sunE[1] / mx, sunE[2] / mx, THREE.LinearSRGBColorSpace);
  sun.intensity = mx;
  sun.visible = mx > 1e-3;
  skyMat.uniforms.uSun.value.copy(s); skyMat.uniforms.uT.value.set(T[0], T[1], T[2]);
  skyMat.uniforms.uDay.value = smoothstep(-0.16, 0.22, el);
  skyMat.uniforms.uTw.value = Math.pow(Math.max(0, 1 - Math.abs(el) * 4), 2);
  // horizontal sky irradiance of the model (for the interior-mapping daylight) by quadrature
  const E = [0, 0, 0], L = [0, 0, 0], dv = [0, 0, 0];
  const NT = 24, NP = 48;
  for (let i = 0; i < NT; i++) {
    const th = (i + 0.5) / NT * Math.PI / 2, st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j < NP; j++) {
      const ph = (j + 0.5) / NP * Math.PI * 2;
      dv[0] = st * Math.cos(ph); dv[1] = ct; dv[2] = st * Math.sin(ph);
      skyRadiance(dv, sv, L);
      const w = ct * st * (Math.PI / 2 / NT) * (Math.PI * 2 / NP);
      for (let k = 0; k < 3; k++) E[k] += L[k] * w;
    }
  }
  // exposure prior (render/atmosphere/exposure.js): K / E_key, harmonic blend with the night exposure
  const Ekey = lum(sunE) * Math.max(el, 0) + lum(E);
  const expDay = 3.3 / Math.max(Ekey, 1e-4), expNight = 15;
  renderer.toneMappingExposure = (+(Q.get('exposure') || 1)) / (1 / expDay + 1 / expNight);
  setBuildingLighting({ sunDir: s, planetCenter: new THREE.Vector3(0, -R_PLANET, 0), localHour: hour, sunE: new THREE.Vector3(...sunE), skyE: new THREE.Vector3(...E) });
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.0);
  scene.environment = envRT.texture;
  scene.environmentIntensity = +(Q.get('env') || 1);
  stats.light = { el: +el.toFixed(3), sunE: sunE.map((v) => +v.toFixed(2)), skyE: E.map((v) => +v.toFixed(3)), exposure: +renderer.toneMappingExposure.toFixed(3) };
}


// ---------------------------------------------------------------------------
// synthetic specs (ranges as urban/builders.js produces them)
// ---------------------------------------------------------------------------
import { stationTrack } from '../buildings/types/z_station_geom.js';

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const PROV = { ZR1: 7, ZR2: 8, ZR3: 9, ZR4: 10, ZR5: 11, ZR6: 12 };
// rows (z of the street line) and lots; front faces +z (heading 180) unless `heading`
const ROWS = { station: 0, civic: -700, glass: -1100, corridor: -1400, hall: -1650, shed: -1900 };
const WATER = { z0: -1858, z1: -1716 };   // harbour basin between the hall row (ferry backs) and the shed row (quays)
const LOTS = [
  // ---- stations (track behind, platforms along it) ----
  { id: 'ST-AG-ZR1', row: 'station', use: 'station', prov: 'ZR1', floors: 2, w: 150, d: 30, fh: 6, gfh: 7, roof: 'canopy', rk: 'membrane', meta: { elevated: false, main: false, platformLength: 150, trackHeading: 90, platformSide: 'back', tracks: 2 } },
  { id: 'ST-EL-ZR1', row: 'station', use: 'station', prov: 'ZR1', floors: 2, w: 160, d: 28, fh: 6, gfh: 7, roof: 'canopy', rk: 'membrane', meta: { elevated: true, main: false, platformLength: 160, trackHeading: 90, platformSide: 'back', tracks: 2 } },
  { id: 'ST-MAIN-ZR3', row: 'station', use: 'station', prov: 'ZR3', floors: 3, w: 224, d: 44, fh: 6, gfh: 7, roof: 'canopy', rk: 'membrane', tier: 'landmark', meta: { elevated: false, main: true, platformLength: 224, trackHeading: 90, platformSide: 'back', tracks: 2 } },
  { id: 'ST-HALT-ZR4', row: 'station', use: 'station', prov: 'ZR4', floors: 1, w: 24, d: 12, fh: 3.4, gfh: 3.4, roof: 'canopy', rk: 'membrane', meta: { elevated: false, main: false, platformLength: 24, trackHeading: 90, platformSide: 'back', tracks: 2 } },
  { id: 'ST-EL-ZR2', row: 'station', use: 'station', prov: 'ZR2', floors: 2, w: 140, d: 27, fh: 6, gfh: 7, roof: 'canopy', rk: 'membrane', slope: 0.06, meta: { elevated: true, main: false, platformLength: 140, trackHeading: 90, platformSide: 'back', tracks: 2, terraced: true, bridging: true } },
  { id: 'ST-AG-ZR6', row: 'station', use: 'station', prov: 'ZR6', floors: 2, w: 130, d: 26, fh: 6, gfh: 7, roof: 'canopy', rk: 'membrane', meta: { elevated: false, main: false, platformLength: 130, trackHeading: 90, platformSide: 'back', tracks: 2, covered: true, cold: true } },
  // ---- civic towers (few, landmark) ----
  { id: 'CT-R-ZR1', row: 'civic', use: 'civic_tower', prov: 'ZR1', floors: 124, w: 56, d: 56, fh: 4, gfh: 7, shape: 'round', roof: 'spire', rk: 'glass', tier: 'landmark', meta: { landmark: true, towerKind: 'needle' } },
  { id: 'CT-S-ZR1', row: 'civic', use: 'civic_tower', prov: 'ZR1', floors: 104, w: 48, d: 48, fh: 4, gfh: 7, roof: 'spire', rk: 'glass', tier: 'landmark', meta: { landmark: true, towerKind: 'sail' } },
  { id: 'CT-R-ZR3', row: 'civic', use: 'civic_tower', prov: 'ZR3', floors: 100, w: 44, d: 44, fh: 4, gfh: 7, shape: 'round', roof: 'spire', rk: 'glass', tier: 'landmark', meta: { landmark: true, towerKind: 'fluted' } },
  { id: 'CT-S-ZR5', row: 'civic', use: 'civic_tower', prov: 'ZR5', floors: 140, w: 60, d: 60, fh: 4, gfh: 7, roof: 'spire', rk: 'glass', tier: 'landmark', meta: { landmark: true, towerKind: 'twist' } },
  // ---- glass: office / research ----
  { id: 'OF-TP-ZR1', row: 'glass', use: 'office', prov: 'ZR1', floors: 40, w: 50, d: 42, fh: 3.8, gfh: 5, shape: 'tower', roof: 'garden', rk: 'garden', tier: 'tower', style: 'Z-glass', meta: { podium: { floors: 4, height: 20, floorHeight: 5 }, tower: { w: 26, d: 24, x: 0, z: -4, shape: 'rect' } } },
  { id: 'OF-TR-ZR5', row: 'glass', use: 'office', prov: 'ZR5', floors: 64, w: 52, d: 46, fh: 3.8, gfh: 5, shape: 'tower', roof: 'garden', rk: 'glass', tier: 'landmark', style: 'Z-glass', meta: { podium: { floors: 3, height: 15, floorHeight: 5 }, tower: { w: 28, d: 28, x: 2, z: -5, shape: 'round' } } },
  { id: 'OF-M-ZR1', row: 'glass', use: 'office', prov: 'ZR1', floors: 9, w: 40, d: 20, fh: 3.8, gfh: 5, roof: 'flat', rk: 'solar', tier: 'midrise', style: 'Z-glass' },
  { id: 'OF-C-ZR6', row: 'glass', use: 'office', prov: 'ZR6', floors: 6, w: 30, d: 18, fh: 3.8, gfh: 5, roof: 'flat', rk: 'solar', tier: 'midrise', style: 'Z-cold' },
  { id: 'RS-ZR1', row: 'glass', use: 'research', prov: 'ZR1', floors: 5, w: 36, d: 20, fh: 4, gfh: 5, roof: 'flat', rk: 'solar', tier: 'midrise', style: 'Z-glass' },
  { id: 'RS-ZR3', row: 'glass', use: 'research', prov: 'ZR3', floors: 3, w: 28, d: 18, fh: 4, gfh: 5, roof: 'flat', rk: 'solar', tier: 'midrise', heading: 135, style: 'Z-glass' },
  // ---- corridor buildings: clinic / school / community ----
  { id: 'CL-ZR1', row: 'corridor', use: 'clinic', prov: 'ZR1', floors: 5, w: 44, d: 22, fh: 4.2, gfh: 4.8, roof: 'flat', rk: 'ceramic', meta: { ambulanceSide: 'right' } },
  { id: 'CL-ZR4', row: 'corridor', use: 'clinic', prov: 'ZR4', floors: 3, w: 32, d: 18, fh: 4.2, gfh: 4.8, roof: 'flat', rk: 'ceramic', meta: { ambulanceSide: 'right' } },
  { id: 'CL-ZR6', row: 'corridor', use: 'clinic', prov: 'ZR6', floors: 4, w: 36, d: 20, fh: 4.2, gfh: 4.8, roof: 'flat', rk: 'ceramic', meta: { ambulanceSide: 'right', covered: true, cold: true } },
  { id: 'SC-ZR1', row: 'corridor', use: 'school', prov: 'ZR1', floors: 3, w: 64, d: 15, fh: 4.0, gfh: 4.5, roof: 'garden', rk: 'garden', meta: { yardSide: 'back' } },
  { id: 'SC-L-ZR2', row: 'corridor', use: 'school', prov: 'ZR2', floors: 2, w: 50, d: 39, fh: 4.0, gfh: 4.5, roof: 'garden', rk: 'garden', shape: 'L', slope: 0.05, meta: { yardSide: 'back', terraced: true } },
  { id: 'CM-ZR1', row: 'corridor', use: 'community', prov: 'ZR1', floors: 2, w: 30, d: 18, fh: 4.5, roof: 'garden', rk: 'garden' },
  { id: 'CM-K-ZR5', row: 'corridor', use: 'community', prov: 'ZR5', floors: 1, w: 12, d: 8, fh: 4, roof: 'canopy', rk: 'membrane', meta: { kiosk: true } },
  { id: 'CM-P-ZR4', row: 'corridor', use: 'community', prov: 'ZR4', floors: 1, w: 14, d: 10, fh: 4, roof: 'garden', rk: 'garden', meta: { pavilion: true } },
  // ---- halls: market / ferry terminal ----
  { id: 'MK-ZR1', row: 'hall', use: 'market', prov: 'ZR1', floors: 1, w: 56, d: 40, fh: 6, gfh: 7, roof: 'vault', rk: 'membrane', meta: { hall: true } },
  { id: 'MK-ZR5', row: 'hall', use: 'market', prov: 'ZR5', floors: 2, w: 44, d: 32, fh: 6, gfh: 7, roof: 'vault', rk: 'membrane', meta: { hall: true } },
  { id: 'MK-ZR6', row: 'hall', use: 'market', prov: 'ZR6', floors: 1, w: 48, d: 34, fh: 6, gfh: 7, roof: 'vault', rk: 'membrane', meta: { hall: true, covered: true, cold: true } },
  { id: 'FT-ZR1', row: 'hall', use: 'ferry_terminal', prov: 'ZR1', floors: 2, w: 44, d: 22, fh: 5, gfh: 6, roof: 'canopy', rk: 'membrane', water: true, meta: { pierHeading: 0, waterSide: 'back' } },
  { id: 'FT-ZR4', row: 'hall', use: 'ferry_terminal', prov: 'ZR4', floors: 2, w: 36, d: 20, fh: 5, gfh: 6, roof: 'canopy', rk: 'membrane', water: true, meta: { pierHeading: 0, waterSide: 'back' } },
  // ---- sheds: warehouse / port shed ----
  { id: 'WH-ZR1', row: 'shed', use: 'warehouse', prov: 'ZR1', floors: 1, w: 72, d: 40, fh: 10, roof: 'flat', rk: 'metal', tier: 'shed', style: 'Z-port', meta: { loadingSide: 'right' } },
  { id: 'WH-S-ZR5', row: 'shed', use: 'warehouse', prov: 'ZR5', floors: 1, w: 60, d: 36, fh: 9, roof: 'sawtooth', rk: 'metal', tier: 'shed', style: 'Z-port', meta: { loadingSide: 'right', port: true } },
  { id: 'PS-ZR5', row: 'shed', use: 'port_shed', prov: 'ZR5', floors: 1, w: 100, d: 50, fh: 12, roof: 'vault', rk: 'metal', tier: 'shed', style: 'Z-port', water: true, meta: { quaySide: 'front' } },
  { id: 'PS-ZR1', row: 'shed', use: 'port_shed', prov: 'ZR1', floors: 1, w: 80, d: 44, fh: 11, roof: 'vault', rk: 'metal', tier: 'shed', style: 'Z-port', meta: { quaySide: 'front' } },
];
// x positions per row
{
  const acc = {};
  for (const L of LOTS) { const a = acc[L.row] ?? 0; L.x = a + L.w / 2; acc[L.row] = a + L.w + (L.row === 'station' ? 90 : L.row === 'civic' ? 120 : 40); }
  for (const L of LOTS) L.x -= (acc[L.row] || 0) / 2;
}

// sloped lots: ground rises behind the front line (slope per metre)
function lotGround(L, lx, lz) { return L.slope ? Math.max(0, (L.d / 2 - lz)) * L.slope : 0; }

function urbanEntrances(L, w, d) {
  const E = [];
  const add = (kind, side, offset, width) => E.push({ kind, side, offset, width });
  switch (L.use) {
    case 'station': add('main', 'front', 0, 8); add('main', 'front', -w * 0.32, 4); add('main', 'front', w * 0.32, 4); for (let k = 0, n = Math.max(2, Math.round(w / 40)); k < n; k++) add('platform', 'back', -w / 2 + (k + 0.5) * (w / n), 4); add('service', 'left', 0, 3); break;
    case 'ferry_terminal': add('main', 'front', 0, 6); add('ferry', 'back', 0, 4); add('service', 'left', 0, 2.4); break;
    case 'warehouse': case 'port_shed': { add('main', 'front', w * 0.35 * (fnv(L.id) & 1 ? -1 : 1), 1.2); const side = L.use === 'port_shed' ? 'front' : 'right'; const LL = side === 'right' ? d : w; const n = Math.max(1, Math.floor(LL / 14)); for (let k = 0; k < n; k++) add('loading', side, -LL / 2 + (k + 0.5) * (LL / n), 4.2); break; }
    case 'school': add('main', 'front', 0, 3.2); add('yard', 'back', 0, 2.4); add('service', 'left', 0, 1.6); break;
    case 'clinic': add('main', 'front', -w * 0.1, 3.0); add('ambulance', 'right', -d * 0.2, 3.6); add('service', 'back', 0, 1.6); break;
    case 'office': case 'civic_tower': case 'research': add('main', 'front', 0, L.tier === 'landmark' ? 8 : 4); add('service', 'back', w * 0.1, 2.4); if (L.tier === 'tower' || L.tier === 'landmark') add('garage', 'right', d * 0.3, 6); break;
    case 'market': case 'community': add('main', 'front', 0, L.use === 'market' ? 6 : 3); add('main', 'left', 0, 2.4); add('service', 'back', w * 0.25, 2.4); break;
    default: add('main', 'front', 0, 1.8); add('service', 'back', 0, 1.0);
  }
  return E;
}

// urban D1 station meta (world/urban/specs.js): trackOffset = building-frame z of the track centreline
// (negative), railGround = rail bed − entrance (level bed at the back-facade ground), railHead
function stationMeta(L, corners) {
  if (L.use !== 'station') return {};
  const el = !!(L.meta && L.meta.elevated);
  const off = (el ? 11 / 2 + 4 : 16 / 2 + 6) + L.d / 2;
  const rg = Math.max(corners[2], corners[3]);
  return { trackOffset: -off, railGround: rg, railHead: rg + (el ? 9.0 : 0.35) };
}
function makeSpec(L) {
  const hash = fnv(L.id);
  const heading = L.heading ?? 180;
  const rot = (180 - heading) * Math.PI / 180;
  const w = L.w, d = L.d, zc = ROWS[L.row] - (8 + d / 2);
  const loc = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  const corners = loc.map(([x, z]) => lotGround(L, x, z));
  const e = 0;
  let footprint = { shape: L.shape || 'rect', w, d };
  if (L.shape === 'L') {
    // urban school L: front bar depth 15 over the full width + back-left wing (local coords, centred)
    const bar = 15, wing = Math.min(16, w * 0.3);
    footprint = { shape: 'L', w, d, points: [[-w / 2, d / 2], [-w / 2, -d / 2], [-w / 2 + wing, -d / 2], [-w / 2 + wing, d / 2 - bar], [w / 2, d / 2 - bar], [w / 2, d / 2]] };
  }
  return {
    id: L.id, hash, version: 1, use: L.use, province: PROV[L.prov] || 7, provinceCode: L.prov, zone: 'Z', style: L.style || '', tier: L.tier || (L.floors > 12 ? 'tower' : L.floors > 3 ? 'midrise' : 'lowrise'),
    lat: LAT, lon: 118, heading, ground: { entrance: L.water ? 2.4 : 12, min: Math.min(...corners, e) + (L.water ? 2.4 : 12), max: Math.max(...corners, e) + (L.water ? 2.4 : 12), corners: corners.map((c) => c + (L.water ? 2.4 : 12)) },
    footprint, floors: L.floors, floorHeight: L.fh || 4.2, groundFloorHeight: L.gfh || undefined, basement: 0, roof: L.roof || 'flat',
    plot: { id: 'P-' + L.id }, block: 'K', district: 'D', neighbors: {}, sharedWalls: L.shared || {},
    entrances: urbanEntrances(L, w, d), occupancy: 0.8, yearBuilt: 2350 + (hash % 80),
    meta: { roofKind: L.rk || 'ceramic', ...(L.meta || {}), ...stationMeta(L, corners) },
    _world: { x: L.x, z: zc, rot, y: 0 }, _lot: L,
  };
}
const SPECS = LOTS.map(makeSpec);

// ---------------------------------------------------------------------------
// ground + bench scenery (streets, slope pads, tracks / viaducts / trains, water)
// ---------------------------------------------------------------------------
function plainMat(c, r = 0.85, m = 0) { return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); }
function addBox(w, h, d, x, y, z, mat, ry = 0, parent = scene) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function buildGround() {
  // ground in two pieces around a harbour basin (z ∈ [WATER.z0, WATER.z1]) shared by the ferry terminals
  // (water behind) and the port sheds (quay in front); water surface 1.6 m below the quays
  const gmat = plainMat(0x9c6e52, 0.95);
  for (const [za, zb] of [[WATER.z1, 650], [-3200, WATER.z0]]) {
    const g = new THREE.PlaneGeometry(5200, zb - za, 1, 1); g.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(g, gmat); ground.position.set(0, -0.03, (za + zb) / 2); ground.receiveShadow = true; scene.add(ground);
  }
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(5200, WATER.z1 - WATER.z0).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x1d4a66, roughness: 0.06, metalness: 0, clearcoat: 1 }));
    water.position.set(0, -1.6, (WATER.z0 + WATER.z1) / 2); water.receiveShadow = true; scene.add(water);
    const qm = plainMat(0x8f8a82, 0.9);
    addBox(5200, 4.0, 1.2, 0, -2.0, WATER.z1 - 0.6, qm).castShadow = false;
    addBox(5200, 4.0, 1.2, 0, -2.0, WATER.z0 + 0.6, qm).castShadow = false;
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(5200, WATER.z1 - WATER.z0).rotateX(-Math.PI / 2), plainMat(0x3a3530, 1));
    bed.position.set(0, -6, (WATER.z0 + WATER.z1) / 2); scene.add(bed);
  }
  const road = plainMat(0x2a2b2d, 0.9), walk = plainMat(0xb9b4ab, 0.9);
  for (const z of Object.values(ROWS)) {
    addBox(5200, 0.05, 10, 0, -0.01, z + 6, road).castShadow = false;
    addBox(5200, 0.12, 4, 0, 0.0, z - 1, walk).castShadow = false;
  }
  for (const s of SPECS) {
    const L = s._lot, W = s._world;
    // building pad / plaza paving around the lot (front plaza 8 m)
    const pad = addBox(L.w + 16, 0.1, L.d + 14, W.x, -0.0, W.z + 1, walk); pad.castShadow = false;
    if (L.slope) {
      const geo = new THREE.BoxGeometry(L.w + 30, 1, L.d + 30, 8, 1, 8);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const lx = p.getX(i), lz = p.getZ(i); const top = p.getY(i) > 0; p.setY(i, top ? lotGround(L, lx, lz) - 0.02 : -0.5); }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, plainMat(0xa47457, 0.95)); m.position.set(W.x, 0, W.z); m.rotation.y = W.rot; m.receiveShadow = true; scene.add(m);
    }
    if (L.use === 'station') stationScenery(s);
    if (L.use === 'ferry_terminal') {
      // stand-in for the city's ferry pier (dock polygon, deck 2.5 m a.s.l.): straight out from the back facade
      const pm = plainMat(0xb8b2a8, 0.85);
      const z0 = W.z - L.d / 2 - 0.3, len = (z0 - WATER.z1) + 60;
      addBox(16, 0.6, len, W.x, -0.22, z0 - len / 2, pm);
      for (let z = z0 - 6; z > z0 - len; z -= 8) for (const sx of [-6, 0, 6]) addBox(0.6, 6, 0.6, W.x + sx, -3.6, z, pm).castShadow = false;
    }
  }
}
// rails / ballast / viaduct + a parked train (bench-only stand-ins for the city & props agents)
function stationScenery(s) {
  const W = s._world, L = s._lot;
  const norm = { _d: L.d, _meta: s.meta, _ground: { fl: 0, fr: 0, br: lotGround(L, 0, -L.d / 2), bl: lotGround(L, 0, -L.d / 2) } };
  const T = stationTrack(norm);
  const len = L.w + 260;
  const grp = new THREE.Group(); grp.position.set(W.x, 0, W.z); grp.rotation.y = W.rot; scene.add(grp);
  const steel = plainMat(0x8a8f94, 0.35, 1), sleeper = plainMat(0x77746e, 0.9), ballast = plainMat(0x5e5852, 1), deck = plainMat(0xc9c6bf, 0.8);
  if (T.elevated) {
    addBox(len, 1.6, 11, 0, T.railY - 0.35 - 0.8, T.zTrack, deck, 0, grp);
    for (let x = -len / 2 + 15; x < len / 2; x += 30) addBox(2.2, T.railY - 1.8 - T.groundTrack, 2.2, x, T.groundTrack + (T.railY - 1.8 - T.groundTrack) / 2, T.zTrack, deck, 0, grp);
  } else addBox(len, 0.3, 9, 0, T.railY - 0.35 + 0.0, T.zTrack, ballast, 0, grp);
  for (const zt of [T.zNear, T.zFar]) {
    for (const g of [-0.7175, 0.7175]) addBox(len, 0.16, 0.07, 0, T.railY - 0.08, zt + g, steel, 0, grp);
    const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.18, 2.6), sleeper, Math.floor(len / 0.65));
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < sl.count; i++) { m4.makeTranslation(-len / 2 + i * 0.65, T.railY - 0.25, zt); sl.setMatrixAt(i, m4); }
    sl.receiveShadow = true; grp.add(sl);
  }
  // train at the near platform (60 m, 2.9 m wide), white ZR livery with dark window band
  if (L.w > 40) {
    const car = new THREE.Group(); grp.add(car);
    const body = plainMat(0xe9e8e4, 0.35, 0.2), win = plainMat(0x1a2a36, 0.1, 0.4), cyan = new THREE.MeshBasicMaterial({ color: 0x7fe7ff });
    const tl = Math.min(80, L.w * 0.55);
    addBox(tl, 3.0, 2.9, -L.w * 0.08, T.railY + 0.5 + 1.5, T.zNear, body, 0, car);
    addBox(tl - 1, 0.9, 2.94, -L.w * 0.08, T.railY + 0.5 + 2.05, T.zNear, win, 0, car);
    addBox(tl - 1, 0.06, 2.95, -L.w * 0.08, T.railY + 0.5 + 0.9, T.zNear, cyan, 0, car);
  }
}

// ---------------------------------------------------------------------------
// building management
// ---------------------------------------------------------------------------
let LOD = Q.get('lod') || 'exterior';
const ONLY = Q.get('only') === '1';
const ROW = Q.get('row');
const bq = Q.get('b');
let focus = bq ? (isNaN(+bq) ? Math.max(0, SPECS.findIndex((s) => s.id === bq)) : Math.max(0, Math.min(SPECS.length - 1, +bq))) : 0;
const objs = new Map();
let busy = 0;

async function loadBuilding(spec, lod) {
  busy++;
  try {
    const t0 = performance.now();
    const clean = { ...spec }; delete clean._world; delete clean._lot;
    const data = await pool.submit('building', { spec: clean, lod }).promise;
    const old = objs.get(spec.id);
    if (old) { scene.remove(old.group); disposeBuildingObject(old.group); }
    const g = createBuildingObject(data, null, { name: spec.id });
    g.position.set(spec._world.x, spec._world.y, spec._world.z);
    g.rotation.y = spec._world.rot;
    g.updateMatrixWorld(true);
    scene.add(g);
    objs.set(spec.id, { group: g, data, lod });
    stats.gen[spec.id] = { lod, workerMs: +(data.__workerMs || 0).toFixed(1), genMs: data.stats.ms, roundTripMs: +(performance.now() - t0).toFixed(1), tris: data.stats.triangles, type: data.stats.type, err: data.stats.error ? data.stats.error.split('\n')[0] : undefined, col: data.stats.colliderTriangles };
    if (data.stats.error) console.warn('[bench-z]', spec.id, data.stats.error);
    setWire(wire);
  } finally { busy--; }
}
async function loadAll() {
  let list = ONLY ? [SPECS[focus]] : ROW ? SPECS.filter((s) => s._lot.row === ROW || s === SPECS[focus]) : SPECS;
  await Promise.all(list.map((s) => loadBuilding(s, s === SPECS[focus] ? LOD : (LOD === 'full' ? 'exterior' : LOD))));
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------
function toWorld(spec, p) { const o = objs.get(spec.id); const v = new THREE.Vector3(...p); return o ? v.applyMatrix4(o.group.matrixWorld) : v; }
function frame(view) {
  const spec = SPECS[focus];
  const o = objs.get(spec.id);
  if (!o) return;
  const b = o.data.bounds, A = o.data.anchors;
  const H = b.max[1], w = spec.footprint.w, d = spec.footprint.d;
  const R = Math.max(w, d, H);
  const set = (pos, tgt) => { camera.position.copy(toWorld(spec, pos)); controls.target.copy(toWorld(spec, tgt)); controls.update(); hideOccluders(spec); };
  const cams = A.cameras || {};
  const tall = H > Math.max(w, d) * 1.6;
  switch (view) {
    case 'front': tall ? set([-w * 0.3 - H * 0.12, H * 0.3, d / 2 + H * 1.2], [0, H * 0.5, 0]) : set([-w * 0.25, Math.min(H * 0.5, R * 0.3) + 3, d / 2 + R * 0.95 + 8], [0, Math.min(H * 0.4, 12), 0]); break;
    case 'back': tall ? set([w * 0.3 + H * 0.12, H * 0.3, -d / 2 - H * 1.2], [0, H * 0.5, 0]) : set([w * 0.25, Math.min(H * 0.5, R * 0.3) + 6, -d / 2 - R * 0.95 - 12], [0, Math.min(H * 0.4, 12), -d / 2]); break;
    case 'crown': set([-w * 0.9 - H * 0.05, H * 0.86, d * 0.9 + H * 0.12], [0, H * 0.9, 0]); break;
    case 'base': set([-w * 0.55, 9, d / 2 + w * 0.9 + 20], [0, 18, 0]); break;
    case 'mid': set([w * 0.8, H * 0.45, d / 2 + w * 1.6], [0, H * 0.5, 0]); break;
    case 'row': {
      const list = SPECS.filter((s2) => s2._lot.row === spec._lot.row);
      const x0 = Math.min(...list.map((s2) => s2._world.x - s2._lot.w / 2)), x1 = Math.max(...list.map((s2) => s2._world.x + s2._lot.w / 2));
      const span = x1 - x0, cx = (x0 + x1) / 2, zc = spec._world.z;
      const Hm = Math.max(...list.map((s2) => (objs.get(s2.id)?.data.bounds.max[1]) || 20));
      if (Hm < 60) {
        // low rows: oblique aerial (~30°) so every building of the row fills the frame
        camera.position.set(cx - span * 0.06, span * 0.3 + 20, zc + span * 0.56 + 30);
        controls.target.set(cx, 4, zc - 6);
      } else {
        camera.position.set(cx - span * 0.08, Math.max(Hm * 0.45, 30), zc + Math.max(span * 0.62, Hm * 1.15) + 40);
        controls.target.set(cx, Hm * 0.42, zc);
      }
      controls.update();
      for (const [, o2] of objs) o2.group.visible = true;
      fitShadow(spec);
      return;
    }
    case 'side': set([w / 2 + R * 1.0 + 6, Math.min(H * 0.5, 40) + 3, d * 0.3], [0, Math.min(H * 0.4, 30), 0]); break;
    case 'corner': set([w / 2 + R * 0.55, Math.min(H * 0.6, 60) + 4, d / 2 + R * 0.65], [0, Math.min(H * 0.35, 40), 0]); break;
    case 'roof': set([-w * 0.3, H + Math.max(14, R * 0.45), d / 2 + R * 0.45], [0, H - 2, -d * 0.1]); break;
    case 'aerial': set([-w * 0.9, H + R * 0.9 + 20, d / 2 + R * 1.4 + 20], [0, H * 0.3, -d * 0.3]); break;
    case 'detail': set([-w * 0.15, 3.2, d / 2 + 9.5], [-w * 0.05, 3.0, d / 2]); break;
    case 'plan': { const c = cut !== null ? cut : H * 0.5; set([0.01, c + Math.max(w, d) * 1.05 + 4, d * 0.32], [0, c - 2.5, 0]); break; }
    default: {
      const key = view === 'interior' ? (cams.interior ? 'interior' : cams.lobby ? 'lobby' : 'living') : view;
      const cam = cams[key];
      if (cam) set(cam.pos, cam.target);
      else set([-w * 0.25, Math.min(H * 0.5, R * 0.3) + 3, d / 2 + R * 0.95 + 8], [0, Math.min(H * 0.4, 12), 0]);
    }
  }
  fitShadow(spec);
}
function hideOccluders(spec) {
  const seg = new THREE.Line3(camera.position.clone(), controls.target.clone());
  const tmp = new THREE.Vector3();
  for (const [id, o] of objs) {
    if (id === spec.id) { o.group.visible = true; continue; }
    const b = new THREE.Box3().setFromObject(o.group);
    const c = b.getCenter(new THREE.Vector3()), r = b.getSize(tmp).length() * 0.5;
    const p = seg.closestPointToPoint(c, true, new THREE.Vector3());
    o.group.visible = !(b.containsPoint(camera.position) || p.distanceTo(c) < r * 0.8);
  }
}
function fitShadow(spec) {
  const o = objs.get(spec.id); if (!o) return;
  const b = o.data.bounds;
  const c = toWorld(spec, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 0.5 + 25;
  const s = sunVector(hour);
  sun.position.copy(c).addScaledVector(s, r * 2);
  sun.target.position.copy(c);
  const sc = sun.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = r * 4;
  sc.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}
let wire = Q.get('wire') === '1';
function setWire(v) { scene.traverse((o) => { if (o.isMesh && o.material && o.material.name?.startsWith('bk:')) o.material.wireframe = v; }); }
let cut = Q.get('cut') ? +Q.get('cut') : null;
function applyCut() {
  if (cut === null) { renderer.clippingPlanes = []; return; }
  const spec = SPECS[focus];
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), spec._world.y + cut)];
}

// ---------------------------------------------------------------------------
// HUD + keys
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
function updHud() {
  const spec = SPECS[focus], g = stats.gen[spec.id] || {};
  const info = renderer.info;
  hud.innerHTML = `<b>${spec.id}</b> use=${spec.use} style=${spec.style || spec.provinceCode} floors=${spec.floors} ${spec.footprint.w}×${spec.footprint.d}\n` +
    `LOD <b>${LOD}</b> type=${g.type} worker ${g.workerMs}ms gen ${g.genMs}ms tris ${g.tris} ${g.col ? 'col ' + g.col : ''} ${g.err ? 'ERR ' + g.err : ''}\n` +
    `time ${hour.toFixed(1)}h  draw ${info.render.calls} tris ${info.render.triangles}\n` +
    `[L]od [C]ut [W]ire [N]ight [T]ime [ ] building  1-9 views`;
}
window.addEventListener('keydown', async (e) => {
  const k = e.key.toLowerCase();
  if (k === 'l') { LOD = LOD === 'mass' ? 'exterior' : LOD === 'exterior' ? 'full' : 'mass'; await loadBuilding(SPECS[focus], LOD); }
  if (k === 'c') { cut = cut === null ? 4.2 : cut > 30 ? null : cut + 4.2; applyCut(); }
  if (k === 'w') { wire = !wire; setWire(wire); }
  if (k === 'n') { night = !night; hour = night ? 21.5 : 11.0; applyTime(); }
  if (k === 't') { hour = (hour + 1) % 24; applyTime(); }
  if (k === ']' || k === '[') { focus = (focus + (k === ']' ? 1 : SPECS.length - 1)) % SPECS.length; if (!objs.has(SPECS[focus].id) || objs.get(SPECS[focus].id).lod !== LOD) await loadBuilding(SPECS[focus], LOD); frame('front'); }
  if (k === 'f') frame('front');
  const views = { 1: 'front', 2: 'back', 3: 'roof', 4: 'corner', 5: 'entrance', 6: 'interior', 7: 'platform', 8: 'side', 9: 'aerial' };
  if (views[k]) frame(views[k]);
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

// ---------------------------------------------------------------------------
// perf bench (?bench=1): every spec of the row (or all), each LOD, 3 runs (median) in the worker
// ---------------------------------------------------------------------------
async function runBench() {
  const out = {};
  const list = ROW ? SPECS.filter((s) => s._lot.row === ROW) : SPECS;
  for (const spec of list) {
    const clean = { ...spec }; delete clean._world; delete clean._lot;
    out[spec.id] = {};
    for (const lod of ['mass', 'exterior', 'full']) {
      const runs = [];
      for (let i = 0; i < 3; i++) { const d = await pool.submit('building', { spec: clean, lod }).promise; runs.push({ ms: d.stats.ms, tris: d.stats.triangles, col: d.stats.colliderTriangles || 0, type: d.stats.type, err: d.stats.error ? 1 : 0 }); }
      runs.sort((a, b) => a.ms - b.ms);
      out[spec.id][lod] = { ms: runs[1].ms, tris: runs[1].tris, col: runs[1].col, type: runs[1].type, err: runs[1].err };
    }
  }
  console.log('[bench-z]', JSON.stringify(out));
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
let ready = false;
window.__MARS__ = {
  ready: true,
  async waitIdle(ms = 90000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (ready && busy === 0) { await new Promise((r) => setTimeout(r, 400)); return true; } await new Promise((r) => setTimeout(r, 100)); } return false; },
  stats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, gen: stats.gen, bench: stats.bench, light: stats.light }; },
  frame, specs: SPECS, setLod: async (l) => { LOD = l; await loadBuilding(SPECS[focus], l); },
};

(async function main() {
  applyTime();
  buildGround();
  const texP = initBuildingMaterials(null, { workers: pool });
  if (Q.get('bench') === '1') { stats.bench = await runBench(); }
  await loadAll();
  await texP;
  frame(Q.get('view') || 'front');
  if (Q.get('cam') && Q.get('tgt')) {
    const spec = SPECS[focus];
    camera.position.copy(toWorld(spec, Q.get('cam').split(',').map(Number)));
    controls.target.copy(toWorld(spec, Q.get('tgt').split(',').map(Number)));
    controls.update(); hideOccluders(spec);
  }
  applyCut();
  ready = true;
  updHud();
})();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready) updHud();
});
