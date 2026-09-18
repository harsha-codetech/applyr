/**
 * Résumé / document upload.
 *
 * `input.files` is read-only in the sense that you cannot push a string into it,
 * but it does accept a FileList built from a DataTransfer - which is the one
 * sanctioned way to put a file into a form from script. The bytes arrive from
 * the service worker as base64 because chrome.runtime messaging is JSON, not
 * structured clone, so an ArrayBuffer would not survive the trip.
 *
 * Some uploaders ignore the `change` event and only listen for a drop on their
 * styled drop zone, so the adapter fires a synthetic drop too when it can find
 * one. `isTrusted` is false on both - the overwhelming majority of ATS uploaders
 * do not check it.
 */

import { fire, sleep } from './dom.js';
import { base64ToBytes } from '../../core/util.js';

function buildFile(spec) {
  const bytes = base64ToBytes(spec.data);
  return new File([bytes], spec.name, {
    type: spec.type || 'application/octet-stream',
    lastModified: Date.now()
  });
}

function dropZoneFor(el) {
  let node = el.parentElement;
  let hops = 0;
  while (node && hops < 4) {
    const cls = `${node.className || ''}`;
    if (/drop|dropzone|upload|attach/i.test(cls) || node.hasAttribute?.('data-dropzone')) return node;
    node = node.parentElement;
    hops += 1;
  }
  return null;
}

/**
 * @param {object} desc  file-input descriptor
 * @param {{name: string, type: string, data: string}} spec base64 payload
 */
export async function fillFile(desc, spec) {
  const el = desc.el;
  const file = buildFile(spec);

  const dt = new DataTransfer();
  dt.items.add(file);

  try {
    el.files = dt.files;
  } catch (err) {
    throw new Error(`browser refused the file assignment: ${err.message}`);
  }

  fire(el, 'input');
  fire(el, 'change');
  await sleep(0);

  const zone = dropZoneFor(el);
  if (zone) {
    const drop = new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt });
    zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(drop);
  }

  // Uploads are async - give the widget a beat to register the filename.
  await sleep(150);
}

/** Does this input's `accept` allow the file we are about to attach? */
export function acceptsFile(desc, spec) {
  const accept = (desc.accept || '').trim();
  if (!accept) return true;
  const name = String(spec.name || '').toLowerCase();
  const type = String(spec.type || '').toLowerCase();
  return accept.split(',').some((rule) => {
    const r = rule.trim().toLowerCase();
    if (!r) return false;
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}
