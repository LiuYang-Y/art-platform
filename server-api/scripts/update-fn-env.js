#!/usr/bin/env node
/**
 * 更新 meiyu-api 云函数的**部分环境变量**（安全合并，不覆盖其他项）
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/update-fn-env.js WECHAT_APPID=wxd724024dd3f03c44 WECHAT_SECRET=xxxxxxxx
 *
 * 设计要点：
 *   - SCF 的 UpdateFunctionConfiguration 传 Environment 会**整体替换**环境变量集合，
 *     因此先 GetFunction 读回现有变量，合并后再写回，避免丢掉 TENCENT_SECRET_KEY 等关键项；
 *   - 只改环境变量，不动函数类型 / 超时 / 代码包 → 零回归；
 *   - 写回后立即回读校验。
 */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.resolve(__dirname, '../deploy/.fn_env.json');
const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const FUNCTION_NAME = process.env.FN_NAME || 'meiyu-api';
const DRY = process.argv.includes('--dry-run');

/** 敏感值只显示长度，不落屏 */
function mask(v) {
  const s = String(v == null ? '' : v);
  if (!s) return '(空)';
  return `***(${s.length} 字符)`;
}

// 解析命令行 K=V（跳过以 -- 开头的开关）
const updates = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith('--')) return;
  const i = arg.indexOf('=');
  if (i > 0) updates[arg.slice(0, i)] = arg.slice(i + 1);
});

if (!Object.keys(updates).length) {
  console.error('用法：node scripts/update-fn-env.js KEY=VALUE [KEY2=VALUE2 ...] [--dry-run]');
  process.exit(1);
}

const TencentCloudCommon = require('tencentcloud-sdk-nodejs-common');
const AbstractClient =
  TencentCloudCommon.AbstractClient ||
  (TencentCloudCommon.common && TencentCloudCommon.common.AbstractClient);

class ScfClient extends AbstractClient {
  constructor(cfg) {
    super('scf.tencentcloudapi.com', '2018-04-16', cfg);
  }
  GetFunction(req, cb) {
    return this.request('GetFunction', req, cb);
  }
  UpdateFunctionConfiguration(req, cb) {
    return this.request('UpdateFunctionConfiguration', req, cb);
  }
}

const client = new ScfClient({
  credential: { secretId: env.TENCENT_SECRET_ID, secretKey: env.TENCENT_SECRET_KEY },
  region: env.TENCENT_REGION || 'ap-shanghai',
  profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 60 } }
});

(async () => {
  const before = await client.GetFunction({ FunctionName: FUNCTION_NAME, Namespace: env.TENCENT_ENV_ID });
  const vars = ((before.Environment && before.Environment.Variables) || []).map((v) => ({
    Key: v.Key,
    Value: v.Value
  }));
  console.log(`当前环境变量 ${vars.length} 项：`);
  vars.forEach((v) => console.log(`  ${v.Key} = ${mask(v.Value)}`));

  console.log('\n将更新：');
  Object.entries(updates).forEach(([k, v]) => console.log(`  ${k} = ${mask(v)}`));

  if (DRY) {
    console.log('\n[dry-run] 未执行写入。去掉 --dry-run 即真实生效。');
    return;
  }

  // 合并
  Object.entries(updates).forEach(([k, v]) => {
    const hit = vars.find((x) => x.Key === k);
    if (hit) hit.Value = v;
    else vars.push({ Key: k, Value: v });
  });

  await client.UpdateFunctionConfiguration({
    FunctionName: FUNCTION_NAME,
    Namespace: env.TENCENT_ENV_ID,
    Environment: { Variables: vars }
  });
  console.log('\n✅ UpdateFunctionConfiguration OK');

  const after = await client.GetFunction({ FunctionName: FUNCTION_NAME, Namespace: env.TENCENT_ENV_ID });
  const nowVars = (after.Environment && after.Environment.Variables) || [];
  console.log(`回读校验：${nowVars.length} 项，Type=${after.Type}，Timeout=${after.Timeout}s`);
  Object.keys(updates).forEach((k) => {
    const hit = nowVars.find((x) => x.Key === k);
    const ok = hit && hit.Value === updates[k];
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${k} 已写入`);
  });

  // 同步更新本地 deploy/.fn_env.json，保持两侧一致
  let changed = false;
  Object.entries(updates).forEach(([k, v]) => {
    if (env[k] !== v) {
      env[k] = v;
      changed = true;
    }
  });
  if (changed) {
    fs.writeFileSync(ENV_FILE, JSON.stringify(env, null, 2) + '\n', 'utf8');
    console.log('已同步本地 deploy/.fn_env.json');
  }
})().catch((e) => {
  console.error('失败:', e.code || '', e.message);
  process.exit(1);
});
