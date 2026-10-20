<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  cloneAudit,
  createAudit,
  deleteAudit,
  enableAudit,
  getAudit,
  listAudits,
  pauseAudit,
  updateAudit,
  type AuditListParams,
} from '@/api/audits'
import type { AuditItem, AuditStatus, TaskResult, TriggerSourceItem } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatDateTime, formatNumber, formatPercent } from '@/utils/format'
import { auditStatusMeta, mediaTypeLabel, resultMeta, sourceTypeLabel } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import FilterChips from '@/components/FilterChips.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 排序白名单：不在白名单内的列头置灰。 */
const SORTABLE_FIELDS = ['name', 'code', 'status', 'created_at', 'updated_at']

/** 审核编码：小写字母开头，可含数字与下划线，长度 3-32 位。 */
const CODE_PATTERN = /^[a-z][a-z0-9_]{2,31}$/

const MEDIA_TYPE_OPTIONS = ['text', 'image', 'video', 'audio'].map((value) => ({
  value,
  label: mediaTypeLabel(value),
}))

const STATUS_OPTIONS: Array<{ value: AuditStatus; label: string }> = [
  { value: 'DRAFT', label: auditStatusMeta('DRAFT').label },
  { value: 'ACTIVE', label: auditStatusMeta('ACTIVE').label },
  { value: 'PAUSED', label: auditStatusMeta('PAUSED').label },
  { value: 'DELETED', label: auditStatusMeta('DELETED').label },
]

const SOURCE_TYPE_OPTIONS = ['REDIS', 'POLLING', 'WEBSOCKET', 'OPENAPI'].map((value) => ({
  value,
  label: sourceTypeLabel(value),
}))

const RESULT_OPTIONS: Array<{ value: TaskResult; label: string }> = [
  { value: 'PASS', label: resultMeta('PASS').label },
  { value: 'REJECT', label: resultMeta('REJECT').label },
  { value: 'REVIEW', label: resultMeta('REVIEW').label },
]

/** 列表行：审核详情里的触发源与统计不在列表接口中，由详情接口补全。 */
type AuditStats = {
  task_total?: number
  task_today?: number
  pass_count?: number
  pass_rate?: number
}

type AuditRow = AuditItem & {
  triggers?: TriggerSourceItem[]
  stats?: AuditStats
}

const router = useRouter()
const auth = useAuthStore()
const projectStore = useProjectStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: [
    'status',
    'media_type',
    'source_type',
    'project_id',
    'owner',
    'created_at_from',
    'created_at_to',
  ],
  defaultPageSize: 20,
})

/** 审核列表按项目查询，项目决定请求路径。 */
const projectId = ref(0)

const table = useTableLoader<AuditRow>(async (params) => {
  if (!projectId.value) return { items: [], total: 0 }
  const payload = await listAudits(projectId.value, params as AuditListParams)
  const items = payload.items ?? []
  void enrichDetails(items)
  return { items, total: payload.total ?? 0 }
})

/** 详情缓存：补充触发方式与运行指标。 */
const detailMap = reactive(new Map<number, AuditRow>())

async function enrichDetails(rows: AuditRow[]) {
  const targets = rows.filter((row) => {
    const cached = detailMap.get(row.id)
    return !cached || cached.updated_at !== row.updated_at
  })
  let cursor = 0
  const workers = Array.from({ length: Math.min(5, targets.length) }, async () => {
    while (cursor < targets.length) {
      const row = targets[cursor]
      cursor += 1
      if (!row) continue
      try {
        const detail = (await getAudit(row.id)) as AuditRow
        detailMap.set(row.id, detail)
      } catch {
        // 详情补全失败不阻塞列表
      }
    }
  })
  await Promise.all(workers)
}

/* ---------------- 筛选 ---------------- */

const keywordInput = ref('')
const mediaTypeFilter = ref<string[]>([])
const statusFilter = ref<AuditStatus[]>([])
const sourceTypeFilter = ref<string[]>([])
const ownerFilter = ref('')
const dateRange = ref<[string, string] | null>(null)

