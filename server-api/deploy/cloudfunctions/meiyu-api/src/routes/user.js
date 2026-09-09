/**
 * 用户模块路由
 * ------------------------------------------------------------
 * POST  /api/user/login    微信静默登录（无需鉴权）
 * GET   /api/user/profile  查询当前登录用户（需鉴权）
 * PATCH /api/user/profile  更新昵称/头像（需鉴权）
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user');
const { auth } = require('../middlewares/auth');

// 静默登录：接收小程序上传的 code，换取 openid 并签发 JWT
router.post('/login', userController.login);

// 用户信息：演示全局鉴权中间件的挂载方式
router.get('/profile', auth, userController.getProfile);

// 更新昵称与头像
router.patch('/profile', auth, userController.updateProfile);

module.exports = router;
