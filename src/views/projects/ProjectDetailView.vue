<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  deleteProject,
  enableProject,
  getProject,
  pauseProject,
  updateProject,
} from '@/api/projects'
import { listAudits } from '@/api/audits'
import { listConfigs } from '@/api/configs'
import { listAuditLogs } from '@/api/auditLogs'
import { getAlerts, getMetrics } from '@/api/metrics'
import { getUserProjects, listUsers } from '@/api/users'
import type {
  AdminUserItem,
  AuditItem,
  AuditLogItem,
  MetricsOverview,
  ProjectConfigItem,
  ProjectEnv,
  ProjectItem,
} from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatFullDateTime, formatNumber } from '@/utils/format'
import {
  auditActionLabel,
  auditStatusMeta,
  configTypeLabel,
  projectEnvLabel,
  projectStatusMeta,
  roleLabel,
} from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import DonutChart from '@/components/charts/DonutChart.vue'

const props = defineProps<{ id: string | number }>()

const router = useRouter()
const auth = useAuthStore()

const projectId = computed(() => Number(props.id))

const project = ref<ProjectItem | null>(null)
const loading = ref(false)
const error = ref('')

const activeTab = ref('overview')

/* ---------------- 概览 ---------------- */

const metrics = ref<MetricsOverview | null>(null)

const statusDistribution = computed(() => {
  const source = metrics.value
  return [
    { label: '通过', value: source?.pass ?? 0, color: 'var(--ap-color-pass)' },
    { label: '不通过', value: source?.reject ?? 0, color: 'var(--ap-color-reject)' },
    { label: '待议', value: source?.review ?? 0, color: 'var(--ap-color-review)' },
    { label: '失败', value: source?.failed ?? 0, color: 'var(--ap-text-secondary)' },
  ]
})

type QuotaRow = {
  label: string
  used: number
  limit: number | null
}

const quotaRows = computed<QuotaRow[]>(() => {
  const item = project.value
  if (!item) return []
  return [
    { label: '今日任务 / 每日上限', used: item.stats.task_today, limit: item.quota.max_daily_tasks },
    { label: '队列积压 / 并发上限', used: item.stats.queue_backlog, limit: item.quota.max_concurrency },
  ]
})

function quotaRatio(row: QuotaRow): number {
  if (!row.limit || row.limit <= 0) return 0
  return Math.min(1, row.used / row.limit)
}

function quotaFillClass(row: QuotaRow): string {
  const ratio = quotaRatio(row)
  if (ratio > 0.95) return 'ap-quota__fill--danger'
  if (ratio > 0.8) return 'ap-quota__fill--warn'
  return ''
}

/* ---------------- 连接配置 ---------------- */

const configs = ref<ProjectConfigItem[]>([])
const configsLoading = ref(false)

/* ---------------- 审核 ---------------- */

const audits = ref<AuditItem[]>([])
const auditsLoading = ref(false)

/* ---------------- 成员 ---------------- */

const members = ref<AdminUserItem[]>([])
const users = ref<AdminUserItem[]>([])
const memberScopes = ref<Record<number, boolean>>({})
const membersLoading = ref(false)

/* ---------------- 告警与日志 ---------------- */

const alerts = ref<MetricsOverview['alerts']>([])
const logs = ref<AuditLogItem[]>([])
const logsLoading = ref(false)

/* ---------------- 操作 ---------------- */

const editVisible = ref(false)
const editSubmitting = ref(false)
const editForm = ref<{ name: string; env: ProjectEnv; owner_id?: number; description: string }>({
  name: '',
  env: 'dev',
  description: '',
})

const ENV_OPTIONS: Array<{ value: ProjectEnv; label: string }> = [
  { value: 'dev', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'staging', label: '预发' },
  { value: 'prod', label: '生产' },
]

function openEdit() {
  const item = project.value
  if (!item) return
  editForm.value = {
    name: item.name,
    env: item.env,
    owner_id: item.owner_id,
    description: item.description ?? '',
  }
  editVisible.value = true
}

async function submitEdit() {
  const item = project.value
  if (!item) return
  editSubmitting.value = true
  try {
    await updateProject(item.id, {
      name: editForm.value.name.trim(),
      env: editForm.value.env,
      owner_id: editForm.value.owner_id,
      description: editForm.value.description.trim(),
      version: item.version,
    })
    ElMessage.success('项目已更新')
    editVisible.value = false
    await loadProject()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    editSubmitting.value = false
  }
}

