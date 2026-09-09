import request from '@/utils/request'

// ---------------- 认证 ----------------
export const adminLogin = (data) => request.post('/admin/login', data)

// ---------------- 工作台统计 G-04 ----------------
export const getStats = () => request.get('/admin/stats')

// ---------------- 作品审核 G-01 ----------------
export const getAdminWorks = (params) => request.get('/admin/works', { params })
export const approveWork = (workId) => request.post('/admin/work/approve', { workId })
export const rejectWork = (workId, reason) => request.post('/admin/work/reject', { workId, reason })

// ---------------- 用户管理 G-02 ----------------
export const getAdminUsers = () => request.get('/admin/users')
export const setUserStatus = (userId, status) => request.post('/admin/user/status', { userId, status })

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
