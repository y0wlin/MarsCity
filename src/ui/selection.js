// Selection panel: location (lat/lon/height + province card), building (ID, province, plot, use,
// floors, orientation, entrances, year, occupancy + actions) and megastructure. OWNER: ui agent.
import { h, iconButton, button, clear, copyText } from './dom.js';
import { icon } from './icons.js';
import { kv } from './widgets.js';
import { PROVINCES, ZONES, MEGASTRUCTURES, provinceByCode } from '../data/provinces.js';
import { PROVINCE_CODES, WORLD_VERSION, SEED } from '../core/constants.js';
import { greatCircleDistance } from '../core/geo.js';
import {
  fmtLat, fmtLon, fmtLength, fmtFacing, useName, buildingHeight, plotId, blockId, entranceGroups, occupancyRow,
  roofText, roundPose, buildingClassText, viewButtons, viewLabel,
} from './format.js';
import { selectionBuildingId } from './nav.js';
import { provinceAt, zoneAt } from '../data/controlMaps.js';

/** resolves p's value, or undefined after `ms` (p keeps running) */
function withTimeout(p, ms) {
  let timer = 0;
  return Promise.race([Promise.resolve(p), new Promise((res) => { timer = setTimeout(() => res(undefined), ms); })]).finally(() => clearTimeout(timer));
}

/** province of a picked location: the pick's own value when valid, else the exact map lookup */
function provinceOfLocation(sel) {
  if (Number.isFinite(sel.province) && PROVINCES[sel.province]) return PROVINCES[sel.province];
  if (typeof sel.province === 'string') { const p = provinceByCode(sel.province); if (p) return p; }
  try { return PROVINCES[provinceAt(sel.lat, sel.lon)] || null; } catch { return null; }
}

function provinceOf(spec) {
  if (!spec) return null;
  if (Number.isFinite(spec.province) && PROVINCES[spec.province]) return PROVINCES[spec.province];
  return provinceByCode(spec.provinceCode || PROVINCE_CODES[spec.province]) || null;
}

export class SelectionPanel {
  constructor(ui) {
    this.ui = ui;
    this.token = 0;
    this.sel = null;
    this.spec = null;
    this.collapsed = false;
    this.views = null;        // viewpoint buttons of the shown building {id, use, spec, key, grid, btns}
    this.viewPending = null;  // {id, name} while a buildingView flight runs
    this._viewToken = 0;
    this._n = 0;
    this.el = h('section', { class: 'mui-sel mui-panel', 'aria-label': '选中对象', hidden: true });
    ui.app.events.on('select', (sel) => this.show(sel));
  }

  hide() {
    this.sel = null;
    this.spec = null;
    this.views = null;
    this.el.hidden = true;
    clear(this.el);
    this.ui.root.classList.remove('mui-has-sel');
    this.ui._rectsDirty = true;
  }

  async show(sel) {
    const token = ++this.token;
    if (!sel) { this.hide(); return; }
    this.sel = sel;
    this.views = null;   // renderBuilding builds them again
    const bid = selectionBuildingId(sel);
    if (bid) {
      let spec = sel.spec || null;
      if (!spec) {
        this.render(this.header('building', '建筑', bid), h('p', { class: 'mui-note' }, '读取建筑信息…'));
        spec = await this.ui.nav.lookupBuilding(bid);
        if (token !== this.token) return;
      }
      this.spec = spec;
      if (!spec) { this.render(this.header('building', '建筑', bid), h('p', { class: 'mui-note', 'data-kind': 'error' }, `找不到建筑 ${bid} 的记录。`)); return; }
      this.renderBuilding(spec, sel);
    } else if (sel.type === 'mega') this.renderMega(sel);
    else if (sel.type === 'location' || (Number.isFinite(sel.lat) && Number.isFinite(sel.lon))) this.renderLocation(sel);
    else this.hide();
  }

