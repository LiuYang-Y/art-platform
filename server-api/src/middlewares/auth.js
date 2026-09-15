/**
 * 全局鉴权中间件
 * ------------------------------------------------------------
 * 约定：客户端在请求头中携带 Authorization: Bearer <token>
 * 校验通过后，将 { userId, role, openid } 挂载到 req.user 供后续控制器使用
 *
 *   auth        必选鉴权（任意登录用户）
 *   authRole    角色鉴权（仅允许指定角色，如 admin）
 *   authOptional 可选鉴权（游客放行）
 */

const jwt = require('jsonwebtoken');
const { fail } = require('../utils/response');
const { queryOne } = require('../utils/config/db');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * 校验 Token，成功返回 payload，失败直接写 401 响应并返回 null
 */
function verifyToken(req, res) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader) {
    fail(res, '缺少 Authorization 请求头，请先登录', 401, 401);
    return null;
  }
  if (!/^Bearer\s+/i.test(authHeader)) {
    fail(res, 'Authorization 格式错误，应为 Bearer <token>', 401, 401);
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    fail(res, 'Token 内容为空，请重新登录', 401, 401);
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      fail(res, '登录状态已过期，请重新登录', 401, 401);
    } else {
      fail(res, 'Token 无效，请重新登录', 401, 401);
    }
    return null;
  }
}

/** 必选鉴权：任意已登录用户 */
const auth = (req, res, next) => {
  const payload = verifyToken(req, res);
  if (!payload) return;
  req.user = { userId: payload.userId, role: payload.role, openid: payload.openid };
  return next();
};

/**
 * 角色鉴权：仅允许 allowed 中的角色访问，其余返回 403
 * 用法：router.post('/x', authRole('admin'), handler)
 */
const authRole = (...allowed) => (req, res, next) => {
  const payload = verifyToken(req, res);
  if (!payload) return;
  req.user = { userId: payload.userId, role: payload.role, openid: payload.openid };

  if (!allowed.includes(payload.role)) {
    return fail(res, '权限不足，需要管理员身份', 403, 403);
  }
  return next();
};

/** 可选鉴权：携带则解析挂载，不携带也放行 */
const authOptional = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return next();
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: payload.userId,
      role: payload.role,
      openid: payload.openid
    };
  } catch (err) {
    req.user = null;
  }
  return next();
};

/**
 * 学号绑定认定门槛（G-07）
 * ------------------------------------------------------------
 * 学生账号须完成「学号绑定 + 管理员认定」（users.bind_status = 'approved'）
 * 才能执行写操作（发布作品 / 评论）；教师、管理员豁免。
 * 用法：router.post('/create', auth, requireBound('发布作品'), handler)
 *
 * @param {string} action 动作名，用于拼接提示语（如「发布作品」「评论」）
 */
const requireBound = (action) => async (req, res, next) => {
  try {
    // 教师 / 管理员无需学号认定
    if (req.user && req.user.role && req.user.role !== 'student') {
      return next();
    }
    const user = await queryOne('SELECT bind_status FROM users WHERE id = $1', [req.user.userId]);
    if (!user) return fail(res, '用户不存在，请重新登录', 401, 401);

    if ((user.bind_status || 'unbound') !== 'approved') {
      const hint =
        user.bind_status === 'pending'
          ? `学号绑定正在认定中，通过后即可${action}`
          : user.bind_status === 'rejected'
            ? `学号绑定未通过认定，请在「我的」页重新提交后再${action}`
            : `请先完成学号绑定认定（「我的」页提交），认定通过后才能${action}`;
      return fail(res, hint, 403, 403);
    }
    return next();
  } catch (err) {
    console.error('[auth] 绑定认定校验异常:', err.message);
    return fail(res, '绑定认定校验失败，请稍后重试', 500);
  }
};

module.exports = {
  auth,
  authRole,
  authOptional,
  requireBound
};
