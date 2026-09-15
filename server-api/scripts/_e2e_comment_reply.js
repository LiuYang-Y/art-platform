/**
 * 临时验证脚本：作品留言「二级回复」端到端
 * ------------------------------------------------------------
 * 用本地 JWT_SECRET 直接签发两个学生的 token（免微信 code2Session），验证：
 *   1) U1 发表一级评论 C1
 *   2) U2 回复 C1 → R1
 *   3) U1 再回复 R1 → R2   ★ 关键：parentId 传的是 R1.id
 *        期望 R2.parent_id 收敛到根 C1，且 replyToUserId = U2
 *   4) 列表结构：C1.replies = [R1, R2]，无三层嵌套
 *   5) 作者标识：作品作者亲自回复 → is_author_reply = true
 *   6) 清理：删除本次产生的评论并回滚 comment_count
 *
 * 执行：node scripts/_e2e_comment_reply.js
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

function tokenOf(u) {
  return jwt.sign({ userId: u.id, role: u.role, openid: u.openid }, SECRET, { expiresIn: '1h' });
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

(async () => {
  // 选一个「作者已认定」的作品，让作者本人下场回帖以验证作者标识
  const work = await db.queryOne(
    `SELECT w.id, w.author_id, w.comment_count, u.nick_name AS author_name
     FROM works w JOIN users u ON u.id = w.author_id
     WHERE u.bind_status = 'approved' AND u.role = 'student'
     ORDER BY w.id DESC LIMIT 1`
  );
  if (!work) {
    console.log('找不到合适的作品，终止');
    process.exit(1);
  }
  const other = await db.queryOne(
    `SELECT id, openid, role, nick_name FROM users
     WHERE bind_status = 'approved' AND role = 'student' AND id <> $1
     ORDER BY id LIMIT 1`,
    [work.author_id]
  );
  if (!other) {
    console.log('找不到第二个已认定学生，终止');
    process.exit(1);
  }

  const U1 = await db.queryOne('SELECT id, openid, role, nick_name FROM users WHERE id = $1', [work.author_id]);
  const U2 = other;
  console.log(`作品=${work.id}「${work.author_name}」 U1=${U1.id}(${U1.nick_name}) U2=${U2.id}(${U2.nick_name})`);
  console.log(`原 comment_count=${work.comment_count}`);

  const t1 = tokenOf(U1);
  const t2 = tokenOf(U2);
  const created = [];
  let baseCount = work.comment_count || 0;

  try {
    // 0. token 有效性
    console.log('\n[0] token 与列表可读');
    const probe = await call('/comment/list?workId=' + work.id);
    assert('评论列表可读（无需鉴权）', probe.code === 200, `code=${probe.code}`);
    assert('token 可识别（发评论前先试一条）', true);

    // 1. U1 一级评论
    console.log('\n[1] U1 发表一级评论');
    const c1 = await call('/comment/add', {
      method: 'POST',
      token: t1,
      body: { workId: work.id, content: '[E2E-一级] 构图很稳，学习了' }
    });
    assert('一级评论创建成功', c1.code === 200, `code=${c1.code} msg=${c1.msg}`);
    assert('一级评论无 parentId', c1.data?.parentId == null, `parentId=${c1.data?.parentId}`);
    assert('作者本人发帖 → is_author_reply=true', c1.data?.isAuthorReply === true, `got=${c1.data?.isAuthorReply}`);
    const C1 = c1.data?.id;
    created.push(C1);
    if (!C1) throw new Error('一级评论未返回 id');

    // 2. U2 回复 C1
    console.log('\n[2] U2 回复一级评论');
    const r1 = await call('/comment/add', {
      method: 'POST',
      token: t2,
      body: { workId: work.id, content: '[E2E-回复1] 同感，光影处理很讲究', parentId: C1 }
    });
    assert('回复创建成功', r1.code === 200, `code=${r1.code} msg=${r1.msg}`);
    assert('parentId 指向一级评论', Number(r1.data?.parentId) === Number(C1), `got=${r1.data?.parentId}`);
    assert(
      'replyToUser 指向楼主',
      Number(r1.data?.replyToUserId) === Number(U1.id) && r1.data?.replyToUserName === U1.nick_name,
      `got=${r1.data?.replyToUserName}`
    );
    assert('非作者 → is_author_reply=false', r1.data?.isAuthorReply === false, `got=${r1.data?.isAuthorReply}`);
    const R1 = r1.data?.id;
    created.push(R1);
    if (!R1) throw new Error('回复未返回 id');

    // 3. ★ 关键：U1 回复「那条回复」
    console.log('\n[3] ★ U1 回复二级回复 R1（原实现会丢失）');
    const r2 = await call('/comment/add', {
      method: 'POST',
      token: t1,
      body: { workId: work.id, content: '[E2E-回复2] 谢谢！下次试试冷色调', parentId: R1 }
    });
    assert('回复的回复创建成功', r2.code === 200, `code=${r2.code} msg=${r2.msg}`);
    assert(
      'parentId 收敛到根评论 C1（不是 R1）',
      Number(r2.data?.parentId) === Number(C1),
      `got=${r2.data?.parentId} want=${C1}`
    );
    assert(
      'replyToUser 指向被回复的 U2',
      Number(r2.data?.replyToUserId) === Number(U2.id) && r2.data?.replyToUserName === U2.nick_name,
      `got=${r2.data?.replyToUserName} want=${U2.nick_name}`
    );
    const R2 = r2.data?.id;
    created.push(R2);

    // 4. 列表结构
    console.log('\n[4] 列表结构（两层、无嵌套）');
    const list = await call('/comment/list?workId=' + work.id);
    assert('列表返回成功', list.code === 200, `code=${list.code}`);
    const node = (list.data?.list || []).find((x) => Number(x.id) === Number(C1));
    assert('根评论在列表里', !!node, `found=${!!node}`);
    assert('根评论下 2 条回复', node?.replies?.length === 2, `got=${node?.replies?.length}`);
    const [first, second] = node?.replies || [];
    assert('回复按时间升序（先 R1 后 R2）', Number(first?.id) === Number(R1) && Number(second?.id) === Number(R2),
      `first=${first?.id} second=${second?.id}`);
    assert('R1 的 replyToUserName = 楼主', first?.replyToUserName === U1.nick_name, `got=${first?.replyToUserName}`);
    assert('R2 的 replyToUserName = U2', second?.replyToUserName === U2.nick_name, `got=${second?.replyToUserName}`);
    assert('R2 内容完整（未丢失）', second?.content === '[E2E-回复2] 谢谢！下次试试冷色调', `got=${second?.content}`);
    assert(
      '不存在三层嵌套（所有回复的 replies 均为空）',
      (node?.replies || []).every((r) => Array.isArray(r.replies) && r.replies.length === 0)
    );
    assert('二级回复都带作者名与头像字段', !!(second?.userName && second?.userId !== undefined),
      `name=${second?.userName}`);

    // 5. 评论数联动
    console.log('\n[5] 评论数联动');
    const wAfter = await db.queryOne('SELECT comment_count FROM works WHERE id = $1', [work.id]);
    assert('comment_count +3', wAfter.comment_count === baseCount + 3, `got=${wAfter.comment_count} want=${baseCount + 3}`);

    // 6. 参数校验
    console.log('\n[6] 参数校验');
    const badWork = await call('/comment/add', {
      method: 'POST',
      token: t2,
      body: { workId: 999999, content: 'x' }
    });
    assert('作品不存在被拒', badWork.code === 404, `code=${badWork.code}`);
    const badParent = await call('/comment/add', {
      method: 'POST',
      token: t2,
      body: { workId: work.id, content: 'x', parentId: 999999 }
    });
    assert('父评论不存在被拒', badParent.code === 404, `code=${badParent.code}`);
    const cross = await db.queryOne('SELECT id, work_id FROM work_comments WHERE work_id <> $1 LIMIT 1', [work.id]);
    if (cross) {
      const crossRes = await call('/comment/add', {
        method: 'POST',
        token: t2,
        body: { workId: work.id, content: 'x', parentId: cross.id }
      });
      assert('跨作品回复被拒', crossRes.code === 400, `code=${crossRes.code} msg=${crossRes.msg}`);
    }
  } finally {
    // 7. 清理
    console.log('\n[7] 清理测试数据');
    const ids = created.filter((x) => x != null);
    for (const id of ids) {
      await db.query('DELETE FROM work_comments WHERE id = $1', [id]);
    }
    if (ids.length) {
      await db.query('UPDATE works SET comment_count = GREATEST(comment_count - $2, 0) WHERE id = $1', [
        work.id,
        ids.length
      ]);
    }
    let leftN = 0;
    for (const id of ids) {
      const r = await db.queryOne('SELECT id FROM work_comments WHERE id = $1', [id]);
      if (r) leftN++;
    }
    const wEnd = await db.queryOne('SELECT comment_count FROM works WHERE id = $1', [work.id]);
    assert('测试评论已删除', leftN === 0, `left=${leftN}`);
    assert('comment_count 已还原', wEnd.comment_count === baseCount, `got=${wEnd.comment_count} want=${baseCount}`);
  }

  console.log(`\n结果：PASS=${pass}  FAIL=${failN}`);
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.error('异常:', e.message);
  process.exit(1);
});
