/**
 * 种子数据灌入脚本（PostgreSQL / CloudBase OpenAPI 通道通用）
 * ------------------------------------------------------------
 * 与后端真实控制器共用 db 层（raw SQL）。
 *
 * 运行：
 *   node scripts/seed.js
 * （重复运行安全：先按业务表顺序清理，再插入。）
 *
 * 数据量对齐《2506班任务书》6.3 要求：
 *   作品 ≥15（覆盖 5 分类）· 班级 ≥3 · 用户 ≥15（学员/志愿者/管理员三类，
 *   管理员可账密登录）· 课程 ≥8 · 点赞流水 ≥50 · 留言 ≥20
 * 另含：1 件 pending（Web 审核演示）+ 1 件 rejected（驳回原因演示）+
 *       作者回复评论用例 + 42 条默认敏感词（G-06）。
 */

const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/utils/config/db');
const { DEFAULT_WORDS } = require('../src/utils/contentFilter');

const MINUTE = 60 * 1000;

/** 稳定图床（固定 id 保证可复现；真机/开发者工具均可访问） */
const IMG = (id, w = 800, h = 1060) =>
  `https://picsum.photos/seed/art-${id}/${w}/${h}`;

const AVATAR = (id) => `https://picsum.photos/seed/avatar-${id}/200/200`;

async function clearBiz() {
  console.log('  清理旧数据 …');
  await db.query('DELETE FROM work_comments');
  await db.query('DELETE FROM likes');
  await db.query('DELETE FROM works');
  await db.query('DELETE FROM courses');
  await db.query('DELETE FROM users');
  await db.query('DELETE FROM classes');
}

