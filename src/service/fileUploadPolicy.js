'use strict';
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const MAX_SIZE = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const ATTACHMENT_EXTENSIONS = IMAGE_EXTENSIONS.concat(['gif', 'webp', 'pdf', 'txt', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'zip']);
const bad = message => Object.assign(new Error(message), { status: 400 });

function basename(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\\/\x00-\x1f\x7f]/.test(value) || value.startsWith('.') || value.includes('..')) throw bad('Invalid filename');
  return value;
}
function ids(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  if (!list.length || list.length > 100 || list.some(id => !/^[1-9]\d{0,9}$/.test(String(id)))) throw bad('Invalid InventoryIDs');
  return [...new Set(list.map(String))];
}
function filename(value, imageOnly = true) {
  basename(value);
  const ext = value.split('.').pop().toLowerCase();
  if (!(imageOnly ? IMAGE_EXTENSIONS : ATTACHMENT_EXTENSIONS).includes(ext)) throw bad('Unsupported file type');
  return ext;
}
async function upload(file, name, imageOnly = true) {
  const ext = filename(name, imageOnly);
  if (!file || !file.path) throw bad('Choose a file');
  const stat = await fs.stat(file.path);
  if (!stat.isFile() || !stat.size || stat.size > MAX_SIZE) throw bad('File must be nonempty and at most 5 MB');
  const bytes = await fs.readFile(file.path);
  const signatures = {
    png: () => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    jpg: () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    jpeg: () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    gif: () => /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()),
    webp: () => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
    pdf: () => bytes.subarray(0, 5).toString() === '%PDF-',
    zip: () => bytes[0] === 80 && bytes[1] === 75,
    xls: () => bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')),
    txt: () => !bytes.includes(0), csv: () => !bytes.includes(0)
  };
  signatures.xlsx = signatures.docx = signatures.zip;
  signatures.doc = signatures.xls;
  if (!signatures[ext]()) throw bad('File contents do not match the selected type');
  if (imageOnly && !['image/jpeg', 'image/png'].includes(file.type)) throw bad('Choose a JPEG or PNG image');
  return { bytes, ext };
}
async function contained(root, name, existing = false) {
  const absolute = path.resolve(root, name);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw bad('Invalid file path');
  const rootReal = await fs.realpath(root);
  const targetReal = await fs.realpath(existing ? absolute : path.dirname(absolute));
  const realRelative = path.relative(rootReal, targetReal);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw bad('File path is outside storage');
  return absolute;
}
async function save(root, name, bytes) {
  const directory = path.dirname(path.resolve(root, name));
  const relative = path.relative(path.resolve(root), directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw bad('Invalid file path');
  await fs.mkdir(root, { recursive: true });
  let parent = path.resolve(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    // Check each existing parent before creating a child beneath it.
    await contained(root, path.relative(root, path.join(parent, '.probe')));
    parent = path.join(parent, segment);
    await fs.mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const target = await contained(root, name);
  const temporary = path.join(directory, '.upload-' + crypto.randomBytes(12).toString('hex') + '.part');
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
module.exports = { bad, basename, ids, filename, upload, save, contained };
