<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from '@/api/http'
import { createRule, deleteRule, dryRunRules, listRules, updateRule } from '@/api/audits'
import type { DryRunResult, RuleGroup, RuleItem, TaskResult } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { resultMeta } from '@/utils/labels'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps<{ id: string }>()

/** 内置字段。`ext.*` 由字段下拉直接输入 `ext.xxx`。 */
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

const RESULT_OPTIONS: Array<{ value: TaskResult; label: string }> = [
  { value: 'PASS', label: resultMeta('PASS').label },
  { value: 'REJECT', label: resultMeta('REJECT').label },
  { value: 'REVIEW', label: resultMeta('REVIEW').label },
]

const GROUP_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'PAUSED', label: '暂停' },
  { value: 'DISABLED', label: '停用' },
]

const DEFAULT_SAMPLE = `{
  "media": [
    { "type": "text", "content": "这是一段待审核文本" }
  ],
  "ext": {
    "user_id": "u123",
    "scene": "ugc_post"
  },
  "model": {
    "label": "porn",
    "score": 0.93,
    "risk_level": "high"
  }
}`

/** 编辑中的条件项。 */
type EditingItem = {
  field: string
  operator: string
  value: unknown
  case_sensitive: boolean
  negate: boolean
  sort_order: number
}

/** 编辑中的规则组。 */
type EditingGroup = {
  id: number | null
  name: string
  priority: number
  logic: 'AND' | 'OR'
  stop_on_hit: boolean
  on_hit_result: TaskResult
  status: string
  items: EditingItem[]
}

const auth = useAuthStore()

const auditId = computed(() => {
  const raw = Number(props.id)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})

const groups = ref<RuleGroup[]>([])
const selectedId = ref<number | null>(null)
const draft = ref<EditingGroup | null>(null)
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const canRead = computed(() => auth.can('rule:read'))
const canWrite = computed(() => auth.can('rule:write'))

/* ---------------- 数据加载 ---------------- */

async function loadGroups() {
  if (!auditId.value) return
  loading.value = true
  error.value = ''
  try {
    const raw = (await listRules(auditId.value)) as unknown
    const items = Array.isArray(raw)
      ? (raw as RuleGroup[])
      : ((raw as { items?: RuleGroup[] })?.items ?? [])
    groups.value = [...items].sort((a, b) => a.priority - b.priority)
    if (groups.value.length === 0) {
      selectedId.value = null
      draft.value = null
      return
    }
    const current = groups.value.find((item) => item.id === selectedId.value)
    const target = current ?? groups.value[0]
    selectGroup(target)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
    groups.value = []
    selectedId.value = null
    draft.value = null
  } finally {
    loading.value = false
  }
}

