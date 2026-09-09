/**
 * 美育课程模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * 公开：GET /api/course/list、GET /api/course/detail
 * 管理：POST /api/course/create|update|delete（需 teacher / admin 角色）
 */

const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course');
const { authRole } = require('../middlewares/auth');

router.get('/list', courseController.listCourses);
router.get('/detail', courseController.getDetail);
router.post('/create', authRole('teacher', 'admin'), courseController.createCourse);
router.post('/update', authRole('teacher', 'admin'), courseController.updateCourse);
router.post('/delete', authRole('teacher', 'admin'), courseController.deleteCourse);

module.exports = router;
