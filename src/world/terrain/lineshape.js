// Shape helpers for the line features (canyons, gorges, troughs, rift walls) shared by field.js
// (masks), relief.js (carving) and hydro.js (river vectors). OWNER: terrain-fn agent.
// Pure, worker-safe, float64, no allocation.
//
//   noiseAtLam(N, X, Y, Z, lam, ox, oy, oz)  noise whose wavelength lam varies in space, WITHOUT
//       frequency modulation. Evaluating N(X / lam) directly is wrong at planetary coordinates
//       (|X| ~ 3.4e6 m): a 0.01 % change of lam scrolls the pattern by ~0.2 noise cells, so any lam
//       that follows a varying width draws pixel-scale streaks ("fur") and jumps wherever the width
//       parameter jumps. Instead the two fixed power-of-two octaves that bracket lam are blended
//       (variance-normalised), which is continuous in lam and position.
//   canyonOffset(hw, X, Y, Z)  lateral meander offset (m) of canyon / valley / rift centrelines.
import { makeNoise } from './noise.js';

const NE = makeNoise(404);
const L2 = new Float64Array(64);
for (let i = 0; i < 64; i++) L2[i] = 2 ** (i - 20);

export function noiseAtLam(N, X, Y, Z, lam, ox, oy, oz) {
  let k = Math.log2(lam);
  if (!(k > -19)) k = -19; else if (k > 42) k = 42;
  const k0 = Math.floor(k), f = k - k0;
  const w = f * f * (3 - 2 * f);
  const i0 = 1 / L2[k0 + 20], i1 = 0.5 * i0;
  // distinct offsets per octave index keep neighbouring octaves decorrelated
  const s0 = (k0 & 7) * 7.31, s1 = ((k0 + 1) & 7) * 7.31;
  let v = 0;
  if (w < 1) v += (1 - w) * N.n3(X * i0 + ox + s0, Y * i0 + oy, Z * i0 + oz - s0);
  if (w > 0) v += w * N.n3(X * i1 + ox + s1, Y * i1 + oy, Z * i1 + oz - s1);
  return v / Math.sqrt((1 - w) * (1 - w) + w * w);
}

/** lateral meander offset (m) of canyon / valley / rift centrelines (shared with river carving) */
export function canyonOffset(hw, X, Y, Z) {
  const lamM = Math.max(2500, 6 * hw);
  return 0.22 * hw * noiseAtLam(NE, X, Y, Z, lamM, 0, 3.3, 0) + 0.035 * hw * noiseAtLam(NE, X, Y, Z, lamM * 0.27, 0, 0, -1.1);
}
