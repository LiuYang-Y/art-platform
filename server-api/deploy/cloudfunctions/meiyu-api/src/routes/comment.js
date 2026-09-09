/**
 * 作品评论模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * GET  /api/comment/list  作品评论树（无需鉴权）
 * POST /api/comment/add   发表评论 / 回复（需鉴权）
 */

const express = require('express');
const router = express.Router();
const commentController = require('../controllers/comment');
const { auth } = require('../middlewares/auth');

router.get('/list', commentController.listComments);
router.post('/add', auth, commentController.addComment);

module.exports = router;