async function toggleStatus() {
  const item = project.value
  if (!item) return
  try {
    if (item.status === 'ACTIVE') {
      const { value } = await ElMessageBox.prompt('请输入暂停原因', '暂停项目', {
        confirmButtonText: '暂停',
        cancelButtonText: '取消',
        inputPlaceholder: '暂停原因',
        inputValidator: (input: string) => (input.trim() ? true : '请输入暂停原因'),
        type: 'warning',
      })
      await pauseProject(item.id, value.trim())
      ElMessage.success('项目已暂停')
    } else {
      await ElMessageBox.confirm(`确认启用项目「${item.name}」？`, '启用项目', {
        confirmButtonText: '启用',
        cancelButtonText: '取消',
        type: 'warning',
      })
      await enableProject(item.id)
      ElMessage.success('项目已启用')
    }
    await loadProject()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function removeProject() {
  const item = project.value
  if (!item) return
  try {
    await ElMessageBox.confirm(
      `删除项目「${item.name}」将移入回收站，保留期内可恢复。若项目存在运行中任务，需强制删除。`,
      '删除项目',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await deleteProject(item.id)
    ElMessage.success('项目已移入回收站')
    void router.push({ name: 'project-list' })
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
        await deleteProject(item.id, true)
        ElMessage.success('项目已强制移入回收站')
        void router.push({ name: 'project-list' })
      } catch (forceErr) {
        ElMessage.error(forceErr instanceof ApiError ? forceErr.message : '操作失败')
      }
      return
    }
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

function openConfigView() {
  void router.push({ name: 'project-config', params: { id: String(projectId.value) } })
}

/* ---------------- 加载 ---------------- */

async function loadProject() {
  loading.value = true
  error.value = ''
  try {
    project.value = await getProject(projectId.value)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
    project.value = null
  } finally {
    loading.value = false
  }
}

async function loadOverview() {
  try {
    metrics.value = await getMetrics({ scope: 'project', id: projectId.value, range: '24h' })
  } catch {
    metrics.value = null
  }
}

async function loadConfigs() {
  configsLoading.value = true
  try {
    const payload = await listConfigs(projectId.value, { page: 1, page_size: 50 })
    configs.value = payload.items ?? []
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    configs.value = []
  } finally {
    configsLoading.value = false
  }
}

async function loadAudits() {
  auditsLoading.value = true
  try {
    const payload = await listAudits(projectId.value, { page: 1, page_size: 50 })
    audits.value = payload.items ?? []
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    audits.value = []
  } finally {
    auditsLoading.value = false
  }
}

async function loadMembers() {
  membersLoading.value = true
  try {
    const payload = await listUsers({ page: 1, page_size: 100 })
    members.value = payload.items ?? []
    const scopes: Record<number, boolean> = {}
    await Promise.all(
      members.value.map(async (item) => {
        try {
          const scope = await getUserProjects(item.id)
          scopes[item.id] = (scope.project_ids ?? []).includes(projectId.value)
        } catch {
          scopes[item.id] = false
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

async function loadAlerts() {
  try {
    alerts.value = (await getAlerts()) ?? []
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    alerts.value = []
  }
}

async function loadLogs() {
  logsLoading.value = true
  try {
    const payload = await listAuditLogs({
      'filter[project_id]': projectId.value,
      page: 1,
      page_size: 20,
    })
    logs.value = payload.items ?? []
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
    logs.value = []
  } finally {
    logsLoading.value = false
  }
}

function onTabChange(name: string) {
  if (name === 'config') void loadConfigs()
  if (name === 'audits') void loadAudits()
  if (name === 'members') void loadMembers()
  if (name === 'alerts') void loadAlerts()
  if (name === 'logs') void loadLogs()
}

onMounted(() => {
  void loadProject()
  void loadOverview()
  void loadUsers()
})

async function loadUsers() {
  try {
    const payload = await listUsers({ page: 1, page_size: 100 })
    users.value = payload.items ?? []
  } catch {
    users.value = []
  }
}

watch(projectId, () => {
  void loadProject()
  void loadOverview()
})
</script>

<template>
  <div class="ap-page" v-loading="loading">
    <PageHeader :title="project?.name ?? '项目详情'" :desc="project ? `${project.code} · ${projectEnvLabel(project.env)}` : ''">
      <template #extra>
        <div class="ap-flex ap-gap-2">
          <StatusTag
            v-if="project"
            :label="projectStatusMeta(project.status).label"
            :tone="projectStatusMeta(project.status).tone"
          />
          <el-tag v-if="project" type="info" effect="plain" size="small">{{ projectEnvLabel(project.env) }}</el-tag>
        </div>
      </template>
      <template #actions>
        <el-button :disabled="!project" @click="openEdit">编辑</el-button>
        <el-button type="primary" :disabled="!project" @click="openConfigView">配置</el-button>
        <el-tooltip :disabled="auth.can('project:write')" content="缺少 project:write 权限" placement="top">
          <span>
            <el-button :disabled="!project || !auth.can('project:write')" @click="toggleStatus">
              {{ project?.status === 'ACTIVE' ? '暂停' : '启用' }}
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="auth.can('project:delete')" content="缺少 project:delete 权限" placement="top">
          <span>
            <el-button type="danger" :disabled="!project || !auth.can('project:delete')" @click="removeProject">
              删除
            </el-button>
          </span>
        </el-tooltip>
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

    <el-alert v-if="error" type="error" show-icon :closable="false" :title="error" />

    <el-tabs v-if="project" v-model="activeTab" class="ap-card" @tab-change="onTabChange">
      <!-- 概览 -->
      <el-tab-pane label="概览" name="overview">
        <div class="ap-card__body">
          <div class="ap-card__title">基本信息</div>
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="名称">{{ project.name }}</el-descriptions-item>
            <el-descriptions-item label="编码">
              <span class="ap-mono">{{ project.code }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="环境">{{ projectEnvLabel(project.env) }}</el-descriptions-item>
            <el-descriptions-item label="负责人">{{ project.owner_name ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="保留天数">{{ project.retain_days }} 天</el-descriptions-item>
            <el-descriptions-item label="描述">{{ project.description || '-' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">
              <span class="ap-mono">{{ formatFullDateTime(project.created_at) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="更新时间">
              <span class="ap-mono">{{ formatFullDateTime(project.updated_at) }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="ap-metrics ap-gap-4">
            <div class="ap-metric">
              <p class="ap-metric__label">今日任务</p>
              <p class="ap-metric__value ap-mono">{{ formatNumber(project.stats.task_today) }}</p>
            </div>
            <div class="ap-metric">
              <p class="ap-metric__label">累计任务</p>
              <p class="ap-metric__value ap-mono">{{ formatNumber(project.stats.task_total) }}</p>
            </div>
            <div class="ap-metric">
              <p class="ap-metric__label">队列积压</p>
              <p
                class="ap-metric__value ap-mono"
                :class="project.stats.queue_backlog > 100 ? 'ap-text-danger' : ''"
              >
                {{ formatNumber(project.stats.queue_backlog) }}
              </p>
            </div>
            <div class="ap-metric">
              <p class="ap-metric__label">审核数</p>
              <p class="ap-metric__value ap-mono">{{ formatNumber(project.stats.audit_count) }}</p>
            </div>
          </div>

          <div class="ap-flex ap-gap-4">
            <div class="ap-card__title">状态分布（24 小时）</div>
            <DonutChart :items="statusDistribution" />
          </div>

          <div class="ap-card__title">配额</div>
          <div class="ap-quota-list">
            <div v-for="row in quotaRows" :key="row.label" class="ap-quota">
              <div class="ap-flex">
                <span class="ap-grow">{{ row.label }}</span>
                <span class="ap-mono ap-text-secondary">
                  {{ formatNumber(row.used) }} / {{ row.limit === null ? '不限' : formatNumber(row.limit) }}
                </span>
              </div>
              <div class="ap-quota__bar">
                <div class="ap-quota__fill" :class="quotaFillClass(row)" :style="{ width: `${quotaRatio(row) * 100}%` }" />
              </div>
            </div>
          </div>

          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="最大并发">
              <span class="ap-mono">{{ formatNumber(project.quota.max_concurrency) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="最大 QPS">
              <span class="ap-mono">{{ formatNumber(project.quota.max_qps) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="MySQL 连接池">
              <span class="ap-mono">{{ formatNumber(project.quota.max_mysql_pool) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="Redis 连接数">
              <span class="ap-mono">{{ formatNumber(project.quota.max_redis_conn) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="媒体大小上限">
              <span class="ap-mono">{{ formatNumber(project.quota.max_media_size_mb) }} MB</span>
            </el-descriptions-item>
            <el-descriptions-item label="每日任务上限">
              <span class="ap-mono">
                {{ project.quota.max_daily_tasks === null ? '不限' : formatNumber(project.quota.max_daily_tasks) }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </el-tab-pane>

      <!-- 配置 -->
      <el-tab-pane label="配置" name="config">
        <div class="ap-card__body" v-loading="configsLoading">
          <div v-if="configs.length === 0" class="ap-empty">
            <EmptyState title="暂无连接配置" desc="前往项目配置页新增连接配置">
              <el-button type="primary" @click="openConfigView">去配置</el-button>
            </EmptyState>
          </div>
          <div v-else class="ap-config-grid">
            <div
              v-for="item in configs"
              :key="item.id"
              class="ap-config-card ap-link"
              @click="openConfigView"
            >
              <div class="ap-flex">
                <span class="ap-grow">{{ item.name }}</span>
                <StatusTag
                  :label="item.test_status === 'OK' ? '连接正常' : item.test_status === 'FAILED' ? '连接失败' : '未测试'"
                  :tone="item.test_status === 'OK' ? 'pass' : item.test_status === 'FAILED' ? 'reject' : 'neutral'"
                />
              </div>
              <div class="ap-text-secondary ap-text-aux">
                {{ configTypeLabel(item.type) }} · v{{ item.version }}
              </div>
              <div class="ap-text-aux ap-mono">{{ formatDateTime(item.updated_at) }}</div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 审核 -->
      <el-tab-pane label="审核" name="audits">
        <div class="ap-card__body ap-card__body--flush" v-loading="auditsLoading">
          <el-table v-if="audits.length > 0" :data="audits" class="ap-table ap-table--compact">
            <el-table-column prop="name" label="审核名称" min-width="160" />
            <el-table-column prop="code" label="审核编码" width="140">
              <template #default="{ row }">
                <span class="ap-mono">{{ row.code }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :label="auditStatusMeta(row.status).label" :tone="auditStatusMeta(row.status).tone" />
              </template>
            </el-table-column>
            <el-table-column prop="concurrency" label="并发" width="100" align="right">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.concurrency) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="timeout_ms" label="超时(ms)" width="120" align="right">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatNumber(row.timeout_ms) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="updated_at" label="更新时间" width="160">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.updated_at) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <EmptyState v-else title="暂无审核定义" />
        </div>
      </el-tab-pane>

      <!-- 成员与权限 -->
      <el-tab-pane label="成员与权限" name="members">
        <div class="ap-card__body ap-card__body--flush" v-loading="membersLoading">
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
            <el-table-column prop="role" label="角色" width="140">
              <template #default="{ row }">
                <span>{{ roleLabel(row.role) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <StatusTag
                  :label="row.status === 'ACTIVE' ? '正常' : row.status === 'LOCKED' ? '锁定' : '停用'"
                  :tone="row.status === 'ACTIVE' ? 'pass' : row.status === 'LOCKED' ? 'review' : 'neutral'"
                />
              </template>
            </el-table-column>
            <el-table-column label="项目授权" width="120">
              <template #default="{ row }">
                <StatusTag
                  :label="memberScopes[row.id] ? '已授权' : '未授权'"
                  :tone="memberScopes[row.id] ? 'pass' : 'neutral'"
                />
              </template>
            </el-table-column>
            <el-table-column prop="last_login_at" label="最近登录" width="160">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.last_login_at) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <EmptyState v-else title="暂无成员" />
        </div>
      </el-tab-pane>

      <!-- 最近告警 -->
      <el-tab-pane label="最近告警" name="alerts">
        <div class="ap-card__body ap-card__body--flush">
          <el-table v-if="alerts.length > 0" :data="alerts" class="ap-table ap-table--compact">
            <el-table-column prop="name" label="告警名称" min-width="160" />
            <el-table-column prop="level" label="级别" width="100">
              <template #default="{ row }">
                <span class="ap-mono">{{ row.level }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="110">
              <template #default="{ row }">
                <StatusTag
                  :label="row.status === 'FIRING' ? '触发中' : row.status === 'RESOLVED' ? '已恢复' : row.status"
                  :tone="row.status === 'FIRING' ? 'reject' : row.status === 'RESOLVED' ? 'pass' : 'neutral'"
                />
              </template>
            </el-table-column>
            <el-table-column prop="message" label="消息" min-width="240" />
            <el-table-column prop="started_at" label="开始时间" width="160">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.started_at) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <EmptyState v-else title="暂无告警" />
        </div>
      </el-tab-pane>

      <!-- 审计日志 -->
      <el-tab-pane label="审计日志" name="logs">
        <div class="ap-card__body ap-card__body--flush" v-loading="logsLoading">
          <el-table v-if="logs.length > 0" :data="logs" class="ap-table ap-table--compact">
            <el-table-column prop="created_at" label="时间" width="160">
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.created_at) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="operator" label="操作人" width="140">
              <template #default="{ row }">
                <span class="ap-mono">{{ row.operator }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="action" label="操作" width="160">
              <template #default="{ row }">
                <span>{{ auditActionLabel(row.action) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="object_type" label="对象" width="140">
              <template #default="{ row }">
                <span>{{ row.object_type ?? '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="result" label="结果" width="100">
              <template #default="{ row }">
                <StatusTag
                  :label="row.result === 'SUCCESS' ? '成功' : '失败'"
                  :tone="row.result === 'SUCCESS' ? 'pass' : 'reject'"
                />
              </template>
            </el-table-column>
          </el-table>
          <EmptyState v-else title="暂无审计日志" />
        </div>
      </el-tab-pane>
    </el-tabs>

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
.ap-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--ap-space-4);
}

.ap-config-card {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-4);
  background: var(--ap-bg-card);
  cursor: pointer;
}

.ap-quota-list {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-3);
  margin-bottom: var(--ap-space-4);
}
</style>
