/**
 * 管理 / 审核模块端到端验证（临时脚本）
 * 覆盖：学生发布(pending) → 学生无权审核(403) → 管理员通过 → 作品进公开瀑布流
 *       → 管理员驳回(带原因) → 状态/原因正确
 */

const dotenv = require('dotenv');
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const axios = require('axios');
const { query, queryOne, insertReturningId } = require('../src/utils/config/db');

const BASE = 'http://127.0.0.1:3000';
const TS = Date.now();

const results = [];
function check(label, cond, extra = '') {
  results.push(cond);
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  →  ' + extra : ''}`);
}

(async () => {
  const studentId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    `e2e_a_stu_${TS}`,
    '学生丙',
    'student'
  ]);
  const adminId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    `e2e_a_admin_${TS}`,
    '管理员',
    'admin'
  ]);
  const tokenStudent = jwt.sign({ userId: studentId, role: 'student', openid: `e2e_a_stu_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const tokenAdmin = jwt.sign({ userId: adminId, role: 'admin', openid: `e2e_a_admin_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const authS = { Authorization: `Bearer ${tokenStudent}` };
  const authA = { Authorization: `Bearer ${tokenAdmin}` };
  const http = (cfg) => axios({ ...cfg, validateStatus: () => true });

  console.log(`学生 id=${studentId}  管理员 id=${adminId}\n` + '─'.repeat(56));

  let workId = null;
  let workId2 = null;

  workId = await insertReturningId(
    'works',
    ['author_id', 'title', 'category', 'images', 'description', 'status', 'created_at', 'updated_at'],
    [studentId, '待审核作品《山水》', 'painting', ['https://example.com/s.jpg'], 'desc', 'pending', new Date(), new Date()]
  );

  try {
    // 1. 学生发布后处于 pending（公开列表看不到）
    const pubBefore = await http({ method: 'get', url: `${BASE}/api/work/list` });
    const inFeedBefore = (pubBefore.data.data.list || []).some((w) => w.id === workId);
    check('待审核作品不在公开瀑布流', !inFeedBefore);

    // 2. 学生无权审核 → 403
    const stuApprove = await http({ method: 'post', url: `${BASE}/api/admin/work/approve`, data: { workId }, headers: authS });
    check('学生审核被拦截(403)', stuApprove.status === 403, `HTTP ${stuApprove.status}`);

    // 3. 管理员审核台可见该 pending 作品
    const pending = await http({ method: 'get', url: `${BASE}/api/admin/works?status=pending`, headers: authA });
    const found = (pending.data.data.list || []).some((w) => w.id === workId);
    check('审核台列出 pending 作品', found);

    // 4. 管理员通过
    const approve = await http({ method: 'post', url: `${BASE}/api/admin/work/approve`, data: { workId }, headers: authA });
    check('管理员审核通过', approve.data.code === 200 && approve.data.data.status === 'approved');
    const st1 = (await queryOne('SELECT status FROM works WHERE id = $1', [workId])).status;
    check('作品状态变为 approved', st1 === 'approved', st1);

    // 5. 通过后进公开瀑布流
    const pubAfter = await http({ method: 'get', url: `${BASE}/api/work/list` });
    const inFeedAfter = (pubAfter.data.data.list || []).some((w) => w.id === workId);
    check('审核通过后进入公开瀑布流', inFeedAfter);

    // 6. 驳回另一作品（带原因）
    workId2 = await insertReturningId(
      'works',
      ['author_id', 'title', 'category', 'images', 'description', 'status', 'created_at', 'updated_at'],
      [studentId, '待审作品《花鸟》', 'painting', ['https://example.com/t.jpg'], 'desc', 'pending', new Date(), new Date()]
    );
    const reject = await http({ method: 'post', url: `${BASE}/api/admin/work/reject`, data: { workId: workId2, reason: '画质不清晰' }, headers: authA });
    check('管理员驳回作品', reject.data.code === 200 && reject.data.data.status === 'rejected');
    const row2 = await queryOne('SELECT status, reject_reason FROM works WHERE id = $1', [workId2]);
    check('驳回状态 + 原因正确', row2.status === 'rejected' && row2.reject_reason === '画质不清晰', `${row2.status}/${row2.reject_reason}`);

    // 7. 无 Token 访问审核台 → 401
    const noAuth = await http({ method: 'get', url: `${BASE}/api/admin/works` });
    check('无 Token 访问审核台被拦截(401)', noAuth.status === 401, `HTTP ${noAuth.status}`);
  } catch (err) {
    check('执行过程异常', false, err.message);
  } finally {
    await query('DELETE FROM work_comments WHERE work_id = $1', [workId]).catch(() => {});
    await query('DELETE FROM work_comments WHERE work_id = $1', [workId2]).catch(() => {});
    await query('DELETE FROM likes WHERE work_id = $1', [workId]).catch(() => {});
    await query('DELETE FROM likes WHERE work_id = $1', [workId2]).catch(() => {});
    await query('DELETE FROM works WHERE id = $1', [workId]).catch(() => {});
    await query('DELETE FROM works WHERE id = $1', [workId2]).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [studentId]).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [adminId]).catch(() => {});
    console.log('─'.repeat(56));
    console.log(`通过 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
