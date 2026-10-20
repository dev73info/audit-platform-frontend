<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import { ApiError } from '@/api/http'
import {
  createApiClient,
  deleteApiClient,
  listApiClients,
  rotateSecret,
  updateApiClient,
  type ApiClientListParams,
} from '@/api/apiClients'
import type { ApiClientItem } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatDateTime, formatNumber } from '@/utils/format'
import type { SemanticTone } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 接入规格：请求头、CanonicalString 与签名算法。 */
const SIGN_SPEC = [
  'X-Api-Key: {app_key}',
  'X-Timestamp: {毫秒时间戳}',
  'X-Nonce: {32 位随机串}',
  'X-Signature: {HMAC-SHA256(AppSecret, CanonicalString) 十六进制小写}',
  '',
  'CanonicalString = Method + "\\n" + Path + "\\n" + Timestamp + "\\n" + Nonce + "\\n" + SHA256HEX(Body)',
  '',
  '签名算法：HMAC-SHA256(AppSecret, CanonicalString)，输出十六进制小写',
  '时间戳偏差 ≤ 5 分钟，Nonce 10 分钟内不可重复',
].join('\n')

const SORTABLE_FIELDS = ['name', 'created_at', 'last_used_at']

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'DISABLED', label: '停用' },
]

const auth = useAuthStore()
const projectStore = useProjectStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: ['status'],
  defaultPageSize: 20,
})

