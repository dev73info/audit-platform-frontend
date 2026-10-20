<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Component } from 'vue'
import { Coin, Connection, Promotion, Timer } from '@element-plus/icons-vue'

import { ApiError } from '@/api/http'
import {
  createTriggerSource,
  deleteTriggerSource,
  enableTriggerSource,
  listTriggerRecent,
  listTriggerSources,
  pauseTriggerSource,
  testTriggerSource,
  updateTriggerSource,
} from '@/api/audits'
import type { TriggerSourceItem, TriggerType } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { sourceTypeLabel } from '@/utils/labels'
import { formatRelative } from '@/utils/format'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps<{ id: string }>()

type TriggerStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED'

const TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: 'REDIS', label: 'Redis 队列' },
  { value: 'POLLING', label: '轮询接口' },
  { value: 'WEBSOCKET', label: 'WebSocket' },
  { value: 'OPENAPI', label: '开放 API' },
]

const TYPE_ICONS: Record<TriggerType, Component> = {
  REDIS: Coin,
  POLLING: Timer,
  WEBSOCKET: Connection,
  OPENAPI: Promotion,
}

const STATUS_OPTIONS: Array<{ value: TriggerStatus; label: string }> = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'PAUSED', label: '暂停' },
  { value: 'DISABLED', label: '停用' },
]

const AUTH_TYPE_OPTIONS = ['none', 'token', 'basic', 'sign']

/** 新增/编辑弹窗表单。 */
type TriggerForm = {
  id: number | null
  type: TriggerType
  name: string
  priority: number
  status: TriggerStatus
  stream: string
  group: string
  batch_size: number
  visibility_timeout_ms: number
  url: string
  interval_sec: number
  cursor_path: string
  biz_key_path: string
  page_size: number
  increment_field: string
  host: string
  path: string
  auth_type: string
  topics: string[]
  heartbeat_sec: number
  sync_wait_ms: number
  require_biz_key: boolean
}

const auth = useAuthStore()

const auditId = computed(() => {
  const raw = Number(props.id)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})

const canRead = computed(() => auth.can('trigger:read'))
const canWrite = computed(() => auth.can('trigger:write'))
const canDelete = computed(() => auth.can('audit:delete'))

const items = ref<TriggerSourceItem[]>([])
const loading = ref(false)
const error = ref('')

/* ---------------- 表单 ---------------- */

function emptyForm(): TriggerForm {
  return {
    id: null,
    type: 'REDIS',
    name: '',
    priority: 10,
    status: 'ACTIVE',
    stream: '',
    group: '',
    batch_size: 16,
    visibility_timeout_ms: 60000,
    url: '',
    interval_sec: 10,
    cursor_path: '',
    biz_key_path: '',
    page_size: 50,
    increment_field: '',
    host: '',
    path: '',
    auth_type: 'none',
    topics: [],
    heartbeat_sec: 30,
    sync_wait_ms: 5000,
    require_biz_key: true,
  }
}

const dialogVisible = ref(false)
const dialogSaving = ref(false)
const form = ref<TriggerForm>(emptyForm())

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  if (value === null || value === undefined) return ''
  return String(value)
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const raw = Number(config[key])
  return Number.isFinite(raw) ? raw : fallback
}

