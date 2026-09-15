/* 检查 works.images 实际存储状态 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../src/utils/config/db');

(async () => {
  const r = await db.query('SELECT id, title, images FROM works ORDER BY id');
  console.log('mode:', db.mode(), 'rows:', r.rows.length);
  for (const row of r.rows) {
    const img = row.images;
    const desc = Array.isArray(img) ? `array(${img.length}): ${img[0] || ''}` : JSON.stringify(img);
    console.log(`${row.id}\t${row.title}\t${desc}`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
