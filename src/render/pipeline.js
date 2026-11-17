// Renderer + HDR post-processing pipeline. OWNER: atmosphere/pipeline agent.
// CONTRACT:
//   new Pipeline(app, container) -> creates app.renderer (WebGLRenderer, logarithmicDepthBuffer)
//   pipeline.setSize(w, h)            CSS pixels; device pixel ratio from settings.pixelRatio
//   pipeline.render(frame)            HDR scene -> atmosphere/cloud composite -> TAA -> bloom ->
//                                     exposure (+ local exposure) -> tone map + sRGB (once) -> canvas
//   pipeline.capture({scale, samples}) -> Promise<Blob>  clean high-resolution PNG still (scale x
//                                     the drawing-buffer size; tiles with a 64 px guard band, each
//                                     accumulated to convergence; bloom / local exposure from a
//                                     seamless overview; no UI)
//   pipeline.resetAccumulation(hard?) call when something changes that the pipeline cannot see
//                                     (it already resets on camera / time / settings / scene
//                                     draw-count changes)
//   pipeline.snapExposure(frames)     instant exposure adaptation (teleports / bookmarks)
//   pipeline.lodScale                 1 normally, = capture scale while a capture refines (systems
//                                     may use it to raise their screen-space LOD target)
//   pipeline.exposure                 {value, ev, target, avgLog, settled} (async read-back)
//   pipeline.converged                true once the static accumulation is good enough for a still
//   pipeline.pixelHeight              full-image height in px (differs from height while tiling)
//
// Chain (all render targets RGBA16F, linear):
//   scene pass (sceneRT + 32F depth texture, log depth, jittered projection while TAA is on)
//   -> GTAO (half res, camera near the ground only) from this frame's depth; patched materials read
//      it NEXT frame through a reprojection matrix and apply it to ambient light only
//   -> composite (app.systems.atmosphere.composite: aerial perspective, sky, clouds, sun, stars)
//   -> temporal resolve (reprojection with float64 origin deltas; progressive accumulation up to
//      256 samples while camera/time/scene are static, 3x3 variance clipping always on; once the
//      sample count is reached only the scene pass runs (change detection) and the converged
//      history is re-displayed, so a finished still costs almost nothing)
//   -> metering: physically motivated prior (atmosphere.exposurePrior) + gentle metered corrections
//      (interiors brighten, highlight fraction protects sunset skies), smooth adaptation
//   -> bloom (13-tap Karis downsample / tent upsample, energy conserving mix, cores clamped)
//   -> output (bloom, exposure, local exposure, AgX with a gentle look, sRGB OETF, dither)
// The chain is a custom pass graph (not EffectComposer) because it shares the depth texture,
// keeps a persistent TAA history, feeds AO back into materials and renders tiled captures.
// Settings (state.settings): exposure (linear multiplier, the UI sets 2^EV), bloom, taa, ao,
// localExposure, toneMap ('agx' | 'aces'), bloomStrength, fixedExposure, nightDodge, pixelRatio
// (0 = auto) and quality ('ultra' | 'high' | 'medium', see QUALITY) — every change emits 'settings'.
// 'time' events (sol time / season) and 'goto' reset the accumulation.
import * as THREE from 'three';
import { FullscreenPass, fsMaterial, halfFloatTarget } from './atmosphere/gpu.js';
import { TAA_FRAG, COPY_FRAG, GREY_FRAG, CROP_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, LUM_FRAG, ADAPT_FRAG, OUTPUT_FRAG } from './shaders/post.glsl.js';
import { GTAO_FRAG, AO_BLUR_FRAG } from './shaders/gtao.glsl.js';

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
const MAX_SAMPLES = 256;
// quality presets: auto pixel-ratio cap, accumulated samples, samples needed for a converged still,
// cloud march quality (static / moving) and ground-level AO. 'ultra' (default) is the acceptance target.
// While the view is static the clouds are marched at FULL resolution with per-frame jittered steps,
// so the accumulation converges the march noise; the static step budget can therefore stay moderate
// (a dense deck seen from below costs ~4x less than a 1.0 budget and converges to the same image),
// which keeps the page responsive while a still refines.
export const QUALITY = {
  ultra: { dprCap: 4, samples: 256, converge: 32, cloudStatic: 0.75, cloudMoving: 0.6, ao: true },
  high: { dprCap: 1.5, samples: 128, converge: 24, cloudStatic: 0.65, cloudMoving: 0.5, ao: true },
  medium: { dprCap: 1, samples: 64, converge: 16, cloudStatic: 0.55, cloudMoving: 0.42, ao: false },
};
const BLOOM_LEVELS = 6;
const CAPTURE_GUARD = 64;         // px of overscan around every capture tile
const LUM_W = 256, LUM_H = 128;
const LOCAL_LOD = 4.0;            // 16 x 8 grid for local exposure

