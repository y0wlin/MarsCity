// Terrain tile builder: mesh + textures + water data for one quadtree tile. Pure JS, no THREE,
// runs inside the world workers (handlers/terrainTile.js) and in Node previews.
// OWNER: terrain-render agent.
//
// Output layout (all typed arrays are transferable):
//   grid vertex (i, j), i along a, j along b, 0..N  → index j*NV + i ; uv = (i/N, j/N)
//   skirts: 4 runs of NV vertices after the grid: W (i=0, j=0..N), E (i=N), S (j=0, i=0..N), N (j=N)
//   positions  Float32 xyz relative to centerEcef (ECEF axes, metres)
//   normals    Float32 xyz (unit, ECEF axes)
//   morph      Float32 xyz: (position on the PARENT mesh) - (own position); used for geomorphing
//              children in and for stitching edges against a coarser neighbour exactly
//   heights    Float32 ground height (m) at the NV×NV grid vertices
//   textures   T×T texels, texel (tx, ty) centred at a = a0 + (a1-a0)·tx/(T-1) (edge-centred, so
//              same-level neighbours share identical edge texels); row 0 = b0 (DataTexture
//              convention). Sample with uv·(T-1)/T + 0.5/T (half-texel inset).
//     albedo   RGBA8: sRGB colour, A = sky visibility / ambient occlusion (linear)
//     normal   RGBA8: object-space (ECEF) unit normal ·0.5+0.5 from the texel heights (finer than the
//              vertex grid) + sub-geometry micro relief; A = gloss mask (water / wet / ice / glass)
//     emission RGBA8 (sRGB): R = window aggregate / EMIT_FAR_RANGE, G = street light / EMIT_STREET_RANGE
//              (EMISSIVE units), B = light temperature, A = dusk onset (0 early .. 1 late, linear)
//              | null when the tile has no lights (material.js decodes and weights by camera distance)
//   water      vertex-grid water data (see ARCHITECTURE.md §8 "Tile water data") | null
//   wl         Float32 (TOTAL_VERTS×2) | null: per-vertex (water level, valid) for the terrain shader — valid = 1
//              where the vertex carries a level the water MESH draws (sea / lake / resolved river or canal,
//              incl. the 3-vertex shoreline dilation), so the material can drop the painted water look on mesh
//              parts that lie above the water surface (coarse shore triangles)
//
// Every world function is evaluated once per texel (sampleTerrain → heights, normals and materials;
// urbanSample per texel below 100 m texels, on a 2–4-texel lattice above; waterAt only where the
// terrain reports water / shore nearby). Heights for the mesh are band-limited at the vertex spacing,
// texel heights at the texel spacing (normal map, error metric).

import { R } from '../../core/constants.js';
import { FACES, tileBounds } from '../../core/geo.js';
import { heightAt, sampleTerrain } from '../../world/terrain.js';
import { waterAt } from '../../world/hydro.js';
import { shadeSurface, surfaceMicroHeight, SHADE_CTX, initSurfaceModules, getUrbanSampler, surfaceModules } from '../../world/surface.js';
import { N, NV, GRID_VERTS, TOTAL_VERTS, TEX_NEAR, TEX_FAR, tileSizeAt, vertexWavelength, texelWavelength, cellSagitta, skirtDepth, EMIT_FAR_RANGE, EMIT_STREET_RANGE } from './config.js';

const QPI = Math.PI / 4;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Load the optional world modules (urban) once per worker. */
let READY = null;
export function ensureTileBuilder() {
  // re-checked while the urban module is missing (initSurfaceModules retries a failed import itself)
  if (!READY || (!getUrbanSampler() && READY_DONE)) { READY_DONE = false; READY = initSurfaceModules().catch(() => false).finally(() => { READY_DONE = true; }); }
  return READY;
}
let READY_DONE = false;
export function tileBuilderInfo() { return surfaceModules(); }

// --------------------------------------------------------------------------------------------
// scratch buffers (per worker, grown on demand)
// --------------------------------------------------------------------------------------------
const S = { cap: 0 };
function scratch(TB) {
  const n = TB * TB;
  if (S.cap >= n) return S;
  S.cap = n;
  S.dir = new Float64Array(n * 3);
  S.h = new Float64Array(n);          // texel heights (band-limited at the texel spacing)
  S.hm = new Float64Array(n);         // micro relief (normal map only)
  S.occ = new Float32Array(n);        // own building height × coverage (AO)
  S.blur = new Float64Array(n); S.tmp = new Float64Array(n);
  return S;
}

function faceDir(F, a, b, out, o) {
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const N0 = F[0], U = F[1], V = F[2];
  const x = N0[0] + s * U[0] + t * V[0];
  const y = N0[1] + s * U[1] + t * V[1];
  const z = N0[2] + s * U[2] + t * V[2];
  const il = 1 / Math.sqrt(x * x + y * y + z * z);
  out[o] = x * il; out[o + 1] = y * il; out[o + 2] = z * il;
}

// linear → sRGB byte lookup (4096 entries)
const SRGB_LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  SRGB_LUT[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}
const toSrgb8 = (c) => SRGB_LUT[c <= 0 ? 0 : c >= 1 ? 4096 : (c * 4096 + 0.5) | 0];

const TS = {}, US = {}, WS = {}, OUT = { albedo: [0, 0, 0], emission: [0, 0, 0] };
const WSEA = { type: 1, level: 0, depth: 0, dist: 1e9, width: 0, flow: [0, 0] };
const CTX = { ...SHADE_CTX };
const num = (v, d = 0) => (typeof v === 'number' && v === v ? v : d);

// terrain sky-visibility bands (metres). LOD consistent: evaluated from heightAt band limits on a
// sparse grid, so every tile covering a point computes the same occlusion for these scales.
const AO_BANDS = [1500, 6000, 24000, 96000];
const AO_ALPHA = 7.0, AO_STRENGTH = 0.30;

/**
 * Build one tile.
 * @param {{face:number, level:number, x:number, y:number, texRes?:number}} req
 */
