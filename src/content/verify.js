/**
 * Read-back verification.
 *
 * Writing a value is not evidence that it stuck: a masked input may reformat it,
 * a framework may revert it on the next render, a dropdown may silently reject
 * an option. Every fill is therefore re-read and compared, and anything that
 * does not match comes back as `unverified` rather than being reported as a
 * success. This is the difference between an autofill tool you can trust and one
 * that quietly submits half-empty applications.
 */

import { normalizeText } from '../core/util.js';

function readBack(desc) {
  const el = desc.el;
  switch (desc.kind) {
    case 'checkbox':
      return el.checked ? 'true' : 'false';
    case 'radio-group': {
      const on = desc.options.find((o) => o.el.checked);
      return on ? on.label || on.value : '';
    }
    case 'select': {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? opt.textContent || opt.value : el.value;
    }
    case 'file':
      return el.files && el.files.length ? el.files[0].name : '';
    case 'contenteditable':
      return el.textContent || '';
    case 'combobox': {
      const input = el.tagName === 'INPUT' ? el : el.querySelector?.('input');
      const typed = input && input.value;
      return typed || el.textContent || '';
    }
    default:
      return el.value || '';
  }
}

/** Loose equality - "United States" vs "United States of America" should pass. */
function matches(actual, expected, kind) {
  const a = normalizeText(actual);
  const e = normalizeText(expected);
  if (!e) return true;
  if (!a) return false;
  if (a === e) return true;

  if (kind === 'checkbox') return a === e;
  if (kind === 'file') {
    // Uploaders often rename or truncate; matching the stem is enough.
    const stem = e.replace(/\.[a-z0-9]+$/, '');
    return a.includes(stem.slice(0, 12)) || stem.includes(a.replace(/\.[a-z0-9]+$/, '').slice(0, 12));
  }

  // Numbers: 5 vs "5 years" vs "5.0"
  const na = a.replace(/[^0-9.]/g, '');
  const ne = e.replace(/[^0-9.]/g, '');
  if (ne && na && parseFloat(na) === parseFloat(ne)) return true;

  if (a.includes(e) || e.includes(a)) return true;

  // Phone / date reformatting: compare digits only.
  const da = a.replace(/\D/g, '');
  const de = e.replace(/\D/g, '');
  if (de.length >= 6 && da === de) return true;

  return false;
}

/**
 * @returns {{ok: boolean, actual: string}}
 */
export function verifyEntry(entry) {
  const actual = readBack(entry.desc);
  return { ok: matches(actual, entry.value, entry.desc.kind), actual: String(actual).trim() };
}
