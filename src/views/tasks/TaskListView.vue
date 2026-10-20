<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { listAudits } from '@/api/audits'
import { ApiError } from '@/api/http'
import {
  batchRetryTasks,
  exportTasks,
  listTasks,
  retryTask,
  stopTask,
  type TaskListParams,
} from '@/api/tasks'
import type { AuditItem, DedupeFlag, TaskItem, TaskResult, TaskStatus, TriggerType } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatDateTime, formatDuration, formatNumber } from '@/utils/format'
import {
  dedupeFlagMeta,
  mediaTypeLabel,
  resultMeta,
  sourceTypeLabel,
  taskStatusMeta,
} from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import FilterChips from '@/components/FilterChips.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 排序白名单：不在白名单内的列头置灰。 */
const SORTABLE_FIELDS = ['created_at', 'finished_at', 'duration_ms', 'result', 'status']

/** 批量重试单次上限。 */
const BATCH_MAX = 100

/** 运行中的任务状态。 */
const RUNNING_STATUSES: TaskStatus[] = [
  'RECEIVED',
  'LOCKED',
  'QUEUED',
  'WAITING_QUOTA',
  'PROCESSING',
  'RULE_EVALUATING',
  'MEDIA_REVIEWING',
  'ROUTING',
]

const SOURCE_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: 'REDIS', label: sourceTypeLabel('REDIS') },
  { value: 'POLLING', label: sourceTypeLabel('POLLING') },
  { value: 'WEBSOCKET', label: sourceTypeLabel('WEBSOCKET') },
  { value: 'OPENAPI', label: sourceTypeLabel('OPENAPI') },
]

const MEDIA_TYPE_OPTIONS = ['text', 'image', 'video', 'audio', 'mixed'].map((value) => ({
  value,
  label: mediaTypeLabel(value),
}))

const RESULT_OPTIONS: Array<{ value: TaskResult; label: string }> = [
  { value: 'PASS', label: resultMeta('PASS').label },
  { value: 'REJECT', label: resultMeta('REJECT').label },
  { value: 'REVIEW', label: resultMeta('REVIEW').label },
  { value: 'UNKNOWN', label: resultMeta('UNKNOWN').label },
]

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'RECEIVED', label: taskStatusMeta('RECEIVED').label },
  { value: 'LOCKED', label: taskStatusMeta('LOCKED').label },
  { value: 'QUEUED', label: taskStatusMeta('QUEUED').label },
  { value: 'WAITING_QUOTA', label: taskStatusMeta('WAITING_QUOTA').label },
  { value: 'PROCESSING', label: taskStatusMeta('PROCESSING').label },
  { value: 'RULE_EVALUATING', label: taskStatusMeta('RULE_EVALUATING').label },
  { value: 'MEDIA_REVIEWING', label: taskStatusMeta('MEDIA_REVIEWING').label },
  { value: 'ROUTING', label: taskStatusMeta('ROUTING').label },
  { value: 'REVIEW_PENDING', label: taskStatusMeta('REVIEW_PENDING').label },
  { value: 'SUCCESS', label: taskStatusMeta('SUCCESS').label },
  { value: 'FAILED', label: taskStatusMeta('FAILED').label },
  { value: 'DUPLICATED', label: taskStatusMeta('DUPLICATED').label },
  { value: 'DEAD_LETTER', label: taskStatusMeta('DEAD_LETTER').label },
]

const DEDUPE_OPTIONS: Array<{ value: DedupeFlag; label: string }> = [
  { value: 'NORMAL', label: dedupeFlagMeta('NORMAL').label },
  { value: 'DUPLICATED', label: dedupeFlagMeta('DUPLICATED').label },
  { value: 'NO_DEDUPE', label: dedupeFlagMeta('NO_DEDUPE').label },
]

const router = useRouter()
const auth = useAuthStore()
const projectStore = useProjectStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: [
    'project_id',
    'audit_id',
    'source_type',
    'media_type',
    'result',
    'status',
    'dedupe_flag',
    'duration_min',
    'duration_max',
    'created_at_from',
    'created_at_to',
  ],
  defaultPageSize: 20,
})

