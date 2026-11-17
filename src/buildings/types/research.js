// Research & development building (研发楼), Zhurong family (owner: buildings-z). Z03-right glass volume
// sharing the office plan logic (types/office.js rectOffice): lobby + reception → lab floors (taller
// 4.2 m storeys, alternating closed labs and open write-up areas on the back zone) around the stair +
// lift core, café on the street corner, service door + yard at the back. Distinct from offices by
// deeper spandrels and mullions, white vertical sun fins on the east / west flanks, lab exhaust stacks
// and plant on the roof; half of the instances also carry the white S-curve fins of the street front.
// Podium towers are not generated for research (urban research parcels are 3–8 storey blocks).

import { rectOffice, rectMassing } from './office.js';

export default {
  name: 'research',
  uses: ['research'],
  generate(spec, lod, ctx) { rectOffice(ctx, { research: true }); },
  massing(spec, ctx) { return rectMassing(ctx, true); },
};
