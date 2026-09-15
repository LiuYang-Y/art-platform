#!/usr/bin/env node
/**
 * 图片上传接口回归验证（线上真实接口）
 *  1. 服务活性
 *  2. 不带 token → 期望 401（这是小程序端曾经的故障表现）
 *  3. 带 token 小图 → 期望 200
 *  4. 带 token 超限大图 → 期望 413 + 中文可操作提示
 *  5. 发布作品完整链路 → 期望 200（跑完清理）
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../src/utils/config/db');

const BASE = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} -> ${JSON.stringify(extra)}`);
  }
}

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

async function upload(token, buf, name) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name);
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const r = await fetch(BASE + '/work/upload', { method: 'POST', headers, body: fd });
  let j = null;
  try {
    j = await r.json();
  } catch (e) {
    /* ignore */
  }
  return { status: r.status, body: j };
}

(async () => {
  console.log('1. 服务活性');
  const l = await fetch(BASE + '/work/list?limit=1');
  check('GET /work/list 200', l.status === 200, l.status);

  const lg = await fetch(BASE + '/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const lj = await lg.json();
  const token = lj.data && lj.data.token;
  const uid = lj.data && lj.data.userInfo && lj.data.userInfo.userId;
  check('登录拿到 token', !!token, lj);

  console.log('2. 无 token 上传（复现小程序端旧故障）');
  const r0 = await upload(null, JPG, 'noauth.jpg');
  check('无 token → 401', r0.status === 401, r0.body);

  console.log('3. 带 token 上传小图');
  const r1 = await upload(token, JPG, 'ok.jpg');
  check('带 token → 200 且返回 url', r1.status === 200 && !!(r1.body.data && r1.body.data.url), r1.body);
  const goodUrl = r1.body.data && r1.body.data.url;

  console.log('4. 超限大图（4MB + 1KB）');
  const big = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x41);
  const r2 = await upload(token, big, 'big.jpg');
  check(
    '超限 → 413 且提示可操作',
    r2.status === 413 && /体积过大/.test((r2.body && r2.body.message) || ''),
    r2.body
  );

  console.log('5. 发布作品完整链路');
  const cr = await fetch(BASE + '/work/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: '上传回归测试', category: 'other', images: [goodUrl], description: 'e2e' })
  });
  const cj = await cr.json();
  check('发布成功', cr.status === 200 && cj.code === 200, cj);
  const newId = cj.data && cj.data.workId;
  if (newId) {
    await db.query('DELETE FROM works WHERE id = $1', [newId]);
    const gone = await db.queryOne('SELECT id FROM works WHERE id = $1', [newId]);
    check('测试作品已清理', !gone, newId);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('异常:', e);
  process.exit(1);
});
