/** Tiny DOM helpers - enough structure to keep the views declarative without a framework. */

export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function field(labelText, control, hint) {
  return h('label', { class: 'field' }, [
    h('span', {}, labelText),
    control,
    hint ? h('div', { class: 'small muted' }, hint) : null
  ]);
}

export function card(title, children) {
  return h('div', { class: 'card' }, [title ? h('h3', {}, title) : null, ...[].concat(children)]);
}

export function group(title, children, open = false) {
  const d = h('details', { class: 'group', ...(open ? { open: true } : {}) }, [
    h('summary', {}, title),
    h('div', { class: 'body' }, children)
  ]);
  return d;
}

export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

export function confirmInline(button, message, onYes) {
  const original = button.textContent;
  button.textContent = message;
  const reset = () => {
    button.textContent = original;
    button.removeEventListener('click', yes);
    document.removeEventListener('click', away, true);
  };
  const yes = (ev) => {
    ev.stopPropagation();
    reset();
    onYes();
  };
  const away = (ev) => {
    if (ev.target !== button) reset();
  };
  button.addEventListener('click', yes, { once: true });
  setTimeout(() => document.addEventListener('click', away, true), 0);
}

export function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
