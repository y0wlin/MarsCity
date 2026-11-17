// Terrain tile material: MeshStandardMaterial + onBeforeCompile (keeps every standard lighting /
// shadow / log-depth chunk so app.lighting.patch() can extend it). OWNER: terrain-render agent.
//
// Per tile: albedo (sRGB, A = sky visibility), object-space normal (A = gloss mask), emission (sRGB,
// A = dusk onset) textures with a half-texel inset; geomorph from the parent shape (uTrMorph 0→1) and
// exact edge stitching against coarser neighbours (uTrEdgeCoarse); texture cross-fade from the parent
// while morphing; debug layers (province, zone, density, emission, wireframe, lod, normals).
//
// Relief readability from orbit (§1 轨道层可读盆地、高原、撞击坑缘和峡谷走向): the slope part of the
// normal is exaggerated as a function of the SCREEN footprint (metres per pixel), never of the tile
// level, so neighbouring tiles of different levels shade identically (no seams) and close views keep
// the true relief.
import * as THREE from 'three';
import { getControlMaps } from '../../data/controlMaps.js';
import { EMIT_FAR_RANGE, EMIT_STREET_RANGE } from './config.js';

export const DEBUG_MODES = { none: 0, province: 1, zone: 2, density: 3, emission: 4, wireframe: 5, lod: 6, normals: 7, objectId: 0 };
// Emission texels (tileBuilder / config.js): R window aggregate, G street light — both in EMISSIVE
// units (ARCHITECTURE §3: 1.0 = a typical lit window, × the lighting patch's EMISSIVE_SCALE 0.05) —,
// B light temperature, A dusk onset. The shader rebuilds the colour from the temperature and weights
// the two parts by camera distance (D3): street light fades out within ~1.5 km of the camera (props
// street lamps / light pools take over), the window aggregate only shows where the 3D city does not
// draw its buildings (complement of the city's size / distance fade). The unpatched fallback (bench /
// stub lighting) scales units to scene radiance with EMISSIVE_SCALE.
export const EMISSIVE_UNITS = 1;            // patched: texels are already in window units
export const EMISSIVE_SCALE = 0.05;         // unpatched fallback: radiance per window unit

// province palette (C01-like: OX warm earth tones, ZR teals / blues / greens)
const PROV_COLORS = [
  0x000000,
  0xc8743f, 0xd59a63, 0xb0583a, 0xe1c7a0, 0xc0603c, 0x9c7a64,
  0x3f8f8a, 0x4d7aa6, 0x4f9a68, 0x58a9b8, 0x3d6b8f, 0x6a8fb0,
];

export class TerrainShared {
  constructor(renderer) {
    this.renderer = renderer;
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 128]), 1, 1);
    black.colorSpace = THREE.SRGBColorSpace; black.needsUpdate = true;
    const grey = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    grey.needsUpdate = true;
    const r8 = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    r8.needsUpdate = true;
    this.black = black; this.grey = grey;
    this.uniforms = {
      uTrDebug: { value: 0 },
      uTrPlanetCenter: { value: new THREE.Vector3() },
      uTrSunDir: { value: new THREE.Vector3(0, 0, 1) },
      uTrNightGate: { value: 1 },
      uTrDetail: { value: 1.0 },
      // relief exaggeration: factor uTrExag.x reached at footprints ≥ 2^uTrExag.z m/px, 1 below 2^uTrExag.y
      // fix round 2 (R4 / R5): 5.5× at disc footprints (≥ 4 km/px) so 50–100 km ridges / canyons read at the full disc
      // (Z-05) and the night directional light finds relief (1.1× at 100 m/px, 4.3× at 1 km/px)
      uTrExag: { value: new THREE.Vector3(5.5, 6.0, 12.0) },
      uTrDbgMap: { value: r8 },          // packed control maps (R province, G zone, B density); debug only
      uTrProvColors: { value: PROV_COLORS.map((c) => new THREE.Color(c)) },
      // night light weighting by camera distance (index.js updates them every frame):
      //   street light: 0 below x, 1 beyond y (m)
      uTrStreetBand: { value: new THREE.Vector2(1000, 1500) },
      //   window aggregate = 1 − city building visibility for a typical building of size s:
      //   vis = smoothstep(px0, px1, s·K/d) · (1 − smoothstep(d0, d1, d)); x = s·K, y = px0, z = px1, w = on
      uTrCityFade: { value: new THREE.Vector4(30 * 1430, 1.6, 4.0, 1) },
      uTrCityMax: { value: new THREE.Vector2(16000, 18500) },
      // coarse-tile datum shift around the camera (index.js _updateDatum): x = metres along the local up,
      // full within y, none beyond z (horizontal distance from the camera nadir, m), w = on
      uTrDatum: { value: new THREE.Vector4(0, 1, 2, 0) },
    };
    this.maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 8;
    this._debugMapsReady = false;
    this.debugMapsOn = false;           // TR_DEBUG_MAPS define on tile materials (extra sampler)
  }

  /** Lazily upload the control maps used by the province / zone / density debug layers, packed into
   *  ONE sampler (R = province id, G = zone mask, B = built density; nearest, equirect 2048×1024) so the
   *  debug variant stays within the 16 texture units together with the planet lighting samplers. */
  ensureDebugMaps() {
    if (this._debugMapsReady) return;
    this._debugMapsReady = true;
    try {
      const m = getControlMaps();
      const W = m.province.width, H = m.province.height;
      const data = new Uint8Array(W * H * 4);
      const zW = m.zone.width, zH = m.zone.height;
      for (let y = 0; y < H; y++) {
        const zy = Math.min(zH - 1, Math.floor((y + 0.5) * zH / H));
        for (let x = 0; x < W; x++) {
          const i = y * W + x, o = ((H - 1 - y) * W + x) * 4;        // DataTexture row 0 = south
          data[o] = m.province.data[i];
          data[o + 1] = m.zone.data[zy * zW + Math.min(zW - 1, Math.floor((x + 0.5) * zW / W))];
          data[o + 2] = m.density.data[Math.min(m.density.data.length - 1, Math.floor(y * m.density.height / H) * m.density.width + Math.floor(x * m.density.width / W))];
          data[o + 3] = 255;
        }
      }
      const t = new THREE.DataTexture(data, W, H);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.needsUpdate = true;
      this.uniforms.uTrDbgMap.value = t;
    } catch (e) { console.warn('[terrain] debug maps unavailable', e); }
  }

  makeTexture(data, T, srgb) {
    const t = new THREE.DataTexture(data, T, T, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = this.maxAniso;
    // edge-centred texels: uv 0..1 maps to texel centres 0..T-1
    t.repeat.set((T - 1) / T, (T - 1) / T);
    t.offset.set(0.5 / T, 0.5 / T);
    t.needsUpdate = true;
    t.onUpdate = releaseTexels;   // fix round 3 (memory): GPU-only once uploaded
    return t;
  }
}

