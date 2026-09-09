<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menus = [
  { path: '/dashboard', title: '工作台', icon: 'Odometer' },
  { path: '/audit', title: '作品审核', icon: 'Stamp' },
  { path: '/users', title: '用户管理', icon: 'User' },
  { path: '/courses', title: '课程管理', icon: 'Calendar' },
  { path: '/sensitive', title: '敏感词库', icon: 'Warning' },
]

const activeMenu = computed(() => route.path)
const adminName = computed(() => auth.displayName)
const adminRole = computed(() => {
  const r = auth.adminInfo?.role
  return r === 'teacher' ? '教师管理员' : r === 'admin' ? '超级管理员' : '管理员'
})

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <!-- 侧边栏：深靛蓝 -->
    <el-aside width="220px" class="aside">
      <div class="logo">
        <div class="logo-mark">沐</div>
        <div class="logo-text">
          <b>沐光·美育</b>
          <span>管理平台</span>
        </div>
      </div>

      <el-menu
        :default-active="activeMenu"
        router
        class="menu"
        background-color="transparent"
        text-color="#B9C6DA"
        active-text-color="#ffffff"
      >
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.title }}</span>
        </el-menu-item>
      </el-menu>

      <div class="aside-foot">
        <span class="dot"></span> 高校美育成果展示与交流
      </div>
    </el-aside>

    <el-container>
      <!-- 顶部栏 -->
      <el-header height="60px" class="header">
        <div class="header-title">{{ route.meta.title || '管理平台' }}</div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="(c) => c === 'logout' && onLogout()">
            <div class="user-chip">
              <el-avatar :size="34" :src="auth.adminInfo?.avatarUrl" class="avatar">
                {{ adminName.charAt(0) }}
              </el-avatar>
              <div class="user-meta">
                <span class="uname">{{ adminRole }}</span>
              </div>
              <el-icon class="arrow"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>{{ adminRole }}</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}

/* ---------- 侧边栏 ---------- */
.aside {
  background: linear-gradient(180deg, #243b55 0%, #1f2b3a 100%);
  display: flex;
  flex-direction: column;
  color: #fff;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 18px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.logo-mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f6f9f, #3d5a80);
  color: #fff;
  font-weight: 700;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
}
.logo-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.logo-text b {
  font-size: 16px;
  letter-spacing: 1px;
}
.logo-text span {
  font-size: 11px;
  color: #9fb3cf;
}
.menu {
  flex: 1;
  padding: 12px 10px;
  border-right: none;
}
.menu :deep(.el-menu-item) {
  border-radius: 8px;
  margin: 4px 0;
  height: 46px;
  line-height: 46px;
}
.menu :deep(.el-menu-item.is-active) {
  background: #3d5a80;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}
.aside-foot {
  padding: 16px;
  font-size: 11px;
  color: #7d91ac;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2e9e6b;
}

/* ---------- 顶部栏 ---------- */
.header {
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--brand-ink);
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.user-chip:hover {
  background: var(--brand-light);
}
.avatar {
  background: #3d5a80;
  color: #fff;
  font-weight: 600;
}
.user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  text-align: left;
}
.uname {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.urole {
  font-size: 11px;
  color: var(--text-sub);
}
.arrow {
  color: var(--text-sub);
  font-size: 13px;
}

/* ---------- 内容 ---------- */
.main {
  background: var(--page-bg);
  padding: 20px 24px;
  overflow: auto;
}
</style>
