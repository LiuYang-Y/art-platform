/**
 * 用户模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * POST /api/user/login          微信静默登录（小程序）
 * POST /api/user/login-password 账密登录（网页端，学生/教师/管理员通用）
 * GET  /api/user/profile 当前用户信息（需鉴权）
 */

const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');
const { findOrCreateClassId } = require('../utils/classResolve');

const JSCODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const DEFAULT_ROLE = 'student';

/**
 * 换取微信用户身份
 */
async function code2Session(code) {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;

  if (!appid || !secret || appid === 'your_wx_appid') {
    throw new Error('服务端未配置 WECHAT_APPID / WECHAT_SECRET，无法完成微信登录');
  }

  const { data } = await axios.get(JSCODE2SESSION_URL, {
    params: { appid, secret, js_code: code, grant_type: 'authorization_code' },
    timeout: 10000
  });

  if (data.errcode) {
    throw new Error(`微信登录失败(${data.errcode}): ${data.errmsg || '未知错误'}`);
  }
  if (!data.openid) {
    throw new Error('微信未返回 openid，登录凭证可能已失效');
  }
  return { openid: data.openid, sessionKey: data.session_key, unionid: data.unionid };
}

/** 解析默认班级 ID（不存在则创建） */
async function resolveDefaultClassId() {
  const row = await queryOne('SELECT id FROM classes WHERE is_default = TRUE LIMIT 1');
  if (row) return row.id;
  return insertReturningId(
    'classes',
    ['college_name', 'major_name', 'class_name', 'is_default'],
    ['默认学院', '默认专业', '默认班级', true]
  );
}

/** 按 openid 查询用户（带班级名，供 toUserInfo 输出 className） */
function findUserByOpenid(openid) {
  return queryOne(
    `SELECT u.*, c.class_name
     FROM users u
     LEFT JOIN classes c ON c.id = u.class_id
     WHERE u.openid = $1`,
    [openid]
  );
}

/** 按 id 查询用户（带班级名） */
function findUserById(id) {
  return queryOne(
    `SELECT u.*, c.class_name
     FROM users u
     LEFT JOIN classes c ON c.id = u.class_id
     WHERE u.id = $1`,
    [Number(id)]
  );
}

/** 对外用户信息（驼峰字段） */
function toUserInfo(user) {
  return {
    userId: user.id,
    openid: user.openid,
    nickName: user.nick_name,
    realName: user.real_name || '',
    className: user.class_name || '',
    avatarUrl: user.avatar_url,
    role: user.role,
    classId: user.class_id,
    status: user.status,
    bindStatus: user.bind_status || 'unbound',
    studentId: user.student_id ? String(user.student_id) : '',
    createTime: user.created_at,
    lastLoginTime: user.last_login_at
  };
}

/**
 * 是否已配置微信小程序登录。
 * WECHAT_APPID/SECRET 未配置或仍为占位符 your_wx_appid 时，
 * 进入「演示登录」模式：跳过微信 code2Session，直登演示账号，
 * 保证体验期发布/审核双端闭环真实落库；正式配置后自动切真实微信登录。
 */
function isWechatReady() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  return Boolean(appid && secret && appid !== 'your_wx_appid');
}

/** 演示登录身份（默认 seed 中的林小满 openid，可用 DEV_LOGIN_OPENID 覆盖） */
const DEV_LOGIN_OPENID = process.env.DEV_LOGIN_OPENID || 'seed_student_openid';

/** POST /api/user/login */
async function login(req, res) {
  const { code } = req.body || {};
  const wechatReady = isWechatReady();

  let session;
  if (!wechatReady) {
    // 演示模式：无法调微信换取 openid，直接使用固定演示身份
    console.warn('[user] 未配置微信登录（WECHAT_APPID 占位），演示登录身份:', DEV_LOGIN_OPENID);
    session = { openid: DEV_LOGIN_OPENID };
  } else {
    if (!code) return fail(res, '缺少登录凭证 code', 400);
    try {
      session = await code2Session(code);
    } catch (err) {
      console.error('[user] code2Session 失败:', err.message);
      return fail(res, err.message || '微信授权失败', 400);
    }
  }

  try {
    let user = await findUserByOpenid(session.openid);
    let isNewUser = false;

    if (!user) {
      const classId = await resolveDefaultClassId();
      await insertReturningId(
        'users',
        ['openid', 'nick_name', 'role', 'class_id', 'last_login_at', 'created_at', 'updated_at'],
        [session.openid, '', DEFAULT_ROLE, classId, new Date(), new Date(), new Date()]
      );
      user = await findUserByOpenid(session.openid);
      isNewUser = true;
    } else {
      // G-02：被管理员停用的用户禁止登录
      if ((user.status || 'active') === 'disabled') {
        return fail(res, '该账号已被停用，如有疑问请联系管理员', 403, 403);
      }
      await query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [
        new Date(),
        user.id
      ]);
      user.last_login_at = new Date();
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role || DEFAULT_ROLE, openid: user.openid },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return success(
      res,
      { token, userInfo: toUserInfo(user), isNewUser, loginMode: wechatReady ? 'wechat' : 'dev' },
      wechatReady ? '登录成功' : '演示模式登录成功（未配置微信 AppID）'
    );
  } catch (err) {
    console.error('[user] 登录处理异常:', err);
    return fail(res, '登录失败，请稍后重试', 500);
  }
}

