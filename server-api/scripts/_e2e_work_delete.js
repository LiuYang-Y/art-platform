/**
 * 临时验证脚本：作者删除自己的作品（含级联清理）端到端
 * ------------------------------------------------------------
 * 用本地 JWT_SECRET 签发两个已认定学生的 token（免微信 code2Session），验证：
 *   1) U1 发布作品（pending，无需等审核通过即可删除——被驳回作品同样要能清理）
 *   2) U2 给作品点赞 + 留言
 *   3) 权限与参数：未登录 401 / 缺 workId 400 / 非法 workId 400 /
 *      非作者 403 / 作品不存在 404
 *   4) U1 删除自己的作品 → 200
 *   5) 回读：detail 404、mine 不再包含、likes / work_comments 级联清空
 *   6) 重复删除 → 404
 *   7) 清理：删除测试期产生的全部数据（works 行删除即带走关联数据）
 *
 * 执行：node scripts/_e2e_work_delete.js
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
  const U1 = await db.queryOne(
    `SELECT id, openid, role, nick_name FROM users
     WHERE bind_status = 'approved' AND role = 'student' ORDER BY id LIMIT 1`
  );
  const U2 = await db.queryOne(
    `SELECT id, openid, role, nick_name FROM users
     WHERE bind_status = 'approved' AND role = 'student' AND id <> $1 ORDER BY id LIMIT 1`,
    [U1 ? U1.id : 0]
  );
  if (!U1 || !U2) {
    console.log('缺少已认定学生账号，终止');
    process.exit(1);
  }
  console.log(`U1=${U1.id}(${U1.nick_name}) U2=${U2.id}(${U2.nick_name})`);

  const t1 = tokenOf(U1);
  const t2 = tokenOf(U2);
  let workId = null;
  let commentId = null;

  try {
    /* 1. 发布测试作品（作者 U1） */
    console.log('\n[1] 发布测试作品');
    const created = await call('/work/create', {
      method: 'POST',
      token: t1,
      body: {
        title: 'E2E 删除测试作品',
        category: 'other',
        description: '回归脚本临时作品，验证后自动清理',
        images: ['https://aaa-d8gj21kc1d09d6414.api.tcloudbasegateway.com/e2e-placeholder.jpg']
      }
    });
    assert('发布 → code 200', created.code === 200, `msg=${created.message}`);
    workId = created.data && created.data.workId;
    assert('返回 workId', !!workId, `workId=${workId}`);
    assert('新作品状态为 pending（待审核）', created.data && created.data.status === 'pending');

    /* 2. U2 点赞 + 留言（制造级联数据） */
    console.log('\n[2] 制造点赞与留言');
    const liked = await call('/work/like', { method: 'POST', token: t2, body: { workId } });
    assert('U2 点赞 → code 200', liked.code === 200, `liked=${liked.data && liked.data.liked}`);

    const cmt = await call('/comment/add', {
      method: 'POST',
      token: t2,
      body: { workId, content: 'E2E 删除测试留言' }
    });
    assert('U2 留言 → code 200', cmt.code === 200, `msg=${cmt.message}`);
    commentId = cmt.data && (cmt.data.commentId || (cmt.data.comment && cmt.data.comment.id));

    const before = await db.queryOne(
      `SELECT
         (SELECT COUNT(*) FROM likes WHERE work_id = $1) AS likes,
         (SELECT COUNT(*) FROM work_comments WHERE work_id = $1) AS comments`,
      [workId]
    );
    assert(
      '删除前级联数据就位（1 赞 + 1 留言）',
      Number(before.likes) === 1 && Number(before.comments) === 1,
      `likes=${before.likes} comments=${before.comments}`
    );

    /* 3. 权限与参数校验 */
    console.log('\n[3] 权限与参数校验');
    const noAuth = await call('/work/delete', { method: 'POST', body: { workId } });
    assert('未登录 → 401', noAuth.http === 401, `http=${noAuth.http}`);

    const noId = await call('/work/delete', { method: 'POST', token: t1, body: {} });
    assert('缺 workId → code 400', noId.code === 400, `msg=${noId.message}`);

    const badId = await call('/work/delete', {
      method: 'POST',
      token: t1,
      body: { workId: 'abc' }
    });
    assert('非法 workId → code 400', badId.code === 400, `msg=${badId.message}`);

    const notOwner = await call('/work/delete', { method: 'POST', token: t2, body: { workId } });
    assert('非作者删除 → code 403', notOwner.code === 403, `msg=${notOwner.message}`);

    const ghost = await call('/work/delete', { method: 'POST', token: t1, body: { workId: 99999999 } });
    assert('作品不存在 → code 404', ghost.code === 404, `msg=${ghost.message}`);

    /* 4. 作者本人删除 */
    console.log('\n[4] 作者本人删除');
    const del = await call('/work/delete', { method: 'POST', token: t1, body: { workId } });
    assert('作者删除自己的作品 → code 200', del.code === 200, `msg=${del.message}`);

    /* 5. 删除后回读 */
    console.log('\n[5] 删除后回读');
    const detail = await call('/work/detail?id=' + workId);
    assert('detail → 404', detail.code === 404, `msg=${detail.message}`);

    const mine = await call('/work/mine', { token: t1 });
    const stillThere = (mine.data && mine.data.list || []).some((w) => Number(w.id) === Number(workId));
    assert('「我的作品」不再包含该作品', !stillThere);

    const after = await db.queryOne(
      `SELECT
         (SELECT COUNT(*) FROM likes WHERE work_id = $1) AS likes,
         (SELECT COUNT(*) FROM work_comments WHERE work_id = $1) AS comments,
         (SELECT COUNT(*) FROM works WHERE id = $1) AS works`,
      [workId]
    );
    assert(
      '级联清理：likes / work_comments / works 全部为 0 行',
      Number(after.likes) === 0 && Number(after.comments) === 0 && Number(after.works) === 0,
      `likes=${after.likes} comments=${after.comments} works=${after.works}`
    );

    /* 6. 重复删除 */
    const again = await call('/work/delete', { method: 'POST', token: t1, body: { workId } });
    assert('重复删除 → code 404（非 500）', again.code === 404, `msg=${again.message}`);

    /* 7. U2 的留言已随作品消失（comment 接口视角） */
    const cmtList = await call('/comment/list?workId=' + workId);
    const listEmpty =
      !cmtList.data || !cmtList.data.list || cmtList.data.list.length === 0;
    assert('评论列表为空（留言已级联删除）', listEmpty);
  } catch (e) {
    console.log('脚本异常:', e.message);
    failN++;
  } finally {
    /* 兜底清理：任何中断路径都不残留测试作品 */
    try {
      if (workId) {
        await db.query('DELETE FROM work_comments WHERE work_id = $1', [workId]);
        await db.query('DELETE FROM likes WHERE work_id = $1', [workId]);
        await db.query('DELETE FROM works WHERE id = $1', [workId]);
      }
    } catch (e) {
      console.log('清理异常:', e.message);
    }
  }

  console.log(`\n=== 结果：${pass} 通过 / ${failN} 失败 ===`);
  process.exit(failN ? 1 : 0);
})();
