/**
 * Listing extraction - assisted mode.
 *
 * Reads the job cards that are already rendered on the page the user opened,
 * and nothing else. It does not navigate, paginate, search, follow links,
 * schedule anything, or run when the user is not looking at the page. There is
 * no code path here that visits a URL the user did not.
 *
 * The output feeds relevance scoring in the panel so the user can see which of
 * the jobs in front of them are worth opening. Applying still means opening the
 * posting and filling the employer's own form, like any other site.
 */

import { deepQueryAll, isVisible } from './detector.js';

const MAX_CARDS = 60;

function text(el) {
  return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function pick(card, selector) {
  if (!selector) return '';
  for (const sel of String(selector).split(',')) {
    try {
      const el = card.querySelector(sel.trim());
      if (el) return text(el);
    } catch {
      /* a bad selector in a board profile must not break the scan */
    }
  }
  return '';
}

function pickHref(card, selector) {
  if (!selector) return '';
  for (const sel of String(selector).split(',')) {
    try {
      const el = card.querySelector(sel.trim());
      if (el && el.href) return el.href;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * @param {object} board  board profile (src/boards/*.json)
 * @param {Document|Element} root
 * @returns {Array} parsed listings, in page order
 */
export function extractListings(board, root = document) {
  if (!board || !board.listing || !board.listing.card) return [];
  const { card: cardSel, id: idAttr, fields = {}, skills: skillSel } = board.listing;

  let cards;
  try {
    cards = deepQueryAll(root, (n) => n.matches && n.matches(cardSel));
  } catch {
    return [];
  }

  const out = [];
  for (const card of cards.slice(0, MAX_CARDS)) {
    if (!isVisible(card)) continue;
    const title = pick(card, fields.title);
    if (!title) continue;

    out.push({
      id: (idAttr && card.getAttribute(idAttr)) || pickHref(card, fields.url) || title,
      title,
      url: pickHref(card, fields.url) || location.href,
      company: pick(card, fields.company),
      location: pick(card, fields.location),
      experience: pick(card, fields.experience),
      salary: pick(card, fields.salary),
      posted: pick(card, fields.posted),
      rating: pick(card, fields.rating),
      description: pick(card, fields.description).slice(0, 240),
      skills: skillSel
        ? [...card.querySelectorAll(skillSel)].map(text).filter(Boolean).slice(0, 12)
        : []
    });
  }
  return out;
}

/** The single listing on a job-detail page, if this board describes one. */
export function extractDetail(board, root = document) {
  if (!board || !board.detail) return null;
  const { fields = {} } = board.detail;
  const title = pick(root, fields.title);
  if (!title) return null;
  return {
    id: location.href,
    title,
    url: location.href,
    company: pick(root, fields.company),
    location: pick(root, fields.location),
    experience: pick(root, fields.experience),
    salary: pick(root, fields.salary),
    skills: [],
    detail: true
  };
}
