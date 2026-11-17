// Bottom-left time bar: play/pause, local + planet time, the local-sol dial (sky colour across
// the 24 h at the camera latitude), speeds ×60/×600/×3600 and dawn/noon/dusk/night presets.
// OWNER: ui agent.
import { h, iconButton, setText, setAttr, setStyle, prefersReducedMotion } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './widgets.js';
import { solTimeForLocal } from '../app/sun.js';
import { fmtHM, localTime, dayGradientCss, presetLocalTime, sunTimes, TIME_PRESETS } from './format.js';

export const SPEEDS = [60, 600, 3600];

export class TimeBar {
  constructor(ui) {
    this.ui = ui;
    const app = ui.app;
    this.play = iconButton('play', '播放时间', { tip: '播放 / 暂停  T', tipPos: 'top', cls: 'mui-play', onclick: () => this.togglePlay() });
    this.play.setAttribute('aria-pressed', 'false');

    this.localV = h('span', { class: 'mui-v mui-num' });
    this.planetV = h('span', { class: 'mui-v mui-num' });
    const read = h('div', { class: 'mui-tb-read' },
      h('div', { class: 'mui-tb-local' }, h('span', { class: 'mui-k' }, '当地'), this.localV),
      h('div', { class: 'mui-tb-planet' }, h('span', { class: 'mui-k' }, '行星时'), this.planetV));

    // dial
    this.track = h('div', { class: 'mui-dial-track' });
    this.thumb = h('div', { class: 'mui-dial-thumb' });
    this.dial = h('div', {
      class: 'mui-dial', role: 'slider', tabindex: '0', 'aria-label': '当地太阳时', 'aria-valuemin': '0', 'aria-valuemax': '24',
      'data-tip': '拖动调整当地时间', 'data-tip-pos': 'top',
    }, this.track,
    h('div', { class: 'mui-dial-ticks', 'aria-hidden': 'true' }, ...[0.25, 0.5, 0.75].map((t) => h('i', { style: `left:${t * 100}%` }))),
    this.thumb);
    this._bindDial();

    // speeds + presets
    this.speeds = segmented(SPEEDS.map((s) => [String(s), `×${s}`, { 'data-tip': `${s === 60 ? '1 秒 = 1 分钟' : s === 600 ? '1 秒 = 10 分钟' : '1 秒 = 1 小时'}`, 'data-tip-pos': 'top' }]), {
      label: '时间倍速', value: String(ui.prefs.playSpeed), cls: 'mui-speeds',
      onChange: (v) => { this.setSpeed(+v, true); },
    });
    this.presets = h('div', { class: 'mui-presets', role: 'group', 'aria-label': '时间预设（相机所在经度）' },
      ...TIME_PRESETS.map(([k, name]) => {
        const b = h('button', { type: 'button', class: 'mui-chip-btn', 'data-preset': k, onclick: () => this.preset(k) }, name);
        return b;
      }));
    this.extra = h('div', { class: 'mui-tb-extra', id: 'mui-tb-extra' }, this.speeds.el, h('span', { class: 'mui-vsep', 'aria-hidden': 'true' }), this.presets);
    this.more = h('button', { type: 'button', class: 'mui-ibtn mui-tb-more', 'aria-label': '倍速与时间预设', 'aria-expanded': 'false', 'aria-controls': 'mui-tb-extra', onclick: () => this.toggleExtra() }, icon('chevron', 18));

    this.el = h('div', { class: 'mui-timebar mui-panel', role: 'group', 'aria-label': '时间' }, this.play, read, this.dial, this.extra, this.more);

    this._last = { lat: 1e9, sub: 1e9, speed: -1, p: -1, playing: null };
    this.tween = null;
    app.events.on('time', () => { this._dirty = true; });
    this._dirty = true;
  }

  // --- actions ---------------------------------------------------------------------------
  togglePlay() {
    const st = this.ui.app.state;
    this.tween = null;
    if (st.timeSpeed) st.setTimeSpeed(0);
    else st.setTimeSpeed((this.ui.prefs.playSpeed || 600) / 3600);
  }

  setSpeed(mult, play = true) {
    const st = this.ui.app.state;
    this.ui.prefs.playSpeed = mult;
    this.ui.savePrefs();
    if (play || st.timeSpeed) st.setTimeSpeed(mult / 3600);
  }

  step(hours) {
    const st = this.ui.app.state;
    this.tween = null;
    st.setTime(st.solTime + hours);
  }

  /** jump (animated) to a preset local time at the camera longitude */
  preset(kind) {
    const app = this.ui.app, st = app.state;
    const f = app.frame;
    const lat = f ? f.camLat : 0, lon = f ? f.camLon : 0;
    const local = presetLocalTime(kind, lat, st.subsolarLat);
    const target = solTimeForLocal(lon, local);
    this.animateTo(target);
    const name = TIME_PRESETS.find((p) => p[0] === kind)?.[1] || '';
    this.ui.toast.show(`${name}  当地 ${fmtHM(local)}`, { timeout: 1600 });
  }

