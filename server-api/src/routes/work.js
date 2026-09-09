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
const pgStorage = require('../utils/pgStorage');

router.get('/list', workController.listWorks);
router.get('/categories', workController.getCategories);
router.get('/detail', workController.getWorkDetail);
router.get('/mine', auth, workController.getMyWorks);
router.post('/create', auth, workController.createWork);
router.post('/like', auth, workController.toggleLike);

/* ------------------------------------------------------------------ */
/* 图片上传（优先 CloudBase PG 云存储 pgstore；未配置 token 时回退本地） */
/* ------------------------------------------------------------------ */
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// 确保目录存在（本地回退与 /uploads 静态服务使用）
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 内存存储：云存储上传需要 Buffer；本地回退时再写盘
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB 兜底（客户端已压到 ≤500KB）
  fileFilter(req, file, cb) {
    if (/^image\//.test(file.mimetype || '')) cb(null, true);
    else cb(new Error('仅支持上传图片文件'));
  }
});

/** 解析安全扩展名 */
function safeExt(originalname, fallback) {
  const ext = (path.extname(originalname || '') || fallback || '.jpg').toLowerCase();
  return /^\.(jpe?g|png|gif|webp|bmp)$/.test(ext) ? ext : '.jpg';
}

/**
 * POST /api/work/upload （需鉴权）
 * multipart/form-data，字段名 file；返回 { url, filename }
 * - 生产（云函数）：上传到 CloudBase PG 云存储，url 为公开可访问地址
 * - 本地兜底：写 uploads 目录并由 Express /uploads 静态服务
 */
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, '请选择要上传的图片文件', 400);
    const ext = safeExt(req.file.originalname);

    if (pgStorage.enabled()) {
      const r = await pgStorage.uploadImage({
        buffer: req.file.buffer,
        mime: req.file.mimetype || 'image/jpeg',
        ext
      });
      return success(res, { url: r.url, filename: r.objectKey }, '图片上传成功');
    }

    // 本地兜底：写入 uploads 目录
    const filename = `${Date.now()}_${Math.random().toString(36).slice(-6)}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
    const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    return success(res, { url: publicUrl, filename }, '图片上传成功');
  } catch (e) {
    return fail(res, `图片上传失败：${e.message}`, 500);
  }
});

module.exports = router;
