/**
 * Selector-pack registry.
 *
 * A pack is pure JSON - data, never code - which is what makes the Phase-10
 * "fetch updated packs from a static URL" upgrade legal under MV3's remote-code
 * ban. Today they are bundled; loadPacks() is the single seam where a remote
 * fetch would later be added, with the bundled copy as the fallback.
 */

const INDEX_URL = 'src/packs/index.json';

let cache = null;

async function loadJSON(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`pack load failed: ${path}`);
  return res.json();
}

/** @returns {Promise<Array>} every bundled pack, parsed */
export async function loadPacks() {
  if (cache) return cache;
  const index = await loadJSON(INDEX_URL);
  const packs = await Promise.all(index.packs.map((p) => loadJSON(`src/packs/${p}`)));
  cache = packs;
  return packs;
}

function hostMatches(host, patterns) {
  return patterns.some((p) => host === p || host.endsWith(`.${p}`));
}

/**
 * Choose the pack for a document.
 *
 * Host match is tried first; if the page is an iframe-embedded board on a
 * company domain (Greenhouse's usual deployment) the DOM fingerprint in
 * `detect.any` is what identifies it instead.
 *
 * @param {string} href
 * @param {Document} doc
 */
export async function pickPack(href, doc) {
  const packs = await loadPacks();
  let host = '';
  try {
    host = new URL(href).hostname;
  } catch {
    /* about:blank and friends */
  }

  const byHost = packs.find((p) => hostMatches(host, p.match || []));
  if (byHost) return { pack: byHost, via: 'host' };

  for (const p of packs) {
    const probes = (p.detect && p.detect.any) || [];
    if (probes.some((sel) => safeQuery(doc, sel))) return { pack: p, via: 'dom' };
  }
  return { pack: null, via: 'generic' };
}

function safeQuery(root, sel) {
  try {
    return root.querySelector(sel);
  } catch {
    return null;
  }
}

/**
 * Build a lookup of CSS selector -> canonical field id for a pack.
 * @param {object|null} pack
 * @returns {Array<{id: string, selectors: string[], options?: Record<string,string>}>}
 */
export function packFieldRules(pack) {
  if (!pack || !Array.isArray(pack.fields)) return [];
  return pack.fields.map((f) => ({
    id: f.id,
    selectors: Array.isArray(f.selector) ? f.selector : [f.selector],
    options: f.options || null
  }));
}

/** Widget hints tell the combobox adapter how this ATS builds its dropdowns. */
export function packWidgets(pack) {
  return (pack && pack.widgets) || {};
}

export function packMetaSelectors(pack) {
  return (pack && pack.meta) || {};
}

export function packSubmitSelectors(pack) {
  return (pack && pack.submit) || ['button[type="submit"]', 'input[type="submit"]'];
}

export function packConfirmSelectors(pack) {
  return (pack && pack.confirm) || [];
}
