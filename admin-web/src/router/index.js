import { createRouter, createWebHistory } from 'vue-router'
import { getAdminInfo } from '@/utils/constants'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录 · 沐光美育管理平台', public: true },
  },
  {
    path: '/',
    component: () => import('@/layout/Index.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '工作台', icon: 'Odometer' },
      },
      {
        path: 'audit',
        name: 'Audit',
        component: () => import('@/views/Audit.vue'),
        meta: { title: '作品审核', icon: 'Stamp' },
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/Users.vue'),
        meta: { title: '用户管理', icon: 'User' },
      },
      {
        path: 'courses',
        name: 'Courses',
        component: () => import('@/views/Courses.vue'),
        meta: { title: '课程管理', icon: 'Calendar' },
      },
      {
        path: 'sensitive',
        name: 'Sensitive',
        component: () => import('@/views/Sensitive.vue'),
        meta: { title: '敏感词库', icon: 'Warning' },
      },
      {
        path: 'studio',
        name: 'Studio',
        component: () => import('@/views/Studio.vue'),
        meta: { title: '我的创作台', icon: 'EditPen' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 管理后台专属页面（仅 admin 角色可进）
const ADMIN_ONLY = ['Dashboard', 'Audit', 'Users', 'Courses', 'Sensitive']

// 全局守卫：未登录跳登录页；登录后按角色分流
router.beforeEach((to) => {
  const token = localStorage.getItem('admin_token')
  const role = getAdminInfo()?.role
  const isAdmin = role === 'admin'

  if (!to.meta.public && !token) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'Login' && token) {
    return { name: isAdmin ? 'Dashboard' : 'Studio' }
  }
  // 学生 / 教师不得进入管理后台页面，统一回创作台
  if (token && role && !isAdmin && ADMIN_ONLY.includes(to.name)) {
    return { name: 'Studio' }
  }
  document.title = to.meta.title || '沐光·美育平台'
  return true
})

export default router
