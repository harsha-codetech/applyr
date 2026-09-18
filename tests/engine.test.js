/**
 * Engine tests - run with `npm test` (no dependencies, node:test only).
 *
 * These cover the parts of the fill engine that are pure: normalisation, the
 * resolver cascade, option matching and read-back verification. Descriptors are
 * fabricated as plain objects, which is exactly what the detector produces, so
 * the resolver is exercised for real without a DOM.
 *
 * DOM-level behaviour (native setters, comboboxes, file uploads) is verified
 * against the pages in fixtures/ - see tests/MANUAL.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeText, questionKey, similarity, looksYes } from '../src/core/util.js';
import { defaultProfile, profileToValues, completeness, missingCoreFields } from '../src/core/schema.js';
import { buildPlan } from '../src/content/resolver.js';
import { isIgnored, looksLikeApplication } from '../src/content/detector.js';
import { parseDateParts } from '../src/content/adapters/date.js';
import { matchOption } from '../src/content/adapters/choice.js';
import { verifyEntry } from '../src/content/verify.js';
import { OUTCOME } from '../src/core/messages.js';
import { FIELDS } from '../src/core/taxonomy.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let n = 0;
function desc(partial = {}) {
  n += 1;
  const d = {
    key: `f${n}`,
    kind: 'text',
    label: '',
    attrs: '',
    autocomplete: '',
    options: [],
    required: false,
    current: '',
    hasValue: false,
    el: { value: '', isConnected: true },
    ...partial
  };
  d.normLabel = normalizeText(d.label);
  d.normAttrs = normalizeText(d.attrs);
  return d;
}

const baseCtx = (over = {}) => ({
  packRules: [],
  root: null,
  values: {},
  memory: [],
  settings: { fillSensitive: false, overwriteExisting: false },
  ...over
});

const byKey = (plan, key) => plan.find((p) => p.key === key);

// ---------------------------------------------------------------------------
// taxonomy sanity
// ---------------------------------------------------------------------------

test('taxonomy has unique ids and a group for every field', () => {
  const ids = FIELDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate field id');
  for (const f of FIELDS) {
    assert.ok(f.label && f.group && f.type, `incomplete field: ${f.id}`);
  }
});

// ---------------------------------------------------------------------------
// text utilities
// ---------------------------------------------------------------------------

test('normalizeText strips decoration and required markers', () => {
  assert.equal(normalizeText('  First Name * (required) '), 'first name');
  assert.equal(normalizeText('E‑mail Address'), 'e mail address');
});

test('questionKey collapses phrasing differences', () => {
  assert.equal(
    questionKey('Are you legally authorized to work in the United States?'),
    questionKey('are you legally authorized to work in the united states')
  );
  assert.ok(!questionKey('the a of').length);
});

test('similarity ranks near-duplicates above unrelated strings', () => {
  const a = questionKey('How did you hear about us?');
  const near = questionKey('How did you hear about us');
  const far = questionKey('What is your expected salary?');
  assert.ok(similarity(a, near) > 0.9);
  assert.ok(similarity(a, far) < 0.4);
});

test('looksYes recognises affirmative phrasings', () => {
  assert.ok(looksYes('Yes'));
  assert.ok(looksYes('I am authorized to work'));
  assert.ok(!looksYes('No'));
});

// ---------------------------------------------------------------------------
// profile projection
// ---------------------------------------------------------------------------

test('profileToValues derives full name and address', () => {
  const p = defaultProfile();
  p.values.first_name = 'Ada';
  p.values.last_name = 'Lovelace';
  p.values.city = 'London';
  p.values.country = 'UK';
  const v = profileToValues(p);
  assert.equal(v.get('full_name'), 'Ada Lovelace');
  assert.equal(v.get('full_address'), 'London, UK');
});

test('profileToValues splits a full name back into parts', () => {
  const p = defaultProfile();
  p.values.full_name = 'Grace Brewster Hopper';
  const v = profileToValues(p);
  assert.equal(v.get('first_name'), 'Grace');
  assert.equal(v.get('last_name'), 'Brewster Hopper');
});

test('profileToValues projects the current job and latest education', () => {
  const p = defaultProfile();
  p.experience = [{ company: 'Acme', title: 'Engineer', current: true }];
  p.education = [{ school: 'MIT', degree: 'BSc', field: 'CS', end: '2020-06' }];
  const v = profileToValues(p);
  assert.equal(v.get('current_company'), 'Acme');
  assert.equal(v.get('current_title'), 'Engineer');
  assert.equal(v.get('school'), 'MIT');
  assert.equal(v.get('graduation_date'), '2020-06');
});

test('sensitive values are withheld unless explicitly included', () => {
  const p = defaultProfile();
  p.values.eeo_gender = 'Female';
  assert.equal(profileToValues(p).has('eeo_gender'), false);
  assert.equal(profileToValues(p, { includeSensitive: true }).get('eeo_gender'), 'Female');
});

test('completeness and missingCoreFields track the core set', () => {
  const p = defaultProfile();
  assert.ok(completeness(p) < 0.1);
  assert.ok(missingCoreFields(p).includes('email'));
  p.values.email = 'a@b.co';
  assert.ok(!missingCoreFields(p).includes('email'));
});

// ---------------------------------------------------------------------------
// resolver
// ---------------------------------------------------------------------------

test('resolves fields from name attributes', () => {
  const d = [
    desc({ attrs: 'first_name', label: 'First' }),
    desc({ attrs: 'last_name', label: 'Last' }),
    desc({ attrs: 'job_application[email]', label: 'Email' })
  ];
  const plan = buildPlan(d, baseCtx({
    values: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }
  }));
  assert.equal(byKey(plan, d[0].key).fieldId, 'first_name');
  assert.equal(byKey(plan, d[1].key).fieldId, 'last_name');
  assert.equal(byKey(plan, d[2].key).fieldId, 'email');
  assert.equal(byKey(plan, d[2].key).value, 'ada@example.com');
});

test('resolves from the autocomplete attribute when names are opaque', () => {
  const d = [desc({ attrs: 'ctl00_x17', autocomplete: 'given-name', label: '' })];
  const plan = buildPlan(d, baseCtx({ values: { first_name: 'Ada' } }));
  assert.equal(plan[0].fieldId, 'first_name');
  assert.equal(plan[0].source, 'autocomplete');
});

test('resolves from the visible label when attributes are useless', () => {
  const d = [desc({ attrs: 'input-42', label: 'Mobile phone number' })];
  const plan = buildPlan(d, baseCtx({ values: { phone: '+1 555 0100' } }));
  assert.equal(plan[0].fieldId, 'phone');
  assert.equal(plan[0].source, 'label');
});

test('a stronger candidate wins a contested field', () => {
  // "Name" alone must not steal first_name from an explicit first-name input.
  const generic = desc({ attrs: 'name', label: 'Name' });
  const specific = desc({ attrs: 'first_name', label: 'First name' });
  const plan = buildPlan([generic, specific], baseCtx({
    values: { first_name: 'Ada', full_name: 'Ada Lovelace' }
  }));
  assert.equal(byKey(plan, specific.key).fieldId, 'first_name');
  assert.equal(byKey(plan, generic.key).fieldId, 'full_name');
});

test('disqualifiers stop a look-alike match', () => {
  const d = [desc({ attrs: 'company_name', label: 'Company name' })];
  const plan = buildPlan(d, baseCtx({ values: { full_name: 'Ada Lovelace' } }));
  assert.notEqual(plan[0].fieldId, 'full_name');
});

test('demographic fields are held back unless the user opts in', () => {
  const d = [desc({ attrs: 'gender', label: 'Gender', kind: 'select', options: [{ value: 'f', label: 'Female' }] })];
  const off = buildPlan(d, baseCtx({ values: { eeo_gender: 'Female' } }));
  assert.equal(off[0].outcome, OUTCOME.SENSITIVE);

  const on = buildPlan(d, baseCtx({
    values: { eeo_gender: 'Female' },
    settings: { fillSensitive: true, overwriteExisting: false }
  }));
  assert.equal(on[0].outcome, null);
  assert.equal(on[0].value, 'Female');
});

test('unknown fields come back as unresolved rather than guessed', () => {
  const d = [desc({ attrs: 'q_9182', label: 'Describe a time you shipped under pressure' })];
  const plan = buildPlan(d, baseCtx());
  assert.equal(plan[0].fieldId, null);
  assert.equal(plan[0].outcome, OUTCOME.UNRESOLVED);
});

test('question memory answers a field the taxonomy cannot place', () => {
  const question = 'Describe a time you shipped under pressure';
  const memory = [{
    id: 'm1',
    key: questionKey(question),
    question,
    answer: 'I rewrote the billing importer the night before launch.'
  }];
  const d = [desc({ attrs: 'q_9182', label: `${question}?`, kind: 'textarea' })];
  const plan = buildPlan(d, baseCtx({ memory }));
  assert.equal(plan[0].source, 'memory');
  assert.equal(plan[0].memoryId, 'm1');
  assert.match(plan[0].value, /billing importer/);
});

test('memory recall tolerates rephrasing', () => {
  const stored = 'How did you hear about us?';
  const memory = [{ id: 'm2', key: questionKey(stored), question: stored, answer: 'LinkedIn' }];
  const d = [desc({ attrs: 'src', label: 'How did you hear about us' })];
  const plan = buildPlan(d, baseCtx({ memory }));
  assert.equal(plan[0].value, 'LinkedIn');
});

test('fields with an existing value are left alone by default', () => {
  const d = [desc({ attrs: 'email', label: 'Email', current: 'old@x.com', hasValue: true })];
  const plan = buildPlan(d, baseCtx({ values: { email: 'new@x.com' } }));
  assert.equal(plan[0].outcome, OUTCOME.SKIPPED);

  const forced = buildPlan(d, baseCtx({
    values: { email: 'new@x.com' },
    settings: { fillSensitive: false, overwriteExisting: true }
  }));
  assert.equal(forced[0].outcome, null);
});

test('recognised fields with no saved value are skipped, not failed', () => {
  const d = [desc({ attrs: 'phone', label: 'Phone' })];
  const plan = buildPlan(d, baseCtx());
  assert.equal(plan[0].fieldId, 'phone');
  assert.equal(plan[0].outcome, OUTCOME.SKIPPED);
});

test('booleans map onto the live option labels', () => {
  const d = [desc({
    kind: 'radio-group',
    attrs: 'work_authorization',
    label: 'Are you legally authorized to work in the United States?',
    options: [
      { value: '1', label: 'Yes', el: {} },
      { value: '0', label: 'No', el: {} }
    ]
  })];
  const plan = buildPlan(d, baseCtx({ values: { work_auth_us: 'yes' } }));
  assert.equal(plan[0].fieldId, 'work_auth_us');
  assert.equal(plan[0].value, 'Yes');
});

test('file inputs only ever claim file fields', () => {
  const d = [desc({ kind: 'file', attrs: 'resume', label: 'Resume', accept: '.pdf' })];
  const plan = buildPlan(d, baseCtx({ values: { first_name: 'Ada' } }));
  assert.equal(plan[0].fieldId, 'resume_file');
});

test('a file field is left for the adapter, not skipped for having no value', () => {
  // Regression: documents live in the vault, not in the profile's values map.
  // Gating the plan on `values.resume_file` marked every upload "skipped" and
  // the resume was silently never attached - on every site, for every user.
  const d = [desc({ kind: 'file', attrs: 'resume', label: 'Resume/CV', accept: '.pdf' })];
  const plan = buildPlan(d, baseCtx({ values: {} }));
  assert.equal(plan[0].fieldId, 'resume_file');
  assert.equal(plan[0].outcome, null, 'must reach the adapter so the vault can be consulted');
});

test('a file field that already holds a document is left alone', () => {
  const d = [desc({ kind: 'file', attrs: 'resume', label: 'Resume/CV', current: 'mine.pdf', hasValue: true })];
  const plan = buildPlan(d, baseCtx({ values: {} }));
  assert.equal(plan[0].outcome, OUTCOME.SKIPPED);

  const forced = buildPlan(d, baseCtx({
    values: {},
    settings: { fillSensitive: false, overwriteExisting: true }
  }));
  assert.equal(forced[0].outcome, null);
});

// ---------------------------------------------------------------------------
// detector guards
// ---------------------------------------------------------------------------

/** Minimal stand-in for a DOM element, enough for isIgnored(). */
function fakeEl({
  name = null, id = null, className = '', ariaHidden = null,
  ariaLabel = null, placeholder = null, tabindex = null, label = null
} = {}) {
  const attrs = {
    name, id, 'aria-hidden': ariaHidden, 'aria-label': ariaLabel,
    placeholder, tabindex
  };
  return {
    getAttribute: (k) => attrs[k] ?? null,
    className,
    labels: label ? [{ textContent: label }] : []
  };
}

