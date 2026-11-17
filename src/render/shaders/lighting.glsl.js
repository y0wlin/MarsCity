// GLSL for the planet lighting patch (app.lighting.patch) and for custom shaders.
// OWNER: atmosphere agent. See the documentation block at the top of render/atmosphere/lighting.js.
import * as THREE from 'three';
import { atmosphereDefines } from '../atmosphere/model.js';
import { GLSL_MATH } from './common.glsl.js';
import { GLSL_ATMO_MEDIUM, GLSL_ATMO_LUT, GLSL_ATMO_MS, GLSL_ATMO_MARCH } from './atmosphere.glsl.js';
import { GLSL_CLOUD_PARS } from './clouds.glsl.js';

// ---- core pars: uniforms + atmosphere LUT lookups + cloud shadows + night gate ---------------
// (two samplers: uLpAtlas, uLpCloudMap)
export const LP_PARS = atmosphereDefines() + GLSL_MATH + /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uPlanetCenter;
uniform vec3 uLpSunE;
uniform vec3 uLpNightAmbient;
uniform float uLpEmissiveScale;
uniform float uNightLights;
uniform float uLpFrame;
uniform float uLpCloudsOn;
uniform sampler2D uLpCloudMap;
uniform float uLpCloudMode;
uniform vec3 uLpCloudAnchor;
uniform vec3 uLpCloudAxisE;
uniform vec3 uLpCloudAxisN;
uniform float uLpCloudExtent;
uniform vec2 uLpEnvRef;
uniform float uLpEnvOn;
uniform sampler2D uLpAO;
uniform mat4 uLpAOVP;
uniform float uLpAOOn;
uniform vec3 uLpGroundAlbedo;
` + GLSL_ATMO_MEDIUM + GLSL_ATMO_LUT + /* glsl */`
// planet-frame quantities of the current fragment (set by lpSetup / lpSetupWorld)
vec3 lpWorldPos;   // render space (camera at origin, ECEF axes)
vec3 lpPlanetPos;  // relative to the planet centre
vec3 lpUp;
float lpR;
float lpH;         // metres above sea level (+-0.3 m precision)
float lpMuS;       // cos of the local sun zenith angle

void lpSetupWorld(vec3 worldPos) {
  lpWorldPos = worldPos;
  lpPlanetPos = worldPos - uPlanetCenter;
  lpR = max(length(lpPlanetPos), 1.0);
  lpUp = lpPlanetPos / lpR;
  lpH = lpR - LP_R;
  lpMuS = dot(lpUp, uSunDir);
}
void lpSetup(vec3 viewPos) {
  lpSetupWorld(((vec4(viewPos, 1.0) - viewMatrix[3]) * viewMatrix).xyz);
}

// emissive night gate: lights come on when the local sun is below ~2 deg (onset 0) .. -6 deg (onset 1)
float lpNightGate(float mus, float onset) {
  float elev = asin(clamp(mus, -1.0, 1.0)) * 57.2957795;
  float thr = mix(2.0, -6.0, clamp(onset, 0.0, 1.0));
  return smoothstep(thr + 1.6, thr - 1.6, elev);
}

vec2 lpCloudMapSample(vec3 q) {
  if (uLpCloudMode < 0.5) {
    vec3 d = q - uLpCloudAnchor;
    vec2 uv = vec2(dot(d, uLpCloudAxisE), dot(d, uLpCloudAxisN)) / uLpCloudExtent + 0.5;
    float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    vec2 v = textureLod(uLpCloudMap, uv, 0.0).rg;
    return mix(vec2(1.0, 0.0), v, smoothstep(0.5, 0.44, edge));
  }
  vec3 dn = normalize(q);
  vec2 uv = vec2(atan(dn.x, dn.z) * 0.15915494 + 0.5, 0.5 - asin(clamp(dn.y, -1.0, 1.0)) * 0.31830989);
  return textureLod(uLpCloudMap, uv, 0.0).rg;
}
// cloud shadow at a point: x = direct-sun transmittance through the layer (soft, offset along the
// sun direction), y = cloud coverage straight above (used to dim the sky light under decks)
vec2 lpCloudShadow(vec3 p, float r, float h, vec3 up, float mus) {
  if (uLpCloudsOn < 0.5 || h > LP_CLOUD_TOP) return vec2(1.0, 0.0);
  float rc = LP_R + LP_CLOUD_MID;
  float A = (LP_CLOUD_MID - h) * (r + rc);
  float T = 1.0;
  if (A > 0.0) {
    float disc = r * r * mus * mus + A;
    float s = A / max(r * mus + sqrt(max(disc, 0.0)), 1e-3);
    T = lpCloudMapSample(p + uSunDir * s).x;
  } else {
    T = mix(lpCloudMapSample(up * rc).x, 1.0, smoothstep(LP_CLOUD_MID, LP_CLOUD_TOP, h));
  }
  float cov = lpCloudMapSample(up * rc).y * (1.0 - smoothstep(LP_CLOUD_BOT, LP_CLOUD_TOP, h));
  return vec2(T, cov);
}

