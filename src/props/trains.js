// Trains on the corridor rail network with a deterministic timetable. OWNER: props agent.
//
// Lines = urban corridor segments (world/urban/corridors.js: great-circle arcs between settlements,
// stations at arc positions t, elevated / bridge intervals). Accessed through a namespace import and
// feature-checked so a changed internal never breaks linking.
// Timetable (pure function of sol time, identical on every reload):
//   * headway H divides 86400 s (periodic over the sol); phase from the segment key
//   * trapezoid speed profile between stations (accel / brake), dwell 30–60 s, terminal layover chosen
//     so each physical train shuttles A -> B -> A (2·(trip + layover) is a multiple of H)
//   * right-hand running, track centres ±2.0 m from the corridor centreline, train centre stops at the
//     platform centre (= station building centre, x = 0 of its frame); trains never longer than the
//     shortest platform of their line kind (4–5 × 25 m metro / regional ≤ 130 m, 1-car service railcar)
//   * heights: the CityTileData.rails polylines the city draws (absolute height of every 20 m lattice
//     point of the loaded props tiles, so any levelling urban applies through stations is followed); the
//     same 20 m lattice computed from terrain (heightAt(·, 2)) where no tile is loaded (far trains)
//   * D1 (types/z_station_geom.js STATION_GEOM): rail head = ground + 0.35 at grade, ground + 9.0 on
//     viaducts (polyline y = ground + 9); car floor = rail head + 1.0 = platform top (platY)
// API: nextArrival(stationId, solTime?) -> {solTime, direction, heading, line, towards, waitSeconds} | null
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { heightAt } from '../world/terrain.js';
import * as CORR from '../world/urban/corridors.js';
import * as DCH from '../world/urban/dchunks.js';
import * as RULES from '../world/urban/rules.js';
import * as TOWNS from '../world/urban/settlements.js';
import { pointFrame, ecefToFrame, frameToEcef, mix32, u01 } from './util.js';

const DAY = 86400;
const DIVISORS = (() => { const d = []; for (let i = 1; i <= DAY; i++) if (DAY % i === 0) d.push(i); return d; })();
const TRACK_HALF = 2.0;            // track centres ±2.0 m (render/city rails, types/z_station_geom.js)
const CAR_LEN = 25;
// rail head above the CityTileData rail polyline y (D1): at grade polyline = ground -> rail head ground + 0.35;
// viaducts polyline = ground + 9 = rail head (D1 "elevated rail head = ground + 9.0"); bridges like viaducts
const RAIL_TOP_GRADE = 0.35, RAIL_TOP_DECK = 0.0;
export const CAR_FLOOR = 1.0;       // car floor above the rail head (= STATION_GEOM.PLATFORM_HEIGHT; models.js)
const PRE = 40, POST = 50;          // s a train stands at its origin before departure / at the terminus after arrival
const ELEV_H = (RULES.RAIL && RULES.RAIL.elevatedHeight) || 9;
// shot sync: line -> a train of `dir` has been standing `standing` s at `station` at sol time `sol`
// (bookmark S07: ZR1 at-grade station S9ruz39h.4, local 10:30 at lon 118)
// (bookmark S06 area, ZR2 canyon: elevated station Sg1b4vvq.2 ~540 m WSW of the S06 camera, blue hour;
//  the train arrives 15 s after the bookmark time)
const SHOT_SYNC = {
  '9ruz39h': { station: 'S9ruz39h.4', dir: -1, sol: ((10.5 - 118.0 / 15) % 24 + 24) % 24, standing: 6 },
  'g1b4vvq': { station: 'Sg1b4vvq.2', dir: 1, sol: ((19.15 + 105.24 / 15) % 24 + 24) % 24, standing: -15 },
};
const HAS_API = typeof CORR.chunkRails === 'function' && typeof CORR.pointAt === 'function' && typeof DCH.chunkAt === 'function';
// urban levels the rail bed through stations (corridors.js railBedGround, used by the tile rails polylines)
const HAS_BED = typeof CORR.railBedGround === 'function';

