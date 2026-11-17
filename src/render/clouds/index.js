// Cloud layer + cloud shadow field. OWNER: atmosphere agent.
// Generates (GPU, deterministic from SEED) the weather cubemap (coverage / type / vertical extent /
// optical density), the tileable Perlin-Worley shape and Worley detail 3D textures, and keeps the
// cloud shadow maps used by every patched material up to date:
//   * local map  (2048^2, tangent plane around the camera, 120..1500 km wide) below 250 km
//   * global map (4096x2048 equirect) from orbit
// The layer drifts east with the sol clock and evolves slowly. Fix round 3 (QP-08): the cloud field is a
// pure function of the sol time (cloud time = state.solTime, 0..24): the same time always shows the same
// clouds whatever the history; the sol wrap is seamless through a dissolve over the sol's last hour (see
// syncTime). Rendering happens in the atmosphere composite.
// Dev helpers: weatherAt(lat, lon) (CPU lookup), weatherImage(channel) (equirect RGBA bytes).
import * as THREE from 'three';
import { SEED, R } from '../../core/constants.js';
import { Rng, hash4 } from '../../core/hash.js';
import { getControlMaps, controlMapsReady } from '../../data/controlMaps.js';
import { enuBasis, latLonToUnit } from '../../core/geo.js';
import { atmosphereDefines, CLOUD } from '../atmosphere/model.js';
import { GLSL_MATH, GLSL_HASH, GLSL_NOISE } from '../shaders/common.glsl.js';
import { GLSL_WEATHER_FLOW, GLSL_WEATHER_GEN, GLSL_WEATHER_DEBUG, GLSL_NOISE3D_GEN, GLSL_CLOUD_PARS, GLSL_CLOUD_SHADOW_GEN, WEATHER_VORTICES } from '../shaders/clouds.glsl.js';
import { FullscreenPass, fsMaterial, gpuSeed } from '../atmosphere/gpu.js';

const WEATHER_SIZE = 2048;
const FLOW_SIZE = 512;
const ADVECT_T = 0.07;               // advection time of the weather tracers (flow units): shear + gentle commas, no marbling
const SHAPE_SIZE = 128;
const DETAIL_SIZE = 128;
const LOCAL_SIZE = 2048;
const GLOBAL_W = 4096, GLOBAL_H = 2048;
const WIND_DEG_PER_HOUR = 0.75;      // ~12 m/s eastward drift at the equator
const SIGMA = 0.02;                  // cloud extinction at density 1 (1/m): thin layered clouds (altocumulus / stratocumulus)
// fix round 3 (QP-08): over the last CLOUD_BLEND_H sol hours (solTime 23..24) the field dissolves into the
// next sol's phase (cloud time solTime - 24), which is the field at solTime 0, so the wrap has no jump.
// No bookmark sits in that window (the latest, S01, is at 22.533), so bookmarks show one phase only.
export const CLOUD_BLEND_H = 1.0;

const smooth01 = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Drift / evolution state of the cloud field at a cloud time (hours): rotation planet frame -> drifting
 * cloud frame (east drift WIND_DEG_PER_HOUR) and the slow noise evolution offsets. Pure function.
 */
export function cloudPhase(cloudTime, rot = new THREE.Matrix3(), offA = new THREE.Vector3(), offB = new THREE.Vector3()) {
  const ang = THREE.MathUtils.degToRad(WIND_DEG_PER_HOUR * cloudTime);
  // the cloud field drifts east: sample the weather in a frame rotated west by ang about +Y
  const c = Math.cos(ang), s = Math.sin(ang);
  rot.set(c, 0, -s, 0, 1, 0, s, 0, c);
  offA.set(cloudTime * 0.0021, cloudTime * 0.0007, -cloudTime * 0.0013);
  offB.set(cloudTime * 0.011, -cloudTime * 0.004, cloudTime * 0.007);
  return { rot, offA, offB };
}

/**
 * The cloud clock: sol time (any real, wrapped to 0..24) -> { cloudTime, mix }. cloudTime = the wrapped
 * sol time (this sol's phase); mix = weight of the next sol's phase (cloud time - 24), 0 except over the
 * sol's last CLOUD_BLEND_H hours where it rises smoothly to 1. Pure function of the sol time.
 */
