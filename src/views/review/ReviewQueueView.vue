<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { ApiError } from '@/api/http'
import { getReview, listReviews, reviewTask } from '@/api/tasks'
import type { MediaItem, RuleGroupTrace, TaskDetail, TaskItem } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatDuration, formatFullDateTime } from '@/utils/format'
import { mediaTypeLabel, resultMeta, sourceTypeLabel, taskStatusMeta } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 等待超时阈值：30 分钟。 */
const OVERDUE_MS = 30 * 60 * 1000

const REASON_CODES = [
  { value: 'POLICY_VIOLATION', label: '违规' },
  { value: 'ADVERTISEMENT', label: '广告' },
  { value: 'PORN', label: '色情' },
  { value: 'TERROR', label: '暴力' },
  { value: 'OTHER', label: '其他' },
]

const auth = useAuthStore()

const queue = ref<TaskItem[]>([])
const activeId = ref(0)
const detail = ref<TaskDetail | null>(null)
const queueLoading = ref(false)
const detailLoading = ref(false)
const submitting = ref(false)
const reasonCode = ref('')
const remark = ref('')

function waitingMs(row: TaskItem): number {
  if (typeof row.waiting_ms === 'number' && Number.isFinite(row.waiting_ms)) return row.waiting_ms
  const created = new Date(row.created_at).getTime()
  if (Number.isNaN(created)) return 0
  return Math.max(0, Date.now() - created)
}

const sortedQueue = computed<TaskItem[]>(() =>
  [...queue.value].sort((a, b) => waitingMs(b) - waitingMs(a)),
)

function isOverdue(row: TaskItem): boolean {
  return waitingMs(row) > OVERDUE_MS
}

const mediaItems = computed<MediaItem[]>(() => detail.value?.media ?? [])

const ruleGroups = computed<RuleGroupTrace[]>(() => detail.value?.rule_hit ?? [])

const modelReasons = computed(() =>
  (detail.value?.reasons ?? []).filter((item) => item.source === 'model'),
)

function reasonLabel(item: Record<string, unknown>): string {
  const label = typeof item.label === 'string' ? item.label : '-'
  const score = typeof item.score === 'number' ? item.score : null
  return score === null ? label : `${label}（${score}）`
}

async function selectTask(id: number) {
  activeId.value = id
  detailLoading.value = true
  try {
    detail.value = await getReview(id)
  } catch (err) {
    detail.value = null
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    detailLoading.value = false
  }
}