/**
 * Fix round 3 (memory): a tile texture's texel array is garbage once uploaded (nothing reads it back; the
 * texture is never re-uploaded — upgrades make new textures, a lost context reloads the page), but a
 * DataTexture keeps it in image.data: up to 3 MB of JS memory per cached 512² tile. Drop it after upload.
 */
function releaseTexels(tex) {
  const im = tex.image;
  if (im && im.data) tex.image = { data: null, width: im.width, height: im.height };
}

const VERT_PARS = /* glsl */`
attribute vec3 morphDelta;
attribute vec2 trWl;
varying vec2 vTrWl;
varying vec3 vTrGN;
varying vec3 vTrLoc;
uniform float uTrMorph;
uniform vec4 uTrEdgeCoarse;
uniform vec3 uTrUpC;
uniform vec4 uTrDatum;
uniform vec3 uTrPlanetCenter;
varying vec2 vTrUv;
varying vec3 vTrPos;
varying float vTrH;
`;
const VERT_MAIN = /* glsl */`
{
  float trE = 0.0;
  if ( uv.x < 0.0001 ) trE = max( trE, uTrEdgeCoarse.x );
  if ( uv.x > 0.9999 ) trE = max( trE, uTrEdgeCoarse.y );
  if ( uv.y < 0.0001 ) trE = max( trE, uTrEdgeCoarse.z );
  if ( uv.y > 0.9999 ) trE = max( trE, uTrEdgeCoarse.w );
  transformed += morphDelta * max( 1.0 - uTrMorph, trE );
  // coarse tiles around the camera follow the analytic ground at the camera until the fine chain arrives
  // (model matrix = translation only, so a world-space offset is a local one)
  if ( uTrDatum.w > 0.5 ) {
    vec3 trWp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    vec3 trCu = normalize( - uTrPlanetCenter );
    float trHd = length( trWp - trCu * dot( trWp, trCu ) );
    transformed += normalize( trWp - uTrPlanetCenter ) * ( uTrDatum.x * ( 1.0 - smoothstep( uTrDatum.y, uTrDatum.z, trHd ) ) );
  }
  vTrUv = uv;
  vTrWl = trWl;
  vTrGN = normal;
  vTrLoc = transformed;
  vTrPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  // height above sea level from tile-local coordinates (precise in float32; tile centre is at
  // sea level on the centre direction uTrUpC): |C + t| - R ≈ t·up + (|t|² - (t·up)²) / 2R
  float trD = dot( transformed, uTrUpC );
  vTrH = trD + ( dot( transformed, transformed ) - trD * trD ) / 6779000.0;
}
`;