test('page machinery is never treated as a fillable field', () => {
  // Greenhouse renders reCAPTCHA as a real <textarea>. Without this guard it
  // looks like a perfectly good free-text answer and could be filled from
  // question memory - on the form that decides whether you are a bot.
  assert.ok(isIgnored(fakeEl({ name: 'g-recaptcha-response', id: 'g-recaptcha-response-100000' })));
  assert.ok(isIgnored(fakeEl({ id: 'h-captcha-response' })));
  assert.ok(isIgnored(fakeEl({ name: 'cf-turnstile-response' })));
  assert.ok(isIgnored(fakeEl({ name: 'authenticity_token' })));
  assert.ok(isIgnored(fakeEl({ name: 'csrf_token' })));
  assert.ok(isIgnored(fakeEl({ className: 'honeypot-field' })));
  assert.ok(isIgnored(fakeEl({ name: 'email', ariaHidden: 'true' })));
});

test('honeypots are never filled', () => {
  // BambooHR's real one: a fully visible 214x28 input, opacity 1, that would have
  // matched the taxonomy's preferred_name pattern via "nickname".
  assert.ok(isIgnored(fakeEl({
    name: 'nickname_hpcsaf', id: 'nickname_hpcsaf',
    label: 'Please leave this field blank', tabindex: '-1'
  })), 'BambooHR honeypot must be ignored');

  // Each signal should stand on its own.
  assert.ok(isIgnored(fakeEl({ name: 'nickname_hpabc123' })), 'hp-suffixed name');
  assert.ok(isIgnored(fakeEl({ name: 'yourname', label: 'Please leave this field blank' })), 'leave-blank label');
  assert.ok(isIgnored(fakeEl({ name: 'yourname', ariaLabel: 'Do not fill this in' })), 'do-not-fill aria-label');
  assert.ok(isIgnored(fakeEl({ name: 'email2', placeholder: 'Leave blank' })), 'leave-blank placeholder');
});