export function buildTerrainTile(req) {
  const { face, level, x, y } = req;
  const T = req.texRes || 256;
  const t0 = now();
  const F = FACES[face];
  const B = tileBounds(face, level, x, y);
  const a0 = B.a0, b0 = B.b0, da = B.a1 - B.a0, db = B.b1 - B.b0;
  const size = tileSizeAt(level);
  const mwV = vertexWavelength(level);
  const mwT = texelWavelength(level, T);
  const C3 = new Float64Array(3);
  faceDir(F, a0 + da / 2, b0 + db / 2, C3, 0);
  const cx = C3[0] * R, cy = C3[1] * R, cz = C3[2] * R;
  const stats = { samplesV: 0, samplesT: 0, samplesW: 0, samplesU: 0, samplesAO: 0, msVertex: 0, msTexel: 0, msPost: 0 };
  const urbanSample = getUrbanSampler();
  let urbanErrors = 0;                 // failed urban samples: the tile is rebuilt later (no silent city holes)

  // ------------------------------------------------------------------ vertex grid (+1 border)
  const NB = N + 3;
  const vDir = new Float64Array(NB * NB * 3);
  const vH = new Float64Array(NB * NB);
  for (let j = 0; j < NB; j++) {
    const bb = b0 + db * (j - 1) / N;
    for (let i = 0; i < NB; i++) {
      const k = j * NB + i;
      faceDir(F, a0 + da * (i - 1) / N, bb, vDir, k * 3);
      vH[k] = heightAt(vDir[k * 3], vDir[k * 3 + 1], vDir[k * 3 + 2], mwV);
    }
  }
  stats.samplesV = NB * NB;
  let minH = Infinity, maxH = -Infinity;
  for (let j = 1; j <= NV; j++) for (let i = 1; i <= NV; i++) { const h = vH[j * NB + i]; if (h < minH) minH = h; if (h > maxH) maxH = h; }
  // steep tile: some grid cell rises more than 1.2× its width (≈ 50°) — refines one level further (index.js)
  let steep = false;
  {
    const lim = 1.2 * mwV;
    for (let j = 1; j < NV && !steep; j++) for (let i = 1; i < NV; i++) {
      const k = j * NB + i, d1 = Math.abs(vH[k + 1] - vH[k]), d2 = Math.abs(vH[k + NB] - vH[k]);
      if (d1 > lim || d2 > lim) { steep = true; break; }
    }
  }
  // vertex normals (grid interior, from the bordered heights)
  const vN = new Float64Array(GRID_VERTS * 3);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = (j + 1) * NB + (i + 1), o = (j * NV + i) * 3;
    const kl = k - 1, kr = k + 1, kd = k - NB, ku = k + NB;
    const rl = R + vH[kl], rr = R + vH[kr], rd = R + vH[kd], ru = R + vH[ku];
    const ax = vDir[kr * 3] * rr - vDir[kl * 3] * rl, ay = vDir[kr * 3 + 1] * rr - vDir[kl * 3 + 1] * rl, az = vDir[kr * 3 + 2] * rr - vDir[kl * 3 + 2] * rl;
    const bx = vDir[ku * 3] * ru - vDir[kd * 3] * rd, by = vDir[ku * 3 + 1] * ru - vDir[kd * 3 + 1] * rd, bz = vDir[ku * 3 + 2] * ru - vDir[kd * 3 + 2] * rd;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    vN[o] = nx * nl; vN[o + 1] = ny * nl; vN[o + 2] = nz * nl;
  }

  // ------------------------------------------------------------------ parent heights (morph / stitch)
  let pH = null;
  if (level > 0) {
    const pmw = vertexWavelength(level - 1);
    pH = new Float64Array(33 * 33);
    for (let J = 0; J <= 32; J++) for (let I = 0; I <= 32; I++) {
      const k = (2 * J + 1) * NB + (2 * I + 1);
      const h = heightAt(vDir[k * 3], vDir[k * 3 + 1], vDir[k * 3 + 2], pmw);
      pH[J * 33 + I] = h;
      if (h < minH) minH = h; if (h > maxH) maxH = h;
    }
    stats.samplesV += 33 * 33;
  }
  stats.msVertex = now() - t0;

  // ------------------------------------------------------------------ texel pass
  const TB = T + 2;
  const s = scratch(TB);
  const tDir = s.dir, tH = s.h, hm = s.hm, occ = s.occ;
  const texelM = mwT;
  // nominal texel of this level (the split criterion's 256² texel): scale-dependent looks (orbit canal widths) use it,
  // so a texture upgrade 128² → 256² → 512² only sharpens them (fix round 3)
  CTX.texelRef = texelWavelength(level, TEX_FAR);
  const tTex = now();
  // probe the terrain API once: newer terrain reports water type / shore distance per sample
  sampleTerrain(C3[0], C3[1], C3[2], mwT, TS);
  const terrainWater = typeof TS.water === 'number' && typeof TS.coast === 'number';
  // vertex water grid (what the water renderer can draw): needed first by the legacy hydro path,
  // otherwise built lazily at the first wet texel
  let vWater = null;
  if (!terrainWater) vWater = vertexWater(vDir, vH, NB, stats);
  // No coarse "is there any city here" pre-pass: the urban plan is not monotonic across footprints
  // (towns vanish from footprints ≳ 9 km, corridor roads from district-level samples), so a coarse
  // gate drops whole blocks of real fabric (blocky city edges, dashed roads), and urbanSample costs
  // only ~1–5 µs where nothing is built (vs 30–80 µs for sampleTerrain): every texel is sampled.

  // coarse texels: urbanSample on a lattice with an s-texel footprint, bilinearly interpolated.
  //   texel ≥ 2.6 km: s = 1 (footprint = texel, the field-expectation level of the urban plan; from
  //       5.2 km texels down the settlements resolve: town cores, satellite towns, green belts read at
  //       orbit instead of the smooth envelope of a 2-texel footprint)
  //   1.65 km ≤ texel < 2.6 km: s = 2 (footprint 3.3–5.2 km, still the field-expectation level)
  //   1 km ≤ texel < 1.65 km: s = 4 so the footprint reaches the field-expectation level (≥ 3.3 km);
  //       district patchwork is sub-texel there anyway and its seeds are very expensive to build
  //   100 m ≤ texel < 1 km: s = 2 (districts span many texels)
  let ls = 1;
  if (texelM >= 2600 && level >= 2) ls = 1;
  else if (texelM >= 1000) ls = texelM >= 1650 ? 2 : 4;
  else if (texelM >= 100) ls = 2;
  const halfUrban = ls > 1 && !!urbanSample;
  let UL = null, HN = 0;
  if (halfUrban) {
    HN = Math.floor((T + 1) / ls) + 2;
    UL = urbanLattice(HN);
    for (let m = 0; m < HN; m++) {
      const cyT = ls * m - 1;
      for (let n = 0; n < HN; n++) {
        const cxT = ls * n - 1, q = m * HN + n;
        let u = null;
        faceDir(F, a0 + da * cxT / (T - 1), b0 + db * cyT / (T - 1), C3, 0);
        try { u = urbanSample(C3[0], C3[1], C3[2], texelM * ls, US); } catch { u = null; urbanErrors++; }
        stats.samplesU++;
        storeLattice(UL, q, u);
      }
    }
  }

  const albedo = new Uint8Array(T * T * 4);
  const normal = new Uint8Array(T * T * 4);
  const emission = new Uint8Array(T * T * 4);
  let waterMask = null;
  let anyUrban = false, anyLight = false, waterTexels = 0, texelWater = false;
  let geomErr = 0;
  const vs = mwV;
  const micro = texelM < 2.5;
  const eFar = 1 / EMIT_FAR_RANGE, eStreet = 1 / EMIT_STREET_RANGE;
  for (let ty = 0; ty < TB; ty++) {
    const bb = b0 + db * (ty - 1) / (T - 1);
    const inY = ty >= 1 && ty <= T;
    const fv = (ty - 1) / (T - 1) * N;
    const j0 = Math.max(0, Math.min(N - 1, Math.floor(fv))), fvv = fv - j0;
    for (let tx = 0; tx < TB; tx++) {
      const k = ty * TB + tx;
      faceDir(F, a0 + da * (tx - 1) / (T - 1), bb, tDir, k * 3);
      const dx = tDir[k * 3], dy = tDir[k * 3 + 1], dz = tDir[k * 3 + 2];
      sampleTerrain(dx, dy, dz, mwT, TS);
      const h = num(TS.h, 0);
      tH[k] = h;
      const interior = inY && tx >= 1 && tx <= T;
      let U = null;
      if (halfUrban) {
        if (interior) U = sampleLattice(UL, HN, tx / ls, ty / ls);
      } else if (urbanSample && (interior || micro)) {
        try { U = urbanSample(dx, dy, dz, texelM, US); } catch { U = null; urbanErrors++; }
        stats.samplesU++;
      }
      hm[k] = micro ? surfaceMicroHeight(dx, dy, dz, texelM, TS, U) : 0;
      if (!interior) continue;
      const o = (ty - 1) * T + (tx - 1);
      if (h < minH) minH = h; if (h > maxH) maxH = h;
      // ---- mesh error and slope from the vertex grid
      const fu = (tx - 1) / (T - 1) * N;
      const i0 = Math.max(0, Math.min(N - 1, Math.floor(fu))), fuu = fu - i0;
      const k00 = (j0 + 1) * NB + (i0 + 1);
      const h00 = vH[k00], h10 = vH[k00 + 1], h01 = vH[k00 + NB], h11 = vH[k00 + NB + 1];
      let hmesh;
      if (((i0 + j0) & 1) === 0) hmesh = fuu >= fvv ? h00 + fuu * (h10 - h00) + fvv * (h11 - h10) : h00 + fuu * (h11 - h01) + fvv * (h01 - h00);
      else hmesh = fuu + fvv <= 1 ? h00 + fuu * (h10 - h00) + fvv * (h01 - h00) : h11 + (1 - fuu) * (h01 - h11) + (1 - fvv) * (h10 - h11);
      const e = Math.abs(h - hmesh); if (e > geomErr) geomErr = e;
      const q = j0 * NV + i0;
      const w00 = (1 - fuu) * (1 - fvv), w10 = fuu * (1 - fvv), w01 = (1 - fuu) * fvv, w11 = fuu * fvv;
      const nx = vN[q * 3] * w00 + vN[(q + 1) * 3] * w10 + vN[(q + NV) * 3] * w01 + vN[(q + NV + 1) * 3] * w11;
      const ny = vN[q * 3 + 1] * w00 + vN[(q + 1) * 3 + 1] * w10 + vN[(q + NV) * 3 + 1] * w01 + vN[(q + NV + 1) * 3 + 1] * w11;
      const nz = vN[q * 3 + 2] * w00 + vN[(q + 1) * 3 + 2] * w10 + vN[(q + NV) * 3 + 2] * w01 + vN[(q + NV + 1) * 3 + 2] * w11;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const cUp = Math.max(0.02, (nx * dx + ny * dy + nz * dz) / nl);
      const slope = 1 - cUp;
      const grad = Math.sqrt(Math.max(0, 1 - cUp * cUp)) / cUp;     // rise per metre
      // ---- water
      let W = null;
      CTX.waterFrac = -1; CTX.depth = 0; CTX.waterResolved = true; CTX.canalResolved = true;
      let needW;
      if (terrainWater) needW = (TS.water | 0) !== 0 || TS.coast < texelM * 2 + 25;
      else needW = waterNear(vWater, i0, j0, vs, h);
      if (needW) {
        if (terrainWater && (TS.water | 0) === 1) {
          // open sea: level 0 by definition, no need to re-evaluate the terrain in waterAt
          W = WSEA; WSEA.depth = -h;
        } else {
          try { W = waterAt(dx, dy, dz, WS); } catch { W = null; }
          stats.samplesW++;
        }
        const wt = W ? num(W.type) | 0 : 0;
        if (wt !== 0) {
          texelWater = true;
          const wl = num(W.level, 0);
          const depth = wl - h;
          let wf = Math.max(0, Math.min(1, 0.5 + depth / Math.max(0.02, grad * texelM * 0.5)));
          if (wt === 2) {
            const width = num(W.width), dist = num(W.dist, 1e9);
            const cv = Math.max(0, Math.min(1, (width * 0.5 - dist) / Math.max(texelM, 0.05) + 0.5));
            wf = Math.max(wf, cv * (texelM > width ? Math.min(1, width / texelM * 1.6) : 1));
            CTX.canalResolved = width >= 2 * vs;
          }
          // can the water mesh draw this texel? Its surface needs all four corners of the vertex quad
          // in the (dilated) vertex water grid at this water level; otherwise (sub-vertex pond, a
          // small lake next to a canal at another level) the water is painted into the texture
          if (!vWater) vWater = vertexWater(vDir, vH, NB, stats);
          CTX.waterResolved = quadHasLevel(vWater, i0, j0, wl, wt);
          CTX.waterFrac = wf; CTX.depth = depth;
          // the wet mask is the water mesh's coverage: painted (undrawable) water stays out of it
          if (wf > 0 && CTX.waterResolved && CTX.canalResolved) {
            if (!waterMask) waterMask = new Uint8Array(T * T);
            waterMask[o] = Math.round(wf * 255);
            waterTexels++;
          }
        } else if (W) { CTX.waterFrac = 0; CTX.depth = -1; }
      }
      CTX.slope = slope;
      CTX.coastal = h < 6;
      CTX.ao = -1;
      if (U) {
        occ[k] = Math.max(0, num(U.height)) * Math.min(1, num(U.coverage) * 1.4);
        if (!anyUrban && ((num(U.cls) | 0) !== 0 || num(U.coverage) > 0 || num(U.fabric) > 0)) anyUrban = true;
      } else occ[k] = 0;
      shadeSurface(dx, dy, dz, texelM, TS, U, W, CTX, OUT);
      const A = OUT.albedo;
      albedo[o * 4] = toSrgb8(A[0]); albedo[o * 4 + 1] = toSrgb8(A[1]); albedo[o * 4 + 2] = toSrgb8(A[2]);
      albedo[o * 4 + 3] = Math.round(Math.max(0, Math.min(1, OUT.ao)) * 255);
      normal[o * 4 + 3] = Math.round(OUT.gloss * 255);
      // emission: R window aggregate, G street light (units / range, sRGB), B temperature, A onset
      const lFar = num(OUT.lightFar), lStr = num(OUT.lightStreet);
      if (lFar > 0 || lStr > 0) {
        anyLight = true;
        emission[o * 4] = toSrgb8(lFar * eFar); emission[o * 4 + 1] = toSrgb8(lStr * eStreet);
      }
      emission[o * 4 + 2] = toSrgb8(num(OUT.lightTemp, 0.2));
      emission[o * 4 + 3] = Math.round(OUT.onset * 255);
    }
  }
  stats.samplesT = TB * TB;
  geomErr += cellSagitta(level);
  // low shores: interior land vertices whose fine ground dips below the neighbouring water level go just
  // under the water surface, so the visible waterline follows the wet mask (water renderer coverage)
  // instead of the coarse triangles poking through it at grazing views (scalloped coasts)
  if (vWater && vWater.any) {
    const nc = shoreClamp(level, vH, NB, vWater, waterMask, T, stats);
    if (nc) for (let j = 1; j <= NV; j++) for (let i = 1; i <= NV; i++) { const h = vH[j * NB + i]; if (h < minH) minH = h; }
  }
  stats.msTexel = now() - tTex;
  const tPost = now();

  // ------------------------------------------------------------------ normals (texel heights + micro relief)
  for (let ty = 1; ty <= T; ty++) for (let tx = 1; tx <= T; tx++) {
    const k = ty * TB + tx, o = (ty - 1) * T + (tx - 1);
    const kl = k - 1, kr = k + 1, kd = k - TB, ku = k + TB;
    const rl = R + tH[kl] + hm[kl], rr = R + tH[kr] + hm[kr], rd = R + tH[kd] + hm[kd], ru = R + tH[ku] + hm[ku];
    const ax = tDir[kr * 3] * rr - tDir[kl * 3] * rl, ay = tDir[kr * 3 + 1] * rr - tDir[kl * 3 + 1] * rl, az = tDir[kr * 3 + 2] * rr - tDir[kl * 3 + 2] * rl;
    const bx = tDir[ku * 3] * ru - tDir[kd * 3] * rd, by = tDir[ku * 3 + 1] * ru - tDir[kd * 3 + 1] * rd, bz = tDir[ku * 3 + 2] * ru - tDir[kd * 3 + 2] * rd;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    let nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= nl; ny *= nl; nz *= nl;
    if (waterMask && waterMask[o]) {
      // the water surface is flat: submerged texels show the bed through a level surface
      const wf = waterMask[o] / 255 * 0.94;
      nx += (tDir[k * 3] - nx) * wf; ny += (tDir[k * 3 + 1] - ny) * wf; nz += (tDir[k * 3 + 2] - nz) * wf;
      nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= nl; ny *= nl; nz *= nl;
    }
    normal[o * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    normal[o * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    normal[o * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
  }

  // ------------------------------------------------------------------ sky visibility → albedo.a
  // (a) neighbouring buildings: a global-lattice grid (aligned for same-level neighbours) of
  //     area-averaged building heights, blurred; texels lower than their surroundings darken.
  let aoGrid = null, aoM = 0, aoStep = 0, G = 0;
  if (anyUrban && urbanSample && texelM < 4.5) {
    // lattice step in [4.5, 9) m (power-of-two subdivision of the tile, so same-level neighbours share
    // the lattice): the heights are blurred with a 10 m radius below, a finer lattice only costs
    // urbanSample calls (it was ~2.5 m: up to 75k extra samples per 512² tile)
    let kk = 2; while (kk < 9 && size / (1 << (kk + 1)) >= Math.max(4.5, texelM * 2)) kk++;
    const aoN = 1 << kk; aoStep = 1 / aoN;
    const stepM = size / aoN;
    aoM = Math.ceil(20 / stepM);
    G = aoN + 1 + 2 * aoM;
    const gh = new Float64Array(G * G);
    for (let j = 0; j < G; j++) {
      const vv = (j - aoM) * aoStep;
      for (let i = 0; i < G; i++) {
        faceDir(F, a0 + da * (i - aoM) * aoStep, b0 + db * vv, C3, 0);
        let hb = 0;
        try { const r = urbanSample(C3[0], C3[1], C3[2], stepM, US); hb = Math.max(0, num(r.height)) * Math.min(1, num(r.coverage) * 1.4); } catch { hb = 0; }
        gh[j * G + i] = hb;
      }
    }
    stats.samplesU += G * G;
    const rad = Math.max(1, Math.round(10 / stepM));
    const tmp = new Float64Array(G * G);
    for (let it = 0; it < 2; it++) { boxBlur(gh, tmp, G, rad, true); boxBlur(tmp, gh, G, rad, false); }
    aoGrid = gh;
  }
  // (b) terrain: LOD-consistent multi-scale cavity (band-limited heights at fixed metre scales on a
  //     sparse grid) + a mild local term from the texel heights
  const bandsAO = terrainBandsAO(F, a0, b0, da, db, texelM, size, stats);
  boxBlur(tH, s.tmp, TB, 2, true); boxBlur(s.tmp, s.blur, TB, 2, false);
  const blur = s.blur;
  // orbit readability (R4, §6 抽查 1 / Z-05): at disc-scale texels canyons and deep valleys (below the mean ground
  // 12–30 km around) are darkened toward shadowed red rock — a dark line through cities and plains, as in A03
  // (position-only measure on a shared grid, wide texel ramp: no step between orbit tile levels)
  const kOrb = smoothstep01(700, 2600, texelM);
  const cavO = kOrb > 0 ? orbitCavity(F, a0, b0, da, db, T, tH, TB, mwT, texelM, stats) : null;
  for (let ty = 1; ty <= T; ty++) for (let tx = 1; tx <= T; tx++) {
    const k = ty * TB + tx, o = (ty - 1) * T + (tx - 1);
    let ao = albedo[o * 4 + 3] / 255;
    const gu = (tx - 1) / (T - 1), gv = (ty - 1) / (T - 1);
    if (aoGrid) {
      const pu = gu / aoStep + aoM, pv = gv / aoStep + aoM;
      const gi = Math.min(G - 2, Math.floor(pu)), gj = Math.min(G - 2, Math.floor(pv));
      const fu = pu - gi, fv = pv - gj;
      const g = (aoGrid[gj * G + gi] * (1 - fu) + aoGrid[gj * G + gi + 1] * fu) * (1 - fv) + (aoGrid[(gj + 1) * G + gi] * (1 - fu) + aoGrid[(gj + 1) * G + gi + 1] * fu) * fv;
      const oc = Math.max(0, g - occ[k]);
      ao *= 1 - 0.62 * oc / (oc + 9);
    }
    if (bandsAO) ao *= sampleBandsAO(bandsAO, gu, gv);
    if (cavO && normal[o * 4 + 3] < 200) {
      const d = cavO[o] * kOrb * 0.62;
      if (d > 0) {
        const o4 = o * 4;
        albedo[o4] = toSrgb8(srgbToLin(albedo[o4]) * (1 - d * 0.56));
        albedo[o4 + 1] = toSrgb8(srgbToLin(albedo[o4 + 1]) * (1 - d * 0.66));
        albedo[o4 + 2] = toSrgb8(srgbToLin(albedo[o4 + 2]) * (1 - d * 0.68));
      }
    }
    const cav = Math.max(0, blur[k] - tH[k]) / (texelM * 2.5);
    ao *= 1 - 0.22 * Math.min(1, cav);
    albedo[o * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao)) * 255);
  }

  // ------------------------------------------------------------------ water on the vertex grid
  let water = null, wl = null;
  if (vWater && (vWater.any || waterTexels > 0)) {
    water = {
      n: NV, type: vWater.type, level: vWater.level, depth: vWater.depth, flow: vWater.flow, dist: vWater.dist, width: vWater.width,
      mask: waterMask, maskRes: T, hasSea: vWater.hasSea, hasCanal: vWater.hasCanal, hasLake: vWater.hasLake,
      minLevel: vWater.minLevel, maxLevel: vWater.maxLevel,
    };
    if (vWater.any) {
      // shader water level: only levels the water mesh draws (canals narrower than 2 vertex spacings stay painted)
      wl = new Float32Array(TOTAL_VERTS * 2);
      const narrow = 2 * vs;
      for (let o = 0; o < GRID_VERTS; o++) {
        if (!vWater.set[o]) continue;
        const wdt = vWater.width[o], dst = vWater.dist[o];
        if (wdt > 0 && wdt < narrow && dst < wdt * 0.5 + 2.5 * vs) continue;
        wl[o * 2] = vWater.level[o]; wl[o * 2 + 1] = 1;
      }
      for (let e = 0; e < 4; e++) for (let t = 0; t < NV; t++) {
        const src = e === 0 ? t * NV : e === 1 ? t * NV + N : e === 2 ? t : N * NV + t, dst = GRID_VERTS + e * NV + t;
        wl[dst * 2] = wl[src * 2]; wl[dst * 2 + 1] = wl[src * 2 + 1];
      }
    }
  }

  // ------------------------------------------------------------------ mesh
  const positions = new Float32Array(TOTAL_VERTS * 3);
  const normals = new Float32Array(TOTAL_VERTS * 3);
  const morph = new Float32Array(TOTAL_VERTS * 3);
  const heights = new Float32Array(GRID_VERTS);
  const cxo = x & 1, cyo = y & 1;
  const P = new Float64Array(9);
  const Pp = (I, J, oo) => {      // parent mesh vertex (child-local parent index), rel. centre
    const k = (2 * J + 1) * NB + (2 * I + 1), r = R + pH[J * 33 + I];
    P[oo] = vDir[k * 3] * r - cx; P[oo + 1] = vDir[k * 3 + 1] * r - cy; P[oo + 2] = vDir[k * 3 + 2] * r - cz;
  };
  let bsx = 0, bsy = 0, bsz = 0;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = (j + 1) * NB + (i + 1), o = j * NV + i;
    const h = vH[k], r = R + h;
    const px = vDir[k * 3] * r - cx, py = vDir[k * 3 + 1] * r - cy, pz = vDir[k * 3 + 2] * r - cz;
    positions[o * 3] = px; positions[o * 3 + 1] = py; positions[o * 3 + 2] = pz;
    heights[o] = h;
    bsx += px; bsy += py; bsz += pz;
    normals[o * 3] = vN[o * 3]; normals[o * 3 + 1] = vN[o * 3 + 1]; normals[o * 3 + 2] = vN[o * 3 + 2];
    if (pH) {
      const ie = (i & 1) === 0, je = (j & 1) === 0;
      if (ie && je) Pp(i >> 1, j >> 1, 0);
      else if (!ie && je) { Pp(i >> 1, j >> 1, 3); Pp((i >> 1) + 1, j >> 1, 6); mid(P); }
      else if (ie && !je) { Pp(i >> 1, j >> 1, 3); Pp(i >> 1, (j >> 1) + 1, 6); mid(P); }
      else {
        const I0 = i >> 1, J0 = j >> 1;
        const gI = cxo * 32 + I0, gJ = cyo * 32 + J0;
        if (((gI + gJ) & 1) === 0) { Pp(I0, J0, 3); Pp(I0 + 1, J0 + 1, 6); }
        else { Pp(I0 + 1, J0, 3); Pp(I0, J0 + 1, 6); }
        mid(P);
      }
      morph[o * 3] = P[0] - px; morph[o * 3 + 1] = P[1] - py; morph[o * 3 + 2] = P[2] - pz;
    }
  }
  // skirts
  const sd = skirtDepth(level, geomErr);
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < NV; t++) {
      const src = e === 0 ? t * NV : e === 1 ? t * NV + N : e === 2 ? t : N * NV + t;
      const dst = GRID_VERTS + e * NV + t;
      const j = (src / NV) | 0, i = src % NV;
      const k = (j + 1) * NB + (i + 1);
      const r = R + vH[k] - sd;
      positions[dst * 3] = vDir[k * 3] * r - cx; positions[dst * 3 + 1] = vDir[k * 3 + 1] * r - cy; positions[dst * 3 + 2] = vDir[k * 3 + 2] * r - cz;
      normals[dst * 3] = normals[src * 3]; normals[dst * 3 + 1] = normals[src * 3 + 1]; normals[dst * 3 + 2] = normals[src * 3 + 2];
      morph[dst * 3] = morph[src * 3]; morph[dst * 3 + 1] = morph[src * 3 + 1]; morph[dst * 3 + 2] = morph[src * 3 + 2];
    }
  }
  // bounding sphere (relative to centre), including morph targets and skirts
  bsx /= GRID_VERTS; bsy /= GRID_VERTS; bsz /= GRID_VERTS;
  let br2 = 0;
  for (let vtx = 0; vtx < TOTAL_VERTS; vtx++) {
    const px = positions[vtx * 3] - bsx, py = positions[vtx * 3 + 1] - bsy, pz = positions[vtx * 3 + 2] - bsz;
    const d2 = px * px + py * py + pz * pz; if (d2 > br2) br2 = d2;
    const qx = px + morph[vtx * 3], qy = py + morph[vtx * 3 + 1], qz = pz + morph[vtx * 3 + 2];
    const e2 = qx * qx + qy * qy + qz * qz; if (e2 > br2) br2 = e2;
  }
  stats.msPost = now() - tPost;

  const result = {
    face, level, x, y, texRes: T,
    center: [cx, cy, cz],
    positions, normals, morph, heights,
    albedo, normal, emission: anyLight ? emission : null,
    water, wl, steep,
    minH, maxH, geomErr, skirt: sd,
    bsphere: [bsx, bsy, bsz, Math.sqrt(br2)],
    anyUrban, waterTexels, urban: !!urbanSample, urbanOk: !!urbanSample && urbanErrors === 0, urbanErrors,
    stats: { ...stats, ms: now() - t0 },
  };
  const transfer = [positions.buffer, normals.buffer, morph.buffer, heights.buffer, albedo.buffer, normal.buffer];
  if (anyLight) transfer.push(emission.buffer);
  if (wl) transfer.push(wl.buffer);
  if (water) {
    transfer.push(water.type.buffer, water.level.buffer, water.depth.buffer, water.flow.buffer, water.dist.buffer, water.width.buffer);
    if (waterMask) transfer.push(waterMask.buffer);
  }
  return { result, transfer };
}

