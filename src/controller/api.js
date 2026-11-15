const Base = require('./base');
const fs = require('fs').promises;
const crypto = require('crypto');
const moment = require('moment');
const Access = require('../service/fileAuthorization');
const Policy = require('../service/fileUploadPolicy');

module.exports = class extends Base {
  async __before() {
    this.ctx.set('Cache-Control', 'no-store');
    const action = Access.actionForPath(this.ctx.path);
    if (!action) return this.reject(404, 'Unknown file operation');
    if (this.ctx.method !== 'POST') return this.reject(405, 'Use POST');
    if (this.ctx.state.fileAction === action && this.ctx.state.fileUser) return;
    try {
      this.ctx.state.fileUser = await Access.authorize(this.header('token') || this.post('_token'), action);
    } catch (error) {
      return this.reject(error.status || 503, error.message);
    }
  }

  reject(status, message) {
    this.ctx.status = status;
    this.json({ errno: status, errmsg: message });
    return false;
  }

  async uploadfileAction() {
    try {
      const { bytes, ext } = await Policy.upload(this.file('file'), this.post('filename'), false);
      const filename = crypto.createHash('md5').update(bytes).digest('hex') + '.' + ext;
      const name = moment().format('YYYY/WW/') + filename;
      await Policy.save(think.config('FilePath').Timeline_Files, name, bytes);
      return this.json({ url: '/' + name });
    } catch (error) { return this.reject(error.status || 500, error.status ? error.message : 'File could not be saved'); }
  }

  async uploadPLRImgAction() {
    try {
      const filename = this.post('filename');
      const ids = Policy.ids(this.post('InventoryIDs'));
      const { bytes } = await Policy.upload(this.file('file'), filename);
      const suffix = filename.split('_').pop();
      if (!/^\d{1,3}\.(jpg|jpeg|png)$/i.test(suffix)) throw Policy.bad('Invalid image sequence');
      const prefix = 'temp_#_' + Date.now() + '@';
      for (const id of ids) await Policy.save(think.config('FilePath').PowerLink_R_Image, prefix + id + '_' + suffix, bytes);
      return this.json({ url: prefix + filename });
    } catch (error) { return this.reject(error.status || 500, error.status ? error.message : 'Image could not be saved'); }
  }

  async confirmPLRImgAction() {
    try {
      const { filenames, InventoryIDs, InventoryNumber } = this.post();
      const ids = Policy.ids(InventoryIDs);
      if (!Array.isArray(filenames) || !filenames.length || filenames.length > 100 || typeof InventoryNumber !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(InventoryNumber)) throw Policy.bad('Invalid image confirmation');
      const root = think.config('FilePath').PowerLink_R_Image;
      const moves = [];
      for (let index = 0; index < filenames.length; index++) {
        const name = Policy.basename(filenames[index]);
        if (!/^temp_#_\d+@[^@]+_\d{1,3}\.(jpg|jpeg|png)$/i.test(name)) throw Policy.bad('Invalid temporary image');
        for (const id of ids) {
          const oldName = name.replace(/@(.*?)_/, '@' + id + '_');
          const serial = String(index + 6).padStart(2, '0') + (index === filenames.length - 1 ? '_end' : '');
          const targetName = InventoryNumber + '+' + id + '_' + serial + '.' + Policy.filename(name);
          const source = await Policy.contained(root, oldName, true);
          if (!(await fs.lstat(source)).isFile()) throw Policy.bad('Invalid temporary image');
          moves.push([source, await Policy.contained(root, targetName)]);
        }
      }
      if (new Set(moves.map(move => move[0])).size !== moves.length) throw Policy.bad('Duplicate temporary images');
      for (const [source, target] of moves) await fs.rename(source, target);
      return this.json(1);
    } catch (error) { return this.reject(error.status || 500, error.status ? error.message : 'Images could not be confirmed'); }
  }

  async uploadPLRRecordImgAction() {
    try {
      const filename = this.post('filename');
      const { bytes } = await Policy.upload(this.file('file'), filename);
      const name = moment().format('YYYY/WW/') + filename;
      await Policy.save(think.config('FilePath').PowerLink_Record_Image, name, bytes);
      return this.json({ url: '/' + name });
    } catch (error) { return this.reject(error.status || 500, error.status ? error.message : 'Record image could not be saved'); }
  }
};

async function simulateDBTime(timer) {
  return new Promise((res, rej) => {
    setTimeout(() => {
      console.log('simulateDBTime', timer);
      res('ok1');
    }, timer);
  });
}
