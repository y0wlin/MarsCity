// Office (办公 / 研发) buildings, Zhurong family (owner: buildings-z). Z03-right language: glass volumes
// with white curved fins, white slab bands, roof garden + plant, lobby with a curved canopy.
//
// rect offices (midrise 6–14 / core 12–28 storeys, corner offices in mixed blocks): plan-first —
// street door → lobby (reception) → double-loaded open-plan floors around a stair + lift core on the
// back wall, café on the street corner, WC + store by the core, service door at the back. Curtain wall
// all round (party walls solid), white bullnose slab bands, 2–4 white S-curve fins on the street side
// (+1–2 on a free flank), roof garden or PV with stair house, lift overrun and plant.
// podium towers (spec.footprint.shape 'tower' + meta.podium / meta.tower, 20–110 storeys): glazed shop
// podium (5 m storeys) with a roof terrace garden; the tower (rect → rounded superellipse, round →
// circle) is a loft-engine curtain wall with gentle taper for tall ones, white sail fins (rect) or white
// storey rings (round), crown with plant screen / garden / lantern, central core through the podium.
// Exports rectOffice(ctx, {research}) for research.js.

import * as K from '../kit/index.js';
import { emitBands, emitRoof, emitBase, emitAnchors } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { corridorPlan, addDoor, pubStoreys, clamp, zMass, signTotem, cyanStrip, planterStrip, benchRow, bollardLine, reception, waitingBench, apron } from './z_common.js';
import { curtainFacades, facadeFins } from './z_curtain.js';
import { superEllipse, towerLevels, loftCurtain, loftMass, ringSlab, ringRoof, serviceCore, surfaceFin, surfacePoint, ringBand, offsetRing, resampleClosed, lerp, smooth, skyGarden, skyDoor } from './z_tower.js';
import { officeDesk, plantPot } from '../interior/furniture.js';

const STY_OFFICE = { gh: 5.0, fh: 3.8, ghMin: 4.5, fhMin: 3.6, fhMax: 4.4 };
const STY_LAB = { gh: 5.0, fh: 4.2, ghMin: 4.5, fhMin: 3.9, fhMax: 4.8 };

function isPodiumTower(s) {
  const m = s._meta || {};
  return !!(m.podium && m.tower && s._floors > (m.podium.floors || 3) + 4);
}

// =============================================================================================
// rect office / research block
// =============================================================================================
export function officePlan(ctx, research) {
  const s = ctx.spec;
  const S = pubStoreys(ctx, research ? STY_LAB : STY_OFFICE);
  const plan = corridorPlan(ctx, {
    storeys: S, corridorW: 2.2, lobbyW: clamp(s._w * 0.24, 7, 12),
    module: (L, zone) => (zone === 'front' ? 8.4 : 7.2),
    kind: (L, zone, i, n) => {
      if (L === 0) return zone === 'front' ? (i === n - 1 && n > 1 ? 'shop' : 'office') : (i === 0 ? 'storage' : 'office');
      if (zone === 'back') return i === 0 ? 'bath' : research ? (i % 2 ? 'office' : 'open') : 'open';
      return 'open';
    },
  });
  plan.bayW = 3.0;
  return { plan, S };
}

/** Light ids for interior rooms behind curtain walls (synthetic openings: floor + bay of the room centre). */
function curtainLights(plan) {
  const w = plan.w, d = plan.d, e = 0.03;
  for (const f of plan.floors) for (const r of f.rooms) {
    if (r.kind === 'stair' || r.kind === 'lift') continue;
    let side = null, uc = 0;
    if (Math.abs(r.z1 - d / 2) < e) { side = 'front'; uc = (r.x0 + r.x1) / 2 + w / 2; }
    else if (Math.abs(r.z0 + d / 2) < e) { side = 'back'; uc = w / 2 - (r.x0 + r.x1) / 2; }
    else if (Math.abs(r.x1 - w / 2) < e) { side = 'right'; uc = d / 2 - (r.z0 + r.z1) / 2; }
    else if (Math.abs(r.x0 + w / 2) < e) { side = 'left'; uc = (r.z0 + r.z1) / 2 + d / 2; }
    if (!side || plan.shared[side]) continue;
    const bay = Math.floor((K.perimeterU(side, w, d) + uc) / plan.bayW);
    plan.allOpenings.push({ side, u0: uc - 0.5, u1: uc + 0.5, v0: f.y + 0.02, v1: f.y + f.h - 0.9, kind: 'fixed', room: r, floor: f.level, light: { floor: f.level, bay } });
  }
}

