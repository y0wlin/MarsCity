// Terrain dev bench (dev/terrain.html). Runs the TerrainSystem alone with a minimal app shell,
// its own worker pool (render/terrain/benchWorker.js) and a stand-in sun, so terrain work can be
// verified while other modules are mid-rewrite. OWNER: terrain-render agent.
//
// URL: /dev/terrain.html?pose=lat,lon,alt,heading,pitch[,lens]&time=9&debug=lod&clean=1&sub=12
//      &pipe=1   real Pipeline + AtmosphereSystem (+ CloudSystem unless clouds=0, + WaterSystem when
//                water=1) around the terrain: true photometry / exposure / night lights, independent of
//                the city / props / controls / UI modules (&local=<h> sets the local solar time)
// Automation: window.__MARS__ = {ready, waitIdle, stats, set, setTime, goto, pose, app}
import * as THREE from 'three';
import { R, DEG, RAD } from '../core/constants.js';
import { setOrigin, origin } from '../core/origin.js';
import { latLonHToEcef, ecefToLatLonH, enuBasis } from '../core/geo.js';
import { loadControlMaps } from '../data/controlMaps.js';
import { sunDirection } from '../app/sun.js';
import { TerrainSystem } from '../render/terrain/index.js';

// ------------------------------------------------------------------ tiny worker pool (same API)
let NEXT = 1;
class BenchPool {
  constructor(size) { this.size = size; this.workers = []; this.idle = []; this.queue = []; this.running = new Map(); this.stats = { submitted: 0, completed: 0, cancelled: 0, failed: 0 }; }
  init(payload) {
    const rs = [];
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('../render/terrain/benchWorker.js', import.meta.url), { type: 'module', name: `terrain-${i}` });
      w.onmessage = (e) => this._msg(w, e.data); w.onerror = (e) => console.error('[bench worker]', e.message || e);
      rs.push(new Promise((r) => { w._ready = r; }));
      w.postMessage({ id: 0, type: '__init', payload });
      this.workers.push(w);
    }
    this.ready = Promise.all(rs).then(() => { this.idle.push(...this.workers); this._pump(); });
    return this.ready;
  }
  submit(type, payload, { priority = 0, transfer = [] } = {}) {
    const job = { id: NEXT++, type, payload, transfer, priority, cancelled: false, started: false };
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.cancel = () => {
      if (job.cancelled) return; job.cancelled = true; this.stats.cancelled++;
      if (!job.started) { const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1); }
      job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    };
    this.queue.push(job); this.stats.submitted++; this._pump();
    return job;
  }
  get pending() { return this.queue.length + this.running.size; }
  _pump() {
    if (!this.idle.length || !this.queue.length) return;
    this.queue.sort((a, b) => (a.priority - b.priority) || (a.id - b.id));
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift(); if (job.cancelled) continue;
      const w = this.idle.pop(); job.started = true; this.running.set(job.id, job);
      w.postMessage({ id: job.id, type: job.type, payload: job.payload }, job.transfer);
    }
  }
  _msg(w, m) {
    if (m.type === '__ready') { w._ready(); return; }
    const job = this.running.get(m.id); this.running.delete(m.id); this.idle.push(w);
    if (job && !job.cancelled) { if (m.ok) { this.stats.completed++; job.resolve(m.result); } else { this.stats.failed++; console.error('[bench job failed]', m.error); job.reject(new Error(m.error)); } }
    this._pump();
  }
}

// ------------------------------------------------------------------ tiny camera rig
class Rig {
  constructor() { this.position = { x: 0, y: 0, z: R * 4 }; this.quaternion = new THREE.Quaternion(); this.lens = 50; this.fov = 35; this.version = 0; }
  setPose({ lat, lon, alt, heading = 0, pitch = -90, roll = 0, lens }) {
    const p = latLonHToEcef(lat, lon, alt); this.position = { x: p.x, y: p.y, z: p.z };
    const B = enuBasis(lat, lon);
    const E = new THREE.Vector3(...B.east), N = new THREE.Vector3(...B.north), U = new THREE.Vector3(...B.up);
    const h = heading * DEG, pt = pitch * DEG;
    const horiz = N.clone().multiplyScalar(Math.cos(h)).add(E.clone().multiplyScalar(Math.sin(h)));
    const f = horiz.clone().multiplyScalar(Math.cos(pt)).addScaledVector(U, Math.sin(pt)).normalize();
    const u = horiz.clone().multiplyScalar(-Math.sin(pt)).addScaledVector(U, Math.cos(pt)).normalize();
    if (roll) u.applyAxisAngle(f, -roll * DEG);
    const r = new THREE.Vector3().crossVectors(f, u).normalize();
    this.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
    if (lens) this.lens = lens;
    this.version++;
  }
  vfov(aspect) { const hf = 2 * Math.atan(18 / this.lens); return 2 * Math.atan(Math.tan(hf / 2) / Math.max(aspect, 1e-3)) * RAD; }
  getPose() { const g = ecefToLatLonH(this.position.x, this.position.y, this.position.z); return { lat: g.lat, lon: g.lon, alt: g.h, lens: this.lens }; }
}

