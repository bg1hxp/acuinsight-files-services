const Base = require("./base");

const fs = require("fs");
// const path = require("path");
const crypto = require('crypto');
const moment = require('moment');

const {
  PowerLink_R_Image=null,
  PowerLink_Record_Image=null,
  Timeline_Files=null
} = think.config('FilePath');

const rImag_temp_prefix = 'temp_#_';

// console.log(PowerLink_R_Image, PowerLink_Record_Image, Timeline_Files)

module.exports = class extends Base {

  indexAction() {
    return this.json({ Scope: 'OEM RIM SHOP TesT API' })
  }

  async uploadfileAction(){
    let { filename } = this.post();
    const file = this.file("file");
    const file_suffix = filename.split('.').pop();
    let filepath = Timeline_Files
    var buffer = fs.readFileSync(file.path);
    var fsHash = crypto.createHash('md5');
    fsHash.update(buffer);
    filename = fsHash.digest('hex') + '.' + file_suffix;
    const sub_path = moment().format('YYYY/WW/')
    filepath = `${filepath}${sub_path}`
    if( ! fs.existsSync(filepath) ){
      think.mkdir(filepath)
    }
    filepath = `${filepath}${filename}`
    filename = `/${sub_path}${filename}`
    let readStream = fs.createReadStream(file.path);
    let writeStream = fs.createWriteStream(filepath);
    readStream.pipe(writeStream);    

    return this.json({url:filename});
  }  


   /**
   * @description 支持 多R# 同时传一张图片，并根据 R#list、图片尾部的序号号 自动保存多份
   * @returns 
   */
  async uploadPLRImgAction() {
    let { filename, InventoryIDs } = this.post();

    const file = this.file("file");
    let filepath = PowerLink_R_Image
    let fileId = moment().format('x');
    let _tempPrefix = `${rImag_temp_prefix}${fileId}@`
    if (file.type === "image/jpeg" || file.type === "image/png") {
      if( ! fs.existsSync(filepath) ){
        think.mkdir(filepath)
      }

      let readStream = fs.createReadStream(file.path);

      InventoryIDs.split(',').forEach(item=>{
        let _index_filename = filename.split('_').pop();
        let _filename = `${_tempPrefix}${item}_${_index_filename}`
        let _filepath = `${filepath}${_filename}`
        let writeStream = fs.createWriteStream(_filepath);
        readStream.pipe(writeStream);
      })
      
    }
    return this.json({url:`${_tempPrefix}${filename}`});
    // return this.json({url:_filename});
  }

 /**
   * @description 使用 要保留的文件列表，来rename要保留的文件, 并重新按顺序排号, 文件名的规则： H#+R#_index.jpg/.png/.jpeg, 最后一张 : H#+R#_index_end.jpg/.png/.jpeg,
   * @returns 
   */
  async confirmPLRImgAction(){
    let { filenames=[], InventoryIDs=[], InventoryNumber='UNDEFINED' } = this.post();
    console.log(this.post())
    
    filenames.forEach((name, index) => {
      // temp_#_1671252890655@88974_04.png
      let _index_filename = '_' + name.split('_').pop();
      InventoryIDs.forEach(item=>{
        // let oldfileName = `${rImag_temp_prefix}${item}${_index_filename}`;
        // let serialNo = index<10 ? '0'+(index+6) : index+6;
        let oldfileName = name.replace(/@(.*?)_/, `@${item}_`)
        let serialNo = index+6;
        serialNo = serialNo < 10 ? '0' + serialNo : serialNo;
        if(index == filenames.length -1) serialNo = serialNo + '_end';
        let newfileName = `${InventoryNumber}+${item}_${serialNo}.${_index_filename.split('.').pop()}`;
        console.log( name, index, _index_filename,  item, oldfileName, newfileName)
        try {
          fs.renameSync(`${PowerLink_R_Image}${oldfileName}`,`${PowerLink_R_Image}${newfileName}`)
        } catch (error) {
          console.error('confirmPLRImgAction, rename error', error)
        }
      })
    });
    return this.json(1)
  }


  async uploadPLRRecordImgAction() {
    let { filename } = this.post();
    const file = this.file("file");
    console.log(file.path, file.type)

    let filepath = PowerLink_Record_Image
    console.log('filepath', filepath)

    if (file.type === "image/jpeg" || file.type === "image/png") {
      const sub_path = moment().format('YYYY/WW/')
      filepath = `${filepath}${sub_path}`
      if( ! fs.existsSync(filepath) ){
        think.mkdir(filepath)
      }
      filepath = `${filepath}${filename}`
      filename = `/${sub_path}${filename}`
      let readStream = fs.createReadStream(file.path);
      let writeStream = fs.createWriteStream(filepath);
      readStream.pipe(writeStream);
    }
    return this.json({url:filename});
  }

}

async function simulateDBTime(timer) {
  return new Promise((res, rej) => {
    setTimeout(() => {
      console.log('simulateDBTime', timer)
      res('ok1')
    }, timer);
  })
}
