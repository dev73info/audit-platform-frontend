<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import { applyRouteTemplate, listRoutes, previewRoute, saveRoute } from '@/api/audits'
import type { ActionSpec, ActionType, ResultRoute } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { actionTypeLabel, resultMeta } from '@/utils/labels'
import PageHeader from '@/components/PageHeader.vue'

const props = defineProps<{ id: string }>()

type ResultKey = 'PASS' | 'REJECT' | 'REVIEW'
type ExecMode = 'sequential' | 'parallel'
type OnError = 'continue' | 'abort' | 'to_review'

const RESULT_KEYS: ResultKey[] = ['PASS', 'REJECT', 'REVIEW']

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

const TEMPLATE_OPTIONS = [
  { value: 'reject_all_except_pass', label: '除通过外均驳回' },
  { value: 'same_actions_all', label: '三条路线相同动作' },
  { value: 'callback_only', label: '仅回调' },
  { value: 'pass_release_review_manual', label: '通过放行 + 待议人工' },
]

const DEFAULT_SAMPLE = `{
  "media": [
    { "type": "text", "content": "这是一段待审核文本" }
  ],
  "ext": {
    "user_id": "u123"
  },
  "model": {
    "label": "porn",
    "score": 0.93
  }
}`

/** 编辑中的动作。 */
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

/** 编辑中的路由。 */
type RouteDraft = {
  exec_mode: ExecMode
  on_error: OnError
  actions: ActionDraft[]
}

const auth = useAuthStore()

const auditId = computed(() => {
  const raw = Number(props.id)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})

const canRead = computed(() => auth.can('route:read'))
const canWrite = computed(() => auth.can('route:write'))

const loading = ref(false)
const error = ref('')
const saving = ref(false)
const activeTab = ref<string>('PASS')
const templateValue = ref<string>('reject_all_except_pass')

let uidSeed = 0
function nextUid(): string {
  uidSeed += 1
  return `act_${uidSeed}`
}

function emptyDraft(): RouteDraft {
  return { exec_mode: 'sequential', on_error: 'continue', actions: [] }
}

const drafts = reactive<Record<ResultKey, RouteDraft>>({
  PASS: emptyDraft(),
  REJECT: emptyDraft(),
  REVIEW: emptyDraft(),
})

/* ---------------- 转换 ---------------- */

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

/** 校验动作里的 JSON 字段，返回首个错误。 */
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

function actionLabel(action: ActionDraft): string {
  return action.name.trim() || actionTypeLabel(action.type)
}

/* ---------------- 加载与保存 ---------------- */

