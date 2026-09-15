/**
 * 迁移：作品留言支持二级回复
 * ------------------------------------------------------------
 * 背景：work_comments 原本只有 parent_id，前端只渲染一层 replies，
 *       「回复某条回复」时后端把数据挂到 reply.replies 上，前端不渲染 → 回复丢失。
 *
 * 方案（对齐微信留言习惯的「扁平两层」）：
 *   - parent_id 一律指向**一级评论**（根），回复的回复也归到同一个根下
 *   - 新增 reply_to_user_id 记录「回复 @谁」，用于列表里展示「回复 @昵称」
 *
 * 本次变更：
 *   1) ALTER TABLE work_comments ADD COLUMN reply_to_user_id
 *   2) 回填历史回复的 reply_to_user_id（取其父评论作者）
 *   3) 归并历史上的多层嵌套（parent 指向回复的行 → 改指向该回复的根）
 *
 * 执行：node scripts/migrate-comment-reply.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const db = require('../src/utils/config/db');

(async () => {
  console.log('=== 作品留言二级回复迁移 ===\n');

  // 1. 加列
  await db.query(
    'ALTER TABLE work_comments ADD COLUMN IF NOT EXISTS reply_to_user_id INT REFERENCES users(id) ON DELETE SET NULL'
  );
  console.log('[1] 列 reply_to_user_id 就绪');

  // 2. 回填：历史回复的「被回复人」= 其父评论作者（幂等，只填空值）
  const filled = await db.query(
    `UPDATE work_comments c
     SET reply_to_user_id = p.user_id
     FROM work_comments p
     WHERE c.parent_id = p.id AND c.reply_to_user_id IS NULL`
  );
  console.log('[2] 回填 reply_to_user_id 行数 =', filled.rowCount);

  // 3. 归并多层嵌套：把 parent 指向「回复」的行改挂到该回复的根
  const deep = await db.query(
    `SELECT c.id, c.parent_id
     FROM work_comments c
     JOIN work_comments p ON p.id = c.parent_id
     WHERE p.parent_id IS NOT NULL`
  );
  let merged = 0;
  for (const row of deep.rows) {
    let cur = Number(row.parent_id);
    let root = null;
    for (let i = 0; i < 20; i++) {
      const p = await db.queryOne('SELECT id, parent_id FROM work_comments WHERE id = $1', [cur]);
      if (!p) break;
      if (p.parent_id == null) {
        root = Number(p.id);
        break;
      }
      cur = Number(p.parent_id);
    }
    if (root && root !== Number(row.parent_id)) {
      await db.query('UPDATE work_comments SET parent_id = $1 WHERE id = $2', [root, row.id]);
      merged++;
    }
  }
  console.log('[3] 归并多层嵌套行数 =', merged);

  // 4. 自检
  const stat = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE parent_id IS NULL)::int AS top,
       COUNT(*) FILTER (WHERE parent_id IS NOT NULL)::int AS replies,
       COUNT(*) FILTER (WHERE reply_to_user_id IS NOT NULL)::int AS with_reply_to
     FROM work_comments`
  );
  const r = stat.rows[0];
  console.log(
    `[4] 自检 total=${r.total} 一级=${r.top} 回复=${r.replies} 带被回复人=${r.with_reply_to}`
  );

  const stillDeep = await db.query(
    `SELECT COUNT(*)::int AS n FROM work_comments c
     JOIN work_comments p ON p.id = c.parent_id
     WHERE p.parent_id IS NOT NULL`
  );
  console.log('    残留多层嵌套 =', stillDeep.rows[0].n, stillDeep.rows[0].n === 0 ? '（OK）' : '（需人工检查）');

  process.exit(0);
})().catch((e) => {
  console.error('迁移失败:', e.message);
  process.exit(1);
});
