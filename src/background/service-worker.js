/**
 * Service worker: the only place that touches storage, and the router between
 * the content scripts and the side panel.
 *
 * MV3 tears this worker down after ~30s idle and restarts it with a clean V8
 * context, so nothing durable lives in module scope - per-tab state goes to
 * chrome.storage.session, everything else to chrome.storage.local.
 */

import { MSG, OUTCOME } from '../core/messages.js';
import { profileToValues } from '../core/schema.js';
import * as store from '../core/storage.js';
import { bufToBase64 } from '../core/util.js';
import { DEFAULT_PACK_URL, MIN_CHECK_INTERVAL_MS, fetchPackBundle } from '../core/pack-source.js';
import { REMOTE_PACKS_KEY, invalidatePackCache } from '../core/packs.js';

// ---------------------------------------------------------------------------
// Per-tab state (survives worker restarts)
// ---------------------------------------------------------------------------

const tabKey = (tabId) => `tab:${tabId}`;

async function getTabState(tabId) {
  const out = await chrome.storage.session.get(tabKey(tabId));
  return out[tabKey(tabId)] || null;
}

async function setTabState(tabId, patch) {
  const prev = (await getTabState(tabId)) || {};
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ [tabKey(tabId)]: next });
  notifyPanel({ type: MSG.SCAN_UPDATED, tabId, state: next });
  return next;
}

function notifyPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* panel is closed - fine */
  });
}

async function setBadge(tabId, counts) {
  if (!counts) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const text = counts.filled ? String(counts.filled) : '';
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: counts.attention ? '#d97706' : '#16a34a' });
}

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    /* older Chrome */
  }
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/welcome.html') });
  }
  await registerDynamicScripts();
  await maybeUpdatePacks();
});

chrome.runtime.onStartup.addListener(async () => {
  await registerDynamicScripts();
  await maybeUpdatePacks();
});

/**
 * Sites the user granted access to at runtime need their content script
 * registered explicitly - the manifest only covers the bundled ATS domains.
 */
async function registerDynamicScripts() {
  const perms = await chrome.permissions.getAll();
  const origins = (perms.origins || []).filter((o) => o !== '*://*/*');
  if (!origins.length) return;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['applyr-dynamic'] });
    const config = {
      id: 'applyr-dynamic',
      matches: origins,
      js: ['src/content/loader.js'],
      css: ['src/content/overlay.css'],
      allFrames: true,
      runAt: 'document_idle'
    };
    if (existing.length) await chrome.scripting.updateContentScripts([config]);
    else await chrome.scripting.registerContentScripts([config]);
  } catch (err) {
    console.warn('[applyr] dynamic registration failed', err);
  }
}

chrome.permissions.onAdded.addListener(registerDynamicScripts);
chrome.permissions.onRemoved.addListener(registerDynamicScripts);

// ---------------------------------------------------------------------------
// Keyboard command
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) fillTab(tab.id);
});

async function fillTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: MSG.FILL });
  } catch {
    return { ok: false, reason: 'applyr is not running on this page' };
  }
}

async function scanTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: MSG.SCAN });
  } catch {
    return null;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId));
});

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

/** Pick which stored document belongs in a given file slot. */
async function resolveFileFor(fieldId) {
  const profile = await store.getProfile();
  const files = await store.listFiles();
  if (!files.length) return null;

  const wantKind = fieldId === 'cover_letter_file' ? 'cover'
    : fieldId === 'other_file' ? 'other'
      : 'resume';

  let meta = null;
  if (wantKind === 'resume' && profile.settings.defaultResumeId) {
    meta = files.find((f) => f.id === profile.settings.defaultResumeId) || null;
  }
  if (!meta) meta = files.find((f) => f.kind === wantKind) || null;
  if (!meta && wantKind === 'resume') meta = files[0];
  if (!meta) return null;

  const rec = await store.getFile(meta.id);
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    data: bufToBase64(rec.bytes)
  };
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

async function logApplication(meta, { status, counts }) {
  if (!meta || !meta.url) return null;
  const profile = await store.getProfile();

  // Only send the keys we actually know: upsertApplicationByUrl merges onto the
  // existing row, so omitting an empty company keeps whatever was learned
  // earlier rather than blanking it. The find-and-write is atomic there, which
  // matters because every frame of a page reports independently.
  const patch = { url: meta.url, status, resumeId: profile.settings.defaultResumeId || null };
  if (meta.company) patch.company = meta.company;
  if (meta.role) patch.role = meta.role;
  if (meta.ats) patch.ats = meta.ats;
  if (counts) patch.fieldsFilled = counts.filled;

  const list = await store.upsertApplicationByUrl(patch);
  notifyPanel({ type: MSG.STATE_CHANGED, what: 'applications' });
  return list;
}

