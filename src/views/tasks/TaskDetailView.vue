<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import { getTask, retryTask, retryTaskAction, stopTask } from '@/api/tasks'
import type { ActionExecLog, MediaItem, RuleGroupTrace, TaskDetail, TaskStatus } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatDuration, formatFullDateTime } from '@/utils/format'
import {
  actionTypeLabel,
  dedupeFlagMeta,
  mediaTypeLabel,
  resultMeta,
  sourceTypeLabel,
  taskStatusMeta,
} from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps<{ id: string }>()

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

type ReasonRow = {
  source: string
  label: string
  score: number | null
  rule: string
}

const auth = useAuthStore()

const detail = ref<TaskDetail | null>(null)
const loading = ref(false)
const error = ref('')
const activeTab = ref('overview')
const retryingActionId = ref(0)

const taskId = computed(() => {
  const raw = Number(props.id)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})

const isRunning = computed(() => (detail.value ? RUNNING_STATUSES.includes(detail.value.status) : false))

async function load() {
  if (taskId.value <= 0) {
    error.value = '任务 ID 无效'
    return
  }
  loading.value = true
  error.value = ''
  try {
    detail.value = await getTask(taskId.value)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
    detail.value = null
  } finally {
    loading.value = false
  }
}

const reasonRows = computed<ReasonRow[]>(() => {
  const rows = detail.value?.reasons ?? []
  return rows.map((item) => ({
    source: typeof item.source === 'string' ? item.source : '',
    label: typeof item.label === 'string' ? item.label : '',
    score: typeof item.score === 'number' ? item.score : null,
    rule: typeof item.rule === 'string' ? item.rule : '',
  }))
})

const mediaItems = computed<MediaItem[]>(() => detail.value?.media ?? [])

const ruleGroups = computed<RuleGroupTrace[]>(() => detail.value?.rule_hit ?? [])

const actionLogs = computed<ActionExecLog[]>(() => detail.value?.actions ?? [])

const events = computed(() => detail.value?.events ?? [])

