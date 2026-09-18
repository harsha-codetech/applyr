/**
 * Split date fields - one logical date spread across month / day / year inputs.
 *
 * Workday's `dateSectionMonth-input` trio is the common case, but the pattern
 * shows up in older enterprise forms too. Each box is filled through the native
 * setter with its own `input` event, because the widget validates and advances
 * focus per segment; writing all three without events leaves the component's
 * state empty even though the boxes look right.
 */

import { setNativeValue, fireInput, fire, focus, blur, sleep } from './dom.js';

/**
 * Parse anything reasonable into {y, m, d}.
 * Returns null when there is not enough to work with.
 */
export function parseDateParts(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (iso) return { y: iso[1], m: iso[2].padStart(2, '0'), d: (iso[3] || '01').padStart(2, '0') };

  // mm/dd/yyyy, or dd/mm/yyyy when the first part cannot be a month.
  const slash = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    return { y: slash[3], m: String(month).padStart(2, '0'), d: String(day).padStart(2, '0') };
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      y: String(parsed.getFullYear()),
      m: String(parsed.getMonth() + 1).padStart(2, '0'),
      d: String(parsed.getDate()).padStart(2, '0')
    };
  }

  // "2026" alone, or "March 2026"
  const yearOnly = s.match(/(19|20)\d{2}/);
  if (yearOnly) return { y: yearOnly[0], m: '01', d: '01' };

  return null;
}

async function setPart(el, value) {
  if (!el) return;
  focus(el);
  if (el.value) {
    setNativeValue(el, '');
    fireInput(el);
  }
  setNativeValue(el, value);
  fireInput(el);
  fire(el, 'change');
  await sleep(10);
  blur(el);
}

export async function fillDateGroup(desc, value) {
  const parts = parseDateParts(value);
  if (!parts) throw new Error(`cannot read a date out of "${value}"`);

  // Month first: some widgets clamp the day once a month is known.
  await setPart(desc.parts.month, parts.m);
  await setPart(desc.parts.day, parts.d);
  await setPart(desc.parts.year, parts.y);
  await sleep(30);
}
