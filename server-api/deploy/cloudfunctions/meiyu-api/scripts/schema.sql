-- ============================================================
-- 高校美育成果展示与交流平台 · PostgreSQL 表结构
-- ------------------------------------------------------------
-- 说明：
--   1) 全部使用 IF NOT EXISTS，可重复执行
--   2) 评论表命名为 work_comments：public 下已存在 comments（「要事提醒」留言板），
--      结构为 username/author_key/reply_to，与本平台作品评论无关，避免覆盖
--   3) 执行：node scripts/init-db-pg.js
-- ============================================================

-- 1. 院系/班级表
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    college_name VARCHAR(100) NOT NULL,
    major_name VARCHAR(100) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    grade_year VARCHAR(20),
    student_count INT DEFAULT 0,
    is_default BOOLEAN DEFAULT FALSE -- 新用户默认归属班级
);

-- 兼容已建表：补列（CREATE TABLE IF NOT EXISTS 不会新增列）
ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

-- 2. 用户表（openid 唯一索引，防止同一微信用户重复创建）
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    openid VARCHAR(128) UNIQUE NOT NULL,
    nick_name VARCHAR(100),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'student', -- student / teacher / admin
    class_id INT REFERENCES classes(id) ON DELETE SET NULL,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 兼容已建表：补列（CREATE TABLE IF NOT EXISTS 不会新增列）
-- 管理端账密登录（G-05）依赖 username + password_hash；status 用于启用/禁用（G-02）
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_username ON users (username) WHERE username IS NOT NULL;

-- 兼容已建表：补 Web 管理端账密登录 / 账号状态（G-05 账密、G-02 启用/禁用）
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(64) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'; -- active / disabled

-- 3. 美育作品表
CREATE TABLE IF NOT EXISTS works (
    id SERIAL PRIMARY KEY,
    author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 书法/国画/油画/摄影/手工/其他
    images JSONB NOT NULL DEFAULT '[]'::jsonb, -- 图片 URL 数组，images->>0 作为封面
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending / approved / rejected
    reject_reason TEXT,
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    view_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 作品表复合索引：分类 + 审核状态 + 时间倒序，支撑瀑布流流式筛选
CREATE INDEX IF NOT EXISTS idx_works_category_status_created
    ON works (category, status, created_at DESC);

-- 4. 点赞表（work_id + user_id 复合唯一索引，物理阻断并发重复点赞）
CREATE TABLE IF NOT EXISTS likes (
    id SERIAL PRIMARY KEY,
    work_id INT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_work_user UNIQUE (work_id, user_id)
);

-- 5. 作品评论表（支持二级回复）
CREATE TABLE IF NOT EXISTS work_comments (
    id SERIAL PRIMARY KEY,
    work_id INT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_id INT REFERENCES work_comments(id) ON DELETE CASCADE,
    is_author_reply BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 评论按作品 + 时间查询
CREATE INDEX IF NOT EXISTS idx_work_comments_work_created
    ON work_comments (work_id, created_at DESC);

-- 6. 美育课程表
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    course_name VARCHAR(100) NOT NULL,
    teacher_name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    class_time VARCHAR(100),
    weekly_info VARCHAR(50),
    description TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 兼容已建表：补「课程分类」列（calligraphy/painting/…，供前端按分类着色）
ALTER TABLE courses ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'other';

-- ============================================================
-- 7. 全站敏感词库表（对齐 4.2(3) 内容安全 + G-06 敏感词库管理）
-- ------------------------------------------------------------
-- 服务端 contentFilter 运行时从本表加载黑名单（带内存缓存，改动即刷新）；
-- 管理端可在 G-06 界面增删，实现词库的可维护闭环。
CREATE TABLE IF NOT EXISTS sensitive_words (
    id SERIAL PRIMARY KEY,
    word VARCHAR(50) NOT NULL,          -- 敏感词（唯一，命中即拦截）
    category VARCHAR(20) DEFAULT 'other', -- 分类：violation/politics/advert/abuse/other
    remark VARCHAR(200),
    enabled BOOLEAN DEFAULT TRUE,       -- false 时跳过该词
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sensitive_word UNIQUE (word)
);
