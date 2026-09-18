/**
 * Listing relevance scoring.
 *
 * Pure functions over a parsed listing and the user's profile. No model, no
 * network - the same trigram similarity the question memory uses, plus a few
 * rules about experience and location.
 *
 * The score exists to *rank what the user is already looking at*, never to
 * decide anything on their behalf. Every score carries its reasons so the panel
 * can show why a job placed where it did, and the user can disagree with it.
 */

import { normalizeText, similarity } from './util.js';

const WEIGHTS = {
  skills: 0.45,
  experience: 0.30,
  location: 0.15,
  title: 0.10
};

/** "Java, Python; React" -> ['java','python','react'] */
export function splitSkills(text) {
  return String(text || '')
    .split(/[,;|\n/]+/)
    .map((s) => normalizeText(s))
    .filter((s) => s && s.length > 1);
}

/** "0-2 Yrs", "5+ years", "3 Yrs" -> {min, max} */
export function parseExperienceRange(text) {
  const t = String(text || '').toLowerCase();
  const range = t.match(/(\d+)\s*[-–to]+\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = t.match(/(\d+)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: Number(plus[1]) + 10 };
  const single = t.match(/(\d+)/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return null;
}

function skillScore(listingSkills, profileSkills) {
  if (!listingSkills.length || !profileSkills.length) return { score: 0.5, reason: null };
  const have = new Set(profileSkills);
  let hits = 0;
  const matched = [];
  for (const s of listingSkills) {
    // Exact, or close enough that "react js" matches "react".
    if (have.has(s) || [...have].some((p) => similarity(p, s) > 0.8)) {
      hits += 1;
      matched.push(s);
    }
  }
  const denom = Math.min(listingSkills.length, 8);
  return {
    score: Math.min(1, hits / denom),
    reason: hits
      ? `${hits} of ${listingSkills.length} skills match (${matched.slice(0, 3).join(', ')})`
      : 'no listed skills match yours'
  };
}

function experienceScore(range, years) {
  if (range == null || years == null || Number.isNaN(years)) {
    return { score: 0.5, reason: null };
  }
  if (years >= range.min && years <= range.max) {
    return { score: 1, reason: `wants ${range.min}-${range.max} yrs, you have ${years}` };
  }
  if (years < range.min) {
    const gap = range.min - years;
    return {
      score: Math.max(0, 1 - gap * 0.35),
      reason: `wants ${range.min}+ yrs, you have ${years}`
    };
  }
  const over = years - range.max;
  return {
    score: Math.max(0.15, 1 - over * 0.12),
    reason: `caps at ${range.max} yrs, you have ${years}`
  };
}

function locationScore(listingLocation, profile) {
  const loc = normalizeText(listingLocation);
  if (!loc) return { score: 0.5, reason: null };
  if (/remote|work from home|anywhere/.test(loc)) {
    return { score: 1, reason: 'remote' };
  }
  const city = normalizeText(profile.city);
  if (city && loc.includes(city)) return { score: 1, reason: `in ${profile.city}` };
  const relocate = /^y/i.test(String(profile.willing_to_relocate || ''));
  return relocate
    ? { score: 0.55, reason: `different city - you said you would relocate` }
    : { score: 0.1, reason: `different city (${listingLocation})` };
}

function titleScore(listingTitle, currentTitle) {
  if (!listingTitle || !currentTitle) return { score: 0.5, reason: null };
  const s = similarity(normalizeText(listingTitle), normalizeText(currentTitle));
  return { score: s, reason: s > 0.5 ? 'similar to your current title' : null };
}

/**
 * @param {{title, company, location, experience, skills: string[]}} listing
 * @param {Record<string,string>} values  canonical profile values
 * @returns {{score: number, reasons: string[], parts: object}}
 */
export function scoreListing(listing, values = {}) {
  const profileSkills = splitSkills(values.skills);
  const listingSkills = (listing.skills || []).map(normalizeText).filter(Boolean);
  const years = values.years_experience != null && values.years_experience !== ''
    ? Number(values.years_experience)
    : null;

  const parts = {
    skills: skillScore(listingSkills, profileSkills),
    experience: experienceScore(parseExperienceRange(listing.experience), years),
    location: locationScore(listing.location, values),
    title: titleScore(listing.title, values.current_title)
  };

  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) score += parts[key].score * weight;

  return {
    score: Math.round(score * 100) / 100,
    reasons: Object.values(parts).map((p) => p.reason).filter(Boolean),
    parts
  };
}

/** Sort a set of listings, best first, and attach their scores. */
export function rankListings(listings, values = {}) {
  return listings
    .map((l) => ({ ...l, match: scoreListing(l, values) }))
    .sort((a, b) => b.match.score - a.match.score);
}

/** A label the panel can show without the user reading a number. */
export function matchLabel(score) {
  if (score >= 0.75) return 'strong';
  if (score >= 0.55) return 'worth a look';
  if (score >= 0.35) return 'weak';
  return 'poor';
}
