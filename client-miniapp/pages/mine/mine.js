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

    // 账号认定（G-07：学号绑定，认定通过后才能发布/评论）
    // 本页「姓名 / 班级」展示位即取自认定时提交的资料
    bind: { status: '', studentId: '', realName: '', className: '', rejectReason: '' },
    bindForm: { studentId: '', realName: '', className: '' },
    bindSubmitting: false,

    loading: true,
    isEmpty: false
  },

  _rawList: [],
  _deletingWork: false,

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
    this.loadUserInfo();
    this.loadBindStatus();
    this.refresh();
  },

  /**
   * 用户资料展示。
   * 「姓名 / 班级」以**服务端为准**（账号认定提交时写入 real_name / class_id 与 nick_name），
   * 本地 storage 只作离线兜底。
   *
   * ⚠️ 不要反过来用本地旧昵称回写服务端：自「姓名即昵称」双写后，
   *    那样的历史修复逻辑会把认定登记的姓名覆盖成手机上的旧昵称。
   */
  loadUserInfo() {
    const local = wx.getStorageSync('myProfile') || {};
    const app = getApp();
    const loginInfo = (app && app.globalData && app.globalData.userInfo) || {};
    this.setData({
      userInfo: {
        nickName: loginInfo.nickName || local.nickName || '',
        className: loginInfo.className || local.className || '',
        avatarUrl: local.avatarUrl || loginInfo.avatarUrl || ''
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
  async chooseAvatar(e) {
    const tempUrl = e.detail && e.detail.avatarUrl;
    if (!tempUrl) return;

    // 先本地生效（临时路径仅当前会话可展示），再上传换公网 URL 同步服务端
    const userInfo = Object.assign({}, this.data.userInfo, { avatarUrl: tempUrl });
    this.setData({ userInfo });
    this.saveProfile(userInfo);

    wx.showLoading({ title: '头像上传中…', mask: true });
    try {
      const publicUrl = await api.uploadImage(tempUrl);
      await api.updateProfile({ avatarUrl: publicUrl });
      const synced = Object.assign({}, this.data.userInfo, { avatarUrl: publicUrl });
      this.setData({ userInfo: synced });
      this.saveProfile(synced);
      this.syncGlobalUserInfo(synced);
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '头像同步失败，仅本机可见', icon: 'none' });
    }
  },

  /**
   * 姓名编辑（type=nickname 用微信昵称填写能力；平台「姓名即昵称」，双写 real_name）
   * 网页端用户管理页与作品作者名随之同步
   */
  onNicknameBlur(e) {
    const nickName = (e.detail.value || '').trim();
    if (!nickName || nickName === this.data.userInfo.nickName) return;
    const userInfo = Object.assign({}, this.data.userInfo, { nickName });
    this.setData({ userInfo });
    this.saveProfile(userInfo);
    this.syncGlobalUserInfo(userInfo);

    // 同步服务端：作品详情 / 沐光墙的作者名取自 users 表，
    // 只写本地 storage 会导致改名后作品页仍显示旧昵称
    api.updateProfile({ nickName }).catch((err) => {
      console.warn('[mine] 姓名同步服务端失败:', err && err.message);
      wx.showToast({ title: '姓名同步失败，请稍后重试', icon: 'none' });
    });
    wx.showToast({ title: '姓名已更新', icon: 'none' });
  },

  /** 同步全局登录态里的用户信息，保证其他页面读取一致 */
  syncGlobalUserInfo(userInfo) {
    const app = getApp();
    if (app && app.globalData && app.globalData.userInfo) {
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, {
        nickName: userInfo.nickName,
        realName: userInfo.nickName,
        className: userInfo.className,
        avatarUrl: userInfo.avatarUrl
      });
    }
  },

  saveProfile(userInfo) {
    wx.setStorageSync('myProfile', {
      nickName: userInfo.nickName,
      className: userInfo.className,
      avatarUrl: userInfo.avatarUrl
    });
  },

  /* ================= 账号认定（G-07 学号绑定） ================= */

  /** 拉取当前认定状态；被驳回时把学号/姓名/班级预填回表单便于修正重提 */
  async loadBindStatus() {
    try {
      const res = await api.getBindStatus();
      const bind = {
        status: (res && res.bindStatus) || 'unbound',
        studentId: (res && res.studentId) || '',
        realName: (res && res.realName) || '',
        className: (res && res.className) || '',
        rejectReason: (res && res.rejectReason) || ''
      };
      const patch = { bind };
      // 仅在「未绑定 / 被驳回」且表单未输入过时预填，避免覆盖用户正在编辑的内容
      if ((bind.status === 'unbound' || bind.status === 'rejected') && !this.data.bindForm.studentId) {
        patch.bindForm = {
          studentId: bind.studentId,
          realName: bind.realName || this.data.userInfo.nickName || '',
          className: bind.className || this.data.userInfo.className || ''
        };
      }
      this.setData(patch);
    } catch (err) {
      console.warn('[mine] 认定状态查询失败:', err && err.message);
    }
  },

  onBindIdInput(e) {
    this.setData({ 'bindForm.studentId': e.detail.value });
  },

  onBindNameInput(e) {
    this.setData({ 'bindForm.realName': e.detail.value });
  },

  onBindClassInput(e) {
    this.setData({ 'bindForm.className': e.detail.value });
  },

  /**
   * 提交学号绑定申请 → 等待管理员认定。
   * 姓名与班级会同时写入用户资料，提交成功后本页「姓名 / 班级」展示位立即更新。
   */
  async submitBind() {
    if (this.data.bindSubmitting) return;
    const studentId = (this.data.bindForm.studentId || '').trim();
    const realName = (this.data.bindForm.realName || '').trim();
    const className = (this.data.bindForm.className || '').trim();

    if (!/^[0-9A-Za-z]{6,20}$/.test(studentId)) {
      wx.showToast({ title: '学号格式不正确（6-20 位数字或字母）', icon: 'none' });
      return;
    }
    if (!realName) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!className) {
      wx.showToast({ title: '请填写班级，如：视觉传达2201班', icon: 'none' });
      return;
    }

    this.setData({ bindSubmitting: true });
    wx.showLoading({ title: '正在提交…', mask: true });
    try {
      await api.bindStudent({ studentId, realName, className });
      wx.hideLoading();

      // 姓名/班级已落库：同步本页展示位与本机缓存，避免刷新后回到旧值
      const userInfo = Object.assign({}, this.data.userInfo, { nickName: realName, className });
      this.setData({ userInfo });
      this.saveProfile(userInfo);
      this.syncGlobalUserInfo(userInfo);

      const bind = Object.assign({}, this.data.bind, {
        status: 'pending',
        studentId,
        realName,
        className,
        rejectReason: ''
      });
      this.setData({
        bind,
        bindForm: { studentId, realName, className }
      });

      wx.showToast({ title: '已提交，等待管理员认定', icon: 'none', duration: 2200 });
      this.loadBindStatus();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none', duration: 2500 });
    } finally {
      this.setData({ bindSubmitting: false });
    }
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

  /* ================= 删除自己的作品 ================= */

  /**
   * 删除自己的作品（待审核 / 已通过 / 未通过均可删，权限由服务端校验）
   * 服务端级联删除该作品的全部留言与点赞；云存储图片不做物理删除
   */
  onDeleteWork(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id || this._deletingWork) return;
    const item = this._rawList.find((w) => Number(w.id) === id);
    if (!item) return;

    const tail =
      item.commentCount > 0 || item.likeCount > 0
        ? `其下 ${item.commentCount || 0} 条留言和 ${item.likeCount || 0} 个赞将一并移除，`
        : '';
    wx.showModal({
      title: '删除作品',
      content: `「${item.title}」删除后不可恢复，${tail}确认删除？`,
      confirmText: '删除',
      confirmColor: '#C84B31',
      success: (r) => {
        if (r.confirm) this.doDeleteWork(id);
      }
    });
  },

  async doDeleteWork(id) {
    this._deletingWork = true;
    wx.showLoading({ title: '删除中…', mask: true });
    try {
      await api.deleteWork(id);
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'none' });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      console.warn('[mine] 删除作品失败:', err && err.message);
      wx.showToast({
        title: (err && err.message) || '删除失败，请重试',
        icon: 'none',
        duration: 2200
      });
    } finally {
      this._deletingWork = false;
    }
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
