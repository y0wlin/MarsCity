// Ferries, cargo ships, tugs and launches with deterministic schedules + foam wakes. OWNER: props agent.
// Routes (all pure functions of world data, positions pure functions of sol time):
//   * G01 navigation mouth (SITES.tidalBarrier.channel): one closed loop per lane (sea -> mouth ->
//     harbour turning basin -> mouth -> sea, right-hand traffic); ships every 300 s (big lane: ferries,
//     cargo ships, tugs) / 540 s (outer lane: launches), one common speed per lane -> no overtaking
//   * G01 harbour ferry line: shuttles across the protected basin between two floating landings (pontoon +
//     gangway + cliff lift), through the S05 foreground (fix round 3), two ferries keeping right
//   * ferry docks of loaded city tiles ('ferry' Z, 'landing' O): shuttle across the water to the
//     opposite shore found by marching along the dock heading
//   * ambient boats in water cells (quadtree level-10 tiles, ~5 km) near the camera: closed loops
// Route polylines are ECEF points on the sea-level sphere (metres); arc length s in metres.
// Shot sync (prompt §5): the phases of the G01 lanes / harbour line are chosen so that the bookmark
// times show the brief's moments (05: a ferry crossing the harbour view with its widening wake;
// 09b: the next inbound ferry just ahead in the mouth). Still deterministic: constants, not clocks.
// Wakes = the boat's own past stern positions (age 0..60 s), widening with age (Kelvin spread), fading.
// props.wakes -> [{id, kind, points: Float64Array (ECEF xyz…), age: Float32Array (s), width: Float32Array (m),
//                  speed (m/s), level (m), beam}]; handed to water.addWake (own foam strips as fallback).
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { tileAt, tileBounds, faceToVec } from '../core/geo.js';
import { heightAt } from '../world/terrain.js';
import * as HYDRO from '../world/hydro.js';
import { pointFrame, frameToEcef, ecefToFrame, mix32, u01, rng, clamp } from './util.js';
import { BOAT_TYPES, HARBOUR, makeRoute, routePoint, routePointKeep, shuttleState, shuttlePeriod, shuttlePhaseFor, buildG01Layout, syncFerryLines } from './harbour.js';

const WAKE_AGE = 60, WAKE_STEP = 2;
const TYPES = BOAT_TYPES;
// side-light positions of the models (models.js; facing +z, port = +x red, starboard = -x green)
const NAV = {
  ferry: { x: 3.35, y: 9.65, z: 10.2, mast: 14.45 },
  cargo: { x: 9.2, y: 16.2, z: -50.7, mast: 23.0 },
  tug: { x: 2.35, y: 6.35, z: 3.4, mast: 9.65 },
  launch: { x: 1.285, y: 1.95, z: 1.4, mast: 2.68 },
};

