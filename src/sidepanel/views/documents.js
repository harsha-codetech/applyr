/** Résumé / cover-letter vault. Bytes live in IndexedDB, never in chrome.storage. */

import { h, card, toast, confirmInline, relTime } from '../ui.js';
import { MSG } from '../../core/messages.js';
import { humanSize } from '../../core/util.js';

const MAX_BYTES = 8 * 1024 * 1024;

export function render(state, api) {
  const root = h('div', {});
  const files = state.files || [];
  const defaultId = state.profile.settings.defaultResumeId;

  const picker = h('input', {
    type: 'file',
    accept: '.pdf,.doc,.docx,.txt,.rtf,application/pdf',
    style: 'display:none',
    onchange: async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      if (file.size > MAX_BYTES) {
        toast(`Too large (${humanSize(file.size)}). Keep it under ${humanSize(MAX_BYTES)}.`);
        return;
      }
      const buf = await file.arrayBuffer();
      const data = toBase64(buf);
      const res = await api.send({
        type: MSG.ADD_FILE,
        name: file.name,
        mime: file.type || 'application/pdf',
        kind: kindSelect.value,
        label: file.name.replace(/\.[^.]+$/, ''),
        data
      });
      if (res && res.ok) {
        toast('Added');
        api.refresh();
      } else {
        toast(res?.error || 'Could not save the file');
      }
    }
  });

  const kindSelect = h('select', { style: 'max-width:150px' }, [
    h('option', { value: 'resume' }, 'Résumé / CV'),
    h('option', { value: 'cover' }, 'Cover letter'),
    h('option', { value: 'other' }, 'Other document')
  ]);

  root.append(card('Add a document', [
    h('div', { class: 'row' }, [
      kindSelect,
      h('button', { class: 'btn', onclick: () => picker.click() }, 'Choose file')
    ]),
    picker,
    h('div', { class: 'small muted', style: 'margin-top:8px' },
      'PDF works best - most ATS parsers choke on .pages and images. Stored on this device only.')
  ]));

  if (!files.length) {
    root.append(h('div', { class: 'empty' }, 'No documents yet. A résumé is what most forms ask for first.'));
    return root;
  }

  root.append(card('Your documents', h('div', { class: 'list' }, files.map((f) => h('div', { class: 'item' }, [
    h('div', { class: 'row spread' }, [
      h('div', {}, [
        h('div', { class: 'title small' }, f.label || f.name),
        h('div', { class: 'small muted' },
          `${f.name} · ${humanSize(f.size)} · ${relTime(f.createdAt)}`)
      ]),
      f.id === defaultId ? h('span', { class: 'pill ok' }, 'default') : null
    ]),
    h('div', { class: 'row', style: 'margin-top:6px; gap:10px' }, [
      f.kind === 'resume' && f.id !== defaultId
        ? h('button', {
          class: 'link',
          onclick: async () => {
            await api.send({ type: MSG.PATCH_SETTINGS, patch: { defaultResumeId: f.id } });
            toast('Set as default');
            api.refresh();
          }
        }, 'Use by default')
        : null,
      h('span', { class: 'pill neutral' }, f.kind),
      h('button', {
        class: 'link',
        style: 'margin-left:auto; color:var(--err)',
        onclick: (ev) => confirmInline(ev.target, 'Delete? Click again', async () => {
          await api.send({ type: MSG.DELETE_FILE, id: f.id });
          toast('Deleted');
          api.refresh();
        })
      }, 'Delete')
    ])
  ])))));

  return root;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
