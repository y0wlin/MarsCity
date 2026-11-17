// Shop row (商住楼): shopfronts on the street with storage + back doors behind, residential
// floors above reached from a separate street door → lobby (mailbox wall) → core. Continuous
// first-floor canopy band over the shops, or a real colonnade (檐廊: columns, soffit lights, drains;
// residential_plan.arcadeDepth), blank signage light boxes, awnings on some.
// Built on the residential plan (ground: 'shops') so upper floors keep real units and windows.

import { generateResidential, residentialMassing } from './residential.js';
import { facadeFrame } from '../kit/walls.js';
import { awning, canopyFlat } from '../kit/structure.js';
import { signPanel } from '../kit/facade.js';

function shopDressing(ctx, plan) {
  const b = ctx.b, st = ctx.style, inst = ctx.inst;
  const rng = ctx.sub(701);
  const f0 = plan.floors[0];
  for (const o of plan.allOpenings || []) {
    if (o.kind !== 'shop' || o.lobby || (o.room && o.room.kind !== 'shop')) continue;
    const arc = plan.arcade && plan.arcade.side === o.side ? plan.arcade.depth : 0;
    b.push(); facadeFrame(b, o.side, plan.w, plan.d, arc);
    const w = o.u1 - o.u0;
    // signage light box centred above the shopfront, under the band / canopy / arcade soffit line
    const sy = o.v1 + 0.12;
    const top = arc ? plan.floors[1].y - plan.slabT - 0.28 : f0.y + f0.h - 0.35;
    if (top - sy > 0.4) signPanel(b, (o.u0 + o.u1) / 2, sy, Math.min(w - 0.6, 4.2), Math.min(0.6, top - sy - 0.05), { z: 0.0 });
    if (arc) { b.pop(); continue; }   // the colonnade shelters the shopfront: no awning / canopy
    // awning on some shops when the living side is not the street (no deep band above)
    if (plan.liveSide !== o.side && rng.next() < 0.6) {
      const tint = [[0.86, 0.84, 0.78], [0.42, 0.55, 0.6], [0.7, 0.45, 0.35], [0.5, 0.58, 0.45]][Math.floor(rng.next() * 4)];
      b.withTint(tint, () => awning(b, { u0: o.u0 + 0.1, u1: o.u1 - 0.1, y: Math.min(top, o.v1 + 0.9), depth: 1.5, drop: 0.5 }));
    } else if (plan.liveSide !== o.side) {
      b.withTint(inst.bandTint, () => canopyFlat(b, { u0: o.u0 - 0.2, u1: o.u1 + 0.2, y: Math.min(top, o.v1 + 0.95), depth: 1.6, key: st.band, rods: true }));
    }
    b.pop();
  }
}

export default {
  name: 'shop_row',
  uses: ['shop_row'],
  generate(spec, lod, ctx) {
    const plan = generateResidential(spec, lod, ctx, { plan: { ground: 'shops' }, noFins: true });
    shopDressing(ctx, plan);
  },
  massing(spec, ctx) {
    const v = residentialMassing(spec, ctx, { ground: 'shops' });
    if (v[0]) v[0].shops = true;
    return v;
  },
};
