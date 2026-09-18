/**
 * Assisted mode - ranks the job cards already on the page the user is viewing.
 *
 * Scoring happens here rather than in the content script so it re-runs whenever
 * the profile changes, and so the content script stays read-only and dumb.
 */

import { h, card, toast } from '../ui.js';
import { MSG } from '../../core/messages.js';
import { rankListings, matchLabel } from '../../core/matching.js';
import { profileToValues } from '../../core/schema.js';

const PILL = { strong: 'ok', 'worth a look': 'warn', weak: 'neutral', poor: 'neutral' };

export function render(state, api) {
  const root = h('div', {});
  const tab = state.tab;
  const listings = (tab && tab.listings) || [];

  if (!tab || !tab.board) {
    root.append(card('Assisted mode', [
      h('div', { class: 'small muted' },
        'Open a supported job board and applyr will rank the jobs already on the page '
        + 'against your profile. It reads only what you are looking at — it never '
        + 'searches, paginates or browses on your behalf.'),
      h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Supported: Naukri.')
    ]));
    return root;
  }

  if (!listings.length) {
    root.append(card(tab.board.name, h('div', { class: 'empty small' },
      'No job cards on this page yet. Scroll or run a search and applyr will pick them up.')));
    return root;
  }

  const values = Object.fromEntries(profileToValues(state.profile));
  const ranked = rankListings(listings, values);

  if (!values.skills) {
    root.append(card('Add your skills', [
      h('div', { class: 'small muted' },
        'Ranking leans mostly on skills. Add a comma-separated list under Profile → Work '
        + 'and these scores get a lot more useful.'),
      h('button', {
        class: 'btn ghost wide', style: 'margin-top:8px',
        onclick: () => api.setView('profile')
      }, 'Open profile')
    ]));
  }

  const strong = ranked.filter((r) => r.match.score >= 0.55).length;
  root.append(card(`${tab.board.name} — ${ranked.length} jobs on this page`, [
    h('div', { class: 'small muted' },
      strong
        ? `${strong} worth a look, ranked against your profile.`
        : 'Nothing here scores well against your profile.'),
    h('div', { class: 'small muted', style: 'margin-top:6px' },
      'applyr does not apply through job boards. Open a posting, and where it leads to '
      + 'the employer’s own form applyr fills that.')
  ]));

  root.append(h('div', { class: 'list' }, ranked.map((job) => renderJob(job, api))));
  return root;
}

function renderJob(job, api) {
  const label = matchLabel(job.match.score);
  return h('div', { class: 'item' }, [
    h('div', { class: 'row spread' }, [
      h('div', { style: 'min-width:0' }, [
        h('div', { class: 'title small' }, job.title),
        h('div', { class: 'small muted' }, [
          job.company,
          job.location ? ` · ${job.location}` : '',
          job.experience ? ` · ${job.experience}` : ''
        ].filter(Boolean).join(''))
      ]),
      h('span', { class: `pill ${PILL[label] || 'neutral'} mono` }, `${Math.round(job.match.score * 100)}`)
    ]),
    job.salary ? h('div', { class: 'small muted', style: 'margin-top:2px' }, job.salary) : null,
    job.match.reasons.length
      ? h('div', { class: 'small muted', style: 'margin-top:4px' }, job.match.reasons.join(' · '))
      : null,
    h('div', { class: 'row', style: 'margin-top:6px; gap:12px' }, [
      h('button', {
        class: 'link',
        onclick: async () => {
          await chrome.tabs.create({ url: job.url, active: true });
          toast('Opened - applyr will fill the employer form if it reaches one');
        }
      }, 'Open posting'),
      job.posted ? h('span', { class: 'small muted' }, job.posted) : null,
      h('span', { class: 'small muted', style: 'margin-left:auto' }, label)
    ])
  ]);
}
