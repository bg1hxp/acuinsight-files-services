'use strict';
const http = require('http');
const https = require('https');
const ACTIONS = ['uploadfile', 'uploadPLRImg', 'uploadPLRRecordImg', 'confirmPLRImg'];

function actionForPath(path) {
  return ACTIONS.find(action => path.toLowerCase() === ('/api/' + action).toLowerCase());
}

function authorize(token, action) {
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) {
    return Promise.reject(Object.assign(new Error('Sign in to continue'), { status: 401 }));
  }
  return new Promise((resolve, reject) => {
    const unavailable = () => reject(Object.assign(new Error('File permissions could not be verified'), { status: 503 }));
    let url;
    try { url = new URL(process.env.FILES_AUTH_URL || 'http://thinkjs:8889/management/fileAccess/authorize'); } catch (_) { unavailable(); return; }
    if (!['http:', 'https:'].includes(url.protocol)) { unavailable(); return; }
    const body = JSON.stringify({ action });
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', headers: { token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 8192) req.destroy(new Error('Response too large')); });
      res.on('error', unavailable);
      res.on('end', () => {
        if ([401, 403].includes(res.statusCode)) {
          reject(Object.assign(new Error(res.statusCode === 401 ? 'Your session expired or is unavailable' : 'You do not have permission to access these files'), { status: res.statusCode }));
          return;
        }
        try {
          const result = JSON.parse(data);
          if (res.statusCode !== 200 || result.errno !== 0 || !result.data || result.data.authorized !== true || !/^\d+$/.test(String(result.data.userid))) return unavailable();
          resolve(result.data);
        } catch (_) { unavailable(); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Authorization timed out')), 4000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', unavailable);
    req.end(body);
  });
}
module.exports = { actionForPath, authorize };