function mid(P) { P[0] = (P[3] + P[6]) * 0.5; P[1] = (P[4] + P[7]) * 0.5; P[2] = (P[5] + P[8]) * 0.5; }

// --------------------------------------------------------------------------------------------
// LOD-consistent terrain sky visibility
// --------------------------------------------------------------------------------------------
/**
 * For each band scale r (metres) larger than ~4 texels: cavity depth c = h_lp(r) − h_lp(r/4) (heightAt
 * band limits: octaves finer than ~2·minWavelength fade out), i.e. how far the point lies below its
 * surroundings at that scale. Evaluated on a sparse grid inside the tile (grid spacing ≈ r/4) and
 * bilinearly interpolated; the result depends only on the position, not on the tile level.
 */
function terrainBandsAO(F, a0, b0, da, db, texelM, size, stats) {
  const bands = [];
  const d = new Float64Array(3);
  for (const r of AO_BANDS) {
    if (r < texelM * 4) continue;
    // grid spacing r/4 resolves the cavity field (band-limited at r/4 .. r) at Nyquist; ≤ 17² per band
    let n = Math.ceil(size / (r / 4)) + 1;
    n = Math.max(3, Math.min(17, n));
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      faceDir(F, a0 + da * i / (n - 1), b0 + db * j / (n - 1), d, 0);
      const hi = heightAt(d[0], d[1], d[2], r * 0.25), lo = heightAt(d[0], d[1], d[2], r);
      const c = lo - hi;                         // > 0: below the surroundings
      g[j * n + i] = c > 0 ? 1 - AO_STRENGTH * Math.min(1, (c / r) * AO_ALPHA) : 1;
    }
    stats.samplesAO += n * n * 2;
    bands.push({ n, g });
  }
  return bands.length ? bands : null;
}
/**
 * Disc-scale canyon / valley score (0..1) per texel for the orbit canyon lines: a texel lies below the mean ground of
 * a ±r-texel window (r·texel ≈ 12 km) AND that window is in strong relief (broad gentle basins stay untouched).
 * heightAt's band limits keep the big landforms (the ZR2 canyon, rifts) at every wavelength, so the AO bands
 * (h_lp(r) − h_lp(r/4)) are zero there; this measures them on the texel heights, extended by a margin of heightAt
 * samples beyond the tile (same band limit) so same-level neighbours agree along their edges.
 */
