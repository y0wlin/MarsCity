// 搜索 panel: building ID, "lat, lon", province code / name, megastructure, bookmark → fly there;
// plus the searchable list of buildings around the camera (ID, use, plot, distance; CSV export).
// OWNER: ui agent.
import { h, iconButton, clear, setText, downloadText } from '../dom.js';
import { icon } from '../icons.js';
import { section } from '../widgets.js';
import { parseQuery } from '../query.js';
import { PROVINCES, ZONES, MEGASTRUCTURES, provinceByCode } from '../../data/provinces.js';
import { allBookmarks } from '../../app/bookmarks.js';
import { fmtLat, fmtLon, fmtLength, useName, plotId, buildingHeight } from '../format.js';
import { BuildingIndex, provinceCodeOf } from '../buildingIndex.js';
import { greatCircleDistance } from '../../core/geo.js';

const GROUP_NAMES = { shot: '镜头', turntable: '昼夜转台', check: '验收视点', user: '我的书签' };
const LIST_ALT = 25000;      // list buildings when the camera is within 25 km of the ground
const LIST_RADIUS = 1500;    // metres around the camera nadir

export class SearchPanel {
  constructor(ui) {
    this.ui = ui;
    this.id = 'search';
    this.title = '搜索';
    this.results = [];
    this.active = -1;
    this.megas = MEGASTRUCTURES.map((m) => ({ ...m, lat: null, lon: null }));
    import('../../world/sites.js').then((mod) => {
      const S = mod.SITES || {};
      for (const site of Object.values(S)) {
        const m = this.megas.find((x) => x.id === site.id);
        if (m && Number.isFinite(site.lat)) { m.lat = site.lat; m.lon = site.lon; }
      }
    }).catch(() => { /* sites optional */ });

    this.input = h('input', {
      type: 'search', class: 'mui-input mui-search-input', placeholder: '建筑 ID、经纬度或省域代号', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'mui-search-results', 'aria-label': '搜索',
      enterkeyhint: 'go',
    });
    this.clearBtn = iconButton('close', '清空', { tip: false, cls: 'mui-ibtn-sm mui-search-clear', onclick: () => { this.input.value = ''; this.onInput(); this.input.focus(); } });
    this.msg = h('div', { class: 'mui-search-msg', role: 'status', 'aria-live': 'polite' });
    this.list = h('ul', { class: 'mui-results', id: 'mui-search-results', role: 'listbox', 'aria-label': '搜索结果' });
    const ex = (t) => h('button', { type: 'button', class: 'mui-chip-btn', onclick: () => { this.input.value = t; this.onInput(); this.input.focus(); } }, t);
    this.examples = h('div', { class: 'mui-examples' }, h('span', { class: 'mui-k' }, '例如'), ex('ZR1'), ex('OX5'), ex('22.5, 118.2'), ex('潮堤'), ex('S01'));

    // nearby building list
    this.blist = h('ul', { class: 'mui-blist', 'aria-label': '附近建筑' });
    this.bnote = h('p', { class: 'mui-note' });
    this.bcount = h('span', { class: 'mui-sec-count mui-num' });
    this.exportBtn = iconButton('download', '导出附近建筑清单 CSV', { tip: '导出 CSV', cls: 'mui-ibtn-sm', onclick: () => this.exportCsv() });
    this.refreshBtn = iconButton('refresh', '重新载入附近建筑', { tip: '刷新', cls: 'mui-ibtn-sm', onclick: () => this.refreshNearby(true) });
    const blistSection = section('附近建筑', { action: h('div', { class: 'mui-sec-actions' }, this.bcount, this.refreshBtn, this.exportBtn) }, this.bnote, this.blist);

    this.el = h('div', { class: 'mui-pane mui-pane-search' },
      h('div', { class: 'mui-search' }, icon('search', 17), this.input, this.clearBtn),
      this.msg, this.list, this.examples, blistSection);

    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this._near = { lat: NaN, lon: NaN, ver: -1, q: null, t: 0, ensured: '' };
    ui.buildingIndex.onChange(() => { this._near.dirty = true; });
    this.onInput();
  }

  focusTarget() { return this.input; }
  onShow() { this.refreshNearby(false); }

  // --- query -------------------------------------------------------------------------------
  ctx() {
    return { provinces: PROVINCES.filter(Boolean), megas: this.megas, bookmarks: allBookmarks() };
  }

