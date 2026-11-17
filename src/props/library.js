// Geometry library + impostor atlas bake. OWNER: props agent.
// Builds every procedural model once (main thread) and bakes a 4x2 impostor atlas of the tree
// species (unlit albedo incl. the crown AO tint) with the app renderer.
import * as THREE from 'three';
import * as M from './models.js';
import { HUMAN_TYPES, buildHuman, makeHumanAtlas, makeOutfitPalette, SKIN_TONES, HAIR_TONES } from './humans.js';
import { humanMaterial, humanDepthMaterial } from './materials.js';

export const IMP_COLS = 4, IMP_ROWS = 2, IMP_RES = 512;

/** leaf geometries: pack the card-normal extras (cnx, cny, cnz) into one vec3 attribute aCardN */
function packCardN(g) {
  const x = g.getAttribute('cnx'), y = g.getAttribute('cny'), z = g.getAttribute('cnz');
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = x ? x.array[i] : 0; a[i * 3 + 1] = y ? y.array[i] : 1; a[i * 3 + 2] = z ? z.array[i] : 0; if (!x || (a[i * 3] === 0 && a[i * 3 + 1] === 0 && a[i * 3 + 2] === 0)) a[i * 3 + 1] = 1; }
  g.deleteAttribute('cnx'); g.deleteAttribute('cny'); g.deleteAttribute('cnz');
  g.setAttribute('aCardN', new THREE.Float32BufferAttribute(a, 3));
  return g;
}

export class PropsLibrary {
  constructor(app, mats) {
    this.app = app; this.mats = mats;
    this.trees = [];            // [species][lod] -> {bark, core, leaf: BufferGeometry, H, crownR}
    this.impCell = [];          // [species] -> {u0, v0, size (m, square cell)}
    this.ready = false;
  }

