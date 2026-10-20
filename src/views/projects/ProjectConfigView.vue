<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  createConfig,
  listConfigVersions,
  listConfigs,
  revealConfig,
  rollbackConfig,
  testConfig,
  updateConfig,
  type ConfigSavePayload,
} from '@/api/configs'
import { getProject, updateProjectQuota } from '@/api/projects'
import { getUserProjects, listUsers, updateUserProjects } from '@/api/users'
import type {
  AdminUserItem,
  ConfigType,
  ConnectionTestResult,
  ProjectConfigItem,
  ProjectItem,
} from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatNumber } from '@/utils/format'
import { configTypeLabel, projectEnvLabel, projectStatusMeta } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps<{ id: string | number }>()

const auth = useAuthStore()

const projectId = computed(() => Number(props.id))
const project = ref<ProjectItem | null>(null)

const canRead = computed(() => auth.can('project:config:read'))
const canWrite = computed(() => auth.can('project:config:write'))
const canReveal = computed(() => auth.can('project:config:reveal'))

const tab = ref<string>('REDIS')

/* ---------------- 连接配置 ---------------- */

const configs = ref<ProjectConfigItem[]>([])
const configsLoading = ref(false)
const selectedIds = reactive<Record<string, number | null>>({ REDIS: null, MYSQL: null, API: null })

const TYPES: ConfigType[] = ['REDIS', 'MYSQL', 'API']

const configsByType = computed(() => {
  const map: Record<string, ProjectConfigItem[]> = {}
  for (const item of configs.value) {
    const list = map[item.type] ?? []
    list.push(item)
    map[item.type] = list
  }
  return map
})

function configsOfType(type: string): ProjectConfigItem[] {
  return configsByType.value[type] ?? []
}

function selectedConfig(type: string): ProjectConfigItem | null {
  const list = configsOfType(type)
  const id = selectedIds[type]
  const found = list.find((item) => item.id === id)
  return found ?? list[0] ?? null
}

function strField(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  return typeof value === 'string' ? value : fallback
}

function numField(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = source[key]
  return typeof value === 'number' ? value : fallback
}

