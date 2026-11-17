// G01 东海分段潮堤 — segmented caisson tidal barrier (ZR1). OWNER: megastructure agent.
// Worker-safe generator: layout (chunks along the SITES.tidalBarrier arc) + chunk geometry at
// LOD 'far' | 'mid' | 'near'. Unit frames: local X = arc tangent (increasing arc station s,
// towards ESE), local Z = outward normal (open sea, SSW), Y = height above sea level.
import { SITES, G01_GEO, g01FromUV, g01ToUV } from '../world/sites.js';
import { hash4, Rng } from '../core/hash.js';
import * as M from './parts.js';
import { EXPO, PX, NX, PY, NY, PZ, NZ, ALL } from './parts.js';
import { PAGE, screenUV } from './screens.js';

const S = SITES.tidalBarrier;
const A = G01_GEO.arc;
const ALPHA = Math.asin(A.half / A.r);
const ARCLEN = 2 * ALPHA * A.r;
export const G01_SITE = S;

export const thOfS = (s) => -ALPHA + (s / ARCLEN) * 2 * ALPHA;
export function sOfXZ(x, z) { const uv = g01ToUV(x, z, {}); return ((Math.atan2(uv.u, uv.v - A.cv) + ALPHA) / (2 * ALPHA)) * ARCLEN; }
export function radOfXZ(x, z) { const uv = g01ToUV(x, z, {}); return Math.hypot(uv.u, uv.v - A.cv); }
export function xzAt(s, off = 0) { const th = thOfS(s), rr = A.r + off; return g01FromUV(rr * Math.sin(th), A.cv + rr * Math.cos(th)); }
const tanAt = (s) => { const th = thOfS(s); return g01FromUV(Math.cos(th), -Math.sin(th)); };
const outAt = (s) => { const th = thOfS(s); return g01FromUV(Math.sin(th), Math.cos(th)); };
// local X = tangent requires Z = (−tz, tx) to be the outward normal (checked once)
const HAND = (() => { const t = tanAt(ARCLEN / 2), n = outAt(ARCLEN / 2); return (-t[1] * n[0] + t[0] * n[1]) > 0 ? 1 : -1; })();
/** harbour office look direction in the tower's arc frame: (along the tangent toward the mouth, seaward) —
 *  25° seaward of the tangent frames the far mouth head with its harbour tower and green light (left third,
 *  ≈ −25°), the mouth gap and the channel just outside it (centre) and the inbound channel where the next ferry
 *  runs (right, ≈ +14°, props S09b sync). The near red light tower stands on the harbour-side corner of the head
 *  block (fix round 2, QS-13: it used to block the window centre), ≈ 43° left of the view, out of the frame. */
const OFFICE_LOOK_DEG = 25;
/** mullion phase of the harbour-tower window band: mullions ≈ 35° apart as seen from the office eye, placed at
 *  ≈ −16° / +45° view angle (clear of the far head, the window centre and the ferry lane) */
const OFFICE_MULLION_PHASE = 0.4;
const OFFICE_LOOK = [Math.cos(OFFICE_LOOK_DEG * Math.PI / 180), Math.sin(OFFICE_LOOK_DEG * Math.PI / 180)];
/** harbour tower (港务塔) drum: radius, height above the deck; office floor at deck + OFFICE_FL */
const HT_R = 10, HT_H = 34, OFFICE_FL = 15.5;
/** head complex length at a lock / abutment end, raised head block at a mouth end (m along the arc) */
const HEAD_LEN = 36, MOUTH_HEAD = 18;
/** cross-sections vary with function: full-width caissons at heads / quays / the maintenance building,
 *  narrow plain wall caissons between them (the seaward face line stays continuous) */
const narrowW = (W) => Math.max(26, Math.round(W * 0.6));
const maintUnit = (nU) => Math.min(nU - 2, Math.floor(nU * 0.84));
function unitWide(ch, sg, u) {
  const s0 = sg.sa + u * ch.uL, s1 = s0 + ch.uL;
  if (s0 < sg.sa + 75 || s1 > sg.sb - 75) return true;
  if (sg.quay && s1 > sg.quay.s0 - 4 && s0 < sg.quay.s1 + 4) return true;
  return u === maintUnit(ch.nU);
}

