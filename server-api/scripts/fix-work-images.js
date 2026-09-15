/**
 * 修复作品图片：把 images 里的「不可用地址」全部转成自建云存储 URL
 * ------------------------------------------------------------
 * 处理两类坏数据：
 *   1) picsum.photos 国外图床（国内网络加载不出）→ 下载后转存 pgstore 公共桶 art-works
 *   2) wxfile://tmp_xxx（小程序本地临时路径，换设备即失效）→ 用同主题图片替换
 *
 * 运行：node scripts/fix-work-images.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/utils/config/db');

const ENV_ID = process.env.TENCENT_ENV_ID;
const BUCKET = process.env.PG_STORAGE_BUCKET || 'art-works';
const TCB = path.resolve(__dirname, '../../admin-web/node_modules/.bin/tcb.cmd');
const PUBLIC_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/storages/object/${BUCKET}`;
const TMP = path.join(os.tmpdir(), 'art-img-fix');

fs.mkdirSync(TMP, { recursive: true });

/** 下载到本地临时文件 */
async function download(url, file) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  fs.writeFileSync(file, Buffer.from(res.data));
  return fs.statSync(file).size;
}

/** 上传到 pgstore 公共桶 */
function upload(localFile, key) {
  const cmd = `"${TCB}" storage objects upload "${localFile}" "${key}" -b ${BUCKET} --env-id ${ENV_ID}`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}

(async () => {
  console.log('='.repeat(64));
  console.log('  修复作品图片 → 自建云存储');
  console.log(`  数据通道: ${db.mode()} | bucket: ${BUCKET}`);
  console.log('='.repeat(64));

  const { rows } = await db.query('SELECT id, title, category, images FROM works ORDER BY id');
  let fixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const images = Array.isArray(row.images) ? row.images : [];
    if (!images.length) {
      console.log(`- #${row.id} ${row.title}：images 为空，跳过`);
      skipped++;
      continue;
    }

    const next = [];
    for (let i = 0; i < images.length; i++) {
      const src = String(images[i] || '');
      const isBad = /^wxfile:\/\//i.test(src) || /^https?:\/\/([a-z0-9-]+\.)?picsum\.photos/i.test(src);
      if (!isBad) {
        next.push(src);
        continue;
      }

      const key = `works/${row.id}-${i}-${Date.now().toString(36)}.jpg`;
      const local = path.join(TMP, `${row.id}-${i}.jpg`);

      try {
        let sourceUrl = src;
        if (/^wxfile:\/\//i.test(src)) {
          // 本地临时路径已失效：按作品 id 取一张稳定的同主题图替代
          sourceUrl = `https://picsum.photos/seed/artfix-${row.id}/800/1060`;
          console.log(`  ↻ #${row.id} ${row.title}：本地临时路径 → 替换为真实图片`);
        }
        const size = await download(sourceUrl, local);
        upload(local, key);
        const url = `${PUBLIC_BASE}/${key}`;
        next.push(url);
        console.log(`  ✓ #${row.id} ${row.title} [${i}] ${size}B → ${key}`);
      } catch (e) {
        console.log(`  ✗ #${row.id} ${row.title} [${i}] 处理失败: ${String(e.message).slice(0, 120)}`);
        next.push(src); // 失败保留原值，避免丢数据
      }
    }

    const changed = JSON.stringify(next) !== JSON.stringify(images);
    if (changed) {
      await db.query('UPDATE works SET images = $1, updated_at = NOW() WHERE id = $2', [next, row.id]);
      fixed++;
    } else {
      skipped++;
    }
  }

  console.log('─'.repeat(64));
  console.log(`  已修复 ${fixed} 件，无需修改 ${skipped} 件`);

  // 抽验第一条 URL 是否公开可读
  const probe = await db.query(`SELECT images->>0 AS u FROM works WHERE images->>0 LIKE 'https://${ENV_ID}.%' LIMIT 1`);
  if (probe.rows[0]) {
    const u = probe.rows[0].u;
    try {
      const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 20000 });
      console.log(`  公开可读校验: HTTP ${r.status}, ${r.data.length} bytes, content-type=${r.headers['content-type']}`);
    } catch (e) {
      console.log(`  ✗ 公开可读校验失败: ${String(e.message).slice(0, 160)}`);
    }
  }
  console.log('='.repeat(64));
  process.exit(0);
})().catch((e) => {
  console.error('  ❌ 修复失败:', e.message);
  process.exit(1);
});
