<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { ApiError, buildQuery, post } from '@/api/http'
import { listAuditLogs, type AuditLogListParams } from '@/api/auditLogs'
import type { AuditLogItem } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatFullDateTime, formatNumber } from '@/utils/format'
import { auditActionLabel } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 参与 URL 同步与导出的筛选字段。 */
const FILTER_KEYS = [
  'operator',
  'action',
  'object_type',
  'object_id',
  'project_id',
  'result',
  'created_at_from',
  'created_at_to',
]

/** 可筛选的操作类型，取值与 auditActionLabel 的映射键一致。 */
const ACTION_OPTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_ENABLE',
  'PROJECT_PAUSE',
  'PROJECT_DELETE',
  'PROJECT_RESTORE',
  'PROJECT_PURGE',
  'QUOTA_UPDATE',
  'CONFIG_CREATE',
  'CONFIG_UPDATE',
  'CONFIG_TEST',
  'CONFIG_ROLLBACK',
  'CONFIG_REVEAL',
  'CONFIG_DELETE',
  'AUDIT_CREATE',
  'AUDIT_UPDATE',
  'AUDIT_ENABLE',
  'AUDIT_PAUSE',
  'AUDIT_DELETE',
  'AUDIT_RESTORE',
  'AUDIT_CLONE',
  'TRIGGER_CREATE',
  'TRIGGER_UPDATE',
  'TRIGGER_DELETE',
  'TRIGGER_TEST',
  'RULE_CREATE',
  'RULE_UPDATE',
  'RULE_DELETE',
  'ROUTE_UPDATE',
  'ROUTE_TEMPLATE',
  'TASK_RETRY',
  'TASK_STOP',
  'TASK_REVIEW',
  'ACTION_RETRY',
  'ACTION_EXEC',
  'RECYCLE_RESTORE',
  'RECYCLE_PURGE',
  'RECYCLE_AUTO_CLEAN',
  'API_CLIENT_CREATE',
  'API_CLIENT_UPDATE',
  'API_CLIENT_DELETE',
  'API_CALL',
  'API_SIGN_FAILED',
  'API_RATE_LIMITED',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_RESET_PASSWORD',
  'USER_SCOPE_UPDATE',
].map((value) => ({ value, label: auditActionLabel(value) }))

const OBJECT_TYPE_OPTIONS = [
  { value: 'PROJECT', label: '项目' },
  { value: 'AUDIT', label: '审核' },
  { value: 'TRIGGER', label: '触发源' },
  { value: 'RULE', label: '规则' },
  { value: 'ROUTE', label: '结果路由' },
  { value: 'TASK', label: '任务' },
  { value: 'ACTION', label: '动作' },
  { value: 'CONFIG', label: '连接配置' },
  { value: 'RECYCLE', label: '回收站' },
  { value: 'API_CLIENT', label: '开放 API 客户端' },
  { value: 'USER', label: '用户' },
]

const RESULT_OPTIONS = [
  { value: 'SUCCESS', label: '成功' },
  { value: 'FAIL', label: '失败' },
]

/** 导出结果。 */
type ExportResult = {
  export_id?: number
  status?: string
  total_rows?: number
  file_path?: string
}

const auth = useAuthStore()
const projectStore = useProjectStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: ['created_at', 'operator', 'action'],
  filterKeys: FILTER_KEYS,
  defaultPageSize: 20,
})

