// Props bench (owner: props): every procedural prop model in a row on a flat paved ground, sun + sky
// light approximating the app's units (AgX, exposure 0.45, emissive × 0.05), orbit camera.
// Rows: trees (LOD0 / LOD1 / impostor per species), shrubs, lamps, furniture, people, road vehicles,
// a train set on a track, boats on a water plane.
// URL: ?view=trees|street|people|train|boats|lamps|all  &night=1  &sun=<elevation deg>  &az=<deg>
//      &cam=x,y,z&tgt=x,y,z  &fov=40  &clean=1  &wire=1
// Keys: N night toggle, 1..7 views.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PropsMaterials, PROPS_UNIFORMS } from '../props/materials.js';
import { PropsLibrary } from '../props/library.js';
import { SPECIES, LAMP_MODELS } from '../props/models.js';

const Q = new URLSearchParams(location.search);
const container = document.getElementById('c');
const hud = document.getElementById('hud');
if (Q.get('clean') === '1') document.body.classList.add('clean');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(+(Q.get('fov') || 40), window.innerWidth / window.innerHeight, 0.05, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---- lighting (app units: sun 8 × transmittance, blue sky / red ground ambient, emissive × 0.05) ----
const nightMats = [];
let night = Q.get('night') === '1' ? 1 : 0;
const mockApp = {
  renderer,
  lighting: {
    uniforms: { uLpEmissiveScale: { value: 0.05 } },
    patch(m, opts = {}) {
      if (m.emissive) { m.userData.benchEmissive = m.emissiveIntensity * 0.05; m.userData.benchNight = !!opts.nightEmissive; nightMats.push(m); }
      return m;
    },
  },
};
const sun = new THREE.DirectionalLight(0xfff4e6, 7.0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
const sc = sun.shadow.camera; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 600;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(new THREE.Color(0.32, 0.46, 0.78), new THREE.Color(0.30, 0.2, 0.14), 1.6);
scene.add(hemi);
function setSun() {
  const el = (night ? -12 : +(Q.get('sun') || 38)) * Math.PI / 180, az = +(Q.get('az') || 140) * Math.PI / 180;
  sun.position.set(Math.sin(az) * Math.cos(el) * 300, Math.sin(el) * 300, -Math.cos(az) * Math.cos(el) * 300);
  sun.intensity = night ? 0 : 7.0 * Math.min(1, Math.max(0, Math.sin(el) * 3));
  hemi.intensity = night ? 0.025 : 1.6;
  scene.background = night ? new THREE.Color(0.004, 0.006, 0.012) : new THREE.Color(0.30, 0.48, 0.85);
  for (const m of nightMats) m.emissiveIntensity = m.userData.benchEmissive * (m.userData.benchNight ? night : 1);
  mats.glow.uniforms.uNight.value = night; mats.pool.uniforms.uNight.value = night;
}

// ---- ground + water ----
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }));
ground.receiveShadow = true; scene.add(ground);
const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 260).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0d3550, roughness: 0.08, metalness: 0.2 }));
water.position.set(0, 0.02, -260); water.receiveShadow = true; scene.add(water);

