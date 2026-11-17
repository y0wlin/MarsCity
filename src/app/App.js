// Application shell: owns renderer, scene, camera, floating origin, the frame loop and the
// subsystem list. OWNER: integration (core). Subsystems receive `app` in their constructor and
// implement async init() and update(frame). See ARCHITECTURE.md.
import * as THREE from 'three';
import { R, SEED, WORLD_VERSION } from '../core/constants.js';
import { setOrigin, origin } from '../core/origin.js';
import { ecefToLatLonH, enuBasis, latLonHToEcef, buildingAxes } from '../core/geo.js';
import { loadControlMaps } from '../data/controlMaps.js';
import { WorkerPool } from '../workers/pool.js';
import { EventBus } from './events.js';
import { AppState } from './state.js';
import { sunDirection } from './sun.js';
import { findBookmark, allBookmarks } from './bookmarks.js';
import { CameraRig } from '../controls/CameraRig.js';
import { Pipeline } from '../render/pipeline.js';
import { AtmosphereSystem } from '../render/atmosphere/index.js';
import { CloudSystem } from '../render/clouds/index.js';
import { TerrainSystem } from '../render/terrain/index.js';
import { WaterSystem } from '../render/water/index.js';
import { CitySystem } from '../render/city/index.js';
import { MegaSystem } from '../megastructures/index.js';
import { PropsSystem } from '../props/index.js';
import { ControlsSystem } from '../controls/index.js';
import { UISystem } from '../ui/index.js';

