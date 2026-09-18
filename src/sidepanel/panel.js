/** Side-panel shell: loads state, renders the active view, keeps itself in sync. */

import { h, toast } from './ui.js';
import { MSG } from '../core/messages.js';
import * as fillView from './views/fill.js';
import * as profileView from './views/profile.js';
import * as documentsView from './views/documents.js';
import * as memoryView from './views/memory.js';
import * as applicationsView from './views/applications.js';
import * as settingsView from './views/settings.js';

const VIEWS = [
  { id: 'fill', label: 'This page', mod: fillView },
  { id: 'profile', label: 'Profile', mod: profileView },
  { id: 'documents', label: 'Documents', mod: documentsView },
  { id: 'memory', label: 'Answers', mod: memoryView },
  { id: 'applications', label: 'Applications', mod: applicationsView },
  { id: 'settings', label: 'Settings', mod: settingsView }
];

const state = {
  view: 'fill',
  tabId: null,
  activeUrl: '',
  profile: null,
  files: [],
  memory: [],
  applications: [],
  sites: {},
  tab: null
};

const api = {
  get tabId() {
    return state.tabId;
  },
  send: (msg) => chrome.runtime.sendMessage(msg).catch((err) => ({ ok: false, error: err.message })),
  refresh: () => load(),
  setView: (id) => {
    state.view = id;
    renderTabs();
    renderView();
  }
};

// ---------------------------------------------------------------------------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function load() {
  const tab = await activeTab();
  state.tabId = tab ? tab.id : null;
  state.activeUrl = tab ? tab.url || '' : '';

  const res = await api.send({ type: MSG.GET_STATE, tabId: state.tabId });
  if (!res || !res.ok) {
    toast(res?.error || 'Could not reach the extension worker');
    return;
  }
  Object.assign(state, {
    profile: res.profile,
    files: res.files,
    memory: res.memory,
    applications: res.applications,
    sites: res.sites,
    tab: res.tab
  });
  renderView();
}

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.textContent = '';
  for (const v of VIEWS) {
    nav.append(h('button', {
      role: 'tab',
      'aria-selected': String(v.id === state.view),
      onclick: () => api.setView(v.id)
    }, v.label));
  }
}

function renderView() {
  const host = document.getElementById('view');
  if (!state.profile) {
    host.textContent = '';
    host.append(h('div', { class: 'empty' }, 'Loading…'));
    return;
  }
  const def = VIEWS.find((v) => v.id === state.view) || VIEWS[0];
  const scrollTop = host.scrollTop;
  host.textContent = '';
  try {
    host.append(def.mod.render(state, api));
  } catch (err) {
    host.append(h('div', { class: 'empty' }, `View error: ${err.message}`));
    console.error('[applyr] view crashed', err);
  }
  host.scrollTop = scrollTop;
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.SCAN_UPDATED && msg.tabId === state.tabId) {
    state.tab = msg.state;
    if (state.view === 'fill') renderView();
  }
  if (msg.type === MSG.STATE_CHANGED) load();
});

chrome.tabs.onActivated.addListener(load);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === state.tabId && info.status === 'complete') load();
});

renderTabs();
load();
