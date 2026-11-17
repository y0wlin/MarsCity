// Building kit dev bench: a street of synthetic BuildingSpecs (sizes, 2–30 floors, headings,
// styles, shared walls, sloped ground) generated in module workers, sun + sky light, orbit camera.
// Keys: L = cycle LOD (mass/exterior/full)  C = cut-away  W = wireframe  N = night  T = +1 h
//       [ ] = prev/next building  F = frame  1..7 = views (front back roof street entrance lobby living)
// URL:  ?b=3&view=front|back|side|roof|street|entrance|lobby|stair|living|yard|aerial|interior|board
//       (view=board: §3 材质样板 — dry / wet concrete, oxidised basalt, ceramic panels, brushed
//        aluminium, window glass (interior-mapped, in a ceramic wall), agricultural glass, an 18 %
//        grey card and a 1.7 m figure, all under the same sun + sky)
//       &lod=full&time=15&night=1&cut=7.5&wire=1&clean=1&only=1&bench=1&fov=50&nohide=1
//       &cam=x,y,z&tgt=x,y,z (building-local camera / target of the framed building)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildingObject, disposeBuildingObject, initBuildingMaterials, setBuildingLighting, BUILDING_UNIFORMS, getBuildingMaterial } from '../buildings/materials.js';
import { MeshBuilder } from '../buildings/kit/MeshBuilder.js';
import * as K from '../buildings/kit/index.js';

const Q = new URLSearchParams(location.search);
const R_PLANET = 3389500;
const LAT = 22;

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
const pool = new BenchPool(Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 8) - 2)));

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
// ground: street + sidewalks + terrain with a sloped lot
// ---------------------------------------------------------------------------
function groundH(x, z) {
  // flat street at y=0; north lots rise behind x∈[30,62] (slope away from street), south lot dips
  let h = 0;
  const north = Math.max(0, -z - 9);
  const wx = THREE.MathUtils.smoothstep(x, 26, 34) * (1 - THREE.MathUtils.smoothstep(x, 60, 68));
  h += north * 0.16 * wx;
  const south = Math.max(0, z - 9);
  const sx = THREE.MathUtils.smoothstep(x, -70, -62) * (1 - THREE.MathUtils.smoothstep(x, -40, -34));
  h -= south * 0.1 * sx;
  return h;
}
function buildGround() {
  const W = 520, Dd = 220, seg = 1.0;
  const nx = Math.round(W / seg), nz = Math.round(Dd / seg);
  const g = new THREE.PlaneGeometry(W, Dd, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, groundH(x, z) - 0.02);
    const street = Math.abs(z) < 5, walk = Math.abs(z) < 9;
    const c = street ? [0.13, 0.13, 0.135] : walk ? [0.62, 0.6, 0.57] : [0.62, 0.42, 0.31];
    // linear albedo ≈ the old concrete texture (≈ 0.45) × tint, with a little low-frequency mottling
    const m = 0.45 * (0.93 + 0.07 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.0) * Math.cos(z * 0.09 - x * 0.03));
    col[i * 3] = c[0] * m; col[i * 3 + 1] = c[1] * m; col[i * 3 + 2] = c[2] * m;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // plain vertex-colour ground (a wall texture such as 'concrete' streaks on a horizontal plane)
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  // sidewalks (paving) as separate strips so the slab joints only show where people walk
  for (const z of [-7, 7]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 3.8), getBuildingMaterial('paving', null));
    sw.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sw.geometry.attributes.position.count * 3).fill(1), 3));
    const uv = sw.geometry.attributes.uv, pp = sw.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i), pp.getZ(i));
    sw.position.set(0, 0.04, z); sw.receiveShadow = true; scene.add(sw);
  }
  // kerbs + lane markings
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(W, 0.15, 0.25), new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.8 }));
  for (const z of [-5, 5]) { const k = kerb.clone(); k.position.set(0, 0.06, z); k.receiveShadow = true; scene.add(k); }
  const mk = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 0.6 });
  for (let x = -W / 2; x < W / 2; x += 6) { const l = new THREE.Mesh(new THREE.BoxGeometry(3, 0.01, 0.15), mk); l.position.set(x, 0.005, 0); scene.add(l); }
  return mesh;
}

