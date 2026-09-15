/**
 * 迁移：取消「昵称」概念，统一以「姓名」作为平台展示名
 * ------------------------------------------------------------
 * 1. 存量账号：real_name 为空时，用现有 nick_name 回填为姓名
 *    （管理端编辑姓名时后端会双写 nick_name，保证展示链路一致）
 * 2. 输出迁移前后统计，便于核对
 *
 * 幂等：仅处理 real_name 为 NULL / 空串的行，可重复执行
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const db = require('../src/utils/config/db');

(async () => {
  const before = await db.queryOne(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(real_name,'') = '') AS no_name,
            COUNT(*) FILTER (WHERE COALESCE(real_name,'') <> '') AS has_name
     FROM users`
  );
  console.log('[migrate-real-name] 迁移前:', JSON.stringify(before));

  const res = await db.query(
    `UPDATE users
     SET real_name = nick_name, updated_at = $1
     WHERE COALESCE(real_name, '') = ''
       AND COALESCE(nick_name, '') <> ''`,
    [new Date()]
  );
  console.log('[migrate-real-name] 已回填行数:', res.rowCount);

  const after = await db.queryOne(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(real_name,'') = '') AS no_name,
            COUNT(*) FILTER (WHERE COALESCE(real_name,'') <> '') AS has_name
     FROM users`
  );
  console.log('[migrate-real-name] 迁移后:', JSON.stringify(after));

  const rows = await db.query(
    `SELECT id, username, real_name, nick_name, bind_status
     FROM users ORDER BY id LIMIT 30`
  );
  console.log('\n=== USERS ===');
  rows.rows.forEach((r) =>
    console.log(
      ` #${r.id} ${r.username || '-'} 姓名=${r.real_name || '(空)'} nick=${r.nick_name || '(空)'} bind=${r.bind_status}`
    )
  );

  process.exit(0);
})().catch((e) => {
  console.error('[migrate-real-name] 失败:', e.message);
  process.exit(1);
});