function boolField(source: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

/* ---------------- Redis 表单 ---------------- */

const redisForm = reactive({
  name: '',
  host: '',
  port: 6379,
  password: '',
  db_index: 0,
  mode: 'standalone',
  max_conn: 10,
  connect_timeout_ms: 3000,
  read_timeout_ms: 3000,
  write_timeout_ms: 3000,
  queue_prefix: '',
  stream_maxlen: 100000,
  consumer_group: '',
})

const REDIS_MODE_OPTIONS = [
  { value: 'standalone', label: '单机' },
  { value: 'sentinel', label: '哨兵' },
  { value: 'cluster', label: '集群' },
]

/* ---------------- MySQL 表单 ---------------- */

const mysqlForm = reactive({
  name: '',
  host: '',
  port: 3306,
  database: '',
  username: '',
  password: '',
  ssl_mode: 'DISABLED',
  max_pool_size: 10,
  min_idle: 2,
  connection_timeout_ms: 30000,
  idle_timeout_ms: 600000,
  max_lifetime_ms: 1800000,
  read_only: false,
})

const SSL_MODE_OPTIONS = [
  { value: 'DISABLED', label: '关闭' },
  { value: 'PREFERRED', label: '优先' },
  { value: 'REQUIRED', label: '必需' },
  { value: 'VERIFY_CA', label: '校验证书' },
]

/* ---------------- 第三方 API 表单 ---------------- */

const apiForm = reactive({
  name: '',
  base_url: '',
  auth_type: 'none',
  secret: '',
  timeout_ms: 30000,
  retry_max_attempts: 3,
  backoff: 'exponential',
  breaker_threshold: 5,
  rate_limit_qps: 100,
  tags: [] as string[],
})

const AUTH_TYPE_OPTIONS = [
  { value: 'none', label: '无认证' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'header', label: '自定义 Header' },
  { value: 'hmac', label: 'HMAC 签名' },
  { value: 'oauth2-client', label: 'OAuth2 客户端' },
]

const BACKOFF_OPTIONS = [
  { value: 'none', label: '不重试' },
  { value: 'fixed', label: '固定间隔' },
  { value: 'exponential', label: '指数退避' },
]

const TAG_OPTIONS = [
  { value: 'BUSINESS', label: '业务数据' },
  { value: 'CONTENT', label: '内容审核' },
  { value: 'REALTIME', label: '实时查询' },
  { value: 'BATCH', label: '离线批处理' },
  { value: 'INTERNAL', label: '内部服务' },
  { value: 'CALLBACK', label: '第三方回调' },
]

/* ---------------- 密钥状态 ---------------- */

const secretEditing = reactive<Record<string, boolean>>({ REDIS: false, MYSQL: false, API: false })
const secretMasked = reactive<Record<string, string>>({ REDIS: '', MYSQL: '', API: '' })

/* ---------------- 测试与保存 ---------------- */

const testResults = reactive<Record<string, ConnectionTestResult | null>>({
  REDIS: null,
  MYSQL: null,
  API: null,
})
const testing = reactive<Record<string, boolean>>({ REDIS: false, MYSQL: false, API: false })
const saving = reactive<Record<string, boolean>>({ REDIS: false, MYSQL: false, API: false })

function buildPayload(type: string): ConfigSavePayload {
  if (type === 'REDIS') {
    return {
      type: 'REDIS',
      name: redisForm.name.trim() || 'redis',
      config: {
        host: redisForm.host.trim(),
        port: redisForm.port,
        db_index: redisForm.db_index,
        mode: redisForm.mode,
        max_conn: redisForm.max_conn,
        connect_timeout_ms: redisForm.connect_timeout_ms,
        read_timeout_ms: redisForm.read_timeout_ms,
        write_timeout_ms: redisForm.write_timeout_ms,
        queue_prefix: redisForm.queue_prefix.trim(),
        stream_maxlen: redisForm.stream_maxlen,
        consumer_group: redisForm.consumer_group.trim(),
        ...(redisForm.password ? { password: redisForm.password } : {}),
      },
    }
  }
  if (type === 'MYSQL') {
    return {
      type: 'MYSQL',
      name: mysqlForm.name.trim() || 'mysql',
      config: {
        host: mysqlForm.host.trim(),
        port: mysqlForm.port,
        database: mysqlForm.database.trim(),
        username: mysqlForm.username.trim(),
        ssl_mode: mysqlForm.ssl_mode,
        ...(mysqlForm.password ? { password: mysqlForm.password } : {}),
      },
      pool: {
        max_pool_size: mysqlForm.max_pool_size,
        min_idle: mysqlForm.min_idle,
        connection_timeout_ms: mysqlForm.connection_timeout_ms,
        idle_timeout_ms: mysqlForm.idle_timeout_ms,
        max_lifetime_ms: mysqlForm.max_lifetime_ms,
        read_only: mysqlForm.read_only,
      },
    }
  }
  return {
    type: 'API',
    name: apiForm.name.trim() || 'api',
    config: {
      base_url: apiForm.base_url.trim(),
      auth_type: apiForm.auth_type,
      timeout_ms: apiForm.timeout_ms,
      retry_max_attempts: apiForm.retry_max_attempts,
      backoff: apiForm.backoff,
      breaker_threshold: apiForm.breaker_threshold,
      rate_limit_qps: apiForm.rate_limit_qps,
      ...(apiForm.secret ? { secret: apiForm.secret } : {}),
    },
    tags: apiForm.tags,
  }
}

function applyForm(type: string, item: ProjectConfigItem | null) {
  if (type === 'REDIS') {
    const config = item?.config ?? {}
    redisForm.name = item?.name ?? ''
    redisForm.host = strField(config, 'host')
    redisForm.port = numField(config, 'port', 6379)
    redisForm.db_index = numField(config, 'db_index', 0)
    redisForm.mode = strField(config, 'mode', 'standalone')
    redisForm.max_conn = numField(config, 'max_conn', 10)
    redisForm.connect_timeout_ms = numField(config, 'connect_timeout_ms', 3000)
    redisForm.read_timeout_ms = numField(config, 'read_timeout_ms', 3000)
    redisForm.write_timeout_ms = numField(config, 'write_timeout_ms', 3000)
    redisForm.queue_prefix = strField(config, 'queue_prefix')
    redisForm.stream_maxlen = numField(config, 'stream_maxlen', 100000)
    redisForm.consumer_group = strField(config, 'consumer_group')
    redisForm.password = ''
    secretMasked.REDIS = strField(config, 'password')
    secretEditing.REDIS = false
    return
  }
  if (type === 'MYSQL') {
    const config = item?.config ?? {}
    const pool = item?.pool ?? {}
    mysqlForm.name = item?.name ?? ''
    mysqlForm.host = strField(config, 'host')
    mysqlForm.port = numField(config, 'port', 3306)
    mysqlForm.database = strField(config, 'database')
    mysqlForm.username = strField(config, 'username')
    mysqlForm.ssl_mode = strField(config, 'ssl_mode', 'DISABLED')
    mysqlForm.password = ''
    secretMasked.MYSQL = strField(config, 'password')
    secretEditing.MYSQL = false
    mysqlForm.max_pool_size = numField(pool, 'max_pool_size', 10)
    mysqlForm.min_idle = numField(pool, 'min_idle', 2)
    mysqlForm.connection_timeout_ms = numField(pool, 'connection_timeout_ms', 30000)
    mysqlForm.idle_timeout_ms = numField(pool, 'idle_timeout_ms', 600000)
    mysqlForm.max_lifetime_ms = numField(pool, 'max_lifetime_ms', 1800000)
    mysqlForm.read_only = boolField(pool, 'read_only', false)
    return
  }
  const config = item?.config ?? {}
  apiForm.name = item?.name ?? ''
  apiForm.base_url = strField(config, 'base_url')
  apiForm.auth_type = strField(config, 'auth_type', 'none')
  apiForm.timeout_ms = numField(config, 'timeout_ms', 30000)
  apiForm.retry_max_attempts = numField(config, 'retry_max_attempts', 3)
  apiForm.backoff = strField(config, 'backoff', 'exponential')
  apiForm.breaker_threshold = numField(config, 'breaker_threshold', 5)
  apiForm.rate_limit_qps = numField(config, 'rate_limit_qps', 100)
  apiForm.secret = ''
  apiForm.tags = Array.isArray(item?.tags) ? [...(item.tags ?? [])] : []
  secretMasked.API = strField(config, 'secret')
  secretEditing.API = false
}

function selectConfig(type: string, id: number) {
  selectedIds[type] = id
  const item = configsOfType(type).find((entry) => entry.id === id) ?? null
  applyForm(type, item)
  testResults[type] = null
  void loadVersions(type)
}

async function testConnection(type: string) {
  testing[type] = true
  testResults[type] = null
  try {
    const payload = buildPayload(type)
    const result = await testConfig(projectId.value, {
      type: payload.type,
      config: payload.config,
      ...(payload.pool ? { pool: payload.pool } : {}),
    })
    testResults[type] = result
    if (!result.ok) {
      ElMessage.error(result.error ?? '连接失败')
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    testing[type] = false
  }
}

async function saveConfig(type: string) {
  saving[type] = true
  try {
    const payload = buildPayload(type)
    const current = selectedConfig(type)
    if (current) {
      await updateConfig(projectId.value, current.id, { ...payload, version: current.version })
    } else {
      await createConfig(projectId.value, payload)
    }
    ElMessage.success('配置已保存')
    await loadConfigs()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    saving[type] = false
  }
}

function resetForm(type: string) {
  applyForm(type, selectedConfig(type))
  testResults[type] = null
}

/* ---------------- 密钥修改 ---------------- */

async function startEditSecret(type: string) {
  let password = ''
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入当前登录密码或 2FA 验证码',
      '确认修改密钥',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '登录密码或 2FA 验证码',
        inputValidator: (input: string) => (input.trim() ? true : '请输入登录密码或 2FA 验证码'),
      },
    )
    password = value.trim()
  } catch {
    return
  }
  const current = selectedConfig(type)
  if (current) {
    try {
      await revealConfig(projectId.value, current.id, password)
    } catch (err) {
      ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
      return
    }
  }
  secretEditing[type] = true
}

