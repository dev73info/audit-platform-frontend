<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { ApiError } from '@/api/http'
import { getOverview } from '@/api/metrics'
import { enableProject } from '@/api/projects'
import type { MetricsOverview } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatDuration, formatNumber, formatPercent } from '@/utils/format'
import type { SemanticTone } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import BarChart from '@/components/charts/BarChart.vue'
import DonutChart from '@/components/charts/DonutChart.vue'
import TrendChart from '@/components/charts/TrendChart.vue'

type RangeKey = '1h' | '6h' | '24h' | '7d'

const REFRESH_INTERVAL_MS = 30_000

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: '1 小时', value: '1h' },
  { label: '6 小时', value: '6h' },
  { label: '24 小时', value: '24h' },
  { label: '7 天', value: '7d' },
]

const auth = useAuthStore()
const projectStore = useProjectStore()
const route = useRoute()
const router = useRouter()

const overview = ref<MetricsOverview | null>(null)
const loading = ref(false)
const range = ref<RangeKey>('24h')
const projectId = ref<number | null>(null)
const autoRefresh = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const canRestore = computed(() => auth.can('project:write'))

/** 选中的项目 ID；清空时为空。 */
const selectedProjectId = computed<number | null>(() =>
  typeof projectId.value === 'number' && projectId.value > 0 ? projectId.value : null,
)