/** push a unit frame at arc station s, offset `off` outward (+) from the arc centreline */
function pushArc(c, s, off = 0) {
  const ch = c.chunk, b = c.b;
  const p = xzAt(s, off), t = tanAt(s);
  const tx = t[0] * HAND, tz = t[1] * HAND;
  b.push(); b.translate(p[0] - ch.cx, 0, p[1] - ch.cz); b.rotY(Math.atan2(-tz, tx));
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------
const STATE_SEED = 0x6011;
/** deterministic lock gate states: {outerOpen, innerOpen} per lock index */
export function lockState(i) {
  const h = hash4(STATE_SEED, i, 7, 0);
  const outerOpen = (h & 3) === 0;                       // tide gates mostly closed: the barrier is shut
  return { outerOpen, innerOpen: !outerOpen || ((h >> 2) & 1) === 0 };
}

export function layoutG01() {
  const pieces = [];
  for (const sg of S.segments) pieces.push({ ...sg, type: sg.kind === 'abutment' ? 'abut' : 'seg' });
  for (const lk of S.locks) pieces.push({ ...lk, type: 'lock' });
  pieces.push({ ...S.mouth, type: 'mouth' });
  for (const p of pieces) { const sa = sOfXZ(p.a[0], p.a[1]), sb = sOfXZ(p.b[0], p.b[1]); p.sa = Math.min(sa, sb); p.sb = Math.max(sa, sb); }
  pieces.sort((a, b) => a.sa - b.sa);
  for (let i = 0; i < pieces.length; i++) { pieces[i].prev = pieces[i - 1]?.type || 'land'; pieces[i].next = pieces[i + 1]?.type || 'land'; pieces[i].order = i; }
  const chunks = [];
  let lockIdx = 0;
  for (const p of pieces) {
    const len = p.sb - p.sa;
    if (p.type === 'seg') {
      const nU = Math.max(4, Math.round(len / 52)), uL = len / nU;
      const per = 4, nC = Math.ceil(nU / per);
      const segNo = +p.id.split('S')[1];
      const quay = p.quay ? { s0: p.sa + len * (0.27 + 0.05 * (segNo % 3)), s1: p.sa + len * (0.5 + 0.05 * (segNo % 2)) } : null;
      const gh = (p.gateHouses || []).map((g) => ({ s: sOfXZ(g.x, g.z), side: g.side }));
      for (let k = 0; k < nC; k++) {
        const u0 = k * per, u1 = Math.min(nU, u0 + per);
        const s0 = p.sa + u0 * uL, s1 = p.sa + u1 * uL, sm = (s0 + s1) / 2;
        const [cx, cz] = xzAt(sm, -10);
        chunks.push({
          id: `${p.id}#${k}`, site: 'G01', kind: 'seg', part: p.id, name: `${p.id} 沉箱堤段`, cx, cz, r: (s1 - s0) / 2 + 80, y0: p.base - 6, y1: p.crest + 46,
          s0, s1, u0, u1, nU, uL, seg: { id: p.id, no: segNo, sa: p.sa, sb: p.sb, W: p.width, crest: p.crest, base: p.base, prev: p.prev, next: p.next, quay, gh },
        });
      }
    } else if (p.type === 'lock') {
      const sm = (p.sa + p.sb) / 2, [cx, cz] = xzAt(sm, -110);
      const li = lockIdx++;
      const wPrev = pieces[p.order - 1]?.width || 40, wNext = pieces[p.order + 1]?.width || 40;
      chunks.push({ id: p.id, site: 'G01', kind: 'lock', part: p.id, name: `${p.id} 通航船闸`, cx, cz, r: 240, y0: -18, y1: 52, s0: p.sa, s1: p.sb, lock: { idx: li, sa: p.sa, sb: p.sb, width: p.width, sill: p.sill, chamber: p.chamber, state: lockState(li), wPrev, wNext } });
    } else if (p.type === 'abut') {
      const n = Math.max(1, Math.round(len / 180));
      for (let k = 0; k < n; k++) {
        const s0 = p.sa + (len * k) / n, s1 = p.sa + (len * (k + 1)) / n, [cx, cz] = xzAt((s0 + s1) / 2, 0);
        chunks.push({ id: `${p.id}#${k}`, site: 'G01', kind: 'abut', part: p.id, name: `${p.id} 堤根护岸`, cx, cz, r: (s1 - s0) / 2 + 60, y0: -12, y1: 30, s0, s1, abut: { landward: p.prev === 'land' ? 'start' : 'end', sa: p.sa, sb: p.sb, crest: p.crest, width: p.width } });
      }
    } else if (p.type === 'mouth') {
      const sm = (p.sa + p.sb) / 2, [cx, cz] = xzAt(sm, 0);
      chunks.push({ id: 'G01-M', site: 'G01', kind: 'channel', part: 'G01-M', name: 'G01-M 主航口 / 航道浮标', cx, cz, r: 4300, y0: -2, y1: 8, s0: p.sa, s1: p.sb, mouth: { sa: p.sa, sb: p.sb, sm } });
    }
  }
  // harbour office (港务工作间) anchor: harbour tower on the head of the segment west of the mouth
  let office = null;
  const mouthP = pieces.find((p) => p.type === 'mouth');
  for (const p of pieces) {
    if (p.type !== 'seg' || p.next !== 'mouth' || !mouthP) continue;
    const g = (p.gateHouses || []).find((q) => q.side === 'east');
    if (!g) continue;
    const s = sOfXZ(g.x, g.z), H = p.width / 2;
    const [x, z] = xzAt(s, -H + HT_R + 1);
    // world (x, z) look direction of the office consoles (same local frame as harbourTower / pushArc)
    const t = tanAt(s), tx = t[0] * HAND, tz = t[1] * HAND, toward = HAND;   // east gate house: mouth at +X·HAND
    const lx = toward * OFFICE_LOOK[0], lz = OFFICE_LOOK[1];
    const look = [lx * tx + lz * -tz, lx * tz + lz * tx];
    office = { x, z, s, floor: p.crest + OFFICE_FL, radius: HT_R, mouth: xzAt((mouthP.sa + mouthP.sb) / 2, 0), look };
  }
  return { id: 'G01', chunks, office, pieces: pieces.map((p) => ({ id: p.id, type: p.type, sa: p.sa, sb: p.sb })) };
}

// ---------------------------------------------------------------------------------------------
// caisson segment chunk
// ---------------------------------------------------------------------------------------------
const SPL_OUT = 6.5, SPL_IN = 1.8;       // highest splash lines (m above sea level)
const BERM = 3.5;                        // armour berm level (m)

function genSeg(c) {
  const ch = c.chunk, sg = ch.seg, b = c.b;
  const W = sg.W, H = W / 2, deck = sg.crest, base = sg.base, Wn = narrowW(W);
  // head zones: the deck road / wave wall stop there and the head complex takes over
  const zoneA = sg.prev === 'mouth' ? MOUTH_HEAD : HEAD_LEN, zoneB = sg.next === 'mouth' ? MOUTH_HEAD : HEAD_LEN;
  for (let u = ch.u0; u < ch.u1; u++) {
    const s0 = sg.sa + u * ch.uL, s1 = s0 + ch.uL, sm = (s0 + s1) / 2;
    const first = u === 0, last = u === ch.nU - 1;
    const hl = ch.uL / 2 - 0.12;
    const zi = unitWide(ch, sg, u) ? -H : H - Wn;          // harbour face of this caisson
    // deck clip (unit-local x = (s − sm)·HAND)
    const xa = (sg.sa + zoneA - sm) * HAND, xb = (sg.sb - zoneB - sm) * HAND;
    const ca = Math.max(-hl, Math.min(xa, xb)), cb = Math.min(hl, Math.max(xa, xb));
    pushArc(c, sm);
    c.setPart(`${sg.id}/U${u + 1}`, `${sg.id} 第${u + 1}号沉箱`);
    // every caisson was cast separately: slight tone shift per unit (reads as the unit rhythm from the air)
    const tr = c.rng(17, u), tk = 0.88 + tr.next() * 0.17, tw = (tr.next() - 0.5) * 0.05;
    b.pushTint(tk + tw, tk, tk - tw * 1.3);
    caissonUnit(c, sg, u, hl, H, zi, deck, base, ca, cb);
    b.popTint();
    b.pop();
    // segment heads
    if (first || last) {
      const end = last ? 1 : -1;            // +1: head at the end (increasing s) of the segment
      const neighbour = last ? sg.next : sg.prev;
      pushArc(c, last ? sg.sb : sg.sa);
      head(c, sg, end * HAND, neighbour, H, deck, base);
      b.pop();
    }
  }
  // harbour control towers (港务塔) on the mouth heads; the other heads carry their drum in head()
  for (const g of sg.gh) {
    if (g.s < ch.s0 || g.s >= ch.s1) continue;
    const mouthHead = (g.side === 'east' && sg.next === 'mouth') || (g.side === 'west' && sg.prev === 'mouth');
    if (!mouthHead) continue;
    pushArc(c, g.s);
    c.setPart(`${sg.id}/GH-${g.side}`, `${sg.id} 闸房（${g.side === 'west' ? '西' : '东'}端）`);
    harbourTower(c, sg, -H + HT_R + 1, deck, g.side === 'east' ? HAND : -HAND);
    b.pop();
  }
  // mid-segment maintenance building (维护楼): a repeated engineering unit on every segment, clear of
  // the quay / crane span and of the head complexes
  const um = maintUnit(ch.nU);
  if (um >= ch.u0 && um < ch.u1 && um > 0) {
    pushArc(c, sg.sa + (um + 0.5) * ch.uL);
    c.setPart(`${sg.id}/MAINT`, `${sg.id} 维护楼`);
    const zc = -H + 8.4;
    M.headHouse(c, -15, zc - 6, 15, zc + 5.5, deck, 2, { sh: 4.2, blank: [], door: 'nz', coreX: -12 });
    if (c.detail) for (const vx of [6, 10]) M.solid(c, 'hvac', vx - 1.2, deck + 8.4, zc + 2, vx + 1.2, deck + 11.6, zc + 4.5, ALL & ~NY, false);
    b.pop();
  }
  // maintenance quay (lower working quay on piles, harbour side)
  if (sg.quay) {
    const q0 = Math.max(sg.quay.s0, ch.s0), q1 = Math.min(sg.quay.s1, ch.s1);
    if (q1 - q0 > 5) quaySpan(c, sg, q0, q1, H, deck);
  }
}

/** one precast caisson: body, deck, wave wall, armour; deck furniture only between local x ca..cb */
function caissonUnit(c, sg, u, hl, H, zi, deck, base, ca, cb) {
  const b = c.b;
  const x0 = -hl, x1 = hl;
  const dk = cb - ca > 0.5;                 // part of the deck outside the head complex
  // ---- caisson body: outer face wet zone, inner quay wall with mooring wear
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  b.rectZ('mega_concrete', x0, base, x1, deck - 0.6, H, 1);                       // outer face (below berm hidden by the armour)
  c.water(0, EXPO.INNER, SPL_IN, 1);
  b.rectZ('mega_concrete', x0, base, x1, deck - 0.6, zi, -1);                     // inner quay face
  c.water(0, EXPO.DRY, 0, 0);
  b.rectX('mega_concrete', zi, base, H, deck - 0.6, x1, 1); b.rectX('mega_concrete', zi, base, H, deck - 0.6, x0, -1);   // joint faces (steps between wide / narrow caissons)
  b.colBox(x0, base, zi, x1, deck, H);
  // ---- deck slab with coping beam (quay edge overhangs 0.35 m)
  if (dk) {
    c.water(0, EXPO.INNER, SPL_IN, 0.4);
    M.csolid(c, 'mega_concrete', ca, deck - 0.9, zi - 0.35, cb, deck + 0.15, zi + 1.2, 0.04, false, true);   // coping (quay edge)
    c.water(0, EXPO.DRY, 0, 0);
    b.box('mega_concrete', ca, deck - 0.6, zi + 1.2, cb, deck, H - 2.5, PY | NY);
    // ---- wave wall with recurved lip (seaward) + promenade walkway on top + pale precast coping
    c.water(0, EXPO.OUTER, SPL_OUT, 0);
    M.extrude(c, 'mega_concrete', [[H - 2.5, deck - 0.6], [H, deck - 0.6], [H, deck + 2.2], [H + 0.8, deck + 2.9], [H + 0.8, deck + 3.4], [H - 2.5, deck + 3.4]], ca, cb, true);
    c.water(0, EXPO.DRY, 0, 0);
    b.colBox(ca, deck, H - 2.65, cb, deck + 3.75, H + 1.0);              // incl. the coping (walkable top)
    if (!c.far) b.box('concrete_smooth', ca, deck + 3.4, H - 2.65, cb, deck + 3.75, H + 1.0, PY | PZ | NZ);
  }
  // ---- armour mound (outer): berm at +3.5 then 1:1.5 down to the shelf (-9.5), toe berm
  const zt = H + 6 + 1.5 * (BERM + 9.5), zToe = zt + 5;
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  const ar = [[H, BERM], [H + 6, BERM], [zt, -9.5], [zToe, -9.8]];
  for (let i = 0; i < ar.length - 1; i++) b.quad('mega_rock', x0 - 0.12, ar[i][1], ar[i][0], x0 - 0.12, ar[i + 1][1], ar[i + 1][0], x1 + 0.12, ar[i + 1][1], ar[i + 1][0], x1 + 0.12, ar[i][1], ar[i][0]);
  b.colQuad(x0, BERM, H, x0, -9.5, zt, x1, -9.5, zt, x1, BERM, H);
  if (c.near) {
    armourRocks(c, x0, x1, H, BERM, zt, u);
    // precast lift joints (2.5 m pours) on the seaward face above the berm and on the quay wall
    c.water(0, EXPO.OUTER, SPL_OUT, 0);
    M.liftJoints(c, x0 + 0.02, x1 - 0.02, 5.0, deck - 1.0, H, 1);
    c.water(0, EXPO.INNER, SPL_IN, 1);
    M.liftJoints(c, x0 + 0.02, x1 - 0.02, 2.5, deck - 2.0, zi, -1);
  }
  // ---- unit rhythm (区域航拍读到重复的工程单元): every precast caisson ends in a proud pilaster on the
  // seaward face (berm → under the wave-wall lip) and a dark recessed joint groove on the quay face
  if (!c.far) {
    c.water(0, EXPO.OUTER, SPL_OUT, 0);
    for (const e of [-1, 1]) {
      const xa = e < 0 ? x0 - 0.1 : x1 - 1.5, xb = e < 0 ? x0 + 1.5 : x1 + 0.1;
      b.box('mega_concrete', xa, BERM - 0.6, H, xb, deck + 2.3, H + 0.6, PZ | (e < 0 ? PX : NX) | PY);
    }
    c.water(0, EXPO.INNER, SPL_IN, 1);
    b.pushTint(b.tintR * 0.42, b.tintG * 0.42, b.tintB * 0.42);
    b.rectZ('mega_concrete', x1 - 0.22, -2.5, x1, deck - 0.95, zi - 0.004, -1);
    b.rectZ('mega_concrete', x0, -2.5, x0 + 0.22, deck - 0.95, zi - 0.004, -1);
    b.popTint();
    c.water(0, EXPO.DRY, 0, 0);
  }
  if (c.far) { if (dk && u % 2 === 0) M.lightPool(c, (ca + cb) / 2, deck + 0.6, H - 8.5, 11, true); return; }
  if (!dk) return;
  // ---- deck furniture
  const roadZ0 = H - 12.5, roadZ1 = H - 4.5;
  b.withTint([0.95, 0.95, 0.95], () => b.rectY('mega_asphalt', ca, roadZ0, cb, roadZ1, deck + 0.02, 1));
  // kerbs
  b.box('concrete_smooth', ca, deck, roadZ0 - 0.25, cb, deck + 0.15, roadZ0, PY | PZ | NZ);
  b.box('concrete_smooth', ca, deck, roadZ1, cb, deck + 0.15, roadZ1 + 0.25, PY | PZ | NZ);
  if (c.near) {
    // lane markings (dashed centre line, solid edges)
    for (let x = ca + 1; x < cb - 3; x += 9) b.box('paving', x, deck + 0.02, (roadZ0 + roadZ1) / 2 - 0.08, x + 4.5, deck + 0.027, (roadZ0 + roadZ1) / 2 + 0.08, PY);
    b.box('paving', ca, deck + 0.02, roadZ0 + 0.3, cb, deck + 0.027, roadZ0 + 0.42, PY); b.box('paving', ca, deck + 0.02, roadZ1 - 0.42, cb, deck + 0.027, roadZ1 - 0.3, PY);
  }
  // cable trench (缆槽) between the apron and the road
  M.cableTrench(c, ca, cb, deck, zi + Math.min(13.5, (roadZ0 - zi) * 0.45), 1.0);
  const inDeck = (x) => x > ca + 0.8 && x < cb - 0.8;
  // lamp posts every second unit + bollards on the coping edge
  if (u % 2 === 0 && inDeck(0)) M.lampPost(c, 0, deck + 0.15, roadZ0 - 0.6, 0, 9);
  for (const bx of [-hl * 0.5, hl * 0.5]) if (inDeck(bx)) M.bollard(c, bx, deck + 0.15, zi + 0.45);
  // fenders on the quay face + ladders
  b.push(); b.translate(0, 0, zi); b.rotY(Math.PI);
  for (const fx of [-hl * 0.55, hl * 0.55]) if (inDeck(-fx)) M.fender(c, fx, 1.6, { w: 2.2, h: 3.4, d: 0.9 });
  if (inDeck(0)) M.ladder(c, 0, -2.5, 0, deck - 0.9 + 2.5, 0, { key: 'steel_yellow', hoop: false });
  b.pop();
  if (c.near) {
    // promenade railings on the wave wall top + inner-edge rail of the footpath
    M.railX(c, ca, cb, deck + 3.75, H - 2.5, { key: 'aluminium', toe: false });
    M.railX(c, ca, cb, deck + 3.75, H + 0.85, { key: 'aluminium', toe: false });
    // scuppers through the wave wall
    for (const sx of [-hl * 0.3, hl * 0.6]) if (inDeck(sx)) b.box('steel_dark', sx - 0.4, deck + 0.02, H - 0.01, sx + 0.4, deck + 0.4, H + 0.02, PZ);
    // joint seal strip (dark) on the deck between units
    if (inDeck(x1 - 1)) b.box('rubber', x1 - 0.02, deck - 0.01, zi + 1.2, x1 + 0.12, deck + 0.005, H - 2.5, PY);
    // life buoy
    if (u % 3 === 1 && inDeck(hl * 0.1)) M.lifeBuoy(c, hl * 0.1, deck + 0.15, zi + 1.6, Math.PI);
    // utility cable tray under the coping on the quay face
    b.push(); b.translate(0, 0, zi - 0.36); b.rotY(Math.PI);
    M.cableTray(c, -cb, -ca, deck - 1.4, 0.35, 0.5, { brackets: true });
    b.pop();
  }
}

function armourRocks(c, x0, x1, H, berm, zt, u) {
  const r = c.rng(31, u);
  // berm crest: a double row of 2.6 m precast armour cubes (placed, slightly rotated / tilted)
  c.water(0, EXPO.OUTER, SPL_OUT + 1.5, 0);
  for (let x = x0 + 1.5; x < x1 - 1.2; x += 2.95) {
    for (const zr of [1.9, 4.6]) {
      if (r.next() < 0.08) continue;
      const s = 2.45 + r.next() * 0.3;
      M.armourCube(c, x + (r.next() - 0.5) * 0.5, berm + s * 0.42, H + zr + (r.next() - 0.5) * 0.5, s, (r.next() - 0.5) * 0.5, (r.next() - 0.5) * 0.3);
    }
  }
  // rock rows along the slope from the berm edge down to just below the low-water line
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  const slope = Math.hypot(zt - (H + 6), berm + 9.5);
  for (let x = x0 + 0.8; x < x1 - 0.5; x += 2.1) {
    for (let d = 5.6; d < 6 + slope * 0.55; d += 1.9) {
      let z, y;
      if (d < 6) { z = H + d; y = berm; } else { const k = (d - 6) / slope; z = H + 6 + (zt - H - 6) * k; y = berm - (berm + 9.5) * k; }
      if (y < -3.5) continue;
      const s = 0.95 + r.next() * 0.6;
      M.rock(c, 'mega_rock', x + (r.next() - 0.5) * 1.1, y + s * 0.25, z + (r.next() - 0.5) * 0.9, s, hash4(c.seed, u, Math.round(x * 10), Math.round(d * 10)), 0.62);
    }
  }
}

/**
 * segment head. Mouth heads: raised head block, roundhead bulging into the mouth with the navigation light
 * tower (red west / green east). Lock / abutment heads: head complex — podium with a harbour-side bulge,
 * three-storey head house (闸房楼), round gate-house drum on the seaward corner rising above it, the gate
 * dock in the end face (lock heads) and the armour mound closed around the end.
 */
function head(c, sg, endSign, neighbour, H, deck, base) {
  const b = c.b;
  c.setPart(`${sg.id}/HEAD-${endSign > 0 ? 'E' : 'W'}`, `${sg.id} 堤头${neighbour === 'mouth' ? '（主航口）' : neighbour === 'lock' ? '（船闸闸首）' : ''}`);
  const e = endSign;                   // +1: the head end face is at local x = 0 facing +X
  const sX = e > 0 ? PX : NX, iX = e > 0 ? NX : PX;
  if (neighbour === 'mouth') return mouthHead(c, sg, e, H, deck, base);
  const L = HEAD_LEN, xa = e > 0 ? -L : 0, xb = e > 0 ? 0 : L;
  const zh0 = -H - 6, zh1 = H + 0.8, py = deck + 1.0;
  // harbour-side bulge (a wider head caisson) + podium slab over the whole head
  c.water(0, EXPO.INNER, SPL_IN, 1);
  b.box('mega_concrete', xa, base, zh0, xb, py, -H, NZ | sX | iX);
  c.water(0, EXPO.LOCK, SPL_OUT * 0.8, 0.3);
  b.rectX('mega_concrete', -H, deck - 0.6, zh1, py, 0, e);                        // end face above the caisson
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  b.rectZ('mega_concrete', xa, deck - 0.6, xb, py, zh1, 1);
  c.water(0, EXPO.DRY, 0, 0);
  b.rectX('mega_concrete', -H, deck - 0.6, zh1, py, e > 0 ? xa : xb, -e);        // podium step toward the deck
  b.rectY('mega_concrete', xa, zh0, xb, zh1, py, 1);
  b.colBox(xa, base, zh0, xb, py, zh1);
  // seaward parapet continuing the wave-wall crest line + parapet along the end edge
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  M.solid(c, 'mega_concrete', xa, py, H - 0.6, xb, deck + 3.4, zh1, ALL & ~NY, false);
  b.colBox(xa, py, H - 0.75, xb, deck + 3.75, zh1 + 0.2);
  c.water(0, EXPO.DRY, 0, 0);
  if (!c.far) b.box('concrete_smooth', xa, deck + 3.4, H - 0.75, xb, deck + 3.75, zh1 + 0.2, PY | PZ | NZ | PX | NX);
  M.solid(c, 'mega_concrete', e > 0 ? -0.5 : 0, py, zh0, e > 0 ? 0 : 0.5, py + 1.1, H - 0.6, ALL & ~NY);
  // armour mound closed around the end (end cap of the mound prism)
  const zt = H + 6 + 1.5 * (BERM + 9.5), zToe = zt + 5;
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  const pr = b.part('mega_rock');
  const capPts = [[H, BERM], [H + 6, BERM], [zt, -9.5], [zToe, -9.8], [H, -9.8]];
  const vi = capPts.map(([z, y]) => b.vert(pr, ...b.tp(0.05 * e, y, z), ...b.td(e, 0, 0), z, y));
  for (let k = 1; k < vi.length - 1; k++) { if (e > 0) b.tri(pr, vi[0], vi[k + 1], vi[k]); else b.tri(pr, vi[0], vi[k], vi[k + 1]); }
  c.water(0, EXPO.DRY, 0, 0);
  if (c.near) {
    const r = c.rng(78, e);
    for (let k = 0; k < 26; k++) {
      const z = H + 1 + r.next() * 22, y = z < H + 6 ? BERM : BERM - (z - H - 6) / 1.5;
      if (y < -3) continue;
      M.rock(c, 'mega_rock', e * (0.6 + r.next() * 2.5), y + 0.5, z, 1.0 + r.next() * 0.7, hash4(c.seed, 700 + k, e, 2), 0.62);
    }
  }
  // gate dock in the end face (lock heads): dark recess with the parked rolling-gate leaf
  if (neighbour === 'lock') {
    const g0 = H - 17, g1 = H - 3;
    c.water(0, EXPO.LOCK, 4, 0);
    b.rectX('mega_steel', g0, -10, g1, deck + 0.3, 0.06 * e, e);
    c.water(0, EXPO.DRY, 0, 0);
    if (!c.far) {
      // concrete portal frame around the dock opening
      b.box('concrete_smooth', e > 0 ? -0.2 : -0.6, -1, g0 - 1.2, e > 0 ? 0.6 : 0.2, deck + 1.6, g0, ALL & ~NY);
      b.box('concrete_smooth', e > 0 ? -0.2 : -0.6, -1, g1, e > 0 ? 0.6 : 0.2, deck + 1.6, g1 + 1.2, ALL & ~NY);
      b.box('concrete_smooth', e > 0 ? -0.2 : -0.6, deck + 0.3, g0, e > 0 ? 0.6 : 0.2, deck + 1.6, g1, ALL);
      b.push(); b.rotY(e > 0 ? Math.PI / 2 : -Math.PI / 2);      // local +Z now = toward the lock
      const gz0 = e > 0 ? -g1 : g0, gz1 = e > 0 ? -g0 : g1;
      c.water(0, EXPO.LOCK, 4, 0);
      gateLeafFace(c, gz0 + 0.6, gz1 - 0.6, -10, deck + 0.2, 0.1);
      c.water(0, EXPO.DRY, 0, 0);
      b.pop();
    }
  }
  // head house (闸房楼) on the harbour side of the podium + gate-house drum on the seaward corner
  const hx0 = e > 0 ? -L + 6 : 3, hx1 = e > 0 ? -3 : L - 6;
  M.headHouse(c, hx0, zh0 + 1.5, hx1, H - 13, py, 4, { sh: 3.8, door: 'nz', coreX: e > 0 ? hx0 + 3.2 : hx1 - 3.2 });
  const dr = 9.5, dh = 30 + (sg.no % 3) * 3;
  c.setPart(`${sg.id}/GH-${endSign > 0 ? 'E' : 'W'}`, `${sg.id} 闸房圆楼（${endSign > 0 ? '东' : '西'}端）`);
  M.roundTower(c, -e * 11.5, py, H - 10.5, dr, dh, { band0: dh - 9.2, band1: dh - 5.8, band2: [dh - 3.6, dh - 1.4], door: -e * Math.PI / 2, lit: true, mastH: 8, beacon: neighbour === 'lock' ? 'light_red' : undefined });
  if (c.far) { M.lightPool(c, -e * L * 0.5, py + 0.1, zh0 + 2, 9, true); return; }
  // stair from the deck up onto the podium (road side), lamps on the podium
  M.stairFlight(c, e > 0 ? -L - 1.9 : L + 1.9, deck, py, H - 4.3, H - 2.6, { dir: e > 0 ? 1 : -1, run: 0.3 });
  M.lampPost(c, -e * 22, py, H - 2.2, Math.PI, 8);
  M.lampPost(c, -e * 4, py, zh0 + 1.2, 0, 8);
}

/** mouth head: raised head block, roundhead with armour bulging into the mouth, navigation light tower */
function mouthHead(c, sg, e, H, deck, base) {
  const b = c.b;
  const hd = deck + 3.2;
  const xa = e > 0 ? -MOUTH_HEAD : 0, xb = e > 0 ? 0 : MOUTH_HEAD;
  c.water(0, EXPO.LOCK, SPL_OUT * 0.8, 0.3);
  b.box('mega_concrete', xa, base, -H, xb, hd, H, (e > 0 ? PX : NX) | PY);
  c.water(0, EXPO.DRY, 0, 0);
  b.box('mega_concrete', xa, deck, -H, xb, hd, H, PZ | NZ | (e > 0 ? NX : PX));
  b.colBox(xa, base, -H, xb, hd, H);
  if (c.detail) {
    b.box('mega_concrete', xa, hd, H - 0.4, xb, hd + 1.1, H, ALL & ~NY);
    b.box('mega_concrete', e > 0 ? -0.4 : 0, hd, -H, e > 0 ? 0 : 0.4, hd + 1.1, H - 0.4, ALL & ~NY);
    M.stairFlight(c, e > 0 ? -MOUTH_HEAD - 0.1 : MOUTH_HEAD + 0.1, deck, hd, -H + 2, -H + 4.2, { dir: e > 0 ? 1 : -1, run: 0.3 });
    M.planter(c, e > 0 ? -17 : 10, -H + 9, e > 0 ? -10 : 17, -H + 15, hd, c.seed + 11 * e);
  }
  // roundhead: half drum bulging into the mouth, armour wrapping around it
  const rr = Math.min(18, H * 0.86);
  b.push(); b.translate(0, 0, H - rr);
  c.water(0, EXPO.OUTER, SPL_OUT, 0);
  const a0 = e > 0 ? 0 : Math.PI, segs = c.far ? 10 : c.near ? 32 : 18;
  b.lathe('mega_concrete', [[rr, base], [rr, deck + 1.0], [rr - 1.2, deck + 1.0]], segs, { a0, a1: a0 + Math.PI });
  b.lathe('mega_rock', [[rr + 24, -9.8], [rr + 4, 3.0], [rr, 3.0]], segs, { a0, a1: a0 + Math.PI });
  c.water(0, EXPO.DRY, 0, 0);
  b.lathe('mega_concrete', [[rr - 1.2, deck + 1.0], [0, deck + 1.0]], segs, { a0, a1: a0 + Math.PI });
  if (!c.far) b.lathe('concrete_smooth', [[rr + 0.25, deck + 1.0], [rr + 0.25, deck + 1.45], [rr - 0.6, deck + 1.45], [rr - 0.6, deck + 1.0]], segs, { a0, a1: a0 + Math.PI });
  b.colBox(-rr, base, -rr, rr, deck + 1, rr);
  if (c.near) {
    const r = c.rng(77, e);
    for (let k = 0; k < 70; k++) {
      const a = a0 + r.next() * Math.PI, d = rr + 1 + r.next() * 9, y = 3.0 - (d - rr - 4) * (12.8 / 20) * (d > rr + 4 ? 1 : 0);
      if (y < -3) continue;
      M.rock(c, 'mega_rock', Math.sin(a) * d, Math.min(3.0, y) + 0.4, Math.cos(a) * d, 1.0 + r.next() * 0.7, hash4(c.seed, 900 + k, e, 1), 0.62);
    }
  }
  b.pop();
  // navigation light tower (导航灯塔) on the harbour-side corner of the raised head block, 6 m back from the end
  // face: red = west (port side entering), green = east; sides follow the channel buoys (genChannel: side < 0 =
  // red). Fix round 2 (QS-13): it stood on the seaward roundhead, right in the centre of the harbour-office
  // window view of the mouth; here it still flanks the mouth from the sea (S09 / S09b) and clears the office view.
  const west = e * HAND > 0;            // head at the end (east edge) of a segment = the WEST side of the mouth
  c.setPart(`${sg.id}/NAV-LIGHT`, `${sg.id} 主航口导航灯塔（${west ? '红·左舷' : '绿·右舷'}）`);
  M.lightTower(c, -e * 6, hd, -H + 4.2, 23.8, west ? 'red' : 'green', { door: e * Math.PI / 2 });
  if (!c.far) M.lampPost(c, e * rr * 0.1, deck + 1.0, H - rr - 6, Math.PI, 8);
}

/** dark steel gate-leaf lattice face in the plane z = zf (facing +Z), x from a to b, y from y0 to y1 */
function gateLeafFace(c, a, bb, y0, y1, zf) {
  const b = c.b;
  b.rectZ('mega_steel', a, y0, bb, y1, zf, 1);
  if (!c.detail) return;
  const nx = Math.max(2, Math.round((bb - a) / 1.6)), ny = Math.max(3, Math.round((y1 - y0) / 1.8));
  for (let i = 0; i <= nx; i++) { const x = a + ((bb - a) * i) / nx; b.box('mega_steel', x - 0.12, y0, zf, x + 0.12, y1, zf + 0.35, PZ | PX | NX); }
  for (let j = 0; j <= ny; j++) { const y = y0 + ((y1 - y0) * j) / ny; b.box('mega_steel', a, y - 0.1, zf, bb, y + 0.1, zf + 0.3, PZ | PY | NY); }
  if (c.near) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = a + ((bb - a) * (i + 0.5)) / nx, y = y0 + ((y1 - y0) * (j + 0.5)) / ny;
    if (((i + j) & 3) === 0) M.bolts(c, x - 0.5, y - 0.6, x + 0.5, y + 0.6, zf + 0.01, 0.25, 0.02, 'steel');
  }
}

