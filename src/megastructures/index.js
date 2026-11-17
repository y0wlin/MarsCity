// Megastructures: G01 东海分段潮堤 (segmented tidal barrier, ZR1) and G02 南台地水阶 (six-level
// water stairs, OX5) — prompt §1 / §3 / §5 shots 08 & 09. OWNER: megastructure agent.
//
// CONTRACT (ARCHITECTURE.md §8 mega; used by controls / ui / water / city)
//   init(), update(frame), isIdle()   isIdle is false while the layout, the surface textures or any
//                                     wanted LOD of a chunk are still loading
//   raycast(originRender:Vector3, dirRender:Vector3)
//       -> {type:'mega', id:'G01'|'G02', part (readable Chinese name), partId, chunk, lod, distance,
//           point:Vector3 (render space)} | null
//   getColliders(nearEcef, radius) -> [{mesh (geometry.boundsTree = MeshBVH), anchorEcef, quaternion, id}]
//       walkable crests / decks / walkways / stairs of the displayed LOD around the point; requests the
//       'near' LOD (walkway grating, railings, ladders) for chunks around the point (a few frames later)
//   spillways() -> [{id, damId, dam, bay, open, ecef, dirEcef, width, flow (m³/s), level (reservoir),
//       tailLevel, crestLevel, across (m along the dam axis a→b from its midpoint), lat, lon}]
//       G02 spillway outlets (end of each chute) for the water renderer's foam / tailwater.
//   gateStates() -> {'G02-D1': [open per bay, bay order of spillways()], ...}  (same at every LOD)
//   towns() -> [{id, lat, lon, y, radius, ecef}]      G02 work-town anchors (for the city engineer)
//   views() -> {name: pose}                           shot 08 / 09 camera poses (lat, lon, alt, heading, pitch, lens)
//   info(id) -> {id, name, centerEcef, radius}        'G01' | 'G02'
//   debugStats()
// LOD: every chunk has 'far' (silhouette, always resident), 'mid' (engineering units) and 'near'
//   (walkways, railings, bolts, armour rocks...) chosen by surface distance against the projected
//   size (K = pixels per radian); near replaces mid with identical shared geometry.
// settings.debugLayer: 'objectId' (one colour per chunk), 'wireframe', 'lod' (far blue / mid green /
//   near orange); nothing extra is drawn when settings.clean.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { R } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { getControlMaps } from '../data/controlMaps.js';
import { SITES, localToLatLon } from '../world/sites.js';
import { siteQuaternion, siteToEcef, siteDirToEcef } from './frame.js';
import { MegaMaterials } from './materials.js';
import { G01OrbitLine } from './orbitline.js';

export const MEGA_CFG = {
  workers: 3,
  nearK: 0.8,          // near LOD when the surface distance < nearK * K (K = px per radian)
  nearMin: 650, nearMax: 2600,
  midK: 9,             // mid LOD when the surface distance < midK * K
  midMin: 5000, midMax: 30000,
  uploadMs: 8,         // main-thread budget per frame for new chunk objects
  keepNear: 240,       // frames a hidden near LOD stays resident
  keepMid: 1800,
};

const LODS = ['far', 'mid', 'near'];
const PREF = { near: ['near', 'mid', 'far'], mid: ['mid', 'near', 'far'], far: ['far', 'mid', 'near'] };
const TRANSPARENT = { mega_lightpool: 3, mega_lightpool_cool: 3, glass_clear: 2, glass_railing: 2 };
const SITE = { G01: SITES.tidalBarrier, G02: SITES.waterStairs };
const DEG = Math.PI / 180;

