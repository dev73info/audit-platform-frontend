<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  batchPurgeRecycleBin,
  listCleanupTasks,
  listRecycleBin,
  purgeRecycleItem,
  restoreRecycleItem,
  type CleanupTaskItem,
  type RecycleListParams,
} from '@/api/recycle'
import type { RecycleBinItem } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatNumber } from '@/utils/format'
import type { SemanticTone } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 排序白名单：不在白名单内的列头置灰。 */
const SORTABLE_FIELDS = ['object_name', 'deleted_at', 'remain_days']

/** 批量永久删除的确认口令。 */
const BATCH_CONFIRM_WORD = '永久删除'

/** 清理任务行：后端另有 progress / step 字段，接口类型里未声明。 */
type CleanupTaskRow = CleanupTaskItem & {
  progress?: number
  step?: string | null
  error_message?: string | null
}

/** 批量永久删除结果：后端返回逐项成功与失败。 */
type BatchPurgeResult = {
  succeeded?: number[]
  failed?: Array<{ id: number; reason: string }>
}

const auth = useAuthStore()

const query = useListQuery({
  defaultSort: { field: 'deleted_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: ['object_type', 'project_id'],
  defaultPageSize: 20,
})

const table = useTableLoader<RecycleBinItem>(async (params) => {
  const payload = await listRecycleBin(params as RecycleListParams)
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 顶部 Tab ---------------- */

const OBJECT_TYPE_TABS = [
  { value: 'PROJECT', label: '项目' },
  { value: 'AUDIT', label: '审核' },
  { value: 'ALL', label: '全部' },
]

const activeTab = ref('ALL')

function filterValue(key: string): string {
  return query.filters[key] ?? ''
}

watch(
  () => filterValue('object_type'),
  (value) => {
    activeTab.value = value || 'ALL'
  },
  { immediate: true },
)

function switchTab(value: string) {
  query.setFilter('object_type', value === 'ALL' ? '' : value)
}

function onTabChange(name: string | number) {
  switchTab(String(name))
}

/* ---------------- 行数据 ---------------- */

function objectTypeLabel(type: string): string {
  if (type === 'PROJECT') return '项目'
  if (type === 'AUDIT') return '审核'
  return type
}

function statusMeta(row: RecycleBinItem): { label: string; tone: SemanticTone } {
  if (row.purge_status === 'PURGED') return { label: '已清理', tone: 'neutral' }
  if (row.purge_status === 'PURGING') return { label: '清理中', tone: 'info' }
  if (row.remain_days <= 0) return { label: '已过期待清理', tone: 'review' }
  return { label: '可恢复', tone: 'pass' }
}

/** 剩余保留天数不超过 3 天标红。 */
function remainDaysClass(row: RecycleBinItem): string {
  return row.remain_days <= 3 ? 'ap-text-danger' : ''
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

/* ---------------- 恢复 ---------------- */

async function restoreRow(row: RecycleBinItem) {
  try {
    await ElMessageBox.confirm(`确认恢复「${row.object_name}」？`, '恢复对象', {
      confirmButtonText: '恢复',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await restoreRecycleItem(row.id)
    ElMessage.success('已恢复')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 永久删除 ---------------- */

const purgeVisible = ref(false)
const purgeTarget = ref<RecycleBinItem | null>(null)
const confirmName = ref('')
const purging = ref(false)

const canConfirmPurge = computed(() => {
  const target = purgeTarget.value
  if (!target) return false
  return confirmName.value === target.object_name
})

function openPurge(row: RecycleBinItem) {
  purgeTarget.value = row
  confirmName.value = ''
  purgeVisible.value = true
}

async function submitPurge() {
  const target = purgeTarget.value
  if (!target || !canConfirmPurge.value) return
  purging.value = true
  try {
    await purgeRecycleItem(target.id, confirmName.value)
    ElMessage.success('已永久删除')
    purgeVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    purging.value = false
  }
}

/* ---------------- 批量永久删除 ---------------- */

const selectedIds = ref<number[]>([])

function onSelectionChange(rows: RecycleBinItem[]) {
  selectedIds.value = rows.map((row) => row.id)
}

const batchVisible = ref(false)
const batchText = ref('')
const batchSubmitting = ref(false)
const batchResult = ref<BatchPurgeResult | null>(null)

const canConfirmBatch = computed(
  () => batchText.value.trim() === BATCH_CONFIRM_WORD && selectedIds.value.length > 0,
)

function openBatchPurge() {
  batchText.value = ''
  batchResult.value = null
  batchVisible.value = true
}

async function submitBatchPurge() {
  if (!canConfirmBatch.value) return
  batchSubmitting.value = true
  try {
    const raw = (await batchPurgeRecycleBin(
      selectedIds.value,
      batchText.value.trim(),
    )) as unknown as BatchPurgeResult
    batchResult.value = { succeeded: raw.succeeded ?? [], failed: raw.failed ?? [] }
    ElMessage.success('批量永久删除完成')
    selectedIds.value = []
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    batchSubmitting.value = false
  }
}

function batchFailedText(): string {
  const failed = batchResult.value?.failed ?? []
  if (failed.length === 0) return ''
  return failed.map((item) => `${item.id}：${item.reason}`).join('；')
}

/* ---------------- 清理任务 ---------------- */

const cleanupVisible = ref(false)
const cleanupTarget = ref<RecycleBinItem | null>(null)
const cleanupRows = ref<CleanupTaskRow[]>([])
const cleanupLoading = ref(false)

function rowPercent(row: RecycleBinItem): number {
  const task = cleanupRows.value.find((item) => item.object_id === row.object_id)
  return task?.progress ?? 0
}

async function openCleanupTasks(row: RecycleBinItem) {
  cleanupTarget.value = row
  cleanupRows.value = []
  cleanupVisible.value = true
  cleanupLoading.value = true
  try {
    const payload = await listCleanupTasks({ page: 1, page_size: 50 })
    cleanupRows.value = (payload.items ?? []).filter((item) => item.object_id === row.object_id)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    cleanupLoading.value = false
  }
}

function cleanupStatusMeta(status: string): { label: string; tone: SemanticTone } {
  if (status === 'SUCCESS') return { label: '成功', tone: 'pass' }
  if (status === 'FAILED') return { label: '失败', tone: 'reject' }
  return { label: '进行中', tone: 'info' }
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void table.load(query.requestParams.value)
})

watch(
  () => query.requestParams.value,
  (params) => void table.load(params),
  { deep: true },
)
</script>

<template>
  <div class="ap-page">
    <PageHeader title="回收站" desc="已删除对象的恢复与永久删除">
      <template #actions>
        <el-tooltip :disabled="auth.can('recycle:purge')" content="缺少 recycle:purge 权限" placement="top">
          <span>
            <el-button
              type="danger"
              plain
              :disabled="!auth.can('recycle:purge') || selectedIds.length === 0"
              @click="openBatchPurge"
            >
              批量永久删除
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-card__body ap-card__body--flush">
        <el-tabs :model-value="activeTab" class="ap-tabs" @tab-change="onTabChange">
          <el-tab-pane v-for="tab in OBJECT_TYPE_TABS" :key="tab.value" :label="tab.label" :name="tab.value" />
        </el-tabs>

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
          <el-table
            v-if="table.items.value.length > 0"
            :data="table.items.value"
            class="ap-table ap-table--compact"
            @selection-change="onSelectionChange"
          >
            <el-table-column type="selection" width="46" />
            <el-table-column prop="object_name" label="名称" min-width="180">
              <template #header>
                <SortableHeader
                  field="object_name"
                  label="名称"
                  :sort="sortText"
                  :sortable="isSortable('object_name')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-truncate">{{ row.object_name }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="object_type" label="类型" width="90">
              <template #default="{ row }">
                <span>{{ objectTypeLabel(row.object_type) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="project_name" label="所属项目" min-width="150">
              <template #default="{ row }">
                <span>{{ row.project_name ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="deleted_by_name" label="删除人" width="130">
              <template #default="{ row }">
                <span>{{ row.deleted_by_name ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="deleted_at" label="删除时间" width="160">
              <template #header>
                <SortableHeader
                  field="deleted_at"
                  label="删除时间"
                  :sort="sortText"
                  :sortable="isSortable('deleted_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.deleted_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="remain_days" label="剩余保留天数" width="120" align="right">
              <template #header>
                <SortableHeader
                  field="remain_days"
                  label="剩余保留天数"
                  :sort="sortText"
                  :sortable="isSortable('remain_days')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono" :class="remainDaysClass(row)">{{ row.remain_days }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="150">
              <template #default="{ row }">
                <div class="ap-flex ap-gap-2">
                  <StatusTag :label="statusMeta(row).label" :tone="statusMeta(row).tone" />
                  <el-progress
                    v-if="row.purge_status === 'PURGING'"
                    class="ap-progress"
                    :percentage="rowPercent(row)"
                    :indeterminate="rowPercent(row) === 0"
                    :stroke-width="6"
                    :show-text="false"
                  />
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="children_count" label="关联对象数" width="110" align="right">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.children_count) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-tooltip :disabled="auth.can('recycle:restore')" content="缺少 recycle:restore 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('recycle:restore')"
                      @click="restoreRow(row)"
                    >
                      恢复
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('recycle:purge')" content="缺少 recycle:purge 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('recycle:purge')"
                      @click="openPurge(row)"
                    >
                      永久删除
                    </el-button>
                  </span>
                </el-tooltip>
                <el-button link type="primary" @click="openCleanupTasks(row)">查看清理任务</el-button>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="回收站为空" desc="调整筛选条件查看已删除对象" />
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

    <!-- 永久删除：要求输入对象全名完全匹配 -->
    <el-dialog v-model="purgeVisible" title="永久删除" width="480px" destroy-on-close>
      <el-alert type="warning" show-icon :closable="false" title="永久删除后不可恢复" />
      <p class="ap-text-secondary ap-purge__name">{{ purgeTarget?.object_name ?? '' }}</p>
      <el-input v-model="confirmName" :placeholder="`输入 ${purgeTarget?.object_name ?? ''} 以确认`" />
      <p class="ap-text-aux ap-purge__hint">
        输入 {{ purgeTarget?.object_name ?? '' }} 以确认
      </p>
      <template #footer>
        <el-button @click="purgeVisible = false">取消</el-button>
        <el-button type="danger" :loading="purging" :disabled="!canConfirmPurge" @click="submitPurge">
          永久删除
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量永久删除 -->
    <el-dialog v-model="batchVisible" title="批量永久删除" width="560px" destroy-on-close>
      <p class="ap-text-secondary">已选择 {{ selectedIds.length }} 条记录</p>
      <el-input v-model="batchText" :placeholder="`输入 ${BATCH_CONFIRM_WORD} 以确认`" />
      <p class="ap-text-aux ap-purge__hint">输入 {{ BATCH_CONFIRM_WORD }} 以确认</p>
      <div v-if="batchResult" class="ap-batch__result">
        <p class="ap-text-success">成功 {{ batchResult.succeeded?.length ?? 0 }} 条</p>
        <p v-if="batchFailedText()" class="ap-text-danger">失败 {{ batchResult.failed?.length ?? 0 }} 条</p>
        <pre class="ap-batch__json">{{ batchFailedText() }}</pre>
      </div>
      <template #footer>
        <el-button @click="batchVisible = false">关闭</el-button>
        <el-button
          type="danger"
          :loading="batchSubmitting"
          :disabled="!canConfirmBatch"
          @click="submitBatchPurge"
        >
          永久删除
        </el-button>
      </template>
    </el-dialog>

    <!-- 清理任务 -->
    <el-dialog
      v-model="cleanupVisible"
      :title="`清理任务 · ${cleanupTarget?.object_name ?? ''}`"
      width="640px"
      destroy-on-close
    >
      <el-table v-if="cleanupRows.length > 0" :data="cleanupRows" class="ap-table ap-table--compact" v-loading="cleanupLoading">
        <el-table-column prop="object_name" label="对象" min-width="150" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <StatusTag :label="cleanupStatusMeta(row.status).label" :tone="cleanupStatusMeta(row.status).tone" />
          </template>
        </el-table-column>
        <el-table-column prop="progress" label="进度" width="160">
          <template #default="{ row }">
            <el-progress :percentage="row.progress ?? 0" :stroke-width="8" />
          </template>
        </el-table-column>
        <el-table-column prop="message" label="信息" min-width="160">
          <template #default="{ row }">
            <span>{{ row.message ?? row.error_message ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160">
          <template #default="{ row }">
            <span class="ap-mono">{{ formatDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else title="暂无清理任务" />
    </el-dialog>
  </div>
</template>

<style scoped>
.ap-tabs {
  margin-bottom: var(--ap-space-2);
}

.ap-progress {
  width: 72px;
}

.ap-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-3);
}

.ap-purge__name {
  margin: var(--ap-space-3) 0 var(--ap-space-2);
}

.ap-purge__hint {
  margin-top: var(--ap-space-1);
}

.ap-batch__result {
  margin-top: var(--ap-space-3);
}

.ap-batch__json {
  margin-top: var(--ap-space-2);
  padding: var(--ap-space-2);
  border-radius: var(--ap-radius-card);
  background: var(--ap-bg-page);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
