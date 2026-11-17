// Sluice jets (W3, fix round 2): the water pouring through the OPEN gate bays of canal sluice stations. OWNER: water agent.
//
// The terrain-tile water surfaces stop at the hydro level step (the gate line of the station: urban centres the station
// on the sluice, building x = 0), so without this layer an open bay shows nothing between the retained pool and the tail
// water 3–12 m below. For every sluice_station near the camera (specs from the city's 'city:tile' events) and every bay
// that buildings-o draws open (buildings/types/sluice_station.js gateLayout, imported lazily: exactly the station's gate
// leaves, same rule at every LOD), this layer draws, in the station's pool frame (buildings-o o_common.js waterInfo
// geometry, replicated below):
//   * the draw-down of the retained level towards the sill (critical depth 2/3 of the head over the sill),
//   * the accelerating, thinning jet down the glacis / drop (Mars g = 3.72 m/s²), aerated white as it speeds up,
//   * the hydraulic jump (fix round 3, W2): ONE grid across the whole stilling basin (training wall to wall) fed by every
//     open bay — a white, boiling roller from the plunge point (front ≤ 0.6 m above the tail water, vertex boils), collapsing
//     over ≈ 6 conjugate depths (Froude number of the toe jet), then a foam carpet torn into streaks along the flow that the
//     tile surface's plume foam (tiles.js, from the same hydro sluice records) continues downstream; a closed bay leaves a
//     calm wedge that the neighbouring jets close downstream. The chute jet is white water after ~35 % of the drop, with
//     roll waves (vertex relief) and bump-mapped foam lumps.
// Closed bays get nothing (the leaf holds the pool: 停用闸孔下方的水比泄流口平静). Streaky aerated texture scrolled along the
// flow with the water clock (frozen while the view is still, like the waves). Drawn within ~4 km.
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { latLonToUnit, buildingAxes } from '../../core/geo.js';
import { hash4, hashString } from '../../core/hash.js';
import { createSprayMaterial } from './spray.js';

const G = 3.72;
const SIDES = ['front', 'right', 'back', 'left'];
const VIS_M = 4000, DROP_M = 5000;
const SPRAY_PER_BAY = 12;         // spray streaks rising off the plunge of every open bay (spray.js material)

let GATE = null, GATE_LOADING = null;
function loadGate() {
  if (GATE || GATE_LOADING) return;
  GATE_LOADING = import('../../buildings/types/sluice_station.js')
    .then((m) => { GATE = typeof m.gateLayout === 'function' ? m : { gateLayout: null }; })
    .catch((err) => { console.warn('[water] sluice gate layout unavailable', err); GATE = { gateLayout: null }; });
}

