<script setup>
/**
 * 学生创作台（网页端）
 * ------------------------------------------------------------
 * 面向学生 / 教师角色：网页端登录后即可上传作品、AI 润色简介、
 * 提交审核并追踪自己的作品状态（与小程序端共用同一后端与审核闭环）。
 *   - 发布：POST /api/work/upload（逐图）→ POST /api/work/create（置 pending）
 *   - 追踪：GET  /api/work/mine（含驳回原因）
 *   - 辅助：POST /api/ai/polish（80~150 字简介润色）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import {
  aiPolish,
  createWork,
  getMyWorks,
  getWorkCategories,
  uploadWorkImage,
} from '@/api'
import { STATUS_MAP, categoryName, fmtTime, resolveImg } from '@/utils/constants'

const auth = useAuthStore()

const MAX_IMAGES = 9
const LONG_EDGE_LIMIT = 1920
const SIZE_LIMIT = 500 * 1024

const categories = ref([])
const uploading = ref(false)
const submitting = ref(false)
const polishing = ref(false)
const loadingList = ref(false)
const myWorks = ref([])

const form = reactive({
  title: '',
  category: '',
  description: '',
  images: [],
})

const statusType = { pending: 'warning', approved: 'success', rejected: 'danger' }
const canSubmit = computed(
  () => form.title.trim() && form.category && form.images.length > 0 && !submitting.value,
)

/* ---------------- 图片压缩与上传 ---------------- */
/** 长边 >1920px 或 >500KB 时等比压缩为 jpeg（对齐 Z-03 客户端压缩约定） */
function compressImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const maxEdge = Math.max(img.width, img.height)
      if (maxEdge <= LONG_EDGE_LIMIT && file.size <= SIZE_LIMIT) {
        URL.revokeObjectURL(url)
        resolve(file)
        return
      }
      const ratio = Math.min(1, LONG_EDGE_LIMIT / maxEdge)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url)
          resolve(blob ? new File([blob], 'upload.jpg', { type: 'image/jpeg' }) : file)
        },
        'image/jpeg',
        0.82,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

async function doUpload(opt) {
  if (form.images.length >= MAX_IMAGES) {
    ElMessage.warning(`最多上传 ${MAX_IMAGES} 张图片`)
    return
  }
  uploading.value = true
  try {
    const file = await compressImage(opt.file)
    const fd = new FormData()
    fd.append('file', file)
    const res = await uploadWorkImage(fd)
    form.images.push(res.url)
    opt.onSuccess?.(res)
  } catch (e) {
    opt.onError?.(e)
  } finally {
    uploading.value = false
  }
}

function removeImage(idx) {
  form.images.splice(idx, 1)
}

/* ---------------- AI 润色（Z-04） ---------------- */
async function onPolish() {
  const keyword = form.title.trim() || form.description.trim()
  if (!keyword) {
    ElMessage.warning('请先填写标题或创作关键词，再使用 AI 润色')
    return
  }
  polishing.value = true
  try {
    const res = await aiPolish({ keyword, category: form.category, text: form.description })
    form.description = res.text
    ElMessage.success('已生成简介，可继续编辑')
  } catch {
    // 拦截器已提示
  } finally {
    polishing.value = false
  }
}

