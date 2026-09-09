import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

// 开发期走 vite 代理 /api；生产可整体覆盖
const BASE = import.meta.env.VITE_API_BASE || '/api'

const service = axios.create({
  baseURL: BASE,
  timeout: 15000,
})

// 请求拦截：注入管理员 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一解包 { code, data, msg }
service.interceptors.response.use(
  (res) => {
    const body = res.data
    // 非标准结构直接放行（如文件流等）
    if (body === null || typeof body !== 'object' || !('code' in body)) {
      return body
    }
    if (body.code === 200 || body.code === 0) {
      return body.data
    }
    // 业务失败
    ElMessage.error(body.msg || body.message || '请求失败')
    return Promise.reject(new Error(body.msg || body.message))
  },
  (err) => {
    const status = err.response?.status
    if (status === 401) {
      ElMessage.error('登录已失效，请重新登录')
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_info')
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login')
      }
    } else if (status === 403) {
      ElMessage.error('没有权限执行该操作')
    } else {
      const msg = err.response?.data?.msg || err.response?.data?.message || err.message || '网络错误'
      ElMessage.error(msg)
    }
    return Promise.reject(err)
  },
)

export default service
