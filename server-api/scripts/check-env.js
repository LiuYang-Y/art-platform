/**
 * 环境自检脚本
 * ------------------------------------------------------------
 * 用途：填完密钥后先跑这个，快速确认「能不能连上云」，不用动数据库
 *
 * 运行：node scripts/check-env.js
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const tcb = require('tencentcloud-sdk-nodejs-tcb');
const TcbClient = tcb.tcb.v20180608.Client;

const PLACEHOLDERS = [
  'please_fill_in',
  'your_wx_appid',
  'your_wx_secret',
  'your_secret_key',
  '请填写'
];

/**
 * 必填项及其用途说明
 * category:
 *   core   —— 云端连通必需，缺失则中断检查
 *   wechat —— 仅微信登录需要，缺失不影响建集合/建索引
 */
const REQUIRED = [
  { key: 'TENCENT_ENV_ID', desc: 'CloudBase 环境 ID', category: 'core' },
  { key: 'TENCENT_SECRET_ID', desc: '腾讯云 SecretId（AKID 开头）', category: 'core' },
  { key: 'TENCENT_SECRET_KEY', desc: '腾讯云 SecretKey（32 位）', category: 'core' },
  { key: 'JWT_SECRET', desc: 'JWT 签名密钥', category: 'core' },
  { key: 'WECHAT_APPID', desc: '小程序 AppID（wx 开头）', category: 'wechat' },
  { key: 'WECHAT_SECRET', desc: '小程序 AppSecret', category: 'wechat' }
];

const isPlaceholder = (value) =>
  !value || PLACEHOLDERS.some((p) => value.toLowerCase().includes(p.toLowerCase()));

function checkVariables() {
  console.log('\n【1/3】环境变量检查');
  console.log('─'.repeat(60));

  const missing = { core: [], wechat: [] };

  for (const item of REQUIRED) {
    const value = process.env[item.key] || '';
    if (isPlaceholder(value)) {
      console.log(`  ❌ ${item.key.padEnd(20)} 未填写  — ${item.desc}`);
      missing[item.category].push(item.key);
    } else {
      const masked =
        value.length > 8 ? `${value.slice(0, 6)}****${value.slice(-4)}` : '****';
      console.log(`  ✅ ${item.key.padEnd(20)} ${masked.padEnd(18)} — ${item.desc}`);
    }
  }

  return missing;
}

async function checkCloudApi() {
  console.log('\n【2/3】腾讯云 OpenAPI 连通性（密钥 + 环境）');
  console.log('─'.repeat(60));

  const client = new TcbClient({
    credential: {
      secretId: process.env.TENCENT_SECRET_ID,
      secretKey: process.env.TENCENT_SECRET_KEY
    },
    region: process.env.TENCENT_REGION || 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } }
  });

  try {
    const res = await client.DescribeEnvs({ EnvId: process.env.TENCENT_ENV_ID });
    const env = (res.EnvList || [])[0];

    if (!env) {
      console.log('  ⚠️  密钥有效，但未查到该环境，请核对 TENCENT_ENV_ID');
      return false;
    }

    console.log(`  ✅ 密钥校验通过`);
    console.log(`     环境 ID   : ${env.EnvId}`);
    console.log(`     环境名称  : ${env.Alias || env.Source || '-'}`);
    console.log(`     状态      : ${env.Status === 'NORMAL' ? '正常' : env.Status}`);
    return true;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('SecretId is not found')) {
      console.log('  ❌ SecretId 无效：该账号下不存在此 SecretId');
    } else if (msg.includes('signature') || msg.includes('could not be validated')) {
      console.log('  ❌ SecretKey 错误：SecretId 有效，但签名校验失败');
      console.log('     → 请确认填写的是 SecretKey，不是 APPID 或 SecretId');
    } else {
      console.log(`  ❌ 调用失败：${msg.slice(0, 120)}`);
    }
    return false;
  }
}

async function checkDatabase() {
  console.log('\n【3/3】云数据库读写连通性');
  console.log('─'.repeat(60));

  try {
    const { query, mode } = require('../src/utils/config/db');
    console.log(`     数据通道: ${mode() === 'pg-direct' ? 'pg 直连' : 'CloudBase OpenAPI'}`);

    const res = await query('SELECT COUNT(*)::int AS cnt FROM users');
    console.log(`  ✅ 数据库可访问，users 表现有 ${res.rows[0].cnt} 条记录`);
    return true;
  } catch (err) {
    const msg = err.message || '';
    console.log(`  ❌ 数据库访问失败：${msg.slice(0, 120)}`);
    if (msg.includes('secret') || msg.includes('SIGN_PARAM')) {
      console.log('     → 密钥问题，修好后再试');
    } else if (msg.includes('does not exist') || msg.includes('relation')) {
      console.log('     → 密钥已通，但表还没建，请执行: node scripts/init-db-pg.js');
    }
    return false;
  }
}

(async () => {
  console.log('='.repeat(60));
  console.log('  环境自检 · 高校美育成果展示与交流平台');
  console.log('='.repeat(60));

  const missing = checkVariables();

  if (missing.core.length > 0) {
    console.log(`\n⚠️  核心配置缺失 ${missing.core.length} 项，云端检查已跳过`);
    console.log('   补齐后重跑本脚本；全部通过再执行: node scripts/init-db-pg.js\n');
    process.exit(1);
  }

  const apiOk = await checkCloudApi();
  const dbOk = apiOk ? await checkDatabase() : false;

  console.log('\n' + '='.repeat(60));
  if (apiOk && dbOk) {
    console.log('  ✅ 云端全通，数据库就绪');
  } else if (apiOk) {
    console.log('  ⚠️  密钥已通，数据库仍需处理（多半是表未创建）');
    console.log('     执行: node scripts/init-db-pg.js');
  } else {
    console.log('  ❌ 密钥未通过，请先修正 TENCENT_SECRET_ID / TENCENT_SECRET_KEY');
  }

  // 微信配置只影响登录接口，不阻塞建表
  if (missing.wechat.length > 0) {
    console.log(`  ⚠️  微信配置未填写（${missing.wechat.join('、')}）`);
    console.log('     不影响建表，但 /api/user/login 会报错');
  }
  console.log('='.repeat(60) + '\n');

  process.exit(apiOk ? 0 : 1);
})();
