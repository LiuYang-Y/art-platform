/**
 * 本地演示数据层（Mock）
 * ------------------------------------------------------------
 * 作用：后端（server-api）未启动或接口未就绪时，为 6 个核心页面
 * 提供可端到端演示的数据兜底；数据人物、内容与最终版原型保持一致
 * （林小满 / 视觉传达 2201 班 / 本周 09.07-09.13）。
 *
 * 约定：
 *   - 真实接口优先，仅当请求失败时由 utils/api.js 降级调到这里
 *   - 点赞、评论、发布等写操作在内存中生效，重启小程序后还原
 */

const NOW = Date.now();

/** 确定性伪随机（保证每次演示数据一致） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 宽容的日期解析：ISO 直接解析；'yyyy-MM-dd HH:mm' 转 '/' 兼容 iOS */
function toDate(s) {
  if (!s) return null;
  const str = String(s);
  if (str.indexOf('T') !== -1 || str.indexOf('Z') !== -1) return new Date(str);
  return new Date(str.replace(/-/g, '/'));
}

/** 分类元信息：名称 / 封面渐变 / emoji */
const CAT_META = {
  calligraphy: { name: '书法', emoji: '✒️', gradients: [['#9A7B5F', '#6B5240'], ['#B08D6E', '#7A5F49']] },
  painting: { name: '绘画', emoji: '🖌️', gradients: [['#E8A87C', '#D96C4F'], ['#F0C987', '#E07A5F']] },
  photography: { name: '摄影', emoji: '📷', gradients: [['#8C9BA8', '#57656F'], ['#A8B4BE', '#6E7C86']] },
  handcraft: { name: '手工', emoji: '✂️', gradients: [['#D98A7E', '#B55B4E'], ['#E3A6A0', '#C06B5F']] },
  other: { name: '其他艺术', emoji: '🎭', gradients: [['#8E9AAF', '#5C6B8A'], ['#A3B0C7', '#6E7FA0']] }
};

const AUTHORS = [
  { name: '王晓明', className: '视觉传达2201班' },
  { name: '陈雨桐', className: '视觉传达2201班' },
  { name: '覃芳语', className: '美术学2102班' },
  { name: '李慕白', className: '书法学2201班' },
  { name: '周子墨', className: '环境设计2103班' },
  { name: '苏晚晴', className: '产品设计2202班' }
];

const TITLES = {
  calligraphy: [
    '楷书《沁园春·雪》节选', '兰亭集序·临帖第七通', '隶书《曹全碑》选临',
    '篆书对联·春风得意', '行书小品·山居秋暝', '小楷《心经》手卷', '魏碑练习·张猛龙碑'
  ],
  painting: [
    '工笔·荷韵', '水彩·巷口的秋天', '油画·午后的画室',
    '速写·图书馆一角', '国画·墨竹图', '版画·田野笔记', '插画·一个夏天的梦'
  ],
  photography: [
    '云海拾光·黄山写生', '晨光里的图书馆', '雨后操场·倒影',
    '毕业季·宿舍楼下的光', '微距·叶脉星球', '夜航·教学楼灯火', '老校门·黑白纪实'
  ],
  handcraft: [
    '刺绣·蝶恋花', '剪纸·生肖窗花', '篆刻·校庆纪念印',
    '陶艺·粗陶茶盏', '编织·秋日围巾', '皮具·手工卡包', '纸艺·几何灯罩'
  ],
  other: [
    '合唱·贝加尔湖畔排练手记', '话剧·《雷雨》片段巡演', '朗诵·少年中国说',
    '街舞·光影节拍', '雕塑·线的生长', '综合材料·废墟花园', '快板·校园新说'
  ]
};

