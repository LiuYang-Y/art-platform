/**
 * 管理 / 审核模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * 打通「发布默认 pending → 管理员审核 → 进瀑布流」闭环。
 * 全部接口需管理员角色（authRole('admin')）。
 *
 *   GET  /api/admin/works?status=pending  审核台列表（按状态筛选）
 *   POST /api/admin/work/approve           通过作品
 *   POST /api/admin/work/reject            驳回作品（可附原因）
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../utils/config/db');
const { success, fail } = require('../utils/response');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function toItem(r) {
  return {
    id: r.id,
    title: r.title,
    coverUrl: r.cover_url,
    category: r.category,
    description: r.description,
    status: r.status,
    rejectReason: r.reject_reason,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    createTime: r.created_at
  };
}

/** GET /api/admin/works?status=pending|approved|rejected|all */
async function listWorks(req, res) {
  const { status } = req.query;
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const params = [status && status !== 'all' ? status : '', limit];
    const sql = `
      SELECT
        w.id, w.title, w.images->>0 AS cover_url, w.category, w.description,
        w.status, w.reject_reason, w.like_count, w.comment_count, w.created_at,
        u.nick_name AS author_name, u.avatar_url AS author_avatar
      FROM works w
      JOIN users u ON u.id = w.author_id
      WHERE ($1 = '' OR w.status = $1)
      ORDER BY w.created_at DESC
      LIMIT $2
    `;
    const list = (await query(sql, params)).rows.map(toItem);
    return success(res, { list, total: list.length }, '查询成功');
  } catch (err) {
    console.error('[admin] 审核列表查询异常:', err.message);
    return fail(res, '审核列表查询失败', 500);
  }
}

/** POST /api/admin/work/approve  { workId } */
async function approveWork(req, res) {
  const { workId } = req.body || {};
  if (!workId) return fail(res, '缺少作品 ID', 400);

  try {
    const work = await queryOne('SELECT id, status FROM works WHERE id = $1', [Number(workId)]);
    if (!work) return fail(res, '作品不存在', 404);

    if (work.status === 'approved') {
      return success(res, { status: 'approved' }, '作品已处于通过状态');
    }

    await query(
      "UPDATE works SET status = 'approved', reject_reason = NULL, updated_at = $2 WHERE id = $1",
      [Number(workId), new Date()]
    );
    return success(res, { status: 'approved' }, '审核通过');
  } catch (err) {
    console.error('[admin] 审核通过异常:', err.message);
    return fail(res, '审核操作失败', 500);
  }
}

/** POST /api/admin/work/reject  { workId, reason? } */
async function rejectWork(req, res) {
  const { workId, reason } = req.body || {};
  if (!workId) return fail(res, '缺少作品 ID', 400);

  try {
    const work = await queryOne('SELECT id FROM works WHERE id = $1', [Number(workId)]);
    if (!work) return fail(res, '作品不存在', 404);

    await query(
      "UPDATE works SET status = 'rejected', reject_reason = $2, updated_at = $3 WHERE id = $1",
      [Number(workId), reason && reason.trim() ? reason.trim() : '不符合发布规范', new Date()]
    );
    return success(res, { status: 'rejected' }, '已驳回');
  } catch (err) {
    console.error('[admin] 驳回异常:', err.message);
    return fail(res, '驳回操作失败', 500);
  }
}

/** 用户对外字段（驼峰） */
function toUserRow(r) {
  return {
    id: r.id,
    openid: r.openid,
    nickName: r.nick_name,
    avatarUrl: r.avatar_url,
    role: r.role,
    username: r.username || '',
    className: r.class_name || '',
    classId: r.class_id,
    status: r.status || 'active',
    workCount: r.work_count,
    likeCount: r.like_count,
    createTime: r.created_at,
    lastLoginTime: r.last_login_at
  };
}

/**
 * POST /api/admin/login  管理员账密登录（G-05）
 * Body: { username, password }
 * 不校验角色前置（登录本身就是入口）；仅接受 role=admin 且账号 active。
 */
