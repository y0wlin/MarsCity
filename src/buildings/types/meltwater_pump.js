// 融水泵房 — OX4 meltwater pump hall on the ice-melt forebay. OWNER: buildings-o.
// Same plan logic as the pump house (o_pump.js) with the polar language: frost-white insulated panel
// shell (thick walls, deep reveals), intake chamber with racks + de-icing bubbler line on the melt pool
// (spec.meta.intakeSide, default back), heat-traced insulated pipes (aluminium jacket, trace boxes)
// towards the greenhouse distribution, recessed entrance behind an insulated vestibule (门斗) with warm
// light, snow tongues on the lee side, scoured windward base, snow cap on the roof.
import { generatePump, pumpMassing } from './o_pump.js';

export default {
  name: 'meltwater_pump',
  uses: ['meltwater_pump'],
  generate(spec, lod, ctx) { generatePump(ctx, true); },
  massing(spec, ctx) { return pumpMassing(spec, ctx, true); },
};