test('tabindex=-1 alone does not disqualify a field', () => {
  // On the same BambooHR form that carries the honeypot, the real Country and
  // Highest Education selects are tabindex="-1" because they sit behind custom
  // widgets, and Greenhouse marks its combobox inner inputs the same way.
  // Treating it as a honeypot signal silently dropped real fields.
  assert.ok(!isIgnored(fakeEl({ name: 'countryId.value', tabindex: '-1', label: 'Country *' })));
  assert.ok(!isIgnored(fakeEl({ name: 'educationLevelId', tabindex: '-1', label: 'Highest Education Obtained *' })));
});

test('a page asking for a password is never an application', () => {
  // Workday's apply flow opens on account creation wearing the same wizard
  // chrome as the form - same progress bar, "step 1 of 6".
  const withPassword = {
    querySelector: (sel) => (sel === 'input[type="password"]' ? {} : null),
    title: 'Staff Engineer - Apply',
    body: { innerText: 'current step 1 of 6 Create Account Email Address Password' }
  };
  const d = [desc({ attrs: 'email' }), desc({ attrs: 'password' }), desc({ attrs: 'verifyPassword' })];
  assert.equal(looksLikeApplication(d, withPassword), false);
});

test('parseDateParts reads the formats forms actually use', () => {
  assert.deepEqual(parseDateParts('2026-11-02'), { y: '2026', m: '11', d: '02' });
  assert.deepEqual(parseDateParts('2026-11'), { y: '2026', m: '11', d: '01' });
  assert.deepEqual(parseDateParts('11/02/2026'), { y: '2026', m: '11', d: '02' });
  // 25 cannot be a month, so this is dd/mm/yyyy.
  assert.deepEqual(parseDateParts('25/12/2026'), { y: '2026', m: '12', d: '25' });
  assert.equal(parseDateParts('2026').y, '2026');
  assert.equal(parseDateParts(''), null);
  assert.equal(parseDateParts('as soon as possible'), null);
});

