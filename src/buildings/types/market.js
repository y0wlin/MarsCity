// Market hall (市集 · 菜市场), Zhurong family (owner: buildings-z).
//
// Plan (front = +z): street colonnade (首层廊, depth A) → front band of small shops (shopfronts with
// blank sign boxes to the colonnade, counters to the hall) with the tall glazed main portal in its
// middle → the market hall (nave) with a stall grid under a white barrel vault (crown roof light,
// glazed gable fans on the left / right ends, clerestory strips above the band roofs, steel portal
// ribs) → back band (deliveries: loading bay with roller doors + dock leveller, cold rooms, office,
// bins) → service yard with bay lines. Side entrance in the left gable (spec 'main' left).
// floors 2: upper storey on the front band (food-court gallery, stair beside the portal).
// Variants: zr_cold / meta.covered → glazed warm colonnade + draught porch (ZR6 covered corridor);
// zr_island → timber posts + slatted pergola + striped awnings (ZR4); zr_terrace → planted band
// roof (ZR2); zr_highland → covered entry porch (ZR3). Instance variation from spec.hash: shop
// module, colonnade depth, clerestory height, vault rise, stall colours, door sides.

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, cyanStrip, signTotem, bollardLine, zMass, specEntrances, columnCanopy, glassScreen, benchRow, glassRoom, straightStair, lightBox, glyphText } from './z_common.js';
import { hall, rollerDoor, dockLeveller, roofProfile } from './z_hall.js';

const PAL_AWN = [[0.2, 0.55, 0.55], [0.92, 0.9, 0.86], [0.85, 0.45, 0.35], [0.35, 0.5, 0.7], [0.9, 0.72, 0.35]];
const PAL_CRATE = [[0.25, 0.42, 0.62], [0.75, 0.75, 0.72], [0.55, 0.32, 0.22], [0.3, 0.5, 0.35]];
const PAL_PROD = [[0.35, 0.6, 0.2], [0.85, 0.3, 0.12], [0.95, 0.65, 0.15], [0.55, 0.15, 0.2], [0.5, 0.7, 0.3], [0.9, 0.85, 0.5]];

/** Layout numbers shared by generate() and massing(). */
function layout(ctx) {
  const s = ctx.spec, st = ctx.style;
  const w = s._w, d = s._d;
  const rng = ctx.sub(1101);
  const nF = clamp(s._floors | 0, 1, 2);
  const frontG = Math.max(s._ground.fl, s._ground.fr);
  const ffl = Math.max(st.id === 'zr_cold' ? 0.45 : 0.3, frontG + 0.15);
  const gh = clamp(+s.groundFloorHeight || 6, 5.2, 6.5);
  const uh = nF > 1 ? clamp(+s.floorHeight || 5, 4.5, 5.5) : 0;
  const bandTop = ffl + gh + uh;
  const naveEave = bandTop + 3.0 + rng.next() * 1.2;
  const island = st.id === 'zr_island';
  const A = island ? 2.8 : clamp(3.2 + rng.next() * 0.8, 3.0, 4.0);
  const bF = clamp(d * 0.18, 5.5, 8.0);
  const bB = clamp(d * 0.16, 5.0, 7.5);
  const zN1 = d / 2 - A - bF, zN0 = -d / 2 + bB;
  const Dn = zN1 - zN0;
  const rise = clamp(Dn * (0.26 + rng.next() * 0.08), 3, 10);
  const backTop = Math.min(bandTop, ffl + 5.4);
  const ys = ffl + clamp(gh - 1.4, 4.0, 4.6);
  const T = 0.3;
  return { w, d, nF, ffl, gh, uh, bandTop, naveEave, A, bF, bB, zN0, zN1, Dn, rise, backTop, ys, T, island, cold: st.id === 'zr_cold' || !!s._meta.covered, rng };
}

/** One produce stall (local frame, front to +z): counter, crates of produce, posts + fabric canopy, blank price board. */
function stall(b, x, y, z, rot, seed, W = 2.4, D = 1.0, posts = true) {
  const h = (k) => K.h01(seed, k, 0, 0);
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.withTint([0.78 + h(1) * 0.15, 0.8, 0.82], () => b.cbox('cabinet', -W / 2, 0, -D / 2, W / 2, 0.86, D / 2, 0.015, false));
  b.cbox('counter', -W / 2 - 0.03, 0.86, -D / 2 - 0.02, W / 2 + 0.03, 0.9, D / 2 + 0.05, 0.008);
  const n = Math.max(2, Math.floor(W / 0.6));
  for (let i = 0; i < n; i++) {
    const cx = -W / 2 + (W * (i + 0.5)) / n;
    b.withTint(PAL_CRATE[Math.floor(h(10 + i) * PAL_CRATE.length)], () => b.box('plastic_bin', cx - 0.25, 0.9, -0.1, cx + 0.25, 1.06, 0.42, 63 & ~8));
    b.withTint(PAL_PROD[Math.floor(h(20 + i) * PAL_PROD.length)], () => b.box('fabric', cx - 0.22, 1.06, -0.06, cx + 0.22, 1.13, 0.38, 1 | 2 | 4 | 16 | 32));
  }
  if (posts) for (const sx of [-W / 2 + 0.05, W / 2 - 0.05]) b.box('steel_dark', sx - 0.03, 0.9, -D / 2 - 0.03, sx + 0.03, 2.55, -D / 2 + 0.03, 63);
  b.withTint(PAL_AWN[Math.floor(h(3) * PAL_AWN.length)], () => {
    b.quad('fabric_awning', -W / 2, 2.52, -D / 2, W / 2, 2.52, -D / 2, W / 2, 2.3, D / 2 + 0.35, -W / 2, 2.3, D / 2 + 0.35);
    b.quad('fabric_awning', W / 2, 2.51, -D / 2, -W / 2, 2.51, -D / 2, -W / 2, 2.29, D / 2 + 0.35, W / 2, 2.29, D / 2 + 0.35);
  });
  b.box('aluminium', -0.32, 2.02, -D / 2 + 0.03, 0.32, 2.24, -D / 2 + 0.05, 63);
  b.rectZ('signage_blank', -0.3, 2.04, 0.3, 2.22, -D / 2 + 0.055, 1);
  glyphText(b, -0.26, 2.13, -D / 2 + 0.056, 0.1, 4, seed, 'steel_dark', { dz: 0.002 });   // price board content
  if (b.collecting) b.colBox(-W / 2, 0, -D / 2, W / 2, 0.9, D / 2);
  b.pop();
}

