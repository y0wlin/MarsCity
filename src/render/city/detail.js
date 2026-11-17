// Near LOD: detailed buildings ('exterior' within ~400–900 m by projected size, 'full' with interiors
// and colliders within ~80 m, for the focused / selected building and on demand for walking).
// Generated in the city worker pool ('cityBuilding' job, building kit) and drawn through GPU-only
// batches (batch.js): ONE THREE.BatchedMesh per material key holds that key's part of every detailed
// building (multi-draw, per-instance culling), so draw calls no longer grow with the building count.
// The drawn geometry lives only in WebGL buffers; each building keeps a compact pick copy (packed
// positions + indices + 64-triangle chunk boxes from the worker) for exact picking / walking probes.
// The mass model of a building dissolves (dithered state fade) once its detailed version is on screen,
// and comes back before the detailed version is released. OWNER: city agent.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { origin } from '../../core/origin.js';
import { latLonHToEcef, buildingAxes } from '../../core/geo.js';
import { INFO_STRIDE } from './massBuild.js';
import { GpuBatch, partSchema, schemaKey } from './batch.js';

let MATS = null;   // buildings/materials.js (loaded lazily so a broken kit never breaks the city)
export async function loadBuildingMaterials(app, pool) {
  if (MATS) return MATS;
  try {
    MATS = await import('../../buildings/materials.js');
    try { MATS.initBuildingMaterials?.(app, { workers: pool || app.workers }); } catch (e) { console.warn('[city] initBuildingMaterials failed', e); }
  } catch (e) { console.warn('[city] building materials unavailable', e); MATS = null; }
  return MATS;
}

export const DETAIL_CFG = {
  exteriorPx: 34,        // bounding radius in device px above which a building gets its detailed exterior
  releasePx: 24,         // hysteresis
  nearExterior: 220,     // m: always detailed this close (surface distance)
  fullDist: 80,          // m: interiors + colliders this close
  maxObjects: 600,
  // GPU residency of detailed buildings (a kit 'exterior' residential block is ~0.1–0.3 M triangles):
  // nearest-first by projected size until this is reached. Not a quality cap -- the buildings beyond
  // keep the far facade shader; it keeps a dense district inside one tab's memory.
  triBudget: 36e6,
  byteBudget: 2.6e9,
  maxJobs: 24,
  uploadMs: 7,
  fadeIn: 0.45,          // s, mass dissolve once the detailed version is drawn
  fadeOut: 0.3,
  releaseFrames: 90,
  anchorRebase: 1500,    // m: batches are anchored near the camera (float32 instance matrices)
  pickDist: 320,         // m: detailed buildings uploaded closer keep a CPU pick copy (positions + indices);
                         // farther ones are picked through their mass hull until they come within 0.7×
  wireBuildings: 40,     // debug 'wireframe': nearest detailed buildings drawn as triangle edges
};

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _pm = new THREE.Matrix4(), _pt = new THREE.Matrix4(), _pr = new THREE.Matrix4();