export class Boats {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.group = new THREE.Group(); this.group.name = 'props-boats';
    this.routes = new Map();          // id -> route
    this.cells = new Map();           // cell key -> [routes]
    this.dockRoutes = new Map();      // dock id -> route | null
    this.g01 = [];                    // [{rt, lane, H, v, types, ph, kOff}]
    this.harbour = [];                // [{rt, phase, speed, dwell}]
    this.landings = [];               // [{ecef, dir:{x,y,z} (ECEF unit, towards the shore)}]
    this.ferryNet = [];               // terminal-to-terminal ferry lines [{rt, type, phases}] (harbour.js ferryNetwork)
    this._netAt = null; this._netPending = false;
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this.wakes = [];
    this._key = '';
    this.renderWakes = true;
    this.boatsNow = [];
  }

  init() {
    const L = this.sys.lib, mats = this.sys.mats;
    if (this.app.scene) this.app.scene.add(this.group);
    this.mesh = {};
    if (L && mats) {
      for (const [type, parts] of Object.entries(L.boats)) {
        this.mesh[type] = [];
        for (const [k, geo] of Object.entries(parts)) {
          if (!geo || !geo.isBufferGeometry) continue;
          const m = new THREE.InstancedMesh(geo, mats.get(k), 96);
          m.count = 0; m.frustumCulled = false; m.castShadow = !k.startsWith('nav'); m.receiveShadow = true;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m); this.mesh[type].push(m);
        }
      }
      // wakes: one dynamic strip geometry (fallback when the water renderer has no wake API)
      this.wakeCap = 12000;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.wakeCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.wakeCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.wakeCap * 2), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.wakeCap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.wakeCap * 3), 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      this.wakeMesh = new THREE.Mesh(g, mats.get('wake'));
      this.wakeMesh.frustumCulled = false; this.wakeMesh.renderOrder = 3; this.wakeMesh.receiveShadow = true;
      this.group.add(this.wakeMesh);
      // nav light glows
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', L.sprite.getAttribute('position').clone()); sg.setIndex(L.sprite.getIndex().clone());
      this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(400 * 4), 4).setUsage(THREE.DynamicDrawUsage);
      sg.setAttribute('aGlow', this.glowAttr);
      this.glow = new THREE.InstancedMesh(sg, mats.glow, 400);
      this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 6;
      this.group.add(this.glow);
      // floating landings of the harbour ferry line (static, few)
      this.landingMesh = Object.entries(L.landing || {}).filter(([, geo]) => geo && geo.isBufferGeometry).map(([k, geo]) => {
        const m = new THREE.InstancedMesh(geo, mats.get(k), 8);
        m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
        this.group.add(m); return m;
      });
      // cliff lifts of the landings: shaft (scaled in y), head, footbridge (scaled in z)
      this.towerMesh = {};
      for (const part of ['shaft', 'head', 'bridge']) {
        this.towerMesh[part] = Object.entries((L.landingTower && L.landingTower[part]) || {}).filter(([, geo]) => geo && geo.isBufferGeometry).map(([k, geo]) => {
          const m = new THREE.InstancedMesh(geo, mats.get(k), 8);
          m.count = 0; m.frustumCulled = false; m.castShadow = k !== 'boatGlass'; m.receiveShadow = true;
          this.group.add(m); return m;
        });
      }
    }
    // the G01 layout needs ~250 terrain samples next to the megastructure landform (slow): ask the
    // props worker; without workers (Node checks) compute it here
    const tp = this.sys.tiles;
    if (tp && typeof tp.requestG01 === 'function') tp.requestG01((layout) => this.setG01(layout));
    else { try { this.setG01(buildG01Layout()); } catch (e) { console.warn('[props] G01 routes', e); } }
  }

  // ---------------------------------------------------------------------------------------------
  // routes
  // ---------------------------------------------------------------------------------------------
  /** G01 lanes + harbour ferry line from buildG01Layout() (computed in the props worker) */
  setG01(layout) {
    if (this.g01Ready) return;
    this.g01Ready = true;               // also when the worker failed (null): never block isIdle() near the harbour
    if (!layout) return;
    for (const Ln of layout.lanes || []) {
      const rt = makeRoute(Ln.id, Ln.pts, 0, { kind: 'mouth', lane: Ln.lane });
      this.routes.set(rt.id, rt);
      this.g01.push({ rt, lane: Ln.lane, H: Ln.H, v: Ln.v, types: Ln.types, ph: Ln.ph, kOff: Ln.kOff });
    }
    const Hb = layout.harbour;
    if (Hb) {
      const rt = makeRoute(Hb.id, Hb.pts, 0, { kind: 'harbour' });
      this.routes.set(rt.id, rt);
      Hb.phases.forEach((phase, i) => this.harbour.push({ rt, phase, speed: Hb.speed, dwell: Hb.dwell, keep: Hb.keep, id: 'H' + i }));
    }
    // shot-sync diagnostics (harbour.js s05Phases: the harbour ferry crossing the S05 foreground)
    this.g01Check = { harbour: layout.harbourCheck || null, s05: layout.s05 || null, error: layout.harbourError || null };
    this.landings = layout.landings || [];
    this._key = '';
  }

  /** ferry route from a dock record of a loaded tile (tile frame F) */
  dockRoute(dock, F) {
    if (this.dockRoutes.has(dock.id)) return this.dockRoutes.get(dock.id);
    let rt = null;
    try {
      const poly = dock.polygon; let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
      const h = (dock.heading || 0) * Math.PI / 180;
      const dx = Math.sin(h), dz = -Math.cos(h);
      const half = (dock.length || 40) / 2;
      const E = {};
      const at = (x, z) => { frameToEcef(F, x, 0, z, E); const l = Math.hypot(E.x, E.y, E.z); return { x: E.x / l, y: E.y / l, z: E.z / l }; };
      const wet = (u) => heightAt(u.x, u.y, u.z, 40) < -1.5;
      // berth alongside the pier end
      const bx = cx + dx * (half + 6) + dz * 12, bz = cz + dz * (half + 6) - dx * 12;
      let level = 0;
      try { const q = at(bx + dx * 40, bz + dz * 40); const W = HYDRO.waterAt(q.x, q.y, q.z, {}); if (W && W.type && W.type !== 1) level = W.level || 0; } catch (e) { level = 0; }
      const wetL = (u) => level ? (() => { try { const W = HYDRO.waterAt(u.x, u.y, u.z, {}); return W.type > 0 && W.depth > 1; } catch (e) { return false; } })() : wet(u);
      const pts = [at(bx, bz)];
      const x = bx + dx * 250, z = bz + dz * 250;
      if (!wetL(at(x, z))) { this.dockRoutes.set(dock.id, null); return null; }
      pts.push(at(x, z));
      // march across the water; veer slightly by the dock hash so routes of nearby docks differ
      const hh = mix32(dock.id.length * 131 + (dock.id.charCodeAt(dock.id.length - 1) | 0), 991);
      const veer = (u01(hh) - 0.5) * 0.6;
      const ca = Math.cos(veer), sa = Math.sin(veer);
      const ux = dx * ca - dz * sa, uz = dx * sa + dz * ca;
      let lastWet = null, steps = 0;
      for (let s = 150; s < 9000; s += 150) {
        const px = x + ux * s, pz = z + uz * s;
        if (!wetL(at(px, pz))) break;
        lastWet = [px, pz]; steps++;
      }
      if (lastWet && steps >= 4) {
        const back = 120;
        const ex2 = lastWet[0] - ux * back, ez2 = lastWet[1] - uz * back;
        let mid = [(x + ex2) / 2 + uz * 120, (z + ez2) / 2 - ux * 120];
        // every leg sampled for depth (islands / shoals between the 150 m probes): the detour point falls
        // back onto the straight line, a dry crossing truncates the route before it
        const fine = (u) => level ? wetL(u) : heightAt(u.x, u.y, u.z, 8) < -1.2;
        const legDry = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s <= L; s += 20) { const f = L ? s / L : 0; if (!fine(at(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))) return f; } return -1; };
        const P0 = [bx, bz], P1 = [x, z];
        if (legDry(P0, P1) >= 0) { this.dockRoutes.set(dock.id, null); return null; }
        if (legDry(P1, mid) >= 0 || legDry(mid, [ex2, ez2]) >= 0) mid = null;
        let end = [ex2, ez2];
        if (!mid) {
          const f = legDry(P1, end);
          if (f >= 0) { const L = Math.hypot(end[0] - x, end[1] - z) * f - 80; end = L > 300 ? [x + ux * L, z + uz * L] : null; }
        }
        if (end) {
          if (mid) pts.push(at(mid[0], mid[1]));
          pts.push(at(end[0], end[1]));
          rt = makeRoute(`F-${dock.id}`, pts, level, { kind: 'ferry', dockKind: dock.kind });
        }
      }
    } catch (e) { rt = null; }
    this.dockRoutes.set(dock.id, rt);
    if (rt) this.routes.set(rt.id, rt);
    if (this.dockRoutes.size > 600) { const k = this.dockRoutes.keys().next().value; const r = this.dockRoutes.get(k); this.dockRoutes.delete(k); if (r) this.routes.delete(r.id); }
    return rt;
  }

  /** ambient boats of a level-10 cell */
  cellRoutes(face, x, y) {
    const key = `${face}/${x}/${y}`;
    if (this.cells.has(key)) return this.cells.get(key);
    const list = [];
    const b = tileBounds(face, 10, x, y);
    const h0 = mix32(face * 1048576 + x * 1024 + y, 0xb0a7);
    const r = rng(h0);
    const at = (fa, fb) => faceToVec(face, b.a0 + (b.a1 - b.a0) * fa, b.b0 + (b.b1 - b.b0) * fb, {});
    const c = at(0.5, 0.5);
    const hc = heightAt(c.x, c.y, c.z, 400);
    if (hc < -6) {
      const nb = 2 + Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) {
        const tr = r();
        const type = tr < 0.55 ? 'launch' : tr < 0.8 ? 'tug' : 'cargo';
        const minDepth = type === 'cargo' ? -12 : -3;
        const pts = [];
        const n = 4 + Math.floor(r() * 3);
        const cx = 0.2 + r() * 0.6, cy = 0.2 + r() * 0.6, rad = 0.12 + r() * 0.2;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + r() * 0.5;
          const u = at(clamp(cx + Math.cos(a) * rad, 0.02, 0.98), clamp(cy + Math.sin(a) * rad, 0.02, 0.98));
          if (heightAt(u.x, u.y, u.z, 60) < minDepth) pts.push(u);
        }
        if (pts.length < 3) continue;
        // check midpoints and quarter points
        let ok = true;
        for (let k = 0; k < pts.length && ok; k++) {
          const p = pts[k], q = pts[(k + 1) % pts.length];
          for (const f of [0.25, 0.5, 0.75]) {
            const m = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f }; const l = Math.hypot(m.x, m.y, m.z);
            if (heightAt(m.x / l, m.y / l, m.z / l, 60) > minDepth * 0.6) { ok = false; break; }
          }
        }
        if (!ok) continue;
        pts.push(pts[0]);
        const phase = r() * 1e5;
        const rt = makeRoute(`C-${key}-${i}`, pts, 0, { loop: true, kind: 'ambient', type, phase, speed: TYPES[type].speed * (0.75 + r() * 0.4) });
        list.push(rt);
      }
    }
    this.cells.set(key, list);
    if (this.cells.size > 400) { const k = this.cells.keys().next().value; this.cells.delete(k); }
    return list;
  }

  /** terminal-to-terminal ferry lines around the camera (worker query, refreshed every ~2.5 km) */
  _updateFerryNet(cam, alt) {
    if (alt > 6000 || this._netPending || !this.sys.tiles || typeof this.sys.tiles.requestFerries !== 'function') return;
    if (this._netAt && Math.hypot(cam.x - this._netAt.x, cam.y - this._netAt.y, cam.z - this._netAt.z) < 2500) return;
    const l = Math.hypot(cam.x, cam.y, cam.z) || 1;
    this._netPending = true;
    this._netAt = { x: cam.x, y: cam.y, z: cam.z };
    this.sys.tiles.requestFerries({ x: cam.x / l, y: cam.y / l, z: cam.z / l }, 7000, (net) => {
      this._netPending = false;
      const list = [];
      for (const r of (net && net.routes) || []) {
        const rt = makeRoute(r.id, r.pts, 0, { kind: 'ferry' });
        this.routes.set(rt.id, rt);
        const hh = mix32(r.id.length * 7919 + (r.id.charCodeAt(r.id.length - 1) | 0), r.len | 0);
        const type = r.kind === 'launch' ? 'launch' : 'ferry';
        // one ferry per line, two on lines longer than 3 km (half a period apart)
        const P = shuttlePeriod(rt.len, TYPES[type].speed, 240).P;
        const ph0 = u01(hh) * P;
        list.push({ rt, type, phases: rt.len > 3000 ? [ph0, ph0 + P / 2] : [ph0] });
      }
      syncFerryLines(list, TYPES);          // shot sync (§5 05): a crossing ferry ahead of the S05 camera
      this.ferryNet = list;
      this._key = '';
    });
  }

  /** all boats near the camera at sol second T -> [{route, type, s, dir, moving, speed, id, keep?, age}] */
  boatsAt(T, cam, alt) {
    const out = [];
    // ferry lines between the urban ferry terminals
    for (const F of this.ferryNet) F.phases.forEach((ph, i) => {
      const st = shuttleState(F.rt.len, T, TYPES[F.type].speed, 240, ph);
      out.push({ route: F.rt, type: F.type, s: st.s, dir: st.dir, moving: st.moving, speed: st.speed, id: `${F.rt.id}#${i}`, keep: 26, age: st.age });
    });
    // G01 lanes: ship k leaves the sea end at ph + k·H and runs the closed lane loop at the lane speed
    for (const G of this.g01) {
      const rt = G.rt, n = G.types.length;
      const kMax = Math.floor((T - G.ph) / G.H);
      for (let k = kMax; k > kMax - 400; k--) {
        const dt = T - (G.ph + k * G.H);
        const s = dt * G.v;
        if (s > rt.len) break;
        const type = G.types[(((k + G.kOff) % n) + n) % n];
        out.push({ route: rt, type, s, dir: 1, moving: true, speed: G.v, id: `G01${G.lane}${k}`, age: dt });
      }
    }
    // harbour ferry line (two ferries in opposite phase, keeping right of the line)
    for (const Hl of this.harbour) {
      const st = shuttleState(Hl.rt.len, T, Hl.speed, Hl.dwell, Hl.phase);
      out.push({ route: Hl.rt, type: 'ferry', s: st.s, dir: st.dir, moving: st.moving, speed: st.speed, id: `G01-${Hl.id}`, keep: Hl.keep || HARBOUR.keep, age: st.age });
    }
    // ferries of loaded docks
    const tiles = this.sys.tiles && this.sys.tiles.tiles;
    if (tiles) for (const t of tiles.values()) {
      if (t.state !== 'ready' || !t.city || !t.city.docks) continue;
      for (const d of t.city.docks) {
        if (d.kind !== 'ferry' && d.kind !== 'landing') continue;
        const rt = this.dockRoute(d, t.F);
        if (!rt) continue;
        const hh = mix32(rt.id.length * 977 + rt.P.length, rt.id.charCodeAt(4) | 0);
        const type = d.kind === 'ferry' ? 'ferry' : 'launch';
        const st = shuttleState(rt.len, T, TYPES[type].speed, 300, u01(hh) * 3000);
        out.push({ route: rt, type, s: st.s, dir: st.dir, moving: st.moving, speed: st.speed, id: rt.id, age: st.age });
      }
    }
    // ambient cells within ~12 km
    if (alt < 25000) {
      const l = Math.hypot(cam.x, cam.y, cam.z);
      const P = pointFrame(cam.x, cam.y, cam.z);
      const seen = new Set();
      const rad = clamp(6000 + alt * 1.5, 6000, 16000);
      const Tq = {};
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        const dx = i * rad / 3, dz = j * rad / 3;
        const px = cam.x / l + (P.E[0] * dx + P.S[0] * dz) / R, py = cam.y / l + (P.E[1] * dx + P.S[1] * dz) / R, pz = cam.z / l + (P.E[2] * dx + P.S[2] * dz) / R;
        tileAt(px, py, pz, 10, Tq);
        const k = `${Tq.face}/${Tq.x}/${Tq.y}`;
        if (seen.has(k)) continue; seen.add(k);
        for (const rt of this.cellRoutes(Tq.face, Tq.x, Tq.y)) out.push({ route: rt, type: rt.type, s: rt.phase + T * rt.speed, dir: 1, moving: true, speed: rt.speed, id: rt.id, age: 1e9 });
      }
    }
    return out;
  }

  /** boat point at arc s incl. the keep-right offset of two-way lines (ECEF; harbour.js routePointKeep, which the
   *  shot syncs use too) */
  boatPoint(b, s, out) { return routePointKeep(b.route, s, b.dir, b.keep, out); }

  update(frame, night) {
    const cam = frame.camEcef, alt = frame.camAltGround;
    if (alt > 40000) { this.group.visible = false; this.clearWakes(); return; }
    this.group.visible = true;
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 4000) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.anchor.E), new THREE.Vector3(...this.anchor.U), new THREE.Vector3(...this.anchor.S)));
      this._key = '';
    }
    const A = this.anchor;
    this.group.quaternion.copy(this.anchorQuat);
    this.group.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    this._updateFerryNet(cam, alt);
    const T = frame.solTime * 3600;
    const key = `${T.toFixed(3)}|${A.ox}|${this.sys.tiles ? this.sys.tiles.version : 0}|${night > 0 ? 1 : 0}|${Math.round(cam.x / 500)},${Math.round(cam.z / 500)}`;
    if (key === this._key) return;
    this._key = key;
    const boats = this.boatsAt(T, cam, alt);
    const maxD = clamp(9000 + alt * 3, 9000, 60000);
    const counts = {}; for (const k of Object.keys(this.mesh)) counts[k] = 0;
    const m4 = new THREE.Matrix4();
    const Pp = {}, Pa = {}, Pb = {}, Lp = {}, La = {}, Lb = {};
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const wakes = [];
    let nGlow = 0;
    const gm = new THREE.Matrix4();
    this.boatsNow.length = 0;
    for (const b of boats) {
      const rt = b.route;
      this.boatPoint(b, b.s, Pp);
      const d = Math.hypot(Pp.x - cam.x, Pp.y - cam.y, Pp.z - cam.z);
      if (d > maxD) continue;
      const type = b.type, ty = TYPES[type];
      if (!this.mesh[type] || counts[type] >= 96) continue;
      const ahead = Math.max(6, ty.len * 0.3);
      this.boatPoint(b, b.s + ahead * b.dir, Pa); this.boatPoint(b, b.s - ahead * b.dir, Pb);
      ecefToFrame(A, Pp.x, Pp.y, Pp.z, Lp); ecefToFrame(A, Pa.x, Pa.y, Pa.z, La); ecefToFrame(A, Pb.x, Pb.y, Pb.z, Lb);
      Z.set(La.x - Lb.x, La.y - Lb.y, La.z - Lb.z);
      if (Z.lengthSq() < 1e-6) {
        // at a route end (docked): face along the route end direction
        this.boatPoint(b, b.s <= 1 ? ahead : rt.len - ahead, Pa);
        ecefToFrame(A, Pa.x, Pa.y, Pa.z, La);
        Z.set(La.x - Lp.x, La.y - Lp.y, La.z - Lp.z);
        if (b.s > 1) Z.negate();
        if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1);
      }
      Z.normalize();
      const ul = ecefToFrame(A, Pp.x / (R + rt.level) + A.ox, Pp.y / (R + rt.level) + A.oy, Pp.z / (R + rt.level) + A.oz, {});
      Y.set(ul.x, ul.y, ul.z).normalize();
      X.crossVectors(Y, Z);
      if (!(X.lengthSq() > 1e-10)) continue;
      X.normalize(); Z.crossVectors(X, Y);
      m4.makeBasis(X, Y, Z); m4.setPosition(Lp.x, Lp.y, Lp.z);
      const n = counts[type]++;
      for (const m of this.mesh[type]) m.setMatrixAt(n, m4);
      this.boatsNow.push({ id: b.id, type, ecef: { x: Pp.x, y: Pp.y, z: Pp.z }, distance: d, moving: b.moving, route: rt.id, s: b.s, dir: b.dir });
      // nav-light glows (facing +z: port = +x red, starboard = -x green, masthead white)
      if (night > 0.01 && nGlow + 3 <= 400) {
        const N = NAV[type];
        const lights = [[N.x, N.y, N.z, 7, 0.25, 0.15], [-N.x, N.y, N.z, 0.2, 7, 1.5], [0, N.mast, 0, 6, 6, 5.5]];
        for (const [lx, ly, lz, r, g, bb] of lights) {
          const wx = Lp.x + X.x * lx + Y.x * ly + Z.x * lz, wy = Lp.y + X.y * lx + Y.y * ly + Z.y * lz, wz = Lp.z + X.z * lx + Y.z * ly + Z.z * lz;
          gm.makeTranslation(wx, wy, wz); this.glow.setMatrixAt(nGlow, gm);
          this.glowAttr.array.set([r * 10, g * 10, bb * 10, 0.6], nGlow * 4); nGlow++;
        }
      }
      // wake history (stern track, newest first)
      if (b.moving && d < 12000) {
        const samples = [];
        const maxAge = Math.min(WAKE_AGE, b.age ?? WAKE_AGE);
        for (let age = 0; age <= maxAge + 1e-6; age += WAKE_STEP) {
          const s = b.s - b.dir * b.speed * age;
          if (!rt.loop && (s < 0 || s > rt.len)) break;
          samples.push(s, age);
        }
        if (samples.length >= 4) wakes.push({ b, rt, samples, beam: ty.beam, len: ty.len });
      }
    }
    for (const [type, ms] of Object.entries(this.mesh)) for (const m of ms) { m.count = counts[type]; m.instanceMatrix.needsUpdate = true; }
    if (this.glow) { this.glow.count = nGlow; this.glow.instanceMatrix.needsUpdate = true; this.glowAttr.needsUpdate = true; }
    this._placeLandings(cam, maxD);
    this._buildWakes(wakes);
  }

  _placeLandings(cam, maxD) {
    if (!this.landingMesh || !this.landingMesh.length) return;
    const A = this.anchor, m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const Lp = {}, Lt = {}, tm = new THREE.Matrix4();
    let n = 0, nt = 0;
    for (const L of this.landings) {
      const e = L.ecef;
      if (Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z) > maxD) continue;
      ecefToFrame(A, e.x, e.y, e.z, Lp);
      ecefToFrame(A, e.x + L.toward.x, e.y + L.toward.y, e.z + L.toward.z, Lt);
      const l = Math.hypot(e.x, e.y, e.z);
      const ul = ecefToFrame(A, e.x / l + A.ox, e.y / l + A.oy, e.z / l + A.oz, {});
      Y.set(ul.x, ul.y, ul.z).normalize();
      Z.set(Lt.x - Lp.x, Lt.y - Lp.y, Lt.z - Lp.z).normalize();       // model +z towards the shore
      X.crossVectors(Y, Z).normalize(); Z.crossVectors(X, Y);
      m4.makeBasis(X, Y, Z); m4.setPosition(Lp.x, Lp.y, Lp.z);
      for (const m of this.landingMesh) m.setMatrixAt(n, m4);
      n++;
      // cliff lift: shaft from the foot to the cliff edge level, head, footbridge to the edge
      const T = L.tower;
      if (T && this.towerMesh && nt < 8) {
        const put = (list, y, z, sy, sz) => {
          tm.makeBasis(X.clone().multiplyScalar(1), Y.clone().multiplyScalar(sy), Z.clone().multiplyScalar(sz));
          tm.setPosition(Lp.x + Y.x * y + Z.x * z, Lp.y + Y.y * y + Z.y * z, Lp.z + Y.z * y + Z.z * z);
          for (const m of list) m.setMatrixAt(nt, tm);
        };
        put(this.towerMesh.shaft, T.base, T.zt, Math.max(1, T.top - T.base), 1);
        put(this.towerMesh.head, T.top, T.zt, 1, 1);
        put(this.towerMesh.bridge, T.top, T.zt + 3.85, 1, Math.max(1, T.bridge - 0.25));
        nt++;
      }
    }
    for (const m of this.landingMesh) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    if (this.towerMesh) for (const list of Object.values(this.towerMesh)) for (const m of list) { m.count = nt; m.instanceMatrix.needsUpdate = true; }
  }

  /** remove every wake handed to the water renderer */
  clearWakes() {
    const water = this.app.systems && this.app.systems.water;
    if (this._waterIds && water && typeof water.removeWake === 'function') for (const id of this._waterIds) { try { water.removeWake(id); } catch (e) { /* */ } }
    this._waterIds = new Set();
    this.wakes = [];
    if (this.wakeMesh) this.wakeMesh.visible = false;
  }

  _buildWakes(list) {
    const A = this.anchor;
    const hasMesh = !!this.wakeMesh;
    const g = hasMesh ? this.wakeMesh.geometry : null;
    const pos = g && g.attributes.position.array, nor = g && g.attributes.normal.array, uv = g && g.attributes.uv.array, col = g && g.attributes.color.array, idx = g && g.index.array;
    let nv = 0, ni = 0;
    const P = {}, Q = {}, Lc = {}, Lq = {};
    this.wakes = [];
    for (const w of list) {
      const n = w.samples.length / 2;
      if (hasMesh && (nv + n * 2 > this.wakeCap || ni + (n - 1) * 6 > this.wakeCap * 3)) break;
      const ecef = new Float64Array(n * 3), ages = new Float32Array(n), widths = new Float32Array(n);
      const base = nv;
      for (let i = 0; i < n; i++) {
        const s = w.samples[i * 2], age = w.samples[i * 2 + 1];
        // the wake starts at the stern
        const sb = s - w.b.dir * w.len * 0.45;
        this.boatPoint(w.b, sb, P);
        const width = w.beam * 0.7 + age * w.b.speed * (w.b.type === 'ferry' ? 0.42 : 0.36);
        ecef[i * 3] = P.x; ecef[i * 3 + 1] = P.y; ecef[i * 3 + 2] = P.z; ages[i] = age; widths[i] = width;
        if (!hasMesh) continue;
        this.boatPoint(w.b, sb - w.b.dir * 4, Q);
        ecefToFrame(A, P.x, P.y, P.z, Lc); ecefToFrame(A, Q.x, Q.y, Q.z, Lq);
        let tx = Lc.x - Lq.x, tz = Lc.z - Lq.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const up = ecefToFrame(A, P.x / (R + w.rt.level) + A.ox, P.y / (R + w.rt.level) + A.oy, P.z / (R + w.rt.level) + A.oz, {});
        const alpha = Math.pow(1 - age / WAKE_AGE, 1.6) * Math.min(1, age / 3 + 0.35) * Math.min(1, w.b.speed / 6);
        const lift = 0.08;
        for (const side of [-1, 1]) {
          const ox = -tz * side * width / 2, oz = tx * side * width / 2;
          pos[nv * 3] = Lc.x + ox + up.x * lift; pos[nv * 3 + 1] = Lc.y + up.y * lift; pos[nv * 3 + 2] = Lc.z + oz + up.z * lift;
          nor[nv * 3] = up.x; nor[nv * 3 + 1] = up.y; nor[nv * 3 + 2] = up.z;
          uv[nv * 2] = (s * 0.02) % 1000; uv[nv * 2 + 1] = side < 0 ? 0 : 1;
          col[nv * 4] = 1; col[nv * 4 + 1] = 1; col[nv * 4 + 2] = 1; col[nv * 4 + 3] = alpha;
          nv++;
        }
      }
      if (hasMesh) for (let i = 0; i + 1 < n; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = b; idx[ni++] = c; idx[ni++] = d;
      }
      this.wakes.push({ id: w.b.id, kind: w.b.type, points: ecef, age: ages, width: widths, speed: w.b.speed, level: w.rt.level, beam: w.beam });
    }
    if (hasMesh) {
      g.setDrawRange(0, ni);
      for (const k of ['position', 'normal', 'uv', 'color']) g.attributes[k].needsUpdate = true;
      g.index.needsUpdate = true;
    }
    // the water renderer draws the wakes on its surface when it offers the API (render/water/wakes.js):
    // hand over the stern tracks (newest first) and hide our own foam strips
    const water = this.app.systems && this.app.systems.water;
    const useWater = water && typeof water.addWake === 'function';
    if (!this._waterIds) this._waterIds = new Set();
    if (useWater) {
      const seen = new Set();
      for (const wk of this.wakes) {
        const pts = [];
        for (let i = 0; i < wk.points.length; i += 3) pts.push({ x: wk.points[i], y: wk.points[i + 1], z: wk.points[i + 2] });
        // ferries (§5 05: a crossing ferry with a widening wake): a stronger, slightly wider wake so the white
        // centre, bubble trail and Kelvin arms read as a spreading V behind the stern
        const ferry = wk.kind === 'ferry';
        const wWidth = wk.beam * (ferry ? 1.6 : 1), wStr = ferry ? clamp(wk.speed / 5.5, 0.5, 1.45) : clamp(wk.speed / 7, 0.4, 1.2);
        try { water.addWake(wk.id, pts, { width: wWidth, strength: wStr, level: wk.level }); seen.add(wk.id); } catch (e) { /* */ }
      }
      for (const id of this._waterIds) if (!seen.has(id)) { try { water.removeWake(id); } catch (e) { /* */ } }
      this._waterIds = seen;
    }
    if (hasMesh) this.wakeMesh.visible = this.renderWakes && !useWater && ni > 0;
  }

  stats() { return { boats: this.boatsNow.length, wakes: this.wakes.length, routes: this.routes.size, cells: this.cells.size, harbour: this.harbour.length }; }
}
