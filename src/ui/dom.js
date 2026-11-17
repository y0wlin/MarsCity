// Small DOM helpers shared by the UI components. OWNER: ui agent.
import { icon } from './icons.js';

/**
 * h('button', {class:'x', onclick, 'aria-label':'…'}, child, …) -> HTMLElement.
 * Props: class, style (object or string), dataset (object), on<event> (function),
 * boolean true -> empty attribute, null/false/undefined -> skipped, `html` -> innerHTML.
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.length > 2 && k[0] === 'o' && k[1] === 'n' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'inert' || k === 'tabIndex') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Icon button: h('button') with an svg icon, aria-label and an optional CSS tooltip. */
export function iconButton(name, label, { tip, tipPos, cls = '', size = 18, onclick, attrs } = {}) {
  const b = h('button', {
    type: 'button', class: `mui-ibtn ${cls}`.trim(), 'aria-label': label,
    'data-tip': tip === false ? null : (tip || label), 'data-tip-pos': tipPos || null, onclick, ...(attrs || {}),
  }, icon(name, size));
  return b;
}

/** Text button with optional leading icon. */
export function button(text, { iconName, cls = '', onclick, attrs, title } = {}) {
  return h('button', { type: 'button', class: `mui-btn ${cls}`.trim(), onclick, title, ...(attrs || {}) },
    iconName ? icon(iconName, 16) : null, text != null ? h('span', null, text) : null);
}

/** Only touches the DOM when the text actually changes (cheap per-frame updates). */
export function setText(el, s) {
  if (el.__t !== s) { el.__t = s; el.textContent = s; }
}

export function setAttr(el, k, v) {
  const key = '__a_' + k;
  if (el[key] === v) return;
  el[key] = v;
  if (v == null || v === false) el.removeAttribute(k); else el.setAttribute(k, v === true ? '' : String(v));
}

export function setStyle(el, k, v) {
  const key = '__s_' + k;
  if (el[key] === v) return;
  el[key] = v;
  el.style.setProperty(k, v);
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Copy text to the clipboard; resolves true on success (falls back to execCommand). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export function downloadText(text, name, type = 'application/json') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);
}

/** Opens a file picker; resolves with the File or null. */
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Resolve after n animation frames. */
export function nextFrames(n = 1) {
  return new Promise((resolve) => {
    const step = () => { if (--n <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** true when the event target is a text-entry element (keys must not be stolen). */
export function isTypingTarget(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(type);
  }
  return false;
}
