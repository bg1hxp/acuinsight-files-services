'use strict';
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const Policy = require('../service/fileUploadPolicy');

module.exports = () => async (ctx, next) => {
  if (ctx.path !== '/share' && !ctx.path.startsWith('/share/')) return next();
  ctx.set('Cache-Control', 'private, no-store');
  ctx.set('Referrer-Policy', 'no-referrer');
  ctx.set('X-Content-Type-Options', 'nosniff');
  const deny = (status, message) => { ctx.status = status; ctx.type = 'html'; ctx.body = '<!doctype html><meta name="viewport" content="width=device-width"><h1>' + message + '</h1><p>Please use today\'s LH picklist and labels message.</p>'; };
  if (!['GET', 'HEAD'].includes(ctx.method)) return deny(405, 'Download only');
  const match = /^\/share\/([A-Za-z0-9_-]{80,2048})$/.exec(ctx.path);
  if (!match) return deny(404, 'Link unavailable');
  const key = process.env.DOCUMENT_SHARE_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || '')) return deny(503, 'Document temporarily unavailable');
  let grant;
  try {
    const bytes = Buffer.from(match[1], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('lh-daily-document:v1'));
    decipher.setAuthTag(bytes.subarray(-16));
    grant = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
  } catch (_) { return deny(404, 'Link unavailable'); }
  if (grant.v !== 1 || grant.scope !== 'LH-daily' || !Number.isSafeInteger(grant.iat) || !Number.isSafeInteger(grant.exp) || grant.exp <= grant.iat || grant.exp - grant.iat > 26 * 3600000 || grant.iat > Date.now() + 5000 || !/^[a-f0-9]{64}$/.test(grant.sha256 || '')) return deny(404, 'Link unavailable');
  if (grant.exp <= Date.now()) return deny(410, 'Link expired');
  if (typeof grant.p !== 'string' || !grant.p.startsWith('BWRPickList/') || !/^(?:picklist|labels)_LH[-_][^/]*_\d{4}-\d{2}-\d{2}\.pdf$/.test(path.basename(grant.p)) || grant.p.split('/').some(p => !p || p.startsWith('.')) || /[\\%\x00-\x1f\x7f]/.test(grant.p)) return deny(404, 'Link unavailable');
  try {
    const storage = process.env.FILES_STORAGE_ROOT || path.join(think.ROOT_PATH, 'www/static');
    const file = await Policy.contained(path.join(storage, 'nodejsFiles'), grant.p, true);
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size || stat.size > 64 * 1024 * 1024) return deny(404, 'Document unavailable');
    const bytes = await fs.readFile(file);
    if (bytes.length > 64 * 1024 * 1024 || crypto.createHash('sha256').update(bytes).digest('hex') !== grant.sha256) return deny(410, 'Document replaced');
    ctx.type = 'application/pdf';
    ctx.set('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(grant.p)));
    ctx.body = bytes;
  } catch (_) { return deny(503, 'Document temporarily unavailable'); }
};