// ---------------------------------------------------------------------------
// Remote selector packs
//
// Off unless the user turns it on, and gated behind its own host permission.
// Everything fetched is validated by core/pack-source.js before it is stored;
// a bundle that fails is discarded whole and the bundled packs keep working.
// ---------------------------------------------------------------------------

function packUrlFor(settings) {
  const custom = (settings.packUrl || '').trim();
  return custom || DEFAULT_PACK_URL;
}

async function packStatus() {
  const profile = await store.getProfile();
  const url = packUrlFor(profile.settings);
  const out = await chrome.storage.local.get(REMOTE_PACKS_KEY);
  const stored = out[REMOTE_PACKS_KEY] || null;
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [url] });
  } catch {
    /* malformed custom url */
  }
  return {
    enabled: Boolean(profile.settings.packUpdates),
    url,
    granted,
    count: stored ? stored.count : 0,
    updated: stored ? stored.updated : null,
    fetchedAt: stored ? stored.fetchedAt : null,
    lastError: stored ? stored.lastError || null : null,
    ids: stored && Array.isArray(stored.packs) ? stored.packs.map((p) => p.id) : []
  };
}

async function updatePacks({ force = false } = {}) {
  const profile = await store.getProfile();
  if (!profile.settings.packUpdates && !force) {
    return { ok: false, reason: 'Pack updates are off' };
  }
  const url = packUrlFor(profile.settings);

  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [url] });
  } catch {
    return { ok: false, reason: 'That pack URL is not a valid origin' };
  }
  if (!granted) {
    return { ok: false, reason: 'Permission for the pack source has not been granted', needsPermission: url };
  }

  const prev = (await chrome.storage.local.get(REMOTE_PACKS_KEY))[REMOTE_PACKS_KEY] || null;
  if (!force && prev && prev.fetchedAt && Date.now() - prev.fetchedAt < MIN_CHECK_INTERVAL_MS) {
    return { ok: true, skipped: 'checked recently', ...(await packStatus()) };
  }

  try {
    const { packs, updated, count } = await fetchPackBundle(url);
    await chrome.storage.local.set({
      [REMOTE_PACKS_KEY]: { packs, updated, count, url, fetchedAt: Date.now(), lastError: null }
    });
    invalidatePackCache();
    notifyPanel({ type: MSG.STATE_CHANGED, what: 'packs' });
    return { ok: true, ...(await packStatus()) };
  } catch (err) {
    // Keep whatever was already validated and stored; only record why.
    await chrome.storage.local.set({
      [REMOTE_PACKS_KEY]: { ...(prev || { packs: [], count: 0 }), url, lastError: err.message, checkedAt: Date.now() }
    });
    return { ok: false, reason: err.message, ...(await packStatus()) };
  }
}