/* ---------------- 提交与列表 ---------------- */
async function onSubmit() {
  if (!form.title.trim()) return ElMessage.warning('请填写作品标题')
  if (!form.category) return ElMessage.warning('请选择作品分类')
  if (!form.images.length) return ElMessage.warning('请至少上传一张作品图片')

  submitting.value = true
  try {
    await createWork({
      title: form.title.trim(),
      category: form.category,
      description: form.description,
      images: [...form.images],
    })
    ElMessage.success('发布成功，等待管理员审核')
    resetForm()
    loadMyWorks()
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.title = ''
  form.category = ''
  form.description = ''
  form.images = []
}

async function loadCategories() {
  try {
    categories.value = (await getWorkCategories()).filter((c) => c.key !== 'all')
  } catch {
    categories.value = []
  }
}

async function loadMyWorks() {
  loadingList.value = true
  try {
    myWorks.value = (await getMyWorks()).list || []
  } catch {
    myWorks.value = []
  } finally {
    loadingList.value = false
  }
}

onMounted(() => {
  loadCategories()
  loadMyWorks()
})
</script>

<template>
  <div class="studio">
    <el-card shadow="never" class="panel">
      <template #header>
        <div class="panel-head">
          <span class="panel-title">发布新作品</span>
          <span class="panel-sub">
            提交后进入「待审核」，管理员通过后展示在沐光墙（先审后发）
          </span>
        </div>
      </template>

      <el-form label-width="86px" label-position="left">
        <el-form-item label="作品图片" required>
          <div class="pic-grid">
            <div v-for="(url, idx) in form.images" :key="url" class="pic-item">
              <img :src="resolveImg(url)" alt="作品图" />
              <span v-if="idx === 0" class="cover-flag">封面</span>
              <button class="pic-del" type="button" @click="removeImage(idx)">×</button>
            </div>

            <el-upload
              v-if="form.images.length < MAX_IMAGES"
              class="pic-add"
              :show-file-list="false"
              accept="image/*"
              multiple
              :http-request="doUpload"
            >
              <div class="pic-add-inner" v-loading="uploading">
                <span class="plus">+</span>
                <span class="hint">{{ form.images.length }}/{{ MAX_IMAGES }}</span>
              </div>
            </el-upload>
          </div>
        </el-form-item>

        <el-form-item label="作品标题" required>
          <el-input v-model="form.title" maxlength="50" show-word-limit placeholder="如：楷书《沁园春·雪》节选" />
        </el-form-item>

        <el-form-item label="作品分类" required>
          <el-select v-model="form.category" placeholder="请选择分类" style="width: 220px">
            <el-option v-for="c in categories" :key="c.key" :label="c.name" :value="c.key" />
          </el-select>
        </el-form-item>

        <el-form-item label="创作说明">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
            maxlength="300"
            show-word-limit
            placeholder="填写创作思路、技法或心得；也可用右侧 AI 润色自动生成"
          />
          <el-button class="polish-btn" :loading="polishing" @click="onPolish">
            ✦ AI 润色简介
          </el-button>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="onSubmit">
            提交审核
          </el-button>
          <el-button @click="resetForm">清空</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="panel">
      <template #header>
        <div class="panel-head">
          <span class="panel-title">我的作品</span>
          <div class="head-right">
            <span class="panel-sub">共 {{ myWorks.length }} 件 · {{ auth.displayName }}</span>
            <el-button text :icon="'Refresh'" @click="loadMyWorks">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loadingList" :data="myWorks" stripe>
        <el-table-column label="封面" width="96">
          <template #default="{ row }">
            <el-image
              class="cover"
              :src="resolveImg(row.coverUrl)"
              :preview-src-list="[resolveImg(row.coverUrl)]"
              fit="cover"
              preview-teleported
            />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column label="分类" width="100">
          <template #default="{ row }">{{ categoryName(row.category) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status] || 'info'" effect="light">
              {{ STATUS_MAP[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="驳回原因" min-width="160">
          <template #default="{ row }">
            <span v-if="row.status === 'rejected'" class="reject">{{ row.rejectReason || '—' }}</span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="点赞 / 留言" width="110">
          <template #default="{ row }">{{ row.likeCount }} / {{ row.commentCount }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有提交过作品，先在左侧发布一件吧" />
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  border-radius: 12px;
  border: 1px solid var(--border);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--brand-ink);
}
.panel-sub {
  font-size: 12px;
  color: var(--text-sub);
}
.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 图片九宫格 */
.pic-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pic-item {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.pic-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-flag {
  position: absolute;
  left: 0;
  bottom: 0;
  padding: 1px 6px;
  font-size: 11px;
  color: #fff;
  background: rgba(200, 75, 49, 0.86);
  border-top-right-radius: 6px;
}
.pic-del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  line-height: 16px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
}
.pic-add-inner {
  width: 96px;
  height: 96px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-sub);
  transition: border-color 0.2s;
}
.pic-add-inner:hover {
  border-color: #3d5a80;
}
.plus {
  font-size: 22px;
  line-height: 1;
}
.hint {
  font-size: 11px;
  margin-top: 4px;
}
.polish-btn {
  margin-top: 8px;
}
.reject {
  color: #c84b31;
}
.dim {
  color: var(--text-sub);
}
.cover {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  display: block;
}
</style>