function orbitCavity(F, a0, b0, da, db, T, tH, TB, mwT, texelM, stats) {
  const r = Math.max(2, Math.min(10, Math.round(12000 / texelM)));
  const M = r + 1, G = T + 2 * M;
  const h = new Float64Array(G * G);
  const d = new Float64Array(3);
  let extra = 0;
  for (let gy = 0; gy < G; gy++) {
    const ty = gy - M;
    for (let gx = 0; gx < G; gx++) {
      const tx = gx - M;
      if (tx >= -1 && tx <= T && ty >= -1 && ty <= T) { h[gy * G + gx] = tH[(ty + 1) * TB + (tx + 1)]; continue; }
      faceDir(F, a0 + da * tx / (T - 1), b0 + db * ty / (T - 1), d, 0);
      h[gy * G + gx] = heightAt(d[0], d[1], d[2], mwT); extra++;
    }
  }
  stats.samplesAO += extra;
  const mean = new Float64Array(G * G), tmp = new Float64Array(G * G);
  boxBlur(h, tmp, G, r, true); boxBlur(tmp, mean, G, r, false);
  // separable window max / min
  const mx = new Float64Array(G * G), mn = new Float64Array(G * G), mx2 = new Float64Array(G * G), mn2 = new Float64Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let a = -Infinity, b = Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(G - 1, x + r); k++) { const v = h[y * G + k]; if (v > a) a = v; if (v < b) b = v; }
    mx[y * G + x] = a; mn[y * G + x] = b;
  }
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let a = -Infinity, b = Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(G - 1, y + r); k++) { const o = k * G + x; if (mx[o] > a) a = mx[o]; if (mn[o] < b) b = mn[o]; }
    mx2[y * G + x] = a; mn2[y * G + x] = b;
  }
  const rho = r * texelM;
  const out = new Float32Array(T * T);
  for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
    const o = (ty + M) * G + (tx + M);
    out[ty * T + tx] = smoothstep01(0.004, 0.018, (mean[o] - h[o]) / rho) * smoothstep01(0.03, 0.07, (mx2[o] - mn2[o]) / rho);
  }
  return out;
}
function smoothstep01(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const LIN_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const srgbToLin = (b) => LIN_LUT[b];
function sampleBandsAO(bands, u, v) {
  let ao = 1;
  for (let b = 0; b < bands.length; b++) {
    const { n, g } = bands[b];
    const pu = u * (n - 1), pv = v * (n - 1);
    const i = Math.min(n - 2, Math.floor(pu)), j = Math.min(n - 2, Math.floor(pv));
    const fu = pu - i, fv = pv - j;
    ao *= (g[j * n + i] * (1 - fu) + g[j * n + i + 1] * fu) * (1 - fv) + (g[(j + 1) * n + i] * (1 - fu) + g[(j + 1) * n + i + 1] * fu) * fv;
  }
  return ao;
}

/**
 * Shoreline clamp of the vertex grid (geometry only; deterministic per vertex, border vertices untouched so
 * same-level neighbours stay crack free). The water renderer covers exactly the texel water mask (iso-line 0.5)
 * and is depth-tested against the terrain, so the visible waterline is the mask wherever the mesh lies below the
 * water surface, and the mesh's own contour (a cell-periodic sawtooth on low banks, Z-04) wherever a triangle
 * inside the mask pokes above it. Every vertex whose 1-ring (±1 cell) touches wet mask texels (≥ 0.2, i.e. a
 * little dilated so finer upgraded masks stay inside) and that lies less than max(2 m, 10 % of the vertex
 * spacing) above its water level goes 0.3 m under that level (water vertices included). The wetness comes from
 * the mask, i.e. from hydro's classification: land BELOW a perched river's level behind its levee is not wet
 * (the old "fine ground below the level" probe pulled levee crests down in a grid pattern). Steep coasts are left
 * alone (their mesh waterline is already within a fraction of a vertex spacing).
 */
function shoreClamp(level, vH, NB, vw, mask, T, stats) {
  if (!mask) { stats.shoreClamped = 0; return 0; }
  const spacing = vertexWavelength(level);
  const lim = Math.max(2.0, 0.1 * spacing);
  const r = (T - 1) / N;                      // texels per cell
  const thr = 51;                             // 0.2 wet
  let n = 0;
  for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
    const o = j * NV + i;
    if (!vw.set[o]) continue;
    const k = (j + 1) * NB + (i + 1);
    const lv = vw.level[o], h = vH[k];
    if (h <= lv - 0.3 || h - lv > lim) continue;
    const tx0 = Math.max(0, Math.floor((i - 1) * r)), tx1 = Math.min(T - 1, Math.ceil((i + 1) * r));
    const ty0 = Math.max(0, Math.floor((j - 1) * r)), ty1 = Math.min(T - 1, Math.ceil((j + 1) * r));
    let wet = false;
    for (let ty = ty0; ty <= ty1 && !wet; ty++) { const row = ty * T; for (let tx = tx0; tx <= tx1; tx++) if (mask[row + tx] >= thr) { wet = true; break; } }
    if (!wet) continue;
    vH[k] = lv - 0.3;
    vw.depth[o] = 0.3;
    n++;
  }
  stats.shoreClamped = n;
  return n;
}

