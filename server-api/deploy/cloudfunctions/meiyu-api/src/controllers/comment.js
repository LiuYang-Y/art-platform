/**
 * 作品评论模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * 支撑「交流」能力：作品下的评论 + 二级回复（扁平两层，对齐微信留言习惯）。
 *
 * 表结构（scripts/schema.sql）：
 *   work_comments(id, work_id, user_id, content, parent_id,
 *                 reply_to_user_id, is_author_reply, created_at)
 *   - parent_id 为空 → 一级评论（根）
 *   - parent_id 指向某条一级评论 → 该评论下的回复
 *     ★ 无论回复的是「一级评论」还是「某条回复」，parent_id 一律落到根评论上，
 *       保证永远只有两层；「回复 @谁」由 reply_to_user_id 记录
 *   - is_author_reply：评论人恰为作品作者时置 TRUE（作者亲自回复标识）
 *
 * 对外接口：
 *   GET  /api/comment/list   作品评论树（可选鉴权：登录后附带 canDelete 标记）
 *   POST /api/comment/add    发表评论 / 回复（需鉴权）
 *   POST /api/comment/delete 删除评论（需鉴权：评论作者本人 或 作品作者）
 */

const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');
const { assertContentSafe } = require('../utils/contentFilter');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_CONTENT = 500;

/** 单行 → 驼峰（含评论人、被回复人昵称与头像） */
function toComment(r) {
  return {
    id: r.id,
    workId: r.work_id,
    userId: r.user_id,
    userName: r.user_name,
    userAvatar: r.user_avatar,
    content: r.content,
    parentId: r.parent_id,
    isAuthorReply: r.is_author_reply,
    replyToUserId: r.reply_to_user_id,
    replyToUserName: r.reply_to_user_name,
    createTime: r.created_at,
    canDelete: false,
    replies: []
  };
}

/**
 * 标记哪些评论当前登录用户可以删除（前端据此渲染「删除」按钮）
 * 规则：评论作者本人可删自己的；作品作者（楼主）可删自己作品下的任意评论
 */
function markCanDelete(list, userId, isWorkAuthor) {
  if (!userId) return list;
  for (const item of list) {
    item.canDelete = isWorkAuthor || Number(item.userId) === userId;
    for (const reply of item.replies || []) {
      reply.canDelete = isWorkAuthor || Number(reply.userId) === userId;
    }
  }
  return list;
}

const LIST_SELECT = `
  SELECT
    c.id, c.work_id, c.user_id, c.content, c.parent_id,
    c.is_author_reply, c.created_at,
    u.nick_name AS user_name, u.avatar_url AS user_avatar,
    COALESCE(c.reply_to_user_id, p.user_id) AS reply_to_user_id,
    COALESCE(rt.nick_name, pu.nick_name) AS reply_to_user_name
  FROM work_comments c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN work_comments p ON p.id = c.parent_id
  LEFT JOIN users pu ON pu.id = p.user_id
  LEFT JOIN users rt ON rt.id = c.reply_to_user_id
`;

/**
 * 回溯某条评论所属的一级评论（根）id
 * 用于「回复某条回复」时把 parent_id 收敛到根，避免出现三层以上
 */
async function resolveRootId(commentId) {
  let cur = Number(commentId);
  for (let i = 0; i < 20; i++) {
    const row = await queryOne('SELECT id, parent_id FROM work_comments WHERE id = $1', [cur]);
    if (!row) return null;
    if (row.parent_id == null) return Number(row.id);
    cur = Number(row.parent_id);
  }
  return null;
}

/**
 * 把扁平的评论行组装成「一级评论 + 各自 replies」的两层结构
 * 历史脏数据（parent 指向回复）会在此自动归并到根，不会丢评论
 */
function buildTree(rows) {
  const rowById = new Map();
  for (const r of rows) rowById.set(Number(r.id), r);

  const nodeById = new Map();
  const list = [];

  // 1) 先落一级评论（保证根节点先于回复建好）
  for (const r of rows) {
    if (r.parent_id == null) {
      const item = toComment(r);
      nodeById.set(item.id, item);
      list.push(item);
    }
  }

  // 2) 再挂回复，parent 一路回溯到根
  for (const r of rows) {
    if (r.parent_id == null) continue;
    const item = toComment(r);
    nodeById.set(item.id, item);

    let rootId = Number(r.parent_id);
    const seen = new Set();
    while (!seen.has(rootId)) {
      seen.add(rootId);
      const p = rowById.get(rootId);
      if (!p || p.parent_id == null) break;
      rootId = Number(p.parent_id);
    }

    const root = nodeById.get(rootId);
    if (root) {
      root.replies.push(item);
    } else {
      // 兜底：根评论已被删除，降级为一级展示，避免评论丢失
      list.push(item);
    }
  }

  return list;
}

/** GET /api/comment/list?workId=<id>（可选鉴权，登录时附带 canDelete） */
async function listComments(req, res) {
  const { workId } = req.query;
  if (!workId) return fail(res, '缺少作品 ID', 400);

  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const wid = Number(workId);

  try {
    // 多取一些再裁剪：回复也要占额度，否则末尾一级评论可能被截断
    const rows = (
      await query(
        `${LIST_SELECT} WHERE c.work_id = $1 ORDER BY c.created_at ASC LIMIT $2`,
        [wid, limit * 3]
      )
    ).rows;

    const list = buildTree(rows);

    // 登录用户：标注可删除项（评论作者本人 / 作品作者）
    const userId = req.user && req.user.userId ? Number(req.user.userId) : null;
    if (userId) {
      const work = await queryOne('SELECT author_id FROM works WHERE id = $1', [wid]);
      const isWorkAuthor = !!work && Number(work.author_id) === userId;
      markCanDelete(list, userId, isWorkAuthor);
    }

    return success(res, { list }, '查询成功');
  } catch (err) {
    console.error('[comment] 评论列表查询异常:', err.message);
    return fail(res, '评论查询失败', 500);
  }
}

