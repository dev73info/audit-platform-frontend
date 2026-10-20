/** 认证：登录、登出、当前用户。 */

import { get, post } from '@/api/http'
import type { LoginResult } from '@/api/types'

export type LoginPayload = {
  username: string
  password: string
  captcha?: string
  mfa_code?: string
}

/** 登录。连续失败会返回 `CAPTCHA_REQUIRED`，账号被锁返回 `ACCOUNT_LOCKED`。 */
export function login(payload: LoginPayload): Promise<LoginResult> {
  return post<LoginResult>('/api/admin/v1/auth/login', payload)
}

/** 登出。 */
export function logout(): Promise<void> {
  return post<void>('/api/admin/v1/auth/logout')
}

/** 当前登录用户信息。 */
export function me(): Promise<LoginResult['user']> {
  return get<LoginResult['user']>('/api/admin/v1/auth/me')
}
