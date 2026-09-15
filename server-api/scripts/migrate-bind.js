#!/usr/bin/env node
/**
 * G-07 学号绑定认定 —— 数据库迁移（幂等，可重复执行）
 * ------------------------------------------------------------
 * 1. users 表补列：student_id / real_name / bind_status /
 *    bind_apply_at / bind_audit_at / bind_reject_reason
 * 2. 学号唯一索引（部分索引，仅已填写学号的行）
 * 3. 存量账号全部视为「已认定」（bind_status='approved'），
 *    不打断现有演示账号的发布能力（用户决策）
 * 4. 清理坏数据：作品 134 两张图片均为 wxfile:// 本机临时路径，
 *    服务器无法恢复，按用户决策删除（含其点赞 / 评论关联行）
 *
 * 用法：node scripts/migrate-bind.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../src/utils/config/db');

const DDL = [
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(32)",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name VARCHAR(64)",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS bind_status VARCHAR(16) NOT NULL DEFAULT 'unbound'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS bind_apply_at TIMESTAMP WITH TIME ZONE",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS bind_audit_at TIMESTAMP WITH TIME ZONE",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS bind_reject_reason TEXT",
  // 学号全局唯一（NULL 不参与）：一个学号只能被一个账号绑定/申请
  'CREATE UNIQUE INDEX IF NOT EXISTS uk_users_student_id ON users (student_id) WHERE student_id IS NOT NULL',
  // 存量账号自动视为已认定（仅迁移从未绑定过的老账号）
  "UPDATE users SET bind_status = 'approved' WHERE bind_status = 'unbound'"
];

(async () => {
  console.log('mode:', db.mode());

  for (const sql of DDL) {
    await db.query(sql);
    console.log('OK :', sql.slice(0, 72));
  }

  // 清理 wxfile:// 坏作品（防御：不硬编码 id，凡是 images 含 wxfile:// 的都删）
  const bad = await db.query(
    "SELECT id, title FROM works WHERE images::text LIKE '%wxfile://%'"
  );
  for (const w of bad.rows) {
    await db.query('DELETE FROM likes WHERE work_id = $1', [w.id]);
    await db.query('DELETE FROM work_comments WHERE work_id = $1', [w.id]);
    await db.query('DELETE FROM works WHERE id = $1', [w.id]);
    console.log(`DEL: 作品 ${w.id}（${w.title}）图片为本机临时路径，已删除`);
  }
  if (!bad.rows.length) console.log('DEL: 无 wxfile:// 坏作品');

  const stat = await db.query(
    'SELECT bind_status, COUNT(*)::int AS n FROM users GROUP BY bind_status ORDER BY 1'
  );
  console.log('bind_status 分布:', JSON.stringify(stat.rows));

  process.exit(0);
})().catch((e) => {
  console.error('迁移失败:', e.message);
  process.exit(1);
});