function toJson(value: unknown): string {
  if (value === undefined || value === null) return '-'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function reasonText(row: ReasonRow): string {
  if (row.source === 'model') {
    return row.score === null ? row.label : `${row.label}（${row.score}）`
  }
  if (row.source === 'rule') return row.rule
  return row.label || row.rule || row.source
}

async function handleRetry() {
  if (!detail.value) return
  try {
    await retryTask(detail.value.id)
    ElMessage.success('已提交重试')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function handleStop() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(`确认强制停止任务「${detail.value.task_no}」？`, '强制停止', {
      confirmButtonText: '停止',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await stopTask(detail.value.id)
    ElMessage.success('任务已停止')
    await load()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function handleRetryAction(row: ActionExecLog) {
  if (!detail.value) return
  retryingActionId.value = row.id
  try {
    await retryTaskAction(detail.value.id, row.id)
    ElMessage.success('已提交重试')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    retryingActionId.value = 0
  }
}

onMounted(() => {
  void load()
})

watch(() => props.id, () => void load())
</script>

<template>
  <div class="ap-page">
    <PageHeader
      :title="detail ? `任务 ${detail.task_no}` : '任务详情'"
      :desc="detail ? `${sourceTypeLabel(detail.source_type)} · ${mediaTypeLabel(detail.media_type)}` : ''"
    >
      <template #actions>
        <el-tooltip :disabled="auth.can('task:retry')" content="缺少 task:retry 权限" placement="top">
          <span>
            <el-button
              type="primary"
              :disabled="!auth.can('task:retry') || !detail"
              @click="handleRetry"
            >
              重试任务
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="auth.can('task:stop')" content="缺少 task:stop 权限" placement="top">
          <span>
            <el-button
              type="danger"
              :disabled="!auth.can('task:stop') || !detail || !isRunning"
              @click="handleStop"
            >
              强制停止
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <div v-loading="loading">
      <el-alert
        v-if="error"
        class="ap-detail__alert"
        type="error"
        show-icon
        :closable="false"
        :title="error"
      />

      <template v-if="detail">
        <div class="ap-card">
          <div class="ap-card__body">
            <div class="ap-info">
              <div class="ap-info__item">
                <span class="ap-info__label">任务号</span>
                <span class="ap-mono">{{ detail.task_no }}</span>
              </div>
              <div class="ap-info__item">
                <span class="ap-info__label">状态</span>
                <StatusTag :label="taskStatusMeta(detail.status).label" :tone="taskStatusMeta(detail.status).tone" />
              </div>
              <div class="ap-info__item">
                <span class="ap-info__label">结果</span>
                <StatusTag :label="resultMeta(detail.result).label" :tone="resultMeta(detail.result).tone" />
              </div>
              <div class="ap-info__item">
                <span class="ap-info__label">来源</span>
                <span>{{ sourceTypeLabel(detail.source_type) }}</span>
              </div>
              <div class="ap-info__item">
                <span class="ap-info__label">耗时</span>
                <span class="ap-mono">{{ formatDuration(detail.duration_ms) }}</span>
              </div>
              <div class="ap-info__item">
                <span class="ap-info__label">重试次数</span>
                <span class="ap-mono">{{ detail.retry_count }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="ap-card">
          <el-tabs v-model="activeTab" class="ap-detail__tabs">
            <!-- 概览 -->
            <el-tab-pane label="概览" name="overview">
              <el-descriptions :column="3" border size="small">
                <el-descriptions-item label="项目">{{ detail.project_name ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="审核">{{ detail.audit_name ?? '-' }}</el-descriptions-item>
                <el-descriptions-item label="媒体类型">{{ mediaTypeLabel(detail.media_type) }}</el-descriptions-item>
                <el-descriptions-item label="业务键">
                  <span class="ap-mono">{{ detail.biz_key ?? '-' }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="去重标记">
                  <StatusTag
                    :label="dedupeFlagMeta(detail.dedupe_flag).label"
                    :tone="dedupeFlagMeta(detail.dedupe_flag).tone"
                  />
                </el-descriptions-item>
                <el-descriptions-item label="链路 ID">
                  <span class="ap-mono">{{ detail.trace_id ?? '-' }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="创建时间">
                  <span class="ap-mono">{{ formatFullDateTime(detail.created_at) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="完成时间">
                  <span class="ap-mono">{{ formatFullDateTime(detail.finished_at) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="错误码">
                  <span class="ap-mono">{{ detail.error_code ?? '-' }}</span>
                </el-descriptions-item>
              </el-descriptions>

              <el-alert
                v-if="detail.error_message"
                class="ap-detail__alert"
                type="error"
                show-icon
                :closable="false"
                :title="detail.error_message"
              />

              <h4 class="ap-detail__section">结果原因</h4>
              <el-table v-if="reasonRows.length > 0" :data="reasonRows" class="ap-table ap-table--compact">
                <el-table-column prop="source" label="来源" width="120">
                  <template #default="{ row }">
                    <span>{{ row.source === 'model' ? '模型' : row.source === 'rule' ? '规则' : row.source }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="原因" min-width="220">
                  <template #default="{ row }">
                    <span>{{ reasonText(row) }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="score" label="得分" width="110" align="right">
                  <template #default="{ row }">
                    <span class="ap-mono">{{ row.score === null ? '-' : row.score }}</span>
                  </template>
                </el-table-column>
              </el-table>
              <EmptyState v-else title="暂无结果原因" />
            </el-tab-pane>

            <!-- 媒体 -->
            <el-tab-pane label="媒体" name="media">
              <div v-if="mediaItems.length > 0" class="ap-media">
                <div v-for="(item, index) in mediaItems" :key="index" class="ap-media__item">
                  <div class="ap-media__head">
                    <span>{{ mediaTypeLabel(item.type) }}</span>
                  </div>
                  <el-image
                    v-if="item.type === 'image' && item.url"
                    :src="item.url"
                    :preview-src-list="[item.url]"
                    preview-teleported
                    fit="contain"
                    class="ap-media__image"
                  />
                  <video v-else-if="item.type === 'video' && item.url" :src="item.url" controls class="ap-media__video" />
                  <audio v-else-if="item.type === 'audio' && item.url" :src="item.url" controls />
                  <pre v-else-if="item.content" class="ap-media__text">{{ item.content }}</pre>
                  <span v-else class="ap-text-aux">-</span>
                </div>
              </div>
              <EmptyState v-else title="暂无媒体" />
            </el-tab-pane>

            <!-- 规则命中 -->
            <el-tab-pane label="规则命中" name="rule">
              <div v-if="ruleGroups.length > 0" class="ap-rules">
                <div v-for="(group, index) in ruleGroups" :key="index" class="ap-rules__group">
                  <div class="ap-rules__head">
                    <span class="ap-rules__name">{{ group.rule }}</span>
                    <span class="ap-text-aux">{{ group.logic }}</span>
                    <StatusTag
                      :label="group.hit ? '命中' : '未命中'"
                      :tone="group.hit ? 'reject' : 'neutral'"
                    />
                    <span v-if="group.skipped" class="ap-text-aux">已跳过</span>
                  </div>
                  <el-table :data="group.items" class="ap-table ap-table--compact">
                    <el-table-column prop="field" label="字段" min-width="160" />
                    <el-table-column prop="operator" label="操作符" width="110" />
                    <el-table-column label="实际值" min-width="160">
                      <template #default="{ row }">
                        <span class="ap-mono">{{ toJson(row.actual) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="期望值" min-width="160">
                      <template #default="{ row }">
                        <span class="ap-mono">{{ toJson(row.expected) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="是否命中" width="100">
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
            </el-tab-pane>

            <!-- 动作日志 -->
            <el-tab-pane label="动作日志" name="actions">
              <el-table v-if="actionLogs.length > 0" :data="actionLogs" class="ap-table ap-table--compact">
                <el-table-column type="expand">
                  <template #default="{ row }">
                    <div class="ap-action__detail">
                      <div>
                        <div class="ap-action__label">请求</div>
                        <pre class="ap-action__json">{{ toJson(row.request) }}</pre>
                      </div>
                      <div>
                        <div class="ap-action__label">响应</div>
                        <pre class="ap-action__json">{{ toJson(row.response) }}</pre>
                      </div>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="类型" min-width="160">
                  <template #default="{ row }">
                    <span>{{ actionTypeLabel(row.action_type) }}</span>
                    <span v-if="row.action_name" class="ap-text-secondary"> · {{ row.action_name }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="route_type" label="路线" width="100" />
                <el-table-column prop="status" label="状态" width="100">
                  <template #default="{ row }">
                    <StatusTag
                      :label="row.status === 'SUCCESS' ? '成功' : row.status === 'FAILED' ? '失败' : '跳过'"
                      :tone="row.status === 'SUCCESS' ? 'pass' : row.status === 'FAILED' ? 'reject' : 'neutral'"
                    />
                  </template>
                </el-table-column>
                <el-table-column prop="duration_ms" label="耗时" width="100" align="right">
                  <template #default="{ row }">
                    <span class="ap-mono">{{ formatDuration(row.duration_ms) }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="retry_count" label="重试次数" width="100" align="right">
                  <template #default="{ row }">
                    <span class="ap-mono">{{ row.retry_count }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="created_at" label="时间" width="160">
                  <template #default="{ row }">
                    <span class="ap-mono">{{ formatDateTime(row.created_at) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120" fixed="right">
                  <template #default="{ row }">
                    <el-tooltip
                      :disabled="auth.can('task:retry')"
                      content="缺少 task:retry 权限"
                      placement="top"
                    >
                      <span>
                        <el-button
                          link
                          type="primary"
                          :disabled="!auth.can('task:retry') || row.status !== 'FAILED'"
                          :loading="retryingActionId === row.id"
                          @click="handleRetryAction(row)"
                        >
                          重试
                        </el-button>
                      </span>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
              <EmptyState v-else title="暂无动作日志" />
            </el-tab-pane>

            <!-- 时间线 -->
            <el-tab-pane label="时间线" name="timeline">
              <el-timeline v-if="events.length > 0" class="ap-timeline">
                <el-timeline-item
                  v-for="(event, index) in events"
                  :key="index"
                  :timestamp="formatFullDateTime(event.created_at)"
                  placement="top"
                >
                  <div class="ap-timeline__row">
                    <StatusTag
                      :label="taskStatusMeta(event.to_status).label"
                      :tone="taskStatusMeta(event.to_status).tone"
                    />
                    <span v-if="event.from_status" class="ap-text-secondary">
                      由 {{ taskStatusMeta(event.from_status).label }} 迁移
                    </span>
                    <span class="ap-mono">{{ formatDuration(event.cost_ms) }}</span>
                  </div>
                  <p v-if="event.message" class="ap-timeline__message">{{ event.message }}</p>
                </el-timeline-item>
              </el-timeline>
              <EmptyState v-else title="暂无时间线" />
            </el-tab-pane>
          </el-tabs>
        </div>
      </template>

      <EmptyState v-else-if="!loading && !error" title="任务不存在" />
    </div>
  </div>
</template>

<style scoped>
.ap-detail__alert {
  margin-bottom: var(--ap-space-4);
}

.ap-detail__tabs {
  padding: 0 var(--ap-space-5) var(--ap-space-5);
}

.ap-info {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ap-space-5);
}

.ap-info__item {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
}

.ap-info__label {
  color: var(--ap-text-secondary);
}

.ap-detail__section {
  margin: var(--ap-space-5) 0 var(--ap-space-3);
  font-size: var(--ap-font-size-title);
  color: var(--ap-text-regular);
}

.ap-media {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-4);
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
  gap: var(--ap-space-4);
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

.ap-action__detail {
  display: flex;
  gap: var(--ap-space-4);
  padding: var(--ap-space-2) var(--ap-space-4);
}

.ap-action__detail > div {
  flex: 1;
  min-width: 0;
}

.ap-action__label {
  margin-bottom: var(--ap-space-1);
  color: var(--ap-text-secondary);
}

.ap-action__json {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: var(--ap-space-3);
  background: var(--ap-bg-page);
  border-radius: var(--ap-radius-card);
  font-size: var(--ap-font-size-aux);
  white-space: pre-wrap;
  word-break: break-all;
}

.ap-timeline__row {
  display: flex;
  align-items: center;
  gap: var(--ap-space-3);
}

.ap-timeline__message {
  margin: var(--ap-space-2) 0 0;
  color: var(--ap-text-secondary);
}
</style>
