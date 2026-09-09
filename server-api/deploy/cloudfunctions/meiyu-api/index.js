/**
 * 美育平台后端 - CloudBase HTTP 云函数入口
 * ------------------------------------------------------------
 * 部署形态：HTTP 云函数（Type=HTTP），由 scf_bootstrap 启动，
 * 要求服务监听 9000 端口（scf_bootstrap 中 export PORT=9000）。
 *
 * 本函数包为「自包含」目录（由 scripts/sync-fn.js 从 server-api 组装）：
 *   ├── index.js          ← 本入口
 *   ├── scf_bootstrap
 *   ├── package.json      ← 生产依赖清单
 *   ├── node_modules/     ← 生产依赖（随包上传，HTTP 函数不自动装依赖）
 *   └── src/              ← Express 源码副本（组装时同步，勿手改）
 *
 * app.js 顶层 app.listen(PORT) 在 require 时启动；PORT=9000 由
 * scf_bootstrap 注入，故这里无需二次 listen。
 *
 * 数据访问：src/utils/config/db.js
 *   - PG_HOST 为空 → cloudbase-openapi 通道（TENCENT_SECRET_ID/KEY + ExecutePGSql）
 *   - 密钥一律来自云函数环境变量，不写入代码
 */

require('./src/app');