function runTime(D, v, a) { return D >= (v * v) / a ? D / v + v / a : 2 * Math.sqrt(D / a); }
function legPos(D, v, a, tau, T) {
  if (tau <= 0) return 0; if (tau >= T) return D;
  if (D >= (v * v) / a) {
    const ta = v / a;
    if (tau < ta) return 0.5 * a * tau * tau;
    if (tau < T - ta) return 0.5 * v * ta + v * (tau - ta);
    const r = T - tau; return D - 0.5 * a * r * r;
  }
  const h = T / 2;
  if (tau < h) return 0.5 * a * tau * tau;
  const r = T - tau; return D - 0.5 * a * r * r;
}
function inIntervals(list, t) { if (!list) return false; for (let i = 0; i + 1 < list.length; i += 2) if (t >= list[i] && t <= list[i + 1]) return true; return false; }

/** run profile of one direction: station positions measured from the start of travel */
function runProfile(st, dwellOf, v, a) {
  const legs = [], arr = [0], dep = [0];
  let tt = 0;
  for (let i = 0; i + 1 < st.length; i++) {
    const D = Math.max(1, st[i + 1].t - st[i].t);
    const T = runTime(D, v, a);
    legs.push({ D, T, t0: st[i].t });
    tt += T; arr.push(tt); tt += (i + 1 < st.length - 1) ? dwellOf(st[i + 1]) : 0; dep.push(tt);
  }
  return { st, legs, arr, dep, trip: arr[arr.length - 1] };
}

/** schedule for one segment (pure). dirs[+1] runs A -> B, dirs[-1] B -> A (positions from B). */
export function lineSchedule(sg) {
  if (sg._props) return sg._props;
  const h = mix32(sg.key % 2147483647, 0x7a11);
  const st = (sg.stations || []).slice().sort((a, b) => a.t - b.t);
  const kind = sg.kind;
  const single = (sg.tracks || 0) < 2;
  const v = kind === 'regional' ? 33 : kind === 'service' ? 16 : 22;
  const a = kind === 'service' ? 0.7 : 1.0;
  // platform lengths (urban districts.js): intermediate 130–179 m, main 210–249 m, service halts 24 m
  // -> metro / regional trains <= 125 m; service lines run a single 25 m railcar
  const cars = kind === 'service' ? 1 : kind === 'regional' ? 5 : (u01(mix32(h, 1)) < 0.5 ? 4 : 5);
  // dwell per station (same in both directions)
  const dw = new Map();
  st.forEach((s, i) => dw.set(s.id, (i === 0 || i === st.length - 1) ? 0 : s.halt ? 25 : 30 + Math.round(u01(mix32(h, 10 + i)) * 20) + (s.main ? 10 : 0)));
  const dwellOf = (s) => dw.get(s.id) || 0;
  const fwd = runProfile(st, dwellOf, v, a);
  const rev = runProfile(st.slice().reverse().map((s) => ({ ...s, t: sg.len - s.t })), dwellOf, v, a);
  const trip = Math.max(fwd.trip, rev.trip);
  let H, layover;
  if (single) {
    const need = 2 * (trip + 300);
    H = DIVISORS.find((d) => d >= need) || DAY;
    layover = H / 2 - trip;
  } else {
    const dens = st.length / Math.max(1, sg.len / 1000);         // stations per km
    const cands = kind === 'regional' ? [480, 600] : dens > 0.45 ? [180, 240] : dens > 0.3 ? [240, 300, 360] : [360, 480, 600];
    H = cands[mix32(h, 2) % cands.length];
    const minLay = 180;
    const k = Math.ceil((2 * (trip + minLay)) / H);
    layover = (k * H) / 2 - trip;
  }
  let phase = Math.floor(u01(mix32(h, 3)) * H);
  // shot sync (prompt §1 / §5 07): a train stands at the platform at the bookmark time
  const sync = SHOT_SYNC[sg.key.toString(36)];
  if (sync) {
    const P = sync.dir > 0 ? fwd : rev;
    const i = P.st.findIndex((x) => x.id === sync.station);
    if (i > 0) {
      const ta = sync.sol * 3600 - sync.standing - P.arr[i];          // departure of that train
      const pd = ((ta % H) + H) % H;
      phase = sync.dir > 0 ? pd : (((pd - trip - layover) % H) + H) % H;
    }
  }
  // the reverse direction leaves B when the forward train has finished its layover there
  const phaseR = (phase + trip + layover) % H;
  sg._props = { st, dirs: { 1: fwd, '-1': rev }, trip, H, layover, phase, phaseR, v, a, cars, single, kind };
  return sg._props;
}

