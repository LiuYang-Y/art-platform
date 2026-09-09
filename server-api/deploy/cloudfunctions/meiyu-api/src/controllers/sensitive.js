/**
 * 敏感词库管理控制器（对齐 G-06）
 * ------------------------------------------------------------
 * 管理端维护全站内容安全词库：查看/新增/编辑/启停/删除。
 * 词表持久化到 sensitive_words 表，改动后即时刷新 contentFilter 运行时缓存，
 * 使「新增敏感词 → 立即可拦截对应发布/评论」。
 *
 *   GET  /api/admin/sensitive           词库列表（可按分类/关键词筛选）
 *   GET  /api/admin/sensitive/categories 分类统计（供前端 tab/筛选）
 *   POST /api/admin/sensitive/add        新增词（word 唯一）
 *   POST /api/admin/sensitive/update     编辑词（word / category / remark / enabled）
 *   POST /api/admin/sensitive/delete     删除词 { id }
 *   POST /api/admin/sensitive/reset      重置为内置默认词表（可传 true 表示清空重建）
 */

const { query, queryOne } = require('../utils/config/db');
const { success, fail } = require('../utils/response');
const {
  DEFAULT_WORDS,
  reloadWords,
  getLoadedWords,
} = require('../utils/contentFilter');

const CATEGORY_MAP = {
  violation: '政治违禁',
  abuse: '不雅攻击',
  advert: '广告引流',
  other: '其他',
};

