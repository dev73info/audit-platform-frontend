import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { get } from '@/api/http'
import type { NotificationItem } from '@/api/types'

/** 站内通知中心：告警、导出完成、清理任务结果。 */
export const useNotificationStore = defineStore('audit-notification', () => {
  const items = ref<NotificationItem[]>([])
  const unread = ref(0)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const payload = await get<{ items: NotificationItem[] }>('/api/admin/v1/notifications', {
        page: 1,
        page_size: 20,
      })
      items.value = payload.items ?? []
      unread.value = items.value.filter((item) => !item.read_at).length
    } finally {
      loading.value = false
    }
  }

  function reset() {
    items.value = []
    unread.value = 0
  }

  return { items, unread, loading, load, reset, count: computed(() => items.value.length) }
})
