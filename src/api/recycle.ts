/** 回收站：列表、恢复、永久删除、批量删除、清理任务。 */

import { del, get, post } from '@/api/http'
import type { PageResult, RecycleBinItem } from '@/api/types'

export type RecycleListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[object_type]'?: string
  'filter[project_id]'?: string | number
  [key: string]: unknown
}

/** 清理任务（与后端 `cleanup_task` 表一致）。 */
export type CleanupTaskItem = {
  id: number
  recycle_id: number | null
  object_type: string
  object_id: number
  object_name: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'
  progress: number
  step: string | null
  error_message: string | null
  created_by: number
  created_at: string
  finished_at: string | null
}

/** 批量永久删除结果。 */
export type BatchPurgeResult = {
  succeeded: number[]
  failed: Array<{ id: number; reason: string }>
}

/** 回收站列表。 */
export function listRecycleBin(params?: RecycleListParams): Promise<PageResult<RecycleBinItem>> {
  return get<PageResult<RecycleBinItem>>('/api/admin/v1/recycle-bin', params)
}

/** 恢复对象。 */
export function restoreRecycleItem(id: number): Promise<RecycleBinItem> {
  return post<RecycleBinItem>(`/api/admin/v1/recycle-bin/${id}/restore`)
}

/** 永久删除，需输入对象全名确认。 */
export function purgeRecycleItem(id: number, confirmName: string): Promise<unknown> {
  return del<unknown>(`/api/admin/v1/recycle-bin/${id}/purge`, { confirm_name: confirmName })
}

/** 批量永久删除。 */
export function batchPurgeRecycleBin(
  ids: number[],
  confirmText: string,
): Promise<BatchPurgeResult> {
  return post<BatchPurgeResult>('/api/admin/v1/recycle-bin/batch-purge', {
    ids,
    confirm_text: confirmText,
  })
}

/** 清理任务列表。 */
export function listCleanupTasks(params?: RecycleListParams): Promise<PageResult<CleanupTaskItem>> {
  return get<PageResult<CleanupTaskItem>>('/api/admin/v1/cleanup-tasks', params)
}
