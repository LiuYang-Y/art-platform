/**
 * 全站文本内容安全过滤（对齐《需求规格说明书》4.2(3) 与 G-06）
 * ------------------------------------------------------------
 * 所有用户提交的文本（作品标题 / 简介 / 评论 / 回复）入库前统一走本模块。
 *
 * 词库来源（分层）：
 *   1) 数据库 sensitive_words 表（G-06 管理端可后台增删/启停）—— 主词库
 *   2) 进程内缓存，管理端改动后 reloadWords() 即时刷新，无需重启
 *   3) 兜底默认词表 DEFAULT_WORDS：首次建表灌库来源；若表未初始化或查询
 *      异常则回退到该内置词表，保证安全过滤永不缺位、不阻塞正常业务
 *
 * 检测分层：
 *   - 命中式正则检查（离线、零成本、即时返回），命中返回该词与分类
 *   - 预留 hook：真实生产可在此挂载腾讯云「内容安全」/ 微信 msgSecCheck
 *     （网络异常自动降级为仅本地词表，不阻塞正常发布）
 */

const { query, queryOne } = require('./config/db');

/* ---------------- 默认词表（含分类；供首次建表灌库 + 表缺失兜底） ---------------- */
const DEFAULT_WORDS = [
  // —— 政治 / 违禁（violation） ——
  { word: '反动', category: 'violation' },
  { word: '颠覆', category: 'violation' },
  { word: '法轮', category: 'violation' },
  { word: '邪教', category: 'violation' },
  { word: '恐怖', category: 'violation' },
  { word: '极端组织', category: 'violation' },
  { word: '分裂国家', category: 'violation' },
  { word: '台独', category: 'violation' },
  { word: '藏独', category: 'violation' },
  { word: '疆独', category: 'violation' },
  { word: '暴力', category: 'violation' },
  { word: '枪支', category: 'violation' },
  { word: '毒品', category: 'violation' },
  { word: '赌博', category: 'violation' },
  { word: '招嫖', category: 'violation' },
  { word: '色情', category: 'violation' },
  { word: '淫秽', category: 'violation' },
  { word: '裸聊', category: 'violation' },
  { word: '卖淫', category: 'violation' },
  // —— 不雅 / 人身攻击（abuse） ——
  { word: '傻逼', category: 'abuse' },
  { word: '操你', category: 'abuse' },
  { word: '去死', category: 'abuse' },
  { word: '废物', category: 'abuse' },
  { word: '滚蛋', category: 'abuse' },
  { word: '贱人', category: 'abuse' },
  { word: '婊子', category: 'abuse' },
  { word: '尼玛', category: 'abuse' },
  // —— 广告 / 引流 / 敏感交易（advert） ——
  { word: '加微信', category: 'advert' },
  { word: '加qq', category: 'advert' },
  { word: '加QQ', category: 'advert' },
  { word: '代购', category: 'advert' },
  { word: '刷单', category: 'advert' },
  { word: '兼职日结', category: 'advert' },
  { word: '私聊我', category: 'advert' },
  { word: '点击链接', category: 'advert' },
  { word: '加群', category: 'advert' },
  { word: '转账', category: 'advert' },
  { word: '收款码', category: 'advert' },
  { word: '中奖', category: 'advert' },
  { word: '彩票', category: 'advert' },
  { word: '博彩', category: 'advert' },
  // —— 其他（other） ——
  { word: '兼职刷信誉', category: 'other' }
];

// 兼容旧引用：纯字符串词表
const BANNED_WORDS = DEFAULT_WORDS.map((w) => w.word);

/* ---------------- 运行时词表缓存 ---------------- */
let _wordsCache = []; // [{ word, category }]
let _bannedRe = null;  // 由 _wordsCache 构建
let _dbReady = false;  // 是否已成功从库加载过一次

/** 由词表构建正则（长词优先，中文按字面匹配） */
function _buildRe(words) {
  const list = [...new Set(words.map((w) => w.word).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (list.length === 0) return null;
  const escaped = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'));
}

/** 用给定词表刷新正则（内部） */
function _applyWords(words) {
  _wordsCache = words || [];
  _bannedRe = _buildRe(_wordsCache);
}

/**
 * 从数据库 sensitive_words 加载启用词表（enabled=true）。
 * 成功 → 刷新缓存并返回 true；表缺失/异常 → 返回 false（调用方决定是否回退）。
 */
async function loadFromDb() {
  try {
    const res = await query(
      'SELECT word, category FROM sensitive_words WHERE enabled = TRUE'
    );
    const rows = (res && res.rows) || [];
    if (rows.length > 0) {
      _applyWords(rows.map((r) => ({ word: r.word, category: r.category || 'other' })));
      _dbReady = true;
      return true;
    }
    return false; // 表存在但无启用词 → 交调用方兜底
  } catch (err) {
    // 表尚未初始化（未跑 init-db）等情况
    return false;
  }
}

/** 管理端增删词后调用：即时刷新运行时词表 */
async function reloadWords() {
  const ok = await loadFromDb();
  if (!ok) {
    // 回退内置默认词表，保证过滤永不缺位
    _applyWords(DEFAULT_WORDS);
    _dbReady = false;
  }
  return { fromDb: ok, count: _wordsCache.length };
}

// 模块加载即从库初始化一次；失败回退默认词表
(async function init() {
  const ok = await loadFromDb();
  if (!ok) _applyWords(DEFAULT_WORDS);
})();

/**
 * 检测文本是否含敏感词（同步，使用当前缓存词表）。
 * @returns {{ hit: boolean, word: string|null, category?: string }}
 */
function checkText(text) {
  if (typeof text !== 'string' || !text.trim()) return { hit: false, word: null };
  if (!_bannedRe) return { hit: false, word: null };
  const m = text.match(_bannedRe);
  if (!m) return { hit: false, word: null };
  const found = _wordsCache.find((w) => w.word === m[0]);
  return { hit: true, word: m[0], category: found ? found.category : 'other' };
}

/**
 * 远程内容安全预留钩子（默认离线仅本地词表）。
 * 真实环境接入微信 msgSecCheck / 腾讯云内容安全；网络异常一律 pass=true。
 */
async function remoteSecure() {
  return { pass: true, label: '' };
}

/**
 * 综合内容安全检查。返回 { ok:boolean, reason?:string }，ok=false 表示应阻断。
 * 先本地命中，命中即返回友好提示（含命中的词），与 4.2(3) 对齐。
 */
async function assertContentSafe(text) {
  const local = checkText(text);
  if (local.hit) {
    return { ok: false, reason: `内容包含不合规词汇（${local.word}），请修改后重试` };
  }
  const remote = await remoteSecure();
  if (!remote.pass) {
    return { ok: false, reason: remote.label || '内容未通过安全检测，请修改后重试' };
  }
  return { ok: true };
}

module.exports = {
  checkText,
  assertContentSafe,
  BANNED_WORDS,
  DEFAULT_WORDS,
  reloadWords,
  getLoadedWords: () => _wordsCache.slice(),
};