function generate(ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const L = layout(ctx);
  const { w, d, nF, ffl, gh, uh, bandTop, naveEave, A, bF, zN0, zN1, Dn, rise, backTop, ys, T, island, cold, rng } = L;
  const full = ctx.full;
  const wk = st.wall, shell = inst.shellTint;
  // ---------------- entrances ----------------
  const mains = specEntrances(ctx, 'main');
  const mF = mains.find((e) => e.side === 'front');
  const E = clamp(mF ? mF.width : 6, 4.8, 8.0);
  const mainU = clamp(mF ? mF.u : w / 2, E / 2 + 3, w - E / 2 - 3), mainX = mainU - w / 2;
  const mL = !s._shared.left ? mains.find((e) => e.side === 'left') : null;
  const leftU = mL ? clamp(mL.u - (zN0 + d / 2), 2.5, Dn - 2.5) : null;          // nave left wall u
  const svc = specEntrances(ctx, 'service')[0];
  const svcSide = svc && !s._shared[svc.side] && (svc.side === 'back' || svc.side === 'right' || svc.side === 'left') ? svc.side : (!s._shared.back ? 'back' : 'right');
  // ---------------- shop units along the front band ----------------
  const ent0 = mainU - E / 2, ent1 = mainU + E / 2;
  const shops = [];
  const mod = 5.0 + rng.next() * 1.4;
  for (const [a, c] of [[0, ent0 - 0.4], [ent1 + 0.4, w]]) {
    const len = c - a;
    if (len < 3.4) continue;
    const n = Math.max(1, Math.round(len / mod));
    for (let i = 0; i < n; i++) shops.push({ u0: a + (len * i) / n, u1: a + (len * (i + 1)) / n, side: a < mainU ? -1 : 1 });
  }
  // floors 2: the first shop right of the portal is the stair hall to the gallery
  const stairShop = nF > 1 ? shops.find((p) => p.u0 > mainU) : null;
  // ---------------- front band (shops) ----------------
  const fz0 = zN1 - T, fz1 = d / 2 - A;
  const fOps = [];
  for (const p of shops) {
    const pu0 = p.u0 + (p.u0 < 0.1 ? 0.6 : 0.3), pu1 = p.u1 - (p.u1 > w - 0.1 ? 0.6 : 0.3);
    if (pu1 - pu0 < 1.6) continue;
    const dwid = 1.5, du = (p.side < 0 ? pu1 - 0.35 - dwid : pu0 + 0.35);
    fOps.push({ u0: pu0, u1: pu1, v0: ffl, v1: ffl + 3.1, kind: 'shop', door: { u0: du, width: dwid }, room: p === stairShop ? 'lobby' : 'shop', depth: bF - 0.4, roomW: pu1 - pu0 + 0.6, floorY: ffl });
    if (nF > 1) {
      const m = Math.max(1, Math.round((pu1 - pu0) / 2.6));
      for (let k = 0; k < m; k++) {
        const a = pu0 + ((pu1 - pu0) * k) / m + 0.25, c = pu0 + ((pu1 - pu0) * (k + 1)) / m - 0.25;
        fOps.push({ u0: a, u1: c, v0: ffl + gh + 0.75, v1: ffl + gh + uh - 0.55, kind: 'window', type: 'tall', room: 'hall', floorY: ffl + gh, floor: 1, depth: bF });
      }
    }
  }
  // main portal: glazed double door + side lights + tall transom glazing
  fOps.push({ u0: mainU - 1.25, u1: mainU + 1.25, v0: ffl, v1: ffl + 2.8, kind: 'door', doorKind: 'glazed_double' });
  for (const [a, c] of [[ent0 + 0.25, mainU - 1.45], [mainU + 1.45, ent1 - 0.25]]) if (c - a > 0.5) fOps.push({ u0: a, u1: c, v0: ffl, v1: ffl + 2.8, kind: 'curtain', pane: 1.2, room: 'lobby', depth: bF });
  fOps.push({ u0: ent0 + 0.25, u1: ent1 - 0.25, v0: ffl + 3.0, v1: bandTop - 0.65, kind: 'curtain', pane: 1.2, room: 'lobby', depth: bF, floorY: ffl });
  const bandSide = (side) => {
    if (s._shared[side]) return { openings: [] };
    const D0 = fz1 - fz0;
    return { openings: [{ u0: 0.9, u1: D0 - 0.9, v0: ffl + 0.9, v1: ffl + 3.1, kind: 'shop', room: 'shop', depth: 4, floorY: ffl }, ...(nF > 1 ? [{ u0: 1.0, u1: D0 - 1.0, v0: ffl + gh + 0.75, v1: ffl + gh + uh - 0.55, kind: 'window', type: 'tall', room: 'hall', floorY: ffl + gh, floor: 1, depth: 4 }] : [])] };
  };
  hall(ctx, {
    x0: -w / 2, x1: w / 2, z0: fz0, z1: fz1, y0: ffl, eave: bandTop - ffl, wallKey: wk, wallT: T, wallTint: shell,
    sides: { front: { openings: fOps }, back: { skip: true }, left: bandSide('left'), right: bandSide('right') },
    roof: { kind: 'flat', parapet: 0.7, surface: 'roof_membrane', parapetSides: { back: 'none' } },
    frames: 0, floorKey: 'tile_floor', lightPanels: false,
  });
  // ---------------- nave (market hall) ----------------
  const nOps = { front: [], back: [], left: [], right: [] };
  const clereN = Math.max(2, Math.round(w / 4.8));
  for (const side of ['front', 'back']) {
    for (let i = 0; i < clereN; i++) {
      const c = (w * (i + 0.5)) / clereN, bay = w / clereN;
      nOps[side].push({ u0: c - bay / 2 + 0.4, u1: c + bay / 2 - 0.4, v0: (side === 'front' ? bandTop : backTop) + 0.9, v1: naveEave - 0.35, kind: 'strip', room: 'hall', floorY: ffl, depth: Dn, bay: i });
    }
  }
  nOps.front.push({ u0: mainU - 2.4, u1: mainU + 2.4, v0: ffl, v1: ffl + 4.0, kind: 'opening' });
  if (full) for (const p of shops) if (p !== stairShop && p.u1 - p.u0 > 3) nOps.front.push({ u0: p.u0 + 0.9, u1: p.u1 - 0.9, v0: ffl + 0.95, v1: ffl + 2.6, kind: 'opening' });
  // passages to the service band (behind the loading doors)
  const backPass = [w * 0.28, w * 0.72];
  for (const u of backPass) nOps.back.push({ u0: u - 1.6, u1: u + 1.6, v0: ffl, v1: ffl + 3.4, kind: 'opening' });
  // gable ends: entrance (left) / exit (right) + tall glazing
  for (const side of ['left', 'right']) {
    if (s._shared[side]) continue;
    const du = side === 'left' && leftU !== null ? leftU : Dn / 2;
    const dw = side === 'left' && mL ? 1.4 : 0.9;
    nOps[side].push({ u0: du - dw, u1: du + dw, v0: ffl, v1: ffl + 2.7, kind: 'door', doorKind: dw > 1 ? 'glazed_double' : 'glazed' });
    const ey = naveEave - 0.45;
    for (const [a, c] of [[1.4, du - dw - 0.5], [du + dw + 0.5, Dn - 1.4]]) {
      if (c - a < 1.2) continue;
      nOps[side].push({ u0: a, u1: c, v0: ffl + 0.6, v1: ey, kind: 'curtain', pane: 1.5, rows: [ffl + 0.6, ffl + 3.2, ey], room: 'hall', depth: w * 0.5 });
    }
    nOps[side].push({ u0: du - dw - 0.1, u1: du + dw + 0.1, v0: ffl + 3.2, v1: ey, kind: 'curtain', pane: 1.4, room: 'hall', depth: w * 0.5 });
  }
  const H = hall(ctx, {
    x0: -w / 2, x1: w / 2, z0: zN0, z1: zN1, y0: ffl, eave: naveEave - ffl, wallKey: wk, wallT: T, wallTint: shell,
    sides: { front: { openings: nOps.front }, back: { openings: nOps.back }, left: { openings: nOps.left, gable: 'glass' }, right: { openings: nOps.right, gable: 'glass' } },
    roof: { kind: 'vault', rise, key: 'ceramic_band', tint: inst.bandTint, soffitKey: 'wood', overhang: 0.8, lights: 'crown', crownW: Dn * 0.16 },
    frames: 6.4, frameKey: 'aluminium', floorKey: 'stone_floor', lightPanels: true,
  });
  // ---------------- back band (deliveries) ----------------
  const bz0 = -d / 2, bz1 = zN0 + T;
  const bOps = { back: [], left: [], right: [], front: [] };
  const svcL = (side) => (side === 'back' || side === 'front' ? w : bz1 - bz0);
  let loadU = [];
  if (svcSide === 'back') {
    const u0 = clamp(svc ? svc.u : w * 0.75, 4, w - 4);
    loadU = [u0, clamp(u0 + (u0 > w / 2 ? -9 : 9), 4, w - 4)];
    for (const u of loadU) bOps.back.push({ u0: u - 1.6, u1: u + 1.6, v0: ffl, v1: ffl + 3.4, kind: 'roller' });
    const pu = clamp(w * 0.5, 2, w - 2);
    if (loadU.every((u) => Math.abs(u - pu) > 3.2)) bOps.back.push({ u0: pu - 0.5, u1: pu + 0.5, v0: ffl, v1: ffl + 2.25, kind: 'door', doorKind: 'service' });
    for (let i = 0; i < Math.round(w / 9); i++) {
      const c = (w * (i + 0.5)) / Math.round(w / 9);
      if (loadU.some((u) => Math.abs(u - c) < 2.8) || Math.abs(c - w * 0.5) < 1.6) continue;
      bOps.back.push({ u0: c - 1.0, u1: c + 1.0, v0: ffl + 2.6, v1: backTop - 0.6, kind: 'louvre' });
    }
  } else {
    const Ls = svcL(svcSide);
    loadU = [clamp(Ls / 2, 2.5, Ls - 2.5)];
    bOps[svcSide].push({ u0: loadU[0] - 1.5, u1: loadU[0] + 1.5, v0: ffl, v1: ffl + 3.4, kind: 'roller' });
  }
  for (const side of ['left', 'right']) if (side !== svcSide && !s._shared[side]) bOps[side].push({ u0: 1.0, u1: 2.0, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service' });
  hall(ctx, {
    x0: -w / 2, x1: w / 2, z0: bz0, z1: bz1, y0: ffl, eave: backTop - ffl, wallKey: wk, wallT: T, wallTint: shell,
    sides: { front: { skip: true }, back: { openings: bOps.back }, left: { openings: bOps.left }, right: { openings: bOps.right } },
    roof: { kind: 'flat', parapet: 0.7, surface: 'roof_membrane', parapetSides: { front: 'none' } },
    frames: 0, floorKey: 'concrete_smooth', lightPanels: full,
  });
  K.plinth(b, s, ffl, { skip: s._shared });
  // ---------------- colonnade / arcade (首层廊) ----------------
  const [gF0, gF1] = K.sideGround(s, 'front');
  const gF = Math.min(gF0, gF1);
  const colY = ffl - 0.02;
  b.cbox('paving_stone', -w / 2, Math.min(gF, colY) - 0.45, d / 2 - A - 0.05, w / 2, colY, d / 2, 0.012, false);
  if (b.collecting) b.colQuad(-w / 2, colY, d / 2, w / 2, colY, d / 2, w / 2, colY, d / 2 - A, -w / 2, colY, d / 2 - A);
  const cGap0 = mainX - E / 2 - 0.6, cGap1 = mainX + E / 2 + 0.6;
  const colsX = [];
  {
    const n = Math.max(2, Math.round((w - 1.2) / 6.0));
    for (let i = 0; i <= n; i++) { const x = -w / 2 + 0.55 + ((w - 1.1) * i) / n; if (x > cGap0 - 2.4 && x < cGap1 + 2.4) continue; colsX.push(x); }
    colsX.push(cGap0 - 0.3, cGap1 + 0.3);
  }
  const zc = d / 2 - 0.42;
  const cTop = ys + 0.45;
  if (island) {
    // timber posts + slatted pergola + striped awnings over the shopfronts (ZR4)
    for (const x of colsX) b.cbox('wood', x - 0.12, colY, zc - 0.12, x + 0.12, cTop, zc + 0.12, 0.015, false);
    for (const [x0, x1] of [[-w / 2 + 0.2, cGap0], [cGap1, w / 2 - 0.2]]) {
      if (x1 - x0 < 1) continue;
      b.box('wood', x0, cTop - 0.05, zc - 0.1, x1, cTop + 0.22, zc + 0.1, 63);
      b.box('wood', x0, cTop - 0.05, d / 2 - A + 0.05, x1, cTop + 0.22, d / 2 - A + 0.25, 63);
      for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.42) b.box('wood', x - 0.03, cTop + 0.22, d / 2 - A, x + 0.03, cTop + 0.3, d / 2 + 0.25, 63);
    }
    b.push(); b.translate(0, 0, d / 2 - A); K.facadeFrame(b, 'front', w, 0, 0);
    shops.forEach((p, i) => { const pu0 = p.u0 + 0.4, pu1 = p.u1 - 0.4; if (pu1 - pu0 > 1.5) b.withTint(PAL_AWN[(i + (s.hash & 3)) % PAL_AWN.length], () => K.awning(b, { u0: pu0, u1: pu1, y: ffl + 3.25, depth: 1.5, drop: 0.45 })); });
    b.pop();
  } else {
    const ck = st.band;
    for (const [x0, x1] of [[-w / 2, cGap0], [cGap1, w / 2]]) {
      if (x1 - x0 < 1) continue;
      const cols = colsX.filter((x) => x > x0 - 0.01 && x < x1 + 0.01).map((x) => [x, zc, colY]);
      b.withTint(inst.bandTint, () => columnCanopy(b, { x0, x1, z0: d / 2 - A - 0.05, z1: d / 2, y: cTop, t: 0.45, cols, key: ck, colR: 0.21, colKey: 'ceramic_white' }));
      cyanStrip(b, x0 + 0.8, d / 2 + 0.012, x1 - 0.8, d / 2 + 0.012, cTop - 0.22, { t: 0.025 });
    }
    if (cold) {
      // warm glazed colonnade: glass screen on the column line, glazed ends, draught porch at the portal
      const gk = full ? 'glass_clear' : 'glass_shop';
      b.push(); K.facadeFrame(b, 'front', w, d, 0);
      for (const [u0, u1] of [[0.25, cGap0 + w / 2 - 0.1], [cGap1 + w / 2 + 0.1, w - 0.25]]) if (u1 - u0 > 1) glassScreen(b, { u0, u1, v0: colY, v1: ys, z: -0.42, pane: 1.5, rows: [colY, colY + 0.35, colY + 2.7, ys], frameKey: 'aluminium_dark', glassKey: gk, room: glassRoom(ctx, { kind: 'corridor', w: 6, d: A, h: ys - colY, sill: 0 }), back: full });
      K.porch(b, { u0: cGap0 + w / 2 + 0.1, u1: cGap1 + w / 2 - 0.1, y0: colY, depth: 2.2, h: 3.0, glassKey: gk });
      b.pop();
      for (const sx of [-1, 1]) {
        b.push(); K.facadeFrame(b, sx < 0 ? 'left' : 'right', w, d, 0);
        const ua = sx < 0 ? d - A : 0.0, uc = sx < 0 ? d - 0.05 : A - 0.05;
        glassScreen(b, { u0: ua + 0.05, u1: uc, v0: colY, v1: ys, z: -0.05, pane: 1.4, rows: [colY, colY + 0.35, colY + 2.7, ys], frameKey: 'aluminium_dark', glassKey: gk, room: glassRoom(ctx, { kind: 'corridor', w: 6, d: A, h: ys - colY, sill: 0 }), back: full });
        b.pop();
      }
    }
  }
  // portal canopy: curved white canopy over the main entrance, higher than the colonnade
  b.push(); b.translate(0, 0, d / 2 - A); K.facadeFrame(b, 'front', w, 0, 0);
  b.withTint(inst.bandTint, () => K.canopyCurved(b, { u0: ent0 - 1.2, u1: ent1 + 1.2, y: bandTop - 0.25, depth: A + (cold ? 1.0 : 2.2), key: st.band, t: 0.42 }));
  lightBox(b, mainU, bandTop + 0.05, Math.min(E + 1.5, 9), 0.55, 0.16, { depth: 0.13, rows: 1, seed: s.hash });
  // sign boxes over the shopfronts (blank light boxes), wall lights at the piers
  for (const p of shops) {
    const pu0 = p.u0 + 0.6, pu1 = p.u1 - 0.6;
    if (pu1 - pu0 < 1.2) continue;
    lightBox(b, (pu0 + pu1) / 2, ffl + 3.28, Math.min(pu1 - pu0, 3.6), 0.5, 0.14, { depth: 0.13, rows: 1, seed: (s.hash + Math.round(pu0 * 7)) >>> 0 });
    if (!island) K.wallLight(b, p.u1, ffl + 2.6);
  }
  if (st.coveredEntry && !cold) K.porch(b, { u0: mainU - 1.7, u1: mainU + 1.7, y0: ffl, depth: 1.8, h: 2.95, glassKey: full ? 'glass_clear' : 'glass_shop' });
  b.pop();
  // street edge: steps down from the colonnade + ramp, bollards, bikes, benches, sign totem
  b.push(); K.facadeFrame(b, 'front', w, d, 0);
  const rise0 = colY - gF;
  if (rise0 > 0.05) {
    const ramp = rise0 > 0.08 && rise0 * 12 + 2 < w * 0.4;
    const rEnd = 0.4 + rise0 * 12;
    K.steps(b, { u0: ramp ? rEnd + 0.4 : 0.2, u1: w - 0.2, z0: 0.0, y0: gF, y1: colY, key: 'stone_step', cheeks: false, rails: false });
    if (ramp) K.rampAlong(b, { uStart: rEnd, uEnd: 0.4, y0: gF, y1: colY, z0: 0.0, z1: 1.5, key: 'paving_stone', railKey: 'steel' });
  }
  b.pop();
  const zKerb = d / 2 + 2.2 + Math.max(0, Math.ceil((colY - gF) / 0.165) * 0.3);
  bollardLine(b, cGap0 - 1, zKerb + 0.6, cGap1 + 1, zKerb + 0.6, gF, 1.8);
  K.bikeRacks(b, -w / 2 + 2.0, zKerb + 0.5, gF, Math.max(3, Math.min(8, Math.floor(w / 9))), { spacing: 0.9 });
  benchRow(b, cGap1 + 4, Math.min(w / 2 - 3, cGap1 + 16), zKerb + 0.8, gF, Math.PI, 5);
  signTotem(b, w / 2 + 1.8, gF, d / 2 + 2.5, 0, { w: 0.9, h: 2.6 });
  // ---------------- back yard: apron + loading ----------------
  const svcFr = svcSide;
  b.push(); K.facadeFrame(b, svcFr, w, d, 0);
  const Ls = svcFr === 'back' || svcFr === 'front' ? w : d;
  const [gb0, gb1] = K.sideGround(s, svcFr);
  const gy = Math.min(gb0, gb1);
  const apD = 12;
  const off = svcFr === 'right' ? d / 2 - bz1 : 0;           // back-band side frame u → footprint side frame u
  const uA0 = svcFr === 'right' ? off : 0, uA1 = svcFr === 'back' ? Ls : (svcFr === 'left' ? bz1 - bz0 : d);
  b.box('concrete', uA0 - 0.3, gy - 0.35, 0.0, uA1 + 0.3, gy + 0.02, apD, 4 | 16 | 1 | 2);
  if (b.collecting) b.colQuad(uA0 - 0.3, gy + 0.02, apD, uA1 + 0.3, gy + 0.02, apD, uA1 + 0.3, gy + 0.02, 0, uA0 - 0.3, gy + 0.02, 0);
  for (const lu of loadU) {
    const u = lu + off;
    if (ffl - gy > 0.5) dockLeveller(b, { u0: u - 1.6, u1: u + 1.6, ffl, gy, depth: 3.0, ext: 0.9, v1: ffl + 3.4 });
    else {
      b.box('steel', u - 1.6, ffl - 0.05, 0.0, u + 1.6, ffl + 0.004, 0.3, 4 | 16);
      for (const uu of [u - 2.0, u + 2.0]) b.cylinder('steel_yellow', uu, gy, 0.35, 0.12, 1.2, 10, { top: true });
    }
    for (const uu of [u - 1.75, u + 1.75]) b.box('steel_yellow', uu - 0.06, gy + 0.02, 1.5, uu + 0.06, gy + 0.026, apD - 1.0, 4);
  }
  if (loadU.length) {
    const c0 = Math.min(...loadU) + off - 2.4, c1 = Math.max(...loadU) + off + 2.4;
    b.withTint(inst.bandTint, () => K.canopyFlat(b, { u0: c0, u1: c1, y: ffl + 4.4, depth: 3.4, t: 0.3, key: 'ceramic_band', rods: true }));
  }
  if (svcFr === 'back') {
    const bu = loadU[0] > w / 2 ? 3.0 : w - 9.0;
    b.push(); b.translate(bu, 0, 4.5); K.binStore(b, 0, 0, 6.0, 2.2, gy, {}); b.pop();
  }
  b.pop();
  // ---------------- roofs: band roofs (garden / plant), vault ridge details ----------------
  const fRect = { x0: -w / 2 + T, x1: w / 2 - T, z0: zN1, z1: fz1 - T };
  if (st.id === 'zr_terrace' || inst.roofGarden) K.roofGarden(b, { x0: fRect.x0 + 0.4, x1: fRect.x1 - 0.4, z0: fRect.z0 + 0.4, z1: fRect.z1 - 0.3 }, bandTop + 0.04, (s.hash ^ 0x51) >>> 0, { keepOut: [{ x0: ent0 - w / 2 - 1, x1: ent1 - w / 2 + 1, z0: fRect.z0, z1: fRect.z1 }] });
  else {
    const n = Math.max(1, Math.floor((w - 8) / 14));
    for (let i = 0; i < n; i++) { const x = -w / 2 + 6 + ((w - 12) * (i + 0.5)) / n; if (Math.abs(x - mainX) < E) continue; K.hvacUnit(b, x, bandTop + 0.02, (fRect.z0 + fRect.z1) / 2, 0, { w: 2.0, d: 1.0, h: 1.1 }); }
  }
  {
    const bRect = { x0: -w / 2 + T, x1: w / 2 - T, z0: bz0 + T, z1: zN0 };
    const n = Math.max(1, Math.floor((w - 6) / 10));
    for (let i = 0; i < n; i++) {
      const x = bRect.x0 + 3 + ((bRect.x1 - bRect.x0 - 6) * (i + 0.5)) / n;
      if (i % 2 === 0) K.hvacUnit(b, x, backTop + 0.02, (bRect.z0 + bRect.z1) / 2, Math.PI, { w: 2.4, d: 1.2, h: 1.3 });
      else { K.ventMushroom(b, x, backTop, (bRect.z0 + bRect.z1) / 2 - 0.6, 0.22, 0.8); K.ventStack(b, x + 1.2, backTop, (bRect.z0 + bRect.z1) / 2 + 0.6, 0.1, 1.4); }
    }
    K.roofHatch(b, bRect.x1 - 2.0, backTop, (bRect.z0 + bRect.z1) / 2, {});
  }
  // ---------------- interior ('full') ----------------
  if (full) marketInterior(ctx, L, { shops, stairShop, mainU, mainX, ent0, ent1, E, fz0, fz1, bz0, bz1, H });
  // ---------------- anchors ----------------
  const A_ = b.anchors;
  A_.floors = [{ level: 0, y: ffl, height: naveEave - ffl }];
  if (nF > 1) A_.floors.push({ level: 1, y: ffl + gh, height: uh });
  A_.roof = { y: bandTop, access: [w / 2 - T - 2.0, backTop, (bz0 + zN0) / 2] };
  A_.entrances = [{ kind: 'main', side: 'front', pos: [mainX, ffl, fz1 + 0.6], dir: [0, 0, 1], width: 2.5 }];
  if (mL) A_.entrances.push({ kind: 'main', side: 'left', pos: [-w / 2 - 0.6, ffl, zN0 + leftU], dir: [-1, 0, 0], width: 2.8 });
  for (const lu of loadU) A_.entrances.push({ kind: 'service', side: svcSide, pos: K.facadePoint(svcSide, w, d, lu + off, ffl, 0.6), dir: K.facadeNormal(svcSide), width: 3.2 });
  A_.rooms = [{ floor: 0, name: 'market hall', kind: 'hall', center: [0, ffl, (zN0 + zN1) / 2], size: [w, naveEave - ffl, Dn] }];
  for (const p of shops) A_.rooms.push({ floor: 0, name: p === stairShop ? 'stair' : 'shop', kind: p === stairShop ? 'stair' : 'shop', center: [(p.u0 + p.u1) / 2 - w / 2, ffl, (zN1 + fz1) / 2], size: [p.u1 - p.u0, gh, fz1 - zN1] });
  const peak = H.prof.y((zN0 + zN1) / 2);
  A_.cameras = {
    street: { pos: [mainX - w * 0.35, gF + 1.65, d / 2 + Math.max(22, w * 0.45)], target: [mainX, ffl + 6, 0] },
    entrance: { pos: [mainX + E * 0.9, colY + 1.65, d / 2 - 0.9], target: [mainX - 1, ffl + 2.2, fz1] },
    interior: { pos: [mainX + 1.2, ffl + 1.65, zN1 - 1.2], target: [mainX - w * 0.25, ffl + 3.5, zN0 + 2] },
    lobby: { pos: [mainX, ffl + 1.65, fz1 - 1.0], target: [mainX, ffl + 3, zN0] },
    back: { pos: K.facadePoint(svcSide, w, d, (loadU[0] ?? 0) + off - 10, gy + 1.65, apD + 8), target: K.facadePoint(svcSide, w, d, (loadU[0] ?? 0) + off, ffl + 2.5, 0) },
    roof: { pos: [-w * 0.45, peak + 16, d * 0.75], target: [0, bandTop, 0] },
  };
  b.meta = { ...(b.meta || {}), market: { shops: shops.length, nave: [w, Dn], vaultPeak: +peak.toFixed(2) } };
}

function marketInterior(ctx, L, o) {
  const b = ctx.b, s = ctx.spec;
  const { w, nF, ffl, gh, zN0, zN1, T, bandTop } = L;
  const { shops, stairShop, mainX, ent0, ent1, fz1 } = o;
  // ---- stall grid in the nave: double rows along x, 3.2 m aisles, cross aisles + main axis ----
  const x0 = -w / 2 + T + 2.2, x1 = w / 2 - T - 2.2;
  const z0 = zN0 + T + 2.6, z1 = zN1 - T - 2.4;
  const pitch = 6.2, rowD = 1.0;
  const nRows = Math.max(1, Math.floor((z1 - z0 + 3.2) / pitch));
  const zStart = (z0 + z1) / 2 - ((nRows - 1) * pitch) / 2;
  const sw = 2.5;
  let k = 0;
  const nX = Math.max(1, Math.floor((x1 - x0) / (sw + 0.02)));
  for (let r = 0; r < nRows; r++) {
    const zr = zStart + r * pitch;
    for (let i = 0; i < nX; i++) {
      const x = x0 + sw / 2 + i * (sw + 0.02);
      if (Math.abs(x - mainX) < 2.6) continue;                       // main axis aisle
      if (i % 5 === 4) continue;                                     // cross aisle every 5 stalls
      stall(b, x, ffl, zr + rowD / 2 + 0.02, 0, (s.hash + k * 7919) >>> 0, sw, rowD);
      stall(b, x, ffl, zr - rowD / 2 - 0.02, Math.PI, (s.hash + k * 7919 + 13) >>> 0, sw, rowD, false);
      k++;
    }
  }
  // ---- shop partitions + counters + shelves in the front band ----
  const ceil = nF > 1 ? ffl + gh - 0.3 : bandTop - 0.35;
  const partU = new Set();          // shared shop boundaries get ONE partition (two identical boxes z-fought)
  for (const p of shops) {
    for (const u of [p.u0, p.u1]) {
      if (u < 0.2 || u > w - 0.2) continue;
      const ku = Math.round(u * 100);
      if (partU.has(ku)) continue;
      partU.add(ku);
      const x = u - w / 2;
      b.box('plaster', x - 0.06, ffl, zN1, x + 0.06, ceil, fz1 - T, 1 | 2 | 16 | 32);
      if (b.collecting) b.colBox(x - 0.06, ffl, zN1, x + 0.06, ceil, fz1 - T);
    }
    if (p === stairShop) continue;
    const cx = (p.u0 + p.u1) / 2 - w / 2, cz = zN1 + 1.2;
    b.push(); b.translate(cx, ffl, cz); b.box('cabinet', -Math.min(1.4, (p.u1 - p.u0) / 2 - 0.6), 0, -0.3, Math.min(1.4, (p.u1 - p.u0) / 2 - 0.6), 1.0, 0.3, 63 & ~8); b.box('counter', -Math.min(1.45, (p.u1 - p.u0) / 2 - 0.55), 1.0, -0.33, Math.min(1.45, (p.u1 - p.u0) / 2 - 0.55), 1.04, 0.35, 63); if (b.collecting) b.colBox(-1.4, 0, -0.3, 1.4, 1.04, 0.3); b.pop();
    for (const sx of [p.u0 + 0.3, p.u1 - 0.3]) { const x = sx - w / 2; b.box('wood', x - 0.22, ffl, zN1 + 2.2, x + 0.22, ffl + 2.2, fz1 - T - 0.6, 63 & ~8); }
  }
  // ceilings over the shops (light panels follow the shop occupancy)
  b.setExtra('iwin1', 0, 0.5, 0, 3100 + (s.hash % 89));
  b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, kindCode('shop'), s._profile | 0);
  for (const p of shops) {
    const cx = (p.u0 + p.u1) / 2 - w / 2, cz = (zN1 + fz1) / 2;
    b.box('light_panel', cx - 0.6, ceil - 0.05, cz - 0.3, cx + 0.6, ceil, cz + 0.3, 63);
  }
  b.clearExtra('iwin1'); b.clearExtra('iwin2');
  // ---- upper gallery (floors 2): slab over the shops, stair in the stair shop, tables ----
  if (nF > 1) {
    const yU = ffl + gh;
    const gx0 = ent0 - w / 2 - 0.2, gx1 = ent1 - w / 2 + 0.2;     // portal stays double height
    for (const [a, c] of [[-w / 2 + T, gx0], [gx1, w / 2 - T]]) {
      if (c - a < 0.5) continue;
      b.cbox('concrete_smooth', a, yU - 0.3, zN1, c, yU - 0.015, fz1 - T, 0.01, true);   // slab top under the timber floor (was 3 mm)
      b.rectY('wood_floor', a, zN1, c, fz1 - T, yU, 1);
      if (b.collecting) b.colQuad(a, yU, fz1 - T, c, yU, fz1 - T, c, yU, zN1, a, yU, zN1);
    }
    if (stairShop) {
      const sx = stairShop.u0 - w / 2 + 0.6;
      // stair opening is left in the slab conceptually; the flight rises along +x against the nave wall
      straightStair(b, sx, ffl, zN1 + 0.9, gh, 1.3);
    }
    for (let x = -w / 2 + 3; x < w / 2 - 3; x += 4.2) {
      if (x > gx0 - 1 && x < gx1 + 1) continue;
      if (stairShop && x > stairShop.u0 - w / 2 - 0.5 && x < stairShop.u1 - w / 2 + 0.5) continue;
      const zz = (zN1 + fz1) / 2;
      b.cylinder('aluminium_dark', x, yU, zz, 0.05, 0.72, 8, { top: false });
      b.cylinder('counter', x, yU + 0.72, zz, 0.45, 0.03, 18, { top: true, bottom: true });
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) b.cbox('wood', x + Math.cos(a) * 0.75 - 0.2, yU, zz + Math.sin(a) * 0.75 - 0.2, x + Math.cos(a) * 0.75 + 0.2, yU + 0.45, zz + Math.sin(a) * 0.75 + 0.2, 0.01, false);
    }
  }
  // ---- service band: cold rooms + office ----
  const bz0 = o.bz0 + T, bz1 = zN0;
  const crW = Math.min(8, w * 0.18);
  for (const [a, c] of [[-w / 2 + T + 0.2, -w / 2 + T + 0.2 + crW], [w / 2 - T - 0.2 - crW * 0.7, w / 2 - T - 0.2]]) {
    b.withTint([0.92, 0.94, 0.95], () => b.cbox('panel_insulated', a, ffl, bz0 + 0.2, c, ffl + 2.8, bz1 - 0.9, 0.02, false));
    if (b.collecting) b.colBox(a, ffl, bz0 + 0.2, c, ffl + 2.8, bz1 - 0.9);
  }
  void fz1;
}

