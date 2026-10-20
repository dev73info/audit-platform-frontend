<script setup lang="ts">
/** 筛选条件 chips：展示已生效的筛选条件，可单个移除。 */
export interface FilterChip {
  key: string
  label: string
}

defineProps<{
  chips: FilterChip[]
}>()

const emit = defineEmits<{
  (event: 'remove', key: string): void
  (event: 'clear'): void
}>()
</script>

<template>
  <div v-if="chips.length > 0" class="ap-filter__chips">
    <el-tag
      v-for="chip in chips"
      :key="chip.key"
      closable
      size="small"
      type="info"
      effect="plain"
      @close="emit('remove', chip.key)"
    >
      {{ chip.label }}
    </el-tag>
    <el-button link type="primary" size="small" @click="emit('clear')">清空筛选</el-button>
  </div>
</template>
