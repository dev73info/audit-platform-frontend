<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import type { Component } from 'vue'
import { Coin, Connection, Promotion, Timer } from '@element-plus/icons-vue'

import { ApiError } from '@/api/http'
import {
  createRule,
  createTriggerSource,
  deleteRule,
  deleteTriggerSource,
  enableAudit,
  getAudit,
  listRoutes,
  listRules,
  listTriggerSources,
  saveRoute,
  testTriggerSource,
  updateAudit,
  updateRule,
  updateTriggerSource,
} from '@/api/audits'
import type {
  ActionSpec,
  ActionType,
  AuditItem,
  AuditStatus,
  ResultRoute,
  RuleGroup,
  RuleItem,
  TaskResult,
  TriggerSourceItem,
  TriggerType,
} from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { actionTypeLabel, mediaTypeLabel, resultMeta } from '@/utils/labels'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

/* ---------------- 常量 ---------------- */

type Aggregate = 'worst' | 'majority' | 'threshold'
type ExecMode = 'sequential' | 'parallel'
type OnError = 'continue' | 'abort' | 'to_review'
type ResultKey = 'PASS' | 'REJECT' | 'REVIEW'

const RESULT_KEYS: ResultKey[] = ['PASS', 'REJECT', 'REVIEW']

const MEDIA_TYPE_OPTIONS = ['text', 'image', 'video', 'audio']

const AUDIT_STATUS_OPTIONS: Array<{ value: AuditStatus; label: string }> = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'ACTIVE', label: '启用' },
  { value: 'PAUSED', label: '暂停' },
]

const RESULT_OPTIONS: Array<{ value: TaskResult; label: string }> = [
  { value: 'PASS', label: resultMeta('PASS').label },
  { value: 'REJECT', label: resultMeta('REJECT').label },
  { value: 'REVIEW', label: resultMeta('REVIEW').label },
]

const BACKOFF_OPTIONS = ['exponential', 'fixed', 'linear']

const AGGREGATE_OPTIONS: Array<{ value: Aggregate; label: string }> = [
  { value: 'worst', label: '取最差' },
  { value: 'majority', label: '取多数' },
  { value: 'threshold', label: '按阈值' },
]

const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: 'REDIS', label: 'Redis 队列' },
  { value: 'POLLING', label: '轮询接口' },
  { value: 'WEBSOCKET', label: 'WebSocket' },
  { value: 'OPENAPI', label: '开放 API' },
]

const TRIGGER_TYPE_ICONS: Record<TriggerType, Component> = {
  REDIS: Coin,
  POLLING: Timer,
  WEBSOCKET: Connection,
  OPENAPI: Promotion,
}

const EXEC_MODE_OPTIONS: Array<{ value: ExecMode; label: string }> = [
  { value: 'sequential', label: '顺序执行' },
  { value: 'parallel', label: '并行执行' },
]

const ON_ERROR_OPTIONS: Array<{ value: OnError; label: string }> = [
  { value: 'continue', label: '继续执行' },
  { value: 'abort', label: '终止执行' },
  { value: 'to_review', label: '转待议' },
]

const ACTION_TYPE_OPTIONS: Array<{ value: ActionType; label: string }> = [
  { value: 'HTTP', label: 'HTTP API' },
  { value: 'REDIS', label: 'Redis 命令' },
  { value: 'MYSQL', label: 'MySQL 更新' },
  { value: 'WEBHOOK', label: 'Webhook' },
  { value: 'MQ', label: '消息队列' },
]

const HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE']
const REDIS_COMMANDS = ['SET', 'HSET', 'LPUSH', 'SADD', 'ZADD', 'PUBLISH', 'EXPIRE', 'DEL']

const GROUP_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'PAUSED', label: '暂停' },
  { value: 'DISABLED', label: '停用' },
]

const FIELD_OPTIONS = [
  { value: 'media.text', label: 'media.text · 全部文本内容拼接' },
  { value: 'media.text_len', label: 'media.text_len · 文本长度' },
  { value: 'media.count', label: 'media.count · 媒体数量' },
  { value: 'media.type', label: 'media.type · 媒体类型集合' },
  { value: 'media.size_bytes', label: 'media.size_bytes · 媒体总大小' },
  { value: 'media.hash', label: 'media.hash · 媒体指纹' },
  { value: 'model.label', label: 'model.label · 模型返回标签' },
  { value: 'model.score', label: 'model.score · 模型置信度' },
  { value: 'model.risk_level', label: 'model.risk_level · 归一化风险等级' },
  { value: 'task.source_type', label: 'task.source_type · 触发来源' },
  { value: 'task.submit_hour', label: 'task.submit_hour · 提交小时' },
]

const OPERATOR_OPTIONS = [
  { value: 'eq', label: 'eq · 等于' },
  { value: 'ne', label: 'ne · 不等于' },
  { value: 'gt', label: 'gt · 大于' },
  { value: 'gte', label: 'gte · 大于等于' },
  { value: 'lt', label: 'lt · 小于' },
  { value: 'lte', label: 'lte · 小于等于' },
  { value: 'between', label: 'between · 介于' },
  { value: 'in', label: 'in · 属于' },
  { value: 'not_in', label: 'not_in · 不属于' },
  { value: 'contains', label: 'contains · 包含' },
  { value: 'not_contains', label: 'not_contains · 不包含' },
  { value: 'contains_any', label: 'contains_any · 包含任一' },
  { value: 'contains_all', label: 'contains_all · 包含全部' },
  { value: 'starts_with', label: 'starts_with · 前缀匹配' },
  { value: 'ends_with', label: 'ends_with · 后缀匹配' },
  { value: 'regex', label: 'regex · 正则匹配' },
  { value: 'length_gt', label: 'length_gt · 长度大于' },
  { value: 'length_lt', label: 'length_lt · 长度小于' },
  { value: 'is_null', label: 'is_null · 为空值' },
  { value: 'is_not_null', label: 'is_not_null · 非空值' },
  { value: 'is_empty', label: 'is_empty · 为空' },
  { value: 'is_not_empty', label: 'is_not_empty · 非空' },
  { value: 'score_gt', label: 'score_gt · 分数大于' },
  { value: 'score_lt', label: 'score_lt · 分数小于' },
  { value: 'label_in', label: 'label_in · 标签属于' },
  { value: 'risk_in', label: 'risk_in · 风险等级属于' },
]

const LABEL_OPTIONS = ['porn', 'violence', 'politics', 'ad', 'spam', 'other']
const RISK_OPTIONS = ['low', 'medium', 'high']

const VARIABLE_GROUPS: Array<{ title: string; items: string[] }> = [
  {
    title: '变量',
    items: [
      '{{task.id}}',
      '{{task.result}}',
      '{{task.biz_key}}',
      '{{task.task_no}}',
      '{{media.url}}',
      '{{media.text}}',
      '{{model.label}}',
      '{{model.score}}',
      '{{ext.user_id}}',
      '{{now}}',
      '{{now_ms}}',
    ],
  },
  {
    title: '过滤器',
    items: [
      '{{ media.text | truncate:200 }}',
      '{{ model.score | round:2 }}',
      "{{ ext.user_id | default:'anonymous' }}",
    ],
  },
  {
    title: '内置函数',
    items: ['uuid()', 'sha256(x)', 'json_escape(x)', 'url_encode(x)'],
  },
]

/* ---------------- 类型 ---------------- */

type MediaReviewConfig = {
  text: { api_ref: string; enable_keyword: boolean; keyword_groups: string[] }
  image: { api_ref: string; enable_ocr: boolean; labels: string[]; aggregate: Aggregate }
  video: { api_ref: string; fps: number; max_frames: number; aggregate: Aggregate; threshold: number }
}

type EditForm = {
  name: string
  code: string
  media_types: string[]
  description: string
  status: AuditStatus
  concurrency: number
  timeout_ms: number
  dedupe_window_sec: number
  media_hash_in_key: boolean
  max_attempts: number
  backoff: string
  base_ms: number
  default_result: TaskResult
  on_model_fail: TaskResult
  media_review: MediaReviewConfig
}

