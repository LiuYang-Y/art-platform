const api = require('../../utils/api');
const util = require('../../utils/util');

/** 单列宽度（rpx）：(750 - 2*24 - 20) / 2 ≈ 341 */
const COL_WIDTH = 341;
/** 卡片文字区估算高度（rpx） */
const TEXT_HEIGHT = 150;
/** 每页条数（Z-01：每页 20 条） */
const PAGE_SIZE = 20;

Page({
  data: {
    fontMode: 'normal',

    categories: api.CATEGORIES,
    activeCategory: 'all',
    sortMode: 'new', // new=最新 hot=最热
    searchInput: '',
    keyword: '',

    leftList: [],
    rightList: [],

    loading: false,
    hasMore: true,
    isEmpty: false
  },

  /** 完整数据存实例上，减少 setData 开销 */
  _rawList: [],
  _nextCursor: null,
  _debouncedSearch: null,
  _animTimers: {},

  onLoad() {
    // 搜索防抖：输入停顿 500ms 后自动检索
    this._debouncedSearch = util.debounce(() => this.applySearch(), 500);
    this.loadWorks(true);
  },

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
  },

  onUnload() {
    Object.keys(this._animTimers).forEach((k) => clearTimeout(this._animTimers[k]));
  },

  onPullDownRefresh() {
    this.loadWorks(true).finally(() => wx.stopPullDownRefresh());
  },

  /** 触底自动追加下一页（每页 20 条） */
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadWorks(false);
    }
  },

  /* ================= 数据加载 ================= */

  /**
   * 加载作品列表：GET /api/work/list?category&sort&limit=20&lastCreateTime
   * @param {boolean} reset 切换分类/排序/搜索或下拉刷新时重置
   */
  async loadWorks(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      const res = await api.listWorks({
        category: this.data.activeCategory,
        sort: this.data.sortMode,
        keyword: this.data.keyword,
        limit: PAGE_SIZE,
        lastCreateTime: reset ? '' : this._nextCursor || ''
      });

      const list = (res && res.list) || [];
      this._rawList = reset ? list : this._rawList.concat(list);
      this._nextCursor = (res && res.nextCursor) || null;

      this.applyColumns();
      this.setData({
        hasMore: !!(res && res.hasMore),
        isEmpty: this.displayList().length === 0
      });
    } catch (err) {
      console.warn('[index] 作品列表加载失败:', err && err.message);
      if (reset) this.setData({ isEmpty: this.displayList().length === 0 });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 关键词客户端兜底过滤（后端不支持 keyword 时也能搜） */
  displayList() {
    const kw = this.data.keyword;
    if (!kw) return this._rawList;
    return this._rawList.filter(
      (item) =>
        (item.title || '').indexOf(kw) !== -1 ||
        (item.authorName || '').indexOf(kw) !== -1
    );
  },

  /**
   * 双列瀑布流：按「封面估算高度 + 文字区高度」把作品放入较矮的一列，
   * 保证左右列视觉均衡（图片等比展示）
   */
  applyColumns() {
    const catMap = {};
    api.CATEGORIES.forEach((c) => { catMap[c.key] = c.name; });

    const list = this.displayList().map((item) =>
      Object.assign({}, item, {
        aspect: item.aspect || 1.25,
        categoryName: catMap[item.category] || '',
        likeCountText: util.formatCount(item.likeCount)
      })
    );

    const left = [];
    const right = [];
    const heights = [0, 0];
    list.forEach((item) => {
      const h = COL_WIDTH * item.aspect + TEXT_HEIGHT;
      const idx = heights[0] <= heights[1] ? 0 : 1;
      (idx === 0 ? left : right).push(item);
      heights[idx] += h;
    });

    this.setData({ leftList: left, rightList: right });
  },

  /* ================= 交互 ================= */

  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeCategory) return;
    this._nextCursor = null;
    this.setData({ activeCategory: key, hasMore: true });
    this.loadWorks(true);
  },

  /** 最新 / 最热 切换 */
  switchSort(e) {
    const sort = e.currentTarget.dataset.sort;
    if (!sort || sort === this.data.sortMode) return;
    this._nextCursor = null;
    this.setData({ sortMode: sort, hasMore: true });
    this.loadWorks(true);
  },

  onSearchInput(e) {
    this.setData({ searchInput: e.detail.value });
    this._debouncedSearch();
  },

  onSearchConfirm() {
    this.applySearch();
  },

  applySearch() {
    const kw = (this.data.searchInput || '').trim();
    if (kw === this.data.keyword) return;
    this._nextCursor = null;
    this.setData({ keyword: kw, hasMore: true });
    this.loadWorks(true);
  },

  clearSearch() {
    this.setData({ searchInput: '', keyword: '' });
    this._nextCursor = null;
    this.setData({ hasMore: true });
    this.loadWorks(true);
  },

  /** 进入作品详情 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  /* ================= 点赞（乐观更新 + +1 动效） ================= */

  async handleLike(e) {
    const workId = e.currentTarget.dataset.id;
    if (!workId) return;

    const target = this._rawList.find((item) => String(item.id) === String(workId));
    if (!target) return;

    const liked = !target.liked;

    // 乐观更新 + 动效
    this.patchWork(workId, {
      liked,
      likeCount: Math.max(0, (target.likeCount || 0) + (liked ? 1 : -1))
    });
    this.playLikeAnim(workId, liked);

    try {
      const res = await api.toggleLike(workId);
      if (res && typeof res.liked === 'boolean' && res.liked !== liked) {
        this.patchWork(workId, { liked: res.liked });
      }
    } catch (err) {
      // 回滚
      this.patchWork(workId, {
        liked: !liked,
        likeCount: target.likeCount || 0
      });
      wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    }
  },

  /** 红心弹跳 + 飘出 +1 动画 */
  playLikeAnim(workId, liked) {
    if (!liked) return;
    const key = String(workId);
    if (this._animTimers[key + '_pop']) clearTimeout(this._animTimers[key + '_pop']);
    if (this._animTimers[key + '_plus']) clearTimeout(this._animTimers[key + '_plus']);

    this.patchWork(workId, { _pop: true, _plus: true });
    this._animTimers[key + '_pop'] = setTimeout(() => this.patchWork(workId, { _pop: false }), 500);
    this._animTimers[key + '_plus'] = setTimeout(() => this.patchWork(workId, { _plus: false }), 750);
  },

  patchWork(workId, patch) {
    this._rawList = this._rawList.map((item) =>
      String(item.id) === String(workId) ? Object.assign({}, item, patch) : item
    );
    this.applyColumns();
  }
});
