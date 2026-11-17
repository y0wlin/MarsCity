// Bottom-right mode switcher (轨道/飞行/步行/环看) and "返回上一机位". OWNER: ui agent.
import { h, nextFrames } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './widgets.js';
import { MODES, MODE_NAMES } from './format.js';
import { selectionBuildingId } from './nav.js';

const MODE_TIPS = {
  orbit: '轨道：环绕行星，滚轮向指针推近',
  fly: '飞行：自由飞行',
  walk: '步行：人眼高度行走',
  focus: '环看：围绕选中的建筑观察',
};

export class ModeBar {
  constructor(ui) {
    this.ui = ui;
    const app = ui.app;
    this.modes = segmented(MODES.map((m) => [m, MODE_NAMES[m], { 'data-tip': MODE_TIPS[m], 'data-tip-pos': 'top' }]), {
      label: '相机模式', value: app.state.mode, cls: 'mui-modes',
      onChange: (m) => this.choose(m),
    });
    this.back = h('button', {
      type: 'button', class: 'mui-btn mui-back', 'aria-label': '返回上一机位', 'data-tip': '返回上一机位', 'data-tip-pos': 'top',
      onclick: () => { if (!ui.nav.back()) ui.toast.show('没有可返回的机位'); },
    }, icon('back', 17), h('span', { class: 'mui-back-text' }, '上一机位'));
    this.el = h('div', { class: 'mui-modebar mui-panel', role: 'group', 'aria-label': '相机' }, this.modes.el, this.back);
    app.events.on('mode', ({ mode }) => this.modes.set(mode));
    this._n = 0;
    this._canBack = null;
  }

  async choose(m) {
    const ui = this.ui, app = ui.app;
    await ui.nav.setMode(m);
    this.modes.set(app.state.mode);
    await nextFrames(2);
    this.modes.set(app.state.mode);
    if (app.state.mode === m) return;
    if (m === 'focus') { if (!selectionBuildingId(app.state.selection)) ui.toast.show('环看需要先选中一栋建筑'); }
    else ui.toast.show(`暂时无法切换到${MODE_NAMES[m]}模式`);
  }

  update() {
    if ((this._n++ % 12) !== 0) return;
    const can = this.ui.nav.canGoBack();
    if (can !== this._canBack) {
      this._canBack = can;
      this.back.disabled = !can;
    }
    const m = this.ui.app.state.mode;
    if (this.modes.get() !== m) this.modes.set(m);
  }
}
