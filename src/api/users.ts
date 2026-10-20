/** 用户与角色：列表、增删改、重置口令、项目授权。 */

import { get, post, put } from '@/api/http'
import type { AdminUserItem, PageResult, RoleCode } from '@/api/types'

export type UserListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[role]'?: string
  'filter[status]'?: string
  [key: string]: unknown
}

export type UserCreatePayload = {
  username: string
  password?: string
  display_name?: string
  email?: string
  /** 后端入参字段是 `role_code`。 */
  role_code: RoleCode
  project_ids?: number[]
}

export type UserUpdatePayload = {
  display_name?: string
  email?: string
  role_code?: RoleCode
  status?: 'ACTIVE' | 'LOCKED' | 'DISABLED'
  project_ids?: number[]
}

/** 用户列表。 */
export function listUsers(params?: UserListParams): Promise<PageResult<AdminUserItem>> {
  return get<PageResult<AdminUserItem>>('/api/admin/v1/users', params)
}

/** 用户详情。 */
export function getUser(id: number): Promise<AdminUserItem> {
  return get<AdminUserItem>(`/api/admin/v1/users/${id}`)
}

/** 新建用户。 */
export function createUser(payload: UserCreatePayload): Promise<AdminUserItem> {
  return post<AdminUserItem>('/api/admin/v1/users', payload)
}

/** 编辑用户。 */
export function updateUser(id: number, payload: UserUpdatePayload): Promise<AdminUserItem> {
  return put<AdminUserItem>(`/api/admin/v1/users/${id}`, payload)
}

/** 重置口令。不传 `password` 时由服务端生成随机口令并回传。 */
export function resetPassword(id: number, password?: string): Promise<{ password: string }> {
  return post<{ password: string }>(`/api/admin/v1/users/${id}/reset-password`, {
    ...(password ? { password } : {}),
  })
}

/** 用户已授权的项目。 */
export function getUserProjects(id: number): Promise<{ project_ids: number[] }> {
  return get<{ project_ids: number[] }>(`/api/admin/v1/users/${id}/projects`)
}

/** 设置用户项目授权。 */
export function updateUserProjects(id: number, projectIds: number[]): Promise<void> {
  return put<void>(`/api/admin/v1/users/${id}/projects`, { project_ids: projectIds })
}
