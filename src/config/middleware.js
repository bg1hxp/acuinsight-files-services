const path = require('path');
const isDev = think.env === 'development';

module.exports = [
  // Shares terminate before development request logging can record bearer URLs.
  {
    handle: 'daily_document_share'
  },
  {
    handle: 'meta',
    options: {
      logRequest: isDev,
      sendResponseTime: isDev
    }
  },
  {
    handle: 'private_file_access'
  },
  {
    handle: 'resource',
    enable: true,  // ops: always serve /static/ (saw211 跑 NODE_ENV=dev,我们 prod 也必须开)
    options: {
      root: process.env.FILES_STORAGE_ROOT ? path.dirname(process.env.FILES_STORAGE_ROOT) : path.join(think.ROOT_PATH, 'www'),
      publicPath: /^\/(static|favicon\.ico)/
    }
  },
  {
    handle: 'trace',
    enable: !think.isCli,
    options: {
      debug: isDev
    }
  },
  {
    handle: 'file_authorization'
  },
  {
    handle: 'payload',
    options: {
      keepExtensions: true,
      limit: '5mb'
    }
  },
  {
    handle: 'router',
    options: {}
  },
  'logic',
  'controller'
];
