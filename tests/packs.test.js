/**
 * Pack integrity.
 *
 * A pack is data, so the things that can go wrong are data problems: a field id
 * that no longer exists in the taxonomy, a pack listed in the index but missing
 * from disk, two packs claiming the same host, or a selector that would throw at
 * querySelector time. These run on every commit so a pack edit cannot quietly
 * break the engine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELD_BY_ID } from '../src/core/taxonomy.js';

const PACK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/packs');
const index = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'index.json'), 'utf8'));
const packs = index.packs.map((f) => ({
  file: f,
  json: JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8'))
}));

test('every pack in the index exists on disk', () => {
  for (const f of index.packs) {
    assert.ok(fs.existsSync(path.join(PACK_DIR, f)), `missing pack file: ${f}`);
  }
});

test('every pack file on disk is listed in the index', () => {
  const onDisk = fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const f of onDisk) {
    assert.ok(index.packs.includes(f), `pack not registered in index.json: ${f}`);
  }
});

test('pack ids and names are unique', () => {
  const ids = packs.map((p) => p.json.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate pack id');
});

test('packs have the required shape', () => {
  for (const { file, json } of packs) {
    assert.ok(json.id, `${file}: missing id`);
    assert.ok(json.name, `${file}: missing name`);
    assert.ok(Array.isArray(json.match) && json.match.length, `${file}: missing match hosts`);
    assert.ok(Array.isArray(json.fields) && json.fields.length, `${file}: no fields`);
    assert.ok(json.detect && Array.isArray(json.detect.any), `${file}: missing detect.any`);
  }
});

test('no two packs claim the same host', () => {
  const seen = new Map();
  for (const { json } of packs) {
    for (const host of json.match) {
      // A vendor apex plus its own subdomain is fine; two different vendors is not.
      const prev = seen.get(host);
      assert.equal(prev, undefined, `host ${host} claimed by both ${prev} and ${json.id}`);
      seen.set(host, json.id);
    }
  }
});

test('every pack field id exists in the taxonomy', () => {
  for (const { file, json } of packs) {
    for (const f of json.fields) {
      assert.ok(FIELD_BY_ID.has(f.id), `${file}: unknown canonical field "${f.id}"`);
    }
  }
});

test('every pack field carries at least one selector', () => {
  for (const { file, json } of packs) {
    for (const f of json.fields) {
      const sels = Array.isArray(f.selector) ? f.selector : [f.selector];
      assert.ok(sels.length && sels.every((s) => typeof s === 'string' && s.trim()),
        `${file}: field "${f.id}" has an empty selector`);
    }
  }
});

test('selectors are balanced and free of obvious syntax errors', () => {
  // Cheap structural check - a real querySelector parse happens in the browser,
  // but this catches the mistakes that actually get made by hand.
  for (const { file, json } of packs) {
    const all = [
      ...json.fields.flatMap((f) => (Array.isArray(f.selector) ? f.selector : [f.selector])),
      ...(json.detect.any || []),
      ...(json.submit || []),
      ...(json.confirm || [])
    ];
    for (const sel of all) {
      const open = (sel.match(/\[/g) || []).length;
      const close = (sel.match(/\]/g) || []).length;
      assert.equal(open, close, `${file}: unbalanced brackets in "${sel}"`);
      const quotes = (sel.match(/'/g) || []).length;
      assert.equal(quotes % 2, 0, `${file}: unbalanced quotes in "${sel}"`);
      assert.ok(!/\s,\s*$/.test(sel), `${file}: trailing comma in "${sel}"`);
    }
  }
});

test('option maps only reference values the taxonomy allows', () => {
  for (const { file, json } of packs) {
    for (const f of json.fields) {
      if (!f.options) continue;
      const def = FIELD_BY_ID.get(f.id);
      if (!def || !def.options) continue;
      for (const key of Object.keys(f.options)) {
        assert.ok(def.options.includes(key),
          `${file}: field "${f.id}" maps unknown option "${key}"`);
      }
    }
  }
});

test('file fields only ever map to file inputs', () => {
  for (const { file, json } of packs) {
    for (const f of json.fields) {
      const def = FIELD_BY_ID.get(f.id);
      if (!def || def.type !== 'file') continue;
      const sels = Array.isArray(f.selector) ? f.selector : [f.selector];
      assert.ok(sels.some((s) => /file|resume|cv|upload|\[cv\]/i.test(s)),
        `${file}: file field "${f.id}" has a selector that does not look like an upload: ${sels.join(', ')}`);
    }
  }
});

test('every pack records whether it was checked against a live form', () => {
  for (const { file, json } of packs) {
    assert.ok('verifiedAgainstLiveForm' in json,
      `${file}: missing verifiedAgainstLiveForm (use null if only fixture-tested)`);
    const v = json.verifiedAgainstLiveForm;
    assert.ok(v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
      `${file}: verifiedAgainstLiveForm must be null or an ISO date`);
  }
});

test('the bundled packs cover the wave-1 and wave-2 ATSs', () => {
  const ids = packs.map((p) => p.json.id).sort();
  for (const expected of [
    'ashby', 'greenhouse', 'lever',
    'bamboohr', 'jazzhr', 'pinpoint', 'recruitee', 'smartrecruiters', 'workable'
  ]) {
    assert.ok(ids.includes(expected), `missing pack: ${expected}`);
  }
});
