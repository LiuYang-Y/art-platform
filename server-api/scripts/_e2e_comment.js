/**
 * 评论模块端到端验证（临时脚本）
 * 覆盖：发表一级评论 → 作者回复标记 → 嵌套回复 → 评论树 → 评论数联动 → 鉴权
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
  // 作者 + 评论者
  const authorId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    `e2e_c_author_${TS}`,
    '作者甲',
    'student'
  ]);
  const commenterId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    `e2e_c_commenter_${TS}`,
    '评论乙',
    'student'
  ]);
  const tokenA = jwt.sign({ userId: authorId, role: 'student', openid: `e2e_c_author_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const tokenB = jwt.sign({ userId: commenterId, role: 'student', openid: `e2e_c_commenter_${TS}` }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };
  const http = (cfg) => axios({ ...cfg, validateStatus: () => true });

  console.log(`作者 id=${authorId}  评论者 id=${commenterId}\n` + '─'.repeat(56));

  const workId = await insertReturningId(
    'works',
    ['author_id', 'title', 'category', 'images', 'description', 'status', 'created_at', 'updated_at'],
    [authorId, '评论测试作品', 'painting', ['https://example.com/x.jpg'], 'desc', 'approved', new Date(), new Date()]
  );

  try {
    // 1. 作者发表一级评论（应为作者回复标记）
    const c1 = await http({
      method: 'post',
      url: `${BASE}/api/comment/add`,
      data: { workId, content: '这是一级评论' },
      headers: authA
    });
    const c1Id = c1.data && c1.data.data && c1.data.data.id;
    check('发表一级评论', c1.data.code === 200 && !!c1Id, `id=${c1Id}`);
    check('作者本人评论 → isAuthorReply=true', c1.data.data && c1.data.data.isAuthorReply === true);

    // 2. 评论者嵌套回复
    const c2 = await http({
      method: 'post',
      url: `${BASE}/api/comment/add`,
      data: { workId, content: '这是回复', parentId: c1Id },
      headers: authB
    });
    const c2Id = c2.data && c2.data.data && c2.data.data.id;
    check('发表嵌套回复', c2.data.code === 200 && !!c2Id, `id=${c2Id}`);
    check('非作者回复 → isAuthorReply=false', c2.data.data && c2.data.data.isAuthorReply === false);
    check('回复带出被回复人昵称', c2.data.data && c2.data.data.replyToUserName === '作者甲', c2.data.data && c2.data.data.replyToUserName);

    // 3. 评论树
    const list = await http({ method: 'get', url: `${BASE}/api/comment/list?workId=${workId}` });
    const top = (list.data.data.list || [])[0];
    check('评论树含 1 条一级评论', (list.data.data.list || []).length === 1, `top=${list.data.data.list.length}`);
    check('一级评论挂 1 条回复', top && top.replies && top.replies.length === 1, top && `replies=${top.replies.length}`);
    check('回复归属正确', top && top.replies[0] && top.replies[0].id === c2Id);

    // 4. 评论数联动
    const cnt = (await queryOne('SELECT comment_count FROM works WHERE id = $1', [workId])).comment_count;
    check('作品评论数 = 2', cnt === 2, `comment_count=${cnt}`);

    // 5. 参数校验
    const noContent = await http({ method: 'post', url: `${BASE}/api/comment/add`, data: { workId, content: '' }, headers: authB });
    check('空内容被拦截', noContent.data.code === 400, `HTTP ${noContent.status}`);

    // 6. 回复不存在的父评论
    const badParent = await http({ method: 'post', url: `${BASE}/api/comment/add`, data: { workId, content: 'x', parentId: 999999 }, headers: authB });
    check('回复不存在的评论被拦截', badParent.data.code === 404);

    // 7. 鉴权
    const noAuth = await http({ method: 'post', url: `${BASE}/api/comment/add`, data: { workId, content: 'x' } });
    check('无 Token 发表评论被拦截', noAuth.status === 401, `HTTP ${noAuth.status}`);
  } catch (err) {
    check('执行过程异常', false, err.message);
  } finally {
    await query('DELETE FROM work_comments WHERE work_id = $1', [workId]).catch(() => {});
    await query('DELETE FROM works WHERE id = $1', [workId]).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [authorId]).catch(() => {});
    await query('DELETE FROM users WHERE id = $1', [commenterId]).catch(() => {});
    console.log('─'.repeat(56));
    console.log(`通过 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