/** lower working quay on piles along the harbour side, arc stations q0..q1 (wide maintenance quay) */
function quaySpan(c, sg, q0, q1, H, deck) {
  const b = c.b, qy = 3.2, qw = 20;
  const sm = (q0 + q1) / 2, L = q1 - q0;
  pushArc(c, sm);
  c.setPart(`${sg.id}/QUAY`, `${sg.id} 维护码头`);
  const x0 = -L / 2, x1 = L / 2, za = -H - qw, zb = -H - 0.35;
  c.water(0, EXPO.INNER, SPL_IN, 1);
  M.csolid(c, 'mega_concrete', x0, qy - 1.4, za, x1, qy, zb, 0.05, true, true);      // deck slab + edge beam
  c.water(0, EXPO.DRY, 0, 0);
  if (c.far) { M.gantryCrane(c, x0 * 0.2, deck, -H + 2.2, -H + 11.2, 18, { hookDrop: 8 }); b.pop(); return; }
  // piles
  const piles = Math.max(2, Math.round(L / 7));
  for (let i = 0; i <= piles; i++) for (const zz of [za + 1.2, (za + zb) / 2, zb - 1.0]) {
    c.water(0, EXPO.INNER, SPL_IN, 0.2);
    b.cylinder('mega_concrete', x0 + (L * i) / piles, -14, zz, 0.55, qy - 1.4 + 14, c.near ? 12 : 6, { top: false });
  }
  c.water(0, EXPO.DRY, 0, 0);
  // fenders + bollards on the quay edge, crane rails on the main deck behind
  b.push(); b.translate(0, 0, za); b.rotY(Math.PI);
  for (let x = x0 + 6; x < x1 - 3; x += 16) M.fender(c, -x, qy - 1.6, { w: 1.8, h: 2.2, d: 0.7 });
  b.pop();
  for (let x = x0 + 3; x < x1 - 1; x += 12) M.bollard(c, x, qy, za + 0.6);
  M.craneRails(c, x0, x1, deck, [-H + 2.2, -H + 11.2]);
  // stairs from the quay up to the deck (along the wall) at both ends
  for (const sx of [x0 + 2, x1 - 2 - (deck - qy) / 0.18 * 0.28]) M.stairFlight(c, sx, qy, deck, zb - 2.6, zb - 0.4, { run: 0.28 });
  // gantry crane parked over the quay edge (crane rails on the deck)
  M.gantryCrane(c, x0 * 0.2, deck, -H + 2.2, -H + 11.2, 18, { hookDrop: 8 });
  // quay lamps
  for (let x = x0 + 10; x < x1 - 5; x += 34) M.lampPost(c, x, qy, za + 2.0, 0, 8);
  if (c.near) {
    M.railX(c, x0, x1, qy, zb - 2.8, { key: 'steel_yellow' });
    // containers / equipment boxes on the quay
    const r = c.rng(55, sg.no);
    for (let i = 0; i < 7; i++) {
      const cx = lerpX(x0 + 8, x1 - 8, r.next()), w = 6.1, d = 2.44, hh = 2.6;
      const zc = za + 3 + (i % 2) * 5;
      b.withTint(i % 3 === 0 ? [0.9, 0.9, 0.88] : i % 3 === 1 ? [0.45, 0.55, 0.62] : [0.7, 0.35, 0.22], () => b.cbox('panel_grey', cx - w / 2, qy, zc, cx + w / 2, qy + hh, zc + d, 0.03, false));
    }
  }
  b.pop();
}
const lerpX = (a, b, t) => a + (b - a) * t;