// Night light pools of the kit's light bollards (fix round 3, C2: the glowing-cap bollards of station / civic /
// office / market / ferry / clinic forecourts are building geometry, not props, so props' pool system never saw
// them). Additive warm discs on the forecourt around each post — same look and photometry as props' own light
// bollards (props/materials.js poolMaterial: colour 0.95 / 0.84 / 0.68, r 1.9 m, × the shared emissive unit,
// night-gated like props: on from sun +2°, full at −4°).
export const POOL_CFG = { radius: 2.1, color: [0.95, 0.84, 0.68], lift: 0.02 };
function bollardPoolMaterial(app) {
  const ES = app?.lighting?.uniforms?.uLpEmissiveScale;
  return new THREE.ShaderMaterial({
    name: 'city:bollard-pool',
    uniforms: { uNight: { value: 0 }, uScale: ES || { value: 0.05 }, uCol: { value: new THREE.Color(...POOL_CFG.color) } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vQ;
      void main() {
        vQ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uNight; uniform float uScale; uniform vec3 uCol;
      varying vec2 vQ;
      void main() {
        #include <logdepthbuf_fragment>
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        float f = pow(1.0 - r2, 2.2);
        gl_FragColor = vec4(uCol * f * uNight * uScale, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}
const COLLIDER_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const NO_SHADOW_FALLBACK = new Set(['glass_clear', 'glass_railing', 'glass_agri', 'light_panel', 'light_warm', 'light_cyan', 'light_red']);
// kit materials used only inside ('full' interiors: materials.js `indoor`): they cast into the near
// cascades only (sun patches through windows); enclosed by walls, they never shape outdoor shadows
const INDOOR_KEYS = new Set(['plaster', 'stone_floor', 'wood_floor', 'wood_door', 'cabinet', 'counter', 'tile_floor', 'tile_wall', 'porcelain', 'fabric', 'black', 'mirror']);
function castsShadow(key) {
  if (MATS && typeof MATS.castsShadow === 'function') return !!MATS.castsShadow(key);
  if (MATS && MATS.NO_SHADOW_KEYS && MATS.NO_SHADOW_KEYS.has) return !MATS.NO_SHADOW_KEYS.has(key);
  return !NO_SHADOW_FALLBACK.has(key);
}

/** invisible collider mesh from {position, index} + a BVH serialized in the worker */
export function colliderMesh(c, ser) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
  g.setIndex(new THREE.BufferAttribute(c.index, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.boundsTree = MeshBVH.deserialize({ version: 1, roots: ser.roots, index: c.index, indirectBuffer: null }, g, { setIndex: false });
  const mesh = new THREE.Mesh(g, COLLIDER_MAT);
  mesh.name = 'colliders'; mesh.visible = false; mesh.userData.isCollider = true;
  return mesh;
}

/**
 * Resolve once every material of obj has a linked program (KHR_parallel_shader_compile: compiled
 * off the frame), so attaching an object with new materials never stalls the frame for seconds.
 * Compiles against the pipeline's HDR scene target so the variant matches the real render.
 * `always`: compile even when the materials were seen before (a new program variant, e.g. batched).
 */
const COMPILING = new WeakMap();   // material -> promise resolved once its program is linked
export function whenCompiled(app, obj, always = false) {
  const r = app.renderer;
  if (!r || !r.compileAsync) return Promise.resolve();
  const waits = new Set();
  let fresh = always;
  const each = (fn) => obj.traverse((o) => { if (o.isMesh && o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) fn(m); });
  if (!always) each((m) => { const p = COMPILING.get(m); if (p) waits.add(p); else fresh = true; });
  if (fresh) {
    const prev = r.getRenderTarget();
    let p;
    try {
      if (app.pipeline && app.pipeline.sceneRT) r.setRenderTarget(app.pipeline.sceneRT);
      p = r.compileAsync(obj, app.camera, app.scene).catch(() => {});
    } catch (e) {
      p = Promise.resolve();
    } finally {
      r.setRenderTarget(prev);
    }
    if (!always) each((m) => { if (!COMPILING.has(m)) COMPILING.set(m, p); });
    waits.add(p);
  }
  return waits.size ? Promise.all(waits) : Promise.resolve();
}

export function buildingFrameOf(spec) {
  const ent = (spec.ground && Number.isFinite(spec.ground.entrance)) ? spec.ground.entrance : 0;
  const o = latLonHToEcef(spec.lat, spec.lon, ent);
  const A = buildingAxes(spec.lat, spec.lon, spec.heading || 0);
  _m.makeBasis(_v.set(A.x[0], A.x[1], A.x[2]), new THREE.Vector3(A.y[0], A.y[1], A.y[2]), new THREE.Vector3(A.z[0], A.z[1], A.z[2]));
  const q = new THREE.Quaternion().setFromRotationMatrix(_m);
  return { originEcef: { x: o.x, y: o.y, z: o.z }, quaternion: q, axes: A };
}

class DetailRec {
  constructor(id, tile, bi, spec) {
    this.id = id; this.tile = tile; this.bi = bi; this.spec = spec;
    this.lod = null; this.want = null; this.job = null; this.jobLod = null;
    this.entries = [];             // [{batch, slot}] drawn parts
    this.collider = null; this.anchors = null; this.bounds = null; this.pick = null;
    this.lastWant = -1; this.bytes = 0; this.tris = 0; this.pendingJob = null;
    const f = buildingFrameOf(spec);
    this.originEcef = f.originEcef; this.quat = f.quaternion; this.axes = f.axes;
    this.M = new THREE.Matrix4(); this.T = { x: NaN, y: NaN, z: NaN };
    this.releasing = false;
  }
  get object() { return this.entries.length ? this : null; }   // compatibility: "has a drawn detailed version"
}

export class DetailManager {
  constructor(city) {
    this.city = city;
    this.app = city.app;
    this.cfg = { ...DETAIL_CFG };
    // ?detailMB=N overrides the GPU residency budget of detailed buildings (MB, default 2.6 GB) for machines with
    // less GPU / unified memory. Only the farthest detailed buildings change: beyond the budget they keep the far
    // facade shader. (The C01–C04 tab crashes of the final capture were a JS out-of-memory caused by too many
    // workers, not this budget: see workers/pool.js MAX_DEFAULT_WORKERS.)
    try {
      const mb = parseFloat(new URLSearchParams(globalThis.location?.search || '').get('detailMB'));
      if (mb > 0) this.cfg.byteBudget = mb * 1048576;
    } catch { /* no location */ }
    this.recs = new Map();       // id -> DetailRec
    this.queue = [];             // finished jobs waiting for upload
    this.waiting = [];           // uploads waiting for a batch program
    this.group = new THREE.Group();
    this.group.name = 'city-detail';
    this.group.matrixAutoUpdate = false;
    this.batches = new Map();    // schema key -> {batch, ready, material}
    this.anchor = null;          // ECEF of the batch frame origin
    this.forcedFull = new Map(); // id -> frame until which 'full' is wanted (focus / walking)
    this.jobs = 0; this.compiling = 0;
    this.stats = { exterior: 0, full: 0, loading: 0, triangles: 0, bytes: 0, built: 0, buildMs: 0, budgetN: 0, wanted: 0, batches: 0, gpuMB: 0, pickMB: 0, instances: 0 };
    this._debug = null;
    this.wire = new Map();       // id -> LineSegments (debug wireframe)
  }

  wantFull(id, frames = 600) { this.forcedFull.set(String(id), this.city.frameNo + frames); }

  /** choose wanted LODs for buildings of the displayed tiles */
  select(frame, tiles) {
    const fno = this.city.frameNo, cfg = this.cfg;
    const cam = frame.camEcef, K = this.city.K;
    const P = {};
    const cand = [];
    const fr = frame.frustum;
    const sph = new THREE.Sphere();
    const forcedIds = new Set();
    for (const [id, f] of this.forcedFull) if (f >= fno) forcedIds.add(id);
    for (const t of tiles) {
      if (!t.displayed || !t.info) continue;
      // far tiles only for buildings forced to 'full' (walker / focus away from the camera)
      const far = t.dist > 2600;
      if (far && !forcedIds.size) continue;
      const I = t.info;
      for (let i = 0; i < t.n; i++) {
        const id = t.data.buildings[i].id;
        const forced = forcedIds.has(id);
        if (far && !forced) continue;
        const o = i * INFO_STRIDE;
        t.toEcef(I[o], I[o + 1], I[o + 2], P);
        const d = Math.hypot(P.x - cam.x, P.y - cam.y, P.z - cam.z);
        const r = Math.max(4, I[o + 3]);
        const surf = Math.max(0, d - r);
        const px = (K * r) / Math.max(1, surf);
        let want = null;
        const rec = this.recs.get(id);
        const thr = rec && rec.lod ? cfg.releasePx : cfg.exteriorPx;
        if (forced || surf < cfg.fullDist) want = 'full';
        else if (surf < cfg.nearExterior || px > thr) {
          sph.center.set(P.x - origin.x, P.y - origin.y, P.z - origin.z); sph.radius = r * 1.2;
          if (surf < 120 || !fr || fr.intersectsSphere(sph)) want = 'exterior';
        }
        if (!want) continue;
        cand.push({ t, i, id, want, surf, score: surf - (forced ? 1e5 : 0) - (want === 'full' ? 50 : 0) });
      }
    }
    cand.sort((a, b) => a.score - b.score);
    // residency budget, nearest first ('full' buildings always fit: they are the few around the eye)
    const avgT = this.stats.built > 0 && this._avgTris ? this._avgTris : 260000;
    const avgB = this._avgBytes || 20e6;
    let triSum = 0, byteSum = 0, n = 0;
    for (; n < cand.length && n < cfg.maxObjects; n++) {
      const c = cand[n];
      const rec0 = this.recs.get(c.id);
      const tr = rec0 && rec0.entries.length ? rec0.tris : avgT, by = rec0 && rec0.entries.length ? rec0.bytes : avgB;
      if (c.want !== 'full' && (triSum + tr > cfg.triBudget || byteSum + by > cfg.byteBudget)) break;
      triSum += tr; byteSum += by;
    }
    this.stats.budgetN = n; this.stats.wanted = cand.length;
    for (let k = 0; k < n; k++) {
      const c = cand[k];
      let rec = this.recs.get(c.id);
      if (!rec) { rec = new DetailRec(c.id, c.t, c.i, c.t.data.buildings[c.i]); this.recs.set(c.id, rec); }
      rec.tile = c.t; rec.bi = c.i;
      rec.want = c.want;
      rec.lastWant = fno;
      rec.score = c.score;
      rec.surf = c.surf;
    }
    for (const [id, f] of this.forcedFull) if (f < fno) this.forcedFull.delete(id);
    // submit jobs nearest first (finished results waiting for upload hold whole building geometries:
    // keep that backlog short so a slow frame rate never piles them up in memory)
    const backlog = this.queue.length + this.waiting.length;
    for (let k = 0; k < n && this.jobs < cfg.maxJobs && this.jobs + backlog < cfg.maxJobs + 6; k++) {
      const rec = this.recs.get(cand[k].id);
      const need = rec.want;
      if (rec.job) continue;   // an exterior job in flight is upgraded after it arrives
      // an exterior uploaded from afar has no pick copy: regenerate it once it comes close
      const needPick = rec.entries.length > 0 && !rec.pick && rec.lod === 'exterior' && need === 'exterior' && rec.surf < cfg.pickDist * 0.7 && !rec.pendingJob;
      if (!needPick && (rec.lod === need || (rec.lod === 'full' && need === 'exterior'))) continue;
      if (rec.pendingJob && (rec.pendingJob.lod === need || rec.pendingJob.lod === 'full')) continue;
      this._submit(rec, need, Math.max(0, cand[k].score));
    }
    // release buildings no longer wanted
    for (const rec of this.recs.values()) {
      if (rec.lastWant >= fno - cfg.releaseFrames) { if (rec.releasing) { rec.releasing = false; if (rec.entries.length) rec.tile.fade(rec.bi, 0, cfg.fadeIn, this.city.time); } continue; }
      if (rec.job) { if (!rec.job.started) { try { rec.job.cancel(); } catch { /* */ } } continue; }
      if (!rec.entries.length) { if (!rec.pendingJob) this.recs.delete(rec.id); continue; }
      if (!rec.releasing) {
        rec.releasing = true;
        rec.releaseT = this.city.time;
        if (rec.tile.stateData) rec.tile.fade(rec.bi, 1, cfg.fadeOut, this.city.time);
      } else if (this.city.time - rec.releaseT > cfg.fadeOut + 0.1 || !rec.tile.displayed) {
        this._dispose(rec);
        this.recs.delete(rec.id);
      }
    }
  }

  _submit(rec, lod, dist) {
    const w = this.city.pool;
    if (!w) return;
    const job = w.submit('cityBuilding', { spec: rec.spec, lod }, { priority: lod === 'full' ? 90 + dist / 2 : 100 + dist / 4 });
    rec.job = job; rec.jobLod = lod; this.jobs++;
    const t0 = performance.now();
    job.promise.then((data) => {
      this.jobs--;
      if (rec.job !== job) return;
      rec.job = null;
      if (!this.recs.has(rec.id)) return;
      this.stats.built++; this.stats.buildMs += data?.stats?.ms || (performance.now() - t0);
      this.queue.push({ rec, data, lod });
    }, (err) => {
      this.jobs--;
      if (rec.job === job) rec.job = null;
      if (!err?.cancelled) console.warn('[city] building job failed', rec.id, err);
    });
  }

  // ------------------------------------------------------------------------------------------
  // batches
  // ------------------------------------------------------------------------------------------
  _batchFor(part) {
    const schema = partSchema(part);
    const key = schemaKey(part.material, schema);
    let B = this.batches.get(key);
    if (B) return B;
    const mat = MATS.getBuildingMaterial(part.material, this.app);
    const batch = new GpuBatch(this.app.renderer, mat, schema, { vertices: 1 << 17, indices: 3 << 17, instances: 256 });
    batch.name = 'city-batch:' + part.material;
    batch.castShadow = castsShadow(part.material);
    batch.receiveShadow = true;
    if (INDOOR_KEYS.has(part.material)) batch.shadowMaxWidth = 320;
    const ro = MATS.renderOrderOf ? MATS.renderOrderOf(part.material) : (MATS.isTransparentKey && MATS.isTransparentKey(part.material) ? 2 : 0);
    if (ro) batch.renderOrder = ro;
    batch.userData.materialKey = part.material;
    B = { batch, ready: false, key, material: part.material, mat, castShadow: batch.castShadow };
    this.batches.set(key, B);
    this.compiling++;
    // the batched program variant (USE_BATCHING) is linked off the frame before the batch is drawn
    const done = () => { this.compiling--; B.ready = true; this.group.add(batch); this._placeBatch(B); if (this._debug) this._applyDebugBatch(B); };
    whenCompiled(this.app, batch, true).then(done, done);
    return B;
  }

  _placeBatch(B) {
    const A = this.anchor;
    if (!A) return;
    B.batch.position.set(A.x - origin.x, A.y - origin.y, A.z - origin.z);
    B.batch.updateMatrix();
    B.batch.updateMatrixWorld(true);
  }

  /** upload finished buildings within the frame budget (batch programs compiled off the frame first) */
  upload(budgetMs) {
    if (!MATS) return;
    const t0 = performance.now();
    if (!this.anchor) this.anchor = { x: origin.x, y: origin.y, z: origin.z };
    // jobs whose batches became ready
    if (this.waiting.length) {
      const still = [];
      for (const job of this.waiting) {
        if (performance.now() - t0 > budgetMs || !job.parts.every((p) => p.B.ready)) { still.push(job); continue; }
        this._attach(job);
      }
      this.waiting = still;
    }
    if (!this.queue.length) return;
    this.queue.sort((a, b) => (a.rec.score ?? 0) - (b.rec.score ?? 0));
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const { rec, data, lod } = this.queue.shift();
      if (!this.recs.has(rec.id) || !data || !data.parts) continue;
      const parts = [];
      let nParts = 0;
      for (const p of data.parts) {
        if (!p.index || !p.index.length || !p.position || p.position.length < 9) continue;
        nParts++;
        let B;
        try { B = this._batchFor(p); } catch (e) { console.warn('[city] batch failed', p.material, e); continue; }
        parts.push({ p, B });
      }
      let col = null;
      if (lod === 'full' && data.colliders) { try { col = data.colliderBVH ? colliderMesh(data.colliders, data.colliderBVH) : MATS.createColliderMesh(data); } catch (e) { console.warn('[city] collider failed', rec.id, e); col = null; } }
      const job = { rec, data, lod, parts, col, nParts };
      rec.pendingJob = job;
      if (parts.every((x) => x.B.ready)) this._attach(job); else this.waiting.push(job);
    }
  }

  _attach(job) {
    const { rec, data, lod, parts, col } = job;
    if (rec.pendingJob !== job || !this.recs.has(rec.id)) return;
    rec.pendingJob = null;
    const old = rec.entries;
    const entries = [];
    const b = data.bounds || { min: [-20, -2, -20], max: [20, 40, 20] };
    let tris = 0, bytes = 0;
    const pickParts = [];
    let failed = parts.length !== job.nParts;
    for (const { p, B } of parts) {
      const vCount = p.position.length / 3;
      const arrays = { position: p.position, normal: p.normal, uv: p.uv, color: p.color };
      if (p.attributes) for (const [n, a] of Object.entries(p.attributes)) arrays[n] = a.array;
      // part bounding sphere (instance frame) for per-instance culling
      const P = p.position;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < P.length; k += 3) { const x = P[k], y = P[k + 1], z = P[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const sphere = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 0.05];
      let slot;
      try { slot = B.batch.addPart(arrays, p.index, vCount, sphere, rec.id); } catch (e) { console.warn('[city] batch upload failed', rec.id, p.material, e); failed = true; continue; }
      entries.push({ batch: B.batch, slot, B });
      tris += p.index.length / 3;
      for (const a of Object.values(arrays)) if (a) bytes += a.byteLength;
      bytes += p.index.byteLength;
      pickParts.push({ pos: p.position, idx: p.index, mat: p.material });
    }
    rec.entries = entries;
    rec.bollards = data.bollards || null;
    this._poolVer = (this._poolVer || 0) + 1;
    rec.collider = col; rec.lod = lod; rec.anchors = data.anchors; rec.bounds = b;
    rec.bytes = bytes; rec.tris = tris;
    // compact pick copy: positions + indices of the drawn parts (+ 64-triangle chunk boxes) for the
    // buildings near the camera; the other arrays are garbage once uploaded
    rec.pick = (lod === 'full' || !(rec.surf > this.cfg.pickDist)) ? makePick(pickParts, failed ? null : data.pickChunks, b) : null;
    const k = Math.min(this.stats.built, 30);
    this._avgTris = ((this._avgTris || tris) * k + tris) / (k + 1);
    this._avgBytes = ((this._avgBytes || bytes) * k + bytes) / (k + 1);
    rec.T.x = NaN;
    this._place(rec, true);
    if (this._debug) for (const e of entries) this._tagEntry(rec, e);
    if (old && old.length) { for (const e of old) e.batch.removePart(e.slot); this._dropWire(rec.id); }
    else if (rec.tile && rec.tile.stateData) rec.tile.fade(rec.bi, 0, this.cfg.fadeIn, this.city.time);
    // the shadow cascades must re-render
    this.city.changed = true;
  }

  _place(rec, force) {
    const A = this.anchor;
    if (!A || !rec.entries.length) return;
    const o = rec.originEcef;
    // detailed buildings stand on their planned (analytic, full-detail) ground: spec.ground — never on
    // the displayed terrain mesh, which converges to it as it refines (mass seating: tiles.js / index.js)
    const tx = o.x - A.x, ty = o.y - A.y, tz = o.z - A.z;
    const T = rec.T;
    if (!force && Math.abs(tx - T.x) < 2e-4 && Math.abs(ty - T.y) < 2e-4 && Math.abs(tz - T.z) < 2e-4) return;
    T.x = tx; T.y = ty; T.z = tz;
    rec.M.compose(_v.set(tx, ty, tz), rec.quat, _one);
    for (const e of rec.entries) e.batch.setPartMatrix(e.slot, rec.M);
    const w = this.wire.get(rec.id);
    if (w) this._placeWire(rec, w);
  }

  place() {
    const A = this.anchor;
    let rebase = false;
    if (!A || Math.hypot(origin.x - A.x, origin.y - A.y, origin.z - A.z) > this.cfg.anchorRebase) {
      this.anchor = { x: origin.x, y: origin.y, z: origin.z };
      rebase = true;
    }
    for (const B of this.batches.values()) this._placeBatch(B);
    for (const rec of this.recs.values()) if (rec.entries.length) this._place(rec, rebase);
    if (this.wire.size) for (const [id, w] of this.wire) { const rec = this.recs.get(id); if (rec) this._placeWire(rec, w); }
  }

  /**
   * Night light pools of the kit light bollards of the drawn detailed buildings (C2): one additive InstancedMesh,
   * instance = building frame (render space) × bollard foot; rebuilt only when the set / origin changes. Hidden by day.
   */
  updatePools(frame) {
    const sinE = frame.sunDir && frame.camUp ? frame.sunDir.dot(frame.camUp) : 1;
    const t = Math.min(1, Math.max(0, (0.035 - sinE) / 0.105));
    const night = t * t * (3 - 2 * t);
    const pm = this.pools;
    if (night <= 0.002 || (this.app.state?.settings?.debugLayer && this.app.state.settings.debugLayer !== 'none')) { if (pm) pm.visible = false; return; }
    let n = 0;
    for (const rec of this.recs.values()) if (rec.bollards && rec.entries.length) n += rec.bollards.length / 3;
    if (!n) { if (pm) pm.visible = false; return; }
    let mesh = pm;
    if (!mesh || mesh.instanceMatrix.count < n) {
      if (mesh) { this.group.remove(mesh); mesh.dispose(); }
      const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
      if (!this._poolMat) this._poolMat = bollardPoolMaterial(this.app);
      mesh = new THREE.InstancedMesh(geo, this._poolMat, Math.max(64, Math.ceil(n * 1.5)));
      mesh.name = 'city-bollard-pools';
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false; mesh.renderOrder = 4;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.pools = mesh;
      this._poolKey = '';
    }
    this._poolMat.uniforms.uNight.value = night;
    // the instance matrices are render-space (camera-relative): refresh when the origin or the set changed
    const key = n + ':' + origin.x.toFixed(2) + ',' + origin.y.toFixed(2) + ',' + origin.z.toFixed(2) + ':' + (this._poolVer || 0);
    if (key !== this._poolKey) {
      this._poolKey = key;
      const R = POOL_CFG.radius, lift = POOL_CFG.lift;
      let i = 0;
      for (const rec of this.recs.values()) {
        const b = rec.bollards;
        if (!b || !rec.entries.length) continue;
        this.matrixOf(rec, _pr);
        for (let k = 0; k < b.length; k += 3) {
          _pt.makeScale(R, 1, R).setPosition(b[k], b[k + 1] + lift, b[k + 2]);
          _pm.multiplyMatrices(_pr, _pt);
          mesh.setMatrixAt(i++, _pm);
        }
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
    }
    mesh.visible = true;
  }

  /** render-space matrix of a drawn detailed building (instance frame -> render space) */
  matrixOf(rec, out) {
    const A = this.anchor;
    out.copy(rec.M);
    out.elements[12] += A.x - origin.x; out.elements[13] += A.y - origin.y; out.elements[14] += A.z - origin.z;
    return out;
  }

  _dispose(rec) {
    if (rec.job) { try { rec.job.cancel(); } catch { /* */ } rec.job = null; }
    for (const e of rec.entries) e.batch.removePart(e.slot);
    rec.entries = [];
    if (rec.collider && rec.collider.geometry) { rec.collider.geometry.boundsTree = null; rec.collider.geometry.dispose(); }
    rec.pendingJob = null;
    if (rec.bollards) this._poolVer = (this._poolVer || 0) + 1;
    rec.collider = null; rec.lod = null; rec.pick = null; rec.bollards = null;
    this._dropWire(rec.id);
    if (rec.tile && rec.tile.stateData) rec.tile.setVisibility(rec.bi, 1);
  }

  /** a tile left the display: drop its detailed buildings */
  dropTile(tile) {
    for (const rec of [...this.recs.values()]) if (rec.tile === tile) { this._dispose(rec); this.recs.delete(rec.id); }
  }

  get(id) { return this.recs.get(String(id)) || null; }
  /** true when building id is drawn detailed and picked through its own geometry */
  picksFor(id) { const r = this.recs.get(id); return !!(r && r.entries.length && r.pick); }

  pending() {
    let n = this.queue.length + this.waiting.length + this.compiling;
    for (const rec of this.recs.values()) if (rec.job || rec.pendingJob || (rec.want && rec.lod !== rec.want && !(rec.lod === 'full' && rec.want === 'exterior'))) n++;
    return n;
  }

  colliders(near, radius, out) {
    for (const rec of this.recs.values()) {
      if (!rec.collider || !rec.collider.geometry.boundsTree) continue;
      const o = rec.originEcef;
      const r = rec.tile && rec.tile.info ? rec.tile.info[rec.bi * INFO_STRIDE + 3] : 30;
      const d = Math.hypot(o.x - near.x, o.y - near.y, o.z - near.z);
      if (d - r > radius) continue;
      // same placement as the drawn building: the planned (analytic) ground, whatever the terrain shows
      out.push({ mesh: rec.collider, anchorEcef: { x: o.x, y: o.y, z: o.z }, quaternion: rec.quat, id: rec.id });
    }
    return out;
  }

  /**
   * Nearest hit of a render-space ray (unit d) on the drawn detailed buildings: bounding sphere, then
   * the building's chunk boxes and triangles in its own frame. -> {rec, t} | null
   */
  raycast(o, d, maxT) {
    let best = null;
    const A = this.anchor;
    if (!A) return null;
    for (const rec of this.recs.values()) {
      if (!rec.entries.length || !rec.pick) continue;
      const Mm = rec.M.elements;
      // building origin in render space
      const ox = Mm[12] + A.x - origin.x, oy = Mm[13] + A.y - origin.y, oz = Mm[14] + A.z - origin.z;
      const pk = rec.pick;
      // bounding sphere (render space)
      const cx = ox + Mm[0] * pk.cx + Mm[4] * pk.cy + Mm[8] * pk.cz, cy = oy + Mm[1] * pk.cx + Mm[5] * pk.cy + Mm[9] * pk.cz, cz = oz + Mm[2] * pk.cx + Mm[6] * pk.cy + Mm[10] * pk.cz;
      const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z;
      const tc = lx * d.x + ly * d.y + lz * d.z;
      const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
      if (d2 > pk.r * pk.r) continue;
      const tEnter = tc - Math.sqrt(Math.max(0, pk.r * pk.r - d2));
      if (tEnter > (best ? best.t : maxT)) continue;
      // ray in the building frame (rotation transpose)
      const px = o.x - ox, py = o.y - oy, pz = o.z - oz;
      const ro = [Mm[0] * px + Mm[1] * py + Mm[2] * pz, Mm[4] * px + Mm[5] * py + Mm[6] * pz, Mm[8] * px + Mm[9] * py + Mm[10] * pz];
      const rd = [Mm[0] * d.x + Mm[1] * d.y + Mm[2] * d.z, Mm[4] * d.x + Mm[5] * d.y + Mm[6] * d.z, Mm[8] * d.x + Mm[9] * d.y + Mm[10] * d.z];
      const t = pickRay(pk, ro, rd, best ? best.t : maxT);
      if (t !== null && (!best || t < best.t)) best = { rec, t };
    }
    return best;
  }

  updateStats() {
    let ext = 0, full = 0, tris = 0, bytes = 0, pick = 0;
    for (const rec of this.recs.values()) { if (rec.lod === 'exterior') ext++; else if (rec.lod === 'full') full++; if (rec.entries.length) { tris += rec.tris; bytes += rec.bytes; } if (rec.pick) pick += rec.pick.bytes; }
    let gpu = 0, used = 0, inst = 0;
    for (const B of this.batches.values()) { gpu += B.batch.gpuBytes(); used += B.batch.usedBytes(); inst += B.batch.liveCount; }
    Object.assign(this.stats, { exterior: ext, full, triangles: tris, bytes, loading: this.jobs + this.queue.length + this.waiting.length, batches: this.batches.size, gpuMB: Math.round(gpu / 1e6), gpuUsedMB: Math.round(used / 1e6), pickMB: Math.round(pick / 1e6), instances: inst });
  }

  // ---- debug layers (objectId / lod / wireframe) -------------------------------------------
  setDebug(mode) {
    const m = mode && mode !== 'none' ? mode : null;
    if (m === this._debug) return;
    this._debug = m;
    for (const B of this.batches.values()) if (B.ready) this._applyDebugBatch(B);
    if (m) for (const rec of this.recs.values()) for (const e of rec.entries) this._tagEntry(rec, e);
    if (m !== 'wireframe') for (const id of [...this.wire.keys()]) this._dropWire(id);
  }
  _applyDebugBatch(B) {
    const mode = this._debug;
    if (!mode) { B.batch.material = B.mat; B.batch.castShadow = B.castShadow; return; }
    if (!B.debugMat) B.debugMat = batchDebugMaterial(B.batch);
    B.debugMat.uniforms.uMode.value = mode === 'objectId' ? 0 : mode === 'lod' ? 1 : 2;
    B.batch.material = B.debugMat;
    B.batch.castShadow = false;
  }
  _tagEntry(rec, e) {
    let r = 0.7, g = 0.7, b = 0.7;
    if (this._debug === 'objectId') { const c = _col.setHSL(((rec.spec.hash >>> 0) % 997) / 997, 0.75, 0.55); r = c.r; g = c.g; b = c.b; }
    else if (this._debug === 'lod') { if (rec.lod === 'full') { r = 1; g = 0.48; b = 0.1; } else { r = 0.18; g = 0.83; b = 0.42; } }
    e.batch.setPartTag(e.slot, r, g, b);
  }
  /** debug 'wireframe': triangle edges of the nearest detailed buildings (from the pick copy) */
  updateWire(frame) {
    if (this._debug !== 'wireframe') return;
    const cam = frame.camEcef;
    const list = [...this.recs.values()].filter((r) => r.entries.length && r.pick).map((r) => ({ r, d: Math.hypot(r.originEcef.x - cam.x, r.originEcef.y - cam.y, r.originEcef.z - cam.z) })).sort((a, b) => a.d - b.d).slice(0, this.cfg.wireBuildings);
    const keep = new Set(list.map((x) => x.r.id));
    for (const id of [...this.wire.keys()]) if (!keep.has(id)) this._dropWire(id);
    const t0 = performance.now();
    for (const { r } of list) {
      if (this.wire.has(r.id)) continue;
      if (performance.now() - t0 > 6) break;
      const w = wireOf(r.pick);
      w.matrixAutoUpdate = false; w.frustumCulled = false; w.name = 'city-wire:' + r.id;
      this.wire.set(r.id, w);
      this.group.add(w);
      this._placeWire(r, w);
    }
  }
  _placeWire(rec, w) { this.matrixOf(rec, w.matrix); w.matrixWorld.copy(w.matrix); }
  _dropWire(id) { const w = this.wire.get(id); if (!w) return; this.group.remove(w); w.geometry.dispose(); this.wire.delete(id); }
}

const _col = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// pick copy: positions + local indices of the drawn parts, chunk boxes (worker or main thread)
// ---------------------------------------------------------------------------------------------
const CHUNK = 64;
/**
 * Compact pick copy of a detailed building (building frame): positions quantised to 16 bits over the
 * building bounds (≤ 3 mm for a 200 m building), indices 16-bit per part where the part has < 65536
 * vertices; 64-triangle chunk boxes from the worker (or computed here). ≈ 6 B / vertex + 6 B / triangle.
 */
function makePick(parts, chunks, bounds) {
  const mn = bounds.min, mx = bounds.max;
  const ox = mn[0] - 0.05, oy = mn[1] - 0.05, oz = mn[2] - 0.05;
  const sx = Math.max(1e-4, (mx[0] - mn[0] + 0.1) / 65535), sy = Math.max(1e-4, (mx[1] - mn[1] + 0.1) / 65535), sz = Math.max(1e-4, (mx[2] - mn[2] + 0.1) / 65535);
  let boxes, meta;
  if (chunks && chunks.boxes && chunks.meta && chunks.meta.length / 3 === chunks.boxes.length / 6) { boxes = chunks.boxes; meta = chunks.meta; }
  else {
    let nc = 0; for (const p of parts) nc += Math.ceil(p.idx.length / 3 / CHUNK);
    boxes = new Float32Array(nc * 6); meta = new Uint32Array(nc * 3);
    let c = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const P = parts[pi].pos, I = parts[pi].idx, nt = I.length / 3;
      for (let t0 = 0; t0 < nt; t0 += CHUNK) {
        const t1 = Math.min(nt, t0 + CHUNK);
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let k = t0 * 3; k < t1 * 3; k++) { const v = I[k] * 3, x = P[v], y = P[v + 1], z = P[v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        boxes.set([x0, y0, z0, x1, y1, z1], c * 6); meta[c * 3] = pi; meta[c * 3 + 1] = t0; meta[c * 3 + 2] = t1 - t0; c++;
      }
    }
  }
  let bytes = boxes.byteLength + meta.byteLength;
  const qparts = parts.map((p) => {
    const P = p.pos, n = P.length / 3;
    const q = new Uint16Array(P.length);
    for (let k = 0; k < n; k++) {
      const o = k * 3;
      q[o] = Math.round((P[o] - ox) / sx); q[o + 1] = Math.round((P[o + 1] - oy) / sy); q[o + 2] = Math.round((P[o + 2] - oz) / sz);
    }
    const idx = n <= 65535 ? Uint16Array.from(p.idx) : p.idx.slice();
    bytes += q.byteLength + idx.byteLength;
    return { q, idx };
  });
  return {
    parts: qparts, boxes, meta, bytes, ox, oy, oz, sx, sy, sz,
    cx: (mn[0] + mx[0]) / 2, cy: (mn[1] + mx[1]) / 2, cz: (mn[2] + mx[2]) / 2, r: 0.5 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) + 0.1,
  };
}

/** nearest triangle hit (two-sided) of a building-frame ray; null if none closer than maxT */
function pickRay(pk, o, d, maxT) {
  const B = pk.boxes, Mt = pk.meta, nc = Mt.length / 3;
  const ix = 1 / (Math.abs(d[0]) > 1e-12 ? d[0] : 1e-12), iy = 1 / (Math.abs(d[1]) > 1e-12 ? d[1] : 1e-12), iz = 1 / (Math.abs(d[2]) > 1e-12 ? d[2] : 1e-12);
  let best = maxT, hit = false;
  for (let c = 0; c < nc; c++) {
    const b = c * 6;
    let t0 = 0, t1 = best, a, e;
    a = (B[b] - 0.01 - o[0]) * ix; e = (B[b + 3] + 0.01 - o[0]) * ix; if (a > e) { const q = a; a = e; e = q; } if (a > t0) t0 = a; if (e < t1) t1 = e; if (t0 > t1) continue;
    a = (B[b + 1] - 0.01 - o[1]) * iy; e = (B[b + 4] + 0.01 - o[1]) * iy; if (a > e) { const q = a; a = e; e = q; } if (a > t0) t0 = a; if (e < t1) t1 = e; if (t0 > t1) continue;
    a = (B[b + 2] - 0.01 - o[2]) * iz; e = (B[b + 5] + 0.01 - o[2]) * iz; if (a > e) { const q = a; a = e; e = q; } if (a > t0) t0 = a; if (e < t1) t1 = e; if (t0 > t1) continue;
    const part = pk.parts[Mt[c * 3]], Q = part.q, I = part.idx;
    const k0 = Mt[c * 3 + 1] * 3, k1 = k0 + Mt[c * 3 + 2] * 3;
    const qox = pk.ox, qoy = pk.oy, qoz = pk.oz, qsx = pk.sx, qsy = pk.sy, qsz = pk.sz;
    for (let k = k0; k < k1; k += 3) {
      const va = I[k] * 3, vb = I[k + 1] * 3, vc = I[k + 2] * 3;
      const ax = qox + Q[va] * qsx, ay = qoy + Q[va + 1] * qsy, az = qoz + Q[va + 2] * qsz;
      const e1x = qox + Q[vb] * qsx - ax, e1y = qoy + Q[vb + 1] * qsy - ay, e1z = qoz + Q[vb + 2] * qsz - az;
      const e2x = qox + Q[vc] * qsx - ax, e2y = qoy + Q[vc + 1] * qsy - ay, e2z = qoz + Q[vc + 2] * qsz - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
      const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t >= 0 && t < best) { best = t; hit = true; }
    }
  }
  return hit ? best : null;
}

/** debug wireframe of a pick copy (all triangle edges) */
function wireOf(pk) {
  let nv = 0, ni = 0;
  for (const p of pk.parts) { nv += p.q.length / 3; ni += p.idx.length * 2; }
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of pk.parts) {
    const Q = p.q;
    for (let k = 0; k < Q.length; k += 3) { const o = vo * 3 + k; pos[o] = pk.ox + Q[k] * pk.sx; pos[o + 1] = pk.oy + Q[k + 1] * pk.sy; pos[o + 2] = pk.oz + Q[k + 2] * pk.sz; }
    const I = p.idx;
    for (let k = 0; k < I.length; k += 3) { const a = I[k] + vo, b = I[k + 1] + vo, c = I[k + 2] + vo; idx[io++] = a; idx[io++] = b; idx[io++] = b; idx[io++] = c; idx[io++] = c; idx[io++] = a; }
    vo += Q.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // bounds before the CPU arrays go (GPU only once uploaded)
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.attributes.position.onUpload(function () { this.array = null; });
  g.index.onUpload(function () { this.array = null; });
  const line = new THREE.LineSegments(g, WIRE_MAT);
  line.raycast = () => {};   // no CPU geometry: never part of three's Raycaster
  return line;
}
const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x9fe8b0 });
WIRE_MAT.name = 'city:debug-wire';

// ---------------------------------------------------------------------------------------------
// debug material of a batch (objectId hue / lod colour per instance from the batch tag texture)
// ---------------------------------------------------------------------------------------------
function batchDebugMaterial(batch) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTag: { value: batch.tagTexture() }, uTagW: { value: batch.tagTexture().image.width }, uMode: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <batching_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      uniform sampler2D uTag;
      uniform float uTagW;
      varying vec3 vTag;
      varying vec3 vNw;
      void main() {
        #include <batching_vertex>
        vec4 p = vec4(position, 1.0);
        mat3 m3 = mat3(modelMatrix);
        vTag = vec3(0.7);
        #ifdef USE_BATCHING
          p = batchingMatrix * p;
          m3 = m3 * mat3(batchingMatrix);
          int id = int(getIndirectIndex(gl_DrawID));
          int w = int(uTagW);
          vTag = texelFetch(uTag, ivec2(id - (id / w) * w, id / w), 0).rgb;
        #endif
        vNw = normalize(m3 * normal);
        gl_Position = projectionMatrix * modelViewMatrix * p;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uMode;
      varying vec3 vTag;
      varying vec3 vNw;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 c = uMode > 1.5 ? vec3(0.32, 0.36, 0.4) : vTag;
        float l = 0.62 + 0.38 * abs(normalize(vNw).y);
        gl_FragColor = vec4(c * l * 1.6, 1.0);
      }`,
  });
  m.name = 'city:batch-debug';
  return m;
}
