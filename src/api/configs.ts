/** 项目连接配置：列表、保存、测试、版本、回滚、查看密钥、删除。 */

import { del, get, post, put } from '@/api/http'
import type { ConfigType, ConnectionTestResult, PageResult, ProjectConfigItem } from '@/api/types'

export type ConfigListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[type]'?: string
  [key: string]: unknown
}

export type ConfigSavePayload = {
  type: ConfigType
  name: string
  config: Record<string, unknown>
  pool?: Record<string, unknown>
  tags?: string[]
  version?: number
}

export type ConfigTestPayload = {
  type: ConfigType
  config: Record<string, unknown>
  pool?: Record<string, unknown>
}

/** 连接配置列表。 */
export function listConfigs(projectId: number, params?: ConfigListParams): Promise<PageResult<ProjectConfigItem>> {
  return get<PageResult<ProjectConfigItem>>(`/api/admin/v1/projects/${projectId}/configs`, params)
}

/** 连接配置详情。 */
export function getConfig(projectId: number, configId: number): Promise<ProjectConfigItem> {
  return get<ProjectConfigItem>(`/api/admin/v1/projects/${projectId}/configs/${configId}`)
}

/** 新建连接配置。 */
export function createConfig(projectId: number, payload: ConfigSavePayload): Promise<ProjectConfigItem> {
  return post<ProjectConfigItem>(`/api/admin/v1/projects/${projectId}/configs`, payload)
}

/** 保存连接配置。 */
export function updateConfig(
  projectId: number,
  configId: number,
  payload: ConfigSavePayload,
): Promise<ProjectConfigItem> {
  return put<ProjectConfigItem>(`/api/admin/v1/projects/${projectId}/configs/${configId}`, payload)
}

/** 测试连接，不落库。 */
export function testConfig(projectId: number, payload: ConfigTestPayload): Promise<ConnectionTestResult> {
  return post<ConnectionTestResult>(`/api/admin/v1/projects/${projectId}/configs/test`, payload)
}

/** 配置版本列表。 */
export function listConfigVersions(
  projectId: number,
  configId: number,
  params?: ConfigListParams,
): Promise<PageResult<ProjectConfigItem>> {
  return get<PageResult<ProjectConfigItem>>(
    `/api/admin/v1/projects/${projectId}/configs/${configId}/versions`,
    params,
  )
}

/** 回滚到指定版本。 */
export function rollbackConfig(
  projectId: number,
  configId: number,
  version: number,
): Promise<ProjectConfigItem> {
  return post<ProjectConfigItem>(
    `/api/admin/v1/projects/${projectId}/configs/${configId}/rollback`,
    { version },
  )
}

/** 查看密钥明文，需二次确认口令。 */
export function revealConfig(
  projectId: number,
  configId: number,
  password: string,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>(
    `/api/admin/v1/projects/${projectId}/configs/${configId}/reveal`,
    { password },
  )
}

/** 删除连接配置。 */
export function deleteConfig(projectId: number, configId: number): Promise<void> {
  return del<void>(`/api/admin/v1/projects/${projectId}/configs/${configId}`)
}
