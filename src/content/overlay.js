/**
 * In-page HUD.
 *
 * Rendered into a shadow root so no host-page stylesheet can reach it and none
 * of its styles leak out. It exists to make the fill auditable: every field the
 * extension touched is ringed, and anything it could not resolve is listed with
 * a one-click way to teach the answer for next time.
 */

import { OUTCOME } from '../core/messages.js';

const HOST_ID = 'applyr-hud-host';

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 320px; max-height: 60vh; display: flex; flex-direction: column;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #0f172a; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 10px 34px rgba(15, 23, 42, 0.18); overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .wrap { color: #e2e8f0; background: #0f172a; border-color: #1e293b; }
  .row { border-color: #1e293b; }
  .muted { color: #94a3b8; }
  input, button.ghost { background: #1e293b; color: #e2e8f0; border-color: #334155; }
}
header {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid currentColor; border-color: #e2e8f0;
  background: linear-gradient(180deg, rgba(47,111,237,.08), transparent);
}
.brand { font-weight: 650; letter-spacing: -0.01em; }
.counts { margin-left: auto; display: flex; gap: 8px; font-variant-numeric: tabular-nums; }
.pill { padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.pill.ok { background: rgba(22,163,74,.14); color: #15803d; }
.pill.warn { background: rgba(217,119,6,.16); color: #b45309; }
.pill.unk { background: rgba(100,116,139,.16); color: #475569; }
button.x { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; opacity: .6; }
button.x:hover { opacity: 1; background: rgba(100,116,139,.15); }
.list { overflow-y: auto; padding: 4px 0; }
.row { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 6px; }
.row:last-child { border-bottom: 0; }
.row .top { display: flex; align-items: flex-start; gap: 8px; }
.dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto; }
.dot.warn { background: #d97706; }
.dot.err { background: #dc2626; }
.dot.unk { background: #64748b; }
.label { flex: 1; font-weight: 550; word-break: break-word; }
.muted { color: #64748b; font-size: 12px; }
.actions { display: flex; gap: 6px; }
button.ghost {
  all: unset; cursor: pointer; font-size: 12px; padding: 3px 9px; border-radius: 7px;
  border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 550;
}
button.ghost:hover { border-color: #94a3b8; }
button.primary {
  all: unset; cursor: pointer; font-size: 12px; padding: 3px 10px; border-radius: 7px;
  background: #2f6fed; color: #fff; font-weight: 600;
}
input, textarea {
  font: inherit; width: 100%; box-sizing: border-box; padding: 5px 8px;
  border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: inherit;
}
textarea { min-height: 54px; resize: vertical; }
.empty { padding: 14px 12px; }
footer { padding: 8px 12px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; align-items: center; }
`;

let host = null;
let shadow = null;
let handlers = {};
let state = { counts: {}, items: [], note: '' };

export function isMounted() {
  return Boolean(host && host.isConnected);
}

export function mount(callbacks = {}) {
  handlers = callbacks;
  if (isMounted()) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.append(style, document.createElement('div'));
  (document.body || document.documentElement).appendChild(host);
  render();
}

export function unmount() {
  clearRings();
  host?.remove();
  host = null;
  shadow = null;
}

// ---------------------------------------------------------------------------
// Field rings
// ---------------------------------------------------------------------------

const RING_CLASSES = ['applyr-ring-ok', 'applyr-ring-warn', 'applyr-ring-err', 'applyr-ring-focus'];
const ringed = new Set();

export function ring(el, kind) {
  if (!el || !el.classList) return;
  el.classList.remove(...RING_CLASSES);
  const cls = {
    ok: 'applyr-ring-ok', warn: 'applyr-ring-warn', err: 'applyr-ring-err', focus: 'applyr-ring-focus'
  }[kind];
  if (cls) {
    el.classList.add(cls);
    ringed.add(el);
  }
}

export function clearRings() {
  for (const el of ringed) el.classList?.remove(...RING_CLASSES);
  ringed.clear();
}

export function flashFocus(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = [...RING_CLASSES].find((c) => el.classList?.contains(c));
  ring(el, 'focus');
  setTimeout(() => {
    el.classList?.remove('applyr-ring-focus');
    if (prev) el.classList?.add(prev);
  }, 1400);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function update(next) {
  state = { ...state, ...next };
  if (isMounted()) render();
}

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function render() {
  if (!shadow) return;
  const root = shadow.lastElementChild;
  root.textContent = '';

  const c = state.counts || {};
  const wrap = h('div', { class: 'wrap' });

  wrap.append(h('header', {}, [
    h('span', { class: 'brand' }, 'applyr'),
    h('span', { class: 'counts' }, [
      c.filled ? h('span', { class: 'pill ok' }, `${c.filled} filled`) : null,
      c.attention ? h('span', { class: 'pill warn' }, `${c.attention} check`) : null,
      c.unresolved ? h('span', { class: 'pill unk' }, `${c.unresolved} unknown`) : null
    ]),
    h('button', { class: 'x', title: 'Close', onclick: () => unmount() }, '×')
  ]));

  const list = h('div', { class: 'list' });

  if (!state.items.length) {
    list.append(h('div', { class: 'empty muted' },
      state.note || 'Everything applyr recognised is filled. Review, then submit yourself.'));
  }

  for (const item of state.items) {
    list.append(renderItem(item));
  }
  wrap.append(list);

  wrap.append(h('footer', {}, [
    h('span', { class: 'muted' }, 'applyr never submits for you.'),
    h('button', {
      class: 'ghost',
      style: 'margin-left:auto',
      onclick: () => handlers.onRefill && handlers.onRefill()
    }, 'Fill again')
  ]));

  root.append(wrap);
}

function renderItem(item) {
  const dotKind = item.outcome === OUTCOME.UNRESOLVED ? 'unk'
    : item.outcome === OUTCOME.FAILED ? 'err' : 'warn';

  const row = h('div', { class: 'row' });
  row.append(h('div', { class: 'top' }, [
    h('span', { class: `dot ${dotKind}` }),
    h('div', { class: 'label' }, [
      item.label || '(unlabelled field)',
      item.detail ? h('div', { class: 'muted' }, item.detail) : null
    ])
  ]));

  const actions = h('div', { class: 'actions' });
  actions.append(h('button', {
    class: 'ghost',
    onclick: () => handlers.onJump && handlers.onJump(item.key)
  }, 'Show me'));

  if (item.outcome === OUTCOME.UNRESOLVED && item.teachable) {
    actions.append(h('button', {
      class: 'ghost',
      onclick: () => openTeach(row, item)
    }, 'Teach answer'));
  }
  row.append(actions);
  return row;
}

function openTeach(row, item) {
  if (row.querySelector('.teach')) return;
  const long = item.kind === 'textarea' || item.kind === 'contenteditable';
  const input = h(long ? 'textarea' : 'input', { placeholder: 'Your answer' });
  const box = h('div', { class: 'teach' }, [
    input,
    h('div', { class: 'actions', style: 'margin-top:6px' }, [
      h('button', {
        class: 'primary',
        onclick: () => {
          const answer = input.value.trim();
          if (!answer) return;
          handlers.onTeach && handlers.onTeach(item.key, item.label, answer, item.kind);
        }
      }, 'Save & fill'),
      h('button', { class: 'ghost', onclick: () => box.remove() }, 'Cancel')
    ])
  ]);
  row.append(box);
  input.focus();
}