function filterValue(key: string): string {
  return query.filters[key] ?? ''
}

function splitFilter(key: string): string[] {
  const value = filterValue(key)
  return value ? value.split(',').filter((item) => item !== '') : []
}

watch(
  () => filterValue('status'),
  (value) => {
    statusFilter.value = splitFilter('status') as AuditStatus[]
  },
  { immediate: true },
)
watch(
  () => filterValue('media_type'),
  (value) => {
    mediaTypeFilter.value = splitFilter('media_type')
  },
  { immediate: true },
)
watch(
  () => filterValue('source_type'),
  (value) => {
    sourceTypeFilter.value = splitFilter('source_type')
  },
  { immediate: true },
)
watch(
  () => filterValue('owner'),
  (value) => {
    ownerFilter.value = value
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
watch(
  () => filterValue('project_id'),
  (value) => {
    const raw = Number(value)
    projectId.value = Number.isFinite(raw) && raw > 0 ? raw : 0
  },
  { immediate: true },
)
watch(
  () => query.keyword.value,
  (value) => {
    keywordInput.value = value
  },
  { immediate: true },
)

function applyKeyword() {
  query.setKeyword(keywordInput.value.trim())
}

function applyMediaTypes(value: string[]) {
  mediaTypeFilter.value = value
  query.setFilter('media_type', value.join(','))
}

function applyStatus(value: AuditStatus[]) {
  statusFilter.value = value
  query.setFilter('status', value.join(','))
}

function applySourceTypes(value: string[]) {
  sourceTypeFilter.value = value
  query.setFilter('source_type', value.join(','))
}

function applyOwner() {
  query.setFilter('owner', ownerFilter.value.trim())
}

function applyDateRange(value: [string, string] | null) {
  dateRange.value = value
  query.setFilter('created_at_from', value?.[0] ?? '')
  query.setFilter('created_at_to', value?.[1] ?? '')
}

function applyProject(value: number) {
  query.setFilter('project_id', value > 0 ? String(value) : '')
}

function onProjectChange(value: number) {
  projectStore.select(value)
  applyProject(value)
}

/** 全局项目切换后，列表跟随切换。 */
watch(
  () => projectStore.currentId,
  (value) => {
    if (value > 0 && !filterValue('project_id')) applyProject(value)
  },
)

const projectName = computed(() => {
  const id = Number(filterValue('project_id'))
  if (!Number.isFinite(id) || id <= 0) return ''
  return projectStore.projects.find((item) => item.id === id)?.name ?? String(id)
})

const chips = computed(() => {
  const result: Array<{ key: string; label: string }> = []
  if (query.keyword.value) {
    result.push({ key: 'keyword', label: `关键词：${query.keyword.value}` })
  }
  const mediaTypes = splitFilter('media_type')
  if (mediaTypes.length > 0) {
    result.push({
      key: 'media_type',
      label: `媒体类型：${mediaTypes.map((item) => mediaTypeLabel(item)).join('、')}`,
    })
  }
  const statuses = splitFilter('status')
  if (statuses.length > 0) {
    result.push({
      key: 'status',
      label: `状态：${statuses.map((item) => auditStatusMeta(item).label).join('、')}`,
    })
  }
  const sourceTypes = splitFilter('source_type')
  if (sourceTypes.length > 0) {
    result.push({
      key: 'source_type',
      label: `触发方式：${sourceTypes.map((item) => sourceTypeLabel(item)).join('、')}`,
    })
  }
  const pid = filterValue('project_id')
  if (pid) {
    result.push({ key: 'project_id', label: `项目：${projectName.value}` })
  }
  const owner = filterValue('owner')
  if (owner) {
    result.push({ key: 'owner', label: `创建人：${owner}` })
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
  if (key === 'media_type') {
    applyMediaTypes([])
    return
  }
  if (key === 'status') {
    applyStatus([])
    return
  }
  if (key === 'source_type') {
    applySourceTypes([])
    return
  }
  if (key === 'project_id') {
    applyProject(projectStore.currentId || projectStore.projects[0]?.id || 0)
    return
  }
  if (key === 'owner') {
    ownerFilter.value = ''
    query.setFilter('owner', '')
    return
  }
  if (key === 'created_at') {
    applyDateRange(null)
  }
}

function clearChips() {
  keywordInput.value = ''
  query.setKeyword('')
  query.setFilter('status', '')
  query.setFilter('media_type', '')
  query.setFilter('source_type', '')
  query.setFilter('owner', '')
  query.setFilter('created_at_from', '')
  query.setFilter('created_at_to', '')
  statusFilter.value = []
  mediaTypeFilter.value = []
  sourceTypeFilter.value = []
  ownerFilter.value = ''
  dateRange.value = null
  applyProject(projectStore.currentId || projectStore.projects[0]?.id || 0)
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

/* ---------------- 行数据 ---------------- */

function rowTriggers(row: AuditRow): TriggerSourceItem[] {
  return detailMap.get(row.id)?.triggers ?? row.triggers ?? []
}

function rowSourceTypes(row: AuditRow): string[] {
  const types = rowTriggers(row).map((item) => item.type)
  return Array.from(new Set(types))
}

function rowStats(row: AuditRow): AuditStats {
  return detailMap.get(row.id)?.stats ?? row.stats ?? {}
}

/* ---------------- 新建 / 编辑 ---------------- */

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editing = ref<AuditRow | null>(null)

const form = reactive({
  name: '',
  code: '',
  media_types: [] as string[],
  description: '',
  concurrency: 10,
  timeout_ms: 30000,
  dedupe_window_sec: 86400,
  default_result: 'REVIEW' as TaskResult,
  on_model_fail: 'REVIEW' as TaskResult,
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入审核名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入审核编码', trigger: 'blur' },
    {
      pattern: CODE_PATTERN,
      message: '编码只能是小写字母开头，可含数字与下划线，长度 3-32 位',
      trigger: 'blur',
    },
  ],
  media_types: [{ required: true, message: '请选择媒体类型', trigger: 'change' }],
}

function openCreate() {
  dialogMode.value = 'create'
  editing.value = null
  form.name = ''
  form.code = ''
  form.media_types = []
  form.description = ''
  form.concurrency = 10
  form.timeout_ms = 30000
  form.dedupe_window_sec = 86400
  form.default_result = 'REVIEW'
  form.on_model_fail = 'REVIEW'
  dialogVisible.value = true
}

function openEdit(row: AuditRow) {
  dialogMode.value = 'edit'
  editing.value = row
  form.name = row.name
  form.code = row.code
  form.media_types = [...row.media_types]
  form.description = row.description ?? ''
  form.concurrency = row.concurrency
  form.timeout_ms = row.timeout_ms
  form.dedupe_window_sec = row.dedupe_window_sec
  form.default_result = row.default_result
  form.on_model_fail = row.on_model_fail
  dialogVisible.value = true
}

async function submitDialog() {
  const instance = formRef.value
  if (instance) {
    const valid = await instance.validate().catch(() => false)
    if (!valid) return
  }
  if (!projectId.value) {
    ElMessage.error('请先选择项目')
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      media_types: form.media_types,
      description: form.description.trim(),
      concurrency: form.concurrency,
      timeout_ms: form.timeout_ms,
      dedupe_window_sec: form.dedupe_window_sec,
      default_result: form.default_result,
      on_model_fail: form.on_model_fail,
    }
    if (dialogMode.value === 'create') {
      await createAudit(projectId.value, payload)
      ElMessage.success('审核已创建')
    } else {
      const row = editing.value
      if (!row) return
      await updateAudit(row.id, { ...payload, config_version: row.config_version })
      ElMessage.success('审核已更新')
    }
    dialogVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

/* ---------------- 行操作 ---------------- */

function openDetail(row: AuditRow) {
  void router.push({ name: 'audit-edit', params: { id: String(row.id) } })
}

async function toggleStatus(row: AuditRow) {
  try {
    if (row.status === 'ACTIVE') {
      await ElMessageBox.confirm(`确认暂停审核「${row.name}」？`, '暂停审核', {
        confirmButtonText: '暂停',
        cancelButtonText: '取消',
        type: 'warning',
      })
      await pauseAudit(row.id)
      ElMessage.success('审核已暂停')
    } else {
      await ElMessageBox.confirm(`确认启用审核「${row.name}」？`, '启用审核', {
        confirmButtonText: '启用',
        cancelButtonText: '取消',
        type: 'warning',
      })
      await enableAudit(row.id)
      ElMessage.success('审核已启用')
    }
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function cloneRow(row: AuditRow) {
  try {
    await ElMessageBox.confirm(`确认克隆审核「${row.name}」？克隆结果为草稿状态。`, '克隆审核', {
      confirmButtonText: '克隆',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await cloneAudit(row.id)
    ElMessage.success('审核已克隆')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function removeAudit(row: AuditRow) {
  try {
    await ElMessageBox.confirm(
      `删除审核「${row.name}」将移入回收站，保留期内可恢复。`,
      '删除审核',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await deleteAudit(row.id)
    ElMessage.success('审核已移入回收站')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void table.load(query.requestParams.value)
  void initProject()
})

watch(
  () => query.requestParams.value,
  (params) => void table.load(params),
  { deep: true },
)

async function initProject() {
  try {
    await projectStore.loadProjects()
  } catch {
    // 项目加载失败时保持空列表
  }
  if (projectId.value > 0) return
  const fallback = projectStore.currentId || projectStore.projects[0]?.id || 0
  if (fallback > 0) applyProject(fallback)
}
</script>

<template>
  <div class="ap-page">
    <PageHeader title="审核列表" desc="审核定义的启停、触发方式与运行指标">
      <template #actions>
        <el-tooltip :disabled="auth.can('audit:write')" content="缺少 audit:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!auth.can('audit:write')" @click="openCreate">
              新建审核
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-filter">
        <el-input
          v-model="keywordInput"
          class="ap-filter__keyword"
          placeholder="审核名称 / 编码"
          clearable
          @keyup.enter="applyKeyword"
          @clear="applyKeyword"
        />
        <el-select
          :model-value="projectId"
          class="ap-filter__field"
          placeholder="项目"
          @change="onProjectChange"
        >
          <el-option
            v-for="item in projectStore.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
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
          <el-option v-for="item in MEDIA_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-model="statusFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="状态"
          @change="applyStatus"
        >
          <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-model="sourceTypeFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="触发方式"
          @change="applySourceTypes"
        >
          <el-option
            v-for="item in SOURCE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-input
          v-model="ownerFilter"
          class="ap-filter__field"
          placeholder="创建人"
          clearable
          @keyup.enter="applyOwner"
          @clear="applyOwner"
        />
        <el-date-picker
          v-model="dateRange"
          class="ap-filter__field"
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

        <div v-loading="table.loading.value">
          <el-table v-if="table.items.value.length > 0" :data="table.items.value" class="ap-table ap-table--compact">
            <el-table-column prop="name" label="审核名称" min-width="180">
              <template #header>
                <SortableHeader
                  field="name"
                  label="审核名称"
                  :sort="sortText"
                  :sortable="isSortable('name')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <a class="ap-link" href="#" @click.prevent="openDetail(row)">{{ row.name }}</a>
              </template>
            </el-table-column>

            <el-table-column prop="code" label="审核编码" width="150">
              <template #header>
                <SortableHeader
                  field="code"
                  label="审核编码"
                  :sort="sortText"
                  :sortable="isSortable('code')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ row.code }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="media_types" label="媒体类型" width="170">
              <template #header>
                <SortableHeader
                  field="media_types"
                  label="媒体类型"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <el-tag
                  v-for="item in row.media_types"
                  :key="item"
                  size="small"
                  type="info"
                  effect="plain"
                  class="ap-tag-gap"
                >
                  {{ mediaTypeLabel(item) }}
                </el-tag>
                <span v-if="row.media_types.length === 0" class="ap-text-aux">-</span>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="100">
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
                <StatusTag :label="auditStatusMeta(row.status).label" :tone="auditStatusMeta(row.status).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="triggers" label="触发方式" width="170">
              <template #header>
                <SortableHeader
                  field="triggers"
                  label="触发方式"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <el-tag
                  v-for="item in rowSourceTypes(row)"
                  :key="item"
                  size="small"
                  type="info"
                  effect="plain"
                  class="ap-tag-gap"
                >
                  {{ sourceTypeLabel(item) }}
                </el-tag>
                <span v-if="rowSourceTypes(row).length === 0" class="ap-text-aux">-</span>
              </template>
            </el-table-column>

            <el-table-column prop="task_today" label="今日任务" width="110" align="right">
              <template #header>
                <SortableHeader
                  field="task_today"
                  label="今日任务"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(rowStats(row).task_today ?? 0) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="pass_rate" label="通过率" width="100" align="right">
              <template #header>
                <SortableHeader
                  field="pass_rate"
                  label="通过率"
                  :sort="sortText"
                  :sortable="false"
                  reason="该列暂不支持排序"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatPercent(rowStats(row).pass_rate ?? 0) }}</span>
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

            <el-table-column prop="updated_at" label="更新时间" width="160">
              <template #header>
                <SortableHeader
                  field="updated_at"
                  label="更新时间"
                  :sort="sortText"
                  :sortable="isSortable('updated_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.updated_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="280" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDetail(row)">查看</el-button>
                <el-tooltip :disabled="auth.can('audit:write')" content="缺少 audit:write 权限" placement="top">
                  <span>
                    <el-button link type="primary" :disabled="!auth.can('audit:write')" @click="openEdit(row)">
                      编辑
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('audit:write')" content="缺少 audit:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('audit:write')"
                      @click="cloneRow(row)"
                    >
                      克隆
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('audit:write')" content="缺少 audit:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('audit:write')"
                      @click="toggleStatus(row)"
                    >
                      {{ row.status === 'ACTIVE' ? '暂停' : '启用' }}
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('audit:delete')" content="缺少 audit:delete 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('audit:delete')"
                      @click="removeAudit(row)"
                    >
                      删除
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无审核" desc="调整筛选条件或新建审核">
            <el-button type="primary" :disabled="!auth.can('audit:write')" @click="openCreate">
              新建审核
            </el-button>
          </EmptyState>
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 个审核</span>
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

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建审核' : '编辑审核'"
      width="640px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="审核名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入审核名称" maxlength="64" />
        </el-form-item>
        <el-form-item label="审核编码" prop="code">
          <el-input v-model="form.code" placeholder="小写字母开头，3-32 位" class="ap-mono" />
        </el-form-item>
        <el-form-item label="媒体类型" prop="media_types">
          <el-select v-model="form.media_types" multiple class="ap-grow" placeholder="请选择媒体类型">
            <el-option
              v-for="item in MEDIA_TYPE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
        <el-form-item label="并发数">
          <el-input-number v-model="form.concurrency" :min="1" :max="10000" controls-position="right" />
        </el-form-item>
        <el-form-item label="超时 (ms)">
          <el-input-number v-model="form.timeout_ms" :min="100" :max="600000" :step="1000" controls-position="right" />
        </el-form-item>
        <el-form-item label="去重窗口 (秒)">
          <el-input-number
            v-model="form.dedupe_window_sec"
            :min="0"
            :max="2592000"
            :step="3600"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="默认结果">
          <el-select v-model="form.default_result" class="ap-grow">
            <el-option v-for="item in RESULT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型失败兜底">
          <el-select v-model="form.on_model_fail" class="ap-grow">
            <el-option v-for="item in RESULT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitDialog">
          {{ dialogMode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ap-filter__keyword {
  width: 200px;
}

.ap-filter__field {
  width: 180px;
}

.ap-tag-gap {
  margin-right: 4px;
}

.ap-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-3);
}
</style>
