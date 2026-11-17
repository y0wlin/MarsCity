// Water surface material: MeshPhysicalMaterial (IOR 1.333, so F0 = 0.02) + onBeforeCompile + the
// planet lighting patch (sun with transmittance / cloud shadow / cascaded shadows, sky ambient, sky
// environment with clouds scaled per fragment, night handling, AO). OWNER: water agent.
//
// What the hook adds (see the GLSL below):
//   * multi-scale wave normals: 42 analytic gravity–capillary waves (waves.js) in face-plane metres,
//     each faded out by its projected size; the slope variance of the waves the pixel cannot resolve
//     becomes GGX roughness (LEAN-style), so the glint is a sharp glitter up close and the broad
//     specular point of A03 from orbit
//   * flow-advected ripples (two-phase flow map) on canals, rivers and spillway jets
//   * depth colour: the terrain already paints the bed seen through the water (sand → teal → cobalt),
//     the surface adds a body colour that hides the bed with depth (Tw = exp(-depth / visibility))
//   * premultiplied blending: rgb = Fresnel-weighted reflection + specular + body in-scatter + foam,
//     alpha = 1 - (1 - F)·Tw, so the bed is transmitted by (1 - F)·Tw
//   * foam: shore break (depth / wet-mask band × wave energy), spillway / sluice plumes (vertex foam
//     source), whitecaps on wind-sea crests, caisson wash at the G01 barrier
//   * planar reflection (when the water system renders one) blended into the specular radiance,
//     analytic sky (lpAtmosphere) for the reflected ray from high altitude, faint city-light sheen at
//     night from the blurred control-map emission
//   * depth bias (relative + per-tile metres) so the surface never z-fights the painted shallows
//   * debug: wireframe (5), lod (6); nothing in clean mode
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { SITES, G01_GEO, g01ToUV } from '../../world/sites.js';
import { NW, BAND, WAVE_JITTER } from './waves.js';

export const WATER_DEBUG = { none: 0, wireframe: 5, lod: 6, normals: 7, objectId: 8 };