/**
 * POST /api/user/login-password
 * 网页端账密登录：学生 / 教师 / 管理员通用。
 * 与小程序微信登录共用同一 users 表与 JWT 签发逻辑，
 * 前端按返回的 role 分流（admin → 管理后台，student/teacher → 创作台）。
 */
async function loginByPassword(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, '请输入账号和密码', 400);

  try {
    const user = await queryOne('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (!user) return fail(res, '账号或密码错误', 400);

    // Web 端不再开放学生登录：学生统一走微信小程序（G-07）
    if ((user.role || 'student') === 'student') {
      return fail(res, '学生账号请使用微信小程序登录，Web 端仅面向教师与管理员', 403, 403);
    }

    // G-02：被管理员停用的用户禁止登录
    if ((user.status || 'active') !== 'active') {
      return fail(res, '该账号已被停用，如有疑问请联系管理员', 403, 403);
    }

    const ok = user.password_hash && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return fail(res, '账号或密码错误', 400);

    await query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [
      new Date(),
      user.id
    ]);
    user.last_login_at = new Date();

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role || DEFAULT_ROLE,
        openid: user.openid,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return success(
      res,
      {
        token,
        userInfo: { ...toUserInfo(user), username: user.username },
        loginMode: 'password'
      },
      '登录成功'
    );
  } catch (err) {
    console.error('[user] 账密登录异常:', err.message);
    return fail(res, '登录失败，请稍后重试', 500);
  }
}

/** GET /api/user/profile */
async function getProfile(req, res) {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) return fail(res, '用户不存在', 404);
    return success(res, toUserInfo(user), '查询成功');
  } catch (err) {
    console.error('[user] 查询用户信息异常:', err.message);
    return fail(res, '查询用户信息失败', 500);
  }
}

/**
 * PATCH /api/user/profile（需鉴权）更新昵称 / 头像
 * 平台已取消「昵称」概念：昵称即姓名，写入时双写 real_name，
 * 保证 Web 用户管理与小程序展示口径一致。
 */
async function updateProfile(req, res) {
  const { nickName, avatarUrl } = req.body || {};
  const sets = [];
  const values = [];
  let idx = 1;

  if (typeof nickName === 'string' && nickName.trim() !== '') {
    const v = nickName.trim();
    if (v.length > 30) return fail(res, '姓名最长 30 个字符', 400);
    sets.push(`nick_name = $${idx++}`);
    values.push(v);
    sets.push(`real_name = $${idx++}`);
    values.push(v);
  }
  if (typeof avatarUrl === 'string' && avatarUrl.trim() !== '') {
    sets.push(`avatar_url = $${idx++}`);
    values.push(avatarUrl.trim());
  }
  if (sets.length === 0) {
    return fail(res, '没有可更新的字段（请传入 nickName 或 avatarUrl）', 400);
  }

  sets.push(`updated_at = $${idx++}`);
  values.push(new Date());
  values.push(req.user.userId);

  try {
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`, values);
    const user = await findUserById(req.user.userId);
    return success(res, toUserInfo(user), '更新成功');
  } catch (err) {
    console.error('[user] 更新用户信息异常:', err.message);
    return fail(res, '更新失败', 500);
  }
}

/* ------------------------------------------------------------------ */
/* 学号绑定认定（G-07）：绑定前只能预览，认定通过后才能发布 / 评论        */
/* ------------------------------------------------------------------ */

/** 学号格式：6-20 位数字或字母（兼容含字母的学号） */
const STUDENT_ID_RE = /^[0-9A-Za-z]{6,20}$/;

/** GET /api/user/bind-status（需鉴权）查询当前账号认定状态 */
async function getBindStatus(req, res) {
  try {
    const user = await queryOne(
      `SELECT u.bind_status, u.student_id, u.real_name, u.class_id,
              u.bind_apply_at, u.bind_audit_at, u.bind_reject_reason,
              c.class_name
       FROM users u
       LEFT JOIN classes c ON c.id = u.class_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (!user) return fail(res, '用户不存在', 404);

    return success(
      res,
      {
        bindStatus: user.bind_status || 'unbound',
        studentId: user.student_id ? String(user.student_id) : '',
        realName: user.real_name || '',
        className: user.class_name || '',
        applyTime: user.bind_apply_at,
        auditTime: user.bind_audit_at,
        rejectReason: user.bind_reject_reason || ''
      },
      '查询成功'
    );
  } catch (err) {
    console.error('[user] 查询认定状态异常:', err.message);
    return fail(res, '查询失败', 500);
  }
}

