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

const { get, post, patch, BASE_URL } = require('./request');
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

  /**
   * 更新昵称 / 头像（PATCH /user/profile）
   * 不降级 mock：mock 模式下本地 storage 已兜底展示，静默失败即可
   * @param {object} data { nickName?, avatarUrl? }
   */
  updateProfile: (data) => patch('/user/profile', data, { silent: true }),

  /* ---------- 学号绑定认定（G-07：绑定前只能预览，认定后才能发布/评论） ---------- */
  /**
   * 查询当前账号认定状态
   * @returns {Promise<{bindStatus:'unbound'|'pending'|'approved'|'rejected', studentId, realName, className, rejectReason}>}
   */
  getBindStatus: () =>
    withMock(
      get('/user/bind-status', {}, { silent: true }),
      () => Promise.resolve({ bindStatus: 'approved', studentId: '', realName: '', className: '', rejectReason: '' }),
      'user/bind-status'
    ),

  /**
   * 提交学号绑定申请（静默失败由调用方自行提示）
   * 姓名与班级会即时写入用户资料（昵称/班级展示位随之更新），不等审核。
   * @param {object} data { studentId, realName, className }
   */
  bindStudent: (data) => post('/user/bind-student', data, { silent: true }),

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
  /**
   * 评论树。携带登录态请求，服务端会为「可删除」的评论下发 canDelete 标记
   * （评论作者本人 / 作品作者可删），前端据此渲染「删除」按钮
   */
  listComments: (workId) =>
    withMock(
      get('/comment/list', { workId }, { silent: true }),
      () => mock.listComments({ workId }),
      'comment/list'
    ),

  addComment: (data) =>
    withMock(post('/comment/add', data, { silent: true }), () => mock.addComment(data), 'comment/add'),

  /**
   * 删除评论（评论作者本人 或 作品作者）
   * 删除一级评论会连同其下所有回复一起删除
   * @param {number|string} commentId
   */
  deleteComment: (commentId) => post('/comment/delete', { commentId }, { silent: true }),

  /**
   * 删除自己发布的作品（严格模式，无 mock 兜底）
   * 服务端校验仅作者本人可删，并级联删除该作品的全部留言与点赞
   * @param {number|string} workId
   */
  deleteWork: (workId) => post('/work/delete', { workId }, { silent: true }),

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
   * 上传单张图片到后端（pgstore 云存储 / 本地兜底）
   * 严格模式：上传失败直接 reject，绝不回退本地临时路径——
   * wxfile:// 路径只有当前设备可用，一旦入库作品图片将永久无法展示
   *
   * ⚠️ 关键：服务端 /work/upload 受 auth 中间件保护，而 wx.uploadFile
   *    与 wx.request 是两套独立通道，**不会**自动带上本地 Token。
   *    必须显式注入 Authorization 头，否则服务端直接 401，表现为
   *    「图片上传失败」——发布功能整体不可用。
   * @returns {Promise<string>} 图片公网 URL
   */
  uploadImage: async (filePath) => {
    // 与 request 层对齐：首屏发布时静默登录可能尚未落盘，先确保登录态就绪
    if (!wx.getStorageSync('token')) {
      try {
        const app = getApp();
        if (app && typeof app.ensureLogin === 'function') await app.ensureLogin();
      } catch (e) {
        // 登录失败不在这里拦，交给服务端返回 401 后给出明确提示
        console.warn('[api] 上传前登录态准备失败:', e && e.message);
      }
    }
    const token = wx.getStorageSync('token') || '';

    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: BASE_URL + '/work/upload',
        filePath,
        name: 'file',
        timeout: 20000,
        header: token ? { Authorization: 'Bearer ' + token } : {},
        success: (res) => {
          let body = null;
          try {
            body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          } catch (e) {
            body = null;
          }

          // 成功
          if (body && body.code === 200 && body.data && body.data.url) {
            resolve(body.data.url);
            return;
          }

          // 登录态失效：清缓存并重新静默登录，提示用户重试
          if (res.statusCode === 401 || (body && body.code === 401)) {
            const app = getApp();
            if (app && typeof app.relogin === 'function') app.relogin();
            reject(new Error('登录已失效，请重新进入小程序后再试'));
            return;
          }

          // 体积超限：把服务端的可操作提示原样透出
          if (res.statusCode === 413 || (body && body.code === 413)) {
            reject(new Error((body && body.message) || '图片体积过大，请换一张后重试'));
            return;
          }

          console.warn('[api] 上传响应异常:', res.statusCode, body && (body.message || body.code));
          reject(new Error((body && body.message) || '图片上传失败，请稍后重试'));
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          console.warn('[api] 上传失败:', msg);
          // 体验版/真机未配置 uploadFile 合法域名
          if (msg.indexOf('domain') !== -1) {
            reject(new Error('当前环境未配置服务器域名，请在微信公众平台添加 uploadFile 合法域名'));
            return;
          }
          if (msg.indexOf('timeout') !== -1) {
            reject(new Error('图片上传超时，请检查网络后重试'));
            return;
          }
          reject(new Error('图片上传失败，请检查网络后重试'));
        }
      });
    });
  }
};

module.exports = api;