const FRAG_PARS = /* glsl */`
varying vec2 vTrUv;
varying vec3 vTrPos;
varying vec2 vTrWl;
varying vec3 vTrGN;
varying vec3 vTrLoc;
uniform vec3 uTrCMod;            // tile centre ECEF mod 65536 m (world-anchored periodic 3D noise)
uniform float uTrMorph;
uniform float uTrHasParent;
uniform vec4 uTrEdgeCoarse;
uniform vec4 uTrParentXf;
uniform sampler2D uTrParentMap;
uniform sampler2D uTrParentNormal;
uniform float uTrLevel;
uniform int uTrDebug;
uniform vec3 uTrPlanetCenter;
uniform vec3 uTrSunDir;
uniform float uTrNightGate;
#ifdef TR_DEBUG_MAPS
uniform sampler2D uTrDbgMap;
#endif
uniform vec3 uTrProvColors[ 13 ];
uniform vec2 uTrDetailOrigin;   // metres: (a0·FACE_ARC) mod 2621.44, (b0·FACE_ARC) mod 2621.44
uniform vec2 uTrFaceOrigin;     // metres: a0·FACE_ARC, b0·FACE_ARC (non-periodic, float32 ≈ 0.3 m)
uniform float uTrTileMeters;    // (a1-a0)·FACE_ARC
uniform float uTrTexRes;
uniform vec3 uTrFaceU;
uniform vec3 uTrFaceV;
uniform float uTrDetail;        // global detail strength (0 disables)
uniform vec3 uTrExag;           // relief exaggeration (max factor, log2 footprint start, end)
uniform vec2 uTrStreetBand;
uniform vec4 uTrCityFade;
uniform vec2 uTrCityMax;
varying float vTrH;
// night light colour from the texel temperature (mirrors world/surface.js lightColour)
vec3 trLightColour( float t ) {
  vec3 c = mix( vec3( 1.0, 0.47, 0.13 ), vec3( 1.0, 0.76, 0.44 ), smoothstep( 0.30, 0.68, t ) );
  return mix( c, vec3( 0.74, 0.86, 1.0 ), smoothstep( 0.68, 0.95, t ) );
}
// decoded night light (window units, before the night gate) of an emission texel at camera distance d
vec3 trEmission( vec4 e, float d ) {
  float wS = smoothstep( uTrStreetBand.x, uTrStreetBand.y, d );
  float px = uTrCityFade.x / max( d, 1.0 );
  float vis = smoothstep( uTrCityFade.y, uTrCityFade.z, px ) * ( 1.0 - smoothstep( uTrCityMax.x, uTrCityMax.y, d ) );
  float wF = 1.0 - vis * uTrCityFade.w;
  return trLightColour( e.b ) * ( e.r * ${EMIT_FAR_RANGE.toFixed(1)} * wF + e.g * ${EMIT_STREET_RANGE.toFixed(1)} * wS );
}
float trHash1( float x ) { uint u = uint( int( mod( x, 65536.0 ) ) ); u = u * 747796405u + 2891336453u; u = ( ( u >> ( ( u >> 28u ) + 4u ) ) ^ u ) * 277803737u; u = ( u >> 22u ) ^ u; return float( u & 0xffffffu ) / 16777216.0; }
float trNoise1( float x ) { float i = floor( x ), f = x - i; float u = f * f * ( 3.0 - 2.0 * f ); return mix( trHash1( i ), trHash1( i + 1.0 ), u ) * 2.0 - 1.0; }
uint trHashU( uvec2 v ) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v.x ^ v.y;
}
float trHash( vec2 p ) { uvec2 q = uvec2( ivec2( mod( p, 8192.0 ) ) ); return float( trHashU( q ) & 0xffffffu ) / 16777216.0; }
// periodic (8192 cells) value noise with analytic derivative: (value -1..1, d/dx, d/dy)
vec3 trNoised( vec2 x ) {
  vec2 i = floor( x ), f = x - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  float a = trHash( i ), b = trHash( i + vec2( 1.0, 0.0 ) ), c = trHash( i + vec2( 0.0, 1.0 ) ), d = trHash( i + vec2( 1.0, 1.0 ) );
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  return vec3( v * 2.0 - 1.0, 2.0 * du * vec2( k1 + k3 * u.y, k2 + k3 * u.x ) );
}
// periodic 3D value noise (-1..1): cell indices wrap at "per" cells (per·λ = 65536 m for every octave, so the
// tile-local position + (centre mod 65536) gives the same noise in every tile)
float trHash3( vec3 c, float per ) {
  uvec3 q = uvec3( ivec3( mod( c, per ) ) );
  uint h = ( q.x * 1597334677u ) ^ ( q.y * 3812015801u ) ^ ( q.z * 2741598923u );
  h = ( h ^ ( h >> 16u ) ) * 2246822519u; h ^= h >> 13u; h *= 3266489917u; h ^= h >> 16u;
  return float( h & 0xffffffu ) / 16777216.0;
}
float trNoise3( vec3 x, float per ) {
  vec3 i = floor( x ), f = x - i;
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  float a = trHash3( i, per ), b = trHash3( i + vec3( 1.0, 0.0, 0.0 ), per );
  float c = trHash3( i + vec3( 0.0, 1.0, 0.0 ), per ), d = trHash3( i + vec3( 1.0, 1.0, 0.0 ), per );
  float e = trHash3( i + vec3( 0.0, 0.0, 1.0 ), per ), f1 = trHash3( i + vec3( 1.0, 0.0, 1.0 ), per );
  float g = trHash3( i + vec3( 0.0, 1.0, 1.0 ), per ), h = trHash3( i + vec3( 1.0, 1.0, 1.0 ), per );
  return mix( mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ), mix( mix( e, f1, u.x ), mix( g, h, u.x ), u.y ), u.z ) * 2.0 - 1.0;
}
vec3 trHue( float h ) { vec3 k = clamp( abs( fract( h + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 ) - 1.0, 0.0, 1.0 ); return k; }
vec2 trLatLonUv( vec3 dir ) {
  float lat = asin( clamp( dir.y, -1.0, 1.0 ) );
  float lon = atan( dir.x, dir.z );
  return vec2( ( lon + PI ) / ( 2.0 * PI ), ( 0.5 * PI - lat ) / PI );
}
`;

