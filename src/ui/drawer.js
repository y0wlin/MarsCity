// Right-hand collapsible drawer hosting the tab panels (书签/搜索/图层/设置/帮助). On wide
// screens the top-right toolbar acts as its tab strip; on phones it has its own. OWNER: ui agent.
import { h, iconButton } from './dom.js';
import { icon } from './icons.js';
import { TABS } from './toolbar.js';
import { BookmarksPanel } from './panels/bookmarks.js';
import { SearchPanel } from './panels/search.js';
import { LayersPanel } from './panels/layers.js';
import { SettingsPanel } from './panels/settings.js';
import { HelpPanel } from './panels/help.js';

export class Drawer {
  constructor(ui) {
    this.ui = ui;
    this.panels = {
      search: new SearchPanel(ui),
      bookmarks: new BookmarksPanel(ui),
      layers: new LayersPanel(ui),
      settings: new SettingsPanel(ui),
      help: new HelpPanel(ui),
    };
    this.tab = this.panels[ui.prefs.tab] ? ui.prefs.tab : 'bookmarks';
    this.isOpen = false;

    this.title = h('h2', { class: 'mui-drawer-title', id: 'mui-drawer-title' });
    this.closeBtn = iconButton('close', '关闭面板', { tip: '关闭  Esc', onclick: () => this.close({ restoreFocus: true }) });
    this.tabStrip = h('div', { class: 'mui-drawer-tabs', role: 'tablist', 'aria-label': '面板' },
      ...TABS.map(([id, ic, label]) => {
        const b = h('button', { type: 'button', role: 'tab', class: 'mui-drawer-tab', 'data-tab': id, 'aria-selected': 'false', 'aria-controls': `mui-panel-${id}`, id: `mui-tab-${id}`, tabIndex: -1 },
          icon(ic, 17), h('span', null, label));
        b.addEventListener('click', () => this.open(id));
        return b;
      }));
    this.tabStrip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const ids = TABS.map((t) => t[0]);
      const i = ids.indexOf(this.tab);
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      this.open(ids[j]);
      this.tabStrip.querySelector(`[data-tab="${ids[j]}"]`)?.focus();
    });

    this.body = h('div', { class: 'mui-drawer-body' });
    for (const [id, p] of Object.entries(this.panels)) {
      p.el.id = `mui-panel-${id}`;
      p.el.setAttribute('role', 'tabpanel');
      p.el.setAttribute('aria-labelledby', 'mui-drawer-title');
      p.el.hidden = true;
      p.el.classList.add('mui-tabpanel');
      this.body.append(p.el);
    }

    this.el = h('aside', { class: 'mui-drawer mui-panel', id: 'mui-drawer', 'aria-labelledby': 'mui-drawer-title', inert: true },
      h('div', { class: 'mui-drawer-head' }, this.title, this.closeBtn),
      this.tabStrip,
      this.body);
    this._select(this.tab);
  }

  _select(tab) {
    const prev = this.panels[this.tab];
    const switched = !!prev && prev !== this.panels[tab];
    // the panes share one scroller: each tab keeps its own scroll position
    if (switched) { prev._scrollTop = this.body.scrollTop; prev.el.hidden = true; prev.onHide?.(); }
    this.tab = tab;
    const p = this.panels[tab];
    p.el.hidden = false;
    if (switched) this.body.scrollTop = p._scrollTop || 0;
    this.title.textContent = p.title;
    for (const b of this.tabStrip.children) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.ui.toolbar?.setActiveTab(tab, this.isOpen);
    if (this.ui.prefs.tab !== tab) { this.ui.prefs.tab = tab; this.ui.savePrefs(); }
  }

  open(tab = this.tab, { focus = false } = {}) {
    const wasOpen = this.isOpen;
    this.isOpen = true;
    this._select(tab);
    this.el.inert = false;
    this.el.classList.add('is-open');
    this.ui.root.classList.add('mui-drawer-open');
    this.ui._rectsDirty = true;
    this.ui.toolbar?.setActiveTab(tab, true);
    this.panels[tab].onShow?.({ wasOpen });
    if (focus) {
      // synchronous: keys typed right after the shortcut must land in the panel, not the page
      const t = this.panels[tab].focusTarget?.() || this.closeBtn;
      t.focus({ preventScroll: true });
      if (document.activeElement !== t) requestAnimationFrame(() => t.focus({ preventScroll: true }));
    }
  }

  close({ restoreFocus = false } = {}) {
    if (!this.isOpen) return;
    const hadFocus = this.el.contains(document.activeElement);
    this.isOpen = false;
    this.el.classList.remove('is-open');
    this.el.inert = true;
    this.ui.root.classList.remove('mui-drawer-open');
    this.ui._rectsDirty = true;
    this.ui.toolbar?.setActiveTab(this.tab, false);
    this.panels[this.tab].onHide?.();
    if (hadFocus || restoreFocus) {
      const btn = this.ui.toolbar?.tabButtons.get(this.tab);
      const target = btn && btn.offsetParent ? btn : this.ui.toolbar?.menu;
      if (target && target.offsetParent) target.focus({ preventScroll: true });
      else document.activeElement?.blur?.();
    }
  }

  toggle(tab) {
    if (this.isOpen && (tab == null || tab === this.tab)) this.close();
    else this.open(tab ?? this.tab, { focus: tab === 'search' });
  }

  update(frame) {
    if (!this.isOpen) return;
    this.panels[this.tab].update?.(frame);
  }
}
