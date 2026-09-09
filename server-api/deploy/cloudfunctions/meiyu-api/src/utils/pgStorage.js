/**
 * CloudBase PG 模式云存储（pgstore）上传工具
 * ------------------------------------------------------------
 * PG 模式环境的存储为 pgstore（与旧 COS 存储是两套独立系统），
 * @cloudbase/node-sdk 的 app.uploadFile()（旧 COS API）不可用于 pgstore，
 * 需走 CloudBase PG Storage HTTP API：
 *   POST https://{envId}.api.tcloudbasegateway.com/v1/storages/object/{bucket}/{key}
 *   Authorization: Bearer {service_role api key}
 *
 * 公开读取（bucket public=true + RLS 放行 anon）：
 *   GET  https://{envId}.api.tcloudbasegateway.com/v1/storages/object/{bucket}/{key}
 *   匿名可下载（无 JWT 且 bucket 为 public 时以 SuperUser 身份查询）
 *
 * 若未配置 PG_STORAGE_TOKEN（本地兜底/开发态），上传方应自行回退本地存储。
 */

const axios = require('axios');

const ENV_ID = process.env.TENCENT_ENV_ID || '';
const TOKEN = process.env.PG_STORAGE_TOKEN || ''; // service_role API Key（云函数环境变量注入）
const BUCKET = process.env.PG_STORAGE_BUCKET || 'art-works';
const GATEWAY_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`;

/** 是否启用 pgstore 上传（有 service_role token 且环境号存在） */
function enabled() {
  return Boolean(TOKEN && ENV_ID);
}

/**
 * 生成对象 key：works/{timestamp}_{random}{ext}（防覆盖 + 防路径穿越）
 */
function buildObjectKey(ext) {
  const safeExt = /^\.(jpe?g|png|gif|webp|bmp)$/i.test(ext || '') ? ext.toLowerCase() : '.jpg';
  return `works/${Date.now()}_${Math.random().toString(36).slice(-6)}${safeExt}`;
}

/**
 * 构造对象的公开访问 URL（bucket 需 public=true + RLS 放行 anon SELECT）
 */
function publicUrl(objectKey) {
  return `${GATEWAY_BASE}/v1/storages/object/${BUCKET}/${objectKey}`;
}

/**
 * 上传图片 buffer 到 pgstore
 * @param {object} opts { buffer: Buffer, mime: string, ext: string }
 * @returns {Promise<{objectKey:string, fileId:string, url:string}>}
 */
async function uploadImage({ buffer, mime, ext }) {
  if (!enabled()) {
    const err = new Error('PG_STORAGE_TOKEN 未配置，pgstore 上传不可用');
    err.code = 'PG_STORAGE_NOT_CONFIGURED';
    throw err;
  }
  const objectKey = buildObjectKey(ext);
  const url = `${GATEWAY_BASE}/v1/storages/object/${BUCKET}/${objectKey}`;
  const { data } = await axios.post(url, buffer, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': mime || 'application/octet-stream',
      'x-upsert': 'true' // 同名覆盖（key 带随机后缀，实际不会冲突，加上更稳）
    },
    timeout: 20000,
    maxBodyLength: 6 * 1024 * 1024
  });
  return { objectKey, fileId: data && data.Id, url: publicUrl(objectKey) };
}

module.exports = { enabled, buildObjectKey, publicUrl, uploadImage };
