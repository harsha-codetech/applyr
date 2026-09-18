/**
 * Question memory.
 *
 * With no model in the loop, this is where the extension's intelligence lives:
 * every answer the user teaches once is recalled by fuzzy match the next time
 * any employer asks the same question in different words.
 */

import { h, card, field, toast, confirmInline, relTime } from '../ui.js';
import { MSG } from '../../core/messages.js';

export function render(state, api) {
  const root = h('div', {});
  const memory = [...(state.memory || [])].sort((a, b) => (b.uses || 0) - (a.uses || 0));

  // -- add ------------------------------------------------------------------
  const q = h('input', { placeholder: 'e.g. Are you authorized to work in the US?' });
  const a = h('textarea', { placeholder: 'Your answer' });

  root.append(card('Teach an answer', [
    field('Question', q),
    field('Answer', a),
    h('button', {
      class: 'btn wide',
      onclick: async () => {
        const question = q.value.trim();
        const answer = a.value.trim();
        if (!question || !answer) {
          toast('Both fields are needed');
          return;
        }
        await api.send({ type: MSG.SAVE_MEMORY, entry: { question, answer } });
        q.value = '';
        a.value = '';
        toast('Remembered');
        api.refresh();
      }
    }, 'Save answer'),
    h('div', { class: 'small muted', style: 'margin-top:8px' },
      'Matching is fuzzy: "Why do you want to work here?" also answers '
      + '"Why are you interested in our company?"')
  ]));

  // -- list -----------------------------------------------------------------
  if (!memory.length) {
    root.append(h('div', { class: 'empty' },
      'Nothing saved yet. Fill a form and use “Teach answer” on anything applyr could not place.'));
    return root;
  }

  const search = h('input', { placeholder: 'Search saved answers', style: 'margin-bottom:8px' });
  const list = h('div', { class: 'list' });

  const draw = () => {
    const needle = search.value.trim().toLowerCase();
    list.textContent = '';
    const rows = memory.filter((e) => !needle
      || e.question.toLowerCase().includes(needle)
      || String(e.answer).toLowerCase().includes(needle));

    if (!rows.length) {
      list.append(h('div', { class: 'empty small' }, 'No matches.'));
      return;
    }
    for (const e of rows) list.append(row(e, api));
  };

  search.addEventListener('input', draw);
  draw();

  root.append(card(`Saved answers (${memory.length})`, [search, list]));
  return root;
}

function row(entry, api) {
  const answerEl = h('div', { class: 'small', style: 'margin-top:4px; white-space:pre-wrap' }, entry.answer);

  const edit = () => {
    const box = h('textarea', { value: entry.answer });
    const save = h('button', {
      class: 'btn',
      style: 'margin-top:6px',
      onclick: async () => {
        await api.send({ type: MSG.UPDATE_MEMORY, id: entry.id, patch: { answer: box.value } });
        toast('Updated');
        api.refresh();
      }
    }, 'Save');
    answerEl.replaceWith(box, save);
  };

  return h('div', { class: 'item' }, [
    h('div', { class: 'row spread' }, [
      h('div', { class: 'title small' }, entry.question),
      entry.uses ? h('span', { class: 'pill neutral mono' }, `${entry.uses}×`) : null
    ]),
    answerEl,
    h('div', { class: 'row', style: 'margin-top:6px; gap:12px' }, [
      h('button', { class: 'link', onclick: edit }, 'Edit'),
      h('span', { class: 'small muted' }, relTime(entry.updatedAt)),
      h('button', {
        class: 'link',
        style: 'margin-left:auto; color:var(--err)',
        onclick: (ev) => confirmInline(ev.target, 'Delete? Click again', async () => {
          await api.send({ type: MSG.DELETE_MEMORY, id: entry.id });
          api.refresh();
        })
      }, 'Delete')
    ])
  ]);
}
