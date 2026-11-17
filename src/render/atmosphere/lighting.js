// Planet lighting patch shared by every planet-anchored material. OWNER: atmosphere agent.
//
// ============================================================================================
// CONTRACT / HOW TO USE
// --------------------------------------------------------------------------------------------
//   app.lighting = new PlanetLighting(app)              (created by the atmosphere system)
//   app.lighting.patch(material, opts?) -> material     idempotent; MeshStandardMaterial,
//       MeshPhysicalMaterial, MeshLambertMaterial, MeshPhongMaterial (anything that uses
//       <lights_fragment_begin>). Keeps logdepth, instancing, batching, skinning, all maps.
//     opts.nightEmissive      (false) emissive only shows when the local sun is below ~2 deg,
//                             fading in through twilight (lights of windows, streets, harbours)
//     opts.emissiveOnsetAlpha (false) per-texel onset in emissiveMap.a: 0 = comes on early
//                             (sun at +2 deg), 1 = late (sun at -6 deg). Needs nightEmissive.
//     opts.receiveCloudShadow (true)  direct sun is attenuated by the cloud layer (soft, offset
//                             along the sun direction) and sky light is dimmed under decks
//     opts.keepSceneAmbient   (false) also add THREE.AmbientLight (normally ignored)
//   What every patched material gets:
//     * sun = SUN_ILLUMINANCE * colour * atmospheric transmittance at the fragment (reddening at
//       low sun, zero below the horizon incl. the sun-disc penumbra) * cloud shadow * cascaded
//       shadow maps (near the ground, see below)
//     * sky irradiance from an SH LUT of the real sky dome (blue in the shade) + the ground bounce
//       from below with the LOCAL ground albedo (uLpGroundAlbedo: pavement grey in cities, red in
//       canyons, green on farms, from world/fields.js at the camera), falling to zero through
//       twilight, plus a cool night-sky light (airglow / stars / moons: diffuse dome + a soft
//       directional part from the sun's azimuth so relief reads) so the night side stays low but
//       readable
//     * ground-level ambient occlusion: the pipeline's GTAO (camera < ~4 km above ground) is
//       reprojected into every patched material and multiplies sky / bounce / night light and the
//       environment reflection (specular occlusion) -- never the direct sun
//     * specular environment = scene.environment (sky captured at the camera) scaled per
//       fragment by the local sky brightness (so the night side / dusk reflections stay dark)
//     * emissive unit: totalEmissive *= EMISSIVE_SCALE (0.05). Author emissive = 1.0 for a typical
//       lit window/street lamp seen at night; 3-10 for bright cores (they bloom); day exposure
//       makes them invisible in daylight as in reality.
//     * aerial perspective / haze / clouds in front: applied per pixel by the pipeline's
//       atmosphere composite from the depth buffer -> automatic for everything that writes depth
//       (opaque materials and depth-writing transparents). Materials must NOT add their own fog.
//   Patched materials ignore DirectionalLight / AmbientLight / HemisphereLight / LightProbe (the
//   planet model supplies sun + sky); Point / Spot / RectArea lights work as usual.
//   If you need your own onBeforeCompile, assign it BEFORE calling patch(); patch() chains it
//   (yours runs first) and extends customProgramCacheKey.
//
// SHADOWS (CSM): app.sunLight (DirectionalLight, unshadowed, for unpatched materials), app.csm
//   (cascades). Within ~3 km of the camera when it is below ~8 km above ground, 4 cascades
//   (4096^2, sphere-fit, texel-snapped in an ECEF-anchored light frame -> no shimmering) are
//   rendered. To take part: mesh.castShadow = true and/or mesh.receiveShadow = true. Nothing else
//   (patched materials sample the cascades). Alpha-tested materials cast cut-out shadows.
//
// UNIFORMS: app.lighting.uniforms holds the shared uniform objects (same references in every
//   patched material): uSunDir (vec3, render/ECEF axes, towards the sun), uPlanetCenter (vec3,
//   render space), uCamAlt, uSolTime, uNightLights (float multiplier on night-gated emissive),
//   uLpSunE, uLpNightAmbient, uLpEmissiveScale, uLpAtlas, uLpCloud*, uLpShadowOn, uLpCascade*,
//   uLpEnv*, uLpAO / uLpAOVP / uLpAOOn, uLpGroundAlbedo, uLpFrame, and (for lp_clouds_pars) uCloud*.
//   Samplers added to a patched material: uLpAtlas, uLpCloudMap, uLpAO (+ the CSM shadow maps).
//
// PHOTOMETRY: scene units, extraterrestrial sun = SUN_ILLUMINANCE (8). Noon exposure ~0.45 (a
//   white Lambertian under the noon sun ~1.05 before tone mapping), night on the ground ~1.8 (fix
//   round 2: capped at +2 EV over noon so artificial light carries the night; regional views from
//   ~60 km: 8), the night side from orbit 5.0 (locked, see below). Emissive authored at 1.0 reads as a
//   lit window at night: the unit uLpEmissiveScale is EMISSIVE_SCALE (0.05) by day / from altitude and
//   rises with the ground night cap (x ~4.5 at night on the ground) -- bind the shared uniform object,
//   do not copy its value. Never tone-map in materials.
//   Orbit views (>= 600 km) use ONE locked day-side exposure (~0.6) whatever the framing; the
//   atmosphere composite lifts the NIGHT side (per surface point, local sun below ~-1 deg, full below
//   ~-11 deg) to the night-orbit exposure (5.0, i.e. ~8x; settings.nightDodge = false / 0..1), so city
//   lights authored in this unit read next to a correctly exposed day side (A01 / A02) and the same
//   light looks the same in every frame of a turntable. Do not brighten emissive for orbit views.
//
// CUSTOM SHADERS (ShaderMaterial): Object.assign(material.uniforms, app.lighting.uniforms) (keeps
//   the shared references) and in the fragment shader:
//       #include <lp_lighting_pars>            // + optional: <lp_atmosphere_pars>, <lp_clouds_pars>
//   GLSL API (positions in render space = camera-relative ECEF axes, metres):
//     void  lpSetupWorld(vec3 worldPos)   / lpSetup(vec3 viewPos)   call first; sets
//           lpWorldPos, lpPlanetPos, lpUp, lpR, lpH (altitude), lpMuS (cos sun zenith)
//     vec3  lpSunIrradiance()              sun colour * transmittance * cloud shadow (no CSM)
//     vec3  lpSkyIrradianceN(vec3 n)       sky + ground-bounce + night irradiance for world normal n
//     vec3  lpNightIrradianceN(vec3 n)     night-sky part only
//     vec3  lpGroundBounceN(vec3 n, float cloudT)  ground-bounce part only (cloudT = lpCloudShadow().x)
//     float lpAmbientOcclusion()           screen-space AO at the fragment (1 when off); multiply
//                                          your ambient terms by it, not the sun
//     vec3  lpSunTransmittance(float r, float h, float mus)
//     vec3  lpSkyIrradiance(vec3 up, vec3 sunDir, float h, vec3 n)   (unit sun, * uLpSunE)
//     vec2  lpCloudShadow(vec3 p, float r, float h, vec3 up, float mus)   x = sun T, y = coverage
//     float lpNightGate(float mus, float onset)
//     uLpEmissiveScale                     multiply your emissive by this
//     -- lp_atmosphere_pars --
//     vec3  lpAtmosphere(vec3 rayDir, float maxDist, out vec3 T)  in-scattering from the fragment
//           along rayDir (sky radiance for reflections: maxDist = 1e30)
//     -- lp_clouds_pars --  (fix round 3: the field is a pure function of the sol time; inside the sol's
//        last hour two phases are blended — read the weather through lpCloudWeatherP(p, footprint),
//        never uCloudRot * p directly)
//     float lpCloudCoverage(vec3 dir)      weather coverage (0..1) at a planet-frame direction
//     float lpCloudDensity(vec3 p, float h, float footprint, bool detail)  density (x optical
//           density scale) at planet-relative position p, altitude h; extinction = d * uCloudSigma
//   Diffuse radiance of a surface = albedo/PI * (lpSunIrradiance()*max(dot(n,sun),0) +
//   lpSkyIrradianceN(n)); emissive * uLpEmissiveScale (* lpNightGate(lpMuS, onset)).
//   The pipeline applies aerial perspective afterwards; do not tone-map in materials.
// ============================================================================================
import * as THREE from 'three';
import { SUN_ILLUMINANCE, SUN_COLOR, NIGHT_AMBIENT, EMISSIVE_SCALE, GROUND_BOUNCE } from './model.js';
import { LP_PARS, LP_SHADOW_PARS, LP_SETUP, LP_EMISSIVE, buildLightChunks, registerShaderChunks } from '../shaders/lighting.glsl.js';