class Bloom {
  constructor() {
    this.down = []; this.up = [];
    this.downPass = new FullscreenPass(fsMaterial({ fragmentShader: BLOOM_DOWN_FRAG, uniforms: { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 }, uClampLum: { value: 4000 } } }));
    this.upPass = new FullscreenPass(fsMaterial({ fragmentShader: BLOOM_UP_FRAG, uniforms: { tLow: { value: null }, tBase: { value: null }, uLowTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.55 } } }));
    this.w = 0; this.h = 0;
  }
  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = []; this.up = [];
    let cw = w, ch = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2));
      this.down.push(halfFloatTarget(cw, ch));
      this.up.push(halfFloatTarget(cw, ch));
    }
  }
  /** returns the texture of the full bloom (half resolution) */
  render(r, srcTex, srcW, srcH, clampLum) {
    const d = this.downPass.material.uniforms;
    let sw = srcW, sh = srcH, src = srcTex;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      d.tSrc.value = src; d.uSrcTexel.value.set(1 / sw, 1 / sh); d.uKaris.value = i === 0 ? 1 : 0; d.uClampLum.value = i === 0 ? clampLum : 1e9;
      this.downPass.render(r, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    const u = this.upPass.material.uniforms;
    let low = this.down[BLOOM_LEVELS - 1];
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      u.tLow.value = low.texture; u.tBase.value = this.down[i].texture; u.uLowTexel.value.set(1 / low.width, 1 / low.height);
      this.upPass.render(r, this.up[i]);
      low = this.up[i];
    }
    return this.up[0].texture;
  }
  dispose() { for (const t of [...this.down, ...this.up]) t.dispose(); this.downPass.dispose(); this.upPass.dispose(); }
}

export class Pipeline {
  constructor(app, container) {
    this.app = app;
    const r = new THREE.WebGLRenderer({ antialias: false, alpha: false, stencil: false, depth: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    r.info.autoReset = false;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;     // the atmosphere system requests updates (near ground only)
    r.setClearColor(0x000000, 1);
    container.appendChild(r.domElement);
    r.domElement.id = 'mars-canvas';
    r.domElement.style.display = 'block';
    this.renderer = r;
    this.gl = r.getContext();
    this.contextLost = false;
    this._initContextLoss(r.domElement);

    this.width = 1; this.height = 1; this.cssW = 1; this.cssH = 1; this.dpr = 1;
    this._fullH = 0;
    this.lodScale = 1;
    this.frameIndex = 0;
    this.accum = { n: 0, valid: false, lastSolTime: null, lastSub: null, lastCalls: -1, lastTris: -1, hard: true, soft: false, blend: 1, gamma: 1, reset: true };
    this.exposure = { value: 0.5, ev: -1, target: -1, avgLog: 0, settled: false, frames: 0 };
    this._expReset = 2;
    this._capturing = false;
    this._prevVP = new THREE.Matrix4();
    this._prevOrigin = { x: 0, y: 0, z: 0 };
    this._havePrev = false;
    this._projNJ = new THREE.Matrix4();
    this._projInvNJ = new THREE.Matrix4();
    this._tmpM = new THREE.Matrix4();
    this.gpuTimeMs = 0;
    this._timer = this._initTimer();

    // passes
    this.copyPass = new FullscreenPass(fsMaterial({ fragmentShader: COPY_FRAG, uniforms: { tSrc: { value: null } } }));
    this.greyPass = new FullscreenPass(fsMaterial({ fragmentShader: GREY_FRAG, uniforms: { tSrc: { value: null } } }));
    this.cropPass = new FullscreenPass(fsMaterial({ fragmentShader: CROP_FRAG, uniforms: { tSrc: { value: null }, uRect: { value: new THREE.Vector4(1, 1, 0, 0) } } }));
    this.taaPass = new FullscreenPass(fsMaterial({
      fragmentShader: TAA_FRAG,
      uniforms: {
        tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null }, tExposure: { value: null },
        uInvProjNJ: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uPrevViewProj: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() }, uBlend: { value: 1 }, uGamma: { value: 1 }, uReset: { value: 1 }, uLogFar: { value: 1 },
      },
    }));
    this.lumPass = new FullscreenPass(fsMaterial({ fragmentShader: LUM_FRAG, uniforms: { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uPriorExposure: { value: 0.5 } } }));
    this.adaptPass = new FullscreenPass(fsMaterial({
      fragmentShader: ADAPT_FRAG,
      uniforms: {
        tLum: { value: null }, uLumLod: { value: Math.log2(LUM_W) }, tPrev: { value: null }, uDt: { value: 0.016 }, uReset: { value: 1 },
        uMinEV: { value: -4.0 }, uMaxEV: { value: 5.0 }, uSpeedUp: { value: 1.1 }, uSpeedDown: { value: 1.8 }, uKey: { value: 0.18 },
        uFixed: { value: 0 }, uPhysEV: { value: -1.2 }, uUpCap: { value: 2.0 }, uMeterK: { value: 1 },
      },
    }));
    this.outputPass = new FullscreenPass(fsMaterial({
      fragmentShader: OUTPUT_FRAG,
      uniforms: {
        tColor: { value: null }, tBloom: { value: null }, tExposure: { value: null }, tLum: { value: null },
        uBloom: { value: 0.04 }, uUserExposure: { value: 1 }, uLocal: { value: 1 }, uLocalLod: { value: LOCAL_LOD },
        uToneMap: { value: 0 }, uOrbitLook: { value: 0 }, uFrame: { value: 0 }, uBloomUv: { value: new THREE.Vector4(1, 1, 0, 0) },
      },
    }));
    this.gtaoPass = new FullscreenPass(fsMaterial({
      fragmentShader: GTAO_FRAG,
      uniforms: {
        tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProjScale: { value: new THREE.Vector2(1, 1) },
        uFullSize: { value: new THREE.Vector2(1, 1) }, uLogFar: { value: 1 }, uRadius: { value: 2.5 }, uMaxDist: { value: 1500 }, uFrame: { value: 0 },
      },
    }));
    this.aoBlurPass = new FullscreenPass(fsMaterial({ fragmentShader: AO_BLUR_FRAG, uniforms: { tAO: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 1 } } }));
    this.bloom = new Bloom();

