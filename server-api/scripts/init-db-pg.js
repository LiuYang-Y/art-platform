/**
 * PostgreSQL 建表脚本
 * ------------------------------------------------------------
 * 读取 scripts/schema.sql，逐条执行建表与建索引语句（全部 IF NOT EXISTS，可重复运行）
 *
 * 运行：node scripts/init-db-pg.js
 */

const fs = require('fs');
const path = require('path');

const db = require('../src/utils/config/db');

/** 从 SQL 文件中拆出可执行的语句 */
function parseStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 从语句中提取对象名，用于输出可读日志 */
function describe(statement) {
  const table = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
  if (table) return { type: '表', name: table[1] };

  const index = statement.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
  if (index) return { type: '索引', name: index[1] };

  return { type: '语句', name: statement.slice(0, 40) };
}

(async () => {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = parseStatements(sql);

  console.log('='.repeat(62));
  console.log('  PostgreSQL 建表 · 高校美育成果展示与交流平台');
  console.log(`  环境 ID : ${process.env.TENCENT_ENV_ID}`);
  console.log(`  数据通道: ${db.mode() === 'pg-direct' ? 'pg 直连' : 'CloudBase OpenAPI（未配直连参数）'}`);
  console.log(`  语句数量: ${statements.length}`);
  console.log('='.repeat(62));

  let ok = 0;
  let failed = 0;

  for (const statement of statements) {
    const { type, name } = describe(statement);
    try {
      await db.query(statement);
      console.log(`  ✅ ${type} ${name}`);
      ok++;
    } catch (err) {
      console.log(`  ❌ ${type} ${name} — ${err.message.slice(0, 120)}`);
      failed++;
    }
  }

  console.log('\n' + '─'.repeat(62));
  console.log(`  完成 ${ok} 条，失败 ${failed} 条`);

  // 校验结果
  if (failed === 0) {
    try {
      const res = await db.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`
      );
      console.log('  当前 public 下的表:');
      res.rows.forEach((r) => console.log(`    · ${r.table_name}`));

      const idx = await db.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
         AND indexname LIKE 'idx_%' OR indexname = 'uk_work_user'`
      );
      if (idx.rows.length) {
        console.log('  业务索引:');
        idx.rows.forEach((r) => console.log(`    · ${r.indexname}`));
      }
    } catch (err) {
      console.log('  结果校验跳过:', err.message.slice(0, 80));
    }
  }

  console.log('─'.repeat(62) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})();
