// Atmosphere system: sun light + cascaded shadows, atmosphere LUTs, sky / aerial perspective /
// cloud composite, stars, sky environment map, planet lighting patch (app.lighting).
// OWNER: atmosphere agent.
//   app.lighting   PlanetLighting (see lighting.js for the material contract)
//   app.sunLight   DirectionalLight along frame.sunDir (no shadow; drives unpatched materials)
//   app.csm        PlanetCSM (cascade shadow carriers; meshes opt in with castShadow/receiveShadow)
//   atmosphere.composite   used by the pipeline after the scene pass
//   atmosphere.isIdle()    false until LUTs/env/exposure/accumulation have converged
import * as THREE from 'three';
import { PlanetLighting } from './lighting.js';
import { AtmosphereLUTs } from './luts.js';
import { PlanetCSM } from './csm.js';
import { SkyEnvironment } from './envmap.js';
import { FullscreenPass, fsMaterial } from './gpu.js';
import { FrameLUTs } from './frameLuts.js';
import { CloudPass } from '../clouds/cloudPass.js';
import { ExposurePrior } from './exposure.js';
import { compositeFragment } from '../shaders/composite.glsl.js';
import { SUN_ILLUMINANCE, SUN_COLOR, ATMO, GROUND_BOUNCE, EMISSIVE_SCALE, NIGHT_AMBIENT, NIGHT_AMBIENT_GROUND } from './model.js';
import { R } from '../../core/constants.js';
import { controlMapsReady } from '../../data/controlMaps.js';

const smooth01 = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => { a[0] += (b[0] - a[0]) * t; a[1] += (b[1] - a[1]) * t; a[2] += (b[2] - a[2]) * t; return a; };

/**
 * Effective ground-bounce albedo at a planet direction from the land cover of world/fields.js (water,
 * ice, city fabric, farmland, bare red rock), blended to the planet average with altitude.
 */
export function groundBounceAlbedo(F, altGround) {
  const B = GROUND_BOUNCE;
  const a = [...B.rock];
  mix3(a, B.farm, Math.min(1, Math.max(0, F.farm || 0)));
  mix3(a, B.urban, Math.min(1, Math.max(0, (F.urban || 0) * 1.25)));
  mix3(a, B.ice, Math.min(1, Math.max(0, F.ice || 0)));
  mix3(a, B.water, Math.min(1, Math.max(0, -(F.coast ?? 1) * 25)));
  return mix3(a, B.orbit, smooth01(altGround, 3000, 60000));
}

