// Tiny synchronous event bus shared by all systems (app.events).
// Event names in use (see ARCHITECTURE.md §Events):
//   'select'        {type:'location'|'building'|null, ...}
//   'hover'         same shape as select
//   'mode'          {mode}
//   'time'          {solTime}
//   'settings'      {key, value}
//   'goto'          {bookmark}
//   'tile:add'      {tile}       terrain tile became renderable (tile object, see render/terrain)
//   'tile:remove'   {tile}
//   'camera:arrive' {bookmark?}
export class EventBus {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, payload) { const s = this.map.get(name); if (!s) return; for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error(`[event ${name}]`, e); } } }
}