// ---- props ----
const mats = new PropsMaterials(mockApp);
const lib = new PropsLibrary(mockApp, mats);
lib.build();
mats.setFade('impostor', -2, -1, 1e9, 2e9);
for (const k of ['shrubLeaf', 'shrubCore', 'metal', 'paint', 'wood', 'ceramic', 'glassFurn', 'lampHead', 'people']) mats.setFade(k, -2, -1, 1e9, 2e9);
if (Q.get('wire') === '1') mats.setWireframe(true);

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
function inst(geo, mat, list, opts = {}) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.setIndex(geo.getIndex());
  const n = list.length;
  if (opts.fade) g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
  for (const [k, [size, fill]] of Object.entries(opts.attrs || {})) g.setAttribute(k, new THREE.InstancedBufferAttribute(fill(n, size), size));
  const m = new THREE.InstancedMesh(g, mat, n);
  list.forEach(([x, y, z, rot = 0, s = 1], i) => { q.setFromAxisAngle(Y, rot); s3.setScalar(s); p3.set(x, y, z); m4.compose(p3, q, s3); m.setMatrixAt(i, m4); });
  if (opts.color) list.forEach((_, i) => m.setColorAt(i, opts.color(i)));
  m.castShadow = opts.cast !== false; m.receiveShadow = true; m.frustumCulled = false;
  scene.add(m);
  return m;
}
const white = () => new THREE.Color(1, 1, 1);
// trees: species along x, LOD0 z=0, LOD1 z=14, impostor z=28
const spX = (s) => -45 + s * 16;
for (let s = 0; s < SPECIES.length; s++) {
  for (let l = 0; l < 2; l++) {
    const G = lib.trees[s][l];
    for (const k of ['bark', 'core', 'leaf']) {
      const m = inst(G[k], mats.get(k), [[spX(s), 0, l * 14, 0.4 * s, 1]], { fade: true, color: k === 'bark' ? white : () => new THREE.Color(1, 1, 1) });
      if (k === 'leaf') m.customDepthMaterial = mats.depth.leaf;
    }
  }
  const cell = lib.impCell[s];
  inst(lib.impQuad, mats.get('impostor'), [[spX(s), -0.05, 28, 0, cell.size]], { cast: false, color: white, attrs: { aImp: [4, (n, sz) => { const a = new Float32Array(n * sz); a[0] = cell.u0; a[1] = cell.v0; a[2] = 0.5; return a; }] } });
}
// a street-tree row (species 0) along z = 46 for a boulevard feel
inst(lib.trees[0][0].bark, mats.get('bark'), Array.from({ length: 10 }, (_, i) => [-45 + i * 8, 0, 46, i * 1.7, 0.9 + (i % 3) * 0.08]), { fade: true, color: white });
inst(lib.trees[0][0].core, mats.get('core'), Array.from({ length: 10 }, (_, i) => [-45 + i * 8, 0, 46, i * 1.7, 0.9 + (i % 3) * 0.08]), { fade: true, color: white });
inst(lib.trees[0][0].leaf, mats.get('leaf'), Array.from({ length: 10 }, (_, i) => [-45 + i * 8, 0, 46, i * 1.7, 0.9 + (i % 3) * 0.08]), { fade: true, color: white }).customDepthMaterial = mats.depth.leaf;
// shrubs
for (let k = 0; k < 3; k++) {
  const S = lib.shrubs[k];
  const list = [[-45 + k * 4, 0, 38, k, 1], [-43 + k * 4, 0, 39.5, k + 2, 0.8]];
  inst(S.core, mats.get('shrubCore'), list);
  inst(S.leaf, mats.get('shrubLeaf'), list).customDepthMaterial = mats.depth.shrub;
}
// lamps along x at z = 60
LAMP_MODELS.forEach((_, i) => { const G = lib.lamps[i]; for (const k of ['metal', 'paint', 'lampHead']) inst(G[k], mats.get(k), [[-45 + i * 9, 0, 60, Math.PI, 1]], { cast: k !== 'lampHead' }); });
// glows / pools at the lamp heads
{
  const pts = LAMP_MODELS.map((M, i) => { const G = lib.lamps[i]; return [-45 + i * 9, G.headY - 0.12, 60 - (M.post ? 0 : G.armX + 0.25), G.H]; });
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', lib.sprite.getAttribute('position')); gg.setIndex(lib.sprite.getIndex());
  gg.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(pts.flatMap(() => [60, 48, 34, 0.45])), 4));
  const gm = new THREE.InstancedMesh(gg, mats.glow, pts.length);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', lib.pool.getAttribute('position')); pg.setIndex(lib.pool.getIndex());
  pg.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(pts.flatMap((p) => [2.4, 1.9, 1.35, p[3] * 1.05])), 4));
  const pm = new THREE.InstancedMesh(pg, mats.pool, pts.length);
  pts.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); gm.setMatrixAt(i, m4); m4.makeTranslation(p[0], 0.06, p[2]); pm.setMatrixAt(i, m4); });
  gm.frustumCulled = pm.frustumCulled = false; gm.renderOrder = 5; pm.renderOrder = 4;
  scene.add(gm, pm);
}
// furniture at z = 70
lib.furniture.forEach((parts, k) => { for (const [mk, geo] of Object.entries(parts)) if (geo && geo.isBufferGeometry) inst(geo, mats.get(mk), [[-45 + k * 6, 0, 70, 0, 1]], { cast: mk !== 'glassFurn' }); });
// people at z = 78 (walking + standing), four variants
{
  const SH = [[0.82, 0.83, 0.84], [0.12, 0.17, 0.26], [0.55, 0.12, 0.1], [0.62, 0.55, 0.42], [0.2, 0.34, 0.3], [0.85, 0.66, 0.25]];
  const PA = [[0.1, 0.11, 0.13], [0.22, 0.25, 0.32], [0.45, 0.4, 0.33], [0.6, 0.6, 0.6]];
  lib.people.forEach((P, v) => {
    const list = Array.from({ length: 6 }, (_, i) => [-45 + v * 7 + (i % 3) * 1.6, 0, 78 + Math.floor(i / 3) * 2, i * 1.1, i === 5 ? 0.72 : 0.95 + (i % 3) * 0.05]);
    inst(P.people, mats.get('people'), list, { attrs: {
      aWalk: [2, (n) => { const a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = i * 1.3; a[i * 2 + 1] = i < 3 ? 1 : 0; } return a; }],
      aShirt: [3, (n) => new Float32Array(Array.from({ length: n }, (_, i) => SH[(i + v * 2) % SH.length]).flat())],
      aPants: [3, (n) => new Float32Array(Array.from({ length: n }, (_, i) => PA[(i + v) % PA.length]).flat())],
    } });
  });
}
// road vehicles at z = 88
lib.vehicles.forEach((parts, k) => { for (const [mk, geo] of Object.entries(parts)) if (geo && geo.isBufferGeometry) inst(geo, mats.get(mk), [[-45 + k * 7, 0, 88, 0.3, 1]], { cast: mk !== 'headlight' && mk !== 'taillight', color: mk === 'carBody' ? () => new THREE.Color(0.6, 0.65, 0.7) : undefined }); });
// train: 5 cars on a track along x at z = 104, rail head at y = 0.77 on a ballast bed
{
  const bed = new THREE.Mesh(new THREE.BoxGeometry(160, 0.45, 4.2), new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 1 }));
  bed.position.set(10, 0.225, 104); bed.receiveShadow = true; scene.add(bed);
  for (const s of [-0.7175, 0.7175]) { const r = new THREE.Mesh(new THREE.BoxGeometry(160, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.8, roughness: 0.35 })); r.position.set(10, 0.69, 104 + s); scene.add(r); }
  const n = 5;
  for (let j = 0; j < n; j++) {
    const cab = j === 0 || j === n - 1;
    const G = cab ? lib.trainCab : lib.trainMid;
    const x = -40 + j * 25;
    const rot = j === n - 1 ? -Math.PI / 2 : Math.PI / 2;     // model +z = travel; train runs towards -x
    for (const k of ['trainBody', 'trainGlass', 'dark']) inst(G[k], mats.get(k), [[x, 0.77, 104, j === 0 ? -Math.PI / 2 : rot]]);
    if (cab) { inst(G.headlight, mats.get(j === 0 ? 'headlight' : 'taillight'), [[x, 0.77, 104, j === 0 ? -Math.PI / 2 : rot]], { cast: false }); }
  }
}
// boats on the water at z = -180 .. -330
{
  const B = lib.boats;
  const place = [['ferry', -80, -180, 0.3], ['tug', 0, -170, 1.2], ['launch', 30, -165, 2.2], ['cargo', -40, -260, 1.57]];
  for (const [type, x, z, rot] of place) for (const [k, geo] of Object.entries(B[type])) if (geo && geo.isBufferGeometry) inst(geo, mats.get(k), [[x, 0, z, rot]], { cast: !k.startsWith('nav') });
}

