/**
 * 作品评论模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * GET  /api/comment/list   作品评论树（可选鉴权：登录后附带 canDelete）
 * POST /api/comment/add    发表评论 / 回复（需鉴权 + 学号认定）
 * POST /api/comment/delete 删除评论（需鉴权：评论作者本人 或 作品作者）
 */

const express = require('express');
const router = express.Router();
const commentController = require('../controllers/comment');
const { auth, authOptional, requireBound } = require('../middlewares/auth');

router.get('/list', authOptional, commentController.listComments);
router.post('/add', auth, requireBound('评论'), commentController.addComment);
router.post('/delete', auth, commentController.deleteComment);

module.exports = router;