// night sky light (airglow + starlight + the moons; art-directed, cool so the red ground reads dark
// mauve-grey instead of dim daylight): 50 % diffuse dome (brighter on upward faces) + 50 % soft
// directional light from the sun's azimuth at ~25 deg elevation (residual twilight / moonlight), so
// relief reads on the night side with one consistent light direction (A02: ~+-10 % per 5 deg of
// slope). uLpNightAmbient = the horizontal irradiance (unchanged meaning for other users).
vec3 lpNightIrradianceN(vec3 n) {
  vec3 d = normalize(lpUp * 0.42 + (uSunDir - lpUp * lpMuS) * 0.91);   // -> up at the antisolar point
  float dirK = min(max(dot(n, d), 0.0) / max(dot(lpUp, d), 0.2), 2.2);
  // fix round 2 (QQ-05): within a few km of the camera (street level) the night light is mostly a soft
  // dome; the directional part that lets relief read from afar lit facades like moonlit daylight.
  // Beyond ~20 km (every orbit / regional view) the split is the round-1 50/50.
  float wd = mix(0.15, 0.5, smoothstep(1500.0, 20000.0, length(lpWorldPos)));
  return uLpNightAmbient * ((1.0 - wd) * (0.60 + 0.40 * dot(n, lpUp)) + wd * dirK);
}
// light reflected by the ground below a surface (local albedo uLpGroundAlbedo, view factor of the
// lower hemisphere (1 - n.up)/2, ground irradiance of the lit / cloud-shadowed ground); absolute units
vec3 lpGroundBounceN(vec3 n, float cloudT) {
  float vf = clamp(0.5 - 0.5 * dot(n, lpUp), 0.0, 1.0);
  if (vf <= 0.0) return vec3(0.0);
  return uLpGroundAlbedo * lpGroundIrradiance(lpMuS) * uLpSunE * (vf * (0.15 + 0.85 * cloudT));
}
// screen-space ambient occlusion of the current fragment (GTAO of the previous frame, reprojected);
// 1 when off / outside. Apply to ambient (sky, bounce, environment) light only.
float lpAmbientOcclusion() {
  if (uLpAOOn < 0.5) return 1.0;
  vec4 pc = uLpAOVP * vec4(lpWorldPos, 1.0);
  if (pc.w <= 0.0) return 1.0;
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 1.0;
  return textureLod(uLpAO, uv, 0.0).r;
}
// sun irradiance reaching a point (colour * transmittance * cloud shadow), no shadow maps
vec3 lpSunIrradiance() {
  return uLpSunE * lpSunTransmittance(lpR, lpH, lpMuS) * lpCloudShadow(lpPlanetPos, lpR, lpH, lpUp, lpMuS).x;
}
// sky + ground-bounce irradiance on a surface with world normal n (absolute units)
vec3 lpSkyIrradianceN(vec3 n) {
  vec2 cs = lpCloudShadow(lpPlanetPos, lpR, lpH, lpUp, lpMuS);
  return lpSkyIrradiance(lpUp, uSunDir, lpH, n) * uLpSunE * (1.0 - 0.38 * cs.y) + lpGroundBounceN(n, cs.x) + lpNightIrradianceN(n);
}
`;

// cascaded shadow sampling; injected after <shadowmap_pars_fragment>
export const LP_SHADOW_PARS = /* glsl */`
uniform float uLpShadowOn;
uniform vec4 uLpCascadeFar;
uniform vec4 uLpPcfRadius;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
// slope: tan of the angle between the receiver's geometric normal and the sun (clamped). The depth of a
// tilted receiver changes by ~slope texels per texel, and the rotated PCF kernel reaches "radius"
// texels out, so the constant bias (1 texel, csm.js) grows with both (slope-scaled bias, fix round 2:
// grazing sun on slopes / far cascades)
float lpPcf( sampler2DShadow map, vec4 sc, float bias, vec2 msize, float radius, float phi, float slope ) {
  vec3 c = sc.xyz / sc.w;
  c.z += bias * ( 1.0 + slope * ( 0.6 + 0.5 * radius ) );
  if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
  vec2 tx = radius / msize;
  float s = 0.0;
  for ( int k = 0; k < 10; k ++ ) {
    float rr = sqrt( ( float( k ) + 0.5 ) / 10.0 );
    float th = float( k ) * 2.39996323 + phi;
    s += texture( map, vec3( c.xy + vec2( cos( th ), sin( th ) ) * rr * tx, c.z ) );
  }
  return s * 0.1;
}
#endif
float lpCascadeShadow( float viewZ, float ndl ) {
  float sh = 1.0;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  if ( uLpShadowOn > 0.5 && receiveShadow ) {
    float phi = lpIGN( gl_FragCoord.xy, uLpFrame ) * 6.2831853;
    float andl = clamp( abs( ndl ), 0.0, 1.0 );
    float slope = min( sqrt( max( 1.0 - andl * andl, 0.0 ) ) / max( andl, 0.1 ), 6.0 );
    int ci = NUM_DIR_LIGHT_SHADOWS;
    for ( int k = NUM_DIR_LIGHT_SHADOWS - 1; k >= 0; k -- ) { if ( viewZ < uLpCascadeFar[ k ] ) ci = k; }
    if ( ci < NUM_DIR_LIGHT_SHADOWS ) {
      float cfar = uLpCascadeFar[ ci ];
      float cnear = ci > 0 ? uLpCascadeFar[ ci - 1 ] : 0.0;
      float band = ( cfar - cnear ) * 0.14;
      float f = ( viewZ - ( cfar - band ) ) / band;
      if ( f > 0.0 && lpIGN( gl_FragCoord.xy + 13.0, uLpFrame + 5.0 ) < f ) ci ++;
    }
    if ( ci < NUM_DIR_LIGHT_SHADOWS ) {
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
        if ( UNROLLED_LOOP_INDEX == ci ) {
          sh = lpPcf( directionalShadowMap[ i ], vDirectionalShadowCoord[ i ], directionalLightShadows[ i ].shadowBias, directionalLightShadows[ i ].shadowMapSize, uLpPcfRadius[ i ], phi, slope );
        }
      }
      #pragma unroll_loop_end
    }
    float lastFar = uLpCascadeFar[ NUM_DIR_LIGHT_SHADOWS - 1 ];
    sh = mix( sh, 1.0, smoothstep( lastFar * 0.86, lastFar, viewZ ) );
  }
