// 'mass' LOD: cheap massing + roof carrying far-facade shader attributes (≤ 2 ms per building).
//
// Volumes: [{ x0, x1, z0, z1, y0, y1, parapet?, floorH, groundH, bayW, garden?, roofColor?,
//             blank?: {front,right,back,left}, shops?: bool, flags?: int, uBase?: number,
//             round?: radius (n-gon prism centred at the volume centre, n = v.n || 24),
//             pitched?: {axis:'x'|'z', rise, color?},   // gable roof instead of parapet + flat roof
//             bands?: bool,                              // slab-edge lips at every storey (ZR bands)
//             soffit?: bool,                             // underside face at y0 (overhangs: arcades)
//             plant?: {x0,x1,z0,z1,h} }]
//   y0 = bottom (usually below ground), y1 = eave (top of the last storey), parapet added above.
//
// Far-facade vertex attributes on material 'mass_facade' (documented in kit/README.md):
//   uv        = (u, v): u = metres along the building perimeter, starting at the front-left
//               corner and running front → right → back → left (the same perimeter coordinate the
//               detailed LODs use for window bay ids); v = metres above the entrance level (y).
//   facade    = (floorH, bayW, styleId, groundH)
//   facadeId  = (hashHi16, hashLo16, eaveY, flags) flags: 1 blank (party wall / windowless volume:
//               emitted with bayW 0; flag 1 WITH a bay width = sky-garden storey band), 2 shopfront ground
//               floor, 4 balcony bands, 8 glazed ground floor; bits 4–6 = occupancy profile
//               (occupancy.profileOf(use)) for windowLitMinute(hash, floor, bay, minute, profile)
//   floor index at v: v < groundH ? 0 : 1 + floor((v - groundH) / floorH)   (v < eaveY)
//   bay index at u:   floor(u / bayW)
//   → occupancy.windowLit(hash, floor, bay, localHour) gives the same light as near windows.

import { STYLE_ID, roofSpec, roofFarColor } from './styles.js';

const SIDES = ['front', 'right', 'back', 'left'];

/**
 * Default massing for any spec: footprint box (rect / tower), L-shape (two boxes) or round (n-gon)
 * from below ground to the eave, roof colour from roofSpec (the near roof material).
 */