  animateTo(target) {
    const st = this.ui.app.state;
    let d = ((target - st.solTime) % 24 + 24) % 24;
    if (d > 12) d -= 24;
    if (prefersReducedMotion() || Math.abs(d) < 1e-3) { this.tween = null; st.setTime(target); return; }
    this.tween = { from: st.solTime, delta: d, t0: performance.now(), dur: 600 + 900 * Math.min(1, Math.abs(d) / 12) };
  }

  toggleExtra(force) {
    const open = force ?? this.el.dataset.extra !== 'open';
    if (open) this.el.dataset.extra = 'open'; else delete this.el.dataset.extra;
    this.more.setAttribute('aria-expanded', String(open));
  }

  // --- dial --------------------------------------------------------------------------------
  _localFromEvent(e) {
    const r = this.dial.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    return t * 24;
  }

  _setLocal(local) {
    const app = this.ui.app;
    const lon = app.frame ? app.frame.camLon : 0;
    this.tween = null;
    app.state.setTime(solTimeForLocal(lon, Math.min(23.9999, Math.max(0, local))));
  }

  _bindDial() {
    const d = this.dial;
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      d.setPointerCapture(e.pointerId);
      d.dataset.drag = '1';
      this._setLocal(this._localFromEvent(e));
      e.preventDefault();
    });
    d.addEventListener('pointermove', (e) => { if (d.dataset.drag) this._setLocal(this._localFromEvent(e)); });
    const end = (e) => { if (d.dataset.drag) { delete d.dataset.drag; try { d.releasePointerCapture(e.pointerId); } catch { /* ignore */ } } };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('keydown', (e) => {
      const app = this.ui.app;
      const lon = app.frame ? app.frame.camLon : 0;
      const cur = localTime(lon, app.state.solTime);
      let next = null;
      const stepH = e.shiftKey ? 1 : 0.25;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + stepH;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - stepH;
      else if (e.key === 'PageUp') next = cur + 1;
      else if (e.key === 'PageDown') next = cur - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 23.99;
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      this.tween = null;
      app.state.setTime(solTimeForLocal(lon, ((next % 24) + 24) % 24));
    });
  }

  // --- frame -------------------------------------------------------------------------------
  update(frame) {
    const st = this.ui.app.state;
    if (this.tween) {
      const tw = this.tween;
      const t = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      st.setTime(tw.from + tw.delta * k);
      if (t >= 1) this.tween = null;
    }
    const L = this._last;
    const local = localTime(frame.camLon, st.solTime);
    const ls = fmtHM(local), ps = fmtHM(st.solTime);
    setText(this.localV, ls);
    setText(this.planetV, ps);
    const p = local / 24;
    if (Math.abs(p - L.p) > 1e-4) {
      L.p = p;
      setStyle(this.thumb, '--p', p.toFixed(5));
      setAttr(this.dial, 'aria-valuenow', local.toFixed(2));
      setAttr(this.dial, 'aria-valuetext', `当地 ${ls}`);
    }
    // the sky band follows the camera latitude and the season
    if (Math.abs(frame.camLat - L.lat) > 0.35 || st.subsolarLat !== L.sub) {
      L.lat = frame.camLat; L.sub = st.subsolarLat;
      this.track.style.background = dayGradientCss(frame.camLat, st.subsolarLat);
      const t = sunTimes(frame.camLat, st.subsolarLat);
      const day = t.polar === 'day' ? '极昼' : t.polar === 'night' ? '极夜' : `日出 ${fmtHM(t.sunrise)}  日落 ${fmtHM(t.sunset)}`;
      this.dial.setAttribute('data-tip', `${day}  拖动调整当地时间`);
      this.dial.setAttribute('aria-description', day);
    }
    const playing = !!st.timeSpeed;
    if (playing !== L.playing) {
      L.playing = playing;
      this.play.replaceChildren(icon(playing ? 'pause' : 'play', 18));
      this.play.setAttribute('aria-pressed', String(playing));
      this.play.setAttribute('aria-label', playing ? '暂停时间' : '播放时间');
      this.el.classList.toggle('is-playing', playing);
    }
    const mult = Math.round(Math.abs(st.timeSpeed) * 3600);
    if (mult !== L.speed) {
      L.speed = mult;
      if (SPEEDS.includes(mult)) this.speeds.set(String(mult));
      else if (!mult) this.speeds.set(String(this.ui.prefs.playSpeed));
      else this.speeds.set('');
    }
  }
}