/** Opportunistic check when the worker wakes. No alarms permission needed. */
async function maybeUpdatePacks() {
  try {
    const profile = await store.getProfile();
    if (profile.settings.packUpdates) await updatePacks({});
  } catch {
    /* never let this break startup */
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((res) => sendResponse(res === undefined ? { ok: true } : res))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;

  switch (msg.type) {
    // ---- from content scripts -------------------------------------------
    case MSG.SCAN_RESULT: {
      if (tabId == null) return { ok: false };
      await setTabState(tabId, {
        url: msg.frameUrl,
        isApplication: msg.isApplication,
        fieldCount: msg.fieldCount,
        pack: msg.pack,
        packName: msg.packName,
        via: msg.via,
        meta: msg.meta,
        step: msg.step,
        board: msg.board,
        listings: msg.listings
      });
      return { ok: true };
    }

    case MSG.NEED_VALUES: {
      const profile = await store.getProfile();
      const memory = await store.allMemory();
      const values = Object.fromEntries(
        profileToValues(profile, { includeSensitive: profile.settings.fillSensitive })
      );
      return { ok: true, values, memory, settings: profile.settings };
    }

    case MSG.NEED_FILE: {
      const file = await resolveFileFor(msg.fieldId);
      return { ok: true, file };
    }

    case MSG.LEARN_ANSWER: {
      await store.rememberAnswer({
        question: msg.question,
        answer: msg.answer,
        type: msg.kind || 'text'
      });
      notifyPanel({ type: MSG.STATE_CHANGED, what: 'memory' });
      return { ok: true };
    }

    case MSG.FILL_RESULT: {
      if (tabId != null) {
        await setTabState(tabId, { counts: msg.counts, results: msg.results, meta: msg.meta });
        await setBadge(tabId, msg.counts);
      }
      if (msg.usedMemory && msg.usedMemory.length) await store.bumpMemoryUses(msg.usedMemory);
      if (msg.meta && msg.meta.url) {
        try {
          const host = new URL(msg.meta.url).hostname;
          await store.recordSiteRun(host, {
            filled: msg.counts.filled,
            skipped: msg.counts.skipped,
            failed: msg.counts.attention,
            unresolved: msg.counts.unresolved
          });
        } catch {
          /* opaque url */
        }
      }
      if (msg.counts && msg.counts.filled > 0) {
        await logApplication(msg.meta, { status: 'filled', counts: msg.counts });
      }
      return { ok: true };
    }

    case MSG.SUBMIT_DETECTED: {
      await logApplication(msg.meta, { status: 'submitted', counts: msg.counts });
      if (tabId != null) await setTabState(tabId, { submitted: true });
      return { ok: true };
    }

    // ---- from the side panel --------------------------------------------
    case MSG.GET_STATE: {
      const [profile, files, memory, applications, sites] = await Promise.all([
        store.getProfile(), store.listFiles(), store.allMemory(),
        store.listApplications(), store.siteStats()
      ]);
      const tab = msg.tabId != null ? await getTabState(msg.tabId) : null;
      return { ok: true, profile, files, memory, applications, sites, tab };
    }

    case MSG.SAVE_PROFILE:
      return { ok: true, profile: await store.saveProfile(msg.profile) };

    case MSG.PATCH_VALUES:
      return { ok: true, profile: await store.patchProfileValues(msg.patch) };

    case MSG.PATCH_SETTINGS:
      return { ok: true, profile: await store.patchSettings(msg.patch) };

    case MSG.ADD_FILE: {
      const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)).buffer;
      const meta = await store.addFile({
        name: msg.name, type: msg.mime, kind: msg.kind, label: msg.label, bytes
      });
      const files = await store.listFiles();
      const profile = await store.getProfile();
      if (meta.kind === 'resume' && !profile.settings.defaultResumeId) {
        await store.patchSettings({ defaultResumeId: meta.id });
      }
      return { ok: true, files };
    }

    case MSG.LIST_FILES:
      return { ok: true, files: await store.listFiles() };

    case MSG.DELETE_FILE:
      await store.deleteFile(msg.id);
      return { ok: true, files: await store.listFiles() };

    case MSG.LIST_MEMORY:
      return { ok: true, memory: await store.allMemory() };

    case MSG.SAVE_MEMORY:
      return { ok: true, memory: await store.rememberAnswer(msg.entry) };

    case MSG.UPDATE_MEMORY:
      return { ok: true, memory: await store.updateMemory(msg.id, msg.patch) };

    case MSG.DELETE_MEMORY:
      return { ok: true, memory: await store.deleteMemory(msg.id) };

    case MSG.LIST_APPS:
      return { ok: true, applications: await store.listApplications() };

    case MSG.SAVE_APP:
      return { ok: true, applications: await store.upsertApplication(msg.app) };

    case MSG.DELETE_APP:
      return { ok: true, applications: await store.deleteApplication(msg.id) };

    case MSG.EXPORT_ALL:
      return { ok: true, bundle: await store.exportAll({ includeFiles: msg.includeFiles !== false }) };

    case MSG.IMPORT_ALL:
      await store.importAll(msg.bundle, { merge: msg.merge });
      return { ok: true };

    case MSG.WIPE_ALL:
      await store.wipeAll();
      invalidatePackCache();
      return { ok: true };

    case MSG.PACK_STATUS:
      return { ok: true, status: await packStatus() };

    case MSG.UPDATE_PACKS:
      return updatePacks({ force: msg.force === true });

    case MSG.CLEAR_REMOTE_PACKS: {
      await chrome.storage.local.remove(REMOTE_PACKS_KEY);
      invalidatePackCache();
      return { ok: true, status: await packStatus() };
    }

    case MSG.SITE_ACCESS_STATUS: {
      const granted = await chrome.permissions.contains({ origins: [msg.origin] });
      return { ok: true, granted };
    }

    case MSG.TRIGGER_SCAN:
      return { ok: true, result: await scanTab(msg.tabId) };

    case MSG.TRIGGER_FILL:
      return { ok: true, result: await fillTab(msg.tabId) };

    default:
      return { ok: false, error: `unknown message: ${msg.type}` };
  }
}

// Surfaced for debugging from the worker console, and used by scripts/e2e.js -
// a service worker cannot sendMessage to itself, so these are the only way to
// exercise the router's own handlers from inside it.
globalThis.__applyr = { OUTCOME, store, packs: { status: packStatus, update: updatePacks } };
