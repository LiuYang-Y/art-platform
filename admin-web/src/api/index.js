import request from '@/utils/request'

// ---------------- 认证 ----------------
export const adminLogin = (data) => request.post('/admin/login', data)
/** 账密登录（网页端通用：学生 / 教师 / 管理员，登录后按 role 分流） */
export const userLogin = (data) => request.post('/user/login-password', data)

// ---------------- 工作台统计 G-04 ----------------
export const getStats = () => request.get('/admin/stats')

// ---------------- 作品审核 G-01 ----------------
export const getAdminWorks = (params) => request.get('/admin/works', { params })
export const approveWork = (workId) => request.post('/admin/work/approve', { workId })
export const rejectWork = (workId, reason) => request.post('/admin/work/reject', { workId, reason })

// ---------------- 用户管理 G-02 ----------------
export const getAdminUsers = () => request.get('/admin/users')
export const getAdminClasses = () => request.get('/admin/classes')
/**
 * 修改用户资料：{ userId, realName?, className? }
 *  - realName：显示名（原「昵称」概念已取消），非空，最长 30 字
 *  - className：班级名，自由输入；空串 = 清空班级；不存在的班级会自动创建
 *  - classId：兼容旧调用（数字=指定班级；null=清空）
 */
export const updateAdminUser = (data) => request.post('/admin/user/update', data)
export const setUserStatus = (userId, status) => request.post('/admin/user/status', { userId, status })

// ---------------- 账号认定 G-07（学号绑定审核） ----------------
export const getBindApplications = (params) => request.get('/admin/bind-applications', { params })
export const auditBindApplication = (userId, action, reason) =>
  request.post('/admin/bind-audit', { userId, action, reason })

// ---------------- 课程管理 G-03 ----------------
export const getCourses = (params) => request.get('/course/list', { params })
export const createCourse = (data) => request.post('/course/create', data)
export const updateCourse = (data) => request.post('/course/update', data)
export const deleteCourse = (id) => request.post('/course/delete', { id })

// ---------------- 敏感词库管理 G-06 ----------------
export const getSensitiveWords = (params) => request.get('/admin/sensitive', { params })
export const getSensitiveCategories = () => request.get('/admin/sensitive/categories')
export const addSensitiveWord = (data) => request.post('/admin/sensitive/add', data)
export const updateSensitiveWord = (data) => request.post('/admin/sensitive/update', data)
export const deleteSensitiveWords = (ids) => request.post('/admin/sensitive/delete', { ids })
export const resetSensitiveWords = () => request.post('/admin/sensitive/reset')

// ---------------- 学生创作台（网页端发布作品 Z-03 / Z-04） ----------------
export const getWorkCategories = () => request.get('/work/categories')
export const getMyWorks = () => request.get('/work/mine')
export const createWork = (data) => request.post('/work/create', data)
export const aiPolish = (data) => request.post('/ai/polish', data)
export const uploadWorkImage = (formData) =>
  request.post('/work/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
