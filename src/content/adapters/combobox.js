/**
 * Custom dropdowns - react-select, Ashby's picker, Workday's listbox, and the
 * long tail of div-based widgets.
 *
 * These cannot be filled by writing a value: the visible text is rendered from
 * component state that only changes in response to a real interaction. So the
 * adapter drives the widget the way a person would - open it, optionally type to
 * filter, wait for the listbox (which is usually portalled to <body>, not nested
 * inside the trigger), then click the matching option.
 */

import { setNativeValue, fireInput, fireKey, realClick, focus, waitFor, sleep } from './dom.js';
import { matchOption } from './choice.js';
import { deepQueryAll, isVisible } from '../detector.js';
import { normalizeText } from '../../core/util.js';

const DEFAULT_OPTION_SELECTORS = [
  '[role="option"]',
  '.select__option',
  '[class*="option" i][id*="option" i]',
  'li[data-value]'
];

function optionSelectors(widgets) {
  const extra = widgets && widgets.combobox && widgets.combobox.option;
  return extra ? [extra, ...DEFAULT_OPTION_SELECTORS] : DEFAULT_OPTION_SELECTORS;
}

function findTypeInput(root) {
  if (root.tagName === 'INPUT') return root;
  return (
    root.querySelector?.('input[role="combobox"], input[aria-autocomplete], input:not([type="hidden"])') || null
  );
}

function visibleOptions(doc, selectors) {
  const els = deepQueryAll(doc, (n) => {
    for (const sel of selectors) {
      try {
        if (n.matches(sel)) return true;
      } catch {
        /* bad selector from a pack - ignore */
      }
    }
    return false;
  }).filter(isVisible);

  return els.map((el) => ({
    el,
    value: el.getAttribute('data-value') || el.getAttribute('value') || (el.textContent || '').trim(),
    label: (el.textContent || '').replace(/\s+/g, ' ').trim()
  })).filter((o) => o.label);
}

/** The element that actually opens the menu. */
function triggerFor(desc, widgets) {
  const hint = widgets && widgets.combobox && widgets.combobox.trigger;
  if (hint) {
    try {
      const own = desc.el.matches(hint) ? desc.el : desc.el.querySelector(hint) || desc.el.closest(hint);
      if (own) return own;
    } catch {
      /* ignore */
    }
  }
  return desc.el;
}

export async function fillCombobox(desc, value, widgets = {}) {
  const doc = desc.el.ownerDocument;
  const selectors = optionSelectors(widgets);
  const trigger = triggerFor(desc, widgets);
  const input = findTypeInput(desc.el) || findTypeInput(trigger);

  focus(input || trigger);
  realClick(trigger);

  let options = await waitFor(() => {
    const o = visibleOptions(doc, selectors);
    return o.length ? o : null;
  }, { timeout: 900 });

  // Nothing appeared - many of these widgets only render the list once the user
  // starts typing, so type the value and look again.
  if (input) {
    setNativeValue(input, String(value));
    fireInput(input);
    fireKey(input, 'keydown', String(value).slice(-1));
    fireKey(input, 'keyup', String(value).slice(-1));
    options = await waitFor(() => {
      const o = visibleOptions(doc, selectors);
      return o.length ? o : null;
    }, { timeout: 1200 }) || options;
  }

  if (!options || !options.length) {
    throw new Error('dropdown did not open');
  }

  const hit = matchOption(options, value);
  if (!hit) {
    // Close the menu again rather than leaving the page in a weird state.
    fireKey(input || trigger, 'keydown', 'Escape');
    throw new Error(`no option matching "${value}"`);
  }

  realClick(hit.el);
  await sleep(60);

  // Some widgets need an explicit Enter to commit the highlighted option.
  const settled = normalizeText(trigger.textContent || (input && input.value) || '');
  if (!settled.includes(normalizeText(hit.label).slice(0, 12)) && input) {
    fireKey(input, 'keydown', 'Enter');
    await sleep(60);
  }
}
