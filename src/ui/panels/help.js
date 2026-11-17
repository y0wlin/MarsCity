// 帮助 panel: camera controls (from controls/index.js CONTROLS_HELP when it exists) and the UI
// keyboard shortcuts. OWNER: ui agent.
import { h, clear } from '../dom.js';
import { section } from '../widgets.js';
import { MODE_NAMES } from '../format.js';

// Used until the controls module publishes CONTROLS_HELP (prompt §4 interaction requirements).
const FALLBACK_CONTROLS = [
  ['拖动', '环绕行星'],
  ['滚轮 / 双指', '向指针位置推近或拉远'],
  ['右键拖动 / Ctrl 拖动', '倾斜视角、转动朝向'],
  ['点击地表', '选择经纬度，查看省域'],
  ['点击建筑', '选中建筑，可环看或进入'],
];

export const UI_SHORTCUTS = [
  [['H'], '净屏：只保留画面'],
  [['B'], '打开书签'],
  [['/'], '搜索建筑 ID、经纬度或省域'],
  [['1', '9'], '预设镜头（步行、飞行时不可用）', '–'],
  [['T'], '播放 / 暂停时间'],
  [['[', ']'], '时间后退 / 前进 1 小时（Shift：10 分钟）', ' '],
  [['Esc'], '关闭面板、取消选择'],
  [['F3'], '诊断面板（也可用 `）'],
];

function keyCombo(keys, sep = ' ') {
  const out = [];
  keys.forEach((k, i) => { if (i) out.push(h('span', { class: 'mui-kbd-sep' }, sep)); out.push(h('kbd', null, k)); });
  return out;
}

/** Normalise any reasonable CONTROLS_HELP shape into [{title?, rows:[[keys, action]]}] */
export function normaliseHelp(src) {
  if (!src) return null;
  const rowOf = (r) => {
    if (Array.isArray(r)) return [String(r[0] ?? ''), String(r[1] ?? '')];
    if (r && typeof r === 'object') {
      const k = r.keys ?? r.key ?? r.input ?? r.gesture ?? r.combo ?? '';
      const a = r.action ?? r.desc ?? r.description ?? r.label ?? r.text ?? '';
      return [Array.isArray(k) ? k.join(' / ') : String(k), String(a)];
    }
    return [String(r), ''];
  };
  if (typeof src === 'string') return [{ title: null, rows: src.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.+?)(?:\s{2,}|\s*[:：]\s*)(.+)$/.exec(l); return m ? [m[1], m[2]] : [l, '']; }) }];
  if (Array.isArray(src)) {
    if (src.length && src[0] && typeof src[0] === 'object' && !Array.isArray(src[0]) && Array.isArray(src[0].rows || src[0].items)) {
      return src.map((g) => ({ title: g.title || g.mode || g.name || null, rows: (g.rows || g.items).map(rowOf) }));
    }
    return [{ title: null, rows: src.map(rowOf) }];
  }
  if (typeof src === 'object') {
    return Object.entries(src).map(([k, v]) => ({ title: MODE_NAMES[k] || k, rows: (Array.isArray(v) ? v : typeof v === 'object' ? Object.entries(v) : [[String(v), '']]).map(rowOf) }));
  }
  return null;
}

export class HelpPanel {
  constructor(ui) {
    this.ui = ui;
    this.id = 'help';
    this.title = '帮助';
    this.controlsBox = h('div');
    const shortcuts = h('dl', { class: 'mui-keys' }, ...UI_SHORTCUTS.map(([keys, text, sep]) => h('div', { class: 'mui-keys-row' }, h('dt', null, keyCombo(keys, sep || ' ')), h('dd', null, text))));
    this.el = h('div', { class: 'mui-pane mui-pane-help' },
      this.controlsBox,
      section('快捷键', {}, shortcuts, h('p', { class: 'mui-note' }, '输入文字时，以及步行、飞行模式下，界面不会占用按键。')),
      section('关于', {}, h('p', { class: 'mui-about' }, '同一颗确定性的火星：世界种子 351165。省域、地块、建筑 ID 与书签在每次载入时完全一致，可按 ID 复访。')),
    );
    this._help = undefined;
    this.renderControls();
  }

  onShow() { this.renderControls(); }

  /** CONTROLS_HELP(_SECTIONS) from the controls module; a namespace object, so a missing export is just undefined */
  async loadHelp() {
    if (this._help !== undefined) return this._help;
    try {
      const ns = await import('../../controls/index.js');
      this._help = ns.CONTROLS_HELP_SECTIONS || ns.CONTROLS_HELP || null;
    } catch { this._help = null; }
    return this._help;
  }

  async renderControls() {
    const src = await this.loadHelp();
    clear(this.controlsBox);
    let groups = null;
    try { groups = normaliseHelp(src); } catch { groups = null; }
    if (!groups || !groups.length) groups = [{ title: null, rows: FALLBACK_CONTROLS }];
    groups.forEach((g, i) => {
      const dl = h('dl', { class: 'mui-keys' }, ...g.rows.filter((r) => r[0] || r[1]).map(([k, a]) => h('div', { class: 'mui-keys-row' }, h('dt', null, h('span', { class: 'mui-gesture' }, k)), h('dd', null, a))));
      this.controlsBox.append(section(g.title ? `操作｜${g.title}` : (i ? '' : '操作'), {}, dl));
    });
  }
}