export function defaultMassing(s, ctx) {
  const w = s._w, d = s._d, gh = s._gh || Math.max(s._fh, 3.6), fh = s._fh;
  const eave = gh + (s._floors - 1) * fh;
  const y0 = Math.min(0, s._ground.min) - 0.5;
  const R = roofSpec(s, ctx?.style || {}, ctx?.inst);
  const base = { y0, y1: eave, parapet: R.kind === 'pitched' ? 0 : 1.0, floorH: fh, groundH: gh, bayW: 3.6, blank: s._shared, flags: ctx?.style?.bands ? 4 : 0, roofColor: roofFarColor(R), garden: R.kind === 'garden' };
  const fp = s.footprint || {};
  if (fp.shape === 'round') {
    const r = Math.min(w, d) / 2;
    return [{ ...base, x0: -r, x1: r, z0: -r, z1: r, round: r, n: Math.max(16, Math.round((2 * Math.PI * r) / 3)), blank: {} }];
  }
  if (fp.shape === 'L' && Array.isArray(fp.points) && fp.points.length === 6) {
    // urban.js L: notch at the back-right corner → front bar (full width) + back-left wing
    const xs = fp.points.map((p) => p[0]), zs = fp.points.map((p) => p[1]);
    const nx = Math.max(...xs.filter((x) => x < w / 2 - 1e-3)), nz = Math.min(...zs.filter((z) => z > -d / 2 + 1e-3));
    return [
      { ...base, x0: -w / 2, x1: w / 2, z0: nz, z1: d / 2, blank: { ...s._shared, back: false } },
      { ...base, x0: -w / 2, x1: nx, z0: -d / 2, z1: nz, blank: { ...s._shared, front: true }, uBase: 2 * w },
    ];
  }
  const v = { ...base, x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  if (R.kind === 'pitched') v.pitched = { axis: w >= d ? 'x' : 'z', rise: Math.tan(0.5) * Math.min(w, d) / 2, color: roofFarColor(R) };
  return [v];
}

/** Emit the mass LOD for a list of volumes into ctx.b. */
export function emitMass(ctx, vols) {
  const b = ctx.b, s = ctx.spec;
  const styleId = STYLE_ID[ctx.style?.id] ?? 0;
  const hhi = (s.hash >>> 16) & 0xffff, hlo = s.hash & 0xffff;
  const prof = (((s._profile | 0) & 7) << 4);
  for (const v of vols) {
    const top = v.y1 + (v.pitched ? 0 : (v.parapet ?? 1.0));
    const flagsBase = (v.shops ? 2 : 0) | (v.flags || 0) | prof;
    b.uvMode = 1;
    // ---- walls (rect: 4 sides; round: n-gon) with the perimeter u coordinate ----
    const ring = [];
    if (v.round) {
      const n = v.n || 24, cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2, r = v.round;
      const a0 = Math.PI / 2 + Math.PI / n;
      for (let k = 0; k <= n; k++) { const a = a0 - (k * 2 * Math.PI) / n; ring.push([cx + r * Math.cos(a), cz + r * Math.sin(a), 'front']); }
    } else {
      const c = [[v.x0, v.z1], [v.x1, v.z1], [v.x1, v.z0], [v.x0, v.z0], [v.x0, v.z1]];
      for (let i = 0; i <= 4; i++) ring.push([c[i][0], c[i][1], SIDES[i % 4]]);
    }
    let u = v.uBase || 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, az, side] = ring[i], [cx, cz] = ring[i + 1];
      const L = Math.hypot(cx - ax, cz - az);
      const blank = !v.round && v.blank && v.blank[side] ? 1 : 0;
      // blank walls (party walls, windowless volumes) carry bayW 0: flag 1 with a bay width marks a
      // sky-garden storey band (loftMass towers), drawn green by the far-facade shaders
      b.setExtra('facade', v.floorH, ((flagsBase | blank) & 1) ? 0 : (v.bayW || 3.6), styleId, v.groundH);
      b.setExtra('facadeId', hhi, hlo, v.y1, flagsBase | blank);
      b.quad('mass_facade', ax, v.y0, az, cx, v.y0, cz, cx, top, cz, ax, top, az, [u, v.y0, u + L, v.y0, u + L, top, u, top]);
      u += L;
    }
    b.uvMode = 0;
    // ---- underside of a volume that overhangs the one below (arcades, cantilevers) ----
    if (v.soffit && !v.round) { b.pushTint([0.78, 0.77, 0.74]); b.rectY('mass_roof', v.x0, v.z0, v.x1, v.z1, v.y0, -1); b.popTint(); }
    // ---- slab-edge lips at every storey (ZR bands read as shadow lines from afar) ----
    if (v.bands && (v.flags & 4)) {
      const nFl = Math.max(0, Math.round((v.y1 - v.groundH) / v.floorH));
      // round volumes: lips on a coarser ring (every other vertex) — they read as shadow lines only
      const lipR = v.round && ring.length > 17 ? ring.filter((_, i) => i % 2 === 0 || i === ring.length - 1) : ring;
      b.pushTint([0.93, 0.92, 0.89]);
      for (let k = 0; k <= nFl; k++) {
        const y = k === nFl ? v.y1 : v.groundH + k * v.floorH;
        if (y > v.y1 + 0.01) break;
        if (y < v.y0 + 0.5) continue;          // stacked volumes (set-backs / crowns): only their own storeys
        lipRing(b, lipR, v, y - 0.25, y + 0.12, k === nFl ? 0.45 : 0.7);
      }
      b.popTint();
    }
    // ---- roof ----
    if (v.pitched) {
      emitGable(b, v, v.pitched);
    } else {
      const t = 0.3;
      b.pushTint([0.8, 0.79, 0.76]);
      if (v.round) {
        const pts = ring.slice(0, -1).map((p) => [p[0], p[1]]);
        b.polyY('mass_roof', pts, [], top, 1);
      } else {
        b.box('mass_roof', v.x0, top - 0.06, v.z0, v.x1, top, v.z0 + t, 4);
        b.box('mass_roof', v.x0, top - 0.06, v.z1 - t, v.x1, top, v.z1, 4);
        b.box('mass_roof', v.x0, top - 0.06, v.z0 + t, v.x0 + t, top, v.z1 - t, 4);
        b.box('mass_roof', v.x1 - t, top - 0.06, v.z0 + t, v.x1, top, v.z1 - t, 4);
        b.rectZ('mass_roof', v.x0 + t, v.y1, v.x1 - t, top - 0.06, v.z0 + t, 1);
        b.rectZ('mass_roof', v.x0 + t, v.y1, v.x1 - t, top - 0.06, v.z1 - t, -1);
        b.rectX('mass_roof', v.z0 + t, v.y1, v.z1 - t, top - 0.06, v.x0 + t, 1);
        b.rectX('mass_roof', v.z0 + t, v.y1, v.z1 - t, top - 0.06, v.x1 - t, -1);
      }
      b.popTint();
      if (!v.round) {
        b.pushTint(v.roofColor || (v.garden ? [0.42, 0.55, 0.36] : [0.66, 0.66, 0.64]));
        b.rectY('mass_roof', v.x0 + t, v.z0 + t, v.x1 - t, v.z1 - t, v.y1, 1);
        b.popTint();
      } else if (v.garden) {
        const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2, r = v.round * 0.62;
        b.pushTint([0.36, 0.46, 0.3]);
        b.box('mass_roof', cx - r, top, cz - r * 0.3, cx + r, top + 0.6, cz + r * 0.9, 63 & ~8);
        b.popTint();
      }
    }
    if (v.plant) {
      const p = v.plant;
      b.pushTint([0.8, 0.8, 0.8]);
      b.box('mass_roof', p.x0, v.y1, p.z0, p.x1, v.y1 + p.h, p.z1, 63 & ~8);
      b.popTint();
    }
  }
  const last = vols[vols.length - 1];
  if (last) {
    b.anchors.roof = { y: last.y1, access: [0, last.y1, 0] };
    const gh = last.groundH, fh = last.floorH;
    const n = Math.max(1, Math.round((last.y1 - gh) / fh) + 1);
    b.anchors.floors = [];
    for (let i = 0; i < n; i++) b.anchors.floors.push({ level: i, y: i === 0 ? 0 : gh + (i - 1) * fh, height: i === 0 ? gh : fh });
  }
  const s0 = ctx.spec;
  b.anchors.entrances.push({ kind: 'main', side: 'front', pos: [0, 0, s0._d / 2 + 0.6], dir: [0, 0, 1], width: 1.8 });
}

