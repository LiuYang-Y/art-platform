<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAdminUsers, setUserStatus } from '@/api'
import { fmtTime, resolveImg } from '@/utils/constants'

const loading = ref(false)
const allUsers = ref([])
const keyword = ref('')

const keywordList = computed(() => allUsers.value)
const list = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return keywordList.value
  return keywordList.value.filter(
    (u) =>
      (u.nickName || '').toLowerCase().includes(kw) ||
      (u.username || '').toLowerCase().includes(kw) ||
      (u.className || '').toLowerCase().includes(kw)
  )
})

const roleMap = {
  admin: { type: 'danger', text: '管理员' },
  teacher: { type: 'warning', text: '教师' },
  student: { type: 'primary', text: '学生' },
}

async function load() {
  loading.value = true
  try {
    const data = await getAdminUsers()
    allUsers.value = data?.list || []
  } catch {
    allUsers.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function toggle(row) {
  const toDisable = row.status !== 'disabled'
  const actionText = toDisable ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(
      `确认${actionText}用户「${row.nickName || row.username || '#' + row.id}」？${
        toDisable ? '停用后该用户将无法登录小程序。' : ''
      }`,
      actionText + '用户',
      { confirmButtonText: actionText, cancelButtonText: '取消', type: toDisable ? 'warning' : 'info' }
    )
  } catch {
    return
  }
  try {
    await setUserStatus(row.id, toDisable ? 'disabled' : 'active')
    ElMessage.success(`已${actionText}`)
    load()
  } catch {
    /* 拦截器提示 */
  }
}
</script>

<template>
  <div>
    <p class="page-sub">平台用户（学生 / 教师 / 管理员）管理，可停用违规账号。</p>

    <div class="page-card">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索昵称 / 账号 / 班级"
          :prefix-icon="'Search'"
          clearable
          style="width: 280px"
        />
        <span class="count">共 {{ list.length }} 人</span>
        <el-button :icon="'Refresh'" circle @click="load" style="margin-left:auto" />
      </div>

      <el-table :data="list" v-loading="loading" row-key="id">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="42" :src="resolveImg(row.avatarUrl)">
                {{ (row.nickName || '?').charAt(0) }}
              </el-avatar>
              <div>
                <div class="uname">
                  {{ row.nickName || '未命名用户' }}
                  <span v-if="row.username" class="acc">@{{ row.username }}</span>
                </div>
                <div class="cls">{{ row.className || '—' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="roleMap[row.role]?.type || 'info'" size="small" effect="light">
              {{ roleMap[row.role]?.text || row.role }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="作品数" width="90" align="center">
          <template #default="{ row }">{{ row.workCount ?? 0 }}</template>
        </el-table-column>

        <el-table-column label="获赞" width="90" align="center">
          <template #default="{ row }">{{ row.likeCount ?? 0 }}</template>
        </el-table-column>

        <el-table-column label="注册时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'disabled' ? 'info' : 'success'" size="small" effect="light">
              {{ row.status === 'disabled' ? '已停用' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" align="center" fixed="right">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status !== 'disabled'"
              inline-prompt
              active-text="开"
              inactive-text="停"
              :loading="row._toggling"
              @change="toggle(row)"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.count {
  color: var(--text-sub);
  font-size: 13px;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.uname {
  font-weight: 600;
  color: var(--brand-ink);
}
.acc {
  font-weight: 400;
  font-size: 12px;
  color: var(--text-sub);
}
.cls {
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 2px;
}
</style>
