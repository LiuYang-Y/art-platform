<script setup>
import { onMounted, ref } from 'vue'
import { getStats } from '@/api'

const stats = ref(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await getStats()
  } catch (e) {
    error.value = e?.message || '统计加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 主 KPI
const primaryCards = [
  { key: 'workTotal', label: '作品总数', icon: 'Picture', color: '#3D5A80' },
  { key: 'userTotal', label: '注册用户', icon: 'User', color: '#2E9E6B' },
  { key: 'courseTotal', label: '美育课程', icon: 'Calendar', color: '#E8853D' },
  { key: 'workWeek', label: '近7天新增', icon: 'TrendCharts', color: '#C84B31' },
]

// 审核漏斗
const auditCards = [
  { key: 'workPending', label: '待审核', color: '#E8853D', icon: 'Clock' },
  { key: 'workApproved', label: '已通过', color: '#2E9E6B', icon: 'CircleCheck' },
  { key: 'workRejected', label: '已驳回', color: '#C84B31', icon: 'CircleClose' },
]

const interactionCards = [
  { key: 'likeTotal', label: '累计点赞', icon: 'Star', color: '#C84B31' },
  { key: 'commentTotal', label: '累计留言', icon: 'ChatDotRound', color: '#3D5A80' },
]

function fmt(n) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString()
}
</script>

<template>
  <div>
    <p class="page-sub">平台运营数据总览 · 打通「小程序发布 → Web 审批」双端协同闭环</p>

    <!-- 主 KPI -->
    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="c in primaryCards" :key="c.key" :xs="12" :sm="12" :md="6">
        <div class="kpi-card">
          <div class="kpi-ico" :style="{ background: c.color + '1a', color: c.color }">
            <el-icon :size="24"><component :is="c.icon" /></el-icon>
          </div>
          <div>
            <div class="kpi-num">{{ stats ? fmt(stats[c.key]) : '—' }}</div>
            <div class="kpi-label">{{ c.label }}</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 待办提醒 + 审核漏斗 + 互动 -->
    <el-row :gutter="16" style="margin-top: 16px" v-loading="loading">
      <el-col :xs="24" :md="14">
        <div class="page-card">
          <div class="card-head">
            <h3>待审核提醒</h3>
            <el-tag v-if="stats && stats.workPending" type="warning" effect="dark" round>
              {{ stats.workPending }} 件待审核
            </el-tag>
          </div>
          <div v-if="stats && stats.workPending > 0" class="pending-banner">
            <el-icon class="banner-ico"><Stamp /></el-icon>
            <div>
              有 <b>{{ stats.workPending }}</b> 件学生新作品等待审核，点击前往处理 →
            </div>
            <router-link to="/audit">
              <el-button type="primary" plain>去审核</el-button>
            </router-link>
          </div>
          <el-empty v-else-if="stats" description="暂无待审核作品" :image-size="90" />
          <div v-else-if="!stats && !loading" style="color:#C84B31">{{ error || '数据加载失败' }}</div>
        </div>

        <div class="page-card" style="margin-top: 16px">
          <div class="card-head"><h3>互动生态</h3></div>
          <div class="interact-grid">
            <div v-for="c in interactionCards" :key="c.key" class="interact-item">
              <el-icon :size="22" :style="{ color: c.color }"><component :is="c.icon" /></el-icon>
              <div>
                <div class="i-num">{{ stats ? fmt(stats[c.key]) : '—' }}</div>
                <div class="i-label">{{ c.label }}</div>
              </div>
            </div>
          </div>
        </div>
      </el-col>

      <!-- 审核漏斗 -->
      <el-col :xs="24" :md="10">
        <div class="page-card">
          <div class="card-head"><h3>作品审核状态分布</h3></div>
          <div class="audit-list">
            <div v-for="c in auditCards" :key="c.key" class="audit-row">
              <div class="audit-left">
                <el-icon :size="18" :style="{ color: c.color }"><component :is="c.icon" /></el-icon>
                <span>{{ c.label }}</span>
              </div>
              <el-progress
                :percentage="100"
                :stroke-width="10"
                :show-text="false"
                :color="c.color"
                style="flex:1"
                class="audit-bar"
              />
              <b class="audit-num">{{ stats ? fmt(stats[c.key]) : '—' }}</b>
            </div>
          </div>
          <div class="audit-foot">
            通过率：
            <b>
              {{
                stats && stats.workTotal
                  ? ((stats.workApproved / stats.workTotal) * 100).toFixed(1) + '%'
                  : '—'
              }}
            </b>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.kpi-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--glass-border);
  border-radius: 16px;
  box-shadow: var(--glass-shadow);
  padding: 18px 20px;
  margin-bottom: 16px;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.kpi-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--glass-shadow-float);
}
.kpi-ico {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.kpi-num {
  font-size: 26px;
  font-weight: 700;
  color: var(--brand-ink);
  line-height: 1.1;
}
.kpi-label {
  font-size: 13px;
  color: var(--text-sub);
  margin-top: 2px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.card-head h3 {
  margin: 0;
  font-size: 16px;
  color: var(--brand-ink);
}
.pending-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fdf3ec;
  border: 1px solid #f7dcc5;
  border-radius: 10px;
  padding: 16px;
}
.banner-ico {
  font-size: 26px;
  color: #e8853d;
}
.pending-banner b {
  color: #c84b31;
  font-size: 18px;
}
.pending-banner .el-button {
  margin-left: auto;
}
.interact-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.interact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.50);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 12px;
  padding: 14px 16px;
}
.i-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--brand-ink);
}
.i-label {
  font-size: 12px;
  color: var(--text-sub);
}
.audit-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.audit-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.audit-left {
  width: 96px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}
.audit-left span {
  font-size: 13px;
}
.audit-num {
  min-width: 26px;
  text-align: right;
  color: var(--brand-ink);
}
.audit-foot {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
  color: var(--text-sub);
  font-size: 13px;
  text-align: right;
}
.audit-foot b {
  color: #2e9e6b;
  font-size: 16px;
}
</style>
