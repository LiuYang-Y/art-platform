/**
 * 用户模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * POST /api/user/login  微信静默登录
 * GET  /api/user/profile 当前用户信息（需鉴权）
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');

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

/** 按 openid 查询用户 */
function findUserByOpenid(openid) {
  return queryOne('SELECT * FROM users WHERE openid = $1', [openid]);
}

/** 对外用户信息（驼峰字段） */
function toUserInfo(user) {
  return {
    userId: user.id,
    openid: user.openid,
    nickName: user.nick_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    classId: user.class_id,
    status: user.status,
    createTime: user.created_at,
    lastLoginTime: user.last_login_at
  };
}

/** POST /api/user/login */
async function login(req, res) {
  const { code } = req.body || {};
  if (!code) return fail(res, '缺少登录凭证 code', 400);

  let session;
  try {
    session = await code2Session(code);
  } catch (err) {
    console.error('[user] code2Session 失败:', err.message);
    return fail(res, err.message || '微信授权失败', 400);
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

    return success(res, { token, userInfo: toUserInfo(user), isNewUser }, '登录成功');
  } catch (err) {
    console.error('[user] 登录处理异常:', err);
    return fail(res, '登录失败，请稍后重试', 500);
  }
}

/** GET /api/user/profile */
async function getProfile(req, res) {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    if (!user) return fail(res, '用户不存在', 404);
    return success(res, toUserInfo(user), '查询成功');
  } catch (err) {
    console.error('[user] 查询用户信息异常:', err.message);
    return fail(res, '查询用户信息失败', 500);
  }
}

/** PATCH /api/user/profile（需鉴权）更新昵称 / 头像 */
async function updateProfile(req, res) {
  const { nickName, avatarUrl } = req.body || {};
  const sets = [];
  const values = [];
  let idx = 1;

  if (typeof nickName === 'string' && nickName.trim() !== '') {
    sets.push(`nick_name = $${idx++}`);
    values.push(nickName.trim());
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
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    return success(res, toUserInfo(user), '更新成功');
  } catch (err) {
    console.error('[user] 更新用户信息异常:', err.message);
    return fail(res, '更新失败', 500);
  }
}

module.exports = { login, getProfile, updateProfile };
