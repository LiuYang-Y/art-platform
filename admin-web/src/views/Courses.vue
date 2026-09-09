<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createCourse, deleteCourse, getCourses, updateCourse } from '@/api'
import { categoryName, COURSE_STATUS_MAP, CATEGORY_KEYS, fmtTime } from '@/utils/constants'

const loading = ref(false)
const list = ref([])
const tab = ref('all')
const tabs = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'closed', label: '已结束' },
]

async function load() {
  loading.value = true
  try {
    const data = await getCourses({ status: tab.value, limit: 100 })
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

// ------- 新增 / 编辑 -------
const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive({
  id: null,
  courseName: '',
  teacherName: '',
  location: '',
  classTime: '',
  weeklyInfo: '',
  category: 'painting',
  description: '',
  status: 'active',
})

const rules = {
  courseName: [{ required: true, message: '请输入课程名称', trigger: 'blur' }],
  teacherName: [{ required: true, message: '请输入授课教师', trigger: 'blur' }],
}

function openCreate() {
  isEdit.value = false
  Object.assign(form, {
    id: null,
    courseName: '',
    teacherName: '',
    location: '',
    classTime: '',
    weeklyInfo: '',
    category: 'painting',
    description: '',
    status: 'active',
  })
  dialogVisible.value = true
}
function openEdit(row) {
  isEdit.value = true
  Object.assign(form, {
    id: row.id,
    courseName: row.courseName,
    teacherName: row.teacherName,
    location: row.location || '',
    classTime: row.classTime || '',
    weeklyInfo: row.weeklyInfo || '',
    category: row.category || 'other',
    description: row.description || '',
    status: row.status || 'active',
  })
  dialogVisible.value = true
}

async function submit() {
  await formRef.value.validate().catch(() => Promise.reject())
  saving.value = true
  try {
    const payload = {
      courseName: form.courseName.trim(),
      teacherName: form.teacherName.trim(),
      location: form.location,
      classTime: form.classTime,
      weeklyInfo: form.weeklyInfo,
      category: form.category,
      description: form.description,
      status: form.status,
    }
    if (isEdit.value) {
      await updateCourse({ id: form.id, ...payload })
      ElMessage.success('已更新课程')
    } else {
      await createCourse(payload)
      ElMessage.success('已创建课程')
    }
    dialogVisible.value = false
    load()
  } catch {
    /* 拦截器提示 */
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除课程《${row.courseName}》？删除后小程序课程表将不再展示。`,
      '删除课程',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await deleteCourse(row.id)
    ElMessage.success('已删除')
    load()
  } catch {
    /* 拦截器提示 */
  }
}

async function toggleStatus(row) {
  const next = row.status === 'active' ? 'closed' : 'active'
  try {
    await updateCourse({ id: row.id, status: next })
    ElMessage.success(next === 'active' ? '已设为进行中' : '已结束')
    load()
  } catch {
    /* 拦截器提示 */
  }
}
</script>

<template>
  <div>
    <p class="page-sub">管理小程序「课程表」页的课程内容，支持分类、时间地点、周次信息。</p>

    <div class="page-card">
      <div class="toolbar">
        <el-radio-group :model-value="tab" @change="onTab">
          <el-radio-button v-for="t in tabs" :key="t.key" :value="t.key">{{ t.label }}</el-radio-button>
        </el-radio-group>
        <el-button
          type="primary"
          :icon="'Plus'"
          style="margin-left: auto"
          @click="openCreate"
        >新增课程</el-button>
      </div>

      <el-table :data="list" v-loading="loading" row-key="id">
        <el-table-column label="课程" min-width="200">
          <template #default="{ row }">
            <div class="cname">{{ row.courseName }}</div>
            <div class="cteacher">{{ row.teacherName }}</div>
          </template>
        </el-table-column>

        <el-table-column label="分类" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ categoryName(row.category) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="时间地点" min-width="180">
          <template #default="{ row }">
            <div class="c-sub">{{ row.classTime || '—' }}</div>
            <div class="c-sub">{{ row.location || '—' }}</div>
          </template>
        </el-table-column>

        <el-table-column label="周次" min-width="150">
          <template #default="{ row }">{{ row.weeklyInfo || '—' }}</template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small" effect="light">
              {{ COURSE_STATUS_MAP[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="'Edit'" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="warning" plain @click="toggleStatus(row)">
              {{ row.status === 'active' ? '结课' : '启用' }}
            </el-button>
            <el-button size="small" type="danger" plain :icon="'Delete'" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && list.length === 0" description="暂无课程" :image-size="100" style="padding:40px 0" />
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑课程' : '新增课程'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="84px">
        <el-form-item label="课程名称" prop="courseName">
          <el-input v-model="form.courseName" placeholder="如：中国书法赏析" maxlength="50" />
        </el-form-item>
        <el-form-item label="授课教师" prop="teacherName">
          <el-input v-model="form.teacherName" placeholder="如：丛晓岚 老师" maxlength="30" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" style="width:100%">
            <el-option v-for="k in CATEGORY_KEYS" :key="k" :label="categoryName(k)" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="上课时间">
          <el-input v-model="form.classTime" placeholder="如：周一 14:00-15:30" maxlength="50" />
        </el-form-item>
        <el-form-item label="上课地点">
          <el-input v-model="form.location" placeholder="如：艺术楼 A201" maxlength="50" />
        </el-form-item>
        <el-form-item label="周次">
          <el-input v-model="form.weeklyInfo" placeholder="如：第 1-16 周" maxlength="50" />
        </el-form-item>
        <el-form-item label="课程简介">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="300" show-word-limit placeholder="课程内容简介（选填）" />
        </el-form-item>
        <el-form-item label="状态" v-if="isEdit">
          <el-radio-group v-model="form.status">
            <el-radio value="active">进行中</el-radio>
            <el-radio value="closed">已结束</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">{{ isEdit ? '保存' : '创建' }}</el-button>
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
.cname {
  font-weight: 600;
  color: var(--brand-ink);
}
.cteacher {
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 3px;
}
.c-sub {
  font-size: 13px;
  color: var(--text-sub);
}
</style>