// ---------------------------------------------------------------------------
// synthetic specs
// ---------------------------------------------------------------------------
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const PROV = { ZR1: 7, ZR2: 8, ZR3: 9, ZR4: 10, ZR5: 11, ZR6: 12, OX1: 1 };
// lot: x centre, side ('N' faces the street from the north, 'S' from the south)
const LOTS = [
  { id: 'R4-ZR1', use: 'residential', prov: 'ZR1', floors: 4, w: 22, d: 13, x: -150, side: 'N', roof: 'garden', rk: 'garden' },
  { id: 'R10-ZR1', use: 'residential', prov: 'ZR1', floors: 10, w: 30, d: 14, x: -112, side: 'N', roof: 'garden', rk: 'garden' },
  { id: 'T24-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 24, w: 26, d: 24, x: -72, side: 'N', roof: 'garden', rk: 'ceramic', shape: 'tower' },
  { id: 'SR4-ZR5', use: 'shop_row', prov: 'ZR5', floors: 4, w: 28, d: 14, x: -34, side: 'N', shared: { right: true }, roof: 'flat', rk: 'ceramic' },
  { id: 'SR3-ZR5', use: 'shop_row', prov: 'ZR5', floors: 3, w: 18, d: 14, x: -11, side: 'N', shared: { left: true }, roof: 'flat', rk: 'solar' },
  { id: 'R6-ZR2-slope', use: 'residential', prov: 'ZR2', floors: 6, w: 24, d: 14, x: 46, side: 'N', style: 'zr_terrace', roof: 'terrace', rk: 'terrace' },
  { id: 'R5-ZR6', use: 'residential', prov: 'ZR6', floors: 5, w: 20, d: 12, x: 84, side: 'N', roof: 'pitched', rk: 'metal' },
  { id: 'R3-ZR4', use: 'residential', prov: 'ZR4', floors: 3, w: 16, d: 11, x: 116, side: 'N', roof: 'garden', rk: 'garden' },
  { id: 'R2-ZR3', use: 'residential', prov: 'ZR3', floors: 2, w: 12, d: 10, x: 142, side: 'N', heading: 90, roof: 'pitched', rk: 'ceramic' },
  { id: 'T30-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 30, w: 28, d: 28, x: -110, side: 'S', roof: 'garden', rk: 'garden', shape: 'round' },
  { id: 'C3-ZR1', use: 'clinic', prov: 'ZR1', floors: 3, w: 26, d: 16, x: -60, side: 'S', roof: 'flat', rk: 'ceramic' },
  { id: 'D3-OX1', use: 'dorm', prov: 'OX1', zone: 'O', floors: 3, w: 20, d: 11, x: -16, side: 'S', roof: 'flat', rk: 'ceramic' },
  { id: 'R8-ZR5', use: 'residential', prov: 'ZR5', floors: 8, w: 26, d: 15, x: 26, side: 'S', roof: 'flat', rk: 'membrane' },
  { id: 'R5-ZR1-slopeS', use: 'residential', prov: 'ZR1', floors: 5, w: 20, d: 13, x: 70, side: 'S', groundDip: true, roof: 'flat', rk: 'solar' },
  // a terrace of row houses (联排): party walls, separate entrances, pitched ceramic / metal roofs
  { id: 'RW1-ZR1', use: 'residential', prov: 'ZR1', floors: 3, w: 8.6, d: 11, x: 166, side: 'N', shared: { right: true }, roof: 'pitched', rk: 'ceramic' },
  { id: 'RW2-ZR1', use: 'residential', prov: 'ZR1', floors: 3, w: 8.6, d: 11, x: 174.6, side: 'N', shared: { left: true, right: true }, roof: 'pitched', rk: 'warm' },
  { id: 'RW3-ZR1', use: 'residential', prov: 'ZR1', floors: 2, w: 8.6, d: 11, x: 183.2, side: 'N', shared: { left: true, right: true }, roof: 'pitched', rk: 'ceramic' },
  { id: 'RW4-ZR1', use: 'residential', prov: 'ZR1', floors: 3, w: 8.6, d: 11, x: 191.8, side: 'N', shared: { left: true }, roof: 'flat', rk: 'garden' },
  // towers on podiums (urban TOWER_PODIUM): shop podium + roof terrace, rect / round tower on top
  { id: 'TP26-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 26, w: 48, d: 40, x: 145, side: 'S', roof: 'garden', rk: 'garden', shape: 'tower', meta: { podium: { floors: 4, height: 20, floorHeight: 5 }, tower: { w: 24, d: 24, x: 0, z: -4, shape: 'rect' } } },
  { id: 'TPR30-ZR1', use: 'residential_tower', prov: 'ZR1', floors: 30, w: 50, d: 42, x: -180, side: 'S', roof: 'garden', rk: 'glass', shape: 'tower', meta: { podium: { floors: 3, height: 15, floorHeight: 5 }, tower: { w: 26, d: 26, x: 3, z: -5, shape: 'round' } } },
  // shop rows with a ground-floor colonnade (檐廊): covered ZR1 street, ZR6 cold valley (square piers)
  { id: 'SA5-ZR1', use: 'shop_row', prov: 'ZR1', floors: 5, w: 30, d: 15, x: 100, side: 'S', roof: 'garden', rk: 'garden', meta: { covered: true } },
  { id: 'SA3-ZR6', use: 'shop_row', prov: 'ZR6', floors: 3, w: 26, d: 14, x: 216, side: 'N', roof: 'flat', rk: 'membrane' },
  // a long slab block with two cores (一梯两户 × 2): two lobbies, two stair houses
  { id: 'R6W-ZR1', use: 'residential', prov: 'ZR1', floors: 6, w: 46, d: 14, x: 200, side: 'S', roof: 'flat', rk: 'ceramic' },
];

function makeSpec(L) {
  const hash = fnv(L.id);
  const heading = L.heading ?? (L.side === 'N' ? 180 : 0);
  const setback = 2.0;
  const d = L.d, w = L.w;
  const zc = L.side === 'N' ? -(9 + setback + d / 2) : (9 + setback + d / 2);
  const rot = (180 - heading) * Math.PI / 180;
  // footprint corners in world (front-left, front-right, back-right, back-left)
  const loc = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  const c = Math.cos(rot), s = Math.sin(rot);
  const toW = ([x, z]) => [L.x + x * c + z * s, zc - x * s + z * c];
  const corners = loc.map((p) => { const q = toW(p); return groundH(q[0], q[1]); });
  const ent = toW([0, d / 2 + 0.5]);
  const e = groundH(ent[0], ent[1]);
  const shared = L.shared || {};
  return {
    id: L.id, hash, version: 1, use: L.use, province: PROV[L.prov] || 7, provinceCode: L.prov, zone: L.zone || 'Z', style: L.style || '', tier: L.floors > 12 ? 'tower' : L.floors > 3 ? 'midrise' : 'lowrise',
    lat: LAT, lon: 118, heading, ground: { entrance: e, min: Math.min(...corners, e), max: Math.max(...corners, e), corners },
    footprint: { shape: L.shape || 'rect', w, d }, floors: L.floors, floorHeight: 3.1, basement: 0, roof: L.roof || 'flat',
    plot: { id: 'P-' + L.id }, block: 'K', district: 'D', neighbors: {}, sharedWalls: shared,
    entrances: [{ kind: 'main', side: 'front', offset: 0 }, ...(shared.back ? [] : [{ kind: 'service', side: 'back', offset: 0 }])],
    occupancy: 0.8, yearBuilt: 2350 + (hash % 80), meta: { roofKind: L.rk || 'ceramic', ...(L.meta || {}) },
    _world: { x: L.x, z: zc, rot, y: e },
  };
}
const SPECS = LOTS.map(makeSpec);

// ---------------------------------------------------------------------------
// material sample board (§3 材质样板), built with the kit on the main thread (the kit is worker-safe
// plain JS, so it runs here too): one 1.2 × 1.8 m panel per material on a plinth, same light
// ---------------------------------------------------------------------------
const BOARD = { x: -250, z: -7.4 };
function buildBoard() {
  const b = new MeshBuilder({ hash: 0x5eed1234, colliders: false });
  const P = 1.2, H = 1.8, GAP = 0.45, y0 = 0.16;
  const panels = (Q.get('panels') || 'concrete,concrete_smooth,concrete_wet,basalt,ceramic_white,aluminium,window,curtain,glass_agri,skygarden').split(',');
  panels.forEach((key, i) => {
    const x0 = i * (P + GAP), x1 = x0 + P;
    b.box('concrete_smooth', x0 - 0.08, 0, -0.22, x1 + 0.08, y0, 0.22);                 // plinth
    if (key === 'curtain') {
      // blue-grey curtain wall: aluminium grid, two vision panes over a spandrel, interior-mapped office
      b.push(); b.translate(x0, 0, 0.06);
      const ys = [y0, y0 + 0.42, y0 + H];
      for (const x of [0, P / 2 - 0.025, P - 0.05]) b.box('aluminium', x, y0, -0.04, x + 0.05, y0 + H, 0.03);
      for (const y of ys) b.box('aluminium', 0, Math.min(y, y0 + H - 0.05), -0.04, P, Math.min(y, y0 + H - 0.05) + 0.05, 0.03);
      b.box('panel_grey', 0.05, y0 + 0.05, -0.06, P - 0.05, y0 + 0.42, -0.04);                  // spandrel panel
      for (const [a, c] of [[0.05, P / 2 - 0.025], [P / 2 + 0.025, P - 0.05]]) {
        K.setGlassRoom(b, { u0: 2.0 + a, w: 3.6, d: 8, h: 3.0, sill: 0.2, seed: 0.61, floor: 3, bay: 5, hash: 0x2545f491, kind: K.ROOM_KIND.office, profile: 1 }, 0, 0);
        const w = c - a, h = H - 0.47;
        b.quad('glass_curtain', a, y0 + 0.47, 0, c, y0 + 0.47, 0, c, y0 + H - 0.05, 0, a, y0 + H - 0.05, 0, [0, 0, w, 0, w, h, 0, h]);
      }
      K.clearGlassRoom(b);
      b.pop();
    } else if (key === 'skygarden') {
      // far-LOD façade (mass_facade) at 1:10: storeys with windows and one sky-garden band (flag 1 with a bay width)
      const fh = 0.31, gh = 0.36;
      for (let k = 0; k * fh + gh < H + 0.01; k++) {
        const ya = k === 0 ? 0 : gh + (k - 1) * fh, yb = Math.min(H, gh + k * fh);
        b.setExtra('facade', fh, 0.36, 0, gh);
        b.setExtra('facadeId', 0x1234, 0x5678, H, (k === 3 ? 1 : 0) | (1 << 4));
        b.quad('mass_facade', x0, y0 + ya, 0, x1, y0 + ya, 0, x1, y0 + yb, 0, x0, y0 + yb, 0, [0, ya, P, ya, P, yb, 0, yb]);
      }
      b.box('ceramic_band', x0, y0 + H, -0.06, x1, y0 + H + 0.03, 0.02);
    } else if (key === 'window') {
      // a piece of ceramic wall with a real window: reveal, frame, mullion, interior-mapped glass
      b.push(); b.translate(x0, 0, 0.1);
      const op = { u0: 0.18, u1: P - 0.18, v0: y0 + 0.3, v1: y0 + H - 0.2, reveal: 0.18 };
      K.wallWithOpenings(b, { L: P, y0, y1: y0 + H, T: 0.2, openings: [op], outer: 'ceramic_white', capStart: true, capEnd: true });
      K.windowUnit(b, { ...op, R: 0.16, type: 'casement', cols: 2, room: { u0: 1.1, w: 3.8, d: 4.4, h: 2.8, sill: 0.9, seed: 0.37, floor: 1, bay: 2, hash: 0x9e3779b9, kind: K.ROOM_KIND.living ?? 1, profile: 0 } });
      K.clearGlassRoom(b);
      b.pop();
    } else if (key === 'glass_agri') {
      // greenhouse glazing: aluminium glazing bars with a two-sided agricultural glass pane
      for (const x of [x0, x1 - 0.05]) b.box('aluminium', x, y0, -0.03, x + 0.05, y0 + H, 0.03);
      for (const y of [y0, y0 + H / 2 - 0.025, y0 + H - 0.05]) b.box('aluminium', x0, y, -0.03, x1, y + 0.05, 0.03);
      b.quad('glass_agri', x0 + 0.05, y0 + 0.05, 0, x1 - 0.05, y0 + 0.05, 0, x1 - 0.05, y0 + H - 0.05, 0, x0 + 0.05, y0 + H - 0.05, 0);
    } else {
      b.box(key, x0, y0, -0.06, x1, y0 + H, 0.06);
    }
  });
  const data = b.finish();
  const g = createBuildingObject(data, null, { name: 'material-board' });
  // 18 % grey card (linear albedo 0.18) and a 1.7 m figure for scale
  const n = panels.length, xg = n * (P + GAP);
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.02), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace), roughness: 1, metalness: 0 }));
  card.position.set(xg + 0.25, 1.25, 0); card.castShadow = card.receiveShadow = true; g.add(card);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 }));
  stand.position.set(xg + 0.25, 0.45, -0.03); g.add(stand);
  const fig = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98f73, roughness: 0.7 }), cloth = new THREE.MeshStandardMaterial({ color: 0x3d4f66, roughness: 0.9 }), cloth2 = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.9 });
  const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; fig.add(m); return m; };
  part(new THREE.CapsuleGeometry(0.075, 0.72, 4, 10), cloth2, -0.1, 0.44, 0); part(new THREE.CapsuleGeometry(0.075, 0.72, 4, 10), cloth2, 0.1, 0.44, 0);
  part(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), cloth, 0, 1.18, 0).scale.set(1.05, 1, 0.62);
  part(new THREE.CapsuleGeometry(0.05, 0.56, 4, 8), cloth, -0.25, 1.12, 0); part(new THREE.CapsuleGeometry(0.05, 0.56, 4, 8), cloth, 0.25, 1.12, 0);
  part(new THREE.SphereGeometry(0.105, 16, 12), skin, 0, 1.6, 0).scale.set(0.9, 1.08, 0.95);
  fig.position.set(xg + 1.1, 0, 0.35); g.add(fig);
  g.position.set(BOARD.x, groundH(BOARD.x, BOARD.z) + 0.1, BOARD.z);
  g.updateMatrixWorld(true);
  scene.add(g);
  return { group: g, width: xg + 1.5 };
}

