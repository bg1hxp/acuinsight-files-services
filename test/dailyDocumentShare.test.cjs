'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'daily-document-read-'));
process.env.FILES_STORAGE_ROOT = root; process.env.DOCUMENT_SHARE_KEY = '12'.repeat(32);
const pdf = Buffer.from('%PDF-1.4\nfixture\n%%EOF'), relative = 'BWRPickList/fixture/picklist_LH-UPS_2026-11-14.pdf';
const file = path.join(root, 'nodejsFiles', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, pdf);
after(() => fs.rmSync(root, { recursive: true, force: true }));
const guard = require('../src/middleware/daily_document_share')();
function token(overrides = {}) {
  const grant = { v: 1, scope: 'LH-daily', p: relative, iat: Date.now() - 1000, exp: Date.now() + 60000, sha256: crypto.createHash('sha256').update(pdf).digest('hex'), ...overrides };
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from('12'.repeat(32), 'hex'), iv); cipher.setAAD(Buffer.from('lh-daily-document:v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(grant)), cipher.final()]);
  return Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64url');
}
function fixture(value, method = 'GET') { const headers = {}; return { path: '/share/' + value, method, headers, set: (k, v) => { headers[k] = v; } }; }
test('exact PDF shares download anonymously with private caching and no referrer', async () => {
  const ctx = fixture(token()); await guard(ctx, () => assert.fail('Share fell through to request logging'));
  assert.deepEqual(ctx.body, pdf); assert.equal(ctx.type, 'application/pdf'); assert.match(ctx.headers['Content-Disposition'], /attachment/);
  assert.equal(ctx.headers['Cache-Control'], 'private, no-store'); assert.equal(ctx.headers['Referrer-Policy'], 'no-referrer');
});
test('expired, tampered, wrong-purpose and changed-file shares never return PDF bytes', async () => {
  const valid = token(), altered = valid.slice(0, 40) + (valid[40] === 'a' ? 'b' : 'a') + valid.slice(41);
  for (const [value, expected] of [[token({ iat: Date.now() - 7200000, exp: Date.now() - 1 }), 410], [altered, 404], [token({ scope: 'other' }), 404], [token({ p: '../outside.pdf' }), 404], [token({ exp: Date.now() + 7 * 86400000 }), 404]]) {
    const ctx = fixture(value); await guard(ctx, () => assert.fail()); assert.equal(ctx.status, expected); assert.equal(typeof ctx.body, 'string'); assert.ok(!ctx.body.includes('%PDF'));
  }
  fs.writeFileSync(file, '%PDF-1.4\nnew version'); const changed = fixture(token()); await guard(changed, () => assert.fail()); assert.equal(changed.status, 410); fs.writeFileSync(file, pdf);
});
test('shares are read-only, fail closed without a key, and leave other API paths untouched', async () => {
  const post = fixture(token(), 'POST'); await guard(post, () => assert.fail()); assert.equal(post.status, 405);
  const saved = process.env.DOCUMENT_SHARE_KEY; delete process.env.DOCUMENT_SHARE_KEY;
  try { const missing = fixture(token()); await guard(missing, () => assert.fail()); assert.equal(missing.status, 503); } finally { process.env.DOCUMENT_SHARE_KEY = saved; }
  const other = fixture(''); other.path = '/api/uploadfile'; let next = false; await guard(other, () => { next = true; }); assert.equal(next, true);
});
