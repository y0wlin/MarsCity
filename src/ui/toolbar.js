// Top-right toolbar (drawer tabs, screenshot, clean plate) and the loading status pill.
// OWNER: ui agent.
import { h, iconButton, setText } from './dom.js';

export const TABS = [
  ['search', 'search', '搜索', '/'],
  ['bookmarks', 'bookmark', '书签', 'B'],
  ['layers', 'layers', '图层', ''],
  ['settings', 'sliders', '设置', ''],
  ['help', 'help', '帮助', ''],
];

export class Toolbar {
  constructor(ui) {
    this.ui = ui;
    this.tabButtons = new Map();
    const tabBtns = TABS.map(([id, ic, label, key]) => {
      const b = iconButton(ic, label, { tip: key ? `${label}  ${key}` : label, cls: 'mui-only-wide', attrs: { 'aria-pressed': 'false', 'aria-controls': 'mui-drawer', 'data-tab': id } });
      b.addEventListener('click', () => ui.drawer.toggle(id));
      this.tabButtons.set(id, b);
      return b;
    });
    // narrow screens keep search + a menu that opens the drawer at the last tab
    this.searchNarrow = iconButton('search', '搜索', { cls: 'mui-only-narrow', attrs: { 'aria-controls': 'mui-drawer' }, onclick: () => ui.drawer.toggle('search') });
    this.menu = iconButton('menu', '菜单', { cls: 'mui-only-narrow', attrs: { 'aria-controls': 'mui-drawer', 'aria-expanded': 'false' }, onclick: () => ui.drawer.toggle(ui.drawer.tab === 'search' ? 'bookmarks' : ui.drawer.tab) });
    this.capture = iconButton('camera', '截图', { tip: '截图（正片 PNG）', onclick: () => ui.capture() });
    this.clean = iconButton('frame', '净屏', { tip: '净屏  H', attrs: { 'aria-pressed': 'false' }, onclick: () => ui.toggleClean() });

    this.statusText = h('span', { class: 'mui-status-text' });
    // the visible pill changes every few frames; screen readers only hear state transitions
    this.status = h('div', { class: 'mui-status mui-panel', 'aria-hidden': 'true', hidden: true },
      h('span', { class: 'mui-spinner' }), this.statusText);
    this.live = h('span', { class: 'mui-sr', role: 'status' });

    this.el = h('div', { class: 'mui-topright' },
      this.live,
      this.status,
      h('div', { class: 'mui-toolbar mui-panel', role: 'group', 'aria-label': '工具' },
        ...tabBtns, this.searchNarrow,
        h('span', { class: 'mui-vsep', 'aria-hidden': 'true' }),
        this.capture, this.clean, this.menu));
    this._n = 0;
    this._statusKey = '';
    this._busySince = 0;
  }

  setActiveTab(tab, open) {
    for (const [id, b] of this.tabButtons) b.setAttribute('aria-pressed', String(open && id === tab));
    this.menu.setAttribute('aria-expanded', String(open));
    this.searchNarrow.setAttribute('aria-pressed', String(open && tab === 'search'));
  }

  setCapturing(on) {
    this.capture.disabled = on;
    this.capture.classList.toggle('is-busy', on);
  }

  /** loading indicator: worker jobs pending / systems refining */
  update() {
    if ((this._n++ % 8) !== 0) return;
    const app = this.ui.app;
    let pending = 0, idle = true;
    try { pending = app.workers?.pending || 0; } catch { /* ignore */ }
    try { idle = app.isIdle ? app.isIdle() : pending === 0; } catch { idle = pending === 0; }
    let key = '';
    let text = '';
    if (pending > 0) { key = 'load'; text = `载入中 ${pending}`; }
    else if (!idle) { key = 'refine'; text = '细化画面'; }
    const now = performance.now();
    if (key && !this._busySince) this._busySince = now;
    if (!key) this._busySince = 0;
    // avoid flicker: only show after the work lasts a moment
    const show = key && now - this._busySince > 350;
    if (show) setText(this.statusText, text);
    const vis = show ? 'show' : '';
    if (vis !== this._statusKey) {
      this._statusKey = vis;
      this.status.hidden = !show;
      this.live.textContent = show ? '正在载入画面' : '';
    }
  }
}
