/**
 * 课程模块端到端验证（临时脚本）
 * 覆盖：学生浏览列表/详情 → 学生无权管理(403) → 教师创建/更新/删除 → 无 Token 拦截
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
    `e2e_c_stu_${TS}`,
    '学生丁',
    'student'
  ]);
  const teacherId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    `e2e_c_teacher_${TS}`,
    '教师戊',
    'teacher'
  ]);
  const tokenStudent = jwt.sign({ userId: studentId, role: 'student', openid: `e2e_c_stu_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const tokenTeacher = jwt.sign({ userId: teacherId, role: 'teacher', openid: `e2e_c_teacher_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const authS = { Authorization: `Bearer ${tokenStudent}` };
  const authT = { Authorization: `Bearer ${tokenTeacher}` };
  const http = (cfg) => axios({ ...cfg, validateStatus: () => true });

  console.log(`学生 id=${studentId}  教师 id=${teacherId}\n` + '─'.repeat(56));

  try {
    // 1. 学生浏览列表（空）
    const listEmpty = await http({ method: 'get', url: `${BASE}/api/course/list` });
    check('课程列表可公开访问', listEmpty.data.code === 200 && Array.isArray(listEmpty.data.data.list));

    // 2. 学生无权创建 → 403
    const stuCreate = await http({ method: 'post', url: `${BASE}/api/course/create`, data: { courseName: 'x', teacherName: 'y' }, headers: authS });
    check('学生创建课程被拦截(403)', stuCreate.status === 403, `HTTP ${stuCreate.status}`);

    // 3. 教师创建
    const created = await http({
      method: 'post',
      url: `${BASE}/api/course/create`,
      data: { courseName: '《国画基础》', teacherName: '王教授', location: '艺术楼 301', classTime: '周三 14:00', weeklyInfo: '每周', description: '零基础入门' },
      headers: authT
    });
    const courseId = created.data && created.data.data && created.data.data.courseId;
    check('教师创建课程', created.data.code === 200 && !!courseId, `courseId=${courseId}`);
    check('新课程状态为 active', created.data.data && created.data.data.status === 'active');

    // 4. 列表可见 + 详情
    const list = await http({ method: 'get', url: `${BASE}/api/course/list` });
    const inList = (list.data.data.list || []).some((c) => c.id === courseId);
    check('课程出现在公开列表', inList);
    const detail = await http({ method: 'get', url: `${BASE}/api/course/detail?id=${courseId}` });
    check('课程详情可读', detail.data.code === 200 && detail.data.data.courseName === '《国画基础》', detail.data.data && detail.data.data.courseName);

    // 5. 教师更新（改教室）
    const upd = await http({ method: 'post', url: `${BASE}/api/course/update`, data: { id: courseId, location: '艺术楼 405' }, headers: authT });
    check('教师更新课程', upd.data.code === 200 && upd.data.data.location === '艺术楼 405', upd.data.data && upd.data.data.location);

    // 6. 教师删除
    const del = await http({ method: 'post', url: `${BASE}/api/course/delete`, data: { id: courseId }, headers: authT });
    check('教师删除课程', del.data.code === 200 && del.data.data.deleted === true);
    const after = await http({ method: 'get', url: `${BASE}/api/course/detail?id=${courseId}` });
    check('删除后详情 404', after.data.code === 404, `HTTP ${after.status}`);

    // 7. 无 Token 创建 → 401
    const noAuth = await http({ method: 'post', url: `${BASE}/api/course/create`, data: { courseName: 'x', teacherName: 'y' } });
    check('无 Token 创建课程被拦截(401)', noAuth.status === 401, `HTTP ${noAuth.status}`);
  } catch (err) {
    check('执行过程异常', false, err.message);
  } finally {
    await query('DELETE FROM courses WHERE teacher_name = $1', ['王教授']).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [studentId]).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [teacherId]).catch(() => {});
    console.log('─'.repeat(56));
    console.log(`通过 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