export function cloudClock(solTime) {
  const t = ((solTime % 24) + 24) % 24;
  return { cloudTime: t, mix: smooth01(t, 24 - CLOUD_BLEND_H, 24) };
}

/**
 * Deterministic cyclone set (cloud frame): six extratropical lows on the storm tracks, two small
 * tropical cyclones, two weak lows. speed = signed peak tangential speed (flow units, + = counter-
 * clockwise seen from outside = cyclonic in the north), radius = core radius (rad), comma = moisture
 * of the comma head.
 */
export function cloudVortices(seed = SEED) {
  const rng = new Rng(hash4(seed, 0x51ac, 7, 4));
  const out = [];
  const add = (lat, lon, speed, radius, comma) => {
    const u = latLonToUnit(lat, lon);
    out.push({ x: u.x, y: u.y, z: u.z, speed, radius, comma, lat, lon });
  };
  for (let i = 0; i < 6; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    add(s * rng.float(40, 60), -180 + (i * 60 + rng.float(-18, 18)), s * rng.float(1.3, 1.9), rng.float(0.07, 0.11), rng.float(0.6, 1.0));
  }
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    add(s * rng.float(11, 19), rng.float(-180, 180), s * rng.float(1.3, 1.7), rng.float(0.035, 0.05), 1.0);
  }
  for (let i = 0; i < WEATHER_VORTICES - 8; i++) {
    const s = rng.bool() ? 1 : -1;
    add(s * rng.float(28, 68), rng.float(-180, 180), s * rng.float(0.6, 0.9), rng.float(0.12, 0.18), 0.3);
  }
  return out;
}

export class CloudSystem {
  constructor(app) {
    this.app = app;
    this.ready = false;
    this.cloudTime = null;        // = state.solTime (0..24) once synced; see syncTime
    this.cloudMix = 0;            // weight of the next sol's phase (sol's last hour only)
    this._shadowKey = null;
    this._shadowDirty = true;
    this.shadowRenders = 0;
  }

