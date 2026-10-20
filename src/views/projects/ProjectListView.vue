<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  createProject,
  deleteProject,
  enableProject,
  listProjects,
  pauseProject,
  updateProject,
  type ProjectListParams,
} from '@/api/projects'
import { listUsers } from '@/api/users'
import type { AdminUserItem, ProjectEnv, ProjectItem, ProjectStatus } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatNumber } from '@/utils/format'
import { projectEnvLabel, projectStatusMeta } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import FilterChips from '@/components/FilterChips.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 排序白名单：不在白名单内的列头置灰。 */
const SORTABLE_FIELDS = [
  'name',
  'code',
  'status',
  'env',
  'audit_count',
  'task_today',
  'task_total',
  'queue_backlog',
  'created_at',
  'updated_at',
]

const CODE_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/
const BACKLOG_WARN = 100
const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'PAUSED', label: '暂停' },
  { value: 'DISABLED', label: '停用' },
  { value: 'DELETED', label: '已删除' },
]
const ENV_OPTIONS: Array<{ value: ProjectEnv; label: string }> = [
  { value: 'dev', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'staging', label: '预发' },
  { value: 'prod', label: '生产' },
]

const router = useRouter()
const auth = useAuthStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: ['status', 'env', 'owner', 'created_at_from', 'created_at_to'],
  defaultPageSize: 20,
})

