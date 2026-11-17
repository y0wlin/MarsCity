// Natural landform composition (pure, worker-safe, float64). OWNER: terrain-fn agent.
//
// relief(F, mw, M) -> metres above sea level BEFORE water bodies (lakes, canals, rivers and the
// megastructure basins are carved by waterbodies.js on top). F comes from field.computeFields();
// M (optional, newMat()) accumulates geology hints for sampleTerrain.
//
// Orbit -> street:
//   continental base + dichotomy, province lowlands / plateaus, rolling hills (cities climb hills)
//   BEDROCK: eroded ridged multifractal (sharp connected crests, damped flanks) for mountain belts,
//     ranges, rift shoulders and the rugged highlands, on a warped domain
//   SEDIMENT FILL: basins and valleys between the ridges are filled up to a smooth level that rises
//     toward the ranges (bajadas / alluvial aprons); the smooth max of bedrock and fill makes the
//     concave talus foot and dendritic mountain fronts, and decides where bare rock is exposed
//   plateau escarpments (ZR3 high tableland, OX5 steps, O-zone red tablelands) + mesas / buttes,
//     shield volcano, ZR6 domes, OX6 inselbergs, OX4 knobs, lava wrinkle ridges
//   coast: beach / tidal flat / sea-cliff land profile, shelf, slope, basins, submarine canyons
//   line features: rift (graben, stepped walls, passes, landslides, box tributaries), stepped
//     canyons (ZR2 Z04), gorges (OX2), U troughs (ZR6); walls carry spur-and-gully relief
//   polar ice sheet (cliffs, crevasses, spiral troughs), craters at all scales
//   detail: erosion-damped fbm (smooth below ~150 m on built land), dunes and ripples in sand, strata
//   ledges on steep faces (absolute elevation layer cake), scree and boulders at cliff feet.
// Everything is band-limited by mw (octaves fade with bandW, crests soften) and continuous.

import { makeNoise, makeRotations, smoothstep, clamp, bandW, smin, smax, hash3, rehash, u01, lerp } from './noise.js';
import { LINE_DATA, lineParam, lineNormalSmooth, REGION_DATA, regionUV } from './layout.js';
import { craterField, fixedCraters } from './impact.js';
import { ox4Weight } from './field.js';
import { gullies, slopeReset, slopeTerm, slopeScale, ampTerm, ampTotal } from './gully.js';
import { canyonOffset, noiseAtLam } from './lineshape.js';
import { basinRelief, BR } from './basin.js';
import { R } from '../../core/constants.js';

const NB = makeNoise(401), ND = makeNoise(403), NE = makeNoise(404);
const NS = makeNoise(405), NP = makeNoise(406), NK = makeNoise(407), NT = makeNoise(408);
const NR = makeNoise(410), NW = makeNoise(411), NG = makeNoise(413);
const ROT = makeRotations(40, 409);
const ROTR = makeRotations(16, 412);
const G = new Float64Array(3);
const UV = new Float64Array(2);
const LN = new Float64Array(3);
const DEGR = Math.PI / 180;

export function newMat() {
  return {
    rock: 0, sand: 0, cliff: 0, strata: 0.5, strataW: 0, fresh: 0, floor: 0, park: 0, rim: 0, dune: 0, mesa: 0, lava: 0,
    iceCliff: 0, ice: 0, riverbed: 0, waterline: 0, wet: 0, beach: 0, seafloor: 0, trough: 0, scree: 0, talus: 0, slope: 0,
    crevasse: 0,
  };
}
export function resetMat(m) {
  m.rock = 0; m.sand = 0; m.cliff = 0; m.strata = 0.5; m.strataW = 0; m.fresh = 0; m.floor = 0; m.park = 0; m.rim = 0;
  m.dune = 0; m.mesa = 0; m.lava = 0; m.iceCliff = 0; m.ice = 0; m.riverbed = 0; m.waterline = 0; m.wet = 0; m.beach = 0;
  m.seafloor = 0; m.trough = 0; m.scree = 0; m.talus = 0; m.slope = 0; m.crevasse = 0;
}

// smoothstep derivative helper: value of d/dx smoothstep(a,b,x)
function dss(a, b, x) { if (x <= a || x >= b) return 0; const t = (x - a) / (b - a); return 6 * t * (1 - t) / (b - a); }

// stair profile: n flat benches with steep risers over s in [0,1]
function stairs(s, n, rf, soft) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  const f = s * n, i = Math.floor(f), fr = f - i;
  return (i + smoothstep(1 - rf - soft, 1 - soft * 0.3, fr)) / n;
}

// strata: terrace absolute elevations into layers of varying thickness ("layer cake").
// w must already include the steepness of the face (ledges, not contour terraces). sl = upper
// estimate of the face slope (m/m): the ledges repeat every tau / sl metres HORIZONTALLY, so the
// band limit uses that spacing (a vertical-only limit aliases into moiré "fur" on steep risers).
function strataTerrace(h, w, mw, M, sl) {
  const tau = 18;
  const psi = h / tau + 0.8 * NT.n3(h / 300, 0.5, 0.25) + 0.3 * NT.n3(h / 90, 1.5, 3.1);
  const i = Math.floor(psi), f = psi - i;
  if (M) M.strata = u01(hash3(i, 77, 13, 5));
  if (w <= 0) return 0;
  // ledge profile ~ half smooth riser, half tread: resolvable down to ~3 samples per spacing
  const bw = bandW(Math.min(tau * 1.5, (0.7 * tau) / (sl > 0.12 ? sl : 0.12)), mw);
  if (bw <= 0) return 0;
  const g = smoothstep(0.42, 0.92, f) * 0.9 + f * 0.1;
  return (g - f) * tau * w * bw;
}

// ---------------------------------------------------------------------------------------------
// bedrock: eroded ridged multifractal. Octaves 128 km .. 125 m on a warped domain; amplitude per
// octave = mountain spectrum (Am, red) + highland spectrum (Ah, peaks at 16-32 km). Crests are
// soft-abs creases (softened toward the band limit); flank detail is damped by the accumulated
// slope (erosion) and by the previous octave (multifractal: valleys stay smooth, ridges gain detail).
// Outputs RG.h (m >= 0), RG.low (octaves >= 64 km, for the sediment fill), RG.s2 (slope^2).
// ---------------------------------------------------------------------------------------------
const RG = { h: 0, low: 0, s2: 0 };
const NOCT_R = 5;
// per-octave spectra (128 km .. 8 km): mountain belts (big ranges first) and rugged highlands; the
// finer relief is carved by the gully filter (dendritic drainage) and the detail fbm
const WM = [0.56, 0.31, 0.17, 0.095, 0.052];
const WH = [0.08, 0.24, 0.46, 0.5, 0.4];
const OG = new Float64Array(NOCT_R * 5);   // per-octave gradient (m/m, ECEF), amplitude, curvature bound (1/m)
let OGN = 0;
// proper domain warp: three independent noise samples (a gradient field would compress features
// radially around its extrema and draw concentric rings)
const WQ = new Float64Array(3);
function warp3(Nz, X, Y, Z, lam, A, out) {
  const i = 1 / lam;
  out[0] = X + A * Nz.n3(X * i, Y * i, Z * i);
  out[1] = Y + A * Nz.n3(X * i + 31.7, Y * i - 7.3, Z * i + 2.1);
  out[2] = Z + A * Nz.n3(X * i - 13.1, Y * i + 19.9, Z * i - 5.7);
  return out;
}
// eroded ridged multifractal on a warped domain: sharp connected crests (soft-abs creases that soften
// toward the band limit); each octave's amplitude grows with the height reached so far, so valleys
// stay smooth and crests gain spurs
function ridged(x, y, z, X, Y, Z, mw, Am, Ah) {
  warp3(NW, X, Y, Z, 300000, 62000, WQ);
  const bwW = bandW(60000, mw);
  if (bwW > 0) warp3(NW, WQ[0], WQ[1], WQ[2], 60000, 8000 * bwW, WQ);
  const qx = WQ[0], qy = WQ[1], qz = WQ[2];
  let h = 0, low = 0, gx = 0, gy = 0, gz = 0, lam = 128000, ampSum = 0;
  OGN = 0;
  for (let k = 0; k < NOCT_R; k++) {
    const bw = bandW(lam, mw);
    if (bw <= 0) break;
    const a = Am * WM[k] + Ah * WH[k];
    const hn = ampSum > 0 ? 1.5 * h / ampSum : 1;
    const lift = k === 0 ? 1 : 0.3 + 0.7 * (hn > 1 ? 1 : hn);
    // octaves fade in over 1-3 cm of amplitude (a hard on/off threshold left cm steps in the height
    // and flipped the gully steering where a massif mask tapers out)
    const f0 = a * lift * bw;
    const f = f0 >= 0.03 ? f0 : f0 <= 0.01 ? 0 : f0 * smoothstep(0.01, 0.03, f0);
    if (f > 0) {
      const m = ROTR[k], il = 1 / lam;
      const px = (m[0] * qx + m[1] * qy + m[2] * qz) * il, py = (m[3] * qx + m[4] * qy + m[5] * qz) * il, pz = (m[6] * qx + m[7] * qy + m[8] * qz) * il;
      const v = NR.d3(px, py, pz, G);
      const e = 0.035 + 0.4 * (1 - bw);
      const av = Math.sqrt(v * v + e * e);
      const r1 = 1 - av;
      const r = r1 > 0 ? r1 * r1 : 0;
      h += f * r;
      if (k < 2) low += f * r;
      const dr = r1 > 0 ? -2 * r1 * (v / av) * il * f : 0;
      // world-space gradient (the warp's Jacobian is ignored: it is close to identity)
      const g0 = dr * (m[0] * G[0] + m[3] * G[1] + m[6] * G[2]), g1 = dr * (m[1] * G[0] + m[4] * G[1] + m[7] * G[2]), g2 = dr * (m[2] * G[0] + m[5] * G[1] + m[8] * G[2]);
      gx += g0; gy += g1; gz += g2;
      // gully STEERING uses the gradient of a softened crease (e >= 0.22): the exact crease flips the slope
      // direction within ~1 % of the octave wavelength, which the gully kernels' lever arm turned into 80 m
      // cliffs 10-15 m wide (Z-03). Curvature bound of that gradient for the gully band limit.
      const es = e > 0.22 ? e : 0.22, avs = Math.sqrt(v * v + es * es), r1s = 1 - avs;
      const qs = v / avs, r1c = r1s > 0 ? r1s : 0;
      const drs = r1s > 0 ? -2 * r1s * qs * il * f : 0;
      const Gn = Math.sqrt(G[0] * G[0] + G[1] * G[1] + G[2] * G[2]);
      const kap = 2 * il * il * f * Gn * (Gn * (qs * qs + r1c * es * es / (avs * avs * avs)) + 3 * r1c * Math.abs(qs));
      const ks = dr !== 0 ? drs / dr : 0;
      const o = OGN * 5; OG[o] = dr !== 0 ? g0 * ks : 0; OG[o + 1] = dr !== 0 ? g1 * ks : 0; OG[o + 2] = dr !== 0 ? g2 * ks : 0; OG[o + 3] = f; OG[o + 4] = kap; OGN++;
    } else { const o = OGN * 5; OG[o] = 0; OG[o + 1] = 0; OG[o + 2] = 0; OG[o + 3] = 0; OG[o + 4] = 0; OGN++; }
    ampSum += a * bw;
    lam *= 0.5;
  }
  const gn = gx * x + gy * y + gz * z;
  RG.h = h; RG.low = low; RG.s2 = gx * gx + gy * gy + gz * gz - gn * gn;
  return h;
}