type TriggerForm = {
  id: number | null
  type: TriggerType
  name: string
  priority: number
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED'
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

type RuleItemDraft = {
  field: string
  operator: string
  value: unknown
  case_sensitive: boolean
  negate: boolean
  sort_order: number
}

type RuleGroupDraft = {
  id: number | null
  name: string
  priority: number
  logic: 'AND' | 'OR'
  stop_on_hit: boolean
  on_hit_result: TaskResult
  status: string
  items: RuleItemDraft[]
}

type ActionDraft = {
  uid: string
  id: string | null
  type: ActionType
  name: string
  api_ref: string
  method: string
  path: string
  headers_text: string
  body_text: string
  timeout_ms: number
  retry_text: string
  command: string
  redis_key: string
  value_text: string
  ttl_sec: number
  datasource: string
  sql: string
  params_text: string
  url: string
  sign_text: string
  target: string
  topic: string
}

type RouteDraft = {
  exec_mode: ExecMode
  on_error: OnError
  actions: ActionDraft[]
}

/* ---------------- 状态 ---------------- */

const auth = useAuthStore()

const auditId = computed(() => {
  const raw = Number(props.id)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})

const canAuditRead = computed(() => auth.can('audit:read'))
const canAuditWrite = computed(() => auth.can('audit:write'))
const canTriggerWrite = computed(() => auth.can('trigger:write'))
const canRuleWrite = computed(() => auth.can('rule:write'))
const canRouteWrite = computed(() => auth.can('route:write'))
const canDelete = computed(() => auth.can('audit:delete'))

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const dirty = ref(false)
const activeTab = ref('basic')

function emptyForm(): EditForm {
  return {
    name: '',
    code: '',
    media_types: ['text'],
    description: '',
    status: 'DRAFT',
    concurrency: 5,
    timeout_ms: 30000,
    dedupe_window_sec: 86400,
    media_hash_in_key: true,
    max_attempts: 3,
    backoff: 'exponential',
    base_ms: 500,
    default_result: 'REVIEW',
    on_model_fail: 'REVIEW',
    media_review: {
      text: { api_ref: '', enable_keyword: true, keyword_groups: [] },
      image: { api_ref: '', enable_ocr: false, labels: [], aggregate: 'worst' },
      video: { api_ref: '', fps: 1, max_frames: 300, aggregate: 'worst', threshold: 1 },
    },
  }
}

const form = ref<EditForm>(emptyForm())

/* ---------------- 加载 ---------------- */

function readString(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key]
  if (value === null || value === undefined) return fallback
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

function readStringList(config: Record<string, unknown>, key: string): string[] {
  const value = config[key]
  if (Array.isArray(value)) return value.map((entry) => String(entry))
  if (typeof value === 'string' && value.trim()) return value.split(',').map((entry) => entry.trim())
  return []
}

function readAggregate(value: unknown, fallback: Aggregate): Aggregate {
  if (value === 'worst' || value === 'majority' || value === 'threshold') return value
  return fallback
}

function toMediaReview(raw: Record<string, unknown> | undefined): MediaReviewConfig {
  const base = emptyForm().media_review
  const source = raw ?? {}
  const text = (source.text ?? {}) as Record<string, unknown>
  const image = (source.image ?? {}) as Record<string, unknown>
  const video = (source.video ?? {}) as Record<string, unknown>
  return {
    text: {
      api_ref: readString(text, 'api_ref', base.text.api_ref),
      enable_keyword: readBool(text, 'enable_keyword', base.text.enable_keyword),
      keyword_groups: readStringList(text, 'keyword_groups'),
    },
    image: {
      api_ref: readString(image, 'api_ref', base.image.api_ref),
      enable_ocr: readBool(image, 'enable_ocr', base.image.enable_ocr),
      labels: readStringList(image, 'labels'),
      aggregate: readAggregate(image.aggregate, base.image.aggregate),
    },
    video: {
      api_ref: readString(video, 'api_ref', base.video.api_ref),
      fps: readNumber(video, 'fps', base.video.fps),
      max_frames: readNumber(video, 'max_frames', base.video.max_frames),
      aggregate: readAggregate(video.aggregate, base.video.aggregate),
      threshold: readNumber(video, 'threshold', base.video.threshold),
    },
  }
}

async function loadAudit() {
  if (!auditId.value) return
  loading.value = true
  error.value = ''
  try {
    const detail = await getAudit(auditId.value)
    const retry = (detail.retry_policy ?? {}) as Record<string, unknown>
    form.value = {
      name: detail.name ?? '',
      code: detail.code ?? '',
      media_types: [...(detail.media_types ?? [])],
      description: detail.description ?? '',
      status: detail.status ?? 'DRAFT',
      concurrency: detail.concurrency ?? 5,
      timeout_ms: detail.timeout_ms ?? 30000,
      dedupe_window_sec: detail.dedupe_window_sec ?? 86400,
      media_hash_in_key: detail.media_hash_in_key ?? true,
      max_attempts: readNumber(retry, 'max_attempts', 3),
      backoff: readString(retry, 'backoff', 'exponential'),
      base_ms: readNumber(retry, 'base_ms', 500),
      default_result: detail.default_result ?? 'REVIEW',
      on_model_fail: detail.on_model_fail ?? 'REVIEW',
      media_review: toMediaReview(detail.media_review),
    }
    await loadTriggers()
    await loadRules()
    await loadRoutes()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

/* ---------------- 触发源 ---------------- */

const triggers = ref<TriggerForm[]>([])

function emptyTrigger(): TriggerForm {
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

function toTriggerForm(item: TriggerSourceItem): TriggerForm {
  const base = emptyTrigger()
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
    auth_type: readString(config, 'auth_type', base.auth_type),
    topics: readStringList(config, 'topics'),
    heartbeat_sec: readNumber(config, 'heartbeat_sec', base.heartbeat_sec),
    sync_wait_ms: readNumber(config, 'sync_wait_ms', base.sync_wait_ms),
    require_biz_key: readBool(config, 'require_biz_key', base.require_biz_key),
  }
}

function toTriggerConfig(target: TriggerForm): Record<string, unknown> {
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

async function loadTriggers() {
  try {
    const payload = await listTriggerSources(auditId.value, { page: 1, page_size: 100 })
    triggers.value = [...(payload.items ?? [])]
      .map((item) => toTriggerForm(item))
      .sort((a, b) => a.priority - b.priority)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

function addTrigger() {
  triggers.value.push(emptyTrigger())
  markDirty()
}

function removeTrigger(index: number) {
  triggers.value.splice(index, 1)
  markDirty()
}

async function saveTrigger(index: number) {
  const target = triggers.value[index]
  if (!target) return
  if (!target.name.trim()) {
    ElMessage.error('触发源名称不能为空')
    return
  }
  try {
    const payload = {
      type: target.type,
      name: target.name.trim(),
      priority: target.priority,
      status: target.status,
      config: toTriggerConfig(target),
    }
    if (target.id === null) {
      const created = await createTriggerSource(auditId.value, payload)
      target.id = created.id
    } else {
      await updateTriggerSource(target.id, payload)
    }
    ElMessage.success('触发源已保存')
    await loadTriggers()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function testTrigger(index: number) {
  const target = triggers.value[index]
  if (!target || target.id === null) {
    ElMessage.error('请先保存触发源')
    return
  }
  try {
    const result = await testTriggerSource(target.id)
    if (result.ok) {
      ElMessage.success(result.message ?? '测试消息已发送')
    } else {
      ElMessage.error(result.message ?? '测试失败')
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function deleteTrigger(index: number) {
  const target = triggers.value[index]
  if (!target) return
  if (target.id === null) {
    removeTrigger(index)
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除触发源「${target.name}」？删除前请确认该触发源没有运行中的任务。`,
      '删除触发源',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await deleteTriggerSource(target.id)
    ElMessage.success('触发源已删除')
    await loadTriggers()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 规则 ---------------- */

const rules = ref<RuleGroupDraft[]>([])

function toRuleDraft(group: RuleGroup): RuleGroupDraft {
  return {
    id: group.id ?? null,
    name: group.name,
    priority: group.priority,
    logic: group.logic,
    stop_on_hit: group.stop_on_hit,
    on_hit_result: group.on_hit_result,
    status: group.status,
    items: (group.items ?? []).map((item, index) => ({
      field: item.field,
      operator: item.operator,
      value: item.value,
      case_sensitive: item.case_sensitive,
      negate: item.negate,
      sort_order: item.sort_order ?? index,
    })),
  }
}

async function loadRules() {
  try {
    const payload = await listRules(auditId.value)
    rules.value = [...payload.items ?? []].sort((a, b) => a.priority - b.priority).map((group) => toRuleDraft(group))
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

function addRuleGroup() {
  const maxPriority = rules.value.reduce((max, item) => Math.max(max, item.priority), 0)
  rules.value.push({
    id: null,
    name: `规则组 ${rules.value.length + 1}`,
    priority: maxPriority + 10,
    logic: 'AND',
    stop_on_hit: true,
    on_hit_result: 'REVIEW',
    status: 'ACTIVE',
    items: [],
  })
  markDirty()
}

function removeRuleGroup(index: number) {
  rules.value.splice(index, 1)
  markDirty()
}

function moveRuleGroup(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= rules.value.length) return
  const current = rules.value[index]
  const swapped = rules.value[target]
  if (!current || !swapped) return
  rules.value[index] = swapped
  rules.value[target] = current
  markDirty()
}

function addRuleItem(group: RuleGroupDraft) {
  group.items.push({
    field: 'media.text',
    operator: 'contains_any',
    value: [],
    case_sensitive: false,
    negate: false,
    sort_order: group.items.length,
  })
  markDirty()
}

function removeRuleItem(group: RuleGroupDraft, index: number) {
  group.items.splice(index, 1)
  group.items.forEach((item, order) => {
    item.sort_order = order
  })
  markDirty()
}

type ValueMode = 'none' | 'text' | 'number' | 'multi' | 'between'

function valueMode(operator: string): ValueMode {
  switch (operator) {
    case 'between':
      return 'between'
    case 'in':
    case 'not_in':
    case 'contains_any':
    case 'contains_all':
    case 'label_in':
    case 'risk_in':
      return 'multi'
    case 'regex':
    case 'contains':
    case 'not_contains':
    case 'starts_with':
    case 'ends_with':
      return 'text'
    case 'is_null':
    case 'is_not_null':
    case 'is_empty':
    case 'is_not_empty':
      return 'none'
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'length_gt':
    case 'length_lt':
    case 'score_gt':
    case 'score_lt':
      return 'number'
    default:
      return 'text'
  }
}

function textValue(item: RuleItemDraft): string {
  if (item.value === null || item.value === undefined) return ''
  if (typeof item.value === 'string') return item.value
  if (typeof item.value === 'number' || typeof item.value === 'boolean') return String(item.value)
  return ''
}

function numberValue(item: RuleItemDraft): number | undefined {
  const raw = Number(item.value)
  return Number.isFinite(raw) ? raw : undefined
}

function multiValue(item: RuleItemDraft): string[] {
  if (Array.isArray(item.value)) return item.value.map((entry) => String(entry))
  if (item.value === null || item.value === undefined || item.value === '') return []
  return [String(item.value)]
}

function betweenValue(item: RuleItemDraft): [number | undefined, number | undefined] {
  if (!Array.isArray(item.value)) return [undefined, undefined]
  const lower = item.value[0]
  const upper = item.value[1]
  return [
    typeof lower === 'number' ? lower : undefined,
    typeof upper === 'number' ? upper : undefined,
  ]
}

function setBetween(item: RuleItemDraft, index: 0 | 1, value: number | undefined) {
  const [lower, upper] = betweenValue(item)
  const next: [number, number] = index === 0 ? [value ?? 0, upper ?? 0] : [lower ?? 0, value ?? 0]
  item.value = next
}

function multiOptions(operator: string): string[] {
  if (operator === 'label_in') return LABEL_OPTIONS
  if (operator === 'risk_in') return RISK_OPTIONS
  return []
}

function onOperatorChange(item: RuleItemDraft) {
  const mode = valueMode(item.operator)
  if (mode === 'multi') {
    item.value = multiValue(item)
    return
  }
  if (mode === 'between') {
    const [lower, upper] = betweenValue(item)
    item.value = [lower ?? 0, upper ?? 0]
    return
  }
  if (mode === 'number') {
    item.value = numberValue(item) ?? null
    return
  }
  if (mode === 'none') {
    item.value = null
    return
  }
  item.value = textValue(item)
}

function toRulePayload(group: RuleGroupDraft): Partial<RuleGroup> {
  return {
    name: group.name.trim(),
    priority: group.priority,
    logic: group.logic,
    stop_on_hit: group.stop_on_hit,
    on_hit_result: group.on_hit_result,
    status: group.status,
    items: group.items.map(
      (item, index): RuleItem => ({
        field: item.field,
        operator: item.operator,
        value: item.value,
        case_sensitive: item.case_sensitive,
        negate: item.negate,
        sort_order: index,
      }),
    ),
  }
}

async function saveRuleGroup(index: number) {
  const target = rules.value[index]
  if (!target) return
  if (!target.name.trim()) {
    ElMessage.error('规则组名称不能为空')
    return
  }
  try {
    if (target.id === null) {
      const created = await createRule(auditId.value, toRulePayload(target))
      target.id = created.id ?? null
    } else {
      await updateRule(target.id, toRulePayload(target))
    }
    ElMessage.success('规则组已保存')
    await loadRules()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function deleteRuleGroup(index: number) {
  const target = rules.value[index]
  if (!target) return
  if (target.id === null) {
    removeRuleGroup(index)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除规则组「${target.name}」？`, '删除规则组', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteRule(target.id)
    ElMessage.success('规则组已删除')
    await loadRules()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 结果路由 ---------------- */

let uidSeed = 0
function nextUid(): string {
  uidSeed += 1
  return `act_${uidSeed}`
}

const routeDrafts = reactive<Record<ResultKey, RouteDraft>>({
  PASS: { exec_mode: 'sequential', on_error: 'continue', actions: [] },
  REJECT: { exec_mode: 'sequential', on_error: 'continue', actions: [] },
  REVIEW: { exec_mode: 'sequential', on_error: 'continue', actions: [] },
})

function emptyAction(type: ActionType): ActionDraft {
  return {
    uid: nextUid(),
    id: null,
    type,
    name: '',
    api_ref: '',
    method: 'POST',
    path: '',
    headers_text: '{}',
    body_text: '',
    timeout_ms: 5000,
    retry_text: '{"max_attempts":1}',
    command: 'SET',
    redis_key: '',
    value_text: '',
    ttl_sec: 0,
    datasource: '',
    sql: '',
    params_text: '[]',
    url: '',
    sign_text: '{}',
    target: '',
    topic: '',
  }
}

function parseJson(text: string): { ok: boolean; value: unknown } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  } catch {
    return { ok: false, value: null }
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  const result = parseJson(text)
  if (!result.ok) return null
  if (result.value === null) return {}
  if (typeof result.value !== 'object' || Array.isArray(result.value)) return null
  return result.value as Record<string, unknown>
}

function parseArray(text: string): unknown[] | null {
  const result = parseJson(text)
  if (!result.ok) return null
  if (result.value === null) return []
  if (!Array.isArray(result.value)) return null
  return result.value
}

function toActionDraft(spec: ActionSpec): ActionDraft {
  const draft = emptyAction(spec.type)
  draft.id = spec.id ?? null
  draft.uid = spec.id ?? nextUid()
  draft.name = spec.name ?? ''
  draft.api_ref = spec.api_ref ?? ''
  draft.method = spec.method ?? 'POST'
  draft.path = spec.path ?? ''
  draft.headers_text = spec.headers ? JSON.stringify(spec.headers, null, 2) : '{}'
  draft.body_text = spec.body === null || spec.body === undefined ? '' : JSON.stringify(spec.body, null, 2)
  draft.timeout_ms = spec.timeout_ms ?? 5000
  draft.retry_text = spec.retry ? JSON.stringify(spec.retry, null, 2) : '{"max_attempts":1}'
  draft.command = spec.command ?? 'SET'
  draft.redis_key = spec.key ?? ''
  draft.value_text = spec.value === null || spec.value === undefined ? '' : String(spec.value)
  draft.ttl_sec = spec.ttl_sec ?? 0
  draft.datasource = spec.datasource ?? ''
  draft.sql = spec.sql ?? ''
  draft.params_text = spec.params ? JSON.stringify(spec.params, null, 2) : '[]'
  draft.url = spec.url ?? ''
  draft.sign_text = spec.sign ? JSON.stringify(spec.sign, null, 2) : '{}'
  draft.target = spec.target ?? ''
  draft.topic = spec.topic ?? ''
  return draft
}

function toActionSpec(draft: ActionDraft): ActionSpec {
  const spec: ActionSpec = {
    id: draft.id,
    type: draft.type,
    name: draft.name.trim(),
  }
  switch (draft.type) {
    case 'HTTP':
      spec.api_ref = draft.api_ref.trim()
      spec.method = draft.method
      spec.path = draft.path.trim()
      spec.headers = parseObject(draft.headers_text)
      spec.body = parseJson(draft.body_text).value
      spec.timeout_ms = draft.timeout_ms
      spec.retry = parseObject(draft.retry_text)
      break
    case 'REDIS':
      spec.command = draft.command
      spec.key = draft.redis_key.trim()
      spec.value = draft.value_text
      spec.ttl_sec = draft.ttl_sec
      break
    case 'MYSQL':
      spec.datasource = draft.datasource.trim()
      spec.sql = draft.sql.trim()
      spec.params = parseArray(draft.params_text)
      break
    case 'WEBHOOK':
      spec.url = draft.url.trim()
      spec.sign = parseObject(draft.sign_text)
      spec.body = parseJson(draft.body_text).value
      spec.retry = parseObject(draft.retry_text)
      break
    case 'MQ':
      spec.target = draft.target.trim()
      spec.topic = draft.topic.trim()
      spec.body = parseJson(draft.body_text).value
      break
  }
  return spec
}

function actionLabel(action: ActionDraft): string {
  return action.name.trim() || actionTypeLabel(action.type)
}

function validateActions(draft: RouteDraft): string {
  for (const action of draft.actions) {
    if (action.type === 'HTTP') {
      if (parseObject(action.headers_text) === null) return `动作「${actionLabel(action)}」的 headers 不是合法 JSON 对象`
      if (!parseJson(action.body_text).ok) return `动作「${actionLabel(action)}」的 body 不是合法 JSON`
      if (parseObject(action.retry_text) === null) return `动作「${actionLabel(action)}」的 retry 不是合法 JSON 对象`
    }
    if (action.type === 'MYSQL') {
      if (parseArray(action.params_text) === null) return `动作「${actionLabel(action)}」的 params 不是合法 JSON 数组`
    }
    if (action.type === 'WEBHOOK') {
      if (parseObject(action.sign_text) === null) return `动作「${actionLabel(action)}」的 sign 不是合法 JSON 对象`
      if (!parseJson(action.body_text).ok) return `动作「${actionLabel(action)}」的 body 不是合法 JSON`
      if (parseObject(action.retry_text) === null) return `动作「${actionLabel(action)}」的 retry 不是合法 JSON 对象`
    }
    if (action.type === 'MQ') {
      if (!parseJson(action.body_text).ok) return `动作「${actionLabel(action)}」的 body 不是合法 JSON`
    }
  }
  return ''
}

async function loadRoutes() {
  try {
    const payload = await listRoutes(auditId.value)
    for (const key of RESULT_KEYS) {
      const route: ResultRoute | undefined = payload?.[key]
      if (!route) {
        routeDrafts[key] = { exec_mode: 'sequential', on_error: 'continue', actions: [] }
        continue
      }
      routeDrafts[key] = {
        exec_mode: route.exec_mode,
        on_error: route.on_error,
        actions: (route.actions ?? []).map((spec) => toActionDraft(spec)),
      }
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

function addAction(draft: RouteDraft) {
  draft.actions.push(emptyAction('HTTP'))
  markDirty()
}

function removeAction(draft: RouteDraft, index: number) {
  draft.actions.splice(index, 1)
  markDirty()
}

function moveAction(draft: RouteDraft, index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= draft.actions.length) return
  const current = draft.actions[index]
  const swapped = draft.actions[target]
  if (!current || !swapped) return
  draft.actions[index] = swapped
  draft.actions[target] = current
  markDirty()
}

function copyAction(draft: RouteDraft, index: number) {
  const source = draft.actions[index]
  if (!source) return
  const copy = toActionDraft(toActionSpec(source))
  copy.uid = nextUid()
  copy.id = null
  copy.name = `${copy.name.trim() || actionTypeLabel(copy.type)} 副本`
  draft.actions.splice(index + 1, 0, copy)
  markDirty()
}

async function saveRouteDraft(key: ResultKey) {
  const draft = routeDrafts[key]
  if (!draft) return
  const invalid = validateActions(draft)
  if (invalid) {
    ElMessage.error(invalid)
    return
  }
  try {
    await saveRoute(auditId.value, key, {
      result_type: key,
      exec_mode: draft.exec_mode,
      on_error: draft.on_error,
      actions: draft.actions.map((action) => toActionSpec(action)),
    })
    ElMessage.success(`${resultMeta(key).label}路由已保存`)
    await loadRoutes()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 保存审核 ---------------- */

function markDirty() {
  dirty.value = true
}

function toPayload(status: AuditStatus): Partial<AuditItem> {
  const target = form.value
  return {
    name: target.name.trim(),
    code: target.code.trim(),
    media_types: target.media_types,
    description: target.description.trim(),
    status,
    concurrency: target.concurrency,
    timeout_ms: target.timeout_ms,
    dedupe_window_sec: target.dedupe_window_sec,
    media_hash_in_key: target.media_hash_in_key,
    retry_policy: {
      max_attempts: target.max_attempts,
      backoff: target.backoff,
      base_ms: target.base_ms,
    },
    default_result: target.default_result,
    on_model_fail: target.on_model_fail,
    media_review: target.media_review,
  }
}

async function saveAudit(status: AuditStatus, enable: boolean) {
  if (!form.value.name.trim()) {
    ElMessage.error('审核名称不能为空')
    return
  }
  saving.value = true
  try {
    await updateAudit(auditId.value, toPayload(status))
    if (enable) {
      await enableAudit(auditId.value)
    }
    form.value.status = enable ? 'ACTIVE' : status
    dirty.value = false
    ElMessage.success(enable ? '审核已保存并启用' : '审核草稿已保存')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  void router.push({ name: 'audit-list' })
}

/* ---------------- 参数变量抽屉 ---------------- */

const variableDrawer = ref(false)
const lastFocused = ref<HTMLElement | null>(null)

function onFocusIn(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLElement) lastFocused.value = target
}

function insertVariable(text: string) {
  const element = lastFocused.value
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus()
    document.execCommand('insertText', false, text)
    return
  }
  void navigator.clipboard?.writeText(text)
  ElMessage.success('已复制到剪贴板')
}

/* ---------------- 离开提示 ---------------- */

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('有未保存的修改，确认离开？', '离开确认', {
      confirmButtonText: '离开',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    dirty.value = false
    return true
  } catch {
    return false
  }
})

watch(
  () => form.value,
  () => {
    if (loading.value) return
    dirty.value = true
  },
  { deep: true, flush: 'sync' },
)

onMounted(() => {
  document.addEventListener('focusin', onFocusIn)
  void loadAudit()
})

onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn)
})

watch(auditId, () => {
  void loadAudit()
})
</script>

<template>
  <div class="ap-page ap-edit">
    <PageHeader :title="form.name || '审核编辑'" :desc="form.code || '审核定义、触发源、规则、媒体审核与结果路由'">
      <template #actions>
        <StatusTag :label="form.status" :tone="form.status === 'ACTIVE' ? 'pass' : 'neutral'" />
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

    <div class="ap-card" v-loading="loading">
      <div class="ap-card__body">
        <el-tabs v-model="activeTab">
          <!-- 基本信息 -->
          <el-tab-pane label="基本信息" name="basic">
            <el-form :model="form" label-width="110px" class="ap-edit__form">
              <el-form-item label="名称">
                <el-input v-model="form.name" maxlength="64" placeholder="审核名称" :disabled="!canAuditWrite" />
              </el-form-item>
              <el-form-item label="编码">
                <el-input v-model="form.code" maxlength="64" placeholder="审核编码" :disabled="!canAuditWrite" />
              </el-form-item>
              <el-form-item label="媒体类型">
                <el-select
                  v-model="form.media_types"
                  multiple
                  class="ap-grow"
                  placeholder="请选择媒体类型"
                  :disabled="!canAuditWrite"
                >
                  <el-option
                    v-for="type in MEDIA_TYPE_OPTIONS"
                    :key="type"
                    :label="mediaTypeLabel(type)"
                    :value="type"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="描述">
                <el-input
                  v-model="form.description"
                  type="textarea"
                  :rows="3"
                  placeholder="审核说明"
                  :disabled="!canAuditWrite"
                />
              </el-form-item>
              <el-form-item label="状态">
                <el-select v-model="form.status" class="ap-grow" :disabled="!canAuditWrite">
                  <el-option
                    v-for="option in AUDIT_STATUS_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 触发源 -->
          <el-tab-pane label="触发源" name="trigger">
            <div class="ap-flex ap-flex-center ap-gap-2 ap-edit__section-head">
              <span class="ap-card__title">触发源</span>
              <el-tooltip :disabled="canTriggerWrite" content="缺少 trigger:write 权限" placement="top">
                <span>
                  <el-button size="small" :disabled="!canTriggerWrite" @click="addTrigger">新增触发源</el-button>
                </span>
              </el-tooltip>
            </div>

            <EmptyState v-if="triggers.length === 0" title="暂无触发源" desc="新增触发源以接入任务来源" />

            <div v-for="(trigger, index) in triggers" :key="index" class="ap-edit__block">
              <div class="ap-flex ap-gap-2 ap-flex-center ap-edit__block-head">
                <el-icon><component :is="TRIGGER_TYPE_ICONS[trigger.type]" /></el-icon>
                <el-select v-model="trigger.type" class="ap-edit__type" :disabled="!canTriggerWrite">
                  <el-option
                    v-for="option in TRIGGER_TYPE_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-input v-model="trigger.name" placeholder="触发源名称" :disabled="!canTriggerWrite" />
                <span class="ap-text-aux">优先级</span>
                <el-input-number
                  :model-value="trigger.priority"
                  :min="1"
                  :max="9999"
                  controls-position="right"
                  :disabled="!canTriggerWrite"
                  @update:model-value="(v: number | undefined) => (trigger.priority = v ?? 10)"
                />
                <el-select v-model="trigger.status" class="ap-edit__status" :disabled="!canTriggerWrite">
                  <el-option label="启用" value="ACTIVE" />
                  <el-option label="暂停" value="PAUSED" />
                  <el-option label="停用" value="DISABLED" />
                </el-select>
              </div>

              <el-form label-width="110px" class="ap-edit__form">
                <template v-if="trigger.type === 'REDIS'">
                  <el-form-item label="Stream">
                    <el-input v-model="trigger.stream" placeholder="stream" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="Group">
                    <el-input v-model="trigger.group" placeholder="group" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="批量大小">
                    <el-input-number
                      :model-value="trigger.batch_size"
                      :min="1"
                      :max="1000"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.batch_size = v ?? 16)"
                    />
                  </el-form-item>
                  <el-form-item label="可见性超时">
                    <el-input-number
                      :model-value="trigger.visibility_timeout_ms"
                      :min="1000"
                      :max="3600000"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.visibility_timeout_ms = v ?? 60000)"
                    />
                  </el-form-item>
                </template>

                <template v-if="trigger.type === 'POLLING'">
                  <el-form-item label="接口地址">
                    <el-input v-model="trigger.url" placeholder="轮询接口地址" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="轮询间隔(秒)">
                    <el-input-number
                      :model-value="trigger.interval_sec"
                      :min="1"
                      :max="86400"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.interval_sec = v ?? 10)"
                    />
                  </el-form-item>
                  <el-form-item label="游标路径">
                    <el-input v-model="trigger.cursor_path" placeholder="data.cursor" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="业务键路径">
                    <el-input v-model="trigger.biz_key_path" placeholder="data.biz_key" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="每页条数">
                    <el-input-number
                      :model-value="trigger.page_size"
                      :min="1"
                      :max="1000"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.page_size = v ?? 50)"
                    />
                  </el-form-item>
                  <el-form-item label="递增字段">
                    <el-input v-model="trigger.increment_field" placeholder="id" :disabled="!canTriggerWrite" />
                  </el-form-item>
                </template>

                <template v-if="trigger.type === 'WEBSOCKET'">
                  <el-form-item label="主机">
                    <el-input v-model="trigger.host" placeholder="WebSocket 主机地址" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="路径">
                    <el-input v-model="trigger.path" placeholder="/ws" :disabled="!canTriggerWrite" />
                  </el-form-item>
                  <el-form-item label="鉴权方式">
                    <el-select v-model="trigger.auth_type" class="ap-grow" :disabled="!canTriggerWrite">
                      <el-option label="none" value="none" />
                      <el-option label="token" value="token" />
                      <el-option label="basic" value="basic" />
                      <el-option label="sign" value="sign" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="订阅主题">
                    <el-select
                      v-model="trigger.topics"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      class="ap-grow"
                      placeholder="请选择或输入主题"
                      :disabled="!canTriggerWrite"
                    >
                      <el-option v-for="topic in trigger.topics" :key="topic" :label="topic" :value="topic" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="心跳间隔(秒)">
                    <el-input-number
                      :model-value="trigger.heartbeat_sec"
                      :min="1"
                      :max="3600"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.heartbeat_sec = v ?? 30)"
                    />
                  </el-form-item>
                </template>

                <template v-if="trigger.type === 'OPENAPI'">
                  <el-form-item label="同步等待(ms)">
                    <el-input-number
                      :model-value="trigger.sync_wait_ms"
                      :min="0"
                      :max="600000"
                      controls-position="right"
                      :disabled="!canTriggerWrite"
                      @update:model-value="(v: number | undefined) => (trigger.sync_wait_ms = v ?? 5000)"
                    />
                  </el-form-item>
                  <el-form-item label="必须业务键">
                    <el-switch v-model="trigger.require_biz_key" :disabled="!canTriggerWrite" />
                  </el-form-item>
                </template>
              </el-form>

              <div class="ap-flex ap-gap-2">
                <el-tooltip :disabled="canTriggerWrite" content="缺少 trigger:write 权限" placement="top">
                  <span>
                    <el-button size="small" type="primary" :disabled="!canTriggerWrite" @click="saveTrigger(index)">
                      保存
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="canTriggerWrite" content="缺少 trigger:write 权限" placement="top">
                  <span>
                    <el-button size="small" :disabled="!canTriggerWrite" @click="testTrigger(index)">测试</el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="canDelete" content="缺少 audit:delete 权限" placement="top">
                  <span>
                    <el-button
                      size="small"
                      type="danger"
                      :disabled="!canDelete"
                      @click="deleteTrigger(index)"
                    >
                      删除
                    </el-button>
                  </span>
                </el-tooltip>
              </div>
            </div>
          </el-tab-pane>

          <!-- 规则配置 -->
          <el-tab-pane label="规则配置" name="rule">
            <div class="ap-flex ap-flex-center ap-gap-2 ap-edit__section-head">
              <span class="ap-card__title">规则组</span>
              <el-tooltip :disabled="canRuleWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button size="small" :disabled="!canRuleWrite" @click="addRuleGroup">新增规则组</el-button>
                </span>
              </el-tooltip>
            </div>

            <EmptyState v-if="rules.length === 0" title="暂无规则组" desc="新增规则组以配置判定条件" />

            <div v-for="(group, index) in rules" :key="index" class="ap-edit__block">
              <div class="ap-flex ap-gap-2 ap-flex-center ap-edit__block-head">
                <el-input v-model="group.name" placeholder="规则组名称" :disabled="!canRuleWrite" />
                <span class="ap-text-aux">优先级</span>
                <el-input-number
                  :model-value="group.priority"
                  :min="1"
                  :max="9999"
                  controls-position="right"
                  :disabled="!canRuleWrite"
                  @update:model-value="(v: number | undefined) => (group.priority = v ?? 10)"
                />
                <el-select v-model="group.logic" class="ap-edit__status" :disabled="!canRuleWrite">
                  <el-option label="AND" value="AND" />
                  <el-option label="OR" value="OR" />
                </el-select>
                <el-select v-model="group.on_hit_result" class="ap-edit__status" :disabled="!canRuleWrite">
                  <el-option
                    v-for="option in RESULT_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-select v-model="group.status" class="ap-edit__status" :disabled="!canRuleWrite">
                  <el-option
                    v-for="option in GROUP_STATUS_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-tooltip content="命中后终止" placement="top">
                  <el-switch v-model="group.stop_on_hit" :disabled="!canRuleWrite" />
                </el-tooltip>
                <el-button
                  link
                  size="small"
                  :disabled="!canRuleWrite || index === 0"
                  @click="moveRuleGroup(index, -1)"
                >
                  上移
                </el-button>
                <el-button
                  link
                  size="small"
                  :disabled="!canRuleWrite || index === rules.length - 1"
                  @click="moveRuleGroup(index, 1)"
                >
                  下移
                </el-button>
              </div>

              <div class="ap-flex ap-flex-center ap-gap-2 ap-edit__section-head">
                <span class="ap-text-secondary">条件项</span>
                <el-tooltip :disabled="canRuleWrite" content="缺少 rule:write 权限" placement="top">
                  <span>
                    <el-button size="small" :disabled="!canRuleWrite" @click="addRuleItem(group)">添加条件</el-button>
                  </span>
                </el-tooltip>
              </div>

              <div v-if="group.items.length === 0" class="ap-text-aux ap-edit__empty">暂无条件项</div>

              <div v-for="(item, itemIndex) in group.items" :key="itemIndex" class="ap-edit__row">
                <el-select
                  v-model="item.field"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="内置字段或 ext.xxx"
                  :disabled="!canRuleWrite"
                >
                  <el-option
                    v-for="option in FIELD_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>

                <el-select v-model="item.operator" :disabled="!canRuleWrite" @change="onOperatorChange(item)">
                  <el-option
                    v-for="option in OPERATOR_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>

                <div class="ap-edit__value">
                  <template v-if="valueMode(item.operator) === 'between'">
                    <el-input-number
                      :model-value="betweenValue(item)[0]"
                      placeholder="下限"
                      controls-position="right"
                      :disabled="!canRuleWrite"
                      @update:model-value="(v: number | undefined) => setBetween(item, 0, v)"
                    />
                    <el-input-number
                      :model-value="betweenValue(item)[1]"
                      placeholder="上限"
                      controls-position="right"
                      :disabled="!canRuleWrite"
                      @update:model-value="(v: number | undefined) => setBetween(item, 1, v)"
                    />
                  </template>
                  <template v-else-if="valueMode(item.operator) === 'multi'">
                    <el-select
                      :model-value="multiValue(item)"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      placeholder="请选择或输入期望值"
                      :disabled="!canRuleWrite"
                      @update:model-value="(v: unknown[]) => (item.value = v.map((entry) => String(entry)))"
                    >
                      <el-option
                        v-for="option in multiOptions(item.operator)"
                        :key="option"
                        :label="option"
                        :value="option"
                      />
                    </el-select>
                  </template>
                  <template v-else-if="valueMode(item.operator) === 'number'">
                    <el-input-number
                      :model-value="numberValue(item)"
                      placeholder="请输入期望值"
                      controls-position="right"
                      :disabled="!canRuleWrite"
                      @update:model-value="(v: number | undefined) => (item.value = v ?? null)"
                    />
                  </template>
                  <template v-else-if="valueMode(item.operator) === 'text'">
                    <el-input
                      :model-value="textValue(item)"
                      placeholder="请输入期望值"
                      :disabled="!canRuleWrite"
                      @update:model-value="(v: string) => (item.value = v)"
                    />
                  </template>
                  <span v-else class="ap-text-aux">无需取值</span>
                </div>

                <div class="ap-flex ap-gap-2 ap-flex-center">
                  <el-tooltip content="区分大小写" placement="top">
                    <el-switch v-model="item.case_sensitive" size="small" :disabled="!canRuleWrite" />
                  </el-tooltip>
                  <el-tooltip content="取反" placement="top">
                    <el-switch v-model="item.negate" size="small" :disabled="!canRuleWrite" />
                  </el-tooltip>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="!canRuleWrite"
                    @click="removeRuleItem(group, itemIndex)"
                  >
                    删除
                  </el-button>
                </div>
              </div>

              <div class="ap-flex ap-gap-2">
                <el-tooltip :disabled="canRuleWrite" content="缺少 rule:write 权限" placement="top">
                  <span>
                    <el-button
                      size="small"
                      type="primary"
                      :disabled="!canRuleWrite"
                      @click="saveRuleGroup(index)"
                    >
                      保存
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="canRuleWrite" content="缺少 rule:write 权限" placement="top">
                  <span>
                    <el-button
                      size="small"
                      type="danger"
                      :disabled="!canRuleWrite"
                      @click="deleteRuleGroup(index)"
                    >
                      删除
                    </el-button>
                  </span>
                </el-tooltip>
              </div>
            </div>
          </el-tab-pane>

          <!-- 媒体审核设置 -->
          <el-tab-pane label="媒体审核设置" name="media">
            <el-tabs>
              <el-tab-pane label="文本" name="media-text">
                <el-form :model="form.media_review.text" label-width="110px" class="ap-edit__form">
                  <el-form-item label="API 引用">
                    <el-input
                      v-model="form.media_review.text.api_ref"
                      placeholder="api_ref"
                      :disabled="!canAuditWrite"
                    />
                  </el-form-item>
                  <el-form-item label="启用关键词">
                    <el-switch v-model="form.media_review.text.enable_keyword" :disabled="!canAuditWrite" />
                  </el-form-item>
                  <el-form-item label="关键词组">
                    <el-select
                      v-model="form.media_review.text.keyword_groups"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      class="ap-grow"
                      placeholder="请选择或输入关键词组"
                      :disabled="!canAuditWrite"
                    >
                      <el-option
                        v-for="group in form.media_review.text.keyword_groups"
                        :key="group"
                        :label="group"
                        :value="group"
                      />
                    </el-select>
                  </el-form-item>
                </el-form>
              </el-tab-pane>

              <el-tab-pane label="图片" name="media-image">
                <el-form :model="form.media_review.image" label-width="110px" class="ap-edit__form">
                  <el-form-item label="API 引用">
                    <el-input
                      v-model="form.media_review.image.api_ref"
                      placeholder="api_ref"
                      :disabled="!canAuditWrite"
                    />
                  </el-form-item>
                  <el-form-item label="启用 OCR">
                    <el-switch v-model="form.media_review.image.enable_ocr" :disabled="!canAuditWrite" />
                  </el-form-item>
                  <el-form-item label="标签集">
                    <el-select
                      v-model="form.media_review.image.labels"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      class="ap-grow"
                      placeholder="请选择或输入标签"
                      :disabled="!canAuditWrite"
                    >
                      <el-option
                        v-for="label in form.media_review.image.labels"
                        :key="label"
                        :label="label"
                        :value="label"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="聚合策略">
                    <el-select v-model="form.media_review.image.aggregate" class="ap-grow" :disabled="!canAuditWrite">
                      <el-option
                        v-for="option in AGGREGATE_OPTIONS"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                  </el-form-item>
                </el-form>
              </el-tab-pane>

              <el-tab-pane label="视频" name="media-video">
                <el-form :model="form.media_review.video" label-width="110px" class="ap-edit__form">
                  <el-form-item label="API 引用">
                    <el-input
                      v-model="form.media_review.video.api_ref"
                      placeholder="api_ref"
                      :disabled="!canAuditWrite"
                    />
                  </el-form-item>
                  <el-form-item label="抽帧帧率">
                    <el-input-number
                      :model-value="form.media_review.video.fps"
                      :min="0.2"
                      :max="5"
                      :step="0.1"
                      controls-position="right"
                      :disabled="!canAuditWrite"
                      @update:model-value="(v: number | undefined) => (form.media_review.video.fps = v ?? 1)"
                    />
                  </el-form-item>
                  <el-form-item label="最大帧数">
                    <el-input-number
                      :model-value="form.media_review.video.max_frames"
                      :min="1"
                      :max="300"
                      controls-position="right"
                      :disabled="!canAuditWrite"
                      @update:model-value="(v: number | undefined) => (form.media_review.video.max_frames = v ?? 300)"
                    />
                  </el-form-item>
                  <el-form-item label="聚合策略">
                    <el-select v-model="form.media_review.video.aggregate" class="ap-grow" :disabled="!canAuditWrite">
                      <el-option
                        v-for="option in AGGREGATE_OPTIONS"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="命中帧阈值">
                    <el-input-number
                      :model-value="form.media_review.video.threshold"
                      :min="1"
                      :max="300"
                      controls-position="right"
                      :disabled="!canAuditWrite"
                      @update:model-value="(v: number | undefined) => (form.media_review.video.threshold = v ?? 1)"
                    />
                  </el-form-item>
                </el-form>
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <!-- 结果路由 -->
          <el-tab-pane label="结果路由" name="route">
            <div class="ap-flex ap-flex-center ap-gap-2 ap-edit__section-head">
              <span class="ap-card__title">动作配置</span>
              <el-button size="small" @click="variableDrawer = true">参数变量</el-button>
            </div>

            <el-tabs>
              <el-tab-pane
                v-for="key in RESULT_KEYS"
                :key="key"
                :name="key"
                :label="resultMeta(key).label"
              >
                <div class="ap-flex ap-gap-4 ap-edit__route-meta">
                  <el-form label-width="90px">
                    <el-form-item label="执行模式">
                      <el-radio-group v-model="routeDrafts[key].exec_mode" :disabled="!canRouteWrite">
                        <el-radio-button value="sequential">顺序</el-radio-button>
                        <el-radio-button value="parallel">并行</el-radio-button>
                      </el-radio-group>
                    </el-form-item>
                  </el-form>
                  <el-form label-width="90px">
                    <el-form-item label="失败策略">
                      <el-radio-group v-model="routeDrafts[key].on_error" :disabled="!canRouteWrite">
                        <el-radio-button value="continue">继续</el-radio-button>
                        <el-radio-button value="abort">终止</el-radio-button>
                        <el-radio-button value="to_review">转待议</el-radio-button>
                      </el-radio-group>
                    </el-form-item>
                  </el-form>
                  <div class="ap-grow"></div>
                  <el-tooltip :disabled="canRouteWrite" content="缺少 route:write 权限" placement="top">
                    <span>
                      <el-button
                        type="primary"
                        :disabled="!canRouteWrite"
                        @click="saveRouteDraft(key)"
                      >
                        保存{{ resultMeta(key).label }}路由
                      </el-button>
                    </span>
                  </el-tooltip>
                </div>

                <div class="ap-flex ap-flex-center ap-gap-2 ap-edit__section-head">
                  <span class="ap-text-secondary">动作列表</span>
                  <el-tooltip :disabled="canRouteWrite" content="缺少 route:write 权限" placement="top">
                    <span>
                      <el-button
                        size="small"
                        :disabled="!canRouteWrite"
                        @click="addAction(routeDrafts[key])"
                      >
                        新增动作
                      </el-button>
                    </span>
                  </el-tooltip>
                </div>

                <div v-if="routeDrafts[key].actions.length === 0" class="ap-text-aux ap-edit__empty">暂无动作</div>

                <div
                  v-for="(action, actionIndex) in routeDrafts[key].actions"
                  :key="action.uid"
                  class="ap-edit__block"
                >
                  <div class="ap-flex ap-gap-2 ap-flex-center ap-edit__block-head">
                    <span class="ap-mono">{{ actionIndex + 1 }}</span>
                    <el-select v-model="action.type" class="ap-edit__type" :disabled="!canRouteWrite">
                      <el-option
                        v-for="option in ACTION_TYPE_OPTIONS"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                    <el-input v-model="action.name" placeholder="动作名称" :disabled="!canRouteWrite" />
                    <el-button
                      link
                      size="small"
                      :disabled="!canRouteWrite || actionIndex === 0"
                      @click="moveAction(routeDrafts[key], actionIndex, -1)"
                    >
                      上移
                    </el-button>
                    <el-button
                      link
                      size="small"
                      :disabled="!canRouteWrite || actionIndex === routeDrafts[key].actions.length - 1"
                      @click="moveAction(routeDrafts[key], actionIndex, 1)"
                    >
                      下移
                    </el-button>
                    <el-button
                      link
                      size="small"
                      :disabled="!canRouteWrite"
                      @click="copyAction(routeDrafts[key], actionIndex)"
                    >
                      复制
                    </el-button>
                    <el-button
                      link
                      type="danger"
                      size="small"
                      :disabled="!canRouteWrite"
                      @click="removeAction(routeDrafts[key], actionIndex)"
                    >
                      删除
                    </el-button>
                  </div>

                  <el-form label-width="110px" class="ap-edit__form">
                    <template v-if="action.type === 'HTTP'">
                      <el-form-item label="API 引用">
                        <el-input v-model="action.api_ref" placeholder="api_ref" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="方法">
                        <el-select v-model="action.method" :disabled="!canRouteWrite">
                          <el-option v-for="m in HTTP_METHODS" :key="m" :label="m" :value="m" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="路径">
                        <el-input v-model="action.path" placeholder="/path" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="超时(ms)">
                        <el-input-number
                          :model-value="action.timeout_ms"
                          :min="0"
                          :max="600000"
                          controls-position="right"
                          :disabled="!canRouteWrite"
                          @update:model-value="(v: number | undefined) => (action.timeout_ms = v ?? 5000)"
                        />
                      </el-form-item>
                      <el-form-item label="请求头">
                        <el-input
                          v-model="action.headers_text"
                          type="textarea"
                          :rows="3"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                      <el-form-item label="请求体">
                        <el-input
                          v-model="action.body_text"
                          type="textarea"
                          :rows="4"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                      <el-form-item label="重试">
                        <el-input
                          v-model="action.retry_text"
                          type="textarea"
                          :rows="2"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                    </template>

                    <template v-if="action.type === 'REDIS'">
                      <el-form-item label="命令">
                        <el-select v-model="action.command" :disabled="!canRouteWrite">
                          <el-option v-for="c in REDIS_COMMANDS" :key="c" :label="c" :value="c" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="Key">
                        <el-input v-model="action.redis_key" placeholder="key" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="Value">
                        <el-input v-model="action.value_text" placeholder="value" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="TTL(秒)">
                        <el-input-number
                          :model-value="action.ttl_sec"
                          :min="0"
                          :max="86400"
                          controls-position="right"
                          :disabled="!canRouteWrite"
                          @update:model-value="(v: number | undefined) => (action.ttl_sec = v ?? 0)"
                        />
                      </el-form-item>
                    </template>

                    <template v-if="action.type === 'MYSQL'">
                      <el-form-item label="数据源">
                        <el-input v-model="action.datasource" placeholder="datasource" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="SQL">
                        <el-input
                          v-model="action.sql"
                          type="textarea"
                          :rows="3"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                      <el-form-item label="参数">
                        <el-input
                          v-model="action.params_text"
                          type="textarea"
                          :rows="2"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                    </template>

                    <template v-if="action.type === 'WEBHOOK'">
                      <el-form-item label="URL">
                        <el-input v-model="action.url" placeholder="回调地址" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="签名">
                        <el-input
                          v-model="action.sign_text"
                          type="textarea"
                          :rows="2"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                      <el-form-item label="请求体">
                        <el-input
                          v-model="action.body_text"
                          type="textarea"
                          :rows="4"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                      <el-form-item label="重试">
                        <el-input
                          v-model="action.retry_text"
                          type="textarea"
                          :rows="2"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                    </template>

                    <template v-if="action.type === 'MQ'">
                      <el-form-item label="目标">
                        <el-input v-model="action.target" placeholder="target" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="Topic">
                        <el-input v-model="action.topic" placeholder="topic" :disabled="!canRouteWrite" />
                      </el-form-item>
                      <el-form-item label="消息体">
                        <el-input
                          v-model="action.body_text"
                          type="textarea"
                          :rows="4"
                          class="ap-mono"
                          :disabled="!canRouteWrite"
                        />
                      </el-form-item>
                    </template>
                  </el-form>
                </div>
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <!-- 高级设置 -->
          <el-tab-pane label="高级设置" name="advanced">
            <el-form :model="form" label-width="130px" class="ap-edit__form">
              <el-form-item label="任务超时(ms)">
                <el-input-number
                  :model-value="form.timeout_ms"
                  :min="1000"
                  :max="600000"
                  controls-position="right"
                  :disabled="!canAuditWrite"
                  @update:model-value="(v: number | undefined) => (form.timeout_ms = v ?? 30000)"
                />
              </el-form-item>
              <el-form-item label="最大重试次数">
                <el-input-number
                  :model-value="form.max_attempts"
                  :min="0"
                  :max="10"
                  controls-position="right"
                  :disabled="!canAuditWrite"
                  @update:model-value="(v: number | undefined) => (form.max_attempts = v ?? 3)"
                />
              </el-form-item>
              <el-form-item label="退避策略">
                <el-select v-model="form.backoff" class="ap-grow" :disabled="!canAuditWrite">
                  <el-option v-for="option in BACKOFF_OPTIONS" :key="option" :label="option" :value="option" />
                </el-select>
              </el-form-item>
              <el-form-item label="退避基数(ms)">
                <el-input-number
                  :model-value="form.base_ms"
                  :min="0"
                  :max="60000"
                  controls-position="right"
                  :disabled="!canAuditWrite"
                  @update:model-value="(v: number | undefined) => (form.base_ms = v ?? 500)"
                />
              </el-form-item>
              <el-form-item label="去重窗口(秒)">
                <el-input-number
                  :model-value="form.dedupe_window_sec"
                  :min="0"
                  :max="604800"
                  controls-position="right"
                  :disabled="!canAuditWrite"
                  @update:model-value="(v: number | undefined) => (form.dedupe_window_sec = v ?? 86400)"
                />
              </el-form-item>
              <el-form-item label="媒体指纹参与去重">
                <el-switch v-model="form.media_hash_in_key" :disabled="!canAuditWrite" />
              </el-form-item>
              <el-form-item label="并发配额">
                <el-input-number
                  :model-value="form.concurrency"
                  :min="1"
                  :max="1000"
                  controls-position="right"
                  :disabled="!canAuditWrite"
                  @update:model-value="(v: number | undefined) => (form.concurrency = v ?? 5)"
                />
              </el-form-item>
              <el-form-item label="默认结果">
                <el-select v-model="form.default_result" class="ap-grow" :disabled="!canAuditWrite">
                  <el-option
                    v-for="option in RESULT_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="模型失败兜底">
                <el-select v-model="form.on_model_fail" class="ap-grow" :disabled="!canAuditWrite">
                  <el-option
                    v-for="option in RESULT_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 底部操作条 -->
    <div class="ap-edit__bar">
      <el-tooltip :disabled="canAuditWrite" content="缺少 audit:write 权限" placement="top">
        <span>
          <el-button :loading="saving" :disabled="!canAuditWrite" @click="saveAudit('DRAFT', false)">
            保存草稿
          </el-button>
        </span>
      </el-tooltip>
      <el-tooltip :disabled="canAuditWrite" content="缺少 audit:write 权限" placement="top">
        <span>
          <el-button type="primary" :loading="saving" :disabled="!canAuditWrite" @click="saveAudit('ACTIVE', true)">
            保存并启用
          </el-button>
        </span>
      </el-tooltip>
      <el-button @click="cancelEdit">取消</el-button>
    </div>

    <!-- 参数变量 -->
    <el-drawer v-model="variableDrawer" title="参数变量" size="420px">
      <div v-for="group in VARIABLE_GROUPS" :key="group.title" class="ap-edit__var-group">
        <div class="ap-card__title">{{ group.title }}</div>
        <div class="ap-edit__var-list">
          <el-tag
            v-for="item in group.items"
            :key="item"
            class="ap-mono"
            effect="plain"
            @click="insertVariable(item)"
          >
            {{ item }}
          </el-tag>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.ap-edit {
  padding-bottom: 72px;
}

.ap-edit__form {
  max-width: 760px;
}

.ap-edit__form :deep(.el-form-item) {
  margin-bottom: var(--ap-space-3);
}

.ap-edit__section-head {
  margin: var(--ap-space-3) 0 var(--ap-space-2);
}

.ap-edit__block {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
  margin-bottom: var(--ap-space-3);
}

.ap-edit__block-head {
  margin-bottom: var(--ap-space-2);
  flex-wrap: wrap;
}

.ap-edit__type {
  width: 160px;
}

.ap-edit__status {
  width: 120px;
}

.ap-edit__row {
  display: grid;
  grid-template-columns: 220px 200px minmax(0, 1fr) 180px;
  gap: var(--ap-space-2);
  align-items: center;
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-2);
  margin-bottom: var(--ap-space-2);
}

.ap-edit__value {
  display: flex;
  gap: var(--ap-space-2);
  align-items: center;
}

.ap-edit__value :deep(.el-select),
.ap-edit__value :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
}

.ap-edit__empty {
  padding: var(--ap-space-3) 0;
  text-align: center;
}

.ap-edit__route-meta {
  align-items: flex-start;
  flex-wrap: wrap;
}

.ap-edit__bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: flex-end;
  gap: var(--ap-space-2);
  padding: var(--ap-space-3) var(--ap-space-5);
  background: var(--ap-bg-card);
  border-top: 1px solid var(--ap-border);
}

.ap-edit__var-group {
  margin-bottom: var(--ap-space-4);
}

.ap-edit__var-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ap-space-2);
  margin-top: var(--ap-space-2);
}

.ap-edit__var-list :deep(.el-tag) {
  cursor: pointer;
}
</style>
