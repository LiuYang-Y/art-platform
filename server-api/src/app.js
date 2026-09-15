const dotenv = require('dotenv');

// 必须最先加载环境变量，后续模块（数据库、鉴权）依赖其中的配置
dotenv.config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { success, fail } = require('./utils/response');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 策略：
// - CloudBase HTTP 网关(tcbgw)自身会反射 Origin 写 access-control-allow-origin，
//   Express 若再设置会叠加成 "origin,origin"/"origin,*" 非法双值 → 浏览器拦截。
//   因此云函数环境（DISABLE_CORS=1，由云函数环境变量注入）由网关负责 CORS。
// - 本地开发直连时由 Express cors 白名单负责。
const CORS_ORIGINS = [
  'https://aaa-d8gj21kc1d09d6414-1480206910.tcloudbaseapp.com',
  'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];
if (process.env.DISABLE_CORS === '1') {
  // 云函数：网关已反射 CORS 头，Express 不再干预；
  // 预检 OPTIONS 统一短路返回 204（Express 5 不用 '*' 路由通配符）
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
} else {
  app.use(cors({
    origin(origin, cb) {
      if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态托管用户上传的作品图片：server-api/uploads
// ⚠️ 云函数容器（SCF）除 /tmp 外为只读文件系统，mkdir 必须容错，
//    否则应用启动即抛 ENOENT/EROFS，整个函数返回 443 不可用。
const UPLOAD_DIR = path.join(__dirname, '../uploads');
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.warn('[app] 本地 uploads 目录不可写（只读文件系统），图片将统一走云存储:', e.code || e.message);
}
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// 健康探活路由
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: Date.now()
  });
});

app.get('/', (req, res) => {
  success(res, { app: 'server-api', env: process.env.NODE_ENV || 'development' }, '美育平台服务正常运转中');
});

// 业务路由统一挂载至 /api
app.use('/api', routes);

app.use((req, res) => {
  fail(res, '访问的接口不存在', 404);
});

app.use((err, req, res, next) => {
  console.error('[Server Error]:', err);
  fail(res, err.message || '服务器内部异常', 500);
});

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 服务启动成功: http://localhost:${PORT}`);
  console.log(`🩺 健康探活路由: http://localhost:${PORT}/health`);
  console.log(`=================================`);
});

module.exports = app;