// G01 protected harbour (W2, decision DG): analytic basin mask per fragment. Harbour-frame metres
// (u, v) = (p·U, p·V) / (p·C) for the planet direction p (same gnomonic projection as sites.js unitToLocal + g01ToUV).
const G01_FRAME = (() => {
  const S = SITES.tidalBarrier, D = Math.PI / 180, la = S.lat * D, lo = S.lon * D;
  const c = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  const e = [Math.cos(lo), 0, -Math.sin(lo)];
  const n = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
  const gu = G01_GEO.uv.u, gv = G01_GEO.uv.v;
  const U = e.map((ek, k) => R * (ek * gu[0] - n[k] * gu[1])), V = e.map((ek, k) => R * (ek * gv[0] - n[k] * gv[1]));
  const m = S.mouth, mc = g01ToUV((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, {});
  return { c, U, V, mouth: [mc.u, mc.v] };
})();
/** calm-water tint of the G01 harbour (linear apparent reflectance of the water column): lighter azure-turquoise than
 *  the cobalt open sea (G01 / A03 references), so the protected basin reads inside the barrier's bright crest line */
export const HARBOUR_TINT = [0.016, 0.100, 0.165];
/** the same basin at orbit / region footprints (≥ 1.5 km per pixel): brighter jade-turquoise against the hazy cobalt sea */
export const HARBOUR_TINT_ORBIT = [0.026, 0.165, 0.180];
const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

const VERT_PARS = /* glsl */`
attribute vec2 aWtrGrid;
attribute vec3 aWtrEdge;
attribute vec4 aWtrA;
attribute vec4 aWtrB;
attribute vec4 aWtrF;
attribute float aWtrI;
uniform vec4 uWtrEdge;
varying float vWtrI;
varying vec3 vWtrWorld;
varying vec2 vWtrGrid;
varying vec4 vWtrA;
varying vec4 vWtrB;
varying vec4 vWtrF;
`;
const VERT_MAIN = /* glsl */`
{
  float wE = 0.0;
  if ( aWtrGrid.x < 0.0001 ) wE = max( wE, uWtrEdge.x );
  if ( aWtrGrid.x > 0.9999 ) wE = max( wE, uWtrEdge.y );
  if ( aWtrGrid.y < 0.0001 ) wE = max( wE, uWtrEdge.z );
  if ( aWtrGrid.y > 0.9999 ) wE = max( wE, uWtrEdge.w );
  transformed += aWtrEdge * wE;
  vWtrWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vWtrGrid = aWtrGrid; vWtrA = aWtrA; vWtrB = aWtrB; vWtrF = aWtrF; vWtrI = aWtrI;
}
`;

const FRAG_PARS = /* glsl */`
#include <lp_atmosphere_pars>
#define WTR_NW ${NW}
uniform vec4 uWtrWaves[ WTR_NW ];      // per face: kx, ky (rad/m on the 4096 m lattice), amp (m), phase (rad, CPU clock)
uniform vec4 uWtrWaveJ[ WTR_NW ];      // regional jitter coefficients (amplitude c1 c2, phase c1 c2)
uniform vec2 uWtrWindDir;              // per face: wind direction (face plane)
uniform vec2 uWtrWindPQ;               // per face: rational approximation of the wind direction (lattice-periodic noise)
uniform vec2 uWtrOrigin;
uniform float uWtrTileM;
uniform vec3 uWtrFaceU;
uniform vec3 uWtrFaceV;
uniform sampler2D uWtrMask;
uniform float uWtrMaskRes;
uniform float uWtrHasMask;
uniform vec2 uWtrBias;
uniform float uWtrLevel;
uniform float uWtrTime;
uniform int uWtrDebug;
uniform float uWtrSkyAnalytic;
uniform sampler2D uWtrEmission;
uniform float uWtrCityGlow;
uniform float uWtrPlanarOn;
uniform sampler2D uWtrPlanarTex;
uniform sampler2D uWtrPlanarDepth;
uniform mat4 uWtrPlanarVP;
uniform vec3 uWtrPlanarFwd;
uniform float uWtrPlanarLevel;
uniform float uWtrPlanarLogFar;
uniform float uWtrPlanarFade;
uniform float uWtrFoamGain;
uniform vec3 uWtrG01C;
uniform vec3 uWtrG01U;
uniform vec3 uWtrG01V;
varying vec3 vWtrWorld;
varying vec2 vWtrGrid;
varying vec4 vWtrA;
varying vec4 vWtrB;
varying vec4 vWtrF;
varying float vWtrI;
#define G01_CV ${glf(G01_GEO.arc.cv)}
#define G01_R ${glf(G01_GEO.arc.r)}
#define G01_HALF ${glf(G01_GEO.arc.half)}
#define G01_MOUTH vec2( ${G01_FRAME.mouth[0].toFixed(2)}, ${G01_FRAME.mouth[1].toFixed(2)} )
#define WTR_HARBOUR vec3( ${HARBOUR_TINT.map((x) => x.toFixed(4)).join(', ')} )
#define WTR_HARBOUR_ORBIT vec3( ${HARBOUR_TINT_ORBIT.map((x) => x.toFixed(4)).join(', ')} )

vec3 wtrN;          // world-space surface normal (waves)
float wtrRough;
float wtrCov;
float wtrFoam;
float wtrPlanarW;
float wtrReflSig;   // angular blur (rad, 1 sigma along the elevation) of the planar reflection at this fragment
// planar reflection (W1, fix round 3): distortion = this fraction of the physical 2·tilt of the reflected ray (crisp,
// wavy break-up near the camera without dissolving into noise); blur = this fraction of the unresolved slope sigma
// of the longer waves (the far-shore image merges into vertical streaks instead of a crisp mirror or a grey smear)
#define WTR_REFL_DISTORT 0.14
#define WTR_REFL_BLUR 0.17

float wtrHash( vec2 p ) {
  uvec2 q = uvec2( ivec2( p ) );
  q = q * 1664525u + 1013904223u;
  q.x += q.y * 1664525u; q.y += q.x * 1664525u;
  q ^= q >> 16u;
  q.x += q.y * 1664525u; q.y += q.x * 1664525u;
  q ^= q >> 16u;
  return float( ( q.x ^ q.y ) & 0xffffffu ) / 16777216.0;
}
// periodic value noise with analytic gradient: (value -1..1, d/dx, d/dy) in cell units
vec3 wtrNoised( vec2 x, float per ) {
  vec2 i = floor( x ), f = x - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  vec2 i0 = mod( i, per ), i1 = mod( i + 1.0, per );
  float a = wtrHash( i0 ), b = wtrHash( vec2( i1.x, i0.y ) ), c = wtrHash( vec2( i0.x, i1.y ) ), d = wtrHash( i1 );
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  return vec3( ( a + k1 * u.x + k2 * u.y + k3 * u.x * u.y ) * 2.0 - 1.0, 2.0 * du * vec2( k1 + k3 * u.y, k2 + k3 * u.x ) );
}
// noise on the 4096 m lattice (cell = 4096 / per metres), gradient per metre
vec3 wtrNoiseM( vec2 xm, float cell ) {
  vec3 n = wtrNoised( xm / cell, floor( 4096.0 / cell + 0.5 ) );
  return vec3( n.x, n.yz / cell );
}
// periodic gradient noise (rounder iso-lines than value noise: foam patches without polygon edges),
// lattice period 'per' cells, sigma ≈ 0.345, |v| < 1.1
float wtrGrad( vec2 x, float per ) {
  vec2 i = floor( x ), f = x - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 i0 = mod( i, per ), i1 = mod( i + 1.0, per );
  float ha = wtrHash( i0 ) * 6.2831853, hb = wtrHash( vec2( i1.x, i0.y ) ) * 6.2831853;
  float hc = wtrHash( vec2( i0.x, i1.y ) ) * 6.2831853, hd = wtrHash( i1 ) * 6.2831853;
  float a = dot( vec2( cos( ha ), sin( ha ) ), f );
  float b = dot( vec2( cos( hb ), sin( hb ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( vec2( cos( hc ), sin( hc ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( vec2( cos( hd ), sin( hd ) ), f - vec2( 1.0 ) );
  return 1.6 * mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// gradient noise in metres; rot = 1 uses a lattice rotated by atan(4/3) (integer map, so it stays periodic
// in 4096 m: tiles stay seamless across the wrap of their origin) to break the axis-aligned look
float wtrGradM( vec2 xm, float cell, float rot ) {
  if ( rot > 0.5 ) {
    vec2 y = vec2( 3.0 * xm.x + 4.0 * xm.y, 3.0 * xm.y - 4.0 * xm.x ) * 0.2;
    float per = max( floor( 819.2 / cell + 0.5 ), 2.0 );
    return wtrGrad( y * ( per / 819.2 ), per );
  }
  float per = max( floor( 4096.0 / cell + 0.5 ), 2.0 );
  return wtrGrad( xm * ( per / 4096.0 ), per );
}
// periodic gradient noise with a period per axis (cells)
float wtrGrad2( vec2 x, vec2 per ) {
  vec2 i = floor( x ), f = x - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 i0 = mod( i, per ), i1 = mod( i + 1.0, per );
  float ha = wtrHash( i0 ) * 6.2831853, hb = wtrHash( vec2( i1.x, i0.y ) ) * 6.2831853;
  float hc = wtrHash( vec2( i0.x, i1.y ) ) * 6.2831853, hd = wtrHash( i1 ) * 6.2831853;
  float a = dot( vec2( cos( ha ), sin( ha ) ), f );
  float b = dot( vec2( cos( hb ), sin( hb ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( vec2( cos( hc ), sin( hc ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( vec2( cos( hd ), sin( hd ) ), f - vec2( 1.0 ) );
  return 1.6 * mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// wind-aligned anisotropic gradient noise (cl = cell along the wind, cc = cell along the crests, metres). The
// frame is the rational direction uWtrWindPQ = (p, q): an integer map of the 4096 m lattice, so the noise
// stays periodic in 4096 m and tiles stay seamless across the wrap of their origin.
float wtrGradW( vec2 xm, float cl, float cc ) {
  vec2 pq = uWtrWindPQ;
  float L = length( pq );
  vec2 per = max( floor( vec2( 4096.0 / ( cl * L ), 4096.0 / ( cc * L ) ) + 0.5 ), vec2( 2.0 ) );
  vec2 y = vec2( pq.x * xm.x + pq.y * xm.y, pq.x * xm.y - pq.y * xm.x ) * ( per / 4096.0 );
  return wtrGrad2( y, per );
}
// ---- planet-anchored noise: 3D noise of the planet direction (continuous across tiles and cube faces, not
// periodic; float32 direction precision ≈ 0.2 m on the ground, used for scales ≥ ~300 m only)
uvec4 wtrPcg4( uvec4 v ) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 wtrH4( ivec3 c, uint s ) { return vec4( wtrPcg4( uvec4( uvec3( c ), s ) ) >> 8u ) * ( 1.0 / 16777216.0 ); }
// 4-channel value noise, -1..1 per channel (sd ≈ 0.31)
vec4 wtrVNoise4( vec3 p, uint s ) {
  vec3 i = floor( p ), f = p - i;
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  ivec3 c = ivec3( i );
  vec4 a = mix( wtrH4( c, s ), wtrH4( c + ivec3( 1, 0, 0 ), s ), u.x );
  vec4 b = mix( wtrH4( c + ivec3( 0, 1, 0 ), s ), wtrH4( c + ivec3( 1, 1, 0 ), s ), u.x );
  vec4 d = mix( wtrH4( c + ivec3( 0, 0, 1 ), s ), wtrH4( c + ivec3( 1, 0, 1 ), s ), u.x );
  vec4 e = mix( wtrH4( c + ivec3( 0, 1, 1 ), s ), wtrH4( c + ivec3( 1, 1, 1 ), s ), u.x );
  return mix( mix( a, b, u.y ), mix( d, e, u.y ), u.z ) * 2.0 - 1.0;
}
float wtrGc( ivec3 c, ivec3 o, vec3 f, uint s ) { return dot( wtrH4( c + o, s ).xyz * 2.0 - 1.0, f - vec3( o ) ); }
// 3D gradient noise (sd ≈ 0.3)
float wtrGNoise3( vec3 p, uint s ) {
  vec3 i = floor( p ), f = p - i;
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  ivec3 c = ivec3( i );
  float n000 = wtrGc( c, ivec3( 0, 0, 0 ), f, s ), n100 = wtrGc( c, ivec3( 1, 0, 0 ), f, s );
  float n010 = wtrGc( c, ivec3( 0, 1, 0 ), f, s ), n110 = wtrGc( c, ivec3( 1, 1, 0 ), f, s );
  float n001 = wtrGc( c, ivec3( 0, 0, 1 ), f, s ), n101 = wtrGc( c, ivec3( 1, 0, 1 ), f, s );
  float n011 = wtrGc( c, ivec3( 0, 1, 1 ), f, s ), n111 = wtrGc( c, ivec3( 1, 1, 1 ), f, s );
  return 1.8 * mix( mix( mix( n000, n100, u.x ), mix( n010, n110, u.x ), u.y ), mix( mix( n001, n101, u.x ), mix( n011, n111, u.x ), u.y ), u.z );
}
// periodic Voronoi on the 4096 m lattice (ice floes): (distance to the cell border in metres, cell hash 0..1)
vec2 wtrVoro( vec2 xm, float cell, float seed ) {
  float per = max( floor( 4096.0 / cell + 0.5 ), 2.0 );
  vec2 x = xm * ( per / 4096.0 );
  vec2 i = floor( x ), f = x - i;
  vec2 mg = vec2( 0.0 ), mr = vec2( 0.0 );
  float md = 8.0;
  for ( int j = -1; j <= 1; j ++ ) for ( int k = -1; k <= 1; k ++ ) {
    vec2 gq = vec2( float( k ), float( j ) );
    vec2 c = mod( i + gq, per );
    vec2 o = 0.12 + 0.76 * vec2( wtrHash( c + vec2( seed, 0.0 ) ), wtrHash( c + vec2( 37.0, 17.0 + seed ) ) );
    vec2 r = gq + o - f;
    float d = dot( r, r );
    if ( d < md ) { md = d; mr = r; mg = gq; }
  }
  float bd = 8.0;
  for ( int j = -2; j <= 2; j ++ ) for ( int k = -2; k <= 2; k ++ ) {
    vec2 gq = mg + vec2( float( k ), float( j ) );
    vec2 c = mod( i + gq, per );
    vec2 o = 0.12 + 0.76 * vec2( wtrHash( c + vec2( seed, 0.0 ) ), wtrHash( c + vec2( 37.0, 17.0 + seed ) ) );
    vec2 r = gq + o - f;
    vec2 dr = r - mr;
    if ( dot( dr, dr ) > 1e-6 ) bd = min( bd, dot( 0.5 * ( mr + r ), normalize( dr ) ) );
  }
  return vec2( bd * 4096.0 / per, wtrHash( mod( i + mg, per ) + vec2( 71.0, 3.0 + seed ) ) );
}
// standard normal quantile (Tukey-lambda approximation)
float wtrProbit( float p ) { p = clamp( p, 1e-4, 1.0 - 1e-4 ); return 4.91 * ( pow( p, 0.14 ) - pow( 1.0 - p, 0.14 ) ); }
// column colour of the water body seen from above (apparent reflectance; same palette family as the
// terrain's submerged-bed tint in world/surface.js)
vec3 wtrBody( float depth, float tint ) {
  vec3 shallow = vec3( 0.022, 0.122, 0.212 ), mid = vec3( 0.008, 0.050, 0.148 ), deep = vec3( 0.0050, 0.022, 0.086 );
  vec3 sea = depth < 60.0 ? mix( shallow, mid, 0.22 + 0.78 * smoothstep( 4.0, 60.0, depth ) ) : mix( mid, deep, smoothstep( 60.0, 900.0, depth ) );
  vec3 lake = mix( vec3( 0.024, 0.130, 0.160 ), vec3( 0.012, 0.072, 0.120 ), smoothstep( 3.0, 30.0, depth ) );
  vec3 canal = vec3( 0.012, 0.052, 0.088 );
  return tint < 0.6 ? mix( sea, canal, tint / 0.55 ) : mix( canal, lake, ( tint - 0.55 ) / 0.45 );
}
// multi-octave foam texture (gradient noise, 32 / 8 / 2 / 0.5 m cells on alternately rotated lattices),
// each octave faded out when sub-pixel: (pattern of the resolved octaves ~0.5, std-dev of the resolved
// octaves, std-dev of the unresolved octaves); total std-dev = WTR_FOAM_SD
#define WTR_FOAM_SD 0.1007
vec3 wtrFoamPattern( vec2 x, float foot ) {
  float r0 = smoothstep( 1.2, 4.0, 32.0 / foot ), r1 = smoothstep( 1.2, 4.0, 8.0 / foot );
  float r2 = smoothstep( 1.2, 4.0, 2.0 / foot ), r3 = smoothstep( 1.2, 4.0, 0.5 / foot );
  float p = 0.0;
  if ( r0 > 0.0 ) p += 0.46 * r0 * wtrGradM( x, 32.0, 1.0 );
  if ( r1 > 0.0 ) p += 0.30 * r1 * wtrGradM( x + vec2( 13.7, 5.1 ), 8.0, 0.0 );
  if ( r2 > 0.0 ) p += 0.17 * r2 * wtrGradM( x + vec2( 3.3, 21.9 ), 2.0, 1.0 );
  if ( r3 > 0.0 ) p += 0.10 * r3 * wtrGradM( x + vec2( 9.1, 1.7 ), 0.5, 0.0 );
  float sdR = 0.1726 * sqrt( r0 * r0 * 0.2116 + r1 * r1 * 0.09 + r2 * r2 * 0.0289 + r3 * r3 * 0.01 );
  float sdU = 0.1726 * sqrt( ( 1.0 - r0 * r0 ) * 0.2116 + ( 1.0 - r1 * r1 ) * 0.09 + ( 1.0 - r2 * r2 ) * 0.0289 + ( 1.0 - r3 * r3 ) * 0.01 );
  return vec3( 0.5 + 0.5 * p, sdR, sdU );
}
// foam density for a mean coverage c (0..1): the threshold is the (1 - c) quantile of the full pattern; the
// octaves the pixel cannot resolve are averaged analytically (the density is the probability that the
// unresolved detail lifts the resolved pattern above the threshold), so foam far away is a translucent,
// correctly averaged film and close up a sharp, frayed texture; the mean coverage is c at any range
float wtrFoamCov( float c, vec3 pat, float soft ) {
  if ( c <= 0.001 ) return 0.0;
  if ( c >= 0.999 ) return 1.0;
  float thr = 0.5 + WTR_FOAM_SD * wtrProbit( 1.0 - c );
  float w = max( pat.z, 0.12 * WTR_FOAM_SD * soft );
  return 1.0 / ( 1.0 + exp( -1.702 * ( pat.x - thr ) / w ) );
}
vec3 wtrHue( float h ) { return clamp( abs( fract( h + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 ) - 1.0, 0.0, 1.0 ); }
// G01 harbour basin mask (W2): designed shore … barrier arc, |u| < half; soft edges of half a pixel (≥ 40 m) and the
// coverage boosted at orbit footprints so the ~11 × 6 km basin stays a visible spot (same rule as surface.js harbourTint)
float wtrHarbourMask( vec3 p, float foot ) {
  float d = dot( p, uWtrG01C );
  if ( d < 0.99995 ) return 0.0;                              // > ~34 km from the barrier
  float u = dot( p, uWtrG01U ) / d, v = dot( p, uWtrG01V ) / d;
  float e = max( 0.6 * foot, 40.0 );
  float au = abs( u );
  float av = G01_CV + sqrt( max( G01_R * G01_R - u * u, 0.0 ) );
  float hq = ( au - 5300.0 ) / 900.0;
  float sv = -2300.0 + 870.0 * exp( - hq * hq );
  if ( au < 5600.0 ) sv -= 4200.0 * pow( max( cos( 3.14159265 * u / 11200.0 ), 0.0 ), 0.7 );
  float cov = smoothstep( G01_HALF + e, G01_HALF - e, au ) * smoothstep( av + e, av - e, v ) * smoothstep( sv - 400.0 - e, sv - 400.0 + e, v );
  return min( 1.0, cov * ( 1.0 + 1.5 * smoothstep( 700.0, 4000.0, foot ) ) );
}
// gradient noise stretched along a rational lattice direction pq (cl = cell along pq, cc = across, metres): an integer
// map of the 4096 m lattice, periodic in 4096 m, so tiles stay seamless across the wrap of their origin
float wtrGradPQ( vec2 xm, vec2 pq, float cl, float cc ) {
  float L = length( pq );
  vec2 per = max( floor( vec2( 4096.0 / ( cl * L ), 4096.0 / ( cc * L ) ) + 0.5 ), vec2( 2.0 ) );
  vec2 y = vec2( pq.x * xm.x + pq.y * xm.y, pq.x * xm.y - pq.y * xm.x ) * ( per / 4096.0 );
  return wtrGrad2( y, per );
}
// flow-aligned streak noise (W6): the two of eight rational lattice directions (0°, 26.6°, 45°, 63.4°, 90°, …) that
// bracket the flow direction (mod 180°), blended by angle with the contrast of the blend preserved
float wtrStreak( vec2 xm, vec2 fdir, float cl, float cc ) {
  float a = atan( fdir.y, fdir.x );
  a = mod( a, 3.14159265 );
  const float A[ 9 ] = float[ 9 ]( 0.0, 0.4636476, 0.7853982, 1.1071487, 1.5707963, 2.0344439, 2.3561945, 2.6779450, 3.14159265 );
  // index 8 = index 0 (a line at 180° is the line at 0°); each direction keeps its own offset whichever pair it is in,
  // so the pattern is continuous where the bracketing pair switches
  const vec2 P[ 9 ] = vec2[ 9 ]( vec2( 1.0, 0.0 ), vec2( 2.0, 1.0 ), vec2( 1.0, 1.0 ), vec2( 1.0, 2.0 ), vec2( 0.0, 1.0 ), vec2( -1.0, 2.0 ), vec2( -1.0, 1.0 ), vec2( -2.0, 1.0 ), vec2( 1.0, 0.0 ) );
  int k = 0;
  for ( int i = 0; i < 8; i ++ ) if ( a >= A[ i ] ) k = i;
  float t = clamp( ( a - A[ k ] ) / ( A[ k + 1 ] - A[ k ] ), 0.0, 1.0 );
  t = t * t * ( 3.0 - 2.0 * t );
  int k1 = k + 1 == 8 ? 0 : k + 1;
  float n0 = t < 0.999 ? wtrGradPQ( xm + vec2( 19.3, 7.1 ) * float( k ), P[ k ], cl, cc ) : 0.0;
  float n1 = t > 0.001 ? wtrGradPQ( xm + vec2( 19.3, 7.1 ) * float( k1 ), P[ k1 ], cl, cc ) : 0.0;
  return ( n0 * ( 1.0 - t ) + n1 * t ) * inversesqrt( t * t + ( 1.0 - t ) * ( 1.0 - t ) );
}
// streak foam texture: wtrFoamPattern's octave structure (same amplitudes, so the same total std-dev WTR_FOAM_SD and
// wtrFoamCov applies) with the three coarse octaves stretched along the flow (40 × 9, 12 × 2.4, 3.2 × 0.7 m): the plume
// tears into streaks along the current where its coverage drops (泡沫在流向下侧撕散)
vec3 wtrStreakPattern( vec2 x, vec2 fdir, float foot ) {
  float r0 = smoothstep( 1.2, 4.0, 9.0 / foot ), r1 = smoothstep( 1.2, 4.0, 2.4 / foot );
  float r2 = smoothstep( 1.2, 4.0, 0.7 / foot ), r3 = smoothstep( 1.2, 4.0, 0.5 / foot );
  float p = 0.0;
  if ( r0 > 0.0 ) p += 0.46 * r0 * wtrStreak( x, fdir, 40.0, 9.0 );
  if ( r1 > 0.0 ) p += 0.30 * r1 * wtrStreak( x + vec2( 13.7, 5.1 ), fdir, 12.0, 2.4 );
  if ( r2 > 0.0 ) p += 0.17 * r2 * wtrStreak( x + vec2( 3.3, 21.9 ), fdir, 3.2, 0.7 );
  if ( r3 > 0.0 ) p += 0.10 * r3 * wtrGradM( x + vec2( 9.1, 1.7 ), 0.5, 0.0 );
  float sdR = 0.1726 * sqrt( r0 * r0 * 0.2116 + r1 * r1 * 0.09 + r2 * r2 * 0.0289 + r3 * r3 * 0.01 );
  float sdU = 0.1726 * sqrt( ( 1.0 - r0 * r0 ) * 0.2116 + ( 1.0 - r1 * r1 ) * 0.09 + ( 1.0 - r2 * r2 ) * 0.0289 + ( 1.0 - r3 * r3 ) * 0.01 );
  return vec3( 0.5 + 0.5 * p, sdR, sdU );
}
`;

const FRAG_LOGDEPTH = /* glsl */`
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  {
    // pull the surface towards the camera: relative (z-fight safety at orbit range) + metres (mesh error)
    // metres part (≤ 0.25 m, see index.js) limited to 1e-4 of the distance (wake ribbons / near props /
    // quay walls stay in front)
    float wbm = min( uWtrBias.y, ( vFragDepth - 1.0 ) * 1e-4 );
    float wfd = ( vFragDepth - wbm ) * ( 1.0 - uWtrBias.x );
    gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( max( wfd, 1.0 ) ) * logDepthBufFC * 0.5;
  }
#endif
`;

const FRAG_MAP = /* glsl */`
{
  vec3 wUp = normalize( vWtrWorld - uPlanetCenter );
  float wDist = length( vWtrWorld );
  vec3 wV = -vWtrWorld / max( wDist, 1e-6 );
  vec2 wX = uWtrOrigin + vWtrGrid * uWtrTileM;              // face-plane metres (mod 4096 origin)
  float wFoot = max( length( fwidth( wX ) ), 1e-4 );        // metres per pixel
  vec3 wTu = normalize( uWtrFaceU - wUp * dot( uWtrFaceU, wUp ) );
  vec3 wTv = normalize( uWtrFaceV - wUp * dot( uWtrFaceV, wUp ) );
  float swellA = vWtrB.x, windA = vWtrB.y, foamSrc = vWtrB.z, turb = vWtrB.w;
  float depth = vWtrA.x, tint = vWtrA.z, flowMix = vWtrA.w;
  float calm = vWtrF.w;
  // G01 protected harbour (W1 / W2): near the camera the per-vertex sheltering field calm (smooth in the distance
  // from the walls and the mouth, tiles.js g01SeaState) drives the calm water and its tint; at orbit / region footprints
  // (vertices kilometres apart) the analytic basin mask takes over, so the basin reads as calm tinted water from 2000 km
  float wFar = smoothstep( 250.0, 1500.0, wFoot );
  float harb = vWtrA.z < 0.3 && wFar > 0.0 ? wtrHarbourMask( wUp, wFoot ) : 0.0;
  float calmX = max( calm, 0.75 * harb * wFar );
  float harbTint = max( clamp( - vWtrI, 0.0, 1.0 ), harb * wFar );     // per-vertex basin factor (tiles.js, −aWtrI) near
  vec2 wd = normalize( uWtrWindDir + vec2( 1e-6 ) );        // wind direction (face plane)
  vec3 wWind3 = normalize( wd.x * wTu + wd.y * wTv + 1e-6 );
  // ---------------- regional sea state (planet-anchored noise, 2–13 km; continuous across tiles and cube
  // faces, never periodic): per-wave amplitude / phase jitter, regional wind strength and direction. Breaks
  // the 4096 m lattice period and the regular interference pattern of the discrete wave set at 5–20 km.
  vec4 rgA = wtrVNoise4( wUp * ${(R / 5200).toFixed(4)}, 11u ) * 0.62 + wtrVNoise4( wUp * ${(R / 2100).toFixed(4)}, 23u ) * 0.38;
  vec4 rgB = wtrVNoise4( wUp * ${(R / 13000).toFixed(4)}, 37u );
  float rDir = 0.85 * rgB.x;                                 // regional wind direction offset (rad)
  vec2 wdR = vec2( wd.x * cos( rDir ) - wd.y * sin( rDir ), wd.x * sin( rDir ) + wd.y * cos( rDir ) );
  windA *= clamp( 1.0 + 0.5 * rgB.y, 0.55, 1.45 );
  swellA *= clamp( 1.0 + 0.4 * rgB.z, 0.6, 1.4 );
  // the analytic harbour part at orbit carries the vertex-side chop reduction too (tiles.js: wind × (1 − 0.3 calm))
  windA *= 1.0 - 0.3 * max( calmX - calm, 0.0 );
  swellA *= 1.0 - 0.9 * max( calmX - calm, 0.0 );
  // ---------------- gusts / wave groups: the wind sea and the swell vary over 0.3–1 km patches drifting
  // with the wind (cat's paws and slicks); uniform when sub-pixel (orbit)
  float gust = 1.0;
  {
    float rg = smoothstep( 1.0, 3.0, 340.0 / wFoot );
    if ( rg > 0.0 && windA > 0.01 ) {
      vec3 dr = wWind3 * uWtrTime;
      float n0 = wtrGNoise3( wUp * ${(R / 1024).toFixed(4)} - dr * ${(2.2 / 1024).toFixed(6)}, 5u );
      float n1 = wtrGNoise3( wUp * ${(R / 341.333).toFixed(4)} - dr * ${(1.4 / 341.333).toFixed(6)} + vec3( 3.1, 7.7, 1.3 ), 7u );
      gust = clamp( 1.0 + ( 0.55 * n0 + 0.30 * n1 ) * rg * ( 1.0 - 0.5 * calm ), 0.45, 1.6 );
    }
  }
  windA *= gust;
  swellA *= mix( 1.0, gust, 0.35 );
  // ---------------- waves
  vec2 g = vec2( 0.0 );
  float varU = 0.0, hW = 0.0, hN = 1e-4, cN = 1e-4, cN2 = 0.0;
  float varB = 0.0;                                          // unresolved slope variance of the longer waves (reflection blur)
  vec2 cz = vec2( 0.0 );                                     // complex amplitude of the resolved wind sea (crests)
  for ( int i = 0; i < WTR_NW; i ++ ) {
    vec4 w = uWtrWaves[ i ];
    vec4 jt = uWtrWaveJ[ i ];
    bool isSwell = i < ${BAND.swell[1]};
    float kl = length( w.xy );
    vec2 kn = w.xy / kl;
    float lam = 6.2831853 / kl;
    float dirW = isSwell ? 1.0 : clamp( 1.0 + 0.9 * ( dot( kn, wdR ) - dot( kn, wd ) ), 0.3, 1.7 );
    // sheltered water (G01 harbour): the short fetch inside keeps the long wind waves small, chop and ripples saturate
    // within metres of fetch and stay (the roughness / sky reflection changes gradually, no mirror-flat basin)
    float fetchW = isSwell ? 1.0 : 1.0 - 0.75 * calmX * smoothstep( 3.0, 24.0, lam );
    float a = w.z * ( isSwell ? swellA : windA ) * dirW * fetchW * max( 1.0 + 0.85 * dot( jt.xy, rgA.xy ), 0.15 );
    if ( a <= 1e-5 ) continue;
    float res = smoothstep( 1.5, 6.0, lam / wFoot );
    float s = a * kl;
    if ( res > 0.0 ) {
      float th = dot( w.xy, wX ) + w.w + 5.0 * dot( jt.zw, rgA.zw );
      float sn = sin( th ), cs = cos( th );
      g += w.xy * ( a * cs * res );
      if ( i < ${BAND.chop[0]} ) { hW += a * sn * res; hN += a * res; }
      // crest field weighted towards the energetic (longer) wind waves: whitecaps break on the dominant sea
      if ( i >= ${BAND.wind[0]} && i < ${BAND.chop[0] + 4} ) { float cw = s * res * inversesqrt( kl ); cz += cw * vec2( cs, sn ); cN += cw; cN2 += cw * cw; }
    }
    varU += ( 1.0 - res ) * 0.5 * s * s;
    varB += ( 1.0 - res ) * 0.5 * s * s * smoothstep( 0.3, 3.0, lam );
  }
  float hNorm = hW / hN;                                     // -1 trough .. +1 crest (resolved waves)
  vec2 czn = cz * inversesqrt( max( 0.5 * cN2, 1e-12 ) );    // crest field, standard normal components
  // flow-advected ripples (canals, rivers, spillway jets): two-phase flow map
  vec2 fl = vWtrF.xy;
  float fsp = length( fl );
  float FT = 1.6;
  float p0 = fract( uWtrTime / FT ), p1 = fract( uWtrTime / FT + 0.5 );
  float w0 = 1.0 - abs( 2.0 * p0 - 1.0 );
  vec2 o0 = fl * ( p0 * FT ), o1 = fl * ( p1 * FT ) + vec2( 17.0, 31.0 );
  if ( flowMix > 0.01 || turb > 0.01 ) {
    vec2 gf = vec2( 0.0 );
    // turbulent tailwater: the slope energy sits in the small cells (fine, small glints), the 1 m cell stays gentle
    float cells[ 3 ] = float[ 3 ]( 1.0, 0.5, 0.25 );
    float amps[ 3 ] = float[ 3 ]( 0.030, 0.024, 0.016 );
    float tw[ 3 ] = float[ 3 ]( 0.35, 1.0, 1.6 );
    for ( int k = 0; k < 3; k ++ ) {
      float c = cells[ k ];
      float res = smoothstep( 1.5, 5.0, c / wFoot );
      float amp = amps[ k ] * ( 0.35 + 1.1 * turb * tw[ k ] + 0.25 * fsp );
      vec3 n0 = wtrNoiseM( wX - o0, c ), n1 = wtrNoiseM( wX - o1, c );
      gf += ( n0.yz * w0 + n1.yz * ( 1.0 - w0 ) ) * amp * c * res;
      varU += ( 1.0 - res ) * amp * amp * ( 0.5 + turb );
    }
    // boils of the spillway / sluice tailwater: slow 8 m swirls (gentle domes, no glitter blobs)
    if ( turb > 0.02 ) {
      float res = smoothstep( 1.5, 5.0, 8.0 / wFoot );
      vec3 b0 = wtrNoiseM( wX - o0 * 0.6, 8.0 ), b1 = wtrNoiseM( wX - o1 * 0.6, 8.0 );
      gf += ( b0.yz * w0 + b1.yz * ( 1.0 - w0 ) ) * 0.022 * 8.0 * turb * res;
      varU += ( 1.0 - res ) * 0.002 * turb;
    }
    g += gf * max( flowMix, turb );
  }
  // irregular chop (value noise drifting with the wind) on top of the analytic set: breaks the regular
  // interference pattern of the discrete wave set up close; calm water (harbour, lakes) keeps less
  {
    vec2 wq = vec2( - wd.y, wd.x );
    float ka = windA * ( 1.0 - 0.35 * calmX );
    float cc[ 3 ] = float[ 3 ]( 8.0, 2.0, 0.5 );
    float ss[ 3 ] = float[ 3 ]( 0.035, 0.045, 0.050 );
    float sp[ 3 ] = float[ 3 ]( 1.6, 0.9, 0.45 );
    for ( int k = 0; k < 3; k ++ ) {
      float c = cc[ k ];
      float res = smoothstep( 1.5, 5.0, c / wFoot );
      float sk = ss[ k ] * ka;
      if ( res > 0.0 && sk > 1e-4 ) {
        vec2 dr = ( wd * sp[ k ] + wq * ( 0.3 * float( k ) - 0.3 ) ) * uWtrTime;
        vec3 nz = wtrNoiseM( wX - dr + vec2( 5.3 * float( k ), 11.7 ), c );
        g += nz.yz * ( sk * c * 0.5 ) * res;
      }
      varU += ( 1.0 - res ) * 0.5 * sk * sk;
      varB += ( 1.0 - res ) * 0.5 * sk * sk * smoothstep( 0.3, 3.0, c );
    }
  }
  // planar reflection blur (W1): the reflected rays fan out by the slopes the pixel cannot resolve; ripples are left out
  // (masked at grazing angles), and the blur keeps growing with the footprint (distance) after the wave set saturates
  wtrReflSig = WTR_REFL_BLUR * sqrt( varB ) * ( 1.0 + 0.6 * smoothstep( 4.0, 120.0, wFoot ) ) + 0.0012;
  // micro detail at the closest range (ripples below the analytic set), screen filtered
  {
    float res = smoothstep( 1.5, 5.0, 0.03 / wFoot );
    if ( res > 0.0 ) {
      vec3 m = wtrNoiseM( wX + vec2( uWtrTime * 0.11, uWtrTime * 0.07 ), 0.03125 );
      g += m.yz * 0.03125 * 0.05 * res * ( 0.2 + windA );
    }
    varU += ( 1.0 - res ) * 0.0009 * ( 0.2 + windA );
  }
  // ---------------- polar ice: floes / brash ice / slush on meltwater pools and the near-ice sea (vWtrI)
  float ice = clamp( vWtrI, 0.0, 1.0 );
  float floe = 0.0, slush = 0.0;
  if ( ice > 0.01 ) {
    // drifting with the current (slowly) — floes 4–16 m on pools and channels, larger on the sea
    vec2 xi = wX - fl * ( uWtrTime * 0.25 );
    float big = 1.0 - tint;                                  // sea: bigger floes
    float cell = mix( 9.0, 26.0, big );
    float rv = smoothstep( 1.0, 3.0, cell / wFoot );
    float cov = clamp( ice * 0.75, 0.0, 0.85 );
    if ( rv > 0.0 ) {
      vec2 vo = wtrVoro( xi, cell, 0.0 );
      float gap = mix( 0.9, 2.2, big ) * ( 1.3 - ice );
      float edge = max( wFoot * 1.2, 0.15 );
      float f1 = smoothstep( gap, gap + edge, vo.x ) * step( vo.y, cov );
      // brash ice between the floes (2.5 m cells) where the cover is dense
      float rb = smoothstep( 1.0, 3.0, 2.5 / wFoot );
      float f2 = 0.0;
      if ( rb > 0.0 && ice > 0.35 ) {
        vec2 vb = wtrVoro( xi + vec2( 13.0, 7.0 ), 2.5, 5.0 );
        f2 = smoothstep( 0.18, 0.18 + max( wFoot, 0.05 ), vb.x ) * step( vb.y, ( ice - 0.35 ) * 0.9 ) * rb;
      }
      floe = mix( cov * 0.82, max( f1, f2 * 0.85 ), rv );
    } else floe = cov * 0.82;                                // sub-pixel: the mean floe area
    slush = smoothstep( 0.25, 0.9, ice ) * ( 0.35 + 0.3 * wtrGradM( wX + vec2( 3.0, 9.0 ), 24.0, 1.0 ) ) * ( 1.0 - floe );
    // floes damp the small waves around them
    g *= 1.0 - 0.6 * smoothstep( 0.3, 1.0, ice );
  }
  wtrN = normalize( wUp - g.x * wTu - g.y * wTv );
  float var = varU + 0.0003 + turb * 0.03;
  wtrRough = clamp( pow( var, 0.25 ), 0.05, 0.75 );
  // ---------------- coverage: wet mask iso-line (texel resolution) + resolved-water flag
  wtrCov = 1.0;
  vec2 muv = vWtrGrid * ( uWtrMaskRes - 1.0 ) / uWtrMaskRes + 0.5 / uWtrMaskRes;
  if ( uWtrHasMask > 0.5 ) {
    float m = texture2D( uWtrMask, muv ).r;
    float fwm = max( fwidth( m ), 1e-4 );
    wtrCov = clamp( ( m - 0.5 ) / fwm + 0.5, 0.0, 1.0 );
    wtrCov = mix( wtrCov, m, clamp( fwm * 1.5 - 0.25, 0.0, 1.0 ) );
  }
  wtrCov *= smoothstep( 0.35, 0.65, vWtrA.y );
  if ( wtrCov <= 0.002 ) discard;
  // ---------------- Fresnel / body / transmission
  float NdV = clamp( dot( wtrN, wV ), 0.0, 1.0 );
  float F = 0.0204 + ( max( 1.0 - wtrRough, 0.0204 ) - 0.0204 ) * pow( 1.0 - NdV, 5.0 );
  float vis = mix( 6.5, 3.2, tint );
  float dEff = max( depth, 0.0 );
  float Tw = exp( - dEff / vis );
  // under the view ray the water column is longer at grazing angles
  Tw = pow( Tw, 1.0 / max( dot( wUp, wV ), 0.15 ) );
  vec3 body = wtrBody( dEff, tint );
  // calm protected harbour: lighter azure-turquoise basin; at orbit footprints a brighter jade-turquoise (the haze of the
  // whole atmosphere sits on top there), so the basin reads from 2000 km+ inside the barrier's bright crest line
  body = mix( body, mix( WTR_HARBOUR, WTR_HARBOUR_ORBIT, wFar ), harbTint * mix( 0.85, 0.95, wFar ) );
  // wave crests are thinner and lighter (sub-surface light), troughs darker: makes the swell / wind
  // sea readable from above; light shining through crests when looking towards the sun
  float sunUp = clamp( dot( wUp, uSunDir ) * 4.0, 0.0, 1.0 );
  float sss = pow( clamp( dot( wV, - uSunDir ) * 0.5 + 0.5, 0.0, 1.0 ), 4.0 ) * sunUp;
  body *= 1.0 + 0.12 * hNorm;
  body += vec3( 0.010, 0.060, 0.055 ) * sss * max( hNorm, 0.0 ) * ( 1.0 - tint * 0.5 );
  // ---------------- foam (shore break, spillway / sluice plumes, whitecaps, caisson wash)
  // multi-octave pattern advected by the current (two phases), resolution-aware coverage mapping
  vec3 patA = wtrFoamPattern( wX - o0 + vec2( uWtrTime * 0.05, - uWtrTime * 0.035 ), wFoot );
  vec3 patB = wtrFoamPattern( wX - o1 + vec2( uWtrTime * 0.05, - uWtrTime * 0.035 ) + vec2( 41.0, 23.0 ), wFoot );
  vec3 pat = mix( patB, patA, w0 );
  pat.x = 0.5 + ( pat.x - 0.5 ) * inversesqrt( w0 * w0 + ( 1.0 - w0 ) * ( 1.0 - w0 ) );   // keep the contrast of the blend
  // shore: texel-accurate proximity from the wet mask blurred to the surf-zone width (mip level)
  float energy = clamp( swellA * 0.9 + windA * 0.30, 0.0, 1.2 );
  float band = 0.0;
  if ( uWtrHasMask > 0.5 ) {
    float texM = uWtrTileM / max( uWtrMaskRes - 1.0, 1.0 );
    float bandM = mix( 2.0, 24.0, clamp( swellA, 0.0, 1.0 ) ) + 4.0 * windA;
    float ratio = bandM / texM;
    float mb = textureLod( uWtrMask, muv, log2( max( ratio, 1.0 ) ) ).r;
    band = ( 1.0 - smoothstep( 0.62, 0.97, mb ) ) * clamp( ratio, 0.0, 1.0 );
  } else {
    band = 1.0 - smoothstep( 0.0, 0.4 + 1.6 * swellA, dEff );        // vertex depth (coarse)
  }
  float lap = 0.5 + 0.5 * sin( dEff * 4.0 - uWtrTime * 1.1 + pat.x * 6.0 );
  float cShore = band * energy * ( 0.55 + 0.45 * lap ) * 0.9 * ( 1.0 - ice );
  // a surf band narrower than a pixel averages out (no white coast outline from far away)
  cShore *= clamp( ( 3.0 + 22.0 * swellA ) / ( wFoot * 1.5 ), 0.0, 1.0 );
  // spillway / sluice plume: white near the outlets, torn into streaks along the current and clearing downstream
  float spill = clamp( foamSrc, 0.0, 1.0 );
  float cSpill = clamp( spill * 1.12 - 0.04, 0.0, 1.0 );
  float fShore = wtrFoamCov( cShore, pat, 1.4 );
  // plume foam (W6): the texture is stretched along the current (two flow-map phases like the isotropic one), so the
  // white water below the gates tears into streaks along the flow where its coverage thins out downstream
  vec3 patS = pat;
  if ( cSpill > 0.001 && fsp > 0.05 ) {
    vec2 fdir = fl / fsp;
    vec2 drift = vec2( uWtrTime * 0.05, - uWtrTime * 0.035 );
    vec3 sA = wtrStreakPattern( wX - o0 + drift, fdir, wFoot );
    vec3 sB = wtrStreakPattern( wX - o1 + drift + vec2( 41.0, 23.0 ), fdir, wFoot );
    vec3 sp = mix( sB, sA, w0 );
    sp.x = 0.5 + ( sp.x - 0.5 ) * inversesqrt( w0 * w0 + ( 1.0 - w0 ) * ( 1.0 - w0 ) );
    patS = mix( pat, sp, smoothstep( 0.05, 0.5, fsp ) );
  }
  float fSpill = wtrFoamCov( cSpill, patS, 1.1 );
  // whitecaps (open wind sea only, not in the harbour / on lakes): breaking crests of steep wind-sea groups. A crest
  // segment breaks where the group envelope × along-crest noise (12 m along the crests, 26 m along the wind) exceeds
  // the threshold for a breaking fraction fb; it shows a bright frayed line just behind the crest (elongated along
  // the crest) and a translucent, wind-streaked foam trail fading behind it (the crest moves on downwind). Mean
  // coverage ≈ capMean (≈ fb · 0.11); sub-pixel caps average to capMean
  float capMean = 0.0075 * windA * windA * ( 1.0 - tint ) * ( 1.0 - calmX ) * ( 1.0 - calmX ) * ( 1.0 - ice );
  float fCap = 0.0;
  if ( capMean > 1e-4 ) {
    float rc = smoothstep( 1.2, 4.0, 5.0 / wFoot );
    if ( rc > 0.0 && cN2 > 1e-12 ) {
      float env = length( czn );                                // Rayleigh: steep wave groups break
      float psi = mod( 1.6707963 - atan( czn.y, czn.x ), 6.2831853 );   // phase behind the crest (+0.1 lead)
      float B = wtrGradW( wX + vec2( 7.3, 2.9 ), 26.0, 12.0 );
      float peak = 0.8 * ( 0.25 + 0.6 * env ) + 0.55 * B;
      float fb = clamp( capMean / 0.11, 0.0, 0.5 );
      float thrB = 0.80 + 0.367 * wtrProbit( 1.0 - fb );
      float brk = smoothstep( thrB - 0.06, thrB + 0.10, peak );
      float r1 = smoothstep( 1.2, 4.0, 0.7 / wFoot ), r2 = smoothstep( 1.2, 4.0, 0.3 / wFoot );
      float fr = wtrGradW( wX + vec2( 1.1, 8.7 ), 2.6, 0.7 ) * r1;   // foam streaks along the wind
      float fr2 = wtrGradW( wX + vec2( 4.4, 0.6 ), 1.2, 0.3 ) * r2;  // finer streaks (close range)
      float line = exp( - psi / 0.35 ) * smoothstep( 0.0, 0.12, psi );
      float trail = exp( - psi / 1.6 ) * smoothstep( 0.0, 0.2, psi );
      float core = smoothstep( 0.30, 0.62, line + 0.22 * fr + 0.1 * fr2 );
      float tr = trail * clamp( 0.35 + 0.8 * fr + 0.5 * fr2, 0.0, 1.0 ) * 0.65;
      fCap = mix( capMean, brk * max( core, tr ), rc );
    } else fCap = capMean;
  }
  // the night side: foam is lit by the dim night sky only, keep the open water dark (留出漆黑水面)
  float wDay = smoothstep( -0.10, 0.08, dot( wUp, uSunDir ) );
  fCap *= mix( 0.3, 1.0, wDay );
  wtrFoam = 1.0 - ( 1.0 - fShore ) * ( 1.0 - fSpill ) * ( 1.0 - fCap );
  wtrFoam = clamp( wtrFoam * uWtrFoamGain, 0.0, 1.0 );
  // bubbles under the plume: lighter, milky turquoise water that clears downstream
  float milky = clamp( spill * 1.6, 0.0, 1.0 ) * ( 1.0 - wtrFoam );
  body = mix( body, vec3( 0.07, 0.22, 0.23 ), milky * 0.5 );
  Tw *= 1.0 - milky * 0.8;
  // slush: grey-white translucent film between the floes
  body = mix( body, vec3( 0.30, 0.34, 0.36 ), slush * 0.6 );
  Tw *= 1.0 - slush * 0.7;
  // ---------------- write material inputs
  vec3 foamAlb = vec3( 0.80, 0.81, 0.80 ) * mix( 0.4, 1.0, wDay );
  vec3 iceAlb = vec3( 0.74, 0.81, 0.86 );
  diffuseColor.rgb = mix( body * ( 1.0 - Tw ), foamAlb, wtrFoam );
  diffuseColor.a = mix( 1.0 - ( 1.0 - F ) * Tw, 1.0, wtrFoam );
  wtrRough = mix( wtrRough, 0.85, wtrFoam );
  if ( floe > 0.0 ) {
    diffuseColor.rgb = mix( diffuseColor.rgb, iceAlb, floe );
    diffuseColor.a = mix( diffuseColor.a, 1.0, floe );
    wtrRough = mix( wtrRough, 0.55, floe );
    wtrN = normalize( mix( wtrN, wUp, floe * 0.8 ) );
  }
  wtrRough = mix( wtrRough, 0.4, slush * 0.6 );
  // planar reflection applies to water on the mirror plane only, near the camera
  wtrPlanarW = uWtrPlanarOn * ( 1.0 - smoothstep( 0.4, 1.2, abs( vWtrF.z - uWtrPlanarLevel ) ) ) * ( 1.0 - smoothstep( uWtrPlanarFade * 0.4, uWtrPlanarFade, wDist ) );
  wtrPlanarW *= 1.0 - floe;
}
`;

const FRAG_ROUGH = /* glsl */`
float roughnessFactor = wtrRough;
`;
const FRAG_NORMAL = /* glsl */`
normal = normalize( ( viewMatrix * vec4( wtrN, 0.0 ) ).xyz ) * faceDirection;
`;

// before <lights_fragment_end>: replace / extend the specular environment radiance
const FRAG_RADIANCE = /* glsl */`
#if defined( RE_IndirectSpecular )
{
  vec3 wRW = reflect( normalize( vWtrWorld ), wtrN );
  vec3 wUpR = normalize( vWtrWorld - uPlanetCenter );
  float wmu = dot( wRW, wUpR );
  if ( wmu < 0.02 ) { wRW = normalize( wRW + wUpR * ( 0.02 - wmu ) ); }
  if ( uWtrSkyAnalytic > 0.001 ) {
    lpSetupWorld( vWtrWorld );
    vec3 wT;
    vec3 sky = lpAtmosphere( wRW, 1e30, wT );
    radiance = mix( radiance, sky, uWtrSkyAnalytic );
  }
  if ( wtrPlanarW > 0.001 ) {
    // (W1, fix round 3) 1. distance D of the reflected object behind this point: depth of the flat-mirror lookup (the
    // mirror camera's ray through this point is the flat reflection rF)
    vec3 wI = normalize( vWtrWorld );
    float wD = length( vWtrWorld );
    vec3 rF = reflect( wI, wUpR );
    float D = 2.0e4;
    vec4 pc0 = uWtrPlanarVP * vec4( vWtrWorld, 1.0 );
    if ( pc0.w > 0.0 ) {
      vec2 uv0 = pc0.xy / pc0.w * 0.5 + 0.5;
      if ( uv0.x > 0.0 && uv0.x < 1.0 && uv0.y > 0.0 && uv0.y < 1.0 ) {
        float pd = textureLod( uWtrPlanarDepth, uv0, 0.0 ).r;
        if ( pd < 0.9999999 ) D = clamp( ( exp2( pd * uWtrPlanarLogFar ) - 1.0 ) / max( dot( rF, uWtrPlanarFwd ), 0.05 ) - wD, 0.0, 2.0e4 );
      }
    }
    // 2. wave distortion: the ray reflected by the (scaled) resolved wave normal, re-projected at distance D — crisp
    // wavy break-up near the camera, nothing where the object touches the water (D -> 0)
    vec3 wTan = wtrN - wUpR * dot( wtrN, wUpR );
    vec3 rP = reflect( wI, normalize( wUpR + wTan * WTR_REFL_DISTORT ) );
    float rmu = dot( rP, wUpR );
    if ( rmu < 0.002 ) rP = normalize( rP + wUpR * ( 0.002 - rmu ) );
    // 3. blur by the unresolved slopes: angular kernel along the elevation (long axis) and the azimuth (× tan of the
    // grazing angle, at least 12 %: reflections streak vertically), scaled by D / (D + distance) through the projection
    vec3 cz = cross( rP, wUpR );
    if ( dot( cz, cz ) < 1e-8 ) cz = cross( rP, vec3( 0.0, 0.6, 0.8 ) );   // looking straight down: any horizontal axis
    vec3 eAz = normalize( cz );
    vec3 eEl = cross( eAz, rP );
    float sg = clamp( - dot( wI, wUpR ), 0.0, 0.999 );
    float sV = wtrReflSig, sH = sV * clamp( sg * inversesqrt( 1.0 - sg * sg ), 0.12, 1.0 );
    vec3 Q = vWtrWorld + rP * D;
    vec4 q0 = uWtrPlanarVP * vec4( Q, 1.0 );
    vec4 q1 = uWtrPlanarVP * vec4( Q + eEl * ( sV * D ), 1.0 );
    vec4 q2 = uWtrPlanarVP * vec4( Q + eAz * ( sH * D ), 1.0 );
    if ( q0.w > 0.0 ) {
      vec2 c0 = q0.xy / q0.w * 0.5 + 0.5;
      vec2 aV = q1.w > 0.0 ? q1.xy / q1.w * 0.5 + 0.5 - c0 : vec2( 0.0 );
      vec2 aH = q2.w > 0.0 ? q2.xy / q2.w * 0.5 + 0.5 - c0 : vec2( 0.0 );
      vec2 tsz = vec2( textureSize( uWtrPlanarTex, 0 ) );
      float lH = length( aH * tsz ), lV = length( aV * tsz );
      float lod = log2( max( max( lH * 1.6, lV * 0.15 ), 1.0 ) );
      // stratified Gaussian taps along the long axis, jittered per pixel and frame (the progressive accumulation of a
      // still converges them), uniform jitter along the short axis on top of the mip footprint
      float jt = lpIGN( gl_FragCoord.xy, uLpFrame ) - 0.5;
      float jh = lpIGN( gl_FragCoord.xy + vec2( 23.0, 7.0 ), uLpFrame + 7.0 ) * 2.0 - 1.0;
      vec4 acc = vec4( 0.0 );
      float wsum = 0.0;
      for ( int k = 0; k < 12; k ++ ) {
        float x = ( ( float( k ) + 0.5 + jt ) / 12.0 * 2.0 - 1.0 ) * 2.2;
        float w = exp( - 0.5 * x * x );
        vec2 uv = c0 + aV * x + aH * jh;
        if ( uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 ) acc += textureLod( uWtrPlanarTex, uv, lod ) * w;
        wsum += w;
      }
      acc /= wsum;                                           // premultiplied by coverage (the target is cleared to 0)
      // light aerial perspective on the reflected geometry over its own path D (the pipeline only hazes the main view)
      vec3 ext = ( LP_BETA_R + LP_BETA_ME ) * 0.72;
      vec3 pT = exp( - ext * D );
      float pa = clamp( acc.a, 0.0, 1.0 );
      vec3 refl = radiance * ( 1.0 - pa * pT ) + acc.rgb * pT;
      radiance = mix( radiance, refl, wtrPlanarW );
    }
  }
  // night: faint sheen of the shore's city lights (blurred control-map emission)
  if ( uWtrCityGlow > 0.0 ) {
    float wnight = smoothstep( 0.05, -0.10, dot( wUpR, uSunDir ) );
    if ( wnight > 0.0 ) {
      vec2 euv = vec2( atan( wUpR.x, wUpR.z ) * 0.15915494 + 0.5, 0.5 - asin( clamp( wUpR.y, -1.0, 1.0 ) ) * 0.31830989 );
      float e = textureLod( uWtrEmission, euv, 2.5 ).r * 0.65 + textureLod( uWtrEmission, euv, 4.5 ).r * 0.35;
      radiance += vec3( 1.0, 0.70, 0.44 ) * ( e * e * uWtrCityGlow * wnight );
    }
  }
}
#endif
`;

const FRAG_OUT = /* glsl */`
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
{
  vec3 wOut = outgoingLight;
  if ( uWtrDebug == 5 ) {
    vec2 gq = vWtrGrid * 64.0;
    vec2 fw = max( fwidth( gq ), vec2( 1e-5 ) );
    vec2 f = abs( fract( gq - 0.5 ) - 0.5 ) / fw;
    float line = 1.0 - clamp( min( f.x, f.y ) - 0.5, 0.0, 1.0 );
    wOut = mix( wOut, vec3( 0.2, 0.6, 1.0 ) * max( 0.05, dot( wOut, vec3( 0.33 ) ) * 4.0 + 0.05 ), line * 0.85 );
  } else if ( uWtrDebug == 6 ) {
    vec2 e = min( vWtrGrid, 1.0 - vWtrGrid ) / max( fwidth( vWtrGrid ), vec2( 1e-6 ) );
    float border = 1.0 - clamp( min( e.x, e.y ) - 1.0, 0.0, 1.0 );
    float lum = max( dot( wOut, vec3( 0.33 ) ), 1e-4 );
    wOut = mix( ( wtrHue( uWtrLevel * 0.137 + 0.5 ) * 0.7 + 0.3 ) * lum * 2.0, vec3( 0.0 ), border * 0.9 );
    diffuseColor.a = 1.0;
  } else if ( uWtrDebug == 7 ) {
    wOut = ( wtrN * 0.5 + 0.5 ) * 0.2; diffuseColor.a = 1.0;
  } else if ( uWtrDebug == 8 ) {
    // water body class: sea blue, canal / river cyan, lake / reservoir green; foam sources white
    vec3 cls = vWtrA.z < 0.3 ? vec3( 0.05, 0.15, 0.9 ) : vWtrA.z < 0.8 ? vec3( 0.0, 0.8, 0.9 ) : vec3( 0.1, 0.85, 0.25 );
    cls = mix( cls, vec3( 1.0 ), clamp( vWtrB.z, 0.0, 1.0 ) );
    wOut = cls * 0.25; diffuseColor.a = 1.0;
  }
  gl_FragColor = vec4( wOut * wtrCov, diffuseColor.a * wtrCov );
}
`;

/** per-tile uniforms (values filled by the system) */
export function tileUniforms() {
  return {
    uWtrOrigin: { value: new THREE.Vector2() },
    uWtrTileM: { value: 1 },
    uWtrFaceU: { value: new THREE.Vector3(1, 0, 0) },
    uWtrFaceV: { value: new THREE.Vector3(0, 1, 0) },
    uWtrMask: { value: null },
    uWtrMaskRes: { value: 256 },
    uWtrHasMask: { value: 0 },
    uWtrBias: { value: new THREE.Vector2(2e-6, 0) },
    uWtrLevel: { value: 0 },
    uWtrEdge: { value: new THREE.Vector4() },
  };
}

/** uniforms shared by every water tile */
export function sharedUniforms() {
  return {
    uWtrTime: { value: 0 },
    uWtrDebug: { value: 0 },
    uWtrSkyAnalytic: { value: 0 },
    uWtrEmission: { value: null },
    uWtrCityGlow: { value: 0 },
    uWtrPlanarOn: { value: 0 },
    uWtrPlanarTex: { value: null },
    uWtrPlanarDepth: { value: null },
    uWtrPlanarVP: { value: new THREE.Matrix4() },
    uWtrPlanarFwd: { value: new THREE.Vector3(0, 0, -1) },
    uWtrPlanarLevel: { value: 0 },
    uWtrPlanarLogFar: { value: 1 },
    uWtrPlanarFade: { value: 12000 },
    uWtrFoamGain: { value: 1 },
    uWtrWaveJ: { value: WAVE_JITTER },
    uLpMsLut: { value: null },
    uWtrG01C: { value: new THREE.Vector3().fromArray(G01_FRAME.c) },
    uWtrG01U: { value: new THREE.Vector3().fromArray(G01_FRAME.U) },
    uWtrG01V: { value: new THREE.Vector3().fromArray(G01_FRAME.V) },
  };
}

/** per-face uniforms: wave vectors / amplitudes / dispersion and the current phases */
export function faceUniforms(fd) {
  return {
    uWtrWaves: { value: new Float32Array(fd.data) },          // .w = phase, written every frame (wavePhases4)
    uWtrWindDir: { value: new THREE.Vector2(Math.cos(fd.wind), Math.sin(fd.wind)) },
    uWtrWindPQ: { value: new THREE.Vector2(fd.pq[0], fd.pq[1]) },
  };
}

/**
 * @param {object} shared sharedUniforms()
 * @param {object} face faceUniforms()
 * @param {object} tile tileUniforms()
 * @param {object} lighting app.lighting (optional)
 */
export function createWaterMaterial(shared, face, tile, lighting) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.1, metalness: 0, ior: 1.333, specularIntensity: 1,
    transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
  });
  mat.name = 'water';
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.userData.wtrUniforms = tile;
  mat.userData.isWater = true;
  const hook = function waterHook(shader) {
    if (shader.__waterPatched) return;
    shader.__waterPatched = true;
    Object.assign(shader.uniforms, shared, face, tile);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    fs = fs.replace('#include <logdepthbuf_fragment>', FRAG_LOGDEPTH);
    fs = fs.replace('#include <map_fragment>', FRAG_MAP);
    fs = fs.replace('#include <roughnessmap_fragment>', FRAG_ROUGH);
    fs = fs.replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    fs = fs.replace('#include <lights_fragment_end>', FRAG_RADIANCE + '\n#include <lights_fragment_end>');
    fs = fs.replace('#include <opaque_fragment>', FRAG_OUT);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.onBeforeCompile = hook;
  mat.customProgramCacheKey = () => 'water-tile-v2';
  try { lighting?.patch?.(mat, { receiveCloudShadow: true }); } catch (e) { console.warn('[water] lighting.patch failed', e); }
  return mat;
}
