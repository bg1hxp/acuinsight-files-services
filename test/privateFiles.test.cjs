'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const root = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'private-file-tests-'));
process.env.FILES_STORAGE_ROOT = root;
for (const name of ['rack_record_upload/2026/46/photo.png', 'highReImagesOutput/123_01.jpg']) {
  const file = require('path').join(root, name); fs.mkdirSync(require('path').dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
}
after(() => fs.rmSync(root, { recursive: true, force: true }));
const Access = require('../src/service/fileAuthorization');
const middleware = require('../src/middleware/private_file_access')();

function fixture(path, token = '') {
  const headers = {};
  return { path, method: 'GET', state: {}, headers,
    get: () => '', cookies: { get: () => token }, set: (k, v) => { headers[k] = v; } };
}
test('anonymous internal file reads fail before static serving', async () => {
  for (const folder of ['timeline_upload', 'rack_record_upload', 'original_imgs_upload', 'snapitSeverPath', 'splitImageOutput']) {
    const ctx = fixture('/static/' + folder + '/test.png'); let served = false;
    await middleware(ctx, () => { served = true; });
    assert.equal(ctx.status, 401); assert.equal(served, false);
    assert.equal(ctx.headers['Cache-Control'], 'private, no-store');
  }
});
test('current permission verification applies to cookie image requests and cannot enable writes', async () => {
  const original = Access.authorize;
  Access.authorize = async (token, action) => {
    assert.equal(token, 'verified-cookie'); assert.equal(action, 'readRecord'); return { userid: 1 };
  };
  try {
    const ctx = fixture('/static/rack_record_upload/2026/46/photo.png', 'verified-cookie'); let served = false;
    await middleware(ctx, () => { served = true; ctx.set('Cache-Control', 'public'); });
    assert.equal(served, true); assert.equal(ctx.headers['Cache-Control'], 'private, no-store');
    assert.equal(ctx.state.fileAction, undefined);
    ctx.method = 'POST'; await middleware(ctx, () => assert.fail('POST must not serve files')); assert.equal(ctx.status, 405);
  } finally { Access.authorize = original; }
});
test('reviewed product image roots retain anonymous reads without permitting other file types', async () => {
  const ctx = fixture('/static/highReImagesOutput/123_01.jpg'); let served = false;
  await middleware(ctx, () => { served = true; }); assert.equal(served, true);
  const hidden = fixture('/static/highReImagesOutput/settings.json');
  await middleware(hidden, () => assert.fail('Non-image must not be public')); assert.equal(hidden.status, 404);
});
test('unknown static roots, active content and escaped paths cannot bypass the private gate', async () => {
  for (const p of ['/static/nodejsFiles/labels/settings.json', '/static/timeline_upload/page.html', '/static/rack_record_upload/../timeline_upload/test.jpg', '/static/rack_record_upload/%252e%252e/test.jpg', '/staticextra/file.png', '/favicon.ico/../static/timeline_upload/test.jpg']) {
    const ctx = fixture(p, 'verified-cookie');
    await middleware(ctx, () => assert.fail('Unsafe path was served'));
    assert.ok([400, 403].includes(ctx.status), p);
  }
});
test('both shipping and administrative documents authorize before streaming, never by filename secrecy', async () => {
  const original = Access.authorize;
  try {
    for (const [folder, action] of [['labels', 'readShippingDocument'], ['wo', 'readShippingDocument'], ['manual_fulfillment', 'readShippingDocument'], ['reports', 'readAdminDocument']]) {
      const relative = `nodejsFiles/${folder}/known-file.pdf`;
      fs.mkdirSync(require('path').dirname(root + '/' + relative), { recursive: true }); fs.writeFileSync(root + '/' + relative, '%PDF-fixture');
      const anonymous = fixture('/static/' + relative);
      await middleware(anonymous, () => assert.fail('Anonymous document served')); assert.equal(anonymous.status, 401);
      Access.authorize = async (token, actual) => { assert.equal(actual, action); return { userid: 1 }; };
      const ctx = fixture('/static/' + relative, 'verified-cookie'); let served = false;
      await middleware(ctx, () => { served = true; ctx.set('Cache-Control', 'public'); });
      assert.equal(served, true); assert.equal(ctx.headers['Content-Disposition'], 'attachment'); assert.equal(ctx.headers['Cache-Control'], 'private, no-store');
      Access.authorize = original;
    }
    Access.authorize = async () => { throw Object.assign(new Error('Denied'), { status: 403 }); };
    const denied = fixture('/static/nodejsFiles/labels/known-file.pdf', 'verified-cookie');
    await middleware(denied, () => assert.fail('Denied document served')); assert.equal(denied.status, 403);
  } finally { Access.authorize = original; }
});
test('encoded separators cannot skip authorization before the static resource decoder', async () => {
  const ctx = fixture('/static%2frack_record_upload%2fphoto.png'); let served = false;
  await middleware(ctx, () => { served = true; });
  assert.equal(ctx.status, 401); assert.equal(served, false);
});
test('a public image root cannot expose private siblings through a symlink', async () => {
  fs.symlinkSync(root + '/rack_record_upload/2026/46/photo.png', root + '/highReImagesOutput/leak.jpg');
  const ctx = fixture('/static/highReImagesOutput/leak.jpg'); let served = false;
  await middleware(ctx, () => { served = true; });
  assert.equal(ctx.status, 400); assert.equal(served, false);
});
test('only exact work order daily report paths select the dedicated report grant', async () => {
  const original = Access.authorize;
  try {
    for (const [relative, expected] of [
      ['reports/Work_Order_Daily_Report_2026-11-13.xlsx', 'readWorkOrderReport'],
      ['reports/Other_Report_2026-11-13.xlsx', 'readAdminDocument'],
      ['reports/Work_Order_Daily_Report_2026-11-13.pdf', 'readAdminDocument'],
      ['reports/Work_Order_Daily_Report_2026-11-13-extra.xlsx', 'readAdminDocument'],
      ['reports/subdir/Work_Order_Daily_Report_2026-11-13.xlsx', 'readAdminDocument'],
      ['other/Work_Order_Daily_Report_2026-11-13.xlsx', 'readAdminDocument']
    ]) {
      const file = root + '/nodejsFiles/' + relative;
      fs.mkdirSync(require('path').dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
      Access.authorize = async (token, action) => { assert.equal(action, expected); return { userid: 1 }; };
      let served = false;
      await middleware(fixture('/static/nodejsFiles/' + relative, 'verified-cookie'), () => { served = true; });
      assert.equal(served, true, relative);
    }
  } finally { Access.authorize = original; }
});
test('repeated slashes in a legacy image URL resolve to the same guarded file', async () => {
  const original = Access.authorize;
  Access.authorize = async () => ({ userid: 1 });
  try {
    // The admin UI joins a trailing-slash base with a leading-slash path, so every
    // stored record photo has always been requested as rack_record_upload//<year>/...
    const ctx = fixture('/static/rack_record_upload//2026/46/photo.png', 'verified-cookie'); let served = false;
    await middleware(ctx, () => { served = true });
    assert.equal(served, true);
    assert.equal(ctx.path, '/static/rack_record_upload/2026/46/photo.png');
    const publicCtx = fixture('//static//highReImagesOutput//123_01.jpg'); let publicServed = false;
    await middleware(publicCtx, () => { publicServed = true });
    assert.equal(publicServed, true);
    for (const p of ['/static/rack_record_upload//../timeline_upload/test.jpg', '/static//../etc/passwd.jpg', '/static//unknown_root//test.jpg']) {
      const unsafe = fixture(p, 'verified-cookie');
      await middleware(unsafe, () => assert.fail('Unsafe path was served'));
      assert.ok([400, 403, 404].includes(unsafe.status), p + ' -> ' + unsafe.status);
    }
  } finally { Access.authorize = original }
});