async function revealSecret(type: string) {
  const current = selectedConfig(type)
  if (!current) return
  try {
    const { value } = await ElMessageBox.prompt('请输入当前登录密码或 2FA 验证码', '查看密钥', {
      confirmButtonText: '查看',
      cancelButtonText: '取消',
      inputType: 'password',
      inputPlaceholder: '登录密码或 2FA 验证码',
      inputValidator: (input: string) => (input.trim() ? true : '请输入登录密码或 2FA 验证码'),
    })
    const payload = await revealConfig(projectId.value, current.id, value.trim())
    const secret = payload.secret ?? payload.password
    ElMessage.info(typeof secret === 'string' ? secret : '密钥已获取')
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 版本 ---------------- */

/** 版本历史项。后端返回 `{ version, operator, change_note, created_at }`。 */
type VersionRow = {
  version: number
  operator: string
  change_note: string | null
  created_at: string
}

const versions = reactive<Record<string, VersionRow[]>>({ REDIS: [], MYSQL: [], API: [] })
const versionsLoading = reactive<Record<string, boolean>>({ REDIS: false, MYSQL: false, API: false })

async function loadVersions(type: string) {
  const current = selectedConfig(type)
  if (!current) {
    versions[type] = []
    return
  }
  versionsLoading[type] = true
  try {
    const raw = (await listConfigVersions(projectId.value, current.id, {
      page: 1,
      page_size: 20,
    })) as unknown
    const items: unknown[] = Array.isArray(raw)
      ? raw
      : ((raw as { items?: unknown[] } | null)?.items ?? [])
    versions[type] = items.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return {
        version: typeof row.version === 'number' ? row.version : 0,
        operator: typeof row.operator === 'string' ? row.operator : '-',
        change_note: typeof row.change_note === 'string' ? row.change_note : null,
        created_at: typeof row.created_at === 'string' ? row.created_at : '',
      }
    })
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    versions[type] = []
  } finally {
    versionsLoading[type] = false
  }
}