// ---- views ----
const VIEWS = {
  trees: [[-5, 6, -22], [-5, 5, 10]],
  street: [[-38, 1.65, 40], [10, 5, 50]],
  lamps: [[-20, 3, 50], [-20, 5, 62]],
  people: [[-30, 1.7, 72], [-32, 1, 79]],
  train: [[-55, 4, 92], [-30, 2, 104]],
  boats: [[-20, 14, -110], [-40, 3, -200]],
  all: [[-120, 70, 140], [0, 0, 40]],
};
function setView(name) {
  const v = VIEWS[name] || VIEWS.trees;
  camera.position.set(...v[0]); controls.target.set(...v[1]); controls.update();
}
const cam = Q.get('cam'), tgt = Q.get('tgt');
if (cam && tgt) { camera.position.set(...cam.split(',').map(Number)); controls.target.set(...tgt.split(',').map(Number)); controls.update(); }
else setView(Q.get('view') || 'trees');
setSun();
window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') { night = 1 - night; setSun(); }
  const names = Object.keys(VIEWS); const i = +e.key - 1; if (i >= 0 && i < names.length) setView(names[i]);
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

let frame = 0;
function tick() {
  frame++;
  controls.update();
  PROPS_UNIFORMS.uPropsTime.value = 0;
  mats.glow.uniforms.uViewH.value = renderer.domElement.height;
  mats.glow.uniforms.uTanHalf.value = Math.tan(camera.fov * Math.PI / 360);
  renderer.render(scene, camera);
  if (frame % 30 === 1) hud.textContent = `props bench  view=${Q.get('view') || 'trees'}  night=${night}\ncalls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
  requestAnimationFrame(tick);
}
tick();
window.__MARS__ = { ready: true, async waitIdle() { await new Promise((r) => setTimeout(r, 800)); return true; }, stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) };