/** Thin projecting ring (outer face + top + soffit) following the wall ring. */
function lipRing(b, ring, v, y0, y1, proj) {
  const n = ring.length - 1;
  // per-vertex outward miter offsets
  const off = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], q = ring[i], r = ring[(i + 1) % n];
    let ax = q[0] - p[0], az = q[1] - p[1]; let la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
    let bx = r[0] - q[0], bz = r[1] - q[1]; let lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
    let mx = -az - bz, mz = ax + bx; const lm = Math.hypot(mx, mz) || 1; mx /= lm; mz /= lm;   // outward = (−uz, ux)
    const k = 1 / Math.max(0.3, mx * -bz + mz * bx);
    off.push([q[0] + mx * proj * k, q[1] + mz * proj * k]);
  }
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[i + 1], A = off[i], C = off[(i + 1) % n];
    const blank = !v.round && v.blank && v.blank[a[2]];
    if (blank) continue;
    b.quad('mass_roof', A[0], y0, A[1], C[0], y0, C[1], C[0], y1, C[1], A[0], y1, A[1]);          // outer face
    b.quad('mass_roof', A[0], y1, A[1], C[0], y1, C[1], c[0], y1, c[1], a[0], y1, a[1]);          // top
    b.quad('mass_roof', a[0], y0, a[1], c[0], y0, c[1], C[0], y0, C[1], A[0], y0, A[1]);          // soffit
  }
}

/** Gable roof prism over a rect volume (ridge along axis), slopes + gable triangles. */
function emitGable(b, v, p) {
  const col = p.color || [0.75, 0.74, 0.72];
  const y = v.y1, rise = p.rise;
  b.pushTint(col);
  if (p.axis === 'x') {
    const zm = (v.z0 + v.z1) / 2, yr = y + rise, ov = 0.4;
    b.quad('mass_roof', v.x0 - 0.2, y - 0.2, v.z1 + ov, v.x1 + 0.2, y - 0.2, v.z1 + ov, v.x1 + 0.2, yr, zm, v.x0 - 0.2, yr, zm);
    b.quad('mass_roof', v.x1 + 0.2, y - 0.2, v.z0 - ov, v.x0 - 0.2, y - 0.2, v.z0 - ov, v.x0 - 0.2, yr, zm, v.x1 + 0.2, yr, zm);
    b.popTint(); b.pushTint([0.92, 0.91, 0.88]);
    b.triangle('mass_roof', v.x0, y, v.z0, v.x0, y, v.z1, v.x0, yr, zm);
    b.triangle('mass_roof', v.x1, y, v.z1, v.x1, y, v.z0, v.x1, yr, zm);
  } else {
    const xm = (v.x0 + v.x1) / 2, yr = y + rise, ov = 0.4;
    b.quad('mass_roof', v.x1 + ov, y - 0.2, v.z1 + 0.2, v.x1 + ov, y - 0.2, v.z0 - 0.2, xm, yr, v.z0 - 0.2, xm, yr, v.z1 + 0.2);
    b.quad('mass_roof', v.x0 - ov, y - 0.2, v.z0 - 0.2, v.x0 - ov, y - 0.2, v.z1 + 0.2, xm, yr, v.z1 + 0.2, xm, yr, v.z0 - 0.2);
    b.popTint(); b.pushTint([0.92, 0.91, 0.88]);
    b.triangle('mass_roof', v.x0, y, v.z1, v.x1, y, v.z1, xm, yr, v.z1);
    b.triangle('mass_roof', v.x1, y, v.z0, v.x0, y, v.z0, xm, yr, v.z0);
  }
  b.popTint();
}
