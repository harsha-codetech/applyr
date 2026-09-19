/**
 * Form detection.
 *
 * Walks the document - including open shadow roots - and turns raw controls into
 * "descriptors": a normalised view of a form field with its best-guess visible
 * label. Everything downstream (resolver, adapters, overlay) works on
 * descriptors and never touches the DOM tree structure again.
 */

import { normalizeText } from '../core/util.js';

const SKIP_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'password'
]);

/** Inputs whose presence usually means "this is a login box, not an application". */
const AUTH_HINT = /(^|\W)(password|sign[\s_-]?in|log[\s_-]?in)(\W|$)/i;

/**
 * Controls that belong to the page's own machinery rather than to the
 * application. Greenhouse, for one, renders reCAPTCHA as a real <textarea>,
 * which would otherwise look like a perfectly good free-text answer field and
 * could be filled from question memory.
 */
// "captcha" alone, so g-recaptcha-response, h-captcha-response and friends all
// match. The trailing pattern catches honeypots named like BambooHR's
// `nickname_hpcsaf` - an "hp" segment plus a random suffix.
const IGNORE_CONTROL = /captcha|turnstile|csrf|authenticity[_-]?token|honeypot|__RequestVerificationToken|(^|[_-])hp[a-z0-9]{0,10}$/i;

/**
 * Honeypots announce themselves to screen readers while staying invisible to
 * sighted users. BambooHR's is the instructive case: a fully visible 214x28
 * input, opacity 1, labelled "Please leave this field blank" and marked
 * tabindex="-1". Nothing about its geometry gives it away, and its name
 * (`nickname_hpcsaf`) matches the taxonomy's `preferred_name` pattern - so
 * filling it was one regex away from flagging a real application as a bot.
 */
const LEAVE_BLANK = /leave\s+(this\s+)?(field\s+)?(blank|empty)|do\s+not\s+(fill|complete|enter)|anti-?spam/i;

export function isIgnored(el) {
  const haystack = [
    el.getAttribute('name'),
    el.getAttribute('id'),
    typeof el.className === 'string' ? el.className : ''
  ].filter(Boolean).join(' ');
  if (IGNORE_CONTROL.test(haystack)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;

  const hint = [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.labels && el.labels[0] ? el.labels[0].textContent : ''
  ].filter(Boolean).join(' ');
  if (LEAVE_BLANK.test(hint)) return true;

  // `tabindex="-1"` is deliberately NOT treated as a honeypot signal on its own.
  // It looks like one, but on the same BambooHR form that carries the honeypot,
  // the real Country and Highest Education selects are also tabindex="-1"
  // (they sit behind custom widgets), and Greenhouse marks the inner inputs of
  // its comboboxes the same way. Excluding on that alone silently dropped real
  // fields. The name pattern and the "leave blank" label each catch the honeypot
  // by themselves, so the weaker signal buys nothing and costs real coverage.

  return false;
}

let uidCounter = 0;
function nextKey() {
  uidCounter += 1;
  return `f${uidCounter}`;
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/** Collect every element matching `selector`, descending into open shadow roots. */
export function deepQueryAll(root, predicate) {
  const out = [];
  const stack = [root];
  const seen = new Set();

  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);

    if (node.nodeType === Node.ELEMENT_NODE && predicate(node)) out.push(node);

    if (node.shadowRoot) stack.push(node.shadowRoot);

    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  return out;
}

export function isVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.disabled) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!style) return false;
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  // A zero-size box is still fillable when it is a styled file input hidden
  // behind a drop zone, so file inputs get a pass.
  if (rect.width === 0 && rect.height === 0) {
    return el.tagName === 'INPUT' && el.type === 'file';
  }
  return true;
}

// ---------------------------------------------------------------------------
// Label extraction
// ---------------------------------------------------------------------------

