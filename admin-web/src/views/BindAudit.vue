<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBindApplications, auditBindApplication } from '@/api'
import { fmtTime } from '@/utils/constants'

const loading = ref(false)
const list = ref([])
const tab = ref('pending')

// 后端 GET /admin/bind-applications?status= 支持 pending|approved|rejected|all
const tabs = [
  { key: 'pending', label: '待认定' },
  { key: 'approved', label: '已认定' },
  { key: 'rejected', label: '已驳回' },
  { key: 'all', label: '全部' },
]

async function load() {
  loading.value = true
  try {
    const data = await getBindApplications({ status: tab.value })
    list.value = data?.list || []
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

function onTab(t) {
  tab.value = t
  load()
}

onMounted(load)

/** 展示名：姓名优先（平台已取消「昵称」概念，历史数据未填姓名时退回旧昵称） */
const displayName = (row) => row.realName || row.nickName || '匿名'

// 认定通过
async function onApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认将账号「${displayName(row)}」（学号 ${row.studentId}${row.className ? ' · ' + row.className : ''}）绑定认定？` +
        '通过后该账号即可发布作品与评论。',
      '认定通过',
      { confirmButtonText: '通过认定', cancelButtonText: '取消', type: 'success' }
    )
  } catch {
    return
  }
  try {
    await auditBindApplication(row.id, 'approve')
    ElMessage.success('认定已通过')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

// 驳回
const rejectVisible = ref(false)
const rejectForm = reactive({ id: null, name: '', studentId: '', className: '', reason: '' })

function openReject(row) {
  rejectForm.id = row.id
  rejectForm.name = displayName(row)
  rejectForm.studentId = row.studentId
  rejectForm.className = row.className || ''
  rejectForm.reason = ''
  rejectVisible.value = true
}

async function submitReject() {
  if (!rejectForm.reason.trim()) {
    ElMessage.warning('请填写驳回原因，便于学生修正后重新提交')
    return
  }
  try {
    await auditBindApplication(rejectForm.id, 'reject', rejectForm.reason.trim())
    ElMessage.success('已驳回')
    rejectVisible.value = false
    load()
  } catch {
    /* 拦截器提示 */
  }
}

function statusTag(s) {
  return {
    pending: { type: 'warning', text: '待认定' },
    approved: { type: 'success', text: '已认定' },
    rejected: { type: 'danger', text: '已驳回' },
  }[s] || { type: 'info', text: s }
}
</script>

<template>
  <div>
    <p class="page-sub">
      学生在小程序「我的」页填写学号、姓名、班级提交绑定申请后进入「待认定」；
      审核时可对照账号名 / 姓名 / 学号 / 班级四项是否一致。认定通过的账号才能发布作品与评论，
      驳回将附带原因回传学生端，并释放该学号以便修正后重新提交。
    </p>

    <div class="page-card">
      <div class="toolbar">
        <el-radio-group :model-value="tab" @change="onTab">
          <el-radio-button v-for="t in tabs" :key="t.key" :value="t.key">{{ t.label }}</el-radio-button>
        </el-radio-group>
        <el-button :icon="'Refresh'" circle @click="load" style="margin-left:auto" />
      </div>

      <el-table :data="list" v-loading="loading" style="width: 100%" row-key="id">
        <el-table-column label="账号" min-width="180">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="40" :src="row.avatarUrl" class="u-avatar">
                {{ displayName(row)[0] }}
              </el-avatar>
              <div class="user-meta">
                <div class="user-name" :title="displayName(row)">{{ displayName(row) }}</div>
                <div class="user-sub">作品 {{ row.workCount || 0 }} 件</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="学号" width="140" align="center">
          <template #default="{ row }">
            <span class="sid">{{ row.studentId || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="申请姓名" width="110" align="center">
          <template #default="{ row }">{{ row.realName || '—' }}</template>
        </el-table-column>

        <el-table-column label="班级" min-width="150">
          <template #default="{ row }">
            <span class="class-name">{{ row.className || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.bindStatus).type" size="small" effect="light">
              {{ statusTag(row.bindStatus).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="申请时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.applyTime) }}</template>
        </el-table-column>

        <el-table-column label="认定时间 / 驳回原因" min-width="180">
          <template #default="{ row }">
            <template v-if="row.bindStatus === 'rejected'">
              <span class="reject-mark">驳回：</span>{{ row.rejectReason || '—' }}
            </template>
            <template v-else-if="row.bindStatus === 'approved'">{{ fmtTime(row.auditTime) }}</template>
            <template v-else>—</template>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="row.bindStatus === 'pending'">
              <el-button type="success" size="small" :icon="'CircleCheck'" @click="onApprove(row)">
                通过
              </el-button>
              <el-button type="danger" size="small" :icon="'CircleClose'" @click="openReject(row)">
                驳回
              </el-button>
            </template>
            <span v-else style="color:var(--text-sub);font-size:12px">—</span>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && list.length === 0"
        :description="tab === 'pending' ? '当前没有待认定的账号申请' : '暂无相关记录'"
        :image-size="100"
        style="padding: 40px 0"
      />
    </div>

    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejectVisible" title="驳回绑定申请" width="480px">
      <p class="reject-tip">
        正在驳回账号 <b>{{ rejectForm.name }}</b> 的学号绑定申请（学号 <b>{{ rejectForm.studentId }}</b>{{ rejectForm.className ? ' · ' + rejectForm.className : '' }}），
        请填写原因（将原样展示给学生）：
      </p>
      <el-input
        v-model="rejectForm.reason"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="例如：学号与姓名不匹配 / 学号不存在 / 非本院学生"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.u-avatar {
  flex-shrink: 0;
  background: linear-gradient(135deg, #e8853d, #c84b31);
  color: #fff;
}
.user-meta {
  min-width: 0;
}
.user-name {
  font-weight: 600;
  color: var(--brand-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.user-sub {
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 2px;
}
.sid {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-weight: 600;
  color: #3d5a80;
  letter-spacing: 1px;
}
.class-name {
  color: var(--brand-ink);
}
.reject-mark {
  color: #c84b31;
}
.reject-tip {
  color: var(--text);
}
.reject-tip b {
  color: #c84b31;
}
</style>