export class App {
  constructor(container) {
    this.container = container;
    this.events = new EventBus();
    this.state = new AppState(this.events);
    this.rig = new CameraRig();
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2.0e8);
    this.camera.position.set(0, 0, 0);
    this.timer = new THREE.Timer();
    this.timer.connect?.(document);
    this.frameNo = 0;
    this.fps = 60;
    this.frame = null;
    this.version = { world: WORLD_VERSION, seed: SEED };
  }

  async start() {
    const base = import.meta.env.BASE_URL || '/';
    const maps = await loadControlMaps(base);
    this.workers = new WorkerPool();
    this.workers.init({ maps });

    this.pipeline = new Pipeline(this, this.container);
    this.renderer = this.pipeline.renderer;

    // subsystem order matters: atmosphere creates app.lighting used by others
    this.systems = {
      atmosphere: new AtmosphereSystem(this),
      clouds: new CloudSystem(this),
      terrain: new TerrainSystem(this),
      water: new WaterSystem(this),
      city: new CitySystem(this),
      mega: new MegaSystem(this),
      props: new PropsSystem(this),
      controls: new ControlsSystem(this),
      ui: new UISystem(this),
    };
    this.controls = this.systems.controls;
    await this.workers.ready;
    for (const [name, s] of Object.entries(this.systems)) {
      try { await s.init(); } catch (e) { console.error(`[init ${name}]`, e); }
    }

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyUrlParams();
    this.exposeAutomation();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Apply a bookmark object or id: pose + time + mode. Returns a Promise (resolves true/false). */
  applyBookmark(bm, { instant = true } = {}) {
    if (typeof bm === 'string') bm = findBookmark(bm);
    if (!bm) return Promise.resolve(false);
    // the newest bookmark request wins: an older one still resolving (mega layout, building streaming)
    // gives up instead of moving the camera afterwards, and says so (QS-03: never fail silently)
    const token = this._bmToken = (this._bmToken || 0) + 1;
    const current = (why) => {
      if (token === this._bmToken) return true;
      console.info(`[bookmark] ${bm.id}: superseded by a newer bookmark${why ? ` (${why})` : ''}`);
      return false;
    };
    // season is part of every bookmark (default 12°) so the light never depends on the order of visits
    this.state.subsolarLat = bm.subsolarLat !== undefined ? bm.subsolarLat : 12;
    if (bm.solTime !== undefined) this.state.setTime(bm.solTime);
    const go = (pose) => {
      if (instant || !this.controls.flyTo) this.rig.setPose(pose);
      else this.controls.flyTo(pose, {});
      if (bm.mode) this.controls.setMode?.(bm.mode, { bookmark: bm });
      this.events.emit('goto', { bookmark: bm });
      return true;
    };
    if (bm.megaView) {
      // megastructure framings come from app.systems.mega.views() (tuned against the G01/G02 refs)
      if (instant) this.rig.setPose(bm.pose);
      return this.resolveMegaView(bm.megaView).then((pose) => (current() ? go(pose ? { ...pose, lens: pose.lens || bm.pose.lens } : bm.pose) : false));
    }
    if (bm.buildingId && bm.view) {
      // provisional pose first so streaming starts at the right place, then the building's own
      // viewpoint through the controls: it stands on the right floor (walk mode where a floor carries
      // the eye — S07c the 2nd-floor living room) and resolves on arrival (OWNER of this block: controls)
      if (instant) this.rig.setPose(bm.pose);
      const fallback = () => this.resolveBuildingView(bm).then((pose) => (current() ? go(pose || bm.pose) : false));
      const c = this.controls;
      if (!c.buildingView) return fallback().catch((e) => { console.warn('[bookmark view]', e); return current() ? go(bm.pose) : false; });
      const lens = bm.viewLens || (bm.pose && bm.pose.lens) || undefined;
      // interruptions by the visitor end the bookmark; any other one (a race with streaming / another
      // programmatic write that left the camera where this request started) is retried, then the stored pose
      const USER = new Set(['pointer', 'wheel', 'key', 'gesture', 'api', 'cancelled', 'input']);
      const attempt = (n) => {
        const p0 = { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z };
        return c.buildingView(bm.buildingId, bm.view, { lens, pitch: bm.viewPitch, instant, bookmark: bm }).then((r) => {
          if (!current(r && r.interrupted)) return false;
          if (r && r.arrived) { this.events.emit('goto', { bookmark: bm, view: r.view || bm.view }); return true; }
          if (r && r.interrupted) {
            const why = r.interrupted, p = this.rig.position;
            const moved = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z) > 0.05;
            const busy = !!(c.transition || c.path || c._focusReq);
            if (USER.has(why)) { console.info(`[bookmark] ${bm.id}: the visitor took over the camera (${why})`); return false; }
            if (busy || (why === 'external' && moved)) { console.info(`[bookmark] ${bm.id}: another camera move took over (${why})`); return false; }
            if (n < 2) { console.info(`[bookmark] ${bm.id}: viewpoint '${bm.view}' interrupted (${why}), retrying`); return attempt(n + 1); }
            console.warn(`[bookmark] ${bm.id}: viewpoint '${bm.view}' interrupted ${n + 1}× (${why}), using the stored pose`);
            return fallback();
          }
          // (the controls already land on the stored pose when the anchors are missing — CT1 — so false means no
          // building data: repeating the lookup in resolveBuildingView would only wait on the same jobs again)
          console.info(`[bookmark] ${bm.id}: viewpoint '${bm.view}' of ${bm.buildingId} not resolved by the controls (no building data), using the stored pose`);
          return go(bm.pose);
        });
      };
      return attempt(0).catch((e) => { console.warn('[bookmark view]', e); return current() ? go(bm.pose) : false; });
    }
    return Promise.resolve(go(bm.pose));
  }

  /** Named megastructure view (waits up to ~15 s for the mega layout); null if unavailable. */
  async resolveMegaView(name) {
    for (let i = 0; i < 60; i++) {
      try { const v = this.systems.mega?.views?.(); if (v && v[name]) return v[name]; } catch (e) { /* layout not ready */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  /**
   * Pose from a building's own camera anchor (BuildingMeshData.anchors.cameras[view]) so shot
   * frames always track the generated asset. Returns null when the building/view is unavailable.
   */
  async resolveBuildingView(bm) {
    const spec = await this.workers.run('buildingSpec', { id: bm.buildingId }, { priority: -100 });
    if (!spec) return null;
    const data = await this.workers.run('building', { spec, lod: 'exterior' }, { priority: -100 });
    const cam = data && data.anchors && data.anchors.cameras && data.anchors.cameras[bm.view];
    if (!cam) return null;
    const O = latLonHToEcef(spec.lat, spec.lon, spec.ground.entrance);
    const A = buildingAxes(spec.lat, spec.lon, spec.heading);
    const toE = (p) => ({ x: O.x + A.x[0] * p[0] + A.y[0] * p[1] + A.z[0] * p[2], y: O.y + A.x[1] * p[0] + A.y[1] * p[1] + A.z[1] * p[2], z: O.z + A.x[2] * p[0] + A.y[2] * p[1] + A.z[2] * p[2] });
    const eye = toE(cam.pos), tgt = toE(cam.target);
    const g = ecefToLatLonH(eye.x, eye.y, eye.z);
    const B = enuBasis(g.lat, g.lon);
    const d = [tgt.x - eye.x, tgt.y - eye.y, tgt.z - eye.z]; const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const dot = (v) => (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / l;
    const heading = (Math.atan2(dot(B.east), dot(B.north)) * 180 / Math.PI + 360) % 360;
    const pitch = bm.viewPitch !== undefined ? bm.viewPitch : Math.asin(Math.max(-1, Math.min(1, dot(B.up)))) * 180 / Math.PI;
    return { lat: g.lat, lon: g.lon, alt: g.h, heading, pitch, lens: bm.viewLens || bm.pose?.lens || 28 };
  }

  applyUrlParams() {
    const q = new URLSearchParams(location.search);
    if (q.get('clean') === '1') this.state.set('clean', true);
    if (q.get('debug')) this.state.set('debugLayer', q.get('debug'));
    if (q.get('quality')) this.state.set('quality', q.get('quality'));
    if (q.get('bookmark')) this.applyBookmark(q.get('bookmark'));
    // default landing = shot card 01 (orbit, day side with the terminator) instead of the night hemisphere
    else if (!q.get('pose')) this.applyBookmark('S01');
    if (q.get('pose')) {
      const [lat, lon, alt, heading = 0, pitch = -90, lens] = q.get('pose').split(',').map(Number);
      this.rig.setPose({ lat, lon, alt, heading, pitch, lens: lens || undefined });
    }
    if (q.get('time')) this.state.setTime(parseFloat(q.get('time')));
    if (q.get('speed')) this.state.setTimeSpeed(parseFloat(q.get('speed')));
    if (q.get('mode')) this.controls.setMode?.(q.get('mode'));
    if (q.get('select')) this.selectBuilding?.(q.get('select'));
  }

  isIdle() {
    if (this.workers.pending > 0) return false;
    for (const s of Object.values(this.systems)) if (s.isIdle && !s.isIdle()) return false;
    return true;
  }

  exposeAutomation() {
    const app = this;
    window.__MARS__ = {
      app,
      ready: true,
      bookmarks: () => allBookmarks(),
      goto(target, opts) {
        if (typeof target === 'string' || target.pose) return app.applyBookmark(target, opts);
        app.rig.setPose(target); return Promise.resolve(true);
      },
      setTime(h) { app.state.setTime(h); },
      set(key, value) { app.state.set(key, value); },
      pose() { return app.rig.getPose(); },
      // opts.throttle = N: draw only every Nth frame while waiting (streaming keeps running every frame), so the
      // tile / building workers get the CPU the renderer would use: on a 10-core laptop a grazing basin view
      // converges ~2× sooner. Normal drawing resumes (with an instant exposure snap) before it resolves.
      async waitIdle(timeoutMs = 60000, settleFrames = 10, opts = {}) {
        const thr = Math.max(1, (opts && opts.throttle) | 0);
        app.renderEvery = thr;
        const t0 = performance.now(); let calm = 0;
        try {
          while (performance.now() - t0 < timeoutMs) {
            await new Promise((r) => requestAnimationFrame(r));
            // a lost WebGL context (GPU reset / TDR) freezes every system's idle state: fail instead of reporting
            // a blank or stale frame as converged
            if (app.pipeline.contextLost) throw new Error('WebGL context lost (GPU reset) while waiting for idle');
            // streaming finished: draw every frame again, so that exposure and accumulation (atmosphere.isIdle)
            // converge at the full frame rate
            if (app.renderEvery > 1 && app.workers.pending === 0 && Object.entries(app.systems).every(([k, s]) => k === 'atmosphere' || !s.isIdle || s.isIdle())) app.renderEvery = 1;
            calm = app.isIdle() ? calm + 1 : 0;
            if (calm >= settleFrames) return true;
          }
          return false;
        } finally {
          // timed out while still throttled: snap the exposure to the scene as it is now
          if (app.renderEvery > 1) app.pipeline.snapExposure?.(3);
          app.renderEvery = 1;
        }
      },
      async capture(opts = {}) {
        const blob = await app.pipeline.capture(opts);
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      },
      stats() {
        const info = app.renderer.info;
        const heap = (typeof performance !== 'undefined' && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
        return { fps: app.fps, frame: app.frameNo, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: (info.programs || []).length, heapMB: heap, workers: { ...app.workers.stats, pending: app.workers.pending, byType: app.workers.typeStats?.() }, city: app.systems?.city?.pool && app.systems.city.pool !== app.workers ? { ...app.systems.city.pool.stats, pending: app.systems.city.pool.pending, byType: app.systems.city.pool.typeStats?.() } : null, terrain: (() => { try { const t = app.systems.terrain, d = t.debugStats(); return { drawn: d.drawn, loading: d.loading, queued: d.queued, upgrading: t.upgrading ? t.upgrading.size : null, buildByTex: d.buildByTex }; } catch { return null; } })(), contextLost: !!app.pipeline.contextLost, idle: Object.fromEntries(Object.entries(app.systems || {}).filter(([, s]) => s && s.isIdle).map(([k, s]) => [k, !!s.isIdle()])) };
      },
    };
  }

  tick() {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    this.frameNo++;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const st = this.state;
    if (st.timeSpeed) st.setTime(st.solTime + st.timeSpeed * dt);

    this.controls.update?.({ dt, pre: true });

    // floating origin = camera
    const p = this.rig.position;
    setOrigin(p.x, p.y, p.z);
    this.camera.quaternion.copy(this.rig.quaternion);
    this.camera.position.set(0, 0, 0);
    const vfov = this.rig.vfov(this.camera.aspect);
    if (Math.abs(this.camera.fov - vfov) > 1e-6) { this.camera.fov = vfov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);

    const g = ecefToLatLonH(p.x, p.y, p.z);
    const B = enuBasis(g.lat, g.lon);
    const f = this.frame || (this.frame = {
      sunDir: new THREE.Vector3(), planetCenter: new THREE.Vector3(), camUp: new THREE.Vector3(),
      frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(), viewport: { width: 1, height: 1, pixelRatio: 1 },
    });
    f.app = this; f.dt = dt; f.time = this.timer.getElapsed(); f.frameNo = this.frameNo; f.fps = this.fps;
    f.solTime = st.solTime;
    sunDirection(st.solTime, st.subsolarLat, f.sunDir);
    f.camEcef = origin; f.camLat = g.lat; f.camLon = g.lon; f.camAlt = g.h;
    f.camAltGround = g.h - (this.systems.terrain.groundHeightCached?.() ?? 0);
    f.camUp.set(B.up[0], B.up[1], B.up[2]);
    f.planetCenter.set(-p.x, -p.y, -p.z);
    f.camera = this.camera;
    const size = this.renderer.getSize(new THREE.Vector2());
    f.viewport.width = size.x; f.viewport.height = size.y; f.viewport.pixelRatio = this.renderer.getPixelRatio();
    f.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    f.frustum.setFromProjectionMatrix(f.projScreen);
    f.rigVersion = this.rig.version;
    f.moving = f.rigVersion !== this._lastRigVersion; this._lastRigVersion = f.rigVersion;
    f.settings = st.settings;

    for (const [name, s] of Object.entries(this.systems)) {
      try { s.update(f); } catch (e) { if (!s._errored) { console.error(`[update ${name}]`, e); s._errored = true; } }
    }
    // automation (waitIdle throttle): while waiting for the final quality only every Nth frame is drawn; the
    // systems above still update (stream, upload) every frame and the worker pools get the renderer's CPU
    if (this.renderEvery > 1 && this.frameNo % this.renderEvery !== 0) return;
    this.pipeline.render(f);
  }
}
