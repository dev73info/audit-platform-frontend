import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { get } from '@/api/http'
import type { ProjectItem } from '@/api/types'

/**
 * 当前选中的项目。切换后所有页面带上 `project_id` 上下文。
 * 项目存在 localStorage，刷新后保持。
 */
export const useProjectStore = defineStore('audit-project', () => {
  const STORAGE_KEY = 'audit_platform_project_id'

  const projects = ref<ProjectItem[]>([])
  const currentId = ref<number>(0)
  const loaded = ref(false)
  const loading = ref(false)

  const current = computed<ProjectItem | null>(
    () => projects.value.find((item) => item.id === currentId.value) ?? null,
  )

  function persist() {
    if (currentId.value) {
      localStorage.setItem(STORAGE_KEY, String(currentId.value))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function select(id: number) {
    currentId.value = id
    persist()
  }

  async function loadProjects(force = false) {
    if (loaded.value && !force) return
    loading.value = true
    try {
      const payload = await get<{ items: ProjectItem[] }>('/api/admin/v1/projects', {
        page: 1,
        page_size: 100,
        'filter[status]': 'ACTIVE,PAUSED',
      })
      projects.value = payload.items ?? []

      const saved = Number(localStorage.getItem(STORAGE_KEY) ?? 0)
      const stillExists = projects.value.some((item) => item.id === saved)
      if (stillExists) {
        currentId.value = saved
      } else if (projects.value.length > 0) {
        currentId.value = projects.value[0]!.id
        persist()
      } else {
        currentId.value = 0
      }
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function reset() {
    projects.value = []
    currentId.value = 0
    loaded.value = false
  }

  return {
    projects,
    currentId,
    current,
    loaded,
    loading,
    select,
    loadProjects,
    reset,
  }
})
