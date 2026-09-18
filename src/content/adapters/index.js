/** Adapter dispatch: plan entry in, outcome out. */

import { OUTCOME } from '../../core/messages.js';
import { verifyEntry } from '../verify.js';
import { fillText } from './text.js';
import { fillSelect, fillCheckbox, fillRadioGroup } from './choice.js';
import { fillCombobox } from './combobox.js';
import { fillFile, acceptsFile } from './file.js';
import { sleep } from './dom.js';

/**
 * Apply one plan entry.
 *
 * @param {object} entry
 * @param {object} ctx
 * @param {object} ctx.widgets            pack widget hints
 * @param {(desc: object) => Promise<object|null>} ctx.resolveFile
 *        called lazily for file fields so bytes are only pulled from the vault
 *        when a form actually asks for a document
 * @returns {Promise<{outcome: string, detail: string}>}
 */
export async function applyEntry(entry, ctx) {
  const { desc, value } = entry;

  try {
    if (!desc.el.isConnected) {
      return { outcome: OUTCOME.FAILED, detail: 'element left the page' };
    }

    if (desc.kind === 'file') {
      const spec = await ctx.resolveFile(desc, entry);
      if (!spec) return { outcome: OUTCOME.SKIPPED, detail: 'no document saved for this slot' };
      if (!acceptsFile(desc, spec)) {
        return { outcome: OUTCOME.SKIPPED, detail: `form only accepts ${desc.accept}` };
      }
      await fillFile(desc, spec);
      entry.value = spec.name;
    } else {
      switch (desc.kind) {
        case 'select':
          await fillSelect(desc, value);
          break;
        case 'checkbox':
          await fillCheckbox(desc, value);
          break;
        case 'radio-group':
          await fillRadioGroup(desc, value);
          break;
        case 'combobox':
          await fillCombobox(desc, value, ctx.widgets);
          break;
        default:
          await fillText(desc, value);
      }
    }

    // Let a re-render settle before reading the value back.
    await sleep(30);
    const check = verifyEntry(entry);
    return check.ok
      ? { outcome: OUTCOME.FILLED, detail: '' }
      : { outcome: OUTCOME.UNVERIFIED, detail: `wrote "${entry.value}", field shows "${check.actual}"` };
  } catch (err) {
    return { outcome: OUTCOME.FAILED, detail: err.message || String(err) };
  }
}