(async () => {
  console.log('='.repeat(60));
  console.log('  🍃 美育平台 · 种子数据灌入（任务书 6.3 数据量对齐版）');
  console.log(`  数据通道 : ${db.mode() === 'pg-direct' ? 'pg 直连' : 'CloudBase OpenAPI'}`);
  console.log('='.repeat(60));

  const now = new Date();

  try {
    await clearBiz();

    // ---------- 0. 敏感词库（G-06）：灌入默认词表（幂等） ----------
    {
      let inserted = 0;
      for (const w of DEFAULT_WORDS) {
        try {
          await db.query(
            `INSERT INTO sensitive_words (word, category, remark, enabled, created_at)
             VALUES ($1, $2, $3, TRUE, $4)
             ON CONFLICT (word) DO NOTHING`,
            [w.word, w.category, '内置默认词', now]
          );
          inserted++;
        } catch (e) {
          console.log(`   ⚠ 敏感词「${w.word}」写入跳过: ${e.message.slice(0, 60)}`);
        }
      }
      console.log(`  ✅ 敏感词库 ${DEFAULT_WORDS.length} 条默认词（G-06）`);
    }

    // ---------- 1. 班级（任务书：≥3 个） ----------
    const classDefs = [
      { college: '美术学院', major: '视觉传达设计', name: '视觉传达2201班', grade: '2022', count: 42, isDefault: true },
      { college: '人文艺术学院', major: '书法学', name: '书法初级班', grade: '2023', count: 36, isDefault: false },
      { college: '美术学院', major: '中国画', name: '国画班', grade: '2023', count: 30, isDefault: false },
      { college: '传媒艺术学院', major: '摄影', name: '摄影班', grade: '2022', count: 28, isDefault: false }
    ];
    const classIds = {};
    for (const c of classDefs) {
      classIds[c.name] = await db.insertReturningId(
        'classes',
        ['college_name', 'major_name', 'class_name', 'grade_year', 'student_count', 'is_default'],
        [c.college, c.major, c.name, c.grade, c.count, c.isDefault]
      );
    }
    console.log(`  ✅ 班级 ${classDefs.length} 个（视觉传达2201班/书法初级班/国画班/摄影班）`);

    // ---------- 2. 用户（任务书：≥15，含学员/志愿者/管理员三类） ----------
    // role: student=学员, teacher=志愿者(助教), admin=管理员
    const userDefs = [
      { key: 'admin', openid: 'seed_admin_openid', name: '丛老师', role: 'admin', cls: '视觉传达2201班', username: 'admin', password: 'admin123' },
      { key: 'lin', openid: 'seed_student_openid', name: '林小满', role: 'student', cls: '视觉传达2201班' },
      { key: 'chen', openid: 'seed_openid_03', name: '陈志远', role: 'teacher', cls: '视觉传达2201班' },
      { key: 'su', openid: 'seed_openid_04', name: '苏晓晴', role: 'teacher', cls: '书法初级班' },
      { key: 'zhou', openid: 'seed_openid_05', name: '周子墨', role: 'student', cls: '书法初级班' },
      { key: 'wu', openid: 'seed_openid_06', name: '吴雨桐', role: 'student', cls: '摄影班' },
      { key: 'zheng', openid: 'seed_openid_07', name: '郑皓然', role: 'student', cls: '视觉传达2201班' },
      { key: 'wang', openid: 'seed_openid_08', name: '王芷若', role: 'student', cls: '国画班' },
      { key: 'liu', openid: 'seed_openid_09', name: '刘天佑', role: 'student', cls: '摄影班' },
      { key: 'li', openid: 'seed_openid_10', name: '李思涵', role: 'student', cls: '摄影班' },
      { key: 'zhang', openid: 'seed_openid_11', name: '张明轩', role: 'student', cls: '视觉传达2201班' },
      { key: 'zhao', openid: 'seed_openid_12', name: '赵语嫣', role: 'student', cls: '国画班' },
      { key: 'sun', openid: 'seed_openid_13', name: '孙嘉懿', role: 'student', cls: '书法初级班' },
      { key: 'hu', openid: 'seed_openid_14', name: '胡欣然', role: 'student', cls: '摄影班' },
      { key: 'zhu', openid: 'seed_openid_15', name: '朱峻熙', role: 'student', cls: '视觉传达2201班' },
      { key: 'he', openid: 'seed_openid_16', name: '何静姝', role: 'student', cls: '国画班' }
    ];
    const userIds = {};
    for (const u of userDefs) {
      const cols = ['openid', 'nick_name', 'avatar_url', 'role', 'class_id', 'status', 'last_login_at', 'created_at', 'updated_at'];
      const vals = [u.openid, u.name, AVATAR(u.key), u.role, classIds[u.cls], 'active', now, now, now];
      // 账密登录凭据：管理员用自定义账号；学员/志愿者给通用演示账号
      // （学生端网页登录演示：student/123456，教师端：teacher/123456，其余学员用其 key）
      const account = u.username
        ? { username: u.username, password: u.password }
        : { username: u.key === 'lin' ? 'student' : u.key === 'chen' ? 'teacher' : u.key, password: '123456' };
      cols.push('username', 'password_hash');
      vals.push(account.username, bcrypt.hashSync(account.password, 10));
      userIds[u.key] = await db.insertReturningId('users', cols, vals);
    }
    console.log(`  ✅ 用户 ${userDefs.length} 个（学员 13 / 志愿者 2 / 管理员 1）`);
    console.log('     可登录账号：admin/admin123（管理员）· student/123456（学员 林小满）· teacher/123456（志愿者 陈志远）');

    // ---------- 3. 作品（任务书：≥15，覆盖 5 分类；作者分散） ----------
    const t = (offsetMin) => new Date(now.getTime() - offsetMin * MINUTE).toISOString();
    // author: userDefs.key；status: approved/pending/rejected
    const works = [
      // —— 书法 calligraphy ——
      { key: 'calli-1', title: '楷书《沁园春·雪》节选', category: 'calligraphy', author: 'lin', images: [IMG('calli-1', 800, 900), IMG('calli-1b', 800, 700)], description: '从笔画结构入手，临习经典碑帖，体悟传统笔法的筋骨与气韵。历时两周完成通临。', status: 'approved', like: 152, comments: 12, views: 1800, time: t(30) },
      { key: 'calli-2', title: '兰亭集序·临帖第七通', category: 'calligraphy', author: 'zhou', images: [IMG('calli-2', 800, 1100)], description: '行书临帖，细究提按转折与牵丝映带，体会王羲之书风之飘逸与平和自然。', status: 'approved', like: 96, comments: 8, views: 1200, time: t(300) },
      { key: 'calli-3', title: '篆刻·沐光朱文印', category: 'calligraphy', author: 'sun', images: [IMG('calli-3', 800, 800)], description: '刀法冲切结合，朱文布白匀停，方寸之间见金石之气。', status: 'approved', like: 74, comments: 5, views: 620, time: t(1600) },
      { key: 'calli-4', title: '隶书·曹全碑选临', category: 'calligraphy', author: 'zhang', images: [IMG('calli-4', 800, 1000)], description: '蚕头燕尾，波磔分明。临《曹全碑》三十通后的阶段小结，秀润中见骨力。', status: 'approved', like: 61, comments: 3, views: 540, time: t(2600) },
      // —— 绘画 painting ——
      { key: 'paint-1', title: '工笔·荷韵', category: 'painting', author: 'wang', images: [IMG('paint-1', 800, 1060), IMG('paint-1b', 800, 900)], description: '以工笔技法描绘夏日荷塘，三矾九染，勾线设色历时六周完成。', status: 'approved', like: 203, comments: 15, views: 2400, time: t(60) },
      { key: 'paint-2', title: '水墨·山居秋暝', category: 'painting', author: 'he', images: [IMG('paint-2', 800, 1000)], description: '写意山水，皴擦点染，取王维诗意，营造空山新雨后的清寂之境。', status: 'approved', like: 180, comments: 9, views: 1500, time: t(900) },
      { key: 'paint-3', title: '素描·静物晨光', category: 'painting', author: 'zheng', images: [IMG('paint-3', 800, 700)], description: '明暗与结构习作，以线条与调子记录清晨窗台的静谧时刻。', status: 'pending', like: 0, comments: 0, views: 0, time: t(5) },
      { key: 'paint-4', title: '色彩构成·晨昏线', category: 'painting', author: 'zhou', images: [IMG('paint-4', 800, 800)], description: '以冷暖对比重构晨昏交界的天光，尝试让色块自己讲出时间感。', status: 'approved', like: 92, comments: 4, views: 760, time: t(1800) },
      // —— 摄影 photography ——
      { key: 'photo-1', title: '云海拾光·黄山写生', category: 'photography', author: 'lin', images: [IMG('photo-1', 800, 1200), IMG('photo-1b', 800, 800), IMG('photo-1c', 800, 600)], description: '清晨五点守在光明顶，等一场云海翻涌。山与光都刚刚好，按下快门的一刻十分值得。', status: 'approved', like: 320, comments: 20, views: 3600, time: t(90) },
      { key: 'photo-2', title: '校园四季·光影拾遗', category: 'photography', author: 'liu', images: [IMG('photo-2', 800, 900)], description: '用镜头记录校园的一年四季，光穿过银杏、落进窗棂，都是温柔的记忆。', status: 'approved', like: 145, comments: 7, views: 1100, time: t(2000) },
      { key: 'photo-3', title: '图书馆的光', category: 'photography', author: 'wu', images: [IMG('photo-3', 800, 1100)], description: '傍晚六点的图书馆，夕阳斜切过书架。安静翻页的声音，是大学里最踏实的背景音。', status: 'approved', like: 118, comments: 6, views: 980, time: t(700) },
      // —— 手工 handcraft ——
      { key: 'craft-1', title: '刺绣·蝶恋花', category: 'handcraft', author: 'zhao', images: [IMG('craft-1', 800, 1000)], description: '传统苏绣非遗技艺实践，劈丝极细、针脚匀密，方寸间绣出蝶戏花间的生机。', status: 'approved', like: 88, comments: 6, views: 800, time: t(4000) },
      { key: 'craft-2', title: '陶艺·素胚茶杯', category: 'handcraft', author: 'zhu', images: [IMG('craft-2', 800, 800)], description: '手拉坯成形，素烧后上透明釉，温润如玉，杯壁薄而透光。', status: 'approved', like: 110, comments: 4, views: 950, time: t(3000) },
      { key: 'craft-3', title: '衍纸·繁花小满', category: 'handcraft', author: 'wang', images: [IMG('craft-3', 800, 1000)], description: '衍纸卷曲组合出立体的花束，献给小满节气的礼物——将满未满，恰到好处。', status: 'pending', like: 0, comments: 0, views: 0, time: t(8) },
      // —— 其他艺术 other ——
      { key: 'other-1', title: '数字插画·沐光少年', category: 'other', author: 'lin', images: [IMG('other-1', 800, 1100)], description: '板绘人物插画，柔光配色，想画一个在图书馆窗外逆光自习的安静少年。', status: 'approved', like: 260, comments: 11, views: 2100, time: t(200) },
      { key: 'other-2', title: '平面设计·二十四节气海报', category: 'other', author: 'su', images: [IMG('other-2', 800, 1200)], description: '用现代网格与东方留白重释节气之美，一套共十二张，此为「立春」。', status: 'rejected', rejectReason: '封面左下角文字与背景对比度不足，请调整后重新提交审核。', like: 0, comments: 0, views: 10, time: t(20) },
      { key: 'other-3', title: '钢笔淡彩·老街早市', category: 'other', author: 'chen', images: [IMG('other-3', 800, 1000)], description: '志愿者速写小组走进老街早市，钢笔勾线加淡彩晕染，烟火气跃然纸上。', status: 'approved', like: 77, comments: 5, views: 690, time: t(2200) }
    ];

    const workIds = {};
    for (const w of works) {
      const id = await db.insertReturningId(
        'works',
        ['author_id', 'title', 'category', 'images', 'description', 'status', 'reject_reason', 'like_count', 'comment_count', 'view_count', 'created_at', 'updated_at'],
        [
          userIds[w.author],
          w.title,
          w.category,
          w.images,
          w.description,
          w.status,
          w.rejectReason || null,
          w.like,
          w.comments,
          w.views,
          w.time,
          w.time
        ]
      );
      workIds[w.title] = id;
    }
    const approvedTitles = works.filter((w) => w.status === 'approved').map((w) => w.title);
    console.log(`  ✅ 作品 ${works.length} 件（approved ${approvedTitles.length} / pending 2 / rejected 1，覆盖 5 分类，作者 ${new Set(works.map((w) => w.author)).size} 人）`);

    // ---------- 4. 点赞流水（任务书：≥50 条，服务端去重 uk_work_user） ----------
    // like_count 为展示计数（种子虚高），此处另插真实 likes 行供统计与“是否已点赞”判断
    const likerKeys = userDefs.map((u) => u.key);
    let likeRows = 0;
    for (let j = 0; j < approvedTitles.length; j++) {
      for (let k = 0; k < 5; k++) {
        const uid = userIds[likerKeys[(j * 5 + k) % likerKeys.length]];
        const wid = workIds[approvedTitles[j]];
        const r = await db
          .query('INSERT INTO likes (work_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [wid, uid, now])
          .catch(() => null);
        if (r) likeRows++;
      }
    }
    console.log(`  ✅ 点赞流水 ${likeRows} 条（13 件 approved × 5 人轮转，唯一约束去重）`);

    // ---------- 5. 评论（任务书：≥20 条，含作者回复用例） ----------
    // [作品key, 评论人key, 内容, 回复的评论序号|null, 是否作者回复, 时间偏移分钟]
    const commentDefs = [
      ['photo-1', 'admin', '这张云海的层次感太好了，请问是在哪里蹲守的？', null, false, 80],
      ['photo-1', 'lin', '在黄山光明顶，凌晨四点就上去占机位啦，值得！', null, true, 70],
      ['photo-1', 'zhou', '回复楼上：山上是早上约 5:40 日出前云海最浓，推荐秋季去。', 1, false, 60],
      ['photo-1', 'wu', '构图和时机都绝了，学习！', null, false, 55],
      ['photo-1', 'zhang', '已收藏，下个月自己也去一趟。', null, false, 40],
      ['paint-1', 'he', '三矾九染的耐心太佩服了，荷瓣的透感简直像真的一样。', null, false, 50],
      ['paint-1', 'lin', '设色层次分明，向国画班同学学习！', null, false, 45],
      ['paint-1', 'zhao', '请问勾线用的是狼毫还是衣纹笔呀？', null, false, 30],
      ['paint-1', 'wang', '衣纹笔起的稿，最后罩染换了白云笔，会好控制一些。', 7, true, 25],
      ['calli-1', 'sun', '沁园春·雪写得气势很足，结字开张有度。', null, false, 28],
      ['calli-1', 'chen', '章法疏密有致，落款位置也讲究，好评！', null, false, 26],
      ['calli-1', 'lin', '谢谢两位老师，还会继续练！', 10, true, 20],
      ['other-1', 'hu', '逆光的感觉好温柔，配色好舒服。', null, false, 180],
      ['other-1', 'li', '少年感拉满，图书馆窗外那棵树也画得很像！', null, false, 150],
      ['other-1', 'lin', '对，就画的西门外那棵梧桐：）', 13, true, 120],
      ['calli-2', 'wang', '牵丝映带处理得真自然，第七通果然不一样了。', null, false, 260],
      ['calli-2', 'su', '行气贯通，建议下一步试试临《圣教序》。', null, false, 240],
      ['photo-2', 'li', '银杏那张绝了，秋天限定。', null, false, 1900],
      ['photo-2', 'wu', '同款机位打卡过，光确实太好了。', null, false, 1700],
      ['craft-2', 'zhu', '杯壁真的能透光，手作温度满满。', null, false, 2800],
      ['craft-2', 'zheng', '想预定一只！出同款吗？', null, false, 2700],
      ['paint-2', 'zhao', '空山新雨后的意境出来了，题字位置也妙。', null, false, 800]
    ];
    const commentIds = {};
    let commentRows = 0;
    for (let i = 0; i < commentDefs.length; i++) {
      const [wkey, ukey, content, replyIdx, isAuthor, mins] = commentDefs[i];
      const id = await db.insertReturningId(
        'work_comments',
        ['work_id', 'user_id', 'content', 'parent_id', 'is_author_reply', 'created_at'],
        [workIds[works.find((w) => w.key === wkey).title], userIds[ukey], content, replyIdx != null ? commentIds[replyIdx] : null, isAuthor, t(mins)]
      );
      commentIds[i] = id;
      commentRows++;
    }
    console.log(`  ✅ 留言 ${commentRows} 条（分布 7 件作品，含作者回复用例）`);

    // ---------- 6. 课程（任务书：≥8 条，时间地点合理） ----------
    const courses = [
      { courseName: '书法基础·楷书入门', teacherName: '林墨 老师', location: '美术楼 201', classTime: '周一 14:00-15:30', weeklyInfo: '第3-8周 每周一', description: '从笔画结构入手，临习经典碑帖，体悟书法美感。', cat: 'calligraphy' },
      { courseName: '中国画赏析与实践', teacherName: '顾清 老师', location: '美术馆 302', classTime: '周三 10:00-11:30', weeklyInfo: '第1-12周 每周三', description: '赏析宋元山水名作，体验水墨勾染技法。', cat: 'painting' },
      { courseName: '校园摄影实践', teacherName: '何朗 老师', location: '艺术楼 105', classTime: '周五 14:00-16:00', weeklyInfo: '第2-10周 每周五', description: '光影构图实战训练，用镜头记录校园光影之美。', cat: 'photography' },
      { courseName: '合唱与声乐基础', teacherName: '陈曦 老师', location: '音乐厅 402', classTime: '周二 16:20-17:50', weeklyInfo: '第1-16周 每周二', description: '声乐发声与合唱排练，感受和声之美。', cat: 'other' },
      { courseName: '篆刻与拓印体验', teacherName: '方远 老师', location: '非遗工坊 106', classTime: '周四 14:00-15:30', weeklyInfo: '第5-9周 每周四', description: '体验篆刻刀法与拓印工艺，了解传统印信之美。', cat: 'handcraft' },
      { courseName: '书法进阶·行书创作', teacherName: '林墨 老师', location: '美术楼 203', classTime: '周二 14:00-15:30', weeklyInfo: '第3-14周 每周二', description: '由临入创，从行书临帖走向条幅与斗方创作。', cat: 'calligraphy' },
      { courseName: '智能手机应用入门', teacherName: '志愿者联合开设', location: '综合楼 108', classTime: '周三 16:00-17:00', weeklyInfo: '第2-12周 每周三', description: '志愿者一对一辅导：扫码、拍照、社交与移动支付基础。', cat: 'other' },
      { courseName: '养生保健·八段锦', teacherName: '韩静 老师', location: '体育馆 302', classTime: '周五 08:00-09:00', weeklyInfo: '第1-16周 每周五', description: '传统导引养生功法，舒展筋骨、调顺气息。', cat: 'other' }
    ];
    for (const c of courses) {
      await db.insertReturningId(
        'courses',
        ['course_name', 'teacher_name', 'location', 'class_time', 'weekly_info', 'description', 'category', 'status', 'created_at'],
        [c.courseName, c.teacherName, c.location, c.classTime, c.weeklyInfo, c.description, c.cat, 'active', now]
      );
    }
    console.log(`  ✅ 课程 ${courses.length} 门（≥8 达标）`);

    // ---------- 7. 统计校验（对齐任务书 6.3） ----------
    const count = async (table, where = '') => {
      const r = await db.query(`SELECT COUNT(*)::int AS n FROM ${table} ${where}`);
      return r.rows[0].n;
    };
    const [nWorks, nUsers, nLikes, nComments, nCourses, nClasses] = await Promise.all([
      count('works'), count('users'), count('likes'), count('work_comments'), count('courses'), count('classes')
    ]);
    const ok = (cond, label, v) => console.log(`  ${cond ? '✅' : '❌'} ${label} = ${v}`);
    console.log('─'.repeat(60));
    ok(nWorks >= 15, `作品 (≥15)`, nWorks);
    ok(nClasses >= 3, `班级 (≥3)`, nClasses);
    ok(nUsers >= 15, `用户 (≥15)`, nUsers);
    ok(nCourses >= 8, `课程 (≥8)`, nCourses);
    ok(nLikes >= 50, `点赞流水 (≥50)`, nLikes);
    ok(nComments >= 20, `留言 (≥20)`, nComments);

    console.log('─'.repeat(60));
    console.log('  ✅ 种子数据注入完成！');
    console.log('  可登录账号：admin/admin123（Web 管理后台）· student/123456（Web 学生创作端发布）· 小程序演示登录同为学生林小满');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (err) {
    console.error('  ❌ 数据注入失败:', err.message);
    process.exit(1);
  }
})();
