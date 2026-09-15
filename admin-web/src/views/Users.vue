<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAdminUsers, getAdminClasses, updateAdminUser, setUserStatus } from '@/api'
import { fmtTime, resolveImg } from '@/utils/constants'

const loading = ref(false)
const allUsers = ref([])
const keyword = ref('')

/** 已有班级（仅用于输入时的联想建议，不限制自由输入） */
const classes = ref([])

/** 展示名：姓名优先，历史数据未填姓名时退回旧昵称 */
const displayName = (row) => row.realName || row.nickName || '未命名用户'

const keywordList = computed(() => allUsers.value)
const list = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return keywordList.value
  return keywordList.value.filter(
    (u) =>
      (u.nickName || '').toLowerCase().includes(kw) ||
      (u.realName || '').toLowerCase().includes(kw) ||
      (u.username || '').toLowerCase().includes(kw) ||
      (u.studentId || '').toLowerCase().includes(kw) ||
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

async function loadClasses() {
  try {
    const data = await getAdminClasses()
    classes.value = data?.list || []
  } catch {
    classes.value = []
  }
}

onMounted(() => {
  load()
  loadClasses()
})

/* ---------------- 编辑用户资料 ---------------- */

const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref(null)
const editing = ref(null)

const form = reactive({
  realName: '',
  className: '',
})

const rules = {
  realName: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 30, message: '姓名最长 30 个字符', trigger: 'blur' },
  ],
}

/**
 * 班级输入联想：已有班级做候选，但允许直接输入任意新班级名
 * （后端遇不存在的班级会自动创建，无需先去别处建班级）
 */
function queryClassName(queryStr, cb) {
  const kw = (queryStr || '').trim().toLowerCase()
  const src = kw ? classes.value.filter((c) => (c.className || '').toLowerCase().includes(kw)) : classes.value
  cb(
    src.slice(0, 30).map((c) => ({
      value: c.className,
      sub: [c.collegeName, c.majorName, c.gradeYear].filter(Boolean).join(' · '),
    }))
  )
}

function openEdit(row) {
  editing.value = row
  form.realName = row.realName || row.nickName || ''
  form.className = row.className || ''
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

async function submitEdit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  const original = editing.value || {}
  const payload = { userId: original.id }

  const nextName = form.realName.trim()
  const nextClass = (form.className || '').trim()
  const originName = original.realName || original.nickName || ''
  const originClass = original.className || ''

  if (nextName !== originName) payload.realName = nextName
  if (nextClass !== originClass) payload.className = nextClass

  if (Object.keys(payload).length === 1) {
    ElMessage.info('资料没有变化')
    return
  }

  saving.value = true
  try {
    await updateAdminUser(payload)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    load()
    loadClasses()
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false
  }
}

/* ---------------- 启用 / 停用 ---------------- */

async function toggle(row) {
  const toDisable = row.status !== 'disabled'
  const actionText = toDisable ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(
      `确认${actionText}用户「${displayName(row)}」？${toDisable ? '停用后该用户将无法登录小程序。' : ''}`,
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
    <p class="page-sub">平台用户（学生 / 教师 / 管理员）管理，可修改姓名与班级，也可停用违规账号。</p>

    <div class="page-card">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索姓名 / 账号 / 学号 / 班级"
          :prefix-icon="'Search'"
          clearable
          style="width: 300px"
        />
        <span class="count">共 {{ list.length }} 人</span>
        <el-button :icon="'Refresh'" circle @click="load" style="margin-left:auto" />
      </div>

      <el-table :data="list" v-loading="loading" row-key="id">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="42" :src="resolveImg(row.avatarUrl)">
                {{ displayName(row).charAt(0) }}
              </el-avatar>
              <div>
                <div class="uname">
                  {{ displayName(row) }}
                  <span v-if="row.username" class="acc">@{{ row.username }}</span>
                </div>
                <div class="cls">{{ row.className || '未分配班级' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="学号 / 认定" min-width="160">
          <template #default="{ row }">
            <div class="real">{{ row.studentId || '未绑定学号' }}</div>
            <el-tag
              :type="row.bindStatus === 'approved' ? 'success' : row.bindStatus === 'pending' ? 'warning' : row.bindStatus === 'rejected' ? 'danger' : 'info'"
              size="small"
              effect="light"
            >
              {{ { approved: '已认定', pending: '待认定', rejected: '已驳回' }[row.bindStatus] || '未申请' }}
            </el-tag>
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

        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="'EditPen'" @click="openEdit(row)">编辑</el-button>
            <el-switch
              :model-value="row.status !== 'disabled'"
              inline-prompt
              active-text="开"
              inactive-text="停"
              style="margin-left: 10px"
              @change="toggle(row)"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 编辑用户资料 -->
    <el-dialog v-model="dialogVisible" title="修改用户资料" width="460px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="72px">
        <el-form-item label="账号">
          <span class="ro-account">
            {{ editing ? displayName(editing) : '' }}
            <template v-if="editing?.username">（@{{ editing.username }}）</template>
            <template v-if="editing?.studentId">· 学号 {{ editing.studentId }}</template>
          </span>
        </el-form-item>

        <el-form-item label="姓名" prop="realName">
          <el-input v-model="form.realName" placeholder="请输入真实姓名（平台展示名）" maxlength="30" show-word-limit clearable />
        </el-form-item>

        <el-form-item label="班级">
          <el-autocomplete
            v-model="form.className"
            :fetch-suggestions="queryClassName"
            placeholder="直接输入班级，如 视觉传达2201班"
            clearable
            style="width: 100%"
          >
            <template #default="{ item }">
              <div class="sug-row">
                <span>{{ item.value }}</span>
                <span v-if="item.sub" class="sug-sub">{{ item.sub }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>

        <p class="hint">
          姓名即平台展示名，修改后该用户已发布作品上的作者名会同步更新；<br />
          班级可直接输入任意名称，输入不存在的班级会自动创建，清空表示不归属任何班级。
        </p>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
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
.cls,
.sid {
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 2px;
}
.real {
  color: var(--brand-ink);
  margin-bottom: 4px;
}
.ro-account {
  color: var(--text-sub);
}
.sug-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sug-sub {
  color: var(--text-sub);
  font-size: 12px;
}
.hint {
  margin: 4px 0 0 72px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-sub);
}
</style>