test('ordinary fields are not caught by the ignore guard', () => {
  assert.ok(!isIgnored(fakeEl({ name: 'first_name', id: 'first_name' })));
  assert.ok(!isIgnored(fakeEl({ name: 'job_application[email]' })));
  assert.ok(!isIgnored(fakeEl({ id: 'resume', className: 'form-control' })));
  assert.ok(!isIgnored(fakeEl({ name: 'urls[LinkedIn]' })));
});

// ---------------------------------------------------------------------------
// option matching
// ---------------------------------------------------------------------------

test('matchOption prefers exact over partial', () => {
  const options = [
    { value: 'us', label: 'United States' },
    { value: 'um', label: 'United States Minor Outlying Islands' }
  ];
  assert.equal(matchOption(options, 'United States').value, 'us');
});

test('matchOption handles a longer form of the same answer', () => {
  const options = [{ value: 'us', label: 'United States' }];
  assert.equal(matchOption(options, 'United States of America').value, 'us');
});

test('matchOption refuses a bad match rather than picking the first option', () => {
  const options = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }];
  assert.equal(matchOption(options, 'Zeppelin'), null);
});

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

function entryFor(kind, elValue, expected, extra = {}) {
  return {
    value: expected,
    desc: { kind, el: { value: elValue, ...extra }, options: extra.options || [] }
  };
}

test('verify accepts a reformatted phone number', () => {
  assert.ok(verifyEntry(entryFor('text', '(555) 123-4567', '5551234567')).ok);
});

test('verify accepts a numeric answer rendered with units', () => {
  assert.ok(verifyEntry(entryFor('text', '5 years', '5')).ok);
});

test('verify rejects a value the field silently dropped', () => {
  const res = verifyEntry(entryFor('text', '', 'Ada Lovelace'));
  assert.equal(res.ok, false);
  assert.equal(res.actual, '');
});

test('verify matches an upload by filename stem', () => {
  const entry = {
    value: 'ada-lovelace-resume.pdf',
    desc: { kind: 'file', el: { files: [{ name: 'ada-lovelace-resume.pdf' }] }, options: [] }
  };
  assert.ok(verifyEntry(entry).ok);
});

test('verify reads a checkbox back as a boolean', () => {
  const on = { value: 'true', desc: { kind: 'checkbox', el: { checked: true }, options: [] } };
  const off = { value: 'true', desc: { kind: 'checkbox', el: { checked: false }, options: [] } };
  assert.ok(verifyEntry(on).ok);
  assert.equal(verifyEntry(off).ok, false);
});
