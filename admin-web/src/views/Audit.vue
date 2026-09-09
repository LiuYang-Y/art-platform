<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAdminWorks, approveWork, rejectWork } from '@/api'
import { categoryName, fmtTime, resolveImg } from '@/utils/constants'

const loading = ref(false)
const list = ref([])
const tab = ref('pending')

// 后端 GET /admin/works?status= 支持 pending|approved|rejected|all
const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'all', label: '全部' },
]

async function load() {
  loading.value = true
  try {
    const data = await getAdminWorks({ status: tab.value })
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

// 通过
async function onApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认通过作品《${row.title}》？通过后将立即展示在小程序沐光墙。`,
      '审核通过',
      { confirmButtonText: '通过', cancelButtonText: '取消', type: 'success' }
    )
  } catch {
    return
  }
  try {
    await approveWork(row.id)
    ElMessage.success('已通过')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

// 驳回
const rejectVisible = ref(false)
const rejectForm = reactive({ id: null, title: '', reason: '' })

function openReject(row) {
  rejectForm.id = row.id
  rejectForm.title = row.title
  rejectForm.reason = ''
  rejectVisible.value = true
}
async function submitReject() {
  if (!rejectForm.reason.trim()) {
    ElMessage.warning('请填写驳回原因，便于学生修改后重新提交')
    return
  }
  try {
    await rejectWork(rejectForm.id, rejectForm.reason.trim())
    ElMessage.success('已驳回')
    rejectVisible.value = false
    load()
  } catch {
    /* 拦截器提示 */
  }
}

// 状态标签
function statusTag(s) {
  return {
    pending: { type: 'warning', text: '待审核' },
    approved: { type: 'success', text: '已通过' },
    rejected: { type: 'danger', text: '已驳回' },
  }[s] || { type: 'info', text: s }
}
</script>

<template>
  <div>
    <p class="page-sub">学生在小程序发布的作品默认进入「待审核」，此处审批通过后即展示到沐光墙；驳回将附带原因回传学生端。</p>

    <div class="page-card">
      <div class="toolbar">
        <el-radio-group :model-value="tab" @change="onTab">
          <el-radio-button v-for="t in tabs" :key="t.key" :value="t.key">
            {{ t.label }}<template v-if="tab === t.key"></template>
          </el-radio-button>
        </el-radio-group>
        <el-button :icon="'Refresh'" circle @click="load" style="margin-left:auto" />
      </div>

      <el-table :data="list" v-loading="loading" style="width: 100%" row-key="id">
        <el-table-column label="作品" min-width="220">
          <template #default="{ row }">
            <div class="work-cell">
              <el-image
                :src="resolveImg(row.coverUrl)"
                fit="cover"
                class="thumb"
                lazy
                :preview-src-list="row.coverUrl ? [resolveImg(row.coverUrl)] : []"
                preview-teleported
              >
                <template #error>
                  <div class="thumb-err"><el-icon><Picture /></el-icon></div>
                </template>
              </el-image>
              <div class="work-meta">
                <div class="work-title" :title="row.title">{{ row.title }}</div>
                <div class="work-sub">{{ row.authorName || '佚名' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="分类" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ categoryName(row.category) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status).type" size="small" effect="light">
              {{ statusTag(row.status).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>

        <el-table-column label="说明 / 驳回原因" min-width="180">
          <template #default="{ row }">
            <div class="desc" :title="row.rejectReason || row.description">
              <template v-if="row.status === 'rejected'">
                <span class="reject-mark">驳回：</span>{{ row.rejectReason || '—' }}
              </template>
              <template v-else>{{ row.description || '—' }}</template>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'pending'"
              type="success"
              size="small"
              :icon="'CircleCheck'"
              @click="onApprove(row)"
            >
              通过
            </el-button>
            <el-button
              v-if="row.status === 'pending'"
              type="danger"
              size="small"
              :icon="'CircleClose'"
              @click="openReject(row)"
            >
              驳回
            </el-button>
            <span v-else style="color:var(--text-sub);font-size:12px">—</span>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && list.length === 0"
        :description="tab === 'pending' ? '太棒了，当前没有待审核作品' : '暂无相关作品'"
        :image-size="100"
        style="padding: 40px 0"
      />
    </div>

    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejectVisible" title="驳回作品" width="480px">
      <p class="reject-tip">
        正在驳回作品 <b>《{{ rejectForm.title }}》</b>，请填写原因（将原样展示给发布学生，便于其修改重提）：
      </p>
      <el-input
        v-model="rejectForm.reason"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="例如：图片清晰度不足 / 题材与美育主题不符 / 缺少作品说明"
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
.work-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.thumb {
  width: 58px;
  height: 58px;
  border-radius: 8px;
  flex-shrink: 0;
  border: 1px solid var(--border);
}
.thumb-err {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b9c3d1;
  background: #f4f6fa;
}
.work-meta {
  min-width: 0;
}
.work-title {
  font-weight: 600;
  color: var(--brand-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.work-sub {
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 4px;
}
.desc {
  color: var(--text-sub);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
