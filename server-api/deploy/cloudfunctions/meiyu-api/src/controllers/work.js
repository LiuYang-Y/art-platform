/**
 * 作品模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * 严格对齐 scripts/_e2e.js 的接口契约：
 *   - 发布后默认 status = 'pending'（待审核），不进瀑布流
 *   - 列表仅展示 'approved'，按 created_at 倒序，游标分页
 *   - coverUrl 取 images 首图，authorName 联表带出
 *   - 点赞 toggle 返回 { liked }
 *
 * 索引命中：idx_works_category_status_created (category, status, created_at DESC)
 */

const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');
const { assertContentSafe } = require('../utils/contentFilter');

const DEFAULT_STATUS = 'pending';
const APPROVED = 'approved';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/** 列表字段（含联表作者信息、首图） */
const LIST_SELECT = `
  SELECT
    w.id, w.title, w.images->>0 AS cover_url, w.category, w.description,
    w.status, w.like_count, w.comment_count, w.view_count, w.created_at,
    u.nick_name AS author_name, u.avatar_url AS author_avatar
  FROM works w
  JOIN users u ON u.id = w.author_id
`;

/**
 * 详情字段：必须带出原始 images 数组（jsonb），否则 toDetail 拿不到图片列表。
 * 注意不能直接复用 LIST_SELECT —— 它只取了 images->>0 首图字符串。
 */
const DETAIL_SELECT = `
  SELECT
    w.id, w.title, w.images, w.category, w.description,
    w.status, w.author_id, w.like_count, w.comment_count, w.view_count,
    w.created_at, w.updated_at,
    u.nick_name AS author_name, u.avatar_url AS author_avatar
  FROM works w
  JOIN users u ON u.id = w.author_id
`;

/** 列表单项 → 驼峰 */
function toListItem(r) {
  return {
    id: r.id,
    title: r.title,
    coverUrl: r.cover_url,
    category: r.category,
    description: r.description,
    status: r.status,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    viewCount: r.view_count,
    createTime: r.created_at
  };
}

/** 详情 → 驼峰（含 images 原数组、点赞状态由前端维护） */
function toDetail(r) {
  return {
    id: r.id,
    title: r.title,
    coverUrl: Array.isArray(r.images) ? r.images[0] : null,
    images: r.images,
    category: r.category,
    description: r.description,
    status: r.status,
    authorId: r.author_id,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    viewCount: r.view_count,
    createTime: r.created_at,
    updateTime: r.updated_at
  };
}

/**
 * GET /api/work/list
 * ------------------------------------------------------------
 * 双列瀑布流 / 分类筛选 / 关键词搜索 / 最新-最热排序 / 游标分页（Z-01）
 * 兼容两类排序入参：'latest'|'new' → 最新(created_at 倒序)；
 *                   'hot'          → 最热(like_count 倒序, 再按时间倒序)。
 * keyword 同时匹配 title / description / 作者昵称（后端模糊检索，大小写不敏感）。
 * 其余保持与原实现一致：仅 approved、每页 20 条游标分页、返回 { list, hasMore, nextCursor }，
 * 因此前端在 mock 与真实数据之间可无缝切换、无需改动。
 */
async function listWorks(req, res) {
  const { category, lastCreateTime } = req.query;
  const keyword = (req.query.keyword || '').trim();
  const sort = (req.query.sort || 'latest').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  try {
    // 动态拼接 WHERE（参数化，避免注入）
    const clauses = [`w.status = '${APPROVED}'`];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      clauses.push(`w.category = $${params.length}`);
    }

    if (keyword) {
      params.push(`%${keyword}%`);
      clauses.push(
        `(w.title ILIKE $${params.length} OR w.description ILIKE $${params.length} OR u.nick_name ILIKE $${params.length})`
      );
    }

    if (lastCreateTime) {
      params.push(lastCreateTime);
      clauses.push(`w.created_at < $${params.length}::timestamptz`);
    }

    // 排序：最热按点赞数倒序（同赞再按时间），最新按时间倒序
    const orderBy =
      sort === 'hot' ? 'w.like_count DESC, w.created_at DESC' : 'w.created_at DESC';

    params.push(limit);
    const sql = `
      ${LIST_SELECT}
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length}
    `;

    const rows = (await query(sql, params)).rows;
    const list = rows.map(toListItem);

    return success(
      res,
      {
        list,
        hasMore: list.length === limit,
        nextCursor: list.length > 0 ? list[list.length - 1].createTime : null
      },
      '查询成功'
    );
  } catch (err) {
    console.error('[work] 作品列表查询异常:', err.message);
    return fail(res, '作品列表查询失败', 500);
  }
}

