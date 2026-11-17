// Reusable accessible controls: segmented radio groups, switches, sliders, rows. OWNER: ui agent.
import { h } from './dom.js';

let UID = 0;
export const uid = (p = 'mui') => `${p}-${++UID}`;

/**
 * Segmented radio group with roving tabindex and arrow-key navigation.
 * items: [[value, label, extraAttrs?]] ; returns {el, set(value), get()}
 */
export function segmented(items, { label, value, onChange, cls = '' } = {}) {
  const el = h('div', { class: `mui-seg ${cls}`.trim(), role: 'radiogroup', 'aria-label': label });
  const btns = items.map(([v, text, attrs]) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'mui-seg-btn', 'data-value': v, 'aria-checked': 'false', tabIndex: -1, ...(attrs || {}) }, text);
    b.addEventListener('click', () => { set(v); onChange?.(v, true); });
    return b;
  });
  el.append(...btns);
  el.addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-checked') === 'true'));
    let j = i;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    const v = btns[j].dataset.value;
    set(v);
    btns[j].focus();
    onChange?.(v, true);
  });
  let cur = null;
  function set(v) {
    cur = v;
    let any = false;
    for (const b of btns) {
      const on = b.dataset.value === String(v);
      if (on) any = true;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    if (!any && btns[0]) btns[0].tabIndex = 0;
  }
  set(value);
  return { el, set, get: () => cur, buttons: btns };
}

/** iOS-like switch (button role=switch) with a text label; returns {el, set(bool)} */
export function switchRow(text, { checked = false, onChange, hint, kbd } = {}) {
  const id = uid('sw');
  const sw = h('button', { type: 'button', role: 'switch', class: 'mui-switch', id, 'aria-checked': String(!!checked) }, h('span', { class: 'mui-switch-knob' }));
  const labelEl = h('label', { class: 'mui-row-label', for: id }, text, kbd ? h('kbd', null, kbd) : null);
  const row = h('div', { class: 'mui-row' }, h('div', { class: 'mui-row-text' }, labelEl, hint ? h('div', { class: 'mui-row-hint' }, hint) : null), sw);
  let state = !!checked;
  const set = (v) => { state = !!v; sw.setAttribute('aria-checked', String(state)); };
  sw.addEventListener('click', () => { set(!state); onChange?.(state); });
  labelEl.addEventListener('click', (e) => { e.preventDefault(); sw.click(); sw.focus(); });
  return { el: row, set, get: () => state, control: sw };
}

/** Label + arbitrary control in one row */
export function controlRow(text, control, { hint } = {}) {
  return h('div', { class: 'mui-row' },
    h('div', { class: 'mui-row-text' }, h('div', { class: 'mui-row-label' }, text), hint ? h('div', { class: 'mui-row-hint' }, hint) : null),
    control);
}

/** Range slider with a value readout; returns {el, set(v)} */
export function sliderRow(text, { min, max, step, value, format = (v) => String(v), onInput, onReset, hint } = {}) {
  const id = uid('rg');
  const out = h('output', { class: 'mui-range-val mui-num', for: id });
  const input = h('input', { type: 'range', class: 'mui-range', id, min: String(min), max: String(max), step: String(step), 'aria-label': text });
  input.value = String(value);
  const paint = () => {
    const t = (parseFloat(input.value) - min) / (max - min);
    input.style.setProperty('--t', String(Math.max(0, Math.min(1, t))));
    out.textContent = format(parseFloat(input.value));
    input.setAttribute('aria-valuetext', out.textContent);
  };
  input.addEventListener('input', () => { paint(); onInput?.(parseFloat(input.value)); });
  if (onReset) input.addEventListener('dblclick', () => { onReset(); });
  const row = h('div', { class: 'mui-row mui-row-range' },
    h('div', { class: 'mui-row-text' }, h('label', { class: 'mui-row-label', for: id }, text), hint ? h('div', { class: 'mui-row-hint' }, hint) : null),
    h('div', { class: 'mui-range-wrap' }, input, out));
  paint();
  return { el: row, set: (v) => { input.value = String(v); paint(); }, input };
}

/** Native select (dark via color-scheme) */
export function selectBox(options, { value, onChange, label } = {}) {
  const sel = h('select', { class: 'mui-select', 'aria-label': label });
  for (const [v, t] of options) sel.append(h('option', { value: String(v) }, t));
  sel.value = String(value);
  sel.addEventListener('change', () => onChange?.(sel.value));
  return { el: sel, set: (v) => { sel.value = String(v); } };
}

/** Section with a small heading and optional trailing action */
export function section(title, { action, cls = '' } = {}, ...kids) {
  return h('section', { class: `mui-sec ${cls}`.trim() },
    h('div', { class: 'mui-sec-head' }, h('h3', { class: 'mui-sec-title' }, title), action || null),
    ...kids);
}

/** Definition rows (label / value) */
export function kv(rows) {
  const dl = h('dl', { class: 'mui-kv' });
  for (const r of rows) {
    if (!r || r[1] == null || r[1] === '') continue;
    dl.append(h('div', { class: 'mui-kv-row' }, h('dt', null, r[0]), h('dd', { class: r[2] || null }, r[1])));
  }
  return dl;
}
