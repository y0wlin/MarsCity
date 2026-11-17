// UI preferences (per viewer) and the user-bookmark store. User bookmarks live in the core
// bookmark storage (app/bookmarks.js) so ?bookmark=<id> and __MARS__.bookmarks() see them too.
// OWNER: ui agent.
import { loadUserBookmarks, saveUserBookmarks } from '../app/bookmarks.js';
import { WORLD_VERSION, SEED } from '../core/constants.js';

const PREF_KEY = 'mars.ui.v1';
const PREF_DEFAULTS = { tab: 'bookmarks', captureScale: 2, captureClean: true, diag: false, playSpeed: 600 };

export function loadPrefs() {
  try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...PREF_DEFAULTS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode etc. */ }
}

function validPose(p) {
  return p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon) && Number.isFinite(+p.alt) && Math.abs(+p.lat) <= 90;
}

let SEQ = 0;
function newId(taken) {
  let id;
  do { id = `U${Date.now().toString(36)}${(SEQ++).toString(36)}`; } while (taken.has(id));
  return id;
}

export class UserBookmarks {
  constructor() {
    this.listeners = new Set();
    this.list = this._read();
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith('mars.bookmarks')) { this.list = this._read(); this._emit(); }
    });
  }

  _read() {
    const raw = loadUserBookmarks();
    return Array.isArray(raw) ? raw.filter((b) => b && validPose(b.pose)) : [];
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(this.list); } catch (e) { console.error('[ui bookmarks]', e); } } }
  _save() { saveUserBookmarks(this.list); this._emit(); }

  all() { return this.list; }
  get(id) { return this.list.find((b) => b.id === id) || null; }
  /**
   * The bookmark a revisit by building ID goes to: the newest one the visitor saved by hand, else from the
   * "存视点" set (`viewSet`) its street view, else the newest of that set.
   */
  forBuilding(buildingId) {
    let best = null, rank = -1;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.buildingId !== buildingId) continue;
      const r = !b.viewSet ? 2 : b.view === 'street' ? 1 : 0;
      if (r > rank) { best = b; rank = r; if (r === 2) break; }
    }
    return best;
  }

  add(bm) {
    const taken = new Set(this.list.map((b) => b.id));
    const item = { ...bm, id: bm.id && !taken.has(bm.id) ? bm.id : newId(taken), group: 'user', created: bm.created || Date.now() };
    this.list.push(item);
    this._save();
    return item;
  }

  rename(id, name) { this.update(id, { name }); }

  /** edit name (empty keeps the old one) and / or note (empty removes it) */
  update(id, { name, note } = {}) {
    const b = this.get(id);
    if (!b) return;
    let changed = false;
    if (name !== undefined) {
      const n = String(name || '').trim().slice(0, 80);
      if (n && n !== b.name) { b.name = n; changed = true; }
    }
    if (note !== undefined) {
      const t = String(note || '').trim().slice(0, 400);
      if (t !== (b.note || '')) { if (t) b.note = t; else delete b.note; changed = true; }
    }
    if (changed) this._save(); else this._emit();
  }

  remove(id) {
    const i = this.list.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const [bm] = this.list.splice(i, 1);
    this._save();
    return { bm, index: i };
  }

  restore(bm, index) {
    if (this.get(bm.id)) return;
    this.list.splice(Math.min(index, this.list.length), 0, bm);
    this._save();
  }

  exportJson() {
    return JSON.stringify({ format: 'mars-bookmarks', version: 1, world: WORLD_VERSION, seed: SEED, exported: new Date().toISOString(), bookmarks: this.list }, null, 2);
  }

  /** Accepts an exported file or a bare array. Returns the number of bookmarks added. */
  importJson(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : Array.isArray(data?.bookmarks) ? data.bookmarks : null;
    if (!arr) throw new Error('文件里没有书签列表');
    const taken = new Set(this.list.map((b) => b.id));
    let n = 0;
    for (const raw of arr) {
      if (!raw || !validPose(raw.pose)) continue;
      const pose = { lat: +raw.pose.lat, lon: +raw.pose.lon, alt: +raw.pose.alt, heading: +raw.pose.heading || 0, pitch: Number.isFinite(+raw.pose.pitch) ? +raw.pose.pitch : -90, roll: +raw.pose.roll || 0 };
      if (raw.pose.lens) pose.lens = +raw.pose.lens; else if (raw.pose.fov) pose.fov = +raw.pose.fov;
      // identical bookmark already present -> skip
      if (this.list.some((b) => b.pose && Math.abs(b.pose.lat - pose.lat) < 1e-9 && Math.abs(b.pose.lon - pose.lon) < 1e-9 && Math.abs(b.pose.alt - pose.alt) < 1e-6 && b.buildingId === raw.buildingId && b.name === raw.name)) continue;
      const item = {
        id: raw.id && !taken.has(String(raw.id)) && /^[A-Za-z0-9_-]{1,40}$/.test(String(raw.id)) ? String(raw.id) : newId(taken),
        name: String(raw.name || '导入的书签').slice(0, 80), group: 'user', pose,
        solTime: Number.isFinite(+raw.solTime) ? +raw.solTime : undefined,
        subsolarLat: Number.isFinite(+raw.subsolarLat) ? +raw.subsolarLat : undefined,
        mode: ['orbit', 'fly', 'walk', 'focus'].includes(raw.mode) ? raw.mode : 'orbit',
        buildingId: raw.buildingId ? String(raw.buildingId) : undefined,
        use: raw.use ? String(raw.use).slice(0, 40) : undefined,
        view: raw.buildingId && raw.view && /^[a-z_]{2,24}$/.test(String(raw.view)) ? String(raw.view) : undefined,
        viewPitch: raw.view && Number.isFinite(+raw.viewPitch) ? +raw.viewPitch : undefined,
        viewLens: raw.view && Number.isFinite(+raw.viewLens) && +raw.viewLens > 0 ? +raw.viewLens : undefined,
        viewSet: raw.view && raw.viewSet === true ? true : undefined,
        note: raw.note ? String(raw.note).slice(0, 400) : undefined,
        world: raw.world ? String(raw.world).slice(0, 40) : undefined,
        seed: Number.isFinite(+raw.seed) ? +raw.seed : undefined,
        created: Number.isFinite(+raw.created) ? +raw.created : Date.now(),
      };
      taken.add(item.id);
      this.list.push(item);
      n++;
    }
    if (n) this._save();
    return n;
  }
}
