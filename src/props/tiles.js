// City-tile streaming of static props + near-tree LOD bucketing. OWNER: props agent.
// Tile data: 'city:tile' events (cache) or the shared pool's 'cityTile' job, then placement in the
// private props worker. Each ready tile owns a THREE.Group in its tile-local frame holding static
// InstancedMeshes (impostors, shrubs, lamps, glows, light pools, furniture, parked vehicles).
// Near trees (3D LOD0 / LOD1) are re-bucketed into global InstancedMeshes in an anchor frame.
import * as THREE from 'three';
import { R, CITY_TILE_LEVEL } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { tileAt, tileKey, latLonToUnit } from '../core/geo.js';
import { getControlMaps } from '../data/controlMaps.js';
import { tileFrame, frameToEcef, ecefToFrame, pointFrame, frameUnit, clamp, smooth } from './util.js';
import { SPECIES, lampModelFor } from './models.js';
import { GRID_N, GRID_STEP, GRID_HALF } from './place.js';

/** local ground y of a placement height grid (bilinear, as place.js groundY) */
function gridY(grid, x, z) {
  let fi = (x + GRID_HALF) / GRID_STEP, fj = (z + GRID_HALF) / GRID_STEP;
  fi = clamp(fi, 0, GRID_N - 1.0001); fj = clamp(fj, 0, GRID_N - 1.0001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, o = j * GRID_N + i;
  return (grid[o] * (1 - u) + grid[o + 1] * u) * (1 - v) + (grid[o + GRID_N] * (1 - u) + grid[o + GRID_N + 1] * u) * v;
}

export const LOD = { L0: 70, B0: 10, L1: 380, B1: 45, IMP_FAR: 1700, IMP_FADE: 250 };
const TILE_HALF = 330;

// leaf tint palettes per species (summer), autumn colour for deciduous species
const AUTUMN = [0.78, 0.48, 0.16];

function basisQuat(F) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.E), new THREE.Vector3(...F.U), new THREE.Vector3(...F.S));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

class TileRec {
  constructor(key, face, x, y) {
    this.key = key; this.face = face; this.x = x; this.y = y;
    this.F = tileFrame(face, x, y);
    this.quat = basisQuat(this.F);
    this.state = 'new';           // new -> city -> place -> ready | failed
    this.group = null; this.meshes = []; this.place = null; this.city = null;
    this.dist = 1e9; this.lastWanted = 0;
    this.seatT = 0; this.seatC = 0; this.seatPhase = (x * 3 + y * 5) & 7;   // displayed-terrain seat offset (m)
  }
}

