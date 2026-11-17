// UI keyboard shortcuts. Never steals keys while the user types, when a modifier is held, when
// another handler already consumed the event, or in walk / fly mode (movement keys belong to the
// controls there; only the diagnostics toggle stays available). OWNER: ui agent.
//   H clean, B bookmarks, / search, 1–9 shots (orbit mode only), T play/pause, [ ] time step, Esc close, F3 or ` diagnostics
import { isTypingTarget } from './dom.js';
import { SHOTS } from '../app/bookmarks.js';

export class Keyboard {
  constructor(ui) {
    this.ui = ui;
    this.onKey = (e) => this.handle(e);
    window.addEventListener('keydown', this.onKey);
  }

  dispose() { window.removeEventListener('keydown', this.onKey); }

  shotForDigit(n) {
    const id = `S${String(n).padStart(2, '0')}`;
    return SHOTS.find((b) => b.id === id) || SHOTS.filter((b) => /^S\d{2}$/.test(b.id))[n - 1] || null;
  }

  handle(e) {
    if (e.defaultPrevented || e.isComposing || e.repeat && e.key !== '[' && e.key !== ']') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    const ui = this.ui, app = ui.app;
    const mode = app.state.mode;
    const key = e.key, code = e.code;

    // diagnostics: allowed in every mode
    if (key === 'F3' || code === 'Backquote' || key === '`') {
      e.preventDefault();
      ui.diag.toggle();
      return;
    }
    if (mode === 'walk' || mode === 'fly') return;

    const clean = !!app.state.settings.clean;
    if (key === 'Escape') {
      // in focus mode Esc belongs to the controls (back to orbit) unless the user is in the UI
      if (mode === 'focus' && !ui.root.contains(document.activeElement)) return;
      if (ui.handleEscape()) e.preventDefault();
      return;
    }
    // activating focused buttons with Space/Enter must keep working
    if (key === ' ' || key === 'Enter') return;

    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === 'h') { e.preventDefault(); ui.toggleClean(); return; }
    if (clean) return; // in clean mode only H / Esc / diagnostics
    if (k === 'b') { e.preventDefault(); ui.drawer.toggle('bookmarks'); return; }
    if (key === '/' || code === 'Slash' && !e.shiftKey) { e.preventDefault(); ui.drawer.open('search', { focus: true }); return; }
    if (k === 't') { e.preventDefault(); ui.timebar.togglePlay(); return; }
    if (code === 'BracketLeft' || key === '[' || key === '{') { e.preventDefault(); ui.timebar.step(e.shiftKey ? -1 / 6 : -1); return; }
    if (code === 'BracketRight' || key === ']' || key === '}') { e.preventDefault(); ui.timebar.step(e.shiftKey ? 1 / 6 : 1); return; }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code || '');
    const digit = m ? +m[1] : (/^[1-9]$/.test(key) ? +key : 0);
    if (digit && !e.shiftKey && mode === 'orbit') { // focus mode uses 1–5 for front/back/left/right/roof
      const bm = this.shotForDigit(digit);
      e.preventDefault();
      if (bm) { ui.nav.gotoBookmark(bm); ui.drawer.panels.bookmarks.setActive(bm.id); }
      else ui.toast.show(`第 ${digit} 号镜头尚未登记`);
    }
  }
}
