const success = (res, data = null, message = 'success') => {
    return res.status(200).json({
      code: 200,
      message,
      data
    });
  };
  
  /**
   * @param {object} res
   * @param {string} message 提示文案
   * @param {number} code    业务状态码（放在响应体的 code 字段）
   * @param {number} [httpStatus] 真实 HTTP 状态码，不传时按 code 自动推导
   */
  const fail = (res, message = 'error', code = 400, httpStatus) => {
    const status = httpStatus || (code >= 500 ? 500 : 200);
    return res.status(status).json({
      code,
      message,
      data: null
    });
  };
  
  module.exports = {
    success,
    fail
  };