function toEditing(group: RuleGroup): EditingGroup {
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

function selectGroup(group: RuleGroup | undefined) {
  if (!group) return
  selectedId.value = group.id ?? null
  draft.value = toEditing(group)
}

/* ---------------- 条件项值控件 ---------------- */

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

function textValue(item: EditingItem): string {
  if (item.value === null || item.value === undefined) return ''
  if (typeof item.value === 'string') return item.value
  if (typeof item.value === 'number' || typeof item.value === 'boolean') return String(item.value)
  return ''
}

function setText(item: EditingItem, value: string) {
  item.value = value
}

function numberValue(item: EditingItem): number | undefined {
  const raw = Number(item.value)
  return Number.isFinite(raw) ? raw : undefined
}

function setNumber(item: EditingItem, value: number | undefined) {
  item.value = value ?? null
}

function multiValue(item: EditingItem): string[] {
  if (Array.isArray(item.value)) {
    return item.value.map((entry) => String(entry))
  }
  if (item.value === null || item.value === undefined || item.value === '') return []
  return [String(item.value)]
}

function setMulti(item: EditingItem, value: unknown[]) {
  item.value = value.map((entry) => String(entry))
}

function betweenValue(item: EditingItem): [number | undefined, number | undefined] {
  if (!Array.isArray(item.value)) return [undefined, undefined]
  const lower = item.value[0]
  const upper = item.value[1]
  return [
    typeof lower === 'number' ? lower : undefined,
    typeof upper === 'number' ? upper : undefined,
  ]
}

function setBetween(item: EditingItem, index: 0 | 1, value: number | undefined) {
  const [lower, upper] = betweenValue(item)
  const next: [number, number] = index === 0 ? [value ?? 0, upper ?? 0] : [lower ?? 0, value ?? 0]
  item.value = next
}

function multiOptions(operator: string): string[] {
  if (operator === 'label_in') return LABEL_OPTIONS
  if (operator === 'risk_in') return RISK_OPTIONS
  return []
}

function onOperatorChange(item: EditingItem) {
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

function addItem() {
  const target = draft.value
  if (!target) return
  target.items.push({
    field: 'media.text',
    operator: 'contains_any',
    value: [],
    case_sensitive: false,
    negate: false,
    sort_order: target.items.length,
  })
}

function removeItem(index: number) {
  const target = draft.value
  if (!target) return
  target.items.splice(index, 1)
  target.items.forEach((item, order) => {
    item.sort_order = order
  })
}

/* ---------------- 保存 ---------------- */

function toPayload(group: EditingGroup): Partial<RuleGroup> {
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

async function saveGroup() {
  const target = draft.value
  if (!target) return
  if (!target.name.trim()) {
    ElMessage.error('规则组名称不能为空')
    return
  }
  saving.value = true
  try {
    if (target.id === null) {
      const created = await createRule(auditId.value, toPayload(target))
      selectedId.value = created.id ?? null
    } else {
      await updateRule(target.id, toPayload(target))
    }
    ElMessage.success('规则组已保存')
    await loadGroups()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

/* ---------------- 规则组操作 ---------------- */

async function createGroup() {
  try {
    const maxPriority = groups.value.reduce((max, item) => Math.max(max, item.priority), 0)
    const created = await createRule(auditId.value, {
      name: `规则组 ${groups.value.length + 1}`,
      priority: maxPriority + 10,
      logic: 'AND',
      stop_on_hit: true,
      on_hit_result: 'REVIEW',
      status: 'ACTIVE',
      items: [],
    })
    ElMessage.success('规则组已新增')
    selectedId.value = created.id ?? null
    await loadGroups()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function copyGroup(group: RuleGroup) {
  try {
    const maxPriority = groups.value.reduce((max, item) => Math.max(max, item.priority), 0)
    const created = await createRule(auditId.value, {
      name: `${group.name} 副本`,
      priority: maxPriority + 10,
      logic: group.logic,
      stop_on_hit: group.stop_on_hit,
      on_hit_result: group.on_hit_result,
      status: 'ACTIVE',
      items: (group.items ?? []).map((item, index) => ({
        field: item.field,
        operator: item.operator,
        value: item.value,
        case_sensitive: item.case_sensitive,
        negate: item.negate,
        sort_order: index,
      })),
    })
    ElMessage.success('规则组已复制')
    selectedId.value = created.id ?? null
    await loadGroups()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function removeGroup(group: RuleGroup) {
  const groupId = group.id
  if (groupId === null || groupId === undefined) return
  try {
    await ElMessageBox.confirm(`确认删除规则组「${group.name}」？`, '删除规则组', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deleteRule(groupId)
    ElMessage.success('规则组已删除')
    if (selectedId.value === groupId) selectedId.value = null
    await loadGroups()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function toggleGroupStatus(group: RuleGroup, value: boolean | string | number) {
  const groupId = group.id
  if (groupId === null || groupId === undefined) return
  const status = typeof value === 'string' ? value : value ? 'ACTIVE' : 'PAUSED'
  try {
    await updateRule(groupId, {
      name: group.name,
      priority: group.priority,
      logic: group.logic,
      stop_on_hit: group.stop_on_hit,
      on_hit_result: group.on_hit_result,
      status,
      items: group.items ?? [],
    })
    ElMessage.success(status === 'ACTIVE' ? '规则组已启用' : '规则组已暂停')
    await loadGroups()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

async function moveGroup(index: number, offset: number) {
  const current = groups.value[index]
  const target = groups.value[index + offset]
  if (!current || !target) return
  const currentId = current.id
  const targetId = target.id
  if (currentId === null || currentId === undefined) return
  if (targetId === null || targetId === undefined) return
  try {
    await updateRule(currentId, {
      name: current.name,
      priority: target.priority,
      logic: current.logic,
      stop_on_hit: current.stop_on_hit,
      on_hit_result: current.on_hit_result,
      status: current.status,
      items: current.items ?? [],
    })
    await updateRule(targetId, {
      name: target.name,
      priority: current.priority,
      logic: target.logic,
      stop_on_hit: target.stop_on_hit,
      on_hit_result: target.on_hit_result,
      status: target.status,
      items: target.items ?? [],
    })
    ElMessage.success('优先级已调整')
    await loadGroups()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  }
}

/* ---------------- 试跑 ---------------- */

const sampleText = ref(DEFAULT_SAMPLE)
const dryRunning = ref(false)
const dryRunResult = ref<DryRunResult | null>(null)

async function runDryRun() {
  let sample: unknown
  try {
    sample = JSON.parse(sampleText.value)
  } catch {
    ElMessage.error('样例 JSON 格式错误')
    return
  }
  dryRunning.value = true
  try {
    dryRunResult.value = await dryRunRules(auditId.value, sample)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    dryRunning.value = false
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '-'
  }
}

function groupTone(status: string): 'pass' | 'review' | 'neutral' {
  if (status === 'ACTIVE') return 'pass'
  if (status === 'PAUSED') return 'review'
  return 'neutral'
}

/* ---------------- 初始化 ---------------- */

onMounted(() => {
  void loadGroups()
})

watch(auditId, () => {
  void loadGroups()
})
</script>

<template>
  <div class="ap-page">
    <PageHeader title="规则配置" desc="规则组优先级、条件表达式与试跑验证">
      <template #actions>
        <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
          <span>
            <el-button type="primary" :disabled="!canWrite" @click="createGroup">新增规则组</el-button>
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
      <div class="rule-layout">
        <!-- 左侧：规则组列表 -->
        <div class="rule-side" v-loading="loading">
          <div class="ap-card__title">规则组</div>
          <div v-if="groups.length === 0" class="ap-text-aux ap-rule-empty">暂无规则组</div>
          <div
            v-for="(group, index) in groups"
            :key="group.id ?? index"
            class="rule-item"
            :class="{ 'is-active': group.id === selectedId }"
            @click="selectGroup(group)"
          >
            <div class="rule-item__head">
              <span class="rule-item__name">{{ group.name }}</span>
              <StatusTag :label="group.status" :tone="groupTone(group.status)" />
            </div>
            <div class="rule-item__meta ap-text-aux">
              <span class="ap-mono">P{{ group.priority }}</span>
              <span>{{ group.logic }}</span>
              <span>{{ resultMeta(group.on_hit_result).label }}</span>
              <span>{{ (group.items ?? []).length }} 项</span>
            </div>
            <div class="rule-item__ops" @click.stop>
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button link size="small" :disabled="!canWrite || index === 0" @click="moveGroup(index, -1)">
                    上移
                  </el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button
                    link
                    size="small"
                    :disabled="!canWrite || index === groups.length - 1"
                    @click="moveGroup(index, 1)"
                  >
                    下移
                  </el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button link size="small" :disabled="!canWrite" @click="copyGroup(group)">复制</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button link type="danger" size="small" :disabled="!canWrite" @click="removeGroup(group)">
                    删除
                  </el-button>
                </span>
              </el-tooltip>
              <el-switch
                :model-value="group.status"
                active-value="ACTIVE"
                inactive-value="PAUSED"
                size="small"
                :disabled="!canWrite"
                @update:model-value="(v: boolean | string | number) => toggleGroupStatus(group, v)"
              />
            </div>
          </div>
        </div>

        <!-- 右侧：条件编辑器 -->
        <div class="rule-main">
          <template v-if="draft">
            <div class="ap-card__title">规则组属性</div>
            <el-form :model="draft" label-width="120px" class="rule-form">
              <div class="rule-form__grid">
                <el-form-item label="名称">
                  <el-input v-model="draft.name" maxlength="64" />
                </el-form-item>
                <el-form-item label="优先级">
                  <el-input-number v-model="draft.priority" :min="1" :max="9999" controls-position="right" />
                </el-form-item>
                <el-form-item label="逻辑">
                  <el-radio-group v-model="draft.logic">
                    <el-radio-button value="AND">AND</el-radio-button>
                    <el-radio-button value="OR">OR</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <el-form-item label="命中后终止">
                  <el-switch v-model="draft.stop_on_hit" />
                </el-form-item>
                <el-form-item label="命中结果">
                  <el-select v-model="draft.on_hit_result" class="ap-grow">
                    <el-option
                      v-for="item in RESULT_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="状态">
                  <el-select v-model="draft.status" class="ap-grow">
                    <el-option
                      v-for="item in GROUP_STATUS_OPTIONS"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-form-item>
              </div>
            </el-form>

            <div class="ap-flex ap-flex-center ap-gap-2 ap-rule-section">
              <span class="ap-card__title">条件项</span>
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button size="small" :disabled="!canWrite" @click="addItem">添加条件</el-button>
                </span>
              </el-tooltip>
            </div>

            <div v-if="draft.items.length === 0" class="ap-text-aux ap-rule-empty">暂无条件项</div>
            <div v-for="(item, index) in draft.items" :key="index" class="rule-item-row">
              <div class="rule-item-row__grid">
                <el-select
                  v-model="item.field"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="内置字段或 ext.xxx"
                >
                  <el-option
                    v-for="option in FIELD_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>

                <el-select v-model="item.operator" @change="onOperatorChange(item)">
                  <el-option
                    v-for="option in OPERATOR_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>

                <div class="rule-item-row__value">
                  <template v-if="valueMode(item.operator) === 'between'">
                    <el-input-number
                      :model-value="betweenValue(item)[0]"
                      placeholder="下限"
                      controls-position="right"
                      @update:model-value="(v: number | undefined) => setBetween(item, 0, v)"
                    />
                    <el-input-number
                      :model-value="betweenValue(item)[1]"
                      placeholder="上限"
                      controls-position="right"
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
                      @update:model-value="(v: number | undefined) => setNumber(item, v)"
                    />
                  </template>
                  <template v-else-if="valueMode(item.operator) === 'text'">
                    <el-input
                      :model-value="textValue(item)"
                      placeholder="请输入期望值"
                      @update:model-value="(v: string) => setText(item, v)"
                    />
                  </template>
                  <span v-else class="ap-text-aux">无需取值</span>
                </div>

                <div class="rule-item-row__flags">
                  <el-tooltip content="区分大小写" placement="top">
                    <el-switch v-model="item.case_sensitive" size="small" />
                  </el-tooltip>
                  <el-tooltip content="取反" placement="top">
                    <el-switch v-model="item.negate" size="small" />
                  </el-tooltip>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="!canWrite"
                    @click="removeItem(index)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
              <div class="rule-item-row__hint ap-text-aux">
                区分大小写 · 取反
              </div>
            </div>

            <div class="ap-rule-actions">
              <el-tooltip :disabled="canWrite" content="缺少 rule:write 权限" placement="top">
                <span>
                  <el-button type="primary" :loading="saving" :disabled="!canWrite" @click="saveGroup">
                    保存规则组
                  </el-button>
                </span>
              </el-tooltip>
            </div>
          </template>
          <div v-else class="ap-empty">
            <p class="ap-empty__title">未选择规则组</p>
            <p class="ap-empty__desc">从左侧选择或新增规则组</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 试跑 -->
    <div class="ap-card">
      <div class="ap-card__header">
        <span class="ap-card__title">试跑</span>
        <el-tooltip :disabled="canRead" content="缺少 rule:read 权限" placement="top">
          <span>
            <el-button type="primary" :loading="dryRunning" :disabled="!canRead" @click="runDryRun">
              试跑
            </el-button>
          </span>
        </el-tooltip>
      </div>
      <div class="ap-card__body">
        <el-input
          v-model="sampleText"
          type="textarea"
          :rows="10"
          class="ap-mono"
          placeholder="样例 JSON"
        />

        <div v-if="dryRunResult" class="ap-dryrun">
          <div class="ap-flex ap-gap-3 ap-dryrun__result">
            <span class="ap-text-secondary">最终结论</span>
            <StatusTag
              :label="resultMeta(dryRunResult.final_result).label"
              :tone="resultMeta(dryRunResult.final_result).tone"
            />
            <span class="ap-text-secondary">命中规则组</span>
            <span class="ap-mono">{{ dryRunResult.matched_rule ?? '-' }}</span>
          </div>

          <el-timeline>
            <el-timeline-item
              v-for="(group, index) in dryRunResult.trace"
              :key="index"
              :type="group.hit ? 'danger' : 'info'"
            >
              <div class="ap-flex ap-gap-2 ap-flex-center">
                <span class="ap-mono">{{ group.rule }}</span>
                <el-tag size="small" type="info" effect="plain">{{ group.logic }}</el-tag>
                <StatusTag
                  :label="group.skipped ? '已跳过' : group.hit ? '命中' : '未命中'"
                  :tone="group.skipped ? 'neutral' : group.hit ? 'reject' : 'neutral'"
                />
              </div>
              <el-table
                v-if="group.items.length > 0"
                :data="group.items"
                class="ap-table ap-table--compact ap-dryrun__table"
              >
                <el-table-column prop="field" label="字段" min-width="140" />
                <el-table-column prop="operator" label="操作符" width="120" />
                <el-table-column label="实际值" min-width="180">
                  <template #default="{ row }">
                    <span class="ap-mono ap-truncate">{{ displayValue(row.actual) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="期望值" min-width="180">
                  <template #default="{ row }">
                    <span class="ap-mono ap-truncate">{{ displayValue(row.expected) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="命中" width="90">
                  <template #default="{ row }">
                    <StatusTag :label="row.hit ? '命中' : '未命中'" :tone="row.hit ? 'pass' : 'neutral'" />
                  </template>
                </el-table-column>
              </el-table>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rule-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: 320px;
}

.rule-side {
  border-right: 1px solid var(--ap-border);
  padding: var(--ap-space-4);
}

.rule-main {
  padding: var(--ap-space-4);
}

.rule-item {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
  margin-bottom: var(--ap-space-2);
  cursor: pointer;
}

.rule-item.is-active {
  border-color: var(--ap-color-primary);
}

.rule-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-2);
}

.rule-item__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-item__meta {
  display: flex;
  gap: var(--ap-space-3);
  margin-top: var(--ap-space-1);
  font-size: 12px;
}

.rule-item__ops {
  display: flex;
  align-items: center;
  gap: var(--ap-space-1);
  margin-top: var(--ap-space-2);
}

.rule-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--ap-space-5);
}

.rule-form__grid :deep(.el-form-item) {
  margin-bottom: var(--ap-space-3);
}

.rule-section {
  margin-top: var(--ap-space-3);
  margin-bottom: var(--ap-space-2);
}

.rule-item-row {
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  padding: var(--ap-space-3);
  margin-bottom: var(--ap-space-2);
}

.rule-item-row__grid {
  display: grid;
  grid-template-columns: 220px 200px minmax(0, 1fr) 180px;
  gap: var(--ap-space-2);
  align-items: center;
}

.rule-item-row__value {
  display: flex;
  gap: var(--ap-space-2);
  align-items: center;
}

.rule-item-row__value :deep(.el-select),
.rule-item-row__value :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
}

.rule-item-row__flags {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
}

.rule-item-row__hint {
  margin-top: var(--ap-space-1);
  font-size: 12px;
}

.rule-actions {
  margin-top: var(--ap-space-4);
}

.rule-empty {
  padding: var(--ap-space-4) 0;
  text-align: center;
}

.ap-dryrun {
  margin-top: var(--ap-space-4);
}

.ap-dryrun__result {
  margin-bottom: var(--ap-space-3);
}

.ap-dryrun__table {
  margin-top: var(--ap-space-2);
}
</style>