function textOf(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  // Strip the control itself and any helper text that would poison the label.
  clone.querySelectorAll?.('input, select, textarea, button, svg, script, style').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function fromAriaLabelledBy(el) {
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (!ids.length) return '';
  const doc = el.getRootNode();
  return ids
    .map((id) => textOf(doc.getElementById ? doc.getElementById(id) : null))
    .filter(Boolean)
    .join(' ');
}

function fromAncestors(el) {
  let node = el.parentElement;
  let hops = 0;
  while (node && hops < 5) {
    // A wrapping <label> is the strongest signal.
    if (node.tagName === 'LABEL') {
      const t = textOf(node);
      if (t) return t;
    }
    const labelish = node.querySelector?.(
      'label, legend, .label, [class*="label" i], [class*="lbl" i], [data-testid*="label" i]'
    );
    if (labelish && !labelish.contains(el)) {
      const t = textOf(labelish);
      if (t && t.length < 300) return t;
    }
    node = node.parentElement;
    hops += 1;
  }
  return '';
}

/**
 * Labels that are not marked up as labels at all: a <td> to the left of the
 * input, a <th> at the head of the row, or a bare <div>/<span> immediately
 * before the control. Legacy enterprise forms are full of these, and without
 * this stage generic mode reads nothing but opaque control names.
 */
function fromNeighbors(el) {
  const cell = el.closest?.('td');
  if (cell) {
    const prev = cell.previousElementSibling;
    if (prev && (prev.tagName === 'TD' || prev.tagName === 'TH')) {
      const t = textOf(prev);
      if (t && t.length < 200) return t;
    }
    const row = cell.closest('tr');
    const th = row && row.querySelector('th');
    if (th) {
      const t = textOf(th);
      if (t && t.length < 200) return t;
    }
  }

  let node = el;
  let hops = 0;
  while (node && hops < 4) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (!sib.querySelector?.('input, select, textarea')
        && !['INPUT', 'SELECT', 'TEXTAREA', 'SCRIPT', 'STYLE'].includes(sib.tagName)) {
        const t = textOf(sib);
        if (t && t.length < 200) return t;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
    hops += 1;
  }
  return '';
}

function humanizeAttr(s) {
  return String(s || '')
    .replace(/\[|\]/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every attribute worth pattern-matching against, joined into one haystack. */
export function attrHaystack(el) {
  const bits = [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('data-qa'),
    el.getAttribute('data-testid'),
    el.getAttribute('data-automation-id'),
    el.getAttribute('data-field'),
    el.getAttribute('formcontrolname')
  ].filter(Boolean);
  return bits.join(' ');
}

/** Best-effort visible label for a control. */
export function labelFor(el) {
  // 1. <label for=...>
  if (el.labels && el.labels.length) {
    const t = textOf(el.labels[0]);
    if (t) return t;
  }
  // 2. aria-labelledby
  const byAria = fromAriaLabelledBy(el);
  if (byAria) return byAria;
  // 3. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  // 4. wrapping/sibling label-ish node
  const anc = fromAncestors(el);
  if (anc) return anc;
  // 5. placeholder / title
  const ph = el.getAttribute('placeholder') || el.getAttribute('title');
  if (ph && ph.trim()) return ph.trim();
  // 6. unmarked-up neighbour text (table cells, bare divs)
  const nb = fromNeighbors(el);
  if (nb) return nb;
  // 7. last resort: humanised attribute
  return humanizeAttr(attrHaystack(el).split(' ')[0] || '');
}

/** Label for a radio/checkbox group - prefers the fieldset legend. */
function groupLabel(els) {
  const first = els[0];
  const fs = first.closest?.('fieldset');
  if (fs) {
    const legend = fs.querySelector('legend');
    const t = textOf(legend);
    if (t) return t;
  }
  const grouped = first.closest?.('[role="group"], [role="radiogroup"]');
  if (grouped) {
    const t = textOf(grouped.querySelector('legend, .label, [class*="label" i]'));
    if (t) return t;
  }
  return fromAncestors(first) || humanizeAttr(first.getAttribute('name') || '');
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

function optionsOfSelect(el) {
  return [...el.options].map((o) => ({
    value: o.value,
    label: (o.textContent || '').trim(),
    el: o
  }));
}

function optionsOfGroup(els) {
  return els.map((el) => ({
    value: el.value,
    label: labelFor(el),
    el
  }));
}

/**
 * Split date inputs.
 *
 * Workday renders a single date as three separate text boxes -
 * `dateSectionMonth-input`, `dateSectionDay-input`, `dateSectionYear-input` -
 * inside one wrapper. Treated individually they are three unlabelled numeric
 * fields that no taxonomy pattern matches; worse, a naive fill would put an
 * entire ISO date into the month box. Grouping them into one descriptor lets
 * the resolver see a single "date" field with the wrapper's label.
 */
const DATE_PART = /dateSection(Month|Day|Year)/i;

export function datePartKind(el) {
  const aid = el.getAttribute && el.getAttribute('data-automation-id');
  if (!aid) return null;
  const m = aid.match(DATE_PART);
  return m ? m[1].toLowerCase() : null;
}

function dateWrapperOf(el) {
  return el.closest('[data-automation-id="dateInputWrapper"]')
    || el.closest('[data-automation-id*="dateWidget" i]')
    || el.closest('[data-automation-id*="formField" i]')
    || (el.parentElement && el.parentElement.parentElement)
    || el.parentElement;
}

function currentValue(desc) {
  switch (desc.kind) {
    case 'date-group': {
      const { month, day, year } = desc.parts;
      const v = [year, month, day].map((p) => (p && p.value ? p.value : '')).filter(Boolean);
      return v.length ? v.join('-') : '';
    }
    case 'checkbox':
      return desc.el.checked ? 'true' : '';
    case 'radio-group': {
      const on = desc.options.find((o) => o.el.checked);
      return on ? on.value : '';
    }
    case 'file':
      return desc.el.files && desc.el.files.length ? desc.el.files[0].name : '';
    case 'contenteditable':
      return (desc.el.textContent || '').trim();
    default:
      return desc.el.value || '';
  }
}

function makeDescriptor(partial) {
  const desc = {
    key: nextKey(),
    required: false,
    options: [],
    ...partial
  };
  desc.label = desc.label || labelFor(desc.el);
  desc.attrs = desc.attrs !== undefined ? desc.attrs : attrHaystack(desc.el);
  desc.normLabel = normalizeText(desc.label);
  desc.normAttrs = normalizeText(humanizeAttr(desc.attrs));
  desc.autocomplete = (desc.el.getAttribute?.('autocomplete') || '').toLowerCase();
  desc.current = currentValue(desc);
  desc.hasValue = desc.current !== '';
  return desc;
}

/**
 * Detect a custom combobox: a control that looks like a dropdown but is not a
 * <select>. Ashby, Workday and the newer Greenhouse boards all use these.
 */
function isCombobox(el) {
  const role = el.getAttribute('role');
  if (role === 'combobox') return true;
  if (el.getAttribute('aria-haspopup') === 'listbox') return true;
  if (el.tagName === 'INPUT' && el.getAttribute('aria-autocomplete')) return true;
  return false;
}

/**
 * Scan a document (or a subtree) and return descriptors for everything fillable.
 * @param {Document|Element} root
 */
export function scan(root = document) {
  uidCounter = 0;
  const controls = deepQueryAll(root, (el) => {
    const tag = el.tagName;
    if (isIgnored(el)) return false;
    if (tag === 'INPUT') return !SKIP_TYPES.has((el.type || 'text').toLowerCase());
    if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable && el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }).filter(isVisible);

  const descriptors = [];
  const radioGroups = new Map();

  // --- split date inputs, grouped before anything else claims them ---------
  const dateGroups = new Map();
  const consumed = new Set();
  for (const el of controls) {
    const part = datePartKind(el);
    if (!part) continue;
    const wrapper = dateWrapperOf(el);
    if (!wrapper) continue;
    if (!dateGroups.has(wrapper)) dateGroups.set(wrapper, {});
    dateGroups.get(wrapper)[part] = el;
    consumed.add(el);
  }
  for (const [wrapper, parts] of dateGroups) {
    const anchor = parts.month || parts.year || parts.day;
    if (!anchor || Object.keys(parts).length < 2) {
      // A lone part is not a date group; let the normal path handle it.
      for (const el of Object.values(parts)) consumed.delete(el);
      continue;
    }
    const wrapperLabel = textOf(wrapper.querySelector('label, [data-automation-id*="ormLabel" i], legend'));
    descriptors.push(makeDescriptor({
      el: anchor,
      kind: 'date-group',
      parts,
      label: wrapperLabel || labelFor(anchor),
      attrs: wrapper.getAttribute('data-automation-id') || attrHaystack(anchor),
      required: Object.values(parts).some((p) => p.required)
    }));
  }

  for (const el of controls) {
    if (consumed.has(el)) continue;
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();

    if (tag === 'INPUT' && type === 'radio') {
      const name = el.getAttribute('name') || `anon-${el.closest('fieldset') ? 'fs' : 'x'}`;
      if (!radioGroups.has(name)) radioGroups.set(name, []);
      radioGroups.get(name).push(el);
      continue;
    }

    if (tag === 'SELECT') {
      descriptors.push(makeDescriptor({
        el, kind: 'select',
        options: optionsOfSelect(el),
        required: el.required || el.getAttribute('aria-required') === 'true'
      }));
      continue;
    }

    if (tag === 'TEXTAREA') {
      descriptors.push(makeDescriptor({
        el, kind: 'textarea',
        required: el.required || el.getAttribute('aria-required') === 'true'
      }));
      continue;
    }

    if (el.isContentEditable) {
      descriptors.push(makeDescriptor({ el, kind: 'contenteditable' }));
      continue;
    }

    if (type === 'checkbox') {
      descriptors.push(makeDescriptor({
        el, kind: 'checkbox',
        required: el.required
      }));
      continue;
    }

    if (type === 'file') {
      descriptors.push(makeDescriptor({
        el, kind: 'file',
        accept: el.getAttribute('accept') || '',
        required: el.required
      }));
      continue;
    }

    descriptors.push(makeDescriptor({
      el,
      kind: isCombobox(el) ? 'combobox' : 'text',
      inputType: type || 'text',
      required: el.required || el.getAttribute('aria-required') === 'true'
    }));
  }

  for (const [name, els] of radioGroups) {
    if (!els.length) continue;
    descriptors.push(makeDescriptor({
      el: els[0],
      kind: 'radio-group',
      groupName: name,
      options: optionsOfGroup(els),
      label: groupLabel(els),
      attrs: name,
      required: els.some((e) => e.required)
    }));
  }

  // Non-<select> comboboxes rendered as divs (Workday, some Ashby widgets).
  const widgetBoxes = deepQueryAll(root, (el) => (
    el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && isCombobox(el)
  )).filter(isVisible);

  for (const el of widgetBoxes) {
    if (descriptors.some((d) => d.el === el || el.contains(d.el))) continue;
    descriptors.push(makeDescriptor({ el, kind: 'combobox' }));
  }

  return descriptors;
}

/**
 * Heuristic: does this page look like a job application rather than a login?
 *
 * @param {Array} descriptors
 * @param {Document} doc
 * @param {{packMatched?: boolean}} [opts] whether a site-specific pack claimed
 *        this page by DOM fingerprint, which is much stronger evidence than any
 *        of the guesses below
 */
export function looksLikeApplication(descriptors, doc = document, opts = {}) {
  // A job application never asks for a password. Workday's apply flow opens on
  // an account-creation step that is otherwise indistinguishable from a form -
  // same wizard chrome, same progress bar, "step 1 of 6" - and filling it would
  // mean typing the user's details into a credential screen. This outranks
  // everything below, including a pack match.
  if (doc.querySelector && doc.querySelector('input[type="password"]')) return false;

  // A pack recognised the page, so stop guessing. iCIMS opens its application
  // with a two-field step - email plus a consent box - which the field-count
  // heuristic below would dismiss even though it is the first page of the
  // application proper.
  if (opts.packMatched && descriptors.length >= 1) return true;

  if (descriptors.length < 3) return false;
  const hasFile = descriptors.some((d) => d.kind === 'file');
  const hasEmail = descriptors.some((d) => /mail/i.test(d.normAttrs) || /mail/i.test(d.normLabel));
  const sample = normalizeText(
    `${doc.title || ''} ${(doc.body && doc.body.innerText) || ''}`.slice(0, 4000)
  );
  const applyWords = /(apply|application|applicant|resume|cv|cover letter|candidate|job|position|vacancy|submit your)/i
    .test(sample);
  const authOnly = AUTH_HINT.test(sample) && descriptors.length < 6;
  return !authOnly && (hasFile || (hasEmail && applyWords) || (applyWords && descriptors.length >= 6));
}

/** Locate the submit control so the tracker can notice a real submission. */
export function findSubmit(selectors, root = document) {
  for (const sel of selectors) {
    const el = deepQueryAll(root, (n) => {
      try {
        return n.matches(sel);
      } catch {
        return false;
      }
    })[0];
    if (el && isVisible(el)) return el;
  }
  return null;
}
