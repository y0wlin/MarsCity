// 书签 panel: the shot cards of §5 grouped by shot (01–09, each with its sub-frames, names, notes,
// lens and local time), the four-longitude day/night turntable (§6.2), the §6 acceptance viewpoints
// (验收视点: app/bookmarks.js CHECKS, grouped by level — district / street / four facades / roof / cold start /
// megastructure) and user bookmarks (save the current view with pose + time + selected building + mode +
// building viewpoint, edit name / note, delete with undo, export / import JSON). OWNER: ui agent.
import { h, iconButton, button, clear, downloadText, pickFile } from '../dom.js';
import { section } from '../widgets.js';
import { SHOTS, TURNTABLE, CHECKS } from '../../app/bookmarks.js';
import { PROVINCES } from '../../data/provinces.js';
import { provinceAt } from '../../data/controlMaps.js';
import { WORLD_VERSION, SEED } from '../../core/constants.js';
import {
  fmtLat, fmtLon, fmtLength, fmtHM, roundPose, useName, MODE_NAMES, splitShotName, groupShots, bookmarkFacts, viewLabel,
  localTime, groupChecks,
} from '../format.js';

/** the §6 acceptance viewpoints (core may not have them in older builds) */
const CHECK_LIST = Array.isArray(CHECKS) ? CHECKS : [];
import { selectionBuildingId } from '../nav.js';

