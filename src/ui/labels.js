// Label overlay: province labels (orbit / regional altitudes), megastructure labels, the
// selected building's label and the selected-location marker. HTML elements projected every
// frame from float64 ECEF via the floating origin and app.camera; hidden behind the planet by a
// horizon test; greedy de-overlap by priority. Shown only when settings.labels && !clean.
// OWNER: ui agent.
import { h, setText } from './dom.js';
import { PROVINCES, MEGASTRUCTURES } from '../data/provinces.js';
import { latLonHToEcef } from '../core/geo.js';
import { smoothstep } from '../core/noise.js';

const PAD = 3;

class Item {
  constructor(kind, el, pill, priority) {
    this.kind = kind; this.el = el; this.pill = pill; this.priority = priority;
    this.x = 0; this.y = 0; this.z = 0; this.nx = 0; this.ny = 1; this.nz = 0;
    this.w = 0; this.h = 0; this.measured = false;
    this.sx = 0; this.sy = 0; this.alpha = 0; this.cand = false; this.shown = false;
    this._tx = ''; this._op = '';
    this.active = true;
  }
  setEcef(p) {
    this.x = p.x; this.y = p.y; this.z = p.z;
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    this.nx = p.x / r; this.ny = p.y / r; this.nz = p.z / r;
  }
}

export class Labels {
  constructor(ui) {
    this.ui = ui;
    this.root = h('div', { id: 'mars-labels', 'aria-hidden': 'true' });
    this.items = [];
    this._tmp = {};

    for (const p of PROVINCES) {
      if (!p) continue;
      const pill = h('span', { class: 'mui-lab-pill' }, h('b', { class: 'mui-lab-code' }, p.code), h('span', null, p.name));
      const el = h('div', { class: 'mui-lab mui-lab-prov', 'data-zone': p.zone }, h('span', { class: 'mui-lab-dot' }), pill);
      const it = new Item('province', el, pill, 10);
      it.setEcef(latLonHToEcef(p.lat, p.lon, 0, this._tmp));
      this.items.push(it);
      this.root.append(el);
    }

    this.megaItems = [];
    for (const m of MEGASTRUCTURES) {
      const pill = h('span', { class: 'mui-lab-pill' }, h('b', { class: 'mui-lab-code' }, m.id), h('span', null, m.name));
      const el = h('div', { class: 'mui-lab mui-lab-mega' }, h('span', { class: 'mui-lab-diamond' }), pill);
      const it = new Item('mega', el, pill, 12);
      it.active = false; // until the site coordinates load
      it.megaId = m.id;
      this.items.push(it);
      this.megaItems.push(it);
      this.root.append(el);
    }
    import('../world/sites.js').then((mod) => {
      for (const s of Object.values(mod.SITES || {})) {
        const it = this.megaItems.find((x) => x.megaId === s.id);
        if (it && Number.isFinite(s.lat) && Number.isFinite(s.lon)) { it.setEcef(latLonHToEcef(s.lat, s.lon, 0, this._tmp)); it.active = true; }
      }
    }).catch(() => { /* optional */ });

    // selected building
    this.bText = h('span', { class: 'mui-lab-use' });
    this.bId = h('span', { class: 'mui-lab-id' });
    const bPill = h('span', { class: 'mui-lab-pill' }, this.bText, this.bId);
    this.bItem = new Item('building', h('div', { class: 'mui-lab mui-lab-bld' }, h('span', { class: 'mui-lab-stem' }), bPill), bPill, 30);
    this.bItem.active = false;
    this.items.push(this.bItem);
    this.root.append(this.bItem.el);

    // selected location marker
    this.lItem = new Item('marker', h('div', { class: 'mui-lab mui-lab-marker' }, h('span', { class: 'mui-lab-ring' })), null, 40);
    this.lItem.active = false;
    this.lItem.w = 18; this.lItem.h = 18; this.lItem.measured = true;
    this.items.push(this.lItem);
    this.root.append(this.lItem.el);

    this.placed = [];
    this.obstacles = [];   // screen rects of UI panels (labels never peek out from under them)
    this.visible = true;
    ui.app.events.on('select', (sel) => this.onSelect(sel));
  }

  onSelect(sel) {
    this.bItem.active = false;
    this.lItem.active = false;
    if (!sel) return;
    // building label is (re)configured from the selection panel's resolved spec in update()
    this._pendingBuilding = true;
    if (sel.type === 'location' && Number.isFinite(sel.lat)) {
      this.lItem.setEcef(latLonHToEcef(sel.lat, sel.lon, Number.isFinite(sel.h) ? Math.max(0, sel.h) : 0, this._tmp));
      this.lItem.active = true;
      this.lItem.el.classList.remove('is-new');
      void this.lItem.el.offsetWidth; // restart the one-shot pulse
      this.lItem.el.classList.add('is-new');
    }
  }

