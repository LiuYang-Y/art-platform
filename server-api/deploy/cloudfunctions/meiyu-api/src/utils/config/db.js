/**
 * PostgreSQL 数据访问层（双通道）
 * ------------------------------------------------------------
 * 数据通道由 mode() 决定：
 *   - 'pg-direct'         ：.env 配置了 PG_HOST 等直连参数 → 使用 pg 官方驱动连接池
 *   - 'cloudbase-openapi' ：未配置 PG_* → 走腾讯云 OpenAPI ExecutePGSql（原有通道）
 *
 * 控制器 / 脚本只依赖本模块导出的统一 API：
 *   mode()                  当前通道：'pg-direct' | 'cloudbase-openapi'
 *   query(sql, params)      执行 SQL，返回 { rows: [...] }
 *   queryOne(sql, params)   返回首行对象或 null
 *   insertReturningId(t,c,v) 插入并返回自增 id
 *   escapeValue(v)          SQL 字面量转义（OpenAPI 通道专用）
 *   pool                    pg 连接池实例（仅 pg-direct 通道存在，懒加载）
 *
 * ── 直连通道的一致性设计 ─────────────────────────────────
 * 为了切换通道后「控制器与前端看到的数据」与 OpenAPI 通道完全一致：
 *   1) timestamptz / timestamp / date → 通过 pg 类型解析器保持 PG 文本字符串
 *      （如 '2026-09-07 15:14:39.528899+08'，与 ExecutePGSql 返回格式一致），
 *      而不是默认的 JS Date 对象；
 *   2) numeric / bigint            → Number（ExecutePGSql 通道同样还原为数字）；
 *   3) jsonb                       → pg 原生解析为对象/数组（与 OpenAPI 通道一致）；
 *   4) JS 数组参数统一 JSON.stringify —— images 列是 jsonb，
 *      pg 驱动默认会把数组序列化成 PG 数组字面量（{...}）导致写坏 jsonb。
 */

const dotenv = require('dotenv');
dotenv.config();

const { Pool, types: pgTypes } = require('pg');

const ENV_ID = process.env.TENCENT_ENV_ID;

/* ------------------------------------------------------------------ */
/* pg 类型解析器（模块加载即注册，仅 pg-direct 通道生效）                */
/* ------------------------------------------------------------------ */
const OID = {
  DATE: 1082, // date
  TIMESTAMP: 1114, // timestamp without time zone
  TIMESTAMPTZ: 1184, // timestamp with time zone
  INT8: 20, // bigint
  NUMERIC: 1700 // numeric
};

// 时间类：保持 PG 文本，避免变成 JS Date（与 OpenAPI 返回一致）
pgTypes.setTypeParser(OID.DATE, (v) => v);
pgTypes.setTypeParser(OID.TIMESTAMP, (v) => v);
pgTypes.setTypeParser(OID.TIMESTAMPTZ, (v) => v);
// bigint / numeric：还原为数字（pg 默认分别返回 string / string）
pgTypes.setTypeParser(OID.INT8, (v) => (v == null ? null : Number(v)));
pgTypes.setTypeParser(OID.NUMERIC, (v) => (v == null ? null : Number(v)));

/* ------------------------------------------------------------------ */
/* pg-direct：连接池（懒加载）                                          */
/* ------------------------------------------------------------------ */
let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      // CloudBase PostgreSQL 外网连接通常强制 SSL
      ssl:
        String(process.env.PG_SSL || '').toLowerCase() === 'false'
          ? false
          : { rejectUnauthorized: false },
      max: 10, // 连接池上限
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      application_name: 'art-platform-server'
    });
    _pool.on('error', (err) => {
      // 空闲连接出错不应让进程崩溃，仅记录
      console.error('[db:pg] 连接池空闲连接错误:', err.message);
    });
  }
  return _pool;
}

/** 数据通道模式：配置了 PG 直连参数走 pg-direct，否则走 CloudBase OpenAPI */
function mode() {
  return process.env.PG_HOST ? 'pg-direct' : 'cloudbase-openapi';
}

