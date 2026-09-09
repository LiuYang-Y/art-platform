/**
 * 作品评论模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * 支撑「交流」能力：作品下的评论 + 一层嵌套回复。
 *
 * 表结构（scripts/schema.sql）：
 *   work_comments(id, work_id, user_id, content, parent_id,
 *                 is_author_reply, created_at)
 *   - parent_id 为空 → 一级评论
 *   - parent_id 指向某条一级评论 → 该评论的回复（仅一层）
 *   - is_author_reply：评论人恰为作品作者时置 TRUE（作者亲自回复标识）
 *
 * 对外接口：
 *   GET  /api/comment/list  作品评论树（无需鉴权）
 *   POST /api/comment/add   发表评论 / 回复（需鉴权）
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
    replies: []
  };
}

const LIST_SELECT = `
  SELECT
    c.id, c.work_id, c.user_id, c.content, c.parent_id,
    c.is_author_reply, c.created_at,
    u.nick_name AS user_name, u.avatar_url AS user_avatar,
    p.user_id AS reply_to_user_id,
    pu.nick_name AS reply_to_user_name
  FROM work_comments c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN work_comments p ON p.id = c.parent_id
  LEFT JOIN users pu ON pu.id = p.user_id
`;

/** GET /api/comment/list?workId=<id> */
async function listComments(req, res) {
  const { workId } = req.query;
  if (!workId) return fail(res, '缺少作品 ID', 400);

  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const rows = (
      await query(
        `${LIST_SELECT} WHERE c.work_id = $1 ORDER BY c.created_at ASC LIMIT $2`,
        [Number(workId), limit]
      )
    ).rows;

    // 组装一层嵌套：一级评论挂 replies
    const byId = new Map();
    const list = [];
    for (const r of rows) {
      const item = toComment(r);
      byId.set(item.id, item);
      if (item.parentId == null) {
        list.push(item);
      }
    }
    for (const r of rows) {
      if (r.parent_id != null) {
        const parent = byId.get(Number(r.parent_id));
        if (parent) parent.replies.push(toComment(r));
      }
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
    if (parentId != null) {
      const parent = await queryOne(
        'SELECT id, work_id, user_id FROM work_comments WHERE id = $1',
        [Number(parentId)]
      );
      if (!parent) return fail(res, '被回复的评论不存在', 404);
      if (Number(parent.work_id) !== wid) {
        return fail(res, '被回复的评论不属于该作品', 400);
      }
      pid = Number(parentId);
    }

    // 作者亲自下场回复 → 标记
    const isAuthorReply = Number(work.author_id) === Number(userId);

    const id = await insertReturningId(
      'work_comments',
      ['work_id', 'user_id', 'content', 'parent_id', 'is_author_reply', 'created_at'],
      [wid, userId, content.trim(), pid, isAuthorReply, new Date()]
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

module.exports = { listComments, addComment };