// rock detail: erosion-damped fbm (large) + plain fine octaves; smoothK damps < ~150 m (built land)
function detail(X, Y, Z, mw, rough, smoothK, lam0, bigK = 0, floorK = 0) {
  let h = 0, lam = lam0, dx = 0, dy = 0, dz = 0;
  for (let k = 0; k < 22; k++) {
    const bw = bandW(lam, mw);
    if (bw <= 0) break;
    let a = 0.026 * Math.pow(lam, 0.88) * rough;
    if (smoothK > 0) {
      const s = lam < 150 ? 1 : lam < 800 ? (800 - lam) / 650 : 0;
      a *= 1 - smoothK * (0.1 + 0.88 * s);
    }
    // designed landforms (OX1 basin floor / lake): no large natural undulation over the designed shoreline
    if (bigK > 0 && lam > 1500) a *= 1 - bigK * smoothstep(1500, 3000, lam);
    // canyon / valley floors (ZR2 river reach): flat alluvial floor, the river never runs on a levee above it
    if (floorK > 0 && lam > 120) a *= 1 - 0.92 * floorK * smoothstep(120, 450, lam);
    if (a > 0.0008) {
      const m = ROT[k], il = 1 / lam;
      const px = (m[0] * X + m[1] * Y + m[2] * Z) * il, py = (m[3] * X + m[4] * Y + m[5] * Z) * il, pz = (m[6] * X + m[7] * Y + m[8] * Z) * il;
      if (lam >= 100) {
        // erosion damping by the accumulated (normalised) gradient of the coarser detail octaves
        const n = ND.d3(px, py, pz, G);
        h += a * bw * n / (1 + 0.5 * (dx * dx + dy * dy + dz * dz));
        dx += 0.25 * G[0]; dy += 0.25 * G[1]; dz += 0.25 * G[2];
      } else {
        h += a * bw * ND.n3(px, py, pz);
      }
    }
    lam *= 0.5;
    if (lam < 0.3) break;
  }
  return h;
}

// transverse dunes: asymmetric crests (gentle stoss, steep lee) perpendicular to one of three
// fixed wind axes, sinuous and broken by noise; blended by tangential strength of each axis
const WAX = [[0.8, 0.1, 0.59], [-0.3, 0.92, 0.25], [0.45, -0.38, 0.81]];
for (const a of WAX) { const l = Math.hypot(a[0], a[1], a[2]); a[0] /= l; a[1] /= l; a[2] /= l; }
const SEL = new Float64Array(3);
function dunes(x, y, z, X, Y, Z, mw, lam, amp) {
  // asymmetric profile: the lee face is only 22 % of the period, so fade on that scale (no aliasing)
  const bwl = bandW(lam * 0.45, mw);
  if (bwl <= 0) return 0;
  let b1 = -1, w1 = 0, b2 = -1, w2 = 0;
  for (let i = 0; i < 3; i++) {
    const a = WAX[i];
    const dn = a[0] * x + a[1] * y + a[2] * z;
    let wt = 1 - dn * dn; wt *= wt; wt *= wt;
    const sel = 0.5 + 0.5 * SEL[i];
    wt *= sel * sel;
    if (wt > w1) { b2 = b1; w2 = w1; b1 = i; w1 = wt; } else if (wt > w2) { b2 = i; w2 = wt; }
  }
  let h = 0, ws = 0;
  for (let j = 0; j < 2; j++) {
    const i = j === 0 ? b1 : b2;
    let wt = j === 0 ? w1 : w2;
    if (i < 0) continue;
    // the secondary axis fades out smoothly instead of being cut (continuity)
    if (j === 1) { wt *= smoothstep(0.03, 0.12, wt / (w1 || 1)); if (wt <= 0) continue; }
    const a = WAX[i];
    const il = 1 / lam;
    const warp = 0.9 * NK.n3(X * il * 0.25 + i * 5, Y * il * 0.25, Z * il * 0.25) + 0.3 * NK.n3(X * il * 0.9, Y * il * 0.9 + i, Z * il * 0.9);
    const ph = (a[0] * X + a[1] * Y + a[2] * Z) * il + warp;
    const f = ph - Math.floor(ph);
    const e = Math.min(0.35, 0.08 + (2 * mw) / lam);
    let p = f < 0.78 ? f / 0.78 : (1 - f) / 0.22;
    p = p * p * (3 - 2 * p);
    p = Math.pow(p, 1 + e);
    const brk = smoothstep(-0.35, 0.25, NK.n3(X * il * 0.5 - 2.2, Y * il * 0.5, Z * il * 0.5 + i));
    h += wt * p * (0.35 + 0.65 * brk); ws += wt;
  }
  return ws > 0 ? (h / ws) * amp * bwl : 0;
}

// lateral meander offset of the line centrelines: lineshape.js (re-exported for hydro.js)
export { canyonOffset };

// spur-and-gully modulation of a wall: returns a lateral shift (m) of the wall position; ridged so
// that gullies are narrow notches and spurs broad buttresses. lam ~ wall height scale (it follows
// the local wall width, so the noise must not be evaluated at X / lam directly: noiseAtLam).
function wallGully(X, Y, Z, lam, mw) {
  const bw = bandW(lam, mw);
  if (bw <= 0) return 0;
  const v = noiseAtLam(NG, X, Y, Z, lam, 0, 1.7, 0);
  let g = 1 - Math.abs(v); g = g * g * g;
  let s = g;
  const bw2 = bandW(lam * 0.4, mw);
  if (bw2 > 0) { const v2 = noiseAtLam(NG, X, Y, Z, lam / 2.6, -3.1, 0, 0); const g2 = 1 - Math.abs(v2); s += 0.45 * g2 * g2 * g2 * bw2; }
  return s * bw;
}

const CR = { fresh: 0, wall: 0, floor: 0, rim: 0, park: 0 };
const GO = { trough: 0, crest: 0 };
const ZR3 = REGION_DATA.zr3Plateau;

