'use strict';
const Access = require('../service/fileAuthorization');
const path = require('path');
const Policy = require('../service/fileUploadPolicy');
const fs = require('fs').promises;
const PRIVATE = {
  timeline_upload: 'readTimeline',
  rack_record_upload: 'readRecord',
  original_imgs_upload: 'readOriginal',
  snapitSeverPath: 'readOriginal',
  splitImageOutput: 'readOriginal',
  tempSnapitPath: 'readOriginal',
  sawshareoriginalImage: 'readOriginal',
  sawsharewhiteBackgroundImage: 'readOriginal'
};
const PUBLIC = new Set(['iImages', 'hImages', 'highReImagesOutput', 'hNumWhiteImages', 'newReplacement']);
const IMAGES = /\.(?:jpe?g|png|gif|webp)$/i;
const ATTACHMENTS = /\.(?:jpe?g|png|gif|webp|pdf|txt|csv|xlsx?|docx?|zip)$/i;

module.exports = () => async (ctx, next) => {
  if (!ctx.path.startsWith('/static') && !ctx.path.startsWith('/favicon.ico')) return next();
  ctx.set('Cache-Control', 'private, no-store');
  ctx.set('X-Content-Type-Options', 'nosniff');
  const deny = (status, errmsg) => { ctx.status = status; ctx.body = { errno: status, errmsg }; };
  if (!['GET', 'HEAD'].includes(ctx.method)) return deny(405, 'Use GET or HEAD');
  let decoded;
  try { decoded = decodeURIComponent(ctx.path); } catch (_) { return deny(400, 'Invalid file path'); }
  if (/[\\\x00-\x1f\x7f]/.test(decoded) || decoded.includes('%') || decoded.split('/').some(p => p.startsWith('.'))) return deny(400, 'Invalid file path');
  if (decoded === '/favicon.ico') return next();
  if (!decoded.startsWith('/static/')) return deny(403, 'File not available');
  const parts = decoded.split('/');
  const folder = parts[2];
  const document = folder === 'nodejsFiles';
  let readAction = PRIVATE[folder];
  if (document) {
    readAction = /^(?:labels[^/]*|usps_labels|wo|BWRPickList|printers|manual_fulfillment)$/.test(parts[3]) ? 'readShippingDocument' : 'readAdminDocument';
    if (/^reports\/Work_Order_Daily_Report_\d{4}-\d{2}-\d{2}\.xlsx$/.test(parts.slice(3).join('/'))) readAction = 'readWorkOrderReport';
  }
  const contained = async () => {
    try {
      const storage = process.env.FILES_STORAGE_ROOT || path.join(think.ROOT_PATH, 'www/static');
      const file = await Policy.contained(path.join(storage, folder), parts.slice(3).join('/'), true);
      if (!(await fs.stat(file)).isFile()) { deny(404, 'File not available'); return false; }
      return true;
    } catch (error) { deny(error.status || 404, 'File not available'); return false; }
  };
  if (PUBLIC.has(folder)) {
    if (!IMAGES.test(decoded)) return deny(404, 'File not available');
    if (!await contained()) return;
    ctx.set('Cache-Control', 'public, max-age=604800');
    return next();
  }
  if ((!document && !Object.prototype.hasOwnProperty.call(PRIVATE, folder)) || !(document ? /\.(?:pdf|xlsx)$/i : ATTACHMENTS).test(decoded)) return deny(403, 'File not available');
  try {
    const token = ctx.get('token') || ctx.cookies.get('token', { signed: false });
    ctx.state.fileReadUser = await Access.authorize(token, readAction);
  } catch (error) { return deny(error.status || 503, error.message); }
  if (!await contained()) return;
  if (!IMAGES.test(decoded)) ctx.set('Content-Disposition', 'attachment');
  await next();
  // Resource middleware may set cache headers; private responses must not inherit public caching.
  ctx.set('Cache-Control', 'private, no-store');
};
