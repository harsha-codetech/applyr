/**
 * Listing relevance scoring - assisted mode.
 *
 * The score only ever reorders jobs the user is already looking at, so the bar
 * is "does the ordering make sense to a person", not precision. These tests pin
 * the cases where a wrong answer would be actively misleading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreListing, rankListings, parseExperienceRange, splitSkills, matchLabel
} from '../src/core/matching.js';

const PROFILE = {
  skills: 'Java, Kubernetes, Kafka, PostgreSQL, Payments, Distributed Systems',
  years_experience: '7',
  city: 'Bengaluru',
  current_title: 'Senior Software Engineer',
  willing_to_relocate: 'yes'
};

const job = (over) => ({
  title: 'Software Engineer', company: 'Acme', location: 'Bengaluru',
  experience: '5-9 Yrs', skills: [], ...over
});

test('splitSkills handles the separators job boards actually use', () => {
  assert.deepEqual(splitSkills('Java, Kubernetes; Kafka / Go'), ['java', 'kubernetes', 'kafka', 'go']);
  assert.deepEqual(splitSkills(''), []);
  assert.deepEqual(splitSkills('C'), []); // single letters are noise, not skills
});

test('parseExperienceRange reads the common formats', () => {
  assert.deepEqual(parseExperienceRange('0-2 Yrs'), { min: 0, max: 2 });
  assert.deepEqual(parseExperienceRange('5-9 Yrs'), { min: 5, max: 9 });
  assert.deepEqual(parseExperienceRange('8+ years'), { min: 8, max: 18 });
  assert.deepEqual(parseExperienceRange('3 Yrs'), { min: 3, max: 3 });
  assert.equal(parseExperienceRange('Not specified'), null);
});

test('a well-matched job scores high and explains why', () => {
  const res = scoreListing(job({
    title: 'Senior Platform Engineer - Payments',
    skills: ['Java', 'Kubernetes', 'Payments', 'PostgreSQL', 'Kafka']
  }), PROFILE);
  assert.ok(res.score >= 0.75, `expected a strong score, got ${res.score}`);
  assert.ok(res.reasons.some((r) => /skills match/.test(r)));
  assert.equal(matchLabel(res.score), 'strong');
});

test('a fresher role scores poorly for a senior candidate', () => {
  const res = scoreListing(job({
    title: 'Trainee Software Developer', experience: '0-2 Yrs',
    location: 'Chennai', skills: ['HTML', 'CSS', 'Fresher']
  }), PROFILE);
  assert.ok(res.score < 0.4, `expected a weak score, got ${res.score}`);
  assert.ok(res.reasons.some((r) => /caps at 2 yrs/.test(r)));
});

test('an unrelated discipline scores poorly even in the right city', () => {
  const res = scoreListing(job({
    title: 'Area Sales Manager', experience: '3-6 Yrs',
    skills: ['Channel Sales', 'Distribution', 'FMCG']
  }), PROFILE);
  assert.ok(res.score < 0.55, `expected a weak score, got ${res.score}`);
});

test('remote always counts as a location match', () => {
  const res = scoreListing(job({ location: 'Remote', skills: ['Java', 'Kafka'] }), PROFILE);
  assert.ok(res.reasons.includes('remote'));
});

test('a different city is penalised, less so if you would relocate', () => {
  const stay = scoreListing(job({ location: 'Pune' }), { ...PROFILE, willing_to_relocate: 'no' });
  const move = scoreListing(job({ location: 'Pune' }), PROFILE);
  assert.ok(move.score > stay.score);
  assert.ok(move.reasons.some((r) => /would relocate/.test(r)));
});

test('missing profile data degrades to neutral rather than zero', () => {
  // An empty profile must not make every job look terrible - it makes them
  // unknown, which is a different thing.
  const res = scoreListing(job({ skills: ['Java'] }), {});
  assert.ok(res.score > 0.3 && res.score < 0.8, `expected a middling score, got ${res.score}`);
});

test('ranking puts the relevant jobs first', () => {
  const listings = [
    job({ title: 'Trainee Developer', experience: '0-2 Yrs', location: 'Chennai', skills: ['HTML'] }),
    job({ title: 'Senior Platform Engineer', skills: ['Java', 'Kubernetes', 'Payments', 'Kafka'] }),
    job({ title: 'Area Sales Manager', experience: '3-6 Yrs', skills: ['FMCG'] }),
    job({ title: 'Backend Engineer', experience: '6-10 Yrs', location: 'Remote', skills: ['Kafka', 'Java', 'Distributed Systems'] })
  ];
  const ranked = rankListings(listings, PROFILE);
  assert.match(ranked[0].title, /Platform Engineer|Backend Engineer/);
  assert.match(ranked[1].title, /Platform Engineer|Backend Engineer/);
  assert.match(ranked[3].title, /Trainee|Sales/);
});

test('scores are stable and bounded', () => {
  for (const l of [job(), job({ skills: [] }), job({ experience: '' }), job({ location: '' })]) {
    const s = scoreListing(l, PROFILE).score;
    assert.ok(s >= 0 && s <= 1, `score out of range: ${s}`);
  }
});
