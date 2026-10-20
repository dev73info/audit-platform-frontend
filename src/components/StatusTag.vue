<script setup lang="ts">
import type { SemanticTone } from '@/utils/labels'

/** 状态标签：底色为语义色 10% 透明度 + 同色文字，左侧 4px 圆点。 */
withDefaults(
  defineProps<{
    label: string
    tone?: SemanticTone
  }>(),
  { tone: 'neutral' },
)
</script>

<template>
  <span class="ap-status" :class="`ap-status--${tone}`">{{ label }}</span>
</template>