async function adminLogin(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, '请输入账号和密码', 400);

  try {
    const user = await queryOne('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (!user || user.role !== 'admin') return fail(res, '账号或密码错误', 400);

    if ((user.status || 'active') !== 'active') {
      return fail(res, '该账号已被停用，请联系系统管理员', 403, 403);
    }

    const ok = user.password_hash && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return fail(res, '账号或密码错误', 400);

    await query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [
      new Date(),
      user.id
    ]);

    const token = jwt.sign(
      { userId: user.id, role: user.role, openid: user.openid, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return success(
      res,
      {
        token,
        adminInfo: {
          userId: user.id,
          username: user.username,
          nickName: user.nick_name,
          avatarUrl: user.avatar_url,
          role: user.role
        }
      },
      '登录成功'
    );
  } catch (err) {
    console.error('[admin] 登录异常:', err.message);
    return fail(res, '登录失败，请稍后重试', 500);
  }
}

/** GET /api/admin/stats 工作台运营指标（G-04） */
async function getStats(req, res) {
  try {
    const [works, status, users, courses, likes, comments] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM works'),
      query(
        `SELECT status, COUNT(*)::int AS n FROM works GROUP BY status`
      ),
      query('SELECT COUNT(*)::int AS n FROM users'),
      query('SELECT COUNT(*)::int AS n FROM courses'),
      query('SELECT COUNT(*)::int AS n FROM likes'),
      query('SELECT COUNT(*)::int AS n FROM work_comments')
    ]);

    const byStatus = {};
    status.rows.forEach((r) => (byStatus[r.status] = r.n));
    const totalLikes = likes.rows[0].n;
    const totalComments = comments.rows[0].n;

    // 近期新增（近 7 天作品数，供趋势占位）
    const week = await query(
      "SELECT COUNT(*)::int AS n FROM works WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'"
    );

    return success(
      res,
      {
        workTotal: works.rows[0].n,
        workApproved: byStatus.approved || 0,
        workPending: byStatus.pending || 0,
        workRejected: byStatus.rejected || 0,
        userTotal: users.rows[0].n,
        courseTotal: courses.rows[0].n,
        likeTotal: totalLikes,
        commentTotal: totalComments,
        workWeek: week.rows[0].n
      },
      '查询成功'
    );
  } catch (err) {
    console.error('[admin] 统计查询异常:', err.message);
    return fail(res, '统计查询失败', 500);
  }
}

/** GET /api/admin/users 用户管理列表（G-02） */
async function listUsers(req, res) {
  try {
    const rows = (
      await query(
        `SELECT u.id, u.openid, u.nick_name, u.avatar_url, u.role, u.username, u.status,
                u.class_id, c.class_name, u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM works w WHERE w.author_id = u.id) AS work_count,
                (SELECT COALESCE(SUM(like_count),0) FROM works w WHERE w.author_id = u.id) AS like_count
         FROM users u
         LEFT JOIN classes c ON c.id = u.class_id
         ORDER BY u.created_at DESC`
      )
    ).rows;

    const list = rows.map(toUserRow);
    return success(res, { list, total: list.length }, '查询成功');
  } catch (err) {
    console.error('[admin] 用户列表查询异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/** POST /api/admin/user/status 启用/禁用用户（G-02） Body: { userId, status } */
async function setUserStatus(req, res) {
  const { userId, status } = req.body || {};
  if (!userId) return fail(res, '缺少用户 ID', 400);
  const next = status === 'disabled' ? 'disabled' : 'active';

  try {
    const user = await queryOne('SELECT id, role FROM users WHERE id = $1', [Number(userId)]);
    if (!user) return fail(res, '用户不存在', 404);

    // 保护：禁止停用管理员自己，避免把唯一入口锁死
    if (next === 'disabled' && user.role === 'admin' && Number(userId) === Number(req.user.userId)) {
      return fail(res, '不能停用当前登录的管理员账号', 400);
    }

    await query('UPDATE users SET status = $1, updated_at = $2 WHERE id = $3', [
      next,
      new Date(),
      Number(userId)
    ]);
    return success(res, { userId: Number(userId), status: next }, next === 'active' ? '已启用' : '已禁用');
  } catch (err) {
    console.error('[admin] 用户状态更新异常:', err.message);
    return fail(res, '操作失败', 500);
  }
}

module.exports = {
  listWorks,
  approveWork,
  rejectWork,
  adminLogin,
  getStats,
  listUsers,
  setUserStatus
};