const DESCS = {
  calligraphy: [
    '临帖三个月，渐渐体会到"慢"的力量。一笔一画之间急不得，也省不得，纸张铺开的那一刻，心先静了下来。',
    '选了最喜欢的碑帖通临一遍，对照原帖才发现自己的笔画还差得远。写字如做人，端正、沉得住气。',
    '第一次尝试创作而非临摹，写的正是教室窗外的秋色。落款还有些稚嫩，但每一笔都是自己的。'
  ],
  painting: [
    '以工笔技法描绘夏日荷塘，三矾九染，历时六周完成。愿这份静心创作的温度，能透过画面传递给你。',
    '午后光线斜斜地照进画室，颜料未干的那一片最迷人。写生最妙的地方，是替你记住了当天的风。',
    '起稿、铺色、深入刻画，画到一半一度想放弃，最后还是被自己"再改一笔"的执念救了回来。'
  ],
  photography: [
    '清晨五点守在光明顶，等一场云海翻涌。远山如黛，天光初染，快门按下的瞬间，山与光都刚刚好。',
    '每天路过的地方，在特定的一刻钟里会变成另一个世界。摄影教会我的，是停下来认真地看。',
    '雨天操场的积水像一面镜子，倒影里的世界安静又完整。等了四十分钟，等来这一帧。'
  ],
  handcraft: [
    '一针一线绣出蝶恋花，针脚细密处最见心思。历时一个月完成，愿传统手艺被更多人看见、喜爱。',
    '从选料到成型全部手工完成，掌心的温度会留在器物里。用它喝茶的时候，总觉得日子慢了下来。',
    '第一方自己刻的印章，刀口还有些毛糙，但钤印在纸上的那一刻，成就感无可替代。'
  ],
  other: [
    '排练了整整一个月，站上舞台的那一刻，灯光亮起，所有的坚持都有了回响。',
    '从选材到塑形，让一条"线"自然生长。创作的过程像一场与材料的对话，它教会我顺从而非征服。',
    '把身边的故事写进作品里，演给熟悉的人看。掌声响起时，突然明白了表达的意义。'
  ]
};

/** 瀑布流高度比（高/宽），错落有致 */
const ASPECTS = [1.45, 1.0, 0.72, 1.25, 0.9, 1.35, 0.8];

/** ---------- 构建作品池 ---------- */
const pool = [];
(function buildPool() {
  let seq = 0;
  Object.keys(TITLES).forEach((category) => {
    TITLES[category].forEach((title, i) => {
      seq += 1;
      const rand = mulberry32(seq * 97 + 13);
      const author = AUTHORS[Math.floor(rand() * AUTHORS.length)];
      const meta = CAT_META[category];
      const galleryCount = 1 + (seq % 4); // 1~4 张
      pool.push({
        id: String(seq),
        title,
        category,
        coverUrl: null, // 演示数据无真实图片，用渐变占位
        coverMeta: { gradient: meta.gradients[i % 2], emoji: meta.emoji },
        aspect: ASPECTS[i % ASPECTS.length],
        gallery: Array.from({ length: galleryCount }, (_, k) => ({
          gradient: meta.gradients[(i + k) % 2],
          emoji: meta.emoji,
          label: '图 ' + (k + 1)
        })),
        description: DESCS[category][seq % DESCS[category].length],
        status: 'approved',
        authorName: author.name,
        authorClass: author.className,
        authorAvatar: '',
        likeCount: 36 + Math.floor(rand() * 300),
        commentCount: 0, // 下面按评论种子回填
        viewCount: 200 + Math.floor(rand() * 2000),
        createTime: new Date(NOW - seq * 5.5 * 3600 * 1000).toISOString()
      });
    });
  });
})();

/** 当前演示用户 */
function currentUser() {
  return { id: 9, name: '林小满', className: '视觉传达2201班', avatar: '' };
}

/** ---------- 运行时状态 ---------- */
const likedSet = new Set();       // 已点赞作品 id
const followSet = new Set();      // 已关注作者
const favoriteSet = new Set();    // 已收藏作品
const commentStore = new Map();   // workId → comments[]
let userWorkSeq = 0;

