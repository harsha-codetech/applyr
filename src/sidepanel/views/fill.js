/** "This page" view - status of the active tab, the fill button, and the audit list. */

import { h, card, toast, relTime } from '../ui.js';
import { MSG, OUTCOME } from '../../core/messages.js';
import { missingCoreFields, completeness } from '../../core/schema.js';
import { fieldLabel } from '../../core/taxonomy.js';

const OUTCOME_PILL = {
  [OUTCOME.FILLED]: ['ok', 'filled'],
  [OUTCOME.UNVERIFIED]: ['warn', 'check'],
  [OUTCOME.FAILED]: ['err', 'failed'],
  [OUTCOME.UNRESOLVED]: ['neutral', 'unknown'],
  [OUTCOME.SKIPPED]: ['neutral', 'skipped'],
  [OUTCOME.SENSITIVE]: ['neutral', 'opt-in off']
};

export function render(state, api) {
  const root = h('div', {});
  const tab = state.tab;
  const pageUrl = state.activeUrl || '';

  // -- profile readiness ----------------------------------------------------
  const missing = missingCoreFields(state.profile);
  const pct = Math.round(completeness(state.profile) * 100);

  if (missing.length) {
    root.append(card('Finish your profile', [
      h('div', { class: 'row spread' }, [
        h('span', { class: 'small' }, `${pct}% complete`),
        h('button', { class: 'link', onclick: () => api.setView('profile') }, 'Open profile')
      ]),
      h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'small muted' },
        `Still needed: ${missing.map(fieldLabel).join(', ')}`)
    ]));
  }

  // -- page status ----------------------------------------------------------
  if (!pageUrl || /^chrome(-extension)?:/.test(pageUrl)) {
    root.append(card('This page', h('div', { class: 'empty' }, 'Open a job application to get started.')));
    return root;
  }

  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch { /* opaque */ }

  if (!tab) {
    root.append(card('This page', [
      h('div', { class: 'small muted', style: 'margin-bottom:10px' },
        'applyr is not running on this site yet.'),
      h('div', { class: 'small', style: 'margin-bottom:10px' }, origin),
      h('button', {
        class: 'btn wide',
        onclick: async (ev) => {
          // permissions.request must be called from the click itself.
          let granted = false;
          try {
            granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
          } catch (err) {
            toast(err.message);
            return;
          }
          if (!granted) {
            toast('Access declined');
            return;
          }
          ev.target.disabled = true;
          await chrome.tabs.reload(api.tabId);
          toast('Access granted - reloading page');
          setTimeout(api.refresh, 1200);
        }
      }, 'Enable applyr on this site'),
      h('div', { class: 'small muted', style: 'margin-top:8px' },
        'Access is per-site and you can revoke it any time from Chrome’s extension settings.')
    ]));
    return root;
  }

  const counts = tab.counts;
  const packLine = tab.pack
    ? `${tab.packName} pack`
    : 'Generic mode — no pack for this site yet';

  root.append(card('This page', [
    h('div', { class: 'row spread' }, [
      h('div', {}, [
        h('div', { class: 'title' }, tab.meta?.role || 'Unrecognised page'),
        h('div', { class: 'small muted' }, tab.meta?.company || origin)
      ]),
      tab.isApplication
        ? h('span', { class: 'pill ok' }, 'application')
        : h('span', { class: 'pill neutral' }, 'no form found')
    ]),
    h('div', { class: 'small muted', style: 'margin-top:8px' },
      `${tab.fieldCount} fields · ${packLine}`),
    h('button', {
      class: 'btn wide',
      style: 'margin-top:10px',
      disabled: !tab.fieldCount,
      onclick: async (ev) => {
        ev.target.disabled = true;
        ev.target.textContent = 'Filling…';
        const res = await api.send({ type: MSG.TRIGGER_FILL, tabId: api.tabId });
        ev.target.disabled = false;
        ev.target.textContent = 'Fill this form';
        if (!res?.result?.ok) {
          toast(res?.result?.reason || 'Could not fill this page');
        } else {
          toast(`Filled ${res.result.counts.filled} fields`);
        }
        api.refresh();
      }
    }, 'Fill this form'),
    h('div', { class: 'small muted', style: 'margin-top:8px; text-align:center' },
      'applyr never submits — you review and click Submit.')
  ]));

  // -- results --------------------------------------------------------------
  if (counts) {
    root.append(card('Result', [
      h('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' }, [
        counts.filled ? h('span', { class: 'pill ok' }, `${counts.filled} filled`) : null,
        counts.attention ? h('span', { class: 'pill warn' }, `${counts.attention} need a check`) : null,
        counts.unresolved ? h('span', { class: 'pill neutral' }, `${counts.unresolved} unknown`) : null,
        counts.skipped ? h('span', { class: 'pill neutral' }, `${counts.skipped} skipped`) : null
      ]),
      tab.submitted ? h('div', { class: 'small', style: 'margin-top:8px' },
        h('span', { class: 'pill ok' }, 'submission detected')) : null,
      h('div', { class: 'small muted', style: 'margin-top:6px' }, relTime(new Date(tab.updatedAt).toISOString()))
    ]));

    const interesting = (tab.results || []).filter((r) => r.outcome !== OUTCOME.SKIPPED);
    if (interesting.length) {
      root.append(card('Fields', h('div', { class: 'list' }, interesting.map((r) => renderResult(r, api)))));
    }
  }

  return root;
}

function renderResult(r, api) {
  const [pillClass, pillText] = OUTCOME_PILL[r.outcome] || ['neutral', r.outcome];
  return h('div', { class: 'item' }, [
    h('div', { class: 'row spread' }, [
      h('div', { class: 'title small' }, r.label || '(unlabelled)'),
      h('span', { class: `pill ${pillClass}` }, pillText)
    ]),
    r.fieldId
      ? h('div', { class: 'small muted' }, `${fieldLabel(r.fieldId)} · via ${r.source}`)
      : null,
    r.detail ? h('div', { class: 'small muted' }, r.detail) : null,
    h('button', {
      class: 'link',
      onclick: () => chrome.tabs.sendMessage(api.tabId, { type: MSG.HIGHLIGHT, key: r.key }).catch(() => {})
    }, 'Show on page')
  ]);
}
