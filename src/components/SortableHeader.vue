<script setup lang="ts">
import { Bottom, InfoFilled, Sort, Top } from '@element-plus/icons-vue'

/**
 * 可排序表头。
 *
 * 非白名单字段置灰并给出 tooltip（设计文档 4.12.1「排序白名单」）。
 */
const props = withDefaults(
  defineProps<{
    field: string
    label: string
    sort?: string
    sortable?: boolean
    reason?: string
  }>(),
  { sort: '', sortable: true, reason: '' },
)

const emit = defineEmits<{
  (event: 'sort', field: string): void
}>()

function currentDirection(): 'asc' | 'desc' | '' {
  if (!props.sort) return ''
  const [field, direction] = props.sort.split(':')
  if (field !== props.field) return ''
  return direction === 'desc' ? 'desc' : 'asc'
}

function handleClick() {
  if (!props.sortable) return
  emit('sort', props.field)
}
</script>

<template>
  <span
    class="sortable-header"
    :class="{
      'is-asc': currentDirection() === 'asc',
      'is-desc': currentDirection() === 'desc',
      'is-disabled': !sortable,
    }"
    @click="handleClick"
  >
    <span>{{ label }}</span>
    <el-tooltip v-if="!sortable && reason" :content="reason" placement="top">
      <el-icon class="ap-text-aux"><InfoFilled /></el-icon>
    </el-tooltip>
    <template v-else-if="sortable">
      <el-icon v-if="currentDirection() === 'asc'"><Top /></el-icon>
      <el-icon v-else-if="currentDirection() === 'desc'"><Bottom /></el-icon>
      <el-icon v-else class="ap-text-placeholder"><Sort /></el-icon>
    </template>
  </span>
</template>
