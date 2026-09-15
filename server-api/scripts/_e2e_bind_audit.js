/**
 * 回归验证：账号认定全链路（小程序提交 → Web 审核）
 * ------------------------------------------------------------------
 * 覆盖：
 *   A. 学生端提交（POST /user/bind-student）：必填校验、学号唯一性、
 *      **姓名/班级即时写入用户资料（real_name / nick_name 双写 + class_id 自动建档）**
 *   B. Web 端审核（GET /admin/bind-applications、POST /admin/bind-audit）：鉴权、参数校验、
 *      **修复点：DB 读回的 student_id 回传为参数（varchar = bigint 42883）**、驳回释放学号
 *
 * 学生 token 由本地 JWT_SECRET 签发（与云函数同密钥），因此可打线上真实接口。
 * 造数用临时账号（openid 前缀 __e2e_bindaudit__）与临时班级，跑完自动清理。
 *
 * 用法：node scripts/_e2e_bind_audit.js
 * 退出码 = 失败项数（0 = 全通过）
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query, queryOne, insertReturningId } = require('../src/utils/config/db');

const BASE =
  process.env.API_BASE ||
  'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';
const SCRATCH_OPENID_PREFIX = '__e2e_bindaudit__';
const SCRATCH_CLASS = 'E2E测试班2201';
const SID_PENDING = '202599990001';
const SID_APPROVED = '202599990002';
const SID_REJECT = '202599990003';
const SID_DUP = '202599990004';

let failed = 0;
function check(ok, label, detail) {
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${label}${detail !== undefined ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

async function api(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* ignore */
  }
  return { status: r.status, code: j && j.code, message: j && j.message, data: j && j.data };
}

/** 造一个临时学生账号（可指定认定状态与学号），返回 { id, token } */
async function makeStudent(status, sid) {
  const openid = SCRATCH_OPENID_PREFIX + (sid || 'none') + '_' + Date.now();
  const now = new Date();
  const id = await insertReturningId(
    'users',
    ['openid', 'nick_name', 'role', 'student_id', 'real_name', 'bind_status', 'bind_apply_at', 'created_at', 'updated_at'],
    [openid, '', 'student', sid || null, '', status, status === 'pending' ? now : null, now, now]
  );
  const token = jwt.sign({ userId: id, role: 'student', openid }, process.env.JWT_SECRET, {
    expiresIn: '1h'
  });
  return { id, openid, token };
}

async function cleanup() {
  // 先把临时用户删掉，再删临时班级（避免外键残留）
  await query(`DELETE FROM users WHERE openid LIKE '${SCRATCH_OPENID_PREFIX}%'`, []);
  await query('DELETE FROM classes WHERE class_name = $1', [SCRATCH_CLASS]);
}

