<script setup lang="ts">
import { computed } from 'vue'

/** 环形图：用 stroke-dasharray 绘制分段，中间显示总量，右侧图例。 */

type DonutItem = {
  label: string
  value: number
  color: string
}

const props = defineProps<{
  items: DonutItem[]
}>()

const SIZE = 180
const R = 66
const STROKE = 26
const CIRCUMFERENCE = 2 * Math.PI * R

const rows = computed(() => props.items ?? [])

const total = computed(() =>
  rows.value.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0),
)

const segments = computed(() => {
  let offset = 0
  return rows.value.map((item) => {
    const value = typeof item.value === 'number' ? item.value : 0
    const ratio = total.value > 0 ? value / total.value : 0
    const length = ratio * CIRCUMFERENCE
    const segment = {
      label: item.label,
      value,
      color: item.color,
      ratio,
      dasharray: `${length.toFixed(2)} ${(CIRCUMFERENCE - length).toFixed(2)}`,
      dashoffset: (-offset).toFixed(2),
    }
    offset += length
    return segment
  })
})

function formatPercentText(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="donut">
    <svg class="donut__svg" :viewBox="`0 0 ${SIZE} ${SIZE}`" preserveAspectRatio="xMidYMid meet">
      <circle
        class="donut__track"
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="R"
        :stroke-width="STROKE"
        fill="none"
      />
      <circle
        v-for="segment in segments"
        :key="segment.label"
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="R"
        :stroke-width="STROKE"
        fill="none"
        stroke-linecap="butt"
        :stroke-dasharray="segment.dasharray"
        :stroke-dashoffset="segment.dashoffset"
        :style="{ stroke: segment.color }"
        :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`"
      />
      <text class="donut__total" :x="SIZE / 2" :y="SIZE / 2 - 2" text-anchor="middle">
        {{ total }}
      </text>
      <text class="donut__caption" :x="SIZE / 2" :y="SIZE / 2 + 16" text-anchor="middle">
        合计
      </text>
    </svg>

    <ul class="donut__legend">
      <li v-for="segment in segments" :key="segment.label" class="donut__legend-item">
        <i class="donut__dot" :style="{ background: segment.color }" />
        <span class="donut__label ap-truncate">{{ segment.label }}</span>
        <span class="donut__value ap-mono">{{ segment.value }}</span>
        <span class="donut__ratio ap-mono ap-text-secondary">
          {{ formatPercentText(segment.ratio) }}
        </span>
      </li>
      <li v-if="segments.length === 0" class="donut__legend-item ap-text-secondary">暂无数据</li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: var(--ap-space-5);
}

.donut__svg {
  width: 160px;
  height: 160px;
  flex: none;
}

.donut__track {
  stroke: var(--ap-bg-hover);
}

.donut__total {
  fill: var(--ap-text-primary);
  font-size: 24px;
  font-weight: 600;
}

.donut__caption {
  fill: var(--ap-text-secondary);
  font-size: 11px;
}

.donut__legend {
  flex: 1;
  min-width: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-2);
}

.donut__legend-item {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
  font-size: var(--ap-font-size-aux);
}

.donut__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.donut__label {
  flex: 1;
  min-width: 0;
}

.donut__value {
  font-weight: 600;
}
</style>
