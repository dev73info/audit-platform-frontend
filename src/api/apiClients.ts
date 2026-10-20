/** 开放 API 客户端：列表、增删改、轮换密钥。 */

import { del, get, post, put } from '@/api/http'
import type { ApiClientItem, PageResult } from '@/api/types'

export type ApiClientListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[status]'?: string
  [key: string]: unknown
}

export type ApiClientCreatePayload = {
  name: string
  app_key?: string
  rate_limit?: Record<string, unknown>
  allow_ips?: string[]
  callback_url?: string | null
}

export type ApiClientUpdatePayload = {
  name?: string
  status?: 'ACTIVE' | 'DISABLED'
  rate_limit?: Record<string, unknown>
  allow_ips?: string[]
  callback_url?: string | null
}

/** 客户端列表。 */
export function listApiClients(
  projectId: number,
  params?: ApiClientListParams,
): Promise<PageResult<ApiClientItem>> {
  return get<PageResult<ApiClientItem>>(`/api/admin/v1/projects/${projectId}/api-clients`, params)
}

/** 客户端详情。 */
export function getApiClient(clientId: number): Promise<ApiClientItem> {
  return get<ApiClientItem>(`/api/admin/v1/api-clients/${clientId}`)
}

/** 新建客户端。 */
export function createApiClient(
  projectId: number,
  payload: ApiClientCreatePayload,
): Promise<ApiClientItem & { secret?: string }> {
  return post<ApiClientItem & { secret?: string }>(
    `/api/admin/v1/projects/${projectId}/api-clients`,
    payload,
  )
}

/** 编辑客户端。 */
export function updateApiClient(
  clientId: number,
  payload: ApiClientUpdatePayload,
): Promise<ApiClientItem> {
  return put<ApiClientItem>(`/api/admin/v1/api-clients/${clientId}`, payload)
}

/** 轮换密钥，返回新密钥明文。 */
export function rotateSecret(clientId: number): Promise<{ app_key: string; secret: string }> {
  return post<{ app_key: string; secret: string }>(
    `/api/admin/v1/api-clients/${clientId}/rotate-secret`,
  )
}

/** 删除客户端。 */
export function deleteApiClient(clientId: number): Promise<void> {
  return del<void>(`/api/admin/v1/api-clients/${clientId}`)
}
