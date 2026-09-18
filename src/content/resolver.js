/**
 * The resolver cascade: DOM descriptor -> canonical field id -> value.
 *
 * Four stages, highest confidence first:
 *   1. pack selector        (site-specific, 1.00)
 *   2. autocomplete token   (browser standard, 0.90)
 *   3. attribute pattern    (taxonomy regex on name/id/data-*, 0.70-0.80)
 *   4. label pattern        (taxonomy regex on visible text, 0.75)
 * ...then, for whatever is still unmapped:
 *   5. question memory      (fuzzy recall of what the user answered before)
 *
 * Stages 2-4 are what make GENERIC MODE work on a site with no pack at all.
 *
 * Assignment is a greedy bipartite match rather than first-wins, so a form with
 * both "Name" and "First name" does not let the weaker candidate claim the
 * stronger field.
 */

import { FIELDS, FIELD_BY_ID, SENSITIVE_IDS } from '../core/taxonomy.js';
import { OUTCOME } from '../core/messages.js';
import { deepQueryAll } from './detector.js';
import { normalizeText, looksYes } from '../core/util.js';

const SCORE = {
  pack: 1.0,
  autocomplete: 0.9,
  attrAnchored: 0.82,
  label: 0.75,
  attrLoose: 0.68
};

/** A regex source that starts with ^ and ends with $ is an exact-name match. */
function isAnchored(re) {
  const s = re.source;
  return s.startsWith('^') && s.endsWith('$');
}

function disqualified(def, haystacks) {
  if (!def.not) return false;
  return def.not.some((re) => haystacks.some((h) => h && re.test(h)));
}

/**
 * Score one descriptor against one taxonomy field.
 * @returns {{score: number, source: string}|null}
 */
function scorePair(desc, def) {
  const label = desc.label || '';
  const attrs = desc.attrs || '';
  const normLabel = desc.normLabel || '';

  if (disqualified(def, [label, attrs, normLabel])) return null;

  if (def.ac && desc.autocomplete && def.ac.includes(desc.autocomplete)) {
    return { score: SCORE.autocomplete, source: 'autocomplete' };
  }

  if (def.attr) {
    for (const re of def.attr) {
      if (re.test(attrs)) {
        return { score: isAnchored(re) ? SCORE.attrAnchored : SCORE.attrLoose, source: 'attr' };
      }
    }
  }

  if (def.text) {
    for (const re of def.text) {
      if (re.test(label) || re.test(normLabel)) {
        return { score: SCORE.label, source: 'label' };
      }
    }
  }

  return null;
}

/** Type compatibility - stops a file input claiming "first name". */
function typeCompatible(desc, def) {
  if (desc.kind === 'date-group') return def.type === 'date' || def.type === 'month';
  if (def.type === 'file') return desc.kind === 'file';
  if (desc.kind === 'file') return def.type === 'file';
  if (def.type === 'longtext') return desc.kind === 'textarea' || desc.kind === 'contenteditable' || desc.kind === 'text';
  if (def.type === 'bool') return ['checkbox', 'radio-group', 'select', 'combobox'].includes(desc.kind);
  if (def.type === 'enum') return ['select', 'radio-group', 'combobox', 'text'].includes(desc.kind);
  return desc.kind !== 'checkbox';
}

/**
 * Stage 1 - apply a pack's explicit selectors.
 * @returns {Map<string, {fieldId: string, options: object|null}>} keyed by descriptor key
 */
function applyPack(descriptors, rules, root) {
  const out = new Map();
  if (!rules.length) return out;

  const byEl = new Map(descriptors.map((d) => [d.el, d]));

  for (const rule of rules) {
    for (const sel of rule.selectors) {
      const matches = deepQueryAll(root, (n) => {
        try {
          return n.matches(sel);
        } catch {
          return false;
        }
      });
      let claimed = false;
      for (const el of matches) {
        const desc = byEl.get(el) || descriptors.find((d) => d.el === el || d.el.contains(el) || el.contains(d.el));
        if (!desc || out.has(desc.key)) continue;
        out.set(desc.key, { fieldId: rule.id, options: rule.options });
        claimed = true;
        break;
      }
      if (claimed) break;
    }
  }
  return out;
}

/**
 * Build the fill plan.
 *
 * @param {Array} descriptors
 * @param {object} ctx
 * @param {Array} ctx.packRules
 * @param {Document|Element} ctx.root
 * @param {Record<string,string>} ctx.values      canonical id -> value
 * @param {Array} ctx.memory                      question-memory entries
 * @param {object} ctx.settings
 * @returns {Array} plan entries
 */
