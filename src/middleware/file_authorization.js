'use strict';
const Access = require('../service/fileAuthorization');

module.exports = () => async (ctx, next) => {
  const action = Access.actionForPath(ctx.path);
  if (!action) return next();
  ctx.set('Cache-Control', 'no-store');
  if (ctx.method !== 'POST') {
    ctx.status = 405;
    ctx.body = { errno: 405, errmsg: 'Use POST' };
    return;
  }
  const token = ctx.get('token');
  // Older open tabs put the confirmation token in JSON. The controller verifies
  // that bounded JSON body; binary upload bodies always require a header first.
  if (!token && action === 'confirmPLRImg') return next();
  try {
    ctx.state.fileUser = await Access.authorize(token, action);
    ctx.state.fileAction = action;
  } catch (error) {
    ctx.status = error.status || 503;
    ctx.body = { errno: ctx.status, errmsg: error.message };
    return;
  }
  return next();
};