  build() {
    for (let s = 0; s < M.SPECIES.length; s++) {
      const lods = [];
      for (let l = 0; l < 2; l++) {
        const t = M.buildTree(s, 0, l);
        lods.push({ bark: t.bark.build(), core: t.core.build(), leaf: packCardN(t.leaf.build()), H: t.H, crownR: t.crownR });
      }
      this.trees.push(lods);
    }
    this.shrubs = [0, 1, 2].map((k) => { const s = M.buildShrub(k); return { core: s.core.build(), leaf: packCardN(s.leaf.build()) }; });
    this.lamps = M.LAMP_MODELS.map((_, i) => { const l = M.buildLamp(i); return { metal: l.pole.build(), paint: l.housing.build(), lampHead: l.lens.build(), H: l.H, headY: l.headY, armX: l.armX }; });
    const b = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v && v.build) r[k] = v.build(); else r[k] = v; return r; };
    this.furniture = [b(M.buildBench()), b(M.buildBollard()), b(M.buildBikeRack()), b(M.buildPlanter()), b(M.buildBin()), b(M.buildShelter())];
    this.people = [0, 1, 2, 3].map((v) => b(M.buildPerson(v)));       // legacy figures (old bench only)
    this.humans = null;                 // built by buildHumans() (async in the app: progressive load)
    this.trainCab = b(M.buildTrainCar(true));
    this.trainMid = b(M.buildTrainCar(false));
    this.boats = { ferry: b(M.buildFerry()), tug: b(M.buildTug()), launch: b(M.buildLaunch()), cargo: b(M.buildCargoShip()) };
    this.landing = b(M.buildLanding());
    this.airTaxi = b(M.buildAirTaxi());
    { const T = M.buildLandingTower(); this.landingTower = { shaft: b(T.shaft), head: b(T.head), bridge: b(T.bridge) }; }
    this.vehicles = [b(M.buildCar()), b(M.buildVan()), b(M.buildRover())];
    this.impQuad = M.impostorQuad();
    this.sprite = M.spriteQuad();
    this.pool = M.poolQuad();
    this.bakeImpostors();
    this.ready = true;
  }

  /**
   * Game-grade pedestrians (humans.js): body types × 3 LODs, one material (+ shadow depth) per type.
   * sync = false (app): one body type per macrotask so the page stays responsive while loading.
   */
  buildHumans(sync = false) {
    const one = (ti, shared) => {
      const T = HUMAN_TYPES[ti];
      const l0 = buildHuman(ti, 0);
      const lods = [l0.geometry, buildHuman(ti, 1).geometry, buildHuman(ti, 2).geometry];
      const ky = T.H / 1.75;
      const material = humanMaterial(this.app, l0.joints, ky, shared);
      // registered with the props materials: distance fade (+ snap while still), wireframe / debug
      this.mats.m['human:' + T.id] = material;
      this.mats.setFade('human:' + T.id, -2, -1, 270, 320);
      return { id: T.id, H: T.H, lods, joints: l0.joints, material, depth: humanDepthMaterial(l0.joints, ky, shared) };
    };
    const mkShared = () => ({ pal: makeOutfitPalette(), atlas: makeHumanAtlas(), skin: SKIN_TONES.map((c) => new THREE.Vector3(...c)), hair: HAIR_TONES.map((c) => new THREE.Vector3(...c)) });
    if (sync) {
      const shared = mkShared();
      this.humanShared = shared;
      this.humans = HUMAN_TYPES.map((_, ti) => one(ti, shared));
      return Promise.resolve(this.humans);
    }
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return (async () => {
      await tick();
      const shared = mkShared();
      this.humanShared = shared;
      const out = [];
      for (let ti = 0; ti < HUMAN_TYPES.length; ti++) { await tick(); out.push(one(ti, shared)); }
      this.humans = out;
      return out;
    })();
  }

  bakeImpostors() {
    const r = this.app.renderer;
    const W = IMP_COLS * IMP_RES, H = IMP_ROWS * IMP_RES;
    // render targets receive linear (working colour space) output -> half float, no sRGB decode
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 4 });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.anisotropy = 8;
    const scene = new THREE.Scene();
    const T = this.mats.tex;
    const leafM = new THREE.MeshBasicMaterial({ map: T.leaf, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide });
    const barkM = new THREE.MeshBasicMaterial({ map: T.bark, vertexColors: true });
    const coreM = new THREE.MeshBasicMaterial({ vertexColors: true });
    const prevRT = r.getRenderTarget();
    const prevClear = new THREE.Color(); r.getClearColor(prevClear); const prevAlpha = r.getClearAlpha();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(rt);
    r.setClearColor(new THREE.Color(0.11, 0.16, 0.07), 0);
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H); r.setRenderTarget(rt);
    r.clear(true, true, false);
    for (let s = 0; s < this.trees.length; s++) {
      const t = this.trees[s][0];
      const size = Math.max(2 * t.crownR * 1.12 + 0.6, t.H + 0.6);
      const col = s % IMP_COLS, row = Math.floor(s / IMP_COLS);
      this.impCell[s] = { u0: col / IMP_COLS, v0: row / IMP_ROWS, size };
      scene.clear();
      for (const [g, m] of [[t.bark, barkM], [t.core, coreM], [t.leaf, leafM]]) scene.add(new THREE.Mesh(g, m));
      const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size, 0, -50, 50);
      cam.position.set(0, 0, 20); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
      rt.viewport.set(col * IMP_RES, row * IMP_RES, IMP_RES, IMP_RES);
      rt.scissor.set(col * IMP_RES, row * IMP_RES, IMP_RES, IMP_RES); rt.scissorTest = true;
      r.setRenderTarget(rt);
      r.render(scene, cam);
    }
    rt.scissorTest = false;
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
    leafM.dispose(); barkM.dispose(); coreM.dispose();
    this.impRT = rt;
    const im = this.mats.get('impostor');
    im.map = rt.texture;
    im.userData.uImpCell.value.set(1 / IMP_COLS, 1 / IMP_ROWS);
    im.needsUpdate = true;
  }
}
