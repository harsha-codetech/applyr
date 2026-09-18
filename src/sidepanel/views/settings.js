/** Settings, backup and the coverage report that tells you which site needs a pack. */

import { h, card, toast, confirmInline } from '../ui.js';
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

  root.append(card('About', [
    h('div', { class: 'small muted' }, [
      'applyr fills job applications from a profile you control. It never submits a form, ',
      'never automates a job board, and never sends your data anywhere. ',
      'Reviewing each application before you submit it is the point, not a limitation.'
    ].join(''))
  ]));

  return root;
}
