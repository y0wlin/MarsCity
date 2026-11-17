// Observable application state (app.state). Systems read fields directly and write through
// set() so that 'settings' / 'time' / 'mode' / 'select' events fire.

export const DEFAULT_SETTINGS = {
  quality: 'ultra',      // 'ultra' is the default and the acceptance target (no perf budget)
  clean: false,          // clean plate: hide all UI, labels, outlines, debug layers
  labels: true,
  outlines: true,
  debugLayer: 'none',    // 'none'|'province'|'zone'|'density'|'emission'|'wireframe'|'objectId'|'lod'|'normals'
  clouds: true,
  shadows: true,
  bloom: true,
  taa: true,             // accumulate samples while static
  exposure: 1.0,
  pixelRatio: 0,         // 0 = devicePixelRatio
};

export class AppState {
  constructor(events) {
    this.events = events;
    this.solTime = 15.0;     // hours of the sol at longitude 0 (planet "UTC")
    this.timeSpeed = 0;      // sol-hours advanced per real second (0 = paused)
    this.subsolarLat = 12;   // degrees, the season (fixed unless changed by the user)
    this.mode = 'orbit';     // 'orbit' | 'fly' | 'walk' | 'focus'
    this.selection = null;   // {type:'location', lat, lon, h, province, zone} | {type:'building', id, spec}
    this.hover = null;
    this.settings = { ...DEFAULT_SETTINGS };
  }
  setTime(h) { this.solTime = ((h % 24) + 24) % 24; this.events.emit('time', { solTime: this.solTime }); }
  setTimeSpeed(s) { this.timeSpeed = s; this.events.emit('time', { solTime: this.solTime, speed: s }); }
  setMode(m) { if (this.mode === m) return; this.mode = m; this.events.emit('mode', { mode: m }); }
  select(sel) { this.selection = sel; this.events.emit('select', sel); }
  setHover(h) { this.hover = h; this.events.emit('hover', h); }
  set(key, value) { this.settings[key] = value; this.events.emit('settings', { key, value }); }
}