// ---------------------------------------------------------------------------
// building management
// ---------------------------------------------------------------------------
let LOD = Q.get('lod') || 'exterior';
const ONLY = Q.get('only') === '1';
let focus = Math.max(0, Math.min(SPECS.length - 1, +(Q.get('b') || 0)));
const objs = new Map(); // id -> {group, data, lod}
const stats = { gen: {} };
let busy = 0;

async function loadBuilding(spec, lod) {
  busy++;
  try {
    const t0 = performance.now();
    const data = await pool.submit('building', { spec, lod }).promise;
    const old = objs.get(spec.id);
    if (old) { scene.remove(old.group); disposeBuildingObject(old.group); }
    const g = createBuildingObject(data, null, { name: spec.id });
    g.position.set(spec._world.x, spec._world.y, spec._world.z);
    g.rotation.y = spec._world.rot;
    g.updateMatrixWorld(true);
    scene.add(g);
    objs.set(spec.id, { group: g, data, lod });
    stats.gen[spec.id] = { lod, workerMs: +(data.__workerMs || 0).toFixed(1), genMs: data.stats.ms, roundTripMs: +(performance.now() - t0).toFixed(1), tris: data.stats.triangles, type: data.stats.type, err: data.stats.error ? data.stats.error.split('\n')[0] : undefined, col: data.stats.colliderTriangles };
    if (data.stats.error) console.warn('[bench]', spec.id, data.stats.error);
    setWire(wire);
  } finally { busy--; }
}

