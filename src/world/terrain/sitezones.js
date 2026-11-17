// Pure site-zone helpers used by the lower world layers (no import of terrain modules, so every
// thread evaluates them identically regardless of which modules it loaded). OWNER: terrain-fn.
//   g01Coast(F, c)  coast metric override around the G01 harbour (designed bay shoreline blended
//                   into the natural fractal coast within 10.5..16.5 km of the barrier anchor)
//   inG02(x,y,z)    inside the G02 valley / canyon core (its own water system: no farm canals)
//   g02Farm(x,y,z)  G02 irrigation (fix round 2, QS-08): {plain: irrigation district on the farmland plain below
//                   the escarpment, fed by the G02-OUT spill channel; terrace: irrigated bench terraces on the
//                   benched left bank of the reservoirs below dams D1-D5} (0..1, geometric, no terrain)
import { SITES, unitToLocal, g01ToUV, g01ShoreV, g02Project, G02_AXIS, g02HalfWidth, g02Index, G02_DAMS } from '../sites.js';
import { smoothstep, makeNoise } from './noise.js';

const DEG = Math.PI / 180;
const unitOf = (s) => [Math.cos(s.lat * DEG) * Math.sin(s.lon * DEG), Math.sin(s.lat * DEG), Math.cos(s.lat * DEG) * Math.cos(s.lon * DEG)];
const G1 = SITES.tidalBarrier, G2 = SITES.waterStairs;
const C1 = unitOf(G1), C2 = unitOf(G2);
const LIM1 = Math.cos(18000 / 3389500), LIM2 = Math.cos(17000 / 3389500);
const NG = makeNoise(801);
const LOC = {}, UV = {}, PJ = {};
const R0 = 10500, R1 = 16500;

export function g01Coast(F, c) {
  if (F.x * C1[0] + F.y * C1[1] + F.z * C1[2] < LIM1) return c;
  unitToLocal(G1, F.x, F.y, F.z, LOC);
  const r = Math.hypot(LOC.x, LOC.z);
  if (r >= R1) return c;
  g01ToUV(LOC.x, LOC.z, UV);
  // designed shore with natural coves and small headlands (city waterfront rebuilds the rest)
  const irr = 150 * NG.n3(LOC.x / 1700, LOC.z / 1700, 1.3) + 60 * NG.n3(LOC.x / 620, LOC.z / 620, 4.1);
  const cs = (g01ShoreV(UV.u) - UV.v) * 0.95 + irr * smoothstep(-6500, -3000, UV.v);
  const w = 1 - smoothstep(R0, R1, r);
  return c + (cs - c) * w;
}

export function inG02(x, y, z) {
  if (x * C2[0] + y * C2[1] + z * C2[2] < LIM2) return false;
  unitToLocal(G2, x, y, z, LOC);
  if (Math.abs(LOC.x) > 22000 || Math.abs(LOC.z) > 22000) return false;
  g02Project(LOC.x, LOC.z, PJ);
  return PJ.dist < 3600 && PJ.s < G02_AXIS.len - 3000;
}

const GF = { plain: 0, terrace: 0 };
const SE = G02_DAMS[5] * 1000;
const G2D = (() => { const b = G2.heading * DEG; return [Math.sin(b), -Math.cos(b)]; })();   // downstream (x, z)
export function g02Farm(x, y, z) {
  GF.plain = 0; GF.terrace = 0;
  if (x * C2[0] + y * C2[1] + z * C2[2] < LIM_F) return GF;
  if (!unitToLocal(G2, x, y, z, LOC)) return GF;
  const lx = LOC.x, lz = LOC.z;
  // plain district: ellipse along the downstream direction starting at the escarpment foot below dam 6
  const along = lx * G2D[0] + lz * G2D[1], across = -lx * G2D[1] + lz * G2D[0];
  const rho = Math.hypot((along - 15000) / 15500, across / 12500);
  let plain = 1 - smoothstep(0.78, 1.05, rho);
  if (plain > 0 || (Math.abs(lx) < 22000 && Math.abs(lz) < 22000)) {
    g02Project(lx, lz, PJ);
    // not in the canyon above the last dam (its own water system)
    if (PJ.dist < 4200) plain *= smoothstep(SE - 200, SE + 1400, PJ.s);
    // bench terraces on the benched (left) bank of the reservoirs below dams D1-D5
    const i = g02Index(PJ.s);
    if (i >= 1 && i <= 5 && PJ.d < 0 && PJ.dist < 3000) {
      const w = g02HalfWidth(i, PJ.s, -1);
      const e = -PJ.d - w;
      const s0 = G02_DAMS[i - 1] * 1000, s1 = G02_DAMS[i] * 1000;
      const ends = smoothstep(s0 + 150, s0 + 600, PJ.s) * (1 - smoothstep(s1 - 500, s1 - 120, PJ.s));
      GF.terrace = smoothstep(32, 60, e) * (1 - smoothstep(360, 460, e)) * ends;
    }
  }
  GF.plain = plain;
  return GF;
}
const LIM_F = Math.cos(48000 / 3389500);
