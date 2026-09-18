/**
 * Content-script orchestrator.
 *
 * One instance runs per frame (the manifest sets all_frames, because Greenhouse
 * and iCIMS render the real form inside an iframe on the employer's domain).
 * Each frame scans itself, fills itself, and reports its own results; the
 * service worker aggregates.
 */

import { MSG, OUTCOME } from '../core/messages.js';
import { pickPack, packFieldRules, packWidgets, packMetaSelectors, packSubmitSelectors, packConfirmSelectors } from '../core/packs.js';
import { scan, looksLikeApplication, deepQueryAll, isVisible } from './detector.js';
import { pickBoard } from '../core/boards.js';
import { extractListings, extractDetail } from './listings.js';
import { buildPlan } from './resolver.js';
import { applyEntry } from './adapters/index.js';
import * as overlay from './overlay.js';

const state = {
  pack: null,
  via: 'generic',
  descriptors: [],
  plan: [],
  lastResults: [],
  scanning: false,
  filling: false,
  meta: null,
  board: null,
  boardChecked: false,
  submitWatched: false
};

// ---------------------------------------------------------------------------
// Page metadata
// ---------------------------------------------------------------------------

function textFromSelectors(selectors) {
  for (const sel of selectors || []) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const v = el.tagName === 'META'
        ? el.getAttribute('content')
        : el.getAttribute('alt') || el.textContent;
      if (v && v.trim()) return v.trim().slice(0, 160);
    } catch {
      /* selector from a pack may be invalid - ignore */
    }
  }
  return '';
}

/**
 * Multi-step wizards announce their position in text for screen readers -
 * Workday renders "current step 2 of 6" - so one regex covers every ATS that
 * bothers to be accessible, with no per-site configuration.
 */
function readStep() {
  const text = ((document.body && document.body.innerText) || '').slice(0, 3000);
  const m = text.match(/step\s+(\d+)\s+of\s+(\d+)/i);
  if (!m) return null;
  const current = Number(m[1]);
  const total = Number(m[2]);
  return total > 1 && current <= total ? { current, total } : null;
}

function readMeta() {
  const sel = packMetaSelectors(state.pack);
  const role = textFromSelectors(sel.role) || textFromSelectors(['h1', 'meta[property="og:title"]']) || document.title;
  const company = textFromSelectors(sel.company)
    || textFromSelectors(['meta[property="og:site_name"]'])
    || hostToCompany();
  return {
    company: String(company || '').slice(0, 120),
    role: String(role || '').replace(/\s*[-|]\s*.*$/, '').slice(0, 120),
    url: location.href,
    ats: state.pack ? state.pack.id : 'generic'
  };
}

