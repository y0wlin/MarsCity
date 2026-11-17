// buildings-o dev bench: the 富氧改造区 water-works & agriculture family (sluice station, pump houses,
// meltwater pump, control towers, greenhouses, dorms, maintenance, cold storage, farm station, water
// treatment, service depots, insulated station) along a service street, with a bench canal behind the
// water-works lots (two levels at the sluice), a polar sector on snow, sun + sky light in the app's units.
// Keys: L = cycle LOD (mass/exterior/full)  C = cut-away  W = wireframe  N = night  T = +1 h
//       [ ] = prev/next building  F = frame  1..9 = views
// URL:  ?b=<index|id>&view=front|back|side|corner|roof|aerial|street|entrance|interior|plan|gate|detail
//       &lod=full&time=15&night=1&cut=5&wire=1&clean=1&only=1&bench=1&fov=50&cam=x,y,z&tgt=x,y,z (building frame)
// Exports O_LOTS / makeOSpec for node-side checks (no DOM work at import when there is no #c element).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildingObject, disposeBuildingObject, initBuildingMaterials, setBuildingLighting, getBuildingMaterial } from '../buildings/materials.js';

const R_PLANET = 3389500;
const LAT = 24;

// ---------------------------------------------------------------------------
// synthetic specs (shared with node checks)
// ---------------------------------------------------------------------------
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const PROV = { OX1: 1, OX2: 2, OX3: 3, OX4: 4, OX5: 5, OX6: 6, ZR1: 7 };
// canal behind the north (water-works) row: back facades at z = −BACK_Z, canal edge 3 m behind, width 18
export const CANAL = { backZ: 25, gap: 3, width: 18, up: -1.25, down: -3.4, down2: -5.6 };
const WATER_META = (extra = {}) => ({ water: { dist: CANAL.gap + CANAL.width / 2, width: CANAL.width }, ...extra });
// urban.js entrance set of the water works (specs.js makeEntrances: pumphouse / sluice / meltwater / water_treatment)
const WW = (w) => [['control', 'front', -w * 0.25, 1.4], ['main', 'front', w * 0.2, 1.2], ['equipment', 'right', 0, 3.6], ['maintenance', 'back', w * 0.2, 1.2]];
// side 'N' = north of the street facing south (heading 180), 'S' = south facing north (heading 0)
export const O_LOTS = [
  { id: 'SL-OX1', use: 'sluice_station', prov: 'OX1', side: 'N', gap: 9, w: 22, d: 14, floors: 2, fh: 4.5, roof: 'flat', rk: 'ceramic', meta: WATER_META({ canalId: 'c1', poolSide: 'back', sluice: { up: CANAL.up, down: CANAL.down }, controlRoom: 'upper' }), entrances: WW(22) },
  { id: 'PH-OX1', use: 'pumphouse', prov: 'OX1', side: 'N', w: 18, d: 14, floors: 2, fh: 4.5, roof: 'flat', rk: 'ceramic', meta: WATER_META({ canalId: 'c1', poolSide: 'back' }), entrances: WW(18) },
  { id: 'CT-OX1', use: 'control_tower', prov: 'OX1', side: 'N', w: 9, d: 9, floors: 5, fh: 3.6, shape: 'round', roof: 'flat', rk: 'ceramic' },
  { id: 'MT-OX3', use: 'maintenance', prov: 'OX3', side: 'N', w: 20, d: 12, floors: 1, fh: 4.5, roof: 'flat', rk: 'ceramic' },
  { id: 'DO-OX1', use: 'dorm', prov: 'OX1', side: 'N', w: 32, d: 13, floors: 3, fh: 3.1, gfh: 3.4, roof: 'flat', rk: 'ceramic' },
  { id: 'GH-OX1', use: 'greenhouse', prov: 'OX1', side: 'S', w: 10, d: 48, floors: 1, fh: 5.2, roof: 'gable', rk: 'glass', meta: { span: 10 }, entrances: [['main', 'front', 0, 2.4], ['service', 'back', 0, 3.2]] },
  { id: 'GH-OX5-multi', use: 'greenhouse', prov: 'OX5', side: 'S', w: 26, d: 40, floors: 1, fh: 5.5, roof: 'gable', rk: 'glass', meta: { span: 8.6 }, entrances: [['main', 'front', 0, 2.4], ['service', 'back', 0, 3.2]] },
  { id: 'PH-OX5-feed', use: 'pumphouse', prov: 'OX5', side: 'S', w: 12, d: 10, floors: 1, fh: 4.5, roof: 'flat', rk: 'ceramic', meta: { serves: 'greenhouses' }, entrances: [['main', 'front', -2.5, 1.4], ['service', 'right', 0, 3.6]] },
  { id: 'FS-OX1', use: 'farm_station', prov: 'OX1', side: 'S', w: 30, d: 22, floors: 2, fh: 4.5, roof: 'flat', rk: 'ceramic', entrances: [['main', 'front', -10, 1.2], ['loading', 'right', -5, 4.2], ['loading', 'right', 5, 4.2]] },
  { id: 'CS-OX1', use: 'cold_storage', prov: 'OX1', side: 'S', w: 46, d: 30, floors: 1, fh: 9, roof: 'flat', rk: 'metal', meta: { loadingSide: 'right' }, entrances: [['main', 'front', 16, 1.2], ['loading', 'right', -7.5, 4.2], ['loading', 'right', 7.5, 4.2]] },
  { id: 'WT-OX5', use: 'water_treatment', prov: 'OX5', side: 'S', w: 36, d: 24, floors: 1, fh: 5, roof: 'flat', rk: 'ceramic', entrances: WW(36) },
  { id: 'SD-OX2', use: 'service_depot', prov: 'OX2', side: 'S', w: 52, d: 34, floors: 1, fh: 9, roof: 'flat', rk: 'metal', entrances: [['main', 'front', 18, 1.2], ['loading', 'right', -8, 4.2], ['loading', 'right', 8, 4.2]] },
  { id: 'MT-OX2-big', use: 'maintenance', prov: 'OX2', side: 'S', w: 32, d: 20, floors: 2, fh: 5, roof: 'flat', rk: 'ceramic' },
  { id: 'PH-OX2-util', use: 'pumphouse', prov: 'OX2', side: 'S', w: 30, d: 20, floors: 2, fh: 5, roof: 'flat', rk: 'ceramic', meta: { poolSide: 'back', canalId: null }, entrances: WW(30) },
  { id: 'SD-OX1-halt', use: 'service_depot', prov: 'OX1', side: 'S', w: 40, d: 12, floors: 1, fh: 3.4, roof: 'canopy', rk: 'membrane', meta: { platformLength: 60, platformSide: 'back', trackHeading: 90 }, entrances: [['main', 'front', 14, 1.2], ['loading', 'right', 0, 4.2]] },
  { id: 'MT-OX1-works', use: 'maintenance', prov: 'OX1', side: 'N', w: 28, d: 13, floors: 3, fh: 3.1, gfh: 3.4, roof: 'flat', rk: 'ceramic' },
  { id: 'CT-OX5', use: 'control_tower', prov: 'OX5', side: 'S', w: 8, d: 8, floors: 4, fh: 4, shape: 'round', roof: 'flat', rk: 'ceramic' },
  // polar sector (OX4 / OX6) on snow; the polar sluice drops the bench canal a second time (−3.4 → −5.6 m)
  { id: 'SL-OX4-polar', use: 'sluice_station', prov: 'OX4', side: 'N', gap: 9, w: 20, d: 13, floors: 2, fh: 4.2, roof: 'flat', rk: 'insulated', style: 'O-polar', lat: 72, meta: WATER_META({ canalId: 'c2', poolSide: 'back', sluice: { up: CANAL.down, down: CANAL.down2, upSide: 'left' }, controlRoom: 'upper', polar: true }), entrances: WW(20) },
  { id: 'MP-OX4', use: 'meltwater_pump', prov: 'OX4', side: 'N', w: 18, d: 12, floors: 1, fh: 5, roof: 'flat', rk: 'insulated', style: 'O-polar', lat: 72, meta: WATER_META({ intakeSide: 'back', polar: true }), entrances: WW(18) },
  { id: 'GH-OX4-polar', use: 'greenhouse', prov: 'OX4', side: 'N', w: 38, d: 11, floors: 1, fh: 4.5, roof: 'gable', rk: 'glass', style: 'O-polar', lat: 72, meta: { polar: true, span: 11, lee: true }, entrances: [['main', 'front', 0, 2.4], ['service', 'back', 0, 3.2]] },
  { id: 'MP-OX4-feed', use: 'meltwater_pump', prov: 'OX4', side: 'N', w: 12, d: 10, floors: 1, fh: 4.5, roof: 'flat', rk: 'insulated', style: 'O-polar', lat: 72, meta: { serves: 'greenhouses', polar: true }, entrances: WW(12) },
  { id: 'IS-OX6', use: 'insulated_station', prov: 'OX6', side: 'S', w: 44, d: 28, floors: 2, fh: 3.6, gfh: 4, roof: 'vault', rk: 'insulated', style: 'O-polar', lat: -65, meta: { vestibule: true, leeSide: 'front', polar: true }, entrances: [['airlock', 'front', 0, 2.0], ['service', 'right', 0, 3.6]] },
  { id: 'SD-OX6-polar', use: 'service_depot', prov: 'OX6', side: 'S', w: 32, d: 22, floors: 1, fh: 6.5, roof: 'flat', rk: 'insulated', style: 'O-polar', lat: -65, meta: { vehicleBay: true, polar: true } },
  { id: 'DO-OX6-polar', use: 'dorm', prov: 'OX6', side: 'S', w: 26, d: 12, floors: 2, fh: 3.1, gfh: 3.4, roof: 'flat', rk: 'insulated', style: 'O-polar', lat: -65, meta: { polar: true } },
];
// x positions: north and south rows packed along the street, polar lots at the east end (x > POLAR_X)
export const POLAR_X = 260;
{
  let xn = -230, xs = -230, xpn = POLAR_X + 20, xps = POLAR_X + 20;
  for (const L of O_LOTS) {
    const polar = /OX4|OX6/.test(L.prov);
    const span = L.w + 16;
    if (L.side === 'N') { if (polar) { L.x = xpn + span / 2; xpn += span; } else { L.x = xn + span / 2; xn += span; } }
    else if (polar) { L.x = xps + span / 2; xps += span; } else { L.x = xs + span / 2; xs += span; }
  }
}

