/**
 * Board profiles - the read-only counterpart to selector packs.
 *
 * A pack says how to FILL a form. A board profile says how to READ the job
 * cards on a listings page the user is already looking at. They are kept apart
 * on purpose: nothing in a board profile can cause a write, and nothing in it
 * describes navigation.
 */

const INDEX_URL = 'src/boards/index.json';

let cache = null;

async function loadJSON(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`board load failed: ${path}`);
  return res.json();
}

export async function loadBoards() {
  if (cache) return cache;
  const index = await loadJSON(INDEX_URL);
  cache = await Promise.all(index.boards.map((b) => loadJSON(`src/boards/${b}`)));
  return cache;
}

function hostMatches(host, patterns) {
  return patterns.some((p) => host === p || host.endsWith(`.${p}`));
}

/** @returns {Promise<object|null>} */
export async function pickBoard(href) {
  let host = '';
  try {
    host = new URL(href).hostname;
  } catch {
    return null;
  }
  const boards = await loadBoards();
  return boards.find((b) => hostMatches(host, b.match || [])) || null;
}
