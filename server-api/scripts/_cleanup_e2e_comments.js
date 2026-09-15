/** 临时：清掉上一轮 e2e 残留的 [E2E- 测试评论，并回滚 comment_count */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const db = require('../src/utils/config/db');

(async () => {
  const rows = await db.query("SELECT id, work_id FROM work_comments WHERE content LIKE '[E2E-%' ORDER BY id");
  console.log('待清理:', rows.rows.map((r) => r.id + '@' + r.work_id).join(', ') || '（无）');

  const perWork = {};
  for (const r of rows.rows) {
    perWork[r.work_id] = (perWork[r.work_id] || 0) + 1;
    await db.query('DELETE FROM work_comments WHERE id = $1', [r.id]);
  }
  for (const [wid, n] of Object.entries(perWork)) {
    await db.query('UPDATE works SET comment_count = GREATEST(comment_count - $2, 0) WHERE id = $1', [
      Number(wid),
      n
    ]);
    const w = await db.queryOne('SELECT id, comment_count FROM works WHERE id = $1', [Number(wid)]);
    console.log(`作品 ${w.id} 减去 ${n}，现 comment_count=${w.comment_count}`);
  }

  const left = await db.query("SELECT COUNT(*)::int n FROM work_comments WHERE content LIKE '[E2E-%'");
  console.log('残留 =', left.rows[0].n);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
