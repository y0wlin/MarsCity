// Long bridges (decision DB) on the main thread: collects the bridge pieces (road / rail pieces flagged bridge:true
// with bridgeType) of every streamed city tile — out to the mass radius (~19 km), so bridges read from 5–10 km —,
// stitches them per bridgeId along bridgeS into deck runs in one bridge frame, and has the city worker build the
// whole structure ('cityBridge' job, bridgeBuild.js): girder, piers, pylons on islands / caissons, cables, arch
// ribs, deck + aviation lights. The street tiles (streets.js, < 1.3 km) draw the walkable deck top of the same
// pieces (asphalt, footways, railings, colliders) 6 cm above the structure's own deck layer. A bridge is rebuilt
// when more of its pieces arrive (debounced) and dropped beyond DROP_DIST. OWNER: city agent.
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { enuBasisFromUnit } from '../../core/geo.js';
import { getStreetMaterial, BRIDGE_CAST, STREET_UNIFORMS } from './streetMaterials.js';
import { whenCompiled } from './detail.js';

export const BRIDGE_CFG = { dropDist: 32000, rebuildDelay: 0.9, busyDist: 14000 };
const _v = new THREE.Vector3();

export class BridgeManager {
  constructor(city) {
    this.city = city;
    this.app = city.app;
    this.group = new THREE.Group();
    this.group.name = 'city-bridges';
    this.group.matrixAutoUpdate = false;
    this.bridges = new Map();     // bridgeId -> record
    this.stats = { bridges: 0, built: 0, pieces: 0, triangles: 0, jobs: 0 };
    this._debug = 'none';
    this._matsCompiled = new Set();
  }

