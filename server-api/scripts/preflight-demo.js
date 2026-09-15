#!/usr/bin/env node
/**
 * 答辩/演示前自检（只读，不改任何数据）
 * ------------------------------------------------------------
 * 用法：node scripts/preflight-demo.js
 *
 * 覆盖「A 方案（真机调试演示）」的完整前置条件：
 *   1. 后端活性        GET  /work/list           → 200 且非空
 *   2. 详情接口        GET  /work/detail?id=...  → 200 且 images 非空
 *   3. 图片域名可达    HEAD 首张图片 URL          → 200（downloadFile 用）
 *   4. 登录真通道      POST /user/login 空 body   → 400 缺少 code（演示分支必须已关）
 *   5. 微信凭证有效    直连微信网关假 code 探测    → 40029（凭证被接受）
 *   6. 管理端可登录    POST /user/login-password  → 200 role=admin（要能发认定）
 *   7. 账号认定状态    查 users.bind_status 分布 + 列出待认定申请
 *
 * 退出码：0 = 全绿可演示；1 = 有 FAIL 项，需先处理。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../src/utils/config/db');

const BASE =
  process.env.API_BASE ||
  'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';

/**
 * 微信凭证的真值在 `deploy/.fn_env.json`（= 云函数里实际生效的那份），
 * **不能读本地 `.env`** —— 后者是给本地跑服务用的，里面是 `your_wx_appid` 占位符，
 * 拿它去探针会被微信网关回 40013，造成「凭证失效」的假警报。
 */
