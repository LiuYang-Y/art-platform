/**
 * 路由总入口
 * ------------------------------------------------------------
 * 统一挂载在 /api 前缀下，新增业务模块只需在此注册
 */

const express = require('express');
const router = express.Router();

const userRouter = require('./user');
const workRouter = require('./work');
const commentRouter = require('./comment');
const adminRouter = require('./admin');
const courseRouter = require('./course');
const aiRouter = require('./ai');

router.use('/user', userRouter);
router.use('/work', workRouter);
router.use('/comment', commentRouter);
router.use('/admin', adminRouter);
router.use('/course', courseRouter);
router.use('/ai', aiRouter);

module.exports = router;
