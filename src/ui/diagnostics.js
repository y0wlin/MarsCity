// Diagnostics panel (F3 or `): fps + frame-time graph, draw calls, triangles, memory, worker
// stats from __MARS__.stats(), per-system refinement state and the camera pose as a copyable
// ?pose= URL. Frame time is diagnostic only (§1). OWNER: ui agent.
import { h, iconButton, setText, copyText } from './dom.js';
import { fmtInt, fmtLat, fmtLon, fmtLength, fmtHM, poseQuery, localTime, sunElevationDeg, MODE_NAMES } from './format.js';
import { selectionBuildingId } from './nav.js';

const N = 150;

export class Diagnostics {
  constructor(ui) {
    this.ui = ui;
    this.open = false;
    this.samples = new Float32Array(N);
    this.head = 0;
    this.count = 0;

    const row = (label) => {
      const v = h('dd', { class: 'mui-num' });
      return [h('div', { class: 'mui-diag-row' }, h('dt', null, label), v), v];
    };
    const [rFps, vFps] = row('帧率');
    const [rMs, vMs] = row('帧时间');
    const [rCalls, vCalls] = row('绘制调用');
    const [rTris, vTris] = row('三角形');
    const [rMem, vMem] = row('几何 / 纹理');
    const [rJobs, vJobs] = row('工作线程');
    const [rDone, vDone] = row('已完成');
    const [rIdle, vIdle] = row('细化');
    this.v = { fps: vFps, ms: vMs, calls: vCalls, tris: vTris, mem: vMem, jobs: vJobs, done: vDone, idle: vIdle };

    this.canvas = h('canvas', { class: 'mui-diag-graph', width: '276', height: '44', 'aria-hidden': 'true' });
    this.ctx2d = this.canvas.getContext('2d');
    this.systems = h('div', { class: 'mui-diag-systems' });
    this.pose = h('div', { class: 'mui-diag-pose mui-mono' });
    this.cam = h('div', { class: 'mui-diag-cam mui-num' });
    this.copyUrl = iconButton('link', '复制位姿 URL', { tip: '复制 ?pose= 链接', tipPos: 'top', cls: 'mui-ibtn-sm', onclick: () => this.copy('url') });
    this.copyJson = iconButton('copy', '复制位姿 JSON', { tip: '复制位姿 JSON', tipPos: 'top', cls: 'mui-ibtn-sm', onclick: () => this.copy('json') });

    this.el = h('section', { class: 'mui-diag mui-panel', 'aria-label': '诊断', hidden: true },
      h('header', { class: 'mui-diag-head' }, h('h2', null, '诊断'), h('span', { class: 'mui-k' }, 'F3'),
        iconButton('close', '关闭诊断', { tip: false, cls: 'mui-ibtn-sm', onclick: () => this.setOpen(false) })),
      this.canvas,
      h('dl', { class: 'mui-diag-grid' }, rFps, rMs, rCalls, rTris, rMem, rJobs, rDone, rIdle),
      this.systems,
      h('div', { class: 'mui-diag-sec' }, h('div', { class: 'mui-diag-sub' }, h('span', null, '相机'), h('span', { class: 'mui-diag-tools' }, this.copyUrl, this.copyJson)), this.cam, this.pose),
    );
    this._n = 0;
    if (ui.prefs.diag) this.setOpen(true, false);
  }

  setOpen(v, persist = true) {
    this.open = !!v;
    this.el.hidden = !this.open;
    this.ui.root.classList.toggle('mui-diag-open', this.open);
    this.ui._rectsDirty = true;
    if (persist) { this.ui.prefs.diag = this.open; this.ui.savePrefs(); }
    this.ui.drawer?.panels?.layers?.sync?.();
    if (this.open) this._n = 0;
  }

  toggle() { this.setOpen(!this.open); }

  poseUrl() {
    const app = this.ui.app;
    const p = this.ui.nav.pose();
    if (!p) return location.href;
    const bid = selectionBuildingId(app.state.selection);
    const q = poseQuery(p, app.state.solTime, { mode: app.state.mode, select: bid });
    return `${location.origin}${location.pathname}?${q}`;
  }

  async copy(kind) {
    const app = this.ui.app;
    const p = this.ui.nav.pose();
    if (!p) return;
    const text = kind === 'url' ? this.poseUrl() : JSON.stringify({ pose: p, solTime: +app.state.solTime.toFixed(4), subsolarLat: app.state.subsolarLat, mode: app.state.mode }, null, 2);
    const ok = await copyText(text);
    this.ui.toast.show(ok ? (kind === 'url' ? '已复制位姿链接' : '已复制位姿 JSON') : '无法访问剪贴板', { kind: ok ? 'info' : 'error' });
  }

