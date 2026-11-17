// Door units (wall frame: x = u along wall, y up, z outward; outer face z = 0).
// Fill an opening [u0,u1]×[v0,v1] (v0 = finished floor level) whose reveal ends at depth R.
// Handles sit at 1.0 m; thresholds, kick plates, glazed leaves, push bars, closers.
//
//   doorUnit(b, {u0,u1,v0,v1,R, kind:'single'|'double'|'glazed'|'glazed_double'|'service'|'apartment'|'interior',
//                open:0..1 (leaf swing, 'full' LOD interiors stay open), hinge:'left'|'right', inward:true})
//   vestibule(b, {...})  glass draught lobby (门斗) behind / in front of an entrance

import { frameRect, glassPane, clearGlassRoom, ROOM_KIND } from './windows.js';
import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';

/** Lever handle on a rose plate at height h (v0 + 1.0 m), on face plane z (normal sign s). */
export function leverHandle(b, u, v0, z, s = 1, side = 1, key = 'chrome') {
  const h = v0 + 1.0;
  const z1 = z + s * 0.01;
  b.box(key, u - 0.025, h - 0.085, Math.min(z, z1), u + 0.025, h + 0.085, Math.max(z, z1), s > 0 ? PZ | PX | NX | PY | NY : NZ | PX | NX | PY | NY);
  const zz = z + s * 0.055;
  b.box(key, u - 0.009, h - 0.009, Math.min(z1, zz), u + 0.009, h + 0.009, Math.max(z1, zz), PX | NX | PY | NY);
  const ua = side > 0 ? u - 0.01 : u - 0.13, ub = side > 0 ? u + 0.13 : u + 0.01;
  b.box(key, ua, h - 0.011, Math.min(zz - s * 0.012, zz + s * 0.012), ub, h + 0.011, Math.max(zz - s * 0.012, zz + s * 0.012), ALL);
}

/** Vertical pull bar (glazed entrance doors). */
export function pullBar(b, u, v0, z, s = 1, key = 'chrome') {
  const zz = z + s * 0.07;
  b.tube(key, [[u, v0 + 0.75, z], [u, v0 + 0.75, zz], [u, v0 + 1.6, zz], [u, v0 + 1.6, z]], 0.016, 10);
}

/**
 * One door leaf, local origin at its hinge-bottom-front corner after the caller's transform.
 * Leaf spans x ∈ [0, w] (w>0), y ∈ [0, h], z ∈ [−t, 0].
 */
