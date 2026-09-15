#!/usr/bin/env node
/**
 * 组装 CloudBase HTTP 云函数部署包（meiyu-api）
 * ------------------------------------------------------------
 * 用法：node scripts/sync-fn.js
 *
 * 作用：把 server-api 的 Express 源码与生产依赖同步到
 *   deploy/cloudfunctions/meiyu-api/（自包含函数包）：
 *   1. 复制 src/            → meiyu-api/src/
 *   2. 复制 scripts/schema.sql → meiyu-api/scripts/（如需 DB 初始化参考）
 *   3. 复制 package.json    → meiyu-api/package.json（生产依赖字段）
 *   4. 复制 node_modules/   → meiyu-api/node_modules/（HTTP 函数不自动装依赖）
 *
 * 幂等：每次全量覆盖 src 与 node_modules，保证与 server-api 一致。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FN_DIR = path.join(ROOT, 'deploy', 'cloudfunctions', 'meiyu-api');
const SRC_DIR = path.join(ROOT, 'src');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const NM_DIR = path.join(ROOT, 'node_modules');

const dst = (p) => path.join(FN_DIR, p);

/** 递归复制目录（存在则先删除目标，避免残留旧文件） */
function copyDirClean(src, dest, label) {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log(`✅ ${label}: ${src} → ${dest}`);
}

/** 复制单文件 */
function copyFile(src, dest, label) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`✅ ${label}: ${src} → ${dest}`);
}

console.log('=== 组装 meiyu-api HTTP 云函数部署包 ===\n');

// 1. 源码
if (fs.existsSync(SRC_DIR)) {
  copyDirClean(SRC_DIR, dst('src'), 'src');
} else {
  console.error('❌ 未找到 src 目录:', SRC_DIR);
  process.exit(1);
}

// 2. schema.sql（可选参考）
const schemaSrc = path.join(SCRIPTS_DIR, 'schema.sql');
if (fs.existsSync(schemaSrc)) {
  copyFile(schemaSrc, dst('scripts/schema.sql'), 'schema.sql');
}

// 3. package.json（生产依赖）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const fnPkg = {
  name: 'meiyu-api',
  version: pkg.version || '1.0.0',
  private: true,
  description: '美育成果展示与交流平台 - 后端（CloudBase HTTP 云函数）',
  main: 'index.js',
  type: 'commonjs',
  dependencies: pkg.dependencies || {}
};
fs.writeFileSync(dst('package.json'), JSON.stringify(fnPkg, null, 2) + '\n');
console.log('✅ package.json（生产依赖）已生成');

// 4. node_modules（增量同步：目标存在则逐文件覆盖补齐；不整目录删除，避免批量删除风险）
if (fs.existsSync(NM_DIR)) {
  console.log('\n⏳ 同步 node_modules（增量覆盖，请稍候）...');
  fs.cpSync(NM_DIR, dst('node_modules'), {
    recursive: true,
    force: true,
    errorOnExist: false
  });
  console.log('✅ node_modules 同步完成');
} else {
  console.warn('⚠️ server-api/node_modules 不存在，请先 npm install');
}

console.log('\n=== 组装完成 ===');
console.log('函数目录:', FN_DIR);
console.log('下一步（二选一）：');
console.log('  A) 只更新线上代码包（推荐，不动函数类型/环境变量/网关路由）：');
console.log('     python scripts/pack-fn.py && node scripts/deploy-fn-code.js');
console.log('  B) 控制台上传 deploy/cloudfunctions/ 目录\n');
