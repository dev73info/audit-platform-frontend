/**
 * HTTP 客户端：统一处理响应封装、错误码、鉴权头。
 *
 * 后端统一返回 `{ code, message, data, trace_id, cost_ms }`，
 * 这里直接把 `data` 抛给调用方，错误则抛 `ApiError`（带错误码与 trace_id）。
 */

const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
export const API_BASE_URL = rawBase.replace(/\/$/, '')

const TOKEN_KEY = 'audit_platform_token'

let unauthorizedRedirecting = false

type UnauthorizedListener = () => void
const unauthorizedListeners: UnauthorizedListener[] = []

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.push(listener)
  return () => {
    const index = unauthorizedListeners.indexOf(listener)
    if (index !== -1) unauthorizedListeners.splice(index, 1)
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** 业务错误。`code` 是后端错误码表里的稳定字符串。 */
export class ApiError extends Error {
  status: number
  code: string
  traceId: string
  fieldErrors: FieldError[]
  data: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    traceId = '',
    fieldErrors: FieldError[] = [],
    data: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.traceId = traceId
    this.fieldErrors = fieldErrors
    this.data = data
  }
}

export type FieldError = {
  field: string
  reason: string
}

type Envelope<T> = {
  code: number
  message: string
  data: T
  trace_id: string
  cost_ms: number
}

function isHtmlResponse(body: string): boolean {
  const trimmed = body.trim().toLowerCase()
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')
}

function handleUnauthorized(status: number): void {
  if (status !== 401) return
  if (unauthorizedRedirecting) return

  unauthorizedRedirecting = true
  clearToken()
  for (const listener of unauthorizedListeners) {
    try {
      listener()
    } catch {
      // 监听器抛错不影响主流程
    }
  }
}

export function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
      continue
    }
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized
}

export function authHeaders(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers)
  const token = getToken()
  if (token) {
    merged.set('Authorization', `Bearer ${token}`)
  }
  return merged
}

async function parseError(resp: Response): Promise<ApiError> {
  const fallback = `请求失败（HTTP ${resp.status}）`
  let text = ''
  try {
    text = await resp.text()
  } catch {
    return new ApiError(resp.status, 'INTERNAL_ERROR', fallback)
  }

  if (!text) {
    return new ApiError(resp.status, 'INTERNAL_ERROR', fallback)
  }

  try {
    const payload = JSON.parse(text) as Envelope<unknown> & {
      data?: { field_errors?: FieldError[] }
    }
    const fieldErrors = payload.data?.field_errors ?? []
    return new ApiError(
      resp.status,
      payload.message || 'INTERNAL_ERROR',
      payload.message === 'INTERNAL_ERROR' ? fallback : payload.message,
      payload.trace_id ?? '',
      fieldErrors,
      payload.data ?? null,
    )
  } catch {
    if (isHtmlResponse(text)) {
      return new ApiError(resp.status, 'INTERNAL_ERROR', '接口返回了 HTML 页面，请检查 API 地址或代理配置')
    }
    return new ApiError(resp.status, 'INTERNAL_ERROR', text.slice(0, 200))
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(apiUrl(path), {
    ...init,
    headers: authHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    }),
  })

  handleUnauthorized(resp.status)

  if (!resp.ok) {
    throw await parseError(resp)
  }

  if (resp.status === 204 || resp.status === 205) {
    return undefined as T
  }

  const text = await resp.text()
  if (!text) {
    return undefined as T
  }

  let payload: Envelope<T>
  try {
    payload = JSON.parse(text) as Envelope<T>
  } catch {
    throw new ApiError(resp.status, 'INTERNAL_ERROR', '接口返回了无效的 JSON')
  }

  if (payload.code !== 0) {
    throw new ApiError(
      resp.status,
      payload.message,
      payload.message,
      payload.trace_id ?? '',
      [],
      payload.data ?? null,
    )
  }

  return payload.data
}

export function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>(`${path}${buildQuery(params)}`, { method: 'GET' })
}

export function post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  })
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