export class TileProps {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.tiles = new Map();
    this.cityCache = new Map();          // key -> CityTileData from 'city:tile' events
    this.root = new THREE.Group(); this.root.name = 'props-tiles';
    this.nearRoot = new THREE.Group(); this.nearRoot.name = 'props-near-trees';
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this.pending = 0; this.cityJobs = 0;
    this.version = 0;               // bumps when the set of ready tiles changes
    this.seatVersion = 0;           // bumps when any tile's seat offset changes
    this._nearKey = '';
    this.near = null;
    this.worker = null; this.workerReady = false; this.nextId = 1; this.waiting = new Map();
    this.radius = 900;
    this.enabled = true;
    this.privateGen = true;
  }

  init() {
    this.app.scene.add(this.root);
    this.app.scene.add(this.nearRoot);
    // private placement workers
    this.workers = [];
    const maps = getControlMaps();
    for (let i = 0; i < 3; i++) {
      const w = new Worker(new URL('./props.worker.js', import.meta.url), { type: 'module', name: `props-${i}` });
      w.busy = 0;
      w.onmessage = (e) => this._onWorker(w, e.data);
      w.onerror = (e) => console.error('[props worker]', e.message || e);
      w.postMessage({ type: 'init', maps });
      this.workers.push(w);
    }
    this.app.events.on('city:tile', (e) => {
      const d = e && (e.data || e.tile?.data);
      const key = d && d.key;
      if (!key) return;
      // fix round 3 (memory): props place tiles within ~2 km only (and city.tileData() serves every streamed tile), so
      // keep near announcements only, most recent last, 96 at most (was the last 400 of the ~19 km disc, ~1 MB each)
      const td = e.tile && e.tile.dist;
      if (Number.isFinite(td) && td > 4000) return;
      this.cityCache.delete(key);
      this.cityCache.set(key, d);
      if (this.cityCache.size > 96) { const k = this.cityCache.keys().next().value; this.cityCache.delete(k); }
    });
    this._buildNear();
  }

  // -------------------------------------------------------------------------------------------
  // streaming
  // -------------------------------------------------------------------------------------------
  wantedTiles(frame) {
    const camAlt = Math.max(0, frame.camAltGround);
    if (camAlt > 3600) return [];
    const rad = clamp(900 + camAlt * 0.9, 900, 1800);
    this.radius = rad;
    const g = frame.camEcef, l = Math.hypot(g.x, g.y, g.z) || 1;
    const ux = g.x / l, uy = g.y / l, uz = g.z / l;
    const P = pointFrame(g.x, g.y, g.z);
    const out = new Map();
    const step = 300;
    const n = Math.ceil(rad / step);
    const T = {};
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const dx = i * step, dz = j * step;
      if (dx * dx + dz * dz > (rad + 300) * (rad + 300)) continue;
      const px = ux + (P.E[0] * dx + P.S[0] * dz) / R, py = uy + (P.E[1] * dx + P.S[1] * dz) / R, pz = uz + (P.E[2] * dx + P.S[2] * dz) / R;
      tileAt(px, py, pz, CITY_TILE_LEVEL, T);
      const key = tileKey(T.face, CITY_TILE_LEVEL, T.x, T.y);
      if (!out.has(key)) out.set(key, { key, face: T.face, x: T.x, y: T.y });
    }
    return [...out.values()];
  }

  /** distance from the camera to a tile (its ground surface, not the sea-level frame origin) */
  _tileDist(t, cam, gy) {
    const F = t.F, y = t.gy ?? gy;
    return Math.max(0, Math.hypot(F.ox + F.U[0] * y - cam.x, F.oy + F.U[1] * y - cam.y, F.oz + F.U[2] * y - cam.z) - TILE_HALF);
  }

  stream(frame) {
    const want = this.wantedTiles(frame);
    const now = frame.frameNo;
    const cam = frame.camEcef;
    this.camGround = frame.camAlt - frame.camAltGround;
    for (const w of want) {
      let t = this.tiles.get(w.key);
      if (!t) { t = new TileRec(w.key, w.face, w.x, w.y); this.tiles.set(w.key, t); }
      t.lastWanted = now;
      t.dist = this._tileDist(t, cam, this.camGround);
    }
    // request: nearest first, a few at a time
    const queue = [...this.tiles.values()].filter((t) => t.state === 'new' && t.lastWanted === now).sort((a, b) => a.dist - b.dist);
    let started = 0;
    for (const t of queue) {
      if (this.cityJobs >= 3 || this.pending >= 9 || started >= 4) break;
      if (this._requestCity(t, now)) started++;
    }
    // drop tiles no longer wanted (hysteresis: a few seconds)
    for (const [k, t] of this.tiles) {
      if (now - t.lastWanted > 240 && t.state !== 'city' && t.state !== 'place') { this._disposeTile(t); this.tiles.delete(k); this.version++; }
    }
  }

  _requestCity(t, now) {
    // 1) the city streamer's data (same CityTileData, no duplicate generation)
    const city = this.app.systems && this.app.systems.city;
    let cached = this.cityCache.get(t.key) || null;
    if (!cached && city && typeof city.tileData === 'function') { try { cached = city.tileData(t.key); } catch (e) { cached = null; } }
    if (cached && cached.key === t.key) { t.state = 'place'; this._place(t, cached); return true; }
    // 2) the city is generating this tile right now: wait a little for it
    // (the city streams every tile near the camera; generating it twice under load only delays both)
    const ct = city && city.tilesMap && city.tilesMap.get ? city.tilesMap.get(t.key) : null;
    if (ct && (ct.state === 'loading' || ct.state === 'empty' || ct.state === 'ready')) {
      const ms = performance.now();
      if (t.waitSince === undefined) t.waitSince = ms;
      if (ms - t.waitSince < 25000) return false;
    }
    // 3) generate it ourselves in the private props workers (the shared pool is busy with terrain /
    //    city mass jobs; generateCityTile is deterministic, so the data is identical)
    if (this.privateGen) { t.state = 'place'; this._place(t, null); return true; }
    t.state = 'city';
    this.cityJobs++;
    let job;
    try { job = this.app.workers.submit('cityTile', { face: t.face, x: t.x, y: t.y }, { priority: 150 + t.dist / 40 }); }
    catch (e) { this.cityJobs--; t.state = 'place'; this._place(t, null); return true; }
    t.job = job;
    job.promise.then((res) => {
      this.cityJobs--; t.job = null;
      const data = (res && (res.data || res.city || res)) || null;
      if (!this.tiles.has(t.key)) return;
      t.state = 'place';
      this._place(t, data && data.key ? data : null);
    }).catch((e) => {
      this.cityJobs--; t.job = null;
      if (e && e.cancelled) { t.state = 'new'; return; }
      if (!this.tiles.has(t.key)) return;
      t.state = 'place'; this._place(t, null);
    });
    return true;
  }

  _place(t, data) {
    const w = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
    const id = this.nextId++;
    w.busy++;
    this.pending++;
    this.waiting.set(id, t);
    w.postMessage({ type: 'tile', id, face: t.face, x: t.x, y: t.y, data: data ? slimCity(data) : null });
  }

  /** G01 boat layout from a props worker (callback once) */
  requestG01(cb) {
    this._g01cb = cb;
    const w = this.workers && this.workers[this.workers.length - 1];
    if (w) w.postMessage({ type: 'g01' }); else cb(null);
  }

  /** ferry network around a unit vector (props worker, harbour.js ferryNetwork); cb(net | null) */
  requestFerries(u, radius, cb) {
    const w = this.workers && this.workers[0];
    if (!w) { cb(null); return; }
    this._ferryReq = (this._ferryReq || 0) + 1;
    this._ferryCb = cb;
    w.postMessage({ type: 'ferries', req: this._ferryReq, x: u.x, y: u.y, z: u.z, radius });
  }

  _onWorker(w, m) {
    if (m.type === 'ready') return;
    if (m.type === 'ferries') { if (m.error) console.warn('[props] ferry network', m.error); if (m.req === this._ferryReq) { try { this._ferryCb?.(m.net); } catch (e) { console.error('[props] ferry network', e); } } return; }
    if (m.type === 'g01') { if (m.error) console.warn('[props] G01 layout', m.error); try { this._g01cb?.(m.layout); } catch (e) { console.error('[props] G01 layout', e); } return; }
    w.busy = Math.max(0, w.busy - 1);
    this.pending = Math.max(0, this.pending - 1);
    const t = this.waiting.get(m.id); this.waiting.delete(m.id);
    if (!t) return;
    if (!m.ok) { console.warn('[props] tile failed', t.key, m.error); t.state = 'failed'; return; }
    if (!this.tiles.has(t.key) || this.tiles.get(t.key) !== t) return;
    t.place = m.result.place; t.city = m.result.city;
    { const G = t.place.grid; let sum = 0; for (let i = 0; i < G.length; i++) sum += G[i]; t.gy = G.length ? sum / G.length : 0; }
    try { this._buildTile(t); } catch (e) { console.error('[props] build tile', t.key, e); t.state = 'failed'; return; }
    t.state = 'ready';
    this.version++;
    this.sys.onTileReady?.(t);
  }

  isIdle() {
    if (this.pending > 0 || this.cityJobs > 0) return false;
    for (const t of this.tiles.values()) if (t.state === 'new' || t.state === 'city' || t.state === 'place') return false;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // per-tile static meshes
  // -------------------------------------------------------------------------------------------
  _inst(geo, mat, n, group, opts = {}) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.castShadow = !!opts.cast; mesh.receiveShadow = opts.receive !== false;
    mesh.frustumCulled = opts.cull !== false;
    if (opts.depth) mesh.customDepthMaterial = opts.depth;
    group.add(mesh);
    return mesh;
  }

  _buildTile(t) {
    const P = t.place, L = this.sys.lib, mats = this.sys.mats;
    const g = new THREE.Group(); g.name = 'props-tile-' + t.key;
    g.quaternion.copy(t.quat);
    t.group = g;
    t.parts = {};
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const season = this.sys.season;
    // ---- tree impostors ----
    const tr = P.trees, nT = tr.length / 8;
    if (nT > 0) {
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, L.impQuad.getAttribute(k).clone());
      geo.setIndex(L.impQuad.getIndex().clone());
      const aImp = new Float32Array(nT * 4);
      geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(aImp, 4));
      const mesh = this._inst(geo, mats.get('impostor'), nT, g, { cast: false, cull: true });
      for (let i = 0; i < nT; i++) {
        const o = i * 8, sp = tr[o + 5] | 0, sc = tr[o + 4];
        const cell = L.impCell[sp];
        const S = cell.size * sc;
        m4.makeScale(S, S, S); m4.setPosition(tr[o], tr[o + 1] - 0.05 * sc, tr[o + 2]);
        mesh.setMatrixAt(i, m4);
        aImp[i * 4] = cell.u0; aImp[i * 4 + 1] = cell.v0; aImp[i * 4 + 2] = tr[o + 6]; aImp[i * 4 + 3] = 0;
        treeColor(sp, tr[o + 6], (tr[o + 7] & 2) !== 0, season, col, true);
        mesh.setColorAt(i, col);
      }
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 15;
      t.parts.impostor = mesh;
    }
    // ---- shrubs ----
    const sh = P.shrubs, nS = sh.length / 6;
    if (nS > 0) {
      const byKind = [[], [], []];
      for (let i = 0; i < nS; i++) byKind[Math.min(2, sh[i * 6 + 5] | 0)].push(i);
      t.parts.shrubs = [];
      for (let k = 0; k < 3; k++) {
        const ids = byKind[k]; if (!ids.length) continue;
        const geoS = L.shrubs[k];
        const mc = this._inst(geoS.core, mats.get('shrubCore'), ids.length, g, { cast: true });
        const ml = this._inst(geoS.leaf, mats.get('shrubLeaf'), ids.length, g, { cast: true, depth: mats.depth.shrub });
        ids.forEach((i, n) => {
          const o = i * 6;
          q.setFromAxisAngle(yAxis, sh[o + 3]); s3.setScalar(sh[o + 4]); p3.set(sh[o], sh[o + 1], sh[o + 2]);
          m4.compose(p3, q, s3); mc.setMatrixAt(n, m4); ml.setMatrixAt(n, m4);
        });
        mc.computeBoundingSphere(); ml.computeBoundingSphere();
        t.parts.shrubs.push(mc, ml);
      }
    }
    // ---- lamps ----
    const lp = P.lamps, nL = lp.length / 8;
    if (nL > 0) {
      const byModel = L.lamps.map(() => []);
      for (let i = 0; i < nL; i++) { const o = i * 8; byModel[lampModelFor(lp[o + 4], lp[o + 5], lp[o + 6], lp[o + 7] > 0.5)].push(i); }
      t.parts.lamps = [];
      const glowPts = [];
      for (let mi = 0; mi < byModel.length; mi++) {
        const ids = byModel[mi]; if (!ids.length) continue;
        const G = L.lamps[mi];
        const meshes = ['metal', 'paint', 'lampHead'].map((k) => this._inst(G[k], mats.get(k), ids.length, g, { cast: k !== 'lampHead' }));
        ids.forEach((i, n) => {
          const o = i * 8;
          q.setFromAxisAngle(yAxis, lp[o + 3]); s3.setScalar(1); p3.set(lp[o], lp[o + 1], lp[o + 2]);
          m4.compose(p3, q, s3);
          for (const m of meshes) m.setMatrixAt(n, m4);
          // head positions for glows / pools
          const heads = mi === 3 ? [1, -1] : [1];
          for (const sgn of heads) {
            const ax = mi === 4 ? 0 : (G.armX + 0.25) * sgn;
            const hx = lp[o] + Math.sin(lp[o + 3]) * ax, hz = lp[o + 2] + Math.cos(lp[o + 3]) * ax;
            glowPts.push(hx, lp[o + 1] + G.headY - 0.12, hz, lp[o + 1], mi === 4 ? 4.5 : G.H * 1.05, mi === 4 ? 0.55 : 1);
          }
        });
        for (const m of meshes) m.computeBoundingSphere();
        t.parts.lamps.push(...meshes);
      }
      // glow sprites (night)
      const nG = glowPts.length / 6;
      const ggeo = new THREE.BufferGeometry();
      ggeo.setAttribute('position', L.sprite.getAttribute('position').clone()); ggeo.setIndex(L.sprite.getIndex().clone());
      const aG = new Float32Array(nG * 4);
      ggeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(aG, 4));
      const gm = this._inst(ggeo, mats.glow, nG, g, { cast: false, receive: false });
      const pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute('position', L.pool.getAttribute('position').clone()); pgeo.setIndex(L.pool.getIndex().clone());
      const aP = new Float32Array(nG * 4);
      pgeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(aP, 4));
      const pm = this._inst(pgeo, mats.pool, nG, g, { cast: false, receive: false });
      for (let i = 0; i < nG; i++) {
        const o = i * 6;
        m4.makeTranslation(glowPts[o], glowPts[o + 1], glowPts[o + 2]); gm.setMatrixAt(i, m4);
        const k = glowPts[o + 5];
        // lens glow: small (the lens mesh itself is visible near the camera; the sprite keeps far lamps >= 2 px)
        // neutral-warm ~3800 K LED (the dusk boulevard read too orange with 2700 K pools)
        aG[i * 4] = 140 * k; aG[i * 4 + 1] = 124 * k; aG[i * 4 + 2] = 104 * k; aG[i * 4 + 3] = 0.2;
        m4.makeTranslation(glowPts[o], glowPts[o + 3] + 0.14, glowPts[o + 2]); pm.setMatrixAt(i, m4);
        // ground pool: subtle (peak ~0.3 window units, D3: 1.0 = one lit window); the asphalt under a
        // street lamp is far dimmer than a lit window, the pool only marks where the lamps are
        // (fix round 2: the near lamps carry real SpotLights, lights.js; decals carry the farther streets)
        aP[i * 4] = 0.42 * k; aP[i * 4 + 1] = 0.37 * k; aP[i * 4 + 2] = 0.3 * k; aP[i * 4 + 3] = glowPts[o + 4] * 0.85;
      }
      gm.computeBoundingSphere(); pm.computeBoundingSphere();
      if (gm.boundingSphere) gm.boundingSphere.radius += 20;
      gm.renderOrder = 5; pm.renderOrder = 4;
      t.parts.glow = gm; t.parts.pool = pm;
      t.heads = new Float32Array(glowPts);              // [x, headY, z, groundY, poolR, k] for lights.js
    }
    // light bollards: small warm pools around their lens bands
    {
      const fu0 = P.furniture, nb = [];
      for (let i = 0; i < fu0.length; i += 6) if ((fu0[i + 4] | 0) === 1) nb.push(fu0[i], fu0[i + 1], fu0[i + 2]);
      if (nb.length) {
        const n = nb.length / 3;
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute('position', L.pool.getAttribute('position').clone()); pgeo.setIndex(L.pool.getIndex().clone());
        const aP = new Float32Array(n * 4);
        pgeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(aP, 4));
        const pm = this._inst(pgeo, mats.bpool, n, g, { cast: false, receive: false });
        for (let i = 0; i < n; i++) {
          m4.makeTranslation(nb[i * 3], nb[i * 3 + 1] + 0.05, nb[i * 3 + 2]); pm.setMatrixAt(i, m4);
          aP[i * 4] = 0.95; aP[i * 4 + 1] = 0.84; aP[i * 4 + 2] = 0.68; aP[i * 4 + 3] = 1.9;
        }
        pm.computeBoundingSphere(); pm.renderOrder = 4;
        t.parts.bpool = pm;
      }
    }
    // ---- furniture ----
    const fu = P.furniture, nF = fu.length / 6;
    if (nF > 0) {
      const byKind = L.furniture.map(() => []);
      for (let i = 0; i < nF; i++) byKind[Math.min(5, fu[i * 6 + 4] | 0)].push(i);
      t.parts.furniture = [];
      for (let k = 0; k < byKind.length; k++) {
        const ids = byKind[k]; if (!ids.length) continue;
        const parts = L.furniture[k];
        for (const [mk, geo] of Object.entries(parts)) {
          if (!geo || !geo.isBufferGeometry) continue;
          const m = this._inst(geo, mats.get(mk), ids.length, g, { cast: mk !== 'glassFurn' });
          ids.forEach((i, n) => {
            const o = i * 6;
            q.setFromAxisAngle(yAxis, fu[o + 3]); s3.setScalar(1); p3.set(fu[o], fu[o + 1], fu[o + 2]);
            m4.compose(p3, q, s3); m.setMatrixAt(n, m4);
          });
          m.computeBoundingSphere();
          t.parts.furniture.push(m);
        }
      }
    }
    // ---- parked vehicles ----
    const pk = P.parks, nP = pk.length / 5;
    if (nP > 0) {
      const byKind = [[], [], []];
      for (let i = 0; i < nP; i++) byKind[Math.min(2, pk[i * 5 + 4] | 0)].push(i);
      t.parts.parked = [];
      for (let k = 0; k < 3; k++) {
        const ids = byKind[k]; if (!ids.length) continue;
        for (const [mk, geo] of Object.entries(L.vehicles[k])) {
          if (!geo || !geo.isBufferGeometry || mk === 'headlight' || mk === 'taillight') continue;
          const m = this._inst(geo, mats.get(mk), ids.length, g, { cast: true });
          ids.forEach((i, n) => {
            const o = i * 5;
            q.setFromAxisAngle(yAxis, pk[o + 3]); s3.setScalar(1); p3.set(pk[o], pk[o + 1], pk[o + 2]);
            m4.compose(p3, q, s3); m.setMatrixAt(n, m4);
            if (mk === 'carBody') { vehicleColor(i * 7 + k, col, k); m.setColorAt(n, col); }
          });
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.computeBoundingSphere();
          t.parts.parked.push(m);
        }
      }
    }
    this.root.add(g);
  }

  _disposeTile(t) {
    if (t.job) { try { t.job.cancel(); } catch { /* */ } t.job = null; }
    if (t.group) {
      this.root.remove(t.group);
      t.group.traverse((o) => { if (o.isInstancedMesh) { o.dispose?.(); if (o.geometry && (o.geometry.getAttribute('aImp') || o.geometry.getAttribute('aGlow'))) o.geometry.dispose(); } });
    }
    t.group = null; t.place = null; t.city = null; t.heads = null;
  }

  /** per-frame: position groups, distance visibility, night glows */
  updateTiles(frame, night) {
    const cam = frame.camEcef;
    const showGlow = night > 0.002;
    const terr = this.app.systems && this.app.systems.terrain;
    const groundAt = terr && typeof terr.groundHeightAt === 'function' ? terr : null;
    const C = {}, Uq = {};
    const step = Math.max(0.01, 25 * Math.min(0.1, frame.dt || 0.016));
    for (const t of this.tiles.values()) {
      if (!t.group) continue;
      const F = t.F;
      // seat the tile on the DISPLAYED terrain like the city seats its buildings (render/city/tiles.js
      // seatSample): offset = displayed − true ground at the tile point nearest to the camera, sub-0.4 m
      // differences ignored, animated at 25 m/s. Zero once the terrain near the camera has refined.
      if (groundAt && t.place && ((frame.frameNo + t.seatPhase) & 7) === 0) {
        ecefToFrame(F, cam.x, cam.y, cam.z, C);
        const px = clamp(C.x, -TILE_HALF, TILE_HALF), pz = clamp(C.z, -TILE_HALF, TILE_HALF);
        const trueH = gridY(t.place.grid, px, pz) + (px * px + pz * pz) / (2 * R);
        frameUnit(F, px, pz, Uq);
        let gh = NaN;
        try { gh = groundAt.groundHeightAt(Math.asin(clamp(Uq.y, -1, 1)) * 180 / Math.PI, Math.atan2(Uq.x, Uq.z) * 180 / Math.PI); } catch (e) { gh = NaN; }
        const dd = Number.isFinite(gh) ? clamp(gh - trueH, -60, 60) : 0;
        t.seatT = Math.abs(dd) < 0.4 ? 0 : dd;
      }
      if (t.seatC !== t.seatT) {
        const dd = t.seatT - t.seatC;
        t.seatC = Math.abs(dd) <= step ? t.seatT : t.seatC + Math.sign(dd) * step;
        this.seatVersion++;
      }
      const sy = t.seatC;
      t.group.position.set(F.ox + F.U[0] * sy - origin.x, F.oy + F.U[1] * sy - origin.y, F.oz + F.U[2] * sy - origin.z);
      const d = this._tileDist(t, cam, this.camGround || 0);
      t.dist = d;
      const P = t.parts;
      const visNear = d < 520, visLamp = d < 1150;
      if (P.shrubs) for (const m of P.shrubs) m.visible = visNear;
      if (P.furniture) for (const m of P.furniture) m.visible = visNear;
      if (P.parked) for (const m of P.parked) m.visible = visNear;
      if (P.lamps) for (const m of P.lamps) m.visible = visLamp;
      if (P.glow) P.glow.visible = showGlow && d < 4000;
      if (P.pool) P.pool.visible = showGlow && d < 450;
      if (P.bpool) P.bpool.visible = showGlow && d < 300;
      if (P.impostor) P.impostor.visible = d < LOD.IMP_FAR + LOD.IMP_FADE;
    }
  }

  // -------------------------------------------------------------------------------------------
  // near trees: global InstancedMeshes per species x LOD x material (anchor frame)
  // -------------------------------------------------------------------------------------------
  _buildNear() {
    this.near = [];
    for (let s = 0; s < SPECIES.length; s++) {
      const lods = [];
      for (let l = 0; l < 2; l++) lods.push({ cap: 0, meshes: null, count: 0, fade: null });
      this.near.push(lods);
    }
  }

  _ensureCap(s, l, n) {
    const B = this.near[s][l];
    if (B.cap >= n && B.meshes) return B;
    const cap = Math.max(64, Math.ceil(n * 1.5));
    if (B.meshes) for (const m of B.meshes) { this.nearRoot.remove(m); m.dispose(); }
    const G = this.sys.lib.trees[s][l];
    const mats = this.sys.mats;
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    B.meshes = [['bark', G.bark], ['core', G.core], ['leaf', G.leaf]].map(([k, geo0]) => {
      const geo = new THREE.BufferGeometry();
      for (const [a, v] of Object.entries(geo0.attributes)) geo.setAttribute(a, v);
      geo.setIndex(geo0.getIndex());
      geo.setAttribute('aFade', fade);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const m = new THREE.InstancedMesh(geo, mats.get(k), cap);
      m.count = 0; m.frustumCulled = false;
      m.castShadow = true; m.receiveShadow = true;
      if (k === 'leaf') m.customDepthMaterial = mats.depth.leaf;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.userData.lod = l;
      this.nearRoot.add(m);
      return m;
    });
    B.fade = fade; B.cap = cap;
    return B;
  }

  /** re-bucket near trees when the camera moved enough or tiles changed */
  updateNear(frame, force = false) {
    const cam = frame.camEcef;
    if (frame.camAltGround > 3600) { this.nearRoot.visible = false; return; }
    this.nearRoot.visible = true;
    // anchor: recentre when the camera is > 1.5 km away
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 1500) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat = basisQuat(this.anchor);
      force = true;
    }
    const A = this.anchor;
    this.nearRoot.quaternion.copy(this.anchorQuat);
    this.nearRoot.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    // LOD cross-fades are dithered while the view moves; once it is still the LODs snap to hard
    // thresholds so the converged frame shows no screen-door pattern (sys.still, see index.js)
    const hard = this.sys.still;
    const key = `${Math.round(cam.x / 1.5)},${Math.round(cam.y / 1.5)},${Math.round(cam.z / 1.5)}|${this.version}|${this.seatVersion}|${this.sys.seasonKey}|${this.sys.debugKey}|${hard ? 1 : 0}`;
    if (!force && key === this._nearKey) return false;
    this._nearKey = key;
    const C = ecefToFrame(A, cam.x, cam.y, cam.z, {});
    const counts = this.near.map(() => [0, 0]);
    const lists = this.near.map(() => [[], []]);
    const maxD = LOD.L1 + LOD.B1;
    const E = {}, Lc = {};
    for (const t of this.tiles.values()) {
      if (t.state !== 'ready' || !t.place || t.dist > maxD + 50) continue;
      const tr = t.place.trees, n = tr.length / 8, F = t.F;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        frameToEcef(F, tr[o], tr[o + 1] + t.seatC, tr[o + 2], E);
        ecefToFrame(A, E.x, E.y, E.z, Lc);
        const dx = Lc.x - C.x, dy = Lc.y - C.y, dz = Lc.z - C.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxD) continue;
        const sp = tr[o + 5] | 0;
        const s01 = hard ? (d < LOD.L0 ? 0 : 1) : smooth(LOD.L0 - LOD.B0, LOD.L0 + LOD.B0, d);
        const s12 = hard ? (d < LOD.L1 ? 0 : 1) : smooth(LOD.L1 - LOD.B1, LOD.L1 + LOD.B1, d);
        if (s01 < 1) { lists[sp][0].push(t, o, Lc.x, Lc.y, Lc.z, 1 - s01); counts[sp][0]++; }
        if (s01 > 0 && s12 < 1) {
          const f = s01 < 1 ? -s01 : (1 - s12);
          lists[sp][1].push(t, o, Lc.x, Lc.y, Lc.z, f); counts[sp][1]++;
        }
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), white = new THREE.Color(1, 1, 1), barkC = new THREE.Color();
    const season = this.sys.season;
    const dbg = this.sys.debugMode;
    for (let s = 0; s < this.near.length; s++) for (let l = 0; l < 2; l++) {
      const n = counts[s][l];
      const B = n > 0 ? this._ensureCap(s, l, n) : this.near[s][l];
      if (!B.meshes) continue;
      const list = lists[s][l];
      for (let k = 0; k < n; k++) {
        const t = list[k * 6], o = list[k * 6 + 1];
        const tr = t.place.trees;
        q.setFromAxisAngle(yAxis, tr[o + 3]); s3.setScalar(tr[o + 4]); p3.set(list[k * 6 + 2], list[k * 6 + 3] - 0.05 * tr[o + 4], list[k * 6 + 4]);
        m4.compose(p3, q, s3);
        for (const m of B.meshes) m.setMatrixAt(k, m4);
        B.fade.array[k] = list[k * 6 + 5];
        treeColor(s, tr[o + 6], (tr[o + 7] & 2) !== 0, season, col, false);
        B.meshes[1].setColorAt(k, col); B.meshes[2].setColorAt(k, col);
        barkC.setScalar(0.85 + tr[o + 6] * 0.3);
        B.meshes[0].setColorAt(k, dbg ? white : barkC);
      }
      for (const m of B.meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.visible = n > 0;
        m.material.userData.uLodColor.value.set(l === 0 ? 0xff4040 : 0xffd040);
      }
      B.fade.needsUpdate = true;
    }
    return true;
  }

  /**
   * trees of the loaded prop tiles within r metres (horizontal) of an ECEF point (fix round 3, P5: eye-view
   * occlusion checks) -> [{ecef: {x, y, z} trunk base as displayed (seat offset incl.), height (m, crown top above
   * the base), crownBase (m), crownR (m), species, distance (m, horizontal)}], nearest first. Only tiles near the
   * camera are loaded (≈ 2 km), so far points return [].
   */
  treesNear(P, r = 30) {
    const out = [], L = {}, E = {};
    if (!P || !Number.isFinite(P.x)) return out;
    for (const t of this.tiles.values()) {
      if (t.state !== 'ready' || !t.place || !t.place.trees) continue;
      const F = t.F;
      ecefToFrame(F, P.x, P.y, P.z, L);
      if (Math.abs(L.x) > TILE_HALF + r + 10 || Math.abs(L.z) > TILE_HALF + r + 10) continue;
      const tr = t.place.trees, n = tr.length / 8;
      for (let i = 0; i < n; i++) {
        const o = i * 8, S = SPECIES[tr[o + 5] | 0] || SPECIES[0], sc = tr[o + 4];
        const crownR = S.crownR * sc, d = Math.hypot(tr[o] - L.x, tr[o + 2] - L.z);
        if (d > r + crownR) continue;
        frameToEcef(F, tr[o], tr[o + 1] + (t.seatC || 0) - 0.05 * sc, tr[o + 2], E);
        out.push({ ecef: { x: E.x, y: E.y, z: E.z }, height: S.H * sc, crownBase: S.trunk * sc, crownR, species: tr[o + 5] | 0, distance: Math.round(d * 100) / 100 });
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  stats() {
    let ready = 0, trees = 0, lamps = 0, near0 = 0, near1 = 0;
    for (const t of this.tiles.values()) if (t.state === 'ready') { ready++; trees += t.place.trees.length / 8; lamps += t.place.lamps.length / 8; }
    for (const s of this.near) { near0 += s[0].meshes ? s[0].meshes[0].count : 0; near1 += s[1].meshes ? s[1].meshes[0].count : 0; }
    return { tiles: this.tiles.size, ready, pending: this.pending, cityJobs: this.cityJobs, trees, lamps, near0, near1, radius: this.radius };
  }

  dispose() {
    for (const t of this.tiles.values()) this._disposeTile(t);
    this.tiles.clear();
    for (const w of this.workers || []) w.terminate();
    this.app.scene.remove(this.root); this.app.scene.remove(this.nearRoot);
  }
}

/** the parts of CityTileData placement needs (no mass geometry / BVH / full specs over postMessage) */
function slimCity(d) {
  const b = (d.buildings || []).map((s) => ({ id: s.id, use: s.use, lat: s.lat, lon: s.lon, heading: s.heading, floors: s.floors, floorHeight: s.floorHeight, groundFloorHeight: s.groundFloorHeight, ground: s.ground ? { entrance: s.ground.entrance } : null, footprint: s.footprint ? { w: s.footprint.w, d: s.footprint.d, shape: s.footprint.shape } : null, meta: s.meta ? { podium: s.meta.podium, height: s.meta.height, water: s.meta.water, poolSide: s.meta.poolSide, intakeSide: s.meta.intakeSide } : null, entrances: (s.entrances || []).filter((e) => e.side === 'front').map((e) => ({ kind: e.kind, side: e.side, offset: e.offset, width: e.width })) }));
  return { key: d.key, face: d.face, x: d.x, y: d.y, level: d.level, center: d.center, buildings: b, roads: d.roads || [], areas: d.areas || [], rails: d.rails || [], stations: d.stations || [], docks: d.docks || [] };
}

/** leaf tint of a tree instance (linear), season: {autumn (0..1), frost (0..1)} */
export function treeColor(sp, tint, deciduous, season, out, impostor) {
  const S = SPECIES[sp];
  // instance variation around white (the geometry vertex colours carry the species tint)
  const v = 0.86 + tint * 0.28;
  let r = v * (0.96 + 0.08 * tint), gg = v, b = v * (1.04 - 0.08 * tint);
  if (deciduous && season.autumn > 0) {
    const a = season.autumn * (0.6 + 0.4 * tint);
    const base = S.color;
    r = r * (1 - a) + (AUTUMN[0] / base[0]) * 0.5 * a;
    gg = gg * (1 - a) + (AUTUMN[1] / base[1]) * 0.5 * a;
    b = b * (1 - a) + (AUTUMN[2] / base[2]) * 0.5 * a;
  }
  out.setRGB(r, gg, b);
  void impostor;
  return out;
}

const CAR_COLORS = [[0.92, 0.93, 0.94], [0.85, 0.86, 0.88], [0.62, 0.65, 0.68], [0.2, 0.22, 0.25], [0.55, 0.6, 0.68], [0.75, 0.78, 0.82], [0.3, 0.38, 0.5]];
export function vehicleColor(i, out, kind) {
  if (kind === 2) return out.setRGB(0.95, 0.95, 0.93);
  const c = CAR_COLORS[((i * 2654435761) >>> 0) % CAR_COLORS.length];
  return out.setRGB(c[0], c[1], c[2]);
}
