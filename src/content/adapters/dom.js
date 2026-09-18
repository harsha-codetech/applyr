/**
 * The low-level DOM writes every adapter shares.
 *
 * The important one is setNativeValue(). React (and Vue, and Angular) install
 * their own `value` property on the element instance, so a plain `el.value = x`
 * updates the DOM node while the framework's state keeps the old value - the
 * field looks filled and submits empty. Reaching through to the prototype's
 * native setter, then dispatching a bubbling `input` event, is what makes the
 * framework observe the change. This works from the content script's isolated
 * world because the DOM node itself is shared across worlds.
 */

export function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && typeof desc.set === 'function') {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
}

export function fire(el, type, init = {}) {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

export function fireInput(el) {
  // InputEvent carries the properties some editors read; Event is the fallback.
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: el.value }));
  } catch {
    fire(el, 'input');
  }
}

export function fireKey(el, type, key) {
  el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, composed: true }));
}

export function firePointer(el, type) {
  const opts = { bubbles: true, composed: true, cancelable: true, view: el.ownerDocument.defaultView };
  try {
    el.dispatchEvent(new PointerEvent(type, opts));
  } catch {
    el.dispatchEvent(new MouseEvent(type, opts));
  }
}

/** A click that widget libraries actually believe: pointer + mouse + click. */
export function realClick(el) {
  firePointer(el, 'pointerdown');
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true }));
  firePointer(el, 'pointerup');
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, cancelable: true }));
  el.click();
}

export function focus(el) {
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      /* detached */
    }
  }
}

export function blur(el) {
  try {
    el.blur();
  } catch {
    /* detached */
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll for a condition. Resolves with the value, or null on timeout. */
export async function waitFor(fn, { timeout = 1200, interval = 40 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}
