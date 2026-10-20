<script setup lang="ts">
/** 页面标题区：标题 + 一句话说明 + 右侧操作。 */
withDefaults(
  defineProps<{
    title: string
    desc?: string
  }>(),
  { desc: '' },
)
</script>

<template>
  <div class="ap-page__head">
    <div class="ap-grow">
      <h1 class="ap-page__title">{{ title }}</h1>
      <p v-if="desc" class="ap-page__desc">{{ desc }}</p>
      <slot name="extra" />
    </div>
    <div class="ap-page__actions">
      <slot name="actions" />
    </div>
  </div>
</template>
