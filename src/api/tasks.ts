/** 任务：列表、详情、重试、停止、复核与待议队列。 */

import { get, post } from '@/api/http'
import type { PageResult, TaskDetail, TaskItem, TaskResult } from '@/api/types'

export type TaskListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[project_id]'?: string | number
  'filter[audit_id]'?: string | number
  'filter[source_type]'?: string
  'filter[result]'?: string
  'filter[status]'?: string
  'filter[dedupe_flag]'?: string
  'filter[duration_min]'?: number
  'filter[duration_max]'?: number
  'filter[created_at_from]'?: string
  'filter[created_at_to]'?: string
  [key: string]: unknown
}

export type ReviewListParams = TaskListParams

export type ReviewPayload = {
  conclusion: TaskResult
  reason_code?: string
  remark?: string
}

/** 任务列表。 */
export function listTasks(params?: TaskListParams): Promise<PageResult<TaskItem>> {
  return get<PageResult<TaskItem>>('/api/admin/v1/tasks', params)
}

/** 任务详情。 */
export function getTask(taskId: number): Promise<TaskDetail> {
  return get<TaskDetail>(`/api/admin/v1/tasks/${taskId}`)
}

/** 重试任务。 */
export function retryTask(taskId: number): Promise<TaskItem> {
  return post<TaskItem>(`/api/admin/v1/tasks/${taskId}/retry`)
}

/** 重试单个动作。 */
export function retryTaskAction(taskId: number, actionExecId: number): Promise<TaskDetail> {
  return post<TaskDetail>(`/api/admin/v1/tasks/${taskId}/retry-action`, {
    action_exec_id: actionExecId,
  })
}

/** 强制停止任务。 */
export function stopTask(taskId: number): Promise<TaskItem> {
  return post<TaskItem>(`/api/admin/v1/tasks/${taskId}/stop`)
}

/** 人工复核结论。 */
export function reviewTask(taskId: number, payload: ReviewPayload): Promise<TaskItem> {
  return post<TaskItem>(`/api/admin/v1/tasks/${taskId}/review`, payload)
}

/** 批量重试。 */
export function batchRetryTasks(taskIds: number[]): Promise<{ accepted: number }> {
  return post<{ accepted: number }>('/api/admin/v1/tasks/batch-retry', { task_ids: taskIds })
}

/** 导出任务，返回导出任务 ID。 */
export function exportTasks(filters: Record<string, unknown>): Promise<{ export_id: number }> {
  return post<{ export_id: number }>('/api/admin/v1/tasks/export', { filters })
}

/** 待议队列。 */
export function listReviews(params?: ReviewListParams): Promise<PageResult<TaskItem>> {
  return get<PageResult<TaskItem>>('/api/admin/v1/reviews', params)
}

/** 待议任务详情。 */
export function getReview(taskId: number): Promise<TaskDetail> {
  return get<TaskDetail>(`/api/admin/v1/reviews/${taskId}`)
}