const LP_VERSION = 'lp5';

function inject(src, include, code, mode) {
  const tag = `#include <${include}>`;
  if (!src.includes(tag)) return null;
  if (mode === 'replace') return src.replace(tag, code);
  if (mode === 'before') return src.replace(tag, code + '\n' + tag);
  return src.replace(tag, tag + '\n' + code);
}

export class PlanetLighting {
  constructor(app) {
    this.app = app;
    const sunE = new THREE.Vector3(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]).multiplyScalar(SUN_ILLUMINANCE);
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 0, 1) },
      uPlanetCenter: { value: new THREE.Vector3() },
      uCamAlt: { value: 0 },
      uSolTime: { value: 0 },
      uNightLights: { value: 1 },
      uLpSunE: { value: sunE },
      uLpNightAmbient: { value: new THREE.Vector3(...NIGHT_AMBIENT) },
      uLpEmissiveScale: { value: EMISSIVE_SCALE },
      uLpFrame: { value: 0 },
      uLpAtlas: { value: null },
      uLpCloudsOn: { value: 0 },
      uLpCloudMap: { value: null },
      uLpCloudMode: { value: 0 },
      uLpCloudAnchor: { value: new THREE.Vector3() },
      uLpCloudAxisE: { value: new THREE.Vector3(1, 0, 0) },
      uLpCloudAxisN: { value: new THREE.Vector3(0, 1, 0) },
      uLpCloudExtent: { value: 100000 },
      uLpEnvRef: { value: new THREE.Vector2(0, 1) },
      uLpEnvOn: { value: 0 },
      uLpAO: { value: null },
      uLpAOVP: { value: new THREE.Matrix4() },
      uLpAOOn: { value: 0 },
      uLpGroundAlbedo: { value: new THREE.Vector3(...GROUND_BOUNCE.fallback) },
      uLpShadowOn: { value: 0 },
      uLpCascadeFar: { value: new THREE.Vector4(10, 50, 200, 1000) },
      uLpPcfRadius: { value: new THREE.Vector4(1.5, 1.5, 1.5, 1.5) },
      // cloud renderer uniforms (filled by the cloud system; used by lp_clouds_pars)
      uCloudWeather: { value: null },
      uCloudShape: { value: null },
      uCloudDetail: { value: null },
      uCloudRot: { value: new THREE.Matrix3() },
      uCloudOffA: { value: new THREE.Vector3() },
      uCloudOffB: { value: new THREE.Vector3() },
      // fix round 3 (QP-08): the next sol's phase, dissolved in over the sol's last hour (uCloudMix > 0)
      uCloudRot2: { value: new THREE.Matrix3() },
      uCloudOffA2: { value: new THREE.Vector3() },
      uCloudOffB2: { value: new THREE.Vector3() },
      uCloudMix: { value: 0 },
      uCloudCoverage: { value: 1 },
      uCloudSigma: { value: 0.02 },
    };
    this.patched = new Set();
    this._warned = new Set();
    // capability flags other systems can probe (e.g. to avoid gating emissive twice)
    this.nightEmissive = true;
    this.features = { nightEmissive: true, emissiveOnsetAlpha: true, cloudShadows: true, skyIrradiance: true, cascadedShadows: true, aerialPerspective: 'pipeline', emissiveScale: EMISSIVE_SCALE };
    registerShaderChunks();
  }

  supports(name) { return !!this.features[name]; }

  /** shared uniform objects for custom ShaderMaterials: Object.assign(mat.uniforms, lighting.shaderUniforms()) */
  shaderUniforms() { return this.uniforms; }

  patch(material, opts = {}) {
    if (!material) return material;
    if (Array.isArray(material)) { for (const m of material) this.patch(m, opts); return material; }
    const o = {
      nightEmissive: !!opts.nightEmissive,
      emissiveOnsetAlpha: !!opts.emissiveOnsetAlpha,
      receiveCloudShadow: opts.receiveCloudShadow !== false,
      keepSceneAmbient: !!opts.keepSceneAmbient,
    };
    const defines = material.defines || (material.defines = {});
    const want = { LP_PATCHED: 1 };
    if (o.nightEmissive) want.LP_NIGHT_EMISSIVE = 1;
    if (o.nightEmissive && o.emissiveOnsetAlpha) want.LP_EMISSIVE_ONSET = 1;
    if (o.receiveCloudShadow) want.LP_CLOUD_SHADOW = 1;
    if (o.keepSceneAmbient) want.LP_KEEP_SCENE_AMBIENT = 1;
    if (material.userData.__lpPatched) {
      // idempotent: only update the feature defines if they changed
      let changed = false;
      for (const k of ['LP_NIGHT_EMISSIVE', 'LP_EMISSIVE_ONSET', 'LP_CLOUD_SHADOW', 'LP_KEEP_SCENE_AMBIENT']) {
        const has = k in defines, w = k in want;
        if (has !== w) { changed = true; if (w) defines[k] = 1; else delete defines[k]; }
      }
      if (changed) material.needsUpdate = true;
      return material;
    }
    if (!(material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial)) {
      const key = material.type;
      if (!this._warned.has(key)) { this._warned.add(key); console.warn(`[lighting] patch(): ${key} has no PBR lighting; skipped (use the lp_* shader chunks for custom shaders)`); }
      return material;
    }
    Object.assign(defines, want);
    const prevOBC = material.onBeforeCompile;
    const hasPrevOBC = prevOBC && prevOBC !== THREE.Material.prototype.onBeforeCompile;
    const prevSrc = hasPrevOBC ? prevOBC.toString() : '';
    const prevKeyFn = material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
    const lighting = this;
    material.onBeforeCompile = function (shader, renderer) {
      if (hasPrevOBC) prevOBC.call(this, shader, renderer);
      lighting._patchShader(shader, this);
    };
    material.customProgramCacheKey = function () { return (prevKeyFn ? prevKeyFn() : prevSrc) + '|' + LP_VERSION; };
    material.userData.__lpPatched = true;
    material.needsUpdate = true;
    this.patched.add(material);
    return material;
  }

  _patchShader(shader, material) {
    for (const k in this.uniforms) shader.uniforms[k] = this.uniforms[k];
    const chunks = buildLightChunks();
    let fs = shader.fragmentShader;
    const steps = [
      ['common', LP_PARS, 'after'],
      ['shadowmap_pars_fragment', LP_SHADOW_PARS, 'after'],
      ['emissivemap_fragment', LP_SETUP, 'before'],
      ['emissivemap_fragment', LP_EMISSIVE, 'after'],
      ['lights_fragment_begin', chunks.begin, 'replace'],
      ['lights_fragment_maps', chunks.maps, 'replace'],
    ];
    for (const [inc, code, mode] of steps) {
      const next = inject(fs, inc, code, mode);
      if (next === null) {
        const key = material.type + ':' + inc;
        if (!this._warned.has(key)) { this._warned.add(key); console.warn(`[lighting] ${material.type}${material.name ? ' "' + material.name + '"' : ''}: <${inc}> not found, planet lighting incomplete`); }
        continue;
      }
      fs = next;
    }
    shader.fragmentShader = fs;
  }

  update(frame) {
    const u = this.uniforms;
    u.uSunDir.value.copy(frame.sunDir);
    u.uPlanetCenter.value.copy(frame.planetCenter);
    u.uCamAlt.value = frame.camAlt;
    u.uSolTime.value = frame.solTime;
    u.uLpFrame.value = (this.app.pipeline?.frameIndex ?? frame.frameNo) % 4096;
  }
}