class AtmosphereComposite {
  constructor(lighting, luts, renderer) {
    const lu = lighting.uniforms;
    this.frameLuts = new FrameLUTs(renderer, lu, luts.ms.texture);
    // shared with the cloud pass (filled by the cloud system)
    this.emissionUniform = { value: null };
    this.cityGlowUniform = { value: 0 };
    this.skyGlowUniform = { value: 0 };
    this.cloudPass = new CloudPass(lu, luts.ms.texture, this.emissionUniform, this.cityGlowUniform);
    this.uniforms = {
      tColor: { value: null }, tDepth: { value: null }, tExposure: { value: null }, tCloud: { value: null },
      uSkyView: { value: this.frameLuts.sky.texture }, uApLut: { value: this.frameLuts.ap.texture },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) }, uCamR: { value: R }, uCamH: { value: 0 },
      uSunDir: lu.uSunDir, uLpSunE: lu.uLpSunE, uLpNightAmbient: lu.uLpNightAmbient,
      uLogFar: { value: 1 }, uFrame: { value: 0 }, uPixelAngle: { value: 0.001 },
      uCloudsOn: { value: 0 }, uStarScale: { value: 0.13 }, uSunDiscScale: { value: 400 }, uRefExposure: { value: 0.45 },
      uFallbackAlbedo: { value: new THREE.Vector3(0.20, 0.10, 0.055) },
      uLpAtlas: lu.uLpAtlas, uLpMsLut: { value: luts.ms.texture },
      uApStrength: { value: 1 }, uApDmax: { value: 1e5 }, uInside: { value: 1 },
      uLpEmission: this.emissionUniform, uSkyGlow: this.skyGlowUniform,
      uDodgeK: { value: 0 }, uDodgeRef: { value: 5.0 }, uDodgeMax: { value: 14 },
      uSkySat: { value: 1 },
    };
    this.pass = new FullscreenPass(fsMaterial({ fragmentShader: compositeFragment(), uniforms: this.uniforms }));
    this.ready = true;
    this.cloudsAvailable = false;
    this.apStrength = 0.72;          // aerial-perspective strength on surfaces (art control)
    this.insideLimit = 100000;       // camera altitude below which the LUT path is used
  }

  render(renderer, sceneRT, outRT, frame, pipeline) {
    const u = this.uniforms, cam = frame.camera || pipeline.app.camera;
    const camH = frame.camAlt, camR = R + camH;
    const fovY = THREE.MathUtils.degToRad(cam.getEffectiveFOV ? cam.getEffectiveFOV() : cam.fov);
    const pixAngle = (2 * Math.tan(fovY / 2)) / Math.max(1, pipeline.pixelHeight || pipeline.height);
    const inside = camH < this.insideLimit;
    if (inside) this.frameLuts.update(frame, cam, camR, camH);
    const clouds = this.cloudsAvailable && u.uCloudsOn.value > 0.5;
    if (clouds) this.cloudPass.render(renderer, sceneRT.depthTexture, cam, frame, pipeline, camR, camH, pixAngle);
    u.tColor.value = sceneRT.texture;
    u.tDepth.value = sceneRT.depthTexture;
    u.tExposure.value = pipeline.exposureTexture;
    u.tCloud.value = clouds ? this.cloudPass.texture : null;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    u.uCamUp.value.copy(frame.camUp);
    u.uCamH.value = camH;
    u.uCamR.value = camR;
    u.uLogFar.value = Math.log2(cam.far + 1);
    u.uFrame.value = pipeline.frameIndex % 4096;
    u.uPixelAngle.value = pixAngle;
    u.uInside.value = inside ? 1 : 0;
    u.uApDmax.value = this.frameLuts.dmax;
    // art direction: the haze over surfaces is lighter than a strict Earth-like column ("subtle:
    // distant shores keep their outline"; orbit refs A01/A03/R3 read clearly). The sky, the limb
    // and the clouds keep the full model.
    // data debug layers read with only a trace of haze in front of them
    const st = pipeline.settings || {};
    const debugView = !st.clean && !!st.debugLayer && st.debugLayer !== 'none';
    u.uApStrength.value = this.apStrength * (1 - 0.62 * THREE.MathUtils.smoothstep(camH, 40000, 2500000)) * (debugView ? 0.25 : 1);
    // orbit night-side dodge (see composite.glsl.js): only for views of the disc from space
    const nd = pipeline.settings?.nightDodge;
    u.uDodgeK.value = THREE.MathUtils.smoothstep(camH, 150000, 600000) * (nd === false ? 0 : (typeof nd === 'number' ? nd : 1));
    u.uDodgeRef.value = pipeline.app?.systems?.atmosphere?.exposurePrior?.nightOrbitExposure ?? 5.0;
    const prevClouds = u.uCloudsOn.value;
    if (!clouds) u.uCloudsOn.value = 0;
    this.pass.render(renderer, outRT);
    u.uCloudsOn.value = prevClouds;
  }
}

export class AtmosphereSystem {
  constructor(app) { this.app = app; this._idleFrames = 0; }

  async init() {
    const app = this.app;
    const lighting = app.lighting = new PlanetLighting(app);
    const r = app.renderer;

    // LUTs (GPU, synchronous)
    this.luts = new AtmosphereLUTs(r);
    this.luts.compute();
    lighting.uniforms.uLpAtlas.value = this.luts.atlas.texture;
    // CPU copy of the LUT atlas for the physically motivated exposure prior
    this.exposurePrior = new ExposurePrior();
    try {
      const h2f = (hv) => { const s = (hv & 0x8000) ? -1 : 1, e = (hv >> 10) & 0x1f, m = hv & 0x3ff; return e === 0 ? s * 6.103515625e-5 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); };
      const a = new Uint16Array(this.luts.atlas.width * this.luts.atlas.height * 4);
      r.readRenderTargetPixels(this.luts.atlas, 0, 0, this.luts.atlas.width, this.luts.atlas.height, a);
      const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = h2f(a[i]);
      this.exposurePrior.setAtlas(f);
    } catch (e) { console.warn('[atmosphere] exposure prior unavailable', e); this.exposurePrior = null; }
    // ground night regime (fix round 2): the emissive unit follows the exposure prior every frame;
    // until the first frame it holds the ground-night value, so systems that copy the VALUE at init
    // (props glow sprites / light pools, only visible near the ground at night) get the right unit
    if (this.exposurePrior) lighting.uniforms.uLpEmissiveScale.value = EMISSIVE_SCALE * this.exposurePrior.maxEmissiveGain();

