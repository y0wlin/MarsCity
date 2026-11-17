// Transient confirmations ("已复制 …", "已存为书签…") with an optional action (撤销). OWNER: ui agent.
//   show(text, {action, onAction, timeout, kind:'info'|'error'|'loading', key})
// A toast shown again with the same `key` while it is still visible only refreshes its text and
// timer (no re-entrance animation): repeated hints such as "室内载入中…" never flicker.
import { h } from './dom.js';

export class Toasts {
  constructor() {
    this.el = h('div', { class: 'mui-toasts', role: 'status', 'aria-live': 'polite' });
    this.current = null;
  }

  show(text, { action, onAction, timeout = 2400, kind = 'info', key = null } = {}) {
    const cur = this.current;
    if (cur && key && cur.key === key && !cur.removed && !action) {
      if (cur.textEl.textContent !== text) cur.textEl.textContent = text;
      clearTimeout(cur.timer);
      cur.timeout = timeout;
      if (!cur.hover) cur.timer = setTimeout(() => this._remove(cur), timeout);
      return cur;
    }
    if (cur) this._remove(cur, true);
    const entry = { el: null, timer: 0, key, timeout, hover: false, textEl: null };
    entry.textEl = h('span', { class: 'mui-toast-text' }, text);
    const t = h('div', { class: 'mui-toast mui-panel', 'data-kind': kind },
      kind === 'loading' ? h('span', { class: 'mui-spinner', 'aria-hidden': 'true' }) : null, entry.textEl);
    if (action && onAction) {
      t.append(h('button', { type: 'button', class: 'mui-toast-action', onclick: () => { onAction(); this._remove(entry); } }, action));
    }
    entry.el = t;
    this.el.append(t);
    requestAnimationFrame(() => t.classList.add('is-in'));
    entry.timer = setTimeout(() => this._remove(entry), timeout);
    t.addEventListener('pointerenter', () => { entry.hover = true; clearTimeout(entry.timer); });
    t.addEventListener('pointerleave', () => { entry.hover = false; clearTimeout(entry.timer); entry.timer = setTimeout(() => this._remove(entry), 1200); });
    this.current = entry;
    return entry;
  }

  /** remove the visible toast when it carries `key` (e.g. the loading hint once the interior is in) */
  dismiss(key) {
    if (this.current && (key == null || this.current.key === key)) this._remove(this.current);
  }

  _remove(entry, instant = false) {
    if (!entry || !entry.el || entry.removed) return;
    entry.removed = true;
    clearTimeout(entry.timer);
    if (this.current === entry) this.current = null;
    const el = entry.el;
    if (instant) { el.remove(); return; }
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }
}
