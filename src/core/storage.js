/**
 * Persistence layer. Everything lives on this device:
 *   - chrome.storage.local  -> profile, question memory, application log
 *   - IndexedDB             -> resume / cover-letter file bytes
 *
 * There is no network code in this file, and no other module in the extension
 * performs a fetch to a third party. That is the product's privacy claim, and it
 * is enforced by keeping all writes funnelled through here.
 */

import { defaultProfile, migrateProfile, validateProfile } from './schema.js';
import { uid, questionKey, bestMatch, bufToBase64, base64ToBytes } from './util.js';

const K_PROFILE = 'profile';
const K_MEMORY = 'memory';
const K_APPS = 'applications';
const K_SITES = 'siteStats';

const DB_NAME = 'applyr';
const DB_VERSION = 1;
const STORE_FILES = 'files';

// ---------------------------------------------------------------------------
// chrome.storage helpers
// ---------------------------------------------------------------------------

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] === undefined ? fallback : out[key];
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

/**
 * Read-modify-write serialization.
 *
 * Most writes here read a list, mutate it and write it back. Because content
 * scripts run in every frame, two frames of the same page report their results
 * milliseconds apart - and both would read the list before either wrote,
 * producing duplicate tracker entries. Chaining every mutating call through one
 * promise removes the interleaving.
 */
