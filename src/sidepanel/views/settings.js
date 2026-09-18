/** Settings, backup and the coverage report that tells you which site needs a pack. */

import { h, card, toast, confirmInline, relTime } from '../ui.js';
import { MSG } from '../../core/messages.js';
import { download } from './applications.js';

export function render(state, api) {
  const root = h('div', {});
  const s = state.profile.settings;

  const toggle = (key, label, hint) => h('label', { class: 'row', style: 'align-items:flex-start; gap:8px; margin-bottom:12px' }, [
    h('input', {
      type: 'checkbox',
      checked: s[key],
      style: 'margin-top:3px',
      onchange: async (e) => {
        await api.send({ type: MSG.PATCH_SETTINGS, patch: { [key]: e.target.checked } });
        toast('Saved');
        api.refresh();
      }
    }),
    h('div', {}, [
      h('div', { style: 'font-weight:600' }, label),
      hint ? h('div', { class: 'small muted' }, hint) : null
    ])
  ]);

  root.append(card('Filling', [
    toggle('autoFillOnLoad', 'Fill automatically',
      'Fill as soon as a recognised application page loads, instead of waiting for the button.'),
    toggle('overwriteExisting', 'Overwrite fields that already have a value',
      'Off by default so applyr never clobbers something you typed.'),
    toggle('highlightFilled', 'Ring the fields applyr touched',
      'Green for verified, amber for anything worth a second look.'),
    toggle('learnUnknownFields', 'Offer to learn unknown questions',
      'Shows a "Teach answer" prompt for fields applyr could not place.')
  ]));

  root.append(card('Demographic questions', [
    toggle('fillSensitive', 'Fill demographic fields',
      'Gender, race, veteran and disability questions, plus date of birth. Off by default: '
      + 'these are protected characteristics and many people prefer to answer them by hand, '
      + 'or not at all. Nothing is guessed - only the values you entered yourself are used.')
  ]));

  // -- coverage report -------------------------------------------------------
  const sites = Object.entries(state.sites || {})
    .sort((a, b) => b[1].runs - a[1].runs)
    .slice(0, 12);

  if (sites.length) {
    root.append(card('Coverage', [
      h('div', { class: 'small muted', style: 'margin-bottom:8px' },
        'Where applyr does well, and where a selector pack would help.'),
      h('div', { class: 'list' }, sites.map(([host, st]) => {
        const total = st.filled + st.unresolved + st.failed || 1;
        const pct = Math.round((st.filled / total) * 100);
        return h('div', { class: 'item' }, [
          h('div', { class: 'row spread' }, [
            h('span', { class: 'small' }, host),
            h('span', { class: `pill ${pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'err'} mono` }, `${pct}%`)
          ]),
          h('div', { class: 'bar', style: 'margin-top:5px' }, h('i', { style: `width:${pct}%` })),
          h('div', { class: 'small muted', style: 'margin-top:4px' },
            `${st.runs} run${st.runs === 1 ? '' : 's'} · ${st.filled} filled · ${st.unresolved} unknown`)
        ]);
      }))
    ]));
  }

  // -- selector packs --------------------------------------------------------
  root.append(renderPackUpdates(state, api));

  // -- backup ----------------------------------------------------------------
  const importer = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
    onchange: async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const bundle = JSON.parse(await file.text());
        const res = await api.send({ type: MSG.IMPORT_ALL, bundle, merge: true });
        if (!res.ok) throw new Error(res.error);
        toast('Imported');
        api.refresh();
      } catch (err) {
        toast(`Import failed: ${err.message}`);
      }
    }
  });

  root.append(card('Your data', [
    h('div', { class: 'small muted', style: 'margin-bottom:10px' },
      'Everything applyr knows lives in this browser profile. There is no server and no account, '
      + 'which also means there is no backup but the one you make here.'),
    h('div', { class: 'row', style: 'gap:8px' }, [
      h('button', {
        class: 'btn ghost',
        onclick: async () => {
          const res = await api.send({ type: MSG.EXPORT_ALL, includeFiles: true });
          if (!res.ok) {
            toast('Export failed');
            return;
          }
          download(
            `applyr-backup-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(res.bundle, null, 2),
            'application/json'
          );
          toast('Exported');
        }
      }, 'Export everything'),
      h('button', { class: 'btn ghost', onclick: () => importer.click() }, 'Import backup')
    ]),
    importer,
    h('button', {
      class: 'btn danger wide',
      style: 'margin-top:12px',
      onclick: (ev) => confirmInline(ev.target, 'Erase everything? Click again', async () => {
        await api.send({ type: MSG.WIPE_ALL });
        toast('All data erased');
        api.refresh();
      })
    }, 'Erase all data')
  ]));

  root.append(renderAbout());
  return root;
}

/**
 * Pack updates.
 *
 * The one feature that can make a network request, so the card is explicit
 * about what leaves the device (nothing about you) and what arrives (CSS
 * selectors, validated before use).
 */
function renderPackUpdates(state, api) {
  const body = h('div', {}, h('div', { class: 'small muted' }, 'Checking…'));
  const wrap = card('Selector packs', body);

  const draw = (status) => {
    body.textContent = '';
    const s = status || {};

    body.append(h('div', { class: 'small muted', style: 'margin-bottom:10px' },
      'When an ATS redesigns, its selectors break and applyr stops filling that site. '
      + 'With this on, applyr refreshes them from a static file instead of waiting for '
      + 'a store update.'));

    body.append(h('label', { class: 'row', style: 'align-items:flex-start; gap:8px; margin-bottom:10px' }, [
      h('input', {
        type: 'checkbox',
        checked: s.enabled,
        style: 'margin-top:3px',
        onclick: async (ev) => {
          const on = ev.target.checked;
          if (on) {
            // permissions.request must run inside the click.
            let granted = false;
            try {
              granted = await chrome.permissions.request({ origins: [s.url] });
            } catch (err) {
              ev.target.checked = false;
              toast(err.message);
              return;
            }
            if (!granted) {
              ev.target.checked = false;
              toast('Access to the pack source was declined');
              return;
            }
          }
          await api.send({ type: MSG.PATCH_SETTINGS, patch: { packUpdates: on } });
          if (on) await api.send({ type: MSG.UPDATE_PACKS, force: true });
          toast(on ? 'Pack updates on' : 'Pack updates off');
          refresh();
        }
      }),
      h('div', {}, [
        h('div', { style: 'font-weight:600' }, 'Keep selector packs up to date'),
        h('div', { class: 'small muted' },
          'Off by default. With it off, applyr makes no network requests at all. '
          + 'With it on, it fetches one static JSON file — no identifier, no cookies, '
          + 'nothing about you or your applications is sent.')
      ])
    ]));

    if (s.enabled) {
      body.append(h('div', { class: 'small muted', style: 'margin-bottom:6px; word-break:break-all' }, s.url));
      body.append(h('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap; margin-bottom:8px' }, [
        s.count
          ? h('span', { class: 'pill ok' }, `${s.count} packs loaded`)
          : h('span', { class: 'pill neutral' }, 'using bundled packs'),
        s.updated ? h('span', { class: 'pill neutral' }, `source dated ${s.updated}`) : null,
        s.fetchedAt ? h('span', { class: 'small muted' }, `checked ${relTime(new Date(s.fetchedAt).toISOString())}`) : null
      ]));

      if (s.lastError) {
        body.append(h('div', { class: 'warnbox small', style: 'margin-bottom:8px' }, [
          h('div', { style: 'font-weight:600' }, 'Last check failed — bundled packs still in use'),
          h('div', { class: 'muted' }, s.lastError)
        ]));
      }

      body.append(h('div', { class: 'row', style: 'gap:8px' }, [
        h('button', {
          class: 'btn ghost',
          onclick: async (ev) => {
            ev.target.disabled = true;
            const res = await api.send({ type: MSG.UPDATE_PACKS, force: true });
            ev.target.disabled = false;
            toast(res && res.ok ? `Loaded ${res.count} packs` : (res && res.reason) || 'Check failed');
            refresh();
          }
        }, 'Check now'),
        s.count
          ? h('button', {
            class: 'btn ghost',
            onclick: async () => {
              await api.send({ type: MSG.CLEAR_REMOTE_PACKS });
              toast('Reverted to the packs that shipped with the extension');
              refresh();
            }
          }, 'Use bundled only')
          : null
      ]));

      body.append(h('div', { class: 'small muted', style: 'margin-top:8px' },
        'Fetched packs are validated before use: unknown fields, selectors that point at '
        + 'a password input, and hosts already claimed by another pack are all rejected, '
        + 'and the bundled copy keeps working.'));
    }
  };

  const refresh = async () => {
    const res = await api.send({ type: MSG.PACK_STATUS });
    draw(res && res.status);
  };
  refresh();

  return wrap;
}

function renderAbout() {
  return card('About', [
    h('div', { class: 'small muted' }, [
      'applyr fills job applications from a profile you control. It never submits a form, ',
      'never automates a job board, and never sends your data anywhere — the only ',
      'request it can make is for selector updates, and only if you turn them on. ',
      'Reviewing each application before you submit it is the point, not a limitation.'
    ].join(''))
  ]);
}
