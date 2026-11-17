// Top-left HUD: title + camera location (lat/lon, altitude above sea level and ground,
// province + zone, local solar time and sky phase). OWNER: ui agent.
import { h, setText, setAttr, setStyle } from './dom.js';
import { provinceAt, zoneAt } from '../data/controlMaps.js';
import { PROVINCES, ZONES } from '../data/provinces.js';
import {
  fmtLat, fmtLon, fmtLength, fmtHM, latLonDecimals, sunElevationDeg, dayPhase, skyColor, localTime,
} from './format.js';

const ZONE_SHORT = { O: '富氧区', Z: '宜居区' };

export class Hud {
  constructor(ui) {
    this.ui = ui;
    const v = (cls = '') => h('span', { class: `mui-v ${cls}`.trim() });
    const k = (t, cls = '') => h('span', { class: `mui-k ${cls}`.trim() }, t);
    this.mark = h('span', { class: 'mui-hud-mark', 'aria-hidden': 'true' });
    this.lat = v('mui-num');
    this.lon = v('mui-num');
    this.alt = v('mui-num');
    this.agl = v('mui-num');
    this.code = h('span', { class: 'mui-code' });
    this.pname = v();
    this.zname = h('span', { class: 'mui-k mui-hud-zone' });
    this.zshort = h('span', { class: 'mui-k mui-hud-zone-short' });
    this.local = v('mui-num');
    this.phase = h('span', { class: 'mui-k' });
    this.elev = v('mui-num mui-hud-elev');

    this.el = h('header', { class: 'mui-hud mui-panel', 'aria-label': '相机位置' },
      h('h1', { class: 'mui-hud-title' }, this.mark, h('span', null, '火星全境')),
      h('div', { class: 'mui-hud-line mui-hud-coords' }, this.lat, this.lon),
      h('div', { class: 'mui-hud-line' }, k('海拔'), this.alt, k('离地', 'mui-gap'), this.agl),
      h('div', { class: 'mui-hud-line' }, this.code, this.pname, this.zname, this.zshort),
      h('div', { class: 'mui-hud-line' }, k('当地'), this.local, this.phase, k('太阳', 'mui-gap mui-hud-elev'), this.elev),
    );
    this._rgb = [0, 0, 0];
    this._n = 0;
  }

  update(frame) {
    // ~20 Hz is plenty for text; always refresh while the camera moves fast
    if ((this._n++ % 3) !== 0 && !frame.moving) return;
    const st = this.ui.app.state;
    const lat = frame.camLat, lon = frame.camLon, alt = frame.camAlt;
    const d = latLonDecimals(frame.camAltGround ?? alt);
    setText(this.lat, fmtLat(lat, d));
    setText(this.lon, fmtLon(lon, d));
    setText(this.alt, fmtLength(alt));
    const agl = Number.isFinite(frame.camAltGround) ? frame.camAltGround : alt;
    setText(this.agl, fmtLength(agl));

    let pid = 0, zone = 'Z';
    try { pid = provinceAt(lat, lon); zone = zoneAt(lat, lon); } catch { /* maps not ready */ }
    const p = PROVINCES[pid];
    setText(this.code, p ? p.code : '—');
    setAttr(this.code, 'data-zone', p ? p.zone : zone);
    setText(this.pname, p ? p.name : '未知省域');
    setText(this.zname, ZONES[zone]?.name || '');
    setText(this.zshort, ZONE_SHORT[zone] || '');

    const lt = localTime(lon, st.solTime);
    const e = sunElevationDeg(lat, lon, st.solTime, st.subsolarLat);
    setText(this.local, fmtHM(lt));
    setText(this.phase, dayPhase(e, lt).name);
    setText(this.elev, `${Math.round(e)}°`);
    const c = skyColor(e, this._rgb);
    setStyle(this.mark, '--sky', `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`);
  }
}