function leaf(b, o, w, h, t) {
  const kind = o.kind;
  const lk = o.leafKey || (kind === 'service' ? 'steel_door' : kind === 'interior' || kind === 'apartment' ? 'wood_door' : kind === 'entry' ? 'wood' : 'aluminium_dark');
  if (kind === 'entry') {
    // house front door: timber leaf with a vertical vision strip of reeded glass, aluminium
    // kick plate, letter plate; frame in aluminium_dark (weather side)
    const gx0 = w * 0.62, gx1 = w * 0.8, gy0 = h * 0.3, gy1 = h * 0.88;
    b.withTint(o.leafTint || [0.62, 0.5, 0.4], () => {
      // leaf with a glazing slot (four boxes around it)
      b.cbox(lk, 0, 0, -t, gx0, h, 0, 0.004);
      b.cbox(lk, gx1, 0, -t, w, h, 0, 0.004);
      b.box(lk, gx0 - 0.001, 0, -t, gx1 + 0.001, gy0, 0, PZ | NZ | PY);
      b.box(lk, gx0 - 0.001, gy1, -t, gx1 + 0.001, h, 0, PZ | NZ | NY | PY);
      // grooves (raised strips) for relief
      for (const zf of [0.004, -t - 0.004]) {
        const sg = zf > 0 ? 1 : -1, f = sg > 0 ? PZ : NZ;
        for (const yy of [h * 0.18, h * 0.5]) b.box(lk, 0.08, yy, Math.min(zf, zf - sg * 0.005), gx0 - 0.08, yy + 0.02, Math.max(zf, zf - sg * 0.005), f | PY | NY);
      }
    });
    clearGlassRoom(b);
    b.quad('glass_frosted', gx0, gy0, -t / 2, gx1, gy0, -t / 2, gx1, gy1, -t / 2, gx0, gy1, -t / 2);
    b.quad('glass_frosted', gx1, gy0, -t / 2 - 0.001, gx0, gy0, -t / 2 - 0.001, gx0, gy1, -t / 2 - 0.001, gx1, gy1, -t / 2 - 0.001);
    b.box('steel_brushed', 0.03, 0.03, 0.0, w - 0.03, 0.22, 0.004, 63);
    b.cbox('steel_brushed', w * 0.25, h * 0.55, 0.0, w * 0.55, h * 0.55 + 0.06, 0.008, 0.002);
    return;
  }
  if (kind === 'glazed' || kind === 'glazed_double') {
    const sw = 0.09;
    frameRect(b, lk, 0, 0, w, h, 0, -t, sw, true, 0.005);
    b.cbox(lk, sw - 0.001, 0, -t, w - sw + 0.001, 0.22, 0, 0.005); // bottom rail (kick)
    if ((o.open ?? 0) > 0.05) {
      // a leaf swung open is no longer part of the façade: no room ids → no street reflection on it
      clearGlassRoom(b);
      b.quad(o.glassKey || 'glass_shop', sw, 0.22, -t / 2, w - sw, 0.22, -t / 2, w - sw, h - sw, -t / 2, sw, h - sw, -t / 2, [0, 0, w - 2 * sw, 0, w - 2 * sw, h - sw - 0.22, 0, h - sw - 0.22]);
    } else glassPane(b, o.glassKey || 'glass_shop', sw, 0.22, w - sw, h - sw, -t / 2, o.room, { u0: 0, v0: 0 });
    clearGlassRoom(b);
    return;
  }
  // solid leaf with chamfered edges + recessed panel grooves
  b.cbox(lk, 0, 0, -t, w, h, 0, 0.004);
  if (kind === 'apartment' || kind === 'single') {
    // two shallow raised panels for relief on both faces (front + edges only)
    for (const zf of [0.005, -t - 0.005]) {
      const s = zf > 0 ? 1 : -1;
      const f = s > 0 ? PZ : NZ;
      b.box(lk, 0.12, 0.18, Math.min(zf, zf - s * 0.007), w - 0.12, h * 0.48, Math.max(zf, zf - s * 0.007), f | PX | NX | PY | NY);
      b.box(lk, 0.12, h * 0.54, Math.min(zf, zf - s * 0.007), w - 0.12, h - 0.18, Math.max(zf, zf - s * 0.007), f | PX | NX | PY | NY);
    }
  }
  if (kind === 'service') {
    // vision panel + kick plate + louvre band at the bottom
    clearGlassRoom(b);
    b.quad('glass_frosted', w * 0.3, h * 0.62, 0.004, w * 0.7, h * 0.62, 0.004, w * 0.7, h * 0.86, 0.004, w * 0.3, h * 0.86, 0.004);
    b.box('steel', 0.03, 0.03, 0.0, w - 0.03, 0.28, 0.006, 63);
  }
}

/**
 * Door in an opening.
 * @param {MeshBuilder} b
 * @param {object} o  {u0,u1,v0,v1,R=0.2,kind,open=0,hinge='left',inward=true,leafKey,frameKey,room,T=0.3}
 */
export function doorUnit(b, o) {
  const R = o.R ?? 0.2, fk = o.frameKey || (o.kind === 'interior' || o.kind === 'apartment' ? 'wood_door' : 'aluminium_dark');
  // 'entry': house front door (timber leaf, reeded glass strip, pull + lever, letter plate)
  const { u0, u1, v0, v1 } = o;
  const double = o.kind === 'double' || o.kind === 'glazed_double';
  const fw = o.kind === 'interior' ? 0.045 : 0.07, fd = o.kind === 'interior' ? (o.T ?? 0.1) + 0.02 : 0.1;
  const zf = o.kind === 'interior' ? (fd / 2) : -R, zb = zf - fd;
  // frame: jambs + head (no bottom bar), threshold
  b.cbox(fk, u0, v0, zb, u0 + fw, v1, zf, 0.005);
  b.cbox(fk, u1 - fw, v0, zb, u1, v1, zf, 0.005);
  b.cbox(fk, u0 + fw - 0.001, v1 - fw, zb, u1 - fw + 0.001, v1, zf, 0.005);
  if (o.kind !== 'interior') b.cbox(o.thresholdKey || 'stone_sill', u0 + 0.002, v0 - 0.01, zb - 0.02, u1 - 0.002, v0 + 0.018, Math.min(0.03, zf + 0.25), 0.006);
  // architraves on interior doors (both faces)
  if (o.kind === 'interior' || o.kind === 'apartment') {
    const T = o.T ?? 0.1, zo = o.kind === 'interior' ? T / 2 : 0, zi = o.kind === 'interior' ? -T / 2 : -(o.T ?? 0.3);
    for (const [z, s] of [[zo, 1], [zi, -1]]) {
      if (o.kind === 'apartment' && s > 0) continue;
      const z1 = z + s * 0.015;
      b.box(fk, u0 - 0.07, v0, Math.min(z, z1), u0 + 0.0, v1 + 0.07, Math.max(z, z1), 63);
      b.box(fk, u1 - 0.0, v0, Math.min(z, z1), u1 + 0.07, v1 + 0.07, Math.max(z, z1), 63);
      b.box(fk, u0 - 0.07, v1, Math.min(z, z1), u1 + 0.07, v1 + 0.07, Math.max(z, z1), 63);
    }
  }
  const cu0 = u0 + fw, cu1 = u1 - fw, h = v1 - fw - v0 - 0.008;
  const t = o.kind === 'interior' ? 0.04 : o.kind === 'glazed' || o.kind === 'glazed_double' ? 0.06 : 0.055;
  const open = o.open ?? 0;
  const inward = o.inward !== false;
  const leaves = double ? [[cu0, (cu0 + cu1) / 2, 'left'], [(cu0 + cu1) / 2, cu1, 'right']] : [[cu0, cu1, o.hinge || 'left']];
  for (const [a, c, hinge] of leaves) {
    const w = c - a - 0.006;
    const ang = open * (Math.PI / 2) * (inward ? 1 : -1) * (hinge === 'left' ? 1 : -1);
    b.push();
    const zLeaf = zf - (fd - t) / 2;
    if (hinge === 'left') { b.translate(a + 0.003, v0 + 0.008, zLeaf); b.rotY(ang); leaf(b, o, w, h, t); handles(b, o, w, t, 'left'); }
    else { b.translate(c - 0.003, v0 + 0.008, zLeaf); b.rotY(ang); b.translate(-w, 0, 0); leaf(b, o, w, h, t); handles(b, o, w, t, 'right'); }
    b.pop();
  }
}