/** waterAt on the NV×NV vertex grid (+ shoreline level dilation) */
function vertexWater(vDir, vH, NB, stats) {
  const type = new Uint8Array(GRID_VERTS), level = new Float32Array(GRID_VERTS), depth = new Float32Array(GRID_VERTS);
  const flow = new Float32Array(GRID_VERTS * 2), dist = new Float32Array(GRID_VERTS), width = new Float32Array(GRID_VERTS);
  let hasSea = false, hasCanal = false, hasLake = false, minLevel = Infinity, maxLevel = -Infinity, maxWidth = 0;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = (j + 1) * NB + (i + 1), o = j * NV + i;
    let w = null;
    try { w = waterAt(vDir[k * 3], vDir[k * 3 + 1], vDir[k * 3 + 2], WS); } catch { w = null; }
    const t = w ? num(w.type, 0) | 0 : 0;
    const lvl = w ? num(w.level, 0) : 0;
    type[o] = t;
    level[o] = t ? lvl : 0;
    depth[o] = t ? lvl - vH[k] : -Math.max(0, vH[k]);
    dist[o] = w ? Math.min(1e9, num(w.dist, 1e9)) : 1e9;
    width[o] = w ? num(w.width, 0) : 0;
    if (w && w.flow) { flow[o * 2] = num(w.flow[0], 0); flow[o * 2 + 1] = num(w.flow[1], 0); }
    if (t === 1) hasSea = true; else if (t === 2) hasCanal = true; else if (t === 3) hasLake = true;
    if (t) { if (lvl < minLevel) minLevel = lvl; if (lvl > maxLevel) maxLevel = lvl; }
    if (width[o] > maxWidth && dist[o] < 1e8) maxWidth = width[o];
  }
  stats.samplesW += GRID_VERTS;
  const any = hasSea || hasCanal || hasLake;
  // `set`: vertices that carry a water level (water vertices + 3-vertex shoreline dilation) — the
  // same vertices the water renderer draws (its own dilation mirrors this one)
  const set = new Uint8Array(GRID_VERTS);
  if (any) {
    // dilate water levels into neighbouring land vertices so shoreline quads have a surface height
    for (let o = 0; o < GRID_VERTS; o++) set[o] = type[o] ? 1 : 0;
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
        const o = j * NV + i; if (set[o]) continue;
        let sum = 0, c = 0;
        if (i > 0 && set[o - 1]) { sum += level[o - 1]; c++; }
        if (i < N && set[o + 1]) { sum += level[o + 1]; c++; }
        if (j > 0 && set[o - NV]) { sum += level[o - NV]; c++; }
        if (j < N && set[o + NV]) { sum += level[o + NV]; c++; }
        if (c) add.push(o, sum / c);
      }
      for (let q = 0; q < add.length; q += 2) { level[add[q]] = add[q + 1]; set[add[q]] = 1; }
    }
    // shoreline (dilated) land vertices: depth below the neighbouring water level (may be > 0 where
    // the interpolated surface covers the vertex); other dry vertices keep -max(0, h) (never > 0,
    // also for dry land below sea level)
    for (let o = 0; o < GRID_VERTS; o++) if (!type[o] && set[o]) { const k = (((o / NV) | 0) + 1) * NB + (o % NV) + 1; depth[o] = level[o] - vH[k]; }
  }
  return { type, level, depth, flow, dist, width, set, any, hasSea, hasCanal, hasLake, maxWidth,
    minLevel: isFinite(minLevel) ? minLevel : 0, maxLevel: isFinite(maxLevel) ? maxLevel : 0 };
}

