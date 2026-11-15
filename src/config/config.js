// default config
const path = require('path');
const storage = process.env.FILES_STORAGE_ROOT || path.join(think.ROOT_PATH, 'www/static');
module.exports = {
  workers: 1,
  host: process.env.FILES_HOST || undefined,
  port: Number(process.env.FILES_PORT || 9000), // server port
  'XPoweredBy':'Acuinsight files Sever',
  FilePath:{
    PowerLink_R_Image: path.join(storage, 'original_imgs_upload'),
    PowerLink_Record_Image: path.join(storage, 'rack_record_upload'),
    Timeline_Files: path.join(storage, 'timeline_upload')
  }
};