export function buildPlan(descriptors, ctx) {
  const { packRules = [], root = document, values = {}, memory = [], settings = {} } = ctx;
  const packHits = applyPack(descriptors, packRules, root);

  // --- greedy bipartite assignment over stages 2-4 --------------------------
  const candidates = [];
  for (const desc of descriptors) {
    if (packHits.has(desc.key)) continue;
    for (const def of FIELDS) {
      if (!typeCompatible(desc, def)) continue;
      const hit = scorePair(desc, def);
      if (hit) candidates.push({ descKey: desc.key, fieldId: def.id, ...hit });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const descTaken = new Set(packHits.keys());
  const fieldTaken = new Set([...packHits.values()].map((v) => v.fieldId));
  /** @type {Map<string, {fieldId: string, source: string, score: number}>} */
  const assigned = new Map();

  for (const c of candidates) {
    if (descTaken.has(c.descKey)) continue;
    // File fields and consent checkboxes legitimately repeat on one form.
    const def = FIELD_BY_ID.get(c.fieldId);
    const repeatable = def && (def.type === 'file' || def.group === 'consent');
    if (fieldTaken.has(c.fieldId) && !repeatable) continue;
    assigned.set(c.descKey, { fieldId: c.fieldId, source: c.source, score: c.score });
    descTaken.add(c.descKey);
    fieldTaken.add(c.fieldId);
  }

  // --- assemble -------------------------------------------------------------
  const plan = [];
  for (const desc of descriptors) {
    const pack = packHits.get(desc.key);
    const auto = assigned.get(desc.key);
    const fieldId = pack ? pack.fieldId : auto ? auto.fieldId : null;
    const source = pack ? 'pack' : auto ? auto.source : null;
    const score = pack ? SCORE.pack : auto ? auto.score : 0;

    const entry = {
      key: desc.key,
      desc,
      fieldId,
      source,
      confidence: score,
      value: null,
      memoryId: null,
      outcome: null,
      reason: ''
    };

    if (fieldId) {
      const def = FIELD_BY_ID.get(fieldId);
      if (SENSITIVE_IDS.has(fieldId) && !settings.fillSensitive) {
        entry.outcome = OUTCOME.SENSITIVE;
        entry.reason = 'Demographic field - turn on in Settings to fill';
        plan.push(entry);
        continue;
      }
      if (def && def.type === 'file') {
        // Documents live in the vault, not in the profile's values map, so there
        // is nothing to look up here - the file adapter fetches the bytes
        // lazily. Gating this on `values` silently skipped every resume upload.
        entry.value = null;
        if (desc.hasValue && !settings.overwriteExisting) {
          entry.outcome = OUTCOME.SKIPPED;
          entry.reason = 'A file is already attached';
        }
        plan.push(entry);
        continue;
      }

      let raw = values[fieldId];
      if (raw === undefined || raw === null || raw === '') {
        // No stored value for a recognised field - memory may still know it.
        const recalled = recallFor(desc, memory);
        if (recalled) {
          entry.value = recalled.answer;
          entry.memoryId = recalled.id;
          entry.source = 'memory';
        } else {
          entry.outcome = OUTCOME.SKIPPED;
          entry.reason = `No value saved for "${def ? def.label : fieldId}"`;
          plan.push(entry);
          continue;
        }
      } else {
        entry.value = mapValue(raw, def, desc, pack && pack.options);
      }
    } else {
      const recalled = recallFor(desc, memory);
      if (recalled) {
        entry.value = recalled.answer;
        entry.memoryId = recalled.id;
        entry.source = 'memory';
      } else {
        entry.outcome = OUTCOME.UNRESOLVED;
        entry.reason = 'No match in the taxonomy or your saved answers';
        plan.push(entry);
        continue;
      }
    }

    if (desc.hasValue && !settings.overwriteExisting) {
      entry.outcome = OUTCOME.SKIPPED;
      entry.reason = 'Already filled';
    }

    plan.push(entry);
  }

  return plan;
}

/**
 * Translate a stored profile value into something this particular control can
 * accept. Enum/bool mapping against the live option list happens here so the
 * adapters stay dumb.
 */
function mapValue(raw, def, desc, packOptions) {
  let value = String(raw);

  if (packOptions && packOptions[value]) value = packOptions[value];

  if (!def) return value;

  if (def.type === 'bool') {
    const yes = looksYes(value);
    if (desc.kind === 'checkbox') return yes ? 'true' : 'false';
    const opts = desc.options || [];
    if (opts.length) {
      const want = yes ? /^(yes|y|true|i am|i do)\b/i : /^(no|n|false|i am not|i do not)\b/i;
      const hit = opts.find((o) => want.test(String(o.label).trim()));
      if (hit) return hit.label;
    }
    return yes ? 'Yes' : 'No';
  }

  if (def.type === 'enum' && desc.options && desc.options.length) {
    const target = normalizeText(value);
    const exact = desc.options.find((o) => normalizeText(o.label) === target);
    if (exact) return exact.label;
    const partial = desc.options.find((o) => normalizeText(o.label).includes(target) || target.includes(normalizeText(o.label)));
    if (partial) return partial.label;
  }

  return value;
}

/** Fuzzy-recall a previously given answer for this control's question. */
function recallFor(desc, memory) {
  if (!memory || !memory.length) return null;
  const question = desc.label;
  if (!question || question.length < 4) return null;

  // The heavy lifting lives in core/util so the background can reuse it, but the
  // content script gets a local copy of the comparison to avoid a round trip.
  const key = memoryKey(question);
  if (!key) return null;

  let best = null;
  let bestScore = 0;
  for (const e of memory) {
    const score = e.key === key ? 1 : dice(key, e.key);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return bestScore >= 0.72 ? best : null;
}

// Local, dependency-free copies so the hot path does not message the worker.
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'you', 'your', 'yours', 'we', 'our', 'us', 'this', 'that', 'these', 'those', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'and', 'or', 'if', 'it', 'its', 'please', 'kindly', 'would', 'will', 'can', 'could', 'may', 'have', 'has', 'had', 'any', 'all', 'about']);

function memoryKey(s) {
  return normalizeText(s)
    .replace(/\b\d{4}\b/g, '')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .join(' ')
    .trim();
}

function dice(a, b) {
  if (!a || !b) return 0;
  const tri = (s) => {
    const p = `  ${s} `;
    const out = new Set();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = tri(a);
  const B = tri(b);
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return (2 * hits) / (A.size + B.size);
}
