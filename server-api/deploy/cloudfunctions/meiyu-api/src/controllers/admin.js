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
const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');
const { findOrCreateClassId } = require('../utils/classResolve');

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
    realName: r.real_name || '',
    className: r.class_name || '',
    classId: r.class_id,
    status: r.status || 'active',
    bindStatus: r.bind_status || 'unbound',
    studentId: r.student_id ? String(r.student_id) : '',
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
                u.real_name, u.bind_status, u.student_id,
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

/* ------------------------------------------------------------------ */
/* 账号认定（G-07）：学号绑定申请的审核                                  */
/* ------------------------------------------------------------------ */

/** 认定申请对外字段 */
function toBindRow(r) {
  return {
    id: r.id,
    nickName: r.nick_name,
    avatarUrl: r.avatar_url,
    role: r.role,
    studentId: r.student_id ? String(r.student_id) : '',
    realName: r.real_name || '',
    className: r.class_name || '',
    bindStatus: r.bind_status || 'unbound',
    applyTime: r.bind_apply_at,
    auditTime: r.bind_audit_at,
    rejectReason: r.bind_reject_reason || '',
    workCount: r.work_count,
    createTime: r.created_at
  };
}

/**
 * GET /api/admin/bind-applications?status=pending|approved|rejected|all
 * 账号认定申请列表（仅展示提交过绑定或已被认定的账号）
 * 班级名来自 students 自助提交时写入的 class_id（LEFT JOIN classes）
 */