export function rectOffice(ctx, o = {}) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const research = !!o.research;
  const { plan, S } = officePlan(ctx, research);
  const w = plan.w, d = plan.d, ffl = plan.ffl;
  const R = K.roofSpec(s, st, inst);
  plan.roof.kind = R.kind === 'garden' || (inst.roofGarden && !research) ? 'garden' : 'flat';
  plan.roof.surface = R.surface;
  // ---- doors ----
  const lob = plan.lobby;
  const mainU = lob ? lob.cx + w / 2 : w / 2;
  addDoor(plan, { side: 'front', u: mainU, w: 2.6, h: 2.8, kind: 'main', room: lob && lob.room, vestibule: st.coveredEntry });
  if (!s._shared.back) addDoor(plan, { side: 'back', u: clamp(w / 2 - (plan.core.x1 + 2.0), 1.5, w - 1.5), w: 1.4, h: 2.3, kind: 'service', doorKind: 'service' });
  const shop = plan.floors[0].rooms.find((r) => r.kind === 'shop' && Math.abs(r.z1 - d / 2) < 0.05);
  if (shop && shop.x1 - shop.x0 > 4) addDoor(plan, { side: 'front', u: (shop.x0 + shop.x1) / 2 + w / 2, w: 1.8, h: 2.6, kind: 'shop', room: shop, doorKind: 'glazed' });
  // ---- curtain wall + white slab bands + fins ----
  const cold = st.id === 'zr_cold';
  curtainFacades(ctx, plan, {
    bayW: plan.bayW, spandrel: research ? 1.0 : 0.85, depth: Math.min(10, d * 0.45), spandrelKey: cold ? 'panel_insulated' : 'aluminium_dark',
    glassKey: ctx.full ? 'glass_clear' : 'glass_curtain',
    mullD: research ? 0.24 : 0.18, kindFn: (lv) => (lv === 0 ? 'lobby' : 'office'),
  });
  curtainLights(plan);
  const bandD = st.bandShape === 'curved' ? 0.5 : 0.32;
  if (st.bandShape !== 'none') emitBands(ctx, plan, (L) => (L === plan.floors.length ? bandD + 0.15 : bandD), { railFn: () => null, up: st.bandShape === 'curved' ? 0.12 : 0.08, lights: false, cornerR: 1.4 });
  // Z03-right white fins (street side + one flank) — research: straight vertical sun fins on the flanks
  const rng = ctx.sub(960);
  const yTop = plan.roof.y + 1.6;
  if (!research || rng.next() < 0.5) {
    const nF = clamp(Math.round(w / 12), 2, 4);
    const us = [];
    for (let i = 0; i < nF; i++) us.push((w * (i + 0.5 + (rng.next() - 0.5) * 0.3)) / nF);
    if (!s._shared.front) facadeFins(ctx, plan, 'front', { us, y0: ffl - 0.25, y1: yTop, off: bandD + 0.55, bulge: clamp(w * 0.04, 0.6, 1.6), lean: clamp(w * 0.05, 0.8, 2.2), depth: 1.0, thick: 0.38 });
    const flank = !s._shared.right ? 'right' : !s._shared.left ? 'left' : null;
    if (flank && d > 12) facadeFins(ctx, plan, flank, { us: [d * 0.32, d * 0.72], y0: ffl - 0.25, y1: yTop, off: bandD + 0.55, bulge: 0.8, lean: 1.0, depth: 0.9, thick: 0.34, leanDir: [1, -1] });
  }
  if (research) {
    for (const side of ['left', 'right']) {
      if (s._shared[side]) continue;
      b.push(); K.facadeFrame(b, side, w, d, 0);
      const n = Math.max(2, Math.round(d / 1.5));
      const us = []; for (let i = 1; i < n; i++) us.push((d * i) / n);
      b.withTint(inst.bandTint, () => K.verticalFins(b, us, ffl + S.gh, plan.roof.y + 0.8, { depth: 0.75, t: 0.12, key: 'ceramic_band' }));
      b.pop();
    }
  }
  // ---- roof, base, interior, anchors ----
  plan.roofOut = emitRoof(ctx, plan, { garden: plan.roof.kind === 'garden', solar: plan.roof.kind !== 'garden', stairHouse: true });
  if (research && plan.roofOut) {
    // lab exhaust stacks + plant screen along the back
    const inner = plan.roofOut.inner, yr = plan.roofOut.yr;
    const n = clamp(Math.round((inner.x1 - inner.x0) / 6), 2, 6);
    for (let i = 0; i < n; i++) {
      const x = inner.x0 + 2 + ((inner.x1 - inner.x0 - 4) * (i + 0.5)) / n, z = inner.z0 + 1.2;
      const c = { x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 };
      if (plan.roofOut.keep.some((k) => k.x0 < c.x1 && k.x1 > c.x0 && k.z0 < c.z1 && k.z1 > c.z0)) continue;
      b.cylinder('steel_brushed', x, yr, z, 0.35, 4.2, 14, { top: false });
      b.cylinder('steel_dark', x, yr + 4.2, z, 0.38, 0.25, 14, { top: true });
      b.cylinder('concrete', x, yr - 0.02, z, 0.55, 0.3, 14, { top: true });
    }
  }
  emitBase(ctx, plan, { canopy: st.bandShape === 'curved' ? 'curved' : 'flat', bikes: true });
  if (ctx.full) {
    emitInterior(ctx, plan);
    if (lob) {
      const r = lob.room;
      b.push(); b.translate((r.x0 + r.x1) / 2, ffl, r.z0 + 1.4); reception(b, Math.min(3.6, r.x1 - r.x0 - 2.4)); b.pop();
      // lobby: planters in the front corners, a bench by the glazing, blank directory screen beside the core
      b.push(); b.translate(0, ffl, 0);
      plantPot(b, r.x0 + 0.7, r.z1 - 0.8, 1.3, s.hash >>> 0); plantPot(b, r.x1 - 0.7, r.z1 - 0.8, 1.3, (s.hash + 3) >>> 0);
      b.pop();
      if (r.x1 - r.x0 > 5) { b.push(); b.translate(r.x0 + 1.9, ffl, r.z1 - 1.0); b.rotY(Math.PI); waitingBench(b, 2.0); b.pop(); }
      b.box('signage_blank', r.x1 - 0.06, ffl + 1.3, (r.z0 + r.z1) / 2 - 0.6, r.x1 - 0.02, ffl + 2.4, (r.z0 + r.z1) / 2 + 0.6, 2 | 4 | 8 | 16 | 32);
    }
  }
  emitAnchors(ctx, plan);
  b.anchors.cameras.interior = b.anchors.cameras.lobby;
  // forecourt: totem + planter
  const g0 = Math.min(...K.sideGround(s, 'front'));
  if (!s._shared.front) {
    signTotem(b, clamp(mainU - w / 2 - 4.5, -w / 2 + 0.8, w / 2 - 0.8), g0, d / 2 + 4.2, 0, { w: 0.9, h: 2.4 });
    const px = clamp(mainU - w / 2 + 6.5, -w / 2 + 3, w / 2 - 3);
    planterStrip(b, px - 2.2, d / 2 + 2.6, px + 2.2, d / 2 + 4.0, g0, (s.hash + 77) >>> 0, { tree: true, treeH: 4.0 });
  }
  return plan;
}

