/**
 * 小程序入口
 * ------------------------------------------------------------
 * onLaunch 阶段执行微信静默登录，置换 Token 并落盘
 *
 * 登录 Promise 做了单例缓存：onLaunch 的登录是异步的，若页面首屏
 * 同时发起多个需鉴权请求，只会产生一次 wx.login，其余复用同一 Promise。
 */

const api = require('./utils/api');

App({
  globalData: {
    token: '',
    userInfo: null,
    isLogin: false
  },

  /** 正在进行的登录 Promise，避免并发重复登录 */
  _loginPromise: null,

  onLaunch() {
    // 先同步本地缓存，保证首屏渲染时即可判断登录态
    this.globalData.token = wx.getStorageSync('token') || '';
    this.globalData.userInfo = wx.getStorageSync('userInfo') || null;

    // 执行静默登录（异步，不阻塞启动）
    this.login();
  },

  /**
   * 静默登录
   * 1. wx.login 获取临时凭证 code
   * 2. 调用后端 /api/user/login 置换 Token
   * 3. 写入本地存储与全局状态
   * @returns {Promise<object>}
   */
  login() {
    // 已有登录流程在进行中，直接复用
    if (this._loginPromise) {
      return this._loginPromise;
    }

    const task = new Promise((resolve, reject) => {
      wx.login({
        timeout: 10000,
        success: (loginRes) => {
          if (!loginRes.code) {
            console.error('[app] wx.login 未返回 code:', loginRes.errMsg);
            reject(new Error(loginRes.errMsg || 'wx.login 失败'));
            return;
          }

          // 走 api 层：后端未启动时自动降级为演示登录（mock token），保证全链路可演示
          api.login(loginRes.code)
            .then((data) => {
              const token = data && data.token;
              const userInfo = data && data.userInfo;

              if (!token) {
                reject(new Error('服务端未返回 token'));
                return;
              }

              // 落盘 + 更新全局状态
              wx.setStorageSync('token', token);
              wx.setStorageSync('userInfo', userInfo);
              this.globalData.token = token;
              this.globalData.userInfo = userInfo;
              this.globalData.isLogin = true;

              console.log('[app] 静默登录成功:', userInfo);
              resolve(data);
            })
            .catch((err) => {
              console.error('[app] 静默登录失败:', err && err.message);
              reject(err);
            });
        },
        fail: (err) => {
          console.error('[app] wx.login 调用失败:', err && err.errMsg);
          reject(err);
        }
      });
    });

    // 失败后清空缓存，保证后续可重新发起登录
    this._loginPromise = task.catch((err) => {
      this._loginPromise = null;
      this.globalData.isLogin = false;
      throw err;
    });

    return this._loginPromise;
  },

  /**
   * 确保已登录：已登录立即 resolve，否则触发登录
   * 供 request 层在发包前调用
   */
  ensureLogin() {
    if (this.globalData.isLogin && wx.getStorageSync('token')) {
      return Promise.resolve(this.globalData.userInfo);
    }
    return this.login();
  },

  /**
   * 重新登录：丢弃旧 Promise 缓存，强制走一遍完整登录
   * 供 request 层在 401 时调用
   */
  relogin() {
    this._loginPromise = null;
    return this.login();
  }
});
