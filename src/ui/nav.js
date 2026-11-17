// Camera navigation helpers used by the UI. Every call into app.controls is optional and falls
// back to a direct rig pose, so the UI keeps working while controls evolve. OWNER: ui agent.
import { R, DEG, RAD } from '../core/constants.js';
import { destination } from '../core/geo.js';
import { provinceAt, zoneAt, getControlMaps } from '../data/controlMaps.js';
import { buildingHeight, posesNear, roundPose } from './format.js';
import { nextFrames } from './dom.js';

/**
 * BuildingSpec regeneration by ID off the main thread: the app's worker pool ('buildingSpec' job,
 * workers/handlers/lookup.js — urban ids + the G02 work-town ids of render/city/towns.js, warm urban
 * caches, no extra worker), with a dedicated module worker as the fallback when the pool cannot answer
 * (benches, old pools); that worker runs the same handler, so both know the same ids (fix round 3).
 * A cold lookup warms the urban caches for many seconds; it must never run on the main thread.
 */
class SpecLookup {
  constructor() { this.worker = null; this.seq = 0; this.pending = new Map(); this.broken = false; this.cache = new Map(); this.inflight = new Map(); }

  /** spec by id: cache → one request per id at a time (pool first, own worker as fallback) */
  spec(id, pool = null, timeoutMs = 90000) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = (async () => {
      let spec = null, answered = false, timedOut = false;
      if (pool && typeof pool.submit === 'function') {
        let job = null, timer = 0;
        try {
          job = pool.submit('buildingSpec', { id }, { priority: -100 });
          spec = await Promise.race([job.promise, new Promise((res) => { timer = setTimeout(() => res(undefined), timeoutMs); })]);
          answered = spec !== undefined;
          if (!answered) { timedOut = true; try { job.cancel(); } catch { /* finished */ } }
        } catch { answered = false; } finally { clearTimeout(timer); }
      }
      // the own worker only when the pool cannot answer this job type (a busy pool that timed out would
      // only be loaded further by a second cold generator)
      if (!answered && !timedOut) spec = await this._workerSpec(id, timeoutMs);
      spec = spec || null;
      if (spec) { this.cache.set(id, spec); if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value); }
      return spec;
    })().finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  _ensure() {
    if (this.worker || this.broken) return !this.broken;
    try {
      this.worker = new Worker(new URL('./lookup.worker.js', import.meta.url), { type: 'module', name: 'ui-lookup' });
    } catch { this.broken = true; return false; }
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (ok) p.resolve(result); else p.resolve(null, error);
    };
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.broken = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(null); }
      this.pending.clear();
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    };
    let maps = null;
    try { maps = getControlMaps(); } catch { /* not loaded */ }
    if (!maps) { this.broken = true; this.worker.terminate(); this.worker = null; return false; }
    this._call('init', { maps }, 30000);
    return true;
  }

  _call(type, payload, timeoutMs) {
    return new Promise((resolve) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { if (this.pending.delete(id)) resolve(null); }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async _workerSpec(id, timeoutMs) {
    if (!this._ensure()) return null;
    return (await this._call('spec', { id }, timeoutMs)) || null;
  }

  get busy() { return this.pending.size > 0 || this.inflight.size > 0; }
}
export const specLookup = new SpecLookup();

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** viewpoints controls/modes/focus.buildingCameras synthesises from a spec before the kit anchors load */
const SPEC_EXTERIOR_VIEWS = new Set(['street', 'entrance', 'back', 'roof']);
/** full-frame lens (36 mm wide sensor) -> vertical fov in degrees (same formula as CameraRig) */
const lensToVFov = (mm, aspect) => 2 * Math.atan(18 / mm / Math.max(aspect, 1e-3)) * RAD;

export class Nav {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this._atView = null;
    // a building-view bookmark (S07…) reports its arrival with 'goto': the camera stands at that viewpoint
    this.app.events.on('goto', (e) => {
      const bm = e && e.bookmark;
      if (bm && bm.buildingId && bm.view) this.markView(bm.buildingId, bm.view);
    });
  }

  get controls() { return this.app.controls || null; }

  pose() { try { return this.app.rig.getPose(); } catch { return null; } }

  groundHeight(lat, lon) {
    try {
      const h = this.app.systems?.terrain?.heightAtLatLon?.(lat, lon);
      return Number.isFinite(h) ? h : 0;
    } catch { return 0; }
  }

  /** controls.flyTo with a direct-pose fallback. Always resolves. */
  flyTo(pose, opts = {}) {
    const c = this.controls;
    if (c && typeof c.flyTo === 'function') {
      try { return Promise.resolve(c.flyTo(pose, opts)).catch(() => {}); } catch { /* fall through */ }
    }
    try { this.app.rig.setPose(pose); } catch { /* ignore */ }
    return Promise.resolve();
  }

  /** altitude that frames the whole disk at ~80 % of the shorter frame axis */
  orbitAltitude(lens = 50, fill = 0.8) {
    const aspect = this.app.camera?.aspect || 16 / 9;
    const vfov = lensToVFov(lens, aspect) * DEG;
    const hfov = 2 * Math.atan(18 / lens);
    const ang = (fill * Math.min(vfov, hfov)) / 2;
    return R / Math.sin(ang) - R;
  }

  /** pose looking at a target point from `range` metres away at `elevDeg` above the horizon */
  lookAtPose(lat, lon, targetH, { range = 3000, elevDeg = 35, heading = 0, lens = 35 } = {}) {
    const d = range * Math.cos(elevDeg * DEG), z = range * Math.sin(elevDeg * DEG);
    const p = destination(lat, lon, heading + 180, d);
    const drop = (d * d) / (2 * R); // curvature: the target sits below the camera's local horizon
    return { lat: p.lat, lon: p.lon, alt: targetH + z, heading: ((heading % 360) + 360) % 360, pitch: -Math.atan2(z + drop, d) * RAD, roll: 0, lens };
  }

  /** current heading when the camera is low, north otherwise */
  _keepHeading() {
    const p = this.pose();
    if (!p || p.alt > 2.5e5 || p.pitch < -85) return 0;
    return p.heading;
  }

  /** "飞往此处": 3 km above the ground, oblique, centred on the point */
  flyToLocation(lat, lon, h, { height = 3000, elevDeg = 40, lens = 35 } = {}) {
    const g = Number.isFinite(h) ? h : this.groundHeight(lat, lon);
    const range = height / Math.sin(elevDeg * DEG);
    return this.flyTo(this.lookAtPose(lat, lon, g, { range, elevDeg, heading: this._keepHeading(), lens }));
  }

  /** top-down regional view */
  regionView(lat, lon, alt = 6.0e5) {
    return this.flyTo({ lat, lon, alt, heading: 0, pitch: -90, roll: 0, lens: 50 });
  }

  /** "回到轨道": the whole planet, centred on the same lat/lon */
  orbitAbove(lat, lon) {
    const lens = 50;
    return this.flyTo({ lat, lon, alt: this.orbitAltitude(lens), heading: 0, pitch: -90, roll: 0, lens });
  }

  // --- buildings ------------------------------------------------------------------------
  buildingTopEcefHeight(spec) {
    const g = spec?.ground?.entrance ?? spec?.ground?.min ?? 0;
    return g + (buildingHeight(spec) || 10);
  }

  /** three-quarter view of the front facade */
  buildingViewPose(spec) {
    const H = buildingHeight(spec) || 12;
    const w = spec.footprint?.w || 20, d = spec.footprint?.d || 15;
    const size = Math.max(H, w, d);
    const range = clamp(2.8 * size, 70, 1800);
    const g = spec.ground?.entrance ?? spec.ground?.min ?? this.groundHeight(spec.lat, spec.lon);
    const heading = ((spec.heading ?? 0) + 180 + 28) % 360;
    return this.lookAtPose(spec.lat, spec.lon, g + H * 0.42, { range, elevDeg: 20, heading, lens: 35 });
  }

  /** street-level pose in front of the main entrance */
  entrancePose(spec) {
    const d = spec.footprint?.d || 15;
    const head = spec.heading ?? 0;
    const p = destination(spec.lat, spec.lon, head, d / 2 + 7);
    const g = spec.ground?.entrance ?? this.groundHeight(spec.lat, spec.lon);
    return { lat: p.lat, lon: p.lon, alt: g + 1.65, heading: (head + 180) % 360, pitch: 4, roll: 0, lens: 28 };
  }

  /**
   * Try a controls method. A returned Promise means the controls own the move (it may load the
   * building first) unless it resolves to false; otherwise, if nothing moved after a few frames
   * (e.g. a not-yet-implemented stub), run the fallback.
   */
  async _tryControl(name, args, fallback) {
    const c = this.controls;
    const app = this.app;
    if (c && typeof c[name] === 'function') {
      const v0 = app.rig.version, m0 = app.state.mode;
      let res, threw = false;
      try { res = c[name](...args); } catch { threw = true; }
      if (!threw && res && typeof res.then === 'function') {
        const v = await Promise.resolve(res).catch(() => false);
        if (v !== false) return true;
      } else if (!threw) {
        if (res === true) return true;
        await nextFrames(4);
        if (app.rig.version !== v0 || app.state.mode !== m0) return true;
      }
    }
    await fallback();
    return false;
  }

  focusBuilding(spec) {
    if (!spec) return Promise.resolve(false);
    return this._tryControl('focusBuilding', [spec.id, { spec }], () => this.flyTo(this.buildingViewPose(spec)));
  }

  enterBuilding(spec) {
    if (!spec) return Promise.resolve(false);
    return this._tryControl('enterBuilding', [spec.id, { spec }], async () => {
      await this.flyTo(this.entrancePose(spec));
      try { this.controls?.setMode ? this.controls.setMode('walk', { buildingId: spec.id }) : this.app.state.setMode('walk'); } catch { /* ignore */ }
    });
  }

  setMode(mode) {
    const app = this.app, c = this.controls;
    const sel = app.state.selection;
    const bid = selectionBuildingId(sel);
    if (mode === 'focus' && bid) {
      const spec = sel.spec;
      if (spec) return this.focusBuilding(spec);
      if (c?.focusBuilding) { try { c.focusBuilding(bid); } catch { /* ignore */ } return Promise.resolve(true); }
    }
    try {
      if (c && typeof c.setMode === 'function') c.setMode(mode, bid ? { buildingId: bid } : {});
      else app.state.setMode(mode);
    } catch { try { app.state.setMode(mode); } catch { /* ignore */ } }
    return Promise.resolve(true);
  }

  back() {
    const c = this.controls;
    try { if (c && typeof c.back === 'function') { c.back(); return true; } } catch { /* ignore */ }
    return false;
  }

  canGoBack() {
    const c = this.controls;
    if (!c) return false;
    try {
      if (typeof c.canGoBack === 'function') return !!c.canGoBack();
      if (typeof c.canGoBack === 'boolean') return c.canGoBack;
      if (Array.isArray(c.backStack)) return c.backStack.length > 0;
    } catch { /* ignore */ }
    return typeof c.back === 'function';
  }

  // --- lookup / selection ----------------------------------------------------------------
  async lookupBuilding(id) {
    if (!id) return null;
    const app = this.app;
    try {
      const b = app.systems?.city?.getBuilding?.(id);
      const spec = b?.spec || (b && b.id === id && b.lat != null ? b : null);
      if (spec) return spec;
    } catch { /* ignore */ }
    const known = this.ui.buildingIndex?.get(id);
    if (known) return known;
    return specLookup.spec(String(id), this.app.workers);
  }

  // --- building viewpoints (§5 07) --------------------------------------------------------
  /**
   * Viewpoint names the controls know for building `id` right now, or null while they are not known:
   * no focus data yet, or only the exterior views the controls synthesise from the spec (street /
   * entrance / back / roof) because the building's own anchors (rooms, stairs) have not loaded — the
   * panel then offers the standard set and controls.buildingView loads the anchors on demand.
   */
  buildingViewNames(id) {
    const c = this.controls;
    if (id == null || !c || typeof c.buildingViews !== 'function') return null;
    let v = null;
    try { v = c.buildingViews(id); } catch { return null; }
    if (!Array.isArray(v) || !v.length) return null;
    if (v.every((n) => SPEC_EXTERIOR_VIEWS.has(n))) return null;
    return v.map(String);
  }

  /**
   * Fly to one of the building's own eye-level viewpoints (street / entrance / lobby / stair / living /
   * back / roof / extras) through controls.buildingView: walk mode where a floor carries the eye.
   * `extra` = further controls.buildingView options (e.g. {instant: true, pushBack: false}).
   * Resolves {arrived, view (the view actually used after the controls' fallbacks), mode, requested:
   * {lat, lon, alt}, …} | {arrived:false, interrupted} | false (the building has no such view / is unknown).
   */
  async buildingView(spec, name, extra = {}) {
    const id = spec?.id;
    if (id == null) return false;
    const c = this.controls;
    if (c && typeof c.buildingView === 'function') {
      // the spec only helps while the controls have no focus data for this building yet
      const opts = this.buildingViewNames(id) ? {} : { spec };
      try { return await c.buildingView(id, name, { ...opts, ...extra }); } catch (e) { console.warn('[ui] buildingView failed', e); return false; }
    }
    // controls without building views: street-level stand-ins from the spec
    if (name === 'street' || name === 'back') { await this.flyTo(this.buildingViewPose(spec)); return { arrived: true, view: 'street' }; }
    if (name === 'roof') return false;
    await this.flyTo(this.entrancePose(spec));
    return { arrived: true, view: 'entrance' };
  }

  /**
   * Record where a buildingView arrival `r` actually put the eye (fix round 3, UI3 / QP-02): position =
   * the controls' resolved request `r.requested` {lat, lon, alt} (the held eye, never a temporary lift),
   * heading / pitch / lens = the rig right after the arrival, mode = the mode the controls entered
   * ('walk' where a floor carries the eye). Kept per building + view (the view used and the one asked
   * for) so "存视点" can store it instead of a generic stand-in. Call it right after the arrival (before
   * the next frame). Returns the record {id, view, asked, pose, mode, source, adjusted, t} or null.
   */
  recordView(id, asked, r) {
    if (id == null || !r || !r.arrived) return null;
    const p = this.pose();
    if (!p) return null;
    const q = r.requested;
    const pose = q && Number.isFinite(q.lat) && Number.isFinite(q.lon) && Number.isFinite(q.alt) ? { ...p, lat: q.lat, lon: q.lon, alt: q.alt } : p;
    let mode = r.mode;
    if (!mode) { try { mode = this.app.state.mode; } catch { mode = 'orbit'; } }
    const view = String(r.view || asked);
    const rec = { id: String(id), view, asked: String(asked || view), pose: roundPose(pose), mode, source: r.source || null, adjusted: !!r.adjusted, t: performance.now() };
    const M = this._resolved || (this._resolved = new Map());
    M.set(`${rec.id}|${view}`, rec);
    if (rec.asked !== view) M.set(`${rec.id}|${rec.asked}`, rec);
    while (M.size > 96) M.delete(M.keys().next().value);
    return rec;
  }

  /** the record of a recent arrival at viewpoint `name` (asked or used) of building `id`, or null */
  resolvedView(id, name, maxAgeMs = 10 * 60 * 1000) {
    const rec = this._resolved && this._resolved.get(`${String(id)}|${String(name)}`);
    return rec && performance.now() - rec.t <= maxAgeMs ? rec : null;
  }

  /**
   * remember that the camera now stands at viewpoint `view` of building `id` (until it moves away);
   * `asked` = the view that was requested when the controls fell back to another one
   */
  markView(id, view, asked = view) {
    const p = this.pose();
    this._atView = p && id != null && view ? { id: String(id), view: String(view), asked: String(asked || view), pose: p } : null;
  }

  /** where the camera is now, for restore(): {pose, mode, focusId, at (currentView)} */
  snapshot() {
    let focusId = null;
    try { if (this.app.state.mode === 'focus') focusId = this.controls?.modes?.focus?.id ?? null; } catch { /* ignore */ }
    return { pose: this.pose(), mode: this.app.state.mode, focusId, at: this.currentView() };
  }

  /**
   * Jump back to a snapshot (no flight, no back-stack entry): same pose and camera mode (walk: held
   * where it stood; focus: orbiting the same building from that pose), and the viewpoint mark it had.
   */
  async restore(snap) {
    if (!snap || !snap.pose) return false;
    const c = this.controls, app = this.app;
    const mode = snap.mode === 'focus' && snap.focusId == null ? 'orbit' : (snap.mode || 'orbit');
    let ok = false;
    if (c && typeof c.flyTo === 'function') {
      const modeOpts = mode === 'focus' ? { id: snap.focusId } : mode === 'walk' ? { trustFloor: true } : {};
      try {
        const r = await c.flyTo({ ...snap.pose }, { duration: 0, pushBack: false, mode, modeOpts, holdWalk: mode === 'walk' });
        ok = !!(r && r.arrived);
      } catch { ok = false; }
    } else {
      try { app.rig.setPose(snap.pose); app.state.setMode?.(mode); ok = true; } catch { ok = false; }
    }
    if (ok && snap.at) this.markView(snap.at.id, snap.at.view, snap.at.asked);
    return ok;
  }

  /** {id, view, pose} while the camera is still at the building viewpoint it arrived at, else null */
  currentView() {
    const a = this._atView;
    if (!a) return null;
    if (!posesNear(this.pose(), a.pose)) { this._atView = null; return null; }
    return a;
  }

  selectLocation(lat, lon, h) {
    const st = this.app.state;
    let province = 0, zone = 'Z';
    try { province = provinceAt(lat, lon); zone = zoneAt(lat, lon); } catch { /* maps missing */ }
    st.select({ type: 'location', lat, lon, h: Number.isFinite(h) ? h : this.groundHeight(lat, lon), province, zone });
  }

  async selectBuildingById(id, { fly = true } = {}) {
    const spec = await this.lookupBuilding(id);
    if (!spec) return null;
    this.app.state.select({ type: 'building', id: spec.id || id, spec });
    if (fly) await this.revisitBuilding(spec);
    return spec;
  }

  /** Revisit by ID: a user bookmark that stores this building wins, otherwise focus on it. */
  async revisitBuilding(spec) {
    const bm = this.ui.userBookmarks?.forBuilding(spec.id);
    if (bm) { this.gotoBookmark(bm, { select: false }); return; }
    await this.focusBuilding(spec);
  }

  /** Apply any bookmark (shot, turntable, user), selecting its building when it has one. */
  gotoBookmark(bm, { instant = false, select = true } = {}) {
    if (!bm) return false;
    const app = this.app;
    let ok = false;
    try {
      if (typeof app.applyBookmark === 'function') ok = app.applyBookmark(bm, { instant });
      else {
        if (bm.solTime !== undefined) app.state.setTime(bm.solTime);
        this.flyTo(bm.pose);
        ok = true;
      }
    } catch (e) {
      console.warn('[ui] bookmark failed', e);
      ok = false;
    }
    if (ok && select && bm.buildingId) {
      this.lookupBuilding(bm.buildingId).then((spec) => {
        if (spec) app.state.select({ type: 'building', id: spec.id || bm.buildingId, spec });
      });
    }
    return ok;
  }
}

export function selectionBuildingId(sel) {
  if (!sel) return null;
  if (sel.type === 'building') return sel.id ?? sel.buildingId ?? sel.spec?.id ?? null;
  if (!sel.type && sel.buildingId) return sel.buildingId;
  return null;
}