function rectMassing(ctx, research) {
  const S = pubStoreys(ctx, research ? STY_LAB : STY_OFFICE);
  return [zMass(ctx, S, { bayW: 3.0, glazedGround: true, bands: ctx.style.bandShape !== 'none' })];
}

// =============================================================================================
// podium tower
// =============================================================================================
function towerLayout(ctx) {
  const s = ctx.spec, m = s._meta;
  const w = s._w, d = s._d;
  const pf = clamp(m.podium.floors | 0 || 3, 1, 8);
  const pfh = clamp(+m.podium.floorHeight || 5, 4.2, 6);
  const fh = clamp(s._fh || 3.8, 3.4, 4.4);
  const ffl = Math.max(0.3, Math.max(s._ground.fl, s._ground.fr) + 0.15);
  const podTop = ffl + pf * pfh;
  const nT = Math.max(4, s._floors - pf);
  const T = m.tower;
  const tw = clamp(+T.w || w * 0.5, 12, w - 4), td = clamp(+T.d || d * 0.5, 12, d - 4);
  const tx = clamp(+T.x || 0, -w / 2 + tw / 2 + 1, w / 2 - tw / 2 - 1), tz = clamp(+T.z || 0, -d / 2 + td / 2 + 1, d / 2 - td / 2 - 1);
  const round = T.shape === 'round';
  const r = ctx.sub(970);
  const levels = [];
  for (let i = 0; i < pf; i++) levels.push({ level: i, y: ffl + i * pfh, h: pfh });
  const tLevels = [];
  for (let j = 0; j < nT; j++) tLevels.push({ level: pf + j, y: podTop + j * fh, h: fh });
  const top = podTop + nT * fh;
  const tall = nT >= 45;
  const L = {
    w, d, pf, pfh, fh, ffl, podTop, nT, tw, td, tx, tz, round, levels, tLevels, top, tall,
    p: round ? 2 : r.float(4.5, 9), taper: tall ? r.float(0.06, 0.16) : 0, twist: !round && tall && r.next() < 0.35 ? r.float(-0.35, 0.35) : 0,
    fins: !round && r.next() < 0.8, rings: round, crown: tall ? (r.next() < 0.5 ? 'lantern' : 'fins') : 'plant',
    // refuge storeys = open sky gardens (every 18 tower floors; far LOD: mass flag 1 → green band)
    plant: (lv) => lv > pf + 8 && lv < pf + nT - 3 && ((lv - pf) % 18) === 17,
    banded: !round && r.next() < 0.5,
  };
  L.planAt = (y) => {
    const t = clamp((y - podTop) / Math.max(1, top - podTop), 0, 1);
    const sc = 1 - L.taper * smooth(t);
    return superEllipse(tx, tz, (tw / 2) * sc, (td / 2) * sc, L.p, round ? 72 : 64, L.twist * t);
  };
  return L;
}