// albedo + normal/gloss fetch (with parent cross-fade while morphing), replaces <map_fragment>
const FRAG_MAP = /* glsl */`
vec4 trAlb = texture2D( map, vMapUv );
vec4 trNrm = texture2D( normalMap, vNormalMapUv );
// screen derivatives in uniform control flow (used by the water dry-out and the steep-face material below)
vec2 trDux = dFdx( vTrUv ), trDuy = dFdy( vTrUv );
vec2 trMgx = dFdx( vMapUv ), trMgy = dFdy( vMapUv );
float trHx = dFdx( vTrH ), trHy = dFdy( vTrH );
float trHdx = max( abs( trHx ) + abs( trHy ), 1e-4 );               // metres of height per pixel
vec4 trAlbC = texture2D( map, vMapUv, 2.0 );                         // local mean colour (no streaks), steep faces
// parent texture weight: cross-fade while morphing, and a band along edges that border a coarser displayed
// neighbour (uTrEdgeCoarse): there the tile fades to its parent's texture (the neighbour's level), so tiles
// of different levels meet without a hard texture seam where the urban plan's raster levels differ
float trPw = 1.0 - uTrMorph;
if ( uTrHasParent > 0.5 && dot( uTrEdgeCoarse, vec4( 1.0 ) ) > 0.5 ) {
  vec4 trEb = vec4( 1.0 ) - smoothstep( vec4( 0.0 ), vec4( 0.22 ), vec4( vTrUv.x, 1.0 - vTrUv.x, vTrUv.y, 1.0 - vTrUv.y ) );
  trEb *= uTrEdgeCoarse;
  trPw = max( trPw, max( max( trEb.x, trEb.y ), max( trEb.z, trEb.w ) ) );
}
if ( trPw > 0.001 && uTrHasParent > 0.5 ) {
  vec2 puv = vTrUv * uTrParentXf.z + uTrParentXf.xy;
  puv = puv * ( uTrParentXf.w - 1.0 ) / uTrParentXf.w + 0.5 / uTrParentXf.w;
  vec2 pgx = trDux * uTrParentXf.z, pgy = trDuy * uTrParentXf.z;
  trAlb = mix( trAlb, textureGrad( uTrParentMap, puv, pgx, pgy ), trPw );
  trNrm = mix( trNrm, textureGrad( uTrParentNormal, puv, pgx, pgy ), trPw );
  trAlbC = mix( trAlbC, trAlb, trPw );
}
vec3 trUpW = normalize( vTrPos - uTrPlanetCenter );
float trFoot = max( length( fwidth( vTrPos ) ), 1e-5 );         // metres per pixel
// ---- resolved water on mesh parts above the water surface (coarse shore triangles at grazing views): the water
// mesh is occluded there, so the bed-through-water tint and the level gloss would draw blue glossy teeth on the
// bank. Replace them by the dry bank seen uphill (the mesh height is linear in uv per triangle: exact gradient),
// darker / wetter just above the waterline; the lit normal becomes the mesh normal (FRAG_NORMAL).
float trDryW = 0.0;
if ( vTrWl.y > 0.999 && trNrm.a > 0.8 ) {
  float trAbove = vTrH - vTrWl.x;
  trDryW = smoothstep( 0.15, 0.6, trAbove ) * smoothstep( 0.8, 0.88, trNrm.a );
  if ( trDryW > 0.0 ) {
    float det = trDux.x * trDuy.y - trDux.y * trDuy.x;
    vec2 g = abs( det ) > 1e-14 ? vec2( trHx * trDuy.y - trHy * trDux.y, trDux.x * trHy - trDuy.x * trHx ) / det : vec2( 0.0 );
    vec2 dir = dot( g, g ) > 1e-18 ? normalize( g ) : vec2( 0.0 );
    float ts = 1.0 / uTrTexRes;
    vec4 a1 = textureGrad( map, vMapUv + dir * ts * 2.5, trMgx, trMgy ), n1 = textureGrad( normalMap, vNormalMapUv + dir * ts * 2.5, trMgx, trMgy );
    vec4 a2 = textureGrad( map, vMapUv + dir * ts * 6.0, trMgx, trMgy ), n2 = textureGrad( normalMap, vNormalMapUv + dir * ts * 6.0, trMgx, trMgy );
    vec3 dryC = n1.a < 0.7 ? a1.rgb : ( n2.a < 0.7 ? a2.rgb : vec3( 0.15, 0.095, 0.065 ) );
    dryC *= mix( 0.62, 1.0, smoothstep( 0.6, 3.0, trAbove ) );
    trAlb.rgb = mix( trAlb.rgb, dryC, trDryW );
    trAlbC.rgb = mix( trAlbC.rgb, dryC, trDryW );
    trNrm.a = mix( trNrm.a, min( trNrm.a, 0.42 ), trDryW );
  }
}
// ---- steep faces (R2, QQ-11 / S04): the tile textures are a planar projection of the face (a, b) grid, stretched
// by 1/cos(slope) on cliffs ("curtains"). Above ~46° the colour becomes an unstretched procedural material over the
// local mean colour (coarser mip): rock = strata bands from the precise height (wobbling, every band faded by its
// on-screen resolvability) + world-anchored 3D blocks / mottling (no projection axis at all); ice cliffs (bright,
// blue-white texels) = thin dust layers, blue recesses, a little gloss. The lit normal loses the stretched texture
// detail and gets strata ledges + blocks as a screen-derivative bump (FRAG_NORMAL).
vec3 trGeoN = normalize( vTrGN );
float trCosS = min( dot( trGeoN, trUpW ), dot( normalize( trNrm.xyz * 2.0 - 1.0 ), trUpW ) );
float trCliffW = ( 1.0 - smoothstep( 0.42, 0.70, trCosS ) ) * ( 1.0 - smoothstep( 0.62, 0.8, trNrm.a ) ) * step( 0.001, uTrDetail );
float trStretch = 1.0 - smoothstep( 0.28, 0.6, trCosS );
float trBump = 0.0;
if ( trCliffW > 0.001 ) {
  vec3 trBase = trAlbC.rgb;
  float trLum = dot( trBase, vec3( 0.3, 0.5, 0.2 ) );
  float trIce = smoothstep( 0.22, 0.40, trLum ) * smoothstep( 0.0, 0.06, trBase.b - trBase.r * 0.97 );   // blue-white only
  vec3 pw = uTrCMod + vTrLoc;
  float wob = trNoise3( pw / 128.0, 512.0 ) * 7.0 + trNoise3( pw / 32.0, 2048.0 ) * 1.6;
  float hh = vTrH + wob;
  float band = 0.0, bn = 0.0, lam = 22.0;
  for ( int o = 0; o < 6; o ++ ) {
    float w = clamp( lam / trHdx * 0.33 - 1.0, 0.0, 1.0 );
    float a = pow( lam / 22.0, 0.4 );
    band += w * a * trNoise1( hh / lam + float( o ) * 31.7 );
    bn += a;
    lam *= 0.43;                                                  // 22, 9.5, 4.1, 1.75, 0.75, 0.32 m
  }
  band /= bn;
  float mot = 0.0, mn = 0.0, l3 = 16.0, per = 4096.0;
  for ( int o = 0; o < 5; o ++ ) {
    float w = clamp( l3 / trFoot * 0.5 - 1.0, 0.0, 1.0 );
    float a = pow( l3 / 16.0, 0.5 );
    mot += w * a * trNoise3( pw / l3 + float( o ) * 7.13, per );
    mn += a;
    l3 *= 0.5; per *= 2.0;                                        // 16 … 1 m
  }
  mot /= mn;
  // rock: pale / tan and deep red layers, darker blocks
  vec3 rockC = trBase * ( 1.0 + 0.38 * band + 0.18 * mot );
  rockC *= mix( vec3( 1.0 ), vec3( 1.16, 1.07, 0.94 ), smoothstep( 0.15, 0.55, band ) * 0.6 );
  rockC *= mix( vec3( 1.0 ), vec3( 0.80, 0.68, 0.64 ), smoothstep( -0.15, -0.55, band ) * 0.6 );
  // ice: dust layers (thin, dark, from the height), blue light in recesses
  float dl = smoothstep( 0.58, 0.86, trNoise1( hh / 2.6 + 5.3 ) * 0.5 + 0.5 ) * clamp( 2.6 / trHdx * 0.33 - 1.0, 0.0, 1.0 );
  float dl2 = smoothstep( 0.62, 0.9, trNoise1( hh / 11.0 + 1.7 ) * 0.5 + 0.5 ) * clamp( 11.0 / trHdx * 0.33 - 1.0, 0.0, 1.0 );
  vec3 iceC = trBase * ( 1.0 + 0.08 * mot + 0.06 * band );
  iceC *= mix( vec3( 1.0 ), vec3( 0.70, 0.64, 0.60 ), max( dl * 0.5, dl2 * 0.35 ) );
  iceC *= mix( vec3( 1.0 ), vec3( 0.74, 0.90, 1.10 ), smoothstep( 0.05, 0.6, - mot ) * 0.55 );
  // fix round 3: keep the vertical crevasse slots of the texture (sampleTerrain.crevasse → deep cold blue texels, which
  // run down the face, i.e. along the projection stretch, so they are not curtains): strong, blue darkening only
  float trCrev = trIce * smoothstep( 0.22, 0.55, 1.0 - trAlb.r / max( trBase.r, 0.02 ) ) * smoothstep( 0.0, 0.06, trAlb.b - trAlb.r );
  iceC = mix( iceC, trAlb.rgb, trCrev );
  trAlb.rgb = mix( trAlb.rgb, mix( rockC, iceC, trIce ), trCliffW );
  trNrm.a = max( trNrm.a, 0.5 * trIce * trCliffW );
  trBump = trCliffW * ( ( 1.0 - trIce ) * ( 0.9 * band + 0.35 * mot ) + trIce * ( 0.25 * mot - 0.2 * dl ) );
} else if ( uTrDetail > 0.0 ) {
  // moderate slopes of red rock (28°–46°): gentle strata on the texture colour
  float trSteep = 1.0 - trCosS;
  float trRock = smoothstep( 0.12, 0.3, trSteep ) * ( 1.0 - trNrm.a ) * clamp( ( trAlb.r - trAlb.b ) * 5.0 - 0.15, 0.0, 1.0 );
  if ( trRock > 0.01 ) {
    float band = 0.0, nrm = 0.0, lam = 26.0;
    for ( int o = 0; o < 6; o ++ ) {
      float w = clamp( lam / trHdx * 0.33 - 1.0, 0.0, 1.0 );
      float a = pow( lam / 26.0, 0.35 );
      band += w * a * trNoise1( vTrH / lam + float( o ) * 31.7 );
      nrm += a;
      lam *= 0.36;
    }
    trAlb.rgb *= 1.0 + 0.30 * band / nrm * trRock * uTrDetail;
  }
}
diffuseColor.rgb *= trAlb.rgb;
float trGloss = trNrm.a;
// ---- procedural sub-texel detail (only frequencies the texture cannot hold, screen-filtered)
vec2 trDetailGrad = vec2( 0.0 );
if ( uTrDetail > 0.0 ) {
  vec2 dc = uTrDetailOrigin + vTrUv * uTrTileMeters;            // metres in face-plane units
  float foot = max( max( length( trDux ), length( trDuy ) ) * uTrTileMeters, 1e-5 );
  float texelM = uTrTileMeters / uTrTexRes;
  float val = 0.0, norm = 0.0;
  float lam = 0.32;                                             // 32 cm .. 1 cm octaves
  for ( int o = 0; o < 6; o ++ ) {
    float wTex = clamp( 2.0 - 0.5 * lam / texelM, 0.0, 1.0 );   // only finer than the texture holds (λ < 2–4 texels)
    float wPix = clamp( lam / foot * 0.5 - 1.0, 0.0, 1.0 );     // resolved on screen (no aliasing)
    float w = wTex * wPix * ( 1.0 - trStretch * trCliffW );     // planar noise: not on stretched cliffs
    float a = pow( lam / 0.32, 0.55 );
    if ( w > 0.0 ) {
      vec3 n = trNoised( dc / lam + float( o ) * 17.31 );
      val += n.x * a * w;
      trDetailGrad += n.yz / lam * a * w;
    }
    norm += a;
    lam *= 0.5;
  }
  float k = uTrDetail * ( 1.0 - 0.85 * trGloss );
  diffuseColor.rgb *= 1.0 + 0.16 * k * val / norm;
  trDetailGrad *= 0.012 * k / norm;                             // relief amplitude ≈ 1 cm
}
`;
const FRAG_ROUGH = /* glsl */`
float roughnessFactor = mix( 0.95, 0.22, trGloss );
`;
const FRAG_NORMAL = /* glsl */`
vec3 trObjN = normalize( trNrm.xyz * 2.0 - 1.0 );
// open water (gloss ≥ 0.86 is reserved for water texels): exact level surface instead of the 8-bit
// quantised normal (no sparkle pattern in the sun glint)
trObjN = normalize( mix( trObjN, trUpW, smoothstep( 0.84, 0.88, trGloss ) ) );
// dried shore texels (mesh above the water surface) and stretched cliff texels: the mesh normal instead of the
// flattened / streaked texel normal
trObjN = normalize( mix( trObjN, trGeoN, max( trDryW, 0.75 * trStretch * trCliffW ) ) );
{
  // steep faces: strata ledges and blocks as a bump (surface gradient from screen derivatives, metres)
  float bx = dFdx( trBump ), by = dFdy( trBump );
  vec3 dpx = dFdx( vTrPos ), dpy = dFdy( vTrPos );
  vec3 r1 = cross( dpy, trObjN ), r2 = cross( trObjN, dpx );
  float dt = dot( dpx, r1 );
  if ( abs( dt ) > 1e-12 && trCliffW > 0.001 ) {
    vec3 gr = sign( dt ) * ( bx * r1 + by * r2 );
    trObjN = normalize( abs( dt ) * trObjN - gr * 1.1 );
  }
}
{
  // footprint-driven relief exaggeration (orbit readability), seamless across tile levels
  float ex = mix( 1.0, uTrExag.x, smoothstep( uTrExag.y, uTrExag.z, log2( trFoot ) ) );
  if ( ex > 1.001 ) {
    float nu = dot( trObjN, trUpW );
    vec3 tg = trObjN - trUpW * nu;
    trObjN = normalize( trUpW * max( nu, 0.05 ) + tg * ex );
  }
}
if ( uTrDetail > 0.0 ) {
  vec3 tU = normalize( uTrFaceU - trObjN * dot( uTrFaceU, trObjN ) );
  vec3 tV = normalize( uTrFaceV - trObjN * dot( uTrFaceV, trObjN ) );
  trObjN = normalize( trObjN - trDetailGrad.x * tU - trDetailGrad.y * tV );
}
normal = normalize( normalMatrix * trObjN );
`;
const FRAG_AO = /* glsl */`
reflectedLight.indirectDiffuse *= trAlb.a;
reflectedLight.indirectSpecular *= mix( 1.0, trAlb.a, 0.7 );
`;
// Runs after three's <emissivemap_fragment> and the lighting patch's LP_EMISSIVE (which only scale by
// the night gate and EMISSIVE_SCALE): the emission texture is data (window aggregate, street light,
// temperature, onset), so the radiance is rebuilt here with the same gate / unit the patch applies.
const FRAG_EMISSIVE_GATE = /* glsl */`
#ifdef USE_EMISSIVEMAP
{
  vec4 trEm = emissiveColor;                      // RGB linear (sRGB texture), A = onset
  // orbit footprints (A02): point-like lights — local contrast against the 4× coarser mip (towns and
  // cores brighter than their surroundings get brighter, the gaps between them darker), so a bright
  // core keeps its internal structure and edges instead of a soft magnified blob
  float trKo = smoothstep( 1500.0, 6000.0, trFoot );
  if ( trKo > 0.0 ) {
    vec4 trEmB = texture2D( emissiveMap, vEmissiveMapUv, 2.0 );
    float trI = trEm.r * ${EMIT_FAR_RANGE.toFixed(1)} + trEm.g * ${EMIT_STREET_RANGE.toFixed(1)};
    float trIm = trEmB.r * ${EMIT_FAR_RANGE.toFixed(1)} + trEmB.g * ${EMIT_STREET_RANGE.toFixed(1)};
    trEm.rg *= pow( clamp( trI / ( trIm + 1e-3 ), 0.0, 6.0 ), 0.65 * trKo );
  }
  // regional footprints (≈ 3 m – 3 km per pixel): seen from above, window light reads along the lit streets
  // (shop fronts, entrances, facades lining the street), not as a uniform fill of every block — the window
  // aggregate is redistributed by the street light against its 5–6× coarser mip (mean preserving), so a
  // district at 5–50 km is a glowing street network with darker block interiors instead of a flat sheet
  float trKr = smoothstep( 2.0, 8.0, trFoot ) * ( 1.0 - smoothstep( 1500.0, 6000.0, trFoot ) );
  if ( trKr > 0.0 ) {
    float trSm = texture2D( emissiveMap, vEmissiveMapUv, 2.5 ).g;
    trEm.r *= mix( 1.0, 0.25 + 0.75 * clamp( trEm.g / ( trSm + 1e-4 ), 0.0, 4.0 ), 0.8 * trKr );
  }
  // regional footprints (≈ 3–60 m per pixel): the window aggregate of a texel is the average of lit and
  // dark buildings; drawn as a fine field of warm dots (mean 1, world-anchored jittered 34 m cells, ~60 %
  // lit, soft discs of varying size / brightness, only once the cells span ≥ 1–3 pixels) instead of a flat
  // sheet (§1 住宅的细密暖光). Orbit footprints average it away; near the camera the 3D windows take over.
  {
    vec2 q = ( uTrFaceOrigin + vTrUv * uTrTileMeters ) / 34.0;
    float w = clamp( 34.0 / trFoot * 0.5 - 0.5, 0.0, 1.0 ) * smoothstep( 0.6, 3.0, trFoot );
    if ( w > 0.0 ) {
      vec2 c = floor( q );
      float h = trHash( c + 1971.0 ), h2 = trHash( c + 3313.0 ), h3 = trHash( c + 577.0 );
      vec2 jit = vec2( h2, h3 ) * 0.5 - 0.25;
      float rr = 0.20 + 0.16 * fract( h * 5.17 );
      float d = length( fract( q ) - 0.5 - jit );
      float v = ( h < 0.6 ? 1.0 : 0.0 ) * ( 1.0 - smoothstep( rr * 0.55, rr, d ) ) * ( 0.6 + 0.8 * fract( h * 7.31 ) );
      trEm.r *= mix( 1.0, v / 0.11, w * 0.6 );        // E[v] ≈ 0.6 lit × ≈ 0.18 disc area
    }
  }
  vec3 trE = trEmission( trEm, length( vTrPos ) );
  float trGate = 1.0;
  #if defined( LP_NIGHT_EMISSIVE )
  trGate = lpNightGate( lpMuS, trEm.a ) * uNightLights * uLpEmissiveScale;
  #elif defined( LP_PATCHED )
  trGate = uLpEmissiveScale;
  #else
  // fallback night gating when the planet lighting patch does not gate emissive itself
  if ( uTrNightGate > 0.5 ) {
    float trSunH = dot( trUpW, uTrSunDir );        // sin(sun elevation) of the local horizon
    float trTh = mix( 0.035, -0.10, trEm.a );      // early lights at +2°, late at -6°
    trGate = 1.0 - smoothstep( trTh - 0.03, trTh + 0.03, trSunH );
  }
  #endif
  totalEmissiveRadiance = emissive * trE * trGate;
}
#endif
`;
const FRAG_DEBUG = /* glsl */`
if ( uTrDebug > 0 ) {
  vec3 trDir = trUpW;
  vec3 trWN = trObjN;
  float trLam = 0.38 + 0.62 * max( dot( trWN, uTrSunDir ), 0.0 );
  vec3 dbg = vec3( 1.0, 0.0, 1.0 );
  #ifdef TR_DEBUG_MAPS
  if ( uTrDebug >= 1 && uTrDebug <= 3 ) {
    vec2 llUv = trLatLonUv( trDir );
    vec4 cm = texture2D( uTrDbgMap, vec2( llUv.x, 1.0 - llUv.y ) );
    if ( uTrDebug == 1 ) {
      int ii = int( clamp( floor( cm.r * 255.0 + 0.5 ), 0.0, 12.0 ) );
      dbg = uTrProvColors[ ii ] * trLam;
    } else if ( uTrDebug == 2 ) {
      dbg = ( cm.g > 0.5 ? vec3( 0.80, 0.42, 0.20 ) : vec3( 0.18, 0.55, 0.58 ) ) * trLam;
    } else {
      // built density: manual bilinear on the nearest-filtered packed map
      vec2 ts = vec2( textureSize( uTrDbgMap, 0 ) );
      vec2 f = vec2( llUv.x, 1.0 - llUv.y ) * ts - 0.5, i0 = floor( f ), w = f - i0;
      float d00 = texture2D( uTrDbgMap, ( i0 + vec2( 0.5, 0.5 ) ) / ts ).b, d10 = texture2D( uTrDbgMap, ( i0 + vec2( 1.5, 0.5 ) ) / ts ).b;
      float d01 = texture2D( uTrDbgMap, ( i0 + vec2( 0.5, 1.5 ) ) / ts ).b, d11 = texture2D( uTrDbgMap, ( i0 + vec2( 1.5, 1.5 ) ) / ts ).b;
      float d = mix( mix( d00, d10, w.x ), mix( d01, d11, w.x ), w.y );
      dbg = mix( vec3( 0.02, 0.03, 0.08 ), vec3( 1.0, 0.85, 0.4 ), d ) * ( 0.5 + 0.5 * trLam );
    }
  } else
  #endif
  if ( uTrDebug == 4 ) {
    #ifdef USE_EMISSIVEMAP
    // decoded night light (all parts, no distance weighting / gate): ~1 window unit → mid grey
    vec4 trEd = texture2D( emissiveMap, vEmissiveMapUv );
    vec3 trEl = trLightColour( trEd.b ) * ( trEd.r * ${EMIT_FAR_RANGE.toFixed(1)} + trEd.g * ${EMIT_STREET_RANGE.toFixed(1)} );
    dbg = trEl / ( trEl + 1.0 ) + diffuseColor.rgb * 0.04;
    #endif
  } else if ( uTrDebug == 5 ) {
    vec2 g = vTrUv * 64.0;
    vec2 fw = max( fwidth( g ), vec2( 1e-5 ) );
    vec2 f = abs( fract( g - 0.5 ) - 0.5 ) / fw;
    vec2 cell = floor( g );
    vec2 q = fract( g );
    float par = mod( cell.x + cell.y, 2.0 );
    float dd = par < 0.5 ? ( q.x - q.y ) : ( q.x + q.y - 1.0 );
    float dl = abs( dd ) / max( fwidth( dd ), 1e-5 );
    float line = 1.0 - clamp( min( min( f.x, f.y ), dl ) - 0.5, 0.0, 1.0 );
    dbg = mix( outgoingLight, vec3( 0.2, 1.0, 0.45 ) * max( 0.05, dot( outgoingLight, vec3( 0.33 ) ) * 4.0 + 0.05 ), line * 0.85 );
  } else if ( uTrDebug == 6 ) {
    vec3 c = trHue( uTrLevel * 0.137 ) * 0.8 + 0.2;
    vec2 e = min( vTrUv, 1.0 - vTrUv ) / max( fwidth( vTrUv ), vec2( 1e-6 ) );
    float border = 1.0 - clamp( min( e.x, e.y ) - 1.0, 0.0, 1.0 );
    dbg = mix( c * trLam, vec3( 0.0 ), border * 0.9 );
    if ( uTrMorph < 0.999 ) dbg = mix( dbg, vec3( 1.0 ), 0.35 );
    if ( uTrTexRes > 300.0 ) dbg *= 1.15;
  } else if ( uTrDebug == 7 ) {
    dbg = trWN * 0.5 + 0.5;
  }
  outgoingLight = dbg;
}
`;