async function listBindApplications(req, res) {
  const { status } = req.query;

  try {
    const params = [status && status !== 'all' ? status : ''];
    const rows = (
      await query(
        `SELECT u.id, u.nick_name, u.avatar_url, u.role,
                u.student_id, u.real_name, u.bind_status,
                u.bind_apply_at, u.bind_audit_at, u.bind_reject_reason, u.created_at,
                c.class_name,
                (SELECT COUNT(*) FROM works w WHERE w.author_id = u.id) AS work_count
         FROM users u
         LEFT JOIN classes c ON c.id = u.class_id
         WHERE u.bind_status IS NOT NULL AND u.bind_status <> 'unbound'
           AND ($1 = '' OR u.bind_status = $1)
         ORDER BY CASE u.bind_status WHEN 'pending' THEN 0 ELSE 1 END, u.bind_apply_at DESC NULLS LAST`,
        params
      )
    ).rows;

    const list = rows.map(toBindRow);
    return success(res, { list, total: list.length }, '查询成功');
  } catch (err) {
    console.error('[admin] 认定申请列表查询异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/**
 * POST /api/admin/bind-audit  账号认定审核
 * Body: { userId, action: 'approve'|'reject', reason? }
 *  - approve：bind_status → approved，记录认定时间
 *  - reject ：bind_status → rejected，记录原因；同时释放学号（student_id 置空），
 *             便于学生修正后重新提交、也避免错误学号长期占用
 */
async function auditBindApplication(req, res) {
  const { userId, action, reason } = req.body || {};
  if (!userId) return fail(res, '缺少用户 ID', 400);
  if (!['approve', 'reject'].includes(action)) {
    return fail(res, "action 仅支持 'approve' 或 'reject'", 400);
  }

  try {
    const user = await queryOne('SELECT id, bind_status, student_id FROM users WHERE id = $1', [
      Number(userId)
    ]);
    if (!user) return fail(res, '用户不存在', 404);
    if ((user.bind_status || 'unbound') !== 'pending') {
      return fail(res, '该账号当前没有待认定的绑定申请', 400);
    }

    if (action === 'approve') {
      // 并发兜底：认定前再确认学号未被其他账号占用
      //
      // ⚠️ 必须 String() 包一层：student_id 是 varchar，但 OpenAPI 通道（db.js coerce()）
      // 会把「纯数字字符串」还原成 JS Number。若直接当参数回传，escapeValue 会拼出
      // 无引号的数字字面量 → `character varying = bigint`（SQLSTATE 42883）→ 接口 500。
      // 所有「从库里读出的文本列、再作为参数回传」的写法都要显式转字符串。
      const sidText = user.student_id == null ? '' : String(user.student_id);
      const occupied = await queryOne(
        "SELECT id FROM users WHERE student_id = $1 AND bind_status = 'approved' AND id <> $2",
        [sidText, Number(userId)]
      );
      if (occupied) {
        return fail(res, '该学号已被其他账号认定，请先驳回本申请', 400);
      }
      await query(
        `UPDATE users
         SET bind_status = 'approved', bind_audit_at = $2, bind_reject_reason = NULL, updated_at = $2
         WHERE id = $1`,
        [Number(userId), new Date()]
      );
      return success(res, { userId: Number(userId), bindStatus: 'approved' }, '认定通过');
    }

    const rejectReason = reason && reason.trim() ? reason.trim() : '学号信息核对未通过';
    await query(
      `UPDATE users
       SET bind_status = 'rejected', bind_audit_at = $2, bind_reject_reason = $3,
           student_id = NULL, updated_at = $2
       WHERE id = $1`,
      [Number(userId), new Date(), rejectReason]
    );
    return success(res, { userId: Number(userId), bindStatus: 'rejected' }, '已驳回');
  } catch (err) {
    // 日志通道（ClsTopicId）未开通，出错信息只写 console 等于丢失；
    // 本接口仅 admin 可调，故把 DB 原始错误一并回传，便于自助定位。
    console.error('[admin] 账号认定审核异常:', err.message);
    return fail(res, `操作失败：${String(err.message || '未知错误').slice(0, 200)}`, 500);
  }
}

/**
 * GET /api/admin/classes  班级列表（供用户管理下拉选择）
 * 返回 id / 学院 / 专业 / 班级 / 年级，以及拼好的 label 方便前端直接展示
 */
async function listClasses(req, res) {
  try {
    const rows = (
      await query(
        `SELECT id, college_name, major_name, class_name, grade_year, is_default
         FROM classes
         ORDER BY grade_year DESC NULLS LAST, college_name, class_name`
      )
    ).rows;

    const list = rows.map((r) => ({
      id: r.id,
      collegeName: r.college_name || '',
      majorName: r.major_name || '',
      className: r.class_name || '',
      gradeYear: r.grade_year || '',
      isDefault: !!r.is_default,
      label: [r.class_name, r.major_name, r.grade_year].filter(Boolean).join(' · ')
    }));

    return success(res, { list, total: list.length }, '查询成功');
  } catch (err) {
    console.error('[admin] 班级列表查询异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/**
 * POST /api/admin/user/update  修改用户资料（G-02 扩展）
 * Body: { userId, realName?, className?, classId? }
 *  - realName：「姓名」即平台展示名（昵称概念已取消），非空、最长 30 字；
 *              写入时同步 nick_name，作品/评论/小程序的作者名随之统一
 *  - className：班级名，自由输入。命中已有班级则复用，未命中则自动新建；
 *               空串/nulls 表示清空班级；不传 = 不修改
 *  - classId  ：兼容旧调用的按 ID 指定班级
 */
async function updateUser(req, res) {
  const { userId, realName, className, classId } = req.body || {};
  if (!userId) return fail(res, '缺少用户 ID', 400);

  try {
    const target = await queryOne('SELECT id FROM users WHERE id = $1', [Number(userId)]);
    if (!target) return fail(res, '用户不存在', 404);

    const sets = [];
    const values = [];
    let idx = 1;

    if (realName !== undefined) {
      const v = String(realName).trim();
      if (!v) return fail(res, '姓名不能为空', 400);
      if (v.length > 30) return fail(res, '姓名最长 30 个字符', 400);
      // 姓名即展示名：双写 nick_name，保证所有既有展示链路（作品、评论、小程序）立即同步
      sets.push(`real_name = $${idx++}`);
      values.push(v);
      sets.push(`nick_name = $${idx++}`);
      values.push(v);
    }

    if (className !== undefined) {
      const v = String(className || '').trim();
      if (!v) {
        sets.push(`class_id = $${idx++}`);
        values.push(null);
      } else {
        // 命中已有班级则复用，否则自动建档
        // （与小程序「账号认定」自助提交共用同一套解析逻辑，避免两处口径分叉）
        let resolved;
        try {
          resolved = await findOrCreateClassId(v);
        } catch (err) {
          return fail(res, err.message || '班级信息不合法', 400);
        }
        sets.push(`class_id = $${idx++}`);
        values.push(resolved.id);
      }
    } else if (classId !== undefined) {
      if (classId === null || classId === '') {
        sets.push(`class_id = $${idx++}`);
        values.push(null);
      } else {
        const cid = Number(classId);
        if (!Number.isInteger(cid) || cid <= 0) return fail(res, '班级 ID 不合法', 400);
        const cls = await queryOne('SELECT id FROM classes WHERE id = $1', [cid]);
        if (!cls) return fail(res, '所选班级不存在', 400);
        sets.push(`class_id = $${idx++}`);
        values.push(cid);
      }
    }

    if (sets.length === 0) return fail(res, '没有可更新的字段', 400);

    sets.push(`updated_at = $${idx++}`);
    values.push(new Date());
    values.push(Number(userId));

    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`, values);

    // 回传更新后的完整行，前端可直接刷新该行
    const row = await queryOne(
      `SELECT u.id, u.openid, u.nick_name, u.avatar_url, u.role, u.username, u.status,
              u.real_name, u.bind_status, u.student_id,
              u.class_id, c.class_name, u.created_at, u.last_login_at
       FROM users u
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE u.id = $1`,
      [Number(userId)]
    );

    return success(res, toUserRow(row), '保存成功');
  } catch (err) {
    console.error('[admin] 用户资料更新异常:', err.message);
    return fail(res, '保存失败', 500);
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
  listClasses,
  updateUser,
  setUserStatus,
  listBindApplications,
  auditBindApplication
};
