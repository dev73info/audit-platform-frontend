<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

import { ApiError, post } from '@/api/http'
import {
  createUser,
  getUserProjects,
  listUsers,
  updateUser,
  updateUserProjects,
  type UserListParams,
} from '@/api/users'
import type { AdminUserItem, RoleCode } from '@/api/types'
import { useListQuery, useTableLoader } from '@/composables/useListQuery'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { formatDateTime, formatFullDateTime, formatNumber } from '@/utils/format'
import { roleLabel, type SemanticTone } from '@/utils/labels'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SortableHeader from '@/components/SortableHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

const SORTABLE_FIELDS = ['username', 'created_at', 'last_login_at']

const ROLE_OPTIONS: Array<{ value: RoleCode; label: string }> = [
  'SUPER_ADMIN',
  'PROJECT_ADMIN',
  'AUDIT_CONFIGURER',
  'REVIEWER',
  'READONLY',
].map((value) => ({ value: value as RoleCode, label: roleLabel(value) }))

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'LOCKED', label: '锁定' },
  { value: 'DISABLED', label: '停用' },
]

/** 口令强度：≥ 10 位，大小写字母 / 数字 / 特殊字符至少命中 3 类。 */
function passwordReason(value: string): string {
  if (value.length === 0) return '请输入口令'
  if (value.length < 10) return '口令长度至少 10 位'
  const kinds = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^a-zA-Z0-9]/.test(value),
  ].filter((hit) => hit).length
  if (kinds < 3) return '口令需包含大写字母、小写字母、数字、特殊字符中的至少 3 类'
  return ''
}

/** 生成 16 位随机口令。 */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const specials = '!@#$%^&*?-_'
  const all = upper + lower + digits + specials
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (byte) => all[byte % all.length] ?? 'a')
  chars[0] = upper[(bytes[0] ?? 0) % upper.length] ?? 'A'
  chars[1] = lower[(bytes[1] ?? 0) % lower.length] ?? 'a'
  chars[2] = digits[(bytes[2] ?? 0) % digits.length] ?? '2'
  chars[3] = specials[(bytes[3] ?? 0) % specials.length] ?? '!'
  return chars.join('')
}

const auth = useAuthStore()
const projectStore = useProjectStore()

const query = useListQuery({
  defaultSort: { field: 'created_at', direction: 'desc' },
  sortableFields: SORTABLE_FIELDS,
  filterKeys: ['role', 'status'],
  defaultPageSize: 20,
})

const table = useTableLoader<AdminUserItem>(async (params) => {
  const payload = await listUsers(params as UserListParams)
  return { items: payload.items ?? [], total: payload.total ?? 0 }
})

/* ---------------- 筛选 ---------------- */