/**
 * Create the material of one tile.
 * @param {TerrainShared} shared
 * @param {{albedo:THREE.Texture, normal:THREE.Texture, emission:THREE.Texture|null, level:number}} t
 * @param {object} lighting app.lighting (optional)
 */
export function createTileMaterial(shared, t, lighting) {
  const mat = new THREE.MeshStandardMaterial({
    map: t.albedo,
    normalMap: t.normal,
    normalMapType: THREE.ObjectSpaceNormalMap,
    emissiveMap: t.emission || shared.black,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: EMISSIVE_SCALE,
    roughness: 1, metalness: 0,
  });
  const u = {
    uTrMorph: { value: 1 },
    uTrEdgeCoarse: { value: new THREE.Vector4() },
    uTrHasParent: { value: 0 },
    uTrParentXf: { value: new THREE.Vector4(0, 0, 0.5, 256) },
    uTrParentMap: { value: shared.grey },
    uTrParentNormal: { value: shared.grey },
    uTrLevel: { value: t.level },
    uTrDetailOrigin: { value: new THREE.Vector2().fromArray(t.detailOrigin || [0, 0]) },
    uTrFaceOrigin: { value: new THREE.Vector2().fromArray(t.faceOrigin || [0, 0]) },
    uTrTileMeters: { value: t.tileMeters || 1 },
    uTrTexRes: { value: t.texRes || 256 },
    uTrFaceU: { value: new THREE.Vector3().fromArray(t.faceU || [1, 0, 0]) },
    uTrFaceV: { value: new THREE.Vector3().fromArray(t.faceV || [0, 1, 0]) },
    uTrUpC: { value: new THREE.Vector3().fromArray(t.upC || [0, 1, 0]) },
    uTrCMod: { value: new THREE.Vector3().fromArray(t.cMod || [0, 0, 0]) },
  };
  mat.userData.trUniforms = u;
  mat.userData.isTerrain = true;
  mat.defines = mat.defines || {};
  if (shared.debugMapsOn) mat.defines.TR_DEBUG_MAPS = 1;
  const sharedU = shared.uniforms;
  const hook = function terrainHook(shader) {
    if (shader.__terrainPatched) return;
    shader.__terrainPatched = true;
    Object.assign(shader.uniforms, sharedU, mat.userData.trUniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    fs = fs.replace('#include <map_fragment>', FRAG_MAP);
    fs = fs.replace('#include <roughnessmap_fragment>', FRAG_ROUGH);
    fs = fs.replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    fs = fs.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
    fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE_GATE);
    fs = fs.replace('#include <opaque_fragment>', FRAG_DEBUG + '\n#include <opaque_fragment>');
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.onBeforeCompile = hook;
  // every tile material compiles to the same program (the hook is identical): one cache key
  mat.customProgramCacheKey = () => 'terrain-tile-v5';
  // let the planet lighting extend the material (night gating, sky ambient, haze, cloud shadows)
  try { lighting?.patch?.(mat, { nightEmissive: true, emissiveOnsetAlpha: true, receiveCloudShadow: true }); } catch (e) { console.warn('[terrain] lighting.patch failed', e); }
  // patched: the lighting multiplies by its own emissive unit (uLpEmissiveScale) → author in units
  const lp = mat.defines && (mat.defines.LP_NIGHT_EMISSIVE || mat.defines.LP_PATCHED);
  mat.emissiveIntensity = lp ? EMISSIVE_UNITS : EMISSIVE_SCALE;
  if (mat.onBeforeCompile !== hook) {
    // the lighting patch replaced our hook: make sure both run (ours first, idempotent)
    const theirs = mat.onBeforeCompile;
    if (!/terrainHook|hook\.call|prevOBC/.test(theirs.toString())) {
      mat.onBeforeCompile = function terrainChain(shader, renderer) { hook.call(this, shader, renderer); theirs.call(this, shader, renderer); };
    }
  }
  return mat;
}