const _ray = new THREE.Ray(), _lr = new THREE.Ray(), _sph = new THREE.Sphere(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------------------------------------
// private worker pool (mega.worker.js) — no registration in workers/handlers needed
// ---------------------------------------------------------------------------------------------
class MegaWorkers {
  constructor(n) { this.n = n; this.workers = []; this.queue = []; this.nextId = 1; this.waiting = new Map(); this.alive = 0; this.layout = null; }
  /**
   * Start the workers. Worker 0 installs the control maps and computes the terrain-keyed layout
   * (the terrain's coast rasters cost ~12 s on a thread's first heightAt calls); the others start
   * empty (chunk generation never samples the terrain), make textures meanwhile and receive the
   * layout as soon as it exists. Resolves with the layout (rejects when worker 0 fails).
   */
  start(maps) {
    for (let i = 0; i < this.n; i++) {
      let w;
      try { w = new Worker(new URL('./mega.worker.js', import.meta.url), { type: 'module', name: `mega-${i}` }); } catch (e) { console.warn('[mega] worker unavailable', e); break; }
      w.busy = true; w.dead = false; w.hasLayout = false;
      w.onmessage = (e) => this._onMessage(e.data);
      w.onerror = (e) => {
        console.error('[mega worker]', e.message || e);
        w.dead = true;
        for (const [id, h] of this.waiting) if (h.w === w) { this.waiting.delete(id); h.reject(new Error('mega worker died')); }
      };
      this.workers.push(w);
    }
    if (!this.workers.length) return Promise.reject(new Error('no workers'));
    const [w0, ...rest] = this.workers;
    for (const w of rest) this._send(w, 'init', {}).then(() => { w.busy = false; this.alive++; this._pump(); }, () => { w.dead = true; });
    return this._send(w0, 'init', { maps, compute: true }).then((L) => {
      w0.busy = false; w0.hasLayout = true; this.alive++;
      this.layout = L;
      for (const w of rest) {
        if (w.dead) continue;
        // queued behind its current job (if any): the worker only takes chunk jobs once installed
        const install = () => this._send(w, 'layout', { layout: L }).then(() => { w.hasLayout = true; w.busy = false; this._pump(); }, () => { w.dead = true; });
        if (!w.busy) { w.busy = true; install(); } else w.pendingInstall = install;
      }
      this._pump();
      return L;
    });
  }
  _send(w, type, payload) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject, w }); w.postMessage({ id, type, payload }); });
  }
  _onMessage(msg) {
    const h = this.waiting.get(msg.id);
    if (!h) return;
    this.waiting.delete(msg.id);
    if (msg.ok) h.resolve(msg.result); else h.reject(new Error(msg.error));
  }
  submit(type, payload, priority = 0) {
    const job = { type, payload, priority, started: false, cancelled: false };
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.cancel = () => {
      if (job.cancelled || job.started) return;
      job.cancelled = true; const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1);
      job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    };
    this.queue.push(job);
    this._pump();
    return job;
  }
  _pump() {
    for (const w of this.workers) {
      if (w.busy || w.dead) continue;
      if (w.pendingInstall) { const f = w.pendingInstall; w.pendingInstall = null; w.busy = true; f(); continue; }
      if (!this.queue.length) continue;
      let bi = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        if (q.type === 'chunk' && !w.hasLayout) continue;
        if (bi < 0 || q.priority < this.queue[bi].priority) bi = i;
      }
      if (bi < 0) continue;
      const job = this.queue.splice(bi, 1)[0];
      job.started = true; w.busy = true;
      this._send(w, job.type, job.payload).then(
        (r) => { w.busy = false; job.resolve(r); this._pump(); },
        (e) => { w.busy = false; job.reject(e); this._pump(); });
    }
  }
  get pending() { let n = this.queue.length; for (const w of this.workers) if (w.busy && !w.dead) n++; return n; }
  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    const gone = () => Object.assign(new Error('mega workers disposed'), { cancelled: true });
    for (const j of this.queue) { j.cancelled = true; j.reject(gone()); }
    this.queue = [];
    for (const h of this.waiting.values()) h.reject(gone());
    this.waiting.clear();
  }
}

/** main-thread fallback with the same submit() API (one job per macrotask) */
class LocalRunner {
  constructor() { this.queue = []; this.running = false; this.mods = null; }
  async start() {
    const [G, T, X, SC] = await Promise.all([import('./gen.js'), import('../world/terrain.js'), import('../buildings/kit/texgen.js'), import('./screens.js')]);
    this.mods = { G, T, X, SC };
    return G.computeLayout((x, y, z) => T.heightAt(x, y, z, 1.0));
  }
  submit(type, payload, priority = 0) {
    const job = { type, payload, priority, started: false, cancelled: false };
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.cancel = () => { if (job.started || job.cancelled) return; job.cancelled = true; const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1); job.reject(Object.assign(new Error('cancelled'), { cancelled: true })); };
    this.queue.push(job);
    this._kick();
    return job;
  }
  _kick() {
    if (this.running || !this.queue.length || !this.mods) return;
    this.running = true;
    setTimeout(() => {
      this.running = false;
      if (!this.queue.length) return;
      let bi = 0; for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[bi].priority) bi = i;
      const job = this.queue.splice(bi, 1)[0];
      job.started = true;
      try {
        const { G, X } = this.mods;
        if (job.type === 'chunk') job.resolve(G.buildChunk(job.payload.site, job.payload.chunk, job.payload.lod));
        else if (job.type === 'texture' && job.payload.name === 'mega_screens') job.resolve(this.mods.SC.generateScreenAtlas());
        else if (job.type === 'texture') job.resolve(X.generateTexture(job.payload.name, job.payload.size));
        else job.reject(new Error('unknown job ' + job.type));
      } catch (e) { job.reject(e); }
      this._kick();
    }, 0);
  }
  get pending() { return this.queue.length + (this.running ? 1 : 0); }
  dispose() { this.queue.length = 0; }
}