const keywordInput = ref('')
const roleFilter = ref('')
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
  () => filterValue('role'),
  (value) => {
    roleFilter.value = value
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

function applyRole(value: string) {
  query.setFilter('role', value)
}

function applyStatus(value: string) {
  query.setFilter('status', value)
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
  if (status === 'LOCKED') return { label: '锁定', tone: 'reject' }
  if (status === 'DISABLED') return { label: '停用', tone: 'neutral' }
  return { label: status, tone: 'neutral' }
}

/* ---------------- 新建 / 编辑 ---------------- */

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editing = ref<AdminUserItem | null>(null)

const form = reactive({
  username: '',
  display_name: '',
  email: '',
  role: 'READONLY' as RoleCode,
  password: '',
  project_ids: [] as number[],
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  password: [
    { required: true, message: '请输入初始口令', trigger: 'blur' },
    { min: 10, message: '口令长度至少 10 位', trigger: 'blur' },
  ],
}

function openCreate() {
  dialogMode.value = 'create'
  editing.value = null
  form.username = ''
  form.display_name = ''
  form.email = ''
  form.role = 'READONLY'
  form.password = ''
  form.project_ids = []
  dialogVisible.value = true
}

function openEdit(row: AdminUserItem) {
  dialogMode.value = 'edit'
  editing.value = row
  form.username = row.username
  form.display_name = row.display_name ?? ''
  form.email = row.email ?? ''
  form.role = row.role
  form.password = ''
  form.project_ids = [...row.projects]
  dialogVisible.value = true
}

async function submitDialog() {
  const instance = formRef.value
  if (instance) {
    const valid = await instance.validate().catch(() => false)
    if (!valid) return
  }
  if (dialogMode.value === 'create') {
    const reason = passwordReason(form.password)
    if (reason) {
      ElMessage.error(reason)
      return
    }
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      const payload = {
        username: form.username.trim(),
        password: form.password,
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        role: form.role,
        // 后端入参字段名为 role_code，同时保留 role 以兼容接口封装。
        role_code: form.role,
        project_ids: form.project_ids,
      }
      await createUser(payload)
      ElMessage.success('用户已创建')
    } else {
      const row = editing.value
      if (!row) return
      const payload = {
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        role: form.role,
        role_code: form.role,
      }
      await updateUser(row.id, payload)
      ElMessage.success('用户已更新')
    }
    dialogVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

/* ---------------- 重置口令 ---------------- */

const resetVisible = ref(false)
const resetTarget = ref<AdminUserItem | null>(null)
const resetPasswordValue = ref('')
const resetSubmitting = ref(false)
const resetResult = ref('')

function openReset(row: AdminUserItem) {
  resetTarget.value = row
  resetPasswordValue.value = generatePassword()
  resetResult.value = ''
  resetVisible.value = true
}

function fillRandomPassword() {
  resetPasswordValue.value = generatePassword()
}

async function submitReset() {
  const row = resetTarget.value
  if (!row) return
  const reason = passwordReason(resetPasswordValue.value)
  if (reason) {
    ElMessage.error(reason)
    return
  }
  resetSubmitting.value = true
  try {
    // 重置口令接口要求带 password 入参，接口封装未暴露该参数，此处直接调用。
    const result = await post<{ password: string }>(
      `/api/admin/v1/users/${row.id}/reset-password`,
      { password: resetPasswordValue.value },
    )
    resetResult.value = result.password
    ElMessage.success('口令已重置')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    resetSubmitting.value = false
  }
}

function closeReset() {
  resetVisible.value = false
  resetPasswordValue.value = ''
  resetResult.value = ''
}

/* ---------------- 项目授权 ---------------- */

const scopeVisible = ref(false)
const scopeTarget = ref<AdminUserItem | null>(null)
const scopeIds = ref<number[]>([])
const scopeLoading = ref(false)
const scopeSubmitting = ref(false)

async function openScope(row: AdminUserItem) {
  scopeTarget.value = row
  scopeIds.value = [...row.projects]
  scopeVisible.value = true
  scopeLoading.value = true
  try {
    const raw: unknown = await getUserProjects(row.id)
    const ids = Array.isArray(raw)
      ? raw.filter((item): item is number => typeof item === 'number')
      : ((raw as { project_ids?: number[] } | null)?.project_ids ?? [])
    scopeIds.value = ids
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    scopeLoading.value = false
  }
}

async function submitScope() {
  const row = scopeTarget.value
  if (!row) return
  scopeSubmitting.value = true
  try {
    await updateUserProjects(row.id, scopeIds.value)
    ElMessage.success('项目授权已保存')
    scopeVisible.value = false
    await table.load(query.requestParams.value)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    scopeSubmitting.value = false
  }
}

/* ---------------- 停用 / 启用 ---------------- */

async function toggleStatus(row: AdminUserItem) {
  const disable = row.status === 'ACTIVE'
  try {
    await ElMessageBox.confirm(
      disable ? `确认停用用户「${row.username}」？` : `确认启用用户「${row.username}」？`,
      disable ? '停用用户' : '启用用户',
      { confirmButtonText: disable ? '停用' : '启用', cancelButtonText: '取消', type: 'warning' },
    )
    const payload = {
      status: (disable ? 'DISABLED' : 'ACTIVE') as 'ACTIVE' | 'LOCKED' | 'DISABLED',
    }
    await updateUser(row.id, payload)
    ElMessage.success(disable ? '用户已停用' : '用户已启用')
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
    <PageHeader title="用户与角色" desc="账号、角色与项目授权">
      <template #actions>
        <el-tooltip :disabled="auth.can('user:write')" content="缺少 user:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!auth.can('user:write')" @click="openCreate">
              新建用户
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </PageHeader>

    <div class="ap-card">
      <div class="ap-filter">
        <el-input
          v-model="keywordInput"
          class="ap-filter__keyword"
          placeholder="用户名 / 显示名"
          clearable
          @keyup.enter="applyKeyword"
          @clear="applyKeyword"
        />
        <el-select
          v-model="roleFilter"
          class="ap-filter__field"
          clearable
          placeholder="角色"
          @change="applyRole"
        >
          <el-option v-for="item in ROLE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
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
            <el-table-column prop="username" label="用户名" min-width="150">
              <template #header>
                <SortableHeader
                  field="username"
                  label="用户名"
                  :sort="sortText"
                  :sortable="isSortable('username')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ row.username }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="display_name" label="显示名" min-width="130">
              <template #default="{ row }">
                <span>{{ row.display_name ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="email" label="邮箱" min-width="180">
              <template #default="{ row }">
                <span>{{ row.email ?? '-' }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="role" label="角色" width="140">
              <template #default="{ row }">
                <span>{{ roleLabel(row.role) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :label="statusMeta(row.status).label" :tone="statusMeta(row.status).tone" />
              </template>
            </el-table-column>

            <el-table-column prop="last_login_at" label="最后登录" width="160">
              <template #header>
                <SortableHeader
                  field="last_login_at"
                  label="最后登录"
                  :sort="sortText"
                  :sortable="isSortable('last_login_at')"
                  reason="该列暂不支持排序"
                  @sort="onSort"
                />
              </template>
              <template #default="{ row }">
                <span class="ap-mono">{{ formatDateTime(row.last_login_at) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="created_at" label="创建时间" width="160">
              <template #header>
                <SortableHeader
                  field="created_at"
                  label="创建时间"
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

            <el-table-column label="操作" width="280" fixed="right">
              <template #default="{ row }">
                <el-tooltip :disabled="auth.can('user:write')" content="缺少 user:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('user:write')"
                      @click="openEdit(row)"
                    >
                      编辑
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('user:write')" content="缺少 user:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('user:write')"
                      @click="openReset(row)"
                    >
                      重置口令
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('user:write')" content="缺少 user:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="primary"
                      :disabled="!auth.can('user:write')"
                      @click="openScope(row)"
                    >
                      调整项目授权
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip :disabled="auth.can('user:write')" content="缺少 user:write 权限" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      :disabled="!auth.can('user:write')"
                      @click="toggleStatus(row)"
                    >
                      {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
                    </el-button>
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>

          <EmptyState v-else title="暂无用户" desc="调整筛选条件或新建用户">
            <el-button type="primary" :disabled="!auth.can('user:write')" @click="openCreate">
              新建用户
            </el-button>
          </EmptyState>
        </div>
      </div>

      <div class="ap-card__body ap-pager">
        <span class="ap-text-secondary">共 {{ formatNumber(table.total.value) }} 个用户</span>
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

    <!-- 新建 / 编辑用户 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建用户' : '编辑用户'"
      width="620px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item v-if="dialogMode === 'create'" label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" maxlength="64" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.display_name" placeholder="请输入显示名" maxlength="64" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="请输入邮箱" maxlength="128" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" class="ap-grow">
            <el-option v-for="item in ROLE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dialogMode === 'create'" label="初始口令" prop="password">
          <el-input v-model="form.password" placeholder="至少 10 位，含 3 类字符" show-password />
          <el-button link type="primary" @click="form.password = generatePassword()">生成随机口令</el-button>
        </el-form-item>
        <el-form-item v-if="dialogMode === 'create'" label="项目授权">
          <el-select v-model="form.project_ids" multiple class="ap-grow" placeholder="请选择项目">
            <el-option
              v-for="item in projectStore.projects"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitDialog">
          {{ dialogMode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 重置口令 -->
    <el-dialog v-model="resetVisible" title="重置口令" width="520px" destroy-on-close>
      <p class="ap-text-secondary">{{ resetTarget?.username ?? '' }}</p>
      <el-input v-model="resetPasswordValue" placeholder="新口令" show-password />
      <div class="ap-flex ap-gap-2 ap-reset__actions">
        <el-button link type="primary" @click="fillRandomPassword">生成随机口令</el-button>
        <span class="ap-text-aux">口令仅展示一次</span>
      </div>
      <el-alert
        v-if="resetResult"
        class="ap-reset__result"
        type="success"
        show-icon
        :closable="false"
        title="新口令"
      >
        <span class="ap-mono ap-reset__value">{{ resetResult }}</span>
      </el-alert>
      <template #footer>
        <el-button v-if="resetResult" type="primary" @click="closeReset">我已保存</el-button>
        <template v-else>
          <el-button @click="closeReset">取消</el-button>
          <el-button type="primary" :loading="resetSubmitting" @click="submitReset">重置</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 项目授权 -->
    <el-dialog v-model="scopeVisible" title="调整项目授权" width="560px" destroy-on-close>
      <p class="ap-text-secondary">{{ scopeTarget?.username ?? '' }}</p>
      <el-select
        v-model="scopeIds"
        multiple
        class="ap-grow"
        placeholder="请选择项目"
        v-loading="scopeLoading"
      >
        <el-option
          v-for="item in projectStore.projects"
          :key="item.id"
          :label="item.name"
          :value="item.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="scopeVisible = false">取消</el-button>
        <el-button type="primary" :loading="scopeSubmitting" @click="submitScope">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
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

.ap-reset__actions {
  margin-top: var(--ap-space-2);
  align-items: center;
}

.ap-reset__result {
  margin-top: var(--ap-space-3);
}

.ap-reset__value {
  font-size: 13px;
  word-break: break-all;
}
</style>