/** harbour control tower on a mouth head, with the 港务工作间 (harbour office) facing the mouth */
function harbourTower(c, sg, zc, deck, toward) {
  // toward: local X direction (+1/-1) of the mouth from this tower
  const b = c.b;
  c.setPart(`${sg.id}/HARBOUR-OFFICE`, `${sg.id} 港务塔 · 港务工作间`);
  const fl = deck + OFFICE_FL;
  // hollow collider at mid AND near: a camera placed in the office before the near LOD arrives must not
  // sit inside a solid collider (the controls would push it out of the tower)
  M.roundTower(c, 0, deck, zc, HT_R, HT_H, {
    band0: OFFICE_FL - 0.2 + 0.9, band1: OFFICE_FL + 3.9, band2: [HT_H - 6.2, HT_H - 2.6], door: -toward * Math.PI / 2,
    beacon: sg.next === 'mouth' ? 'light_red' : 'mega_light_green', mastH: 10, radar: true, lit: true, hollow: !c.far, mullion: 2.7, mullionW: 0.07, mullionPhase: OFFICE_MULLION_PHASE,
  });
  if (c.near) harbourOffice(c, 0, fl, zc, HT_R - 0.45, toward);
  M.serviceBlock(c, -toward * 17.5 - 8, zc - 7, -toward * 17.5 + 8, zc + 6, deck, 7.0, { windows: ['pz', 'nz'], door: 'nz' });
  if (c.detail) M.planter(c, -6, zc + 11, 6, zc + 14.5, deck, c.seed + 3);
}