class Events { constructor() { this.m = new Map(); } on(n, f) { (this.m.get(n) || this.m.set(n, new Set()).get(n)).add(f); return () => this.m.get(n).delete(f); } emit(n, p) { const s = this.m.get(n); if (s) for (const f of [...s]) f(p); } }

// ------------------------------------------------------------------ bench app
const q = new URLSearchParams(location.search);
const container = document.getElementById('app');
const hud = document.getElementById('hud');

async function main() {
  if (q.get('pipe') === '1') return mainPipe();
  const maps = await loadControlMaps('/');
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = +(q.get('exposure') || 1.0);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2e8);
  const events = new Events();
  const settings = { debugLayer: q.get('debug') || 'none', clean: q.get('clean') === '1' };
  const state = { settings, solTime: +(q.get('time') || 9), subsolarLat: +(q.get('sub') || 12), set(k, v) { settings[k] = v; events.emit('settings', { key: k, value: v }); } };
  const sun = new THREE.DirectionalLight(0xfff1e0, 3.2); scene.add(sun, sun.target);
  const amb = new THREE.HemisphereLight(0x6f86a8, 0x3a2418, 0.22); scene.add(amb);
  const lighting = { uniforms: {}, patch(m) { return m; }, update() {} };
  const workers = new BenchPool(Math.max(2, (navigator.hardwareConcurrency || 8) - 2));
  workers.init({ maps });
  await workers.ready;
  const rig = new Rig();
  const pose = (q.get('pose') || '15,100,9.5e6,0,-90,50').split(',').map(Number);
  rig.setPose({ lat: pose[0], lon: pose[1], alt: pose[2], heading: pose[3] || 0, pitch: pose[4] ?? -90, lens: pose[5] || 50 });
  const app = { renderer, scene, camera, events, state, workers, lighting, rig, systems: {} };
  const terrain = new TerrainSystem(app);
  app.systems.terrain = terrain;
  await terrain.init();

  const timer = new THREE.Timer();
  let frameNo = 0, fps = 60, lastRig = -1;
  const frame = { sunDir: new THREE.Vector3(), planetCenter: new THREE.Vector3(), camUp: new THREE.Vector3(), frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(), viewport: { width: 1, height: 1, pixelRatio: 1 } };
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  function tick() {
    timer.update();
    const dt = Math.min(0.1, timer.getDelta()); frameNo++; fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const p = rig.position; setOrigin(p.x, p.y, p.z);
    camera.quaternion.copy(rig.quaternion); camera.position.set(0, 0, 0);
    const vf = rig.vfov(camera.aspect); if (Math.abs(camera.fov - vf) > 1e-6) { camera.fov = vf; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    const g = ecefToLatLonH(p.x, p.y, p.z);
    sunDirection(state.solTime, state.subsolarLat, frame.sunDir);
    frame.dt = dt; frame.time = timer.getElapsed(); frame.frameNo = frameNo; frame.fps = fps; frame.solTime = state.solTime;
    frame.camEcef = origin; frame.camLat = g.lat; frame.camLon = g.lon; frame.camAlt = g.h;
    frame.camAltGround = g.h - terrain.groundHeightCached();
    frame.planetCenter.set(-p.x, -p.y, -p.z); frame.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    frame.viewport.width = size.x; frame.viewport.height = size.y; frame.viewport.pixelRatio = renderer.getPixelRatio();
    frame.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frame.frustum.setFromProjectionMatrix(frame.projScreen);
    frame.moving = rig.version !== lastRig; lastRig = rig.version; frame.settings = settings;
    sun.position.copy(frame.sunDir).multiplyScalar(1000); sun.target.position.set(0, 0, 0);
    terrain.update(frame);
    renderer.render(scene, camera);
    if (!settings.clean && (frameNo & 7) === 0) {
      const s = terrain.debugStats();
      hud.style.display = '';
      hud.textContent = `lat ${g.lat.toFixed(4)} lon ${g.lon.toFixed(4)} alt ${g.h.toFixed(1)} m  agl ${frame.camAltGround.toFixed(1)} m  fps ${fps.toFixed(0)}\n` +
        `drawn ${s.drawn} ready ${s.ready} loading ${s.loading} queued ${s.queued} gpu ${s.gpuMB} MB  tris ${(s.tris / 1e6).toFixed(2)} M\n` +
        `built ${s.built} avg ${s.avgBuildMs} ms max ${Math.round(s.maxBuildMs)} ms  upg ${s.upgrades} evict ${s.evicted} cancel ${s.cancelled}\n` +
        `levels ${JSON.stringify(s.levels)}  idle ${terrain.isIdle()}  pool ${workers.pending}`;
    } else if (settings.clean) hud.style.display = 'none';
  }
  renderer.setAnimationLoop(tick);

  // --- minimal mouse controls: drag = rotate around planet centre, wheel = zoom towards cursor
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    const p = rig.position; const alt = Math.max(1, Math.hypot(p.x, p.y, p.z) - R - terrain.groundHeightCached());
    const k = (camera.fov * DEG / window.innerHeight) * Math.min(1, alt / R);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.quaternion);
    for (const [ax, ang] of [[up, -dx * k], [right, -dy * k]]) {
      const qq = new THREE.Quaternion().setFromAxisAngle(ax, ang);
      const v = new THREE.Vector3(p.x, p.y, p.z).applyQuaternion(qq); rig.position = { x: v.x, y: v.y, z: v.z }; rig.quaternion.premultiply(qq);
    }
    rig.version++;
  });
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const hit = terrain.raycast(ray.ray.origin, ray.ray.direction);
    const kk = 1 - Math.pow(0.86, -e.deltaY / 100);
    const p = rig.position, d = ray.ray.direction;
    let t = hit ? hit.distance * kk : (Math.hypot(p.x, p.y, p.z) - R) * kk;
    if (hit && kk > 0) t = Math.min(t, hit.distance - 1);
    rig.position = { x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t }; rig.version++;
  }, { passive: false });

  window.__MARS__ = {
    app, ready: true,
    async waitIdle(timeoutMs = 60000, settleFrames = 10) {
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < timeoutMs) {
        await new Promise((r) => requestAnimationFrame(r));
        calm = (workers.pending === 0 && terrain.isIdle()) ? calm + 1 : 0;
        if (calm >= settleFrames) return true;
      }
      return false;
    },
    stats() { const i = renderer.info; return { fps, frame: frameNo, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, terrain: terrain.debugStats(), workers: { ...workers.stats, pending: workers.pending } }; },
    set: (k, v) => state.set(k, v),
    setTime: (h) => { state.solTime = h; },
    goto: (p) => rig.setPose(p),
    pose: () => rig.getPose(),
    raycastCenter() { const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), camera); return terrain.raycast(ray.ray.origin, ray.ray.direction); },
  };
}

