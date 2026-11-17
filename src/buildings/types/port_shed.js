// Port transit shed (港口仓棚), Zhurong family (owner: buildings-z). Shares the shed generator of
// types/warehouse.js (portal frames, wall openings, docks, office annex, interior).
//
// Long-span portal-frame shed under a silver standing-seam barrel vault (crown roof light, glazed
// gable fans in the end walls). Quay side (spec.meta.quaySide, default front — the urban parcels face
// the shed front to the quay apron): wide at-grade sliding / sectional doors for forklifts and
// straddle carriers at the urban 'loading' offsets, a deep white cantilever canopy with downlights and
// a limited cyan edge strip, yellow door-frame guards; the port office annex (two storeys, strip
// windows, glazed entrance with steps + ramp) sits in the corner nearest the main entrance. Yard side:
// truck doors with a raised dock where the yard is low enough, apron with bay lines. High clerestory
// strips along both long walls, escape doors in the gable ends, blank shed-number light boxes high on
// the gables. 'full': concrete floor, crate / pallet blocks and containers in aisles, office mezzanine
// + stair, high-bay lights, colliders.

import * as K from '../kit/index.js';
import { clamp, lightBox } from './z_common.js';
import { shed, shedMassing } from './warehouse.js';
import { roofProfile } from './z_hall.js';

function quaySide(s) { const want = s._meta.quaySide || 'front'; return !s._shared[want] ? want : 'front'; }

/** Painted 7-segment shed number (two digits, h tall) centred at (u, y) on the wall plane z (current wall frame). */
function shedNumber(b, u, y, h, n, z) {
  const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
  const wd = h * 0.55, t = h * 0.12;
  const digit = (cx, dg) => {
    const m = SEG[dg % 10], x0 = cx - wd / 2, x1 = cx + wd / 2, y0 = y - h / 2, ym = y, y1 = y + h / 2;
    const H = (yy) => b.box('steel_dark', x0 + t * 0.6, yy - t / 2, z, x1 - t * 0.6, yy + t / 2, z + 0.012, 16 | 4 | 8);
    const V = (xx, a, c) => b.box('steel_dark', xx - t / 2, a + t * 0.6, z, xx + t / 2, c - t * 0.6, z + 0.008, 16 | 1 | 2);
    if (m & 1) H(y1 - t / 2); if (m & 64) H(ym); if (m & 8) H(y0 + t / 2);
    if (m & 2) V(x1 - t / 2, ym, y1); if (m & 4) V(x1 - t / 2, y0, ym); if (m & 16) V(x0 + t / 2, y0, ym); if (m & 32) V(x0 + t / 2, ym, y1);
  };
  digit(u - wd * 0.62, Math.floor(n / 10)); digit(u + wd * 0.62, n % 10);
}

export default {
  name: 'port_shed',
  uses: ['port_shed'],
  generate(spec, lod, ctx) {
    const s = ctx.spec, b = ctx.b;
    const quay = quaySide(s);
    const yard = quay === 'front' ? 'back' : quay === 'back' ? 'front' : quay === 'left' ? 'right' : 'left';
    const eave = clamp(+s.floorHeight || s._fh || 11, 6.5, 16);
    const L = shed(ctx, {
      dockSide: quay, raised: false, doorW: clamp(s._w / 16, 5.0, 6.5), doorH: clamp(eave - 3.2, 5.0, 7.5), roof: 'vault', port: true, gable: 'glass',
      wallKey: ctx.style.id === 'zr_cold' ? 'panel_insulated' : 'panel_white', canopyDepth: 7.0, apronDepth: 9,
      band: ctx.style.id === 'zr_cold' ? null : [0.16, 0.3, 0.52],          // port-blue base band (warehouses: neutral families)
      backDocks: { side: yard, raised: true, n: Math.max(1, Math.floor((yard === 'front' || yard === 'back' ? s._w : s._d) / 20)), apron: 16 },
    });
    // shed number painted large on both gable ends (7-segment, readable from the water) + a name light box below it;
    // yellow / black guard stripes on the quay door jambs; ventilators along the vault crown (port identity, qa-style)
    const num = 1 + ((s.hash >>> 7) % 48);
    for (const side of ['left', 'right']) {
      if (s._shared[side]) continue;
      b.push(); K.facadeFrame(b, side, s._w, s._d, 0);
      const hN = clamp(L.eave * 0.32, 2.4, 4.2);
      shedNumber(b, s._d * 0.5, L.ffl + L.eave - hN / 2 - 0.6, hN, num, 0.03);
      lightBox(b, s._d * 0.5, L.ffl + L.eave - hN - 2.2, Math.min(6, s._d * 0.18), 1.0, 0.16, { depth: 0.13, rows: 1, seed: s.hash });
      b.pop();
    }
    b.push(); K.facadeFrame(b, quay, s._w, s._d, 0);
    for (const u of L.docks) for (const sg of [-1, 1]) {
      const uj = u + sg * (L.doorW / 2 + 0.16);
      for (let k = 0; k < 6; k++) b.withTint(k % 2 ? [0.08, 0.08, 0.08] : [1, 1, 1], () => b.box(k % 2 ? 'steel_dark' : 'steel_yellow', uj - 0.14, L.ffl + k * 0.25, 0.03, uj + 0.14, L.ffl + (k + 1) * 0.25, 0.09, 1 | 2 | 4 | 16));
    }
    b.pop();
    const D = s._d, prof = roofProfile({ z0: -D / 2, z1: D / 2, y0: L.ffl, eave: L.eave, roof: { kind: 'vault', rise: Math.min(D * 0.14, 7) } });
    const zv = -(D * 0.09 + 1.3), yv = prof.y(zv);          // beside the crown roof light (|z| < 0.09 D)
    for (let x = -s._w / 2 + 6; x < s._w / 2 - 5; x += 12) {
      b.cylinder('aluminium', x, yv - 0.25, zv, 0.45, 1.25, 16, { top: false });
      b.cylinder('aluminium', x, yv + 1.0, zv, 0.62, 0.12, 16, { top: true, bottom: true });
    }
  },
  massing(spec, ctx) { return shedMassing(ctx, { roof: 'vault', dockSide: quaySide(ctx.spec), raised: false }); },
};