/** interior of the harbour office (港务工作间) inside a drum of radius ri at floor level fl (fix round 2, QS-13):
 *  operations-room fit-out along the window facing the mouth — VTS console with radar / ECDIS / AIS displays
 *  (screens.js atlas pages), a chart desk with the paper harbour chart, parallel ruler, dividers and a lamp,
 *  side consoles (CCTV, lock & gate board, tide, weather, berths, comms, systems), task chairs, phone, VHF set,
 *  binoculars, papers; equipment racks + door on the back (stair core) wall; carpet floor, ceiling lights. */
function harbourOffice(c, x, fl, z, ri, toward) {
  const b = c.b;
  b.push(); b.translate(x, fl, z);
  // floor (dark blue-grey carpet tiles), ceiling, wall below the window band and above it
  b.withTint([0.36, 0.4, 0.46], () => b.lathe('fabric', [[ri, 0], [0, 0.0001]], 40, {}));
  b.lathe('plaster', [[0, 3.6], [ri, 3.6001]], 40, {});
  b.lathe('plaster', [[ri, 0.9], [ri, 0]], 40, {});               // inner wall below the window band (faces in)
  b.lathe('plaster', [[ri, 3.6], [ri, 3.0]], 40, {});
  b.withTint([0.55, 0.56, 0.58], () => b.lathe('cabinet', [[ri, 0.12], [ri - 0.02, 0.12], [ri - 0.02, 0.0]], 40, {}));   // skirting
  b.colPolyY(ring(ri, 24), [], 0);
  // office frame: local +Z toward the look direction (OFFICE_LOOK_DEG seaward of the tangent toward the mouth;
  // views().g01-office looks the same way). Seen from the eye (on +Z), local +X is on the LEFT.
  b.push(); b.rotY(Math.atan2(toward * OFFICE_LOOK[0], OFFICE_LOOK[1]));
  const Rd = ri - 0.95;                                           // console desk centre line (desk 0.8 m deep)
  const R = c.rng(61, 3);
  // module(phiRight, width, fn): a desk module centred phiRight radians to the RIGHT of the view axis
  const module = (phiRight, w, fn) => { b.push(); b.rotY(-phiRight); b.translate(0, 0, Rd); fn(w); b.pop(); };
  // ---- main VTS console (right of centre): radar in the middle, ECDIS left, AIS right; keyboard, trackball, mic
  module(0.135, 2.2, (w) => {
    consoleDesk(c, w);
    display(c, 0.68, 0.79, 0.12, 0.6, 0.34, PAGE.ECDIS, 0.32);
    display(c, 0, 0.79, 0.2, 0.62, 0.35, PAGE.RADAR, 0);
    display(c, -0.68, 0.79, 0.12, 0.6, 0.34, PAGE.AIS, -0.32);
    keyboard(c, 0.12, -0.18); keyboard(c, -0.55, -0.2, 0.1);
    b.cylinder('black', -0.18, 0.76, -0.2, 0.05, 0.035, 12, { top: true });                       // trackball housing
    b.cylinder('steel_dark', -0.18, 0.795, -0.2, 0.025, 0.012, 10, { top: true });
    gooseneckMic(c, 0.45, -0.1);
    paperSheet(c, 0.72, -0.32, 0.93, -0.02, 0.777, PAGE.PAPER_LOG);                                    // log sheet
    b.cylinder('porcelain', -0.98, 0.775, -0.26, 0.042, 0.095, 14, { top: true });                  // mug
    b.box('black', -0.88, 0.775, -0.36, -0.8, 0.79, -0.2, ALL & ~NY);                               // handheld VHF
    chair(c, 0.35, -1.0, 0.18 + (R.next() - 0.5) * 0.3, R.next());
    chair(c, -0.62, -0.95, -0.25 + (R.next() - 0.5) * 0.3, R.next());
  });
  // ---- chart desk (left of centre): paper harbour chart on a slightly raked board, ruler, dividers, lamp
  module(-0.125, 1.6, (w) => {
    consoleDesk(c, w, { low: true });
    chartBoard(c, 0, 1.24, 0.82, PAGE.PAPER_CHART);
    display(c, 0, 0.79, 0.33, 0.42, 0.24, PAGE.TIDE, 0, 0.18);
    deskLamp(c, 0.66, 0.2);
    binoculars(c, -0.55, -0.22, 0.5);
    paperSheet(c, -0.66, -0.36, -0.42, -0.06, 0.777, PAGE.PAPER_LOG);                                  // notes
    chair(c, -0.35, -1.25, -0.6 + (R.next() - 0.5) * 0.3, R.next());
  });
  // ---- side consoles (beside the window view: CCTV / lock & gate board, tide / weather, berths / comms, systems)
  const sides = [[0.43, 1.9, PAGE.CCTV, PAGE.LOCKS], [-0.41, 1.9, PAGE.WEATHER, PAGE.ECDIS_MOUTH], [0.71, 1.9, PAGE.BERTHS, PAGE.COMMS], [-0.69, 1.9, PAGE.SYSTEMS, PAGE.RADAR_LONG]];
  for (const [phi, w, p0, p1] of sides) module(phi, w, (ww) => {
    consoleDesk(c, ww);
    display(c, 0.4, 0.79, 0.16, 0.6, 0.34, p0, 0.18);
    display(c, -0.4, 0.79, 0.16, 0.6, 0.34, p1, -0.18);
    keyboard(c, 0, -0.2);
    if (phi > 0.6) phone(c, 0.62, -0.2); else if (phi < -0.6) vhfSet(c, -0.6, -0.12); else if (phi > 0) phone(c, -0.66, -0.18); else vhfSet(c, 0.62, -0.1);
    chair(c, (R.next() - 0.5) * 0.4, -1.0 - R.next() * 0.25, (R.next() - 0.5) * 0.7, R.next());
  });
  // ---- back (stair-core) wall: door, equipment racks, notice board, printer cabinet
  b.box('plaster', -2.4, 0, -ri + 0.6, 2.4, 3.6, -ri + 0.8, ALL);
  b.box('wood_door', -0.5, 0, -ri + 0.81, 0.5, 2.1, -ri + 0.83, PZ);
  b.box('aluminium', -0.55, 0, -ri + 0.8, -0.5, 2.15, -ri + 0.86, ALL); b.box('aluminium', 0.5, 0, -ri + 0.8, 0.55, 2.15, -ri + 0.86, ALL);
  b.box('aluminium', -0.55, 2.1, -ri + 0.8, 0.55, 2.15, -ri + 0.86, ALL);
  for (const rx of [-1.9, -1.25]) rack(c, rx, -ri + 0.82);
  b.box('cabinet', 0.95, 0, -ri + 0.82, 2.1, 0.75, -ri + 1.4, ALL & ~NY);
  b.withTint([0.4, 0.42, 0.45], () => b.cbox('cabinet', 1.15, 0.75, -ri + 0.95, 1.75, 1.0, -ri + 1.38, 0.02));   // printer
  b.withTint([0.82, 0.78, 0.62], () => b.box('cabinet', 1.0, 1.4, -ri + 0.81, 2.0, 2.1, -ri + 0.83, PZ));       // notice board
  b.colBox(-2.4, 0, -ri + 0.6, 2.4, 3.6, -ri + 0.8);
  b.pop();
  // ceiling: light panels (night-gated warm) + a cable tray ring to the consoles
  for (const [lx, lz] of [[0, 0], [2.6, 2.6], [-2.6, 2.6], [2.6, -2.6], [-2.6, -2.6], [0, 5.2], [3.7, 4.0], [-3.7, 4.0]]) {
    b.box('aluminium', lx - 0.62, 3.56, lz - 0.32, lx + 0.62, 3.6, lz + 0.32, NY);
    b.box('light_warm', lx - 0.58, 3.555, lz - 0.28, lx + 0.58, 3.56, lz + 0.28, NY);
  }
  b.pop();
}

