const api = require('../../utils/api');

/** 最多 9 张，第一张为封面 */
const MAX_IMAGES = 9;
/** 客户端等比压缩阈值（Z-03）：长边 ≤1920px 且单张 ≤500KB */
const LONG_EDGE_LIMIT = 1920;
const SIZE_LIMIT = 500 * 1024;

Page({
  data: {
    fontMode: 'normal',

    categories: [],
    category: '',

    images: [], // [{ path, compressed }]
    title: '',
    desc: '',
    keyword: '',

    polishing: false,
    submitting: false
  },

  onLoad() {
    this.setData({ categories: api.CATEGORIES.filter((c) => c.key !== 'all') });
    this.restoreDraft();
  },

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
  },

  /* ================= 图片宫格选取 ================= */

  /** 点击「+」：从相册选择（长按该格子则拍照） */
  addImage() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 9 张', icon: 'none' });
      return;
    }
    this.choose(['album'], remain);
  },

  /** 长按「+」：拍照 */
  addImageByCamera() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) return;
    this.choose(['camera'], 1);
  },

  choose(sourceType, count) {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType,
      sizeType: ['original'], // 原图选中后由本地压缩逻辑统一处理
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath);
        this.handleNewImages(paths);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  },

  /** 逐张压缩后加入宫格 */
  async handleNewImages(paths) {
    if (!paths.length) return;
    const added = [];
    for (let i = 0; i < paths.length; i++) {
      if (this.data.images.length + added.length >= MAX_IMAGES) break;
      wx.showLoading({
        title: '压缩中 ' + (i + 1) + '/' + paths.length,
        mask: true
      });
      const result = await this.compressIfNeeded(paths[i]);
      added.push(result);
    }
    wx.hideLoading();
    this.setData({ images: this.data.images.concat(added) });
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images });
  },

  /* ================= 客户端等比压缩（Z-03） ================= */

  getImageInfo(src) {
    return new Promise((resolve, reject) =>
      wx.getImageInfo({ src, success: resolve, fail: reject })
    );
  },

  getFileInfo(filePath) {
    return new Promise((resolve) =>
      wx.getFileInfo({
        filePath,
        success: resolve,
        fail: () => resolve({ size: 0 })
      })
    );
  },

  /** 压缩：优先带目标宽度等比压缩；旧基础库不支持时退回仅质量压缩 */
  compressOne(src, quality, targetWidth) {
    return new Promise((resolve, reject) => {
      const options = { src, quality };
      if (targetWidth) options.compressedWidth = targetWidth;
      wx.compressImage(
        Object.assign({}, options, {
          success: resolve,
          fail: () => {
            if (targetWidth) {
              // 基础库 <2.26 不支持 compressedWidth，退化为仅质量压缩
              wx.compressImage({ src, quality, success: resolve, fail: reject });
            } else {
              reject(new Error('compressImage fail'));
            }
          }
        })
      );
    });
  },

  /**
   * 强制客户端压缩：长边 >1920px 或体积 >500KB 时压缩后再上传
   * @returns {Promise<{path:string, compressed:boolean}>}
   */
  async compressIfNeeded(src) {
    try {
      const info = await this.getImageInfo(src);
      const file = await this.getFileInfo(src);
      const width = info.width || 0;
      const height = info.height || 0;
      let longEdge = Math.max(width, height);
      let size = file.size || 0;

      // 无需压缩
      if (longEdge <= LONG_EDGE_LIMIT && size <= SIZE_LIMIT) {
        return { path: src, compressed: false };
      }

      let out = src;
      // 第一次：质量 80，长边超限时等比缩到 1920
      const scale = longEdge > LONG_EDGE_LIMIT ? LONG_EDGE_LIMIT / longEdge : 1;
      const targetWidth = scale < 1 ? Math.round(width * scale) : 0;
      try {
        const r = await this.compressOne(out, 80, targetWidth);
        out = r.tempFilePath;
      } catch (e) {
        return { path: src, compressed: false }; // 压缩能力不可用时用原图
      }

      // 复检；仍超标 → 质量 40 再压一次
      try {
        const ri = await this.getImageInfo(out);
        const rf = await this.getFileInfo(out);
        longEdge = Math.max(ri.width || 0, ri.height || 0);
        size = rf.size || 0;
        if (longEdge > LONG_EDGE_LIMIT || size > SIZE_LIMIT) {
          const r2 = await this.compressOne(out, 40, 0);
          out = r2.tempFilePath;
        }
      } catch (e) {
        // 复检失败不阻塞，使用第一次压缩结果
      }

      return { path: out, compressed: out !== src };
    } catch (e) {
      // 元信息读取失败（部分场景 getFileInfo 受限），直接使用原图
      return { path: src, compressed: false };
    }
  },

  /* ================= 表单 ================= */

  pickCategory(e) {
    this.setData({ category: e.currentTarget.dataset.key });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ desc: e.detail.value });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  /* ================= AI 润色（Z-04，8 秒超时降级） ================= */

  async polish() {
    if (this.data.polishing) return;
    const keyword = (this.data.keyword || this.data.title || '').trim();
    if (!keyword) {
      wx.showToast({ title: '先填写标题或关键词，AI 才知道润色什么', icon: 'none' });
      return;
    }

    this.setData({ polishing: true });
    wx.showLoading({ title: 'AI 正在润色…', mask: true });

    try {
      const res = await api.polishText({
        keyword,
        category: this.data.category || 'painting'
      });
      wx.hideLoading();
      if (res && res.text) {
        this.setData({ desc: res.text });
        wx.showToast({
          title: res.source === 'local' ? 'AI 服务暂不可用，已用本地润色' : '润色完成，可继续编辑',
          icon: 'none',
          duration: 2200
        });
      } else {
        wx.showToast({ title: '未获取到润色结果，请手写', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.warn('[publish] AI 润色失败:', err && err.message);
      wx.showToast({ title: 'AI 润色失败，请手动填写', icon: 'none' });
    } finally {
      this.setData({ polishing: false });
    }
  },

  /* ================= 草稿 ================= */

  restoreDraft() {
    const draft = wx.getStorageSync('publishDraft');
    if (!draft) return;
    this.setData({
      title: draft.title || '',
      category: draft.category || '',
      desc: draft.desc || '',
      keyword: draft.keyword || ''
    });
  },

  saveDraft() {
    wx.setStorageSync('publishDraft', {
      title: this.data.title,
      category: this.data.category,
      desc: this.data.desc,
      keyword: this.data.keyword
    });
    wx.showToast({ title: '草稿已保存', icon: 'success' });
  },

  clearDraft() {
    wx.removeStorageSync('publishDraft');
  },

  /* ================= 提交审核（Z-03） ================= */

  async submit() {
    if (this.data.submitting) return;

    const title = (this.data.title || '').trim();
    const desc = (this.data.desc || '').trim();

    if (!this.data.images.length) {
      wx.showToast({ title: '请至少上传一张作品图片', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请填写作品标题', icon: 'none' });
      return;
    }
    if (!this.data.category) {
      wx.showToast({ title: '请选择作品分类', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交…', mask: true });

    try {
      // 逐张上传（后端无上传接口时 api 层自动回退本地路径，不阻塞发布）
      const urls = [];
      for (let i = 0; i < this.data.images.length; i++) {
        const url = await api.uploadImage(this.data.images[i].path);
        urls.push(url);
      }

      await api.createWork({
        title,
        category: this.data.category,
        images: urls,
        description: desc
      });

      wx.hideLoading();
      this.clearDraft();
      this.setData({ images: [], title: '', desc: '', keyword: '', category: '' });

      wx.showModal({
        title: '提交成功',
        content: '作品已进入待审核队列，审核通过后将展示在沐光墙。',
        showCancel: false,
        confirmText: '好的',
        success: () => {
          wx.switchTab({ url: '/pages/mine/mine' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.warn('[publish] 提交失败:', err && err.message);
      wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
