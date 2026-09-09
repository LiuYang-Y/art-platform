const tcb = require('@cloudbase/node-sdk');
const dotenv = require('dotenv');

dotenv.config();

// 初始化 CloudBase 实例
const app = tcb.init({
  env: process.env.TENCENT_ENV_ID,
  secretId: process.env.TENCENT_SECRET_ID,
  secretKey: process.env.TENCENT_SECRET_KEY
});

// 获取数据库实例与数据库操作符
const db = app.database();
const _ = db.command;

module.exports = {
  app,
  db,
  _
};