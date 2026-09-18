/** Native <select>, checkboxes and radio groups. */

import { setNativeValue, fire, realClick, sleep } from './dom.js';
import { normalizeText, looksYes, looksNo } from '../../core/util.js';

/** Rank option candidates: exact > startsWith > contains > token overlap. */
export function matchOption(options, wanted) {
  const target = normalizeText(wanted);
  if (!target) return null;

  const scored = options.map((o) => {
    const label = normalizeText(o.label);
    const value = normalizeText(o.value);
    let score = 0;
    if (label === target || value === target) score = 1;
    else if (label.startsWith(target) || target.startsWith(label)) score = 0.85;
    else if (label.includes(target) || target.includes(label)) score = 0.7;
    else {
      const a = new Set(target.split(' ').filter(Boolean));
      const b = new Set(label.split(' ').filter(Boolean));
      if (a.size && b.size) {
        let hits = 0;
        for (const t of a) if (b.has(t)) hits++;
        score = hits / Math.max(a.size, b.size) * 0.6;
      }
    }
    return { option: o, score };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored[0] && scored[0].score >= 0.55 ? scored[0].option : null;
}

/** Yes/no questions rendered as a two-option list. */
function matchBoolean(options, wanted) {
  const yes = looksYes(wanted);
  const no = looksNo(wanted) || String(wanted) === 'false';
  if (!yes && !no) return null;
  return options.find((o) => (yes ? looksYes(o.label) : looksNo(o.label))) || null;
}

export async function fillSelect(desc, value) {
  const el = desc.el;
  const options = desc.options.filter((o) => o.value !== '' || normalizeText(o.label));
  const hit = matchBoolean(options, value) || matchOption(options, value);
  if (!hit) throw new Error(`no option matching "${value}"`);

  setNativeValue(el, hit.value);
  // <select> ignores the native input setter in some engines; assign directly too.
  if (el.value !== hit.value) el.value = hit.value;
  fire(el, 'input');
  fire(el, 'change');
  await sleep(0);
}

export async function fillCheckbox(desc, value) {
  const el = desc.el;
  const want = looksYes(value) || value === 'true' || value === true;
  if (el.checked !== want) {
    // click() rather than setting .checked, so framework handlers see it.
    realClick(el);
    await sleep(0);
    if (el.checked !== want) {
      el.checked = want;
      fire(el, 'input');
      fire(el, 'change');
    }
  }
}

export async function fillRadioGroup(desc, value) {
  const options = desc.options;
  const hit = matchBoolean(options, value) || matchOption(options, value);
  if (!hit) throw new Error(`no radio option matching "${value}"`);
  if (!hit.el.checked) {
    realClick(hit.el);
    await sleep(0);
    if (!hit.el.checked) {
      hit.el.checked = true;
      fire(hit.el, 'input');
      fire(hit.el, 'change');
    }
  }
}
