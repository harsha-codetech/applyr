/**
 * Build packs.json - the single file a remote pack source serves.
 *
 * Run it after editing any pack, commit the result, and installs that have
 * opted into pack updates pick up the fix without waiting for a store review.
 * The output is validated with the same rules the extension applies on fetch,
 * so a bundle that would be rejected at runtime fails here instead.
 *
 *   npm run packs:bundle
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackBundle } from '../src/core/pack-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = path.join(ROOT, 'src/packs');
const OUT = path.join(ROOT, 'packs.json');

const index = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'index.json'), 'utf8'));
const packs = index.packs.map((f) => JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')));

const bundle = {
  format: 'applyr-packs',
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  minExtensionVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version,
  packs
};

const { ok, errors } = validatePackBundle(bundle);
if (!ok) {
  console.error('packs.json would be REJECTED by the extension:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

fs.writeFileSync(OUT, `${JSON.stringify(bundle, null, 2)}\n`);
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`packs.json: ${packs.length} packs, ${kb} KB, validates clean`);
console.log(`  ${packs.map((p) => p.id).join(', ')}`);