async function loadRoutes() {
  if (!auditId.value) return
  loading.value = true
  error.value = ''
  try {
    const payload = await listRoutes(auditId.value)
    for (const key of RESULT_KEYS) {
      const route = payload?.[key]
      if (!route) {
        drafts[key] = emptyDraft()
        continue
      }
      drafts[key] = {
        exec_mode: route.exec_mode,
        on_error: route.on_error,
        actions: (route.actions ?? []).map((spec) => toActionDraft(spec)),
      }
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function saveRouteFor(key: ResultKey) {
  const draft = drafts[key]
  if (!draft) return
  const invalid = validateActions(draft)
  if (invalid) {
    ElMessage.error(invalid)
    return
  }
  saving.value = true
  try {
    await saveRoute(auditId.value, key, {
      result_type: key,
      exec_mode: draft.exec_mode,
      on_error: draft.on_error,
      actions: draft.actions.map((action) => toActionSpec(action)),
    })
    ElMessage.success(`${resultMeta(key).label}路由已保存`)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

/* ---------------- 动作操作 ---------------- */

function addAction(key: ResultKey) {
  const draft = drafts[key]
  if (!draft) return
  draft.actions.push(emptyAction('HTTP'))
}

function removeAction(key: ResultKey, index: number) {
  const draft = drafts[key]
  if (!draft) return
  draft.actions.splice(index, 1)
}

function moveAction(key: ResultKey, index: number, offset: number) {
  const draft = drafts[key]
  if (!draft) return
  const target = index + offset
  if (target < 0 || target >= draft.actions.length) return
  const current = draft.actions[index]
  const swapped = draft.actions[target]
  if (!current || !swapped) return
  draft.actions[index] = swapped
  draft.actions[target] = current
}

function copyAction(key: ResultKey, index: number) {
  const draft = drafts[key]
  if (!draft) return
  const source = draft.actions[index]
  if (!source) return
  const copy = toActionDraft(toActionSpec(source))
  copy.uid = nextUid()
  copy.id = null
  copy.name = `${copy.name.trim() || actionTypeLabel(copy.type)} 副本`
  draft.actions.splice(index + 1, 0, copy)
}

/* ---------------- 模板与预览 ---------------- */

async function applyTemplate() {
  if (!templateValue.value) {
    ElMessage.error('请选择模板')
    return
  }
  try {
    await ElMessageBox.confirm('应用模板会覆盖三条路线的现有配置，确认继续？', '应用路由模板', {
      confirmButtonText: '应用',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    throw err
  }
  try {
    const payload = await applyRouteTemplate(
      auditId.value,
      templateValue.value as 'reject_all_except_pass' | 'same_actions_all' | 'callback_only' | 'pass_release_review_manual',
    )
    for (const key of RESULT_KEYS) {
      const route = payload?.[key]
      if (!route) {
        drafts[key] = emptyDraft()
        continue
      }
      drafts[key] = {
        exec_mode: route.exec_mode,
        on_error: route.on_error,
        actions: (route.actions ?? []).map((spec) => toActionDraft(spec)),
      }
    }
    ElMessage.success('模板已应用')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

const previewVisible = ref(false)
const previewLoading = ref(false)
const previewText = ref('')
const previewError = ref('')
const sampleText = ref(DEFAULT_SAMPLE)

const previewContent = computed(() => {
  if (!previewText.value) return '-'
  try {
    return JSON.stringify(JSON.parse(previewText.value) as unknown, null, 2)
  } catch {
    return previewText.value
  }
})

async function openPreview() {
  previewVisible.value = true
  previewError.value = ''
  previewText.value = ''
  let sample: unknown
  try {
    sample = JSON.parse(sampleText.value) as unknown
  } catch {
    previewError.value = '样例 JSON 格式错误'
    return
  }
  previewLoading.value = true
  try {
    const payload = await previewRoute(auditId.value, activeTab.value, sample)
    previewText.value = JSON.stringify(payload ?? {}, null, 2)
  } catch (err) {
    previewError.value = err instanceof ApiError ? err.message : '操作失败'
  } finally {
    previewLoading.value = false
  }
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void loadRoutes()
})

watch(auditId, () => {
  void loadRoutes()
})
</script>

<template>
  <div class="ap-page">
    <PageHeader title="结果路由" desc="按审核结论配置执行模式、失败策略与执行动作">
      <template #actions>
        <el-select v-model="templateValue" class="route-template-select">
          <el-option
            v-for="option in TEMPLATE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-tooltip :disabled="canWrite" content="缺少 route:write 权限" placement="top">
          <span>
            <el-button :disabled="!canWrite" @click="applyTemplate">应用模板</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="canRead" content="缺少 route:read 权限" placement="top">
          <span>
            <el-button :disabled="!canRead" @click="openPreview">预览渲染</el-button>
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

    <div class="ap-card">
      <div class="ap-card__body" v-loading="loading">
        <el-tabs v-model="activeTab">
          <el-tab-pane
            v-for="key in RESULT_KEYS"
            :key="key"
            :name="key"
            :label="resultMeta(key).label"
          >
            <div class="ap-flex ap-gap-4 route-meta">
              <el-form label-width="90px" class="route-meta__form">
                <el-form-item label="执行模式">
                  <el-radio-group v-model="drafts[key].exec_mode" :disabled="!canWrite">
                    <el-radio-button value="sequential">顺序</el-radio-button>
                    <el-radio-button value="parallel">并行</el-radio-button>
                  </el-radio-group>
                </el-form-item>
              </el-form>
              <el-form label-width="90px" class="route-meta__form">
                <el-form-item label="失败策略">
                  <el-radio-group v-model="drafts[key].on_error" :disabled="!canWrite">
                    <el-radio-button value="continue">继续</el-radio-button>
                    <el-radio-button value="abort">终止</el-radio-button>
                    <el-radio-button value="to_review">转待议</el-radio-button>
                  </el-radio-group>
                </el-form-item>
              </el-form>
              <div class="ap-grow"></div>
              <el-tooltip :disabled="canWrite" content="缺少 route:write 权限" placement="top">
                <span>
                  <el-button type="primary" :loading="saving" :disabled="!canWrite" @click="saveRouteFor(key)">
                    保存{{ resultMeta(key).label }}路由
                  </el-button>
                </span>
              </el-tooltip>
            </div>

            <div class="ap-flex ap-flex-center ap-gap-2 route-actions__head">
              <span class="ap-card__title">动作列表</span>
              <el-tooltip :disabled="canWrite" content="缺少 route:write 权限" placement="top">
                <span>
                  <el-button size="small" :disabled="!canWrite" @click="addAction(key)">新增动作</el-button>
                </span>
              </el-tooltip>
            </div>

            <div v-if="drafts[key].actions.length === 0" class="ap-text-aux route-empty">暂无动作</div>

            <div
              v-for="(action, index) in drafts[key].actions"
              :key="action.uid"
              class="route-action"
            >
              <div class="route-action__head">
                <span class="ap-mono">{{ index + 1 }}</span>
                <el-select v-model="action.type" class="route-action__type" :disabled="!canWrite">
                  <el-option
                    v-for="option in ACTION_TYPE_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-input v-model="action.name" placeholder="动作名称" :disabled="!canWrite" />
                <div class="route-action__ops">
                  <el-button
                    link
                    size="small"
                    :disabled="!canWrite || index === 0"
                    @click="moveAction(key, index, -1)"
                  >
                    上移
                  </el-button>
                  <el-button
                    link
                    size="small"
                    :disabled="!canWrite || index === drafts[key].actions.length - 1"
                    @click="moveAction(key, index, 1)"
                  >
                    下移
                  </el-button>
                  <el-button link size="small" :disabled="!canWrite" @click="copyAction(key, index)">复制</el-button>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="!canWrite"
                    @click="removeAction(key, index)"
                  >
                    删除
                  </el-button>
                </div>
              </div>

              <div class="route-action__body">
                <template v-if="action.type === 'HTTP'">
                  <el-form label-width="90px" class="route-action__form">
                    <el-form-item label="API 引用">
                      <el-input v-model="action.api_ref" placeholder="api_ref" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="方法">
                      <el-select v-model="action.method" :disabled="!canWrite">
                        <el-option v-for="m in HTTP_METHODS" :key="m" :label="m" :value="m" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="路径">
                      <el-input v-model="action.path" placeholder="/path" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="超时(ms)">
                      <el-input-number
                        :model-value="action.timeout_ms"
                        :min="0"
                        :max="600000"
                        controls-position="right"
                        :disabled="!canWrite"
                        @update:model-value="(v: number | undefined) => (action.timeout_ms = v ?? 5000)"
                      />
                    </el-form-item>
                    <el-form-item label="请求头">
                      <el-input
                        v-model="action.headers_text"
                        type="textarea"
                        :rows="3"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                    <el-form-item label="请求体">
                      <el-input
                        v-model="action.body_text"
                        type="textarea"
                        :rows="4"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                    <el-form-item label="重试">
                      <el-input
                        v-model="action.retry_text"
                        type="textarea"
                        :rows="2"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                  </el-form>
                </template>

                <template v-if="action.type === 'REDIS'">
                  <el-form label-width="90px" class="route-action__form">
                    <el-form-item label="命令">
                      <el-select v-model="action.command" :disabled="!canWrite">
                        <el-option v-for="c in REDIS_COMMANDS" :key="c" :label="c" :value="c" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="Key">
                      <el-input v-model="action.redis_key" placeholder="key" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="Value">
                      <el-input v-model="action.value_text" placeholder="value" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="TTL(秒)">
                      <el-input-number
                        :model-value="action.ttl_sec"
                        :min="0"
                        :max="86400"
                        controls-position="right"
                        :disabled="!canWrite"
                        @update:model-value="(v: number | undefined) => (action.ttl_sec = v ?? 0)"
                      />
                    </el-form-item>
                  </el-form>
                </template>

                <template v-if="action.type === 'MYSQL'">
                  <el-form label-width="90px" class="route-action__form">
                    <el-form-item label="数据源">
                      <el-input v-model="action.datasource" placeholder="datasource" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="SQL">
                      <el-input
                        v-model="action.sql"
                        type="textarea"
                        :rows="3"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                    <el-form-item label="参数">
                      <el-input
                        v-model="action.params_text"
                        type="textarea"
                        :rows="2"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                  </el-form>
                </template>

                <template v-if="action.type === 'WEBHOOK'">
                  <el-form label-width="90px" class="route-action__form">
                    <el-form-item label="URL">
                      <el-input v-model="action.url" placeholder="回调地址" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="签名">
                      <el-input
                        v-model="action.sign_text"
                        type="textarea"
                        :rows="2"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                    <el-form-item label="请求体">
                      <el-input
                        v-model="action.body_text"
                        type="textarea"
                        :rows="4"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                    <el-form-item label="重试">
                      <el-input
                        v-model="action.retry_text"
                        type="textarea"
                        :rows="2"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                  </el-form>
                </template>

                <template v-if="action.type === 'MQ'">
                  <el-form label-width="90px" class="route-action__form">
                    <el-form-item label="目标">
                      <el-input v-model="action.target" placeholder="target" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="Topic">
                      <el-input v-model="action.topic" placeholder="topic" :disabled="!canWrite" />
                    </el-form-item>
                    <el-form-item label="消息体">
                      <el-input
                        v-model="action.body_text"
                        type="textarea"
                        :rows="4"
                        class="ap-mono"
                        :disabled="!canWrite"
                      />
                    </el-form-item>
                  </el-form>
                </template>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 渲染预览 -->
    <el-dialog v-model="previewVisible" title="渲染预览" width="760px">
      <el-form label-width="90px">
        <el-form-item label="样例 JSON">
          <el-input v-model="sampleText" type="textarea" :rows="8" class="ap-mono" />
        </el-form-item>
      </el-form>
      <el-alert v-if="previewError" type="error" show-icon :closable="false" :title="previewError" />
      <pre v-else class="ap-mono route-preview" v-loading="previewLoading">{{ previewContent }}</pre>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button type="primary" @click="openPreview">重新渲染</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.route-template-select {
  width: 200px;
}

.route-meta {
  align-items: flex-start;
  flex-wrap: wrap;
}

.route-meta__form {
  width: 320px;
}

.route-meta__form :deep(.el-form-item) {
  margin-bottom: var(--ap-space-2);
}

.route-actions__head {
  margin: var(--ap-space-3) 0 var(--ap-space-2);
}

.route-empty {
  padding: var(--ap-space-4) 0;
  text-align: center;
}

.route-action {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
  margin-bottom: var(--ap-space-2);
}

.route-action__head {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
}

.route-action__type {
  width: 160px;
}

.route-action__ops {
  display: flex;
  align-items: center;
  gap: var(--ap-space-1);
}

.route-action__body {
  margin-top: var(--ap-space-3);
}

.route-action__form {
  max-width: 720px;
}

.route-action__form :deep(.el-form-item) {
  margin-bottom: var(--ap-space-2);
}

.route-preview {
  max-height: 360px;
  overflow: auto;
  background: var(--ap-bg-page);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
  margin: 0;
}
</style>
