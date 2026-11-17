// 泵房 — O-zone pump house (canal pump station / greenhouse feeder / utility pump hall). OWNER: buildings-o.
// Plan-first generator in o_pump.js: intake on the pool side (spec.meta.poolSide, default back) with trash
// racks + hoist, suction pipes low through the pool wall, crane-served equipment hall entered through the
// maintenance roller door (spec 'service' entrance) from a loading apron / turning area, raised control
// room over the pool, high windows above the pipe runs, louvred air intakes, roof extract fans.
// 'full' adds the control-room mezzanine, stair, switchgear room, workbench and colliders.
import { generatePump, pumpMassing } from './o_pump.js';

export default {
  name: 'pumphouse',
  uses: ['pumphouse'],
  generate(spec, lod, ctx) { generatePump(ctx, false); },
  massing(spec, ctx) { return pumpMassing(spec, ctx, false); },
};