function readBool(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = config[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readTopics(config: Record<string, unknown>): string[] {
  const value = config.topics
  if (Array.isArray(value)) return value.map((entry) => String(entry))
  if (typeof value === 'string' && value.trim()) return value.split(',').map((entry) => entry.trim())
  return []
}

function toForm(item: TriggerSourceItem): TriggerForm {
  const base = emptyForm()
  const config = item.config ?? {}
  return {
    ...base,
    id: item.id,
    type: item.type,
    name: item.name,
    priority: item.priority,
    status: item.status,
    stream: readString(config, 'stream'),
    group: readString(config, 'group'),
    batch_size: readNumber(config, 'batch_size', base.batch_size),
    visibility_timeout_ms: readNumber(config, 'visibility_timeout_ms', base.visibility_timeout_ms),
    url: readString(config, 'url'),
    interval_sec: readNumber(config, 'interval_sec', base.interval_sec),
    cursor_path: readString(config, 'cursor_path'),
    biz_key_path: readString(config, 'biz_key_path'),
    page_size: readNumber(config, 'page_size', base.page_size),
    increment_field: readString(config, 'increment_field'),
    host: readString(config, 'host'),
    path: readString(config, 'path'),
    auth_type: readString(config, 'auth_type') || base.auth_type,
    topics: readTopics(config),
    heartbeat_sec: readNumber(config, 'heartbeat_sec', base.heartbeat_sec),
    sync_wait_ms: readNumber(config, 'sync_wait_ms', base.sync_wait_ms),
    require_biz_key: readBool(config, 'require_biz_key', base.require_biz_key),
  }
}

function toConfig(target: TriggerForm): Record<string, unknown> {
  switch (target.type) {
    case 'REDIS':
      return {
        stream: target.stream.trim(),
        group: target.group.trim(),
        batch_size: target.batch_size,
        visibility_timeout_ms: target.visibility_timeout_ms,
      }
    case 'POLLING':
      return {
        url: target.url.trim(),
        interval_sec: target.interval_sec,
        cursor_path: target.cursor_path.trim(),
        biz_key_path: target.biz_key_path.trim(),
        page_size: target.page_size,
        increment_field: target.increment_field.trim(),
      }
    case 'WEBSOCKET':
      return {
        host: target.host.trim(),
        path: target.path.trim(),
        auth_type: target.auth_type,
        topics: target.topics,
        heartbeat_sec: target.heartbeat_sec,
      }
    case 'OPENAPI':
      return {
        sync_wait_ms: target.sync_wait_ms,
        require_biz_key: target.require_biz_key,
      }
  }
}

function openCreate() {
  form.value = emptyForm()
  dialogVisible.value = true
}

function openEdit(item: TriggerSourceItem) {
  form.value = toForm(item)
  dialogVisible.value = true
}

async function submitForm() {
  const target = form.value
  if (!target.name.trim()) {
    ElMessage.error('触发源名称不能为空')
    return
  }
  dialogSaving.value = true
  try {
    const payload = {
      type: target.type,
      name: target.name.trim(),
      priority: target.priority,
      status: target.status,
      config: toConfig(target),
    }
    if (target.id === null) {
      await createTriggerSource(auditId.value, payload)
    } else {
      await updateTriggerSource(target.id, payload)
    }
    ElMessage.success(target.id === null ? '触发源已新增' : '触发源已保存')
    dialogVisible.value = false
    await loadItems()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    dialogSaving.value = false
  }
}

/* ---------------- 列表 ---------------- */

async function loadItems() {
  if (!auditId.value) return
  loading.value = true
  error.value = ''
  try {
    const payload = await listTriggerSources(auditId.value, { page: 1, page_size: 100 })
    items.value = [...(payload.items ?? [])].sort((a, b) => a.priority - b.priority)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
    items.value = []
  } finally {
    loading.value = false
  }
}

function successRate(item: TriggerSourceItem): number | null {
  const total = item.success_count + item.fail_count
  if (!total) return null
  return item.success_count / total
}

function rateLabel(item: TriggerSourceItem): string {
  const rate = successRate(item)
  if (rate === null) return '-'
  return `${(rate * 100).toFixed(1)}%`
}

function statusTone(status: TriggerStatus): 'pass' | 'review' | 'neutral' {
  if (status === 'ACTIVE') return 'pass'
  if (status === 'PAUSED') return 'review'
  return 'neutral'
}

async function toggleStatus(item: TriggerSourceItem, value: boolean | string | number) {
  const next = typeof value === 'string' ? value : value ? 'ACTIVE' : 'PAUSED'
  try {
    if (next === 'ACTIVE') {
      await enableTriggerSource(item.id)
    } else {
      await pauseTriggerSource(item.id)
    }
    ElMessage.success(next === 'ACTIVE' ? '触发源已启用' : '触发源已暂停')
    await loadItems()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function runTest(item: TriggerSourceItem) {
  try {
    const result = await testTriggerSource(item.id)
    if (result.ok) {
      ElMessage.success(result.message ?? '测试消息已发送')
    } else {
      ElMessage.error(result.message ?? '测试失败')
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function removeItem(item: TriggerSourceItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除触发源「${item.name}」？删除前请确认该触发源没有运行中的任务。`,
      '删除触发源',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    return
  }
  try {
    await deleteTriggerSource(item.id)
    ElMessage.success('触发源已删除')
    await loadItems()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 消费记录 ---------------- */

const expandedId = ref<number | null>(null)
const recent = ref<Record<string, unknown>[]>([])
const recentLoading = ref(false)

function pickValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        continue
      }
    }
    return String(value)
  }
  return '-'
}

async function toggleRecent(item: TriggerSourceItem) {
  if (expandedId.value === item.id) {
    expandedId.value = null
    return
  }
  expandedId.value = item.id
  recent.value = []
  recentLoading.value = true
  try {
    const payload = await listTriggerRecent(item.id)
    recent.value = (payload.items ?? []).slice(0, 50)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    recentLoading.value = false
  }
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void loadItems()
})

watch(auditId, () => {
  void loadItems()
})
</script>

<template>
  <div class="ap-page">
    <PageHeader title="触发源" desc="触发源配置、运行状态与最近消费记录">
      <template #actions>
        <el-tooltip :disabled="canWrite" content="缺少 trigger:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!canWrite" @click="openCreate">新增触发源</el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <el-alert
      v-if="error"
      class="ap-card"
      type="error"
      show-icon
      :closable="false"
      :title="error"
    />

    <div v-loading="loading">
      <EmptyState
        v-if="!loading && items.length === 0"
        title="暂无触发源"
        desc="新增触发源以接入任务来源"
      >
        <el-tooltip :disabled="canWrite" content="缺少 trigger:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!canWrite" @click="openCreate">新增触发源</el-button>
          </span>
        </el-tooltip>
      </EmptyState>

      <div v-for="item in items" :key="item.id" class="ap-card trigger-card">
        <div class="ap-card__header">
          <div class="ap-flex ap-gap-2 ap-flex-center">
            <el-icon class="trigger-card__icon"><component :is="TYPE_ICONS[item.type]" /></el-icon>
            <span class="ap-card__title">{{ item.name }}</span>
            <el-tag size="small" type="info" effect="plain">{{ sourceTypeLabel(item.type) }}</el-tag>
            <StatusTag :label="item.status" :tone="statusTone(item.status)" />
          </div>
          <div class="ap-flex ap-gap-2 ap-flex-center">
            <el-tooltip :disabled="canWrite" content="缺少 trigger:write 权限" placement="top">
              <span>
                <el-button size="small" :disabled="!canWrite" @click="runTest(item)">测试</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="canWrite" content="缺少 trigger:write 权限" placement="top">
              <span>
                <el-button size="small" :disabled="!canWrite" @click="openEdit(item)">编辑</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="canDelete" content="缺少 audit:delete 权限" placement="top">
              <span>
                <el-button size="small" type="danger" :disabled="!canDelete" @click="removeItem(item)">
                  删除
                </el-button>
              </span>
            </el-tooltip>
            <el-switch
              :model-value="item.status"
              active-value="ACTIVE"
              inactive-value="PAUSED"
              :disabled="!canWrite"
              @update:model-value="(v: boolean | string | number) => toggleStatus(item, v)"
            />
          </div>
        </div>

        <div class="ap-card__body">
          <div class="trigger-card__meta">
            <div class="trigger-card__field">
              <span class="ap-text-aux">优先级</span>
              <span class="ap-mono">P{{ item.priority }}</span>
            </div>
            <div class="trigger-card__field">
              <span class="ap-text-aux">最近消费</span>
              <span>{{ formatRelative(item.last_consume_at) }}</span>
            </div>
            <div class="trigger-card__field">
              <span class="ap-text-aux">成功率</span>
              <span class="ap-mono">{{ rateLabel(item) }}</span>
            </div>
            <div class="trigger-card__field">
              <span class="ap-text-aux">成功 / 失败</span>
              <span class="ap-mono">{{ item.success_count }} / {{ item.fail_count }}</span>
            </div>
          </div>

          <div v-if="item.last_error" class="ap-text-danger trigger-card__error ap-truncate">
            {{ item.last_error }}
          </div>

          <div class="ap-flex ap-gap-2 ap-flex-center trigger-card__ops">
            <el-button link size="small" @click="toggleRecent(item)">
              {{ expandedId === item.id ? '收起消费记录' : '查看消费记录' }}
            </el-button>
          </div>

          <div v-if="expandedId === item.id" class="trigger-card__recent" v-loading="recentLoading">
            <el-table :data="recent" class="ap-table ap-table--compact">
              <el-table-column label="消息 ID" min-width="180">
                <template #default="{ row }">
                  <span class="ap-mono ap-truncate">{{ pickValue(row, ['message_id', 'msg_id', 'id']) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="解析状态" width="120">
                <template #default="{ row }">
                  <span class="ap-mono">{{ pickValue(row, ['parse_status', 'status', 'result']) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="耗时" width="120" align="right">
                <template #default="{ row }">
                  <span class="ap-mono">{{ pickValue(row, ['duration_ms', 'cost_ms', 'latency_ms']) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="错误" min-width="200">
                <template #default="{ row }">
                  <span class="ap-truncate">{{ pickValue(row, ['error', 'error_message', 'message']) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="form.id === null ? '新增触发源' : '编辑触发源'" width="640px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="类型">
          <el-select v-model="form.type" class="ap-grow" :disabled="form.id !== null">
            <el-option
              v-for="option in TYPE_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" maxlength="64" placeholder="触发源名称" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="1" :max="9999" controls-position="right" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" class="ap-grow">
            <el-option
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <template v-if="form.type === 'REDIS'">
          <el-form-item label="Stream">
            <el-input v-model="form.stream" placeholder="stream" />
          </el-form-item>
          <el-form-item label="Group">
            <el-input v-model="form.group" placeholder="group" />
          </el-form-item>
          <el-form-item label="批量大小">
            <el-input-number
              :model-value="form.batch_size"
              :min="1"
              :max="1000"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.batch_size = v ?? 16)"
            />
          </el-form-item>
          <el-form-item label="可见性超时">
            <el-input-number
              :model-value="form.visibility_timeout_ms"
              :min="1000"
              :max="3600000"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.visibility_timeout_ms = v ?? 60000)"
            />
          </el-form-item>
        </template>

        <template v-else-if="form.type === 'POLLING'">
          <el-form-item label="接口地址">
            <el-input v-model="form.url" placeholder="轮询接口地址" />
          </el-form-item>
          <el-form-item label="轮询间隔(秒)">
            <el-input-number
              :model-value="form.interval_sec"
              :min="1"
              :max="86400"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.interval_sec = v ?? 10)"
            />
          </el-form-item>
          <el-form-item label="游标路径">
            <el-input v-model="form.cursor_path" placeholder="data.cursor" />
          </el-form-item>
          <el-form-item label="业务键路径">
            <el-input v-model="form.biz_key_path" placeholder="data.biz_key" />
          </el-form-item>
          <el-form-item label="每页条数">
            <el-input-number
              :model-value="form.page_size"
              :min="1"
              :max="1000"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.page_size = v ?? 50)"
            />
          </el-form-item>
          <el-form-item label="递增字段">
            <el-input v-model="form.increment_field" placeholder="id" />
          </el-form-item>
        </template>

        <template v-else-if="form.type === 'WEBSOCKET'">
          <el-form-item label="主机">
            <el-input v-model="form.host" placeholder="WebSocket 主机地址" />
          </el-form-item>
          <el-form-item label="路径">
            <el-input v-model="form.path" placeholder="/ws" />
          </el-form-item>
          <el-form-item label="鉴权方式">
            <el-select v-model="form.auth_type" class="ap-grow">
              <el-option v-for="option in AUTH_TYPE_OPTIONS" :key="option" :label="option" :value="option" />
            </el-select>
          </el-form-item>
          <el-form-item label="订阅主题">
            <el-select
              v-model="form.topics"
              multiple
              filterable
              allow-create
              default-first-option
              class="ap-grow"
              placeholder="请选择或输入主题"
            >
              <el-option v-for="topic in form.topics" :key="topic" :label="topic" :value="topic" />
            </el-select>
          </el-form-item>
          <el-form-item label="心跳间隔(秒)">
            <el-input-number
              :model-value="form.heartbeat_sec"
              :min="1"
              :max="3600"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.heartbeat_sec = v ?? 30)"
            />
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="同步等待(ms)">
            <el-input-number
              :model-value="form.sync_wait_ms"
              :min="0"
              :max="600000"
              controls-position="right"
              @update:model-value="(v: number | undefined) => (form.sync_wait_ms = v ?? 5000)"
            />
          </el-form-item>
          <el-form-item label="必须业务键">
            <el-switch v-model="form.require_biz_key" />
          </el-form-item>
        </template>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogSaving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.trigger-card {
  margin-bottom: var(--ap-space-3);
}

.trigger-card__icon {
  color: var(--ap-color-primary);
  font-size: 18px;
}

.trigger-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ap-space-5);
}

.trigger-card__field {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-1);
  min-width: 120px;
}

.trigger-card__error {
  margin-top: var(--ap-space-2);
}

.trigger-card__ops {
  margin-top: var(--ap-space-2);
}

.trigger-card__recent {
  margin-top: var(--ap-space-2);
}
</style>