function massing(ctx) {
  const s = ctx.spec, b = ctx.b;
  const L = layout(ctx);
  const { w, d, ffl, bandTop, naveEave, A, zN0, zN1, rise, backTop, ys } = L;
  const R = K.roofSpec(s, ctx.style, ctx.inst);
  const all = { front: true, right: true, back: true, left: true };
  const vols = [
    zMass(ctx, { fh: naveEave - ffl, gh: naveEave - ffl, ffl, roofY: naveEave }, { z0: zN0, z1: zN1, parapet: 0.05, blank: { front: true, back: true }, glazedGround: true, bands: false, roofColor: [0.86, 0.87, 0.88], bayW: 3.6 }),
    zMass(ctx, { fh: L.uh || L.gh, gh: L.gh, ffl, roofY: bandTop }, { z0: zN1 - L.T, z1: d / 2 - A, parapet: 0.7, blank: { ...s._shared, back: true }, shops: true, bands: false, roofColor: K.roofFarColor(R), bayW: 3.6 }),
    zMass(ctx, { fh: backTop - ffl, gh: backTop - ffl, ffl, roofY: backTop }, { z0: -d / 2, z1: zN0 + L.T, parapet: 0.7, blank: { ...s._shared, front: true }, bands: false, bayW: 3.6 }),
    zMass(ctx, { fh: 1, gh: 1, ffl, roofY: ys + 0.45 }, { z0: d / 2 - A, z1: d / 2, y0: ys, parapet: 0.0, blank: all, soffit: true, bands: false, roofColor: [0.9, 0.9, 0.88] }),
  ];
  // vault (mass_roof) + gable ends
  const prof = roofProfile({ z0: zN0, z1: zN1, y0: ffl, eave: naveEave - ffl, roof: { kind: 'vault', rise } });
  const n = 10, P = [];
  for (let i = 0; i <= n; i++) { const z = zN0 + ((zN1 - zN0) * i) / n; P.push([z, prof.y(z)]); }
  b.pushTint([0.86, 0.87, 0.88]);
  for (let i = 0; i < n; i++) {
    const [za, ya] = P[i], [zb, yb] = P[i + 1];
    b.quad('mass_roof', -w / 2, ya, za, -w / 2, yb, zb, w / 2, yb, zb, w / 2, ya, za);
  }
  for (let i = 0; i < n; i++) {
    const [za, ya] = P[i], [zb, yb] = P[i + 1], zm = (zN0 + zN1) / 2;
    b.triangle('mass_roof', w / 2, naveEave, zm, w / 2, ya, za, w / 2, yb, zb);
    b.triangle('mass_roof', -w / 2, naveEave, zm, -w / 2, yb, zb, -w / 2, ya, za);
  }
  b.popTint();
  return vols;
}

export default {
  name: 'market',
  uses: ['market'],
  generate(spec, lod, ctx) { generate(ctx); },
  massing(spec, ctx) { return massing(ctx); },
};