/** pg 直连参数归一化：数组 → JSON 字符串（jsonb 入参）；其余交给 pg 原生序列化 */
function pgParam(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

function normalizeParams(params) {
  if (!params || params.length === 0) return [];
  return params.map(pgParam);
}

/** pg-direct 通道统一查询入口（错误带友好提示） */
async function pgQuery(sql, params) {
  try {
    return await getPool().query(sql, normalizeParams(params));
  } catch (err) {
    const hint =
      process.env.PG_HOST && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|password authentication|too many clients/i.test(err.message)
        ? '（PG 直连失败，请核对 .env 的 PG_HOST/PORT/USER/PASSWORD/DATABASE，并确认控制台已开通外网访问）'
        : '';
    throw new Error(`${err.message} ${hint}`.trim());
  }
}

/* ------------------------------------------------------------------ */
/* cloudbase-openapi：原有通道（未配置 PG_* 时使用）                     */
/* ------------------------------------------------------------------ */
const tcb = require('tencentcloud-sdk-nodejs-tcb');
const TcbClient = tcb.tcb.v20180608.Client;

let client = null;

/** 简单退避，用于 OpenAPI 触发频限时重试 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 包装 ExecutePGSql，对「频率超限」自动退避重试（上限 6 次） */
async function execPGSql(params, attempt = 0) {
  try {
    return await getTcbClient().ExecutePGSql(params);
  } catch (err) {
    const msg = err.message || '';
    const isRateLimit =
      msg.includes('exceeds the frequency limit') ||
      msg.includes('RequestLimitExceeded') ||
      err.code === 'FailedOperation';
    if (isRateLimit && attempt < 6) {
      const backoff = Math.min(2000, 120 * Math.pow(2, attempt));
      await sleep(backoff);
      return execPGSql(params, attempt + 1);
    }
    throw err;
  }
}

function getTcbClient() {
  if (!client) {
    client = new TcbClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID,
        secretKey: process.env.TENCENT_SECRET_KEY
      },
      region: process.env.TENCENT_REGION || 'ap-shanghai',
      profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } }
    });
  }
  return client;
}

/**
 * 值还原：CloudBase OpenAPI 把 PG 值序列化为字符串
 * - true/false → 布尔
 * - 纯数字 → 数字
 * - { / [ 开头 → 尝试 JSON 解析（jsonb 字段）
 * - 其余 → 保持字符串
 */
function coerce(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'NULL' || val === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  if (val.startsWith('{') || val.startsWith('[')) {
    try {
      return JSON.parse(val);
    } catch (e) {
      /* 非合法 JSON 则保持原字符串 */
    }
  }
  return val;
}

/** 将 ExecutePGSql 的二维结果映射为对象数组 */
function mapRows(res) {
  const columns = (res.Columns || []).map((c) => String(c).toLowerCase());
  const rows = res.Rows || [];
  return rows.map((rowStr) => {
    const cells = typeof rowStr === 'string' ? JSON.parse(rowStr) : rowStr;
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = coerce(cells[i]);
    });
    return obj;
  });
}

/** SQL 字面量转义 */
function escapeValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toString() : 'NULL';
  const json = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${json.replace(/'/g, "''")}'`;
}

/** 把 $1/$2 占位符替换为转义后的字面量 */
function interpolate(sql, params) {
  if (!params || params.length === 0) return sql;
  return sql.replace(/\$(\d+)/g, (_, n) => {
    const idx = parseInt(n, 10) - 1;
    if (idx < 0 || idx >= params.length) {
      throw new Error(`SQL 参数 $${n} 缺失`);
    }
    return escapeValue(params[idx]);
  });
}

/* ------------------------------------------------------------------ */
/* 对外统一 API                                                         */
/* ------------------------------------------------------------------ */
async function query(sql, params = []) {
  if (mode() === 'pg-direct') {
    const res = await pgQuery(sql, params);
    return { rows: res.rows };
  }
  const finalSql = interpolate(sql, params);
  const res = await execPGSql({ EnvId: ENV_ID, Sql: finalSql });
  return { rows: mapRows(res) };
}

async function queryOne(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

/**
 * 插入并返回自增 id。
 * - pg-direct：直接 INSERT ... RETURNING id（原子、简洁）
 * - OpenAPI：ExecutePGSql 不回传 RETURNING 结果行，
 *   先经 pg_get_serial_sequence 取号再显式写入 id，保证序列与数据一致。
 */
async function insertReturningId(table, columns, values) {
  if (mode() === 'pg-direct') {
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) RETURNING id`;
    const res = await pgQuery(sql, values);
    return Number(res.rows[0].id);
  }

  const seqRes = await query(
    `SELECT nextval(pg_get_serial_sequence($1, 'id'))::bigint AS id`,
    [table]
  );
  const id = seqRes.rows[0] && seqRes.rows[0].id;
  if (id == null) {
    throw new Error(`无法获取表 ${table} 的自增序列值（请确认 id 列为 SERIAL）`);
  }

  const cols = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = values.map((_, i) => `$${i + 2}`).join(', ');
  const sql = `INSERT INTO "${table}" (id, ${cols}) VALUES ($1, ${placeholders})`;
  await query(sql, [Number(id), ...values]);
  return Number(id);
}

module.exports = {
  mode,
  query,
  queryOne,
  insertReturningId,
  escapeValue,
  /** pg 连接池（仅 pg-direct 通道存在；OpenAPI 通道为 null） */
  get pool() {
    return mode() === 'pg-direct' ? getPool() : null;
  }
};
