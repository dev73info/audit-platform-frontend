/** 项目：列表、详情、增删改、启停、配额。 */

import { buildQuery, del, get, post, put } from '@/api/http'
import type { PageResult, ProjectEnv, ProjectItem, ProjectQuota } from '@/api/types'

export type ProjectListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[status]'?: string
  'filter[env]'?: string
  [key: string]: unknown
}

export type ProjectCreatePayload = {
  name: string
  code: string
  env: ProjectEnv
  owner_id?: number
  description?: string
  quota?: Partial<ProjectQuota>
}

export type ProjectUpdatePayload = {
  name?: string
  env?: ProjectEnv
  owner_id?: number
  description?: string
  version?: number
}

export type ProjectDeleteResult = {
  recycle_id: number
  affected: { audits: number; trigger_sources: number; rules: number }
  running_tasks: number
  expire_at: string
}

/** 项目列表。 */
export function listProjects(params?: ProjectListParams): Promise<PageResult<ProjectItem>> {
  return get<PageResult<ProjectItem>>('/api/admin/v1/projects', params)
}

/** 项目详情。 */
export function getProject(id: number): Promise<ProjectItem> {
  return get<ProjectItem>(`/api/admin/v1/projects/${id}`)
}

/** 新建项目。 */
export function createProject(payload: ProjectCreatePayload): Promise<ProjectItem> {
  return post<ProjectItem>('/api/admin/v1/projects', payload)
}

/** 编辑项目。 */
export function updateProject(id: number, payload: ProjectUpdatePayload): Promise<ProjectItem> {
  return put<ProjectItem>(`/api/admin/v1/projects/${id}`, payload)
}

/** 启用项目。 */
export function enableProject(id: number): Promise<ProjectItem> {
  return post<ProjectItem>(`/api/admin/v1/projects/${id}/enable`)
}

/** 暂停项目。 */
export function pauseProject(id: number, reason: string): Promise<ProjectItem> {
  return post<ProjectItem>(`/api/admin/v1/projects/${id}/pause`, { reason })
}

/** 调整项目配额。 */
export function updateProjectQuota(id: number, quota: Partial<ProjectQuota>): Promise<ProjectItem> {
  return post<ProjectItem>(`/api/admin/v1/projects/${id}/quota`, quota)
}

/** 删除项目（进回收站）。`force` 为 true 时跳过运行中任务检查。 */
export function deleteProject(id: number, force = false): Promise<ProjectDeleteResult> {
  const query = buildQuery({ force: force ? 'true' : '' })
  return del<ProjectDeleteResult>(`/api/admin/v1/projects/${id}${query}`)
}