// ------------------------------------------------------------------ full-pipeline bench (?pipe=1)
async function mainPipe() {
  const [{ Pipeline }, { AtmosphereSystem }, { EventBus }, { AppState }, { CameraRig }, { solTimeForLocal }] = await Promise.all([
    import('../render/pipeline.js'), import('../render/atmosphere/index.js'), import('../app/events.js'),
    import('../app/state.js'), import('../controls/CameraRig.js'), import('../app/sun.js'),
  ]);
  const maps = await loadControlMaps('/');
  const app = {
    container, events: new EventBus(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(35, 1, 0.05, 2.0e8),
    timer: new THREE.Timer(), frameNo: 0, fps: 60, frame: null, systems: {},
  };
  app.state = new AppState(app.events);
  app.rig = new CameraRig();
  app.timer.connect?.(document);
  app.workers = new BenchPool(Math.max(2, (navigator.hardwareConcurrency || 8) - 2));
  app.workers.init({ maps });
  app.pipeline = new Pipeline(app, container);
  app.renderer = app.pipeline.renderer;
  app.systems.atmosphere = new AtmosphereSystem(app);
  if (q.get('clouds') !== '0') { try { const { CloudSystem } = await import('../render/clouds/index.js'); app.systems.clouds = new CloudSystem(app); } catch (e) { console.warn('[bench] clouds unavailable', e); } }
  const terrain = new TerrainSystem(app);
  app.systems.terrain = terrain;
  if (q.get('water') === '1') { try { const { WaterSystem } = await import('../render/water/index.js'); app.systems.water = new WaterSystem(app); } catch (e) { console.warn('[bench] water unavailable', e); } }
  await app.workers.ready;
  for (const [name, s] of Object.entries(app.systems)) { try { await s.init?.(); } catch (e) { console.error(`[init ${name}]`, e); } }
  const resize = () => { const w = innerWidth, h = innerHeight; app.pipeline.setSize(w, h); app.camera.aspect = w / h; app.camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  if (q.get('clean') === '1') app.state.set('clean', true);
  if (q.get('debug')) app.state.set('debugLayer', q.get('debug'));
  if (q.get('clouds') === '0') app.state.set('clouds', false);
  const pose = (q.get('pose') || '10,95,1.8e7,0,-90,50').split(',').map(Number);
  app.rig.setPose({ lat: pose[0], lon: pose[1], alt: pose[2], heading: pose[3] || 0, pitch: pose[4] ?? -90, lens: pose[5] || undefined });
  if (q.get('sub')) app.state.subsolarLat = +q.get('sub');
  if (q.get('time')) app.state.setTime(+q.get('time'));
  if (q.get('local')) app.state.setTime(solTimeForLocal(pose[1], +q.get('local')));
  app.isIdle = () => { if (app.workers.pending > 0) return false; for (const s of Object.values(app.systems)) if (s.isIdle && !s.isIdle()) return false; return true; };
  const frame = { sunDir: new THREE.Vector3(), planetCenter: new THREE.Vector3(), camUp: new THREE.Vector3(), frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(), viewport: { width: 1, height: 1, pixelRatio: 1 } };
  app.frame = frame;
  let lastRig = -1;
  const tick = () => {
    app.timer.update();
    const dt = Math.min(0.1, app.timer.getDelta()); app.frameNo++; app.fps = app.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const st = app.state, p = app.rig.position;
    setOrigin(p.x, p.y, p.z);
    app.camera.quaternion.copy(app.rig.quaternion); app.camera.position.set(0, 0, 0);
    const vf = app.rig.vfov(app.camera.aspect); if (Math.abs(app.camera.fov - vf) > 1e-6) { app.camera.fov = vf; app.camera.updateProjectionMatrix(); }
    app.camera.updateMatrixWorld(true);
    const g = ecefToLatLonH(p.x, p.y, p.z), B = enuBasis(g.lat, g.lon);
    frame.app = app; frame.dt = dt; frame.time = app.timer.getElapsed(); frame.frameNo = app.frameNo; frame.fps = app.fps; frame.solTime = st.solTime;
    sunDirection(st.solTime, st.subsolarLat, frame.sunDir);
    frame.camEcef = origin; frame.camLat = g.lat; frame.camLon = g.lon; frame.camAlt = g.h; frame.camAltGround = g.h - terrain.groundHeightCached();
    frame.camUp.set(B.up[0], B.up[1], B.up[2]); frame.planetCenter.set(-p.x, -p.y, -p.z); frame.camera = app.camera;
    const size = app.renderer.getSize(new THREE.Vector2());
    frame.viewport.width = size.x; frame.viewport.height = size.y; frame.viewport.pixelRatio = app.renderer.getPixelRatio();
    frame.projScreen.multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse); frame.frustum.setFromProjectionMatrix(frame.projScreen);
    frame.rigVersion = app.rig.version; frame.moving = frame.rigVersion !== lastRig; lastRig = frame.rigVersion; frame.settings = st.settings;
    for (const [name, s] of Object.entries(app.systems)) { try { s.update?.(frame); } catch (e) { if (!s._errored) { console.error(`[update ${name}]`, e); s._errored = true; } } }
    app.pipeline.render(frame);
    if (!st.settings.clean && (app.frameNo & 7) === 0) {
      const s = terrain.debugStats();
      hud.textContent = `lat ${g.lat.toFixed(4)} lon ${g.lon.toFixed(4)} alt ${g.h.toFixed(1)} m  agl ${frame.camAltGround.toFixed(1)} m  sol ${st.solTime.toFixed(2)}  exp ${app.pipeline.exposure?.value?.toFixed?.(3)}\n` +
        `drawn ${s.drawn} ready ${s.ready} loading ${s.loading} gpu ${s.gpuMB} MB  built ${s.built} upg ${s.upgrades}  levels ${JSON.stringify(s.levels)}  idle ${terrain.isIdle()}`;
    } else if (st.settings.clean) hud.style.display = 'none';
  };
  app.renderer.setAnimationLoop(tick);
  window.__MARS__ = {
    app, ready: true,
    async waitIdle(timeoutMs = 60000, settleFrames = 10) {
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < timeoutMs) { await new Promise((r) => requestAnimationFrame(r)); calm = app.isIdle() ? calm + 1 : 0; if (calm >= settleFrames) return true; }
      return false;
    },
    stats() { const i = app.renderer.info; return { fps: app.fps, frame: app.frameNo, calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, exposure: app.pipeline.exposure?.value, terrain: terrain.debugStats(), workers: { ...app.workers.stats, pending: app.workers.pending } }; },
    set: (k, v) => app.state.set(k, v),
    setTime: (h) => app.state.setTime(h),
    goto: (p) => app.rig.setPose(p),
    pose: () => app.rig.getPose(),
    async capture(opts = {}) { const blob = await app.pipeline.capture(opts); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); },
  };
}

main().catch((e) => { console.error(e); hud.textContent = 'bench failed: ' + (e.stack || e); });
