/**
 * 作品模块路由（PostgreSQL 版）
 * ------------------------------------------------------------
 * GET  /api/work/list         瀑布流列表（无需鉴权，支持分类/搜索/排序/游标）
 * GET  /api/work/detail       作品详情（无需鉴权）
 * GET  /api/work/categories   分类清单（无需鉴权）
 * GET  /api/work/mine         我的作品（需鉴权）
 * POST /api/work/create       发布作品（需鉴权）
 * POST /api/work/like         点赞/取消点赞（需鉴权）
 * POST /api/work/delete       删除自己的作品（需鉴权，级联清留言与点赞）
 * POST /api/work/upload       单图上传（需鉴权，返回可访问 URL）
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const workController = require('../controllers/work');
const { auth, requireBound } = require('../middlewares/auth');
const { success, fail } = require('../utils/response');
const pgStorage = require('../utils/pgStorage');

router.get('/list', workController.listWorks);
router.get('/categories', workController.getCategories);
router.get('/detail', workController.getWorkDetail);
router.get('/mine', auth, workController.getMyWorks);
router.post('/create', auth, requireBound('发布作品'), workController.createWork);
router.post('/like', auth, workController.toggleLike);
router.post('/delete', auth, workController.deleteWork);

/* ------------------------------------------------------------------ */
/* 图片上传（优先 CloudBase PG 云存储 pgstore；未配置 token 时回退本地） */
/* ------------------------------------------------------------------ */
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// 确保目录存在（本地回退与 /uploads 静态服务使用）
// ⚠️ 云函数容器（SCF）除 /tmp 外为只读文件系统：此处必须容错，
//    否则模块加载即抛 ENOENT，整个 app 启动失败（函数返回 443）。
const LOCAL_UPLOAD_READY = (() => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return true;
  } catch (e) {
    console.warn('[work] 本地 uploads 不可写（只读文件系统），仅使用云存储:', e.code || e.message);
    return false;
  }
})();

// 内存存储：云存储上传需要 Buffer；本地回退时再写盘
const storage = multer.memoryStorage();

/**
 * 单张图片体积上限（兜底）
 * ------------------------------------------------------------
 * 客户端已压到 ≤500KB，这里是「压缩失效」时的最后一道防线。
 * 不能设得太小：手机原图常见 3~8MB，若客户端压缩能力不可用（旧基础库、
 * HEIC 等），阈值过紧会让用户完全无法发布（表现为「图片上传失败」）。
 * 也不能设得太大：SCF 同步调用请求体硬上限 6MB（base64 传输还会膨胀），
 * 超过会被网关直接拒绝且拿不到业务错误码。
 * 取 4MB：既覆盖绝大多数未压缩原图，又留足网关余量。
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    // 兼容部分机型对大写扩展名 / 非标准 mime 的上报（如 image/jpg、空 mime）
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(name)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持上传图片文件'));
    }
  }
});

/**
 * 包装 multer：把「文件过大」等中间件错误转成统一 JSON 响应
 * ------------------------------------------------------------
 * 直接 upload.single('file') 时，MulterError 会冒泡到全局错误中间件，
 * 返回 500 + "File too large"——小程序侧只能笼统提示「上传失败」。
 * 这里显式转成 413 + 中文提示，客户端据此给出可操作的引导。
 */
const uploadSingleImage = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return fail(
        res,
        `图片体积过大（超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB），请换一张或先压缩后重试`,
        413,
        413
      );
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return fail(res, '上传字段名应为 file', 400, 400);
    }
    return fail(res, err.message || '图片上传失败', 400, 400);
  });
};

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
router.post('/upload', auth, uploadSingleImage, async (req, res) => {
  try {
    if (!req.file) return fail(res, '请选择要上传的图片文件', 400, 400);
    const ext = safeExt(req.file.originalname);

    if (pgStorage.enabled()) {
      const r = await pgStorage.uploadImage({
        buffer: req.file.buffer,
        mime: req.file.mimetype || 'image/jpeg',
        ext
      });
      return success(res, { url: r.url, filename: r.objectKey }, '图片上传成功');
    }

    // 本地兜底：写入 uploads 目录（只读文件系统下不可用，直接明确报错）
    if (!LOCAL_UPLOAD_READY) {
      return fail(res, '图片上传失败：服务端未配置云存储，且本地目录不可写', 500);
    }
    const filename = `${Date.now()}_${Math.random().toString(36).slice(-6)}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
    const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    return success(res, { url: publicUrl, filename }, '图片上传成功');
  } catch (e) {
    return fail(res, `图片上传失败：${e.message}`, 500);
  }
});

module.exports = router;