const table = useTableLoader<AuditLogItem>(async (params) => {
  const payload = await listAuditLogs(params as AuditLogListParams)
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 筛选控件 ---------------- */

const operatorInput = ref('')
const actionFilter = ref('')
const objectTypeFilter = ref('')
const objectIdInput = ref('')
const projectFilter = ref(0)
const resultFilter = ref('')
const dateRange = ref<[string, string] | null>(null)

function filterValue(key: string): string {
  return query.filters[key] ?? ''
}

watch(
  () => filterValue('operator'),
  (value) => {
    operatorInput.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('action'),
  (value) => {
    actionFilter.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('object_type'),
  (value) => {
    objectTypeFilter.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('object_id'),
  (value) => {
    objectIdInput.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('project_id'),
  (value) => {
    const raw = Number(value)
    projectFilter.value = Number.isFinite(raw) && raw > 0 ? raw : 0
  },
  { immediate: true },
)
watch(
  () => filterValue('result'),
  (value) => {
    resultFilter.value = value
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

function applyOperator() {
  query.setFilter('operator', operatorInput.value.trim())
}

function applyObjectId() {
  query.setFilter('object_id', objectIdInput.value.trim())
}

function applyAction(value: string) {
  query.setFilter('action', value)
}

function applyObjectType(value: string) {
  query.setFilter('object_type', value)
}

function applyProject(value: number) {
  query.setFilter('project_id', value > 0 ? String(value) : '')
}

function applyResult(value: string) {
  query.setFilter('result', value)
}

function applyDateRange(value: [string, string] | null) {
  query.setFilter('created_at_from', value?.[0] ?? '')
  query.setFilter('created_at_to', value?.[1] ?? '')
}

function resetFilters() {
  query.reset()
}

/* ---------------- 排序与分页 ---------------- */

const sortText = computed(() => `${query.sort.value.field}:${query.sort.value.direction}`)

function isSortable(field: string): boolean {
  return ['created_at', 'operator', 'action'].includes(field)
}

function onSort(field: string) {
  query.toggleSort(field)
}

const deepOffset = computed(() => (query.page.value - 1) * query.pageSize.value)

/* ---------------- 行数据 ---------------- */

function actionLabel(action: string): string {
  return auditActionLabel(action)
}

function objectLabel(row: AuditLogItem): string {
  const type = row.object_type ?? '-'
  const id = row.object_id ?? '-'
  return `${type} #${id}`
}

function resultMeta(result: string): { label: string; tone: 'pass' | 'reject' | 'neutral' } {
  if (result === 'SUCCESS') return { label: '成功', tone: 'pass' }
  if (result === 'FAIL') return { label: '失败', tone: 'reject' }
  return { label: result, tone: 'neutral' }
}

function detailText(row: AuditLogItem): string {
  if (!row.detail) return '{}'
  try {
    return JSON.stringify(row.detail, null, 2)
  } catch {
    return '{}'
  }
}

/* ---------------- 导出 ---------------- */

const exporting = ref(false)
const exportResult = ref<ExportResult | null>(null)

function exportParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const key of FILTER_KEYS) {
    const value = query.filters[key]
    if (value) params[`filter[${key}]`] = value
  }
  if (query.keyword.value) params.keyword = query.keyword.value
  return params
}

async function doExport() {
  exporting.value = true
  try {
    // 后端导出接口按查询参数取筛选条件。
    const url = `/api/admin/v1/audit-logs/export${buildQuery(exportParams())}`
    const result = await post<ExportResult>(url)
    exportResult.value = result
    ElMessage.success('导出完成')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    exporting.value = false
  }
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void table.load(query.requestParams.value)
  void loadProjects()
})

watch(
  () => query.requestParams.value,
  (params) => void table.load(params),
  { deep: true },
)

async function loadProjects() {
  try {
    await projectStore.loadProjects()
  } catch {
    // 项目加载失败时保持空列表
  }
}
</script>

<template>
  <div class="ap-page">
    <PageHeader title="审计日志" desc="操作留痕与追溯">
      <template #actions>
        <el-tooltip :disabled="auth.can('audit_log:export')" content="缺少 audit_log:export 权限" placement="top">
          <span>
            <el-button
              type="primary"
              :loading="exporting"
              :disabled="!auth.can('audit_log:export')"
              @click="doExport"
            >
              导出
            </el-button>
          </span>
        </el-tooltip>
      </template>
      <template #extra>
        <p class="ap-text-aux">审计日志留存 ≥ 180 天</p>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-filter">
        <el-input
          v-model="operatorInput"
          class="ap-filter__keyword"
          placeholder="操作人"
          clearable
          @keyup.enter="applyOperator"
          @clear="applyOperator"
        />
        <el-select
          v-model="actionFilter"
          class="ap-filter__field"
          clearable
          placeholder="操作类型"
          @change="applyAction"
        >
          <el-option v-for="item in ACTION_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-model="objectTypeFilter"
          class="ap-filter__field"
          clearable
          placeholder="对象类型"
          @change="applyObjectType"
        >
          <el-option v-for="item in OBJECT_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-input
          v-model="objectIdInput"
          class="ap-filter__field"
          placeholder="对象 ID"
          clearable
          @keyup.enter="applyObjectId"
          @clear="applyObjectId"
        />
        <el-select
          v-model="projectFilter"
          class="ap-filter__field"
          clearable
          placeholder="项目"
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
          v-model="resultFilter"
          class="ap-filter__field"
          clearable
          placeholder="结果"
          @change="applyResult"
        >
          <el-option v-for="item in RESULT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          class="ap-filter__field"
          type="datetimerange"
          value-format="YYYY-MM-DD HH:mm:ss"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @change="applyDateRange"
        />
        <el-button type="primary" plain @click="resetFilters">重置</el-button>
      </div>

      <div class="ap-card__body ap-card__body--flush">
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
          v-if="exportResult"
          class="ap-filter__chips"
          type="success"
          show-icon
          :closable="false"
          :title="`已导出 ${formatNumber(exportResult.total_rows ?? 0)} 行`"
        >
          <span class="ap-mono ap-log__export-path">{{ exportResult.file_path ?? '-' }}</span>
        </el-alert>

        <div v-loading="table.loading.value">
          <el-table v-if="table.items.value.length > 0" :data="table.items.value" class="ap-table ap-table--compact">
            <el-table-column type="expand" width="46">
              <template #default="{ row }">
                <div class="ap-log__detail">
                  <div class="ap-log__detail-label">详情</div>
                  <pre class="ap-log__json">{{ detailText(row) }}</pre>
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="created_at" label="时间" width="160">
              <template #header>
                <SortableHeader
                  field="created_at"
                  label="时间"
                  :sort="sortText"
                  :sortable="isSortable('created_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatFullDateTime(row.created_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="operator" label="操作人" width="180">
              <template #header>
                <SortableHeader
                  field="operator"
                  label="操作人"
                  :sort="sortText"
                  :sortable="isSortable('operator')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <div class="ap-log__operator">
                  <span>{{ row.operator }}</span>
                  <span class="ap-mono ap-text-aux">{{ row.operator_ip ?? '-' }}</span>
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="action" label="操作" width="160">
              <template #header>
                <SortableHeader
                  field="action"
                  label="操作"
                  :sort="sortText"
                  :sortable="isSortable('action')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span>{{ actionLabel(row.action) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="object_id" label="对象" min-width="160">
              <template #default="{ row }">
                <span class="ap-mono">{{ objectLabel(row) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="result" label="结果" width="100">
              <template #default="{ row }">
                <StatusTag :label="resultMeta(row.result).label" :tone="resultMeta(row.result).tone" />
              </template>
            </el-table-column>

            <el-table-column label="详情" width="90">
              <template #default>
                <span class="ap-text-aux">展开查看</span>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无审计日志" desc="调整筛选条件后重试" />
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 条</span>
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
  width: 180px;
}

.ap-filter__field {
  width: 180px;
}

.ap-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-3);
}

.ap-log__operator {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.ap-log__detail {
  padding: var(--ap-space-2) var(--ap-space-4);
}

.ap-log__detail-label {
  color: var(--ap-text-secondary);
  font-size: 12px;
  margin-bottom: var(--ap-space-1);
}

.ap-log__json {
  margin: 0;
  padding: var(--ap-space-2);
  border-radius: var(--ap-radius-card);
  background: var(--ap-bg-page);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.ap-log__export-path {
  font-size: 12px;
  word-break: break-all;
}
</style>