/** Bench canal level at x (east = downstream): steps at each sluice lot's x (its meta.sluice levels). */
export function canalLevelAt(x) {
  const sl = O_LOTS.filter((L) => L.use === 'sluice_station' && L.meta && L.meta.sluice).sort((a, c) => a.x - c.x);
  if (!sl.length) return CANAL.up;
  let lv = sl[0].meta.sluice.up;
  for (const L of sl) if (x > L.x) lv = L.meta.sluice.down;
  return lv;
}

/** spec.meta for a lot; water.dist = footprint centre → canal centreline, water.level = bench canal level there (urban fix 1). */
function metaOf(L) {
  const m = { roofKind: L.rk || 'ceramic', ...(L.meta || {}) };
  if (m.water) m.water = { ...m.water, dist: (L.gap ?? CANAL.gap) + CANAL.width / 2 + L.d / 2, level: m.sluice ? m.sluice.up : canalLevelAt(L.x) };
  return m;
}

/** BuildingSpec for a lot. groundFn(x, z) = terrain height at world (x, z). */
export function makeOSpec(L, groundFn = () => 0) {
  const hash = fnv(L.id);
  const heading = L.side === 'N' ? 180 : 0;
  const d = L.d, w = L.w;
  // north water-works lots: back facades aligned on the canal line
  // (per-lot quay gap L.gap: the sluice house keeps its gantry rail and control bay clear of each other)
  const setback = L.side === 'N' && L.meta && L.meta.water ? CANAL.backZ + CANAL.gap - (L.gap ?? CANAL.gap) - 9 - d : 3.0;
  const zc = L.side === 'N' ? -(9 + setback + d / 2) : (9 + setback + d / 2);
  const rot = (180 - heading) * Math.PI / 180;
  const loc = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  const c = Math.cos(rot), s = Math.sin(rot);
  const toW = ([x, z]) => [L.x + x * c + z * s, zc - x * s + z * c];
  const corners = loc.map((p) => { const q = toW(p); return groundFn(q[0], q[1]); });
  const ent = toW([0, d / 2 + 0.5]);
  const e = groundFn(ent[0], ent[1]);
  const def = /cold_storage|service_depot|farm_station/.test(L.use)
    ? [['main', 'front', w * 0.35 * ((hash & 1) ? -1 : 1), 1.2], ...Array.from({ length: Math.max(1, Math.floor(d / 14)) }, (_, k) => ['loading', 'right', -d / 2 + (k + 0.5) * (d / Math.max(1, Math.floor(d / 14))), 4.2])]
    : [['main', 'front', 0, 1.4], ['back', 'back', 0, 1.0]];
  const ents = (L.entrances || def).map(([kind, side, offset, width]) => ({ kind, side, offset, width }));
  const fp = { shape: L.shape || 'rect', w, d };
  return {
    id: L.id, hash, version: 1, use: L.use, province: PROV[L.prov] || 1, provinceCode: L.prov, zone: 'O', style: L.style || 'O-utility', tier: L.floors > 3 ? 'midrise' : 'lowrise',
    lat: L.lat ?? LAT, lon: 105, heading, ground: { entrance: e, min: Math.min(...corners, e), max: Math.max(...corners, e), corners },
    footprint: fp, floors: L.floors, floorHeight: L.fh, groundFloorHeight: L.gfh, basement: 0, roof: L.roof || 'flat',
    plot: { id: 'P-' + L.id }, block: 'K', district: 'D', neighbors: {}, sharedWalls: {},
    entrances: ents, occupancy: 0.7, yearBuilt: 2300 + (hash % 120), meta: metaOf(L),
    _world: { x: L.x, z: zc, rot, y: e },
  };
}