#endif
  return sh;
}
`;

export const LP_SETUP = /* glsl */`
lpSetup( - vViewPosition );
`;

export const LP_EMISSIVE = /* glsl */`
#ifdef LP_NIGHT_EMISSIVE
{
  float lpOnset = 0.0;
  #if defined( LP_EMISSIVE_ONSET ) && defined( USE_EMISSIVEMAP )
  lpOnset = emissiveColor.a;
  #endif
  totalEmissiveRadiance *= lpNightGate( lpMuS, lpOnset ) * uNightLights;
}
#endif
totalEmissiveRadiance *= uLpEmissiveScale;
`;

const LP_SUN = /* glsl */`
vec3 lpNormalW = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
#ifdef LP_CLOUD_SHADOW
vec2 lpCloud = lpCloudShadow( lpPlanetPos, lpR, lpH, lpUp, lpMuS );
#else
vec2 lpCloud = vec2( 1.0, 0.0 );
#endif
{
  vec3 lpSunT = lpSunTransmittance( lpR, lpH, lpMuS );
  directLight.color = uLpSunE * lpSunT * lpCloud.x;
  if ( directLight.color.r + directLight.color.g + directLight.color.b > 0.0 ) {
    directLight.direction = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
    directLight.color *= lpCascadeShadow( vViewPosition.z, dot( nonPerturbedNormal, directLight.direction ) );
    directLight.visible = true;
    #if defined( RE_Direct )
    RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    #endif
  }
}
`;

const LP_INDIRECT = /* glsl */`
float lpAO = lpAmbientOcclusion();
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = vec3( 0.0 );
	// sky dome + ground bounce + night light, all occluded by the ambient occlusion (the bounce from
	// below is what a balcony / canopy underside sees: GTAO darkens it next to the wall)
	vec3 lpSkyE = ( lpSkyIrradiance( lpUp, uSunDir, lpH, lpNormalW ) * uLpSunE * ( 1.0 - 0.38 * lpCloud.y ) + lpGroundBounceN( lpNormalW, lpCloud.x ) + lpNightIrradianceN( lpNormalW ) ) * lpAO;
	#ifdef LP_KEEP_SCENE_AMBIENT
		irradiance += getAmbientLightIrradiance( ambientLightColor );
	#endif
	#if defined( STANDARD )
		iblIrradiance += lpSkyE;
	#else
		irradiance += lpSkyE;
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif
float lpEnvScale = 1.0;
if ( uLpEnvOn > 0.5 ) {
	float lpRefL = lpLum( lpIrradianceDC( uLpEnvRef.x, uLpEnvRef.y ) );
	float lpHereL = lpLum( lpIrradianceDC( max( lpH, 0.0 ), lpMuS ) );
	lpEnvScale = clamp( lpHereL / max( lpRefL, 1e-7 ), 0.0, 2.5 ) * ( 1.0 - 0.3 * lpCloud.y );
}
#if defined( STANDARD ) || defined( PHYSICAL )
{
	// specular occlusion from the ambient occlusion (Lagarde & de Rousiers 2014)
	float lpNdV = saturate( dot( geometryNormal, geometryViewDir ) );
	lpEnvScale *= saturate( pow( lpNdV + lpAO, exp2( -16.0 * material.roughness - 1.0 ) ) - 1.0 + lpAO );
}
#endif
`;

let _built = null;
/** Build the replacement chunks from the pinned three.js r187 sources (point/spot/area lights,
 * iridescence and the multi-scattering setup are kept verbatim). */
export function buildLightChunks() {
  if (_built) return _built;
  const SRC = THREE.ShaderChunk.lights_fragment_begin;
  const iDirect = SRC.indexOf('IncidentLight directLight;');
  const iPoint = SRC.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const iSun = SRC.indexOf('#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )');
  const iRect = SRC.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )');
  const iInd = SRC.indexOf('#if defined( RE_IndirectDiffuse )');
  let begin;
  if (iDirect > 0 && iPoint > iDirect && iSun > iPoint && iRect > iSun && iInd > iRect) {
    const header = SRC.slice(0, iDirect).replace(/#if \( NUM_SUN_LIGHTS > 0 \|\| NUM_DIR_LIGHTS > 0 \|\| NUM_POINT_LIGHTS > 0 \|\| NUM_SPOT_LIGHTS > 0 \)/, '#if 1');
    begin = header + 'IncidentLight directLight;\n' + LP_SUN + SRC.slice(iPoint, iSun) + SRC.slice(iRect, iInd) + LP_INDIRECT;
  } else {
    console.warn('[lighting] unexpected lights_fragment_begin layout; point/spot lights disabled in patched materials');
    begin = /* glsl */`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	float EssMs = material.dfg.x + material.dfg.y;
	material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