  /** register the long-bridge pieces of a displayed city tile (idempotent) */
  addTile(t) {
    const d = t && t.data;
    if (!d) return;
    const scan = (list, kind) => {
      for (const r of list || []) {
        if (!r || !r.bridge || !r.bridgeType || !r.bridgeId || !r.points || r.points.length < 2 || !Array.isArray(r.bridgeS)) continue;
        // a corridor crossing carries the rail AND the parallel corridor road (34 m beside it) with the same bridgeId:
        // one structure per deck (twin bridges), keyed by id + kind
        const key = r.bridgeId + '|' + kind;
        let B = this.bridges.get(key);
        if (!B) {
          B = { id: key, bridgeId: r.bridgeId, type: r.bridgeType, kind, span: r.bridgeSpan || 0, clearance: r.clearance || 0, archRise: r.archRise || 0, pieces: new Map(), frame: null, group: null, job: null, dirty: false, changedAt: 0, dist: 1e9, built: 0, width: r.width || 12, cls: r.cls || 'arterial', tracks: r.tracks || 2 };
          this.bridges.set(key, B);
        }
        if (B.pieces.has(r.id)) continue;
        // piece points → ECEF (tile frame: origin at sea level under the tile centre, y = height a.s.l.)
        const n = r.points.length, cu = t.cu, E = t.E, U = t.U, S = t.S;
        const P = new Float64Array(n * 3), H = new Float64Array(n), sArr = new Float64Array(n);
        let len = 0;
        for (let i = 0; i < n; i++) {
          const [x, y, z] = r.points[i];
          P[i * 3] = cu.x * R + E[0] * x + U[0] * y + S[0] * z;
          P[i * 3 + 1] = cu.y * R + E[1] * x + U[1] * y + S[1] * z;
          P[i * 3 + 2] = cu.z * R + E[2] * x + U[2] * y + S[2] * z;
          H[i] = y;
          if (i) len += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][2] - r.points[i - 1][2]);
          sArr[i] = len;
        }
        const sa = r.bridgeS[0], sb = r.bridgeS[1];
        for (let i = 0; i < n; i++) sArr[i] = sa + (len > 0 ? sArr[i] / len : 0) * (sb - sa);
        const pylons = (r.pylons || []).map((p) => ({ s: sa + (p.t || 0) * (sb - sa), h: p.h, shape: p.shape, base: p.base, baseR: p.baseR }));
        B.pieces.set(r.id, { sa, sb, P, H, s: sArr, pylons, cx: P[Math.floor(n / 2) * 3], cy: P[Math.floor(n / 2) * 3 + 1], cz: P[Math.floor(n / 2) * 3 + 2] });
        if (!B.frame) {
          const l = Math.hypot(P[0], P[1], P[2]), c = [P[0] / l, P[1] / l, P[2] / l];
          const Bs = enuBasisFromUnit(c[0], c[1], c[2], {});
          B.frame = { c, E: Bs.east, U: Bs.up, S: Bs.south, o: { x: c[0] * R, y: c[1] * R, z: c[2] * R },
            quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...Bs.east), new THREE.Vector3(...Bs.up), new THREE.Vector3(...Bs.south))) };
        }
        if (r.width) B.width = Math.max(B.width, r.width);
        B.dirty = true; B.changedAt = this.city.time;
      }
    };
    scan(d.roads, 'road');
    scan(d.rails, 'rail');
  }

  update(frame) {
    const cam = frame.camEcef;
    // night factor of the min-pixel lights (local sun at the camera, same onset as the emissive night gate)
    const mu = frame.sunDir && frame.camUp ? frame.sunDir.dot(frame.camUp) : 1;
    STREET_UNIFORMS.uBrNight.value = Math.max(0, Math.min(1, (0.035 - mu) / 0.135));
    for (const [id, B] of this.bridges) {
      let dmin = 1e12;
      for (const pc of B.pieces.values()) { const d = Math.hypot(pc.cx - cam.x, pc.cy - cam.y, pc.cz - cam.z); if (d < dmin) dmin = d; }
      B.dist = dmin;
      if (dmin > BRIDGE_CFG.dropDist) { this._dispose(B); this.bridges.delete(id); continue; }
      if (B.dirty && !B.job && this.city.time - B.changedAt > BRIDGE_CFG.rebuildDelay) this._request(B);
      else if (B.job) B.job.priority = 104 + B.dist / 24;
    }
    this.place();
  }

  place() {
    for (const B of this.bridges.values()) {
      if (!B.group) continue;
      const o = B.frame.o;
      B.group.position.set(o.x - origin.x, o.y - origin.y, o.z - origin.z);
      B.group.updateMatrix(); B.group.updateMatrixWorld(true);
    }
  }

  _payload(B) {
    const F = B.frame;
    const pcs = [...B.pieces.values()].sort((a, b) => a.sa - b.sa);
    const runs = [];
    let cur = null;
    const toFrame = (P, i, out) => {
      const dx = P[i * 3] - F.o.x, dy = P[i * 3 + 1] - F.o.y, dz = P[i * 3 + 2] - F.o.z;
      out.push(dx * F.E[0] + dy * F.E[1] + dz * F.E[2], dx * F.U[0] + dy * F.U[1] + dz * F.U[2], dx * F.S[0] + dy * F.S[1] + dz * F.S[2]);
    };
    for (const pc of pcs) {
      const n = pc.s.length;
      if (!cur || Math.abs(pc.sa - cur.end) > 1.0) { cur = { s: [], p: [], end: pc.sb }; runs.push(cur); }
      for (let i = 0; i < n; i++) {
        if (cur.s.length && pc.s[i] <= cur.s[cur.s.length - 1] + 1e-3) continue;   // shared joint point
        cur.s.push(pc.s[i]); toFrame(pc.P, i, cur.p);
      }
      cur.end = pc.sb;
    }
    const pylons = [];
    for (const pc of pcs) for (const p of pc.pylons) if (!pylons.some((q) => Math.abs(q.s - p.s) < 5)) pylons.push(p);
    // water level: deck height (a.s.l.) at mid-span − clearance (clearance is given at mid-span)
    let sMid;
    if (B.type === 'cable' && pylons.length >= 2) sMid = (Math.min(...pylons.map((p) => p.s)) + Math.max(...pylons.map((p) => p.s))) / 2;
    else sMid = (pcs[0].sa + pcs[pcs.length - 1].sb) / 2;
    let level = null;
    for (const pc of pcs) {
      if (sMid < pc.sa - 1 || sMid > pc.sb + 1) continue;
      for (let i = 0; i < pc.s.length - 1; i++) if (pc.s[i] <= sMid && pc.s[i + 1] >= sMid) { const f = (sMid - pc.s[i]) / Math.max(1e-6, pc.s[i + 1] - pc.s[i]); level = pc.H[i] + (pc.H[i + 1] - pc.H[i]) * f; break; }
    }
    if (level === null) { let hmax = -1e9; for (const pc of pcs) for (let i = 0; i < pc.H.length; i++) hmax = Math.max(hmax, pc.H[i]); level = hmax; }
    level = Math.max(-50, level - (B.clearance || 0));
    if (B.type === 'cable' && Math.abs(level) < 3) level = 0;
    // the road twin of a rail crossing stands its pylons on caissons inside the rail bridge's pylon islands
    const twinOfRail = B.kind === 'road' && this.bridges.has(B.bridgeId + '|rail');
    return {
      id: B.id, type: B.type, kind: B.kind, cls: B.cls, width: B.width, tracks: B.tracks, span: B.span, clearance: B.clearance, archRise: B.archRise, level, noIsland: twinOfRail,
      frame: { c: F.c, E: F.E, U: F.U, S: F.S },
      runs: runs.map((r) => ({ s: Float64Array.from(r.s), p: Float64Array.from(r.p) })), pylons,
    };
  }

  _request(B) {
    const w = this.city.pool;
    if (!w) return;
    B.dirty = false;
    const nPieces = B.pieces.size;
    const job = w.submit('cityBridge', this._payload(B), { priority: 104 + B.dist / 24 });
    B.job = job;
    this.stats.jobs++;
    job.promise.then((res) => {
      if (B.job !== job) return;
      B.job = null;
      if (!this.bridges.has(B.id)) return;
      this._install(B, res, nPieces);
    }, (err) => {
      if (B.job !== job) return;
      B.job = null;
      if (!err?.cancelled) { console.warn('[city] bridge build failed', B.id, err); }
      else B.dirty = true;
    });
  }

  _install(B, res, nPieces) {
    const g = new THREE.Group();
    g.name = 'bridge:' + B.id;
    g.matrixAutoUpdate = false;
    g.quaternion.copy(B.frame.quat);
    let tris = 0;
    const mats = [];
    for (const p of res.parts || []) {
      if (!p.index || !p.index.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(p.color, 3));
      geo.setIndex(new THREE.BufferAttribute(p.index, 1));
      geo.computeBoundingSphere();
      // min-pixel parts grow with distance: generous bounds so they are never culled early
      if (p.material === 'br_cable' || p.material.startsWith('br_light') || p.material === 'br_aviation') geo.boundingSphere.radius += 60;
      const mat = getStreetMaterial(p.material, this.app);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'bridge:' + B.id + ':' + p.material;
      mesh.castShadow = BRIDGE_CAST.has(p.material);
      mesh.receiveShadow = !p.material.startsWith('br_light') && p.material !== 'br_aviation';
      mesh.matrixAutoUpdate = false;
      mesh.userData.materialKey = p.material;
      mesh.raycast = () => {};   // bridges are not pick targets (the street deck colliders are walkable)
      g.add(mesh);
      tris += p.index.length / 3;
      mats.push(mat);
    }
    const attach = () => {
      if (!this.bridges.has(B.id)) { disposeGroup(g); return; }
      if (B.group) { this.group.remove(B.group); disposeGroup(B.group); }
      B.group = g; B.tris = tris; B.built = nPieces; B.stats = res.stats;
      this.group.add(g);
      if (this._debug !== 'none') this._applyDebug(B);
      this.place();
      this.city.changed = true;
    };
    // link new programs off the frame before the first show (one bridge program set for every bridge)
    const fresh = mats.some((m) => !this._matsCompiled.has(m));
    if (fresh) {
      for (const m of mats) this._matsCompiled.add(m);
      g.visible = true;
      this.place();
      whenCompiled(this.app, g).then(attach, attach);
    } else attach();
  }

  _dispose(B) {
    if (B.job) { try { B.job.cancel(); } catch { /* */ } B.job = null; }
    if (B.group) { this.group.remove(B.group); disposeGroup(B.group); B.group = null; }
  }

  /** true while bridges near the camera are waiting for their structure */
  pending() {
    let n = 0;
    for (const B of this.bridges.values()) if ((B.job || B.dirty) && B.dist < BRIDGE_CFG.busyDist) n++;
    return n;
  }

  setDebug(mode) { this._debug = mode || 'none'; for (const B of this.bridges.values()) this._applyDebug(B); }
  _applyDebug(B) {
    if (!B.group) return;
    const mode = this._debug;
    for (const m of B.group.children) {
      if (!m.userData.baseMat) m.userData.baseMat = m.material;
      if (mode === 'wireframe' || mode === 'lod' || mode === 'objectId') { m.material = debugMat(mode, B.id); m.castShadow = false; }
      else { m.material = m.userData.baseMat; m.castShadow = BRIDGE_CAST.has(m.userData.materialKey); }
    }
  }

  updateStats() {
    let built = 0, pieces = 0, tris = 0;
    for (const B of this.bridges.values()) { pieces += B.pieces.size; if (B.group) { built++; tris += B.tris || 0; } }
    Object.assign(this.stats, { bridges: this.bridges.size, built, pieces, triangles: tris });
  }

  /** [{id, type, kind, pieces, built, dist, stats}] (diagnostics) */
  list() {
    return [...this.bridges.values()].map((B) => ({ id: B.id, bridgeId: B.bridgeId, type: B.type, kind: B.kind, pieces: B.pieces.size, built: B.built, dist: Math.round(B.dist), tris: B.tris || 0, stats: B.stats || null }));
  }

  dispose() { for (const B of this.bridges.values()) this._dispose(B); this.bridges.clear(); }
}

function disposeGroup(g) { for (const m of g.children) { m.geometry?.dispose(); } }

const DM = new Map();
function debugMat(mode, id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const key = mode === 'objectId' ? mode + (h % 64) : mode;
  let m = DM.get(key);
  if (!m) {
    const c = mode === 'lod' ? new THREE.Color(0.85, 0.55, 0.2) : mode === 'objectId' ? new THREE.Color().setHSL((h % 64) / 64, 0.7, 0.55) : new THREE.Color(0.75, 0.78, 0.82);
    m = new THREE.MeshBasicMaterial({ color: c, wireframe: mode === 'wireframe' });
    m.name = 'city:bridge-debug-' + key;
    DM.set(key, m);
  }
  return m;
}
void _v;