function turntableLabel(bm) {
  const lon = bm.pose?.lon ?? 0;
  if (Math.abs(lon) < 1e-6) return '0°';
  if (Math.abs(Math.abs(lon) - 180) < 1e-6) return '180°';
  return `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
}

/** user-visible note text (bookmarks store it as `note`) */
const noteOf = (bm) => (bm && typeof bm.note === 'string' ? bm.note.trim() : '');

export class BookmarksPanel {
  constructor(ui) {
    this.ui = ui;
    this.id = 'bookmarks';
    this.title = '书签';
    this.activeId = null;
    this.editing = null;

    this.shots = h('ol', { class: 'mui-shots', 'aria-label': '镜头卡' });
    this.turntable = h('div', { class: 'mui-turntable', role: 'group', 'aria-label': '昼夜转台：中央经线' });
    this.ttNote = h('p', { class: 'mui-note' });
    this.checks = h('ol', { class: 'mui-checks', 'aria-label': '验收视点' });
    this.userList = h('ul', { class: 'mui-ulist', 'aria-label': '我的书签' });
    this.empty = h('p', { class: 'mui-empty' }, '还没有自己的书签。存下当前视角后可以随时一键回到这里：位姿、时间、相机模式，以及选中建筑的 ID 与所在视点都会记住。');
    this.userCount = h('span', { class: 'mui-sec-count mui-num' });

    const addBtn = button('存当前视角', { iconName: 'plus', cls: 'mui-btn-quiet', onclick: () => this.addCurrent(), title: '记下位姿、时间、模式与选中建筑' });
    this.el = h('div', { class: 'mui-pane mui-pane-bookmarks' },
      section('镜头', { action: h('span', { class: 'mui-sec-count mui-num' }, `${SHOTS.length} 个机位`) }, this.shots),
      section('昼夜转台', {}, this.turntable, this.ttNote),
      CHECK_LIST.length ? section('验收视点', { action: h('span', { class: 'mui-sec-count mui-num' }, `${CHECK_LIST.length} 个视点`) },
        h('p', { class: 'mui-note mui-checks-note' }, '§6「网页可复现」要留的实拍机位：区级、街级、建筑四面与屋顶，另有冷启动与港池复查。轨道见镜头 01、02，室内见镜头 07。'),
        this.checks) : null,
      section('我的书签', { action: h('div', { class: 'mui-sec-actions' }, this.userCount, addBtn) }, this.userList, this.empty,
        h('div', { class: 'mui-btnrow' },
          button('导出 JSON', { iconName: 'download', cls: 'mui-btn-quiet', onclick: () => this.exportJson() }),
          button('导入 JSON', { iconName: 'upload', cls: 'mui-btn-quiet', onclick: () => this.importJson() }))),
    );

    this.renderShots();
    this.renderTurntable();
    this.renderChecks();
    this.renderUser();
    ui.userBookmarks.onChange(() => this.renderUser());
    ui.app.events.on('goto', (e) => this.setActive(e?.bookmark?.id ?? null));
  }

  focusTarget() { return this.shots.querySelector('button'); }

  setActive(id) {
    this.activeId = id;
    for (const b of this.el.querySelectorAll('[data-bm]')) {
      if (b.dataset.bm === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    for (const g of this.shots.children) g.classList.toggle('is-current', !!(id && g.querySelector(`[data-bm="${CSS.escape(id)}"]`)));
    for (const g of this.checks.children) g.classList.toggle('is-current', !!(id && g.querySelector(`[data-bm="${CSS.escape(id)}"]`)));
  }

  go(bm) {
    this.ui.nav.gotoBookmark(bm);
    this.setActive(bm.id);
    if (this.ui.isNarrow()) this.ui.drawer.close();
  }

  // --- shot cards -------------------------------------------------------------------------
  renderShots() {
    clear(this.shots);
    const groups = groupShots(SHOTS);
    let n = 0;
    for (const g of groups) {
      const main = g.main;
      const isMain = /^S\d{2}$/.test(main.id);
      if (isMain) n++;
      const key = isMain && n <= 9 ? String(n) : null;
      const { sub } = splitShotName(main.name);
      const note = noteOf(main);
      const facts = bookmarkFacts(main);
      const head = h('button', {
        type: 'button', class: 'mui-shot', 'data-bm': main.id, title: [main.name, note].filter(Boolean).join('\n'),
        onclick: () => this.go(main),
      },
      h('span', { class: 'mui-shot-num mui-num', 'aria-hidden': 'true' }, g.num || main.id),
      h('span', { class: 'mui-shot-text' },
        h('span', { class: 'mui-shot-title' }, g.title, h('span', { class: 'mui-sr' }, `，镜头 ${g.num || main.id}`)),
        sub ? h('span', { class: 'mui-shot-sub' }, sub) : null,
        note ? h('span', { class: 'mui-shot-note' }, note) : null,
        h('span', { class: 'mui-shot-meta mui-num' }, facts,
          main.buildingId ? h('span', { class: 'mui-mono mui-shot-bid' }, main.buildingId) : null)),
      key ? h('kbd', { 'aria-label': `快捷键 ${key}` }, key) : null);
      const li = h('li', { class: `mui-shotg${g.frames.length ? ' has-frames' : ''}` }, head);
      if (g.frames.length) {
        const ol = h('ol', { class: 'mui-frames', 'aria-label': `${g.title} 的其他定格` });
        for (const f of g.frames) {
          const fs = splitShotName(f.name);
          const fnote = noteOf(f);
          ol.append(h('li', null, h('button', {
            type: 'button', class: 'mui-frame', 'data-bm': f.id, title: [f.name, fnote].filter(Boolean).join('\n'), onclick: () => this.go(f),
          },
          h('span', { class: 'mui-frame-name' }, fs.sub || fs.title),
          fnote ? h('span', { class: 'mui-shot-note' }, fnote) : null,
          h('span', { class: 'mui-frame-meta mui-num' }, bookmarkFacts(f)))));
        }
        li.append(ol);
      }
      this.shots.append(li);
    }
    if (!SHOTS.length) this.shots.append(h('li', { class: 'mui-empty' }, '镜头书签尚未登记。'));
  }

  renderTurntable() {
    clear(this.turntable);
    for (const bm of TURNTABLE) {
      this.turntable.append(h('button', { type: 'button', class: 'mui-tt-btn mui-num', 'data-bm': bm.id, title: bm.name, 'aria-label': bm.name, onclick: () => this.go(bm) }, turntableLabel(bm)));
    }
    const t = TURNTABLE[0];
    this.ttNote.textContent = `四条中央经线同一行星时${t && Number.isFinite(t.solTime) ? ` ${fmtHM(t.solTime)}` : ''}、同一曝光基准，用来比对城市只随地表旋转、昼夜只改变受光与发光。`;
  }

  // --- §6 acceptance viewpoints (验收视点) -----------------------------------------------------
  /** CHECKS grouped by level (区级 / 街级 / 建筑四面 / 建筑屋顶 / 冷启动 / 巨构), one row per viewpoint */
  renderChecks() {
    clear(this.checks);
    let gi = 0;
    for (const g of groupChecks(CHECK_LIST)) {
      const labelId = `mui-chk-${gi++}`;
      const ol = h('ol', { class: 'mui-checkl', 'aria-labelledby': g.level ? labelId : null, 'aria-label': g.level ? null : '验收视点' });
      for (const { bm, title } of g.items) {
        const note = noteOf(bm);
        ol.append(h('li', null, h('button', {
          type: 'button', class: 'mui-shot mui-check', 'data-bm': bm.id, title: [bm.name, note].filter(Boolean).join('\n'), onclick: () => this.go(bm),
        },
        h('span', { class: 'mui-shot-num mui-num', 'aria-hidden': 'true' }, bm.id),
        h('span', { class: 'mui-shot-text' },
          h('span', { class: 'mui-shot-title' }, title, h('span', { class: 'mui-sr' }, `，验收视点 ${bm.id}`)),
          note ? h('span', { class: 'mui-shot-note' }, note) : null,
          h('span', { class: 'mui-shot-meta mui-num' }, bookmarkFacts(bm),
            bm.buildingId ? h('span', { class: 'mui-mono mui-shot-bid' }, bm.buildingId) : null)))));
      }
      this.checks.append(h('li', { class: 'mui-checkg' }, g.level ? h('div', { class: 'mui-checkg-title', id: labelId }, g.level) : null, ol));
    }
  }

  // --- user bookmarks ---------------------------------------------------------------------
  renderUser() {
    if (this.editing) return;   // the inline editor is open: re-render when it closes
    clear(this.userList);
    const list = this.ui.userBookmarks.all();
    this.empty.hidden = list.length > 0;
    this.userCount.textContent = list.length ? String(list.length) : '';
    for (const bm of list) this.userList.append(this._userItem(bm));
    this.setActive(this.activeId);
  }

  _userItem(bm) {
    const p = bm.pose;
    const where = bm.buildingId
      ? h('span', { class: 'mui-ub-meta' }, h('span', { class: 'mui-mono' }, bm.buildingId), bm.view ? `  ${viewLabel(bm.view, bm.use)}视点` : '')
      : h('span', { class: 'mui-ub-meta mui-num' }, `${fmtLat(p.lat, 3)} ${fmtLon(p.lon, 3)}  ${fmtLength(p.alt)}`);
    const when = [];
    if (Number.isFinite(bm.solTime)) when.push(`当地 ${fmtHM(localTime(p.lon, bm.solTime))}`);
    if (bm.mode && bm.mode !== 'orbit') when.push(MODE_NAMES[bm.mode] || bm.mode);
    const lens = bm.viewLens || p.lens;
    if (lens) when.push(`${+(+lens).toFixed(0)} mm`);
    const stale = bm.world && bm.world !== WORLD_VERSION;
    const note = noteOf(bm);
    const name = h('span', { class: 'mui-ub-name' }, bm.name || bm.id);
    const main = h('button', { type: 'button', class: 'mui-ub-main', 'data-bm': bm.id, title: [bm.name, note].filter(Boolean).join('\n'), onclick: () => this.go(bm) },
      name, where,
      note ? h('span', { class: 'mui-ub-note' }, note) : null,
      h('span', { class: 'mui-ub-time mui-num' }, when.join(' · ')),
      stale ? h('span', { class: 'mui-ub-warn' }, `存于世界版本 ${bm.world}`) : null);
    const li = h('li', { class: 'mui-ub' }, main,
      h('span', { class: 'mui-ub-tools' },
        iconButton('edit', `编辑「${bm.name}」`, { tip: '名称与备注', tipPos: 'top', cls: 'mui-ibtn-sm', onclick: () => this.startEdit(bm, li) }),
        iconButton('trash', `删除「${bm.name}」`, { tip: '删除', tipPos: 'top', cls: 'mui-ibtn-sm', onclick: () => this.remove(bm) })));
    return li;
  }

  /** inline editor: name + note; Enter in the name saves, Esc cancels, leaving the editor saves */
  startEdit(bm, li) {
    if (this.editing) this.editing.finish(true);
    const nameIn = h('input', { type: 'text', class: 'mui-input mui-input-inline', value: bm.name || '', 'aria-label': '书签名称', maxlength: '80', placeholder: '名称' });
    const noteIn = h('textarea', { class: 'mui-input mui-textarea', rows: '2', 'aria-label': '书签备注', maxlength: '400', placeholder: '备注（可选）：机位用途、要复查的细节…' });
    noteIn.value = noteOf(bm);
    // (pointerdown keeps the focus in the fields: browsers that do not focus clicked buttons would
    // otherwise end the edit through focusout before the click lands)
    const keep = { onpointerdown: (e) => e.preventDefault() };
    const save = button('保存', { cls: 'mui-btn-xs mui-btn-primary', onclick: () => finish(true), attrs: keep });
    const cancel = button('取消', { cls: 'mui-btn-xs mui-btn-quiet', onclick: () => finish(false), attrs: keep });
    const form = h('div', { class: 'mui-ub-edit', role: 'group', 'aria-label': '编辑书签' }, nameIn, noteIn, h('div', { class: 'mui-ub-edit-row' }, cancel, save));
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      this.editing = null;
      if (ok) this.ui.userBookmarks.update(bm.id, { name: nameIn.value, note: noteIn.value });
      this.renderUser();
      requestAnimationFrame(() => this.userList.querySelector(`[data-bm="${CSS.escape(bm.id)}"]`)?.focus());
    };
    this.editing = { id: bm.id, finish };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && (e.target === nameIn || e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
    };
    form.addEventListener('keydown', onKey);
    form.addEventListener('focusout', (e) => { if (!form.contains(e.relatedTarget)) setTimeout(() => { if (!form.contains(document.activeElement)) finish(true); }, 0); });
    li.classList.add('is-editing');
    li.replaceChildren(form);
    nameIn.focus();
    nameIn.select();
  }

  remove(bm) {
    const r = this.ui.userBookmarks.remove(bm.id);
    if (!r) return;
    this.ui.toast.show(`已删除「${bm.name}」`, { action: '撤销', onAction: () => this.ui.userBookmarks.restore(r.bm, r.index), timeout: 6000 });
  }

  defaultName() {
    const app = this.ui.app;
    const sel = app.state.selection;
    const bid = selectionBuildingId(sel);
    const at = this.ui.nav.currentView();
    if (bid) return `${useName(sel.spec?.use)} ${bid}${at && at.id === String(bid) ? ` ${viewLabel(at.view, sel.spec?.use)}` : ''}`;
    const f = app.frame;
    if (!f) return '视角';
    let pid = 0;
    try { pid = provinceAt(f.camLat, f.camLon); } catch { /* ignore */ }
    const p = PROVINCES[pid];
    return `${p ? `${p.code} ${p.name}` : '视角'}  ${fmtLength(f.camAltGround ?? f.camAlt)}`;
  }

  /**
   * Save the current camera: pose, sol time + season, camera mode, the selected building's ID (so
   * revisiting by ID works) and — while the camera still stands at one of that building's viewpoints —
   * the viewpoint, so the bookmark re-enters it through controls.buildingView (right storey, the
   * asset's own anchor). Records the world version and seed (§5 template: 记录相机和世界版本).
   */
  addCurrent({ buildingId, name, note } = {}) {
    const app = this.ui.app;
    const pose = this.ui.nav.pose();
    if (!pose) return null;
    const sel = app.state.selection;
    const bid = buildingId ?? selectionBuildingId(sel);
    const at = this.ui.nav.currentView();
    const view = at && bid != null && at.id === String(bid) ? at.view : null;
    const rp = roundPose(pose);
    const bm = this.ui.userBookmarks.add({
      name: name || this.defaultName(), group: 'user', pose: rp,
      solTime: +app.state.solTime.toFixed(4), subsolarLat: app.state.subsolarLat, mode: app.state.mode,
      buildingId: bid != null ? String(bid) : undefined, use: sel?.spec?.use || undefined,
      view: view || undefined, viewPitch: view ? rp.pitch : undefined, viewLens: view && rp.lens ? rp.lens : undefined,
      note: note || undefined, world: WORLD_VERSION, seed: SEED,
    });
    this.setActive(bm.id);
    this.ui.toast.show(`已存为书签「${bm.name}」`);
    return bm;
  }

  userBookmarkForBuilding(id) { return this.ui.userBookmarks.forBuilding(id); }

  exportJson() {
    const list = this.ui.userBookmarks.all();
    if (!list.length) { this.ui.toast.show('没有可导出的书签'); return; }
    const d = new Date();
    const name = `mars-bookmarks-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    downloadText(this.ui.userBookmarks.exportJson(), name);
    this.ui.toast.show(`已导出 ${list.length} 个书签`);
  }

  async importJson() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      const n = this.ui.userBookmarks.importJson(text);
      this.ui.toast.show(n ? `已导入 ${n} 个书签` : '文件里的书签都已存在');
    } catch (e) {
      this.ui.toast.show(`无法导入：${e.message || '不是书签 JSON 文件'}`, { kind: 'error', timeout: 4000 });
    }
  }
}
