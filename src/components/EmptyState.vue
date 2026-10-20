<script setup lang="ts">
/** 空状态：说明 + 主操作。 */
withDefaults(
  defineProps<{
    title: string
    desc?: string
  }>(),
  { desc: '' },
)
</script>

<template>
  <div class="ap-empty">
    <p class="ap-empty__title">{{ title }}</p>
    <p v-if="desc" class="ap-empty__desc">{{ desc }}</p>
    <slot />
  </div>
</template>