/** 我的作品（对应原型 图 5-4 / 5-6） */
const myWorks = [
  {
    id: 'm1', title: '刺绣·蝶恋花', category: 'handcraft', status: 'pending',
    coverMeta: { gradient: CAT_META.handcraft.gradients[0], emoji: CAT_META.handcraft.emoji },
    aspect: 1.25, likeCount: 12, commentCount: 3,
    createTime: '2026-09-07 20:15', note: '预计 1-2 个工作日', rejectReason: ''
  },
  {
    id: 'm2', title: '楷书《沁园春·雪》节选', category: 'calligraphy', status: 'approved',
    coverMeta: { gradient: CAT_META.calligraphy.gradients[0], emoji: CAT_META.calligraphy.emoji },
    aspect: 1.5, likeCount: 86, commentCount: 9,
    createTime: '2026-09-02 10:32', note: '审核通过', rejectReason: ''
  },
  {
    id: 'm3', title: '剪纸·生肖窗花', category: 'handcraft', status: 'rejected',
    coverMeta: { gradient: CAT_META.handcraft.gradients[1], emoji: CAT_META.handcraft.emoji },
    aspect: 1.2, likeCount: 0, commentCount: 0,
    createTime: '2026-08-21 16:40', note: '图片模糊，请重拍后重新提交',
    rejectReason: '图片模糊，请重拍后重新提交'
  },
  {
    id: 'm4', title: '篆刻·校庆纪念印', category: 'other', status: 'pending',
    coverMeta: { gradient: CAT_META.other.gradients[0], emoji: CAT_META.other.emoji },
    aspect: 0.9, likeCount: 5, commentCount: 1,
    createTime: '2026-09-05 18:22', note: '预计 1-2 个工作日', rejectReason: ''
  },
  {
    id: 'm5', title: '水彩·巷口的秋天', category: 'painting', status: 'approved',
    coverMeta: { gradient: CAT_META.painting.gradients[1], emoji: CAT_META.painting.emoji },
    aspect: 1.1, likeCount: 53, commentCount: 6,
    createTime: '2026-08-28 11:05', note: '审核通过', rejectReason: ''
  }
];

/** 美育课程种子（对应原型 图 5-5） */
const COURSES = [
  { id: 'c1', courseName: '书法基础·楷书入门', category: 'calligraphy', teacherName: '林墨', location: '美术楼 201', classTime: '周一 14:00-15:30', description: '从笔画结构入手，临习经典碑帖，掌握楷书的基本法度。' },
  { id: 'c2', courseName: '合唱与声乐基础', category: 'other', teacherName: '苏晚', location: '音乐厅 101', classTime: '周二 18:30-20:00', description: '科学发声训练与合唱排练，期末登台校园艺术节。' },
  { id: 'c3', courseName: '中国画赏析与实践', category: 'painting', teacherName: '顾清', location: '美术馆 302', classTime: '周三 10:00-11:30', description: '赏析宋元山水名作，体验水墨勾染与留白之美。' },
  { id: 'c4', courseName: '戏剧表演工作坊', category: 'other', teacherName: '程砚', location: '黑匣子剧场', classTime: '周四 19:00-20:30', description: '从台词到肢体，沉浸式体验舞台人物的塑造过程。' },
  { id: 'c5', courseName: '校园摄影实践', category: 'photography', teacherName: '何朗', location: '艺术楼 105', classTime: '周五 14:00-16:00', description: '光影构图实战训练，用镜头记录校园的四季与日常。' },
  { id: 'c6', courseName: '篆刻与拓印体验', category: 'other', teacherName: '吴石', location: '美术楼 203', classTime: '周五 16:20-17:50', description: '识篆、奏刀、钤印，亲手完成一方属于自己的印章。' }
];

/** ---------- 评论种子 ---------- */
const COMMENT_POOL = [
  '构图太绝了，层次感全拍出来了！',
  '用色好舒服，求分享一下工具和参数~',
  '看得出练了很久，笔力很稳！',
  '被治愈到了，收藏了！',
  '细节处理得好用心，膜拜一下',
  '请问这学期还有对应的选修课吗？想入坑'
];
const COMMENT_NAMES = ['陈雨桐', '李慕白', '周子墨', '何朗老师', '苏晚晴'];