/**
 * Does the water mesh draw a surface at level `wl` over vertex quad (i0, j0)? All four corners must
 * carry a water level (water or shoreline-dilated vertex) and the interpolated surface must pass
 * through `wl` (within the corner level range ± tol: a steeply descending canal spans a range, a
 * different water body nearby does not). Canal width (≥ 2 vertex spacings) is checked by the caller.
 */
function quadHasLevel(vw, i0, j0, wl, wt) {
  if (!vw.any) return false;
  const set = vw.set, level = vw.level;
  const o = j0 * NV + i0;
  const c0 = o, c1 = o + 1, c2 = o + NV, c3 = o + NV + 1;
  if (!(set[c0] && set[c1] && set[c2] && set[c3])) return false;
  const l0 = level[c0], l1 = level[c1], l2 = level[c2], l3 = level[c3];
  const lo = Math.min(l0, l1, l2, l3), hi = Math.max(l0, l1, l2, l3);
  const tol = wt === 1 ? 0.75 : 0.5;
  return wl >= lo - tol && wl <= hi + tol;
}

/** legacy: could a texel in vertex quad (i0, j0) be water? Conservative test on vertex samples. */
function waterNear(vw, i0, j0, vs, h) {
  if (h < 1.5) return true;
  if (!vw.any && vw.maxWidth <= 0) return false;
  for (let dj = -1; dj <= 2; dj++) {
    const j = j0 + dj; if (j < 0 || j > N) continue;
    for (let di = -1; di <= 2; di++) {
      const i = i0 + di; if (i < 0 || i > N) continue;
      const o = j * NV + i;
      if (vw.type[o]) return true;
      if (vw.dist[o] < vs * 2.9 + vw.width[o] * 0.5 + 2) return true;   // canal distance is 1-Lipschitz
    }
  }
  return false;
}

