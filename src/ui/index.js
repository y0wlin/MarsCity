// UI system: HUD, time bar, mode switcher, drawer (书签/搜索/图层/设置/帮助), selection panel,
// labels, loading status, diagnostics, keyboard, clean plate and capture. Chinese interface.
// OWNER: ui agent. See ARCHITECTURE.md §8 (ui) and prompt §1/§4/§5/§6.
//
// Contract with the rest of the app (all optional, tolerated when missing):
//   app.state (settings / selection / solTime / mode) + app.events ('select','settings','mode','time','goto','city:tile')
//   app.controls.{flyTo, back, setMode, focusBuilding, enterBuilding}, app.pipeline.capture({scale})
//   app.systems.terrain.heightAtLatLon, app.systems.city.getBuilding, world/urban.buildingSpecById
// Provides: app.selectBuilding(id, {fly}) (used by ?select=<id>), window.__MARS__.ui helpers.
import { h, downloadBlob, nextFrames, isTypingTarget } from './dom.js';
import { loadPrefs, savePrefs, UserBookmarks } from './store.js';
import { Nav } from './nav.js';
import { Toasts } from './toast.js';
import { Hud } from './hud.js';
import { TimeBar } from './timebar.js';
import { ModeBar } from './modebar.js';
import { Toolbar } from './toolbar.js';
import { Drawer } from './drawer.js';
import { SelectionPanel } from './selection.js';
import { Labels } from './labels.js';
import { Diagnostics } from './diagnostics.js';
import { Keyboard } from './keyboard.js';
import { BuildingIndex } from './buildingIndex.js';
import { captureFileName, posesClose } from './format.js';
import { findBookmark } from '../app/bookmarks.js';

const NARROW = '(max-width: 720px)';

export class UISystem {
  constructor(app) {
    this.app = app;
    this.prefs = loadPrefs();
    this._capturing = false;
    this._cleanApplied = null;
    this._boot = true;
    this._lastBookmark = null;
  }

  savePrefs() { savePrefs(this.prefs); }

  isNarrow() { try { return window.matchMedia(NARROW).matches; } catch { return false; } }