/** GET /api/work/detail */
async function getWorkDetail(req, res) {
  const { id } = req.query;
  if (!id) return fail(res, '缺少作品 ID', 400);

  try {
    const sql = `
      ${DETAIL_SELECT}
      WHERE w.id = $1
    `;
    const row = await queryOne(sql, [Number(id)]);
    if (!row) return fail(res, '作品不存在或已下架', 404);

    // 浏览量自增
    query('UPDATE works SET view_count = view_count + 1 WHERE id = $1', [Number(id)]).catch(
      (e) => console.warn('[work] 浏览量自增失败:', e.message)
    );

    return success(res, toDetail(row), '查询成功');
  } catch (err) {
    console.error('[work] 作品详情查询异常:', err.message);
    return fail(res, '作品详情查询失败', 500);
  }
}

/** GET /api/work/categories
 * 与小程序端 api.CATEGORIES / 发布页分类保持同一套 key 约定，
 * 便于瀑布流分类筛选与作品发布分类一一对应。
 */
function getCategories(req, res) {
  return success(
    res,
    [
      { key: 'all', name: '全部' },
      { key: 'calligraphy', name: '书法' },
      { key: 'painting', name: '绘画' },
      { key: 'photography', name: '摄影' },
      { key: 'handcraft', name: '手工' },
      { key: 'other', name: '其他艺术' }
    ],
    '查询成功'
  );
}