/** console desk module (local +Z = window, the operator on −Z): dark cabinet, stone top, cable spine, kick plate */
function consoleDesk(c, w, o = {}) {
  const b = c.b, h = 0.74;
  b.withTint([0.34, 0.36, 0.4], () => {
    b.cbox('cabinet', -w / 2 + 0.02, 0.08, -0.32, w / 2 - 0.02, h, 0.38, 0.015);
    b.box('cabinet', -w / 2 + 0.06, 0, -0.26, w / 2 - 0.06, 0.08, 0.34, PZ | NZ | PX | NX);
  });
  b.cbox('counter', -w / 2, h, -0.46, w / 2, h + 0.035, 0.42, 0.008);
  b.withTint([0.18, 0.19, 0.21], () => b.box('rubber', -w / 2, h + 0.004, -0.47, w / 2, h + 0.03, -0.45, PZ | NZ | PY));   // soft front edge
  if (!o.low) b.box('aluminium_dark', -w / 2 + 0.05, h + 0.035, 0.05, w / 2 - 0.05, h + 0.06, 0.4, PY | NZ | PX | NX);      // monitor bridge
  // slim louvre strips + a cable-access hatch line on the operator face (no dark holes)
  if (c.near) {
    for (let k = 0; k < 3; k++) b.box('aluminium_dark', -w / 2 + 0.12, 0.16 + k * 0.035, -0.326, w / 2 - 0.12, 0.172 + k * 0.035, -0.32, NZ | PY);
    for (const hx of [-w / 4, w / 4]) b.box('aluminium_dark', hx - 0.004, 0.26, -0.326, hx + 0.004, 0.66, -0.321, NZ);
  }
  c.b.colBox(-w / 2, 0, -0.46, w / 2, h + 0.04, 0.42);
}
/** display on a stand: housing + self-lit screen (atlas page) facing −Z (the operator); yaw turns it toward the
 *  operator, tilt leans the top back */
function display(c, x, y, z, w, h, page, yaw = 0, tilt = 0.12) {
  const b = c.b;
  b.push(); b.translate(x, y, z); b.rotY(yaw);
  b.box('steel_dark', -0.12, 0, -0.08, 0.12, 0.012, 0.1, ALL & ~NY);                 // foot plate
  b.box('steel_dark', -0.025, 0.012, 0.04, 0.025, 0.12 + h * 0.4, 0.07, ALL);         // post
  b.translate(0, 0.1, 0); b.rotX(tilt);
  b.box('black', -w / 2 - 0.016, 0, 0, w / 2 + 0.016, h + 0.032, 0.03, ALL);          // housing
  b.box('black', -w / 2 + 0.05, 0.04, 0.03, w / 2 - 0.05, h - 0.01, 0.05, PZ | PX | NX | PY);   // back hump
  const [u0, v0, u1, v1] = screenUV(page), y0 = 0.016, y1 = h + 0.016, xw = w / 2;
  b.quad('mega_screen', xw, y0, -0.002, -xw, y0, -0.002, -xw, y1, -0.002, xw, y1, -0.002, [u0, v0, u1, v0, u1, v1, u0, v1]);
  b.pop();
}
/** paper chart on a raked chart board (page of the atlas, matte paper), w × d, front edge at z −d/2 */
function chartBoard(c, x, w, d, page) {
  const b = c.b, h = 0.775, rake = 0.11;
  b.push(); b.translate(x, h, -0.04); b.rotX(-rake);
  b.withTint([0.55, 0.5, 0.42], () => b.cbox('wood', -w / 2 - 0.04, -0.03, -d / 2 - 0.04, w / 2 + 0.04, 0.0, d / 2 + 0.04, 0.008));
  const [u0, v0, u1, v1] = screenUV(page);
  b.quad('mega_chart', w / 2, 0.002, -d / 2, -w / 2, 0.002, -d / 2, -w / 2, 0.002, d / 2, w / 2, 0.002, d / 2, [u0, v0, u1, v0, u1, v1, u0, v1]);
  // parallel ruler (two clear-edged aluminium bars + links), dividers, pencil
  b.push(); b.translate(-0.12, 0.004, 0.02); b.rotY(0.42);
  for (const dz of [-0.035, 0.035]) b.box('aluminium', -0.3, 0, dz - 0.018, 0.3, 0.01, dz + 0.018, ALL & ~NY);
  for (const lx of [-0.2, 0.2]) b.box('steel_dark', lx - 0.006, 0.01, -0.04, lx + 0.006, 0.014, 0.04, ALL & ~NY);
  b.pop();
  b.tube('steel', [[0.25, 0.004, -0.12], [0.31, 0.06, -0.08], [0.37, 0.004, -0.03]], 0.004, 5);
  b.withTint([0.95, 0.75, 0.2], () => b.box('cabinet', 0.05, 0.002, 0.2, 0.22, 0.01, 0.208, ALL & ~NY));
  b.pop();
}
/** loose paper sheet (atlas page, matte) lying on a desk top at height y, x0..x1 × z0..z1, text toward the operator */
function paperSheet(c, x0, z0, x1, z1, y, page) {
  const [u0, v0, u1, v1] = screenUV(page);
  c.b.quad('mega_chart', x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1, [u0, v0, u1, v0, u1, v1, u0, v1]);
}
function keyboard(c, x, z, yaw = 0) {
  const b = c.b;
  b.push(); b.translate(x, 0.775, z); b.rotY(yaw);
  b.cbox('black', -0.22, 0, -0.07, 0.22, 0.022, 0.07, 0.004);
  if (c.near) b.withTint([0.32, 0.33, 0.35], () => b.box('cabinet', -0.2, 0.022, -0.055, 0.2, 0.026, 0.055, PY));
  b.pop();
}
function gooseneckMic(c, x, z) {
  const b = c.b;
  b.cylinder('black', x, 0.775, z, 0.045, 0.02, 12, { top: true });
  b.tube('steel_dark', [[x, 0.795, z], [x, 0.95, z + 0.02], [x - 0.04, 1.06, z - 0.06], [x - 0.08, 1.08, z - 0.14]], 0.006, 6);
  b.cylinder('black', x - 0.08, 1.06, z - 0.14, 0.013, 0.05, 8, { top: true });
}
function phone(c, x, z) {
  const b = c.b;
  b.push(); b.translate(x, 0.775, z); b.rotY(0.3);
  b.withTint([0.3, 0.31, 0.33], () => b.cbox('cabinet', -0.1, 0, -0.08, 0.1, 0.05, 0.08, 0.01));
  b.cbox('black', -0.105, 0.05, -0.03, 0.105, 0.075, 0.03, 0.012);
  if (c.near) b.box('light_cyan', -0.05, 0.051, -0.07, 0.03, 0.053, -0.045, PY);
  b.pop();
}
function vhfSet(c, x, z) {
  const b = c.b;
  b.push(); b.translate(x, 0.775, z);
  b.withTint([0.22, 0.23, 0.25], () => b.cbox('cabinet', -0.16, 0, -0.1, 0.16, 0.09, 0.1, 0.008));
  b.box('light_cyan', -0.1, 0.035, -0.101, 0.04, 0.07, -0.1, NZ);                     // channel display
  b.cylinder('black', 0.1, 0.05, -0.1, 0.018, 0.02, 10, { top: true });
  b.cbox('black', 0.17, 0, -0.05, 0.22, 0.12, 0.0, 0.01);                               // handset on its hook
  b.pop();
}
function binoculars(c, x, z, yaw) {
  const b = c.b;
  b.push(); b.translate(x, 0.81, z); b.rotY(yaw);
  for (const dx of [-0.045, 0.045]) M.cylZ(c, 'black', dx, 0, -0.08, 0.08, 0.03, 10);
  b.box('steel_dark', -0.045, -0.01, -0.02, 0.045, 0.01, 0.02, ALL);
  b.pop();
}
function deskLamp(c, x, z) {
  const b = c.b;
  b.cylinder('steel_dark', x, 0.775, z, 0.07, 0.02, 12, { top: true });
  b.tube('steel_dark', [[x, 0.795, z], [x - 0.05, 1.12, z - 0.05], [x - 0.22, 1.2, z - 0.22]], 0.008, 6);
  b.push(); b.translate(x - 0.24, 1.14, z - 0.24);
  b.lathe('steel_dark', [[0.0, 0.08], [0.05, 0.07], [0.09, 0.0]], 12, {});
  b.box('light_warm', -0.05, -0.002, -0.05, 0.05, 0.0, 0.05, NY);
  b.pop();
}
/** task chair (5-star base on casters, gas column, seat, high backrest, armrests) at (x, z) facing +Z rotated by yaw */
function chair(c, x, z, yaw, rnd = 0.5) {
  const b = c.b;
  b.push(); b.translate(x, 0, z); b.rotY(yaw);
  for (let k = 0; k < 5; k++) {
    b.push(); b.rotY(k * 1.2566 + rnd);
    b.box('aluminium_dark', -0.02, 0.06, 0.0, 0.02, 0.1, 0.33, ALL);
    if (c.near) b.cylinder('black', 0, 0.0, 0.31, 0.03, 0.06, 8, { top: true });
    b.pop();
  }
  b.cylinder('aluminium_dark', 0, 0.06, 0, 0.05, 0.08, 10, { top: true });
  b.cylinder('chrome', 0, 0.14, 0, 0.026, 0.3, 10, { top: false });
  b.box('black', -0.17, 0.42, -0.17, 0.17, 0.46, 0.17, ALL);
  b.withTint([0.17, 0.19, 0.24], () => {
    b.cbox('fabric', -0.25, 0.46, -0.24, 0.25, 0.54, 0.25, 0.035);                    // seat
    b.push(); b.translate(0, 0.56, -0.27); b.rotX(-0.16);                                 // backrest leaning back (−Z)
    b.cbox('fabric', -0.23, 0.06, -0.04, 0.23, 0.66, 0.035, 0.03);
    b.pop();
  });
  b.box('black', -0.03, 0.46, -0.3, 0.03, 0.66, -0.25, ALL);                                // back spine
  for (const s of [-1, 1]) {
    b.box('black', s * 0.27 - 0.015, 0.5, -0.05, s * 0.27 + 0.015, 0.66, -0.02, ALL);      // arm post
    b.cbox('black', s * 0.27 - 0.035, 0.66, -0.18, s * 0.27 + 0.035, 0.69, 0.1, 0.01);    // arm pad
  }
  b.pop();
}
/** 19" equipment rack against a wall (front facing +Z): dark cabinet, glass door frame, unit rows + status LEDs */
function rack(c, x, z) {
  const b = c.b;
  b.withTint([0.22, 0.23, 0.25], () => b.cbox('cabinet', x - 0.3, 0, z, x + 0.3, 2.0, z + 0.8, 0.01));
  if (!c.near) return;
  for (let k = 0; k < 9; k++) {
    const y = 0.25 + k * 0.18;
    b.box('black', x - 0.24, y, z + 0.801, x + 0.24, y + 0.13, z + 0.805, PZ);
    b.box(k % 3 === 0 ? 'light_cyan' : 'mega_light_green', x + 0.16, y + 0.05, z + 0.806, x + 0.175, y + 0.065, z + 0.808, PZ);
  }
}
function ring(r, n) { const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }

// ---------------------------------------------------------------------------------------------
// lock chunk: chamber walls into the harbour with lock heads (闸首), rolling gates, gantries, footbridge
// ---------------------------------------------------------------------------------------------
function genLock(c) {
  const ch = c.chunk, lk = ch.lock, b = c.b;
  const sm = (lk.sa + lk.sb) / 2, G = lk.width;
  pushArc(c, sm);
  const zo = 26, zi = zo - lk.chamber;            // outer and inner ends of the chamber walls
  const crest = 11.5, wallT = 10, xw = G / 2 - wallT;
  const Hn = Math.max(lk.wPrev || 40, lk.wNext || 40) / 2;
  const zb = -Hn - 8;                              // behind both neighbouring head bulges: walls widen into the harbour
  const zh = zi + 36;                              // inner lock head
  for (const side of [-1, 1]) {
    c.setPart(`${ch.id}/WALL-${side > 0 ? 'E' : 'W'}`, `${ch.id} 闸室墙（${side > 0 ? '东' : '西'}）`);
    const blocks = [[zb, zo, G / 2, crest], [zh, zb, G / 2 + 8, crest], [zi, zh, G / 2 + 22, crest + 1.5]];
    for (const [za, zz, xo, top] of blocks) {
      const xa = side > 0 ? xw : -xo, xb = side > 0 ? xo : -xw;
      c.water(0, EXPO.INNER, SPL_IN, 0);
      b.box('mega_concrete', xa, -15, za, xb, top, zz, (side > 0 ? PX : NX) | NZ | PZ);
      c.water(0, EXPO.DRY, 0, 0);
      b.box('mega_concrete', xa, -15, za, xb, top, zz, PY);
      b.colBox(xa, -15, za, xb, top, zz);
    }
    // chamber face (wet marks of the lock levels) over the whole length
    c.water(0, EXPO.LOCK, 3.5, 1);
    b.rectX('mega_concrete', zi, -15, zo, crest, side * xw, -side);
    c.water(0, EXPO.OUTER, SPL_OUT, 0);
    b.rectZ('mega_concrete', side > 0 ? xw : -G / 2, -15, side > 0 ? G / 2 : -xw, crest, zo + 0.02, 1);
    c.water(0, EXPO.DRY, 0, 0);
    if (c.far) {
      M.headHouse(c, side > 0 ? G / 2 + 3 : -G / 2 - 19, zi + 6, side > 0 ? G / 2 + 19 : -G / 2 - 3, zi + 30, crest + 1.5, 2, { sh: 4 });
      continue;
    }
    // coping edge + bollards + ladders + fenders along the chamber face
    const xf = side * xw;               // chamber face plane
    b.box('concrete_smooth', side > 0 ? xw - 0.3 : -xw, crest - 0.4, zi, side > 0 ? xw : -xw + 0.3, crest + 0.15, zo, ALL);
    for (let z = zi + 10; z < zo - 5; z += 22) M.bollard(c, xf - side * 0.8, crest + 0.15, z);
    b.push(); b.translate(xf, 0, 0); b.rotY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (let z = zi + 20; z < zo - 10; z += 30) M.ladder(c, side > 0 ? z : -z, -3, 0, crest + 3, 0, {});
    if (c.near) for (let z = zi + 6; z < zo - 4; z += 11) { const lx = side > 0 ? z : -z; b.box('rubber', lx - 0.2, -1.5, 0, lx + 0.2, 6.5, 0.3, ALL); }
    b.pop();
    for (let z = zi + 45; z < zo; z += 40) M.lampPost(c, side > 0 ? G / 2 - 2 : -G / 2 + 2, crest, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, 8);
    if (c.near) M.railZ(c, side > 0 ? G / 2 - 0.3 : -G / 2 + 0.3, crest, zh, zo, { key: 'steel_yellow' });
    // outer-head machinery house on each wall, lock control house (闸控楼) on each inner head block
    M.serviceBlock(c, side > 0 ? xw + 1.2 : -G / 2 + 1.2, zo - 30, side > 0 ? G / 2 - 1.2 : -xw - 1.2, zo - 16, crest, 6.0, { windows: ['px', 'nx', 'nz', 'pz'], door: 'nz' });
    c.setPart(`${ch.id}/CTRL-${side > 0 ? 'E' : 'W'}`, `${ch.id} 闸控楼（${side > 0 ? '东' : '西'}）`);
    M.headHouse(c, side > 0 ? G / 2 + 3 : -G / 2 - 19, zi + 6, side > 0 ? G / 2 + 19 : -G / 2 - 3, zi + 30, crest + 1.5, 2, { sh: 4, door: side > 0 ? 'nx' : 'px' });
    M.lampPost(c, side > 0 ? G / 2 + 20 : -G / 2 - 20, crest + 1.5, zi + 34, 0, 8);
  }
  // sill beams at the gate positions
  const zg0 = zo - 9, zg1 = zi + 9;
  if (!c.far) for (const zg of [zg0, zg1]) b.box('mega_concrete', -xw, -12, zg - 4, xw, -9.6, zg + 4, PY | PZ | NZ);
  // outer rolling gate: closed across the lock entrance (dark steel lattice leaf) or parked in the head dock
  c.setPart(`${ch.id}/GATE-OUT`, `${ch.id} 外闸门（横拉门）`);
  if (!lk.state.outerOpen) rollingGate(c, -xw, xw, zg0, crest);
  c.setPart(`${ch.id}/GATE-IN`, `${ch.id} 内闸门（横拉门）`);
  // inner gate dock: box structure off the east wall at the inner end
  const dx0 = G / 2 + 22, dx1 = G / 2 + xw * 2 + 14;
  c.water(0, EXPO.INNER, SPL_IN, 0);
  M.csolid(c, 'mega_concrete', dx0, -15, zg1 - 9, dx1, crest, zg1 + 9, 0.1, true, false);
  c.water(0, EXPO.DRY, 0, 0);
  if (!lk.state.innerOpen) rollingGate(c, -xw, xw, zg1, crest);
  else if (!c.far) {
    // parked: leaf end face visible in the dock opening
    b.push(); b.translate(xw, 0, zg1); b.rotY(-Math.PI / 2);
    gateLeafFace(c, -4, 4, -9.5, crest - 0.5, -0.2);
    b.pop();
  }
  // gate-hoist portal gantries (闸首门机) over both gate lines: the tall lock silhouette from the sea
  c.setPart(`${ch.id}/GANTRY-OUT`, `${ch.id} 外闸首门机`);
  M.portalGantry(c, -xw - wallT / 2, xw + wallT / 2, zg0 - 13, crest, 26, { trolley: (lk.idx % 2 ? -1 : 1) * xw * 0.35, girder: 4.2 });
  c.setPart(`${ch.id}/GANTRY-IN`, `${ch.id} 内闸首门机`);
  M.portalGantry(c, -xw - wallT / 2, xw + wallT / 2, zg1 + 14, crest + 1.5, 17, { trolley: (lk.idx % 2 ? 1 : -1) * xw * 0.3, girder: 3.0 });
  if (c.far) { b.pop(); return; }
  M.serviceBlock(c, dx1 - 18, zg1 - 7, dx1 - 4, zg1 + 6, crest, 5.0, { windows: ['nz', 'pz', 'px'], door: 'pz' });
  // footbridge (truss, 缆槽 carried underneath) across the chamber behind the outer head
  c.setPart(`${ch.id}/BRIDGE`, `${ch.id} 检修人行桥`);
  footbridge(c, -G / 2 + 3, G / 2 - 3, zo - 48, crest);
  b.pop();
}