// ---------------------------------------------------------------------------
// everything below needs a page
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined' && document.getElementById('c')) main();

function main() {
  const Q = new URLSearchParams(location.search);

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

  // ---- renderer / scene ----
  const container = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
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

  // ---- lighting (same model + units as the kit bench / app) ----
  const SUN_E = 8.0, SUN_COLOR = [1.0, 0.955, 0.905];
  const TAU = [0.063, 0.143, 0.256];
  const GROUND_ALB = [0.26, 0.16, 0.11];
  const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  function sunTransmittance(el) {
    const deg = Math.asin(Math.max(-1, Math.min(1, el))) * 180 / Math.PI;
    if (deg < -1) return [0, 0, 0];
    const m = 1 / (Math.max(el, 0) + 0.15 * Math.pow(Math.max(deg, 0) + 3.885, -1.253));
    const disc = smoothstep(-0.9, 0.3, deg);
    return TAU.map((t) => Math.exp(-t * m) * disc);
  }
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
    vec3 Lg = vec3(0.26, 0.16, 0.11) * Eg / 3.14159265;
    L = mix(L, Lg, min(1.0, -d.y * 6.0));
  }
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
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), new THREE.ShaderMaterial({ uniforms: skyMat.uniforms, vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: SKY_GLSL + '\nvoid main(){ vec3 d = normalize(vDir); vec3 L = skyRad(d); L -= step(0.99996, dot(d, uSun)) * 8.0 * uT * 600.0; gl_FragColor = vec4(L, 1.0); }', side: THREE.BackSide })));
  const sun = new THREE.DirectionalLight(0xffffff, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  let hour = +(Q.get('time') || 10.5);
  let night = Q.get('night') === '1';
  if (night && !Q.get('time')) hour = 21.5;
  function sunVector(h, lat = LAT) {
    const dcl = 12 * Math.PI / 180, p = lat * Math.PI / 180, H = (h - 12) * 15 * Math.PI / 180;
    const east = -Math.cos(dcl) * Math.sin(H);
    const north = Math.sin(dcl) * Math.cos(p) - Math.cos(dcl) * Math.sin(p) * Math.cos(H);
    const up = Math.sin(dcl) * Math.sin(p) + Math.cos(dcl) * Math.cos(p) * Math.cos(H);
    return new THREE.Vector3(east, up, -north).normalize();
  }
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const stats = { gen: {} };
  let sunLat = LAT;
  function applyTime() {
    const s = sunVector(hour, sunLat);
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
    const Ekey = lum(sunE) * Math.max(el, 0) + lum(E);
    const expDay = 3.3 / Math.max(Ekey, 1e-4), expNight = 15;
    renderer.toneMappingExposure = (+(Q.get('exposure') || 1)) / (1 / expDay + 1 / expNight);
    setBuildingLighting({ sunDir: s, planetCenter: new THREE.Vector3(0, -R_PLANET, 0), localHour: hour, sunE: new THREE.Vector3(...sunE), skyE: new THREE.Vector3(...E) });
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.0);
    scene.environment = envRT.texture;
    stats.light = { el: +el.toFixed(3), exposure: +renderer.toneMappingExposure.toFixed(3) };
  }

  // ---- ground: street, sidewalks, red soil / snow, canal trench behind the north row ----
  const canalZ0 = -(CANAL.backZ + CANAL.gap + CANAL.width), canalZ1 = -(CANAL.backZ + CANAL.gap);
  function groundH(x, z) {
    let h = 0;
    // canal trench with near-vertical (quay) banks
    const dz = Math.max(canalZ0 - z, z - canalZ1, 0);
    if (dz < 0.5) h = -(x > POLAR_X ? 7.6 : 4.6) * (1 - dz / 0.5);
    // gentle rise behind the south row
    if (z > 70) h += (z - 70) * 0.05;
    return h;
  }
  const SPECS = O_LOTS.map((L) => makeOSpec(L, groundH));
  function buildGround() {
    const X0 = -280, X1 = POLAR_X + 340, Z0 = -90, Z1 = 120;
    const W = X1 - X0, Dd = Z1 - Z0, seg = 1.0;
    const g = new THREE.PlaneGeometry(W, Dd, Math.round(W / seg), Math.round(Dd / seg));
    g.rotateX(-Math.PI / 2);
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = groundH(x, z);
      p.setY(i, h - 0.02);
      const street = Math.abs(z) < 5, walk = Math.abs(z) < 9;
      const polar = x > POLAR_X;
      const n = 0.92 + 0.08 * Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.53 - x * 0.11);
      let c = street ? [0.13, 0.13, 0.135] : walk ? [0.62, 0.6, 0.57] : polar ? [0.86 * n, 0.88 * n, 0.92 * n] : [0.66 * n, 0.4 * n, 0.27 * n];
      if (h < -0.5) c = polar ? [0.5, 0.52, 0.55] : [0.45, 0.3, 0.22];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    const mesh = new THREE.Mesh(g, getBuildingMaterial('concrete', null));
    mesh.receiveShadow = true;
    scene.add(mesh);
    for (const z of [-7, 7]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 3.8), getBuildingMaterial('paving', null));
      sw.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sw.geometry.attributes.position.count * 3).fill(1), 3));
      const uv2 = sw.geometry.attributes.uv, pp = sw.geometry.attributes.position;
      for (let i = 0; i < uv2.count; i++) uv2.setXY(i, pp.getX(i), pp.getZ(i));
      sw.position.set((X0 + X1) / 2, 0.04, z); sw.receiveShadow = true; scene.add(sw);
    }
    // canal water: upstream level west of the sluice gate line, downstream east of it (bench stand-in for the water renderer)
    const water = new THREE.MeshPhysicalMaterial({ color: 0x0c3540, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.0, depthWrite: true });
    const mk = (xa, xb, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, CANAL.width + 2), water); m.rotation.x = -Math.PI / 2; m.position.set((xa + xb) / 2, y, (canalZ0 + canalZ1) / 2); scene.add(m); };
    // one reach per level: steps at every sluice lot's gate line (building x = 0)
    const gates = SPECS.filter((s) => s.use === 'sluice_station').map((s) => s._world.x).sort((a, c) => a - c);
    let xa = X0;
    for (const gx of gates) { mk(xa, gx - 0.1, canalLevelAt(gx - 1)); xa = gx + 0.1; }
    mk(xa, X1, canalLevelAt(X1));
    return mesh;
  }

  // ---- buildings ----
  let LOD = Q.get('lod') || 'exterior';
  const ONLY = Q.get('only') === '1';
  const bq = Q.get('b') || '0';
  let focus = isNaN(+bq) ? Math.max(0, SPECS.findIndex((s) => s.id === bq)) : Math.max(0, Math.min(SPECS.length - 1, +bq));
  const objs = new Map();
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
      stats.gen[spec.id] = { lod, use: spec.use, workerMs: +(data.__workerMs || 0).toFixed(1), genMs: data.stats.ms, roundTripMs: +(performance.now() - t0).toFixed(1), tris: data.stats.triangles, type: data.stats.type, err: data.stats.error ? data.stats.error.split('\n')[0] : undefined, col: data.stats.colliderTriangles };
      if (data.stats.error) console.warn('[bench]', spec.id, data.stats.error);
      setWire(wire);
    } finally { busy--; }
  }
  async function loadAll() {
    const list = ONLY ? [SPECS[focus]] : SPECS;
    await Promise.all(list.map((s) => loadBuilding(s, s === SPECS[focus] ? LOD : (LOD === 'full' ? 'exterior' : LOD))));
  }

  // ---- views ----
  function toWorld(spec, p) { const o = objs.get(spec.id); const v = new THREE.Vector3(...p); return o ? v.applyMatrix4(o.group.matrixWorld) : v; }
  let cut = Q.get('cut') ? +Q.get('cut') : null;
  function frame(view) {
    const spec = SPECS[focus];
    const o = objs.get(spec.id);
    if (!o) return;
    const b = o.data.bounds, A = o.data.anchors;
    const H = b.max[1], w = spec.footprint.w, d = spec.footprint.d;
    const R = Math.max(w, d, H);
    const set = (pos, tgt) => { camera.position.copy(toWorld(spec, pos)); controls.target.copy(toWorld(spec, tgt)); controls.update(); hideOccluders(spec); };
    const camKey = view === 'interior' ? (A.cameras && A.cameras.control ? 'control' : 'living') : view;
    const cam = (A.cameras || {})[camKey];
    switch (view) {
      case 'front': set([-w * 0.3, H * 0.4 + 2, d / 2 + R * 1.15 + 6], [0, H * 0.35, 0]); break;
      case 'back': set([w * 0.3, H * 0.45 + 3, b.min[2] - R * 1.1 - 6], [0, H * 0.3, (b.min[2] - d / 2) * 0.5]); break;
      case 'side': set([w / 2 + R * 1.15 + 6, H * 0.5 + 3, d * 0.2], [0, H * 0.35, 0]); break;
      case 'corner': set([w / 2 + R * 0.75 + 3, H * 0.55 + 4, d / 2 + R * 0.85 + 3], [0, H * 0.35, 0]); break;
      case 'backcorner': set([-w / 2 - R * 0.75 - 3, H * 0.6 + 5, b.min[2] - R * 0.7 - 3], [0, H * 0.3, (b.min[2] + b.max[2]) * 0.5]); break;
      case 'roof': set([-w * 0.3, H + Math.max(12, R * 0.65), d / 2 + R * 0.5], [0, H - 1, 0]); break;
      case 'aerial': set([-w * 1.1 - 10, H + R * 1.3 + 18, d / 2 + R * 1.8 + 16], [0, H * 0.25, (b.min[2] + b.max[2]) * 0.5]); break;
      case 'detail': set([-w * 0.12, 2.6, d / 2 + 6.5], [-w * 0.05, 2.2, d / 2]); break;
      case 'plan': { const c = cut !== null ? cut : H * 0.5; set([0.01, c + Math.max(w, d) * 1.05 + 4, d * 0.3], [0, c - 2.5, 0]); break; }
      default:
        if (cam) set(cam.pos, cam.target);
        else set([-w * 0.3, H * 0.4 + 2, d / 2 + R * 1.15 + 6], [0, H * 0.35, 0]);
    }
    fitShadow(spec);
  }
  function hideOccluders(spec) {
    const seg = new THREE.Line3(camera.position.clone(), controls.target.clone());
    const tmp = new THREE.Vector3();
    for (const [id, o] of objs) {
      if (id === spec.id) { o.group.visible = true; continue; }
      const bb = new THREE.Box3().setFromObject(o.group);
      const c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(tmp).length() * 0.5;
      const p = seg.closestPointToPoint(c, true, new THREE.Vector3());
      o.group.visible = !(bb.containsPoint(camera.position) || p.distanceTo(c) < r * 0.8);
    }
  }
  function fitShadow(spec) {
    const o = objs.get(spec.id); if (!o) return;
    const b = o.data.bounds;
    const c = toWorld(spec, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
    const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 0.5 + 25;
    const s = sunVector(hour, sunLat);
    sun.position.copy(c).addScaledVector(s, r * 2);
    sun.target.position.copy(c);
    const sc = sun.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = r * 4;
    sc.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }
  let wire = Q.get('wire') === '1';
  function setWire(v) { scene.traverse((o) => { if (o.isMesh && o.material && o.material.name?.startsWith('bk:')) o.material.wireframe = v; }); }
  function applyCut() {
    if (cut === null) { renderer.clippingPlanes = []; return; }
    const spec = SPECS[focus];
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), spec._world.y + cut)];
  }

  // ---- HUD + keys ----
  const hud = document.getElementById('hud');
  function updHud() {
    const spec = SPECS[focus], g = stats.gen[spec.id] || {};
    const info = renderer.info;
    hud.innerHTML = `<b>${spec.id}</b> use=${spec.use} ${spec.footprint.w}×${spec.footprint.d} floors=${spec.floors} prov=${spec.provinceCode}\n` +
      `LOD <b>${LOD}</b> type=${g.type} worker ${g.workerMs}ms gen ${g.genMs}ms tris ${g.tris} ${g.col ? 'col ' + g.col : ''} ${g.err ? 'ERR ' + g.err : ''}\n` +
      `time ${hour.toFixed(1)}h  draw ${info.render.calls} tris ${info.render.triangles}\n[L]od [C]ut [W]ire [N]ight [T]ime [ ] building  1-9 views`;
  }
  window.addEventListener('keydown', async (e) => {
    const k = e.key.toLowerCase();
    if (k === 'l') { LOD = LOD === 'mass' ? 'exterior' : LOD === 'exterior' ? 'full' : 'mass'; await loadBuilding(SPECS[focus], LOD); }
    if (k === 'c') { cut = cut === null ? 3.0 : cut > 24 ? null : cut + 2.5; applyCut(); }
    if (k === 'w') { wire = !wire; setWire(wire); }
    if (k === 'n') { night = !night; hour = night ? 21.5 : 10.5; applyTime(); }
    if (k === 't') { hour = (hour + 1) % 24; applyTime(); }
    if (k === ']' || k === '[') { focus = (focus + (k === ']' ? 1 : SPECS.length - 1)) % SPECS.length; if (!objs.has(SPECS[focus].id) || objs.get(SPECS[focus].id).lod !== LOD) await loadBuilding(SPECS[focus], LOD); frame('corner'); }
    if (k === 'f') frame('front');
    const views = { 1: 'front', 2: 'back', 3: 'roof', 4: 'street', 5: 'entrance', 6: 'interior', 7: 'side', 8: 'corner', 9: 'aerial' };
    if (views[k]) frame(views[k]);
  });
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

  // ---- perf bench: every lot × LOD in the worker (median of 3) ----
  async function runBench() {
    const out = {};
    for (const spec of SPECS) {
      out[spec.id] = {};
      for (const lod of ['mass', 'exterior', 'full']) {
        const runs = [];
        for (let i = 0; i < 3; i++) { const d = await pool.submit('building', { spec, lod }).promise; runs.push({ ms: d.stats.ms, tris: d.stats.triangles, col: d.stats.colliderTriangles || 0, type: d.stats.type }); }
        runs.sort((a, b) => a.ms - b.ms);
        out[spec.id][lod] = { ms: runs[1].ms, tris: runs[1].tris, col: runs[1].col, type: runs[1].type };
      }
    }
    console.log('[bench]', JSON.stringify(out));
    return out;
  }

  let ready = false;
  window.__MARS__ = {
    ready: true,
    async waitIdle(ms = 60000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (ready && busy === 0) { await new Promise((r) => setTimeout(r, 300)); return true; } await new Promise((r) => setTimeout(r, 100)); } return false; },
    stats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, gen: stats.gen, bench: stats.bench, light: stats.light }; },
    frame, specs: SPECS, setLod: async (l) => { LOD = l; await loadBuilding(SPECS[focus], l); },
  };
  (async function run() {
    sunLat = SPECS[focus].lat ?? LAT;
    applyTime();
    buildGround();
    const texP = initBuildingMaterials(null, { workers: pool });
    await loadAll();
    await texP;
    frame(Q.get('view') || 'corner');
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
}
