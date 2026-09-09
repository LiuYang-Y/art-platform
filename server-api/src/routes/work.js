/**
 * 作品模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * GET  /api/work/list         瀑布流列表（无需鉴权，支持分类/搜索/排序/游标）
 * GET  /api/work/detail       作品详情（无需鉴权）
 * GET  /api/work/categories   分类清单（无需鉴权）
 * GET  /api/work/mine         我的作品（需鉴权）
 * POST /api/work/create       发布作品（需鉴权）
 * POST /api/work/like         点赞/取消点赞（需鉴权）
 * POST /api/work/upload       单图上传（需鉴权，返回可访问 URL）
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const workController = require('../controllers/work');
const { auth } = require('../middlewares/auth');
const { success, fail } = require('../utils/response');

router.get('/list', workController.listWorks);
router.get('/categories', workController.getCategories);
router.get('/detail', workController.getWorkDetail);
router.get('/mine', auth, workController.getMyWorks);
router.post('/create', auth, workController.createWork);
router.post('/like', auth, workController.toggleLike);

/* ------------------------------------------------------------------ */
/* 图片上传（multer 磁盘存储到 server-api/uploads，静态托管于 /uploads） */
/* ------------------------------------------------------------------ */
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// 确保目录存在（首次访问自动创建）
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 磁盘存储：随机文件名避免覆盖 & 防止路径穿越
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    // 仅允许图片扩展名兜底
    const safeExt = /^\.(jpe?g|png|gif|webp|bmp)$/.test(ext) ? ext : '.jpg';
    const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(-6)}${safeExt}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB 兜底（客户端已压到 ≤500KB）
  fileFilter(req, file, cb) {
    if (/^image\//.test(file.mimetype || '')) cb(null, true);
    else cb(new Error('仅支持上传图片文件'));
  }
});

/**
 * POST /api/work/upload （需鉴权）
 * multipart/form-data，字段名 file；返回 { url }
 */
router.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, '请选择要上传的图片文件', 400);

  // 拼接本地可访问 URL（BASE 需与客户端 BASE_URL 的 host:port 一致）
  const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  return success(res, { url: publicUrl, filename: req.file.filename }, '图片上传成功');
});

module.exports = router;
