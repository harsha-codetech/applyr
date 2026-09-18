/** Application tracker - populated automatically from fills and submissions. */

import { h, card, toast, confirmInline, relTime } from '../ui.js';
import { MSG } from '../../core/messages.js';
import { APP_STATUS } from '../../core/storage.js';

const STATUS_PILL = {
  filled: 'neutral',
  submitted: 'ok',
  interviewing: 'ok',
  offer: 'ok',
  rejected: 'err',
  withdrawn: 'neutral'
};

export function render(state, api) {
  const root = h('div', {});
  const apps = state.applications || [];

  if (!apps.length) {
    root.append(h('div', { class: 'empty' },
      'No applications yet. Every form you fill is logged here automatically.'));
    return root;
  }

  const byStatus = apps.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  root.append(card('Summary', h('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' },
    Object.entries(byStatus).map(([s, n]) =>
      h('span', { class: `pill ${STATUS_PILL[s] || 'neutral'}` }, `${n} ${s}`)))));

  const filter = h('select', { style: 'margin-bottom:8px' }, [
    h('option', { value: '' }, 'All statuses'),
    ...APP_STATUS.map((s) => h('option', { value: s }, s))
  ]);
  const list = h('div', { class: 'list' });

  const draw = () => {
    list.textContent = '';
    const rows = apps.filter((a) => !filter.value || a.status === filter.value);
    if (!rows.length) list.append(h('div', { class: 'empty small' }, 'Nothing with that status.'));
    for (const a of rows) list.append(row(a, api));
  };
  filter.addEventListener('change', draw);
  draw();

  root.append(card(`Applications (${apps.length})`, [filter, list]));

  root.append(h('button', {
    class: 'btn ghost wide',
    onclick: () => exportCsv(apps)
  }, 'Export as CSV'));

  return root;
}

function row(app, api) {
  return h('div', { class: 'item' }, [
    h('div', { class: 'row spread' }, [
      h('div', {}, [
        h('div', { class: 'title small' }, app.role || '(role unknown)'),
        h('div', { class: 'small muted' }, [
          app.company || '',
          app.ats ? ` · ${app.ats}` : '',
          app.fieldsFilled ? ` · ${app.fieldsFilled} fields` : ''
        ].join(''))
      ]),
      h('select', {
        style: 'max-width:120px',
        onchange: async (e) => {
          await api.send({ type: MSG.SAVE_APP, app: { id: app.id, status: e.target.value } });
          toast('Updated');
          api.refresh();
        }
      }, APP_STATUS.map((s) => h('option', { value: s, ...(s === app.status ? { selected: true } : {}) }, s)))
    ]),
    h('div', { class: 'row', style: 'margin-top:6px; gap:12px' }, [
      app.url ? h('a', { href: app.url, target: '_blank', class: 'small' }, 'Open posting') : null,
      h('span', { class: 'small muted' }, relTime(app.createdAt)),
      h('button', {
        class: 'link',
        style: 'margin-left:auto; color:var(--err)',
        onclick: (ev) => confirmInline(ev.target, 'Remove? Click again', async () => {
          await api.send({ type: MSG.DELETE_APP, id: app.id });
          api.refresh();
        })
      }, 'Remove')
    ])
  ]);
}

function exportCsv(apps) {
  const head = ['company', 'role', 'status', 'ats', 'url', 'created', 'updated'];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const body = apps.map((a) => [a.company, a.role, a.status, a.ats, a.url, a.createdAt, a.updatedAt].map(esc).join(','));
  const csv = [head.join(','), ...body].join('\n');
  download(`applyr-applications-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
}

/** Anchor-based save - avoids needing the "downloads" permission. */
export function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