  sample(frame) {
    this.samples[this.head] = frame.dt * 1000;
    this.head = (this.head + 1) % N;
    if (this.count < N) this.count++;
  }

  update(frame) {
    if (!this.open) return;
    this.sample(frame);
    if ((this._n++ % 10) !== 0) return;
    const app = this.ui.app;
    let st = null;
    try { st = window.__MARS__?.stats ? window.__MARS__.stats() : null; } catch { st = null; }
    if (!st) {
      const info = app.renderer?.info;
      st = { fps: app.fps, calls: info?.render?.calls, triangles: info?.render?.triangles, geometries: info?.memory?.geometries, textures: info?.memory?.textures, workers: { ...(app.workers?.stats || {}), pending: app.workers?.pending } };
    }
    // frame-time stats over the window
    let sum = 0, max = 0;
    for (let i = 0; i < this.count; i++) { const v = this.samples[i]; sum += v; if (v > max) max = v; }
    const avg = this.count ? sum / this.count : 0;
    setText(this.v.fps, Number.isFinite(st.fps) ? st.fps.toFixed(0) : '—');
    setText(this.v.ms, `${avg.toFixed(1)} ms  峰值 ${max.toFixed(1)}`);
    setText(this.v.calls, fmtInt(st.calls ?? 0));
    setText(this.v.tris, fmtInt(st.triangles ?? 0));
    setText(this.v.mem, `${fmtInt(st.geometries ?? 0)} / ${fmtInt(st.textures ?? 0)}`);
    const w = st.workers || {};
    setText(this.v.jobs, `${fmtInt(w.pending ?? 0)} 排队${app.workers?.size ? `  ${app.workers.size} 线程` : ''}`);
    setText(this.v.done, `${fmtInt(w.completed ?? 0)} / ${fmtInt(w.submitted ?? 0)}${w.failed ? `  失败 ${w.failed}` : ''}${w.cancelled ? `  取消 ${w.cancelled}` : ''}`);
    let idle = true;
    try { idle = app.isIdle(); } catch { /* ignore */ }
    setText(this.v.idle, idle ? '已收敛' : '进行中');
    this.v.idle.dataset.state = idle ? 'idle' : 'busy';

    // per-system refinement
    const parts = [];
    for (const [name, sys] of Object.entries(app.systems || {})) {
      let ok = true;
      try { ok = sys.isIdle ? !!sys.isIdle() : true; } catch { ok = false; }
      parts.push(`${ok ? '●' : '○'} ${name}`);
    }
    setText(this.systems, parts.join('   '));

    const p = this.ui.nav.pose();
    if (p) {
      const f = frame;
      const lt = localTime(p.lon, app.state.solTime);
      const e = sunElevationDeg(p.lat, p.lon, app.state.solTime, app.state.subsolarLat);
      setText(this.cam, `${fmtLat(p.lat, 6)} ${fmtLon(p.lon, 6)}\n海拔 ${fmtLength(p.alt)}  离地 ${fmtLength(f.camAltGround)}\n朝向 ${p.heading.toFixed(1)}°  俯仰 ${p.pitch.toFixed(1)}°  ${p.lens ? `${(+p.lens).toFixed(0)} mm` : `${(+p.fov || 0).toFixed(1)}° 视场`}\n${MODE_NAMES[app.state.mode] || app.state.mode}  行星时 ${fmtHM(app.state.solTime)}  当地 ${fmtHM(lt)}  太阳 ${e.toFixed(1)}°`);
      setText(this.pose, `?${poseQuery(p, app.state.solTime, { mode: app.state.mode })}`);
    }
    this.drawGraph();
  }

  drawGraph() {
    const c = this.ctx2d;
    if (!c) return;
    // retina-sharp backing store
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = Math.round(276 * dpr), ch = Math.round(44 * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = 276, H = 44;
    c.clearRect(0, 0, W, H);
    // reference lines at 16.7 ms and 33.3 ms
    const scale = (ms) => H - Math.min(1, ms / 50) * (H - 2) - 1;
    c.strokeStyle = 'rgba(242,239,232,0.10)';
    c.lineWidth = 1;
    c.beginPath();
    for (const ms of [16.7, 33.3]) { const y = Math.round(scale(ms)) + 0.5; c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    if (!this.count) return;
    c.strokeStyle = 'rgba(226,174,114,0.95)';
    c.lineWidth = 1.25;
    c.beginPath();
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const idx = (this.head - n + i + N) % N;
      const x = (i / (N - 1)) * W;
      const y = scale(this.samples[idx]);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
  }
}
