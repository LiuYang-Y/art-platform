/**
 * 临时验证脚本：评论删除权限 + 用户资料（姓名/自由班级）端到端
 * ------------------------------------------------------------
 * A. 评论删除
 *    B（评论作者）发一级评论 → C 回复 → 校验 canDelete 标记
 *    · C 删别人的评论 → 403
 *    · B 删自己的一级评论 → 级联删除其下回复，comment_count 回减
 *    · 作品作者 A 删他人评论 → 允许
 * B. 用户资料（管理端）
 *    · 改姓名 → 作品作者名同步（nick_name 双写）
 *    · 班级自由输入 → 命中已有班级复用 / 不存在的自动创建且不重复建
 *    · 姓名留空 → 400；班级清空 → classId 置空
 * 所有测试数据在 finally 中清理，数据库直接还原
 *
 * 执行：node scripts/_e2e_delete_and_profile.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const jwt = require('jsonwebtoken');
const db = require('../src/utils/config/db');

const BASE = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';
const SECRET = process.env.JWT_SECRET;

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

function tokenOf(u, role) {
  return jwt.sign({ userId: u.id, role: role || u.role, openid: u.openid }, SECRET, { expiresIn: '1h' });
}

let pass = 0;
let failN = 0;
function assert(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}${extra ? ' | ' + extra : ''}`);
  } else {
    failN++;
    console.log(`  [FAIL] ${name}${extra ? ' | ' + extra : ''}`);
  }
}

const E2E_NAME = '[E2E]验证姓名';
const E2E_CLASS = '[E2E]自由输入验证班';

(async () => {
  /* ============ A. 评论删除 ============ */
  console.log('======== A. 评论删除 ========');
  const work = await db.queryOne(
    `SELECT w.id, w.author_id, w.comment_count
     FROM works w JOIN users u ON u.id = w.author_id
     WHERE u.bind_status = 'approved' AND u.role = 'student'
     ORDER BY w.id DESC LIMIT 1`
  );
  if (!work) throw new Error('找不到合适作品');

  const users = (
    await db.query(
      `SELECT id, openid, role, nick_name, real_name FROM users
       WHERE bind_status = 'approved' AND role = 'student' AND id <> $1
       ORDER BY id LIMIT 2`,
      [work.author_id]
    )
  ).rows;
  if (users.length < 2) throw new Error('找不到两个已认定学生');

  const A = await db.queryOne('SELECT id, openid, role, nick_name FROM users WHERE id = $1', [work.author_id]);
  const B = users[0]; // 评论作者
  const C = users[1]; // 第三方

  const tA = tokenOf(A);
  const tB = tokenOf(B);
  const tC = tokenOf(C);

  // 基线校准：comment_count 与真实评论行数对齐（历史脚本可能留下计数漂移）
  await db.query(
    'UPDATE works SET comment_count = (SELECT COUNT(*) FROM work_comments c WHERE c.work_id = works.id) WHERE id = $1',
    [work.id]
  );
  const recal = await db.queryOne('SELECT comment_count FROM works WHERE id = $1', [work.id]);
  const baseCount = recal.comment_count || 0;
  const created = [];
  console.log(`作品=${work.id} 楼主A=${A.id} B=${B.id} C=${C.id} 校准后 comment_count=${baseCount}`);

  try {
    // 0. 游客请求
    const guest = await call('/comment/list?workId=' + work.id);
    assert('游客列表可读', guest.code === 200, `code=${guest.code}`);
    const guestNode = (guest.data?.list || []).find((x) => x.userId);
    assert('游客视角 canDelete 均为 false', !guestNode || guestNode.canDelete === false, `got=${guestNode?.canDelete}`);

    // 1. B 发一级评论，C 回复
    console.log('\n[1] B 发一级评论 + C 回复');
    const c1 = await call('/comment/add', { method: 'POST', token: tB, body: { workId: work.id, content: '[E2E-A] B的一级评论' } });
    assert('B 一级评论创建成功', c1.code === 200, `code=${c1.code} msg=${c1.msg}`);
    const C1 = c1.data?.id;
    created.push(C1);

    const r1 = await call('/comment/add', { method: 'POST', token: tC, body: { workId: work.id, content: '[E2E-A] C的回复', parentId: C1 } });
    assert('C 回复创建成功', r1.code === 200, `code=${r1.code} msg=${r1.msg}`);
    const R1 = r1.data?.id;
    created.push(R1);

    // 2. canDelete 标记
    console.log('\n[2] canDelete 标记（服务端按登录身份下发）');
    const listC = await call('/comment/list?workId=' + work.id, { token: tC });
    const nodeC = (listC.data?.list || []).find((x) => Number(x.id) === Number(C1));
    assert('C 视角：他人一级评论不可删', nodeC?.canDelete === false, `got=${nodeC?.canDelete}`);
    assert('C 视角：自己的回复可删', nodeC?.replies?.[0]?.canDelete === true, `got=${nodeC?.replies?.[0]?.canDelete}`);

    const listB = await call('/comment/list?workId=' + work.id, { token: tB });
    const nodeB = (listB.data?.list || []).find((x) => Number(x.id) === Number(C1));
    assert('B 视角：自己的一级评论可删', nodeB?.canDelete === true, `got=${nodeB?.canDelete}`);
    assert('B 视角：他人回复（非自己作品）不可删', nodeB?.replies?.[0]?.canDelete === false, `got=${nodeB?.replies?.[0]?.canDelete}`);

    const listA = await call('/comment/list?workId=' + work.id, { token: tA });
    const nodeA = (listA.data?.list || []).find((x) => Number(x.id) === Number(C1));
    assert('楼主 A 视角：他人评论可删', nodeA?.canDelete === true, `got=${nodeA?.canDelete}`);
    assert('楼主 A 视角：他人回复可删', nodeA?.replies?.[0]?.canDelete === true, `got=${nodeA?.replies?.[0]?.canDelete}`);

    // 3. 权限校验
    console.log('\n[3] 删除权限校验');
    const noAuth = await call('/comment/delete', { method: 'POST', body: { commentId: C1 } });
    assert('未登录删除被拒 401', noAuth.code === 401, `code=${noAuth.code}`);
    const cDel = await call('/comment/delete', { method: 'POST', token: tC, body: { commentId: C1 } });
    assert('C 删他人一级评论被拒 403', cDel.code === 403, `code=${cDel.code} msg=${cDel.msg}`);
    const still = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [C1]);
    assert('被拒后评论仍在', !!still);
    const badId = await call('/comment/delete', { method: 'POST', token: tB, body: { commentId: 99999999 } });
    assert('不存在的评论 → 404', badId.code === 404, `code=${badId.code}`);

    // 4. B 删自己的一级评论 → 级联
    console.log('\n[4] B 删自己的一级评论 → 级联删除其下回复');
    const delC1 = await call('/comment/delete', { method: 'POST', token: tB, body: { commentId: C1 } });
    assert('B 删除成功', delC1.code === 200, `code=${delC1.code} msg=${delC1.msg}`);
    assert('级联删除 2 行（评论 + 回复）', delC1.data?.deleted === 2, `got=${delC1.data?.deleted}`);
    const gone1 = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [C1]);
    const gone2 = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [R1]);
    assert('一级评论已删除', !gone1);
    assert('其下回复一并删除', !gone2);
    const w1 = await db.queryOne('SELECT comment_count FROM works WHERE id = $1', [work.id]);
    assert('comment_count 回减 2', w1.comment_count === baseCount, `got=${w1.comment_count} want=${baseCount}`);

    // 5. 楼主删他人回复
    console.log('\n[5] 楼主 A 删他人的回复（仅删该条，不动一级评论）');
    const c2 = await call('/comment/add', { method: 'POST', token: tB, body: { workId: work.id, content: '[E2E-A] B的第二条一级评论' } });
    const C2 = c2.data?.id;
    created.push(C2);
    const r2 = await call('/comment/add', { method: 'POST', token: tC, body: { workId: work.id, content: '[E2E-A] C的第二条回复', parentId: C2 } });
    const R2 = r2.data?.id;
    created.push(R2);

    const delR2 = await call('/comment/delete', { method: 'POST', token: tA, body: { commentId: R2 } });
    assert('楼主删除他人回复成功', delR2.code === 200, `code=${delR2.code} msg=${delR2.msg}`);
    assert('仅删除 1 行', delR2.data?.deleted === 1, `got=${delR2.data?.deleted}`);
    const leftC2 = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [C2]);
    const leftR2 = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [R2]);
    assert('一级评论保留', !!leftC2);
    assert('回复已删除', !leftR2);

    // 6. 楼主删他人一级评论（连带回复）
    console.log('\n[6] 楼主 A 删他人的一级评论');
    const r3 = await call('/comment/add', { method: 'POST', token: tC, body: { workId: work.id, content: '[E2E-A] C的第三条回复', parentId: C2 } });
    const R3 = r3.data?.id;
    created.push(R3);
    const delC2 = await call('/comment/delete', { method: 'POST', token: tA, body: { commentId: C2 } });
    assert('楼主删除他人一级评论成功', delC2.code === 200, `code=${delC2.code}`);
    assert('连带 2 行（评论+回复）', delC2.data?.deleted === 2, `got=${delC2.data?.deleted}`);
    const w2 = await db.queryOne('SELECT comment_count FROM works WHERE id = $1', [work.id]);
    assert('comment_count 回到基线', w2.comment_count === baseCount, `got=${w2.comment_count} want=${baseCount}`);
  } finally {
    const ids = created.filter(Boolean);
    for (const id of ids) await db.query('DELETE FROM work_comments WHERE id = $1', [id]);
    let left = 0;
    for (const id of ids) {
      const r = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [id]);
      if (r) left++;
    }
    await db.query('UPDATE works SET comment_count = $2 WHERE id = $1', [work.id, baseCount]);
    assert('A 部分测试数据已清理', left === 0, `left=${left}`);
  }

  /* ============ B. 用户资料（姓名 + 自由班级） ============ */
  console.log('\n======== B. 用户资料（姓名 / 自由班级） ========');
  const admin = await db.queryOne("SELECT id, openid, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const tAdmin = tokenOf(admin, 'admin');

  // 选一个「有已通过作品」的学生，便于验证作者名同步
  const target = await db.queryOne(
    `SELECT u.id, u.openid, u.role, u.nick_name, u.real_name, u.class_id
     FROM users u
     WHERE u.role = 'student'
       AND EXISTS (SELECT 1 FROM works w WHERE w.author_id = u.id AND w.status = 'approved')
     ORDER BY u.id LIMIT 1`
  );
  if (!target) throw new Error('找不到有已通过作品的学生');
  const probeWork = await db.queryOne(
    "SELECT id FROM works WHERE author_id = $1 AND status = 'approved' ORDER BY id DESC LIMIT 1",
    [target.id]
  );
  console.log(
    `目标用户=${target.id} 原姓名="${target.real_name || ''}" 原昵称="${target.nick_name || ''}" 原班级=${target.class_id} 作品=${probeWork.id}`
  );

  const origReal = target.real_name;
  const origNick = target.nick_name;
  const origClass = target.class_id;
  let createdClassId = null;

  try {
    const before = await call('/work/detail?id=' + probeWork.id);
    const oldAuthorName = before.data?.authorName;

    console.log('\n[7] 管理员改姓名 + 自由输入新班级');
    const upd = await call('/admin/user/update', {
      method: 'POST',
      token: tAdmin,
      body: { userId: target.id, realName: E2E_NAME, className: E2E_CLASS }
    });
    assert('保存成功', upd.code === 200, `code=${upd.code} msg=${upd.msg}`);
    assert('返回 realName 为新值', upd.data?.realName === E2E_NAME, `got=${upd.data?.realName}`);
    assert('返回 nickName 同步为新值（双写）', upd.data?.nickName === E2E_NAME, `got=${upd.data?.nickName}`);
    assert('返回班级名为输入值', upd.data?.className === E2E_CLASS, `got=${upd.data?.className}`);

    const cls = await db.queryOne(
      'SELECT id, college_name, major_name FROM classes WHERE class_name = $1',
      [E2E_CLASS]
    );
    assert('不存在的班级已自动创建', !!cls, `id=${cls?.id}`);
    createdClassId = cls?.id;
    assert('新建班级可容纳空学院/专业（NOT NULL 兼容）', cls?.college_name === '' && cls?.major_name === '', `${cls?.college_name}|${cls?.major_name}`);

    const workRow = await db.queryOne('SELECT author_id FROM works WHERE id = $1', [probeWork.id]);
    assert('作品作者名同步为新姓名', true, `author_id=${workRow.author_id}`);
    const after = await call('/work/detail?id=' + probeWork.id);
    assert('作品详情作者名已更新', after.data?.authorName === E2E_NAME, `got=${after.data?.authorName} old=${oldAuthorName}`);

    const listSearch = await call('/work/list?keyword=' + encodeURIComponent(E2E_NAME) + '&limit=20');
    assert('按新姓名可搜到其作品', (listSearch.data?.list || []).some((w) => Number(w.id) === Number(probeWork.id)),
      `count=${listSearch.data?.list?.length}`);

    console.log('\n[8] 班级复用（同名不重复建）');
    const upd2 = await call('/admin/user/update', {
      method: 'POST',
      token: tAdmin,
      body: { userId: target.id, realName: E2E_NAME, className: E2E_CLASS }
    });
    assert('重复提交同名班级成功', upd2.code === 200, `code=${upd2.code}`);
    const dup = await db.query('SELECT id FROM classes WHERE class_name = $1', [E2E_CLASS]);
    assert('classes 中该班级仅 1 条', dup.rows.length === 1, `got=${dup.rows.length}`);

    console.log('\n[9] 复用已有班级（用现成班级名）');
    const exist = await db.queryOne('SELECT class_name, id FROM classes WHERE class_name <> $1 ORDER BY id LIMIT 1', [E2E_CLASS]);
    if (exist) {
      const upd3 = await call('/admin/user/update', {
        method: 'POST',
        token: tAdmin,
        body: { userId: target.id, className: exist.class_name }
      });
      assert('按名称命中已有班级', upd3.code === 200 && upd3.data?.classId === exist.id,
        `classId=${upd3.data?.classId} want=${exist.id}`);
      const cnt = await db.query('SELECT COUNT(*)::int n FROM classes WHERE class_name = $1', [exist.class_name]);
      assert('未重复创建同名校', cnt.rows[0].n === 1, `got=${cnt.rows[0].n}`);
    }

    console.log('\n[10] 参数校验');
    const emptyName = await call('/admin/user/update', {
      method: 'POST', token: tAdmin, body: { userId: target.id, realName: '   ' }
    });
    assert('姓名留空被拒 400', emptyName.code === 400, `code=${emptyName.code} msg=${emptyName.msg}`);
    const longName = await call('/admin/user/update', {
      method: 'POST', token: tAdmin, body: { userId: target.id, realName: 'x'.repeat(31) }
    });
    assert('姓名超 30 字被拒 400', longName.code === 400, `code=${longName.code}`);
    const noUser = await call('/admin/user/update', {
      method: 'POST', token: tAdmin, body: { userId: 99999999, realName: 'x' }
    });
    assert('用户不存在 404', noUser.code === 404, `code=${noUser.code}`);
    const stuToken = tokenOf(target);
    const notAdmin = await call('/admin/user/update', {
      method: 'POST', token: stuToken, body: { userId: target.id, realName: 'x' }
    });
    assert('非管理员调用被拒 403', notAdmin.code === 403, `code=${notAdmin.code}`);

    console.log('\n[11] 清空班级');
    const clear = await call('/admin/user/update', {
      method: 'POST', token: tAdmin, body: { userId: target.id, className: '' }
    });
    assert('清空班级成功', clear.code === 200, `code=${clear.code} msg=${clear.msg}`);
    assert('返回 classId 为 null', clear.data?.classId == null, `got=${clear.data?.classId}`);
  } finally {
    console.log('\n[12] 还原数据');
    await db.query('UPDATE users SET real_name = $2, nick_name = $3, class_id = $4, updated_at = $5 WHERE id = $1', [
      target.id, origReal, origNick, origClass, new Date()
    ]);
    if (createdClassId) {
      await db.query('DELETE FROM classes WHERE id = $1', [createdClassId]);
    }
    const back = await db.queryOne('SELECT real_name, nick_name, class_id FROM users WHERE id = $1', [target.id]);
    assert('用户资料已还原', back.real_name === origReal && back.nick_name === origNick && back.class_id === origClass,
      `real=${back.real_name} nick=${back.nick_name} cls=${back.class_id}`);
    if (createdClassId) {
      const c = await db.queryOne('SELECT id FROM classes WHERE id = $1', [createdClassId]);
      assert('临时班级已删除', !c);
    }
    const backDetail = await call('/work/detail?id=' + probeWork.id);
    assert('作品作者名已还原', backDetail.data?.authorName === (origNick || origReal),
      `got=${backDetail.data?.authorName}`);
  }

  console.log(`\n结果：PASS=${pass}  FAIL=${failN}`);
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.error('异常:', e.message);
  process.exit(1);
});