    // sun (unshadowed carrier for unpatched materials) + hemisphere ambient for unpatched ones
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, SUN_ILLUMINANCE);
    sun.name = 'sun';
    sun.color.setRGB(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]);
    app.scene.add(sun, sun.target);
    app.sunLight = sun;
    this.hemi = new THREE.HemisphereLight(0x6f8fbf, 0x5a3220, 0.0);
    this.hemi.name = 'sky.unpatched';
    app.scene.add(this.hemi);
    app.scene.background = null;

    // cascades
    this.csm = app.csm = new PlanetCSM(app, { cascades: 4, mapSize: 4096 });

    // environment map
    this.env = new SkyEnvironment(r, lighting.uniforms, { size: 256 });
    this.env.setMsLut(this.luts.ms.texture);

    // composite used by the pipeline
    this.composite = new AtmosphereComposite(lighting, this.luts, r);

    this._wantShadows = app.state?.settings?.shadows !== false;
    app.events?.on('settings', ({ key, value }) => {
      if (key === 'shadows') this._wantShadows = value !== false;
      if (key === 'clouds') this.composite.uniforms.uCloudsOn.value = value === false ? 0 : 1;
    });
    app.events?.on('goto', () => { app.pipeline?.snapExposure?.(4); this._ground.snap = true; });
    this._lastPose = null;

    // local ground-bounce albedo (world/fields.js land cover at the camera, see groundBounceAlbedo)
    this._ground = { cur: [...GROUND_BOUNCE.fallback], target: null, t: -1, p: null, snap: true, F: {} };
    import('../../world/fields.js').then((m) => { this._fields = m; }).catch((e) => console.warn('[atmosphere] fields unavailable, ground bounce uses the fallback albedo', e));
  }

  _updateGroundAlbedo(frame) {
    const g = this._ground, u = this.app.lighting.uniforms.uLpGroundAlbedo.value;
    const p = frame.camEcef;
    const now = frame.time ?? performance.now() / 1000;
    if (this._fields && controlMapsReady()) {
      const moved = !g.p ? Infinity : Math.hypot(p.x - g.p.x, p.y - g.p.y, p.z - g.p.z);
      const ag = Number.isFinite(frame.camAltGround) ? frame.camAltGround : frame.camAlt;
      const altG = Math.max(0, Number.isFinite(ag) ? ag : 0);
      if (!g.target || (moved > Math.max(40, altG * 0.05) && now - g.t > 0.25) || g.snap) {
        const l = Math.hypot(p.x, p.y, p.z) || 1;
        try {
          this._fields.sampleFields(p.x / l, p.y / l, p.z / l, g.F);
          g.target = groundBounceAlbedo(g.F, altG);
          if (!g.target.every(Number.isFinite)) g.target = [...GROUND_BOUNCE.fallback];
        } catch (e) { g.target = [...GROUND_BOUNCE.fallback]; }
        g.t = now; g.p = { x: p.x, y: p.y, z: p.z };
      }
    }
    const tgt = g.target || GROUND_BOUNCE.fallback;
    const d = Math.abs(tgt[0] - g.cur[0]) + Math.abs(tgt[1] - g.cur[1]) + Math.abs(tgt[2] - g.cur[2]);
    if (d > 1e-5) {
      // ease while the camera moves; settle at once on a still view (and restart the accumulation)
      if (g.snap || !frame.moving) { g.cur = [...tgt]; if (d > 2e-3) this.app.pipeline?.resetAccumulation?.(false); }
      else mix3(g.cur, tgt, 1 - Math.exp(-(frame.dt || 0.016) / 0.6));
    }
    g.snap = false;
    u.set(g.cur[0], g.cur[1], g.cur[2]);
  }

  /**
   * Ground night regime (fix round 2, QQ-05): the exposure prior caps the night exposure near the
   * ground and returns the emissive gain that keeps artificial light at its round-1 brightness; the
   * night sky light blends to a dimmer, less blue variant near the ground; the city glow on clouds /
   * in the sky is artificial light too and follows the gain. From ~60 km up everything is round 1.
   */
  _updateNightRegime(frame) {
    const lu = this.app.lighting.uniforms, P = this.exposurePrior;
    if (P) P.update(frame, this.app.camera);
    const gain = P ? P.emissiveGain : 1, gk = P ? P.groundK : 0;
    lu.uLpEmissiveScale.value = EMISSIVE_SCALE * gain;
    // blue-hour lift of the twilight light seen from the ground (exposure.js twilightGain; 1 by day)
    const tg = P ? P.twilightGain : 1;
    lu.uLpSunE.value.set(SUN_COLOR[0] * SUN_ILLUMINANCE * tg, SUN_COLOR[1] * SUN_ILLUMINANCE * tg, SUN_COLOR[2] * SUN_ILLUMINANCE * tg);
    const na = lu.uLpNightAmbient.value;
    na.set(NIGHT_AMBIENT[0] + (NIGHT_AMBIENT_GROUND[0] - NIGHT_AMBIENT[0]) * gk,
      NIGHT_AMBIENT[1] + (NIGHT_AMBIENT_GROUND[1] - NIGHT_AMBIENT[1]) * gk,
      NIGHT_AMBIENT[2] + (NIGHT_AMBIENT_GROUND[2] - NIGHT_AMBIENT[2]) * gk);
    const c = this.composite;
    c.uniforms.uSkySat.value = P ? P.skySaturation : 1;
    if (c.skyGlowBase !== undefined) c.skyGlowUniform.value = c.skyGlowBase * gain;
    if (c.cityGlowBase !== undefined) c.cityGlowUniform.value = c.cityGlowBase * gain;
  }

  update(frame) {
    const app = this.app;
    const lighting = app.lighting;
    lighting.update(frame);
    this._updateGroundAlbedo(frame);
    this._updateNightRegime(frame);
    const sd = frame.sunDir;
    // the sun light shines from the sun towards the camera neighbourhood
    this.sun.position.set(sd.x * 1000, sd.y * 1000, sd.z * 1000);
    this.sun.target.position.set(0, 0, 0);
    // unpatched materials: tint the sun by the transmittance seen at the camera (approximate)
    const mus = frame.camUp.dot(sd);
    const t = THREE.MathUtils.smoothstep(mus, -0.02, 0.25);
    this.sun.intensity = SUN_ILLUMINANCE * t;
    this.sun.color.setRGB(SUN_COLOR[0], SUN_COLOR[1] * (0.75 + 0.25 * t), SUN_COLOR[2] * (0.55 + 0.45 * t));
    this.hemi.intensity = 1.2 * THREE.MathUtils.smoothstep(mus, -0.2, 0.3);
    this.hemi.position.copy(frame.camUp);

    // cascaded shadows (near the ground only)
    const want = this._wantShadows && app.state?.settings?.shadows !== false;
    this.csm.update(frame, lighting.uniforms, want);

    // sky environment for reflections (clouds included; one cube face per frame while refreshing)
    if (this.env.update(frame, lighting.uniforms, app.systems?.clouds?.cloudTime ?? null)) {
      app.scene.environment = this.env.texture;
    }
    // detect teleports -> instant exposure adaptation
    const p = frame.camEcef;
    if (this._lastPose) {
      const d = Math.hypot(p.x - this._lastPose.x, p.y - this._lastPose.y, p.z - this._lastPose.z);
      const alt = Math.max(1, frame.camAltGround ?? frame.camAlt);
      if (d > Math.max(500, alt * 0.8)) app.pipeline?.snapExposure?.(3);
    }
    this._lastPose = { x: p.x, y: p.y, z: p.z };
  }

  isIdle() {
    const pl = this.app.pipeline;
    if (!this.luts?.ready || !this.env?.ready || this.env.busy) return false;
    if (!pl) return true;
    const ok = pl.exposure.settled && pl.converged;
    this._idleFrames = ok ? this._idleFrames + 1 : 0;
    return ok;
  }

  dispose() {
    this.csm?.dispose(); this.env?.dispose(); this.luts?.dispose();
  }
}
