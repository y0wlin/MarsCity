// 设置 panel: quality, exposure, bloom, shadows, TAA, pixel ratio, season, screenshot options.
// Every render setting goes through app.state.set (emits 'settings'). OWNER: ui agent.
import { h, button } from '../dom.js';
import { section, segmented, switchRow, sliderRow, selectBox, controlRow } from '../widgets.js';
import { QUALITY_LEVELS, fmtFixed } from '../format.js';

const EV_MIN = -3, EV_MAX = 3;

export class SettingsPanel {
  constructor(ui) {
    this.ui = ui;
    this.id = 'settings';
    this.title = '设置';
    const st = ui.app.state, s = st.settings;
    const set = (k) => (v) => st.set(k, v);

    this.quality = segmented(QUALITY_LEVELS, { label: '画质', value: s.quality, cls: 'mui-seg-fill', onChange: set('quality') });
    const ev = (x) => Math.log2(Math.max(1e-3, x));
    this.exposure = sliderRow('曝光', {
      min: EV_MIN, max: EV_MAX, step: 0.1, value: ev(s.exposure ?? 1),
      format: (v) => `${v > 0.04 ? '+' : ''}${fmtFixed(Math.abs(v) < 0.05 ? 0 : v, 1)} EV`,
      onInput: (v) => st.set('exposure', +Math.pow(2, v).toFixed(4)),
      onReset: () => { st.set('exposure', 1); },
      hint: '双击复位',
    });
    this.bloom = switchRow('泛光', { checked: s.bloom, onChange: set('bloom'), hint: '窗光与灯核的柔光，不吞没屋面边缘' });
    this.shadows = switchRow('阴影', { checked: s.shadows, onChange: set('shadows') });
    this.taa = switchRow('静止时累积采样', { checked: s.taa, onChange: set('taa'), hint: '相机静止时收敛阴影、反射与抗锯齿' });
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = selectBox([[0, `自动（${+dpr.toFixed(2)}×）`], [1, '1×'], [1.5, '1.5×'], [2, '2×'], [3, '3×']], {
      value: s.pixelRatio ?? 0, label: '像素比', onChange: (v) => st.set('pixelRatio', +v),
    });
    this.season = sliderRow('太阳直射纬度', {
      min: -25, max: 25, step: 0.5, value: st.subsolarLat ?? 12,
      format: (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`,
      onInput: (v) => { st.subsolarLat = v; st.events.emit('time', { solTime: st.solTime }); },
      onReset: () => { st.subsolarLat = 12; st.events.emit('time', { solTime: st.solTime }); this.season.set(12); },
      hint: '季节，双击复位到 12°N',
    });

    this.capScale = segmented([['1', '1×'], ['2', '2×'], ['4', '4×']], {
      label: '截图倍率', value: String(ui.prefs.captureScale || 2), cls: 'mui-seg-fill',
      onChange: (v) => { ui.prefs.captureScale = +v; ui.savePrefs(); },
    });
    this.capClean = switchRow('正片截图', { checked: ui.prefs.captureClean !== false, onChange: (v) => { ui.prefs.captureClean = v; ui.savePrefs(); }, hint: '截图时暂时隐藏描边与调试图层' });

    this.el = h('div', { class: 'mui-pane mui-pane-settings' },
      section('画面', {},
        controlRow('画质', this.quality.el, { hint: '默认极致：按视域分块细化到最终质量' }),
        this.exposure.el, this.bloom.el, this.shadows.el, this.taa.el,
        controlRow('像素比', this.pixelRatio.el)),
      section('光照', {}, this.season.el),
      section('截图', {},
        controlRow('倍率', this.capScale.el),
        this.capClean.el,
        h('div', { class: 'mui-btnrow' }, button('立即截图', { iconName: 'camera', cls: 'mui-btn-quiet', onclick: () => ui.capture() }))),
    );
    ui.app.events.on('settings', () => this.sync());
    ui.app.events.on('time', () => { if (Math.abs((st.subsolarLat ?? 12) - parseFloat(this.season.input.value)) > 0.01) this.season.set(st.subsolarLat); });
  }

  sync() {
    const s = this.ui.app.state.settings;
    this.quality.set(s.quality);
    const cur = parseFloat(this.exposure.input.value);
    const want = Math.log2(Math.max(1e-3, s.exposure ?? 1));
    if (Math.abs(cur - want) > 0.051) this.exposure.set(Math.max(EV_MIN, Math.min(EV_MAX, want)));
    this.bloom.set(s.bloom);
    this.shadows.set(s.shadows);
    this.taa.set(s.taa);
    this.pixelRatio.set(s.pixelRatio ?? 0);
  }
}