// =============================================================================================
export function relief(F, mw, M) {
  const x = F.x, y = F.y, z = F.z;
  const X = F.X, Y = F.Y, Z = F.Z;
  const c = F.c;
  const urban = F.urban;
  const built = Math.max(urban, F.farmBase * 0.9);     // graded ground (large-scale suppression)
  const nh = F.nh;
  slopeReset();
  let ex = z, ez = -x; { const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el; }
  const nx = y * ez, ny = z * ex - x * ez, nz = -y * ex;

  // ======================================================== 1. continental base
  let B = 760 + 1250 * F.wSouth - 380 * F.wNorth;
  B += 640 * (0.62 * NB.n3(X / 3.2e6, Y / 3.2e6, Z / 3.2e6) + 0.27 * NB.n3(X / 1.45e6 + 3.1, Y / 1.45e6, Z / 1.45e6) + 0.11 * NB.n3(X / 6.4e5, Y / 6.4e5 - 2.3, Z / 6.4e5));
  B += 900 * F.wZR2 + 1050 * F.wZR6 + 420 * F.wOX2 + 650 * F.wH1;
  B = lerp(B, 110, 0.9 * F.wOX1);
  B = lerp(B, 40, 0.9 * F.wOX3);
  B = lerp(B, 300, 0.78 * F.wOX4);
  B = lerp(B, 720, 0.75 * F.wOX6);
  B = lerp(B, 170, 0.82 * F.wOX5);
  B = lerp(B, 60, F.wArch);
  B = lerp(B, 260, 0.6 * F.wZR5);
  if (B < 35) B = 35;

  let h, T = B;
  let rockW = 0, strataW = 0, cliffW = 0, mesaAll = 0, talusW = 0, slope2 = 0;
  // strataSl: upper estimate of the slope (m/m) of the faces that carry strata ledges (band limit)
  let strataSl = 0;
  const land = c > 0;
  const fadeBig = smoothstep(0, 30000, c), fadeMid = smoothstep(0, 3000, c), fadeSmall = smoothstep(0, 220, c);
  // OX4 outwash apron: smooth ground within ~2 km of the ice cliffs (meltwater channel, forebay pools,
  // pump stations and greenhouses at the cliff foot; icefoot.js). Damps hills, bedrock relief, knobs.
  const apron = F.wOX4 > 0 && F.iceQ > -2.6 ? 0.88 * F.wOX4 * smoothstep(-2.6, -0.8, F.iceQ) : 0;
  const keepA = 1 - apron;

  if (land) {
    // ==================================================== 2. rolling hills (cities climb hills)
    {
      let i1 = 1 / 42000;
      let v = NB.n3(X * i1 + 1.7, Y * i1, Z * i1); let a = (70 + 50 * built) * fadeBig;
      T += a * v;
      i1 = 1 / 11000; a = (30 + 66 * built) * fadeBig * (1 - 0.6 * apron);
      v = NB.n3(X * i1, Y * i1 - 5.5, Z * i1); T += a * v;
      const b3 = bandW(4200, mw);
      if (b3 > 0) { i1 = 1 / 4200; a = (11 + 28 * built) * fadeMid * b3 * keepA; v = NB.n3(X * i1 + 9.1, Y * i1, Z * i1); T += a * v; }
      const b4 = bandW(1600, mw);
      if (b4 > 0) { i1 = 1 / 1600; a = (4 + 11 * built) * fadeMid * b4 * keepA; v = NB.n3(X * i1, Y * i1 + 3.7, Z * i1); T += a * v; }
    }

    // ==================================================== 3. bedrock relief + sediment fill
    {
      const mount = F.mount;
      const mm = mount > 0 ? Math.pow(mount, 1.15) : 0;
      const Am = (mm > 0 ? (F.rangeM > 0.05 ? Math.max(3600, 1.25 * F.rangeH) : 3600 + 1200 * F.wH1) * mm : 0) * keepA;
      const Ah = 900 * F.rough * (1 - mount) * keepA;
      if (Am + Ah > 0.5) {
        ridged(x, y, z, X, Y, Z, mw, Am, Ah);
        const k0 = smoothstep(0.5, 6, Am + Ah);                       // continuity at the early-out
        const hRock = RG.h * fadeBig * k0;
        // sediment fill: rises toward the ranges (aprons) but never reaches the crests
        const fill = (0.42 * RG.low + 0.05 * Am + 0.12 * Ah + 6) * fadeBig * k0;
        const kf = 18 + 0.03 * (Am + Ah);
        const top = smax(hRock, fill, kf);
        T += top;
        const exR = hRock - fill;
        const expo = smoothstep(-0.15 * kf, 0.6 * kf, exR);
        // the drainage of exposed bedrock steers and feeds the gully filter; buried valleys only
        // keep the gentle slope of the fill
        const ks = (0.42 + 0.58 * expo) * fadeBig * k0;
        let lamO = 128000;
        for (let o = 0; o < OGN; o++, lamO *= 0.5) {
          const q = o * 5;
          if (OG[q + 3] <= 0) continue;
          slopeTerm(lamO, ks, OG[q], OG[q + 1], OG[q + 2], ks * OG[q + 4]);
          ampTerm(lamO, 0.2 * OG[q + 3] * expo * fadeBig * k0);
        }
        const steep = smoothstep(0.06, 0.5, RG.s2);
        rockW = Math.max(rockW, expo * (0.55 + 0.45 * smoothstep(0.004, 0.08, RG.s2)) * smoothstep(0, 30, Am + Ah) * fadeMid);
        talusW = Math.max(talusW, (1 - Math.abs(exR) / (kf + 1)) * expo * 0.8);
        cliffW = Math.max(cliffW, steep * expo);
        const swB = smoothstep(0.35, 1.2, RG.s2) * expo * 0.35;
        if (swB > 0.02) { strataW = Math.max(strataW, swB); strataSl = Math.max(strataSl, 1.6 * Math.sqrt(RG.s2)); }
        slope2 = RG.s2 * expo;
      }
    }

    // ==================================================== 4. regional landforms
    // ---- ZR3 中陆高原: high tableland, escarpment with re-entrants, wind gaps between towns
    if (F.wZR3 > 0) {
      regionUV(ZR3, x, y, z, UV);
      const du = UV[0] / ZR3.a, dv = UV[1] / ZR3.b;
      const rd = Math.sqrt(du * du + dv * dv) + 1e-9;
      const kx = du / (ZR3.a * rd), ky = dv / (ZR3.b * rd);
      let e = (1 - rd) * 650000;
      let gex = -650000 * (kx * ZR3.ax[0] + ky * ZR3.ay[0]), gey = -650000 * (kx * ZR3.ax[1] + ky * ZR3.ay[1]), gez = -650000 * (kx * ZR3.ax[2] + ky * ZR3.ay[2]);
      const ia = 1 / 130000, ib = 1 / 33000;
      let n = NP.d3(X * ia, Y * ia, Z * ia, G); e += 32000 * n; gex += 32000 * G[0] * ia; gey += 32000 * G[1] * ia; gez += 32000 * G[2] * ia;
      n = NP.d3(X * ib + 2, Y * ib, Z * ib, G); e += 9000 * n; gex += 9000 * G[0] * ib; gey += 9000 * G[1] * ib; gez += 9000 * G[2] * ib;
      let lam = 8500, a = 2400;
      for (let k = 0; k < 6; k++) { const bw = bandW(lam, mw); if (bw <= 0) break; e += a * bw * NP.n3(X / lam - k, Y / lam, Z / lam + k); lam *= 0.45; a *= 0.45; }
      const rc = 1 - Math.abs(NP.n3(X / 52000 + 5, Y / 52000, Z / 52000));
      e -= 12000 * Math.pow(rc, 5) * smoothstep(60000, 0, Math.abs(e));     // re-entrant canyons
      const W = 3600;
      const t = (e + W) / (2 * W);
      const wz = smoothstep(0, 0.35, F.wZR3);
      if (t > 0) {
        const esc = t >= 1 ? 1 : 0.2 * smoothstep(0, 0.55, t) + 0.8 * smoothstep(0.5, 0.96, t);
        let top = 1550 + 240 * NP.n3(X / 240000, Y / 240000 + 9, Z / 240000);
        const gw = 1 - Math.abs(NP.n3(X / 260000 + 1.7, Y / 260000, Z / 260000 - 4));
        top -= 460 * Math.pow(gw, 7) * smoothstep(0, 40000, e);           // wind gaps (风口) / grassy saddles
        T += top * esc * fadeBig * wz;
        const desc = t >= 1 ? 0 : (0.2 * dss(0, 0.55, t) + 0.8 * dss(0.5, 0.96, t)) / (2 * W);
        slopeTerm(4 * W, top * desc * fadeBig * wz, gex, gey, gez);
        const face = (1 - Math.abs(2 * esc - 1)) * wz;
        ampTerm(4 * W, 0.12 * top * face);
        const steep = smoothstep(0.45, 0.6, t) * (1 - smoothstep(0.95, 1, t)) * wz;
        strataW = Math.max(strataW, steep); cliffW = Math.max(cliffW, steep); rockW = Math.max(rockW, face * 0.95);
        // escarpment slope: riser profile x |grad e| (the lateral fbm roughly doubles it)
        if (steep > 0.02) strataSl = Math.max(strataSl, 2.2 * top * Math.max(desc, (0.8 * 1.5 / 0.46) / (2 * W)));
      }
      if (e < 0 && e > -40000) {                                          // mesa outliers
        const mn = NP.n3(X / 9500 + 3.3, Y / 9500, Z / 9500) * 0.7 + NP.n3(X / 3100, Y / 3100 + 1.9, Z / 3100) * 0.3;
        const thr = 0.42 + 0.25 * smoothstep(-5000, -40000, e);
        // cliff band >= ~1.5 mw wide (|grad mn| ~ 2.5e-4 /m): no aliased 1100 m walls on coarse tiles
        const me = smoothstep(thr, thr + Math.max(0.05, 4e-4 * mw), mn) * bandW(1600, mw) * smoothstep(0, -2500, e) * smoothstep(-40000, -30000, e) * wz;
        if (me > 0) { T += 1100 * me * fadeBig; mesaAll = Math.max(mesaAll, me); const sd = me * (1 - me) * 4; strataW = Math.max(strataW, sd); rockW = Math.max(rockW, me); cliffW = Math.max(cliffW, sd); if (sd > 0.02) strataSl = Math.max(strataSl, 10); }
      }
    }

    // ---- OX5 南台地: stepped tableland parallel to the west-sea coast; mesas and buttes in front
    if (F.wOX5 > 0) {
      const ck = F.coastKm * 1000;
      const gcx = F.cge * ex + F.cgn * nx, gcy = F.cgn * ny, gcz = F.cge * ez + F.cgn * nz;
      const g02k = g02NoiseFade(x, y, z);
      let add = 0;
      for (let i = 0; i < OX5_STEPS.length; i++) {
        const E = OX5_STEPS[i][0], H = OX5_STEPS[i][1];
        let s = ck - E;
        if (s < -70000) continue;
        if (s > 70000) { add += H; continue; }
        let gsx = gcx, gsy = gcy, gsz = gcz;
        const ia = 1 / 76000, ib = 1 / 20000;
        let n = NP.d3(X * ia + i * 3, Y * ia, Z * ia, G); s += 17000 * n * g02k; gsx += 17000 * G[0] * ia * g02k; gsy += 17000 * G[1] * ia * g02k; gsz += 17000 * G[2] * ia * g02k;
        n = NP.d3(X * ib, Y * ib + i, Z * ib, G); s += 5000 * n * g02k; gsx += 5000 * G[0] * ib * g02k; gsy += 5000 * G[1] * ib * g02k; gsz += 5000 * G[2] * ib * g02k;
        let lam = 4800, a = 1250;
        for (let k = 0; k < 6; k++) { const bw = bandW(lam, mw); if (bw <= 0) break; s += a * bw * NP.n3(X / lam + i, Y / lam - k, Z / lam) * (0.35 + 0.65 * g02k); lam *= 0.45; a *= 0.45; }
        const Wd = 520;
        const t = (s + Wd) / (2 * Wd);
        let st = t <= 0 ? 0 : t >= 1 ? 1 : 0.15 * smoothstep(0, 0.6, t) + 0.85 * smoothstep(0.45, 0.97, t);
        if (t > 0 && t < 1) slopeTerm(4 * Wd, H * (0.15 * dss(0, 0.6, t) + 0.85 * dss(0.45, 0.97, t)) / (2 * Wd) * F.wOX5 * fadeBig, gsx, gsy, gsz);
        let isMesa = false;
        if (s < 0 && s > -36000) {                                    // mesas & buttes (R1 / G02)
          const mn = NP.n3(X / 8500 + i * 11, Y / 8500, Z / 8500) * 0.68 + NP.n3(X / 2700, Y / 2700 + i * 5, Z / 2700) * 0.32;
          const thr = 0.36 + 0.3 * smoothstep(-4000, -36000, s);
          const me = smoothstep(thr, thr + Math.max(0.04, 4.5e-4 * mw), mn) * bandW(1400, mw) * smoothstep(0, -1600, s) * smoothstep(-36000, -28000, s) * g02k;
          if (me > st) { st = me; mesaAll = Math.max(mesaAll, me); isMesa = true; }
        }
        add += H * st;
        const face = 1 - Math.abs(2 * st - 1);
        const steep = t > 0.45 && t < 1 ? smoothstep(0.45, 0.55, t) * (1 - smoothstep(0.95, 1, t)) : face * face;
        strataW = Math.max(strataW, steep * F.wOX5); cliffW = Math.max(cliffW, steep * F.wOX5); rockW = Math.max(rockW, face * F.wOX5);
        if (steep * F.wOX5 > 0.02) strataSl = Math.max(strataSl, isMesa ? 6 : (H * 2.5) / Wd);
        ampTerm(4 * Wd, 0.12 * H * face * F.wOX5);
      }
      T += add * F.wOX5 * fadeBig;
    }

    // ---- O-zone red tablelands (R1 赤岩台地): flat-topped plateaus between the farmland basins
    const tab = F.zoneO * (1 - F.oBasin) * (1 - F.wOX5) * (1 - F.ice) * (1 - 0.8 * F.wOX6);
    if (tab > 0.01) {
      const ia = 1 / 60000, ib = 1 / 16000;
      let e = NP.d3(X * ia - 2.9, Y * ia, Z * ia, G); let gx = G[0] * ia, gy = G[1] * ia, gz = G[2] * ia;
      const e2 = NP.d3(X * ib, Y * ib + 6.6, Z * ib, G); e = 0.75 * e + 0.25 * e2; gx = 0.75 * gx + 0.25 * G[0] * ib; gy = 0.75 * gy + 0.25 * G[1] * ib; gz = 0.75 * gz + 0.25 * G[2] * ib;
      let lam = 4000, a = 0.05;
      for (let k = 0; k < 5; k++) { const bw = bandW(lam, mw); if (bw <= 0) break; e += a * bw * NP.n3(X / lam + 4 * k, Y / lam, Z / lam); lam *= 0.45; a *= 0.5; }
      const thr = 0.62 - 0.85 * tab;
      const W = 0.022;
      const t = (e - thr + W) / (2 * W);
      if (t > 0) {
        const H = 180 + 170 * (0.5 + 0.5 * NP.n3(X / 200000, Y / 200000, Z / 200000 + 3));
        const st = t >= 1 ? 1 : 0.18 * smoothstep(0, 0.6, t) + 0.82 * smoothstep(0.42, 0.97, t);
        T += H * st * tab * fadeBig;
        if (t < 1) slopeTerm(4600, H * (0.18 * dss(0, 0.6, t) + 0.82 * dss(0.42, 0.97, t)) / (2 * W) * tab * fadeBig, gx, gy, gz);
        const face = 1 - Math.abs(2 * st - 1);
        ampTerm(4600, 0.1 * H * face * tab);
        const steep = t < 1 ? smoothstep(0.42, 0.55, t) * (1 - smoothstep(0.95, 1, t)) : 0;
        strataW = Math.max(strataW, steep * tab); cliffW = Math.max(cliffW, steep * tab); rockW = Math.max(rockW, (0.55 * st + 0.45 * face) * tab);
        // riser slope: profile peak / (2W) x |grad e| (2-octave analytic gradient + the fbm detail)
        if (steep * tab > 0.02) strataSl = Math.max(strataSl, H * (0.82 * 1.5 / 0.55) / (2 * W) * (Math.hypot(gx, gy, gz) + 1.6e-4));
        mesaAll = Math.max(mesaAll, st * tab * 0.7);
      }
    }

    // ---- shield volcano 赤冕 (orbital landmark): basal escarpment, caldera, radial flows
    if (F.wVolc && F.volcR < 1.9) {
      const rho = F.volcR;
      let v = 0;
      if (rho < 1) {
        v = 9200 * Math.pow(1 - rho * rho, 1.5);
        v += 1900 * smoothstep(1.0, 0.95, rho);
        const cal = smoothstep(0.12, 0.085, rho);
        v -= 2400 * cal;
        v -= 600 * smoothstep(0.06, 0.045, Math.abs(rho - 0.05));
        const lv = 1 - Math.abs(NP.n3(X / 24000, Y / 24000 + 3, Z / 24000));
        v += 200 * Math.pow(lv, 3) * (1 - cal);
        rockW = Math.max(rockW, smoothstep(1.0, 0.93, rho) * smoothstep(0.9, 1.0, rho) + cal);
        const esc = smoothstep(1.0, 0.95, rho) * smoothstep(0.92, 0.985, rho);
        cliffW = Math.max(cliffW, esc + cal * (1 - cal) * 4);
        strataW = Math.max(strataW, esc);
        if (esc > 0.02) strataSl = Math.max(strataSl, 0.7);
        const rdv = REGION_DATA.volcano;
        regionUV(rdv, x, y, z, UV);
        const rr = Math.hypot(UV[0], UV[1]) + 1;
        const slope = 9200 * 1.5 * Math.sqrt(Math.max(1e-6, 1 - rho * rho)) * 2 * rho / rdv.a;
        slopeTerm(300000, -slope * fadeBig, (UV[0] * rdv.ax[0] + UV[1] * rdv.ay[0]) / rr, (UV[0] * rdv.ax[1] + UV[1] * rdv.ay[1]) / rr, (UV[0] * rdv.ax[2] + UV[1] * rdv.ay[2]) / rr);
        ampTerm(300000, 300 * (1 - cal));
      } else {
        v = 280 * Math.pow(1 - (rho - 1) / 0.9, 2) * (0.6 + 0.4 * NP.n3(X / 40000, Y / 40000, Z / 40000 + 2));
      }
      T += v * fadeBig;
      if (M) M.lava = Math.max(M.lava, smoothstep(1.9, 1.0, rho));
    }

    // ---- ZR6 穹: rounded domes between the sunny troughs
    if (F.wZR6 > 0) {
      const dm = NP.n3(X / 26000 + 2, Y / 26000, Z / 26000 - 7);
      if (dm > 0) T += 440 * F.wZR6 * fadeBig * dm * dm;
    }
    // ---- OX6 霜原: frost plains with rock islands (inselbergs)
    if (F.wOX6 > 0) {
      const kn = NP.n3(X / 15000 + 8, Y / 15000, Z / 15000) * 0.65 + NP.n3(X / 4800, Y / 4800, Z / 4800 + 3) * 0.35;
      const isl = smoothstep(0.44, 0.78, kn);
      if (isl > 0) {
        const top = 120 + 260 * (0.5 + 0.5 * NP.n3(X / 30000, Y / 30000 + 1, Z / 30000));
        const dome = isl * isl * (3 - 2 * isl);
        T += top * Math.pow(dome, 1.5) * F.wOX6 * fadeMid;
        rockW = Math.max(rockW, isl * F.wOX6);
        const sd = (1 - Math.abs(2 * isl - 1)) * F.wOX6;
        cliffW = Math.max(cliffW, sd * 0.7); strataW = Math.max(strataW, sd * 0.5);
        if (sd > 0.04) strataSl = Math.max(strataSl, 1.2);
      }
    }
    // ---- OX4: proglacial rock knobs (O03: red-brown outcrops between meltwater channels)
    if (F.wOX4 > 0 && F.iceQ < 0.6) {
      const kn = NP.n3(X / 7000 - 4, Y / 7000, Z / 7000) * 0.6 + NP.n3(X / 2200, Y / 2200 + 6, Z / 2200) * 0.4;
      const kb = smoothstep(0.38, 0.62, kn);
      if (kb > 0) {
        // none on the outwash apron in front of the ice cliffs (q > -1.8 km): the meltwater channel / pools
        // and the pump stations sit on smooth ground at the cliff foot
        T += (70 + 110 * kb) * kb * F.wOX4 * fadeMid * smoothstep(-0.5, -1.8, F.iceQ);
        rockW = Math.max(rockW, kb * F.wOX4);
        cliffW = Math.max(cliffW, kb * (1 - kb) * 2 * F.wOX4);
      }
    }
    // ---- basalt plains: wrinkle ridges + gentle flow fronts
    if (F.wLava > 0) {
      const wr = 1 - Math.abs(NP.n3(X / 70000 + 3.3, Y / 70000, Z / 70000 - 1.2) + 0.25 * NP.n3(X / 17000, Y / 17000, Z / 17000));
      T += F.wLava * (90 * Math.pow(Math.max(0, wr), 7) + 16 * NP.n3(X / 6000, Y / 6000 + 2, Z / 6000)) * fadeBig;
    }
  }

  // ======================================================== 5. coast: land profile / sea floor
  if (land) {
    const tidal = F.tidal;
    const hb = 2.2 * (1 - Math.exp(-c / 70)) + 12 * (1 - Math.exp(-c / 2200));
    const ht = 0.7 * (1 - Math.exp(-c / 600)) + 5 * (1 - Math.exp(-c / 8000));
    let shore = hb + (ht - hb) * tidal;
    let top = 14.2 + (5.7 - 14.2) * tidal;
    const cn = NE.n3(X / 70000, Y / 70000, Z / 70000) * 0.6 + NE.n3(X / 17000, Y / 17000 + 4, Z / 17000) * 0.4;
    const cliffy = Math.max(smoothstep(0.2, 0.6, F.mount), smoothstep(0.3, 0.62, cn) * 0.85 * (0.4 + 0.6 * F.rough)) * (1 - tidal) * (1 - built * 0.65);
    if (cliffy > 0.01) {
      const Hc = (16 + 95 * (0.5 + 0.5 * NE.n3(X / 9000, Y / 9000, Z / 9000 + 1.3))) * cliffy;
      const wcl = Math.max(5, 0.4 * Hc, 1.5 * mw);
      const hc = Hc * smoothstep(1.2, 1.2 + wcl, c);
      if (hc > shore) shore = hc + (shore - hc) * 0.06;
      top = Math.max(top, Hc);
      if (c < 1.2 + wcl * 1.6) {
        cliffW = Math.max(cliffW, cliffy);
        const swc = cliffy * smoothstep(20, 60, Hc);
        if (swc > 0.02) { strataW = Math.max(strataW, swc); strataSl = Math.max(strataSl, 4); }
      }
    }
    const Lc = (80000 - 66000 * Math.max(smoothstep(0.1, 0.6, F.mount), cliffy * 0.5)) * (1 + 1.6 * tidal);
    const g = 1 - Math.exp(-c / Lc);
    h = shore + Math.max(0, T - top) * g;
    if (M) M.beach = (1 - smoothstep(50, 200 + 2500 * tidal, c)) * (1 - cliffy);
    const kc = Math.max(0, T - top) * Math.exp(-c / Lc) / Lc;   // the ramp tilts drainage toward the sea
    slopeScale(g);
    slopeTerm(Lc, kc, F.cge * ex + F.cgn * nx, F.cgn * ny, F.cge * ez + F.cgn * nz);
  } else {
    const u = -c;
    const tidal = F.tidal;
    const nS1 = NS.n3(X / 600000, Y / 600000, Z / 600000), nS2 = NS.n3(X / 250000 + 5, Y / 250000, Z / 250000);
    const inletK = Math.max(F.wOX1, F.wOX3);
    const bayK = F.wZR5;
    const shelfW = (24000 + 18000 * nS1) * (1 + 0.8 * tidal) * (1 + 3 * inletK) * (1 - 0.55 * bayK);
    const shelfD = (85 + 50 * nS2) * (1 - 0.45 * F.wArch) * (1 - 0.82 * inletK) * (1 + 0.6 * bayK);
    const slopeW = (75000 + 45000 * nS2) * (1 - 0.6 * bayK);
    const basinD = (3300 + 1200 * nS1) * (1 - 0.82 * F.wArch) * (1 - 0.95 * inletK) * (1 - 0.8 * bayK);
    let d = (6 - 3 * tidal) * (1 - Math.exp(-u / 380));
    d += shelfD * smoothstep(0, shelfW, u);
    d += (basinD - shelfD) * smoothstep(shelfW, shelfW + slopeW, u);
    if (F.wArch > 0.05) d += 60 * F.wArch * smoothstep(1500, 12000, u);   // channels between islands
    const fz = smoothstep(600, 6000, u);
    if (fz > 0) {
      const sl = smoothstep(shelfW * 0.7, shelfW + slopeW * 0.4, u) * (1 - smoothstep(shelfW + slopeW * 0.6, shelfW + slopeW * 1.3, u));
      let rel = 0;
      const b1 = bandW(60000, mw);
      if (b1 > 0) rel += 150 * b1 * NS.n3(X / 60000, Y / 60000, Z / 60000 - 3);
      const b2 = bandW(14000, mw);
      if (b2 > 0) rel += 45 * b2 * NS.n3(X / 14000 + 1, Y / 14000, Z / 14000);
      if (sl > 0) {
        const b3 = bandW(9000, mw);
        if (b3 > 0) { const r = 1 - Math.abs(NS.n3(X / 18000, Y / 18000 + 7, Z / 18000)); rel -= 420 * sl * b3 * Math.pow(r, 6); }
      }
      d -= rel * fz * smoothstep(20, 300, d);
    }
    h = -d;
    if (M) M.seafloor = 1;
  }

  // ======================================================== 5b. OX1 catchment basin (basin.js; after the coast
  // ramp, which flattens the OX1 lowland toward the sea and would squash the designed landform)
  let basinFloor = 0;
  if (land && F.basinW > 0) {
    h = basinRelief(F, h, mw);
    if (BR.w > 0) {
      rockW = Math.max(rockW * (1 - BR.w), BR.rock); cliffW = Math.max(cliffW * (1 - BR.w), BR.cliff);
      talusW = Math.max(talusW * (1 - BR.w), BR.talus); mesaAll = Math.max(mesaAll, BR.mesa);
      if (BR.strata > 0.02) { strataW = Math.max(strataW * (1 - BR.w), BR.strata); strataSl = Math.max(strataSl, BR.strataSl); }
      basinFloor = BR.floor;
    }
  }
  // ======================================================== 6. line features (shoulders, carving)
  // floorK: on a carved canyon / valley floor (alluvial floor + river): no large detail undulation, no strata ledges
  let floorK = 0, floorZ = 0, floorW = 0;
  if (land && nh) {
    let hS = h;
    for (let i = 0; i < nh; i++) {
      const ld = LINE_DATA[F.hLine[i]];
      const kind = ld.kind;
      if (kind === 'range' || kind === 'inlet') continue;
      const v = F.hV[i];
      const hw = lineParam(ld, 'hw', v) * 1000;
      const u = Math.abs(F.hD[i]);
      if (kind === 'oldbed') {
        const ad = Math.abs(F.hD[i] + 700 * NE.n3(X / 7000, Y / 7000, Z / 7000));
        const p = smoothstep(1.25 * hw, 0.25 * hw, ad);
        hS += lineParam(ld, 'height', v) * p * p * (3 - 2 * p) * fadeSmall;
        continue;
      }
      const floor = lineParam(ld, 'floor', v);
      if (kind === 'rift') {
        const lift = lineParam(ld, 'lift', v);
        const lu = 1 - smoothstep(0, 3.0 * hw, u);
        hS += lift * lu * lu * fadeBig;
        const inf = smoothstep(3.0 * hw, 1.3 * hw, u) * fadeBig;
        hS = Math.max(hS, hS + (floor + 2600 - hS) * inf);
      } else if (!ld.line.side) {
        // rim shoulders (side canyons cut into the parent's plateau and never raise it)
        const depth = lineParam(ld, 'depth', v);
        const inf = smoothstep(5.5 * hw, 1.6 * hw, u) * smoothstep(0, 12000, c);
        hS = Math.max(hS, hS + (floor + depth - hS) * inf);
      }
    }
    h = hS;
    for (let i = 0; i < nh; i++) {
      const ld = LINE_DATA[F.hLine[i]];
      const kind = ld.kind;
      if (kind === 'range' || kind === 'oldbed' || kind === 'inlet') continue;
      const v = F.hV[i];
      const hw = lineParam(ld, 'hw', v) * 1000, fw = lineParam(ld, 'fw', v) * 1000;
      let floor = lineParam(ld, 'floor', v);
      const d = F.hD[i] + canyonOffset(hw, X, Y, Z);
      let u = Math.abs(d);
      // canyons vary in width along their course (narrows and broad amphitheatre reaches)
      let hwC = hw, fwC = fw;
      if (kind === 'canyon') {
        const wm = 1 + 0.26 * NE.n3(X / 70000 + 6.1, Y / 70000, Z / 70000) + 0.09 * NE.n3(X / 17000, Y / 17000 + 2.9, Z / 17000);
        hwC = hw * wm; fwC = fw * (0.8 + 0.2 * wm);
      }
      if (u > hwC * (kind === 'rift' ? 2.3 : 1.6)) continue;
      let carve, s, wallW = 0, dcdu = 0;
      if (kind === 'rift') {
        let p = 0;
        const ps = ld.passes;
        for (let j = 0; j < ps.length; j++) { const dt = (F.hT[i] - ps[j][0] * ld.totalLen) / (ps[j][1] * 1000 * 1.5); const e = Math.exp(-dt * dt); if (e > p) p = e; }
        const ia = 1 / 30000, ib = 1 / 9000;
        const hwE = hw * (1 - 0.55 * p) * (1 + 0.11 * NE.n3(X * ia + 9, Y * ia, Z * ia) + 0.05 * NE.n3(X * ib, Y * ib - 4, Z * ib));
        const fwE = fw * (1 - 0.6 * p) * (1 + 0.15 * NE.n3(X * ia - 3, Y * ia + 1, Z * ia));
        floor = floor + (Math.max(floor, h - 240) - floor) * smoothstep(0.1, 0.9, p);
        // spur-and-gully walls: buttresses project into the graben, gullies notch the shoulders
        const gl = wallGully(X, Y, Z, Math.max(2500, 0.45 * (hwE - fwE)), mw);
        u = Math.max(0, u - 0.22 * (hwE - fwE) * gl);
        s = (u - fwE) / (hwE - fwE);
        const sw = s <= 0 ? 0 : s >= 1 ? 1 : s;
        const wallH = Math.max(300, h - floor);
        // talus apron (concave) -> stepped cliff -> rounded rim
        const st = stairs(sw, 4, 0.5, 0.08 + Math.min(0.3, mw / Math.max(200, (hwE - fwE) * 0.25)));
        const wall = 0.14 * smoothstep(0, 0.3, sw) + 0.62 * (0.55 * smoothstep(0.2, 0.78, sw) + 0.45 * st) + 0.24 * smoothstep(0.62, 1, sw);
        carve = floor + wallH * wall;
        dcdu = wallH * (0.14 * dss(0, 0.3, sw) + 0.34 * dss(0.2, 0.78, sw) + 0.28 + 0.24 * dss(0.62, 1, sw)) / (hwE - fwE);
        if (s < 0.2 && p < 0.95) {
          const ls = smoothstep(-0.45, 0.12, s);
          const np = 1 - smoothstep(0.2, 0.8, p);
          // hummocky landslide aprons at the wall feet, rounded erosional knobs on the open floor
          carve += 230 * ls * ls * (0.45 + 0.55 * NE.n3(X / 8000, Y / 8000, Z / 8000 + 5)) * np;
          const kn = smoothstep(0.35, 0.8, NE.n3(X / 5200 + 3, Y / 5200, Z / 5200));
          carve += 150 * kn * kn * (1 - ls) * np;
        }
        // box-canyon tributaries cutting back into the shoulders
        const SP = 34000, tk0 = Math.floor(F.hT[i] / SP);
        for (let q = tk0 - 1; q <= tk0 + 1; q++) {
          const hh = hash3(q, F.hLine[i], 0x5ac, 0x77);
          const side = u01(hh) < 0.45 ? 1 : u01(hh) < 0.9 ? -1 : 0;
          if (side !== 0 && (d >= 0 ? 1 : -1) !== side) continue;
          const tk = (q + 0.2 + 0.6 * u01(rehash(hh, 1))) * SP;
          const L = hw * (0.35 + 0.75 * u01(rehash(hh, 2))) * (1 - p);
          const wk = hw * (0.07 + 0.08 * u01(rehash(hh, 3)));
          const at = Math.abs(F.hT[i] - tk + 0.25 * wk * NE.n3(X / 6000, Y / 6000, Z / 6000 + q));
          if (at > 1.6 * wk || u > hwE + L) continue;
          const ramp = smoothstep(hwE * 0.75, hwE + L, u);
          const floorS = floor + (h - floor) * (0.12 + 0.88 * Math.pow(ramp, 0.8));
          const cs = floorS + (h - floorS) * smoothstep(0.35 * wk, 1.5 * wk, at * (1 + 0.6 * ramp));
          if (cs < carve) carve = cs;
        }
        wallW = smoothstep(-0.05, 0.1, s) * (1 - smoothstep(0.88, 1.05, s)) * (1 - 0.8 * p);
        const cl = smoothstep(0.22, 0.32, s) * (1 - smoothstep(0.66, 0.78, s)) * (1 - p);
        strataW = Math.max(strataW, cl); cliffW = Math.max(cliffW, cl);
        if (cl > 0.02) strataSl = Math.max(strataSl, 3.5 * dcdu);
        rockW = Math.max(rockW, smoothstep(-0.35, -0.05, s) * (1 - smoothstep(0.95, 1.25, s)) * (1 - 0.75 * p));
        talusW = Math.max(talusW, smoothstep(-0.02, 0.1, s) * (1 - smoothstep(0.18, 0.3, s)) * (1 - p));
      } else if (kind === 'canyon') {
        const steps = Math.max(2, Math.round(lineParam(ld, 'steps', v)));
        // broad spur-and-gully re-entrants (the gully filter adds the fine drainage on the walls)
        const gl = wallGully(X, Y, Z, Math.max(900, 0.9 * (hwC - fwC) / steps * 3), mw);
        u = Math.max(0, u - 0.07 * (hwC - fwC) * gl);
        s = (u - fwC) / (hwC - fwC);
        const wallH = Math.max(150, h - floor);
        // irregular benches: the bench index warps along the canyon so treads vary in width. The warp
        // is a function of position (an along-line coordinate jumps across the bisectors on the inside
        // of every polyline bend and would draw radial steps into the walls); it fades out at the rim
        // and the floor (s*(1-s)) so the wall never leaves [floor, rim].
        const sj = s > 0 && s < 1 ? s + (1.4 / steps) * s * (1 - s) * NE.n3(X / 7000 + 2.7, Y / 7000 + s * 3.1, Z / 7000 - 1.3) : s;
        const soft = 0.05 + Math.min(0.25, mw / Math.max(30, (hw - fw) / steps));
        // Z04: tall near-vertical red cliffs (22 % of each step) between broad terrace benches that
        // carry the stepped streets; the steep risers stay bare rock (no building plinths fit there)
        const st = stairs(sj, steps, 0.22, soft);
        carve = floor + wallH * (0.84 * st + 0.16 * (s < 0 ? 0 : s > 1 ? 1 : s));
        dcdu = wallH / (hwC - fwC);
        wallW = smoothstep(-0.02, 0.04, s) * (1 - smoothstep(0.97, 1.05, s));
        const fr = sj * steps - Math.floor(sj * steps);
        const riser = smoothstep(0.7, 0.77, fr) * (1 - smoothstep(0.96, 1, fr)) * wallW;
        strataW = Math.max(strataW, riser); cliffW = Math.max(cliffW, riser); rockW = Math.max(rockW, wallW * (0.4 + 0.6 * riser));
        // riser slope ~ 0.84 * 1.5 / 0.22 x the mean wall slope, steepened by the spur-and-gully shift
        if (riser > 0.02) strataSl = Math.max(strataSl, 9 * dcdu);
        talusW = Math.max(talusW, smoothstep(0.6, 0.7, fr) * (1 - smoothstep(0.72, 0.78, fr)) * wallW);
      } else {
        const shape = lineParam(ld, 'shape', v);
        const gl = wallGully(X, Y, Z, Math.max(400, 0.6 * (hw - fw)), mw);
        u = Math.max(0, u - (shape > 0.5 ? 0.1 : 0.18) * (hw - fw) * gl);
        s = (u - fw) / (hw - fw);
        const sw = s <= 0 ? 0 : s >= 1.3 ? 1.3 : s;
        const wallH = Math.max(120, h - floor);
        if (shape > 0.5) {
          carve = floor + wallH * Math.min(1, sw * sw * (1.15 - 0.25 * sw));
          dcdu = wallH * (2.3 * sw - 0.75 * sw * sw) / (hw - fw);
          wallW = smoothstep(0.1, 0.4, s) * (1 - smoothstep(1.0, 1.2, s));
          rockW = Math.max(rockW, wallW * 0.5);
        } else {
          // gorge: steep water-cut lower walls, rockfall ledges above
          const st = stairs(Math.min(1, sw), 3, 0.55, 0.06);
          carve = floor + wallH * Math.min(1, 0.6 * Math.pow(Math.min(1, sw), 0.65) + 0.4 * st);
          dcdu = wallH / (hw - fw);
          wallW = smoothstep(-0.02, 0.05, s) * (1 - smoothstep(0.95, 1.05, s));
          strataW = Math.max(strataW, wallW); cliffW = Math.max(cliffW, wallW * (s < 0.8 ? 1 : 0.4)); rockW = Math.max(rockW, wallW * 0.95);
          if (wallW > 0.02) strataSl = Math.max(strataSl, 4 * dcdu);
        }
      }
      const k = Math.max(3, Math.min(80, mw * 0.8));
      const before = h;
      h = smin(h, carve, k);
      const cut = before - h;
      if (kind !== 'rift' && cut > 2) {
        floorK = Math.max(floorK, (1 - smoothstep(-0.04, 0.08, s)) * Math.min(1, cut / 12));
        // near the floor (floor + lower wall) the later detail / strata may not dig below the floor level
        const wz = (1 - smoothstep(0.12, 0.4, s)) * Math.min(1, cut / 12);
        if (wz > floorW) { floorW = wz; floorZ = floor; }
      }
      if (M && s < 0.02 && cut > 4) M.riverbed = Math.max(M.riverbed, 1 - smoothstep(-0.4, 0.02, s));
      if (cut > 1 && wallW > 0) {
        slope2 = Math.max(slope2, wallW);
        // the wall slope feeds the gully filter (spur-and-gully walls)
        lineNormalSmooth(ld, v, LN);
        const sg = d >= 0 ? 1 : -1;
        const cw = Math.min(1, cut / 20) * wallW;
        const lw = kind === 'rift' ? 2 * (hw - fw) : 2.5 * (hw - fw);
        // the wall weight ramps over ~6 % of the wall width at the foot / rim: curvature ~ |T| * 12 / width
        slopeTerm(lw, dcdu * sg * cw, LN[0], LN[1], LN[2], dcdu * cw * 12 / Math.max(50, hw - fw));
        // stepped canyon walls (ZR2 terraced streets) keep readable benches: only shallow gullies
        ampTerm(lw, (kind === 'canyon' ? 0.035 : 0.1) * Math.min(1200, cut) * wallW);
      }
    }
  }

  // ======================================================== 6b. gully erosion on natural slopes
  if (land && mw < 10000) {
    const nat = (1 - built) * (1 - F.ice) * fadeMid;
    if (nat > 0.002 && ampTotal() > 0.5) {
      h += gullies(x, y, z, X, Y, Z, nat * smoothstep(0.002, 0.02, nat), mw, GO);
      if (M) M.trough = GO.trough * nat;
      rockW = Math.max(rockW, smoothstep(0.75, 0.98, GO.crest) * 0.6 * nat * smoothstep(0.05, 0.4, F.mount + F.rough * 0.4));
    }
  }

  // ======================================================== 7. polar ice sheet
  let iceW = 0;
  if (F.iceQ > -10) {
    const q = F.iceQ, qm = q * 1000;
    const north = F.lat > 0;
    const ox4 = north ? ox4Weight(x, y, z) : 0;
    const Hc = (north ? 70 + 260 * ox4 : 50) * (0.65 + 0.7 * (0.5 + 0.5 * NT.n3(X / 80000, Y / 80000 + 2, Z / 80000)));
    // cliff ramp >= 1.5 mw wide for the HEIGHT (band limit); materials keep the true cliff width wc0
    const wc0 = 25 + 0.2 * Hc, wc = Math.max(wc0, 1.5 * mw);
    const cliff = Hc * smoothstep(-wc, wc, qm);
    const Tmax = north ? 2300 : 1500;
    let ice = cliff + (Tmax - Hc) * (1 - Math.exp(-Math.max(0, q) / 240)) * smoothstep(0.05, 3, q);
    if (q > 0) {
      if (qm < 4500) {
        // crevasse slots are ~6 m (140 m family) / ~2 m (47 m family) wide: band-limited by that width
        const bc1 = bandW(12, mw), bc2 = bandW(4, mw);
        if (bc1 > 0) {
          const g1 = 1 - Math.abs(NT.n3(X / 140, Y / 140, Z / 140));
          let crev = smoothstep(0.9, 0.985, g1) * 0.7 * bc1;
          if (bc2 > 0) { const g2 = 1 - Math.abs(NT.n3(X / 47 + 3, Y / 47, Z / 47)); crev += smoothstep(0.9, 0.98, g2) * 0.3 * bc2; }
          ice -= 16 * crev * smoothstep(60, 400, qm) * (1 - smoothstep(1800, 4500, qm));
        }
      }
      if (north && q > 25) {
        const col = (90 - F.lat) * 59.16;
        const arg = (2 * Math.PI * col) / 115 - 3 * (F.lon * DEGR) + 0.9 * NT.n3(X / 300000, Y / 300000, Z / 300000);
        const tw = 0.5 + 0.5 * Math.cos(arg);
        const tr = smoothstep(0.8, 0.97, tw) * smoothstep(40, 170, col) * smoothstep(25, 90, q);
        ice -= 460 * tr;
        const swI = tr * (1 - tr) * 3.5;
        if (swI > 0.02) { strataW = Math.max(strataW, swI); strataSl = Math.max(strataSl, 0.5); }
      }
      // the swell / roughness of the sheet fade in over the upper half of the cliff ramp (they started at full
      // amplitude at q = 0: a step of up to 18 m along that iso-line on the cliff face)
      const kq = smoothstep(0, wc, qm);
      const b1 = bandW(4000, mw);
      if (b1 > 0) ice += 18 * b1 * kq * NT.n3(X / 4000, Y / 4000, Z / 4000 + 9);
      const b2 = bandW(6, mw);
      if (b2 > 0) ice += 0.18 * b2 * kq * NT.n3(X / 6, Y / 6 + 2, Z / 6);
    }
    iceW = smoothstep(-0.02, 0.15, q);
    // the ice-cliff FACE is ice down to a short red-rock foot (O03 冰崖 / QY-04): the lowest ~2-40 m of the cliff
    // profile (qm < -0.55 wc) show bare rock, frost on the face; crevasse cue for the renderer (M.crevasse)
    if (q > -0.3 && qm < wc0 * 2.5) {
      const faceIce = smoothstep(-wc0 * 0.9, -wc0 * 0.55, qm);
      if (faceIce > iceW) iceW = faceIce;
      const foot = smoothstep(-wc0 * 1.7, -wc0 * 1.05, qm) * (1 - smoothstep(-wc0 * 0.75, -wc0 * 0.5, qm));
      if (foot > 0) { rockW = Math.max(rockW, 0.9 * foot); talusW = Math.max(talusW, 0.6 * foot); }
      if (M) {
        const bc = bandW(40, mw);
        if (bc > 0) {
          const g = 1 - Math.abs(NT.n3(X / 90 + 1.3, Y / 260, Z / 90 - 2.1));
          M.crevasse = Math.max(M.crevasse, smoothstep(0.86, 0.97, g) * faceIce * (1 - smoothstep(wc0, wc0 * 2.5, qm)) * bc);
        }
      }
    }
    h += ice * smoothstep(-0.5, 0, q) * (land ? 1 : 0.4);
    if (M) M.iceCliff = q > -0.2 && qm < wc0 * 2.5 ? smoothstep(-wc0 * 2, -wc0 * 0.5, qm) * (1 - smoothstep(wc0 * 1.5, wc0 * 2.5, qm)) : 0;
  }

  // ======================================================== 8. craters
  {
    const sea = !land;
    let ampBig = (1 - iceW) * (1 - 0.8 * basinFloor) * (sea ? 0.32 - 0.25 * F.wArch : 1) * (1 - 0.4 * F.wOX6) * (1 - 0.55 * F.wLava) * (1 - 0.85 * F.rift) * (1 - 0.9 * F.canyon) * (1 - 0.6 * F.wArch);
    ampBig *= 0.4 + 0.8 * F.rough + 0.3 * F.wSouth;
    if (F.wVolc && F.volcR < 1.2) ampBig *= 0.25;
    ampBig *= sea ? 1 : smoothstep(0, 1500, c);
    // small craters: buried on graded / farmed land and mostly degraded on sediment plains
    const ampSmall = ampBig * (1 - built) * (1 - built) * (0.35 + 0.65 * F.rough);
    ampBig *= 1 - 0.55 * urban;
    const ageBias = (sea ? 0.45 : 0) + 0.35 * urban + 0.3 * F.farmBase + 0.12 * (1 - F.rough);
    let hc = 0;
    if (ampBig > 0.002) hc = craterField(X, Y, Z, mw, ampBig, ampSmall, ageBias, CR);
    else { CR.fresh = 0; CR.wall = 0; CR.floor = 0; CR.rim = 0; }
    hc += fixedCraters(x, y, z, mw, CR) * (1 - iceW) * (sea ? 0.4 : smoothstep(0, 2000, c));
    h += hc;
    rockW = Math.max(rockW, CR.wall * 0.75);
    const swC = CR.wall * CR.wall * 0.6;
    if (swC > 0.02) { strataW = Math.max(strataW, swC); strataSl = Math.max(strataSl, 1.4); }
    if (M) { M.fresh = CR.fresh; M.floor = CR.floor; M.park = CR.park; M.rim = CR.rim; }
  }

  // ======================================================== 9. detail, dunes, strata, scree
  {
    let rough = 0.3 + 0.9 * rockW + 0.4 * F.rough + 0.35 * F.mount;
    rough *= 1 - 0.6 * iceW;
    rough *= 1 - 0.5 * F.wOX6 * (1 - rockW);
    if (!land) rough *= 0.45;
    let dh = detail(X, Y, Z, mw, rough, land ? built : 0, 6000, 0.85 * basinFloor, floorK);
    if (built > 0.05 && built < 0.45 && c > 300) {                        // outcrops at city / farm edges
      const ob = bandW(1200, mw);
      if (ob > 0) {
        // lobate, rounded rock knobs and short ribs (a single smoothstepped octave drew flat-topped
        // "buttons" that read as rows of ovals from the air)
        const b2 = bandW(640, mw), b3 = bandW(260, mw);
        let on = NE.n3(X / 1900 + 4, Y / 1900, Z / 1900);
        if (b2 > 0) on += 0.38 * b2 * NE.n3(X / 640 - 2.3, Y / 640 + 5.1, Z / 640);
        if (b3 > 0) on += 0.12 * b3 * NE.n3(X / 260 + 7.7, Y / 260, Z / 260 - 4.2);
        const edge = smoothstep(0.05, 0.16, built) * (1 - smoothstep(0.25, 0.45, built));
        const knob = smoothstep(0.46, 0.95, on) * edge;
        dh += 28 * knob * Math.sqrt(knob) * ob;
        rockW = Math.max(rockW, smoothstep(0.05, 0.45, knob) * 0.85 * ob);
      }
    }
    if (land) h += dh * (c > 350 ? 1 : fadeSmall + (1 - fadeSmall) * 0.12);
    else h += dh * smoothstep(0, 1500, -c);

    // dunes & ripples in sand country (crater floors, rift floor, open plains, polar erg)
    if (land && c > 30 && mw < 300) {
      const erg = smoothstep(0.1, 0.55, NK.n3(X / 420000, Y / 420000 + 5, Z / 420000)) * (1 - F.wLava) * F.plain * (1 - F.zoneO * 0.6)
        + CR.floor * 0.6 + (F.lat > 70 && F.iceQ < -3 ? smoothstep(70, 74, F.lat) * 0.9 : 0);
      let sand = clamp(erg, 0, 1) * (1 - rockW) * (1 - built) * (1 - iceW) * (1 - 0.7 * F.frost) * (1 - 0.8 * basinFloor) * smoothstep(30, 600, c);
      if (F.rift > 0.5) sand = Math.max(sand, 0.5 * (1 - rockW * 0.6));
      if (sand > 0.02) {
        SEL[0] = NK.n3(X / 900000, Y / 900000, Z / 900000); SEL[1] = NK.n3(X / 900000 + 7, Y / 900000, Z / 900000); SEL[2] = NK.n3(X / 900000 + 14, Y / 900000, Z / 900000);
        const ks = smoothstep(0.02, 0.06, sand);
        h += ks * (dunes(x, y, z, X, Y, Z, mw, 280, 16 * sand) + dunes(x, y, z, X, Y, Z, mw, 38, 1.4 * sand) + dunes(x, y, z, X, Y, Z, mw, 1.6, 0.07 * sand));
        if (M) M.dune = Math.max(M.dune, sand);
      }
      if (M) M.sand = Math.max(M.sand, sand);
    }

    // strata ledges on steep faces (absolute elevation layer cake)
    const sW = land ? strataW * (1 - floorK) : 0;
    if (sW > 0.001 || M) h += strataTerrace(h, sW, mw, M, strataSl);

    // canyon / valley floors: no pits below the floor level at the wall feet (detail / strata notches)
    if (floorW > 0 && h < floorZ - 0.5) h += (smax(h, floorZ - 0.5, 2) - h) * floorW;

    // scree & boulders where they change silhouettes: cliff feet and steep rock
    if (mw < 3 && rockW > 0.3 && land) {
      const cell = 7;
      const gx = X / cell - 0.5, gy = Y / cell - 0.5, gz = Z / cell - 0.5;
      const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
      let bh = 0;
      const occ = 0.2 + 0.4 * Math.max(cliffW, talusW);
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const hh = hash3(ix + dx, iy + dy, iz + dz, 0x51c0);
        if (u01(hh) > occ) continue;
        const ox = (ix + dx + u01(rehash(hh, 1))) * cell, oy = (iy + dy + u01(rehash(hh, 2))) * cell, oz = (iz + dz + u01(rehash(hh, 3))) * cell;
        const r = 0.5 + 2.3 * Math.pow(u01(rehash(hh, 4)), 2);
        const ddx = X - ox, ddy = Y - oy, ddz = Z - oz;
        const d2 = (ddx * ddx + ddy * ddy + ddz * ddz) / (r * r);
        if (d2 < 1) { const t = 1 - d2; bh = Math.max(bh, r * 0.72 * t * Math.sqrt(t)); }
      }
      h += bh * (rockW - 0.3) / 0.7 * bandW(2.5, mw) * (1 - built);
      if (M) M.scree = Math.max(M.scree, (rockW - 0.3) / 0.7 * Math.max(cliffW, talusW));
    }
  }

  if (M) {
    M.rock = Math.max(M.rock, rockW);
    M.cliff = Math.max(M.cliff, cliffW);
    M.ice = iceW;
    M.strataW = strataW;
    M.mesa = Math.max(M.mesa, mesaAll);
    M.talus = Math.max(M.talus, talusW);
    M.slope = Math.max(M.slope, slope2);
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// OX5 step layout (shared with the G02 design: the water stairs cross step 2 near 45W 28S)
// [distance from the west-sea coast (m), riser height (m)]
export const OX5_STEPS = [[100000, 230], [262000, 300], [470000, 330], [720000, 300]];
// near the G02 valley the escarpment stays regular (no lateral noise) so the designed stairs fit
const G02C = (() => { const la = -27.9 * DEGR, lo = -44.9 * DEGR; return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]; })();
export function g02NoiseFade(x, y, z) {
  const dx = x - G02C[0], dy = y - G02C[1], dz = z - G02C[2];
  return smoothstep(26000, 70000, Math.sqrt(dx * dx + dy * dy + dz * dz) * R);
}
