/**
 * Remote selector packs.
 *
 * ATSs redesign without warning - Greenhouse changed a whole generation of its
 * board between one check and the next - and a broken selector shipped in the
 * store takes days to fix. Packs are data, so they can be refreshed from a
 * static JSON file instead, turning that into a one-hour fix.
 *
 * Three things make this safe rather than a back door:
 *
 * 1. It is DATA, never code. The fetched file is parsed as JSON and every value
 *    is treated as a CSS selector string. Nothing is evaluated, imported, or
 *    inserted into the page. That is also what keeps it legal under MV3's ban on
 *    remotely-hosted code.
 * 2. It is OFF by default and needs its own host permission, which is requested
 *    only when the user turns it on. With it off, the extension makes no network
 *    requests at all.
 * 3. Everything fetched is validated before it is stored, by the rules below.
 *    A pack that fails any of them is discarded whole and the bundled copy keeps
 *    working. A remote file cannot introduce a field the taxonomy does not know,
 *    cannot point at a password input, and cannot claim a host another pack owns.
 *
 * The request carries no identifier, no profile data and no cookies - it is a
 * plain GET for a static file.
 */

import { FIELD_BY_ID } from './taxonomy.js';

export const DEFAULT_PACK_URL =
  'https://raw.githubusercontent.com/harsha-codetech/applyr/main/packs.json';

/** How often an enabled install re-checks, at most. */
export const MIN_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const LIMITS = {
  packs: 100,
  fieldsPerPack: 200,
  selectorLength: 300,
  selectorsPerField: 12,
  bytes: 1_000_000
};

/** Anything that could steer a fill at a credential input is refused outright. */
const FORBIDDEN_SELECTOR = /password|\[type\s*=\s*['"]?password/i;

/** A plausible hostname, not a wildcard or a bare TLD. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function selectorsOf(field) {
  return Array.isArray(field.selector) ? field.selector : [field.selector];
}

function checkSelector(sel, where, errors) {
  if (typeof sel !== 'string' || !sel.trim()) {
    errors.push(`${where}: empty selector`);
    return;
  }
  if (sel.length > LIMITS.selectorLength) {
    errors.push(`${where}: selector longer than ${LIMITS.selectorLength} characters`);
  }
  if (FORBIDDEN_SELECTOR.test(sel)) {
    errors.push(`${where}: selector targets a password field`);
  }
  if ((sel.match(/\[/g) || []).length !== (sel.match(/\]/g) || []).length) {
    errors.push(`${where}: unbalanced brackets in "${sel}"`);
  }
  if ((sel.match(/'/g) || []).length % 2 !== 0) {
    errors.push(`${where}: unbalanced quotes in "${sel}"`);
  }
}

function validatePack(pack, seenHosts, errors) {
  const id = typeof pack.id === 'string' ? pack.id : '(no id)';
  if (!pack.id || typeof pack.id !== 'string') errors.push(`${id}: missing id`);
  if (!pack.name || typeof pack.name !== 'string') errors.push(`${id}: missing name`);

  if (!Array.isArray(pack.match) || !pack.match.length) {
    errors.push(`${id}: missing match hosts`);
  } else {
    for (const host of pack.match) {
      if (typeof host !== 'string' || !HOSTNAME.test(host)) {
        errors.push(`${id}: implausible host "${host}"`);
        continue;
      }
      if (seenHosts.has(host)) {
        errors.push(`${id}: host ${host} already claimed by ${seenHosts.get(host)}`);
      } else {
        seenHosts.set(host, id);
      }
    }
  }

  if (!pack.detect || !Array.isArray(pack.detect.any)) {
    errors.push(`${id}: missing detect.any`);
  } else {
    pack.detect.any.forEach((s, i) => checkSelector(s, `${id}.detect[${i}]`, errors));
  }

  if (!Array.isArray(pack.fields) || !pack.fields.length) {
    errors.push(`${id}: no fields`);
    return;
  }
  if (pack.fields.length > LIMITS.fieldsPerPack) {
    errors.push(`${id}: more than ${LIMITS.fieldsPerPack} fields`);
    return;
  }

  for (const field of pack.fields) {
    const def = FIELD_BY_ID.get(field.id);
    if (!def) {
      errors.push(`${id}: unknown canonical field "${field.id}"`);
      continue;
    }
    const sels = selectorsOf(field);
    if (sels.length > LIMITS.selectorsPerField) {
      errors.push(`${id}.${field.id}: too many selectors`);
    }
    sels.forEach((s) => checkSelector(s, `${id}.${field.id}`, errors));

    // A document slot must point at an upload, or a remote file could route the
    // resume into an arbitrary control.
    if (def.type === 'file' && !sels.some((s) => typeof s === 'string' && /file|resume|cv|upload|attach/i.test(s))) {
      errors.push(`${id}.${field.id}: file field does not target an upload`);
    }
  }

  for (const key of ['submit', 'confirm']) {
    if (pack[key] === undefined) continue;
    if (!Array.isArray(pack[key])) {
      errors.push(`${id}: ${key} must be an array`);
      continue;
    }
    pack[key].forEach((s, i) => checkSelector(s, `${id}.${key}[${i}]`, errors));
  }
}

/**
 * @param {unknown} bundle parsed JSON from the pack URL
 * @returns {{ok: boolean, packs: Array, errors: string[]}}
 */
export function validatePackBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, packs: [], errors: ['not an object'] };
  }
  if (bundle.format !== 'applyr-packs') {
    return { ok: false, packs: [], errors: [`unexpected format: ${bundle.format}`] };
  }
  if (!Array.isArray(bundle.packs) || !bundle.packs.length) {
    return { ok: false, packs: [], errors: ['no packs in bundle'] };
  }
  if (bundle.packs.length > LIMITS.packs) {
    return { ok: false, packs: [], errors: [`more than ${LIMITS.packs} packs`] };
  }

  const seenHosts = new Map();
  const seenIds = new Set();
  for (const pack of bundle.packs) {
    if (seenIds.has(pack && pack.id)) errors.push(`duplicate pack id: ${pack.id}`);
    else if (pack && pack.id) seenIds.add(pack.id);
    validatePack(pack || {}, seenHosts, errors);
  }

  return { ok: errors.length === 0, packs: errors.length ? [] : bundle.packs, errors };
}

/**
 * Fetch and validate. Throws on anything that is not a usable bundle, so the
 * caller can keep whatever it already had.
 *
 * @param {string} url
 * @returns {Promise<{packs: Array, updated: string|null, count: number}>}
 */
export async function fetchPackBundle(url) {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new Error(`pack source returned ${res.status}`);

  const text = await res.text();
  if (text.length > LIMITS.bytes) throw new Error('pack file is implausibly large');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('pack source is not valid JSON');
  }

  const { ok, packs, errors } = validatePackBundle(parsed);
  if (!ok) throw new Error(`rejected: ${errors.slice(0, 3).join('; ')}`);

  return { packs, updated: typeof parsed.updated === 'string' ? parsed.updated : null, count: packs.length };
}

/**
 * Bundled packs, with validated remote ones layered on top by id. A remote pack
 * may replace a bundled one or add a new one; it can never remove one, so a
 * source that goes away or goes wrong degrades to what shipped in the store.
 */
export function mergePacks(bundled, remote) {
  if (!Array.isArray(remote) || !remote.length) return bundled;
  const byId = new Map(bundled.map((p) => [p.id, p]));
  for (const pack of remote) byId.set(pack.id, { ...pack, source: 'remote' });
  return [...byId.values()];
}