function hostToCompany() {
  const h = location.hostname.replace(/^www\./, '');
  const parts = h.split('.');
  if (/greenhouse|lever|ashbyhq|myworkdayjobs|icims/.test(h)) {
    // Company name is in the path for the big boards: /acme/job/123
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (seg && seg.length < 40) return seg.replace(/[-_]/g, ' ');
  }
  return parts.length > 2 ? parts[parts.length - 2] : parts[0];
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function doScan({ announce = true } = {}) {
  if (state.scanning) return null;
  state.scanning = true;
  try {
    if (!state.pack) {
      const picked = await pickPack(location.href, document);
      state.pack = picked.pack;
      state.via = picked.via;
    }
    state.descriptors = scan(document);
    const isApp = looksLikeApplication(state.descriptors, document);
    state.meta = readMeta();

    // Assisted mode: if this host is a job board we know how to read, parse the
    // cards that are already on screen. Read-only - see content/listings.js.
    if (!state.boardChecked) {
      state.boardChecked = true;
      state.board = await pickBoard(location.href);
    }
    let listings = [];
    if (state.board) {
      listings = extractListings(state.board, document);
      if (!listings.length) {
        const one = extractDetail(state.board, document);
        if (one) listings = [one];
      }
    }

    const payload = {
      type: MSG.SCAN_RESULT,
      frameUrl: location.href,
      isApplication: isApp,
      fieldCount: state.descriptors.length,
      pack: state.pack ? state.pack.id : null,
      packName: state.pack ? state.pack.name : 'Generic mode',
      via: state.via,
      meta: state.meta,
      step: readStep(),
      board: state.board ? { id: state.board.id, name: state.board.name } : null,
      listings
    };
    if (announce) safeSend(payload);
    if (isApp) watchSubmit();
    return payload;
  } finally {
    state.scanning = false;
  }
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

async function doFill({ only = null } = {}) {
  if (state.filling) return { ok: false, reason: 'already filling' };

  // Never write into a page that is asking for a password. Workday's apply flow
  // opens on account creation wearing the same wizard chrome as the form, and
  // marking it "not an application" was not enough on its own: an explicit Fill
  // still typed the user's email into the credential screen.
  //
  // Known trade-off: a few ATSs (some iCIMS and Taleo flows) combine account
  // creation with the application itself. Those will refuse too, and have to be
  // filled by hand until this can tell the two apart.
  if (document.querySelector('input[type="password"]')) {
    return {
      ok: false,
      reason: 'This page is asking for a password - applyr does not fill sign-in or account screens'
    };
  }

  state.filling = true;
  overlay.clearRings();

  try {
    if (!state.descriptors.length) await doScan({ announce: false });
    else state.descriptors = scan(document);

    const ctxData = await safeSend({ type: MSG.NEED_VALUES });
    if (!ctxData || !ctxData.ok) {
      return { ok: false, reason: 'profile unavailable' };
    }

    state.plan = buildPlan(state.descriptors, {
      packRules: packFieldRules(state.pack),
      root: document,
      values: ctxData.values,
      memory: ctxData.memory,
      settings: ctxData.settings
    });

    const widgets = packWidgets(state.pack);
    const results = [];
    const usedMemory = [];

    for (const entry of state.plan) {
      if (only && entry.key !== only) continue;

      if (entry.outcome) {
        results.push(summarize(entry, entry.outcome, entry.reason));
        paint(entry, entry.outcome);
        continue;
      }

      const res = await applyEntry(entry, {
        widgets,
        resolveFile: async (desc) => {
          const reply = await safeSend({
            type: MSG.NEED_FILE,
            fieldId: entry.fieldId,
            accept: desc.accept || ''
          });
          return reply && reply.file ? reply.file : null;
        }
      });

      entry.outcome = res.outcome;
      entry.reason = res.detail;
      if (res.outcome === OUTCOME.FILLED && entry.memoryId) usedMemory.push(entry.memoryId);
      results.push(summarize(entry, res.outcome, res.detail));
      paint(entry, res.outcome);
    }

    state.lastResults = results;
    const counts = tally(results);

    // Awaited so a caller that resolves on `fill` knows the tracker has already
    // been updated - otherwise a fill that finishes and a tracker that has not
    // caught up look identical from outside.
    await safeSend({
      type: MSG.FILL_RESULT,
      frameUrl: location.href,
      counts,
      results,
      meta: state.meta,
      usedMemory
    });

    renderOverlay(counts, results, ctxData.settings);
    return { ok: true, counts, results };
  } finally {
    state.filling = false;
  }
}

function summarize(entry, outcome, detail) {
  return {
    key: entry.key,
    fieldId: entry.fieldId,
    source: entry.source,
    confidence: entry.confidence,
    label: entry.desc.label,
    kind: entry.desc.kind,
    required: entry.desc.required,
    value: entry.fieldId && entry.desc.kind !== 'file' ? maskIfSensitive(entry) : entry.value,
    outcome,
    detail: detail || ''
  };
}

function maskIfSensitive(entry) {
  return entry.value;
}

function paint(entry, outcome) {
  const el = entry.desc.el;
  if (outcome === OUTCOME.FILLED) overlay.ring(el, 'ok');
  else if (outcome === OUTCOME.FAILED) overlay.ring(el, 'err');
  else if (outcome === OUTCOME.UNVERIFIED || outcome === OUTCOME.UNRESOLVED) overlay.ring(el, 'warn');
}

function tally(results) {
  const counts = { filled: 0, attention: 0, unresolved: 0, skipped: 0, total: results.length };
  for (const r of results) {
    if (r.outcome === OUTCOME.FILLED) counts.filled++;
    else if (r.outcome === OUTCOME.UNRESOLVED) counts.unresolved++;
    else if (r.outcome === OUTCOME.SKIPPED || r.outcome === OUTCOME.SENSITIVE) counts.skipped++;
    else counts.attention++;
  }
  return counts;
}

function renderOverlay(counts, results, settings) {
  const items = results
    .filter((r) => (
      r.outcome === OUTCOME.UNVERIFIED
      || r.outcome === OUTCOME.FAILED
      || (r.outcome === OUTCOME.UNRESOLVED && r.required)
      || (r.outcome === OUTCOME.UNRESOLVED && settings.learnUnknownFields)
    ))
    .slice(0, 25)
    .map((r) => ({
      key: r.key,
      label: r.label,
      detail: r.detail,
      outcome: r.outcome,
      kind: r.kind,
      teachable: r.kind !== 'file'
    }));

  overlay.mount({
    onJump: (key) => {
      const entry = state.plan.find((e) => e.key === key);
      if (entry) overlay.flashFocus(entry.desc.el);
    },
    onTeach: async (key, question, answer, kind) => {
      await safeSend({ type: MSG.LEARN_ANSWER, question, answer, kind });
      const entry = state.plan.find((e) => e.key === key);
      if (entry) {
        entry.value = answer;
        entry.outcome = null;
        await doFill({ only: key });
      }
    },
    onRefill: () => doFill({})
  });

  overlay.update({
    counts,
    items,
    note: counts.filled
      ? 'Review every field, then submit the form yourself.'
      : 'Nothing matched your profile on this page.'
  });
}

// ---------------------------------------------------------------------------
// Submission detection (for the tracker - applyr never clicks submit itself)
// ---------------------------------------------------------------------------

function watchSubmit() {
  if (state.submitWatched) return;
  state.submitWatched = true;

  const report = (how) => {
    safeSend({
      type: MSG.SUBMIT_DETECTED,
      meta: state.meta || readMeta(),
      counts: tally(state.lastResults || []),
      how
    });
  };

  document.addEventListener('submit', () => report('form-submit'), true);

  document.addEventListener('click', (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [ev.target];
    const selectors = packSubmitSelectors(state.pack);
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      for (const sel of selectors) {
        try {
          if (node.matches(sel)) {
            report('button-click');
            return;
          }
        } catch {
          /* ignore */
        }
      }
      const txt = (node.textContent || '').trim().toLowerCase();
      if (node.tagName === 'BUTTON' && /^(submit|submit application|apply|send application)$/.test(txt)) {
        report('button-text');
        return;
      }
    }
  }, true);
}

/** A confirmation screen is stronger evidence than a click. */
function checkConfirmation() {
  const selectors = packConfirmSelectors(state.pack);
  for (const sel of selectors) {
    try {
      if (document.querySelector(sel)) {
        safeSend({ type: MSG.SUBMIT_DETECTED, meta: state.meta || readMeta(), how: 'confirmation', confirmed: true });
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  const text = (document.body?.innerText || '').slice(0, 1500);
  if (/thank you for (applying|your application)|application (was )?(received|submitted)/i.test(text)) {
    safeSend({ type: MSG.SUBMIT_DETECTED, meta: state.meta || readMeta(), how: 'confirmation-text', confirmed: true });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

async function safeSend(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    // Worker asleep or extension reloading - not fatal for the page.
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case MSG.PING:
        sendResponse({ ok: true, fields: state.descriptors.length, pack: state.pack?.id || null });
        break;
      case MSG.SCAN:
        sendResponse(await doScan({ announce: false }));
        break;
      case MSG.FILL:
        sendResponse(await doFill({}));
        break;
      case MSG.FILL_ONE:
        sendResponse(await doFill({ only: msg.key }));
        break;
      case MSG.HIGHLIGHT: {
        const entry = state.plan.find((e) => e.key === msg.key);
        if (entry) overlay.flashFocus(entry.desc.el);
        sendResponse({ ok: Boolean(entry) });
        break;
      }
      case MSG.CLEAR_HIGHLIGHT:
        overlay.clearRings();
        overlay.unmount();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let rescanTimer = null;
function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(async () => {
    const before = state.descriptors.length;
    const res = await doScan({ announce: true });
    if (res && res.isApplication) checkConfirmation();
    // Multi-step wizards swap the whole form out; a big change is worth a
    // fresh auto-fill when the user asked for that.
    if (res && res.fieldCount && Math.abs(res.fieldCount - before) > 2) {
      const ctxData = await safeSend({ type: MSG.NEED_VALUES });
      if (ctxData && ctxData.ok && ctxData.settings.autoFillOnLoad && res.isApplication) {
        doFill({});
      }
    }
  }, 700);
}

function boot() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    return;
  }

  doScan({ announce: true }).then(async (res) => {
    if (!res) return;
    checkConfirmation();
    if (!res.isApplication) return;
    const ctxData = await safeSend({ type: MSG.NEED_VALUES });
    if (ctxData && ctxData.ok && ctxData.settings.autoFillOnLoad) doFill({});
  });

  const mo = new MutationObserver((records) => {
    // Ignore our own overlay mutations.
    for (const r of records) {
      if (r.target && r.target.id === 'applyr-hud-host') return;
    }
    scheduleRescan();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // SPA route changes (Workday, Ashby) do not reload the document.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      state.pack = null;
      state.submitWatched = false;
      scheduleRescan();
    }
  }, 1000);
}

boot();
