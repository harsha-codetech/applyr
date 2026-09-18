/**
 * Remote pack validation.
 *
 * This is the only place where data from outside the extension can influence
 * where a value gets typed, so the tests are written from the attacker's side:
 * each one is something a bad or broken pack file could try, and must not get
 * through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackBundle, mergePacks, DEFAULT_PACK_URL } from '../src/core/pack-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const goodPack = (over = {}) => ({
  id: 'demo',
  name: 'Demo',
  match: ['demo-ats.com'],
  detect: { any: ['#application-form'] },
  fields: [{ id: 'first_name', selector: ['#first_name'] }],
  ...over
});

const bundle = (packs) => ({ format: 'applyr-packs', version: 1, packs });

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

test('a well-formed bundle is accepted', () => {
  const res = validatePackBundle(bundle([goodPack()]));
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(res.packs.length, 1);
});

test('anything that is not an applyr pack bundle is refused', () => {
  assert.equal(validatePackBundle(null).ok, false);
  assert.equal(validatePackBundle('a string').ok, false);
  assert.equal(validatePackBundle({ packs: [goodPack()] }).ok, false, 'missing format');
  assert.equal(validatePackBundle(bundle([])).ok, false, 'empty pack list');
});

test('a bundle is rejected whole, not partially applied', () => {
  // One bad pack must not let the good ones through: a half-applied update is
  // harder to reason about than no update.
  const res = validatePackBundle(bundle([goodPack(), goodPack({ id: 'bad', fields: [] })]));
  assert.equal(res.ok, false);
  assert.deepEqual(res.packs, []);
});

// ---------------------------------------------------------------------------
// the rules that matter
// ---------------------------------------------------------------------------

test('a selector that targets a password input is refused', () => {
  const res = validatePackBundle(bundle([goodPack({
    fields: [{ id: 'email', selector: ["input[type='password']"] }]
  })]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /password/.test(e)));
});

test('a field id the taxonomy does not know is refused', () => {
  const res = validatePackBundle(bundle([goodPack({
    fields: [{ id: 'social_security_number', selector: ['#ssn'] }]
  })]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /unknown canonical field/.test(e)));
});

test('a document slot must point at an upload', () => {
  // Otherwise a remote file could route the resume into an arbitrary control.
  const bad = validatePackBundle(bundle([goodPack({
    fields: [{ id: 'resume_file', selector: ['#some-text-box'] }]
  })]));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /does not target an upload/.test(e)));

  const good = validatePackBundle(bundle([goodPack({
    fields: [{ id: 'resume_file', selector: ["input[type='file']"] }]
  })]));
  assert.equal(good.ok, true, good.errors.join('; '));
});

test('two packs cannot claim the same host', () => {
  const res = validatePackBundle(bundle([
    goodPack(),
    goodPack({ id: 'impostor', match: ['demo-ats.com'] })
  ]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /already claimed/.test(e)));
});

test('wildcard and implausible hosts are refused', () => {
  for (const host of ['*', '*.com', 'com', 'javascript:alert(1)', '']) {
    const res = validatePackBundle(bundle([goodPack({ match: [host] })]));
    assert.equal(res.ok, false, `host "${host}" should be refused`);
  }
});

test('duplicate pack ids are refused', () => {
  const res = validatePackBundle(bundle([goodPack(), goodPack()]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /duplicate pack id/.test(e)));
});

test('absurd sizes are refused', () => {
  const huge = validatePackBundle(bundle([goodPack({
    fields: [{ id: 'first_name', selector: ['#a'.padEnd(400, 'b')] }]
  })]));
  assert.equal(huge.ok, false);

  const many = validatePackBundle(bundle(
    Array.from({ length: 101 }, (_, i) => goodPack({ id: `p${i}`, match: [`p${i}.example.com`] }))
  ));
  assert.equal(many.ok, false);
});

test('malformed selectors are refused', () => {
  assert.equal(validatePackBundle(bundle([goodPack({
    fields: [{ id: 'first_name', selector: ["input[name='x"] }]
  })])).ok, false);
});

// ---------------------------------------------------------------------------
// merge behaviour
// ---------------------------------------------------------------------------

test('remote packs layer over bundled ones by id', () => {
  const bundled = [{ id: 'lever', name: 'Lever' }, { id: 'ashby', name: 'Ashby' }];
  const merged = mergePacks(bundled, [{ id: 'lever', name: 'Lever (updated)' }, { id: 'new', name: 'New' }]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((p) => p.id === 'lever').name, 'Lever (updated)');
  assert.equal(merged.find((p) => p.id === 'lever').source, 'remote');
  assert.equal(merged.find((p) => p.id === 'ashby').name, 'Ashby');
});

test('a remote source can never remove a bundled pack', () => {
  // A source that disappears or goes wrong must degrade to what shipped.
  const bundled = [{ id: 'lever' }, { id: 'ashby' }];
  assert.equal(mergePacks(bundled, []).length, 2);
  assert.equal(mergePacks(bundled, null).length, 2);
  assert.equal(mergePacks(bundled, [{ id: 'other' }]).length, 3);
});

// ---------------------------------------------------------------------------
// the file we actually publish
// ---------------------------------------------------------------------------

test('the committed packs.json passes the runtime validator', () => {
  const file = path.join(ROOT, 'packs.json');
  assert.ok(fs.existsSync(file), 'packs.json is missing - run npm run packs:bundle');
  const res = validatePackBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.ok(res.packs.length >= 10, `expected every pack, got ${res.packs.length}`);
});

test('packs.json matches the packs on disk', () => {
  const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/packs/index.json'), 'utf8'));
  assert.deepEqual(
    published.packs.map((p) => p.id).sort(),
    index.packs.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/packs', f), 'utf8')).id).sort(),
    'packs.json is stale - run npm run packs:bundle'
  );
});

test('the default source is a static file over https', () => {
  const u = new URL(DEFAULT_PACK_URL);
  assert.equal(u.protocol, 'https:');
  assert.ok(u.pathname.endsWith('.json'));
  assert.equal(u.search, '', 'the request must carry no query parameters');
});
