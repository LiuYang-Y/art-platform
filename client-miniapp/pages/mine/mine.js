const api = require('../../utils/api');
const util = require('../../utils/util');

/** 审核状态 → 文案 / 标签色（绿：已通过 黄：待审核 红：未通过） */
const STATUS_MAP = {
  approved: { text: '已通过', cls: 'tag-approved' },
  pending: { text: '待审核', cls: 'tag-pending' },
  rejected: { text: '未通过', cls: 'tag-rejected' }
};

Page({
  data: {
    fontMode: 'normal',

    userInfo: { nickName: '', className: '', avatarUrl: '' },
    stats: { works: 0, likes: 0, comments: 0 },

    tracking: [],   // 审核状态追踪列表
    leftList: [],   // 我的作品瀑布流（左列）
    rightList: [],

    loading: true,
    isEmpty: false
  },

  _rawList: [],

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
    this.loadUserInfo();
    this.refresh();
  },

  /** 用户资料：本地修改优先，其次登录态，最后默认演示人设 */
  loadUserInfo() {
    const local = wx.getStorageSync('myProfile');
    const app = getApp();
    const loginInfo = app && app.globalData && app.globalData.userInfo;
    this.setData({
      userInfo: {
        nickName:
          (local && local.nickName) ||
          (loginInfo && loginInfo.nickName) ||
          '林小满',
        className:
          (local && local.className) ||
          (loginInfo && loginInfo.className) ||
          '视觉传达2201班',
        avatarUrl:
          (local && local.avatarUrl) ||
          (loginInfo && loginInfo.avatarUrl) ||
          ''
      }
    });
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      const res = await api.getMyWorks();
      const list = (res && res.list) || [];

      this._rawList = list.map((item) => {
        const st = STATUS_MAP[item.status] || STATUS_MAP.pending;
        return Object.assign({}, item, {
          statusText: st.text,
          statusCls: st.cls,
          timeText: util.fmtDateTime(item.createTime),
          likeCountText: util.formatCount(item.likeCount),
          aspect: item.aspect || 1.2
        });
      });

      // 成就统计（Z-07）：作品总数 / 获赞总数 / 收到留言
      let likes = 0;
      let comments = 0;
      this._rawList.forEach((w) => {
        likes += w.likeCount || 0;
        comments += w.commentCount || 0;
      });

      this.setData({
        stats: { works: this._rawList.length, likes, comments },
        tracking: this._rawList,
        isEmpty: this._rawList.length === 0
      });
      this.applyColumns();
    } catch (err) {
      console.warn('[mine] 我的作品加载失败:', err && err.message);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 双列瀑布流（按估算高度均衡分列） */
  applyColumns() {
    const left = [];
    const right = [];
    const heights = [0, 0];
    this._rawList.forEach((item) => {
      const h = 300 * item.aspect + 180;
      const idx = heights[0] <= heights[1] ? 0 : 1;
      (idx === 0 ? left : right).push(item);
      heights[idx] += h;
    });
    this.setData({ leftList: left, rightList: right });
  },

  /* ================= 资料维护（Z-09） ================= */

  /** 微信头像填写能力：点击头像更换 */
  chooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (!avatarUrl) return;
    const userInfo = Object.assign({}, this.data.userInfo, { avatarUrl });
    this.setData({ userInfo });
    this.saveProfile(userInfo);
    wx.showToast({ title: '头像已更新', icon: 'none' });
  },

  /** 昵称编辑（type=nickname 微信昵称填写能力） */
  onNicknameBlur(e) {
    const nickName = (e.detail.value || '').trim();
    if (!nickName || nickName === this.data.userInfo.nickName) return;
    const userInfo = Object.assign({}, this.data.userInfo, { nickName });
    this.setData({ userInfo });
    this.saveProfile(userInfo);
    wx.showToast({ title: '昵称已更新', icon: 'none' });
  },

  saveProfile(userInfo) {
    wx.setStorageSync('myProfile', {
      nickName: userInfo.nickName,
      className: userInfo.className,
      avatarUrl: userInfo.avatarUrl
    });
  },

  /* ================= 审核状态追踪 ================= */

  statusTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.tracking[index];
    if (!item) return;

    // 红色：未通过 → 查看管理员驳回原因
    if (item.status === 'rejected') {
      wx.showModal({
        title: '未通过原因',
        content: item.rejectReason || item.note || '请联系管理员了解详情',
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }
    // 黄色：待审核 → 展示进度说明
    if (item.status === 'pending') {
      wx.showModal({
        title: '审核中',
        content: item.note || '预计 1-2 个工作日完成审核，通过后将展示在沐光墙。',
        showCancel: false,
        confirmText: '好的'
      });
      return;
    }
    // 绿色：已通过 → 查看作品详情
    wx.navigateTo({ url: '/pages/detail/detail?id=' + item.id });
  },

  /* ================= 大字模式（Z-10 适老化） ================= */

  onFontSwitch(e) {
    const fontMode = e.detail.value ? 'large' : 'normal';
    wx.setStorageSync('fontMode', fontMode);
    this.setData({ fontMode });
    wx.showToast({
      title: fontMode === 'large' ? '已开启大字模式' : '已恢复标准字号',
      icon: 'none'
    });
  },

  openHelp() {
    wx.showModal({
      title: '设置与帮助',
      content:
        '沐光·美育平台 v1.0\n高校美育成果展示与交流平台\n\n' +
        '· 大字模式：全局字号提升至 22px（Z-10 适老化）\n' +
        '· 审核状态：绿色已通过 / 黄色待审核 / 红色未通过',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
