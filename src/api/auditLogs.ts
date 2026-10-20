/** 审计日志：列表与导出。 */

import { buildQuery, get, post } from '@/api/http'
import type { AuditLogItem, PageResult } from '@/api/types'

export type AuditLogListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[operator]'?: string
  'filter[action]'?: string
  'filter[object_type]'?: string
  'filter[object_id]'?: string | number
  'filter[project_id]'?: string | number
  'filter[result]'?: string
  'filter[created_at_from]'?: string
  'filter[created_at_to]'?: string
  [key: string]: unknown
}

/** 导出结果。 */
export type AuditLogExportResult = {
  export_id: number
  status: string
  total_rows: number
  file_path: string
}

/** 审计日志列表。 */
export function listAuditLogs(params?: AuditLogListParams): Promise<PageResult<AuditLogItem>> {
  return get<PageResult<AuditLogItem>>('/api/admin/v1/audit-logs', params)
}

/**
 * 导出审计日志。后端按查询参数取筛选条件，所以筛选要拼在 URL 上而不是请求体。
 */
export function exportAuditLogs(filters?: AuditLogListParams): Promise<AuditLogExportResult> {
  return post<AuditLogExportResult>(`/api/admin/v1/audit-logs/export${buildQuery(filters)}`)
}