  async init() {
    const app = this.app, r = app.renderer;
    const lu = app.lighting?.uniforms;
    if (!lu) throw new Error('clouds: app.lighting missing (atmosphere must init first)');
    const prevTarget = r.getRenderTarget();
    const t0 = performance.now();

    // weather cubemap
    this.weatherRT = new THREE.WebGLCubeRenderTarget(WEATHER_SIZE, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace,
    });
    this.weatherRT.texture.name = 'clouds.weather';
    this.vortices = cloudVortices(SEED);
    const vU = this.vortices.map((v) => new THREE.Vector4(v.x, v.y, v.z, v.speed));
    const vR = this.vortices.map((v) => new THREE.Vector2(v.radius, v.comma));
    // planetary flow field (velocity cubemap) used to advect the weather tracers
    const flowRT = new THREE.WebGLCubeRenderTarget(FLOW_SIZE, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace,
    });
    const fPass = new FullscreenPass(fsMaterial({
      fragmentShader: GLSL_MATH + GLSL_HASH + GLSL_NOISE + GLSL_WEATHER_FLOW,
      uniforms: { uFace: { value: 0 }, uSize: { value: FLOW_SIZE }, uSeed: { value: gpuSeed(SEED, 103) }, uVortex: { value: vU }, uVortexR: { value: vR } },
    }));
    for (let f = 0; f < 6; f++) { fPass.material.uniforms.uFace.value = f; fPass.render(r, flowRT, null, f); }
    fPass.dispose();
    const wMat = fsMaterial({
      fragmentShader: GLSL_MATH + GLSL_HASH + GLSL_NOISE + GLSL_WEATHER_GEN,
      uniforms: { uFace: { value: 0 }, uSize: { value: WEATHER_SIZE }, uSeed: { value: gpuSeed(SEED, 101) }, uVel: { value: flowRT.texture }, uT: { value: ADVECT_T }, uVortex: { value: vU }, uVortexR: { value: vR } },
    });
    const wPass = new FullscreenPass(wMat);
    for (let f = 0; f < 6; f++) {
      this.weatherRT.texture.generateMipmaps = f === 5;
      wMat.uniforms.uFace.value = f;
      wPass.render(r, this.weatherRT, null, f);
    }
    wPass.dispose();
    flowRT.dispose();

    // 3D noises
    this.shapeRT = this._make3D(SHAPE_SIZE);
    this.detailRT = this._make3D(DETAIL_SIZE);
    const nMat = fsMaterial({
      fragmentShader: GLSL_MATH + GLSL_HASH + GLSL_NOISE + GLSL_NOISE3D_GEN,
      uniforms: { uZ: { value: 0 }, uSize: { value: SHAPE_SIZE }, uSeed: { value: gpuSeed(SEED, 202) }, uKind: { value: 0 } },
    });
    const nPass = new FullscreenPass(nMat);
    for (const [rt, size, kind] of [[this.shapeRT, SHAPE_SIZE, 0], [this.detailRT, DETAIL_SIZE, 1]]) {
      nMat.uniforms.uSize.value = size; nMat.uniforms.uKind.value = kind;
      for (let z = 0; z < size; z++) {
        rt.texture.generateMipmaps = z === size - 1;
        nMat.uniforms.uZ.value = z;
        nPass.render(r, rt, null, z);
      }
    }
    nPass.dispose();

    // night emission (control map) for light pollution under clouds
    if (controlMapsReady()) {
      const m = getControlMaps().emission;
      const tex = new THREE.DataTexture(m.data, m.width, m.height, THREE.RedFormat, THREE.UnsignedByteType);
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.needsUpdate = true;
      tex.unpackAlignment = 1;
      this.emissionTex = tex;
    }

    // shadow maps
    const smOpts = { type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace };
    this.localRT = new THREE.WebGLRenderTarget(LOCAL_SIZE, LOCAL_SIZE, { ...smOpts, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.globalRT = new THREE.WebGLRenderTarget(GLOBAL_W, GLOBAL_H, { ...smOpts, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.localRT.texture.name = 'clouds.shadowLocal';
    this.globalRT.texture.name = 'clouds.shadowGlobal';
    this.shadowUniforms = {
      uMode: { value: 0 }, uSizePx: { value: new THREE.Vector2() }, uAnchor: { value: new THREE.Vector3() },
      uAxisE: { value: new THREE.Vector3() }, uAxisN: { value: new THREE.Vector3() }, uExtent: { value: 1 },
      uSunDir: { value: new THREE.Vector3() },
      uCloudWeather: lu.uCloudWeather, uCloudShape: lu.uCloudShape, uCloudDetail: lu.uCloudDetail,
      uCloudRot: lu.uCloudRot, uCloudOffA: lu.uCloudOffA, uCloudOffB: lu.uCloudOffB,
      uCloudRot2: lu.uCloudRot2, uCloudOffA2: lu.uCloudOffA2, uCloudOffB2: lu.uCloudOffB2, uCloudMix: lu.uCloudMix,
      uCloudCoverage: lu.uCloudCoverage, uCloudSigma: lu.uCloudSigma,
    };
    this.shadowPass = new FullscreenPass(fsMaterial({ fragmentShader: atmosphereDefines() + GLSL_MATH + GLSL_CLOUD_PARS + GLSL_CLOUD_SHADOW_GEN, uniforms: this.shadowUniforms }));

    // publish
    lu.uCloudWeather.value = this.weatherRT.texture;
    lu.uCloudShape.value = this.shapeRT.texture;
    lu.uCloudDetail.value = this.detailRT.texture;
    lu.uCloudSigma.value = SIGMA;
    lu.uCloudCoverage.value = 1;
    const comp = app.systems?.atmosphere?.composite;
    if (comp) {
      comp.emissionUniform.value = this.emissionTex || null;
      // base values at the round-1 emissive unit; the atmosphere system multiplies them by the
      // current emissive gain (ground night regime) every frame
      comp.cityGlowBase = this.emissionTex ? 0.25 : 0;
      comp.skyGlowBase = this.emissionTex ? 0.022 : 0;
      comp.cityGlowUniform.value = comp.cityGlowBase;
      comp.skyGlowUniform.value = comp.skyGlowBase;
      comp.cloudsAvailable = true;
    }
    r.setRenderTarget(prevTarget);
    this.genMs = performance.now() - t0;
    this.ready = true;
  }

  _make3D(size) {
    const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    const t = rt.texture;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  get enabled() { return this.app.state?.settings?.clouds !== false; }

  /**
   * Set the drift uniforms for a sol time. Fix round 3 (QP-08): a PURE function of the sol time, no
   * history (the old unwrapped clock mapped both +12 h and -12 h to -12 h, so 15 -> 3 -> 15 left the
   * field shifted by a sol). Phase 1 (uCloudRot / uCloudOffA / uCloudOffB) = cloud time solTime; phase 2
   * (uCloudRot2 / uCloudOffA2 / uCloudOffB2) = cloud time solTime - 24, blended in with uCloudMix over
   * the sol's last hour (coverage-space dissolve in the shaders) so the wrap 24 -> 0 is continuous.
   */
  syncTime(solTime) {
    const lu = this.app.lighting.uniforms;
    const { cloudTime, mix } = cloudClock(Number.isFinite(solTime) ? solTime : 0);
    this.cloudTime = cloudTime;
    this.cloudMix = mix;
    cloudPhase(cloudTime, lu.uCloudRot.value, lu.uCloudOffA.value, lu.uCloudOffB.value);
    if (lu.uCloudRot2) cloudPhase(cloudTime - 24, lu.uCloudRot2.value, lu.uCloudOffA2.value, lu.uCloudOffB2.value);
    if (lu.uCloudMix) lu.uCloudMix.value = mix;
  }

  update(frame) {
    if (!this.ready) return;
    const app = this.app, lu = app.lighting.uniforms;
    this.syncTime(frame.solTime);
    const st = app.state?.settings || {};
    const cov = st.cloudCoverage;
    lu.uCloudCoverage.value = cov >= 0 ? cov : 1;
    // data debug layers (province / zone / density / emission / objectId / lod / wireframe / normals)
    // are read without the cloud layer and its shadows in front of them
    const debugView = !st.clean && !!st.debugLayer && st.debugLayer !== 'none';
    const on = this.enabled && !debugView;
    lu.uLpCloudsOn.value = on ? 1 : 0;
    const comp = app.systems?.atmosphere?.composite;
    if (comp) comp.uniforms.uCloudsOn.value = on ? 1 : 0;
    if (on) this._updateShadow(frame);
  }

  _updateShadow(frame) {
    const app = this.app, lu = app.lighting.uniforms, r = app.renderer;
    const alt = Math.max(0, frame.camAlt);
    const mode = alt < 250000 ? 0 : 1;
    const up = frame.camUp;
    const extent = THREE.MathUtils.clamp(120000 + 5 * alt, 120000, 1500000);
    const sd = frame.sunDir;
    const key = this._shadowKey;
    let dirty = this._shadowDirty || !key || key.mode !== mode;
    if (!dirty) {
      if (Math.abs(this.cloudTime - key.time) > 0.004) dirty = true;          // ~15 s of drift
      else if (sd.dot(key.sun) < Math.cos(THREE.MathUtils.degToRad(0.04))) dirty = true;
      else if (Math.abs((lu.uCloudCoverage.value) - key.cov) > 1e-4) dirty = true;
      else if (mode === 0) {
        const moved = Math.acos(Math.min(1, up.dot(key.up))) * R;
        if (moved > extent / 16 || Math.abs(extent - key.extent) / key.extent > 0.2) dirty = true;
      }
    }
    if (!dirty) return;
    const su = this.shadowUniforms;
    su.uMode.value = mode;
    su.uSunDir.value.copy(sd);
    let target;
    if (mode === 0) {
      const B = enuBasis(frame.camLat, frame.camLon);
      su.uAnchor.value.set(up.x, up.y, up.z).multiplyScalar(R + CLOUD.mid);
      su.uAxisE.value.set(B.east[0], B.east[1], B.east[2]);
      su.uAxisN.value.set(B.north[0], B.north[1], B.north[2]);
      su.uExtent.value = extent;
      su.uSizePx.value.set(LOCAL_SIZE, LOCAL_SIZE);
      target = this.localRT;
      lu.uLpCloudAnchor.value.copy(su.uAnchor.value);
      lu.uLpCloudAxisE.value.copy(su.uAxisE.value);
      lu.uLpCloudAxisN.value.copy(su.uAxisN.value);
      lu.uLpCloudExtent.value = extent;
    } else {
      su.uSizePx.value.set(GLOBAL_W, GLOBAL_H);
      target = this.globalRT;
    }
    const prev = r.getRenderTarget();
    this.shadowRenders++;
    this.shadowPass.render(r, target);
    r.setRenderTarget(prev);
    lu.uLpCloudMap.value = target.texture;
    lu.uLpCloudMode.value = mode;
    this._shadowKey = { mode, time: this.cloudTime, sun: sd.clone(), up: up.clone(), extent, cov: lu.uCloudCoverage.value };
    this._shadowDirty = false;
    app.pipeline?.resetAccumulation?.(false);
  }

  isIdle() { return this.ready; }

  /**
   * CPU lookup of the weather cubemap (coverage, type, top, density; 0..1) at a planet lat/lon,
   * with the current drift applied (both sol phases blended like the shaders inside the sol's last
   * hour). Reads the cubemap back once (dev / placement aid).
   */
  weatherAt(lat, lon) {
    if (!this.ready) return null;
    const r = this.app.renderer;
    if (!this._weatherCPU) {
      this._weatherCPU = [];
      for (let f = 0; f < 6; f++) { const px = new Uint8Array(WEATHER_SIZE * WEATHER_SIZE * 4); r.readRenderTargetPixels(this.weatherRT, 0, 0, WEATHER_SIZE, WEATHER_SIZE, px, f); this._weatherCPU.push(px); }
    }
    const lu = this.app.lighting.uniforms;
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    const u = new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
    const a = this._weatherLookup(u.clone().applyMatrix3(lu.uCloudRot.value));
    const m = lu.uCloudMix?.value || 0;
    if (m <= 0 || !lu.uCloudRot2) return a;
    const b = this._weatherLookup(u.applyMatrix3(lu.uCloudRot2.value));
    const out = {};
    for (const k of Object.keys(a)) out[k] = a[k] + (b[k] - a[k]) * m;
    return out;
  }

  _weatherLookup(p) {
    const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
    let f, sc, tc, ma;
    if (ax >= ay && ax >= az) { ma = ax; f = p.x > 0 ? 0 : 1; sc = p.x > 0 ? -p.z : p.z; tc = -p.y; }
    else if (ay >= az) { ma = ay; f = p.y > 0 ? 2 : 3; sc = p.x; tc = p.y > 0 ? p.z : -p.z; }
    else { ma = az; f = p.z > 0 ? 4 : 5; sc = p.z > 0 ? p.x : -p.x; tc = -p.y; }
    const s = (sc / ma + 1) / 2, t = (tc / ma + 1) / 2;
    const x = Math.min(WEATHER_SIZE - 1, Math.floor(s * WEATHER_SIZE)), y = Math.min(WEATHER_SIZE - 1, Math.floor(t * WEATHER_SIZE));
    const i = (y * WEATHER_SIZE + x) * 4, d = this._weatherCPU[f];
    return { coverage: d[i] / 255, type: d[i + 1] / 255, top: d[i + 2] / 255, density: d[i + 3] / 255 };
  }

  /** Equirect image of the weather map in the cloud frame (dev): {width, height, data:RGBA bytes, mean} */
  weatherImage(channel = 0, width = 2048, win = [-180, 180, -90, 90]) {
    const r = this.app.renderer, height = Math.round(width * (win[3] - win[2]) / (win[1] - win[0]));
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
    const W = new THREE.Vector4(...win.map((v) => v * Math.PI / 180));
    const pass = new FullscreenPass(fsMaterial({ fragmentShader: GLSL_WEATHER_DEBUG, uniforms: { uCloudWeather: { value: this.weatherRT.texture }, uChannel: { value: channel }, uWindow: { value: W } } }));
    const prev = r.getRenderTarget();
    pass.render(r, rt);
    const data = new Uint8Array(width * height * 4);
    r.readRenderTargetPixels(rt, 0, 0, width, height, data);
    r.setRenderTarget(prev);
    pass.dispose(); rt.dispose();
    // area-weighted mean of the red channel (coverage for channel 0)
    let sum = 0, wsum = 0;
    for (let y = 0; y < height; y++) {
      const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
      for (let x = 0; x < width; x += 4) { sum += data[(y * width + x) * 4] * w; wsum += w; }
    }
    return { width, height, data, mean: sum / wsum / 255 };
  }

  dispose() {
    this.weatherRT?.dispose(); this.shapeRT?.dispose(); this.detailRT?.dispose();
    this.localRT?.dispose(); this.globalRT?.dispose(); this.shadowPass?.dispose(); this.emissionTex?.dispose();
  }
}
