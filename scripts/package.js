/**
 * Build the Chrome Web Store upload zip - no dependencies, just zlib.
 *
 * Ships only what the extension needs: manifest, icons and src. Fixtures, tests,
 * docs and scripts stay out of the package.
 *
 *   npm run zip  ->  dist/applyr-<version>.zip
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'icons', 'src'];

// ---------------------------------------------------------------------------
// minimal zip writer (deflate, no directory entries)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const useStore = deflated.length >= entry.data.length;
    const body = useStore ? entry.data : deflated;
    const method = useStore ? 0 : 8;
    const { time, day } = dosTime(entry.date);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}

// ---------------------------------------------------------------------------

function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(abs).sort()) walk(path.join(rel, child), out);
  } else {
    out.push({
      name: rel.split(path.sep).join('/'),
      data: fs.readFileSync(abs),
      date: stat.mtime
    });
  }
  return out;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const entries = INCLUDE.flatMap((p) => walk(p));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const outFile = path.join(ROOT, 'dist', `applyr-${manifest.version}.zip`);
fs.writeFileSync(outFile, zip(entries));

const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`${entries.length} files -> dist/applyr-${manifest.version}.zip (${kb} KB)`);
