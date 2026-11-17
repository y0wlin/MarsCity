// Residential family — the most common building on the planet (§1 生成可使用的普通建筑, §3, §6).
// Plan-first (residential_plan.js): arrival / service / daylight sides → cores → through-units →
// rooms → windows. Then the style language of the province/year on top:
//   zr_ceramic  R2/Z03: warm-white ceramic shell, continuous curved bullnose balcony bands that
//               wrap the corners (deep on the living side, AC ledges on the service side), glass
//               railings, planters, sweeping ribbon fins, roof garden behind a glass rail
//   zr_terrace  Z04/ZR2: stepped terraces on the living side, every step a planted terrace
//   zr_island   ZR4: low-rise, deep shaded balconies, louvres/shutters, pergola roofs
//   zr_cold     ZR6: compact, thick walls, deep reveals, flat slab edges, covered vestibules
//   zr_highland ZR3: ceramic with stone plinths and sheltered entries
// Instance variation (spec.hash): ceramic temperature, balcony rhythm / undulation, planters,
// window family, frame colour, railing type, fins, roof treatment.

import { residentialPlan, residentialFloors, housePlan, isHouse } from './residential_plan.js';
import { emitFacades, emitBands, emitRoof, emitBase, emitAnchors, rectOf } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { ribbonFin, acScreen, sunshade } from '../kit/facade.js';
import { facadeFrame } from '../kit/walls.js';
import { planterBox } from '../kit/vegetation.js';
import { pergola } from '../kit/structure.js';
import { SIDES, roomFacades } from '../kit/plan.js';
import { clamp, smooth01 } from '../kit/math.js';
import { STYLE_ID, roofFarColor } from '../kit/styles.js';

/** Projection function per level/side for the residential band language. */
export function residentialBands(ctx, plan) {
  const st = ctx.style, inst = ctx.inst, s = ctx.spec;
  const rB = ctx.sub(601);
  const deep = st.balconyDepth[0] + (st.balconyDepth[1] - st.balconyDepth[0]) * rB.next();
  const ledge = st.ledgeDepth[0] + (st.ledgeDepth[1] - st.ledgeDepth[0]) * rB.next();
  const wave = inst.bandWave;
  const levels = plan.floors.length;
  return (L, side, rect) => {
    const top = L === levels;
    if (plan.shared[side]) return 0;
    if (plan.house) {
      // houses: slim slab lines, a garden-side balcony over the kitchen bay on the first floor,
      // bullnose roof edge on flat ZR roofs
      if (top) return plan.roof.kind === 'pitched' ? 0 : st.bandShape === 'curved' ? 0.42 : st.bandShape === 'flat' ? 0.22 : 0;
      if (!st.bands) return 0;
      if (L === 1 && side === plan.serviceSide && side === 'back' && st.balconyDepth[1] > 0.8) return Math.min(1.35, st.balconyDepth[0]);
      return st.bandShape === 'flat' ? 0.16 : 0.2;
    }
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    const sideLen = side === 'front' || side === 'back' ? w : d;
    if (top) return st.bandShape === 'curved' ? 0.55 : st.bandShape === 'flat' ? 0.3 : 0;
    if (side === plan.liveSide) {
      if (st.balconyDepth[1] < 0.3) return st.bands ? 0.18 : 0;
      // living rooms of the floor above the band get the deepest bulges
      const f = plan.floors[L];
      const live = f.rooms.filter((r) => r.kind === 'living').flatMap((r) => roomFacades(r, rect, plan.w, plan.d).filter((x) => x.side === side).map((x) => ((x.u0 + x.u1) / 2 - (side === 'front' ? rect.x0 + plan.w / 2 : plan.w / 2 - rect.x1)) / sideLen));
      if (st.bandShape === 'flat') {
        // cold style: flat slab edge with rectangular balconies (crisp steps, `breaks`) in front of
        // living rooms, kept ≥ 0.9 m clear of the corners
        const hw = Math.min(1.4, sideLen * 0.2), tw = 0.06;
        const cs = live.map((c) => clamp(c, (hw + 0.9) / sideLen, 1 - (hw + 0.9) / sideLen));
        const fnFlat = (t) => { let m = 0.22; for (const c of cs) { const k = 1 - smooth01((Math.abs(t - c) * sideLen - hw) / tw); m = Math.max(m, 0.22 + (deep - 0.22) * k); } return m; };
        fnFlat.breaks = cs.flatMap((c) => [c - (hw + tw) / sideLen, c - hw / sideLen, c + hw / sideLen, c + (hw + tw) / sideLen]);
        return fnFlat;
      }
      const rhythm = inst.balconyRhythm;
      if (!wave && !live.length) return deep;
      return (t) => {
        let m = deep * (0.78 + 0.08 * Math.sin((t * sideLen) / 3.7 * Math.PI * 0.5 + rhythm));
        for (const c of live) { const q = ((t - c) * sideLen) / 2.4; const k = Math.exp(-(q * q)); m += (wave || 0.35) * k; }
        return clamp(m, 0.5, deep + (wave || 0.35));
      };
    }
    if (side === plan.serviceSide) {
      if (!st.bands) return 0;
      // gap at the vertical stair strip
      const gaps = (plan.groups || []).map((g) => g.stripU).filter(Boolean).map(([a, c]) => {
        const off = side === 'back' ? plan.w / 2 - rect.x1 : rect.x0 + plan.w / 2;
        return [(a - off) / sideLen, (c - off) / sideLen];
      });
      if (!gaps.length) return st.bandShape === 'flat' ? 0.22 : ledge;
      return (t) => (gaps.some(([a, c]) => t > a - 0.01 && t < c + 0.01) ? -0.2 : (st.bandShape === 'flat' ? 0.22 : ledge));
    }
    // short sides: wrap of the living-side band tapering to a ledge
    if (!st.bands) return 0;
    return st.bandShape === 'flat' ? 0.22 : (t) => {
      // t runs left→right seen from outside on this side; the living side is at one end
      const liveAtStart = (side === 'right' && plan.liveSide === 'front') || (side === 'left' && plan.liveSide === 'back');
      const x = liveAtStart ? t : 1 - t;
      return ledge + (deep * 0.85 - ledge) * (1 - smooth01((x * sideLen - 3.4) / 3.0));
    };
  };
}

