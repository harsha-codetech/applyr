/**
 * Profile schema.
 *
 * The profile is deliberately flat: `values` is keyed by canonical field id from
 * taxonomy.js, so the editor can render itself by iterating the taxonomy and the
 * fill engine can look a value up in O(1) without any per-site knowledge.
 *
 * `experience` and `education` are the two genuinely repeating structures. The
 * most recent entry of each is projected back into `values` by profileToValues()
 * so that single-slot forms ("current company", "school") fill without the user
 * duplicating data.
 */

import { FIELDS, FIELD_BY_ID, SENSITIVE_IDS } from './taxonomy.js';
import { uid } from './util.js';

export const SCHEMA_VERSION = 1;

export function emptyExperience() {
  return {
    id: uid(), company: '', title: '', location: '',
    start: '', end: '', current: false, description: ''
  };
}

export function emptyEducation() {
  return {
    id: uid(), school: '', degree: '', field: '',
    start: '', end: '', gpa: ''
  };
}

export function defaultProfile() {
  return {
    version: SCHEMA_VERSION,
    values: {},
    experience: [],
    education: [],
    settings: {
      /** Demographic / EEO fields are never filled unless this is explicitly turned on. */
      fillSensitive: false,
      /** Which resume to attach when a form asks for one. */
      defaultResumeId: null,
      /** Scan and fill as soon as a known application page loads. */
      autoFillOnLoad: false,
      /** Replace values the user (or the site) already put in a field. */
      overwriteExisting: false,
      /** Draw a coloured ring around every field applyr touched. */
      highlightFilled: true,
      /** Offer to remember answers to questions applyr could not resolve. */
      learnUnknownFields: true
    },
    updatedAt: null
  };
}

/** Fields we consider the bare minimum for the extension to be useful. */
export const CORE_FIELDS = [
  'first_name', 'last_name', 'email', 'phone',
  'city', 'country', 'linkedin_url'
];

/**
 * Structural validation. Returns a list of human-readable problems; an empty
 * list means the profile is safe to persist.
 */
export function validateProfile(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['Profile is not an object'];
  if (typeof p.values !== 'object' || p.values === null) errors.push('values must be an object');
  if (!Array.isArray(p.experience)) errors.push('experience must be an array');
  if (!Array.isArray(p.education)) errors.push('education must be an array');

  for (const key of Object.keys(p.values || {})) {
    if (!FIELD_BY_ID.has(key)) errors.push(`unknown field id: ${key}`);
  }

  const email = (p.values || {}).email;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email looks malformed');

  return errors;
}

/** Migrate an older stored profile forward. */
export function migrateProfile(p) {
  if (!p) return defaultProfile();
  const base = defaultProfile();
  const out = {
    ...base,
    ...p,
    values: { ...base.values, ...(p.values || {}) },
    settings: { ...base.settings, ...(p.settings || {}) },
    experience: Array.isArray(p.experience) ? p.experience : [],
    education: Array.isArray(p.education) ? p.education : [],
    version: SCHEMA_VERSION
  };
  // Drop values whose field id no longer exists in the taxonomy.
  for (const key of Object.keys(out.values)) {
    if (!FIELD_BY_ID.has(key)) delete out.values[key];
  }
  return out;
}

function firstNonEmpty(...xs) {
  for (const x of xs) if (x !== undefined && x !== null && String(x).trim() !== '') return x;
  return '';
}

/**
 * Project the stored profile into the flat canonical map the fill engine reads.
 *
 * @param {object} profile
 * @param {{includeSensitive?: boolean}} [opts]
 * @returns {Map<string, string>}
 */
export function profileToValues(profile, opts = {}) {
  const p = migrateProfile(profile);
  const v = { ...p.values };

  const latestJob = p.experience.find((e) => e.current) || p.experience[0];
  const latestEdu = p.education[0];

  // -- derived: name --------------------------------------------------------
  v.full_name = firstNonEmpty(
    v.full_name,
    [v.first_name, v.last_name].filter(Boolean).join(' ')
  );
  if (!v.first_name && v.full_name) v.first_name = String(v.full_name).split(/\s+/)[0];
  if (!v.last_name && v.full_name) {
    const parts = String(v.full_name).trim().split(/\s+/);
    if (parts.length > 1) v.last_name = parts.slice(1).join(' ');
  }

  // -- derived: address -----------------------------------------------------
  v.full_address = firstNonEmpty(
    v.full_address,
    [v.address_line1, v.city, v.state, v.postal_code, v.country].filter(Boolean).join(', ')
  );

  // -- derived: current job -------------------------------------------------
  if (latestJob) {
    v.current_company = firstNonEmpty(v.current_company, latestJob.company);
    v.current_title = firstNonEmpty(v.current_title, latestJob.title);
  }

  // -- derived: education ---------------------------------------------------
  if (latestEdu) {
    v.school = firstNonEmpty(v.school, latestEdu.school);
    v.degree = firstNonEmpty(v.degree, latestEdu.degree);
    v.field_of_study = firstNonEmpty(v.field_of_study, latestEdu.field);
    v.graduation_date = firstNonEmpty(v.graduation_date, latestEdu.end);
    v.gpa = firstNonEmpty(v.gpa, latestEdu.gpa);
  }

  const includeSensitive = opts.includeSensitive === true;
  const map = new Map();
  for (const [k, raw] of Object.entries(v)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (SENSITIVE_IDS.has(k) && !includeSensitive) continue;
    map.set(k, raw);
  }
  return map;
}

/** 0..1 - how much of the profile is filled in, weighted toward the core fields. */
export function completeness(profile) {
  const p = migrateProfile(profile);
  const filled = (id) => {
    const x = p.values[id];
    return x !== undefined && x !== null && String(x).trim() !== '';
  };
  const coreDone = CORE_FIELDS.filter(filled).length / CORE_FIELDS.length;
  const optional = FIELDS.filter((f) => !CORE_FIELDS.includes(f.id) && !f.sensitive && f.type !== 'file');
  const optDone = optional.filter((f) => filled(f.id)).length / Math.max(1, optional.length);
  const hasHistory = (p.experience.length ? 1 : 0) * 0.5 + (p.education.length ? 1 : 0) * 0.5;
  return Math.min(1, coreDone * 0.6 + optDone * 0.25 + hasHistory * 0.15);
}

/** Which core fields are still missing - drives the "finish your profile" nudge. */
export function missingCoreFields(profile) {
  const p = migrateProfile(profile);
  return CORE_FIELDS.filter((id) => {
    const x = p.values[id];
    return x === undefined || x === null || String(x).trim() === '';
  });
}
