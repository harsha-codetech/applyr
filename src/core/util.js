/** Shared helpers. No DOM access here - this module is imported by the service worker too. */

/** Collapse a label or question into a comparable form. */
export function normalizeText(s) {
  return String(s == null ? '' : s)
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\(required\)|\(optional\)|\*/g, ' ')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aggressive normalization for question-memory keys: strips the parts of a
 * screening question that vary between employers so the same question asked by
 * two companies collapses onto one memory entry.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'you', 'your', 'yours', 'we', 'our', 'us', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'and', 'or',
  'if', 'it', 'its', 'please', 'kindly', 'would', 'will', 'can', 'could', 'may',
  'have', 'has', 'had', 'any', 'all', 'about'
]);

export function questionKey(s) {
  return normalizeText(s)
    .replace(/\b\d{4}\b/g, '')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

function trigrams(s) {
  const padded = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams. Returns 0..1. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = trigrams(a);
  const B = trigrams(b);
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return (2 * hits) / (A.size + B.size);
}

/**
 * Pick the best match for `needle` among `candidates`.
 * @param {string} needle
 * @param {Array<{key: string}>} candidates
 * @param {number} threshold
 */
export function bestMatch(needle, candidates, threshold = 0.72) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarity(needle, c.key);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= threshold ? { match: best, score: bestScore } : null;
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** ArrayBuffer -> base64. Chunked so large resumes do not blow the call stack. */
export function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 -> Uint8Array. */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Truthy/falsy words used by yes-no dropdowns and radio groups. */
export const YES_WORDS = ['yes', 'y', 'true', 'i am', 'i do', 'authorized', 'agree', 'accept'];
export const NO_WORDS = ['no', 'n', 'false', 'i am not', 'i do not', 'not authorized', 'decline'];

export function looksYes(s) {
  const t = normalizeText(s);
  return YES_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}

export function looksNo(s) {
  const t = normalizeText(s);
  return NO_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}