/** Style decoration passes shared by the residential family. */
export function decorateResidential(ctx, plan, opts = {}) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const levels = plan.floors.length;
  // ---- bands / balconies ----
  if (st.bands || st.balconyDepth[1] > 0) {
    emitBands(ctx, plan, residentialBands(ctx, plan), {
      up: st.bandShape === 'flat' ? 0.15 : 0.3,
      cornerR: st.bandCornerR[0] + (st.bandCornerR[1] - st.bandCornerR[0]) * ctx.sub(602).next(),
      railFn: (L, depth) => (L === levels ? (plan.roof.kind === 'garden' || plan.roof.wallParapet < 0.5 ? inst.railing : null) : depth > 0.85 ? inst.railing : null),
    });
  }
  // ---- AC units behind louvre screens on service ledges (back-of-house) ----
  if (st.bands && st.ledgeDepth[1] >= 0.5) {
    const rng = ctx.sub(603);
    for (let L = 1; L < levels; L++) {
      const f = plan.floors[L];
      const side = plan.serviceSide;
      if (plan.shared[side]) continue;
      const rect = rectOf(plan, plan.floors[L - 1]);
      for (const r of f.rooms) {
        if (r.kind !== 'bedroom' && r.kind !== 'living' && r.kind !== 'kitchen') continue;
        const fc = roomFacades(r, rectOf(plan, f), plan.w, plan.d).find((x) => x.side === side);
        if (!fc || rng.next() > 0.6) continue;
        const u = fc.u0 + 0.75;
        b.push(); facadeFrame(b, side, plan.w, plan.d, side === 'back' ? (plan.floors[L - 1].inset?.back || 0) : 0);
        acScreen(b, u, f.y - 0.03, Math.min(0.5, st.ledgeDepth[0] - 0.1), { key: 'aluminium' });
        b.pop();
        void rect;
      }
    }
  }
  // ---- sweeping ribbon fins (ZR signature) ----
  if (inst.fins && st.bandShape === 'curved' && levels >= 4 && !opts.noFins) {
    const rng = ctx.sub(604);
    const side = plan.liveSide;
    const sgn = side === 'front' ? 1 : -1;
    const w = plan.w, d = plan.d;
    const zf = sgn * (d / 2 + st.balconyDepth[0] + 0.25);
    const corner = rng.next() < 0.5 ? -1 : 1;
    if (!plan.shared[corner < 0 ? (side === 'front' ? 'left' : 'right') : (side === 'front' ? 'right' : 'left')]) {
      const x0 = corner * (w / 2 - 0.6), x1 = corner * (w / 2 - Math.min(w * 0.3, 7));
      const yTop = plan.roof.y + 0.6;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const lean = Math.sin(t * Math.PI * 0.85) * 0.9;
        pts.push([x0 + (x1 - x0) * smooth01(t * 1.05), plan.ffl + (yTop - plan.ffl) * t, zf + sgn * lean]);
      }
      b.withTint(inst.bandTint, () => ribbonFin(b, pts, { width: 0.6, thickness: 0.34 }));
      if (rng.next() < 0.5) {
        const pts2 = pts.map(([x, y, z], i) => [x + corner * -1.2 * Math.sin((i / 6) * Math.PI), y * 0.82 + plan.ffl * 0.18, z + sgn * 0.05]);
        b.withTint(inst.bandTint, () => ribbonFin(b, pts2, { width: 0.45, thickness: 0.28 }));
      }
    }
  }
  // ---- island style: sunshades over service windows, pergola on the roof ----
  if (st.id === 'zr_island' && plan.floors.length > 0) {
    for (const o of plan.allOpenings || []) {
      if (o.side !== plan.serviceSide || (o.kind !== 'casement')) continue;
      b.push(); facadeFrame(b, o.side, plan.w, plan.d, 0); sunshade(b, o.u0 - 0.15, o.u1 + 0.15, o.v1 + 0.25, { n: 3, depth: 0.6 }); b.pop();
    }
  }
  // ---- terrace planters on setbacks ----
  for (let L = 1; L < levels; L++) {
    const f = plan.floors[L], fb = plan.floors[L - 1];
    for (const side of ['front', 'back']) {
      const ins = (f.inset?.[side] || 0) - (fb.inset?.[side] || 0);
      if (ins < 1.2) continue;
      const lower = rectOf(plan, fb);
      const sg = side === 'front' ? 1 : -1;
      const zOuter = side === 'front' ? lower.z1 : lower.z0;
      const n = Math.max(1, Math.round((lower.x1 - lower.x0) / 6));
      for (let i = 0; i < n; i++) {
        if ((i + L) % 2) continue;
        const a = lower.x0 + 0.6 + ((lower.x1 - lower.x0 - 1.2) * i) / n, c = a + Math.min(3.2, (lower.x1 - lower.x0) / n - 0.8);
        const z0 = zOuter - sg * (plan.wallT + 0.15), z1 = z0 - sg * 0.8;
        planterBox(b, a, Math.min(z0, z1), c, Math.max(z0, z1), f.y - 0.03, 0.5, (s.hash + L * 31 + i) >>> 0, { tree: i % 4 === 0, treeH: 2.4, density: 1.5, key: 'ceramic_band' });
      }
    }
  }
}

