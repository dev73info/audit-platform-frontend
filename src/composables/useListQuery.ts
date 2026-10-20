import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export type SortState = {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * 列表查询状态：筛选、排序、分页与 URL 同步。
 *
 * 筛选值以 `filter[字段]` 形式放进 URL，排序以 `sort=字段:方向` 形式放进 URL。
 */
export function useListQuery<T>(options: {
  /** 默认排序字段与方向。 */
  defaultSort: SortState
  /** 可排序字段白名单；不在白名单内的列头不显示排序。 */
  sortableFields: string[]
  /** 参与 URL 同步的筛选字段。 */
  filterKeys: string[]
  /** 每页条数默认值。 */
  defaultPageSize?: number
}) {
  const route = useRoute()
  const router = useRouter()

  const filters = reactive<Record<string, string>>({})
  const page = ref(1)
  const pageSize = ref(options.defaultPageSize ?? 20)
  const sort = ref<SortState>({ ...options.defaultSort })
  const keyword = ref('')

  function readFromRoute() {
    const query = route.query as Record<string, string | undefined>
    for (const key of options.filterKeys) {
      filters[key] = query[`filter[${key}]`] ?? ''
    }
    keyword.value = query.keyword ?? ''

    const rawPage = Number(query.page ?? '1')
    page.value = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

    const rawSize = Number(query.page_size ?? String(options.defaultPageSize ?? 20))
    pageSize.value = [20, 50, 100].includes(rawSize) ? rawSize : (options.defaultPageSize ?? 20)

    const rawSort = query.sort ?? ''
    if (rawSort) {
      const [field, direction] = rawSort.split(':')
      if (field && options.sortableFields.includes(field)) {
        sort.value = { field, direction: direction === 'asc' ? 'asc' : 'desc' }
      }
    } else {
      sort.value = { ...options.defaultSort }
    }
  }

  function toQuery(): Record<string, string> {
    const query: Record<string, string> = {}
    for (const key of options.filterKeys) {
      const value = filters[key]
      if (value !== undefined && value !== '') {
        query[`filter[${key}]`] = value
      }
    }
    if (keyword.value) query.keyword = keyword.value
    if (page.value > 1) query.page = String(page.value)
    if (pageSize.value !== (options.defaultPageSize ?? 20)) {
      query.page_size = String(pageSize.value)
    }
    query.sort = `${sort.value.field}:${sort.value.direction}`
    return query
  }

  function syncToRoute(replace = true) {
    const query = toQuery()
    const current = route.query as Record<string, string | undefined>
    const changed = JSON.stringify(current) !== JSON.stringify(query)
    if (!changed) return
    void router[replace ? 'replace' : 'push']({ path: route.path, query })
  }

  function setFilter(key: string, value: string) {
    filters[key] = value
    page.value = 1
    syncToRoute()
  }

  function setKeyword(value: string) {
    keyword.value = value
    page.value = 1
    syncToRoute()
  }

  function toggleSort(field: string) {
    if (!options.sortableFields.includes(field)) return
    if (sort.value.field === field) {
      sort.value = { field, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
    } else {
      sort.value = { field, direction: 'desc' }
    }
    page.value = 1
    syncToRoute()
  }

  function setPage(value: number) {
    page.value = value
    syncToRoute()
  }

  function setPageSize(value: number) {
    pageSize.value = value
    page.value = 1
    syncToRoute()
  }

  function reset() {
    for (const key of options.filterKeys) {
      filters[key] = ''
    }
    keyword.value = ''
    sort.value = { ...options.defaultSort }
    page.value = 1
    syncToRoute()
  }

  /** 请求参数：直接拼给后端的 query。 */
  const requestParams = computed(() => ({
    ...toQuery(),
    page: page.value,
    page_size: pageSize.value,
  }))

  watch(() => route.fullPath, readFromRoute, { immediate: true })

  return {
    filters,
    keyword,
    page,
    pageSize,
    sort,
    requestParams,
    setFilter,
    setKeyword,
    toggleSort,
    setPage,
    setPageSize,
    reset,
    readFromRoute,
    syncToRoute,
  }
}

/** 列表加载状态机：数据、分页、加载中、错误。 */
export function useTableLoader<T>(loader: (params: Record<string, unknown>) => Promise<{ items: T[]; total: number }>) {
  const items = ref<T[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')

  async function load(params: Record<string, unknown>) {
    loading.value = true
    error.value = ''
    try {
      const payload = await loader(params)
      items.value = payload.items ?? []
      total.value = payload.total ?? 0
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载失败'
      items.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  return { items, total, loading, error, load }
}