async function loadQueue() {
  queueLoading.value = true
  try {
    const payload = await listReviews({ page: 1, page_size: 100, sort: 'created_at:asc' })
    queue.value = payload.items ?? []
    const target = sortedQueue.value.find((item) => item.id === activeId.value) ?? sortedQueue.value[0]
    if (target) {
      await selectTask(target.id)
    } else {
      activeId.value = 0
      detail.value = null
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    queueLoading.value = false
  }
}

function selectNext() {
  const list = sortedQueue.value
  if (list.length === 0) return
  const index = list.findIndex((item) => item.id === activeId.value)
  const next = list[index + 1] ?? list[0]
  if (next) void selectTask(next.id)
}

async function submitReview(conclusion: 'PASS' | 'REJECT') {
  if (!detail.value) return
  if (!auth.can('task:review')) {
    ElMessage.warning('缺少 task:review 权限')
    return
  }
  if (!reasonCode.value) {
    ElMessage.warning('请选择原因码')
    return
  }
  submitting.value = true
  const reviewedId = detail.value.id
  try {
    await reviewTask(reviewedId, {
      conclusion,
      reason_code: reasonCode.value,
      remark: remark.value.trim(),
    })
    ElMessage.success('复核完成')
    queue.value = queue.value.filter((item) => item.id !== reviewedId)
    reasonCode.value = ''
    remark.value = ''
    const next = sortedQueue.value[0]
    if (next) {
      await selectTask(next.id)
    } else {
      activeId.value = 0
      detail.value = null
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const tag = target?.tagName ?? ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
  const key = event.key.toLowerCase()
  if (key === 'a') {
    event.preventDefault()
    void submitReview('PASS')
    return
  }
  if (key === 'r') {
    event.preventDefault()
    void submitReview('REJECT')
    return
  }
  if (key === 'n') {
    event.preventDefault()
    selectNext()
  }
}

onMounted(() => {
  void loadQueue()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="ap-page">
    <PageHeader title="待议复核" desc="人工复核待议任务并给出结论" />

    <div class="ap-review">
      <div class="ap-card ap-review__queue">
        <div class="ap-card__header">
          <span class="ap-card__title">待处理队列</span>
          <span class="ap-text-aux">{{ sortedQueue.length }}</span>
        </div>
        <div v-loading="queueLoading" class="ap-review__list">
          <div
            v-for="item in sortedQueue"
            :key="item.id"
            class="ap-review__item"
            :class="{ 'is-active': item.id === activeId }"
            @click="selectTask(item.id)"
          >
            <div class="ap-review__row">
              <span class="ap-mono ap-review__no">{{ item.task_no }}</span>
              <span class="ap-mono" :class="isOverdue(item) ? 'ap-text-danger' : 'ap-text-secondary'">
                {{ formatDuration(waitingMs(item)) }}
              </span>
            </div>
            <div class="ap-review__row">
              <span class="ap-truncate">{{ item.audit_name ?? '-' }}</span>
              <span class="ap-text-aux">{{ sourceTypeLabel(item.source_type) }}</span>
            </div>
          </div>
          <EmptyState v-if="!queueLoading && sortedQueue.length === 0" title="暂无待议任务" />
        </div>
      </div>

      <div class="ap-card ap-review__work">
        <div v-loading="detailLoading" class="ap-review__body">
          <template v-if="detail">
            <div class="ap-review__head">
              <span class="ap-mono ap-review__no">{{ detail.task_no }}</span>
              <StatusTag :label="taskStatusMeta(detail.status).label" :tone="taskStatusMeta(detail.status).tone" />
              <StatusTag :label="resultMeta(detail.result).label" :tone="resultMeta(detail.result).tone" />
              <span class="ap-text-secondary">{{ detail.audit_name ?? '-' }}</span>
              <span class="ap-text-secondary">{{ sourceTypeLabel(detail.source_type) }}</span>
              <span class="ap-mono ap-text-secondary">{{ formatDuration(detail.duration_ms) }}</span>
            </div>

            <div class="ap-review__section">
              <div class="ap-review__section-title">媒体</div>
              <div v-if="mediaItems.length > 0" class="ap-media">
                <div v-for="(item, index) in mediaItems" :key="index" class="ap-media__item">
                  <div class="ap-media__head">{{ mediaTypeLabel(item.type) }}</div>
                  <el-image
                    v-if="item.type === 'image' && item.url"
                    :src="item.url"
                    :preview-src-list="[item.url]"
                    preview-teleported
                    fit="contain"
                    class="ap-media__image"
                  />
                  <video
                    v-else-if="item.type === 'video' && item.url"
                    :src="item.url"
                    controls
                    class="ap-media__video"
                  />
                  <audio v-else-if="item.type === 'audio' && item.url" :src="item.url" controls />
                  <pre v-else-if="item.content" class="ap-media__text">{{ item.content }}</pre>
                  <span v-else class="ap-text-aux">-</span>
                </div>
              </div>
              <EmptyState v-else title="暂无媒体" />
            </div>

            <div class="ap-review__section">
              <div class="ap-review__section-title">规则命中</div>
              <div v-if="ruleGroups.length > 0" class="ap-rules">
                <div v-for="(group, index) in ruleGroups" :key="index" class="ap-rules__group">
                  <div class="ap-rules__head">
                    <span class="ap-rules__name">{{ group.rule }}</span>
                    <span class="ap-text-aux">{{ group.logic }}</span>
                    <StatusTag
                      :label="group.hit ? '命中' : '未命中'"
                      :tone="group.hit ? 'reject' : 'neutral'"
                    />
                  </div>
                  <el-table :data="group.items" class="ap-table ap-table--compact">
                    <el-table-column prop="field" label="字段" min-width="150" />
                    <el-table-column prop="operator" label="操作符" width="100" />
                    <el-table-column label="实际值" min-width="140">
                      <template #default="{ row }">
                        <span class="ap-mono">{{ row.actual ?? '-' }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="期望值" min-width="140">
                      <template #default="{ row }">
                        <span class="ap-mono">{{ row.expected ?? '-' }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="命中" width="90">
                      <template #default="{ row }">
                        <StatusTag
                          :label="row.hit ? '命中' : '未命中'"
                          :tone="row.hit ? 'reject' : 'neutral'"
                        />
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
              <EmptyState v-else title="暂无规则命中" />
            </div>

            <div class="ap-review__section">
              <div class="ap-review__section-title">模型结果</div>
              <div v-if="modelReasons.length > 0" class="ap-models">
                <div v-for="(item, index) in modelReasons" :key="index" class="ap-models__row">
                  <span>{{ reasonLabel(item) }}</span>
                </div>
              </div>
              <EmptyState v-else title="暂无模型结果" />
            </div>

            <div class="ap-review__section">
              <div class="ap-review__section-title">复核结论</div>
              <div class="ap-conclusion">
                <div class="ap-conclusion__field">
                  <span class="ap-conclusion__label">原因码</span>
                  <el-select v-model="reasonCode" class="ap-conclusion__select" placeholder="请选择原因码">
                    <el-option
                      v-for="item in REASON_CODES"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </div>
                <div class="ap-conclusion__field">
                  <span class="ap-conclusion__label">备注</span>
                  <el-input v-model="remark" type="textarea" :rows="2" maxlength="500" placeholder="备注" />
                </div>
                <div class="ap-conclusion__actions">
                  <el-tooltip :disabled="auth.can('task:review')" content="缺少 task:review 权限" placement="top">
                    <span>
                      <el-button
                        type="success"
                        :disabled="!auth.can('task:review')"
                        :loading="submitting"
                        @click="submitReview('PASS')"
                      >
                        通过（A）
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-tooltip :disabled="auth.can('task:review')" content="缺少 task:review 权限" placement="top">
                    <span>
                      <el-button
                        type="danger"
                        :disabled="!auth.can('task:review')"
                        :loading="submitting"
                        @click="submitReview('REJECT')"
                      >
                        不通过（R）
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-button :disabled="sortedQueue.length === 0" @click="selectNext">下一条（N）</el-button>
                </div>
              </div>
            </div>
          </template>

          <EmptyState v-else-if="!detailLoading" title="暂无待复核任务" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap-review {
  display: flex;
  align-items: flex-start;
  gap: var(--ap-space-4);
}

.ap-review__queue {
  width: 320px;
  flex: 0 0 320px;
}

.ap-review__list {
  max-height: 70vh;
  overflow: auto;
}

.ap-review__item {
  padding: var(--ap-space-3) var(--ap-space-4);
  border-bottom: 1px solid var(--ap-border);
  cursor: pointer;
}

.ap-review__item:hover {
  background: var(--ap-bg-page);
}

.ap-review__item.is-active {
  background: var(--ap-bg-page);
  border-left: 3px solid var(--ap-color-primary);
  padding-left: calc(var(--ap-space-4) - 3px);
}

.ap-review__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-2);
}

.ap-review__no {
  font-size: var(--ap-font-size-aux);
}

.ap-review__work {
  flex: 1;
  min-width: 0;
}

.ap-review__body {
  padding: var(--ap-space-5);
}

.ap-review__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ap-space-3);
  padding-bottom: var(--ap-space-3);
  border-bottom: 1px solid var(--ap-border);
}

.ap-review__section {
  margin-top: var(--ap-space-5);
}

.ap-review__section-title {
  margin-bottom: var(--ap-space-3);
  font-weight: 600;
  color: var(--ap-text-regular);
}

.ap-media {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-3);
}

.ap-media__item {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
}

.ap-media__head {
  margin-bottom: var(--ap-space-2);
  color: var(--ap-text-secondary);
}

.ap-media__image {
  max-width: 420px;
  max-height: 320px;
}

.ap-media__video {
  width: 100%;
  max-width: 640px;
}

.ap-media__text {
  margin: 0;
  padding: var(--ap-space-3);
  background: var(--ap-bg-page);
  border-radius: var(--ap-radius-card);
  white-space: pre-wrap;
  word-break: break-all;
}

.ap-rules {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-3);
}

.ap-rules__group {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
}

.ap-rules__head {
  display: flex;
  align-items: center;
  gap: var(--ap-space-3);
  margin-bottom: var(--ap-space-2);
}

.ap-rules__name {
  font-weight: 600;
}

.ap-models__row {
  padding: var(--ap-space-2) 0;
}

.ap-conclusion {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-3);
  max-width: 640px;
}

.ap-conclusion__field {
  display: flex;
  align-items: flex-start;
  gap: var(--ap-space-3);
}

.ap-conclusion__label {
  width: 60px;
  flex: 0 0 60px;
  color: var(--ap-text-secondary);
  line-height: 32px;
}

.ap-conclusion__select {
  width: 220px;
}

.ap-conclusion__actions {
  display: flex;
  gap: var(--ap-space-3);
}
</style>