/** distance from the start of travel of a train centre `dt` seconds after its departure */
function runPos(P, dt, v, a) {
  const st = P.st;
  if (dt <= 0) return st[0].t;
  for (let i = 0; i < P.legs.length; i++) {
    const L = P.legs[i];
    const d0 = P.dep[i], a1 = P.arr[i + 1];
    if (dt < d0) return st[i].t;
    if (dt <= a1) return L.t0 + legPos(L.D, v, a, dt - d0, L.T);
  }
  return st[st.length - 1].t;
}

export class Trains {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.group = new THREE.Group(); this.group.name = 'props-trains';
    this.segs = new Map();
    this.anchor = null; this.anchorQuat = new THREE.Quaternion();
    this._segKey = ''; this._lastRefresh = -1e9; this._stateKey = '';
    this.heightCache = new Map();
    this.visible = [];
    this.enabled = HAS_API;
    if (!HAS_API) console.warn('[props] corridors API missing: trains disabled');
  }

  init() {
    const L = this.sys.lib, mats = this.sys.mats;
    this.app.scene.add(this.group);
    const mk = (geo, mat, cap) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); return m; };
    this.cap = 512;
    this.mesh = {
      cab: ['trainBody', 'trainGlass', 'dark'].map((k) => mk(L.trainCab[k], mats.get(k), this.cap)),
      mid: ['trainBody', 'trainGlass', 'dark'].map((k) => mk(L.trainMid[k], mats.get(k), this.cap * 2)),
      head: mk(L.trainCab.headlight, mats.get('headlight'), this.cap),
      tail: mk(L.trainCab.taillight, mats.get('taillight'), this.cap),
    };
    this.mesh.head.castShadow = false; this.mesh.tail.castShadow = false;
    // head / tail light glow sprites (night factor in the shader; keep distant trains readable at dusk)
    if (L.sprite && mats.glow) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', L.sprite.getAttribute('position').clone()); sg.setIndex(L.sprite.getIndex().clone());
      this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
      sg.setAttribute('aGlow', this.glowAttr);
      this.glow = new THREE.InstancedMesh(sg, mats.glow, this.cap * 2);
      this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 6;
      this.group.add(this.glow);
    }
  }

  /** rail segments near the camera (cached per chunk) */
  refreshSegments(cam) {
    const l = Math.hypot(cam.x, cam.y, cam.z) || 1;
    const ux = cam.x / l, uy = cam.y / l, uz = cam.z / l;
    let ch;
    try { ch = DCH.chunkAt(ux, uy, uz); } catch (e) { return; }
    const key = ch ? (ch.key ?? `${ch.face}/${ch.a0}/${ch.b0}`) : '';
    if (key === this._segKey) return;
    this._segKey = key;
    let rails = [];
    try { rails = CORR.chunkRails(ch) || []; } catch (e) { console.warn('[props] chunkRails failed', e); rails = []; }
    const seen = new Set();
    for (const sg of rails) {
      if (!sg || !sg.rail || !(sg.tracks > 0) || !sg.stations || sg.stations.length < 2) continue;
      seen.add(sg.key);
      if (!this.segs.has(sg.key)) this.segs.set(sg.key, sg);
    }
    // forget far segments (keep the cache bounded)
    if (this.segs.size > 300) for (const k of this.segs.keys()) if (!seen.has(k)) this.segs.delete(k);
  }

  /** rail head height at arc position t (m above sea level): rail polyline y (20 m lattice, linear in t)
   *  + the rail-top offset of the run (D1) */
  railHeight(sg, t) {
    const k0 = Math.floor(t / 20), f = t / 20 - k0;
    const deck = (inIntervals(sg.elev, t) && sg.kind === 'metro') || inIntervals(sg.bridge, t);
    const top = deck ? RAIL_TOP_DECK : RAIL_TOP_GRADE;
    const P = this.poly && this.poly.get(sg.key);
    if (P) {
      const h0 = P.get(k0), h1 = P.get(k0 + 1);
      if (h0 !== undefined && h1 !== undefined) return h0 * (1 - f) + h1 * f + top;
    }
    return this._latticeH(sg, k0) * (1 - f) + this._latticeH(sg, k0 + 1) * f + top;
  }
  /** rail polyline y at lattice point k as urban/citytile.js computes it (no rail-top offset) */
  _latticeH(sg, k) {
    const t = Math.max(0, Math.min(sg.len, k * 20));
    const key = sg.key * 8192 + k;
    let h = this.heightCache.get(key);
    if (h !== undefined) return h;
    const Q = CORR.pointAt(sg, t, {});
    let gh = heightAt(Q.x, Q.y, Q.z, 2);
    if (HAS_BED && sg.rail) gh = CORR.railBedGround(sg, t, gh);    // level through station platforms
    const elev = inIntervals(sg.elev, t) && sg.kind === 'metro', br = inIntervals(sg.bridge, t);
    h = elev ? gh + ELEV_H : br ? Math.max(gh, 0) + 7 : gh;
    this.heightCache.set(key, h);
    if (this.heightCache.size > 200000) this.heightCache.clear();
    return h;
  }
  /**
   * Absolute heights of the CityTileData rail polylines of the loaded props tiles (what the city draws),
   * keyed segment -> lattice index k (t = 20 k). Rebuilt when the set of ready props tiles changes.
   */
  _syncPolylines() {
    const tiles = this.sys.tiles;
    if (!tiles || (tiles.version === this._polyTiles && this.segs.size === this._polySegs)) return false;
    this._polyTiles = tiles.version; this._polySegs = this.segs.size;
    this._polyVer = (this._polyVer || 0) + 1;
    const poly = new Map();
    const E = {}, SDp = {};
    for (const t of tiles.tiles.values()) {
      if (t.state !== 'ready' || !t.city || !t.city.rails) continue;
      for (const rl of t.city.rails) {
        if (!rl || !rl.points || rl.points.length < 2 || rl.segment == null) continue;
        const key = parseInt(rl.segment, 36);
        const sg = this.segs.get(key);
        if (!sg) continue;
        let m = poly.get(key); if (!m) { m = new Map(); poly.set(key, m); }
        for (const p of rl.points) {
          frameToEcef(t.F, p[0], p[1], p[2], E);
          const l = Math.hypot(E.x, E.y, E.z);
          CORR.segDistance(sg, E.x / l, E.y / l, E.z / l, SDp);
          const k = Math.round(SDp.along / 20);
          if (Math.abs(SDp.along - k * 20) > 0.5) continue;        // tile-edge cut point
          m.set(k, l - R);
        }
      }
    }
    this.poly = poly;
    return true;
  }
  /** ECEF of the track centre for direction dir at arc t */
  trackPoint(sg, t, dir, out) {
    // no clamping: beyond the segment ends the great circle continues (trains standing at a
    // terminus overhang the arc end by up to half a train)
    const Q = CORR.pointAt(sg, t, {});
    const off = (dir > 0 ? -TRACK_HALF : TRACK_HALF) * ((sg.tracks || 0) >= 2 ? 1 : 0) / R;
    let x = Q.x + sg.nx * off, y = Q.y + sg.ny * off, z = Q.z + sg.nz * off;
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const r = R + this.railHeight(sg, t);
    out.x = x * r; out.y = y * r; out.z = z * r; out.ux = x; out.uy = y; out.uz = z;
    return out;
  }

  /** trains of a segment at sol second T -> [{dir, s (centre arc), id}] */
  trainsAt(sg, T) {
    const S = lineSchedule(sg);
    const out = [];
    for (const dir of [1, -1]) {
      const ph = dir > 0 ? S.phase : S.phaseR;
      // trains between PRE s before their departure and POST s after their arrival at the terminus
      // (in between they lay over on a siding beyond the platforms)
      const base = Math.floor((T + PRE - ph) / S.H);
      for (let k = base; ; k--) {
        const dt = T - (ph + k * S.H);
        if (dt > S.dirs[dir].trip + POST) break;
        if (dt < -PRE) continue;
        const P = S.dirs[dir];
        const f = runPos(P, Math.min(Math.max(dt, 0), P.trip), S.v, S.a);
        const s = dir > 0 ? f : sg.len - f;
        out.push({ dir, s, id: `${sg.key.toString(36)}:${dir > 0 ? 'a' : 'b'}:${((k % 100000) + 100000) % 100000}`, cars: S.cars, moving: dt > 0 && dt < P.trip && runPos(P, dt + 0.5, S.v, S.a) !== f });
        if (out.length > 200) break;
      }
    }
    return out;
  }

  update(frame) {
    if (!this.enabled) { this.group.visible = false; return; }
    const cam = frame.camEcef;
    const alt = frame.camAltGround;
    if (alt > 30000) { this.group.visible = false; return; }
    this.group.visible = true;
    if (frame.time - this._lastRefresh > 0.5) { this._lastRefresh = frame.time; this.refreshSegments(cam); }
    if (!this.anchor || Math.hypot(cam.x - this.anchor.ox, cam.y - this.anchor.oy, cam.z - this.anchor.oz) > 3000) {
      this.anchor = pointFrame(cam.x, cam.y, cam.z);
      this.anchorQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.anchor.E), new THREE.Vector3(...this.anchor.U), new THREE.Vector3(...this.anchor.S)));
      this._stateKey = '';
    }
    const A = this.anchor;
    this.group.quaternion.copy(this.anchorQuat);
    this.group.position.set(A.ox - origin.x, A.oy - origin.y, A.oz - origin.z);
    const T = frame.solTime * 3600;
    this._syncPolylines();
    const key = `${T.toFixed(3)}|${this.segs.size}|${A.ox}|${this._polyVer}`;
    if (key === this._stateKey) return;
    this._stateKey = key;
    const maxD = Math.max(9000, alt * 3);
    const l = Math.hypot(cam.x, cam.y, cam.z) || 1;
    const cu = { x: cam.x / l, y: cam.y / l, z: cam.z / l };
    const SD = {};
    const m4 = new THREE.Matrix4();
    let nCab = 0, nMid = 0, nHead = 0, nTail = 0, nGlow = 0;
    const gm = new THREE.Matrix4();
    const P0 = {}, P1 = {}, Pc = {}, Lp = {}, Lf = {};
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), U = new THREE.Vector3();
    this.visible.length = 0;
    for (const sg of this.segs.values()) {
      let d;
      try { d = CORR.segDistance(sg, cu.x, cu.y, cu.z, SD); } catch (e) { continue; }
      if (d > maxD) continue;
      const trains = this.trainsAt(sg, T);
      for (const tr of trains) {
        const n = tr.cars, Ltr = n * CAR_LEN;
        // quick cull on the train centre
        this.trackPoint(sg, tr.s, tr.dir, Pc);
        const dc = Math.hypot(Pc.x - cam.x, Pc.y - cam.y, Pc.z - cam.z);
        if (dc > maxD + Ltr) continue;
        this.visible.push({ id: tr.id, line: sg.key.toString(36), dir: tr.dir, s: tr.s, ecef: { x: Pc.x, y: Pc.y, z: Pc.z }, distance: dc, moving: tr.moving });
        for (let j = 0; j < n; j++) {
          const sc = tr.s + tr.dir * (Ltr / 2 - CAR_LEN / 2 - CAR_LEN * j);
          this.trackPoint(sg, sc - 8.75 * tr.dir, tr.dir, P0);
          this.trackPoint(sg, sc + 8.75 * tr.dir, tr.dir, P1);
          this.trackPoint(sg, sc, tr.dir, Pc);
          // position: midpoint of the bogies (on the chord, i.e. on the rail polyline)
          ecefToFrame(A, (P0.x + P1.x) / 2, (P0.y + P1.y) / 2, (P0.z + P1.z) / 2, Lp);
          ecefToFrame(A, P1.x - P0.x + A.ox, P1.y - P0.y + A.oy, P1.z - P0.z + A.oz, Lf);
          Z.set(Lf.x, Lf.y, Lf.z);
          if (!(Z.lengthSq() > 1e-8)) continue;
          Z.normalize();
          const ul = ecefToFrame(A, Pc.ux + A.ox, Pc.uy + A.oy, Pc.uz + A.oz, {});
          U.set(ul.x, ul.y, ul.z).normalize();
          const cab = j === 0 || j === n - 1;
          const flip = cab && n > 1 && j === n - 1;      // a single railcar runs nose first
          if (flip) Z.negate();
          X.crossVectors(U, Z).normalize(); Y.crossVectors(Z, X);
          m4.makeBasis(X, Y, Z); m4.setPosition(Lp.x, Lp.y, Lp.z);
          if (cab) {
            if (nCab >= this.cap) continue;
            for (const m of this.mesh.cab) m.setMatrixAt(nCab, m4);
            nCab++;
            if (!flip) { this.mesh.head.setMatrixAt(nHead++, m4); }
            else { this.mesh.tail.setMatrixAt(nTail++, m4); }
            // lamp glows: headlights (front cab) / tail lights (rear cab), car-local positions (models.js)
            if (this.glow && nGlow + 4 <= this.cap * 2) {
              // [flip, z]: tail lights of a single railcar sit on its flat rear end cap
              const ends = n === 1 ? [[false, 11.83], [true, -12.3]] : [[flip, flip ? 11.61 : 11.83]];
              for (const [tail, lz] of ends) for (const sx of [1, -1]) {
                const lx = sx * (tail ? 0.85 : 0.55), ly = 1.115;
                gm.makeTranslation(Lp.x + X.x * lx + Y.x * ly + Z.x * lz, Lp.y + X.y * lx + Y.y * ly + Z.y * lz, Lp.z + X.z * lx + Y.z * ly + Z.z * lz);
                this.glow.setMatrixAt(nGlow, gm);
                if (tail) this.glowAttr.array.set([60, 3, 2, 0.22], nGlow * 4); else this.glowAttr.array.set([120, 112, 96, 0.3], nGlow * 4);
                nGlow++;
              }
            }
          } else {
            if (nMid >= this.cap * 2) continue;
            for (const m of this.mesh.mid) m.setMatrixAt(nMid, m4);
            nMid++;
          }
        }
      }
    }
    for (const m of this.mesh.cab) { m.count = nCab; m.instanceMatrix.needsUpdate = true; }
    if (this.glow) { this.glow.count = nGlow; this.glow.instanceMatrix.needsUpdate = true; this.glowAttr.needsUpdate = true; }
    for (const m of this.mesh.mid) { m.count = nMid; m.instanceMatrix.needsUpdate = true; }
    this.mesh.head.count = nHead; this.mesh.head.instanceMatrix.needsUpdate = true;
    this.mesh.tail.count = nTail; this.mesh.tail.instanceMatrix.needsUpdate = true;
  }

  /** segments serving a station id (intermediate ids encode the segment key; main ids the town) */
  segmentsForStation(stationId) {
    const out = [];
    if (!HAS_API || !stationId) return out;
    const m = /^S([0-9a-z]+)\.(\d+)$/.exec(stationId);
    if (m) {
      const key = parseInt(m[1], 36);
      let sg = this.segs.get(key);
      if (!sg && typeof CORR.segment === 'function') { try { sg = CORR.segment(Math.floor(key / 400000), key % 400000); } catch (e) { sg = null; } }
      if (sg) out.push(sg);
      return out;
    }
    const t = /^T([0-9a-z]+)$/.exec(stationId);
    if (t) {
      const town = parseInt(t[1], 36);
      for (const sg of this.segs.values()) if (sg.ka === town || sg.kb === town) out.push(sg);
      if (!out.length && typeof TOWNS.townByKey === 'function') {
        try {
          const T0 = TOWNS.townByKey(town);
          if (T0) { const ch = DCH.chunkAt(T0.x, T0.y, T0.z); for (const sg of CORR.chunkRails(ch) || []) if (sg.rail && (sg.ka === town || sg.kb === town)) out.push(sg); }
        } catch (e) { /* ignore */ }
      }
    }
    return out;
  }

  /**
   * Next train arriving at `stationId` at or after `solTime` (hours at lon 0, default now).
   * -> {solTime, inSeconds, direction (+1 towards the segment's B end, -1 towards A), heading (compass deg of
   *     travel at the station), line, towards (terminal station id), stationT, cars} | null
   */
  nextArrival(stationId, solTime) {
    const now = (solTime ?? this.app.state.solTime) * 3600;
    let best = null;
    for (const sg of this.segmentsForStation(stationId)) {
      const S = lineSchedule(sg);
      const idx = S.st.findIndex((s) => s.id === stationId);
      if (idx < 0) continue;
      for (const dir of [1, -1]) {
        const i = dir > 0 ? idx : S.st.length - 1 - idx;
        if (i === 0) continue;                                // trains start here in this direction
        const off = S.dirs[dir].arr[i];
        const ph = dir > 0 ? S.phase : S.phaseR;
        const k = Math.ceil((now - ph - off) / S.H - 1e-9);
        const t = ph + k * S.H + off;
        if (!best || t < best.t) best = { t, sg, dir, S, idx };
      }
    }
    if (!best) return null;
    const { t, sg, dir, S, idx } = best;
    const ts = S.st[idx].t;
    const a = CORR.pointAt(sg, ts, {}), b = CORR.pointAt(sg, Math.min(sg.len, ts + 50 * dir) === ts ? ts - 50 * dir : ts + 50 * dir, {});
    const F = pointFrame(a.x, a.y, a.z);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const e = F.E[0] * dx + F.E[1] * dy + F.E[2] * dz, nn = -(F.S[0] * dx + F.S[1] * dy + F.S[2] * dz);
    let heading = (Math.atan2(e, nn) * 180 / Math.PI + 360) % 360;
    if (Math.min(sg.len, ts + 50 * dir) === ts) heading = (heading + 180) % 360;
    const term = dir > 0 ? S.st[S.st.length - 1] : S.st[0];
    return { solTime: ((t / 3600) % 24 + 24) % 24, inSeconds: Math.round(t - now), direction: dir, heading: Math.round(heading * 10) / 10, line: sg.key.toString(36), towards: term.id, stationT: Math.round(ts), cars: S.cars, headway: S.H };
  }

  stats() { return { lines: this.segs.size, trains: this.visible.length, cabs: this.mesh ? this.mesh.cab[0].count : 0, mids: this.mesh ? this.mesh.mid[0].count : 0 }; }
}
