#!/usr/bin/env node
/**
 * 验证云函数里的 WECHAT_APPID / WECHAT_SECRET 是否被微信网关接受。
 * 用一个必然无效的 code 去调 jscode2session：
 *   - 返回 40029 invalid code  → AppID/Secret 正确（只是 code 假）
 *   - 返回 40013 invalid appid → AppID 写错
 *   - 返回 40125 invalid appsecret → Secret 写错
 * 同时验证线上 /user/login 已切到真实通道（无 code 应报 400）。
 */
const BASE = 'https://aaa-d8gj21kc1d09d6414-1480206910.ap-shanghai.app.tcloudbase.com/api';

(async () => {
  // 1) 直接打微信网关，验证凭证本身
  const appid = process.argv[2];
  const secret = process.argv[3];
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=INVALID_CODE_FOR_PROBE&grant_type=authorization_code`;
  const r = await fetch(url);
  const j = await r.json();
  console.log('[微信网关] errcode=%s errmsg=%s', j.errcode, j.errmsg);
  if (j.errcode === 40029) console.log('[微信网关] ✅ 凭证正确（仅 code 无效，符合预期）');
  else if (j.errcode === 40013) console.log('[微信网关] ❌ AppID 无效');
  else if (j.errcode === 40125) console.log('[微信网关] ❌ AppSecret 无效');
  else if (j.errcode === 0) console.log('[微信网关] ⚠️ 意外成功，请检查是否用了真实 code');
  else console.log('[微信网关] ⚠️ 其他错误码，需人工判断');

  // 2) 验证线上登录接口是否已切换到真实通道
  const lr = await fetch(BASE + '/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const lj = await lr.json();
  console.log('\n[线上 /user/login 空 body] HTTP %s code=%s message=%s', lr.status, lj.code, lj.message);
  if (lj.code === 400 && /code/i.test(String(lj.message))) {
    console.log('[线上 /user/login] ✅ 已切真实通道（要求 code，演示分支已关闭）');
  } else if (lj.code === 200) {
    console.log('[线上 /user/login] ⚠️ 仍走演示分支，环境变量可能未生效');
  }
})();
