<script setup lang="ts">
import { computed } from 'vue'

/** 趋势图：四条折线（通过 / 不通过 / 待议 / 失败），纯 SVG 手绘。 */

type TrendPoint = {
  ts: string
  pass: number
  reject: number
  review: number
  failed: number
}

type LineKey = 'pass' | 'reject' | 'review' | 'failed'

const props = defineProps<{
  series: TrendPoint[]
}>()

const W = 680
const H = 260
const PAD = { top: 16, right: 16, bottom: 30, left: 46 }

const lines: Array<{ key: LineKey; label: string; color: string }> = [
  { key: 'pass', label: '通过', color: 'var(--ap-color-pass)' },
  { key: 'reject', label: '不通过', color: 'var(--ap-color-reject)' },
  { key: 'review', label: '待议', color: 'var(--ap-color-review)' },
  { key: 'failed', label: '失败', color: 'var(--ap-color-neutral)' },
]

const plotWidth = W - PAD.left - PAD.right
const plotHeight = H - PAD.top - PAD.bottom

const points = computed<TrendPoint[]>(() => props.series ?? [])

const maxValue = computed(() => {
  let max = 0
  for (const point of points.value) {
    for (const line of lines) {
      const value = point[line.key]
      if (typeof value === 'number' && value > max) max = value
    }
  }
  return max > 0 ? max : 1
})

function xAt(index: number): number {
  const count = points.value.length
  if (count <= 1) return PAD.left + plotWidth / 2
  return PAD.left + (index / (count - 1)) * plotWidth
}

function yAt(value: number): number {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return PAD.top + plotHeight - (safe / maxValue.value) * plotHeight
}

const paths = computed(() =>
  lines.map((line) => {
    const d = points.value
      .map((point, index) => {
        const x = xAt(index).toFixed(2)
        const y = yAt(point[line.key]).toFixed(2)
        return `${index === 0 ? 'M' : 'L'}${x},${y}`
      })
      .join(' ')
    return { key: line.key, label: line.label, color: line.color, d }
  }),
)

const yTicks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: PAD.top + plotHeight - ratio * plotHeight,
    label: String(Math.round(maxValue.value * ratio)),
  })),
)

const xTicks = computed(() => {
  const count = points.value.length
  if (count === 0) return []
  const indexes = count === 1 ? [0] : [0, Math.floor((count - 1) / 2), count - 1]
  return indexes.map((index) => ({
    x: xAt(index),
    label: formatTime(points.value[index]?.ts ?? ''),
  }))
})

function formatTime(ts: string): string {
  if (!ts) return ''
  // 后端的时间桶形如 2026-10-21T10:00:00Z，按本地时间展示，不做时区换算
  const matched = /T(\d{2}):(\d{2})/.exec(ts)
  if (matched) return `${matched[1]}:${matched[2]}`
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <div class="trend">
    <div class="trend__legend">
      <span v-for="line in lines" :key="line.key" class="trend__legend-item">
        <i class="trend__dot" :style="{ background: line.color }" />
        {{ line.label }}
      </span>
    </div>

    <svg class="trend__svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
      <line
        v-for="tick in yTicks"
        :key="`grid-${tick.y}`"
        class="trend__grid"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="tick.y"
        :y2="tick.y"
      />

      <g class="trend__axis">
        <text
          v-for="tick in yTicks"
          :key="`yl-${tick.y}`"
          :x="PAD.left - 8"
          :y="tick.y + 4"
          text-anchor="end"
        >
          {{ tick.label }}
        </text>
        <text
          v-for="tick in xTicks"
          :key="`xl-${tick.x}`"
          :x="tick.x"
          :y="H - 8"
          text-anchor="middle"
        >
          {{ tick.label }}
        </text>
      </g>

      <path
        v-for="line in paths"
        :key="line.key"
        :d="line.d"
        fill="none"
        :style="{ stroke: line.color }"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <text
        v-if="points.length === 0"
        class="trend__empty"
        :x="W / 2"
        :y="H / 2"
        text-anchor="middle"
      >
        暂无数据
      </text>
    </svg>
  </div>
</template>

<style scoped>
.trend {
  display: flex;
  flex-direction: column;
  gap: var(--ap-space-2);
}

.trend__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ap-space-4);
}

.trend__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ap-font-size-aux);
  color: var(--ap-text-secondary);
}

.trend__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.trend__svg {
  width: 100%;
  height: auto;
}

.trend__grid {
  stroke: var(--ap-border);
  stroke-width: 1;
}

.trend__axis text {
  fill: var(--ap-text-secondary);
  font-size: 11px;
}

.trend__empty {
  fill: var(--ap-text-placeholder);
  font-size: 12px;
}
</style>
