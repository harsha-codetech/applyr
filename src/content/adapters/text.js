/** Text, email, tel, url, number, date, textarea and contenteditable controls. */

import { setNativeValue, fireInput, fire, focus, blur, sleep } from './dom.js';

/** HTML date inputs need yyyy-mm-dd; month inputs need yyyy-mm. */
function coerceDate(value, inputType) {
  const s = String(value).trim();
  if (inputType === 'date' || inputType === 'month') {
    const iso = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (iso) return inputType === 'month' ? `${iso[1]}-${iso[2]}` : `${iso[1]}-${iso[2]}-${iso[3] || '01'}`;
    const us = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (us) {
      const mm = us[1].padStart(2, '0');
      const dd = us[2].padStart(2, '0');
      return inputType === 'month' ? `${us[3]}-${mm}` : `${us[3]}-${mm}-${dd}`;
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return inputType === 'month' ? `${y}-${m}` : `${y}-${m}-${d}`;
    }
  }
  return s;
}

export async function fillText(desc, value) {
  const el = desc.el;

  if (desc.kind === 'contenteditable') {
    focus(el);
    el.textContent = String(value);
    fireInput(el);
    fire(el, 'change');
    blur(el);
    return;
  }

  const inputType = (el.getAttribute('type') || desc.inputType || 'text').toLowerCase();
  const next = coerceDate(value, inputType);

  focus(el);
  // Clear first: some masked inputs append rather than replace.
  if (el.value) {
    setNativeValue(el, '');
    fireInput(el);
  }
  setNativeValue(el, next);
  fireInput(el);
  fire(el, 'change');
  await sleep(0);
  blur(el);
  // A few validators only run on blur, and a few re-render on focusout.
  fire(el, 'focusout');
}