  _syncBuilding() {
    const info = this.ui.selection.labelInfo();
    if (!info) { this.bItem.active = false; return; }
    if (this.bItem.bid !== info.id) {
      this.bItem.bid = info.id;
      setText(this.bText, info.text);
      setText(this.bId, info.id);
      this.bItem.measured = false;
      const top = this.ui.nav.buildingTopEcefHeight(info.spec);
      this.bItem.setEcef(latLonHToEcef(info.spec.lat, info.spec.lon, top + 2, this._tmp));
    }
    this.bItem.active = true;
  }

  /** flat [x0,y0,x1,y1,...] rects in CSS px, refreshed by the UI a few times per second */
  setObstacles(list) { this.obstacles = list; }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.root.hidden = !v;
    if (v) for (const it of this.items) { it._tx = ''; it._op = ''; }
  }

  update(frame) {
    const s = this.ui.app.state.settings;
    const show = !!s.labels && (!s.clean || this.ui._capturing);
    this.setVisible(show);
    if (!show) return;
    if (this._pendingBuilding || (frame.frameNo & 15) === 0) { this._pendingBuilding = false; this._syncBuilding(); }

    const W = frame.viewport.width, H = frame.viewport.height;
    const e = frame.projScreen.elements;
    const C = frame.camEcef;
    const alt = frame.camAlt;
    const provFade = smoothstep(1.2e5, 3.5e5, alt);
    const megaFade = smoothstep(2.5e3, 9e3, alt);

    const cands = [];
    for (const it of this.items) {
      it.cand = false;
      if (!it.active) continue;
      let a = 1;
      if (it.kind === 'province') a = provFade;
      else if (it.kind === 'mega') a = megaFade;
      if (a <= 0.01) continue;
      const dx = C.x - it.x, dy = C.y - it.y, dz = C.z - it.z;
      const dist = Math.hypot(dx, dy, dz);
      if (it.kind === 'building') { a *= 1 - smoothstep(1.6e4, 2.5e4, dist); if (a <= 0.01) continue; }
      if (it.kind === 'marker' && dist < 25) continue;
      // horizon: the camera must be above the tangent plane at the anchor
      const cosA = (dx * it.nx + dy * it.ny + dz * it.nz) / Math.max(1e-6, dist);
      if (cosA <= 0) continue;
      if (it.kind === 'province' || it.kind === 'mega') a *= smoothstep(0.0, 0.12, cosA);
      const rx = -dx, ry = -dy, rz = -dz;
      const cw = e[3] * rx + e[7] * ry + e[11] * rz + e[15];
      if (cw <= 1e-9) continue;
      const nxs = (e[0] * rx + e[4] * ry + e[8] * rz + e[12]) / cw;
      const nys = (e[1] * rx + e[5] * ry + e[9] * rz + e[13]) / cw;
      if (nxs < -1.2 || nxs > 1.2 || nys < -1.2 || nys > 1.2) continue;
      it.sx = (nxs * 0.5 + 0.5) * W;
      it.sy = (0.5 - nys * 0.5) * H;
      it.alpha = a;
      it.cand = true;
      cands.push(it);
    }

    // measure newly needed labels in one read pass (one layout at most)
    for (const it of cands) {
      if (!it.measured && it.pill) {
        it.w = it.pill.offsetWidth; it.h = it.pill.offsetHeight;
        it.measured = it.w > 0;
      }
    }

    // greedy placement by priority
    cands.sort((p, q) => q.priority - p.priority);
    const placed = this.placed;
    placed.length = 0;
    for (let i = 0; i < this.obstacles.length; i++) placed.push(this.obstacles[i]);
    for (const it of cands) {
      let x0, y0, x1, y1;
      if (it.kind === 'building') { x0 = it.sx - it.w / 2; x1 = it.sx + it.w / 2; y1 = it.sy; y0 = it.sy - 26 - it.h; }
      else if (it.kind === 'marker') { x0 = it.sx - 9; x1 = it.sx + 9; y0 = it.sy - 9; y1 = it.sy + 9; }
      else { x0 = it.sx - 5; x1 = it.sx + 10 + it.w; y0 = it.sy - it.h / 2; y1 = it.sy + it.h / 2; }
      // fully inside the viewport (a label sliced by the screen edge reads as clutter)
      let ok = x0 >= 4 && x1 <= W - 4 && y0 >= 4 && y1 <= H - 4;
      if (ok) {
        for (let i = 0; i < placed.length; i += 4) {
          if (x0 - PAD < placed[i + 2] && x1 + PAD > placed[i] && y0 - PAD < placed[i + 3] && y1 + PAD > placed[i + 1]) { ok = false; break; }
        }
      }
      if (!ok) { it.cand = false; continue; }
      if (it.kind !== 'marker') placed.push(x0, y0, x1, y1);
    }

    // writes
    for (const it of this.items) {
      const on = it.cand;
      if (on !== it.shown) { it.shown = on; it.el.classList.toggle('is-on', on); }
      if (!on) continue;
      const tx = `translate3d(${it.sx.toFixed(1)}px,${it.sy.toFixed(1)}px,0)`;
      if (tx !== it._tx) { it._tx = tx; it.el.style.transform = tx; }
      const op = it.alpha >= 0.995 ? '1' : it.alpha.toFixed(2);
      if (op !== it._op) { it._op = op; it.el.style.setProperty('--a', op); }
    }
  }
}