async function loadAll() {
  const list = ONLY ? [SPECS[focus]] : SPECS;
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
  const cam = (A.cameras || {})[view === 'yard' ? 'back' : view === 'interior' ? 'living' : view];
  switch (view) {
    case 'front': set([-w * 0.35, H * 0.45 + 2, d / 2 + R * 1.25 + 6], [0, H * 0.42, 0]); break;
    case 'back': set([w * 0.35, H * 0.45 + 2, -d / 2 - R * 1.25 - 6], [0, H * 0.42, 0]); break;
    case 'side': set([w / 2 + R * 1.2 + 6, H * 0.5 + 3, d * 0.3], [0, H * 0.4, 0]); break;
    case 'corner': set([w / 2 + R * 0.8, H * 0.6 + 4, d / 2 + R * 0.9], [0, H * 0.4, 0]); break;
    case 'roof': set([-w * 0.3, H + Math.max(14, R * 0.7), d / 2 + R * 0.55], [0, H - 1, 0]); break;
    case 'aerial': set([-w * 1.2, H + R * 1.4 + 20, d / 2 + R * 2.2 + 20], [0, H * 0.3, 0]); break;
    case 'detail': set([-w * 0.15, 3.2, d / 2 + 7.5], [-w * 0.05, 3.0, d / 2]); break;
    case 'plan': { const c = cut !== null ? cut : H * 0.5; set([0.01, c + Math.max(w, d) * 1.05 + 4, d * 0.32], [0, c - 2.5, 0]); break; }
    default:
      if (cam) set(cam.pos, cam.target);
      else set([-w * 0.35, H * 0.45 + 2, d / 2 + R * 1.25 + 6], [0, H * 0.42, 0]);
  }
  // cut-away for interior views
  fitShadow(spec);
}
// bench convenience: hide other buildings that really block the view of the framed building
// (camera inside their box, or the camera→target segment passes through their slightly shrunk box)
function hideOccluders(spec) {
  if (Q.get('nohide') === '1') { for (const [, o] of objs) o.group.visible = true; return; }
  const dir = controls.target.clone().sub(camera.position);
  const len = dir.length(); dir.normalize();
  const ray = new THREE.Ray(camera.position.clone(), dir), hit = new THREE.Vector3();
  for (const [id, o] of objs) {
    if (id === spec.id) { o.group.visible = true; continue; }
    const b = new THREE.Box3().setFromObject(o.group);
    const camInside = b.containsPoint(camera.position);
    const size = b.getSize(new THREE.Vector3());
    b.expandByVector(size.multiplyScalar(-0.04));
    const h = ray.intersectBox(b, hit);
    o.group.visible = !(camInside || (h && h.distanceTo(camera.position) < len * 0.92));
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
    `[L]od [C]ut [W]ire [N]ight [T]ime [ ] building  1-7 views`;
}
window.addEventListener('keydown', async (e) => {
  const k = e.key.toLowerCase();
  if (k === 'l') { LOD = LOD === 'mass' ? 'exterior' : LOD === 'exterior' ? 'full' : 'mass'; await loadBuilding(SPECS[focus], LOD); }
  if (k === 'c') { cut = cut === null ? 4.2 : cut > 30 ? null : cut + 3.1; applyCut(); }
  if (k === 'w') { wire = !wire; setWire(wire); }
  if (k === 'n') { night = !night; hour = night ? 21.5 : 11.0; applyTime(); }
  if (k === 't') { hour = (hour + 1) % 24; applyTime(); }
  if (k === ']' || k === '[') { focus = (focus + (k === ']' ? 1 : SPECS.length - 1)) % SPECS.length; if (!objs.has(SPECS[focus].id) || objs.get(SPECS[focus].id).lod !== LOD) await loadBuilding(SPECS[focus], LOD); frame('front'); }
  if (k === 'f') frame('front');
  const views = { 1: 'front', 2: 'back', 3: 'roof', 4: 'street', 5: 'entrance', 6: 'lobby', 7: 'living', 8: 'stair', 9: 'aerial' };
  if (views[k]) frame(views[k]);
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

// ---------------------------------------------------------------------------
// perf bench (?bench=1): 10-storey block in the worker, N runs per LOD
// ---------------------------------------------------------------------------
async function runBench() {
  const spec = SPECS.find((s) => s.id === 'R10-ZR1');
  const out = {};
  for (const lod of ['mass', 'exterior', 'full']) {
    const runs = [];
    for (let i = 0; i < 6; i++) { const d = await pool.submit('building', { spec, lod }).promise; runs.push({ ms: d.stats.ms, worker: d.__workerMs, tris: d.stats.triangles }); }
    runs.sort((a, b) => a.ms - b.ms);
    out[lod] = { medianGenMs: runs[3].ms, minGenMs: runs[0].ms, workerMs: +runs[3].worker.toFixed(1), tris: runs[0].tris };
  }
  console.log('[bench]', JSON.stringify(out));
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
let ready = false;
window.__MARS__ = {
  ready: true,   // shot.mjs then waits on waitIdle(), which resolves once everything is generated
  async waitIdle(ms = 60000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (ready && busy === 0) { await new Promise((r) => setTimeout(r, 300)); return true; } await new Promise((r) => setTimeout(r, 100)); } return false; },
  stats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, gen: stats.gen, bench: stats.bench, light: stats.light }; },
  frame, specs: SPECS, setLod: async (l) => { LOD = l; await loadBuilding(SPECS[focus], l); },
};

(async function main() {
  applyTime();
  buildGround();
  const texP = initBuildingMaterials(null, { workers: pool });
  await loadAll();
  await texP;
  if (Q.get('view') === 'board') {
    const bd = buildBoard();
    const cx = BOARD.x + bd.width / 2;
    camera.fov = +(Q.get('fov') || 32); camera.updateProjectionMatrix();
    camera.position.set(cx + 2.2, 1.75, BOARD.z + bd.width * 1.05 + 1.5); controls.target.set(cx + 0.4, 1.0, BOARD.z);
    controls.update();
    for (const [, o] of objs) o.group.visible = true;
    sun.position.set(cx, 0, BOARD.z).addScaledVector(sunVector(hour), 60); sun.target.position.set(cx, 0, BOARD.z);
    const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 140; sc.updateProjectionMatrix();
  } else frame(Q.get('view') || 'front');
  if (Q.get('cam') && Q.get('tgt')) {
    const spec = SPECS[focus];
    camera.position.copy(toWorld(spec, Q.get('cam').split(',').map(Number)));
    controls.target.copy(toWorld(spec, Q.get('tgt').split(',').map(Number)));
    controls.update(); hideOccluders(spec);
  }
  applyCut();
  if (Q.get('bench') === '1') stats.bench = await runBench();
  ready = true;
  updHud();
})();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready) updHud();
});