function rollingGate(c, x0, x1, zg, crest) {
  const b = c.b;
  c.water(0, EXPO.LOCK, 3.0, 0);
  b.box('mega_steel', x0 + 0.5, -9.6, zg - 3.5, x1 - 0.5, crest + 0.4, zg + 3.5, ALL & ~NY);
  b.colBox(x0, -9.6, zg - 3.5, x1, crest + 0.4, zg + 3.5);
  if (c.detail) {
    b.push(); b.translate(0, 0, zg + 3.5); gateLeafFace(c, x0 + 0.5, x1 - 0.5, -9.6, crest + 0.4, 0); b.pop();
    b.push(); b.translate(0, 0, zg - 3.5); b.rotY(Math.PI); gateLeafFace(c, -(x1 - 0.5), -(x0 + 0.5), -9.6, crest + 0.4, 0); b.pop();
    // walkway on top of the gate with railings
    M.grating(c, x0 + 0.5, zg - 1.2, x1 - 0.5, zg + 1.2, crest + 0.5, {});
    if (c.near) { M.railX(c, x0 + 0.5, x1 - 0.5, crest + 0.5, zg - 1.15, {}); M.railX(c, x0 + 0.5, x1 - 0.5, crest + 0.5, zg + 1.15, {}); }
    // yellow top rail (the gate line reads at distance)
    b.box('steel_yellow', x0 + 0.5, crest + 0.4, zg + 3.0, x1 - 0.5, crest + 0.9, zg + 3.5, ALL & ~NY);
  }
  c.water(0, EXPO.DRY, 0, 0);
}

function footbridge(c, x0, x1, z, crest) {
  const b = c.b, dy = crest + 9, w = 3.2;
  // stair towers
  for (const xs of [x0, x1]) {
    b.box('steel', xs - 1.6, crest, z - 2.4, xs + 1.6, dy + 3.2, z - 2.1, ALL);
    b.box('steel', xs - 1.6, crest, z + 2.1, xs + 1.6, dy + 3.2, z + 2.4, ALL);
    b.colBox(xs - 1.6, crest, z - 2.4, xs + 1.6, dy + 3.2, z + 2.4);
  }
  // deck
  M.grating(c, x0, z - w / 2, x1, z + w / 2, dy, {});
  // trusses (top chord, bottom chord, diagonals) both sides
  const pan = 6, n = Math.max(2, Math.round((x1 - x0) / pan));
  for (const s of [-1, 1]) {
    const zz = z + s * (w / 2 + 0.1);
    b.box('steel_yellow', x0, dy - 0.35, zz - 0.15, x1, dy, zz + 0.15, ALL);
    b.box('steel_yellow', x0, dy + 2.6, zz - 0.15, x1, dy + 2.9, zz + 0.15, ALL);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      b.box('steel_yellow', x - 0.12, dy, zz - 0.12, x + 0.12, dy + 2.6, zz + 0.12, PX | NX | PZ | NZ);
      if (i < n) { const xn = x0 + ((x1 - x0) * (i + 1)) / n; b.tube('steel_yellow', i % 2 ? [[x, dy + 2.6, zz], [xn, dy, zz]] : [[x, dy, zz], [xn, dy + 2.6, zz]], 0.09, c.near ? 6 : 4); }
    }
  }
  // cable trays under the deck (缆槽 between the segments)
  M.cableTray(c, x0, x1, dy - 0.9, z - 0.7, 0.6, { brackets: false });
  M.cableTray(c, x0, x1, dy - 0.9, z + 0.7, 0.6, { brackets: false });
  if (c.near) { for (let x = x0 + 1; x < x1; x += 2.0) b.box('steel', x - 0.02, dy - 0.95, z - 1.1, x + 0.02, dy - 0.35, z + 1.1, ALL); }
}

// ---------------------------------------------------------------------------------------------
// abutment (rubble-mound root to the headland)
// ---------------------------------------------------------------------------------------------
function genAbut(c) {
  const ch = c.chunk, ab = ch.abut, b = c.b;
  const L = ch.s1 - ch.s0, sm = (ch.s0 + ch.s1) / 2;
  const n = Math.max(2, Math.round(L / 30));
  const crest = ab.crest, top = 11, bw = ab.width / 2;
  for (let i = 0; i < n; i++) {
    const sa = ch.s0 + (L * i) / n, sb = ch.s0 + (L * (i + 1)) / n, smid = (sa + sb) / 2, hl = (sb - sa) / 2 + 0.05;
    pushArc(c, smid);
    c.water(0, EXPO.OUTER, SPL_OUT, 0);
    const prof = [[-bw - 18, -9.5], [-top, crest], [top, crest], [bw + 18, -9.5]];
    for (let k = 0; k < prof.length - 1; k++) {
      const key = k === 1 ? 'mega_concrete' : 'mega_rock';
      if (k === 0) c.water(0, EXPO.INNER, SPL_IN, 0); else c.water(0, EXPO.OUTER, SPL_OUT, 0);
      b.quad(key, -hl, prof[k][1], prof[k][0], -hl, prof[k + 1][1], prof[k + 1][0], hl, prof[k + 1][1], prof[k + 1][0], hl, prof[k][1], prof[k][0]);
    }
    c.water(0, EXPO.DRY, 0, 0);
    b.colQuad(-hl, crest, -top, hl, crest, -top, hl, crest, top, -hl, crest, top);
    if (!c.far) {
      b.rectY('mega_asphalt', -hl, -4, hl, 4, crest + 0.03, 1);
      if (i % 2 === 0) M.lampPost(c, 0, crest, -5, 0, 9);
      if (c.near) {
        M.railX(c, -hl, hl, crest, -top + 0.6, { key: 'steel' }); M.railX(c, -hl, hl, crest, top - 0.6, { key: 'steel' });
        const r = c.rng(91, i);
        for (let k = 0; k < 90; k++) {
          const side = r.next() < 0.5 ? -1 : 1, t = r.next() * 0.72;
          const z = side * (top + (bw + 18 - top) * t), y = crest - (crest + 9.5) * t;
          if (y < -3) continue;
          M.rock(c, 'mega_rock', (r.next() - 0.5) * 2 * hl, y + 0.45, z, 1.0 + r.next() * 0.8, hash4(c.seed, i, k, 3), 0.6);
        }
      }
    }
    b.pop();
  }
  void sm;
}

// ---------------------------------------------------------------------------------------------
// channel markers: red (port, west) / green (starboard, east) buoys along the deep channel
// ---------------------------------------------------------------------------------------------
function genChannel(c) {
  if (c.far) return;
  const ch = c.chunk, sm = ch.mouth.sm;
  const p0 = xzAt(sm), n = outAt(sm), t = tanAt(sm);
  const half = S.channel.width / 2 + 18;
  let k = 0;
  for (let d = -1500; d <= 4200; d += 560) {
    if (Math.abs(d) < 260) continue;
    for (const side of [-1, 1]) {
      const x = p0[0] + n[0] * d + t[0] * side * half, z = p0[1] + n[1] * d + t[1] * side * half;
      c.setPart(`G01-M/BUOY-${side < 0 ? 'R' : 'G'}${++k}`, `G01-M 航道浮标（${side < 0 ? '红·左舷' : '绿·右舷'}）`);
      M.buoy(c, x - ch.cx, z - ch.cz, side < 0 ? 'red' : 'green', k);
    }
  }
}

// ---------------------------------------------------------------------------------------------
export function genG01Chunk(c) {
  switch (c.chunk.kind) {
    case 'seg': return genSeg(c);
    case 'lock': return genLock(c);
    case 'abut': return genAbut(c);
    case 'channel': return genChannel(c);
    default: return undefined;
  }
}

/** shot / bookmark poses for the G01 cards (lat, lon, alt, heading, pitch, lens) */
export function g01Info() {
  const sm = (S.mouth ? (sOfXZ(S.mouth.a[0], S.mouth.a[1]) + sOfXZ(S.mouth.b[0], S.mouth.b[1])) / 2 : ARCLEN / 2);
  return { mouthStation: sm, mouth: xzAt(sm), outward: outAt(sm), tangent: tanAt(sm), arcLength: ARCLEN };
}
void Rng; void PX; void NX; void PY; void NY; void PZ; void NZ; void ALL;