/** POST /api/comment/add（需鉴权） */
async function addComment(req, res) {
  const { workId, content, parentId } = req.body || {};
  const userId = req.user.userId;

  if (!workId) return fail(res, '缺少作品 ID', 400);
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail(res, '评论内容不能为空', 400);
  }
  if (content.length > MAX_CONTENT) {
    return fail(res, `评论内容不能超过 ${MAX_CONTENT} 字`, 400);
  }

  // 内容安全过滤（对齐 4.2(3)）：评论/回复命中敏感词即阻断
  const safe = await assertContentSafe(content);
  if (!safe.ok) return fail(res, safe.reason, 400);

  const wid = Number(workId);

  try {
    // 作品必须存在
    const work = await queryOne('SELECT id, author_id FROM works WHERE id = $1', [wid]);
    if (!work) return fail(res, '作品不存在', 404);

    let pid = null;
    let replyToUserId = null;
    if (parentId != null) {
      const parent = await queryOne(
        'SELECT id, work_id, user_id, parent_id FROM work_comments WHERE id = $1',
        [Number(parentId)]
      );
      if (!parent) return fail(res, '被回复的评论不存在', 404);
      if (Number(parent.work_id) !== wid) {
        return fail(res, '被回复的评论不属于该作品', 400);
      }

      // 被回复人 = 被点的那条评论的作者（无论那是一级评论还是某条回复）
      replyToUserId = Number(parent.user_id);

      // parent_id 一律收敛到一级评论，保证结构永远两层
      pid = parent.parent_id == null ? Number(parent.id) : await resolveRootId(Number(parent.id));
      if (!pid) return fail(res, '被回复的评论已不存在', 404);
    }

    // 作者亲自下场回复 → 标记
    const isAuthorReply = Number(work.author_id) === Number(userId);

    const id = await insertReturningId(
      'work_comments',
      ['work_id', 'user_id', 'content', 'parent_id', 'reply_to_user_id', 'is_author_reply', 'created_at'],
      [wid, userId, content.trim(), pid, replyToUserId, isAuthorReply, new Date()]
    );

    // 评论数联动（每条评论行都计入，含回复）
    await query('UPDATE works SET comment_count = comment_count + 1 WHERE id = $1', [wid]);

    const row = await queryOne(
      `${LIST_SELECT} WHERE c.id = $1`,
      [id]
    );
    return success(res, toComment(row), '评论成功');
  } catch (err) {
    console.error('[comment] 发表评论异常:', err.message);
    return fail(res, '评论发表失败', 500);
  }
}

/**
 * POST /api/comment/delete（需鉴权）
 * Body: { commentId }
 * ------------------------------------------------------------
 * 权限：评论作者本人可删自己的评论；作品作者（楼主）可删自己作品下的任意评论。
 * 删除一级评论时，其下所有回复递归一并删除（不留孤儿回复）；
 * 删除后按实际删除行数回减 works.comment_count，并做下限保护。
 */
async function deleteComment(req, res) {
  const { commentId } = req.body || {};
  if (!commentId) return fail(res, '缺少评论 ID', 400);

  const cid = Number(commentId);
  if (!Number.isInteger(cid) || cid <= 0) return fail(res, '评论 ID 不合法', 400);
  const userId = Number(req.user.userId);

  try {
    // 评论必须存在；同时带出作品作者用于「楼主可删」判定
    const row = await queryOne(
      `SELECT c.id, c.work_id, c.user_id, w.author_id
       FROM work_comments c
       JOIN works w ON w.id = c.work_id
       WHERE c.id = $1`,
      [cid]
    );
    if (!row) return fail(res, '评论不存在或已被删除', 404);

    const isOwner = Number(row.user_id) === userId;
    const isWorkAuthor = Number(row.author_id) === userId;
    if (!isOwner && !isWorkAuthor) {
      return fail(res, '只能删除自己的评论，或自己作品下的评论', 403, 403);
    }

    // 递归收集待删除节点（自身 + 所有层级的子回复），兼容历史脏数据
    // 注意：本项目 DB 通道不可用数组参数（ANY($1::int[]) 会被转义成字符串字面量），
    // 必须展开为 $1,$2,… 逐个占位
    const ids = (
      await query(
        `WITH RECURSIVE sub AS (
           SELECT id FROM work_comments WHERE id = $1
           UNION ALL
           SELECT c.id FROM work_comments c JOIN sub s ON c.parent_id = s.id
         )
         SELECT id FROM sub`,
        [cid]
      )
    ).rows.map((r) => Number(r.id));

    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    await query(`DELETE FROM work_comments WHERE id IN (${ph})`, ids);
    await query(
      'UPDATE works SET comment_count = GREATEST(comment_count - $2, 0) WHERE id = $1',
      [Number(row.work_id), ids.length]
    );

    return success(res, { deleted: ids.length, ids }, '已删除');
  } catch (err) {
    console.error('[comment] 删除评论异常:', err.message);
    return fail(res, '删除失败，请稍后重试', 500);
  }
}

module.exports = { listComments, addComment, deleteComment };