#endif
IncidentLight directLight;
` + LP_SUN + LP_INDIRECT;
  }
  const MAPS = THREE.ShaderChunk.lights_fragment_maps;
  let maps = MAPS.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '/* lp: sky irradiance comes from the planet SH LUT */');
  maps = maps.replace('radiance += iblRadiance;', 'radiance += iblRadiance * lpEnvScale;');
  maps = maps.replace('clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );', 'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * lpEnvScale;');
  if (maps === MAPS) console.warn('[lighting] lights_fragment_maps not patched (layout changed)');
  _built = { begin, maps };
  return _built;
}

// ---- optional pars for custom shaders --------------------------------------------------------
// lp_atmosphere_pars: lpAtmosphere(rayDir, maxDist, out T) -> in-scattered radiance from the current
// fragment (after lpSetup*) along rayDir for maxDist metres (1e30 = to space), absolute units.
export const LP_ATMOSPHERE_PARS = GLSL_ATMO_MS + GLSL_ATMO_MARCH + /* glsl */`
vec3 lpAtmosphere(vec3 rd, float maxDist, out vec3 T) {
  float mu = dot(lpUp, rd);
  vec2 tt = lpRaySphere(lpR, lpH, mu, LP_ATMO_H);
  vec2 tg = lpRaySphere(lpR, lpH, mu, 0.0);
  float t1 = min(maxDist, max(tt.y, 0.0));
  if (mu < 0.0 && tg.x <= tg.y && tg.x > 0.0) t1 = min(t1, tg.x);
  vec3 L = vec3(0.0); T = vec3(1.0);
  lpIntegrate(lpR, max(lpH, 0.0), mu, lpMuS, dot(rd, uSunDir), max(tt.x, 0.0), t1, 16, 0.5, 1.6, L, T);
  return L * uLpSunE;
}
`;
// lp_clouds_pars: lpCloudCoverage(dir) -> 0..1 weather coverage at a planet-frame direction,
// lpCloudDensity(p, h, footprint, detail) -> the layer density used by the renderer.
export const LP_CLOUDS_PARS = GLSL_CLOUD_PARS + /* glsl */`
float lpCloudCoverage(vec3 dir) {
  return clamp(lpCoverageMul(lpCloudWeatherP(normalize(dir), 0.0).r), 0.0, 1.0);
}
`;

export function registerShaderChunks() {
  THREE.ShaderChunk.lp_lighting_pars = LP_PARS;
  THREE.ShaderChunk.lp_atmosphere_pars = GLSL_ATMO_MS + GLSL_ATMO_MARCH + LP_ATMOSPHERE_PARS.slice((GLSL_ATMO_MS + GLSL_ATMO_MARCH).length);
  THREE.ShaderChunk.lp_clouds_pars = LP_CLOUDS_PARS;
}