const PLACEHOLDER = /^(your_|xxx|placeholder)/i;
function wechatCreds() {
  let appid = '';
  let secret = '';
  try {
    const fnEnv = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../deploy/.fn_env.json'), 'utf8')
    );
    appid = fnEnv.WECHAT_APPID || '';
    secret = fnEnv.WECHAT_SECRET || '';
  } catch (e) {
    /* 读不到就退回环境变量 */
  }
  if (!appid || PLACEHOLDER.test(appid)) appid = process.env.WECHAT_APPID || '';
  if (!secret || PLACEHOLDER.test(secret)) secret = process.env.WECHAT_SECRET || '';
  return { appid, secret, valid: Boolean(appid && secret && !PLACEHOLDER.test(appid) && !PLACEHOLDER.test(secret)) };
}

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}
function info(label, detail) {
  console.log(`  ----  ${label}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  console.log('\n================ 演示前自检 ================');
  console.log(`后端地址：${BASE}\n`);

  /* 1 + 2. 后端活性 / 详情 / 图片 URL --------------------------------- */
  console.log('[1] 后端接口');
  let firstWork = null;
  try {
    const r = await fetch(`${BASE}/work/list?limit=3`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const list = (j && j.data && (j.data.list || j.data.rows || j.data)) || [];
    const n = Array.isArray(list) ? list.length : 0;
    record(r.status === 200 && n > 0, 'GET /work/list 返回 200 且有数据', `HTTP ${r.status}，${n} 条`);
    if (n) firstWork = list[0];
  } catch (e) {
    record(false, 'GET /work/list', e.message);
  }

  if (firstWork && firstWork.id) {
    try {
      const r = await fetch(`${BASE}/work/detail?id=${firstWork.id}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const imgs = (j && j.data && j.data.images) || [];
      record(r.status === 200 && imgs.length > 0, `GET /work/detail?id=${firstWork.id} 有图片`,
        `HTTP ${r.status}，images=${imgs.length}`);

      if (imgs.length) {
        const url = typeof imgs[0] === 'string' ? imgs[0] : imgs[0].url || imgs[0].src;
        if (url && /^https?:/.test(url)) {
          const h = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
          const host = new URL(url).host;
          record(h.ok, '作品图片真实可下载（downloadFile 域名）', `HTTP ${h.status} @ ${host}`);
        } else {
          record(false, '作品图片 URL', `非 http(s)：${String(url).slice(0, 60)}`);
        }
      }
    } catch (e) {
      record(false, 'GET /work/detail', e.message);
    }
  } else {
    info('跳过详情/图片检查', '列表为空');
  }

  /* 3. 登录真通道 ----------------------------------------------------- */
  console.log('\n[2] 登录通道');
  try {
    const r = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json();
    const ok = j.code === 400 && /code/i.test(String(j.message || ''));
    record(ok, '微信登录已切真实通道（演示分支关闭）', `code=${j.code} msg=${j.message}`);
    if (!ok && j.code === 200) {
      info('注意', '仍在演示分支 → 所有人会登录成同一个账号，需检查 WECHAT_APPID/SECRET');
    }
  } catch (e) {
    record(false, 'POST /user/login', e.message);
  }

  /* 4. 微信凭证有效性 -------------------------------------------------- */
  console.log('\n[3] 微信凭证（源：deploy/.fn_env.json = 云函数实际生效值）');
  const wx = wechatCreds();
  if (!wx.valid) {
    info('跳过', '未找到真实凭证（本地 .env 为占位符，属正常）');
  } else {
    console.log(`  ----  AppID=${wx.appid}`);
    try {
      const u = `https://api.weixin.qq.com/sns/jscode2session?appid=${wx.appid}&secret=${wx.secret}&js_code=PREFLIGHT_PROBE&grant_type=authorization_code`;
      const j = await (await fetch(u, { signal: AbortSignal.timeout(15000) })).json();
      record(j.errcode === 40029, '微信网关接受凭证（40029=仅 code 无效）',
        `errcode=${j.errcode} ${j.errmsg || ''}`);
      if (j.errcode === 40013) info('提示', 'AppID 无效 — 与小程序 project.config.json 的 appid 不一致？');
      if (j.errcode === 40125) info('提示', 'AppSecret 无效 — 可能已在公众平台重置过');
    } catch (e) {
      record(false, '微信网关探测', e.message);
    }
  }

  /* 5. 管理端登录 ------------------------------------------------------ */
  console.log('\n[4] 管理后台');
  try {
    const r = await fetch(`${BASE}/user/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json();
    record(j.code === 200 && j.data && j.data.userInfo && j.data.userInfo.role === 'admin',
      'admin 账密登录可用（认定审核入口）', `code=${j.code} role=${j.data && j.data.userInfo && j.data.userInfo.role}`);
  } catch (e) {
    record(false, 'POST /user/login-password', e.message);
  }

  /* 6. 数据与认定状态 -------------------------------------------------- */
  console.log('\n[5] 数据库与认定状态');
  try {
    const w = await query('SELECT COUNT(*)::int AS n FROM works');
    info('作品总数', String(w.rows[0].n));

    const u = await query(
      "SELECT COALESCE(bind_status,'(null)') AS bs, COUNT(*)::int AS n FROM users GROUP BY 1 ORDER BY 2 DESC"
    );
    const dist = u.rows.map((r) => `${r.bs}=${r.n}`).join('  ');
    console.log(`  ---- 账号认定分布：${dist}`);

    const pend = await query(
      `SELECT id, COALESCE(real_name,'-') AS rn, COALESCE(student_id,'-') AS sid, bind_apply_at
       FROM users WHERE bind_status = 'pending' ORDER BY bind_apply_at DESC LIMIT 20`
    );
    if (pend.rows.length) {
      console.log(`  ---- ⚠ 有 ${pend.rows.length} 条待认定申请（演示前必须在后台点通过）：`);
      pend.rows.forEach((r) => console.log(`         #${r.id} ${r.rn} / ${r.sid}`));
      record(true, '存在待认定申请（已列出，需人工通过）', `${pend.rows.length} 条`);
    } else {
      info('待认定申请', '无');
    }

    const approved = u.rows.find((r) => r.bs === 'approved');
    record(Boolean(approved && approved.n > 0), '存在已认定账号（可用于演示发布）',
      approved ? `approved=${approved.n}` : '无');
  } catch (e) {
    record(false, '数据库查询', e.message);
  }

  /* 汇总 -------------------------------------------------------------- */
  const failed = results.filter((r) => !r.ok);
  console.log('\n================ 结论 ================');
  console.log(`通过 ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log('FAIL 项：');
    failed.forEach((f) => console.log(`  ✗ ${f.label}${f.detail ? ' — ' + f.detail : ''}`));
    console.log('\n⚠ 有未通过项，先处理再演示。');
    process.exit(1);
  }
  console.log('✓ 全部通过。演示方式：开发者工具「真机调试」（不校验域名，可看 Console）；');
  console.log('  若用「预览」，扫码后需点右上角 … →「开发调试」开关打开，否则域名校验会拦截请求。');
})().catch((e) => {
  console.error('\n自检脚本异常:', e.message);
  process.exit(1);
});
