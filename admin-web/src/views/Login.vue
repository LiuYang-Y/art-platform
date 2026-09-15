<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function onSubmit() {
  await formRef.value.validate().catch(() => Promise.reject())
  loading.value = true
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success(`${auth.roleName}登录成功`)
    // 按角色分流：管理员 → 后台工作台；学生/教师 → 创作台
    const redirect = route.query.redirect
    router.push(typeof redirect === 'string' ? redirect : auth.homePath)
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="deco-circle c1"></div>
    <div class="deco-circle c2"></div>

    <el-card class="login-card" shadow="never">
      <div class="brand">
        <div class="logo-mark">沐</div>
        <div>
          <h1>沐光 · 美育平台</h1>
          <p>高校美育成果展示与交流 · 管理员 / 教师登录</p>
        </div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="onSubmit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="账号（管理员 / 教师）" :prefix-icon="'User'" clearable />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="登录密码" show-password :prefix-icon="'Lock'" />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="onSubmit">
          {{ loading ? '登录中…' : '登 录' }}
        </el-button>
      </el-form>

      <div class="tip">
        管理员：<b>admin</b> / <b>admin123</b><br />
        学生请使用微信小程序登录并发布作品
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100vh;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 极光柔彩底（iOS 液态玻璃） */
  background:
    radial-gradient(ellipse 55% 45% at 15% 8%, rgba(255, 196, 150, 0.55), transparent 62%),
    radial-gradient(ellipse 50% 42% at 88% 18%, rgba(160, 180, 250, 0.52), transparent 60%),
    radial-gradient(ellipse 55% 48% at 85% 85%, rgba(255, 205, 175, 0.48), transparent 62%),
    radial-gradient(ellipse 48% 40% at 8% 90%, rgba(165, 215, 195, 0.45), transparent 60%),
    linear-gradient(160deg, #FAF6F0 0%, #F0F1F8 55%, #ECF3F0 100%);
}
.deco-circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
}
.c1 {
  width: 460px;
  height: 460px;
  top: -140px;
  right: -100px;
  background: radial-gradient(circle at 40% 40%, rgba(232, 133, 61, 0.35), transparent 70%);
}
.c2 {
  width: 400px;
  height: 400px;
  bottom: -150px;
  left: -100px;
  background: radial-gradient(circle at 60% 40%, rgba(61, 90, 128, 0.30), transparent 70%);
}

.login-card {
  width: 420px;
  max-width: 92vw;
  border-radius: 20px;
  z-index: 1;
  padding: 8px 6px;
  background: rgba(255, 255, 255, 0.62) !important;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.75) !important;
  box-shadow: 0 24px 60px rgba(60, 80, 110, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.login-card :deep(.el-card__body) {
  padding: 34px 38px 28px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}
.logo-mark {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: linear-gradient(135deg, #e8853d, #c84b31);
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(200, 75, 49, 0.35);
}
.brand h1 {
  margin: 0;
  font-size: 21px;
  color: var(--brand-ink);
}
.brand p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-sub);
}
.submit {
  width: 100%;
  height: 46px;
  font-size: 16px;
  letter-spacing: 4px;
  border-radius: 999px;
  background: linear-gradient(135deg, #e8853d, #c84b31);
  border: none;
  box-shadow: 0 8px 22px rgba(200, 75, 49, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.submit:hover {
  opacity: 0.92;
}
.tip {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-sub);
}
.tip b {
  color: #3d5a80;
}
</style>
