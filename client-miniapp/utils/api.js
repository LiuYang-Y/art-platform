/**
 * 接口聚合层
 * ------------------------------------------------------------
 * 1. 所有请求集中在此维护，页面层不直接拼 URL；
 * 2. 真实后端（server-api）优先；
 * 3. 后端不可用 / 接口未就绪时，自动降级到 utils/mock.js 演示数据，
 *    保证 6 个核心页面在微信开发者工具中可端到端演示；
 * 4. 真实接口的契约：
 *      GET  /work/list?category&limit&lastCreateTime   游标分页（每页 ≤20 条）
 *      GET  /work/detail?id                            作品详情
 *      POST /work/like       { workId }                点赞/取消（返回 { liked }）
 *      GET  /work/mine                                 我的作品（含审核状态）
 *      POST /work/create     { title, category, images, description }
 *      GET  /comment/list?workId                       评论树（含作者回复标识）
 *      POST /comment/add     { workId, content, parentId? }
 *      GET  /course/list?status=active                  美育课程
 *      POST /user/login      { code }                  静默登录
 */

const { get, post, BASE_URL } = require('./request');
const mock = require('./mock');

/** 分类清单（与原型一致：全部/书法/绘画/摄影/手工/其他艺术） */
const CATEGORIES = [
  { key: 'all', name: '全部' },
  { key: 'calligraphy', name: '书法' },
  { key: 'painting', name: '绘画' },
  { key: 'photography', name: '摄影' },
  { key: 'handcraft', name: '手工' },
  { key: 'other', name: '其他艺术' }
];

/**
 * 真实请求失败时降级到演示数据
 */
function withMock(promise, mockFn, tag) {
  return promise.catch((err) => {
    console.warn('[api] 后端不可用，使用演示数据 →', tag, (err && (err.errMsg || err.message)) || err);
    return mockFn();
  });
}

const api = {
  CATEGORIES,

  /** 分类为前端常量（与原型一致，不依赖后端下发） */
  getCategories: () => Promise.resolve(CATEGORIES),

  /* ---------- 用户 ---------- */
  login: (code) =>
    withMock(post('/user/login', { code }, { needAuth: false, silent: true }), () => mock.login(), 'user/login'),

  getProfile: () =>
    withMock(get('/user/profile', {}, { silent: true }), () => mock.profile(), 'user/profile'),

  /* ---------- 作品 ---------- */
  /**
   * 作品列表（每页 20 条，游标分页）
   * @param {object} params { category, sort:'new'|'hot', keyword, lastCreateTime }
   */
  listWorks: (params) => {
    const query = Object.assign({ category: 'all', limit: 20 }, params);
    return withMock(
      get('/work/list', query, { needAuth: false, silent: true }),
      () => mock.listWorks(query),
      'work/list'
    );
  },

  getWorkDetail: (id) =>
    withMock(
      get('/work/detail', { id }, { needAuth: false, silent: true }),
      () => mock.getWorkDetail(id),
      'work/detail'
    ),

  /** 点赞 / 取消点赞 → { liked } */
  toggleLike: (workId) =>
    withMock(post('/work/like', { workId }, { silent: true }), () => mock.toggleLike({ workId }), 'work/like'),

  /** 发布作品（服务端置为 pending 待审核） */
  createWork: (data) =>
    withMock(post('/work/create', data, { silent: true }), () => mock.createWork(data), 'work/create'),

  /** 我的作品（含审核状态与驳回原因） */
  getMyWorks: () =>
    withMock(get('/work/mine', {}, { silent: true }), () => mock.getMyWorks(), 'work/mine'),

  /* ---------- 评论 ---------- */
  listComments: (workId) =>
    withMock(
      get('/comment/list', { workId }, { needAuth: false, silent: true }),
      () => mock.listComments({ workId }),
      'comment/list'
    ),

  addComment: (data) =>
    withMock(post('/comment/add', data, { silent: true }), () => mock.addComment(data), 'comment/add'),

  /* ---------- 课程 ---------- */
  getCourses: () =>
    withMock(
      get('/course/list', { status: 'active' }, { needAuth: false, silent: true }),
      () => mock.getCourses(),
      'course/list'
    ),

  /* ---------- AI 润色（Z-04，8 秒超时降级） ---------- */
  /**
   * 输入关键词 → 80~150 字简介
   * 优先调用后端 /ai/polish；8 秒超时或失败时降级到本地润色
   * @returns {Promise<{text:string, source:'ai'|'local'}>}
   */
  polishText: (data) => {
    const real = post('/ai/polish', data, { silent: true }).then((res) => ({
      text: (res && (res.text || res.content)) || '',
      source: 'ai'
    }));
    const timeout = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('AI 润色超时(8s)')), 8000);
    });
    return Promise.race([real, timeout]).catch(() => mock.polishText(data));
  },

  /* ---------- 图片上传 ---------- */
  /**
   * 上传单张图片；后端未提供上传接口时回退本地临时路径（演示模式）
   * 永不 reject，发布主链路不因上传阻塞
   * @returns {Promise<string>} 图片 URL
   */
  uploadImage: (filePath) =>
    new Promise((resolve) => {
      wx.uploadFile({
        url: BASE_URL + '/work/upload',
        filePath,
        name: 'file',
        timeout: 10000,
        success: (res) => {
          try {
            const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            if (body && body.code === 200 && body.data && body.data.url) {
              resolve(body.data.url);
              return;
            }
          } catch (e) {
            // 非 JSON 响应，走降级
          }
          console.warn('[api] 上传响应异常，回退本地路径（演示模式）');
          resolve(filePath);
        },
        fail: (err) => {
          console.warn('[api] 上传不可用，回退本地路径（演示模式）:', err && err.errMsg);
          resolve(filePath);
        }
      });
    })
};

module.exports = api;