const VERT_PARS = /* glsl */`
attribute vec4 aSj;          // x: metres downstream of the gate line, y: across (pool-frame z, metres), z: aeration / foam cover 0..1, w: speed m/s
attribute float aSjA;        // opacity envelope (fades into the tile surfaces at the ends / free lateral edges)
attribute vec2 aSjB;         // x: relief amplitude (m; roll waves on the chute, boils on the jump), y: kind 0 jet, 1 jump roller, 2 foam carpet
uniform float uSjTime;
varying vec4 vSj;
varying float vSjA;
varying vec2 vSjB;
float sjVHash( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1030 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }
float sjVNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sjVHash( i ), sjVHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( sjVHash( i + vec2( 0.0, 1.0 ) ), sjVHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
`;
// relief (fix round 3, W2): roll waves running down the chute at the jet speed, boils welling up on the jump roller and
// drifting downstream — the white water is a heaving, lumpy surface, not a smooth ramp
const VERT_BEGIN = /* glsl */`
vSj = aSj; vSjA = aSjA; vSjB = aSjB;
{
  float sxs = aSj.x, szs = aSj.y, ssp = aSj.w, st = uSjTime;
  float sh;
  if ( aSjB.y < 0.5 ) {
    float ph = ( sxs - ssp * st ) / 1.7 + 0.35 * sin( szs * 1.3 ) + 0.2 * sin( szs * 3.1 + 1.0 );
    sh = 0.6 * sin( 6.2831853 * ph ) + 0.4 * ( sjVNoise( vec2( szs * 1.6, ( sxs - ssp * st ) * 0.9 ) ) * 2.0 - 1.0 );
  } else {
    vec2 q = vec2( ( sxs - 1.2 * st ) * 0.5, szs * 0.55 );
    float b = sjVNoise( q + vec2( 0.0, st * 0.31 ) ) * 0.62 + sjVNoise( q * 2.3 + vec2( 3.7, - st * 0.47 ) ) * 0.38;
    sh = b * b * 1.8 - 0.3;
  }
  transformed += objectNormal * ( sh * aSjB.x );
  // the roller / carpet ride a few cm over the tile surface, whose log-depth bias pulls it up to 1e-4 of the distance
  // (≤ 0.25 m) towards the camera: lift them by more than that (no z-fight / swallowed foam at mid range)
  if ( aSjB.y > 0.5 ) transformed.y += min( 0.32, 1.4e-4 * length( ( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz ) );
}
`;
const FRAG_PARS = /* glsl */`
uniform float uSjTime;
varying vec4 vSj;
varying float vSjA;
varying vec2 vSjB;
float sjHash( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1030 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }
float sjNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sjHash( i ), sjHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( sjHash( i + vec2( 0.0, 1.0 ) ), sjHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
// bump-mapped normal from a procedural height (metres) via screen-space derivatives (three's perturbNormalArb)
vec3 sjBump( vec3 surfPos, vec3 surfNorm, float h, float fd ) {
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * fd;
  vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;
const FRAG_MAP = /* glsl */`
{
  float xi = vSj.x, zc = vSj.y, aer = vSj.z, sp = vSj.w, kind = vSjB.y;
  float tS = uSjTime * sp;
  float px = max( length( fwidth( vec2( zc, xi ) ) ), 1e-3 );          // metres per pixel
  float n;
  if ( kind < 0.5 ) {
    // jet: aerated streaks along the flow (stretched noise scrolled downstream at the local speed)
    float n1 = sjNoise( vec2( zc * 0.9, ( xi - tS ) * 0.55 ) );
    float n2 = sjNoise( vec2( zc * 2.3 + 7.0, ( xi - tS ) * 1.6 ) );
    float n3 = sjNoise( vec2( zc * 5.5 + 3.0, ( xi - tS * 1.1 ) * 4.0 ) );
    n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
  } else {
    // jump roller: boiling foam cells drifting downstream; carpet: the foam torn into streaks along the flow
    vec2 q = vec2( xi - tS, zc );
    float b1 = sjNoise( q * vec2( 0.42, 0.55 ) + vec2( 0.0, uSjTime * 0.21 ) );
    float b2 = sjNoise( q * vec2( 1.25, 1.5 ) + vec2( 5.1, - uSjTime * 0.33 ) );
    float b3 = sjNoise( q * vec2( 3.4, 4.0 ) + vec2( 1.7, 2.9 ) );
    float s1 = sjNoise( vec2( ( xi - tS ) * 0.16, zc * 1.3 ) );
    float s2 = sjNoise( vec2( ( xi - tS ) * 0.5 + 9.0, zc * 3.7 ) );
    float nb = b1 * 0.5 + b2 * 0.32 + b3 * 0.18, ns = s1 * 0.55 + s2 * 0.25 + b3 * 0.2;
    n = mix( nb, ns, smoothstep( 1.2, 1.8, kind ) );
  }
  // sub-pixel detail averages out (coverage, not noise, at a distance)
  n = mix( 0.5, n, mix( 0.3, 1.0, 1.0 - smoothstep( 0.08, 0.9, px ) ) );
  // cover: the aeration sets the threshold, the noise tears it (solid white at full aeration, patches / streaks as it thins)
  float foam = smoothstep( 0.0, 1.0, ( aer - 0.5 ) * 2.6 + ( n - 0.5 ) * 2.2 + 0.5 );
  vec3 clear = kind > 0.5 ? vec3( 0.05, 0.17, 0.17 ) : vec3( 0.04, 0.15, 0.16 );   // milky aerated water / glassy tongue
  vec3 white = vec3( 0.90, 0.92, 0.92 );
  // inside the white water: grooves between streaks / gaps between foam cells darker (bubbles, shadowed crevices)
  float shade = mix( 0.70, 1.0, smoothstep( 0.22, 0.78, n ) );
  diffuseColor.rgb = mix( clear, white * shade, foam );
  float aClear = kind > 1.5 ? 0.0 : kind > 0.5 ? 0.55 : 0.62;
  diffuseColor.a = clamp( vSjA * mix( aClear, 0.985, foam ), 0.0, 1.0 );
  sjRough = mix( 0.07, 0.72, foam );
  sjH = ( n - 0.5 ) * ( 0.04 + 0.1 * foam ) * ( 1.0 - smoothstep( 0.1, 0.9, px ) );   // foam lumps (bump, metres)
}
`;

/** pool-frame geometry of a sluice station (buildings-o o_common.js waterInfo + sluice_station.js gateStructure) */
export function stationGeometry(s) {
  const m = s.meta || {};
  const sl = m.sluice, W = m.water;
  if (!sl || !W) return null;
  const width = +W.width;
  if (!(width > 2)) return null;
  const side = SIDES.includes(m.poolSide) ? m.poolSide : SIDES.includes(m.intakeSide) ? m.intakeSide : 'back';
  const fb = side === 'front' || side === 'back';
  const fp = s.footprint || {};
  let w = +fp.w, d = +fp.d;
  if (Array.isArray(fp.points) && fp.points.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of fp.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    w = x1 - x0; d = z1 - z0;
  }
  w = Math.max(4, w || 20); d = Math.max(4, d || 14);
  const hd = fb ? d / 2 : w / 2;
  const dist = W.dist === null || W.dist === undefined || W.dist === '' ? NaN : +W.dist;
  const gap = Number.isFinite(dist) ? Math.max(0.5, dist - width / 2 - hd) : Math.max(2, 22 - hd);
  const e = Number.isFinite(+s.ground?.entrance) ? +s.ground.entrance : 0;
  let upR = +sl.up - e, dnR = +sl.down - e;
  if (!Number.isFinite(upR) || !Number.isFinite(dnR)) return null;
  if (dnR > upR) { const t = upR; upR = dnR; dnR = t; }
  const up = Math.max(-35, Math.min(15, upR));
  const down = Math.max(up - 16, Math.min(up - 0.15, dnR));
  const rot = side === 'back' ? 0 : side === 'front' ? Math.PI : side === 'left' ? Math.PI / 2 : -Math.PI / 2;
  let f = 1;
  if (sl.upSide === 'left' || sl.upSide === 'right') f = sl.upSide === 'left' ? 1 : -1;
  else if (W.flow === -1 || W.flow === 'left') f = -1;
  const flow = side === 'front' ? -f : f;
  const depth = Math.max(1.6, Math.min(3.2, 1.5 + width * 0.02));
  return { width, hd, gap, up, down, rot, flow, bedU: up - depth, bedD: down - depth, entrance: e };
}

/** hydraulics of a station's open bays (same numbers for every bay: one profile per station) */
export function jetProfile(Gm) {
  const fl = Gm.flow, up = Gm.up, down = Gm.down;
  const sill = Gm.bedU + 0.15;
  const H = Math.max(0.3, up - sill);                       // head over the sill
  const yc = (2 / 3) * H;                                    // critical depth at the sill (free overflow)
  const q = yc * Math.sqrt(G * yc);                          // discharge per metre width
  const basinBed = Gm.bedD - 1.0;
  const drop = Math.max(0, Gm.bedU - basinBed);
  const xc0 = 0.35, chute = Math.max(1.2, drop * (drop > 4 ? 0.7 : 1.2)), xc1 = xc0 + chute;
  const drowned = down > sill + 0.85 * yc;                   // tail water above the jet: submerged flow, boil only
  // profile samples (xi = metres downstream of the gate line)
  // The tile surface stays flat at the retained level up to its last vertex before the gate line (≤ one vertex spacing
  // upstream), so the sheet runs 3 cm under it (hidden by it where both exist, filling the gap where the tile ends early)
  // and the visible draw-down is the brink: the surface curving down over the gate sill into the jet.
  const xs = [];
  for (let x = -3.0; x < -0.4; x += 0.4) xs.push(x);
  for (let k = 0; k <= 8; k++) xs.push(-0.4 + ((xc0 + 0.4) * k) / 8);
  for (let k = 1; k <= 28; k++) xs.push(xc0 + (chute * k) / 28);
  const prof = [];
  let xp = null, vToe = Math.sqrt(G * yc);
  const yBrink = sill + 0.9 * yc;
  // aeration (W2, fix round 3): the turbulent boundary layer reaches the surface a little below the brink, then the jet
  // is white water: fully aerated after ~35 % of the drop (less on low glacis steps)
  const aerMax = Math.min(1, 0.55 + 0.12 * drop);
  for (const x of xs) {
    let y, aer, sp, rel;
    if (x < -0.4) {
      const t = (x + 3) / 2.6;
      y = up - 0.03; aer = 0.0; sp = 0.4 + 0.8 * t; rel = 0.0;
    } else if (x <= xc0) {
      // brink: smooth fall from the pool level to the critical section at the sill end (glassy tongue)
      const t = (x + 0.4) / (xc0 + 0.4), s = 0.5 - 0.5 * Math.cos(Math.PI * t);
      y = up - 0.03 - (up - 0.03 - yBrink) * s;
      aer = 0.04 * s; sp = 1.2 + (Math.sqrt(G * yc) - 1.2) * s; rel = 0.004 + 0.01 * s;
    } else {
      const bed = Gm.bedU - ((x - xc0) / chute) * drop;
      const v = Math.sqrt(G * yc + 2 * G * Math.max(0, Gm.bedU - bed));
      const th = Math.max(0.12, q / v);
      y = bed + th + 0.03;
      const f = Math.min(1, (Gm.bedU - bed) / Math.max(1.0, 0.35 * drop));
      aer = aerMax * (0.22 + 0.78 * f * f * (3 - 2 * f));
      sp = v; vToe = v;
      rel = (0.02 + 0.07 * aer) * Math.min(1, th / 0.25 + 0.3);
    }
    if (!drowned && x > xc0 && y <= down + 0.02) { xp = x; prof.push({ x, y: down + 0.02, aer: aerMax, sp: sp * 0.6, rel: 0.05 }); break; }
    if (drowned && x > xc0) { xp = x; break; }
    prof.push({ x, y, aer, sp, rel });
  }
  if (xp === null) xp = xc1;
  // hydraulic jump: incoming depth / Froude number -> roller length (≈ 6 conjugate depths, bounded by the basin) and the
  // height of the boiling front above the tail water
  const y1 = Math.max(0.12, q / Math.max(0.5, vToe));
  const Fr = vToe / Math.sqrt(G * y1);
  const y2 = 0.5 * y1 * (Math.sqrt(1 + 8 * Fr * Fr) - 1);
  const Lb = Math.max(12, 6 + drop * 1.4);
  const Lr = Math.min(Lb + 2, Math.max(5, 6 * Math.min(y2, Math.max(0.6, down - basinBed) * 1.3)));
  const hJ = Math.min(0.6, 0.1 * Math.sqrt(Math.max(0.3, drop) * Math.max(0.5, yc)) + (drowned ? 0.12 : 0.18));
  return { fl, prof, xp, Lr, hJ, drowned, drop, yc, q, vToe, Fr, chute, xc0, xc1, Lb, basinBed, down };
}

/**
 * Sheet vertices of one open bay's jet (brink + chute) in the pool frame (x along the canal, flow = ±1 along x; z across,
 * bay z0..z1). Returns {pos, nrm, sj, alpha, sjb, cols, rows}.
 */
export function baySheet(Gm, z0, z1, P = jetProfile(Gm)) {
  const fl = Gm.flow, prof = P.prof;
  const cols = 11, rows = prof.length;
  const pos = new Float32Array(rows * cols * 3), nrm = new Float32Array(rows * cols * 3), sj = new Float32Array(rows * cols * 4), alpha = new Float32Array(rows * cols), sjb = new Float32Array(rows * cols * 2);
  const za = Math.min(z0, z1) + 0.04, zb = Math.max(z0, z1) - 0.04;
  for (let r = 0; r < rows; r++) {
    const p = prof[r], pa = prof[Math.max(0, r - 1)], pb = prof[Math.min(rows - 1, r + 1)];
    const dx = (pb.x - pa.x) || 1e-3, dy = pb.y - pa.y;
    // normal in the pool frame: perpendicular to the profile tangent (fl·dx, dy)
    let nx = -dy * fl, ny = dx; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const aEnd = Math.min(1, (p.x + 3) / 1.6);
    for (let c = 0; c < cols; c++) {
      const ac = c / (cols - 1), z = za + (zb - za) * ac;
      const o = r * cols + c;
      pos[o * 3] = p.x * fl; pos[o * 3 + 1] = p.y; pos[o * 3 + 2] = z;
      nrm[o * 3] = nx; nrm[o * 3 + 1] = ny; nrm[o * 3 + 2] = 0;
      // the jet is a little thinner / less aerated along the pier faces
      const edge = Math.min(ac, 1 - ac);
      sj[o * 4] = p.x; sj[o * 4 + 1] = z; sj[o * 4 + 2] = p.aer * (0.85 + 0.15 * Math.min(1, edge * 8)); sj[o * 4 + 3] = p.sp;
      sjb[o * 2] = p.rel * Math.min(1, edge * 6); sjb[o * 2 + 1] = 0;
      // soft lateral edges that widen downstream (between the piers within ~0.25 m of the pier faces)
      const em = edge * (zb - za), fw = 0.25 + 0.16 * Math.max(0, p.x - 5);
      const ef = Math.min(1, em / fw);
      alpha[o] = Math.max(0, aEnd) * ef * ef * (3 - 2 * ef);
    }
  }
  return { pos, nrm, sj, alpha, sjb, cols, rows };
}

/**
 * The hydraulic jump of a station (one grid across the whole stilling basin, every open bay feeding it): a white,
 * boiling roller from the plunge point (front rising ~hJ above the tail water, boils), collapsing over ≈ 6 conjugate
 * depths, then a foam carpet torn into streaks along the flow that hands over to the tile plume. Cover per vertex = the
 * open bays' jets spreading sideways past the pier ends (zero below a closed bay away from its open neighbours: the
 * tile surface shows calm water there). ctx: {zMin, zMax (basin walls), xPier (pier end, metres downstream)}.
 */
export function jumpGrid(Gm, bays, P = jetProfile(Gm), ctx = {}) {
  const open = bays.filter((b) => b.open);
  if (!open.length) return null;
  const fl = Gm.flow, down = Gm.down, xp = P.xp, Lr = P.Lr, hJ = P.hJ;
  const zMin = Number.isFinite(ctx.zMin) ? ctx.zMin : Math.min(...open.map((b) => Math.min(b.z0, b.z1))) - 2;
  const zMax = Number.isFinite(ctx.zMax) ? ctx.zMax : Math.max(...open.map((b) => Math.max(b.z0, b.z1))) + 2;
  const xPier = Number.isFinite(ctx.xPier) ? ctx.xPier : 6.4;
  const Lc = Math.min(32, Math.max(12, 1.5 * Lr));
  // rows: front (plunge, 2.1 m), roller, carpet
  const xs = [];
  const xf0 = xp - 0.6, xf1 = xp + 1.5, xr1 = xp + Lr, xe = xr1 + Lc;
  for (let k = 0; k <= 6; k++) xs.push(xf0 + (xf1 - xf0) * k / 6);
  for (let k = 1; k <= 22; k++) xs.push(xf1 + (xr1 - xf1) * k / 22);
  for (let k = 1; k <= 14; k++) xs.push(xr1 + (xe - xr1) * k / 14);
  const width = zMax - zMin;
  const cols = Math.max(9, Math.min(61, Math.ceil(width / 0.9) + 1)), rows = xs.length;
  const pos = new Float32Array(rows * cols * 3), nrm = new Float32Array(rows * cols * 3), sj = new Float32Array(rows * cols * 4), alpha = new Float32Array(rows * cols), sjb = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    const x = xs[r];
    let y, aerX, relX, spX, kind;
    if (x <= xf1) {
      const t = Math.min(1, Math.max(0, (x - xf0) / (xf1 - xf0)));
      y = down + 0.03 + hJ * (0.3 + 0.7 * t * t * (3 - 2 * t));
      aerX = 1; relX = 0.3 * hJ + 0.08; spX = 3.2 - 0.8 * t; kind = 1;
    } else if (x <= xr1) {
      const t = (x - xf1) / (xr1 - xf1);
      y = down + 0.03 + hJ * Math.pow(1 - t, 1.5);
      aerX = 1 - 0.42 * t * t; relX = (0.3 * hJ + 0.08) * Math.pow(1 - t, 1.1) + 0.03; spX = 2.4 - 1.2 * t; kind = 1 + t * t * 0.6;
    } else {
      const t = (x - xr1) / (xe - xr1);
      y = down + 0.03;
      aerX = 0.58 * Math.pow(1 - t, 1.25); relX = 0.03 * (1 - t); spX = 1.2 - 0.4 * t; kind = 2;
    }
    const endA = Math.min(1, (x - xf0) / 0.6) * (r >= rows - 4 ? (rows - 1 - r) / 4 : 1);
    const sig = x < xPier ? 0.18 : 0.3 + 0.3 * (x - xPier);          // jets spread sideways past the pier ends
    for (let c = 0; c < cols; c++) {
      const z = zMin + width * c / (cols - 1);
      let cov = 0;
      for (const b of open) {
        const b0 = Math.min(b.z0, b.z1), b1 = Math.max(b.z0, b.z1);
        const dd = z < b0 ? b0 - z : z > b1 ? z - b1 : 0;
        cov = Math.max(cov, Math.exp(-(dd * dd) / (sig * sig)));
      }
      const o = r * cols + c;
      pos[o * 3] = x * fl; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      nrm[o * 3] = 0; nrm[o * 3 + 1] = 1; nrm[o * 3 + 2] = 0;
      sj[o * 4] = x; sj[o * 4 + 1] = z; sj[o * 4 + 2] = aerX * Math.min(1, cov * 1.15); sj[o * 4 + 3] = spX;
      sjb[o * 2] = relX * cov; sjb[o * 2 + 1] = kind;
      // free edges fade with the cover (calm water below closed bays); the training walls cut the sheet
      alpha[o] = Math.max(0, endA) * Math.min(1, cov * cov * 4.0);
    }
  }
  // normals from the y profile along x (pool frame, rows share x)
  for (let r = 0; r < rows; r++) {
    const ra = Math.max(0, r - 1), rb = Math.min(rows - 1, r + 1);
    const dx = (xs[rb] - xs[ra]) || 1e-3, dy = pos[(rb * cols) * 3 + 1] - pos[(ra * cols) * 3 + 1];
    let nx = -dy * fl, ny = dx; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    for (let c = 0; c < cols; c++) { const o = r * cols + c; nrm[o * 3] = nx; nrm[o * 3 + 1] = ny; }
  }
  return { pos, nrm, sj, alpha, sjb, cols, rows };
}

/**
 * Station geometry + bays [{z0, z1, open}] in the pool frame: buildings-o's own pure `sluiceGateGeometry(spec)` when that
 * module exports one (feature-detected; same field names), else the replica above + `gateLayout`.
 */
function stationBays(s) {
  if (!GATE) return null;
  if (typeof GATE.sluiceGateGeometry === 'function') {
    try {
      const g = GATE.sluiceGateGeometry(s);
      if (g && Array.isArray(g.bays) && Number.isFinite(g.up) && Number.isFinite(g.down)) {
        const Gm = { width: g.width, hd: 0, gap: 0, up: g.up, down: g.down, rot: g.rot || 0, flow: g.flow || 1, bedU: g.bedU ?? g.up - 2.4, bedD: g.bedD ?? g.down - 2.4, entrance: +s.ground?.entrance || 0, zE: g.zE };
        return { Gm, zE: g.zE, bays: g.bays.map((b) => ({ z0: b.z0, z1: b.z1, open: !!b.open })), discharging: g.bays.some((b) => b.open) };
      }
    } catch { /* fall back to the replica */ }
  }
  if (typeof GATE.gateLayout !== 'function') return null;
  const Gm = stationGeometry(s);
  if (!Gm) return null;
  let lay = null;
  try { lay = GATE.gateLayout(s, Gm.width); } catch { lay = null; }
  if (!lay) return null;
  const n = lay.n, tp = 1.5, bw = (Gm.width - (n - 1) * tp) / n, zE = -Gm.hd - Gm.gap;
  const bays = [];
  for (let i = 0; i < n; i++) { const z1 = zE - i * (bw + tp); bays.push({ z0: z1 - bw, z1, open: !!lay.open[i] }); }
  return { Gm, zE, bays, discharging: !!lay.discharging };
}

export class SluiceJetLayer {
  constructor(app, water) {
    this.app = app;
    this.water = water;
    this.group = new THREE.Group();
    this.group.name = 'water.sluiceJets';
    this.group.matrixAutoUpdate = false;
    this.stations = new Map();      // building id -> {spec, tiles:Set, anchor, quat, mesh|null, dead}
    this.byTile = new Map();        // city tile key -> [ids]
    this.u = { uSjTime: { value: 0 } };
    this.uSp = { uSpTime: { value: 0 }, uSpOpacity: { value: 0.34 } };
    this.sprayMat = null;
    this.mat = null;
    this.stats = { stations: 0, meshes: 0, bays: 0, spans: 0 };
    // open-bay spans per station (persistent, small): the tile plumes put the white water below the open bays only
    this.spanInfo = new Map();      // building id -> {u, up, down, spans:[[l0, l1] metres left of the flow]}
    this.spanCells = new Map();     // ~220 m cell key -> [info]
    this._gateHooked = false;
    const ev = app.events;
    ev?.on?.('city:tile', ({ tile, data }) => this._addTile(tile, data));
    ev?.on?.('city:tile-remove', ({ key }) => this._removeTile(key));
  }

  _addTile(tile, data) {
    const key = tile?.key;
    if (!key || !data?.buildings) return;
    const ids = [];
    for (const b of data.buildings) {
      if (b.use !== 'sluice_station' || !b.meta?.sluice || !b.meta?.water) continue;
      ids.push(b.id);
      let st = this.stations.get(b.id);
      if (!st) { st = { spec: b, tiles: new Set(), mesh: null, anchor: null, quat: null, dead: false }; this.stations.set(b.id, st); }
      st.tiles.add(key);
      if (GATE) this._spans(st.spec);
    }
    if (!ids.length) return;
    this.byTile.set(key, ids);
    loadGate();
    if (!GATE && !this._gateHooked && GATE_LOADING) {
      this._gateHooked = true;
      GATE_LOADING.then(() => { for (const st of this.stations.values()) this._spans(st.spec); });
    }
  }

  static _cell(lat, lon) { return `${Math.round(lat * 500)},${Math.round(lon * 500)}`; }

  /** open-bay spans of a station (metres left of the flow from the canal centreline) at its gate-line centre */
  _spans(s) {
    if (this.spanInfo.has(s.id) || !GATE) return;
    const st = stationBays(s);
    if (!st) { this.spanInfo.set(s.id, null); return; }
    const Gm = st.Gm, zc = st.zE - Gm.width / 2;
    const spans = [];
    for (const b of st.bays) {
      if (!b.open) continue;
      const l0 = -(b.z0 - zc) * Gm.flow, l1 = -(b.z1 - zc) * Gm.flow;  // left of the flow = −z·flow in the pool frame
      spans.push([Math.min(l0, l1), Math.max(l0, l1)]);
    }
    // gate-line centre on the canal centreline: pool (0, zc) -> building frame (rotY) -> ECEF unit vector
    const c = Math.cos(Gm.rot), sn = Math.sin(Gm.rot), bx = zc * sn, bz = zc * c;
    const ax = buildingAxes(s.lat, s.lon, s.heading || 0), u0 = latLonToUnit(s.lat, s.lon);
    const px = u0.x * R + bx * ax.x[0] + bz * ax.z[0], py = u0.y * R + bx * ax.x[1] + bz * ax.z[1], pz = u0.z * R + bx * ax.x[2] + bz * ax.z[2];
    const l = Math.hypot(px, py, pz);
    const sl = s.meta.sluice, a = +sl.up, b = +sl.down;
    const info = { id: s.id, u: { x: px / l, y: py / l, z: pz / l }, up: Math.max(a, b), down: Math.min(a, b), spans, discharging: st.discharging };
    this.spanInfo.set(s.id, info);
    const lat = Math.asin(info.u.y) * 180 / Math.PI, lon = Math.atan2(info.u.x, info.u.z) * 180 / Math.PI;
    const k = SluiceJetLayer._cell(lat, lon);
    if (!this.spanCells.has(k)) this.spanCells.set(k, []);
    this.spanCells.get(k).push(info);
    this.stats.spans = this.spanInfo.size;
    try { this.water?._sluiceSpansChanged?.(info.u); } catch { /* optional */ }
  }

  /**
   * Hydro sluice records [{u, up, down, ...}] -> the same records, with `spans` attached where a station's open bays
   * are known (same levels within 3 cm, gate-line centre within 40 m)
   */
  attachSpans(records) {
    if (!records || !records.length || !this.spanCells.size) return records;
    let out = null;
    for (let k = 0; k < records.length; k++) {
      const r = records[k];
      if (!r.open || !r.u) continue;
      const lat = Math.asin(Math.max(-1, Math.min(1, r.u.y))) * 180 / Math.PI, lon = Math.atan2(r.u.x, r.u.z) * 180 / Math.PI;
      const ci = Math.round(lat * 500), cj = Math.round(lon * 500);
      let best = null, bd = 40;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const info of this.spanCells.get(`${ci + di},${cj + dj}`) || []) {
          if (Math.abs(info.up - r.up) > 0.03 || Math.abs(info.down - r.down) > 0.03) continue;
          const d = Math.hypot(info.u.x - r.u.x, info.u.y - r.u.y, info.u.z - r.u.z) * R;
          if (d < bd) { bd = d; best = info; }
        }
      }
      if (!best || !best.spans.length) continue;
      if (!out) out = records.slice();
      out[k] = { ...r, spans: best.spans };
    }
    return out || records;
  }

  _removeTile(key) {
    const ids = this.byTile.get(key);
    if (!ids) return;
    this.byTile.delete(key);
    for (const id of ids) {
      const st = this.stations.get(id);
      if (!st) continue;
      st.tiles.delete(key);
      if (!st.tiles.size) { this._disposeMesh(st); this.stations.delete(id); }
    }
  }

  _material() {
    if (this.mat) return this.mat;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, transparent: true, depthWrite: true, side: THREE.DoubleSide });
    mat.name = 'water.sluiceJet';
    const u = this.u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS + '\nfloat sjRough = 0.3;\nfloat sjH = 0.0;')
        .replace('#include <map_fragment>', FRAG_MAP)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sjRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = sjBump( - vViewPosition, normal, sjH, faceDirection );');
    };
    mat.customProgramCacheKey = () => 'water-sluicejet-v2';
    try { this.app.lighting?.patch?.(mat, { receiveCloudShadow: true }); } catch { /* optional */ }
    this.mat = mat;
    return mat;
  }

  _build(st) {
    st.dead = true;                                   // built once (or nothing to draw)
    const s = st.spec;
    const sb = stationBays(s);
    if (!sb || !sb.bays.some((b) => b.open)) return;
    const Gm = sb.Gm;
    const P = jetProfile(Gm);
    // open bays from the near bank (zE) towards −z, piers 1.5 m / 10 m long (sluice_station.js gateStructure: pier end
    // 6.4 m downstream of the gate line), basin between the training walls zE − width … zE
    const parts = [];
    let nOpen = 0;
    for (const b of sb.bays) if (b.open) { parts.push(baySheet(Gm, b.z0, b.z1, P)); nOpen++; }
    if (!parts.length) return;
    const zE = Number.isFinite(sb.zE) ? sb.zE : Math.max(...sb.bays.map((b) => Math.max(b.z0, b.z1)));
    const jump = jumpGrid(Gm, sb.bays, P, { zMin: zE - Gm.width, zMax: zE, xPier: 6.4 });
    if (jump) parts.push(jump);
    // merge, rotate pool frame -> building frame (rotY(rot): x' = x c + z s, z' = −x s + z c)
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.rows * p.cols; ni += (p.rows - 1) * (p.cols - 1) * 6; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), sj = new Float32Array(nv * 4), al = new Float32Array(nv), sjb = new Float32Array(nv * 2);
    const idx = new Uint32Array(ni);
    const c = Math.cos(Gm.rot), sn = Math.sin(Gm.rot);
    let vo = 0, io = 0;
    for (const p of parts) {
      const cnt = p.rows * p.cols;
      for (let k = 0; k < cnt; k++) {
        const x = p.pos[k * 3], y = p.pos[k * 3 + 1], z = p.pos[k * 3 + 2];
        pos[(vo + k) * 3] = x * c + z * sn; pos[(vo + k) * 3 + 1] = y; pos[(vo + k) * 3 + 2] = -x * sn + z * c;
        const nx = p.nrm[k * 3], ny = p.nrm[k * 3 + 1], nz = p.nrm[k * 3 + 2];
        nrm[(vo + k) * 3] = nx * c + nz * sn; nrm[(vo + k) * 3 + 1] = ny; nrm[(vo + k) * 3 + 2] = -nx * sn + nz * c;
        for (let q = 0; q < 4; q++) sj[(vo + k) * 4 + q] = p.sj[k * 4 + q];
        al[vo + k] = p.alpha[k];
        sjb[(vo + k) * 2] = p.sjb[k * 2]; sjb[(vo + k) * 2 + 1] = p.sjb[k * 2 + 1];
      }
      for (let r = 0; r < p.rows - 1; r++) for (let cc = 0; cc < p.cols - 1; cc++) {
        const a = vo + r * p.cols + cc, b = a + 1, d = a + p.cols, e = d + 1;
        idx[io++] = a; idx[io++] = d; idx[io++] = b; idx[io++] = b; idx[io++] = d; idx[io++] = e;
      }
      vo += cnt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aSj', new THREE.BufferAttribute(sj, 4));
    g.setAttribute('aSjA', new THREE.BufferAttribute(al, 1));
    g.setAttribute('aSjB', new THREE.BufferAttribute(sjb, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    // the vertex relief (≤ ~0.5 m) can lift the sheet off its bounds a little
    g.boundingSphere.radius += 1.5;
    const mesh = new THREE.Mesh(g, this._material());
    mesh.name = 'water.sluiceJet:' + s.id;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 3;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.buildingId = s.id;
    try { const sp = this._spray(s, Gm, P, sb.bays, c, sn); if (sp) mesh.add(sp); } catch (err) { if (!this._sprayWarned) { this._sprayWarned = true; console.warn('[water] sluice spray', err); } }
    this.group.add(mesh);
    st.mesh = mesh;
    st.bays = nOpen;
    this.stats.bays += nOpen;
  }

  /**
   * Spray off the plunge of every open bay (W2): torn white streaks rising ~1–4 m and drifting downstream while they fade
   * (spray.js material: lit like the foam, dark at night). Child of the jet mesh (building frame); pool frame rotated by rot.
   */
  _spray(s, Gm, P, bays, c, sn) {
    const open = bays.filter((b) => b.open);
    if (!open.length) return null;
    if (!this.sprayMat) this.sprayMat = createSprayMaterial(this.app, this.uSp, 'water.sluiceSpray');
    const count = open.length * SPRAY_PER_BAY;
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSpray = new Float32Array(count * 4);
    const mesh = new THREE.InstancedMesh(geo, this.sprayMat, count);
    mesh.name = 'water.sluiceSpray:' + s.id;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    const m4 = new THREE.Matrix4();
    const sid = hashString(s.id) >>> 0, fl = Gm.flow;
    const f = Math.min(1.4, 0.45 + 0.09 * P.drop) * (P.drowned ? 0.5 : 1);
    const dxB = fl * c, dzB = -fl * sn;                        // downstream unit in the building frame
    let k = 0;
    open.forEach((b, bi) => {
      for (let j = 0; j < SPRAY_PER_BAY; j++) {
        const h = (q) => hash4(sid, bi, j, q) / 4294967296;
        const along = P.xp + 0.2 + h(1) * 3.0;
        const z = Math.min(b.z0, b.z1) + (0.08 + 0.84 * h(2)) * Math.abs(b.z1 - b.z0);
        const y = Gm.down + 0.15 + h(3) * 0.5;
        const px = along * fl, bx = px * c + z * sn, bz = -px * sn + z * c;
        const dl = 3 + h(4) * 8;
        m4.set(dxB * dl, 0, 0, bx, 0, 1, 0, y, dzB * dl, 0, 1, bz, 0, 0, 0, 1);
        mesh.setMatrixAt(k, m4);
        aSpray[k * 4] = h(5); aSpray[k * 4 + 1] = (0.9 + h(6) * 1.7) * f; aSpray[k * 4 + 2] = (0.8 + h(7) * 2.0) * f; aSpray[k * 4 + 3] = h(8);
        k++;
      }
    });
    geo.setAttribute('aSpray', new THREE.InstancedBufferAttribute(aSpray, 4));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  _disposeMesh(st) {
    if (!st.mesh) return;
    this.group.remove(st.mesh);
    for (const ch of st.mesh.children) ch.geometry?.dispose();
    st.mesh.geometry.dispose();
    this.stats.bays = Math.max(0, this.stats.bays - (st.bays || 0));
    st.mesh = null; st.bays = 0;
  }

  _frame(st) {
    if (st.anchor) return;
    const s = st.spec;
    const u = latLonToUnit(s.lat, s.lon), h = R + (+s.ground?.entrance || 0);
    st.anchor = { x: u.x * h, y: u.y * h, z: u.z * h };
    const ax = buildingAxes(s.lat, s.lon, s.heading || 0);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...ax.x), new THREE.Vector3(...ax.y), new THREE.Vector3(...ax.z));
    st.quat = new THREE.Quaternion().setFromRotationMatrix(m);
  }

  update(frame) {
    this.u.uSjTime.value = (this.water?.time || 0) % 4096;
    this.uSp.uSpTime.value = this.u.uSjTime.value;
    const dbg = frame.settings?.debugLayer;
    this.group.visible = !(dbg && dbg !== 'none' && !frame.settings.clean && dbg !== 'emission');
    if (!this.stations.size) return;
    const cam = frame.camEcef;
    let meshes = 0;
    for (const st of this.stations.values()) {
      this._frame(st);
      const a = st.anchor;
      const d = Math.hypot(a.x - cam.x, a.y - cam.y, a.z - cam.z);
      if (d > DROP_M) { if (st.mesh) { this._disposeMesh(st); st.dead = false; } continue; }
      if (!st.mesh && !st.dead && d < VIS_M && GATE) this._build(st);
      if (!st.mesh) continue;
      st.mesh.visible = d < VIS_M;
      st.mesh.position.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
      st.mesh.quaternion.copy(st.quat);
      st.mesh.updateMatrix();
      st.mesh.updateMatrixWorld();
      meshes++;
    }
    this.stats.stations = this.stations.size;
    this.stats.meshes = meshes;
  }

  /** true while the gate layout module of a nearby station is still loading */
  pending() { return !GATE && !!GATE_LOADING && this.stations.size > 0; }

  dispose() {
    for (const st of this.stations.values()) this._disposeMesh(st);
    this.stations.clear();
    this.mat?.dispose();
    this.sprayMat?.dispose();
  }
}
