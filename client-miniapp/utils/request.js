/**
 * 统一网络请求封装
 * ------------------------------------------------------------
 * 能力：
 *   1. Promise 化，调用侧可直接 await
 *   2. 自动在 header 携带本地缓存的 Token（Authorization: Bearer <token>）
 *   3. 服务端返回 code !== 200 时统一 wx.showToast 告警
 *   4. 拦截 401：清空本地存储并引导重新静默登录
 */

// 后端服务地址：开发阶段可用 localhost；真机/体验版走 CloudBase HTTP 云函数公网域名（部署后固定）
// 注意：小程序正式环境需在「小程序后台 → 开发管理 → 服务器域名」将下面域名加入 request 合法域名（HTTPS）
const BASE_URL = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';

// 登录接口：该接口自身不能参与 401 重登逻辑，否则会死循环
const LOGIN_PATH = '/user/login';

/**
 * 处理登录态失效
 */
function handleUnauthorized() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('userInfo');

  const app = getApp();
  // 用 relogin 而非 login：强制丢弃已失效的登录 Promise 缓存
  if (app && typeof app.relogin === 'function') {
    app.relogin();
  } else if (app && typeof app.login === 'function') {
    app.login();
  }
}

/**
 * 等待登录态就绪
 * ------------------------------------------------------------
 * 场景：onLaunch 的静默登录是异步的，页面首屏请求可能早于 Token 落盘发出，
 * 导致无谓的 401。此处在真正发包前补一次等待。
 */
function waitForLogin() {
  const token = wx.getStorageSync('token');
  if (token) {
    return Promise.resolve(true);
  }

  const app = getApp();
  if (app && typeof app.ensureLogin === 'function') {
    return app.ensureLogin().then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

/**
 * 核心请求方法
 * @param {object} options
 * @param {string} options.url       接口路径，如 '/user/login'
 * @param {string} options.method    请求方法，默认 GET
 * @param {object} options.data      请求参数
 * @param {object} options.header    自定义请求头
 * @param {boolean} options.needAuth 是否需要携带 Token，默认 true
 * @param {boolean} options.silent   为 true 时 suppress 错误 Toast（调用方自行处理）
 * @returns {Promise<any>} resolve 服务端 data 字段
 */
async function request(options = {}) {
  const {
    url,
    method = 'GET',
    data = {},
    header = {},
    needAuth = true,
    silent = false
  } = options;

  // 需要鉴权但本地无 Token 时，先等静默登录完成再发包
  if (needAuth) {
    await waitForLogin();
  }

  const token = wx.getStorageSync('token');

  const finalHeader = {
    'Content-Type': 'application/json',
    ...header
  };

  // 自动注入 Token
  if (needAuth && token) {
    finalHeader.Authorization = 'Bearer ' + token;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: finalHeader,
      timeout: 15000,
      success(res) {
        const body = res.data || {};
        const isLoginApi = url.indexOf(LOGIN_PATH) !== -1;

        // 1) 登录态失效：HTTP 401 或业务码 401
        if (res.statusCode === 401 || body.code === 401) {
          if (!isLoginApi) {
            handleUnauthorized();
          }
          reject({ code: 401, message: body.message || '登录状态失效，请重新登录' });
          return;
        }

        // 2) 业务成功：只把 data 透出，调用侧无需层层解包
        if (res.statusCode === 200 && body.code === 200) {
          resolve(body.data);
          return;
        }

        // 3) 其余一律视为失败，统一提示
        const message = body.message || `请求失败(${res.statusCode})`;
        if (!silent) {
          wx.showToast({
            title: message,
            icon: 'none',
            duration: 2000
          });
        }
        reject({ code: body.code || res.statusCode, message });
      },
      fail(err) {
        if (!silent) {
          wx.showToast({
            title: '网络连接失败，请检查网络',
            icon: 'none',
            duration: 2000
          });
        }
        reject({ code: -1, message: err.errMsg || '网络异常' });
      }
    });
  });
}

/**
 * 语法糖
 */
const get = (url, data = {}, options = {}) =>
  request({ url, method: 'GET', data, ...options });

const post = (url, data = {}, options = {}) =>
  request({ url, method: 'POST', data, ...options });

const put = (url, data = {}, options = {}) =>
  request({ url, method: 'PUT', data, ...options });

const patch = (url, data = {}, options = {}) =>
  request({ url, method: 'PATCH', data, ...options });

const remove = (url, data = {}, options = {}) =>
  request({ url, method: 'DELETE', data, ...options });

module.exports = {
  BASE_URL,
  request,
  get,
  post,
  put,
  patch,
  remove
};