/** separable box blur on a square G×G grid (horizontal when h=true) */
function boxBlur(src, dst, G, r, h) {
  const inv = 1 / (2 * r + 1);
  for (let a = 0; a < G; a++) {
    let acc = 0;
    for (let t = -r; t <= r; t++) { const b = Math.min(G - 1, Math.max(0, t)); acc += h ? src[a * G + b] : src[b * G + a]; }
    for (let b = 0; b < G; b++) {
      if (h) dst[a * G + b] = acc * inv; else dst[b * G + a] = acc * inv;
      const add = Math.min(G - 1, b + r + 1), sub = Math.max(0, b - r);
      acc += h ? src[a * G + add] - src[a * G + sub] : src[add * G + a] - src[sub * G + a];
    }
  }
}

// --------------------------------------------------------------------------------------------
// coarse-texel urban lattice (bilinear continuous fields, dominant discrete fields)
// --------------------------------------------------------------------------------------------
const UF_CONT = ['coverage', 'roof', 'height', 'light', 'lightGround', 'lightTemp', 'lightOnset', 'districtTone', 'fabric', 'fabricR', 'fabricG', 'fabricB', 'green', 'road', 'farm', 'water'];
const UF_DISC = ['cls', 'roofKind', 'landUse', 'farmCrop', 'farmStage', 'parcelId', 'blockId'];
const LAT = { cap: 0 };
function urbanLattice(HN) {
  const n = HN * HN;
  if (LAT.cap < n) {
    LAT.cap = n;
    LAT.cont = UF_CONT.map(() => new Float32Array(n));
    LAT.disc = UF_DISC.map(() => new Float64Array(n));
    LAT.has = new Uint8Array(n);
    LAT.hasFabric = new Uint8Array(n);
  }
  return LAT;
}
function storeLattice(L, q, u) {
  if (!u) { L.has[q] = 0; for (let f = 0; f < UF_CONT.length; f++) L.cont[f][q] = 0; for (let f = 0; f < UF_DISC.length; f++) L.disc[f][q] = 0; return; }
  L.has[q] = 1;
  L.hasFabric[q] = typeof u.fabric === 'number' ? 1 : 0;
  for (let f = 0; f < UF_CONT.length; f++) L.cont[f][q] = num(u[UF_CONT[f]], 0);
  for (let f = 0; f < UF_DISC.length; f++) L.disc[f][q] = num(u[UF_DISC[f]], 0);
}
const LU_OUT = {};
/** bilinear (continuous) / dominant-weight (discrete) lattice sample at lattice coords (mx, my) */
function sampleLattice(L, HN, mx, my) {
  let n0 = Math.floor(mx), m0 = Math.floor(my);
  if (n0 > HN - 2) n0 = HN - 2; if (m0 > HN - 2) m0 = HN - 2;
  const fx = mx - n0, fy = my - m0;
  const q00 = m0 * HN + n0, q10 = q00 + 1, q01 = q00 + HN, q11 = q01 + 1;
  if (!(L.has[q00] | L.has[q10] | L.has[q01] | L.has[q11])) return null;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  for (let f = 0; f < UF_CONT.length; f++) {
    const a = L.cont[f];
    LU_OUT[UF_CONT[f]] = a[q00] * w00 + a[q10] * w10 + a[q01] * w01 + a[q11] * w11;
  }
  // fabric colour is a colour of the fabric part: re-weight by fabric so empty nodes do not darken it
  const fa = L.cont[8];
  const fw = fa[q00] * w00 + fa[q10] * w10 + fa[q01] * w01 + fa[q11] * w11;
  if (fw > 1e-6) {
    for (let c = 9; c <= 11; c++) {
      const a = L.cont[c];
      LU_OUT[UF_CONT[c]] = (a[q00] * fa[q00] * w00 + a[q10] * fa[q10] * w10 + a[q01] * fa[q01] * w01 + a[q11] * fa[q11] * w11) / fw;
    }
  }
  // light temperature / onset weighted by light
  const la = L.cont[3];
  const lw = la[q00] * w00 + la[q10] * w10 + la[q01] * w01 + la[q11] * w11;
  if (lw > 1e-6) {
    for (const c of [5, 6]) {
      const a = L.cont[c];
      LU_OUT[UF_CONT[c]] = (a[q00] * la[q00] * w00 + a[q10] * la[q10] * w10 + a[q01] * la[q01] * w01 + a[q11] * la[q11] * w11) / lw;
    }
  }
  // discrete fields from the dominant node
  let best = q00, bw = w00;
  if (w10 > bw) { bw = w10; best = q10; } if (w01 > bw) { bw = w01; best = q01; } if (w11 > bw) { best = q11; }
  for (let f = 0; f < UF_DISC.length; f++) LU_OUT[UF_DISC[f]] = L.disc[f][best];
  if (!L.hasFabric[best]) delete LU_OUT.fabric; else if (LU_OUT.fabric === undefined) LU_OUT.fabric = fw;
  return LU_OUT;
}
