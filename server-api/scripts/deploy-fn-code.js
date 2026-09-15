#!/usr/bin/env node
/**
 * 只更新 meiyu-api 云函数代码包（SCF UpdateFunctionCode）
 * ------------------------------------------------------------
 * 用法：node scripts/deploy-fn-code.js [zipPath]
 *   默认 zipPath = C:\art-platform\output\meiyu-api.zip（由 output/zip_fn.py 打包）
 *
 * 设计原则（重要）：
 *   - 只调用 UpdateFunctionCode，只替换代码包；
 *   - 不改函数类型(Type=HTTP)、环境变量、超时、网关路由 → 零回归风险；
 *   - 凭证从 deploy/.fn_env.json 读取，不硬编码。
 *
 * 走 tencentcloud-sdk-nodejs-common 的通用 AbstractClient 直连 scf 端点，
 * 无需额外安装 tencentcloud-sdk-nodejs-scf。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ZIP = process.env.FN_ZIP || 'C:\\art-platform\\output\\meiyu-api.zip';
const ZIP_PATH = process.argv[2] || DEFAULT_ZIP;
const ENV_FILE = path.join(ROOT, 'deploy', '.fn_env.json');
const FUNCTION_NAME = process.env.FN_NAME || 'meiyu-api';

(async () => {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error('❌ 未找到代码包:', ZIP_PATH);
    process.exit(1);
  }
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));

  const TencentCloudCommon = require('tencentcloud-sdk-nodejs-common');
  const AbstractClient =
    TencentCloudCommon.AbstractClient ||
    (TencentCloudCommon.common && TencentCloudCommon.common.AbstractClient);
  if (!AbstractClient) {
    console.error('❌ 未找到 AbstractClient，导出键:', Object.keys(TencentCloudCommon).join(','));
    process.exit(1);
  }

  class ScfClient extends AbstractClient {
    constructor(cfg) {
      super('scf.tencentcloudapi.com', '2018-04-16', cfg);
    }
    UpdateFunctionCode(req, cb) {
      return this.request('UpdateFunctionCode', req, cb);
    }
    GetFunction(req, cb) {
      return this.request('GetFunction', req, cb);
    }
  }

  const client = new ScfClient({
    credential: {
      secretId: env.TENCENT_SECRET_ID,
      secretKey: env.TENCENT_SECRET_KEY
    },
    region: env.TENCENT_REGION || 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 120 } }
  });

  const zip = fs.readFileSync(ZIP_PATH);
  const b64 = zip.toString('base64');
  console.log(
    `📦 ${FUNCTION_NAME} 代码包 ${(zip.length / 1024 / 1024).toFixed(2)}MB → base64 ${(
      b64.length / 1024 / 1024
    ).toFixed(2)}MB`
  );

  const req = {
    FunctionName: FUNCTION_NAME,
    Namespace: env.TENCENT_ENV_ID,
    Code: { ZipFile: b64 }
  };

  const res = await client.UpdateFunctionCode(req);
  console.log('✅ UpdateFunctionCode OK');
  console.log('   RequestId:', res.RequestId);
  if (res.CodeSize !== undefined) console.log('   CodeSize:', res.CodeSize);
  if (res.LastModified) console.log('   LastModified:', res.LastModified);

  const info = await client.GetFunction({
    FunctionName: FUNCTION_NAME,
    Namespace: env.TENCENT_ENV_ID
  });
  const cfg = (info && info.Configuration) || {};
  console.log('   Runtime:', cfg.Runtime, '| Type:', cfg.FunctionType || cfg.Type || '-');
  if (cfg.Environment && cfg.Environment.Variables) {
    console.log('   envKeys:', Object.keys(cfg.Environment.Variables).join(','));
  }
  console.log('   Timeout:', cfg.Timeout, '| MemorySize:', cfg.MemorySize, '| Status:', cfg.Status);
})().catch((e) => {
  console.error('❌ 部署失败:', e.code || '', e.message || e);
  process.exit(1);
});
