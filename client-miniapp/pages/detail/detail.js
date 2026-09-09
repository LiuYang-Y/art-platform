const api = require('../../utils/api');
const util = require('../../utils/util');

/** 快捷短语（Z-06 留言栏） */
const QUICK_PHRASES = ['构图太绝了！', '学到了，求教程', '为你的坚持点赞', '想看更多作品'];

/** 点赞防抖间隔（ms） */
const LIKE_DEBOUNCE = 500;

Page({
  data: {
    fontMode: 'normal',

    loading: true,
    loadError: false,

    work: null,
    swiperItems: [], // [{url}] 真实图片 或 [{gradient, emoji, label}] 渐变占位
    current: 0,
    imgTotal: 0,

    statusText: '',
    statusClass: '',
    categoryName: '',
    createTimeText: '',

    followed: false,
    favorited: false,
    favoriteCount: 0,
    likeAnim: false,
    showPlus: false,

    comments: [],
    commentTotal: 0,

    inputValue: '',
    replyTo: null, // { id, name }
    quickPhrases: QUICK_PHRASES
  },

  _id: '',
  _likeLastAt: 0,
  _likeTimer: null,
  _plusTimer: null,
  _sending: false,

  onLoad(options) {
    this._id = options.id || '';
    this.loadDetail();
  },

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
  },

  onUnload() {
    if (this._likeTimer) clearTimeout(this._likeTimer);
    if (this._plusTimer) clearTimeout(this._plusTimer);
  },

  /** 分享给好友 */
  onShareAppMessage() {
    const work = this.data.work || {};
    return {
      title: work.title ? '「' + work.title + '」沐光·美育平台' : '沐光·美育平台',
      path: '/pages/detail/detail?id=' + this._id
    };
  },

  /* ================= 数据加载 ================= */

  async loadDetail() {
    this.setData({ loading: true, loadError: false });
    try {
      const work = await api.getWorkDetail(this._id);
      if (!work) throw new Error('作品不存在');

      const STATUS_MAP = {
        approved: { text: '已通过', cls: 'tag-approved' },
        pending: { text: '待审核', cls: 'tag-pending' },
        rejected: { text: '未通过', cls: 'tag-rejected' }
      };
      const status = STATUS_MAP[work.status] || { text: '', cls: '' };

      // 轮播项：真实图片优先，否则用渐变占位（演示数据）
      let swiperItems = [];
      if (Array.isArray(work.images) && work.images.length) {
        swiperItems = work.images.map((url, idx) => ({ url, idx }));
      } else if (Array.isArray(work.gallery) && work.gallery.length) {
        swiperItems = work.gallery.map((g, idx) => ({
          idx,
          gradient: g.gradient || ['#CDBFA8', '#A08D74'],
          emoji: g.emoji || '🎨',
          label: g.label || '图 ' + (idx + 1)
        }));
      } else {
        swiperItems = [{
          idx: 0,
          gradient: (work.coverMeta && work.coverMeta.gradient) || ['#CDBFA8', '#A08D74'],
          emoji: (work.coverMeta && work.coverMeta.emoji) || '🎨',
          label: '图 1'
        }];
      }

      const cat = api.CATEGORIES.find((c) => c.key === work.category);

      this.setData({
        work,
        statusText: status.text,
        statusClass: status.cls,
        categoryName: cat ? cat.name : '',
        createTimeText: util.fmtDateTime(work.createTime),
        swiperItems,
        imgTotal: swiperItems.length,
        favorited: this.readFavs().indexOf(String(work.id)) !== -1,
        favoriteCount: work.favoriteCount || Math.max(0, Math.round((work.likeCount || 0) / 4))
      });

      await this.loadComments();
    } catch (err) {
      console.warn('[detail] 详情加载失败:', err && err.message);
      this.setData({ loadError: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadComments() {
    try {
      const res = await api.listComments(this._id);
      const list = (res && res.list) || [];
      let total = 0;
      const comments = list.map((c) => {
        const replies = (c.replies || []).map((r) =>
          Object.assign({}, r, { timeText: util.fmtDateTime(r.createTime) })
        );
        total += 1 + replies.length;
        return Object.assign({}, c, { replies, timeText: util.fmtDateTime(c.createTime) });
      });
      this.setData({ comments, commentTotal: total });
    } catch (err) {
      console.warn('[detail] 评论加载失败:', err && err.message);
    }
  },

  /* ================= 画廊 ================= */

  onSwiperChange(e) {
    this.setData({ current: e.detail.current });
  },

  /** 点击大图 → 全屏预览（真实图片才可预览，演示渐变给出提示） */
  previewImage() {
    const urls = this.data.swiperItems.filter((s) => s.url).map((s) => s.url);
    if (!urls.length) {
      wx.showToast({ title: '演示数据暂无高清原图', icon: 'none' });
      return;
    }
    wx.previewImage({
      current: urls[this.data.current] || urls[0],
      urls
    });
  },

  /* ================= 关注 / 收藏 ================= */

  toggleFollow() {
    const followed = !this.data.followed;
    this.setData({ followed });
    const work = this.data.work || {};
    const map = wx.getStorageSync('followMap') || {};
    if (followed) map[work.authorName] = 1;
    else delete map[work.authorName];
    wx.setStorageSync('followMap', map);
    wx.showToast({ title: followed ? '已关注' : '已取消关注', icon: 'none' });
  },

  readFavs() {
    return wx.getStorageSync('favWorkIds') || [];
  },

  toggleFavorite() {
    const id = String((this.data.work && this.data.work.id) || this._id);
    const favs = this.readFavs();
    const idx = favs.indexOf(id);
    const favorited = idx === -1;
    if (favorited) favs.push(id);
    else favs.splice(idx, 1);
    wx.setStorageSync('favWorkIds', favs);
    this.setData({
      favorited,
      favoriteCount: Math.max(0, this.data.favoriteCount + (favorited ? 1 : -1))
    });
    wx.showToast({ title: favorited ? '收藏成功' : '已取消收藏', icon: 'none' });
  },

  /* ================= 点赞（500ms 防抖 + +1 动效） ================= */

  async handleLike() {
    const now = Date.now();
    if (now - this._likeLastAt < LIKE_DEBOUNCE) return; // 防抖
    this._likeLastAt = now;

    const work = this.data.work;
    if (!work) return;
    const liked = !work.liked;

    // 乐观更新
    this.setData({
      work: Object.assign({}, work, {
        liked,
        likeCount: Math.max(0, (work.likeCount || 0) + (liked ? 1 : -1))
      })
    });

    if (liked) {
      if (this._likeTimer) clearTimeout(this._likeTimer);
      if (this._plusTimer) clearTimeout(this._plusTimer);
      this.setData({ likeAnim: true, showPlus: true });
      this._likeTimer = setTimeout(() => this.setData({ likeAnim: false }), 500);
      this._plusTimer = setTimeout(() => this.setData({ showPlus: false }), 750);
    }

    try {
      const res = await api.toggleLike(work.id);
      if (res && typeof res.liked === 'boolean' && res.liked !== liked) {
        this.setData({
          work: Object.assign({}, this.data.work, { liked: res.liked })
        });
      }
    } catch (err) {
      this.setData({
        work: Object.assign({}, this.data.work, { liked: !liked, likeCount: work.likeCount || 0 })
      });
      wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    }
  },

  /* ================= 留言 ================= */

  onCommentInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  pickQuick(e) {
    this.setData({ inputValue: e.currentTarget.dataset.text });
  },

  setReplyTo(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ replyTo: { id, name }, inputValue: '' });
  },

  cancelReply() {
    this.setData({ replyTo: null });
  },

  async sendComment() {
    const content = (this.data.inputValue || '').trim();
    if (!content) {
      wx.showToast({ title: '说点什么吧', icon: 'none' });
      return;
    }
    if (this._sending) return;
    this._sending = true;

    try {
      await api.addComment({
        workId: this._id,
        content,
        parentId: this.data.replyTo ? this.data.replyTo.id : null
      });
      this.setData({ inputValue: '', replyTo: null });
      await this.loadComments();
      wx.showToast({ title: '留言成功', icon: 'none' });
    } catch (err) {
      console.warn('[detail] 留言失败:', err && err.message);
      wx.showToast({ title: '留言失败，请重试', icon: 'none' });
    } finally {
      this._sending = false;
    }
  }
});