  render(...kids) {
    clear(this.el);
    this.el.append(...kids);
    this.el.hidden = false;
    this.el.classList.toggle('is-collapsed', this.collapsed);
    this.ui.root.classList.add('mui-has-sel');
    this.ui._rectsDirty = true;
  }

  header(ic, title, sub, subMono = false) {
    const toggle = iconButton('chevron', this.collapsed ? '展开' : '收起', { tip: false, cls: 'mui-ibtn-sm mui-sel-toggle', attrs: { 'aria-expanded': String(!this.collapsed) } });
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.el.classList.toggle('is-collapsed', this.collapsed);
      toggle.setAttribute('aria-expanded', String(!this.collapsed));
      toggle.setAttribute('aria-label', this.collapsed ? '展开' : '收起');
    });
    return h('header', { class: 'mui-sel-head' },
      h('span', { class: 'mui-sel-ico' }, icon(ic, 18)),
      h('div', { class: 'mui-sel-titles' }, h('h2', { class: 'mui-sel-title' }, title), sub ? h('div', { class: `mui-sel-sub${subMono ? ' mui-mono' : ''}` }, sub) : null),
      toggle,
      iconButton('close', '取消选择', { tip: '取消选择  Esc', cls: 'mui-ibtn-sm', onclick: () => this.ui.app.state.select(null) }));
  }

  provinceCard(p, zone) {
    if (!p) return h('div', { class: 'mui-prov', 'data-zone': zone || 'Z' }, h('div', { class: 'mui-prov-head' }, h('span', { class: 'mui-prov-name' }, '未知省域')));
    return h('div', { class: 'mui-prov', 'data-zone': p.zone },
      h('div', { class: 'mui-prov-head' },
        h('span', { class: 'mui-code', 'data-zone': p.zone }, p.code),
        h('span', { class: 'mui-prov-name' }, p.name),
        h('span', { class: 'mui-prov-zone' }, ZONES[p.zone]?.name || '')),
      h('p', { class: 'mui-prov-form' }, p.form),
      h('p', { class: 'mui-prov-night' }, icon('moon', 14), h('span', null, p.night)));
  }

  copyBtn(text, label) {
    return iconButton('copy', label, { tip: label, cls: 'mui-ibtn-sm', onclick: async () => { const ok = await copyText(text); this.ui.toast.show(ok ? `已复制 ${text}` : '无法访问剪贴板', { kind: ok ? 'info' : 'error' }); } });
  }

  // --- location -----------------------------------------------------------------------------
  renderLocation(sel) {
    const nav = this.ui.nav;
    const lat = sel.lat, lon = sel.lon;
    const hgt = Number.isFinite(sel.h) ? sel.h : nav.groundHeight(lat, lon);
    const p = provinceOfLocation(sel);
    let zone = sel.zone;
    if (zone !== 'O' && zone !== 'Z') { try { zone = zoneAt(lat, lon); } catch { zone = p?.zone || 'Z'; } }
    const coordText = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const body = h('div', { class: 'mui-sel-body' },
      h('div', { class: 'mui-sel-coords' },
        h('span', { class: 'mui-num' }, `${fmtLat(lat, 5)}  ${fmtLon(lon, 5)}`),
        this.copyBtn(coordText, '复制坐标')),
      kv([['海拔', fmtLength(hgt), 'mui-num'], ['距离', Number.isFinite(sel.distance) ? fmtLength(sel.distance) : null, 'mui-num']]),
      this.provinceCard(p, zone));
    const actions = h('div', { class: 'mui-actions' },
      button('飞往此处', { iconName: 'pin', cls: 'mui-btn-primary', attrs: { 'data-tip': '离地 3 km 斜看', 'data-tip-pos': 'top' }, onclick: () => nav.flyToLocation(lat, lon, hgt) }),
      button('区域俯瞰', { iconName: 'region', onclick: () => nav.regionView(lat, lon) }),
      button('设为书签', { iconName: 'bookmark', onclick: () => this.bookmarkLocation(lat, lon, hgt, p) }));
    this.render(this.header('pin', '地点', p ? `${p.code} ${p.name}` : null), body, actions);
  }

  bookmarkLocation(lat, lon, hgt, p) {
    const nav = this.ui.nav, app = this.ui.app;
    const cur = nav.pose();
    const f = app.frame;
    let pose = cur;
    // keep the framing the user made when the camera is already near; otherwise store the 3 km view
    const near = cur && f && (f.camAltGround ?? cur.alt) < 30000 && greatCircleDistance(cur.lat, cur.lon, lat, lon) < 40000;
    if (!near) {
      const range = 3000 / Math.sin(40 * Math.PI / 180);
      pose = nav.lookAtPose(lat, lon, hgt, { range, elevDeg: 40, heading: 0, lens: 35 });
    }
    const name = `${p ? `${p.code} ${p.name}` : '地点'}  ${fmtLat(lat, 3)} ${fmtLon(lon, 3)}`;
    const bm = this.ui.userBookmarks.add({ name, group: 'user', pose: roundPose(pose), solTime: +app.state.solTime.toFixed(4), subsolarLat: app.state.subsolarLat, mode: 'orbit' });
    this.ui.toast.show(`已存为书签「${bm.name}」`);
  }

  // --- building -----------------------------------------------------------------------------
  renderBuilding(spec, sel) {
    const nav = this.ui.nav;
    const id = String(spec.id ?? selectionBuildingId(sel));
    const p = provinceOf(spec);
    const H = buildingHeight(spec);
    const floors = spec.floors ? `${spec.floors} 层${spec.basement ? `  地下 ${spec.basement} 层` : ''}` : null;
    const groups = entranceGroups(spec.entrances);
    const ents = groups.length
      ? h('ul', { class: 'mui-ents' }, ...groups.slice(0, 7).map((t) => h('li', null, t)), groups.length > 7 ? h('li', null, `另有 ${groups.length - 7} 类`) : null)
      : null;
    const fp = spec.footprint;
    const fpText = fp && Number.isFinite(fp.w) && Number.isFinite(fp.d) ? `${fp.w.toFixed(1)} × ${fp.d.toFixed(1)} m` : null;
    const block = blockId(spec);
    // the block id usually embeds the district id; only add the district when it carries new information
    const district = spec.district != null ? String(spec.district) : null;
    const blockText = [block, district && !(block != null && String(block).includes(district)) ? `片区 ${district}` : null].filter(Boolean).join('   ');

    const body = h('div', { class: 'mui-sel-body' },
      h('div', { class: 'mui-sel-id' },
        h('span', { class: 'mui-mono mui-sel-idtext', title: id }, id),
        this.copyBtn(id, '复制 ID')),
      this.provinceLine(p, spec.zone),
      this.viewsBlock(spec, id),
      kv([
        ['地块', plotId(spec), 'mui-mono'],
        ['街区', blockText || null, 'mui-mono'],
        ['层数', floors],
        ['高度', Number.isFinite(H) ? fmtLength(H) : null, 'mui-num'],
        ['朝向', Number.isFinite(spec.heading) ? fmtFacing(spec.heading) : null, 'mui-num'],
        ['占地', fpText, 'mui-num'],
        ['屋面', roofText(spec.roof ?? spec.roofType, spec.meta?.roofKind)],
        ['入口', ents],
        ['建成', Number.isFinite(spec.yearBuilt) ? `${spec.yearBuilt} 年` : null, 'mui-num'],
        occupancyRow(spec.occupancy, spec.use),
        ['坐标', `${fmtLat(spec.lat, 5)}  ${fmtLon(spec.lon, 5)}`, 'mui-num'],
        ['距离', Number.isFinite(sel.distance) ? fmtLength(sel.distance) : null, 'mui-num'],
      ]));
    const actions = h('div', { class: 'mui-actions' },
      button('环看', { iconName: 'orbit', cls: 'mui-btn-primary', onclick: () => nav.focusBuilding(spec) }),
      button('进入', { iconName: 'enter', onclick: () => nav.enterBuilding(spec) }),
      button('回到轨道', { iconName: 'globe', attrs: { 'data-tip': '升到同一经纬度的轨道视角', 'data-tip-pos': 'top' }, onclick: () => nav.orbitAbove(spec.lat, spec.lon) }),
      button('复制 ID', { iconName: 'copy', onclick: async () => { const ok = await copyText(id); this.ui.toast.show(ok ? `已复制 ${id}` : '无法访问剪贴板'); } }),
      button('存书签', { iconName: 'bookmark', onclick: () => this.bookmarkBuilding(spec, id) }));
    this.render(this.header('building', useName(spec.use), buildingClassText(spec)), body, actions);
  }

  // --- building viewpoints (§5 07: 街对面 / 入口 / 门厅 / 楼梯 / 起居室 / 后院 / 屋顶) ---------------
  /**
   * Eye-level viewpoint buttons: the names controls.buildingViews(id) knows (refreshed while the panel
   * is open: the list appears once the building's focus data / anchors are loaded), the standard set
   * until then. A click flies there through controls.buildingView (walk mode where a floor carries
   * the eye); the button of the viewpoint the camera stands at stays pressed until it moves.
   */
  viewsBlock(spec, id) {
    const grid = h('div', { class: 'mui-views', role: 'group', 'aria-label': '人眼视点' });
    const box = h('div', { class: 'mui-views-box' },
      h('div', { class: 'mui-views-head' }, h('h3', { class: 'mui-views-title' }, '人眼视点'), h('span', { class: 'mui-k' }, '眼高 1.65 m，到达后可继续步行')),
      grid);
    this.views = { id: String(id), use: spec.use, spec, key: null, grid, btns: new Map() };
    this._fillViews(this.ui.nav.buildingViewNames(id));
    return box;
  }

  _fillViews(names) {
    const V = this.views;
    if (!V) return;
    const key = names ? names.join(',') : '*';
    if (key === V.key) return;
    V.key = key;
    clear(V.grid);
    V.btns.clear();
    for (const v of viewButtons(names, V.use)) {
      // native title: CSS tooltips would be clipped by the scrolling panel body
      const b = h('button', {
        type: 'button', class: 'mui-view', 'data-view': v.name, title: v.tip, 'aria-pressed': 'false', onclick: () => this.goView(v),
      }, h('span', { class: 'mui-view-label' }, v.label));
      V.btns.set(v.name, b);
      V.grid.append(b);
    }
    // §5 07 保存视点 / §5 template 独立书签: every viewpoint of this building as its own user bookmark
    V.saveBtn = h('button', {
      type: 'button', class: 'mui-view mui-view-save', title: '把这栋楼的每个人眼视点各存成一个书签：逐个到达并记下实际眼位，之后按建筑 ID 与视点复访', onclick: () => this.saveAllViews(),
    }, icon('bookmark', 14), h('span', { class: 'mui-view-label' }, '存视点'));
    V.grid.append(V.saveBtn);
    V.grid.dataset.provisional = names ? 'false' : 'true';
    this._paintViews();
  }

  /**
   * "存视点" (§5 07 保存视点 / §5 template 独立书签 / §6 抽查 4 保存退出再回访): one user bookmark per
   * viewpoint of this building, {buildingId, view}, so revisits go through controls.buildingView (the
   * asset's own anchor, right storey). Fix round 3 (UI3, QP-02): the stored pose is each view's ACTUALLY
   * RESOLVED eye — the controls' resolved request r.requested {lat, lon, alt}, the rig's heading / pitch /
   * lens at the arrival and the mode it entered ('walk' on a floor) — never a generic three-quarter /
   * entrance stand-in: it is the pose a cold revisit lands on when the anchors are not ready in time
   * (controls CT1) and App.applyBookmark's last resort. Views reached from this panel in the last minutes
   * reuse that arrival; the others are visited now, one after the other (instant jumps, no back entries,
   * progress toast), then the camera returns to where it was. Visitor input (or another camera request)
   * stops the tour and keeps the camera there; the views resolved so far are saved. Views already saved
   * for this building, and fallbacks onto a view resolved / saved already, are skipped.
   */
  async saveAllViews() {
    const V = this.views;
    if (!V) return 0;
    const ui = this.ui, app = ui.app, nav = ui.nav, toast = ui.toast;
    if (this._savingViews) { toast.show('正在逐个解析视点，请稍候…', { kind: 'loading', key: 'save-views', timeout: 90000 }); return 0; }
    const { spec, id, use } = V;
    const savedViews = () => new Set(ui.userBookmarks.all().filter((b) => b.buildingId === id && b.view).map((b) => b.view));
    let have = savedViews();
    const token = ++this._viewToken;
    this._savingViews = { id };
    this._paintViews();
    let start = null;             // where the camera was right before the first jump (restored at the end)
    const resolved = new Map();   // view used -> nav.recordView record
    const missing = [];           // buttons the building has no view for
    let interrupted = null, timedOut = false, visited = 0;
    try {
      // the building's own viewpoint list (until its anchors are known only the provisional standard set)
      let names = nav.buildingViewNames(id);
      if (!names) {
        toast.show('正在读取这栋楼的视点…', { kind: 'loading', key: 'save-views', timeout: 90000 });
        names = await this._awaitViewNames(id, spec, 12000);
        if (token !== this._viewToken) interrupted = 'superseded';
      }
      let known = !!names;
      let queue = interrupted ? [] : viewButtons(names, use).filter((v) => !have.has(v.name));
      const tried = new Set();
      while (queue.length) {
        const v = queue.shift();
        tried.add(v.name);
        if (have.has(v.name) || resolved.has(v.name)) continue;
        let rec = nav.resolvedView(id, v.name);
        if (!rec) {
          if (!start) start = nav.snapshot();
          visited++;
          toast.show(`存视点 ${visited}/${visited + queue.length}：到达「${v.label}」并记下眼位`, { kind: 'loading', key: 'save-views', timeout: 90000 });
          this.viewPending = { id, name: v.name };
          this._paintViews();
          const r = await withTimeout(nav.buildingView(spec, v.name, { instant: true, pushBack: false }), 75000);
          if (token !== this._viewToken) { interrupted = (r && r.interrupted) || 'superseded'; break; }
          if (r === undefined) { timedOut = true; break; }
          // {arrived:false, interrupted}: visitor input or another camera request took over
          if (r && typeof r === 'object' && !r.arrived) { interrupted = r.interrupted || 'interrupted'; break; }
          rec = r ? nav.recordView(id, v.name, r) : null;
          if (!rec) { missing.push(v.label); continue; }   // false: the building has no such view
        }
        if (!have.has(rec.view) && !resolved.has(rec.view)) resolved.set(rec.view, rec);
        // after the first arrival the controls know the building's own list: follow it from here
        if (!known) {
          const n2 = nav.buildingViewNames(id);
          if (n2) {
            known = true;
            queue = viewButtons(n2, use).filter((w) => !tried.has(w.name) && !have.has(w.name) && !resolved.has(w.name));
          }
        }
      }
    } catch (e) {
      console.warn('[ui] saving the viewpoints failed', e);
      interrupted = interrupted || 'error';
    }
    // back to where the visitor was, unless someone else took the camera meanwhile
    if (visited && start && !interrupted) {
      toast.show('回到原来的位置…', { kind: 'loading', key: 'save-views', timeout: 90000 });
      await nav.restore(start);
    }
    have = savedViews();
    let n = 0;
    for (const rec of resolved.values()) {
      if (have.has(rec.view)) continue;
      ui.userBookmarks.add({
        name: `${useName(use)} ${id} ${viewLabel(rec.view, use)}`, group: 'user', pose: rec.pose,
        solTime: +app.state.solTime.toFixed(4), subsolarLat: app.state.subsolarLat, mode: rec.mode || 'walk',
        buildingId: id, use: use || undefined, view: rec.view, viewLens: rec.pose.lens || undefined, viewSet: true,
        world: WORLD_VERSION, seed: SEED,
      });
      have.add(rec.view);
      n++;
    }
    if (this._savingViews && this._savingViews.id === id) this._savingViews = null;
    if (token === this._viewToken) this.viewPending = null;
    this._paintViews();
    toast.dismiss('save-views');
    const lack = missing.length ? `；这栋楼没有「${missing.slice(0, 3).join('」「')}」${missing.length > 3 ? '等' : ''}视点` : '';
    let msg;
    if (timedOut) msg = n ? `视点解析超时：已存 ${n} 个，稍后再按「存视点」补存其余视点` : '视点解析超时，没有存下新的视点，请稍后再试';
    else if (interrupted) msg = n ? `已存 ${n} 个视点；镜头被接管，再按「存视点」可补存其余视点` : '存视点已中断，没有存下新的视点';
    else msg = n ? `已把 ${n} 个视点按实际眼位存为书签，见书签面板「我的书签」${lack}` : `这栋楼的视点都已存为书签${lack}`;
    toast.show(msg, { kind: timedOut ? 'error' : 'info', timeout: 4200 });
    return n;
  }

  /**
   * Wait (≤ ms) until the controls know building `id`'s own viewpoint list: getFocusInfo caches its focus
   * data, then buildingViews polls refresh it with the building's anchors in the background. null if not.
   */
  async _awaitViewNames(id, spec, ms) {
    const nav = this.ui.nav, c = nav.controls;
    const t0 = performance.now();
    if (c && typeof c.getFocusInfo === 'function') {
      try { await withTimeout(Promise.resolve(c.getFocusInfo(id, spec)), ms); } catch { /* unknown building */ }
    }
    while (performance.now() - t0 < ms) {
      const n = nav.buildingViewNames(id);
      if (n) return n;
      await new Promise((r) => setTimeout(r, 300));
    }
    return nav.buildingViewNames(id);
  }

  _paintViews() {
    const V = this.views;
    if (!V) return;
    const at = this.ui.nav.currentView();
    const cur = at && at.id === V.id ? at.view : null;
    const pend = this.viewPending && this.viewPending.id === V.id ? this.viewPending.name : null;
    // a fallback view (living → interior) that has no button of its own lights the one that asked for it
    const lit = cur && !V.btns.has(cur) && at.asked && V.btns.has(at.asked) ? at.asked : cur;
    for (const [name, b] of V.btns) {
      const on = name === lit;
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-busy', name === pend);
    }
    if (V.saveBtn) {
      const busy = !!(this._savingViews && this._savingViews.id === V.id);
      V.saveBtn.classList.toggle('is-busy', busy);
      if (busy) V.saveBtn.setAttribute('aria-busy', 'true'); else V.saveBtn.removeAttribute('aria-busy');
    }
  }

  async goView(v) {
    const V = this.views;
    if (!V) return;
    const { id, spec, use } = V;
    const token = ++this._viewToken;
    this.viewPending = { id, name: v.name };
    this._paintViews();
    let r = null;
    try { r = await this.ui.nav.buildingView(spec, v.name); } catch { r = false; }
    if (token !== this._viewToken) return;
    this.viewPending = null;
    if (r === false || r == null) this.ui.toast.show(`这栋楼没有「${v.label}」视点`);
    else if (r.arrived) {
      const used = r.view || v.name;
      // the eye this view actually resolved to ("存视点" stores it instead of visiting it again)
      this.ui.nav.recordView(id, v.name, r);
      this.ui.nav.markView(id, used, v.name);
      if (used !== v.name && viewLabel(used, use) !== v.label) this.ui.toast.show(`没有「${v.label}」机位，已改到「${viewLabel(used, use)}」`);
    }
    this._paintViews();
  }

  /** per frame (UI update): refresh the viewpoint list / pressed state a few times per second */
  update() {
    if (!this.views || this.el.hidden) return;
    if ((this._n++ % 15) !== 0) return;
    this._fillViews(this.ui.nav.buildingViewNames(this.views.id));
    this._paintViews();
  }

  provinceLine(p, zone) {
    if (!p) return null;
    return h('div', { class: 'mui-sel-prov' },
      h('span', { class: 'mui-code', 'data-zone': p.zone || zone }, p.code),
      h('span', null, p.name),
      h('span', { class: 'mui-k' }, ZONES[p.zone || zone]?.name || ''));
  }

  bookmarkBuilding(spec, id) {
    const app = this.ui.app, nav = this.ui.nav;
    const cur = nav.pose();
    const far = !cur || greatCircleDistance(cur.lat, cur.lon, spec.lat, spec.lon) > 3000 || cur.alt - (spec.ground?.entrance ?? 0) > 5000;
    const pose = far ? nav.buildingViewPose(spec) : cur;
    const bm = this.ui.userBookmarks.add({
      name: `${useName(spec.use)} ${id}`, group: 'user', pose: roundPose(pose), solTime: +app.state.solTime.toFixed(4),
      subsolarLat: app.state.subsolarLat, mode: far ? 'orbit' : app.state.mode, buildingId: id,
    });
    this.ui.toast.show(`已存为书签「${bm.name}」，按 ID 搜索即可回访`);
  }

  // --- megastructure -------------------------------------------------------------------------
  renderMega(sel) {
    const nav = this.ui.nav;
    const m = MEGASTRUCTURES.find((x) => x.id === sel.id) || { id: sel.id, name: '巨构', province: '' };
    const p = provinceByCode(m.province);
    const lat = Number.isFinite(sel.lat) ? sel.lat : null, lon = Number.isFinite(sel.lon) ? sel.lon : null;
    const go = (pose) => nav.flyTo(pose);
    const resolveSite = async () => {
      if (lat != null) return { lat, lon };
      try {
        const mod = await import('../world/sites.js');
        const s = Object.values(mod.SITES || {}).find((x) => x.id === m.id);
        return s && Number.isFinite(s.lat) ? { lat: s.lat, lon: s.lon } : null;
      } catch { return null; }
    };
    const part = sel.part == null ? null : typeof sel.part === 'object' ? (sel.part.name || sel.part.kind || sel.part.id || null) : String(sel.part);
    const body = h('div', { class: 'mui-sel-body' },
      this.provinceLine(p, p?.zone),
      kv([
        ['用途', m.serves === 'city' ? '港区防护与通航' : m.serves === 'water' ? '流域调蓄与灌溉' : null],
        ['部件', part],
        ['坐标', lat != null ? `${fmtLat(lat, 4)}  ${fmtLon(lon, 4)}` : null, 'mui-num'],
      ]));
    const actions = h('div', { class: 'mui-actions' },
      button('飞往', { iconName: 'target', cls: 'mui-btn-primary', onclick: async () => { const s = await resolveSite(); if (s) go(nav.lookAtPose(s.lat, s.lon, nav.groundHeight(s.lat, s.lon), { range: 90000, elevDeg: 38, heading: 0, lens: 35 })); } }),
      button('回到轨道', { iconName: 'globe', onclick: async () => { const s = await resolveSite(); if (s) nav.orbitAbove(s.lat, s.lon); } }));
    this.render(this.header('target', m.name, `${m.id}  巨构`), body, actions);
  }

  /** used by labels: what to show above the selected building */
  labelInfo() {
    const sel = this.sel;
    const bid = selectionBuildingId(sel);
    if (!bid) return null;
    const spec = this.spec || sel.spec;
    if (!spec || !Number.isFinite(spec.lat)) return null;
    return { id: String(spec.id ?? bid), spec, text: useName(spec.use) };
  }
}

