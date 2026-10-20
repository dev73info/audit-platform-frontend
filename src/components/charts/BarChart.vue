<script setup lang="ts">
import { computed } from 'vue'

/** 竖向柱状图：纯 SVG 手绘，带坐标刻度。 */

type BarItem = {
  label: string
  value: number
}

const props = defineProps<{
  items: BarItem[]
}>()

const W = 640
const H = 240
const PAD = { top: 16, right: 12, bottom: 36, left: 46 }

const plotWidth = W - PAD.left - PAD.right
const plotHeight = H - PAD.top - PAD.bottom

const rows = computed(() => props.items ?? [])

const maxValue = computed(() => {
  let max = 0
  for (const item of rows.value) {
    const value = typeof item.value === 'number' ? item.value : 0
    if (value > max) max = value
  }
  return max > 0 ? max : 1
})

const bars = computed(() => {
  const count = rows.value.length
  if (count === 0) return []
  const slot = plotWidth / count
  const width = Math.min(48, slot * 0.6)
  return rows.value.map((item, index) => {
    const value = typeof item.value === 'number' ? item.value : 0
    const height = (value / maxValue.value) * plotHeight
    return {
      label: item.label,
      value,
      x: PAD.left + slot * index + (slot - width) / 2,
      y: PAD.top + plotHeight - height,
      width,
      height,
    }
  })
})

const yTicks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: PAD.top + plotHeight - ratio * plotHeight,
    label: String(Math.round(maxValue.value * ratio)),
  })),
)

function shortLabel(label: string): string {
  if (!label) return ''
  return label.length > 8 ? `${label.slice(0, 8)}…` : label
}
</script>

<template>
  <div class="bar">
    <svg class="bar__svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
      <line
        v-for="tick in yTicks"
        :key="`grid-${tick.y}`"
        class="bar__grid"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="tick.y"
        :y2="tick.y"
      />

      <g class="bar__axis">
        <text
          v-for="tick in yTicks"
          :key="`yl-${tick.y}`"
          :x="PAD.left - 8"
          :y="tick.y + 4"
          text-anchor="end"
        >
          {{ tick.label }}
        </text>
      </g>

      <g v-for="bar in bars" :key="bar.label">
        <rect
          class="bar__column"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="3"
        />
        <text class="bar__value" :x="bar.x + bar.width / 2" :y="bar.y - 4" text-anchor="middle">
          {{ bar.value }}
        </text>
        <text
          class="bar__label"
          :x="bar.x + bar.width / 2"
          :y="H - 10"
          text-anchor="middle"
        >
          {{ shortLabel(bar.label) }}
        </text>
      </g>

      <text v-if="rows.length === 0" class="bar__empty" :x="W / 2" :y="H / 2" text-anchor="middle">
        暂无数据
      </text>
    </svg>
  </div>
</template>

<style scoped>
.bar {
  width: 100%;
}

.bar__svg {
  width: 100%;
  height: auto;
}

.bar__grid {
  stroke: var(--ap-border);
  stroke-width: 1;
}

.bar__column {
  fill: var(--ap-color-primary);
}

.bar__axis text {
  fill: var(--ap-text-secondary);
  font-size: 11px;
}

.bar__value {
  fill: var(--ap-text-regular);
  font-size: 11px;
}

.bar__label {
  fill: var(--ap-text-secondary);
  font-size: 11px;
}

.bar__empty {
  fill: var(--ap-text-placeholder);
  font-size: 12px;
}
</style>
