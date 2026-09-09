<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  addSensitiveWord,
  deleteSensitiveWords,
  getSensitiveCategories,
  getSensitiveWords,
  resetSensitiveWords,
  updateSensitiveWord,
} from '@/api'
import { fmtTime } from '@/utils/constants'

const loading = ref(false)
const list = ref([])
const cats = ref({ total: 0, enabled: 0 })
const catTab = ref('all')
const keyword = ref('')

const CAT_TABS = [
  { key: 'all', label: '全部' },
  { key: 'violation', label: '政治违禁' },
  { key: 'abuse', label: '不雅攻击' },
  { key: 'advert', label: '广告引流' },
  { key: 'other', label: '其他' },
]

async function load(keepCat = true) {
  loading.value = true
  try {
    const data = await getSensitiveWords({
      category: catTab.value === 'all' ? '' : catTab.value,
      keyword: keyword.value.trim() || undefined,
    })
    list.value = data?.list || []
    const c = await getSensitiveCategories()
    cats.value = c?.categories || {}
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

function onCat(k) {
  catTab.value = k
  load()
}
function onSearch() {
  load()
}

/* 新增词 */
const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive({ id: null, word: '', category: 'other', remark: '', enabled: true })
const rules = {
  word: [{ required: true, message: '请输入敏感词', trigger: 'blur' }],
}

function openAdd() {
  isEdit.value = false
  Object.assign(form, { id: null, word: '', category: 'other', remark: '', enabled: true })
  dialogVisible.value = true
}
function openEdit(row) {
  isEdit.value = true
  Object.assign(form, {
    id: row.id,
    word: row.word,
    category: row.category || 'other',
    remark: row.remark || '',
    enabled: row.enabled !== false,
  })
  dialogVisible.value = true
}

async function submit() {
  await formRef.value.validate().catch(() => Promise.reject())
  saving.value = true
  try {
    if (isEdit.value) {
      await updateSensitiveWord({
        id: form.id,
        word: form.word.trim(),
        category: form.category,
        remark: form.remark,
        enabled: form.enabled,
      })
      ElMessage.success('已更新并即时生效')
    } else {
      await addSensitiveWord({
        word: form.word.trim(),
        category: form.category,
        remark: form.remark,
      })
      ElMessage.success('已添加并即时生效')
    }
    dialogVisible.value = false
    load()
  } catch {
    /* 拦截器提示 */
  } finally {
    saving.value = false
  }
}

async function onToggle(row) {
  try {
    await updateSensitiveWord({ id: row.id, enabled: row.enabled })
    ElMessage.success(row.enabled ? '已启用（将参与拦截）' : '已停用（不再拦截）')
    load()
  } catch {
    row.enabled = !row.enabled // 回滚开关
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除敏感词「${row.word}」？删除后该词将不再拦截。`, '删除敏感词', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteSensitiveWords([row.id])
    ElMessage.success('已删除并即时生效')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

async function onBatchDelete() {
  const sel = selection.value.map((r) => r.id)
  if (!sel.length) return ElMessage.warning('请先勾选要删除的词条')
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${sel.length} 条敏感词？`, '批量删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteSensitiveWords(sel)
    ElMessage.success('已删除并即时生效')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

async function onReset() {
  try {
    await ElMessageBox.confirm('将词库重置为内置默认词表（清空现有并重新灌入默认 42 词），确认继续？', '重置词库', {
      confirmButtonText: '重置',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await resetSensitiveWords()
    ElMessage.success('已重置为默认词表')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

const selection = ref([])
const catColor = { violation: '#C84B31', abuse: '#E8853D', advert: '#3D5A80', other: '#6B7684' }
function catName(k) {
  return CAT_TABS.find((t) => t.key === k)?.label || '其他'
}
</script>

<template>
  <div>
    <p class="page-sub">
      全站内容安全词库（对齐 4.2(3) / G-06）。作品标题、简介、评论、回复提交时命中词即阻断。
      当前启用 <b style="color:#2E9E6B">{{ cats.enabled ?? 0 }}</b> / <b>{{ cats.total ?? 0 }}</b> 条，改动即时生效。
    </p>

    <div class="page-card">
      <div class="toolbar">
        <el-radio-group :model-value="catTab" @change="onCat">
          <el-radio-button v-for="t in CAT_TABS" :key="t.key" :value="t.key">
            {{ t.label }}
            <template v-if="t.key !== 'all'">({{ cats[t.key] ?? 0 }})</template>
          </el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          placeholder="搜索敏感词"
          :prefix-icon="'Search'"
          clearable
          style="width: 200px"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-button type="primary" :icon="'Plus'" @click="openAdd">新增敏感词</el-button>
        <el-button type="danger" plain :icon="'Delete'" @click="onBatchDelete">批量删除</el-button>
        <el-button :icon="'RefreshLeft'" @click="onReset" style="margin-left:auto">重置默认词表</el-button>
      </div>

      <el-table :data="list" v-loading="loading" row-key="id" @selection-change="(s) => (selection = s)">
        <el-table-column type="selection" width="44" />
        <el-table-column label="敏感词" min-width="160">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'danger' : 'info'" effect="dark" size="large">
              {{ row.word }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="110" align="center">
          <template #default="{ row }">
            <el-tag :color="catColor[row.category] || '#6B7684'" style="color:#fff;border:none" size="small">
              {{ catName(row.category) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="160">
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="onToggle(row)" inline-prompt active-text="拦" inactive-text="停" />
          </template>
        </el-table-column>
        <el-table-column label="添加时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="'Edit'" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="'Delete'" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!loading && list.length === 0" class="empty-hint">
        <el-empty description="该分类下暂无敏感词" :image-size="90" />
      </div>
    </div>

    <!-- 新增 / 编辑抽屉 -->
    <el-drawer v-model="dialogVisible" :title="isEdit ? '编辑敏感词' : '新增敏感词'" size="420px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="70px">
        <el-form-item label="敏感词" prop="word">
          <el-input v-model="form.word" placeholder="如：代购、刷单" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" style="width: 100%">
            <el-option v-for="t in CAT_TABS.slice(1)" :key="t.key" :label="t.label" :value="t.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="可选，说明该词类别/来源" />
        </el-form-item>
        <el-form-item v-if="isEdit" label="是否启用">
          <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">{{ isEdit ? '保存' : '新增' }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.empty-hint {
  padding: 10px 0;
}
</style>