function podiumTower(ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const L = towerLayout(ctx);
  const { w, d, ffl, podTop, top, pf } = L;
  const full = ctx.full;
  const white = inst.bandTint;
  // ---------------- podium (rect plan, curtain wall, shops) ----------------
  const plan = { w, d, ffl, wallT: 0.3, slabT: 0.3, floors: L.levels.map((lv) => ({ ...lv, rooms: [], openings: [], inset: {} })), roof: { y: podTop, parapet: 1.1, wallParapet: 1.1, kind: 'flat' }, shared: s._shared, entrances: [], extraOpenings: [], shafts: [], bayW: 3.0 };
  const main = s._entrances.find((e) => e.kind === 'main' && e.side === 'front');
  const mainU = clamp(w / 2 + (main ? main.offset : 0), 6, w - 6);
  addDoor(plan, { side: 'front', u: mainU, w: 3.2, h: 3.0, kind: 'main' });
  // shop doors along the front + flanks
  for (const k of [0.18, 0.82]) { const u = w * k; if (Math.abs(u - mainU) > 6) addDoor(plan, { side: 'front', u, w: 1.8, h: 2.7, kind: 'shop', doorKind: 'glazed' }); }
  if (!s._shared.back) addDoor(plan, { side: 'back', u: w * 0.62, w: 1.4, h: 2.3, kind: 'service', doorKind: 'service' });
  const flank = !s._shared.left ? 'left' : !s._shared.right ? 'right' : null;
  if (flank) addDoor(plan, { side: flank, u: d * 0.6, w: 1.8, h: 2.7, kind: 'shop', doorKind: 'glazed' });
  curtainFacades(ctx, plan, { bayW: 3.0, spandrel: 1.1, depth: 9, spandrelKey: 'ceramic_band', spandrelTint: white, mullD: 0.2, kindFn: (lv) => (lv === 0 ? 'shop' : 'office'), glassKey: full ? 'glass_clear' : 'glass_curtain' });
  // white bands per podium storey + deep canopy band over the ground floor
  if (st.bandShape !== 'none') emitBands(ctx, plan, (lv) => (lv === 1 ? 1.6 : lv === plan.floors.length ? 0.7 : 0.45), { railFn: () => null, up: 0.12, lights: false, cornerR: 2.0 });
  // podium roof terrace: parapet, deck, garden around the tower base
  const T = 0.3;
  K.parapets(b, { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 }, podTop, 1.1, T, { sides: { front: s._shared.front ? 'firewall' : 'parapet', right: s._shared.right ? 'firewall' : 'parapet', back: s._shared.back ? 'firewall' : 'parapet', left: s._shared.left ? 'firewall' : 'parapet' }, innerKey: 'render_white', copingKey: 'aluminium', outerKey: st.wall });
  const inner = { x0: -w / 2 + T, x1: w / 2 - T, z0: -d / 2 + T, z1: d / 2 - T };
  const yr = K.roofDeck(b, inner, podTop, { key: 'roof_tiles', mode: 'ridge' });
  const keep = [{ x0: L.tx - L.tw / 2 - 2.5, x1: L.tx + L.tw / 2 + 2.5, z0: L.tz - L.td / 2 - 2.5, z1: L.tz + L.td / 2 + 2.5 }];
  K.roofGarden(b, { x0: inner.x0 + 0.4, x1: inner.x1 - 0.4, z0: inner.z0 + 0.4, z1: inner.z1 - 0.4 }, yr ?? podTop, s.hash, { keepOut: keep, deckKey: 'wood_deck' });
  if (b.collecting) b.colQuad(inner.x0, podTop, inner.z1, inner.x1, podTop, inner.z1, inner.x1, podTop, inner.z0, inner.x0, podTop, inner.z0);
  emitBase(ctx, plan, { canopy: 'curved', bikes: true });
  // ---------------- tower ----------------
  // D4: blue-grey coated curtain wall; 'banded' towers carry white ceramic spandrels + slab-edge bands (silver-
  // white), the others silver aluminium spandrels (blue-grey glass towers with white fins / rings)
  const curtain = loftCurtain(ctx, {
    levels: L.tLevels, planAt: L.planAt, bayW: 3.0, spandrel: L.banded ? 1.1 : L.round ? 0.75 : 0.9, glassKey: 'glass_curtain', frameKey: 'aluminium',
    spandrelKey: L.banded || L.round ? 'ceramic_band' : 'aluminium', spandrelTint: L.banded || L.round ? white : null, mullD: 0.2, kind: 'office', depth: Math.min(10, Math.min(L.tw, L.td) * 0.35),
    back: (lv) => full && lv <= pf + 2, open: L.plant,
  });
  // base ring (where the tower meets the podium roof) + plant bands + round storey rings
  ringBand(ctx, curtain[0].ring, podTop + 0.05, { proj: 0.5, h0: 0.25, h1: 0.12, tint: white, key: 'ceramic_band' });
  let skyIdx = 0;
  for (const c of curtain) {
    if (L.plant(c.level)) c.inner = skyGarden(ctx, L.planAt, c, skyIdx++, { white, uOffset: 700 });
    else if (L.plant(c.level - 1)) continue;
    else if ((L.rings || L.banded) && c.level > pf) ringBand(ctx, c.ring, c.y + 0.02, { proj: L.banded ? 0.5 : 0.42, h0: L.banded ? 0.42 : 0.24, h1: 0.06, tint: white });
  }
  // white sail fins on rect towers: two S-curves on the front and back faces
  if (L.fins) {
    const step = Math.max(1, Math.round(curtain.length / 30));
    const ys = []; for (let i = 0; i <= curtain.length; i += step) ys.push(i >= curtain.length ? top : curtain[i].y);
    if (ys[ys.length - 1] < top - 0.01) ys.push(top);
    for (const [f0, amp] of [[0.06, 0.05], [0.56, -0.05]]) {
      const pts = [], nn = [];
      for (const y of ys) {
        const t = (y - podTop) / (top - podTop);
        const sp = surfacePoint(L.planAt, f0 + amp * Math.sin(t * Math.PI), y, 0.25);
        pts.push(sp.p); nn.push(sp.n);
      }
      const pT = pts[pts.length - 1], nT = nn[nn.length - 1];
      pts.push([pT[0] - nT[0] * 0.6, top + 5.5, pT[2] - nT[1] * 0.6]); nn.push(nT);
      surfaceFin(ctx, pts, (t, i) => nn[Math.min(i, nn.length - 1)], { depth: (t) => 0.8 + 0.9 * Math.sin(t * Math.PI), thick: 0.6, seg: 10, key: 'ceramic_band', tint: white });
    }
  }
  // crown
  const topRing = curtain[curtain.length - 1].top;
  const rr = ringRoof(ctx, topRing, top, { parapet: 1.3, key: 'ceramic_band', surface: 'roof_membrane' });
  ringBand(ctx, topRing, top + 1.3, { proj: 0.55, h0: 0.25, h1: 0.12, tint: white });
  crown(ctx, L, rr);
  // ---------------- interior ----------------
  const cw = Math.min(L.tw, L.td) * 0.34;
  const core = { x0: L.tx - cw * 0.6, x1: L.tx + cw * 0.6, z0: L.tz - cw * 0.45, z1: L.tz + cw * 0.45 };
  if (full) {
    // podium floors: slabs with the core hole, shop counters / gondolas on the ground floor, offices above
    for (const f of plan.floors) {
      const rect = [[-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [w / 2 - 0.3, d / 2 - 0.3], [-w / 2 + 0.3, d / 2 - 0.3]];
      const hole = [[core.x0, core.z0], [core.x0, core.z1], [core.x1, core.z1], [core.x1, core.z0]];
      b.polyY(f.level === 0 ? 'stone_floor' : 'wood_floor', rect, [hole], f.y, 1);
      if (f.level > 0) b.withTint([0.96, 0.96, 0.95], () => b.polyY('plaster', rect, [hole], f.y - 0.3, -1));
      if (b.collecting) b.colPolyY(rect, [hole], f.y);
    }
    b.withTint([0.96, 0.96, 0.95], () => b.polyY('plaster', [[-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [w / 2 - 0.3, d / 2 - 0.3], [-w / 2 + 0.3, d / 2 - 0.3]], [], podTop - 0.3, -1));
    if (b.collecting) {
      // podium wall colliders with door gaps (front / sides / back)
      for (const side of ['front', 'right', 'back', 'left']) {
        const Ls = side === 'front' || side === 'back' ? w : d;
        const gaps = plan.extraOpenings.filter((op) => op.side === side && op.kind === 'door').map((op) => [op.u0, op.u1]).sort((p, q) => p[0] - q[0]);
        b.push(); K.facadeFrame(b, side, w, d, 0);
        let u = 0;
        for (const g of gaps) { if (g[0] > u) b.colBox(u, ffl, -0.3, g[0], podTop, 0); u = Math.max(u, g[1]); }
        if (Ls > u) b.colBox(u, ffl, -0.3, Ls, podTop, 0);
        b.colBox(0, ffl + L.pfh, -0.3, Ls, podTop, 0);
        b.pop();
      }
    }
    // shops: counters + gondolas between the core and the front glazing
    const sx0 = -w / 2 + 2, sx1 = w / 2 - 2;
    for (let x = sx0 + 2; x < sx1 - 2; x += 4.5) {
      if (x > core.x0 - 3 && x < core.x1 + 3) continue;
      b.push(); b.translate(x, ffl, d / 2 - 6); b.rotY(Math.PI / 2);
      b.cbox('cabinet', -1.2, 0, -0.35, 1.2, 1.4, 0.35, 0.02, false);
      b.box('light_cyan', -1.1, 1.4, 0.34, 1.1, 1.43, 0.36, 63);
      if (b.collecting) b.colBox(-1.2, 0, -0.35, 1.2, 1.4, 0.35);
      b.pop();
    }
    b.push(); b.translate(core.x1 + 3, ffl, core.z1 + 3); b.rotY(-Math.PI / 2); reception(b, 3.2); b.pop();
    for (const f of plan.floors) if (f.level > 0) for (let x = -w / 2 + 2.5; x < w / 2 - 2.5; x += 3.2) for (let z = -d / 2 + 2.5; z < d / 2 - 3; z += 2.8) {
      if (x > core.x0 - 2.5 && x < core.x1 + 2.5 && z > core.z0 - 2.5 && z < core.z1 + 2.5) continue;
      b.push(); b.translate(x, f.y, z); officeDesk(b, (s.hash + Math.round(x * 3 + z * 7)) >>> 0); b.pop();
    }
    // tower slabs + core + wall colliders, desks on the first two tower floors
    for (const c of curtain) ringSlab(ctx, c.ring, c.y, { holes: [core], key: c.level <= pf + 2 ? 'wood_floor' : 'concrete_smooth', inset: 0.1, collide: true });
    serviceCore(ctx, { ...core, y0: ffl, y1: top + 1.2, levels: L.levels.concat(L.tLevels), full: true, lifts: 2, key: 'render_white' });
    if (b.collecting) for (const c of curtain) {
      const hh = c.open ? 1.3 : c.h;
      for (let k = 0; k < c.n; k++) { const a = c.ring[k], q = c.ring[(k + 1) % c.n]; b.colQuad(a[0], c.y, a[1], q[0], c.y, q[1], q[0], c.y + hh, q[1], a[0], c.y + hh, a[1]); }
      if (c.inner) { const R = c.inner.ring, n = R.length; for (let k = 0; k < n; k++) { const a = R[k], q = R[(k + 1) % n]; if (skyDoor(a, q)) continue; b.colQuad(a[0], c.y, a[1], q[0], c.y, q[1], q[0], c.y + c.h, q[1], a[0], c.y + c.h, a[1]); } }
    }
    for (const c of curtain) if (c.level <= pf + 2) {
      const RR = offsetRing(c.ring, -1.6);
      for (let x = L.tx - L.tw / 2 + 2; x < L.tx + L.tw / 2 - 2; x += 3.1) for (let z = L.tz - L.td / 2 + 2; z < L.tz + L.td / 2 - 2; z += 2.7) {
        if (!K.pointInPoly(x, z, RR) || (x > core.x0 - 2 && x < core.x1 + 2 && z > core.z0 - 2 && z < core.z1 + 2)) continue;
        b.push(); b.translate(x, c.y, z); officeDesk(b, (s.hash + Math.round(x * 5 + z * 3)) >>> 0); b.pop();
      }
    }
  } else {
    b.box('render_white', core.x0, ffl, core.z0, core.x1, podTop, core.z1, 1 | 2 | 16 | 32);
  }
  // forecourt furniture
  const g0 = Math.min(...K.sideGround(s, 'front'));
  if (!s._shared.front) {
    signTotem(b, clamp(mainU - w / 2 - 6, -w / 2 + 1, w / 2 - 1), g0, d / 2 + 4.5, 0, { w: 1.0, h: 3.0 });
    bollardLine(b, -w / 2 + 1, d / 2 + 6.5, w / 2 - 1, d / 2 + 6.5, g0, 2.4);
  }
  // anchors
  const A = b.anchors;
  A.floors = L.levels.concat(L.tLevels).map((lv) => ({ level: lv.level, y: lv.y, height: lv.h }));
  A.roof = { y: top, access: [L.tx, top, L.tz] };
  for (const e of plan.entrances) {
    const u = (e.u0 + e.u1) / 2;
    A.entrances.push({ kind: e.kind, side: e.side, pos: K.facadePoint(e.side, w, d, u, ffl, 0.6), dir: K.facadeNormal(e.side), width: e.u1 - e.u0 });
  }
  A.rooms = [{ floor: 0, name: 'lobby', kind: 'lobby', center: [mainU - w / 2, ffl, d / 2 - 4], size: [8, L.pfh, 8] }];
  const H = top - ffl;
  A.cameras = {
    street: { pos: [-w * 0.7, g0 + 1.65, d / 2 + 26], target: [0, ffl + Math.min(40, H * 0.25), 0] },
    entrance: { pos: [mainU - w / 2 + 3, g0 + 1.65, d / 2 + 9], target: [mainU - w / 2, ffl + 2.4, d / 2 - 2] },
    lobby: { pos: [mainU - w / 2 + 2, ffl + 1.65, d / 2 - 1.5], target: [L.tx, ffl + 2.2, core.z1] },
    interior: { pos: [mainU - w / 2 + 2, ffl + 1.65, d / 2 - 1.5], target: [L.tx, ffl + 2.2, core.z1] },
    back: { pos: [w * 0.4, g0 + 1.65, -d / 2 - 22], target: [0, ffl + 10, 0] },
    roof: { pos: [L.tx - L.tw * 1.2, top + L.tw * 0.9, L.tz + L.td * 1.4], target: [L.tx, top, L.tz] },
  };
  b.meta.tower = { height: top, podium: podTop, round: L.round };
}

function crown(ctx, L, rr) {
  const b = ctx.b, s = ctx.spec, white = ctx.inst.bandTint;
  const top = L.top;
  if (L.crown === 'lantern') {
    // set-back glazed lantern (frosted, glows) with a white lid and mast
    const lan = offsetRing(rr, -Math.min(L.tw, L.td) * 0.12);
    const h = 6 + L.nT * 0.05;
    for (let k = 0; k < lan.length; k++) {
      const a = lan[k], q = lan[(k + 1) % lan.length];
      K.clearGlassRoom(b);
      b.quad('glass_frosted', a[0], top, a[1], q[0], top, q[1], q[0], top + h, q[1], a[0], top + h, a[1]);
      if (k % 2 === 0) b.box('aluminium', a[0] - 0.06, top, a[1] - 0.06, a[0] + 0.06, top + h, a[1] + 0.06, 63 & ~8);
    }
    b.withTint(white, () => { b.polyY('ceramic_band', lan, [], top + h, 1); b.polyY('render_white', lan, [], top + h - 0.02, -1); });
    b.withTint(white, () => b.lathe('ceramic_band', [[0.9, top + h], [0.5, top + h + 12], [0, top + h + 14]], 12, { x: L.tx, z: L.tz }));
    b.cylinder('light_red', L.tx, top + h + 12.5, L.tz, 0.2, 0.35, 8, { top: true });
  } else if (L.crown === 'fins') {
    // ring of white blades rising from the parapet (crown fins)
    const R = resampleClosed(rr, 24).pts;
    for (let k = 0; k < R.length; k += 2) {
      const p = R[k];
      const nx = p[0] - L.tx, nz = p[1] - L.tz, nl = Math.hypot(nx, nz) || 1;
      const hh = 7 + 3 * Math.sin((k / R.length) * Math.PI * 2 + s.hash % 7);
      surfaceFin(ctx, [[p[0], top, p[1]], [p[0] - (nx / nl) * 0.5, top + hh, p[1] - (nz / nl) * 0.5]], [nx / nl, nz / nl], { depth: 0.5, thick: 0.9, seg: 8, key: 'ceramic_band', tint: white });
    }
    K.hvacUnit(b, L.tx, top + 0.1, L.tz, 0, { w: 3, d: 1.6, h: 1.6 });
  } else {
    // plant screen (louvred box) + small roof garden
    const scr = offsetRing(rr, -2.2);
    const R = resampleClosed(scr, 32).pts;
    for (let k = 0; k < R.length; k++) {
      const a = R[k], q = R[(k + 1) % R.length];
      // white louvred plant screen (crown band of the silver-white skyline): dark grille behind two white blades
      b.quad('grille_dark', a[0], top, a[1], q[0], top, q[1], q[0], top + 3.2, q[1], a[0], top + 3.2, a[1]);
      { const ex = q[0] - a[0], ez = q[1] - a[1], el = Math.hypot(ex, ez) || 1, ox = (-ez / el) * 0.07, oz = (ex / el) * 0.07;
        b.withTint(white, () => { for (const yb of [top + 0.9, top + 2.1]) b.quad('ceramic_band', a[0] + ox, yb, a[1] + oz, q[0] + ox, yb, q[1] + oz, q[0] + ox, yb + 0.75, q[1] + oz, a[0] + ox, yb + 0.75, a[1] + oz); }); }
      b.box('aluminium', a[0] - 0.05, top, a[1] - 0.05, a[0] + 0.05, top + 3.3, a[1] + 0.05, 63 & ~8);
    }
    b.withTint(white, () => b.polyY('ceramic_band', R, [], top + 3.25, 1));
  }
}

function towerMassing(ctx) {
  const s = ctx.spec, b = ctx.b;
  const L = towerLayout(ctx);
  const S = { fh: L.pfh, gh: L.pfh, ffl: L.ffl, roofY: L.podTop };
  const vols = [zMass(ctx, S, { bayW: 3.0, glazedGround: true, shops: true, bands: true, garden: true, roofColor: [0.38, 0.47, 0.32] })];
  loftMass(ctx, { levels: L.tLevels, planAt: L.planAt, bayW: 3.0, groundH: L.podTop - (L.pf - 1) * L.fh, floorH: L.fh, eaveY: L.top, flags: 0, louvre: L.plant, chord: 5 });
  const topR = resampleClosed(L.planAt(L.top), 24).pts;
  b.pushTint([0.88, 0.88, 0.86]);
  b.polyY('mass_roof', topR, [], L.top + 1.3, 1);
  for (let k = 0; k < topR.length; k++) { const a = topR[k], q = topR[(k + 1) % topR.length]; b.quad('mass_roof', a[0], L.top, a[1], q[0], L.top, q[1], q[0], L.top + 1.3, q[1], a[0], L.top + 1.3, a[1]); }
  if (L.crown === 'lantern') b.lathe('mass_roof', [[0.9, L.top + 1.3], [0, L.top + 22]], 6, { x: L.tx, z: L.tz });
  b.popTint();
  return vols;
}

// =============================================================================================
export default {
  name: 'office',
  uses: ['office'],
  generate(spec, lod, ctx) {
    if (isPodiumTower(ctx.spec)) podiumTower(ctx); else rectOffice(ctx, {});
  },
  massing(spec, ctx) {
    return isPodiumTower(ctx.spec) ? towerMassing(ctx) : rectMassing(ctx, false);
  },
};

export { rectMassing, isPodiumTower };