function toTaskParams(params: Record<string, unknown>): TaskListParams {
  const out: TaskListParams = { page: 1, page_size: 20 }
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

const table = useTableLoader<TaskItem>(async (params) => {
  const payload = await listTasks(toTaskParams(params))
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 筛选 ---------------- */

const keywordInput = ref('')
const projectId = ref(0)
const auditId = ref(0)
const sourceTypeFilter = ref<string[]>([])
const mediaTypeFilter = ref<string[]>([])
const resultFilter = ref<TaskResult[]>([])
const statusFilter = ref<TaskStatus[]>([])
const dedupeFilter = ref<DedupeFlag[]>([])
const durationMin = ref<number | undefined>(undefined)
const durationMax = ref<number | undefined>(undefined)
const dateRange = ref<[string, string] | null>(null)
const audits = ref<AuditItem[]>([])

function filterValue(key: string): string {
  return query.filters[key] ?? ''
}

function splitFilter(key: string): string[] {
  const value = filterValue(key)
  return value ? value.split(',').filter((item) => item !== '') : []
}

watch(
  () => query.keyword.value,
  (value) => {
    keywordInput.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('project_id'),
  (value) => {
    const raw = Number(value)
    projectId.value = Number.isFinite(raw) && raw > 0 ? raw : 0
  },
  { immediate: true },
)
watch(
  () => filterValue('audit_id'),
  (value) => {
    const raw = Number(value)
    auditId.value = Number.isFinite(raw) && raw > 0 ? raw : 0
  },
  { immediate: true },
)
watch(
  () => filterValue('source_type'),
  () => {
    sourceTypeFilter.value = splitFilter('source_type')
  },
  { immediate: true },
)
watch(
  () => filterValue('media_type'),
  () => {
    mediaTypeFilter.value = splitFilter('media_type')
  },
  { immediate: true },
)
watch(
  () => filterValue('result'),
  () => {
    resultFilter.value = splitFilter('result') as TaskResult[]
  },
  { immediate: true },
)
watch(
  () => filterValue('status'),
  () => {
    statusFilter.value = splitFilter('status') as TaskStatus[]
  },
  { immediate: true },
)
watch(
  () => filterValue('dedupe_flag'),
  () => {
    dedupeFilter.value = splitFilter('dedupe_flag') as DedupeFlag[]
  },
  { immediate: true },
)
watch(
  () => filterValue('duration_min'),
  (value) => {
    const raw = Number(value)
    durationMin.value = value && Number.isFinite(raw) ? raw : undefined
  },
  { immediate: true },
)
watch(
  () => filterValue('duration_max'),
  (value) => {
    const raw = Number(value)
    durationMax.value = value && Number.isFinite(raw) ? raw : undefined
  },
  { immediate: true },
)
watch(
  () => `${filterValue('created_at_from')}|${filterValue('created_at_to')}`,
  () => {
    const from = filterValue('created_at_from')
    const to = filterValue('created_at_to')
    dateRange.value = from && to ? [from, to] : null
  },
  { immediate: true },
)

function applyKeyword() {
  query.setKeyword(keywordInput.value.trim())
}

function applyProject(value: number) {
  query.setFilter('project_id', value > 0 ? String(value) : '')
}

function applyAudit(value: number) {
  query.setFilter('audit_id', value > 0 ? String(value) : '')
}

function applySourceTypes(value: string[]) {
  sourceTypeFilter.value = value
  query.setFilter('source_type', value.join(','))
}

function applyMediaTypes(value: string[]) {
  mediaTypeFilter.value = value
  query.setFilter('media_type', value.join(','))
}

function applyResults(value: TaskResult[]) {
  resultFilter.value = value
  query.setFilter('result', value.join(','))
}

function applyStatuses(value: TaskStatus[]) {
  statusFilter.value = value
  query.setFilter('status', value.join(','))
}

function applyDedupeFlags(value: DedupeFlag[]) {
  dedupeFilter.value = value
  query.setFilter('dedupe_flag', value.join(','))
}

function applyDuration() {
  query.setFilter('duration_min', durationMin.value === undefined ? '' : String(durationMin.value))
  query.setFilter('duration_max', durationMax.value === undefined ? '' : String(durationMax.value))
}

function applyDateRange(value: [string, string] | null) {
  dateRange.value = value
  query.setFilter('created_at_from', value?.[0] ?? '')
  query.setFilter('created_at_to', value?.[1] ?? '')
}

const projectName = computed(() => {
  const id = Number(filterValue('project_id'))
  if (!Number.isFinite(id) || id <= 0) return ''
  return projectStore.projects.find((item) => item.id === id)?.name ?? String(id)
})

const chips = computed(() => {
  const result: Array<{ key: string; label: string }> = []
  if (query.keyword.value) {
    result.push({ key: 'keyword', label: `任务号：${query.keyword.value}` })
  }
  const pid = filterValue('project_id')
  if (pid) {
    result.push({ key: 'project_id', label: `项目：${projectName.value}` })
  }
  const aid = filterValue('audit_id')
  if (aid) {
    const name = audits.value.find((item) => item.id === Number(aid))?.name ?? aid
    result.push({ key: 'audit_id', label: `审核：${name}` })
  }
  const sourceTypes = splitFilter('source_type')
  if (sourceTypes.length > 0) {
    result.push({
      key: 'source_type',
      label: `来源类型：${sourceTypes.map((item) => sourceTypeLabel(item)).join('、')}`,
    })
  }
  const mediaTypes = splitFilter('media_type')
  if (mediaTypes.length > 0) {
    result.push({
      key: 'media_type',
      label: `媒体类型：${mediaTypes.map((item) => mediaTypeLabel(item)).join('、')}`,
    })
  }
  const results = splitFilter('result')
  if (results.length > 0) {
    result.push({
      key: 'result',
      label: `结果：${results.map((item) => resultMeta(item).label).join('、')}`,
    })
  }
  const statuses = splitFilter('status')
  if (statuses.length > 0) {
    result.push({
      key: 'status',
      label: `状态：${statuses.map((item) => taskStatusMeta(item).label).join('、')}`,
    })
  }
  const dedupeFlags = splitFilter('dedupe_flag')
  if (dedupeFlags.length > 0) {
    result.push({
      key: 'dedupe_flag',
      label: `去重标记：${dedupeFlags.map((item) => dedupeFlagMeta(item).label).join('、')}`,
    })
  }
  const min = filterValue('duration_min')
  const max = filterValue('duration_max')
  if (min || max) {
    result.push({ key: 'duration', label: `耗时：${min || '-'} ~ ${max || '-'} ms` })
  }
  const from = filterValue('created_at_from')
  const to = filterValue('created_at_to')
  if (from && to) {
    result.push({ key: 'created_at', label: `创建时间：${from} ~ ${to}` })
  }
  return result
})

function removeChip(key: string) {
  if (key === 'keyword') {
    keywordInput.value = ''
    query.setKeyword('')
    return
  }
  if (key === 'project_id') {
    applyProject(0)
    return
  }
  if (key === 'audit_id') {
    applyAudit(0)
    return
  }
  if (key === 'source_type') {
    applySourceTypes([])
    return
  }
  if (key === 'media_type') {
    applyMediaTypes([])
    return
  }
  if (key === 'result') {
    applyResults([])
    return
  }
  if (key === 'status') {
    applyStatuses([])
    return
  }
  if (key === 'dedupe_flag') {
    applyDedupeFlags([])
    return
  }
  if (key === 'duration') {
    durationMin.value = undefined
    durationMax.value = undefined
    applyDuration()
    return
  }
  if (key === 'created_at') {
    applyDateRange(null)
  }
}

function clearChips() {
  keywordInput.value = ''
  query.setKeyword('')
  applyProject(0)
  applyAudit(0)
  applySourceTypes([])
  applyMediaTypes([])
  applyResults([])
  applyStatuses([])
  applyDedupeFlags([])
  durationMin.value = undefined
  durationMax.value = undefined
  applyDuration()
  applyDateRange(null)
  clearSelection()
}

/* ---------------- 排序与分页 ---------------- */

const sortText = computed(() => `${query.sort.value.field}:${query.sort.value.direction}`)

function isSortable(field: string): boolean {
  return SORTABLE_FIELDS.includes(field)
}

function onSort(field: string) {
  query.toggleSort(field)
}

const deepOffset = computed(() => (query.page.value - 1) * query.pageSize.value)

/* ---------------- 选择 ---------------- */

const selectedIds = ref<number[]>([])
const allMatched = ref(false)

const selectedCount = computed(() => (allMatched.value ? table.total.value : selectedIds.value.length))

const pageSelectedCount = computed(() =>
  allMatched.value
    ? table.items.value.length
    : table.items.value.filter((row) => selectedIds.value.includes(row.id)).length,
)

const pageAllSelected = computed(
  () => table.items.value.length > 0 && pageSelectedCount.value === table.items.value.length,
)

const pageIndeterminate = computed(
  () => pageSelectedCount.value > 0 && pageSelectedCount.value < table.items.value.length,
)

const canSelectAll = computed(
  () =>
    !allMatched.value &&
    pageAllSelected.value &&
    table.total.value > table.items.value.length,
)

function isSelected(id: number): boolean {
  return allMatched.value || selectedIds.value.includes(id)
}

function toggleRow(id: number, checked: boolean) {
  allMatched.value = false
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value = [...selectedIds.value, id]
    return
  }
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
}

function togglePage(raw: boolean | string | number) {
  const checked = raw === true
  allMatched.value = false
  const ids = table.items.value.map((row) => row.id)
  if (checked) {
    const merged = new Set([...selectedIds.value, ...ids])
    selectedIds.value = Array.from(merged)
    return
  }
  selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
}

function selectAllMatched() {
  allMatched.value = true
}

function clearSelection() {
  allMatched.value = false
  selectedIds.value = []
}

/* ---------------- 行操作 ---------------- */

function openDetail(row: TaskItem) {
  void router.push({ name: 'task-detail', params: { id: String(row.id) } })
}

function isRunning(status: TaskStatus): boolean {
  return RUNNING_STATUSES.includes(status)
}

async function handleRetry(row: TaskItem) {
  try {
    await retryTask(row.id)
    ElMessage.success('已提交重试')
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function handleStop(row: TaskItem) {
  try {
    await ElMessageBox.confirm(`确认强制停止任务「${row.task_no}」？`, '强制停止', {
      confirmButtonText: '停止',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await stopTask(row.id)
    ElMessage.success('任务已停止')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function handleBatchRetry() {
  if (selectedCount.value === 0) return
  let ids = selectedIds.value
  if (allMatched.value) {
    if (table.total.value > BATCH_MAX) {
      ElMessage.warning(`单次批量重试最多 ${BATCH_MAX} 条，请增加筛选条件`)
      return
    }
    try {
      const payload = await listTasks(toTaskParams({ ...query.requestParams.value, page: 1, page_size: BATCH_MAX }))
      ids = (payload.items ?? []).map((item) => item.id)
    } catch (err) {
      ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
      return
    }
  }
  if (ids.length === 0) {
    ElMessage.warning('请先选择任务')
    return
  }
  try {
    const payload = await batchRetryTasks(ids)
    ElMessage.success(`已提交批量重试：${payload.accepted ?? ids.length} 条`)
    clearSelection()
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 导出 ---------------- */

const exporting = ref(false)
const exportInfo = ref<{ exportId: number; rows: number } | null>(null)

function buildExportFilters(): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  const pid = Number(filterValue('project_id'))
  if (Number.isFinite(pid) && pid > 0) filters.project_id = pid
  const aid = Number(filterValue('audit_id'))
  if (Number.isFinite(aid) && aid > 0) filters.audit_id = aid
  const sourceTypes = splitFilter('source_type')
  if (sourceTypes.length > 0) filters.source_type = sourceTypes
  const mediaTypes = splitFilter('media_type')
  if (mediaTypes.length > 0) filters.media_type = mediaTypes
  const results = splitFilter('result')
  if (results.length > 0) filters.result = results
  const statuses = splitFilter('status')
  if (statuses.length > 0) filters.status = statuses
  const dedupeFlags = splitFilter('dedupe_flag')
  if (dedupeFlags.length > 0) filters.dedupe_flag = dedupeFlags
  const min = Number(filterValue('duration_min'))
  if (filterValue('duration_min') && Number.isFinite(min)) filters.duration_min = min
  const max = Number(filterValue('duration_max'))
  if (filterValue('duration_max') && Number.isFinite(max)) filters.duration_max = max
  const from = filterValue('created_at_from')
  if (from) filters.created_at_from = from
  const to = filterValue('created_at_to')
  if (to) filters.created_at_to = to
  if (query.keyword.value) filters.keyword = query.keyword.value
  return filters
}

async function handleExport() {
  exporting.value = true
  try {
    const payload = (await exportTasks(buildExportFilters())) as {
      export_id: number
      total_rows?: number
    }
    exportInfo.value = { exportId: payload.export_id, rows: payload.total_rows ?? 0 }
    ElMessage.success(`导出任务已创建：${payload.export_id}`)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    exporting.value = false
  }
}

/* ---------------- 初始化 ---------------- */

async function loadAudits(currentProjectId: number) {
  if (currentProjectId <= 0) {
    audits.value = []
    return
  }
  try {
    const payload = await listAudits(currentProjectId, { page: 1, page_size: 100 })
    audits.value = payload.items ?? []
  } catch {
    audits.value = []
  }
}

watch(projectId, (value) => {
  void loadAudits(value)
})

onMounted(() => {
  void table.load(query.requestParams.value)
  void projectStore.loadProjects()
})

watch(
  () => query.requestParams.value,
  (params) => {
    clearSelection()
    void table.load(params)
  },
  { deep: true },
)
</script>

<template>
  <div class="ap-page">
    <PageHeader title="任务列表" desc="任务执行状态、审核结论与重试操作">
      <template #actions>
        <el-button :loading="exporting" @click="handleExport">导出任务</el-button>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-filter">
        <el-input
          v-model="keywordInput"
          class="ap-filter__keyword"
          placeholder="任务号"
          clearable
          @keyup.enter="applyKeyword"
          @clear="applyKeyword"
        />
        <el-select
          :model-value="projectId"
          class="ap-filter__field"
          placeholder="项目"
          clearable
          @change="applyProject"
        >
          <el-option
            v-for="item in projectStore.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-select
          :model-value="auditId"
          class="ap-filter__field"
          placeholder="审核"
          clearable
          :disabled="projectId <= 0"
          @change="applyAudit"
        >
          <el-option
            v-for="item in audits"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="sourceTypeFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="来源类型"
          @change="applySourceTypes"
        >
          <el-option
            v-for="item in SOURCE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="mediaTypeFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="媒体类型"
          @change="applyMediaTypes"
        >
          <el-option
            v-for="item in MEDIA_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="resultFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="结果"
          @change="applyResults"
        >
          <el-option
            v-for="item in RESULT_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="statusFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="状态"
          @change="applyStatuses"
        >
          <el-option
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="dedupeFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="去重标记"
          @change="applyDedupeFlags"
        >
          <el-option
            v-for="item in DEDUPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-input-number
          v-model="durationMin"
          class="ap-filter__number"
          :min="0"
          :controls="false"
          placeholder="耗时下限"
          @change="applyDuration"
        />
        <el-input-number
          v-model="durationMax"
          class="ap-filter__number"
          :min="0"
          :controls="false"
          placeholder="耗时上限"
          @change="applyDuration"
        />
        <el-date-picker
          v-model="dateRange"
          class="ap-filter__date"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="创建时间起"
          end-placeholder="创建时间止"
          @change="applyDateRange"
        />
        <el-button type="primary" plain @click="applyKeyword">查询</el-button>
      </div>

      <div class="ap-card__body ap-card__body--flush">
        <FilterChips :chips="chips" @remove="removeChip" @clear="clearChips" />

        <el-alert
          v-if="table.error.value"
          class="ap-filter__chips"
          type="error"
          show-icon
          :closable="false"
          :title="table.error.value"
        />

        <el-alert
          v-if="deepOffset > 1000"
          class="ap-filter__chips"
          type="info"
          show-icon
          :closable="false"
          title="请增加筛选条件"
        />

        <el-alert
          v-if="exportInfo"
          class="ap-filter__chips"
          type="success"
          show-icon
          :closable="false"
          :title="`导出任务 ID：${exportInfo.exportId}，共 ${exportInfo.rows} 行`"
        />

        <div v-if="selectedCount > 0" class="ap-batch">
          <span class="ap-text-secondary">已选 {{ formatNumber(selectedCount) }} 项</span>
          <el-tooltip :disabled="auth.can('task:retry')" content="缺少 task:retry 权限" placement="top">
            <span>
              <el-button
                type="primary"
                size="small"
                :disabled="!auth.can('task:retry')"
                @click="handleBatchRetry"
              >
                批量重试
              </el-button>
            </span>
          </el-tooltip>
          <el-button size="small" @click="clearSelection">取消</el-button>
          <el-link v-if="canSelectAll" type="primary" @click="selectAllMatched">
            选择全部 {{ formatNumber(table.total.value) }} 条
          </el-link>
        </div>

        <div v-loading="table.loading.value">
          <el-table v-if="table.items.value.length > 0" :data="table.items.value" class="ap-table ap-table--compact">
            <el-table-column width="46">
              <template #header>
                <el-checkbox
                  :model-value="pageAllSelected"
                  :indeterminate="pageIndeterminate"
                  @change="togglePage"
                />
              </template>
              <template #default="{ row }">
                <el-checkbox :model-value="isSelected(row.id)" @change="toggleRow(row.id, $event === true)" />
              </template>
            </el-table-column>

            <el-table-column prop="task_no" label="任务号" width="170">
              <template #header>
                <SortableHeader
                  field="task_no"
                  label="任务号"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <a class="ap-link ap-mono" href="#" @click.prevent="openDetail(row)">{{ row.task_no }}</a>
              </template>
            </el-table-column>

            <el-table-column prop="project_name" label="项目" width="130">
              <template #header>
                <SortableHeader
                  field="project_name"
                  label="项目"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-truncate">{{ row.project_name ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="audit_name" label="审核" width="150">
              <template #header>
                <SortableHeader
                  field="audit_name"
                  label="审核"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-truncate">{{ row.audit_name ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="source_type" label="来源类型" width="110">
              <template #header>
                <SortableHeader
                  field="source_type"
                  label="来源类型"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span>{{ sourceTypeLabel(row.source_type) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="media_type" label="媒体类型" width="100">
              <template #header>
                <SortableHeader
                  field="media_type"
                  label="媒体类型"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span>{{ mediaTypeLabel(row.media_type) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="result" label="结果" width="100">
              <template #header>
                <SortableHeader
                  field="result"
                  label="结果"
                  :sort="sortText"
                  :sortable="isSortable('result')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <StatusTag :label="resultMeta(row.result).label" :tone="resultMeta(row.result).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="110">
              <template #header>
                <SortableHeader
                  field="status"
                  label="状态"
                  :sort="sortText"
                  :sortable="isSortable('status')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <StatusTag :label="taskStatusMeta(row.status).label" :tone="taskStatusMeta(row.status).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="dedupe_flag" label="去重标记" width="100">
              <template #header>
                <SortableHeader
                  field="dedupe_flag"
                  label="去重标记"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <StatusTag :label="dedupeFlagMeta(row.dedupe_flag).label" :tone="dedupeFlagMeta(row.dedupe_flag).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="duration_ms" label="耗时" width="100" align="right">
              <template #header>
                <SortableHeader
                  field="duration_ms"
                  label="耗时"
                  :sort="sortText"
                  :sortable="isSortable('duration_ms')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDuration(row.duration_ms) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="retry_count" label="重试次数" width="100" align="right">
              <template #header>
                <SortableHeader
                  field="retry_count"
                  label="重试次数"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ row.retry_count }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="created_at" label="创建时间" width="160">
              <template #header>
                <SortableHeader
                  field="created_at"
                  label="创建时间"
                  :sort="sortText"
                  :sortable="isSortable('created_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.created_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="finished_at" label="完成时间" width="160">
              <template #header>
                <SortableHeader
                  field="finished_at"
                  label="完成时间"
                  :sort="sortText"
                  :sortable="isSortable('finished_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.finished_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDetail(row)">查看详情</el-button>
                <el-tooltip :disabled="auth.can('task:retry')" content="缺少 task:retry 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('task:retry')"
                      @click="handleRetry(row)"
                    >
                      重试
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('task:stop')" content="缺少 task:stop 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('task:stop') || !isRunning(row.status)"
                      @click="handleStop(row)"
                    >
                      强制停止
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无任务" desc="调整筛选条件后重试" />
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 个任务</span>
        <el-pagination
          :current-page="query.page.value"
          :page-size="query.pageSize.value"
          :page-sizes="[20, 50, 100]"
          :total="table.total.value"
          layout="sizes, prev, pager, next"
          @current-change="query.setPage"
          @size-change="query.setPageSize"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap-filter__keyword {
  width: 190px;
}

.ap-filter__field {
  width: 160px;
}

.ap-filter__number {
  width: 130px;
}

.ap-filter__date {
  width: 240px;
}

.ap-batch {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--ap-space-3);
  padding: var(--ap-space-3) var(--ap-space-5);
  background: var(--ap-bg-card);
  border-bottom: 1px solid var(--ap-border);
}

.ap-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-3);
}
</style>