function handles(b, o, w, t, hinge) {
  const glazed = o.kind === 'glazed' || o.kind === 'glazed_double';
  const hu = hinge === 'left' ? w - 0.07 : 0.07;
  const side = hinge === 'left' ? -1 : 1;
  if (glazed) { pullBar(b, hu, 0, 0.0, 1); pullBar(b, hu, 0, -t, -1); return; }
  if (o.kind === 'entry') { pullBar(b, hu - 0.01, 0, 0.0, 1, 'steel_brushed'); leverHandle(b, hu, 0, -t, -1, side); b.cbox('chrome', hu - 0.02, 0.92, 0.0, hu + 0.02, 0.98, 0.012, 0.003); return; }
  leverHandle(b, hu, 0, 0.0, 1, side);
  leverHandle(b, hu, 0, -t, -1, side);
  if (o.kind === 'apartment') b.cbox('chrome', hu - 0.012, 1.45, 0.0, hu + 0.012, 1.47, 0.006, 0.002); // spy hole
}

/**
 * Glass draught lobby (门斗/vestibule) projecting INTO the building behind an entrance opening.
 * In wall frame: spans u0..u1, from z = −R (outer doors) to z = −R − depth (inner doors).
 */
export function vestibule(b, o) {
  const R = o.R ?? 0.2, depth = o.depth ?? 2.0, { u0, u1, v0 } = o;
  const H = o.height ?? 2.6, fk = o.frameKey || 'aluminium_dark';
  const zi = -R - depth;
  // inner glazed double doors with side lights
  const w = u1 - u0, dw = Math.min(1.8, w - 0.6);
  const d0 = u0 + (w - dw) / 2;
  b.push(); b.translate(0, 0, zi + 0.05);
  frameRect(b, fk, u0, v0, d0, v0 + H, 0.05, -0.05, 0.06, true);
  glassPane(b, 'glass_clear', u0 + 0.06, v0 + 0.06, d0 - 0.06, v0 + H - 0.06, 0, null, null);
  frameRect(b, fk, d0 + dw, v0, u1, v0 + H, 0.05, -0.05, 0.06, true);
  glassPane(b, 'glass_clear', d0 + dw + 0.06, v0 + 0.06, u1 - 0.06, v0 + H - 0.06, 0, null, null);
  doorUnit(b, { u0: d0, u1: d0 + dw, v0, v1: v0 + 2.3, R: -0.05, kind: 'glazed_double', open: o.open ?? 0, frameKey: fk, glassKey: 'glass_clear' });
  b.cbox(fk, d0, v0 + 2.3, -0.05, d0 + dw, v0 + H, 0.05, 0.005);
  b.pop();
  // side glass walls
  for (const u of [u0 + 0.03, u1 - 0.03]) {
    b.push(); b.translate(u, 0, 0); b.rotY(Math.PI / 2);
    frameRect(b, fk, -R, v0, -zi, v0 + H, 0.03, -0.03, 0.06, true);
    b.pop();
  }
  b.cbox(fk, u0, v0 + H, zi, u1, v0 + H + 0.12, -R, 0.008);
  if (o.mat !== false) b.box('mat_entrance', u0 + 0.1, v0 + 0.003, zi + 0.1, u1 - 0.1, v0 + 0.012, -R - 0.1, 4 | 1 | 2 | 16 | 32);
}

export { ROOM_KIND };