function ensureComments(workId) {
  if (commentStore.has(workId)) return commentStore.get(workId);
  const wid = parseInt(workId, 10);
  const work = pool.find((w) => w.id === String(workId));
  const rand = mulberry32((isNaN(wid) ? 1 : wid) * 31 + 7);
  const count = 2 + (isNaN(wid) ? 1 : wid % 3);
  const list = [];
  let commentSeq = 1;
  for (let i = 0; i < count; i++) {
    const cid = 'c_' + workId + '_' + commentSeq++;
    list.push({
      id: cid, workId: String(workId),
      userId: 100 + i, userName: COMMENT_NAMES[(wid + i) % COMMENT_NAMES.length], userAvatar: '',
      content: COMMENT_POOL[(wid * 2 + i) % COMMENT_POOL.length],
      parentId: null, isAuthorReply: false, replyToUserName: '',
      createTime: new Date(NOW - (i + 1) * 7 * 3600 * 1000).toISOString(),
      replies: []
    });
  }
  // 部分作品带一条「作者回复」高亮示例（Z-06）
  if (work && wid % 2 === 0) {
    const parentId = list[0].id;
    list[0].replies.push({
      id: 'c_' + workId + '_' + commentSeq++, workId: String(workId),
      userId: 1, userName: work.authorName, userAvatar: '',
      content: '谢谢喜欢！后面会继续更新这个系列的~',
      parentId, isAuthorReply: true, replyToUserName: list[0].userName,
      createTime: new Date(NOW - 3 * 3600 * 1000).toISOString(),
      replies: []
    });
  }
  // 回填评论数
  let total = 0;
  list.forEach((c) => { total += 1 + c.replies.length; });
  if (work) work.commentCount = total;
  commentStore.set(String(workId), list);
  return list;
}

/** ---------- 润色文案（Z-04 本地降级版，80~150 字） ---------- */
const POLISH_OPENER = {
  calligraphy: '一笔一画皆有来处',
  painting: '画笔起落之间',
  photography: '快门按下的那一瞬',
  handcraft: '一针一刀皆是功夫',
  other: '灯光亮起的那一刻'
};
const POLISH_MIDDLE = {
  calligraphy: '选帖、读帖、临写，反复对照笔画的提按与间架',
  painting: '起稿、铺色、深入刻画，层层叠加出画面的呼吸感',
  photography: '踩点、等光、构图，在最普通的角落等来最好的光线',
  handcraft: '起稿、备料、制作，每一个针脚与刀口都不肯将就',
  other: '排练、打磨、合成，每个节拍与走位都练了又练'
};

function composePolish(keyword, category) {
  const opener = POLISH_OPENER[category] || POLISH_OPENER.painting;
  const middle = POLISH_MIDDLE[category] || POLISH_MIDDLE.painting;
  const kw = keyword ? '，以「' + keyword + '」为引' : '';
  return (
    opener + kw + '，把这段时光里最动人的部分留了下来。' +
    middle + '，历时数周完成。它并不完美，却是眼下最真诚的表达——' +
    '愿你在作品前停留的片刻，也能感受到创作时的那份专注与欢喜。'
  );
}

/** ---------- 模拟网络延迟 ---------- */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 300));
}

/** ---------- 对外处理器 ---------- */

/** GET /work/list → { list, hasMore, nextCursor } */
function listWorks(params) {
  const { category, sort, keyword, limit, lastCreateTime } = params || {};
  const size = Math.min(Number(limit) || 20, 30);

  let list = pool.filter((w) => !category || category === 'all' || w.category === category);
  if (keyword) {
    const kw = String(keyword).trim();
    if (kw) {
      list = list.filter(
        (w) => w.title.indexOf(kw) !== -1 || w.authorName.indexOf(kw) !== -1
      );
    }
  }
  if (sort === 'hot') {
    list = list.slice().sort((a, b) => b.likeCount - a.likeCount);
  } else {
    list = list.slice().sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
  }
  if (lastCreateTime) {
    const cursor = toDate(lastCreateTime);
    list = list.filter((w) => toDate(w.createTime) < cursor);
  }

  const page = list.slice(0, size).map(decorate);
  const hasMore = list.length > size;
  const nextCursor = page.length ? page[page.length - 1].createTime : null;
  return delay().then(() => ({ list: page, hasMore, nextCursor }));
}