const table = useTableLoader<ApiClientItem>(async (params) => {
  const projectId = projectStore.currentId
  if (!projectId) return { items: [], total: 0 }
  const payload = await listApiClients(projectId, params as ApiClientListParams)
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 筛选 ---------------- */

const keywordInput = ref('')
const statusFilter = ref('')

function filterValue(key: string): string {
  return query.filters[key] ?? ''
}

watch(
  () => query.keyword.value,
  (value) => {
    keywordInput.value = value
  },
  { immediate: true },
)
watch(
  () => filterValue('status'),
  (value) => {
    statusFilter.value = value
  },
  { immediate: true },
)

function applyKeyword() {
  query.setKeyword(keywordInput.value.trim())
}

function applyStatus(value: string) {
  query.setFilter('status', value)
}

function onProjectChange(value: number) {
  projectStore.select(value)
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

/* ---------------- 行数据 ---------------- */

function statusMeta(status: string): { label: string; tone: SemanticTone } {
  if (status === 'ACTIVE') return { label: '启用', tone: 'pass' }
  if (status === 'DISABLED') return { label: '停用', tone: 'neutral' }
  return { label: status, tone: 'neutral' }
}

function rateLimitText(row: ApiClientItem): string {
  const limit = row.rate_limit ?? {}
  if (Object.keys(limit).length === 0) return '-'
  return JSON.stringify(limit)
}

function allowIpsText(row: ApiClientItem): string {
  if (!row.allow_ips || row.allow_ips.length === 0) return '-'
  return row.allow_ips.join('、')
}

/* ---------------- 新建 / 编辑 ---------------- */

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editing = ref<ApiClientItem | null>(null)

const form = reactive({
  name: '',
  status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
  rate_limit: '{}',
  allow_ips: '',
  callback_url: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入客户端名称', trigger: 'blur' }],
}

/** 限流按 JSON 对象提交。 */
function parseRateLimit(): Record<string, unknown> | null {
  const text = form.rate_limit.trim()
  if (!text) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function parseAllowIps(): string[] {
  return form.allow_ips
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function openCreate() {
  dialogMode.value = 'create'
  editing.value = null
  form.name = ''
  form.status = 'ACTIVE'
  form.rate_limit = '{}'
  form.allow_ips = ''
  form.callback_url = ''
  dialogVisible.value = true
}

function openEdit(row: ApiClientItem) {
  dialogMode.value = 'edit'
  editing.value = row
  const limit = rateLimitText(row)
  form.name = row.name
  form.status = row.status
  form.rate_limit = limit === '-' ? '{}' : limit
  form.allow_ips = row.allow_ips.join('\n')
  form.callback_url = row.callback_url ?? ''
  dialogVisible.value = true
}

async function submitDialog() {
  const instance = formRef.value
  if (instance) {
    const valid = await instance.validate().catch(() => false)
    if (!valid) return
  }
  const rateLimit = parseRateLimit()
  if (!rateLimit) {
    ElMessage.error('限流需为 JSON 对象')
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      const projectId = projectStore.currentId
      if (!projectId) {
        ElMessage.error('请先选择项目')
        return
      }
      const created = await createApiClient(projectId, {
        name: form.name.trim(),
        rate_limit: rateLimit,
        allow_ips: parseAllowIps(),
        callback_url: form.callback_url.trim(),
      })
      ElMessage.success('客户端已创建')
      dialogVisible.value = false
      await table.load(query.requestParams.value)
      showSecret(created.app_key, created.secret ?? '')
      return
    }
    const row = editing.value
    if (!row) return
    await updateApiClient(row.id, {
      name: form.name.trim(),
      status: form.status,
      rate_limit: rateLimit,
      allow_ips: parseAllowIps(),
      callback_url: form.callback_url.trim(),
    })
    ElMessage.success('客户端已更新')
    dialogVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

/* ---------------- 密钥展示（仅一次） ---------------- */

const secretVisible = ref(false)
const secretAppKey = ref('')
const secretValue = ref('')

function showSecret(appKey: string, secret: string) {
  secretAppKey.value = appKey
  secretValue.value = secret
  secretVisible.value = true
}

function closeSecret() {
  secretVisible.value = false
  secretAppKey.value = ''
  secretValue.value = ''
}

/* ---------------- 轮换密钥 ---------------- */

async function rotate(row: ApiClientItem) {
  try {
    await ElMessageBox.confirm(`轮换后「${row.name}」的旧密钥立即失效。`, '轮换密钥', {
      confirmButtonText: '轮换',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const result = await rotateSecret(row.id)
    ElMessage.success('密钥已轮换')
    await table.load(query.requestParams.value)
    showSecret(result.app_key, result.secret)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 删除 ---------------- */

async function removeClient(row: ApiClientItem) {
  try {
    await ElMessageBox.confirm(`删除客户端「${row.name}」后不可恢复。`, '删除客户端', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deleteApiClient(row.id)
    ElMessage.success('客户端已删除')
    await table.load(query.requestParams.value)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
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

watch(
  () => projectStore.currentId,
  () => {
    void table.load(query.requestParams.value)
  },
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
    <PageHeader title="开放 API 客户端" desc="项目接入凭证与调用配额">
      <template #actions>
        <el-tooltip :disabled="auth.can('apiclient:write')" content="缺少 apiclient:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!auth.can('apiclient:write')" @click="openCreate">
              新建客户端
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <div class="ap-card ap-client__spec">
      <div class="ap-card__body">
        <div class="ap-card__title">接入规格</div>
        <pre class="ap-spec">{{ SIGN_SPEC }}</pre>
      </div>
    </div>

    <div class="ap-card">
      <div class="ap-filter">
        <el-select
          :model-value="projectStore.currentId"
          class="ap-filter__field"
          placeholder="项目"
          @change="onProjectChange"
        >
          <el-option
            v-for="item in projectStore.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-input
          v-model="keywordInput"
          class="ap-filter__keyword"
          placeholder="客户端名称"
          clearable
          @keyup.enter="applyKeyword"
          @clear="applyKeyword"
        />
        <el-select
          v-model="statusFilter"
          class="ap-filter__field"
          clearable
          placeholder="状态"
          @change="applyStatus"
        >
          <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" plain @click="applyKeyword">查询</el-button>
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

        <div v-loading="table.loading.value">
          <el-table v-if="table.items.value.length > 0" :data="table.items.value" class="ap-table ap-table--compact">
            <el-table-column prop="app_key" label="AppKey" min-width="200">
              <template #default="{ row }">
                <span class="ap-mono">{{ row.app_key }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="name" label="名称" min-width="150">
              <template #header>
                <SortableHeader
                  field="name"
                  label="名称"
                  :sort="sortText"
                  :sortable="isSortable('name')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span>{{ row.name }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :label="statusMeta(row.status).label" :tone="statusMeta(row.status).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="rate_limit" label="限流" min-width="140">
              <template #default="{ row }">
                <span class="ap-mono ap-truncate">{{ rateLimitText(row) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="allow_ips" label="IP 白名单" min-width="150">
              <template #default="{ row }">
                <span class="ap-mono ap-truncate">{{ allowIpsText(row) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="callback_url" label="回调地址" min-width="180">
              <template #default="{ row }">
                <span class="ap-mono ap-truncate">{{ row.callback_url ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="last_used_at" label="最后使用时间" width="160">
              <template #header>
                <SortableHeader
                  field="last_used_at"
                  label="最后使用时间"
                  :sort="sortText"
                  :sortable="isSortable('last_used_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.last_used_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-tooltip :disabled="auth.can('apiclient:write')" content="缺少 apiclient:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('apiclient:write')"
                      @click="openEdit(row)"
                    >
                      编辑
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('apiclient:write')" content="缺少 apiclient:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('apiclient:write')"
                      @click="rotate(row)"
                    >
                      轮换密钥
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('apiclient:write')" content="缺少 apiclient:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('apiclient:write')"
                      @click="removeClient(row)"
                    >
                      删除
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无客户端" desc="调整筛选条件或新建客户端">
            <el-button type="primary" :disabled="!auth.can('apiclient:write')" @click="openCreate">
              新建客户端
            </el-button>
          </EmptyState>
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 个客户端</span>
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

    <!-- 新建 / 编辑客户端 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建客户端' : '编辑客户端'"
      width="620px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入客户端名称" maxlength="64" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" class="ap-grow">
            <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="限流">
          <el-input v-model="form.rate_limit" type="textarea" :rows="3" class="ap-mono" placeholder="JSON 对象" />
        </el-form-item>
        <el-form-item label="IP 白名单">
          <el-input v-model="form.allow_ips" type="textarea" :rows="3" placeholder="每行一个 IP" />
        </el-form-item>
        <el-form-item label="回调地址">
          <el-input v-model="form.callback_url" placeholder="回调地址" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitDialog">
          {{ dialogMode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 明文密钥：仅展示一次 -->
    <el-dialog v-model="secretVisible" title="AppSecret" width="560px" destroy-on-close>
      <el-alert type="warning" show-icon :closable="false" title="AppSecret 仅展示一次，关闭后不再显示" />
      <div class="ap-secret__row">
        <span class="ap-secret__label">AppKey</span>
        <span class="ap-mono ap-secret__value">{{ secretAppKey }}</span>
      </div>
      <div class="ap-secret__row">
        <span class="ap-secret__label">AppSecret</span>
        <span class="ap-mono ap-secret__value">{{ secretValue }}</span>
      </div>
      <template #footer>
        <el-button type="primary" @click="closeSecret">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ap-client__spec {
  margin-bottom: var(--ap-space-3);
}

.ap-spec {
  margin: var(--ap-space-2) 0 0;
  padding: var(--ap-space-3);
  border-radius: var(--ap-radius-card);
  background: var(--ap-bg-page);
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
}

.ap-filter__keyword {
  width: 200px;
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

.ap-secret__row {
  display: flex;
  align-items: flex-start;
  gap: var(--ap-space-3);
  margin-top: var(--ap-space-3);
}

.ap-secret__label {
  width: 80px;
  flex: none;
  color: var(--ap-text-secondary);
}

.ap-secret__value {
  font-size: 13px;
  word-break: break-all;
}
</style>