// ---------------------------------------------------------------------------------------------
// gate-state cross-check with the water renderer (render/water/tiles.js spillwayGateOpen)
// ---------------------------------------------------------------------------------------------
async function crossCheckGates(layout) {
  try {
    const mod = await import('../render/water/tiles.js');
    if (typeof mod.spillwayGateOpen !== 'function') return null;
    let bad = 0;
    for (const s of layout.G02.spillways) {
      const bays = layout.G02.dams[s.dam].bays;
      if (mod.spillwayGateOpen(s.dam, bays - 1 - s.bay) !== s.open) bad++;
    }
    if (bad) console.warn(`[mega] ${bad} G02 spillway gate states differ from render/water spillwayGateOpen()`);
    return bad;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
export class MegaSystem {
  constructor(app) {
    this.app = app;
    this.cfg = { ...MEGA_CFG };
    this.recs = [];
    this.results = [];
    this.layout = null;
    this.frameNo = 0;
    this.K = 1400;
    this._busy = true;
    this._dbg = null;
    this.quat = {
      G01: new THREE.Quaternion(...siteQuaternion(SITE.G01)),
      G02: new THREE.Quaternion(...siteQuaternion(SITE.G02)),
    };
    this.stats = { chunks: 0, far: 0, mid: 0, near: 0, triangles: 0, built: 0, buildMs: 0, uploadMs: 0, layoutMs: 0 };
    this.gateCheck = null;
  }

  async init() {
    const app = this.app;
    this.root = new THREE.Group();
    this.root.name = 'megastructures';
    this.root.matrixAutoUpdate = false;
    app.scene.add(this.root);
    this.mats = new MegaMaterials(app);
    // G01 crest line with a minimum on-screen width out to orbit (QS-09 / DG): independent of the layout
    try { this.orbitLine = new G01OrbitLine(app); this.orbitLine.attach(this.root, this.mats); } catch (e) { console.warn('[mega] orbit line failed', e); this.orbitLine = null; }
    app.events?.on?.('settings', ({ key }) => { if (key === 'debugLayer' || key === 'clean') this._applyDebug(); });
    // workers: layout (terrain-keyed), textures, chunk geometry
    let maps = null;
    try { maps = getControlMaps(); } catch { maps = null; }
    const pool = new MegaWorkers(this.cfg.workers);
    this.runner = pool;
    const useLocal = async (why) => {
      console.warn('[mega] using the main-thread generator:', why);
      pool.dispose();
      this.runner = new LocalRunner();
      return this.runner.start();
    };
    // surface textures: requested right away (the idle workers make them while worker 0 computes
    // the layout); re-requested on the fallback runner if the pool died
    const texInFlight = new Set();
    const requestTextures = () => {
      for (const name of this.mats.textureRequests()) {
        if (this.mats.textures.has(name) || texInFlight.has(name)) continue;
        texInFlight.add(name);
        const runner = this.runner;
        runner.submit('texture', { name }, -10).promise.then((t) => { texInFlight.delete(name); this.mats.installTexture(t); })
          .catch((e) => { texInFlight.delete(name); if (!e?.cancelled && runner === this.runner) console.warn('[mega] texture failed', name, e); });
      }
    };
    const layoutP = maps
      ? pool.start(maps).catch((e) => useLocal(e && e.message))
      : useLocal('no control maps');
    if (maps) requestTextures();
    // never block App.start(): the layout arrives asynchronously (isIdle() stays false meanwhile)
    layoutP.then((L) => {
      if (!L || !L.G01) throw new Error('bad layout');
      this._installLayout(L);
      requestTextures();
    }).catch((e) => { console.error('[mega] layout failed', e); this._failed = true; });
  }

  // ------------------------------------------------------------------------------------------
  _installLayout(L) {
    this.layout = L;
    this.stats.layoutMs = L.ms || 0;
    for (const sid of ['G01', 'G02']) {
      const site = SITE[sid];
      for (const c of L[sid].chunks) {
        const center = siteToEcef(site, c.cx, (c.y0 + c.y1) / 2, c.cz, {});
        const h = hashStr(c.id);
        this.recs.push({
          key: `${sid}:${c.id}`, sid, id: c.id, chunk: c, center, radius: Math.hypot(c.r, (c.y1 - c.y0) / 2),
          lods: {}, jobs: {}, want: 'far', shown: null, obj: null, lastWant: { far: 0, mid: -1e9, near: -1e9 },
          walkUntil: -1, dist: 1e12, visible: false, inView: false, fails: {},
          colour: new THREE.Color().setHSL((h % 997) / 997, 0.7, 0.55),
        });
      }
    }
    this.stats.chunks = this.recs.length;
    // far LOD of everything right away (tiny: ~30k triangles for both sites)
    for (const rec of this.recs) this._request(rec, 'far', 1);
    crossCheckGates(L).then((n) => { this.gateCheck = n; });
  }

  _request(rec, lod, priority) {
    if ((rec.fails[lod] || 0) >= 2) return;           // give up on a chunk LOD that failed twice
    if (rec.lods[lod] || rec.jobs[lod]) { if (rec.jobs[lod] && !rec.jobs[lod].started) rec.jobs[lod].priority = priority; return; }
    const job = this.runner.submit('chunk', { site: rec.sid, chunk: rec.id, lod }, priority);
    rec.jobs[lod] = job;
    job.promise.then((data) => {
      if (rec.jobs[lod] !== job) return;
      rec.jobs[lod] = null;
      this.results.push({ rec, lod, data });
    }, (err) => {
      if (rec.jobs[lod] !== job) return;
      rec.jobs[lod] = null;
      if (!err?.cancelled) { console.warn('[mega] chunk failed', rec.key, lod, err); rec.fails[lod] = (rec.fails[lod] || 0) + 1; }
    });
  }

  // ------------------------------------------------------------------------------------------
  update(frame) {
    this.frameNo++;
    this.mats.update(frame);
    this.orbitLine?.update(frame, origin);
    this._wind(frame);
    const st = frame.settings || this.app.state?.settings || {};
    if ((st.clean ? 'none' : st.debugLayer || 'none') !== this._dbg) this._applyDebug();
    if (!this.recs.length) { this._busy = !this._failed; return; }
    this._upload(this.cfg.uploadMs);

    const vp = frame.viewport || { height: 900, pixelRatio: 1 };
    const fov = (frame.camera?.fov || 35) * DEG;
    const lodScale = this.app.pipeline?.lodScale || 1;
    this.K = (vp.height * (vp.pixelRatio || 1) * lodScale) / (2 * Math.tan(fov / 2));
    const cfg = this.cfg, K = this.K;
    const nearD = clamp(cfg.nearK * K, cfg.nearMin, cfg.nearMax), midD = clamp(cfg.midK * K, cfg.midMin, cfg.midMax);
    const cam = frame.camEcef, camR = Math.hypot(cam.x, cam.y, cam.z);
    const cux = cam.x / camR, cuy = cam.y / camR, cuz = cam.z / camR;
    const thC = Math.acos(Math.min(1, R / camR));
    const fr = frame.frustum;
    let pending = 0;
    for (const rec of this.recs) {
      const c = rec.center;
      const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const d = Math.max(1, dist - rec.radius);
      // horizon: chunk (top ~ +60 m) still above the camera's horizon
      const cr = Math.hypot(c.x, c.y, c.z);
      const cosA = (c.x * cux + c.y * cuy + c.z * cuz) / cr;
      const thP = Math.acos(Math.min(1, R / (R + 80))) + rec.radius / R;
      // above the horizon and not sub-pixel (true angular size: the far LOD fades into the city band)
      const visible = dist < 4000 || (Math.acos(Math.max(-1, Math.min(1, cosA))) < thC + thP && (rec.radius * K) / dist > 0.25);
      _sph.center.set(c.x - origin.x, c.y - origin.y, c.z - origin.z); _sph.radius = rec.radius + 10;
      const inView = visible && (!fr || fr.intersectsSphere(_sph));
      let want = 'far';
      const kind = rec.chunk.kind;
      if ((visible || d < 3000) && kind !== 'band') {          // deposit bands: one LOD (tiny)
        const nd = rec.want === 'near' ? nearD * 1.3 : nearD;
        let md = rec.want !== 'far' ? midD * 1.25 : midD;
        if (kind === 'road') md = Math.min(md, 2500);          // fill walls / kerbs only up close
        if (d < nd) want = 'near'; else if (d < md) want = 'mid';
      }
      if (rec.walkUntil > this.frameNo && kind !== 'band') want = 'near';
      rec.want = want; rec.dist = d; rec.visible = visible; rec.inView = inView;
      rec.lastWant[want] = this.frameNo; rec.lastWant.far = this.frameNo;
      const base = inView ? 0 : 40;
      if (want === 'near') { this._request(rec, 'near', base + 2 + d / 400); this._request(rec, 'mid', base + 6 + d / 2000); rec.lastWant.mid = this.frameNo; }
      else if (want === 'mid') this._request(rec, 'mid', base + 8 + d / 2000);
      if (!rec.lods.far) this._request(rec, 'far', 1);
      // choose the displayed LOD (best ready, closest to the wanted one)
      let show = null;
      for (const l of PREF[want]) if (rec.lods[l]) { show = l; break; }
      if (show !== rec.shown) this._show(rec, show);
      if (rec.obj) {
        const g = rec.obj.group, a = rec.obj.anchor;
        g.visible = visible;
        g.position.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
        g.updateMatrix();
        g.updateMatrixWorld(true);
      }
      if (want !== 'far' && !rec.lods[want] && (rec.fails[want] || 0) < 2 && (inView || d < 2000)) pending++;
      if (!rec.lods.far && (rec.fails.far || 0) < 2) pending++;
      // release resident LODs that have not been wanted for a while
      for (const l of ['near', 'mid']) {
        const L = rec.lods[l];
        if (!L || rec.shown === l) continue;
        const keep = l === 'near' ? cfg.keepNear : cfg.keepMid;
        if (this.frameNo - rec.lastWant[l] > keep) this._dispose(rec, l);
      }
    }
    this._busy = pending > 0 || this.results.length > 0 || !this.mats.texturesReady;
    if (this.frameNo % 30 === 0) this._stats();
  }

  /** downwind direction of the nearest site (leeward dust in the surface shader) */
  _wind(frame) {
    const cam = frame.camEcef;
    let best = null, bd = Infinity;
    for (const sid of ['G01', 'G02']) {
      const st = SITE[sid], la = st.lat * DEG, lo = st.lon * DEG;
      const ux = Math.cos(la) * Math.sin(lo), uy = Math.sin(la), uz = Math.cos(la) * Math.cos(lo);
      const d = Math.hypot(cam.x - ux * R, cam.y - uy * R, cam.z - uz * R);
      if (d < bd) { bd = d; best = st; }
    }
    if (best === this._windSite) return;
    this._windSite = best;
    // G01: side wind from the WSW across the approach to the mouth; G02: down-valley wind off the tableland
    const bear = (best.id === 'G01' ? 70 : 255) * DEG;
    const v = siteDirToEcef(best, Math.sin(bear), 0, -Math.cos(bear), {});
    this.mats.uniforms.uMegaWind.value.set(v.x, v.y, v.z).normalize();
  }

  _upload(budgetMs) {
    if (!this.results.length) return;
    const t0 = performance.now();
    this.results.sort((a, b) => (a.rec.inView === b.rec.inView ? a.rec.dist - b.rec.dist : a.rec.inView ? -1 : 1));
    while (this.results.length && performance.now() - t0 < budgetMs) {
      const { rec, lod, data } = this.results.shift();
      if (rec.lods[lod]) continue;
      try { rec.lods[lod] = this._createLod(rec, lod, data); } catch (e) { console.error('[mega] upload failed', rec.key, lod, e); rec.fails[lod] = (rec.fails[lod] || 0) + 1; continue; }
      this.stats.built++; this.stats.buildMs += data.stats?.ms || 0;
    }
    this.stats.uploadMs = Math.max(this.stats.uploadMs * 0.95, performance.now() - t0);
  }

  _createLod(rec, lod, data) {
    const group = new THREE.Group();
    group.name = `mega:${rec.key}:${lod}`;
    group.matrixAutoUpdate = false;
    group.quaternion.copy(this.quat[rec.sid]);
    const box = new THREE.Box3(new THREE.Vector3(...data.bounds.min), new THREE.Vector3(...data.bounds.max));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    let tris = 0, bytes = 0;
    for (const p of data.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(p.color, 3));
      if (p.aMega) g.setAttribute('aMega', new THREE.BufferAttribute(p.aMega, 4));
      g.setIndex(new THREE.BufferAttribute(p.index, 1));
      g.boundingBox = box.clone(); g.boundingSphere = sphere.clone();
      const mat = this.mats.get(p.material);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = p.material;
      mesh.matrixAutoUpdate = false;
      // roads lie on the terrain bench: no shadow (on a still-coarse terrain tile a draped road would
      // otherwise throw a long shadow wedge below it)
      mesh.castShadow = !this.mats.isNoShadow(p.material) && rec.chunk.kind !== 'road';
      mesh.receiveShadow = true;
      if (TRANSPARENT[p.material]) mesh.renderOrder = TRANSPARENT[p.material];
      mesh.userData.megaMat = mat;
      mesh.userData.megaKey = p.material;
      group.add(mesh);
      tris += p.index.length / 3;
      bytes += p.position.byteLength + p.normal.byteLength + p.uv.byteLength + p.color.byteLength + p.index.byteLength + (p.aMega ? p.aMega.byteLength : 0);
    }
    group.visible = false;
    return { lod, group, anchor: data.anchor, colliders: data.colliders, partTable: data.partTable || [], tris, bytes, colMesh: null, lights: data.lights || [] };
  }

  _show(rec, lod) {
    if (rec.obj) { this.root.remove(rec.obj.group); rec.obj.group.visible = false; }
    rec.shown = lod; rec.obj = lod ? rec.lods[lod] : null;
    if (rec.obj) { this.root.add(rec.obj.group); this._debugLod(rec, rec.obj); }
  }

  _dispose(rec, lod) {
    const L = rec.lods[lod];
    if (!L) return;
    if (rec.obj === L) { this.root.remove(L.group); rec.obj = null; rec.shown = null; }
    L.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (L.colMesh) { L.colMesh.geometry.boundsTree = null; L.colMesh.geometry.dispose(); }
    delete rec.lods[lod];
  }

  /** collider mesh (three-mesh-bvh) of a LOD object, built on first use */
  _colMesh(L) {
    if (L.colMesh !== null) return L.colMesh || null;
    const c = L.colliders;
    if (!c || !c.index || !c.index.length) { L.colMesh = false; return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
    g.setIndex(new THREE.BufferAttribute(c.index, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.boundsTree = new MeshBVH(g, { targetLeafSize: 8 });
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    mesh.name = 'mega-colliders'; mesh.visible = false; mesh.userData.isCollider = true;
    L.colMesh = mesh;
    return mesh;
  }

  // ------------------------------------------------------------------------------------------
  // queries
  // ------------------------------------------------------------------------------------------
  isIdle() { return !this._busy; }

  /** nearest megastructure surface along a render-space ray */
  raycast(o, d) {
    if (!this.recs.length) return null;
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    _ray.origin.set(o.x, o.y, o.z); _ray.direction.set(d.x / dl, d.y / dl, d.z / dl);
    let best = null;
    for (const rec of this.recs) {
      const L = rec.obj;
      if (!L || !rec.visible) continue;
      _sph.center.set(rec.center.x - origin.x, rec.center.y - origin.y, rec.center.z - origin.z); _sph.radius = rec.radius + 20;
      if (!_ray.intersectsSphere(_sph)) continue;
      const mesh = this._colMesh(L);
      if (!mesh) continue;
      _m.compose(_v.set(L.anchor.x - origin.x, L.anchor.y - origin.y, L.anchor.z - origin.z), this.quat[rec.sid], _one);
      _inv.copy(_m).invert();
      _lr.copy(_ray).applyMatrix4(_inv);
      const hit = mesh.geometry.boundsTree.raycastFirst(_lr, THREE.DoubleSide, 0, best ? best.distance : Infinity);
      if (!hit || (best && hit.distance >= best.distance)) continue;
      const pi = L.colliders.part ? L.colliders.part[hit.face.a] : 0;
      const pt = L.partTable[pi] || { id: rec.id, name: rec.chunk.name || rec.id };
      best = { type: 'mega', id: rec.sid, megaId: rec.sid, part: pt.name, partId: pt.id, chunk: rec.id, lod: L.lod, distance: hit.distance, point: _ray.at(hit.distance, new THREE.Vector3()) };
    }
    return best;
  }

  getColliders(nearEcef, radius = 14) {
    const out = [];
    if (!nearEcef || !this.recs.length) return out;
    for (const rec of this.recs) {
      const c = rec.center;
      const dist = Math.hypot(c.x - nearEcef.x, c.y - nearEcef.y, c.z - nearEcef.z);
      if (dist > rec.radius + radius + 40) continue;
      rec.walkUntil = this.frameNo + 240;               // walkways / railings within reach: near LOD
      const L = rec.obj;
      if (!L) continue;
      const mesh = this._colMesh(L);
      if (mesh) out.push({ mesh, anchorEcef: L.anchor, quaternion: this.quat[rec.sid], id: `${rec.key}:${L.lod}` });
    }
    return out;
  }

  /** G02 spillway outlets (end of each chute) for the water renderer */
  spillways() {
    if (!this.layout) return [];
    if (this._spill) return this._spill;
    const site = SITE.G02, dams = this.layout.G02.dams;
    this._spill = this.layout.G02.spillways.map((s) => {
      const dam = dams[s.dam];
      const ll = localToLatLon(site, s.x, s.z, {});
      const X = -dam.SW / 2 + s.bay * 18 + 6;          // bay centre along the dam (dam frame X)
      const flipX = (dam.TX * (SITE.G02.levels[s.dam].dam.b[0] - SITE.G02.levels[s.dam].dam.a[0]) + dam.TZ * (SITE.G02.levels[s.dam].dam.b[1] - SITE.G02.levels[s.dam].dam.a[1])) < 0 ? -1 : 1;
      return {
        id: s.id, damId: s.damId, dam: s.dam, bay: s.bay, open: s.open,
        ecef: siteToEcef(site, s.x, s.y, s.z, {}), dirEcef: siteDirToEcef(site, s.dir[0], 0, s.dir[1], {}),
        width: s.width, flow: s.flow, level: s.level, tailLevel: s.tail, crestLevel: s.crestY, across: X * flipX,
        lat: ll.lat, lon: ll.lon,
      };
    });
    return this._spill;
  }

  gateStates() {
    if (!this.layout) return {};
    const out = {};
    for (const d of this.layout.G02.dams) out[d.id] = d.states.slice();
    return out;
  }

  towns() {
    const site = SITE.G02;
    return site.towns.map((t) => { const ll = localToLatLon(site, t.x, t.z, {}); return { id: t.id, lat: ll.lat, lon: ll.lon, y: t.y, radius: t.radius, ecef: siteToEcef(site, t.x, t.y, t.z, {}) }; });
  }

  info(id) {
    const site = SITE[id];
    if (!site) return null;
    return { id, name: site.name, province: site.province, lat: site.lat, lon: site.lon, centerEcef: siteToEcef(site, 0, 0, 0, {}), radius: id === 'G01' ? 6500 : 9000 };
  }

  /** named camera poses for the shot 08 / 09 framings (and bookmarks) */
  views() {
    if (this._views) return this._views;
    const V = {};
    const pose = (site, x, z, alt, tx, tz, pitch, lens) => {
      const ll = localToLatLon(site, x, z, {});
      const heading = ((Math.atan2(tx - x, -(tz - z)) / DEG) + 360) % 360;
      return { lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6), alt: +alt.toFixed(1), heading: +heading.toFixed(2), pitch, lens };
    };
    // ---- G01: open sea -> main mouth (shot 09)
    const S1 = SITE.G01, m = S1.mouth;
    const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[1] + m.b[1]) / 2;
    const ob = S1.heading * DEG, ox = Math.sin(ob), oz = -Math.cos(ob);          // offshore unit (x, z)
    const ax = m.b[0] - m.a[0], az = m.b[1] - m.a[1], al = Math.hypot(ax, az), tx = ax / al, tz = az / al;
    V['g01-300km'] = pose(S1, mx + ox * 160000, mz + oz * 160000, 300000, mx, mz, -55, 35);
    V['g01-30km'] = pose(S1, mx + ox * 26000 - tx * 9000, mz + oz * 26000 - tz * 9000, 14000, mx - ox * 1500, mz - oz * 1500, -28, 35);
    // shot 09 opener (dusk, approaching the main mouth from the open sea): oblique from the SW offing, ~3 km
    // to the mouth, looking NE with the low sun behind the camera on the seaward faces; the barrier recedes
    // diagonally (nearest segments ~1.5 km: heads, drums, lock gantries, quays), the calm harbour inside and
    // the city on the far shore behind the barrier
    V['g01-5km'] = pose(S1, mx + ox * 2000 - tx * 2300, mz + oz * 2000 - tz * 2300, 320, mx - ox * 400 + tx * 600, mz - oz * 400 + tz * 600, -6, 40);
    V['g01-2km'] = pose(S1, mx + ox * 2100 - tx * 700, mz + oz * 2100 - tz * 700, 230, mx - ox * 400, mz - oz * 400, -5.5, 35);
    // 300 m up, ~1 km off the mouth, east of it (G01 reference framing): both mouth heads, the arc
    // receding west, the protected harbour and the city behind
    V['g01-300m'] = pose(S1, mx + ox * 1000 + tx * 420, mz + oz * 1000 + tz * 420, 300, mx - ox * 450 - tx * 650, mz - oz * 450 - tz * 650, -12, 30);
    // close pass of the mouth heads (60 m up, 600 m out)
    V['g01-heads'] = pose(S1, mx + ox * 600 + tx * 90, mz + oz * 600 + tz * 90, 45, mx - ox * 250, mz - oz * 250, -4, 28);
    V['g01-ship'] = pose(S1, mx + ox * 650, mz + oz * 650, 7, mx - ox * 600, mz - oz * 600, -1.5, 35);
    V['g01-ship-in'] = pose(S1, mx - ox * 120, mz - oz * 120, 7, mx + ox * 800 + tx * 300, mz + oz * 800 + tz * 300, -1, 28);
    // harbour office (港务工作间): drum of the harbour tower on the mouth head west of the mouth,
    // eye 1.7 m above the office floor, ~2.6 m behind the console desk (drum radius − 4.4 m from the axis)
    // toward the window facing the mouth (looking where the consoles face: office.look = the far mouth
    // head, the mouth gap, the near navigation light and the inbound channel)
    const of = this.layout && this.layout.G01.office;
    if (of) {
      let lx, lz;
      if (of.look) { lx = of.look[0]; lz = of.look[1]; } else { const dx = of.mouth[0] - of.x, dz = of.mouth[1] - of.z, l = Math.hypot(dx, dz) || 1; lx = dx / l; lz = dz / l; }
      const er = (of.radius || 9) - 4.4;
      const ex = of.x + lx * er, ez = of.z + lz * er;
      V['g01-office'] = pose(S1, ex, ez, of.floor + 1.7, of.x + lx * 1000, of.z + lz * 1000, -4, 24);
    }
    // ---- G02: down the valley (shot 08)
    const S2 = SITE.G02, lv = S2.levels;
    const dam = (i) => lv[i].dam;
    const dmid = (i) => [(dam(i).a[0] + dam(i).b[0]) / 2, (dam(i).a[1] + dam(i).b[1]) / 2];
    const d0 = dmid(0), d5 = dmid(5), d3 = dmid(3), d2 = dmid(2);
    const vx = d5[0] - d0[0], vz = d5[1] - d0[1], vl = Math.hypot(vx, vz), ux = vx / vl, uz = vz / vl;
    // shot 08 opener: high oblique along the valley line from below the escarpment, the six levels
    // stepping up and receding, every dam showing its still upstream pool, wall and outflow
    V['g02-valley'] = pose(S2, d5[0] + ux * 3600 + uz * 1500, d5[1] + uz * 3600 - ux * 1500, 2500, d3[0], d3[1], -15, 30);
    // the same valley seen downstream from above the head (pools receding toward the plain)
    V['g02-down'] = pose(S2, d0[0] - ux * 3500 + uz * 1600, d0[1] - uz * 3500 - ux * 1600, 3200, d3[0], d3[1], -21, 32);
    V['g02-high'] = pose(S2, d0[0] - ux * 9000, d0[1] - uz * 9000, 9000, (d2[0] + d3[0]) / 2, (d2[1] + d3[1]) / 2, -30, 35);
    // reference framing (G02 concept art): from above the plain, looking up the stairs
    const d4 = dmid(4);
    V['g02-ref'] = pose(S2, d5[0] + ux * 2600 - uz * 900, d5[1] + uz * 2600 + ux * 900, 1900, d4[0], d4[1], -17, 35);
    const dams = this.layout ? this.layout.G02.dams : null;
    if (dams) {
      const dm = dams[2];
      const toXZ = (X, Z) => [dm.mx + dm.TX * X + dm.ZX * Z, dm.mz + dm.TZ * X + dm.ZZ * Z];
      // 50 mm on dam 3 from downstream, off to one side: piers between the bays, hoist rail, walkway
      const c0 = toXZ(70, 215), t0 = toXZ(0, 6);
      V['g02-dam50'] = pose(S2, c0[0], c0[1], dm.crest + 7, t0[0], t0[1], -1.5, 50);
      // 85 mm on a gate-side grille: housing on the pier face beside an open bay, just above the sheet
      // running past, seen from the upstream railing of the crest road bridge
      let b = dm.states.findIndex((o) => o);
      if (b < 0) b = 0;
      const xf = -dm.SW / 2 + (b + 1) * 18 - 6;          // xa face of pier b+1 (faces bay b)
      const cam = toXZ(xf - 8, 7.3), tgt = toXZ(xf, 3.5);
      const p = pose(S2, cam[0], cam[1], dm.crest + 1.7, tgt[0], tgt[1], 0, 85);
      const hz = Math.hypot(8, 3.8), ty = dm.level - 3.6;  // aim a little below the grille centre (L − 3.1)
      p.pitch = +(Math.atan2(-(dm.crest + 1.7 - ty), hz) / DEG).toFixed(2);
      V['g02-grille'] = p;
    }
    this._views = this.layout ? V : null;
    return V;
  }

  // ------------------------------------------------------------------------------------------
  // debug layers
  // ------------------------------------------------------------------------------------------
  _applyDebug() {
    const s = this.app.state?.settings || {};
    const dbg = s.clean ? 'none' : s.debugLayer || 'none';
    this._dbg = dbg;
    for (const rec of this.recs) if (rec.obj) this._debugLod(rec, rec.obj);
  }

  _debugLod(rec, L) {
    const mode = this._dbg === 'objectId' || this._dbg === 'wireframe' || this._dbg === 'lod' ? this._dbg : null;
    for (const mesh of L.group.children) {
      if (!mesh.isMesh) continue;
      if (!mode) { mesh.material = mesh.userData.megaMat; continue; }
      mesh.material = debugMaterial(mode, rec, L.lod);
    }
  }

  _stats() {
    let far = 0, mid = 0, near = 0, tris = 0;
    for (const rec of this.recs) {
      if (rec.shown === 'far') far++; else if (rec.shown === 'mid') mid++; else if (rec.shown === 'near') near++;
      if (rec.obj && rec.visible) tris += rec.obj.tris;
    }
    Object.assign(this.stats, { far, mid, near, triangles: tris });
  }

  debugStats() {
    this._stats();
    return { ...this.stats, busy: this._busy, K: Math.round(this.K), results: this.results.length, pendingJobs: this.runner?.pending ?? 0, texturesReady: this.mats?.texturesReady, gateMismatch: this.gateCheck };
  }

  dispose() {
    this.orbitLine?.dispose();
    for (const rec of this.recs) for (const l of LODS) this._dispose(rec, l);
    this.recs = [];
    this.runner?.dispose?.();
    this.app.scene.remove(this.root);
  }
}

const DEBUG_MATS = new Map();
const LOD_COL = { far: 0x3d7cff, mid: 0x2fd36a, near: 0xff7a1a };
function debugMaterial(mode, rec, lod) {
  const key = mode === 'objectId' ? 'id:' + rec.key : mode + ':' + lod;
  let m = DEBUG_MATS.get(key);
  if (!m) {
    const color = mode === 'objectId' ? rec.colour : new THREE.Color(LOD_COL[lod] || 0xffffff);
    m = new THREE.MeshBasicMaterial({ color, wireframe: mode === 'wireframe' });
    m.name = 'mega:debug-' + key;
    DEBUG_MATS.set(key, m);
  }
  return m;
}

function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