const table = useTableLoader<ProjectItem>(async (params) => {
  const payload = await listProjects(params as ProjectListParams)
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 筛选 ---------------- */

const keywordInput = ref('')
const statusFilter = ref<ProjectStatus[]>([])
const envFilter = ref<ProjectEnv[]>([])
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
    statusFilter.value = splitFilter('status') as ProjectStatus[]
  },
  { immediate: true },
)
watch(
  () => filterValue('env'),
  (value) => {
    envFilter.value = splitFilter('env') as ProjectEnv[]
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
  () => query.keyword.value,
  (value) => {
    keywordInput.value = value
  },
  { immediate: true },
)

function applyKeyword() {
  query.setKeyword(keywordInput.value.trim())
}

function applyStatus(value: ProjectStatus[]) {
  statusFilter.value = value
  query.setFilter('status', value.join(','))
}

function applyEnv(value: ProjectEnv[]) {
  envFilter.value = value
  query.setFilter('env', value.join(','))
}

function applyOwner() {
  query.setFilter('owner', ownerFilter.value.trim())
}

function applyDateRange(value: [string, string] | null) {
  dateRange.value = value
  query.setFilter('created_at_from', value?.[0] ?? '')
  query.setFilter('created_at_to', value?.[1] ?? '')
}

const chips = computed(() => {
  const result: Array<{ key: string; label: string }> = []
  if (query.keyword.value) {
    result.push({ key: 'keyword', label: `关键词：${query.keyword.value}` })
  }
  const statuses = splitFilter('status')
  if (statuses.length > 0) {
    const labels = statuses.map((item) => projectStatusMeta(item).label)
    result.push({ key: 'status', label: `状态：${labels.join('、')}` })
  }
  const envs = splitFilter('env')
  if (envs.length > 0) {
    const labels = envs.map((item) => projectEnvLabel(item))
    result.push({ key: 'env', label: `环境：${labels.join('、')}` })
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
  if (key === 'status') {
    applyStatus([])
    return
  }
  if (key === 'env') {
    applyEnv([])
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
  query.setFilter('env', '')
  query.setFilter('owner', '')
  query.setFilter('created_at_from', '')
  query.setFilter('created_at_to', '')
  statusFilter.value = []
  envFilter.value = []
  ownerFilter.value = ''
  dateRange.value = null
}

/* ---------------- 排序 ---------------- */

const sortText = computed(() => `${query.sort.value.field}:${query.sort.value.direction}`)

function isSortable(field: string): boolean {
  return SORTABLE_FIELDS.includes(field)
}

function onSort(field: string) {
  query.toggleSort(field)
}

/* ---------------- 分页 ---------------- */

const deepOffset = computed(() => (query.page.value - 1) * query.pageSize.value)

/* ---------------- 新建项目 ---------------- */

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const users = ref<AdminUserItem[]>([])

const form = reactive({
  name: '',
  code: '',
  env: 'dev' as ProjectEnv,
  owner_id: undefined as number | undefined,
  description: '',
  max_concurrency: 50,
  max_qps: 100,
  max_mysql_pool: 20,
  max_redis_conn: 20,
  max_media_size_mb: 50,
  max_daily_tasks: undefined as number | undefined,
  max_api_call_per_task: 10,
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入项目编码', trigger: 'blur' },
    { pattern: CODE_PATTERN, message: '编码只能是小写字母开头，可含数字、下划线与短横线，长度 3-32 位', trigger: 'blur' },
  ],
  env: [{ required: true, message: '请选择环境', trigger: 'change' }],
}

function openCreate() {
  form.name = ''
  form.code = ''
  form.env = 'dev'
  form.owner_id = undefined
  form.description = ''
  form.max_concurrency = 50
  form.max_qps = 100
  form.max_mysql_pool = 20
  form.max_redis_conn = 20
  form.max_media_size_mb = 50
  form.max_daily_tasks = undefined
  form.max_api_call_per_task = 10
  dialogVisible.value = true
}

async function submitCreate() {
  const instance = formRef.value
  if (instance) {
    const valid = await instance.validate().catch(() => false)
    if (!valid) return
  }
  submitting.value = true
  try {
    await createProject({
      name: form.name.trim(),
      code: form.code.trim(),
      env: form.env,
      ...(form.owner_id ? { owner_id: form.owner_id } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      quota: {
        max_concurrency: form.max_concurrency,
        max_qps: form.max_qps,
        max_mysql_pool: form.max_mysql_pool,
        max_redis_conn: form.max_redis_conn,
        max_media_size_mb: form.max_media_size_mb,
        max_daily_tasks: form.max_daily_tasks ?? null,
        max_api_call_per_task: form.max_api_call_per_task,
      },
    })
    ElMessage.success('项目已创建')
    dialogVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

/* ---------------- 编辑项目 ---------------- */

const editVisible = ref(false)
const editSubmitting = ref(false)
const editing = ref<ProjectItem | null>(null)
const editForm = reactive({
  name: '',
  env: 'dev' as ProjectEnv,
  owner_id: undefined as number | undefined,
  description: '',
})

function openEdit(row: ProjectItem) {
  editing.value = row
  editForm.name = row.name
  editForm.env = row.env
  editForm.owner_id = row.owner_id
  editForm.description = row.description ?? ''
  editVisible.value = true
}

async function submitEdit() {
  const row = editing.value
  if (!row) return
  editSubmitting.value = true
  try {
    await updateProject(row.id, {
      name: editForm.name.trim(),
      env: editForm.env,
      owner_id: editForm.owner_id,
      description: editForm.description.trim(),
      version: row.version,
    })
    ElMessage.success('项目已更新')
    editVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    editSubmitting.value = false
  }
}

/* ---------------- 行操作 ---------------- */

function openDetail(row: ProjectItem) {
  void router.push({ name: 'project-detail', params: { id: String(row.id) } })
}

function openConfig(row: ProjectItem) {
  void router.push({ name: 'project-config', params: { id: String(row.id) } })
}

async function toggleStatus(row: ProjectItem) {
  try {
    if (row.status === 'ACTIVE') {
      const { value } = await ElMessageBox.prompt('请输入暂停原因', '暂停项目', {
        confirmButtonText: '暂停',
        cancelButtonText: '取消',
        inputPlaceholder: '暂停原因',
        inputValidator: (input: string) => (input.trim() ? true : '请输入暂停原因'),
        type: 'warning',
      })
      await pauseProject(row.id, value.trim())
      ElMessage.success('项目已暂停')
    } else {
      await ElMessageBox.confirm(`确认启用项目「${row.name}」？`, '启用项目', {
        confirmButtonText: '启用',
        cancelButtonText: '取消',
        type: 'warning',
      })
      await enableProject(row.id)
      ElMessage.success('项目已启用')
    }
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function removeProject(row: ProjectItem) {
  try {
    await ElMessageBox.confirm(
      `删除项目「${row.name}」将移入回收站，保留期内可恢复。若项目存在运行中任务，需强制删除。`,
      '删除项目',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await deleteProject(row.id)
    ElMessage.success('项目已移入回收站')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    if (err instanceof ApiError) {
      try {
        await ElMessageBox.confirm(
          `${err.message}。是否强制删除？强制删除会中断运行中的任务。`,
          '强制删除',
          { confirmButtonText: '强制删除', cancelButtonText: '取消', type: 'error' },
        )
      } catch {
        return
      }
      try {
        await deleteProject(row.id, true)
        ElMessage.success('项目已强制移入回收站')
        await table.load(query.requestParams.value)
      } catch (forceErr) {
        ElMessage.error(forceErr instanceof ApiError ? forceErr.message : '操作失败')
      }
      return
    }
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

onMounted(() => {
  void table.load(query.requestParams.value)
  void loadUsers()
})

watch(
  () => query.requestParams.value,
  (params) => void table.load(params),
  { deep: true },
)

async function loadUsers() {
  try {
    const payload = await listUsers({ page: 1, page_size: 100 })
    users.value = payload.items ?? []
  } catch {
    users.value = []
  }
}
</script>

<template>
  <div class="ap-page">
    <PageHeader title="项目列表" desc="审核项目的接入、配置与运行状态">
      <template #actions>
        <el-button type="primary" @click="openCreate">新建项目</el-button>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-filter">
        <el-input
          v-model="keywordInput"
          class="ap-filter__keyword"
          placeholder="项目名称 / 编码"
          clearable
          @keyup.enter="applyKeyword"
          @clear="applyKeyword"
        />
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
          v-model="envFilter"
          class="ap-filter__field"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="环境"
          @change="applyEnv"
        >
          <el-option v-for="item in ENV_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
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
          v-if="deepOffset > 1000"
          class="ap-filter__chips"
          type="info"
          show-icon
          :closable="false"
          title="请增加筛选条件"
        />

        <div v-loading="table.loading.value">
          <el-table v-if="table.items.value.length > 0" :data="table.items.value" class="ap-table ap-table--compact">
            <el-table-column prop="name" label="项目名称" min-width="160">
              <template #header>
                <SortableHeader
                  field="name"
                  label="项目名称"
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

            <el-table-column prop="code" label="项目编码" width="140">
              <template #header>
                <SortableHeader
                  field="code"
                  label="项目编码"
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
                <StatusTag :label="projectStatusMeta(row.status).label" :tone="projectStatusMeta(row.status).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="env" label="环境" width="100">
              <template #header>
                <SortableHeader
                  field="env"
                  label="环境"
                  :sort="sortText"
                  :sortable="isSortable('env')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <el-tag v-if="row.env === 'prod'" type="danger" effect="plain" size="small">
                  {{ projectEnvLabel(row.env) }}
                </el-tag>
                <el-tag v-else type="info" effect="plain" size="small">{{ projectEnvLabel(row.env) }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="stats.audit_count" label="审核数" width="100" align="right">
              <template #header>
                <SortableHeader
                  field="audit_count"
                  label="审核数"
                  :sort="sortText"
                  :sortable="isSortable('audit_count')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.stats.audit_count) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="stats.task_today" label="今日任务" width="110" align="right">
              <template #header>
                <SortableHeader
                  field="task_today"
                  label="今日任务"
                  :sort="sortText"
                  :sortable="isSortable('task_today')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.stats.task_today) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="stats.task_total" label="累计任务" width="110" align="right">
              <template #header>
                <SortableHeader
                  field="task_total"
                  label="累计任务"
                  :sort="sortText"
                  :sortable="isSortable('task_total')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.stats.task_total) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="stats.queue_backlog" label="队列积压" width="110" align="right">
              <template #header>
                <SortableHeader
                  field="queue_backlog"
                  label="队列积压"
                  :sort="sortText"
                  :sortable="isSortable('queue_backlog')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span
                  class="ap-mono"
                  :class="row.stats.queue_backlog > BACKLOG_WARN ? 'ap-text-danger' : ''"
                >
                  {{ formatNumber(row.stats.queue_backlog) }}
                </span>
              </template>
            </el-table-column>

            <el-table-column prop="owner_name" label="创建人" width="120">
              <template #header>
                <SortableHeader field="owner_name" label="创建人" :sort="sortText" :sortable="false" reason="该列暂不支持排序" />
              </template>
              <template #default="{ row }">
                <span>{{ row.owner_name ?? '-' }}</span>
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

            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDetail(row)">查看</el-button>
                <el-tooltip :disabled="auth.can('project:write')" content="缺少 project:write 权限" placement="top">
                  <span>
                    <el-button link type="primary" :disabled="!auth.can('project:write')" @click="openEdit(row)">
                      编辑
                    </el-button>
                  </span>
                </el-tooltip>
                <el-button link type="primary" @click="openConfig(row)">配置</el-button>
                <el-tooltip
                  :disabled="auth.can('project:write')"
                  content="缺少 project:write 权限"
                  placement="top"
                >
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('project:write')"
                      @click="toggleStatus(row)"
                    >
                      {{ row.status === 'ACTIVE' ? '暂停' : '启用' }}
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip
                  :disabled="auth.can('project:delete')"
                  content="缺少 project:delete 权限"
                  placement="top"
                >
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('project:delete')"
                      @click="removeProject(row)"
                    >
                      删除
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无项目" desc="调整筛选条件或新建项目">
            <el-button type="primary" @click="openCreate">新建项目</el-button>
          </EmptyState>
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 个项目</span>
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

    <el-dialog v-model="dialogVisible" title="新建项目" width="640px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入项目名称" maxlength="64" />
        </el-form-item>
        <el-form-item label="项目编码" prop="code">
          <el-input v-model="form.code" placeholder="小写字母开头，3-32 位" class="ap-mono" />
        </el-form-item>
        <el-form-item label="环境" prop="env">
          <el-select v-model="form.env" class="ap-grow">
            <el-option v-for="item in ENV_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="form.owner_id" clearable filterable placeholder="请选择负责人" class="ap-grow">
            <el-option
              v-for="item in users"
              :key="item.id"
              :label="item.display_name ?? item.username"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>

      <div class="ap-card__title">配额</div>
      <el-form :model="form" label-width="130px" class="ap-quota-form">
        <div class="ap-quota-form__grid">
          <el-form-item label="最大并发">
            <el-input-number v-model="form.max_concurrency" :min="1" :max="10000" controls-position="right" />
          </el-form-item>
          <el-form-item label="最大 QPS">
            <el-input-number v-model="form.max_qps" :min="1" :max="100000" controls-position="right" />
          </el-form-item>
          <el-form-item label="MySQL 连接池">
            <el-input-number v-model="form.max_mysql_pool" :min="1" :max="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="Redis 连接数">
            <el-input-number v-model="form.max_redis_conn" :min="1" :max="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="媒体大小 (MB)">
            <el-input-number v-model="form.max_media_size_mb" :min="1" :max="10240" controls-position="right" />
          </el-form-item>
          <el-form-item label="每日任务上限">
            <el-input-number
              v-model="form.max_daily_tasks"
              :min="1"
              :max="10000000"
              controls-position="right"
              placeholder="不限"
            />
          </el-form-item>
          <el-form-item label="单任务 API 调用">
            <el-input-number v-model="form.max_api_call_per_task" :min="1" :max="1000" controls-position="right" />
          </el-form-item>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="editVisible" title="编辑项目" width="560px" destroy-on-close>
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="项目名称">
          <el-input v-model="editForm.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="环境">
          <el-select v-model="editForm.env" class="ap-grow">
            <el-option v-for="item in ENV_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="editForm.owner_id" clearable filterable placeholder="请选择负责人" class="ap-grow">
            <el-option
              v-for="item in users"
              :key="item.id"
              :label="item.display_name ?? item.username"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="3" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ap-filter__keyword {
  width: 220px;
}

.ap-filter__field {
  width: 200px;
}

.ap-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-3);
}

.ap-quota-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--ap-space-5);
}

.ap-quota-form__grid :deep(.el-form-item) {
  margin-bottom: var(--ap-space-3);
}
</style>
