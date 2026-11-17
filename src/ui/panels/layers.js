// 图层 panel in the §6 acceptance order: first look at the clean picture (labels, outlines and debug
// layers off — one button), then switch on object ID, terrain wireframe, LOD and the channels
// (normals, ambient occlusion) to locate problems; control maps last. Plus clean plate, clouds and
// diagnostics. OWNER: ui agent.
import { h, button } from '../dom.js';
import { section, switchRow } from '../widgets.js';
import { DEBUG_GROUPS } from '../format.js';

const LAYER_HINTS = {
  none: '正片画面：只有场景本身',
  objectId: '每栋建筑、巨构分块、水体与道具的稳定 ID 色',
  wireframe: '地形网格、LOD 接缝与近处步行碰撞体',
  lod: '地形、水面、城市与巨构的细节层级',
  normals: '法线通道',
  'view:ao': '环境光遮蔽缓冲（相机贴近地面、AO 开启时才有画面）',
  province: '十二省域着色',
  zone: '富氧区 / 宜居区',
  density: '建设密度控制图',
  emission: '夜光强度控制图',
};

export class LayersPanel {
  constructor(ui) {
    this.ui = ui;
    this.id = 'layers';
    this.title = '图层';
    const s = ui.app.state.settings;

    // one radio group across the sub-groups (roving tabindex, arrow keys walk the flat list)
    // the AO channel exists only in the real pipeline (GTAO, render/pipeline.js settings.debugView 'ao')
    const pipe = ui.app.pipeline;
    const hasAO = !!pipe && typeof pipe === 'object' && 'aoOn' in pipe;
    this.radios = h('div', { class: 'mui-layer-groups', role: 'radiogroup', 'aria-label': '调试图层' });
    this.layerBtns = [];
    for (const [title, items] of DEBUG_GROUPS) {
      const grid = h('div', { class: 'mui-layer-grid' });
      for (const [v, label] of items) {
        if (v === 'view:ao' && !hasAO) continue;
        const b = h('button', { type: 'button', role: 'radio', class: 'mui-layer', 'data-value': v, 'aria-checked': 'false', tabIndex: -1, title: LAYER_HINTS[v] },
          h('span', { class: 'mui-layer-dot', 'aria-hidden': 'true' }), h('span', { class: 'mui-layer-label' }, label));
        b.addEventListener('click', () => this.setLayer(v));
        this.layerBtns.push(b);
        grid.append(b);
      }
      if (grid.children.length) this.radios.append(h('div', { class: 'mui-layer-group', role: 'presentation' }, h('div', { class: 'mui-layer-gtitle', 'aria-hidden': 'true' }, title), grid));
    }
    this.radios.addEventListener('keydown', (e) => {
      const n = this.layerBtns.length;
      const i = Math.max(0, this.layerBtns.findIndex((b) => b.getAttribute('aria-checked') === 'true'));
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j == null) return;
      e.preventDefault();
      e.stopPropagation();
      this.setLayer(this.layerBtns[j].dataset.value);
      this.layerBtns[j].focus();
    });
    this.layerHint = h('p', { class: 'mui-note' });

    const set = (k) => (v) => ui.app.state.set(k, v);
    this.labels = switchRow('文字标签', { checked: s.labels, onChange: set('labels'), hint: '省域、巨构与选中建筑的名称' });
    this.outlines = switchRow('选中描边', { checked: s.outlines, onChange: set('outlines'), hint: '选中建筑的轮廓线（关闭后凭体量、材质与邻接关系辨认）' });
    this.clouds = switchRow('云层', { checked: s.clouds, onChange: set('clouds') });
    this.clean = switchRow('净屏', { checked: s.clean, onChange: (v) => ui.setClean(v), kbd: 'H', hint: '只保留画面：隐藏界面、标签、描边与调试层' });
    this.diag = switchRow('诊断面板', { checked: !!ui.prefs.diag, onChange: (v) => ui.diag.setOpen(v), kbd: 'F3', hint: '帧率、绘制调用、三角形、工作线程与相机位姿' });

    const plain = button('正片观察', { cls: 'mui-btn-quiet mui-btn-xs', iconName: 'frame', onclick: () => this.allOff(), title: '关闭标签、描边与调试图层，先观察正片' });
    this.el = h('div', { class: 'mui-pane mui-pane-layers' },
      section('验收顺序', {},
        h('ol', { class: 'mui-steps' },
          h('li', null, h('span', { class: 'mui-step-n mui-num' }, '1'), h('span', null, '关闭标注与调试层，先看正片'), plain),
          h('li', null, h('span', { class: 'mui-step-n mui-num' }, '2'), h('span', null, '再开对象 ID、地形线框与通道定位问题')))),
      section('标注', {}, this.labels.el, this.outlines.el),
      section('调试图层', {}, this.radios, this.layerHint),
      section('画面', {}, this.clean.el, this.clouds.el, this.diag.el),
    );
    this.sync();
    ui.app.events.on('settings', () => this.sync());
  }

  /** current radio value: the pipeline view (debugView) wins over debugLayer */
  current() {
    const s = this.ui.app.state.settings;
    if (s.debugView) return `view:${s.debugView}`;
    return s.debugLayer || 'none';
  }

  setLayer(v) {
    const st = this.ui.app.state;
    if (v.startsWith('view:')) {
      if ((st.settings.debugLayer || 'none') !== 'none') st.set('debugLayer', 'none');
      st.set('debugView', v.slice(5));
    } else {
      if (st.settings.debugView) st.set('debugView', null);
      st.set('debugLayer', v);
    }
  }

  allOff() {
    const st = this.ui.app.state;
    st.set('labels', false);
    st.set('outlines', false);
    if (st.settings.debugView) st.set('debugView', null);
    st.set('debugLayer', 'none');
    this.ui.toast.show('已关闭标签、描边与调试图层：正片观察');
  }

  sync() {
    const s = this.ui.app.state.settings;
    const cur = this.current();
    let any = false;
    for (const b of this.layerBtns) {
      const on = b.dataset.value === cur;
      if (on) any = true;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!any && this.layerBtns[0]) this.layerBtns[0].tabIndex = 0;
    this.layerHint.textContent = LAYER_HINTS[cur] ? `当前：${LAYER_HINTS[cur]}` : `当前：${cur}`;
    this.labels.set(s.labels);
    this.outlines.set(s.outlines);
    this.clouds.set(s.clouds);
    this.clean.set(s.clean);
    this.diag.set(!!this.ui.prefs.diag);
  }
}