/** 附加点赞状态 */
function decorate(w) {
  return Object.assign({}, w, { liked: likedSet.has(String(w.id)) });
}

/** GET /work/detail */
function getWorkDetail(id) {
  const work = pool.find((w) => w.id === String(id));
  if (!work) {
    return delay().then(() => {
      const err = new Error('作品不存在或已下架');
      err.code = 404;
      throw err;
    });
  }
  return delay().then(() => Object.assign({}, decorate(work), { images: [] }));
}

/** POST /work/like → { liked } */
function toggleLike(params) {
  const workId = String(params && params.workId);
  const work = pool.find((w) => w.id === workId);
  let liked;
  if (likedSet.has(workId)) {
    likedSet.delete(workId);
    liked = false;
  } else {
    likedSet.add(workId);
    liked = true;
  }
  if (work) work.likeCount = Math.max(0, work.likeCount + (liked ? 1 : -1));
  return delay(200).then(() => ({ liked }));
}

/** GET /comment/list → { list } */
function listComments(params) {
  const workId = String((params && params.workId) || '');
  const list = ensureComments(workId);
  return delay().then(() => ({
    list: list.map((c) => Object.assign({}, c, { replies: c.replies.map((r) => Object.assign({}, r)) }))
  }));
}

/** POST /comment/add → comment */
function addComment(data) {
  const { workId, content, parentId } = data || {};
  const user = currentUser();
  const item = {
    id: 'u_' + Date.now(), workId: String(workId),
    userId: user.id, userName: user.name, userAvatar: user.avatar,
    content: String(content || '').trim(), parentId: parentId || null,
    isAuthorReply: false, replyToUserName: '',
    createTime: new Date().toISOString(), replies: []
  };
  const list = ensureComments(workId);
  if (parentId) {
    const parent = list.find((c) => c.id === parentId);
    if (parent) {
      item.replyToUserName = parent.userName;
      parent.replies.push(item);
    } else {
      list.push(item);
    }
  } else {
    list.push(item);
  }
  const work = pool.find((w) => w.id === String(workId));
  if (work) work.commentCount += 1;
  return delay(200).then(() => item);
}

/** POST /work/create → { workId, status } */
function createWork(data) {
  const { title, category, images, description } = data || {};
  const meta = CAT_META[category] || CAT_META.other;
  userWorkSeq += 1;
  const item = {
    id: 'u' + userWorkSeq, title: String(title || '').trim(), category,
    status: 'pending',
    coverUrl: images && images[0] ? images[0] : null,
    coverMeta: { gradient: meta.gradients[0], emoji: meta.emoji },
    aspect: 1.2, likeCount: 0, commentCount: 0,
    createTime: new Date().toISOString(),
    note: '预计 1-2 个工作日', rejectReason: ''
  };
  myWorks.unshift(item);
  return delay(400).then(() => ({ workId: item.id, status: 'pending' }));
}

/** GET /work/mine → { list } */
function getMyWorks() {
  return delay().then(() => ({
    list: myWorks.map((w) => Object.assign({ liked: false }, w))
  }));
}

/** GET /course/list → { list } */
function getCourses() {
  return delay().then(() => ({ list: COURSES.slice() }));
}

/** POST /ai/polish → { text, source } */
function polishText(data) {
  const { keyword, category } = data || {};
  return delay(1200).then(() => ({
    text: composePolish(keyword, category),
    source: 'local'
  }));
}

/** POST /user/login（演示登录） */
function login() {
  const user = currentUser();
  return delay(300).then(() => ({
    token: 'mock-token-' + user.id,
    userInfo: { nickName: user.name, className: user.className, avatarUrl: user.avatar, role: 'student' }
  }));
}

/** GET /user/profile */
function profile() {
  const user = currentUser();
  return delay().then(() => ({
    nickName: user.name, className: user.className, avatarUrl: user.avatar, role: 'student'
  }));
}

module.exports = {
  CAT_META,
  listWorks,
  getWorkDetail,
  toggleLike,
  listComments,
  addComment,
  createWork,
  getMyWorks,
  getCourses,
  polishText,
  login,
  profile,
  __test: { likedSet, followSet, favoriteSet, myWorks }
};