  async init() {
    const app = this.app;
    // a clean start must never flash the interface
    let urlClean = false;
    try { urlClean = new URLSearchParams(location.search).get('clean') === '1'; } catch { /* ignore */ }
    if (urlClean || app.state.settings.clean) document.documentElement.classList.add('mars-clean');

    document.getElementById('hud-stub')?.remove();
    this.root = h('div', { id: 'mars-ui', class: 'mui-root mui-boot', lang: 'zh-CN' });

    this.userBookmarks = new UserBookmarks();
    this.buildingIndex = new BuildingIndex(this);
    this.nav = new Nav(this);
    this.toast = new Toasts();
    this.hud = new Hud(this);
    this.toolbar = new Toolbar(this);
    this.selection = new SelectionPanel(this);
    this.diag = new Diagnostics(this);
    this.drawer = new Drawer(this);
    this.timebar = new TimeBar(this);
    this.modebar = new ModeBar(this);
    this.labels = new Labels(this);
    this.bookmarks = this.drawer.panels.bookmarks;

    this.bottom = h('div', { class: 'mui-bottom' }, this.timebar.el, this.modebar.el);
    this.root.append(this.hud.el, this.selection.el, this.toolbar.el, this.drawer.el, this.diag.el, this.bottom, this.toast.el);

    // clean-mode exit affordance: an invisible top-right hot corner (hover / tap to reveal)
    this.cleanExit = h('button', { type: 'button', class: 'mui-clean-exit', onclick: () => this.setClean(false) }, '退出净屏', h('kbd', null, 'H'));
    this.cleanCorner = h('div', { id: 'mars-clean-corner' }, this.cleanExit);
    this.cleanCorner.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && !this.cleanCorner.classList.contains('is-peek')) {
        e.preventDefault();
        this.cleanCorner.classList.add('is-peek');
        clearTimeout(this._peekTimer);
        this._peekTimer = setTimeout(() => this.cleanCorner.classList.remove('is-peek'), 3000);
      }
    });

    document.body.append(this.labels.root, this.root, this.cleanCorner);

    // typing inside the UI never reaches global (controls) key handlers
    const stopTyping = (e) => { if (isTypingTarget(e.target)) e.stopPropagation(); };
    this.root.addEventListener('keydown', stopTyping);
    this.root.addEventListener('keyup', stopTyping);
    this.root.addEventListener('keypress', stopTyping);
    // context menu over panels is meaningless here
    this.root.addEventListener('contextmenu', (e) => { if (e.target !== this.root) e.preventDefault(); });
    // a mouse click must not leave focus on a button: later Space / Enter belong to the camera
    // controls (keyboard activation, detail === 0, keeps focus for keyboard users)
    this.root.addEventListener('click', (e) => {
      if (e.detail === 0) return;
      const b = e.target.closest?.('button');
      if (!b || !this.root.contains(b) || b.closest('[role="tablist"]')) return;
      requestAnimationFrame(() => { if (document.activeElement === b) b.blur(); });
    });

    this.keyboard = new Keyboard(this);

    // events
    app.events.on('settings', ({ key } = {}) => { if (key === 'clean') this._applyClean(!!app.state.settings.clean); });
    app.events.on('mode', ({ mode } = {}) => { this.root.dataset.mode = mode || app.state.mode; });
    app.events.on('goto', (e) => { this._lastBookmark = e?.bookmark || null; });
    // the walker is held at a facade whose interior / walk colliders are still streaming in
    app.events.on('controls:hint', (e) => this._onControlsHint(e));
    this.root.dataset.mode = app.state.mode;

    // clean-mode cursor auto-hide
    this._onPointerMove = () => {
      const de = document.documentElement;
      if (!de.classList.contains('mars-clean')) return;
      de.classList.remove('mars-cursor-idle');
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => { if (de.classList.contains('mars-clean')) de.classList.add('mars-cursor-idle'); }, 1600);
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });

    // layout metrics for CSS (selection sheet above the bottom bar, etc.)
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this.bottom);
      this._ro.observe(this.hud.el);
      this._ro.observe(this.diag.el);
    }
    window.addEventListener('resize', () => this._measure());

    // ?select=<id> support (App.applyUrlParams calls app.selectBuilding when present)
    if (typeof app.selectBuilding !== 'function') {
      app.selectBuilding = (id, opts = {}) => {
        let fly = opts.fly;
        if (fly == null) {
          try { const q = new URLSearchParams(location.search); fly = !(q.has('pose') || q.has('bookmark')); } catch { fly = true; }
        }
        return this.nav.selectBuildingById(String(id), { fly });
      };
    }

    this._applyClean(urlClean || !!app.state.settings.clean);
    this._installAutomationHook();
  }

  /** attach __MARS__.ui the moment App publishes window.__MARS__ (before the first frame) */
  _installAutomationHook() {
    const attach = (M) => { if (M && typeof M === 'object' && !M.ui) M.ui = this._automationApi(); };
    if (window.__MARS__) { attach(window.__MARS__); return; }
    try {
      let store;
      Object.defineProperty(window, '__MARS__', {
        configurable: true, enumerable: true,
        get() { return store; },
        set(v) { store = v; attach(v); },
      });
    } catch { /* attached on the first frame instead */ }
  }

  _panelRects() {
    const out = [];
    const els = [this.hud.el, this.toolbar.el, this.timebar.el, this.modebar.el, this.selection.el, this.diag.el, this.drawer.el];
    for (const el of els) {
      if (!el || el.hidden) continue;
      if (el === this.drawer.el && !this.drawer.isOpen) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r.left - 4, r.top - 4, r.right + 4, r.bottom + 4);
    }
    return out;
  }

  _measure() {
    const b = this.bottom.getBoundingClientRect();
    const hud = this.hud.el.getBoundingClientRect();
    this.root.style.setProperty('--mui-bottom-h', `${Math.ceil(b.height)}px`);
    this.root.style.setProperty('--mui-hud-b', `${Math.ceil(hud.bottom)}px`);
    if (!this.diag.el.hidden) this.root.style.setProperty('--mui-diag-b', `${Math.ceil(this.diag.el.getBoundingClientRect().bottom)}px`);
  }

  /** 'controls:hint' {kind, id}: short status toasts for camera situations the visitor cannot see */
  _onControlsHint(e) {
    if (!e || e.kind !== 'building-loading') return;
    // controls repeats the hint at most every 4 s while the walker waits: one steady toast, no flicker
    this.toast.show('室内载入中，稍候即可进入', { kind: 'loading', key: 'building-loading', timeout: 4800 });
  }

  // --- clean plate ---------------------------------------------------------------------------
  setClean(v) { this.app.state.set('clean', !!v); }
  toggleClean() { this.setClean(!this.app.state.settings.clean); }

  _applyClean(clean) {
    if (this._capturing) return;
    if (clean === this._cleanApplied) return;
    this._cleanApplied = clean;
    const de = document.documentElement;
    de.classList.toggle('mars-clean', clean);
    if (!clean) { de.classList.remove('mars-cursor-idle'); clearTimeout(this._idleTimer); this._restoreDebugView(); }
    else {
      if (this.root.contains(document.activeElement)) document.activeElement.blur();
      this._onPointerMove?.();
      this._suspendDebugView();
    }
    this.toolbar.clean.setAttribute('aria-pressed', String(clean));
    this.drawer.panels.layers?.sync();
  }

  /**
   * The pipeline's settings.debugView (AO buffer) is not gated by clean mode in the pipeline itself:
   * clean plates and captures suspend it and restore it afterwards (nothing but the scene, §3).
   */
  _suspendDebugView() {
    const s = this.app.state.settings;
    if (!s.debugView) return;
    this._debugViewStash = s.debugView;
    this.app.state.set('debugView', null);
  }

  _restoreDebugView() {
    const v = this._debugViewStash;
    this._debugViewStash = null;
    if (v && !this.app.state.settings.debugView) this.app.state.set('debugView', v);
  }

  handleEscape() {
    const app = this.app;
    if (app.state.settings.clean) { this.setClean(false); return true; } // nothing else is visible
    if (this.timebar.el.dataset.extra === 'open') { this.timebar.toggleExtra(false); return true; }
    if (this.drawer.isOpen) { this.drawer.close({ restoreFocus: this.root.contains(document.activeElement) }); return true; }
    if (this.diag.open) { this.diag.setOpen(false); return true; }
    if (app.state.selection) { app.state.select(null); return true; }
    if (this.root.contains(document.activeElement)) { document.activeElement.blur(); return true; }
    return false;
  }

  // --- capture ---------------------------------------------------------------------------------
  _bookmarkIdForPose(pose) {
    const bm = this._lastBookmark;
    if (!bm || !pose) return null;
    const ref = bm.pose ? bm : findBookmark(bm.id);
    return ref && posesClose(pose, ref.pose) ? ref.id : null;
  }

  /** app.pipeline.capture({scale}) -> PNG download named after the bookmark or pose + sol time */
  async capture() {
    if (this._capturing) return;
    const app = this.app, st = app.state, s = st.settings;
    const scale = this.prefs.captureScale || 1;
    // outlines only exist around a selection; debug layers always count
    const needClean = this.prefs.captureClean !== false && !s.clean && ((s.outlines && !!st.selection) || (s.debugLayer && s.debugLayer !== 'none') || !!s.debugView);
    this._capturing = true;
    this.toolbar.setCapturing(true);
    const pose = this.nav.pose();
    const name = captureFileName({ bookmarkId: this._bookmarkIdForPose(pose), pose, solTime: st.solTime, scale });
    try {
      if (needClean) { this._suspendDebugView(); st.set('clean', true); await nextFrames(2); }
      let blob;
      if (app.pipeline && typeof app.pipeline.capture === 'function') blob = await app.pipeline.capture({ scale });
      else {
        blob = await new Promise((res) => { app.renderer.render(app.scene, app.camera); app.renderer.domElement.toBlob(res, 'image/png'); });
      }
      if (typeof blob === 'string') blob = await (await fetch(blob)).blob();
      if (!blob) throw new Error('渲染器没有返回图像');
      downloadBlob(blob, name);
      this.toast.show(`已保存截图 ${name}`, { timeout: 3200 });
    } catch (e) {
      console.warn('[ui] capture failed', e);
      this.toast.show(`截图失败：${e?.message || e}`, { kind: 'error', timeout: 4200 });
    } finally {
      if (needClean) { st.set('clean', false); this._restoreDebugView(); }
      this._capturing = false;
      this.toolbar.setCapturing(false);
    }
  }

  // --- automation helpers (window.__MARS__.ui) -------------------------------------------------
  _exposeAutomation() {
    const M = window.__MARS__;
    if (M && typeof M === 'object' && !M.ui) M.ui = this._automationApi();
  }

  _automationApi() {
    const ui = this;
    return {
      open: (tab) => ui.drawer.open(tab || ui.drawer.tab),
      close: () => ui.drawer.close(),
      clean: (v = true) => ui.setClean(v),
      diag: (v = true) => ui.diag.setOpen(v),
      search: (text) => { ui.drawer.open('search'); const p = ui.drawer.panels.search; p.input.value = text; p.onInput(); },
      selectLocation: (lat, lon) => ui.nav.selectLocation(lat, lon),
      selectBuilding: (id, opts) => ui.nav.selectBuildingById(id, opts),
      capture: () => ui.capture(),
      timeExtra: (v = true) => ui.timebar.toggleExtra(v),
      /** click a viewpoint button of the selected building's panel (false when it has no such button) */
      view: (name) => { const b = ui.selection.views?.btns.get(name); if (!b) return false; b.click(); return true; },
      /** "存视点" of the selected building's panel → Promise<number of bookmarks added> (0 without a building panel) */
      saveViews: () => (ui.selection.views ? ui.selection.saveAllViews() : Promise.resolve(0)),
      /** what the interface shows (automation / QA) */
      state: () => {
        const sel = ui.selection;
        const at = ui.nav.currentView();
        return {
          drawer: ui.drawer.isOpen ? ui.drawer.tab : null,
          selection: sel.el.hidden ? null : (sel.views ? { building: sel.views.id, views: [...sel.views.btns.keys()], provisional: sel.views.grid.dataset.provisional === 'true' } : { kind: sel.sel?.type || null }),
          atView: at ? { id: at.id, view: at.view } : null,
          savingViews: sel._savingViews ? sel._savingViews.id : null,
          toast: ui.toast.current && !ui.toast.current.removed ? ui.toast.current.textEl.textContent : null,
          searchMsg: ui.drawer.panels.search.msg.textContent || null,
          clean: !!ui.app.state.settings.clean,
        };
      },
    };
  }

  // --- frame -----------------------------------------------------------------------------------
  update(frame) {
    if (this._boot) {
      this._boot = false;
      requestAnimationFrame(() => this.root.classList.remove('mui-boot'));
      this._measure();
      this._exposeAutomation();
    }
    const clean = !!this.app.state.settings.clean;
    if (!this._capturing && clean !== this._cleanApplied) this._applyClean(clean);
    // read panel rects before this frame's DOM writes (no forced layout)
    if (!clean && (frame.frameNo % 15 === 0 || this._rectsDirty)) { this._rectsDirty = false; this.labels.setObstacles(this._panelRects()); }
    this.timebar.update(frame);           // runs time tweens even when hidden
    this.labels.update(frame);
    if (clean && !this._capturing) return; // nothing else is visible
    this.hud.update(frame);
    this.selection.update(frame);
    this.modebar.update(frame);
    this.toolbar.update(frame);
    this.drawer.update(frame);
    this.diag.update(frame);
  }

  isIdle() { return true; }

  dispose() {
    this.keyboard?.dispose();
    window.removeEventListener('pointermove', this._onPointerMove);
    this._ro?.disconnect();
    this.root?.remove();
    this.labels?.root.remove();
    this.cleanCorner?.remove();
    document.documentElement.classList.remove('mars-clean', 'mars-cursor-idle');
  }
}