    // exposure targets (1x1 float, persistent) and the luminance pyramid
    const expOpts = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.expRT = [halfFloatTarget(1, 1, expOpts), halfFloatTarget(1, 1, expOpts)];
    this.expIndex = 0;
    this.lumRT = halfFloatTarget(LUM_W, LUM_H, { type: THREE.FloatType, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
    this._initExposureTargets();
    this.aoOn = false;

    const st = app.state;
    if (st?.events) {
      st.events.on('settings', ({ key }) => {
        if (key === 'pixelRatio' || key === 'quality') this.setSize(this.cssW, this.cssH);
        this.resetAccumulation(true);
      });
      // sol time / season changes: small steps (time playback) count as motion, jumps and season
      // changes discard the history (_updateAccum compares solTime / subsolarLat every frame too)
      st.events.on('time', () => this.resetAccumulation(false));
      st.events.on('goto', () => this.resetAccumulation(true));
    }
    this.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  }

  /**
   * WebGL context loss (QA-ID-05): GPU resets under heavy load. While the context is lost the frame
   * loop is paused (no system touches GL, no error flood) and a notice is shown. Several systems keep
   * geometry only in GPU buffers (city batches) or generate GPU-only textures (LUTs, cloud noise), so
   * they cannot be re-uploaded in place: when the browser restores the context the page reloads at the
   * same pose / time / settings (at most twice per 10 min, then the notice offers a manual reload).
   */
  _initContextLoss(canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.contextLost) return;
      this.contextLost = true;
      this._pausedLoop = true;
      try { this.renderer.setAnimationLoop(null); } catch { /* ignore */ }
      console.warn('[pipeline] WebGL context lost: frame loop paused, waiting for the browser to restore it');
      this._contextNotice('WebGL 上下文丢失（GPU 重置），渲染已暂停，正在等待恢复…', false);
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[pipeline] WebGL context restored: reloading the view');
      let n = [];
      try { n = JSON.parse(sessionStorage.getItem('mars.ctxReloads') || '[]').filter((t) => Date.now() - t < 600000); } catch { n = []; }
      if (n.length >= 2) { this._contextNotice('WebGL 上下文已恢复，但短时间内多次丢失。请点击重新加载。', true); return; }
      try { n.push(Date.now()); sessionStorage.setItem('mars.ctxReloads', JSON.stringify(n)); } catch { /* storage blocked */ }
      this._contextNotice('WebGL 上下文已恢复，正在重新加载当前视角…', false);
      setTimeout(() => location.replace(this._reloadUrl()), 300);
    }, false);
  }

  /** URL of the current view (pose, sol time, display settings) for a reload after a context loss */
  _reloadUrl() {
    const q = new URLSearchParams(location.search);
    try {
      const p = this.app.rig?.getPose?.();
      if (p && Number.isFinite(p.lat)) {
        q.delete('bookmark');
        q.set('pose', [p.lat, p.lon, p.alt, p.heading, p.pitch, p.lens].map((v) => +(+v || 0).toFixed(7)).join(','));
      }
      const st = this.app.state;
      if (st && Number.isFinite(st.solTime)) q.set('time', (+st.solTime).toFixed(4));
      if (st?.settings?.clean) q.set('clean', '1');
      if (st?.settings?.quality) q.set('quality', st.settings.quality);
    } catch { /* keep the original URL */ }
    return location.pathname + '?' + q.toString() + location.hash;
  }

  _contextNotice(text, button) {
    try {
      let el = document.getElementById('mars-context-notice');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mars-context-notice';
        el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:99999;padding:16px 22px;border-radius:8px;background:rgba(12,14,18,0.88);color:#e8e6e0;font:15px/1.5 system-ui,sans-serif;text-align:center;max-width:80vw';
        document.body.appendChild(el);
      }
      el.textContent = text;
      if (button) {
        const b = document.createElement('button');
        b.textContent = '重新加载';
        b.style.cssText = 'display:block;margin:12px auto 0;padding:6px 16px;font:inherit;cursor:pointer';
        b.onclick = () => location.replace(this._reloadUrl());
        el.appendChild(b);
      }
    } catch { /* no DOM */ }
  }

  get settings() { return this.app.state?.settings || {}; }
  /** the active quality preset (QUALITY[settings.quality], default ultra) */
  get quality() { return QUALITY[this.settings.quality] || QUALITY.ultra; }
  /** the current adapted exposure texture (R = multiplier, G = EV, B = target EV, A = avg log2 L) */
  get exposureTexture() { return this.expRT[this.expIndex].texture; }
  /** full-image height in device pixels (tiles of a capture are smaller than the image) */
  get pixelHeight() { return this._fullH || this.height; }

  _initExposureTargets() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (const t of this.expRT) { r.setRenderTarget(t); r.setClearColor(new THREE.Color(0.5, -1, -1), 1); r.clear(true, false, false); }
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(prev);
  }

  setSize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    const s = this.settings;
    const dpr = s.pixelRatio > 0 ? s.pixelRatio : Math.min(window.devicePixelRatio || 1, this.quality.dprCap);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    const r = this.renderer;
    r.setPixelRatio(dpr);
    r.setSize(w, h, false);
    r.domElement.style.width = w + 'px';
    r.domElement.style.height = h + 'px';
    this._allocTargets(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
    this.resetAccumulation(true);
  }

  _allocTargets(W, H) {
    if (W === this.width && H === this.height && this.sceneRT) return;
    this.width = W; this.height = H;
    for (const t of [this.sceneRT, this.compositeRT, ...(this.hist || []), this.aoRT, this.aoBlurRT]) t?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    const depth = new THREE.DepthTexture(W, H, THREE.FloatType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter; depth.magFilter = THREE.NearestFilter;
    this.sceneRT = halfFloatTarget(W, H, { depthBuffer: true, depthTexture: depth });
    this.sceneRT.texture.name = 'pipeline.scene';
    this.compositeRT = halfFloatTarget(W, H);
    this.hist = [halfFloatTarget(W, H), halfFloatTarget(W, H)];
    this.histIndex = 0;
    const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    this.aoRT = halfFloatTarget(hw, hh, { format: THREE.RGFormat });
    this.aoBlurRT = halfFloatTarget(hw, hh, { format: THREE.RGFormat });
    this.aoRT.texture.name = 'pipeline.ao'; this.aoBlurRT.texture.name = 'pipeline.aoBlur';
    this.bloom.setSize(W, H);
    this._aoValid = false;
  }

  /** hard = discard history (teleports, settings); soft = treat as motion this frame */
  resetAccumulation(hard = false) { if (hard) this.accum.hard = true; else this.accum.soft = true; }

  _initTimer() {
    try {
      const ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
      return ext ? { ext, pending: [], active: null } : null;
    } catch { return null; }
  }
  _timerBegin() {
    const t = this._timer; if (!t || t.active || t.pending.length > 3) return;
    const q = this.gl.createQuery(); this.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q); t.active = q;
  }
  _timerEnd() {
    const t = this._timer; if (!t) return;
    const gl = this.gl;
    if (t.active) { gl.endQuery(t.ext.TIME_ELAPSED_EXT); t.pending.push(t.active); t.active = null; }
    while (t.pending.length) {
      const q = t.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(t.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) this.gpuTimeMs = this.gpuTimeMs * 0.8 + (ns / 1e6) * 0.2;
      gl.deleteQuery(q); t.pending.shift();
    }
  }

  // ------------------------------------------------------------------------------------------
  _updateAccum(frame, forceHard, ignoreMotion) {
    const a = this.accum;
    let hard = a.hard || forceHard || !a.valid;
    let soft = ignoreMotion ? false : (a.soft || !!frame.moving);
    a.hard = false; a.soft = false;
    if (a.lastSolTime !== null) {
      let d = frame.solTime - a.lastSolTime;
      d = ((d % 24) + 36) % 24 - 12;
      if (Math.abs(d) > 0.25) hard = true; else if (Math.abs(d) > 1e-9) soft = true;
    }
    a.lastSolTime = frame.solTime;
    const sub = frame.app?.state?.subsolarLat ?? this.app.state?.subsolarLat;
    if (a.lastSub !== null && sub !== a.lastSub) hard = true;
    a.lastSub = sub;
    if (hard) { a.n = 0; a.reset = true; } else if (soft) { a.n = 0; a.reset = false; } else { a.n++; a.reset = false; }
    a.valid = true;
    // camera / time / settings unchanged this frame (scene-content changes detected after the scene
    // pass restart the accumulation but keep the view static: the cloud history stays valid and the
    // view counts as converged after a while even if animated content keeps changing the draw list)
    a.viewStatic = !hard && !soft;
    const now = performance.now();
    if (!a.viewStatic) { a.staticFrames = 0; a.staticSince = now; } else a.staticFrames = (a.staticFrames || 0) + 1;
    if (a.staticSince === undefined) a.staticSince = now;
    this._computeBlend();
    return hard;
  }
  _computeBlend() {
    const a = this.accum;
    if (a.reset) { a.blend = 1; a.gamma = 1; return; }
    if (a.n === 0) { a.blend = 0.11; a.gamma = 1.0; return; }
    // progressive average once static: the history from motion (half-res clouds, reprojection blur)
    // keeps only ~2/(n+2) of the weight, so a converged still is as sharp as a single static frame
    const n = Math.min(a.n + 1, this.quality.samples);
    a.blend = 1 / (n + 1);
    a.gamma = Math.min(2.2, 1.0 + a.n * 0.05);
  }

  _jitter(cam) {
    const a = this.accum;
    const idx = a.n > 0 ? (a.n % this.quality.samples) + 1 : (this.frameIndex % 8) + 1;
    const jx = halton(idx, 2) - 0.5, jy = halton(idx, 3) - 0.5;
    const e = cam.projectionMatrix.elements;
    e[8] += (2 * jx) / this.width;
    e[9] += (2 * jy) / this.height;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  render(frame) {
    if (this._capturing || !frame || this.contextLost) return;
    this._renderFrame(frame, { output: null, metering: true });
  }

  /** previous frame's unjittered view-projection expressed in the current render space */
  _prevViewProjInCurrent(frame) {
    const o = frame.camEcef || { x: 0, y: 0, z: 0 };
    const dx = o.x - this._prevOrigin.x, dy = o.y - this._prevOrigin.y, dz = o.z - this._prevOrigin.z;
    this._tmpM.makeTranslation(dx, dy, dz);
    return this._tmpM.premultiply(this._prevVP);
  }

  /** AO feedback for patched materials: last frame's AO + its view-projection in this render space */
  _publishAO(frame) {
    const lu = this.app.lighting?.uniforms;
    if (!lu || !lu.uLpAO) return;
    const s = this.settings;
    const hg = Math.max(0, frame.camAltGround ?? frame.camAlt ?? 0);
    const want = s.ao !== false && this.quality.ao && hg < 4000;
    this._aoStrength = want ? 1 - THREE.MathUtils.smoothstep(hg, 1500, 4000) : 0;
    const use = want && this._aoValid && this._havePrev;
    lu.uLpAOOn.value = use ? 1 : 0;
    lu.uLpAO.value = this.aoBlurRT.texture;
    if (use) lu.uLpAOVP.value.copy(this._prevViewProjInCurrent(frame));
    this.aoOn = want;
  }

  _renderAO(cam) {
    const r = this.renderer;
    const u = this.gtaoPass.material.uniforms;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uProjScale.value.set(cam.projectionMatrix.elements[0], cam.projectionMatrix.elements[5]);
    u.uFullSize.value.set(this.width, this.height);
    u.uLogFar.value = Math.log2(cam.far + 1);
    u.uFrame.value = this.frameIndex % 4096;
    this.gtaoPass.render(r, this.aoRT);
    const b = this.aoBlurPass.material.uniforms;
    b.tAO.value = this.aoRT.texture;
    b.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    b.uStrength.value = this._aoStrength;
    this.aoBlurPass.render(r, this.aoBlurRT);
    this._aoValid = true;
  }

  /**
   * One frame. opts.output: render target (null = canvas); opts.metering: run exposure adaptation;
   * opts.accumulateOnly: stop after the temporal resolve (capture tiles).
   */
  _renderFrame(frame, opts) {
    const r = this.renderer, app = this.app, cam = app.camera, s = this.settings;
    const taa = s.taa !== false;
    this.frameIndex++;
    if (!opts.accumulateOnly) { r.info.reset(); this._timerBegin(); }
    this._updateAccum(frame, opts.forceHard, opts.accumulateOnly);
    this._publishAO(frame);
    // remember the unjittered projection, then jitter
    this._projNJ.copy(cam.projectionMatrix);
    this._projInvNJ.copy(cam.projectionMatrixInverse);
    if (taa) this._jitter(cam);

    // scene pass
    const c0 = r.info.render.calls, t0 = r.info.render.triangles;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(app.scene, cam);
    const dc = r.info.render.calls - c0, dtri = r.info.render.triangles - t0;
    const a = this.accum;
    if (!a.reset && (dc !== a.lastCalls || dtri !== a.lastTris) && a.lastCalls >= 0 && !opts.accumulateOnly) { a.n = 0; this._computeBlend(); }
    a.lastCalls = dc; a.lastTris = dtri;

    // fully converged still (camera, time, settings and scene unchanged for `samples` frames): the
    // scene pass above keeps detecting changes, but AO, the cloud march / composite and the temporal
    // resolve are skipped and the converged history is re-displayed -> the GPU goes quiet and the page
    // stays responsive while a finished still is on screen
    const settled = taa && !opts.accumulateOnly && !s.debugView && !a.reset && this._havePrev && this.lastHDR && a.n > this.quality.samples + 1;
    if (settled) {
      cam.projectionMatrix.copy(this._projNJ);
      cam.projectionMatrixInverse.copy(this._projInvNJ);
      this._prevVP.multiplyMatrices(this._projNJ, cam.matrixWorldInverse);
      const o0 = frame.camEcef || { x: 0, y: 0, z: 0 };
      this._prevOrigin.x = o0.x; this._prevOrigin.y = o0.y; this._prevOrigin.z = o0.z;
      const hdr0 = this.lastHDR;
      if (opts.metering) this._meter(hdr0, frame);
      const bloomTex0 = s.bloom !== false ? this.bloom.render(r, hdr0.texture, this.width, this.height, this._bloomClamp()) : null;
      this._output(hdr0.texture, bloomTex0, opts.output, null, this.lumRT.texture);
      this._timerEnd();
      return hdr0;
    }

    // ambient occlusion for the next frame's materials
    if (this.aoOn) this._renderAO(cam); else this._aoValid = false;

    // composite (atmosphere, clouds, sun, stars)
    const comp = app.systems?.atmosphere?.composite;
    if (comp && comp.ready) comp.render(r, this.sceneRT, this.compositeRT, frame, this);
    else { this.copyPass.material.uniforms.tSrc.value = this.sceneRT.texture; this.copyPass.render(r, this.compositeRT); }

    // temporal resolve
    let hdr = this.compositeRT;
    if (taa) {
      const u = this.taaPass.material.uniforms;
      const prev = this.hist[this.histIndex], next = this.hist[1 - this.histIndex];
      u.tCurrent.value = this.compositeRT.texture;
      u.tHistory.value = prev.texture;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.tExposure.value = this.exposureTexture;
      u.uInvProjNJ.value.copy(this._projInvNJ);
      u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
      u.uPrevViewProj.value.copy(this._prevViewProjInCurrent(frame));
      u.uTexel.value.set(1 / this.width, 1 / this.height);
      u.uBlend.value = a.blend;
      u.uGamma.value = a.gamma;
      u.uReset.value = (a.reset || !this._havePrev) ? 1 : 0;
      u.uLogFar.value = Math.log2(cam.far + 1);
      this.taaPass.render(r, next);
      this.histIndex = 1 - this.histIndex;
      hdr = next;
    }
    // restore projection; store this frame's unjittered view-projection for reprojection
    cam.projectionMatrix.copy(this._projNJ);
    cam.projectionMatrixInverse.copy(this._projInvNJ);
    this._prevVP.multiplyMatrices(this._projNJ, cam.matrixWorldInverse);
    const o = frame.camEcef || { x: 0, y: 0, z: 0 };
    this._prevOrigin.x = o.x; this._prevOrigin.y = o.y; this._prevOrigin.z = o.z;
    this._havePrev = true;
    this.lastHDR = hdr;
    if (opts.accumulateOnly) return hdr;

    // exposure metering + adaptation (also fills the luminance pyramid used by local exposure)
    if (opts.metering) this._meter(hdr, frame);
    // bloom
    const bloomOn = s.bloom !== false;
    const bloomTex = bloomOn ? this.bloom.render(r, hdr.texture, this.width, this.height, this._bloomClamp()) : null;
    // output
    if (s.debugView === 'ao' && this._aoValid) { this.greyPass.material.uniforms.tSrc.value = this.aoBlurRT.texture; this.greyPass.render(r, opts.output); }
    else if (s.debugView === 'aoRaw' && this._aoValid) { this.greyPass.material.uniforms.tSrc.value = this.aoRT.texture; this.greyPass.render(r, opts.output); }
    else this._output(hdr.texture, bloomTex, opts.output, null, this.lumRT.texture);
    this._timerEnd();
    return hdr;
  }

  /** bright cores are clamped before blurring so a single window or lamp cannot flood the frame */
  _bloomClamp() { return 24 / Math.max(this.exposure.value * (this.settings.exposure > 0 ? this.settings.exposure : 1), 1e-3); }

  _lum(srcTex, srcW, srcH, target, priorExposure) {
    const lu = this.lumPass.material.uniforms;
    lu.tSrc.value = srcTex;
    lu.uSrcTexel.value.set(1 / srcW, 1 / srcH);
    lu.uPriorExposure.value = priorExposure;
    this.lumPass.render(this.renderer, target);    // mipmaps regenerated by the renderer
  }

  _meter(hdr, frame) {
    const r = this.renderer;
    const prior = this.app.systems?.atmosphere?.exposurePrior;
    const physEV = prior ? prior.update(frame, this.app.camera) : -1.2;
    this._lum(hdr.texture, this.width, this.height, this.lumRT, Math.pow(2, physEV));
    const au = this.adaptPass.material.uniforms;
    const prev = this.expRT[this.expIndex], next = this.expRT[1 - this.expIndex];
    au.tLum.value = this.lumRT.texture;
    au.tPrev.value = prev.texture;
    au.uDt.value = Math.min(0.1, frame.dt || 0.016);
    au.uReset.value = this._expReset > 0 ? 1 : 0;
    au.uFixed.value = this.settings.fixedExposure > 0 ? this.settings.fixedExposure : 0;
    au.uPhysEV.value = physEV;
    // dark scenes may brighten a lot in daylight near the ground (interiors, deep canyons), barely at
    // night (night stays night) and not from altitude (a dark night side must not lift a day view)
    const hg = Math.max(0, frame.camAltGround ?? frame.camAlt ?? 0);
    // "day" from the sun at the camera (the capped ground night exposure, EV ~0.8, would look like day
    // to an exposure-based test and let the meter lift the night by +1 EV)
    const dayness = Math.min(1 - THREE.MathUtils.smoothstep(physEV, -0.5, 2.5), prior ? 1 - (prior.nightK || 0) : 1);
    au.uUpCap.value = 0.3 + 2.5 * dayness * (1 - THREE.MathUtils.smoothstep(hg, 2000, 25000));
    // from orbit the exposure is the locked baseline of the prior (no metered corrections)
    this._lockK = prior ? prior.lockK || 0 : 0;
    au.uMeterK.value = 1 - this._lockK;
    if (this._expReset > 0) this._expReset--;
    this.adaptPass.render(r, next);
    this.expIndex = 1 - this.expIndex;
    // async readback for idle detection / diagnostics
    this.exposure.frames++;
    if ((this.exposure.frames & 7) === 0 && !this._expReading && r.readRenderTargetPixelsAsync) {
      this._expReading = true;
      const buf = new Float32Array(4);
      r.readRenderTargetPixelsAsync(next, 0, 0, 1, 1, buf).then(() => {
        const e = this.exposure;
        if (Number.isFinite(buf[0]) && buf[0] > 0) { e.value = buf[0]; e.ev = buf[1]; e.target = buf[2]; e.avgLog = buf[3]; }
        // 0.05 EV (3.5 %) is invisible; a tighter bound flickers with the meter noise of animated scenes
        e.settled = Math.abs(buf[1] - buf[2]) < 0.05 || this.settings.fixedExposure > 0;
      }).catch(() => {}).finally(() => { this._expReading = false; });
    }
  }

  /** request instant exposure adaptation for the next frames (teleports, bookmarks) */
  snapExposure(frames = 3) { this._expReset = frames; this.exposure.settled = false; }

  _output(hdrTex, bloomTex, target, overviewUv, lumTex) {
    const s = this.settings;
    const u = this.outputPass.material.uniforms;
    u.tColor.value = hdrTex;
    u.tBloom.value = bloomTex;
    u.uBloom.value = bloomTex ? (s.bloomStrength ?? 0.04) : 0;
    u.tExposure.value = this.exposureTexture;
    u.tLum.value = lumTex;
    // local exposure fades out from orbit, where the night side is lifted geometrically (composite
    // dodge) and the exposure is locked: framing must not change how a region looks; and at night,
    // where it would lift the large dark areas that artificial light must leave dark (QQ-05)
    const nightK = this.app.systems?.atmosphere?.exposurePrior?.nightK || 0;
    u.uLocal.value = s.localExposure === false || !lumTex ? 0 : (typeof s.localExposure === 'number' ? s.localExposure : 1) * (1 - (this._lockK || 0)) * (1 - nightK);
    u.uUserExposure.value = s.exposure > 0 ? s.exposure : 1;
    u.uToneMap.value = s.toneMap === 'aces' ? 1 : 0;
    // orbit look (fix round 3, QQ-14): midtone contrast / saturation / soft shoulder for views of the disc
    // from space, with the locked exposure (lockK); settings.orbitLook false/0..1 for A/B
    const ol = s.orbitLook === false ? 0 : (typeof s.orbitLook === 'number' ? THREE.MathUtils.clamp(s.orbitLook, 0, 1) : 1);
    u.uOrbitLook.value = (this._lockK || 0) * ol;
    u.uFrame.value = this.frameIndex;
    if (overviewUv) u.uBloomUv.value.copy(overviewUv); else u.uBloomUv.value.set(1, 1, 0, 0);
    this.outputPass.render(this.renderer, target);
  }

  /**
   * true when the accumulated image has converged enough for a still: `converge` accumulated frames
   * (+24 while the static cloud march is interleaved, each frame then marches a quarter of the
   * pixels), or -- when animated content (trains, boats, LOD swaps) keeps restarting the accumulation
   * of an otherwise static view -- 3x that many static frames and >= 2.5 s, so automation never
   * waits forever on a living scene.
   */
  get converged() {
    if (this.settings.taa === false) return true;
    const a = this.accum, c = this.quality.converge;
    const need = c + (this.app.systems?.atmosphere?.composite?.cloudPass?.interleaved ? 24 : 0);
    if (a.n >= need) return true;
    return !!a.viewStatic && (a.staticFrames || 0) >= 3 * need && performance.now() - (a.staticSince ?? 0) >= 2500;
  }

  // ------------------------------------------------------------------------------------------
  /**
   * Clean high-resolution still. scale 1..4 (any positive number up to 8), samples = accumulated
   * frames per tile. Renders tiles of at most the current drawing-buffer size with
   * camera.setViewOffset, computes bloom and the local-exposure pyramid on a screen-size overview
   * so they are seamless, tone maps with the current exposure, assembles a PNG. UI (DOM) is never
   * part of the image.
   */
  async capture({ scale = 1, samples = 48, idleTimeoutMs = 20000 } = {}) {
    const app = this.app, r = this.renderer, cam = app.camera;
    scale = Math.max(0.25, Math.min(8, +scale || 1));
    const W0 = this.width, H0 = this.height;
    const W = Math.max(1, Math.round(W0 * scale)), H = Math.max(1, Math.round(H0 * scale));
    const nx = Math.ceil(W / W0), ny = Math.ceil(H / H0);
    const tw = Math.ceil(W / nx), th = Math.ceil(H / ny);
    this._capturing = true;
    this.lodScale = scale;
    const tiles = [];
    let overview = null, overviewBloom = null, outRT = null, capLum = null;
    try {
      // let systems refine for the capture LOD scale
      const t0 = performance.now();
      if (scale > 1 && app.isIdle) {
        await new Promise((res) => requestAnimationFrame(res));
        while (performance.now() - t0 < idleTimeoutMs && !app.isIdle()) await new Promise((res) => requestAnimationFrame(res));
      }
      const frame = app.frame;
      overview = halfFloatTarget(W0, H0);
      overviewBloom = new Bloom(); overviewBloom.setSize(W0, H0);
      capLum = halfFloatTarget(LUM_W, LUM_H, { type: THREE.FloatType, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
      outRT = new THREE.WebGLRenderTarget(tw, th, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, colorSpace: THREE.NoColorSpace });
      const canvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = canvas.getContext('2d');
      this._fullH = H;
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const x = tx * tw, y = ty * th;
          const cw = Math.min(tw, W - x), ch = Math.min(th, H - y);
          // guard band: render a larger window so the screen-space passes (GTAO, the TAA
          // neighbourhood, the cloud pass depth taps) see real neighbours at the tile border, then
          // keep only the interior -> no seams between tiles
          const gx0 = Math.max(0, x - CAPTURE_GUARD), gy0 = Math.max(0, y - CAPTURE_GUARD);
          const gx1 = Math.min(W, x + cw + CAPTURE_GUARD), gy1 = Math.min(H, y + ch + CAPTURE_GUARD);
          const ew = gx1 - gx0, eh = gy1 - gy0;
          cam.setViewOffset(W, H, gx0, gy0, ew, eh);
          cam.updateProjectionMatrix();
          this._allocTargets(ew, eh);
          this._havePrev = false;
          // one warm-up frame (AO / reprojection history for this tile), then accumulate
          this._renderFrame(frame, { accumulateOnly: true, forceHard: true });
          for (let i = 0; i < samples; i++) this._renderFrame(frame, { accumulateOnly: true, forceHard: i === 0 });
          const tileRT = halfFloatTarget(cw, ch);
          // interior of the guarded window (view-offset rows run top-down, GL uv bottom-up)
          const cu = this.cropPass.material.uniforms;
          cu.tSrc.value = this.lastHDR.texture;
          cu.uRect.value.set(cw / ew, ch / eh, (x - gx0) / ew, (gy1 - y - ch) / eh);
          this.cropPass.render(r, tileRT);
          // scaled copy into the overview (top-left origin -> GL bottom-left)
          const ox = (x / W) * W0, oy = ((H - y - ch) / H) * H0;
          this.copyPass.material.uniforms.tSrc.value = tileRT.texture;
          this.copyPass.render(r, overview, [Math.floor(ox), Math.floor(oy), Math.ceil((cw / W) * W0), Math.ceil((ch / H) * H0)]);
          tiles.push({ x, y, cw, ch, rt: tileRT });
          cam.clearViewOffset();
          cam.updateProjectionMatrix();
          await new Promise((res) => requestAnimationFrame(res));
        }
      }
      const bloomTex = this.settings.bloom !== false ? overviewBloom.render(r, overview.texture, W0, H0, this._bloomClamp()) : null;
      this._lum(overview.texture, W0, H0, capLum, this.exposure.value);
      for (const t of tiles) {
        if (outRT.width !== t.cw || outRT.height !== t.ch) outRT.setSize(t.cw, t.ch);
        // tile uv -> overview uv
        const ou = new THREE.Vector4(t.cw / W, t.ch / H, t.x / W, (H - t.y - t.ch) / H);
        this._output(t.rt.texture, bloomTex, outRT, ou, capLum.texture);
        const px = new Uint8Array(t.cw * t.ch * 4);
        r.readRenderTargetPixels(outRT, 0, 0, t.cw, t.ch, px);
        const img = new ImageData(t.cw, t.ch);
        const row = t.cw * 4;
        for (let yy = 0; yy < t.ch; yy++) img.data.set(px.subarray((t.ch - 1 - yy) * row, (t.ch - yy) * row), yy * row);
        ctx.putImageData(img, t.x, t.y);
      }
      return canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((res) => canvas.toBlob(res, 'image/png'));
    } finally {
      for (const t of tiles) t.rt.dispose();
      overview?.dispose(); overviewBloom?.dispose(); outRT?.dispose(); capLum?.dispose();
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
      this._fullH = 0;
      this.lodScale = 1;
      this._allocTargets(W0, H0);
      this._havePrev = false;
      this.resetAccumulation(true);
      this._capturing = false;
    }
  }

  dispose() {
    for (const t of [this.sceneRT, this.compositeRT, ...this.hist, ...this.expRT, this.lumRT, this.aoRT, this.aoBlurRT]) t?.dispose();
    for (const p of [this.copyPass, this.greyPass, this.cropPass, this.taaPass, this.lumPass, this.adaptPass, this.outputPass, this.gtaoPass, this.aoBlurPass]) p?.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
  }
}
