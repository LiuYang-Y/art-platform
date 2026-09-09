import { defineStore } from 'pinia'
import { adminLogin } from '@/api'
import { clearAuth, getAdminInfo, setAdminInfo } from '@/utils/constants'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('admin_token') || '',
    adminInfo: getAdminInfo(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    displayName: (s) => s.adminInfo?.nickName || s.adminInfo?.username || '管理员',
  },
  actions: {
    async login(username, password) {
      const data = await adminLogin({ username, password })
      // data = { token, adminInfo }
      this.token = data.token
      this.adminInfo = data.adminInfo
      localStorage.setItem('admin_token', data.token)
      setAdminInfo(data.adminInfo)
      return data
    },
    logout() {
      this.token = ''
      this.adminInfo = null
      clearAuth()
    },
  },
})
