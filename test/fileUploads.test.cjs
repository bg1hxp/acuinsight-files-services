'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-security-test-'));
const roots = { PowerLink_R_Image: root + '/product/', PowerLink_Record_Image: root + '/record/', Timeline_Files: root + '/timeline/' };
Object.values(roots).forEach(p => fs.mkdirSync(p));
global.think = { Controller: class {}, config: () => roots, mkdir: p => fs.mkdirSync(p, { recursive: true }), logger: { error() {} } };
const Controller = require('../src/controller/api');
let server;
let authCalls = 0;
before(async () => {
  server = http.createServer((req, res) => {
    authCalls++;
    let data = ''; req.on('data', d => { data += d; });
    req.on('end', () => {
      const input = JSON.parse(data);
      const denied = req.headers.token === 'ungranted-session-token';
      res.writeHead(denied ? 403 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(denied ? { errno: 403 } : { errno: 0, data: { authorized: true, userid: 1, action: input.action } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.FILES_AUTH_URL = `http://127.0.0.1:${server.address().port}/management/fileAccess/authorize`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
function controller(action, body = {}, token = 'granted-session-token', file) {
  const c = Object.create(Controller.prototype);
  c.ctx = { path: '/api/' + action, method: 'POST', status: 200, state: {}, set() {} };
  c.post = key => key ? body[key] : body;
  c.header = key => key === 'token' ? token : '';
  c.file = () => file;
  c.json = value => { c.response = value; return value; };
  return c;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function image() { const p = root + '/fixture.png'; fs.writeFileSync(p, png); return { path: p, type: 'image/png', size: png.length }; }

test('anonymous writes stop before filesystem actions and never call auth without a session', async () => {
  const beforeCalls = authCalls;
  for (const action of ['uploadfile', 'uploadPLRImg', 'uploadPLRRecordImg', 'confirmPLRImg']) {
    const c = controller(action, {}, '');
    assert.equal(await c.__before(), false); assert.equal(c.ctx.status, 401);
  }
  assert.equal(authCalls, beforeCalls);
  assert.deepEqual(fs.readdirSync(roots.PowerLink_R_Image), []);
});
test('ungranted session is denied by central authorization', async () => {
  const c = controller('uploadPLRImg', {}, 'ungranted-session-token');
  assert.equal(await c.__before(), false); assert.equal(c.ctx.status, 403);
});
test('authorized product upload and confirmation preserve multi-R filenames', async () => {
  const c = controller('uploadPLRImg', { filename: '123_01.png', InventoryIDs: '123,456' }, undefined, image());
  assert.notEqual(await c.__before(), false); await c.uploadPLRImgAction();
  const uploaded = c.response.url;
  assert.ok(uploaded.startsWith('temp_#_'));
  const d = controller('confirmPLRImg', { filenames: [uploaded], InventoryIDs: [123, 456], InventoryNumber: '560-12345A' });
  assert.notEqual(await d.__before(), false); await d.confirmPLRImgAction();
  for (const id of [123, 456]) assert.deepEqual(fs.readFileSync(roots.PowerLink_R_Image + `560-12345A+${id}_06_end.png`), png);
});
test('authorized record photo exists completely before success is returned', async () => {
  const c = controller('uploadPLRRecordImg', { filename: '123_01.png' }, undefined, image());
  assert.notEqual(await c.__before(), false); await c.uploadPLRRecordImgAction();
  assert.deepEqual(fs.readFileSync(roots.PowerLink_Record_Image + c.response.url.replace(/^\//, '')), png);
});
test('filename traversal, target traversal, forged image bytes and active attachments are rejected', async () => {
  const bad = root + '/not-image'; fs.writeFileSync(bad, '<html>not an image</html>');
  const inputs = [
    ['uploadPLRRecordImg', { filename: '../escape.png' }, image()],
    ['uploadPLRImg', { filename: '123_01.png', InventoryIDs: '../escape' }, image()],
    ['uploadPLRRecordImg', { filename: '123_01.png' }, { path: bad, type: 'image/png' }],
    ['uploadfile', { filename: 'page.html' }, { path: bad, type: 'text/html' }],
    ['confirmPLRImg', { filenames: ['../../escape.png'], InventoryIDs: [123], InventoryNumber: '560-12345' }]
  ];
  for (const [action, body, file] of inputs) {
    const c = controller(action, body, undefined, file);
    assert.notEqual(await c.__before(), false); await c[action + 'Action']();
    assert.equal(c.ctx.status, 400, action);
  }
  assert.equal(fs.existsSync(root + '/escape.png'), false);
});
test('auth outages and forged identity headers fail closed', async () => {
  const previous = process.env.FILES_AUTH_URL;
  process.env.FILES_AUTH_URL = 'http://127.0.0.1:1/authorize';
  const c = controller('uploadPLRImg');
  try { assert.equal(await c.__before(), false); assert.equal(c.ctx.status, 503); }
  finally { process.env.FILES_AUTH_URL = previous; }
});
test('timeline PDF upload preserves the response path and blocks active file types', async () => {
  const p = root + '/fixture.pdf'; fs.writeFileSync(p, '%PDF-1.4\nfixture-only\n%%EOF');
  const c = controller('uploadfile', { filename: 'internal document.pdf' }, undefined, { path: p, type: 'application/pdf' });
  assert.notEqual(await c.__before(), false); await c.uploadfileAction();
  assert.ok(c.response.url.endsWith('.pdf'));
  assert.equal(fs.existsSync(roots.Timeline_Files + c.response.url.replace(/^\//, '')), true);
});
test('a symlink parent cannot create files or directories outside the configured root', async () => {
  const Policy = require('../src/service/fileUploadPolicy');
  const outside = root + '/outside'; fs.mkdirSync(outside);
  fs.symlinkSync(outside, roots.Timeline_Files + 'linked');
  await assert.rejects(Policy.save(roots.Timeline_Files, 'linked/new-directory/evil.txt', Buffer.from('x')), /outside storage/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('anonymous binary requests are denied before the payload parser is reached', async () => {
  const middleware = require('../src/middleware/file_authorization')();
  const ctx = { path: '/api/uploadPLRImg', method: 'POST', state: {}, get: () => '', set() {} };
  let parsed = false;
  await middleware(ctx, () => { parsed = true; });
  assert.equal(parsed, false); assert.equal(ctx.status, 401);
});
test('duplicate source images are rejected before any confirmation rename', async () => {
  const c = controller('uploadPLRImg', { filename: '789_01.png', InventoryIDs: '789' }, undefined, image());
  assert.notEqual(await c.__before(), false); await c.uploadPLRImgAction();
  const name = c.response.url;
  const d = controller('confirmPLRImg', { filenames: [name, name], InventoryIDs: [789], InventoryNumber: '560-12345A' });
  assert.notEqual(await d.__before(), false); await d.confirmPLRImgAction();
  assert.equal(d.ctx.status, 400);
  assert.equal(fs.existsSync(roots.PowerLink_R_Image + name), true);
});
test('legacy JSON confirmation sessions remain verified instead of bypassing auth', async () => {
  const c = controller('confirmPLRImg', { _token: 'granted-session-token' }, '');
  assert.notEqual(await c.__before(), false);
  assert.equal(c.ctx.state.fileUser.userid, 1);
});
