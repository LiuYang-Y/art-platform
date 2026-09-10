import { defineStore } from 'pinia'
import { userLogin } from '@/api'
import { clearAuth, getAdminInfo, setAdminInfo } from '@/utils/constants'

const ROLE_NAMES = { admin: '超级管理员', teacher: '教师', student: '学员' }

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('admin_token') || '',
    adminInfo: getAdminInfo(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => s.adminInfo?.role || '',
    isAdmin: (s) => s.adminInfo?.role === 'admin',
    roleName: (s) => ROLE_NAMES[s.adminInfo?.role] || '用户',
    displayName: (s) => s.adminInfo?.nickName || s.adminInfo?.username || '用户',
    /** 各角色登录后的落地页：管理员 → 后台工作台；学生/教师 → 创作台 */
    homePath: (s) => (s.adminInfo?.role === 'admin' ? '/dashboard' : '/studio'),
  },
  actions: {
    /** 账密登录（学生 / 教师 / 管理员通用，按返回 role 分流） */
    async login(username, password) {
      const data = await userLogin({ username, password })
      // data = { token, userInfo, loginMode }
      this.token = data.token
      this.adminInfo = data.userInfo
      localStorage.setItem('admin_token', data.token)
      setAdminInfo(data.userInfo)
      return data
    },
    logout() {
      this.token = ''
      this.adminInfo = null
      clearAuth()
    },
  },
})