(async () => {
  console.log('=== 账号认定全链路回归（线上真实接口）===\n');

  await cleanup(); // 清掉上次异常退出可能留下的残留

  const admin = await api('POST', '/user/login-password', { username: 'admin', password: 'admin123' });
  const adminToken = admin.data && admin.data.token;
  check(!!adminToken, '0) admin 登录', 'HTTP ' + admin.status);
  if (!adminToken) return finish();

  /* ============ A. 小程序提交（学生端） ============ */
  console.log('\n--- A. 小程序提交 /user/bind-student ---');
  const stu = await makeStudent('unbound', null);

  const noName = await api('POST', '/user/bind-student', { studentId: SID_PENDING, className: SCRATCH_CLASS }, stu.token);
  check(noName.code === 400, 'A1) 缺姓名 → code 400', noName.message);

  const noClass = await api('POST', '/user/bind-student', { studentId: SID_PENDING, realName: '测试学生' }, stu.token);
  check(noClass.code === 400, 'A2) 缺班级 → code 400', noClass.message);

  const badSid = await api(
    'POST',
    '/user/bind-student',
    { studentId: '12', realName: '测试学生', className: SCRATCH_CLASS },
    stu.token
  );
  check(badSid.code === 400, 'A3) 学号格式非法 → code 400', badSid.message);

  const submit = await api(
    'POST',
    '/user/bind-student',
    { studentId: SID_PENDING, realName: '测试学生', className: SCRATCH_CLASS },
    stu.token
  );
  check(
    submit.code === 200 && submit.data && submit.data.bindStatus === 'pending',
    'A4) ★ 提交认定（学号+姓名+班级）→ 200 pending',
    submit.message
  );

  /* A5：姓名/班级是否即时写入用户资料——即「填到昵称/班级位置」 */
  const row = await queryOne(
    `SELECT u.real_name, u.nick_name, u.bind_status, u.student_id, u.class_id, c.class_name
     FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = $1`,
    [stu.id]
  );
  check(
    row && row.real_name === '测试学生' && row.nick_name === '测试学生',
    'A5) ★ 姓名写入 real_name 并双写 nick_name',
    JSON.stringify({ real_name: row && row.real_name, nick_name: row && row.nick_name })
  );
  check(
    row && row.class_name === SCRATCH_CLASS,
    'A6) ★ 班级自动建档并关联 class_id',
    JSON.stringify({ class_id: row && row.class_id, class_name: row && row.class_name })
  );

  const st = await api('GET', '/user/bind-status', undefined, stu.token);
  check(
    st.code === 200 && st.data && st.data.className === SCRATCH_CLASS && st.data.realName === '测试学生',
    'A7) bind-status 回带 className / realName（小程序展示位用）',
    JSON.stringify(st.data)
  );

  const profile = await api('GET', '/user/profile', undefined, stu.token);
  check(
    profile.code === 200 && profile.data && profile.data.className === SCRATCH_CLASS,
    'A8) profile 回带 className（登录态展示用）',
    'className=' + (profile.data && profile.data.className)
  );

  /* A9：学号唯一性（另一个账号用同一学号） */
  const stu2 = await makeStudent('unbound', null);
  const dup = await api(
    'POST',
    '/user/bind-student',
    { studentId: SID_PENDING, realName: '冒名学生', className: SCRATCH_CLASS },
    stu2.token
  );
  check(dup.code === 400, 'A9) 学号已被占用 → code 400', dup.message);

  /* ============ B. Web 端审核 ============ */
  console.log('\n--- B. Web 审核 /admin/bind-audit ---');
  check((await api('POST', '/admin/bind-audit', { userId: stu.id, action: 'approve' })).status === 401, 'B1) 无 token → 401');

  const noUser = await api('POST', '/admin/bind-audit', { action: 'approve' }, adminToken);
  check(noUser.code === 400, 'B2) 缺 userId → code 400', noUser.message);

  const badAction = await api('POST', '/admin/bind-audit', { userId: stu.id, action: 'xxx' }, adminToken);
  check(badAction.code === 400, 'B3) 非法 action → code 400', badAction.message);

  const ghost = await api('POST', '/admin/bind-audit', { userId: 999999, action: 'approve' }, adminToken);
  check(ghost.code === 404, 'B4) 用户不存在 → code 404', ghost.message);

  const list = await api('GET', '/admin/bind-applications?status=pending', undefined, adminToken);
  const listed = list.data && (list.data.list || []).find((r) => Number(r.id) === stu.id);
  check(
    !!listed && listed.className === SCRATCH_CLASS && listed.realName === '测试学生',
    'B5) ★ 审核列表带出学生填报的姓名与班级',
    listed ? JSON.stringify({ realName: listed.realName, className: listed.className, studentId: listed.studentId }) : '未找到记录'
  );

  const approve = await api('POST', '/admin/bind-audit', { userId: stu.id, action: 'approve' }, adminToken);
  check(
    approve.code === 200 && approve.data && approve.data.bindStatus === 'approved',
    'B6) ★ 修复点：待认定账号通过 → 200（此前必 500）',
    approve.message
  );

  const after = await queryOne('SELECT bind_status, student_id, bind_audit_at FROM users WHERE id = $1', [stu.id]);
  check(
    after && after.bind_status === 'approved' && String(after.student_id) === SID_PENDING && after.bind_audit_at,
    'B7) 回读：状态 approved / 学号保留 / 记录认定时间',
    JSON.stringify(after)
  );

  const again = await api('POST', '/admin/bind-audit', { userId: stu.id, action: 'approve' }, adminToken);
  check(again.code === 400, 'B8) 已认定账号再次通过 → code 400（非 500）', again.message);

  /* B9：驳回分支应释放学号 */
  const stu3 = await makeStudent('pending', SID_REJECT);
  const rej = await api(
    'POST',
    '/admin/bind-audit',
    { userId: stu3.id, action: 'reject', reason: 'E2E 驳回测试' },
    adminToken
  );
  check(rej.code === 200, 'B9) 驳回 → 200', rej.message);
  const rowB = await queryOne('SELECT bind_status, student_id, bind_reject_reason FROM users WHERE id = $1', [stu3.id]);
  check(
    rowB && rowB.bind_status === 'rejected' && rowB.student_id == null && rowB.bind_reject_reason === 'E2E 驳回测试',
    'B10) 回读：状态 rejected / 学号已释放 / 驳回原因写入',
    JSON.stringify(rowB)
  );

  /* B11：存量已认定账号登记学号（同表单） */
  const stu4 = await makeStudent('approved', null);
  const legacy = await api(
    'POST',
    '/user/bind-student',
    { studentId: SID_DUP, realName: '存量学生', className: SCRATCH_CLASS },
    stu4.token
  );
  check(
    legacy.code === 200 && legacy.data && legacy.data.bindStatus === 'approved',
    'B11) 存量已认定账号登记学号 → 直接 approved',
    legacy.message
  );

  finish();
})().catch(async (e) => {
  console.error('脚本异常:', e && e.stack ? e.stack : e);
  await cleanup();
  process.exit(1);
});

async function finish() {
  try {
    await cleanup();
    const left = await queryOne(`SELECT COUNT(*) AS n FROM users WHERE openid LIKE '${SCRATCH_OPENID_PREFIX}%'`, []);
    const cls = await queryOne('SELECT COUNT(*) AS n FROM classes WHERE class_name = $1', [SCRATCH_CLASS]);
    console.log(`\n清理：残留临时账号 ${left ? left.n : '?'} 条 / 临时班级 ${cls ? cls.n : '?'} 条`);
  } catch (e) {
    console.error('清理失败:', e.message);
  }
  console.log(`\n=== ${failed === 0 ? '全部通过' : failed + ' 项失败'} ===`);
  process.exit(failed === 0 ? 0 : 1);
}