/** POST /api/work/create（需鉴权） */
async function createWork(req, res) {
  const { title, description, images, category } = req.body || {};

  if (!title || !title.trim()) return fail(res, '作品标题不能为空', 400);
  if (!category) return fail(res, '请选择作品分类', 400);
  if (!Array.isArray(images) || images.length === 0) {
    return fail(res, '请至少上传一张作品图片', 400);
  }

  // 图片必须是已上传完成的公网 URL：wxfile:// 等本机临时路径只有发布者当前
  // 设备可见，一旦入库，Web 端与其他设备将永久裂图（曾有历史脏数据）。
  const invalidImg = images.find((u) => typeof u !== 'string' || !/^https?:\/\//i.test(u));
  if (invalidImg) {
    return fail(res, '图片尚未上传完成，请重新选择图片后再提交', 400);
  }

  // 内容安全过滤（对齐 4.2(3)）：标题 + 简介命中敏感词即阻断
  const safeTitle = await assertContentSafe(title);
  if (!safeTitle.ok) return fail(res, safeTitle.reason, 400);
  if (description && description.trim()) {
    const safeDesc = await assertContentSafe(description);
    if (!safeDesc.ok) return fail(res, safeDesc.reason, 400);
  }

  try {
    const id = await insertReturningId(
      'works',
      ['author_id', 'title', 'category', 'images', 'description', 'status', 'created_at', 'updated_at'],
      [
        req.user.userId,
        title.trim(),
        category,
        images,
        description || '',
        DEFAULT_STATUS,
        new Date(),
        new Date()
      ]
    );

    return success(res, { workId: id, status: DEFAULT_STATUS }, '发布成功，等待审核');
  } catch (err) {
    console.error('[work] 作品发布异常:', err.message);
    return fail(res, '作品发布失败', 500);
  }
}

/** POST /api/work/like（需鉴权） */
async function toggleLike(req, res) {
  const { workId } = req.body || {};
  const userId = req.user.userId;
  if (!workId) return fail(res, '缺少作品 ID', 400);
  const wid = Number(workId);

  try {
    // OpenAPI 不回传 INSERT ... RETURNING，改用「先查后写」判断点赞状态，
    // 并依赖 likes 表的 (work_id, user_id) 唯一约束兜底并发重复。
    const existing = await queryOne(
      'SELECT 1 AS hit FROM likes WHERE work_id = $1 AND user_id = $2',
      [wid, userId]
    );

    if (!existing) {
      // 未点赞 → 新增（唯一约束保证并发下最多 1 条）
      await query(
        'INSERT INTO likes (work_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [wid, userId]
      );
    } else {
      // 已点赞 → 取消
      await query('DELETE FROM likes WHERE work_id = $1 AND user_id = $2', [wid, userId]);
    }

    // 重新计算点赞数，使其与 likes 表实际行数一致（规避计数漂移）
    await query(
      'UPDATE works SET like_count = (SELECT COUNT(*) FROM likes WHERE work_id = $1) WHERE id = $1',
      [wid]
    );

    const finalRow = await queryOne(
      'SELECT EXISTS(SELECT 1 FROM likes WHERE work_id = $1 AND user_id = $2) AS liked',
      [wid, userId]
    );
    const liked = !!(finalRow && finalRow.liked);
    return success(res, { liked }, liked ? '点赞成功' : '已取消点赞');
  } catch (err) {
    console.error('[work] 点赞异常:', err.message);
    return fail(res, '操作失败，请稍后重试', 500);
  }
}

/** GET /api/work/mine（需鉴权） */
async function getMyWorks(req, res) {
  try {
    const rows = (
      await query(
        `SELECT id, title, images->>0 AS cover_url, category, status,
                reject_reason, like_count, comment_count, created_at
         FROM works WHERE author_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.user.userId]
      )
    ).rows;

    const list = rows.map((r) => ({
      id: r.id,
      title: r.title,
      coverUrl: r.cover_url,
      category: r.category,
      status: r.status,
      rejectReason: r.reject_reason,
      likeCount: r.like_count,
      commentCount: r.comment_count,
      createTime: r.created_at
    }));

    return success(res, { list }, '查询成功');
  } catch (err) {
    console.error('[work] 我的作品查询异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/**
 * POST /api/work/delete（需鉴权）
 * Body: { workId }
 * ------------------------------------------------------------
 * 权限：仅作品作者本人可删（管理员下架走 Web 审核通道，与本接口互不影响）。
 * 状态：待审核 / 已通过 / 未通过 均可删——被驳回的作品同样需要清理入口，
 *      不能只留「审核通过后」这一个场景。
 * 级联：先删该作品的全部留言（work_comments）与点赞记录（likes），最后删 works 行
 *      （db 封装无事务，顺序保证：即使中途失败，works 行还在，不会出现孤儿留言）。
 * 注：云存储中的图片对象不做物理删除（URL 不再被引用即不可达，成本可忽略）。
 */
async function deleteWork(req, res) {
  const { workId } = req.body || {};
  if (!workId) return fail(res, '缺少作品 ID', 400);

  const wid = Number(workId);
  if (!Number.isInteger(wid) || wid <= 0) return fail(res, '作品 ID 不合法', 400);
  const userId = Number(req.user.userId);

  try {
    const row = await queryOne('SELECT id, author_id, title FROM works WHERE id = $1', [wid]);
    if (!row) return fail(res, '作品不存在或已被删除', 404);
    if (Number(row.author_id) !== userId) {
      return fail(res, '只能删除自己发布的作品', 403);
    }

    await query('DELETE FROM work_comments WHERE work_id = $1', [wid]);
    await query('DELETE FROM likes WHERE work_id = $1', [wid]);
    await query('DELETE FROM works WHERE id = $1', [wid]);

    return success(res, { workId: wid }, '作品已删除');
  } catch (err) {
    console.error('[work] 作品删除异常:', err.message);
    return fail(res, '删除失败，请稍后重试', 500);
  }
}

module.exports = {
  listWorks,
  getWorkDetail,
  getCategories,
  createWork,
  toggleLike,
  getMyWorks,
  deleteWork
};
