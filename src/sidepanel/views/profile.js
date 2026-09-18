/**
 * Profile editor. Renders itself entirely from the taxonomy - adding a canonical
 * field to taxonomy.js makes an input appear here with no further work.
 */

import { h, field, group, toast } from '../ui.js';
import { MSG } from '../../core/messages.js';
import { FIELDS, GROUPS } from '../../core/taxonomy.js';
import { emptyExperience, emptyEducation, CORE_FIELDS } from '../../core/schema.js';

export function render(state, api) {
  const profile = structuredClone(state.profile);
  const root = h('div', {});
  let saveTimer = null;

  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await api.send({ type: MSG.SAVE_PROFILE, profile });
      if (res && res.ok) {
        state.profile = res.profile;
        toast('Saved');
      } else {
        toast(res?.error || 'Save failed');
      }
    }, 450);
  };

  const setValue = (id, v) => {
    if (v === '' || v === null) delete profile.values[id];
    else profile.values[id] = v;
    queueSave();
  };

  // -- taxonomy-driven groups ------------------------------------------------
  for (const g of GROUPS) {
    if (g.id === 'documents') continue; // handled by the Documents view
    const defs = FIELDS.filter((f) => f.group === g.id && f.type !== 'file');
    if (!defs.length) continue;

    const isCore = g.id === 'personal' || g.id === 'location';
    const body = h('div', {});

    if (g.id === 'eeo') {
      body.append(h('div', { class: 'warnbox small muted', style: 'margin-bottom:10px' },
        'Protected characteristics. Stored on your device and only filled when you turn on '
        + '"Fill demographic fields" in Settings. Leave blank to always answer these yourself.'));
    }

    for (const def of defs) {
      body.append(controlFor(def, profile.values[def.id], (v) => setValue(def.id, v)));
    }

    root.append(group(
      `${g.label}${defs.some((d) => CORE_FIELDS.includes(d.id)) ? '' : ''}`,
      body,
      isCore
    ));
  }

  // -- experience ------------------------------------------------------------
  root.append(group('Work history', repeatable({
    items: profile.experience,
    empty: emptyExperience,
    onChange: queueSave,
    render: (item, onChange) => [
      field('Company', h('input', { value: item.company || '', oninput: (e) => onChange('company', e.target.value) })),
      field('Title', h('input', { value: item.title || '', oninput: (e) => onChange('title', e.target.value) })),
      h('div', { class: 'grid2' }, [
        field('Start', h('input', { type: 'month', value: item.start || '', oninput: (e) => onChange('start', e.target.value) })),
        field('End', h('input', {
          type: 'month', value: item.end || '', disabled: item.current,
          oninput: (e) => onChange('end', e.target.value)
        }))
      ]),
      h('label', { class: 'row small' }, [
        h('input', {
          type: 'checkbox', checked: item.current,
          onchange: (e) => onChange('current', e.target.checked)
        }),
        'I work here now'
      ]),
      field('What you did', h('textarea', {
        value: item.description || '', oninput: (e) => onChange('description', e.target.value)
      }))
    ],
    title: (item) => [item.title, item.company].filter(Boolean).join(' · ') || 'New role'
  })));

  // -- education -------------------------------------------------------------
  root.append(group('Education', repeatable({
    items: profile.education,
    empty: emptyEducation,
    onChange: queueSave,
    render: (item, onChange) => [
      field('School', h('input', { value: item.school || '', oninput: (e) => onChange('school', e.target.value) })),
      h('div', { class: 'grid2' }, [
        field('Degree', h('input', { value: item.degree || '', oninput: (e) => onChange('degree', e.target.value) })),
        field('Field', h('input', { value: item.field || '', oninput: (e) => onChange('field', e.target.value) }))
      ]),
      h('div', { class: 'grid2' }, [
        field('Finished', h('input', { type: 'month', value: item.end || '', oninput: (e) => onChange('end', e.target.value) })),
        field('GPA / grade', h('input', { value: item.gpa || '', oninput: (e) => onChange('gpa', e.target.value) }))
      ])
    ],
    title: (item) => [item.degree, item.school].filter(Boolean).join(' · ') || 'New entry'
  })));

  return root;
}

function controlFor(def, value, onChange) {
  const common = { value: value == null ? '' : value };

  if (def.type === 'bool') {
    return field(def.label, h('select', {
      onchange: (e) => onChange(e.target.value)
    }, [
      h('option', { value: '', ...(value ? {} : { selected: true }) }, '—'),
      h('option', { value: 'yes', ...(value === 'yes' ? { selected: true } : {}) }, 'Yes'),
      h('option', { value: 'no', ...(value === 'no' ? { selected: true } : {}) }, 'No')
    ]));
  }

  if (def.type === 'enum') {
    return field(def.label, h('select', {
      onchange: (e) => onChange(e.target.value)
    }, [
      h('option', { value: '' }, '—'),
      ...def.options.map((o) => h('option', { value: o, ...(value === o ? { selected: true } : {}) }, o))
    ]));
  }

  if (def.type === 'longtext') {
    return field(def.label, h('textarea', {
      ...common, oninput: (e) => onChange(e.target.value)
    }), def.group === 'screening' ? 'Reused whenever a form asks something similar.' : null);
  }

  const inputType = def.type === 'number' ? 'number'
    : def.type === 'date' ? 'date'
      : def.type === 'month' ? 'month'
        : def.type === 'email' ? 'email'
          : def.type === 'tel' ? 'tel'
            : def.type === 'url' ? 'url' : 'text';

  return field(def.label, h('input', {
    type: inputType, ...common, oninput: (e) => onChange(e.target.value)
  }));
}

/** Generic add/remove list editor for experience and education. */
function repeatable({ items, empty, render, onChange, title }) {
  const wrap = h('div', {});

  const draw = () => {
    wrap.textContent = '';
    items.forEach((item, idx) => {
      const body = h('div', {});
      const update = (key, v) => {
        item[key] = v;
        onChange();
        if (key === 'company' || key === 'title' || key === 'school' || key === 'degree') {
          summary.firstChild.textContent = title(item);
        }
      };
      body.append(...render(item, update));
      body.append(h('button', {
        class: 'btn ghost',
        style: 'margin-top:6px',
        onclick: () => {
          items.splice(idx, 1);
          onChange();
          draw();
        }
      }, 'Remove'));

      const summary = h('summary', {}, [h('span', {}, title(item))]);
      const det = h('details', { class: 'group' }, [summary, h('div', { class: 'body' }, body)]);
      wrap.append(det);
    });

    wrap.append(h('button', {
      class: 'btn ghost wide',
      onclick: () => {
        items.push(empty());
        onChange();
        draw();
      }
    }, '+ Add'));
  };

  draw();
  return wrap;
}