/** GET /api/admin/sensitive?keyword=&category= */
async function listWords(req, res) {
  const { keyword, category } = req.query;
  try {
    const conds = [];
    const params = [];
    if (category && CATEGORY_MAP[category]) {
      params.push(category);
      conds.push(`category = $${params.length}`);
    }
    if (keyword && String(keyword).trim()) {
      params.push(`%${String(keyword).trim()}%`);
      conds.push(`word ILIKE $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT id, word, category, remark, enabled, created_at
         FROM sensitive_words ${where}
         ORDER BY id DESC`;
    const rows = (
      await query(sql, params)
    ).rows;
    return success(res, { list: rows, total: rows.length }, '查询成功');
  } catch (err) {
    console.error('[sensitive] 词库查询异常:', err.message);
    return fail(res, '词库查询失败', 500);
  }
}

/** GET /api/admin/sensitive/categories 分类+启用统计 */
async function categoryStats(req, res) {
  try {
    const rows = (
      await query(
        `SELECT category, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE enabled)::int AS enabled
         FROM sensitive_words GROUP BY category`
      )
    ).rows;
    const byCat = { violation: 0, abuse: 0, advert: 0, other: 0, total: 0, enabled: 0 };
    rows.forEach((r) => {
      const c = r.category || 'other';
      if (c in byCat) {
        byCat[c] += r.total;
      }
      byCat.enabled += r.enabled;
      byCat.total += r.total;
    });
    return success(res, { categories: byCat }, '查询成功');
  } catch (err) {
    console.error('[sensitive] 分类统计异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/** POST /api/admin/sensitive/add  { word, category, remark } */
async function addWord(req, res) {
  const { word, category, remark } = req.body || {};
  if (!word || !String(word).trim()) return fail(res, '敏感词不能为空', 400);
  const w = String(word).trim();
  if (w.length > 50) return fail(res, '单个敏感词不能超过 50 字', 400);
  const cat = CATEGORY_MAP[category] ? category : 'other';

  try {
    const exist = await queryOne('SELECT id FROM sensitive_words WHERE word = $1', [w]);
    if (exist) return fail(res, '该敏感词已存在，无需重复添加', 400);
    await query(
      `INSERT INTO sensitive_words (word, category, remark, enabled, created_at)
       VALUES ($1, $2, $3, TRUE, $4)`,
      [w, cat, remark ? String(remark).slice(0, 200) : '', new Date()]
    );
    await reloadWords(); // 即时生效
    return success(res, { word: w }, '已添加并即时生效');
  } catch (err) {
    console.error('[sensitive] 新增异常:', err.message);
    return fail(res, '新增失败', 500);
  }
}

/** POST /api/admin/sensitive/update  { id, word?, category?, remark?, enabled? } */
async function updateWord(req, res) {
  const { id } = req.body || {};
  if (!id) return fail(res, '缺少词条 ID', 400);
  const sets = [];
  const values = [];
  let idx = 1;

  const push = (col, v) => {
    sets.push(`${col} = $${idx++}`);
    values.push(v);
  };
  if (req.body.word !== undefined) {
    const w = String(req.body.word).trim();
    if (!w) return fail(res, '敏感词不能为空', 400);
    push('word', w);
  }
  if (req.body.category !== undefined) {
    const cat = req.body.category;
    push('category', CATEGORY_MAP[cat] ? cat : 'other');
  }
  if (req.body.remark !== undefined) push('remark', String(req.body.remark).slice(0, 200));
  if (req.body.enabled !== undefined) push('enabled', !!req.body.enabled);

  if (sets.length === 0) return fail(res, '没有可更新的字段', 400);
  try {
    const exist = await queryOne('SELECT id FROM sensitive_words WHERE id = $1', [Number(id)]);
    if (!exist) return fail(res, '词条不存在', 404);
    values.push(Number(id));
    await query(`UPDATE sensitive_words SET ${sets.join(', ')} WHERE id = $${idx}`, values);
    await reloadWords();
    return success(res, { updated: Number(id) }, '已更新并即时生效');
  } catch (err) {
    // 唯一冲突（word 重复）
    if (err.message && err.message.includes('uk_sensitive_word')) {
      return fail(res, '该敏感词已存在', 400);
    }
    console.error('[sensitive] 更新异常:', err.message);
    return fail(res, '更新失败', 500);
  }
}

/** POST /api/admin/sensitive/delete  { id } 或 { ids: [] } */
async function deleteWords(req, res) {
  const ids = (req.body && req.body.ids) || (req.body && req.body.id ? [req.body.id] : []);
  if (!Array.isArray(ids) || ids.length === 0) return fail(res, '缺少要删除的词条 ID', 400);
  try {
    const nums = ids.map((i) => Number(i)).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length === 0) return fail(res, '缺少要删除的词条 ID', 400);
    const ph = nums.map((_, i) => `$${i + 1}`).join(',');
    const res2 = await query(`DELETE FROM sensitive_words WHERE id IN (${ph})`, nums);
    await reloadWords();
    return success(res, { deleted: (res2 && res2.rowCount) || nums.length }, '已删除');
  } catch (err) {
    console.error('[sensitive] 删除异常:', err.message);
    return fail(res, '删除失败', 500);
  }
}

/** POST /api/admin/sensitive/reset  { rebuild?: boolean }
 *  将词库重置为内置默认词表（清空现有启用词后灌入默认词）。 */
async function resetWords(req, res) {
  try {
    // 仅重置内置分类词（violation/abuse/advert/other 均来自默认表）
    await query('DELETE FROM sensitive_words');
    const now = new Date();
    for (const w of DEFAULT_WORDS) {
      await query(
        `INSERT INTO sensitive_words (word, category, remark, enabled, created_at)
         VALUES ($1, $2, $3, TRUE, $4)
         ON CONFLICT (word) DO NOTHING`,
        [w.word, w.category, '内置默认词', now]
      );
    }
    await reloadWords();
    return success(res, { count: DEFAULT_WORDS.length }, '已重置为默认词表并即时生效');
  } catch (err) {
    console.error('[sensitive] 重置异常:', err.message);
    return fail(res, '重置失败', 500);
  }
}

module.exports = {
  listWords,
  categoryStats,
  addWord,
  updateWord,
  deleteWords,
  resetWords,
};
