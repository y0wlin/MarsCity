// Room furnishing: wall-based greedy placement that respects doors (with swing clearance) and
// windows (only items lower than the sill go under a window). Recipes per room kind.

import * as F from './furniture.js';
import { connected, uToPlan } from '../kit/plan.js';
import { bikeRacks } from '../kit/site.js';
import { Rng, hash4 } from '../../core/hash.js';

/** The four interior walls of rect I as placement frames. */
function wallsOf(I) {
  return [
    { id: 'z0', o: [I.x0, I.z0], u: [1, 0], n: [0, 1], L: I.x1 - I.x0 },
    { id: 'x1', o: [I.x1, I.z0], u: [0, 1], n: [-1, 0], L: I.z1 - I.z0 },
    { id: 'z1', o: [I.x1, I.z1], u: [-1, 0], n: [0, -1], L: I.x1 - I.x0 },
    { id: 'x0', o: [I.x0, I.z1], u: [0, -1], n: [1, 0], L: I.z1 - I.z0 },
  ];
}

/** u-coordinate of plan point p on wall W (projection). */
const uOn = (W, p) => (p[0] - W.o[0]) * W.u[0] + (p[1] - W.o[1]) * W.u[1];
const dOff = (W, p) => (p[0] - W.o[0]) * W.n[0] + (p[1] - W.o[1]) * W.n[1];