async function rollback(type: string, version: number) {
  const current = selectedConfig(type)
  if (!current) return
  try {
    await ElMessageBox.confirm(`确认回滚到版本 v${version}？当前内容将被覆盖。`, '回滚配置', {
      confirmButtonText: '回滚',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await rollbackConfig(projectId.value, current.id, version)
    ElMessage.success('已回滚')
    await loadConfigs()
    await loadVersions(type)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 配额 ---------------- */

const quotaForm = reactive({
  max_concurrency: 50,
  max_qps: 100,
  max_mysql_pool: 20,
  max_redis_conn: 20,
  max_media_size_mb: 50,
  max_daily_tasks: undefined as number | undefined,
  max_api_call_per_task: 10,
})
const quotaSaving = ref(false)

function applyQuota(item: ProjectItem | null) {
  if (!item) return
  quotaForm.max_concurrency = item.quota.max_concurrency
  quotaForm.max_qps = item.quota.max_qps
  quotaForm.max_mysql_pool = item.quota.max_mysql_pool
  quotaForm.max_redis_conn = item.quota.max_redis_conn
  quotaForm.max_media_size_mb = item.quota.max_media_size_mb
  quotaForm.max_daily_tasks = item.quota.max_daily_tasks ?? undefined
  quotaForm.max_api_call_per_task = item.quota.max_api_call_per_task
}

async function saveQuota() {
  quotaSaving.value = true
  try {
    const item = await updateProjectQuota(projectId.value, {
      max_concurrency: quotaForm.max_concurrency,
      max_qps: quotaForm.max_qps,
      max_mysql_pool: quotaForm.max_mysql_pool,
      max_redis_conn: quotaForm.max_redis_conn,
      max_media_size_mb: quotaForm.max_media_size_mb,
      max_daily_tasks: quotaForm.max_daily_tasks ?? null,
      max_api_call_per_task: quotaForm.max_api_call_per_task,
    })
    project.value = item
    applyQuota(item)
    ElMessage.success('配额已保存')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    quotaSaving.value = false
  }
}

/* ---------------- 成员 ---------------- */

const members = ref<AdminUserItem[]>([])
const memberScopes = ref<Record<number, number[]>>({})
const membersLoading = ref(false)

async function loadMembers() {
  membersLoading.value = true
  try {
    const payload = await listUsers({ page: 1, page_size: 100 })
    members.value = payload.items ?? []
    const scopes: Record<number, number[]> = {}
    await Promise.all(
      members.value.map(async (item) => {
        try {
          const scope = await getUserProjects(item.id)
          scopes[item.id] = scope.project_ids ?? []
        } catch {
          scopes[item.id] = []
        }
      }),
    )
    memberScopes.value = scopes
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    members.value = []
  } finally {
    membersLoading.value = false
  }
}

async function toggleMemberScope(item: AdminUserItem) {
  const current = memberScopes.value[item.id] ?? []
  const granted = current.includes(projectId.value)
  try {
    await ElMessageBox.confirm(
      granted
        ? `确认取消「${item.display_name ?? item.username}」对本项目的授权？`
        : `确认授予「${item.display_name ?? item.username}」本项目访问权限？`,
      granted ? '取消授权' : '授予权限',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const next = granted
    ? current.filter((id) => id !== projectId.value)
    : [...current, projectId.value]
  try {
    await updateUserProjects(item.id, next)
    memberScopes.value = { ...memberScopes.value, [item.id]: next }
    ElMessage.success('项目授权已更新')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

function memberGranted(id: number): boolean {
  return (memberScopes.value[id] ?? []).includes(projectId.value)
}

/* ---------------- 加载 ---------------- */

async function loadProject() {
  try {
    const item = await getProject(projectId.value)
    project.value = item
    applyQuota(item)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function loadConfigs() {
  configsLoading.value = true
  try {
    const payload = await listConfigs(projectId.value, { page: 1, page_size: 50 })
    configs.value = payload.items ?? []
    for (const type of TYPES) {
      const list = configsOfType(type)
      const id = selectedIds[type]
      const keep = list.find((item) => item.id === id)
      const next = keep ?? list[0] ?? null
      selectedIds[type] = next ? next.id : null
      applyForm(type, next)
    }
    for (const type of TYPES) {
      void loadVersions(type)
    }
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    configs.value = []
  } finally {
    configsLoading.value = false
  }
}

onMounted(() => {
  void loadProject()
  void loadConfigs()
})

watch(projectId, () => {
  void loadProject()
  void loadConfigs()
})

watch(tab, (value) => {
  if (value === 'members') void loadMembers()
})
</script>

<template>
  <div class="ap-page">
    <PageHeader
      :title="project ? `${project.name} · 配置` : '项目配置'"
      :desc="project ? `${project.code} · ${projectEnvLabel(project.env)}` : ''"
    >
      <template #extra>
        <div class="ap-flex ap-gap-2">
          <StatusTag
            v-if="project"
            :label="projectStatusMeta(project.status).label"
            :tone="projectStatusMeta(project.status).tone"
          />
        </div>
      </template>
    </PageHeader>

    <el-alert
      v-if="project?.env === 'prod'"
      class="ap-gap-2"
      type="warning"
      show-icon
      :closable="false"
      title="当前为生产环境，修改将影响线上流程"
    />

    <div class="ap-card">
      <div class="ap-card__body" v-loading="configsLoading">
        <el-tabs v-model="tab" tab-position="left" class="ap-config-tabs">
          <!-- Redis -->
          <el-tab-pane label="Redis" name="REDIS">
            <div class="ap-card__title">Redis 连接配置</div>
            <div v-if="configsOfType('REDIS').length > 1" class="ap-flex ap-gap-2 ap-config-picker">
              <span class="ap-text-secondary">选择配置</span>
              <el-select
                :model-value="selectedIds.REDIS ?? undefined"
                class="ap-grow"
                @change="selectConfig('REDIS', $event)"
              >
                <el-option
                  v-for="item in configsOfType('REDIS')"
                  :key="item.id"
                  :label="`${item.name} (v${item.version})`"
                  :value="item.id"
                />
              </el-select>
            </div>
            <el-alert
              v-else-if="configsOfType('REDIS').length === 0"
              class="ap-gap-2"
              type="info"
              show-icon
              :closable="false"
              title="尚无 Redis 配置，填写后保存将新建"
            />
            <el-form :model="redisForm" label-width="130px" :disabled="!canRead">
              <el-form-item label="配置名称">
                <el-input v-model="redisForm.name" placeholder="redis" />
              </el-form-item>
              <el-form-item label="地址">
                <el-input v-model="redisForm.host" placeholder="127.0.0.1" class="ap-mono" />
              </el-form-item>
              <el-form-item label="端口">
                <el-input-number v-model="redisForm.port" :min="1" :max="65535" controls-position="right" />
              </el-form-item>
              <el-form-item label="密码">
                <div class="ap-flex ap-gap-2">
                  <el-input
                    v-model="redisForm.password"
                    :placeholder="secretEditing.REDIS ? '请输入新密码' : '••••••••'"
                    :disabled="!secretEditing.REDIS"
                    type="password"
                    show-password
                    class="ap-grow"
                  />
                  <el-tooltip
                    :disabled="canReveal && secretEditing.REDIS"
                    content="缺少 project:config:reveal 权限"
                    placement="top"
                  >
                    <span>
                      <el-button :disabled="!canReveal || secretEditing.REDIS" @click="startEditSecret('REDIS')">
                        修改
                      </el-button>
                    </span>
                  </el-tooltip>
                </div>
                <p v-if="secretMasked.REDIS" class="ap-text-aux ap-mono">当前密钥：{{ secretMasked.REDIS }}</p>
              </el-form-item>
              <el-form-item label="DB index">
                <el-input-number v-model="redisForm.db_index" :min="0" :max="63" controls-position="right" />
              </el-form-item>
              <el-form-item label="模式">
                <el-select v-model="redisForm.mode" class="ap-grow">
                  <el-option v-for="item in REDIS_MODE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="最大连接数">
                <el-input-number v-model="redisForm.max_conn" :min="1" :max="10000" controls-position="right" />
              </el-form-item>
              <el-form-item label="连接超时(ms)">
                <el-input-number v-model="redisForm.connect_timeout_ms" :min="100" :max="600000" controls-position="right" />
              </el-form-item>
              <el-form-item label="读超时(ms)">
                <el-input-number v-model="redisForm.read_timeout_ms" :min="100" :max="600000" controls-position="right" />
              </el-form-item>
              <el-form-item label="写超时(ms)">
                <el-input-number v-model="redisForm.write_timeout_ms" :min="100" :max="600000" controls-position="right" />
              </el-form-item>
              <el-form-item label="队列前缀">
                <el-input v-model="redisForm.queue_prefix" placeholder="audit" class="ap-mono" />
              </el-form-item>
              <el-form-item label="Stream 最大长度">
                <el-input-number v-model="redisForm.stream_maxlen" :min="1000" :max="10000000" controls-position="right" />
              </el-form-item>
              <el-form-item label="消费组">
                <el-input v-model="redisForm.consumer_group" placeholder="cg_demo" class="ap-mono" />
              </el-form-item>
            </el-form>

            <el-alert
              v-if="testResults.REDIS"
              class="ap-gap-2"
              :type="testResults.REDIS.ok ? 'success' : 'error'"
              show-icon
              :closable="false"
              :title="testResults.REDIS.ok ? '连接成功' : '连接失败'"
            >
              <template v-if="testResults.REDIS.ok">
                延迟 {{ testResults.REDIS.latency_ms }} ms
                <template v-if="testResults.REDIS.server_info">
                  · 版本 {{ testResults.REDIS.server_info }}
                </template>
                <template v-if="testResults.REDIS.max_connections !== null">
                  · 连接上限 {{ formatNumber(testResults.REDIS.max_connections) }}
                </template>
                <template v-if="testResults.REDIS.current_used !== null">
                  · 已用 {{ formatNumber(testResults.REDIS.current_used) }}
                </template>
              </template>
              <template v-else>{{ testResults.REDIS.error ?? '连接失败' }}</template>
              <p v-for="(warning, index) in testResults.REDIS.warnings" :key="index" class="ap-text-warning">
                {{ warning }}
              </p>
            </el-alert>

            <div class="ap-flex ap-gap-2 ap-config-actions">
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    :loading="testing.REDIS"
                    :disabled="!canWrite"
                    @click="testConnection('REDIS')"
                  >
                    测试连接
                  </el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    type="primary"
                    :loading="saving.REDIS"
                    :disabled="!canWrite"
                    @click="saveConfig('REDIS')"
                  >
                    保存
                  </el-button>
                </span>
              </el-tooltip>
              <el-button :disabled="!canWrite" @click="resetForm('REDIS')">重置</el-button>
            </div>
          </el-tab-pane>

          <!-- MySQL -->
          <el-tab-pane label="MySQL" name="MYSQL">
            <div class="ap-card__title">MySQL 连接配置</div>
            <div v-if="configsOfType('MYSQL').length > 1" class="ap-flex ap-gap-2 ap-config-picker">
              <span class="ap-text-secondary">选择配置</span>
              <el-select
                :model-value="selectedIds.MYSQL ?? undefined"
                class="ap-grow"
                @change="selectConfig('MYSQL', $event)"
              >
                <el-option
                  v-for="item in configsOfType('MYSQL')"
                  :key="item.id"
                  :label="`${item.name} (v${item.version})`"
                  :value="item.id"
                />
              </el-select>
            </div>
            <el-alert
              v-else-if="configsOfType('MYSQL').length === 0"
              class="ap-gap-2"
              type="info"
              show-icon
              :closable="false"
              title="尚无 MySQL 配置，填写后保存将新建"
            />
            <el-form :model="mysqlForm" label-width="130px" :disabled="!canRead">
              <el-form-item label="配置名称">
                <el-input v-model="mysqlForm.name" placeholder="mysql" />
              </el-form-item>
              <el-form-item label="地址">
                <el-input v-model="mysqlForm.host" placeholder="127.0.0.1" class="ap-mono" />
              </el-form-item>
              <el-form-item label="端口">
                <el-input-number v-model="mysqlForm.port" :min="1" :max="65535" controls-position="right" />
              </el-form-item>
              <el-form-item label="库名">
                <el-input v-model="mysqlForm.database" placeholder="audit" class="ap-mono" />
              </el-form-item>
              <el-form-item label="账号">
                <el-input v-model="mysqlForm.username" placeholder="audit" class="ap-mono" />
              </el-form-item>
              <el-form-item label="密码">
                <div class="ap-flex ap-gap-2">
                  <el-input
                    v-model="mysqlForm.password"
                    :placeholder="secretEditing.MYSQL ? '请输入新密码' : '••••••••'"
                    :disabled="!secretEditing.MYSQL"
                    type="password"
                    show-password
                    class="ap-grow"
                  />
                  <el-tooltip
                    :disabled="canReveal && secretEditing.MYSQL"
                    content="缺少 project:config:reveal 权限"
                    placement="top"
                  >
                    <span>
                      <el-button :disabled="!canReveal || secretEditing.MYSQL" @click="startEditSecret('MYSQL')">
                        修改
                      </el-button>
                    </span>
                  </el-tooltip>
                </div>
                <p v-if="secretMasked.MYSQL" class="ap-text-aux ap-mono">当前密钥：{{ secretMasked.MYSQL }}</p>
              </el-form-item>
              <el-form-item label="SSL 模式">
                <el-select v-model="mysqlForm.ssl_mode" class="ap-grow">
                  <el-option v-for="item in SSL_MODE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="maxPoolSize">
                <el-input-number v-model="mysqlForm.max_pool_size" :min="1" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="minIdle">
                <el-input-number v-model="mysqlForm.min_idle" :min="0" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="connectionTimeout(ms)">
                <el-input-number v-model="mysqlForm.connection_timeout_ms" :min="100" :max="600000" controls-position="right" />
              </el-form-item>
              <el-form-item label="idleTimeout(ms)">
                <el-input-number v-model="mysqlForm.idle_timeout_ms" :min="1000" :max="86400000" controls-position="right" />
              </el-form-item>
              <el-form-item label="maxLifetime(ms)">
                <el-input-number v-model="mysqlForm.max_lifetime_ms" :min="1000" :max="86400000" controls-position="right" />
              </el-form-item>
              <el-form-item label="只读标记">
                <el-switch v-model="mysqlForm.read_only" />
              </el-form-item>
            </el-form>

            <p class="ap-text-secondary">
              剩余可分配 = {{ testResults.MYSQL?.remain_for_project ?? '-' }}
              <template v-if="testResults.MYSQL?.global_limit !== null && testResults.MYSQL?.global_limit !== undefined">
                · 全局上限 = {{ formatNumber(testResults.MYSQL.global_limit) }}
              </template>
            </p>

            <el-alert
              v-if="testResults.MYSQL"
              class="ap-gap-2"
              :type="testResults.MYSQL.ok ? 'success' : 'error'"
              show-icon
              :closable="false"
              :title="testResults.MYSQL.ok ? '连接成功' : '连接失败'"
            >
              <template v-if="testResults.MYSQL.ok">
                延迟 {{ testResults.MYSQL.latency_ms }} ms
                <template v-if="testResults.MYSQL.server_info">
                  · 版本 {{ testResults.MYSQL.server_info }}
                </template>
                <template v-if="testResults.MYSQL.max_connections !== null">
                  · 连接上限 {{ formatNumber(testResults.MYSQL.max_connections) }}
                </template>
                <template v-if="testResults.MYSQL.current_used !== null">
                  · 已用 {{ formatNumber(testResults.MYSQL.current_used) }}
                </template>
              </template>
              <template v-else>{{ testResults.MYSQL.error ?? '连接失败' }}</template>
              <p v-for="(warning, index) in testResults.MYSQL.warnings" :key="index" class="ap-text-warning">
                {{ warning }}
              </p>
            </el-alert>

            <div class="ap-flex ap-gap-2 ap-config-actions">
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    :loading="testing.MYSQL"
                    :disabled="!canWrite"
                    @click="testConnection('MYSQL')"
                  >
                    测试连接
                  </el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    type="primary"
                    :loading="saving.MYSQL"
                    :disabled="!canWrite"
                    @click="saveConfig('MYSQL')"
                  >
                    保存
                  </el-button>
                </span>
              </el-tooltip>
              <el-button :disabled="!canWrite" @click="resetForm('MYSQL')">重置</el-button>
            </div>
          </el-tab-pane>

          <!-- 第三方 API -->
          <el-tab-pane label="第三方 API" name="API">
            <div class="ap-card__title">第三方 API 配置</div>
            <div v-if="configsOfType('API').length > 1" class="ap-flex ap-gap-2 ap-config-picker">
              <span class="ap-text-secondary">选择配置</span>
              <el-select
                :model-value="selectedIds.API ?? undefined"
                class="ap-grow"
                @change="selectConfig('API', $event)"
              >
                <el-option
                  v-for="item in configsOfType('API')"
                  :key="item.id"
                  :label="`${item.name} (v${item.version})`"
                  :value="item.id"
                />
              </el-select>
            </div>
            <el-alert
              v-else-if="configsOfType('API').length === 0"
              class="ap-gap-2"
              type="info"
              show-icon
              :closable="false"
              title="尚无第三方 API 配置，填写后保存将新建"
            />
            <el-form :model="apiForm" label-width="130px" :disabled="!canRead">
              <el-form-item label="名称">
                <el-input v-model="apiForm.name" placeholder="moderation_api" />
              </el-form-item>
              <el-form-item label="BaseURL">
                <el-input v-model="apiForm.base_url" placeholder="https://example.com/api" class="ap-mono" />
              </el-form-item>
              <el-form-item label="认证方式">
                <el-select v-model="apiForm.auth_type" class="ap-grow">
                  <el-option v-for="item in AUTH_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="密钥">
                <div class="ap-flex ap-gap-2">
                  <el-input
                    v-model="apiForm.secret"
                    :placeholder="secretEditing.API ? '请输入新密钥' : '••••••••'"
                    :disabled="!secretEditing.API"
                    type="password"
                    show-password
                    class="ap-grow"
                  />
                  <el-tooltip
                    :disabled="canReveal && secretEditing.API"
                    content="缺少 project:config:reveal 权限"
                    placement="top"
                  >
                    <span>
                      <el-button :disabled="!canReveal || secretEditing.API" @click="startEditSecret('API')">
                        修改
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-tooltip :disabled="canReveal" content="缺少 project:config:reveal 权限" placement="top">
                    <span>
                      <el-button :disabled="!canReveal" @click="revealSecret('API')">查看</el-button>
                    </span>
                  </el-tooltip>
                </div>
                <p v-if="secretMasked.API" class="ap-text-aux ap-mono">当前密钥：{{ secretMasked.API }}</p>
              </el-form-item>
              <el-form-item label="超时(ms)">
                <el-input-number v-model="apiForm.timeout_ms" :min="100" :max="600000" controls-position="right" />
              </el-form-item>
              <el-form-item label="重试次数">
                <el-input-number v-model="apiForm.retry_max_attempts" :min="0" :max="10" controls-position="right" />
              </el-form-item>
              <el-form-item label="退避策略">
                <el-select v-model="apiForm.backoff" class="ap-grow">
                  <el-option v-for="item in BACKOFF_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="熔断阈值">
                <el-input-number v-model="apiForm.breaker_threshold" :min="1" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="限流(QPS)">
                <el-input-number v-model="apiForm.rate_limit_qps" :min="1" :max="100000" controls-position="right" />
              </el-form-item>
              <el-form-item label="用途标签">
                <el-select v-model="apiForm.tags" multiple collapse-tags class="ap-grow">
                  <el-option v-for="item in TAG_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
            </el-form>

            <el-alert
              v-if="testResults.API"
              class="ap-gap-2"
              :type="testResults.API.ok ? 'success' : 'error'"
              show-icon
              :closable="false"
              :title="testResults.API.ok ? '连接成功' : '连接失败'"
            >
              <template v-if="testResults.API.ok">
                延迟 {{ testResults.API.latency_ms }} ms
                <template v-if="testResults.API.server_info">
                  · 版本 {{ testResults.API.server_info }}
                </template>
              </template>
              <template v-else>{{ testResults.API.error ?? '连接失败' }}</template>
              <p v-for="(warning, index) in testResults.API.warnings" :key="index" class="ap-text-warning">
                {{ warning }}
              </p>
            </el-alert>

            <div class="ap-flex ap-gap-2 ap-config-actions">
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    :loading="testing.API"
                    :disabled="!canWrite"
                    @click="testConnection('API')"
                  >
                    测试连接
                  </el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button
                    type="primary"
                    :loading="saving.API"
                    :disabled="!canWrite"
                    @click="saveConfig('API')"
                  >
                    保存
                  </el-button>
                </span>
              </el-tooltip>
              <el-button :disabled="!canWrite" @click="resetForm('API')">重置</el-button>
            </div>
          </el-tab-pane>

          <!-- 配额 -->
          <el-tab-pane label="配额" name="quota">
            <div class="ap-card__title">项目配额</div>
            <el-form :model="quotaForm" label-width="150px" :disabled="!canWrite">
              <el-form-item label="最大并发">
                <el-input-number v-model="quotaForm.max_concurrency" :min="1" :max="10000" controls-position="right" />
              </el-form-item>
              <el-form-item label="最大 QPS">
                <el-input-number v-model="quotaForm.max_qps" :min="1" :max="100000" controls-position="right" />
              </el-form-item>
              <el-form-item label="MySQL 连接池">
                <el-input-number v-model="quotaForm.max_mysql_pool" :min="1" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="Redis 连接数">
                <el-input-number v-model="quotaForm.max_redis_conn" :min="1" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="媒体大小 (MB)">
                <el-input-number v-model="quotaForm.max_media_size_mb" :min="1" :max="10240" controls-position="right" />
              </el-form-item>
              <el-form-item label="每日任务上限">
                <el-input-number
                  v-model="quotaForm.max_daily_tasks"
                  :min="1"
                  :max="10000000"
                  controls-position="right"
                  placeholder="不限"
                />
              </el-form-item>
              <el-form-item label="单任务 API 调用">
                <el-input-number v-model="quotaForm.max_api_call_per_task" :min="1" :max="1000" controls-position="right" />
              </el-form-item>
            </el-form>
            <div class="ap-flex ap-gap-2 ap-config-actions">
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button type="primary" :loading="quotaSaving" :disabled="!canWrite" @click="saveQuota">
                    保存
                  </el-button>
                </span>
              </el-tooltip>
            </div>
          </el-tab-pane>

          <!-- 成员 -->
          <el-tab-pane label="成员" name="members">
            <div class="ap-card__title">项目成员与授权</div>
            <div v-loading="membersLoading">
              <el-table v-if="members.length > 0" :data="members" class="ap-table ap-table--compact">
                <el-table-column prop="username" label="账号" width="160">
                  <template #default="{ row }">
                    <span class="ap-mono">{{ row.username }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="display_name" label="姓名" min-width="140">
                  <template #default="{ row }">
                    <span>{{ row.display_name ?? '-' }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="role" label="角色" width="140" />
                <el-table-column label="项目授权" width="140">
                  <template #default="{ row }">
                    <StatusTag
                      :label="memberGranted(row.id) ? '已授权' : '未授权'"
                      :tone="memberGranted(row.id) ? 'pass' : 'neutral'"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120">
                  <template #default="{ row }">
                    <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                      <span>
                        <el-button
                          link
                          type="primary"
                          :disabled="!canWrite"
                          @click="toggleMemberScope(row)"
                        >
                          {{ memberGranted(row.id) ? '取消授权' : '授予' }}
                        </el-button>
                      </span>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
              <EmptyState v-else title="暂无成员" />
            </div>
            <div class="ap-flex ap-gap-2 ap-config-actions">
              <el-button @click="loadMembers">刷新</el-button>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 版本区 -->
    <div class="ap-card">
      <div class="ap-card__header">
        <h3 class="ap-card__title">版本记录</h3>
      </div>
      <div class="ap-card__body ap-card__body--flush">
        <el-tabs v-model="tab" class="ap-version-tabs">
          <el-tab-pane label="Redis" name="REDIS" />
          <el-tab-pane label="MySQL" name="MYSQL" />
          <el-tab-pane label="第三方 API" name="API" />
        </el-tabs>
        <el-table
          v-if="tab === 'REDIS' || tab === 'MYSQL' || tab === 'API'"
          :data="versions[tab] ?? []"
          class="ap-table ap-table--compact"
          v-loading="versionsLoading[tab]"
        >
          <el-table-column prop="version" label="版本" width="100">
            <template #default="{ row }">
              <span class="ap-mono">v{{ row.version }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" width="140">
            <template #default="{ row }">
              <span class="ap-mono">{{ row.operator }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="change_note" label="变更说明" min-width="180">
            <template #default="{ row }">
              <span>{{ row.change_note ?? '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" width="160">
            <template #default="{ row }">
              <span class="ap-mono">{{ formatDateTime(row.created_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-tooltip :disabled="canWrite" content="缺少 project:config:write 权限" placement="top">
                <span>
                  <el-button link type="primary" :disabled="!canWrite" @click="rollback(tab, row.version)">
                    回滚
                  </el-button>
                </span>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <EmptyState v-else title="暂无版本记录" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap-config-tabs :deep(.el-tabs__content) {
  padding-left: var(--ap-space-5);
}

.ap-config-actions {
  margin-top: var(--ap-space-4);
  padding-top: var(--ap-space-4);
  border-top: 1px solid var(--ap-border);
}

.ap-config-picker {
  margin-bottom: var(--ap-space-4);
}

.ap-version-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--ap-space-3);
}

.ap-text-aux {
  margin: var(--ap-space-1) 0 0;
}
</style>