/**
 * POST /api/user/bind-student（需鉴权）提交学号绑定申请
 * Body: { studentId, realName, className }
 * 状态机：unbound / rejected → pending（待管理员认定）；pending 可重复提交（覆盖）；
 *         approved 不可重复绑定。
 * 学号全局唯一：已被其他账号认定/申请中的学号不可再绑定。
 *
 * 姓名与班级在提交时即写入用户资料（不等审核）：
 *   - realName → real_name，并双写 nick_name（所有展示链路立即显示本人姓名）
 *   - className → 命中已有班级则复用，否则自动建档，写入 class_id
 * 这样管理员在 Web 端「账号认定」页看到的姓名/学号/班级就是学生自己填的，
 * 认定通过后也无需再手工补资料。
 */
async function bindStudent(req, res) {
  const { studentId, realName, className } = req.body || {};
  const sid = String(studentId || '').trim();
  const name = String(realName || '').trim();
  const clsName = String(className || '').trim();

  if (!STUDENT_ID_RE.test(sid)) {
    return fail(res, '学号格式不正确（6-20 位数字或字母）', 400);
  }
  if (!name) return fail(res, '请填写姓名', 400);
  if (name.length > 30) return fail(res, '姓名最长 30 个字符', 400);
  if (!clsName) return fail(res, '请填写班级', 400);

  try {
    const user = await queryOne('SELECT bind_status, student_id FROM users WHERE id = $1', [
      req.user.userId
    ]);
    if (!user) return fail(res, '用户不存在', 404);

    // 班级先落库（自动建档），失败则整单不提交
    let classId;
    try {
      const cls = await findOrCreateClassId(clsName);
      classId = cls.id;
    } catch (err) {
      return fail(res, err.message || '班级信息不合法', 400);
    }

    const cur = user.bind_status || 'unbound';
    if (cur === 'approved' && user.student_id) {
      return fail(res, `已绑定学号 ${user.student_id}，无需重复提交`, 400);
    }

    // 学号唯一性：被「其他账号」占用（待认定或已认定）则拒绝
    // 注：student_id 是 varchar，而 OpenAPI 通道会把纯数字字符串还原成 Number，
    //     入参必须是字符串，否则拼出 `varchar = bigint` 报 42883。
    const occupied = await queryOne(
      "SELECT id FROM users WHERE student_id = $1 AND bind_status IN ('pending','approved') AND id <> $2",
      [sid, req.user.userId]
    );
    if (occupied) {
      return fail(res, '该学号已被其他账号绑定或正在认定中，如有疑问请联系管理员', 400);
    }

    // 存量已认定账号（approved 但尚未登记学号）：直接登记，无需再次审核
    if (cur === 'approved') {
      await query(
        `UPDATE users
         SET student_id = $1, real_name = $2, nick_name = $2, class_id = $3,
             bind_audit_at = $4, updated_at = $4
         WHERE id = $5`,
        [sid, name, classId, new Date(), req.user.userId]
      );
      return success(
        res,
        { bindStatus: 'approved', studentId: sid, realName: name, className: clsName },
        '学号登记成功'
      );
    }

    await query(
      `UPDATE users
       SET student_id = $1, real_name = $2, nick_name = $2, class_id = $3,
           bind_status = 'pending',
           bind_apply_at = $4, bind_audit_at = NULL, bind_reject_reason = NULL, updated_at = $4
       WHERE id = $5`,
      [sid, name, classId, new Date(), req.user.userId]
    );

    return success(
      res,
      { bindStatus: 'pending', studentId: sid, realName: name, className: clsName },
      '绑定申请已提交，等待管理员认定'
    );
  } catch (err) {
    console.error('[user] 学号绑定申请异常:', err.message);
    return fail(res, `提交失败：${String(err.message || '未知错误').slice(0, 200)}`, 500);
  }
}

module.exports = { login, loginByPassword, getProfile, updateProfile, getBindStatus, bindStudent };