async function load() {
  loading.value = true
  try {
    const payload = await getOverview({
      scope: selectedProjectId.value ? 'project' : 'global',
      id: selectedProjectId.value ?? undefined,
      range: range.value,
    })
    overview.value = payload
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    loading.value = false
  }
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function parseProjectId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function handleProjectChange(raw: number | string | null | undefined) {
  const id = typeof raw === 'number' && raw > 0 ? raw : null
  if (id) projectStore.select(id)
  projectId.value = id
  void router.replace({
    path: route.path,
    query: { ...route.query, project_id: id ?? undefined },
  })
}

async function restoreProject() {
  const project = activeProject.value
  if (!project) return
  try {
    await enableProject(project.id)
    ElMessage.success('项目已恢复')
    await projectStore.loadProjects(true)
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

const metrics = computed(() => {
  const data = overview.value
  const pass = data?.pass ?? 0
  const reject = data?.reject ?? 0
  const review = data?.review ?? 0
  const failed = data?.failed ?? 0
  const total = pass + reject + review + failed
  return {
    taskTotal: data?.task_total ?? 0,
    taskToday: data?.task_today ?? 0,
    passRate: total > 0 ? pass / total : 0,
    actionSuccessRate: data?.action_success_rate ?? 0,
    p50: data?.duration_p50 ?? 0,
    p95: data?.duration_p95 ?? 0,
    review,
    backlog: data?.backlog ?? 0,
    deadLetter: data?.dead_letter ?? 0,
  }
})

const series = computed(() => overview.value?.series ?? [])

const donutItems = computed(() => {
  const data = overview.value
  if (!data) return []
  return [
    { label: '通过', value: data.pass, color: 'var(--ap-color-pass)' },
    { label: '不通过', value: data.reject, color: 'var(--ap-color-reject)' },
    { label: '待议', value: data.review, color: 'var(--ap-color-review)' },
    { label: '失败', value: data.failed, color: 'var(--ap-color-neutral)' },
  ]
})

const projectRows = computed(() => {
  const rows = overview.value?.projects ?? []
  if (!selectedProjectId.value) return rows
  return rows.filter((row) => row.project_id === selectedProjectId.value)
})

const barItems = computed(() =>
  projectRows.value.map((row) => ({ label: row.project_name, value: row.task_total })),
)

const alerts = computed(() => overview.value?.alerts ?? [])

const activeProject = computed(() => {
  if (selectedProjectId.value) {
    return projectStore.projects.find((item) => item.id === selectedProjectId.value) ?? null
  }
  return projectStore.current
})

function healthMeta(health: string): { label: string; tone: SemanticTone } {
  switch (health) {
    case 'HEALTHY':
      return { label: '健康', tone: 'pass' }
    case 'WARNING':
      return { label: '预警', tone: 'review' }
    case 'CRITICAL':
      return { label: '严重', tone: 'reject' }
    default:
      return { label: health, tone: 'neutral' }
  }
}

function levelMeta(level: string): { label: string; tone: SemanticTone } {
  const normalized = level.toUpperCase()
  if (normalized === 'P1' || normalized === 'CRITICAL') return { label: level, tone: 'reject' }
  if (normalized === 'P2' || normalized === 'WARNING') return { label: level, tone: 'review' }
  if (normalized === 'P3' || normalized === 'INFO') return { label: level, tone: 'info' }
  return { label: level, tone: 'neutral' }
}

function alertAdvice(level: string): string {
  const normalized = level.toUpperCase()
  if (normalized === 'P1' || normalized === 'CRITICAL') return '立即排查并恢复'
  if (normalized === 'P2' || normalized === 'WARNING') return '尽快排查处理'
  return '关注并择机处理'
}

function durationSince(value: string | null): string {
  if (!value) return '-'
  const start = new Date(value).getTime()
  if (Number.isNaN(start)) return '-'
  return formatDuration(Math.max(0, Date.now() - start))
}

onMounted(async () => {
  projectId.value = parseProjectId(route.query.project_id)
  try {
    await projectStore.loadProjects()
  } catch {
    // 项目列表加载失败不阻塞看板
  }
  await load()
})

watch([range, selectedProjectId], () => {
  void load()
})

watch(
  () => route.query.project_id,
  (raw) => {
    const next = parseProjectId(raw)
    if (next !== selectedProjectId.value) projectId.value = next
  },
)

watch(autoRefresh, (enabled) => {
  stopTimer()
  if (enabled) timer = setInterval(() => void load(), REFRESH_INTERVAL_MS)
})

onUnmounted(stopTimer)
</script>

<template>
  <div class="ap-page">
    <PageHeader title="监控看板" desc="任务、结论与项目健康度概览">
      <template #actions>
        <el-radio-group v-model="range" size="small">
          <el-radio-button
            v-for="option in RANGE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </el-radio-button>
        </el-radio-group>

        <el-select
          v-model="projectId"
          class="dash__select"
          placeholder="全部项目"
          clearable
          size="small"
          @change="handleProjectChange"
        >
          <el-option
            v-for="item in projectStore.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>

        <div class="dash__refresh">
          <span class="ap-text-aux">自动刷新</span>
          <el-switch v-model="autoRefresh" size="small" />
        </div>
      </template>
    </PageHeader>

    <div v-if="activeProject && activeProject.status === 'PAUSED'" class="dash__notice">
      <span class="dash__notice-text">项目已暂停，任务不再消费</span>
      <el-tooltip :content="canRestore ? '' : '缺少项目编辑权限'" :disabled="canRestore">
        <el-button type="warning" size="small" :disabled="!canRestore" @click="restoreProject">
          恢复
        </el-button>
      </el-tooltip>
    </div>

    <div v-loading="loading" class="dash__body">
      <div class="ap-metrics">
        <div class="ap-metric">
          <div class="ap-metric__label">任务量</div>
          <div class="ap-metric__value">{{ formatNumber(metrics.taskTotal) }}</div>
          <div class="ap-metric__delta">今日 {{ formatNumber(metrics.taskToday) }}</div>
        </div>

        <div class="ap-metric">
          <div class="ap-metric__label">成功率</div>
          <div class="ap-metric__value">{{ formatPercent(metrics.passRate) }}</div>
          <div class="ap-metric__delta">
            动作成功率 {{ formatPercent(metrics.actionSuccessRate) }}
          </div>
        </div>

        <div class="ap-metric">
          <div class="ap-metric__label">平均耗时</div>
          <div class="ap-metric__value">{{ formatDuration(metrics.p50) }}</div>
          <div class="ap-metric__delta">P95 {{ formatDuration(metrics.p95) }}</div>
        </div>

        <div class="ap-metric">
          <div class="ap-metric__label">待议数</div>
          <div class="ap-metric__value">{{ formatNumber(metrics.review) }}</div>
          <div class="ap-metric__delta">待人工复核</div>
        </div>

        <div class="ap-metric">
          <div class="ap-metric__label">积压数</div>
          <div class="ap-metric__value">{{ formatNumber(metrics.backlog) }}</div>
          <div class="ap-metric__delta">队列等待中</div>
        </div>

        <div class="ap-metric">
          <div class="ap-metric__label">死信数</div>
          <div class="ap-metric__value">{{ formatNumber(metrics.deadLetter) }}</div>
          <div class="ap-metric__delta">需人工处理</div>
        </div>
      </div>

      <div class="dash__grid dash__grid--charts">
        <div class="ap-card dash__card dash__card--trend">
          <div class="ap-card__header">
            <h3 class="ap-card__title">任务趋势</h3>
          </div>
          <div class="ap-card__body">
            <TrendChart :series="series" />
          </div>
        </div>

        <div class="ap-card dash__card">
          <div class="ap-card__header">
            <h3 class="ap-card__title">结论分布</h3>
          </div>
          <div class="ap-card__body">
            <DonutChart :items="donutItems" />
          </div>
        </div>

        <div class="ap-card dash__card">
          <div class="ap-card__header">
            <h3 class="ap-card__title">项目任务量</h3>
          </div>
          <div class="ap-card__body">
            <BarChart :items="barItems" />
          </div>
        </div>
      </div>

      <div class="dash__grid dash__grid--bottom">
        <div class="ap-card dash__card">
          <div class="ap-card__header">
            <h3 class="ap-card__title">项目健康度</h3>
          </div>
          <div class="ap-card__body ap-card__body--flush">
            <el-table :data="projectRows" class="ap-table">
              <el-table-column prop="project_name" label="项目" min-width="140" />
              <el-table-column label="任务量" width="110" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ formatNumber(row.task_total) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="积压" width="100" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ formatNumber(row.backlog) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="错误率" width="110" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ formatPercent(row.error_rate) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="MySQL 池水位" width="130" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ formatNumber(row.mysql_pool_in_use) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="健康度" width="100">
                <template #default="{ row }">
                  <StatusTag :label="healthMeta(row.health).label" :tone="healthMeta(row.health).tone" />
                </template>
              </el-table-column>
              <template #empty>
                <EmptyState title="暂无项目数据" />
              </template>
            </el-table>
          </div>
        </div>

        <div class="ap-card dash__card">
          <div class="ap-card__header">
            <h3 class="ap-card__title">告警</h3>
          </div>
          <div class="ap-card__body ap-card__body--flush">
            <el-table :data="alerts" class="ap-table">
              <el-table-column label="级别" width="90">
                <template #default="{ row }">
                  <StatusTag :label="levelMeta(row.level).label" :tone="levelMeta(row.level).tone" />
                </template>
              </el-table-column>
              <el-table-column label="名称" min-width="160">
                <template #default="{ row }">
                  <div class="ap-truncate">{{ row.name }}</div>
                  <div v-if="row.message" class="ap-text-aux ap-truncate">
                    {{ row.message }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="持续时长" width="120" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ durationSince(row.started_at) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="处置建议" min-width="130">
                <template #default="{ row }">
                  {{ alertAdvice(row.level) }}
                </template>
              </el-table-column>
              <template #empty>
                <EmptyState title="暂无告警" />
              </template>
            </el-table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash__select {
  width: 200px;
}

.dash__refresh {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
}

.dash__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-4);
  padding: var(--ap-space-3) var(--ap-space-5);
  border: 1px solid var(--ap-color-review);
  border-radius: var(--ap-radius-card);
  background: var(--ap-color-review-soft);
}

.dash__notice-text {
  color: var(--ap-color-review);
  font-weight: 600;
}

.dash__body {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-4);
  min-height: 120px;
}

.dash__grid {
  display: grid;
  gap: var(--ap-space-4);
}

.dash__grid--charts {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dash__card--trend {
  grid-column: span 2;
}

.dash__grid--bottom {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}

.dash__card {
  min-width: 0;
}

@media (max-width: 1280px) {
  .dash__grid--charts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dash__grid--bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
