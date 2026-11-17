// Streets & ground at close range (main thread side): requests 'cityStreets' worker jobs for the
// displayed city tiles near the camera and draws every tile's parts through GPU-only batches
// (batch.js: one THREE.BatchedMesh per street material, per-instance tile matrix relative to the
// detail batches' camera-near anchor) — no CPU copy of the drawn geometry, a few draw calls for all
// street tiles; offers kerb / sidewalk / step / bridge-deck colliders for walking. OWNER: city agent.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { origin } from '../../core/origin.js';
import { getStreetMaterial, refreshStreetMaterials, streetMaterialsReady, STREET_CAST } from './streetMaterials.js';
import { whenCompiled } from './detail.js';
import { GpuBatch, partSchema, schemaKey } from './batch.js';

export const STREET_CFG = { maxDist: 1300, keepDist: 1700, uploadMs: 5 };
const _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();

export class StreetManager {
  constructor(city) {
    this.city = city;
    this.app = city.app;
    this.cfg = { ...STREET_CFG };
    this.group = new THREE.Group();
    this.group.name = 'city-streets';
    this.group.matrixAutoUpdate = false;
    this.recs = new Map();     // tile key -> {tile, job, entries, collider, state, M}
    this.queue = [];
    this.waiting = [];
    this.batches = new Map();  // schema key -> {batch, ready, mat}
    this.compiling = 0;
    this.stats = { tiles: 0, triangles: 0, loading: 0, batches: 0 };
    this._debug = 'none';
    this._anchorKey = '';
  }

  update(frame, tiles) {
    const cfg = this.cfg;
    if (this._matsReady && this._matsPending !== false && this.city.frameNo % 20 === 0) this._matsPending = refreshStreetMaterials();
    for (const t of tiles) {
      if (!t.data) continue;
      let r = this.recs.get(t.key);
      if (t.dist < cfg.maxDist && !r) { r = { tile: t, state: 'empty', entries: [] }; this.recs.set(t.key, r); }
      if (!r) continue;
      if (r.state === 'empty' && t.dist < cfg.maxDist) this._request(r, t.dist);
      else if (r.state === 'loading' && r.job) r.job.priority = 110 + t.dist / 6;
    }
    // upload (once the street materials carry their final textures, or after 25 s without them)
    if (this.queue.length && !this._matsReady) {
      if (this._waitT0 === undefined) this._waitT0 = performance.now();
      if ((this.city.frameNo % 15 === 0 && streetMaterialsReady(this.app)) || performance.now() - this._waitT0 > 25000) this._matsReady = true;
    }
    const t0 = performance.now();
    if (this.waiting.length) {
      const still = [];
      for (const w of this.waiting) { if (w.parts.every((p) => p.B.ready) && performance.now() - t0 < cfg.uploadMs) this._attach(w); else still.push(w); }
      this.waiting = still;
    }
    while (this._matsReady && this.queue.length && performance.now() - t0 < cfg.uploadMs) this._install(this.queue.shift());
    // release
    for (const [k, r] of this.recs) {
      const t = r.tile;
      if (!t.displayed || t.dist > cfg.keepDist) {
        if (r.state === 'loading' && r.job && !r.job.started) { try { r.job.cancel(); } catch { /* */ } }
        this._dispose(r); this.recs.delete(k); continue;
      }
    }
    this.place();
  }

  /** batches follow the detail anchor; instance matrices = tile frame relative to it */
  place() {
    const A = this.city.detail.anchor;
    if (!A) return;
    const key = A.x + ',' + A.y + ',' + A.z;
    const rebase = key !== this._anchorKey;
    this._anchorKey = key;
    for (const B of this.batches.values()) {
      B.batch.position.set(A.x - origin.x, A.y - origin.y, A.z - origin.z);
      B.batch.updateMatrix(); B.batch.updateMatrixWorld(true);
    }
    if (rebase) for (const r of this.recs.values()) if (r.entries.length) this._placeRec(r);
  }
  _placeRec(r) {
    const A = this.city.detail.anchor, o = r.origin;
    if (!A || !o) return;
    r.M = r.M || new THREE.Matrix4();
    r.M.compose(_v.set(o.x - A.x, o.y - A.y, o.z - A.z), r.tile.quat, _one);
    for (const e of r.entries) e.batch.setPartMatrix(e.slot, r.M);
  }

