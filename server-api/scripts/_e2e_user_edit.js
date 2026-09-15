/**
 * 临时验证脚本：用户管理「编辑资料」端到端
 * 1) 管理员登录拿 token
 * 2) GET /admin/classes 班级列表
 * 3) GET /admin/users 找一个有作品的学生
 * 4) POST /admin/user/update 改昵称 + 班级
 * 5) 断言：users 返回、/work/detail 作者名同步
 * 6) 还原原始昵称与班级
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const db = require('../src/utils/config/db');

const BASE = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, ...json };
}

let pass = 0;
let failTotal = 0;
function assert(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}${extra ? ' | ' + extra : ''}`);
  } else {
    failTotal++;
    console.log(`  [FAIL] ${name}${extra ? ' | ' + extra : ''}`);
  }
}

(async () => {
  // 0. 找目标用户（有作品的学生）
  const target = await db.queryOne(
    `SELECT u.id, u.nick_name, u.real_name, u.class_id
     FROM users u
     WHERE u.role = 'student'
       AND EXISTS (SELECT 1 FROM works w WHERE w.author_id = u.id)
     ORDER BY u.id LIMIT 1`
  );
  if (!target) {
    console.log('找不到有作品的学生用户，终止');
    process.exit(1);
  }
  const workId = (
    await db.queryOne('SELECT id FROM works WHERE author_id = $1 ORDER BY id LIMIT 1', [target.id])
  ).id;
  console.log(`目标用户 id=${target.id} 原昵称=${target.nick_name} 原class=${target.class_id} 作品=${workId}`);

  // 1. 登录
  console.log('\n[1] 管理员登录');
  const login = await call('/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  assert('登录成功', login.code === 200 && !!login.data?.token, `code=${login.code} msg=${login.msg}`);
  const token = login.data && login.data.token;
  if (!token) process.exit(1);

  // 2. 班级列表
  console.log('\n[2] GET /admin/classes');
  const cls = await call('/admin/classes', { token });
  assert('班级列表返回', cls.code === 200 && Array.isArray(cls.data?.list), `count=${cls.data?.list?.length}`);
  assert('班级含 label 字段', !!cls.data?.list?.[0]?.label, `first=${cls.data?.list?.[0]?.label}`);
  const someClass = (cls.data?.list || []).find((c) => c.id !== target.class_id) || cls.data?.list?.[0];
  console.log('  可选用班级:', someClass && someClass.label);

  // 3. 无 token 访问应被拦
  console.log('\n[3] 鉴权校验');
  const noAuth = await call('/admin/classes');
  assert('未带 token 被拒', noAuth.http === 401 || noAuth.http === 403, `http=${noAuth.http}`);

  // 4. 改昵称 + 班级
  const newNick = '验证昵称' + Date.now().toString().slice(-4);
  console.log(`\n[4] 改昵称->${newNick}，班级->${someClass.id} (${someClass.label})`);
  const upd = await call('/admin/user/update', {
    method: 'POST',
    token,
    body: { userId: target.id, nickName: newNick, classId: someClass.id }
  });
  assert('更新接口成功', upd.code === 200, `code=${upd.code} msg=${upd.msg}`);
  assert('返回体昵称已更新', upd.data?.nickName === newNick, `got=${upd.data?.nickName}`);
  assert('返回体班级已更新', upd.data?.classId === someClass.id, `got=${upd.data?.classId}`);

  // 5. 列表复核
  console.log('\n[5] 列表复核');
  const users = await call('/admin/users', { token });
  const row = (users.data?.list || []).find((u) => u.id === target.id);
  assert('列表中昵称已更新', row?.nickName === newNick, `got=${row?.nickName}`);
  assert('列表中班级名已更新', row?.className === someClass.className, `got=${row?.className}`);

  // 6. 作品详情作者名同步
  console.log('\n[6] 作品作者名同步');
  const detail = await call('/work/detail?id=' + workId);
  assert('作品详情作者名已同步', detail.data?.authorName === newNick, `got=${detail.data?.authorName}`);
  const wl = await call('/work/list?limit=50');
  const inList = (wl.data?.list || []).find((w) => w.id === workId);
  assert('作品列表作者名已同步', !inList || inList.authorName === newNick, `got=${inList?.authorName}`);

  // 7. 参数校验
  console.log('\n[7] 参数校验');
  const empty = await call('/admin/user/update', {
    method: 'POST',
    token,
    body: { userId: target.id, nickName: '   ' }
  });
  assert('空昵称被拒', empty.code === 400, `code=${empty.code} msg=${empty.msg}`);
  const badClass = await call('/admin/user/update', {
    method: 'POST',
    token,
    body: { userId: target.id, classId: 999999 }
  });
  assert('不存在班级被拒', badClass.code === 400, `code=${badClass.code} msg=${badClass.msg}`);
  const noUser = await call('/admin/user/update', { method: 'POST', token, body: { userId: 999999 } });
  assert('不存在用户被拒', noUser.code === 404, `code=${noUser.code} msg=${noUser.msg}`);
  const noField = await call('/admin/user/update', { method: 'POST', token, body: { userId: target.id } });
  assert('无字段被拒', noField.code === 400, `code=${noField.code} msg=${noField.msg}`);

  // 8. 还原
  console.log('\n[8] 还原数据');
  const restore = await call('/admin/user/update', {
    method: 'POST',
    token,
    body: { userId: target.id, nickName: target.nick_name, classId: target.class_id }
  });
  assert('还原成功', restore.code === 200, `code=${restore.code} msg=${restore.msg}`);
  const after = await call('/admin/users', { token });
  const rrow = (after.data?.list || []).find((u) => u.id === target.id);
  assert('昵称已还原', rrow?.nickName === target.nick_name, `got=${rrow?.nickName} want=${target.nick_name}`);
  assert('班级已还原', rrow?.classId === target.class_id, `got=${rrow?.classId} want=${target.class_id}`);

  console.log(`\n结果：PASS=${pass}  FAIL=${failTotal}`);
  process.exit(failTotal === 0 ? 0 : 1);
})().catch((e) => {
  console.error('异常:', e.message);
  process.exit(1);
});
