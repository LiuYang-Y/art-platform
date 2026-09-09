# 沐光 · 高校美育成果展示与交流平台

基于「双端协同」的美育作品展示与互动交流平台：微信小程序（学生/教师端）+ Web 管理后台 + 统一后端 API，依托腾讯云 CloudBase（PostgreSQL + HTTP 云函数 + 静态网站托管）部署。

## 项目结构

```
art-platform/
├── client-miniapp/   # 微信小程序端（原生 WXML/WXSS/JS，6 页面）
├── admin-web/        # Web 管理后台（Vue 3 + Vite + Element Plus）
└── server-api/       # 后端服务（Node.js 18 + Express，30+ REST 接口）
    ├── src/          # 业务源码（routes / controllers / middlewares / utils）
    ├── scripts/      # schema.sql 建表 · seed.js 种子数据 · sync-fn.js 云函数组装
    └── deploy/       # CloudBase HTTP 云函数部署包（meiyu-api）
```

## 核心功能

- **沐光墙**：作品分类浏览（书法/绘画/摄影/手工/其他）、最新/最热排序、分页
- **作品详情**：多图画廊、点赞（服务端 work_id+user_id 唯一约束去重）、两级留言
- **发布审核**：发布 → 待审核 → 管理员通过/驳回（带原因）→ 前台可见（先审后发）
- **AI 润色**：创作说明一键润色（外部大模型 + 内置离线语料双引擎，8s 超时降级）
- **内容安全**：标题/简介/留言服务端敏感词检测（G-06 可配置词库，42 条默认词）
- **管理后台**：登录、数据工作台、作品审核、用户管理、课程管理、敏感词库
- **课程表**：每周美育课程（后台维护）

## 快速开始

### 1. 后端（server-api）

```bash
cd server-api
npm install
cp .env.example .env        # 填入 TENCENT_ENV_ID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY / JWT_SECRET
node scripts/init-db-pg.js  # 建表（幂等）
node scripts/seed.js        # 灌入演示数据（作品17/用户16/课程8/点赞70/留言22）
npm start                   # http://localhost:3000  健康检查 /health
```

### 2. Web 管理后台（admin-web）

```bash
cd admin-web
npm install
npm run dev                 # http://localhost:5173（/api 代理到 localhost:3000）
# 管理员账号：admin / admin123
```

### 3. 小程序（client-miniapp）

微信开发者工具导入 `client-miniapp/`（appid 见 project.config.json）；后端地址在 `utils/request.js` 的 `BASE_URL`（默认已指向线上云函数域名）。

## 云端部署（CloudBase）

| 层 | 形态 | 说明 |
|---|---|---|
| 后端 | HTTP 云函数 `meiyu-api` | `node scripts/sync-fn.js` 组装函数包 → `manageFunctions createFunction`（或控制台上传 `deploy/cloudfunctions/`），scf_bootstrap 监听 9000 |
| 网关 | 路由 `/api` → meiyu-api | enablePathTransmission=true（透传完整路径） |
| 管理端 | 静态网站托管 | `VITE_API_BASE=<云函数域名>/api npm run build`，上传 `dist/`，404 回退 index.html |
| 数据 | CloudBase PostgreSQL | 走 OpenAPI ExecutePGSql 通道，密钥放云函数环境变量 |

密钥一律走环境变量（本地 `.env` / 云函数 envVariables），`.gitignore` 已排除 `.env`、`node_modules`、部署产物。

## 接口约定

- 统一前缀 `/api`，统一返回 `{ code, message, data }`
- 健康检查 `GET /health`
- 鉴权：`Authorization: Bearer <JWT>`；角色控制 `auth / authRole('admin'|'teacher')`
- 接口分组：user / work / comment / course / ai / admin（含 sensitive 词库管理），共 30+

## 环境变量说明（server-api/.env）

见 `.env.example` 注释。关键项：`TENCENT_ENV_ID`、`TENCENT_SECRET_ID/KEY`（CloudBase OpenAPI）、`JWT_SECRET`、`LLM_API_URL/KEY`（AI 润色，可选，缺省走内置离线引擎）、`PG_*`（直连通道，可选）。
