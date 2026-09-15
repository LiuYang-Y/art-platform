#!/usr/bin/env node
/**
 * G-07 学号绑定认定 —— 线上端到端验证 v2（临时账号全流程，跑完自清理）
 *  1. 临时新账号（unbound）：发布/评论 → 期望 403
 *  2. 提交绑定 → pending：发布 → 期望 403（认定中）
 *  3. admin 待认定列表可见 → 驳回 → rejected 且学号释放
 *  4. 重新提交 → pending → 通过 → approved：可过发布门槛
 *  5. 存量认定账号（演示账号）：直接登记学号（无需再审）→ 还原
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const BASE = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';
const jwt = require('jsonwebtoken');
const db = require('../src/utils/config/db');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra ? '-> ' + JSON.stringify(extra) : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* ignore */
  }
  return { status: res.status, body: json };
}

(async () => {
  const OPENID = 'e2e_bind_temp_openid';
  const SID_A = 'E2E20260001';
  const SID_B = 'E2E20260002';

  // 准备：清理可能残留的临时账号，再新建（unbound 默认）
  await db.query('DELETE FROM users WHERE openid = $1', [OPENID]);
  const classRow = await db.queryOne('SELECT id FROM classes LIMIT 1');
  const uid = await db.insertReturningId(
    'users',
    ['openid', 'nick_name', 'role', 'class_id', 'created_at', 'updated_at'],
    [OPENID, 'E2E临时', 'student', classRow && classRow.id, new Date(), new Date()]
  );
  const token = jwt.sign({ userId: uid, role: 'student', openid: OPENID }, process.env.JWT_SECRET, {
    expiresIn: '1h'
  });

  const adminLogin = await call('POST', '/admin/login', {
    body: { username: 'admin', password: 'admin123' }
  });
  const adminToken = adminLogin.body?.data?.token;
  check('管理员登录', !!adminToken, adminLogin.body);

  console.log('1. 未绑定账号的写操作门槛');
  const bs0 = await call('GET', '/user/bind-status', { token });
  check('新账号 bindStatus=unbound', bs0.body?.data?.bindStatus === 'unbound', bs0.body);

  const c0 = await call('POST', '/work/create', {
    token,
    body: { title: '门槛测试', category: 'other', images: ['https://example.com/a.jpg'] }
  });
  check('未绑定发布被拦（403）', c0.status === 403 && /认定/.test(c0.body?.message || ''), c0.body);

  const cm0 = await call('POST', '/comment/add', {
    token,
    body: { workId: 110, content: '门槛测试' }
  });
  check('未绑定评论被拦（403）', cm0.status === 403, cm0.body);

  console.log('2. 提交绑定 → pending');
  const b1 = await call('POST', '/user/bind-student', {
    token,
    body: { studentId: SID_A, realName: '端到端' }
  });
  check('绑定申请提交成功', b1.body?.code === 200 && b1.body?.data?.bindStatus === 'pending', b1.body);

  const c1 = await call('POST', '/work/create', {
    token,
    body: { title: '门槛测试', category: 'other', images: ['https://example.com/a.jpg'] }
  });
  check('pending 发布被拦（403 认定中）', c1.status === 403 && /认定中/.test(c1.body?.message || ''), c1.body);

  console.log('3. 管理员驳回');
  const apps1 = await call('GET', '/admin/bind-applications?status=pending', { token: adminToken });
  const app1 = (apps1.body?.data?.list || []).find((r) => r.studentId === SID_A);
  check('待认定列表含申请', !!app1, apps1.body?.data?.list);

  const rej = await call('POST', '/admin/bind-audit', {
    token: adminToken,
    body: { userId: app1 && app1.id, action: 'reject', reason: '学号不存在' }
  });
  check('驳回成功', rej.body?.code === 200, rej.body);

  const bs1 = await call('GET', '/user/bind-status', { token });
  check('驳回后 rejected + 原因 + 学号释放',
    bs1.body?.data?.bindStatus === 'rejected' &&
      bs1.body?.data?.rejectReason === '学号不存在' &&
      bs1.body?.data?.studentId === '',
    bs1.body);

  console.log('4. 重新提交 → 通过');
  const b2 = await call('POST', '/user/bind-student', {
    token,
    body: { studentId: SID_B, realName: '端到端' }
  });
  check('驳回后可重新提交', b2.body?.code === 200, b2.body);

  const apps2 = await call('GET', '/admin/bind-applications?status=pending', { token: adminToken });
  const app2 = (apps2.body?.data?.list || []).find((r) => r.studentId === SID_B);
  const apr = await call('POST', '/admin/bind-audit', {
    token: adminToken,
    body: { userId: app2 && app2.id, action: 'approve' }
  });
  check('认定通过', apr.body?.code === 200, apr.body);

  const bs2 = await call('GET', '/user/bind-status', { token });
  check('认定后 approved + 学号正确',
    bs2.body?.data?.bindStatus === 'approved' && bs2.body?.data?.studentId === SID_B,
    bs2.body);

  const c2 = await call('POST', '/work/create', {
    token,
    body: { title: '', category: 'other', images: ['https://example.com/a.jpg'] }
  });
  check('认定后过门槛（缺标题 → 400 非 403）',
    c2.status === 400 && c2.body?.message?.includes('标题'), c2.body);

  // 学号唯一性：另一账号占用检查（临时账号再申请同一学号被拒——自身占用提示除外）
  const b3 = await call('POST', '/user/bind-student', {
    token,
    body: { studentId: SID_B }
  });
  check('已绑定学号不可重复提交', b3.status === 400, b3.body);

  console.log('5. 存量认定账号直接登记学号');
  const demoLogin = await call('POST', '/user/login', { body: {} });
  const demoToken = demoLogin.body?.data?.token;
  const demoUid = demoLogin.body?.data?.userInfo?.userId;
  const b4 = await call('POST', '/user/bind-student', {
    token: demoToken,
    body: { studentId: 'DEMO2026REG', realName: '登记测试' }
  });
  check('存量账号登记学号直接 approved',
    b4.body?.code === 200 && b4.body?.data?.bindStatus === 'approved', b4.body);
  // 还原演示账号
  await db.query(
    "UPDATE users SET student_id = NULL, real_name = NULL, bind_audit_at = NULL WHERE id = $1",
    [demoUid]
  );

  // 清理临时账号
  await db.query('DELETE FROM users WHERE openid = $1', [OPENID]);
  const gone = await db.queryOne('SELECT id FROM users WHERE openid = $1', [OPENID]);
  check('临时账号已清理', !gone);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('E2E 异常:', e);
  process.exit(1);
});
