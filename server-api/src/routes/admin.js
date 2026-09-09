/**
 * 管理 / 审核模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * 除 login 外仅管理员可访问（authRole('admin')）。
 *   POST /api/admin/login              管理员账密登录（G-05，无需鉴权）
 *   GET  /api/admin/works              审核台列表（?status=pending）
 *   POST /api/admin/work/approve       通过作品
 *   POST /api/admin/work/reject        驳回作品
 *   GET  /api/admin/stats              工作台运营指标（G-04）
 *   GET  /api/admin/users              用户管理列表（G-02）
 *   POST /api/admin/user/status        启用/禁用用户（G-02）
 *   GET  /api/admin/sensitive          敏感词库列表（G-06）
 *   GET  /api/admin/sensitive/categories  敏感词分类统计
 *   POST /api/admin/sensitive/add      新增敏感词
 *   POST /api/admin/sensitive/update   编辑敏感词
 *   POST /api/admin/sensitive/delete   删除敏感词（{ id } 或 { ids }）
 *   POST /api/admin/sensitive/reset    重置为默认词表
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin');
const sensitiveController = require('../controllers/sensitive');
const { authRole } = require('../middlewares/auth');

router.post('/login', adminController.adminLogin);
router.get('/works', authRole('admin'), adminController.listWorks);
router.post('/work/approve', authRole('admin'), adminController.approveWork);
router.post('/work/reject', authRole('admin'), adminController.rejectWork);
router.get('/stats', authRole('admin'), adminController.getStats);
router.get('/users', authRole('admin'), adminController.listUsers);
router.post('/user/status', authRole('admin'), adminController.setUserStatus);

// —— G-06 敏感词库管理 ——
router.get('/sensitive/categories', authRole('admin'), sensitiveController.categoryStats);
router.get('/sensitive', authRole('admin'), sensitiveController.listWords);
router.post('/sensitive/add', authRole('admin'), sensitiveController.addWord);
router.post('/sensitive/update', authRole('admin'), sensitiveController.updateWord);
router.post('/sensitive/delete', authRole('admin'), sensitiveController.deleteWords);
router.post('/sensitive/reset', authRole('admin'), sensitiveController.resetWords);

module.exports = router;
