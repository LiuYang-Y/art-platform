/**
 * 端到端验证（临时脚本）
 * 覆盖：发布 → 审核 → 列表筛选 → 详情 → 点赞/取消 → 并发防重 → 我的作品
 */

const dotenv = require('dotenv');
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const axios = require('axios');
const { query, queryOne, insertReturningId } = require('../src/utils/config/db');

const BASE = 'http://127.0.0.1:3000';
const TEST_OPENID = 'e2e_test_openid_' + Date.now();

const results = [];
function check(label, cond, extra = '') {
  results.push(cond);
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  →  ' + extra : ''}`);
}

(async () => {
  // ---------- 准备测试用户 ----------
  const userId = await insertReturningId('users', ['openid', 'nick_name', 'role'], [
    TEST_OPENID,
    '测试同学',
    'student'
  ]);
  const user = { id: userId, openid: TEST_OPENID };
  const token = jwt.sign(
    { userId: user.id, role: 'student', openid: user.openid },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  const auth = { Authorization: `Bearer ${token}` };
  const http = (cfg) => axios({ ...cfg, validateStatus: () => true });

  console.log(`\n测试用户 id=${user.id}\n` + '─'.repeat(56));

  let workId = null;

  try {
    // 1. 发布作品
    const created = await http({
      method: 'post',
      url: `${BASE}/api/work/create`,
      data: {
        title: 'E2E 测试作品《兰亭序》',
        category: 'calligraphy',
        images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        description: '自动化验证用'
      },
      headers: auth
    });
    workId = created.data && created.data.data && created.data.data.workId;
    check('发布作品', created.data.code === 200 && !!workId, `workId=${workId}`);
    check('新作品为待审核', created.data.data && created.data.data.status === 'pending');

    // 2. 待审核不应出现在列表
    const listPending = await http({ method: 'get', url: `${BASE}/api/work/list` });
    const inPending = (listPending.data.data.list || []).some((w) => w.id === workId);
    check('待审核作品不进瀑布流', !inPending);

    // 3. 审核通过
    await query(`UPDATE works SET status = 'approved' WHERE id = $1`, [workId]);
    const listOk = await http({ method: 'get', url: `${BASE}/api/work/list` });
    const item = (listOk.data.data.list || []).find((w) => w.id === workId);
    check('审核后出现在瀑布流', !!item);
    check('封面取 images 第一张', item && item.coverUrl === 'https://example.com/a.jpg', item && item.coverUrl);
    check('联表带出作者名', item && item.authorName === '测试同学', item && item.authorName);

    // 4. 分类筛选
    const listCalli = await http({ method: 'get', url: `${BASE}/api/work/list?category=calligraphy` });
    const listPaint = await http({ method: 'get', url: `${BASE}/api/work/list?category=painting` });
    check('分类筛选命中', (listCalli.data.data.list || []).some((w) => w.id === workId));
    check('分类筛选排除其他类', !(listPaint.data.data.list || []).some((w) => w.id === workId));

    // 5. 游标分页
    const page1 = await http({ method: 'get', url: `${BASE}/api/work/list?limit=1` });
    const cursor = page1.data.data.nextCursor;
    const page2 = await http({
      method: 'get',
      url: `${BASE}/api/work/list?limit=1&lastCreateTime=${encodeURIComponent(cursor)}`
    });
    const ids1 = (page1.data.data.list || []).map((w) => w.id);
    const ids2 = (page2.data.data.list || []).map((w) => w.id);
    check('游标分页不重复', ids2.length === 0 || !ids1.includes(ids2[0]), `page1=${ids1} page2=${ids2}`);

    // 6. 详情
    const detail = await http({ method: 'get', url: `${BASE}/api/work/detail?id=${workId}` });
    check('作品详情可读', detail.data.code === 200 && detail.data.data.id === workId);

    // 7. 点赞 → 取消
    const like1 = await http({ method: 'post', url: `${BASE}/api/work/like`, data: { workId }, headers: auth });
    check('首次点赞 liked=true', like1.data.data && like1.data.data.liked === true, JSON.stringify(like1.data));

    const cnt1 = (await queryOne('SELECT like_count FROM works WHERE id = $1', [workId])).like_count;
    check('点赞数 +1', cnt1 === 1, `like_count=${cnt1}`);

    const like2 = await http({ method: 'post', url: `${BASE}/api/work/like`, data: { workId }, headers: auth });
    check('再次点赞转为取消', like2.data.data && like2.data.data.liked === false, JSON.stringify(like2.data));

    const cnt2 = (await queryOne('SELECT like_count FROM works WHERE id = $1', [workId])).like_count;
    check('取消后点赞数归零', cnt2 === 0, `like_count=${cnt2}`);

    // 8. 并发防重：同一用户同时发 6 次点赞
    await query('DELETE FROM likes WHERE work_id = $1 AND user_id = $2', [workId, user.id]);
    await query('UPDATE works SET like_count = 0 WHERE id = $1', [workId]);

    const burst = await Promise.all(
      Array.from({ length: 6 }, () =>
        http({ method: 'post', url: `${BASE}/api/work/like`, data: { workId }, headers: auth })
      )
    );
    const likeRows = await queryOne(
      'SELECT COUNT(*)::int AS cnt FROM likes WHERE work_id = $1 AND user_id = $2',
      [workId, user.id]
    );
    check(
      '并发6次点赞后 likes 表最多1条（唯一约束生效）',
      likeRows.cnt <= 1,
      `实际 ${likeRows.cnt} 条`
    );

    // 9. 我的作品
    const mine = await http({ method: 'get', url: `${BASE}/api/work/mine`, headers: auth });
    check('我的作品可查', (mine.data.data.list || []).some((w) => w.id === workId));

    // 10. 鉴权
    const noAuth = await http({ method: 'post', url: `${BASE}/api/work/like`, data: { workId } });
    check('无 Token 点赞被拦截', noAuth.status === 401, `HTTP ${noAuth.status}`);
  } catch (err) {
    check('执行过程异常', false, err.message);
  } finally {
    // ---------- 清理 ----------
    if (workId) {
      await query('DELETE FROM likes WHERE work_id = $1', [workId]).catch(() => {});
      await query('DELETE FROM work_comments WHERE work_id = $1', [workId]).catch(() => {});
      await query('DELETE FROM works WHERE id = $1', [workId]).catch(() => {});
    }
    await query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => {});
    console.log('─'.repeat(56));
    console.log(`通过 ${results.filter(Boolean).length}/${results.length}`);
    const dirty = await queryOne("SELECT COUNT(*)::int AS cnt FROM users WHERE openid LIKE 'e2e_test_%'");
    console.log(`残留测试用户: ${dirty.cnt}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
