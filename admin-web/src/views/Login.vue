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
const form = reactive({ username: 'admin', password: '' })

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function onSubmit() {
  await formRef.value.validate().catch(() => Promise.reject())
  loading.value = true
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success('登录成功')
    const redirect = route.query.redirect
    router.push(typeof redirect === 'string' ? redirect : '/dashboard')
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
          <p>高校美育成果展示与交流 · 管理端</p>
        </div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="onSubmit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="管理员账号" :prefix-icon="'User'" clearable />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="登录密码" show-password :prefix-icon="'Lock'" />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="onSubmit">
          {{ loading ? '登录中…' : '登 录' }}
        </el-button>
      </el-form>

      <div class="tip">
        默认测试账号：<b>admin</b> / <b>admin123</b>
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
  background: linear-gradient(135deg, #1f2b3a 0%, #2f4a73 55%, #3d5a80 100%);
}
.deco-circle {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.12), transparent 70%);
}
.c1 {
  width: 420px;
  height: 420px;
  top: -120px;
  right: -80px;
}
.c2 {
  width: 360px;
  height: 360px;
  bottom: -140px;
  left: -90px;
  background: radial-gradient(circle at 60% 40%, rgba(232, 133, 61, 0.18), transparent 70%);
}

.login-card {
  width: 420px;
  max-width: 92vw;
  border-radius: 16px;
  border: none;
  z-index: 1;
  padding: 8px 6px;
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
  height: 44px;
  font-size: 16px;
  letter-spacing: 4px;
  border-radius: 8px;
  background: linear-gradient(90deg, #3d5a80, #2f4a73);
  border: none;
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