let writeChain = Promise.resolve();
function serialize(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

const cleanUrl = (u) => String(u || '').split('#')[0];

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile() {
  return migrateProfile(await get(K_PROFILE, defaultProfile()));
}

export async function saveProfile(profile) {
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(`Invalid profile: ${errors.join('; ')}`);
  const next = migrateProfile(profile);
  next.updatedAt = new Date().toISOString();
  await set(K_PROFILE, next);
  return next;
}

export function patchProfileValues(patch) {
  return serialize(async () => {
    const p = await getProfile();
    p.values = { ...p.values, ...patch };
    return saveProfile(p);
  });
}

export function patchSettings(patch) {
  return serialize(async () => {
    const p = await getProfile();
    p.settings = { ...p.settings, ...patch };
    return saveProfile(p);
  });
}

// ---------------------------------------------------------------------------
// Question memory
//
// The whole intelligence of the product with no model behind it: remember what
// the user answered, recall it the next time a form asks the same thing in
// different words.
// ---------------------------------------------------------------------------

/** @returns {Promise<Array>} */
export async function allMemory() {
  return get(K_MEMORY, []);
}

/**
 * @param {{question: string, answer: string, fieldId?: string|null, type?: string}} entry
 */
export function rememberAnswer(entry) {
  return serialize(async () => {
    const list = await allMemory();
    const key = questionKey(entry.question);
    if (!key) return list;

    const existing = list.find((e) => e.key === key);
    if (existing) {
      existing.answer = entry.answer;
      existing.fieldId = entry.fieldId ?? existing.fieldId ?? null;
      existing.type = entry.type || existing.type || 'text';
      existing.updatedAt = new Date().toISOString();
    } else {
      list.push({
        id: uid(),
        key,
        question: entry.question,
        answer: entry.answer,
        fieldId: entry.fieldId ?? null,
        type: entry.type || 'text',
        uses: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await set(K_MEMORY, list);
    return list;
  });
}

export function updateMemory(id, patch) {
  return serialize(async () => {
    const list = await allMemory();
    const e = list.find((x) => x.id === id);
    if (!e) return list;
    Object.assign(e, patch, { updatedAt: new Date().toISOString() });
    await set(K_MEMORY, list);
    return list;
  });
}

export function deleteMemory(id) {
  return serialize(async () => {
    const list = (await allMemory()).filter((x) => x.id !== id);
    await set(K_MEMORY, list);
    return list;
  });
}

/** Record that a remembered answer was actually used, for the "most reused" view. */
export function bumpMemoryUses(ids) {
  if (!ids || !ids.length) return Promise.resolve();
  return serialize(async () => {
    const list = await allMemory();
    let touched = false;
    for (const e of list) {
      if (ids.includes(e.id)) {
        e.uses = (e.uses || 0) + 1;
        touched = true;
      }
    }
    if (touched) await set(K_MEMORY, list);
  });
}

/**
 * Fuzzy recall. Exact key first, then trigram similarity above the threshold.
 * @param {string} question
 */
export async function recallAnswer(question, threshold = 0.72) {
  const key = questionKey(question);
  if (!key) return null;
  const list = await allMemory();
  const exact = list.find((e) => e.key === key);
  if (exact) return { entry: exact, score: 1 };
  const m = bestMatch(key, list, threshold);
  return m ? { entry: m.match, score: m.score } : null;
}

// ---------------------------------------------------------------------------
// Application tracker
// ---------------------------------------------------------------------------

export const APP_STATUS = ['filled', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn'];

export async function listApplications() {
  return get(K_APPS, []);
}

function newApplication(app) {
  return {
    id: uid(),
    company: '',
    role: '',
    url: '',
    ats: '',
    status: 'filled',
    resumeId: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...app
  };
}

/** Edit an existing entry by id, or add a new one. Used by the panel. */
export function upsertApplication(app) {
  return serialize(async () => {
    const list = await listApplications();
    const idx = app.id ? list.findIndex((a) => a.id === app.id) : -1;
    if (idx >= 0) list[idx] = { ...list[idx], ...app, updatedAt: new Date().toISOString() };
    else list.unshift(newApplication(app));
    await set(K_APPS, list);
    return list;
  });
}

/**
 * Log a fill or a submission against a page URL, atomically.
 *
 * The find-then-write must happen inside one critical section: doing it as two
 * awaits let two frames of the same page each create their own entry.
 */
export function upsertApplicationByUrl(app) {
  return serialize(async () => {
    const list = await listApplications();
    const target = cleanUrl(app.url);
    const existing = list.find((a) => cleanUrl(a.url) === target);
    if (existing) {
      const status = existing.status === 'submitted' && app.status === 'filled'
        ? 'submitted' // never walk a submitted application back to "filled"
        : app.status || existing.status;
      Object.assign(existing, app, { id: existing.id, status, updatedAt: new Date().toISOString() });
    } else {
      list.unshift(newApplication(app));
    }
    await set(K_APPS, list);
    return list;
  });
}

/** Find an existing entry for this page so one application does not log twice. */
export async function findApplicationByUrl(url) {
  const list = await listApplications();
  return list.find((a) => cleanUrl(a.url) === cleanUrl(url)) || null;
}

export function deleteApplication(id) {
  return serialize(async () => {
    const list = (await listApplications()).filter((a) => a.id !== id);
    await set(K_APPS, list);
    return list;
  });
}

// ---------------------------------------------------------------------------
// Per-site fill statistics - drives "this site needs a pack" reporting
// ---------------------------------------------------------------------------

export function recordSiteRun(host, { filled, skipped, failed, unresolved }) {
  return serialize(async () => {
    const stats = await get(K_SITES, {});
    const s = stats[host] || { runs: 0, filled: 0, skipped: 0, failed: 0, unresolved: 0 };
    s.runs += 1;
    s.filled += filled;
    s.skipped += skipped;
    s.failed += failed;
    s.unresolved += unresolved;
    s.lastRun = new Date().toISOString();
    stats[host] = s;
    await set(K_SITES, stats);
    return s;
  });
}

export async function siteStats() {
  return get(K_SITES, {});
}

// ---------------------------------------------------------------------------
// File vault (IndexedDB)
// ---------------------------------------------------------------------------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE_FILES, mode).objectStore(STORE_FILES);
}

/**
 * @param {{name: string, type: string, bytes: ArrayBuffer, kind?: 'resume'|'cover'|'other', label?: string}} file
 */
export async function addFile(file) {
  const db = await openDB();
  const record = {
    id: uid(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.bytes.byteLength,
    kind: file.kind || 'resume',
    label: file.label || file.name.replace(/\.[^.]+$/, ''),
    bytes: file.bytes,
    createdAt: new Date().toISOString()
  };
  await new Promise((resolve, reject) => {
    const r = tx(db, 'readwrite').put(record);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  db.close();
  const { bytes, ...meta } = record;
  return meta;
}

/** Metadata only - never pulls the bytes into memory. */
export async function listFiles() {
  const db = await openDB();
  const all = await new Promise((resolve, reject) => {
    const r = tx(db, 'readonly').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return all
    .map(({ bytes, ...meta }) => meta)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getFile(id) {
  const db = await openDB();
  const rec = await new Promise((resolve, reject) => {
    const r = tx(db, 'readonly').get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return rec;
}

export async function deleteFile(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const r = tx(db, 'readwrite').delete(id);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  db.close();
  const p = await getProfile();
  if (p.settings.defaultResumeId === id) {
    await patchSettings({ defaultResumeId: null });
  }
}

// ---------------------------------------------------------------------------
// Export / import - the user's escape hatch, and their only backup
// ---------------------------------------------------------------------------

export async function exportAll({ includeFiles = true } = {}) {
  const [profile, memory, applications, sites] = await Promise.all([
    getProfile(), allMemory(), listApplications(), siteStats()
  ]);
  const bundle = {
    format: 'applyr-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    memory,
    applications,
    sites,
    files: []
  };
  if (includeFiles) {
    const metas = await listFiles();
    for (const m of metas) {
      const rec = await getFile(m.id);
      if (rec) bundle.files.push({ ...m, data: bufToBase64(rec.bytes) });
    }
  }
  return bundle;
}

export async function importAll(bundle, { merge = false } = {}) {
  if (!bundle || bundle.format !== 'applyr-export') {
    throw new Error('Not an applyr export file');
  }
  if (bundle.profile) {
    const incoming = migrateProfile(bundle.profile);
    if (merge) {
      const current = await getProfile();
      incoming.values = { ...current.values, ...incoming.values };
      incoming.experience = [...current.experience, ...incoming.experience];
      incoming.education = [...current.education, ...incoming.education];
    }
    await saveProfile(incoming);
  }

  if (Array.isArray(bundle.memory)) {
    const existing = merge ? await allMemory() : [];
    const byKey = new Map(existing.map((e) => [e.key, e]));
    for (const e of bundle.memory) byKey.set(e.key, e);
    await set(K_MEMORY, [...byKey.values()]);
  }

  if (Array.isArray(bundle.applications)) {
    const existing = merge ? await listApplications() : [];
    const byId = new Map(existing.map((a) => [a.id, a]));
    for (const a of bundle.applications) byId.set(a.id, a);
    await set(K_APPS, [...byId.values()]);
  }

  for (const f of bundle.files || []) {
    if (!f.data) continue;
    await addFile({
      name: f.name,
      type: f.type,
      kind: f.kind,
      label: f.label,
      bytes: base64ToBytes(f.data).buffer
    });
  }
}

export async function wipeAll() {
  await chrome.storage.local.clear();
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const r = tx(db, 'readwrite').clear();
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  db.close();
}