  _request(r, dist) {
    const t = r.tile, d = t.data, w = this.city.pool;
    if (!w) return;
    r.state = 'loading';
    const payload = { key: t.key, face: t.face, x: t.x, y: t.y, level: t.level, h0: t.h0, center: d.center, roads: d.roads, areas: d.areas, rails: d.rails, docks: d.docks, stations: d.stations, stationTracks: this._stationTracks(t) };
    const job = w.submit('cityStreets', payload, { priority: 110 + dist / 6 });
    r.job = job;
    job.promise.then((res) => { if (r.job !== job) return; r.job = null; this.queue.push({ r, res }); }, (err) => {
      if (r.job !== job) return; r.job = null; r.state = err?.cancelled ? 'empty' : 'failed';
      if (!err?.cancelled) console.warn('[city] streets failed', t.key, err);
    });
  }

  /**
   * Station buildings whose platforms may reach this tile's rails (the tile and its 8 neighbours,
   * when loaded): the track bed drops parapets and ends at the platform edges along them (D1).
   */
  _stationTracks(t) {
    const out = [];
    const city = this.city;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${t.face}/${t.level}/${t.x + dx}/${t.y + dy}`;
      const n = city.tilesMap.get(k);
      if (!n || !n.data || !n.data.stations || !n.byId) continue;
      for (const st of n.data.stations) {
        const bi = st.buildingId != null ? n.byId.get(st.buildingId) : undefined;
        const spec = bi !== undefined ? n.data.buildings[bi] : null;
        if (!spec) continue;
        const m = spec.meta || {};
        out.push({ id: st.id, lat: spec.lat, lon: spec.lon, heading: spec.heading || 0, w: (spec.footprint && spec.footprint.w) || st.platformLength || 60, d: (spec.footprint && spec.footprint.d) || 26, entrance: (spec.ground && spec.ground.entrance) || 0, trackOffset: Number.isFinite(m.trackOffset) ? m.trackOffset : null, elevated: !!(m.elevated ?? st.elevated) });
      }
    }
    return out;
  }

  _batchFor(part) {
    const schema = partSchema(part);
    const key = schemaKey(part.material, schema);
    let B = this.batches.get(key);
    if (B) return B;
    const mat = getStreetMaterial(part.material, this.app);
    const batch = new GpuBatch(this.app.renderer, mat, schema, { vertices: 1 << 16, indices: 3 << 16, instances: 64 });
    batch.name = 'city-street-batch:' + part.material;
    batch.castShadow = STREET_CAST.has(part.material);
    batch.receiveShadow = true;
    B = { batch, ready: false, key, mat, castShadow: batch.castShadow };
    this.batches.set(key, B);
    this.compiling++;
    const done = () => { this.compiling--; B.ready = true; this.group.add(batch); this.place(); if (this._debug !== 'none') this._applyDebugBatch(B); };
    whenCompiled(this.app, batch, true).then(done, done);
    return B;
  }

  _install({ r, res }) {
    if (this.recs.get(r.tile.key) !== r || !res) return;
    const t = r.tile;
    r.origin = t.origin;
    const parts = [];
    for (const p of res.parts || []) {
      if (!p.index || !p.index.length || !p.position || p.position.length < 9) continue;
      let B;
      try { B = this._batchFor(p); } catch (e) { console.warn('[city] street batch failed', p.material, e); continue; }
      parts.push({ p, B });
    }
    if (res.colliders && res.colliders.index && res.colliders.index.length) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.BufferAttribute(res.colliders.position, 3));
      cg.setIndex(new THREE.BufferAttribute(res.colliders.index, 1));
      cg.boundsTree = res.colliderBVH ? MeshBVH.deserialize({ version: 1, roots: res.colliderBVH.roots, index: res.colliders.index, indirectBuffer: null }, cg, { setIndex: false }) : new MeshBVH(cg, { targetLeafSize: 10 });
      cg.computeBoundingSphere();
      const cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ visible: false }));
      cm.visible = false; cm.userData.isCollider = true;
      r.collider = cm;
      r.colliderR = 700;
    }
    r.state = 'compiling';
    const w = { r, parts };
    r.pending = w;
    if (parts.every((x) => x.B.ready)) this._attach(w); else this.waiting.push(w);
  }

  _attach(w) {
    const r = w.r;
    if (r.pending !== w || this.recs.get(r.tile.key) !== r) return;
    r.pending = null;
    let tris = 0;
    for (const { p, B } of w.parts) {
      const P = p.position;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < P.length; k += 3) { const x = P[k], y = P[k + 1], z = P[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const sphere = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 1.0];
      try {
        const slot = B.batch.addPart({ position: p.position, normal: p.normal, uv: p.uv, color: p.color }, p.index, P.length / 3, sphere, r.tile.key);
        r.entries.push({ batch: B.batch, slot });
        tris += p.index.length / 3;
      } catch (e) { console.warn('[city] street upload failed', r.tile.key, p.material, e); }
    }
    r.tris = tris; r.state = 'ready';
    this._placeRec(r);
    this.city.changed = true;
  }

  _dispose(r) {
    r.pending = null;
    for (const e of r.entries) e.batch.removePart(e.slot);
    r.entries = [];
    if (r.collider) { r.collider.geometry.boundsTree = null; r.collider.geometry.dispose(); r.collider = null; }
    r.state = 'empty';
  }

  hide(t) { const r = this.recs.get(t.key); if (r) { if (r.job) { try { r.job.cancel(); } catch { /* */ } } this._dispose(r); this.recs.delete(t.key); } }
  drop(t) { this.hide(t); }

  pending() {
    let n = this.queue.length + this.waiting.length + this.compiling;
    for (const r of this.recs.values()) if ((r.state === 'loading' || r.state === 'compiling') && r.tile.dist < 900) n++;
    return n;
  }

  colliders(near, radius, out) {
    for (const r of this.recs.values()) {
      if (!r.collider) continue;
      const o = r.origin;
      if (Math.hypot(o.x - near.x, o.y - near.y, o.z - near.z) > r.colliderR + radius) continue;
      out.push({ mesh: r.collider, anchorEcef: r.origin, quaternion: r.tile.quat, id: 'streets:' + r.tile.key });
    }
    return out;
  }

  setDebug(mode) { this._debug = mode || 'none'; for (const B of this.batches.values()) if (B.ready) this._applyDebugBatch(B); }
  _applyDebugBatch(B) {
    const mode = this._debug;
    if (mode === 'wireframe' || mode === 'lod') { B.batch.material = debugMat(mode); B.batch.castShadow = false; }
    else { B.batch.material = B.mat; B.batch.castShadow = B.castShadow; }
  }

  updateStats() {
    let n = 0, tris = 0, loading = 0;
    for (const r of this.recs.values()) { if (r.state === 'ready') { n++; tris += r.tris || 0; } else if (r.state === 'loading') loading++; }
    Object.assign(this.stats, { tiles: n, triangles: tris, loading, batches: this.batches.size });
  }
}

// flat debug colour for street batches (no wireframe: the drawn geometry has no CPU index)
const DM = {};
function debugMat(mode) {
  if (!DM[mode]) {
    const c = new THREE.Color(mode === 'lod' ? 0x8a8f98 : 0x5a6068);
    DM[mode] = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: c } },
      vertexShader: /* glsl */`
        #include <common>
        #include <batching_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNw;
        void main() {
          #include <batching_vertex>
          vec4 p = vec4(position, 1.0);
          mat3 m3 = mat3(modelMatrix);
          #ifdef USE_BATCHING
            p = batchingMatrix * p; m3 = m3 * mat3(batchingMatrix);
          #endif
          vNw = normalize(m3 * normal);
          gl_Position = projectionMatrix * modelViewMatrix * p;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        varying vec3 vNw;
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(uColor * (0.7 + 0.3 * abs(normalize(vNw).y)) * 1.4, 1.0);
        }`,
    });
    DM[mode].name = 'city:street-debug-' + mode;
  }
  return DM[mode];
}