  onInput() {
    const text = this.input.value;
    this.clearBtn.hidden = !text;
    this.examples.hidden = !!text.trim();
    this.results = this.withKnownIds(parseQuery(text, this.ctx()), text).slice(0, 8);
    this.active = this.results.length ? 0 : -1;
    setText(this.msg, '');
    this.msg.removeAttribute('data-kind');
    this.renderResults();
    this._near.dirty = true;
  }

  /**
   * A partial building ID also lists indexed buildings whose ID starts with it (nearest first), so
   * an ID copied short or typed from a screenshot still finds the instance.
   */
  withKnownIds(results, text) {
    const q = String(text || '').trim();
    const top = results[0];
    if (!top || top.kind !== 'building' || q.length < 5) return results;
    const idx = this.ui.buildingIndex;
    const ql = q.toLowerCase();
    const f = this.ui.app.frame;
    const hits = [];
    for (const [id, spec] of idx.byId) {
      if (id.length <= q.length || !id.toLowerCase().startsWith(ql)) continue;
      hits.push({ spec, d: f ? greatCircleDistance(f.camLat, f.camLon, spec.lat, spec.lon) : 0 });
      if (hits.length > 400) break;
    }
    hits.sort((a, b) => a.d - b.d);
    const known = hits.slice(0, 4).map(({ spec, d }) => ({ kind: 'known', key: `k:${spec.id}`, score: 60, spec, dist: d }));
    if (idx.get(q)) results[0] = { ...top, spec: idx.get(q) };
    return [results[0], ...known, ...results.slice(1)];
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.results.length) return;
      e.preventDefault();
      const n = this.results.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.results[this.active >= 0 ? this.active : 0];
      if (r) this.activate(r);
      else if (this.input.value.trim()) this.showMsg('没有匹配的建筑 ID、坐标、省域或书签。', 'error');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.input.value) { this.input.value = ''; this.onInput(); }
      else this.ui.drawer.close({ restoreFocus: true });
    }
  }

  showMsg(text, kind = 'info') {
    setText(this.msg, text);
    this.msg.dataset.kind = kind;
  }

  describe(r) {
    switch (r.kind) {
      case 'coords': return { ic: 'pin', title: `${fmtLat(r.lat, 4)}  ${fmtLon(r.lon, 4)}`, sub: Number.isFinite(r.alt) ? `飞往离地 ${fmtLength(r.alt)}` : '飞往离地 3 km 处斜看' };
      case 'province': {
        const p = r.province;
        return { ic: 'region', title: `${p.code} ${p.name}`, sub: `${ZONES[p.zone]?.name || ''}  锚点 ${fmtLat(p.lat, 0)} ${fmtLon(p.lon, 0)}`, zone: p.zone };
      }
      case 'mega': {
        const m = r.mega, p = provinceByCode(m.province);
        return { ic: 'target', title: `${m.id} ${m.name}`, sub: `巨构  ${p ? `${p.code} ${p.name}` : m.province}` };
      }
      case 'bookmark': return { ic: 'bookmark', title: r.bookmark.name || r.bookmark.id, sub: `${GROUP_NAMES[r.bookmark.group] || '书签'}  ${r.bookmark.id}` };
      case 'building': return { ic: 'building', title: r.spec ? `${useName(r.spec.use)}  按 ID 飞往` : '按建筑 ID 查找并飞往', sub: r.id, mono: true };
      case 'known': {
        const s = r.spec;
        const facts = [provinceCodeOf(s), s.floors ? `${s.floors} 层` : null, Number.isFinite(r.dist) && r.dist > 0 ? fmtLength(r.dist) : null].filter(Boolean).join('  ');
        return { ic: 'building', title: `${useName(s.use)}  ${facts}`, sub: String(s.id), mono: true };
      }
      default: return { ic: 'more', title: r.key, sub: '' };
    }
  }

  renderResults() {
    clear(this.list);
    this.input.setAttribute('aria-expanded', String(this.results.length > 0));
    this.results.forEach((r, i) => {
      const d = this.describe(r);
      const id = `mui-sr-${i}`;
      const li = h('li', { id, role: 'option', class: 'mui-result', 'aria-selected': String(i === this.active) },
        h('span', { class: 'mui-result-ico', 'data-zone': d.zone || null }, icon(d.ic, 17)),
        h('span', { class: 'mui-result-text' }, h('span', { class: 'mui-result-title' }, d.title), h('span', { class: `mui-result-sub${d.mono ? ' mui-mono' : ''}` }, d.sub)));
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => { this.active = i; this.activate(r); });
      li.addEventListener('mousemove', () => { if (this.active !== i) { this.active = i; this.renderActive(); } });
      this.list.append(li);
    });
    this.renderActive();
  }

  renderActive() {
    const items = this.list.children;
    for (let i = 0; i < items.length; i++) items[i].setAttribute('aria-selected', String(i === this.active));
    if (this.active >= 0 && items[this.active]) {
      this.input.setAttribute('aria-activedescendant', items[this.active].id);
      items[this.active].scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }

  async activate(r) {
    const ui = this.ui, nav = ui.nav;
    const done = () => { if (ui.isNarrow()) ui.drawer.close(); };
    switch (r.kind) {
      case 'coords': {
        const g = nav.groundHeight(r.lat, r.lon);
        nav.selectLocation(r.lat, r.lon, g);
        nav.flyToLocation(r.lat, r.lon, g, Number.isFinite(r.alt) ? { height: Math.max(2, r.alt) } : {});
        this.showMsg(`飞往 ${fmtLat(r.lat, 4)} ${fmtLon(r.lon, 4)}`);
        done();
        break;
      }
      case 'province': {
        const p = r.province;
        nav.selectLocation(p.lat, p.lon);
        nav.regionView(p.lat, p.lon, 2.2e6);
        this.showMsg(`飞往 ${p.code} ${p.name}`);
        done();
        break;
      }
      case 'mega': {
        const m = r.mega;
        if (!Number.isFinite(m.lat)) { this.showMsg('巨构选址尚未载入。', 'error'); break; }
        ui.app.state.select({ type: 'mega', id: m.id, part: null, lat: m.lat, lon: m.lon });
        nav.flyTo(nav.lookAtPose(m.lat, m.lon, nav.groundHeight(m.lat, m.lon), { range: 90000, elevDeg: 38, heading: 0, lens: 35 }));
        this.showMsg(`飞往 ${m.id} ${m.name}`);
        done();
        break;
      }
      case 'bookmark':
        nav.gotoBookmark(r.bookmark);
        this.showMsg(`前往书签「${r.bookmark.name || r.bookmark.id}」`);
        done();
        break;
      case 'known':
      case 'building': {
        const want = r.kind === 'known' ? String(r.spec.id) : r.id;
        this.showMsg(`查找 ${want}…`);
        const slow = setTimeout(() => this.showMsg(`正在按 ID 重建 ${want} 所在街区，首次查找需要多等一会儿…`), 1500);
        const spec = r.spec || await nav.lookupBuilding(want);
        clearTimeout(slow);
        if (!spec) {
          const bm = ui.userBookmarks.forBuilding(r.id);
          if (bm) { nav.gotoBookmark(bm, { select: false }); this.showMsg(`没有读到 ${r.id} 的建筑记录，已按书签回到存下的机位。`); done(); break; }
          this.showMsg(`没有这个建筑 ID：${r.id}。请核对大小写与连字符，或在下方附近建筑清单里查找。`, 'error');
          break;
        }
        ui.app.state.select({ type: 'building', id: spec.id || r.id, spec });
        const label = `${useName(spec.use)} ${spec.id}`;
        this.showMsg(`飞往 ${label}…`);
        done();   // (phones: the drawer closes before the flight so the view is free)
        await nav.revisitBuilding(spec);
        this.showMsg(`已定位 ${label}`);
        if (!ui.drawer.isOpen || ui.drawer.tab !== 'search') ui.toast.show(`已定位 ${label}`);
        break;
      }
      default: break;
    }
  }

  // --- nearby buildings --------------------------------------------------------------------
  listFilterText() {
    const text = this.input.value.trim();
    if (!text) return '';
    const top = this.results[0];
    if (top && top.kind !== 'building') return '';
    return text;
  }

  refreshNearby(force) {
    const f = this.ui.app.frame;
    if (!f) return;
    const agl = Number.isFinite(f.camAltGround) ? f.camAltGround : f.camAlt;
    if (agl > LIST_ALT) return;
    const key = `${f.camLat.toFixed(3)},${f.camLon.toFixed(3)}`;
    if (!force && key === this._near.ensured) return;
    this._near.ensured = key;
    this.ui.buildingIndex.ensureAround(f.camLat, f.camLon, 1).then(() => { this._near.dirty = true; });
    this._near.dirty = true;
  }

  update(frame) {
    const N = this._near;
    const now = performance.now();
    if (now - N.t < 250) return;
    const agl = Number.isFinite(frame.camAltGround) ? frame.camAltGround : frame.camAlt;
    const far = agl > LIST_ALT;
    const q = this.listFilterText();
    const moved = !Number.isFinite(N.lat) || greatCircleDistance(N.lat, N.lon, frame.camLat, frame.camLon) > 120;
    if (!N.dirty && !moved && q === N.q && far === N.far) return;
    N.t = now; N.dirty = false; N.q = q; N.far = far; N.lat = frame.camLat; N.lon = frame.camLon;
    if (moved && !far) this.refreshNearby(false);
    this.renderNearby(frame, far, q);
  }

  renderNearby(frame, far, q) {
    clear(this.blist);
    this.exportBtn.disabled = far;
    this.refreshBtn.disabled = far;
    if (far) {
      setText(this.bcount, '');
      setText(this.bnote, `下降到离地 ${LIST_ALT / 1000} km 以内时，这里会列出相机附近 ${fmtLength(LIST_RADIUS)} 内的每一栋建筑：ID、用途、地块与距离。`);
      this.bnote.hidden = false;
      return;
    }
    const idx = this.ui.buildingIndex;
    const rows = idx.nearby(frame.camLat, frame.camLon, { text: q, maxDist: LIST_RADIUS });
    this._rows = rows;
    const cov = idx.coverage(frame.camLat, frame.camLon, 1);
    setText(this.bcount, rows.length ? `${rows.length}` : '');
    if (!rows.length) {
      const loading = idx.busy || cov.have < cov.total;
      setText(this.bnote, loading ? '正在载入附近地块…' : q ? `附近没有匹配「${q}」的建筑。` : '附近没有已建成的建筑。');
      this.bnote.hidden = false;
      return;
    }
    this.bnote.hidden = cov.have >= cov.total;
    if (!this.bnote.hidden) setText(this.bnote, '正在载入更多地块…');
    const sel = this.ui.app.state.selection;
    const selId = sel?.type === 'building' ? (sel.id ?? sel.spec?.id) : null;
    const MAX = 160;
    for (const { spec, dist } of rows.slice(0, MAX)) {
      const H = buildingHeight(spec);
      const btn = h('button', { type: 'button', class: 'mui-bl-item', 'aria-current': spec.id === selId ? 'true' : null },
        h('span', { class: 'mui-bl-top' }, h('span', { class: 'mui-bl-use' }, useName(spec.use)), h('span', { class: 'mui-bl-id mui-mono' }, String(spec.id)), h('span', { class: 'mui-bl-dist mui-num' }, fmtLength(dist))),
        h('span', { class: 'mui-bl-meta' }, [provinceCodeOf(spec), plotId(spec) ? `地块 ${plotId(spec)}` : null, spec.floors ? `${spec.floors} 层` : null, Number.isFinite(H) ? fmtLength(H) : null].filter(Boolean).join('   ')));
      btn.addEventListener('click', () => {
        this.ui.app.state.select({ type: 'building', id: spec.id, spec });
        this.ui.nav.focusBuilding(spec);
        if (this.ui.isNarrow()) this.ui.drawer.close();
      });
      this.blist.append(h('li', null, btn));
    }
    if (rows.length > MAX) this.blist.append(h('li', { class: 'mui-note' }, `另有 ${rows.length - MAX} 栋，导出 CSV 可查看全部。`));
  }

  exportCsv() {
    const f = this.ui.app.frame;
    if (!f) return;
    const rows = this.ui.buildingIndex.nearby(f.camLat, f.camLon, { text: this.listFilterText(), maxDist: LIST_RADIUS });
    if (!rows.length) { this.ui.toast.show('附近没有可导出的建筑'); return; }
    const name = `mars-buildings_${Math.abs(f.camLat).toFixed(4)}${f.camLat >= 0 ? 'N' : 'S'}_${Math.abs(f.camLon).toFixed(4)}${f.camLon >= 0 ? 'E' : 'W'}.csv`;
    downloadText('﻿' + BuildingIndex.csv(rows), name, 'text/csv');
    this.ui.toast.show(`已导出 ${rows.length} 栋建筑`);
  }
}