export function furnishRoom(ctx, plan, f, r, edges) {
  const b = ctx.b, s = ctx.spec;
  const I = r._in; if (!I) return;
  const rng = new Rng(hash4(s.hash, f.level, Math.round(r.x0 * 7), Math.round(r.z0 * 7)));
  const walls = wallsOf(I);
  // blocked intervals per wall: [u0, u1, maxH, flag] — an item of height h may stand over the
  // interval only when h ≤ maxH (low items under a window sill); doors and French windows use
  // maxH −1 (nothing in front of them); flag 1 = keep another 0.3 m clear (balcony / exterior doors)
  for (const W of walls) { W.block = []; W.used = []; }
  // keep-out boxes in front of every door (the swing + a 1 m approach): furniture on the
  // perpendicular walls must not reach into it either (walk-mode capsule r 0.28 m)
  const placed = [];
  const keepOut = (pA, pB) => {
    const mx = (pA[0] + pB[0]) / 2, mz = (pA[1] + pB[1]) / 2;
    const alongX = Math.abs(pA[0] - pB[0]) >= Math.abs(pA[1] - pB[1]);
    const half = Math.max(Math.abs(pA[0] - pB[0]), Math.abs(pA[1] - pB[1])) / 2 + 0.25;
    const deep = 1.0;
    const bx = alongX ? { x0: mx - half, x1: mx + half, z0: mz - deep, z1: mz + deep } : { x0: mx - deep, x1: mx + deep, z0: mz - half, z1: mz + half };
    bx.keep = true;
    placed.push(bx);
  };
  if (r._doorSpans && r._doorSpans.length) {
    // the real door spans cut by emitInterior
    for (const [pA, pB] of r._doorSpans) {
      const mid = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
      for (const W of walls) {
        if (Math.abs(dOff(W, mid)) > 0.35) continue;
        const a = uOn(W, pA), c = uOn(W, pB);
        W.block.push([Math.min(a, c) - 0.6, Math.max(a, c) + 0.6, -1, 0]);
      }
      keepOut(pA, pB);
    }
  } else {
    // no door spans known (furnishRoom called without emitInterior): the door sits 0.25 m from one
    // end of the shared partition (or centred on short ones) — block both candidate positions
    for (const e of edges) {
      if (e.a !== r && e.b !== r) continue;
      if (!connected(e.a, e.b)) continue;
      const mid = [(e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2];
      for (const W of walls) {
        if (Math.abs(dOff(W, mid)) > 0.2) continue;
        const a = uOn(W, [e.x0, e.z0]), c = uOn(W, [e.x1, e.z1]);
        const L = Math.abs(c - a);
        const lo = Math.min(a, c);
        const dw = 0.9; const at = L > 2.6 ? 0.25 + dw / 2 : L / 2;
        W.block.push([lo + at - dw / 2 - 0.55, lo + at + dw / 2 + 0.55, -1, 0]);
        W.block.push([lo + L - at - dw / 2 - 0.55, lo + L - at + dw / 2 + 0.55, -1, 0]);
      }
    }
  }
  for (const op of plan.allOpenings || []) {
    if (op.room !== r) continue;
    const p0 = uToPlan(op.side, plan.w, plan.d, op.u0), p1 = uToPlan(op.side, plan.w, plan.d, op.u1);
    for (const W of walls) {
      const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      if (Math.abs(dOff(W, m)) > plan.wallT + 0.25) continue;
      const a = uOn(W, p0), c = uOn(W, p1);
      const sill = op.v0 - f.y;
      const full = op.kind === 'slider' || op.kind === 'tall' || op.kind === 'door' || op.kind === 'shop' || (op.door && op.kind === 'shop');
      W.block.push([Math.min(a, c) - 0.1, Math.max(a, c) + 0.1, full ? -1 : sill - 0.05, op.kind === 'slider' || op.kind === 'door' ? 1 : 0]);
    }
    // exterior doors / balcony sliders: keep the approach clear like an interior door
    if ((op.kind === 'slider' || op.kind === 'door') && op.v0 < f.y + 0.3) keepOut(p0, p1);
  }
  const area = (I.x1 - I.x0) * (I.z1 - I.z0);
  /** try to place item {w, d, h} on one of `prefer` walls; returns frame info or null */
  const place = (item, prefer = ['z0', 'x0', 'x1', 'z1'], o = {}) => {
    for (const id of prefer) {
      const W = walls.find((x) => x.id === id);
      if (!W || W.L < item.w + 0.1) continue;
      const cands = [];
      const step = 0.1;
      for (let u = item.w / 2 + 0.05; u <= W.L - item.w / 2 - 0.05; u += step) cands.push(u);
      // prefer centre or corner as requested
      if (o.centre) cands.sort((p, q) => Math.abs(p - W.L / 2) - Math.abs(q - W.L / 2));
      for (const u of cands) {
        const a = u - item.w / 2, c = u + item.w / 2;
        if (W.block.some((bl) => a < bl[1] && c > bl[0] && item.h > bl[2])) continue;
        if (W.block.some((bl) => bl[3] === 1 && a < bl[1] + 0.3 && c > bl[0] - 0.3)) continue; // keep balcony doors free
        // overlap with already placed footprints (axis-aligned in plan)
        const px = W.o[0] + W.u[0] * u, pz = W.o[1] + W.u[1] * u;
        const fx = W.u[0] * item.w / 2, fz = W.u[1] * item.w / 2;
        const gx = W.n[0] * (item.d + (o.clear ?? 0.6)), gz = W.n[1] * (item.d + (o.clear ?? 0.6));
        const bb = { x0: Math.min(px - fx, px + fx, px - fx + gx, px + fx + gx), x1: Math.max(px - fx, px + fx, px - fx + gx, px + fx + gx), z0: Math.min(pz - fz, pz + fz, pz - fz + gz, pz + fz + gz), z1: Math.max(pz - fz, pz + fz, pz - fz + gz, pz + fz + gz) };
        // solid footprint (no walking clearance) for the door keep-out boxes
        const hx = W.n[0] * item.d, hz = W.n[1] * item.d;
        const sb = { x0: Math.min(px - fx, px + fx, px - fx + hx, px + fx + hx), x1: Math.max(px - fx, px + fx, px - fx + hx, px + fx + hx), z0: Math.min(pz - fz, pz + fz, pz - fz + hz, pz + fz + hz), z1: Math.max(pz - fz, pz + fz, pz - fz + hz, pz + fz + hz) };
        if (placed.some((q) => { const t = q.keep ? sb : bb; return t.x0 < q.x1 - 0.02 && t.x1 > q.x0 + 0.02 && t.z0 < q.z1 - 0.02 && t.z1 > q.z0 + 0.02; })) continue;
        if (bb.x0 < I.x0 - 0.01 || bb.x1 > I.x1 + 0.01 || bb.z0 < I.z0 - 0.01 || bb.z1 > I.z1 + 0.01) continue;
        placed.push(bb);
        return { W, u, px, pz, bb };
      }
    }
    return null;
  };
  const at = (p, fn) => { if (!p) return; b.push(); b.frame(p.px, f.y, p.pz, p.W.u[0], 0, p.W.u[1], 0, 1, 0, p.W.n[0], 0, p.W.n[1]); fn(); b.pop(); };
  const free = (x, z, w, d) => !placed.some((q) => x - w / 2 < q.x1 && x + w / 2 > q.x0 && z - d / 2 < q.z1 && z + d / 2 > q.z0);
  const seed = hash4(s.hash, f.level, r.unit ?? 0, 9) % 97;
  switch (r.kind) {
    case 'living': {
      // sofa centred on a side wall facing the TV (the 2nd-floor living camera looks past it)
      const sofaP = place({ w: 2.1, d: 0.9, h: 0.9 }, ['x0', 'x1', 'z0', 'z1'], { clear: 1.4, centre: true });
      at(sofaP, () => F.sofa(b, seed));
      r._sofaWall = sofaP ? sofaP.W.id : null;
      if (sofaP) {
        // coffee table + rug in front of the sofa
        const cx = sofaP.px + sofaP.W.n[0] * 1.45, cz = sofaP.pz + sofaP.W.n[1] * 1.45;
        b.push(); b.frame(cx, f.y, cz, sofaP.W.u[0], 0, sofaP.W.u[1], 0, 1, 0, sofaP.W.n[0], 0, sofaP.W.n[1]); F.rug(b, 2.2, 1.6, seed); F.coffeeTable(b); b.pop();
        // TV unit on the opposite wall
        const opp = { x0: 'x1', x1: 'x0', z0: 'z1', z1: 'z0' }[sofaP.W.id];
        at(place({ w: 1.8, d: 0.4, h: 1.4 }, [opp], { centre: true, clear: 0.4 }), () => F.tvUnit(b));
      }
      if (area > 18) {
        const dx = (I.x0 + I.x1) / 2 + (rng.next() - 0.5) * 0.5, dz = I.z0 + 1.4;
        if (free(dx, dz, 2.0, 2.2)) { b.push(); b.translate(dx, f.y, dz); F.diningSet(b, seed); b.pop(); placed.push({ x0: dx - 1, x1: dx + 1, z0: dz - 1.1, z1: dz + 1.1 }); }
      }
      at(place({ w: 0.9, d: 0.35, h: 1.9 }, ['z0', 'x1', 'x0', 'z1'], { clear: 0.5 }), () => F.shelves(b, 0.9, 1.9, seed));
      at(place({ w: 0.5, d: 0.5, h: 1.0 }, ['z1', 'x0', 'x1'], { clear: 0.2 }), () => F.plantPot(b, 0, 0.25, 1.0, seed));
      at(place({ w: 0.4, d: 0.4, h: 1.7 }, ['x1', 'x0', 'z0'], { clear: 0.2 }), () => F.floorLamp(b));
      break;
    }
    case 'bedroom': {
      if (r.name === 'study') {
        // study: desk + chair at the window wall, bookshelves, reading chair with lamp, rug, plant
        at(place({ w: 1.4, d: 0.6, h: 0.76 }, ['z1', 'z0', 'x1', 'x0'], { clear: 0.8, centre: true }), () => F.desk(b, 1.4, seed));
        for (let k = 0; k < 2; k++) at(place({ w: 0.9, d: 0.35, h: 1.9 }, ['x0', 'x1', 'z0', 'z1'], { clear: 0.5 }), () => F.shelves(b, 0.9, 1.9, seed + k * 5));
        at(place({ w: 0.6, d: 0.6, h: 0.9 }, ['x1', 'x0', 'z0'], { clear: 0.5 }), () => { b.translate(0, 0, 0.28); F.chair(b, seed + 3); });
        at(place({ w: 0.4, d: 0.4, h: 1.7 }, ['x1', 'x0', 'z0'], { clear: 0.2 }), () => F.floorLamp(b));
        at(place({ w: 0.5, d: 0.5, h: 1.0 }, ['z0', 'x0', 'x1', 'z1'], { clear: 0.2 }), () => F.plantPot(b, 0, 0.25, 1.0, seed));
        if (area > 7) { const cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2; b.push(); b.translate(cx, f.y, cz); F.rug(b, Math.min(1.8, I.x1 - I.x0 - 1.2), Math.min(1.3, I.z1 - I.z0 - 1.4), seed); b.pop(); }
        break;
      }
      const bw = (I.x1 - I.x0) > 2.9 && (I.z1 - I.z0) > 2.9 ? 1.6 : 0.9;
      const bedP = place({ w: bw + 1.0, d: 2.1, h: 1.1 }, ['z0', 'x0', 'x1', 'z1'], { centre: true, clear: 0.6 });
      at(bedP, () => {
        F.bed(b, bw, seed); b.push(); b.translate(-bw / 2 - 0.3, 0, 0); F.bedside(b); b.pop(); b.push(); b.translate(bw / 2 + 0.3, 0, 0); F.bedside(b); b.pop();
        b.push(); b.translate(0, 0, 1.75); F.rug(b, bw + 1.1, 1.3, seed + 1); b.pop();          // rug at the foot of the bed
      });
      at(place({ w: 1.8, d: 0.6, h: 2.2 }, ['x1', 'x0', 'z1', 'z0'], { clear: 0.7 }), () => F.wardrobe(b, 1.8));
      // window-wall piece varies per room: desk (its top varies too), chest of drawers, armchair corner
      const wv = (seed * 5 + f.level) % 7;
      if (wv < 4) at(place({ w: 1.2, d: 0.6, h: 0.76 }, ['z1', 'x1', 'x0'], { clear: 0.7 }), () => F.desk(b, 1.2, seed + f.level));
      else if (wv < 6) at(place({ w: 1.0, d: 0.45, h: 0.82 }, ['z1', 'x1', 'x0'], { clear: 0.6 }), () => F.dresser(b, 1.0, seed + f.level));
      else at(place({ w: 0.8, d: 0.8, h: 0.9 }, ['z1', 'x0', 'x1'], { clear: 0.4 }), () => { b.translate(0, 0, 0.36); b.rotY(Math.PI); F.chair(b, seed + 2); });
      // fuller rooms: plant, armchair + reading lamp in larger rooms (no colliders: walkways stay open);
      // a low bookshelf only on the wall the bed stands against when there is room beside the bed
      if (bedP && bedP.W.L > bw + 3.4) {
        const W0 = bedP.W, side = bedP.u > W0.L / 2 ? -1 : 1, u = bedP.u + side * (bw / 2 + 1.25);
        const px = W0.o[0] + W0.u[0] * u, pz = W0.o[1] + W0.u[1] * u;
        const ex = Math.abs(W0.u[0]) * 0.4 + Math.abs(W0.n[0]) * 0.35, ez = Math.abs(W0.u[1]) * 0.4 + Math.abs(W0.n[1]) * 0.35;
        const sb = { x0: px - ex + W0.n[0] * 0.175, x1: px + ex + W0.n[0] * 0.175, z0: pz - ez + W0.n[1] * 0.175, z1: pz + ez + W0.n[1] * 0.175 };
        const clearOf = !W0.block.some((bl) => u - 0.4 < bl[1] && u + 0.4 > bl[0] && 0.95 > bl[2]) && !placed.some((q) => q !== bedP.bb && sb.x0 < q.x1 - 0.02 && sb.x1 > q.x0 + 0.02 && sb.z0 < q.z1 - 0.02 && sb.z1 > q.z0 + 0.02);
        if (clearOf && u > 0.45 && u < W0.L - 0.45) { placed.push(sb); at({ W: W0, u, px, pz }, () => F.shelves(b, 0.8, 0.95, seed + 2)); }
      }
      if (area > 9 && rng.next() < 0.6) at(place({ w: 0.5, d: 0.5, h: 1.1 }, ['z1', 'x0', 'x1', 'z0'], { clear: 0.2 }), () => F.plantPot(b, 0, 0.25, 1.1, seed + 4));
      if (area > 13) at(place({ w: 0.6, d: 0.6, h: 0.9 }, ['x0', 'x1', 'z1'], { clear: 0.5 }), () => { b.translate(0, 0, 0.28); F.chair(b, seed + 6); });
      if (area > 11) at(place({ w: 0.4, d: 0.4, h: 1.7 }, ['x0', 'x1', 'z1'], { clear: 0.2 }), () => F.floorLamp(b));
      break;
    }
    case 'kitchen': {
      const W = walls.slice().sort((p, q) => q.L - p.L);
      let done = false;
      for (const w0 of W) {
        const L = Math.min(w0.L - 0.2, 3.6);
        if (L < 1.4) continue;
        const p = place({ w: L, d: 0.62, h: 0.92 }, [w0.id], { clear: 0.9 });
        if (p) { at({ ...p, px: p.px - p.W.u[0] * L / 2, pz: p.pz - p.W.u[1] * L / 2 }, () => F.kitchenRun(b, L)); done = true; break; }
      }
      if (!done) { const p = place({ w: 1.4, d: 0.62, h: 0.92 }, ['z0', 'x0', 'x1', 'z1'], { clear: 0.8 }); at(p && { ...p, px: p.px - p.W.u[0] * 0.7, pz: p.pz - p.W.u[1] * 0.7 }, () => F.kitchenRun(b, 1.4, { fridge: false })); }
      if (area > 11) { const dx = (I.x0 + I.x1) / 2, dz = (I.z0 + I.z1) / 2; if (free(dx, dz, 1.9, 2.1)) { b.push(); b.translate(dx, f.y, dz); b.rotY(Math.PI / 2); F.diningSet(b, seed); b.pop(); } }
      break;
    }
    case 'bath': {
      at(place({ w: 0.45, d: 0.72, h: 0.8 }, ['z0', 'x0', 'x1', 'z1'], { clear: 0.5 }), () => F.toilet(b));
      at(place({ w: 0.8, d: 0.5, h: 0.9 }, ['x1', 'x0', 'z0', 'z1'], { clear: 0.6 }), () => F.vanity(b, 0.8));
      const sp = place({ w: 0.92, d: 0.92, h: 2.0 }, ['z1', 'z0', 'x0', 'x1'], { clear: 0.0 });
      at(sp, () => { b.translate(-0.46, 0, 0); F.shower(b, 0.9); });
      break;
    }
    case 'hall':
      at(place({ w: 1.0, d: 0.35, h: 1.0 }, ['x0', 'x1', 'z0', 'z1'], { clear: 0.6 }), () => F.shelves(b, 1.0, 1.0, seed));
      if (area > 4 && rng.next() < 0.5) at(place({ w: 0.5, d: 0.5, h: 1.0 }, ['x1', 'x0', 'z0', 'z1'], { clear: 0.3 }), () => F.plantPot(b, 0, 0.25, 1.0, seed + 1));
      break;
    case 'lobby': {
      at(place({ w: 1.6, d: 0.45, h: 0.5 }, ['x1', 'z0'], { clear: 0.8 }), () => F.lobbyBench(b));
      at(place({ w: 0.5, d: 0.5, h: 1.3 }, ['x1', 'z1', 'z0'], { clear: 0.3 }), () => F.plantPot(b, 0, 0.25, 1.3, seed));
      break;
    }
    case 'shop': {
      at(place({ w: 2.0, d: 0.64, h: 1.1 }, ['x0', 'x1', 'z0'], { clear: 1.0 }), () => F.counter(b, 2.0));
      const n = Math.max(0, Math.floor((I.x1 - I.x0 - 1.5) / 2.2));
      for (let i = 0; i < n; i++) {
        const gx = I.x0 + 1.2 + i * 2.2, gz = (I.z0 + I.z1) / 2;
        if (free(gx, gz, 1.0, 2.6)) { b.push(); b.translate(gx, f.y, gz - 1.2); b.rotY(-Math.PI / 2); F.gondola(b, 2.4); b.pop(); placed.push({ x0: gx - 0.5, x1: gx + 0.5, z0: gz - 1.3, z1: gz + 1.3 }); }
      }
      break;
    }
    case 'office': case 'classroom': case 'clinic': {
      const nx = Math.max(1, Math.floor((I.x1 - I.x0 - 1) / 2.0)), nz = Math.max(1, Math.floor((I.z1 - I.z0 - 1.5) / 2.4));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = I.x0 + 1.0 + (i + 0.5) * ((I.x1 - I.x0 - 2) / nx), z = I.z0 + 1.0 + (j + 0.3) * ((I.z1 - I.z0 - 2) / nz);
        if (free(x, z, 1.5, 1.6)) { b.push(); b.translate(x, f.y, z); F.officeDesk(b, seed + i + j); b.pop(); placed.push({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.1, z1: z + 1.3 }); }
      }
      break;
    }
    case 'storage': {
      for (let k = 0; k < 3; k++) at(place({ w: 0.9, d: 0.35, h: 1.9 }, ['z0', 'x0', 'x1', 'z1'], { clear: 0.5 }), () => F.shelves(b, 0.9, 1.9, seed + k));
      break;
    }
    case 'bike': {
      bikeRacks(b, I.x0 + 0.5, (I.z0 + I.z1) / 2, f.y, Math.max(1, Math.floor((I.x1 - I.x0 - 0.8) / 0.9)));
      break;
    }
    default: break;
  }
}