/** Ground-floor terraces / front gardens in front of ground-floor living rooms. */
function groundGardens(ctx, plan) {
  const b = ctx.b, s = ctx.spec;
  const f0 = plan.floors[0];
  const side = plan.liveSide;
  if (plan.shared[side]) return;
  for (const r of f0.rooms) {
    if (r.kind !== 'living' && r.kind !== 'bedroom') continue;
    const fc = roomFacades(r, rectOf(plan, f0), plan.w, plan.d).find((x) => x.side === side);
    if (!fc) continue;
    b.push(); facadeFrame(b, side, plan.w, plan.d, 0);
    const a = fc.u0 + 0.3, c = fc.u1 - 0.3;
    if (c - a > 1.5) {
      // low hedge planter 1.6 m out, leaving a terrace strip
      planterBox(b, a, 1.5, c, 2.1, Math.min(plan.ffl - 0.45, 0), 0.75 + Math.max(0, plan.ffl - 0.45), (s.hash + Math.round(a * 10)) >>> 0, { density: 2.2, size: 0.6, key: 'ceramic_grey' });
    }
    b.pop();
  }
}

export function residentialMassing(spec, ctx, o = {}) {
  const plan = residentialFloors(ctx, o);
  const st = ctx.style;
  const vols = [];
  const flags = (st.bands ? 4 : 0) | (st.id === 'zr_ceramic' ? 8 : 0);
  const R = plan.roof.spec;
  const roofColor = R ? roofFarColor({ ...R, kind: plan.roof.kind }) : null;
  let i0 = 0;
  for (let i = 1; i <= plan.floors.length; i++) {
    const a = plan.floors[i0], f = plan.floors[i];
    const same = f && JSON.stringify(f.inset) === JSON.stringify(a.inset);
    if (same) continue;
    const r = rectOf(plan, a);
    const last = plan.floors[i - 1];
    const top = i === plan.floors.length;
    const v = { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: i0 === 0 ? Math.min(0, ctx.spec._ground.min) - 0.5 : a.y, y1: last.y + last.h, parapet: top ? (plan.roof.kind === 'pitched' ? 0 : 1.05) : 0.3, floorH: plan.floors[Math.min(1, plan.floors.length - 1)].h, groundH: plan.floors[0].h + plan.ffl, bayW: plan.bayW, blank: plan.shared, garden: plan.roof.kind === 'garden', roofColor, flags, bands: !!st.bands && st.bandShape !== 'none' && !plan.house, uBase: 0, soffit: i0 > 0 };
    if (top && plan.roof.kind === 'pitched') {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const axis = plan.roof.ridgeAxis || (w >= d ? 'x' : 'z');
      v.pitched = { axis, rise: Math.tan(st.id === 'zr_cold' ? 0.62 : 0.5) * (axis === 'x' ? d : w) / 2, color: roofColor };
    }
    vols.push(v);
    i0 = i;
  }
  if (plan.floors.length >= 4 && vols.length && plan.roof.kind !== 'pitched') { const sz = plan.liveSide === 'front' ? -plan.d / 2 + 0.3 : plan.d / 2 - 5.9; vols[vols.length - 1].plant = { x0: -1.4, x1: 1.4, z0: sz, z1: sz + 5.6, h: 2.9 }; }
  return vols;
}

export function generateResidential(spec, lod, ctx, opts = {}) {
  const po = opts.plan || {};
  const plan = isHouse(ctx.spec, po) ? housePlan(ctx, po) : residentialPlan(ctx, po);
  emitFacades(ctx, plan);
  decorateResidential(ctx, plan, opts);
  emitRoof(ctx, plan, { garden: plan.roof.kind === 'garden', solar: plan.roof.kind !== 'garden' && (plan.roof.solar || ctx.sub(605).next() < 0.4) });
  emitBase(ctx, plan, { canopy: plan.house ? 'flat' : ctx.style.bandShape === 'curved' ? 'curved' : 'flat', ramp: !plan.house, binStore: !plan.house });
  groundGardens(ctx, plan);
  if (ctx.full) emitInterior(ctx, plan);
  emitAnchors(ctx, plan);
  ctx.b.meta.style = ctx.style.id; ctx.b.meta.styleId = STYLE_ID[ctx.style.id];
  return plan;
}

export default {
  name: 'residential',
  uses: ['residential'],
  generate(spec, lod, ctx) { generateResidential(spec, lod, ctx); },
  massing: residentialMassing,
};

export { SIDES, pergola };
