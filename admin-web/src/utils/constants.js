// 全局常量与工具

/** 作品分类 key → 中文名（与后端 /api/work/categories 对齐） */
export const CATEGORY_MAP = {
  all: '全部',
  calligraphy: '书法',
  painting: '绘画',
  photography: '摄影',
  handcraft: '手工',
  other: '其他艺术',
}

export const CATEGORY_KEYS = Object.keys(CATEGORY_MAP).filter((k) => k !== 'all')

export function categoryName(key) {
  return CATEGORY_MAP[key] || key || '其他艺术'
}

/** 作品审核状态 */
export const STATUS_MAP = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}

/** 课程状态 */
export const COURSE_STATUS_MAP = {
  active: '进行中',
  closed: '已结束',
}

/**
 * 图片地址归一化：
 *  - 完整 http(s)://... 直接可用
 *  - 以 /uploads 开头的相对路径 → 拼上后端源（开发默认 localhost:3000，可用 VITE_IMG_ORIGIN 覆盖）
 *  - 空值返回占位
 */
export function resolveImg(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/uploads')) {
    const origin = import.meta.env.VITE_IMG_ORIGIN || 'http://localhost:3000'
    return origin + url
  }
  return url
}

/** 格式化时间串（PG timestamptz 字符串 → 本地时间） */
export function fmtTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 管理员信息读写 */
export function getAdminInfo() {
  try {
    return JSON.parse(localStorage.getItem('admin_info') || 'null')
  } catch {
    return null
  }
}
export function setAdminInfo(info) {
  localStorage.setItem('admin_info', JSON.stringify(info || {}))
}
export function clearAuth() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_info')
}
