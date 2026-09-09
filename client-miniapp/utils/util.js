/**
 * 通用工具函数
 */

/** 补零 */
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/**
 * 解析时间字符串（兼容 iOS：'2026-09-07 20:15' / ISO 均可）
 */
function parseDate(str) {
  if (!str) return new Date();
  if (typeof str === 'number') return new Date(str);
  return new Date(String(str).replace(/-/g, '/').replace('T', ' '));
}

/** 格式化为 MM-DD HH:mm */
function fmtDateTime(str) {
  const d = parseDate(str);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 格式化为 MM.DD */
function fmtShort(str) {
  const d = parseDate(str);
  return pad(d.getMonth() + 1) + '.' + pad(d.getDate());
}

/** 数字缩写：1234 → 1234，12000 → 1.2w */
function formatCount(n) {
  const num = Number(n) || 0;
  if (num >= 10000) {
    const w = num / 10000;
    return (w >= 10 ? Math.round(w) : w.toFixed(1)) + 'w';
  }
  return String(num);
}

/**
 * 周次区间计算（周一为一周开始）
 * @param {number} offsetWeeks 0=本周 1=下周 -1=上周
 * @returns {{ start:'09.07', end:'09.13', label:'09.07-09.13', monday:Date }}
 */
function weekRange(offsetWeeks) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offsetWeeks * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const fmt = (d) => pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  return {
    start: fmt(monday),
    end: fmt(sunday),
    label: fmt(monday) + '-' + fmt(sunday),
    monday
  };
}

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 解析上课时间 "周一 14:00-15:30" → { dayIndex, dayName, start, end }
 */
function parseClassTime(classTime) {
  const result = { dayIndex: 8, dayName: '', start: '', end: '' };
  if (!classTime) return result;
  const dayName = DAY_NAMES.find((d) => classTime.indexOf(d) !== -1);
  if (dayName) {
    result.dayName = dayName;
    result.dayIndex = DAY_NAMES.indexOf(dayName) + 1;
  }
  const m = String(classTime).match(/(\d{1,2}:\d{2})\s*[-—~]\s*(\d{1,2}:\d{2})?/);
  if (m) {
    result.start = m[1];
    result.end = m[2] || '';
  }
  return result;
}

/**
 * 防抖
 */
function debounce(fn, wait) {
  let timer = null;
  return function () {
    const args = arguments;
    const ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(ctx, args), wait);
  };
}

module.exports = {
  pad,
  parseDate,
  fmtDateTime,
  fmtShort,
  formatCount,
  weekRange,
  DAY_NAMES,
  parseClassTime,
  debounce
};
