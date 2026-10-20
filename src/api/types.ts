/** 与后端 `doc/API.md` 一一对应的类型定义。 */

export type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  trace_id: string
  cost_ms: number
}

export type PageResult<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'DELETED'
export type ProjectEnv = 'dev' | 'test' | 'staging' | 'prod'
export type AuditStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'DELETED'
export type TriggerType = 'REDIS' | 'POLLING' | 'WEBSOCKET' | 'OPENAPI'
export type TaskStatus =
  | 'RECEIVED'
  | 'LOCKED'
  | 'QUEUED'
  | 'WAITING_QUOTA'
  | 'PROCESSING'
  | 'RULE_EVALUATING'
  | 'MEDIA_REVIEWING'
  | 'ROUTING'
  | 'REVIEW_PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'DUPLICATED'
  | 'DEAD_LETTER'
export type TaskResult = 'PASS' | 'REJECT' | 'REVIEW' | 'UNKNOWN'
export type DedupeFlag = 'NORMAL' | 'DUPLICATED' | 'NO_DEDUPE'
export type ActionType = 'HTTP' | 'REDIS' | 'MYSQL' | 'WEBHOOK' | 'MQ'
export type ConfigType = 'REDIS' | 'MYSQL' | 'API' | 'OSS' | 'MQ'
export type RoleCode =
  | 'SUPER_ADMIN'
  | 'PROJECT_ADMIN'
  | 'AUDIT_CONFIGURER'
  | 'REVIEWER'
  | 'READONLY'

export type ProjectQuota = {
  max_concurrency: number
  max_qps: number
  max_mysql_pool: number
  max_redis_conn: number
  max_media_size_mb: number
  max_daily_tasks: number | null
  max_api_call_per_task: number
}

export type ProjectStats = {
  audit_count: number
  task_today: number
  task_total: number
  queue_backlog: number
}

export type ProjectItem = {
  id: number
  name: string
  code: string
  env: ProjectEnv
  status: ProjectStatus
  owner_id: number
  owner_name: string | null
  description: string | null
  retain_days: number
  quota: ProjectQuota
  stats: ProjectStats
  version: number
  created_at: string
  updated_at: string
}

export type ProjectConfigItem = {
  id: number
  project_id: number
  type: ConfigType
  name: string
  version: number
  config: Record<string, unknown>
  pool: Record<string, unknown>
  tags: string[]
  test_status: 'UNTESTED' | 'OK' | 'FAILED'
  test_message: string | null
  tested_at: string | null
  created_at: string
  updated_at: string
}

export type ConnectionTestResult = {
  type: ConfigType
  ok: boolean
  latency_ms: number
  server_info: string | null
  max_connections: number | null
  current_used: number | null
  global_limit: number | null
  remain_for_project: number | null
  warnings: string[]
  error: string | null
}

export type ApiClientItem = {
  id: number
  project_id: number
  app_key: string
  name: string
  status: 'ACTIVE' | 'DISABLED'
  secret_masked: string
  rate_limit: Record<string, unknown>
  allow_ips: string[]
  callback_url: string | null
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export type RuleItem = {
  id?: number | null
  field: string
  operator: string
  value: unknown
  case_sensitive: boolean
  negate: boolean
  sort_order: number
}

export type RuleGroup = {
  id?: number | null
  name: string
  priority: number
  logic: 'AND' | 'OR'
  stop_on_hit: boolean
  on_hit_result: TaskResult
  status: string
  items: RuleItem[]
  created_at?: string
  updated_at?: string
}

export type ActionSpec = {
  id?: string | null
  type: ActionType
  name?: string | null
  api_ref?: string | null
  method?: string | null
  path?: string | null
  headers?: Record<string, unknown> | null
  body?: unknown
  command?: string | null
  key?: string | null
  value?: unknown
  ttl_sec?: number | null
  datasource?: string | null
  sql?: string | null
  params?: unknown[] | null
  url?: string | null
  sign?: Record<string, unknown> | null
  target?: string | null
  topic?: string | null
  timeout_ms?: number | null
  retry?: Record<string, unknown> | null
  on_error?: 'continue' | 'abort' | 'to_review' | null
}

export type ResultRoute = {
  id?: number | null
  result_type: 'PASS' | 'REJECT' | 'REVIEW'
  exec_mode: 'sequential' | 'parallel'
  on_error: 'continue' | 'abort' | 'to_review'
  actions: ActionSpec[]
  status?: string | null
}

export type TriggerSourceItem = {
  id: number
  project_id: number
  audit_id: number
  type: TriggerType
  name: string
  priority: number
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED'
  config: Record<string, unknown>
  success_count: number
  fail_count: number
  last_consume_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type AuditItem = {
  id: number
  project_id: number
  project_name: string | null
  name: string
  code: string
  media_types: string[]
  status: AuditStatus
  concurrency: number
  timeout_ms: number
  dedupe_window_sec: number
  media_hash_in_key: boolean
  retry_policy: Record<string, unknown>
  default_result: TaskResult
  on_model_fail: TaskResult
  media_review: Record<string, unknown>
  description: string | null
  config_version: number
  created_at: string
  updated_at: string
}

export type TaskItem = {
  id: number
  task_no: string
  project_id: number
  project_name: string | null
  audit_id: number
  audit_name: string | null
  source_type: TriggerType
  biz_key: string | null
  media_type: string
  status: TaskStatus
  result: TaskResult
  dedupe_flag: DedupeFlag
  retry_count: number
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  waiting_ms?: number | null
  reviewer_id?: number | null
  reviewer_name?: string | null
  created_at: string
  finished_at: string | null
}

export type TaskEvent = {
  from_status: string | null
  to_status: string
  message: string | null
  cost_ms: number | null
  created_at: string
}

export type ActionExecLog = {
  id: number
  route_type: string
  action_id: string
  action_type: ActionType
  action_name: string | null
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  retry_count: number
  duration_ms: number | null
  request: unknown
  response: unknown
  error_message: string | null
  created_at: string
}

export type RuleItemTrace = {
  field: string
  operator: string
  actual: unknown
  expected: unknown
  hit: boolean
}

export type RuleGroupTrace = {
  rule_id?: number | null
  rule: string
  logic: string
  hit: boolean
  skipped?: boolean
  items: RuleItemTrace[]
}

export type MediaItem = {
  type: string
  content: string
  url: string
  duration?: number | null
}

export type TaskDetail = {
  id: number
  task_no: string
  project_id: number
  project_name: string | null
  audit_id: number
  audit_name: string | null
  source_type: TriggerType
  biz_key: string | null
  media_type: string
  status: TaskStatus
  result: TaskResult
  dedupe_flag: DedupeFlag
  retry_count: number
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  media: MediaItem[]
  ext: Record<string, unknown>
  reasons: Array<Record<string, unknown>>
  rule_hit: RuleGroupTrace[]
  actions: ActionExecLog[]
  events: TaskEvent[]
  payload: Record<string, unknown>
  trace_id: string | null
  created_at: string
  finished_at: string | null
}

export type RecycleBinItem = {
  id: number
  object_type: 'PROJECT' | 'AUDIT'
  object_id: number
  object_name: string
  object_code: string | null
  project_id: number
  project_name: string | null
  deleted_by: number
  deleted_by_name: string | null
  deleted_at: string
  expire_at: string
  remain_days: number
  purge_status: 'NONE' | 'PURGING' | 'PURGED'
  purge_message: string | null
  children_count: number
}

export type AuditLogItem = {
  id: number
  project_id: number | null
  operator: string
  operator_id: number | null
  operator_ip: string | null
  action: string
  object_type: string | null
  object_id: string | null
  result: 'SUCCESS' | 'FAIL'
  detail: Record<string, unknown>
  trace_id: string | null
  created_at: string
}

export type MetricsOverview = {
  task_total: number
  task_today: number
  pass: number
  reject: number
  review: number
  failed: number
  dedupe_hit: number
  backlog: number
  dead_letter: number
  duration_p50: number
  duration_p95: number
  duration_p99: number
  action_total: number
  action_failed: number
  action_success_rate: number
  series: Array<{ ts: string; pass: number; reject: number; review: number; failed: number }>
  projects: Array<{
    project_id: number
    project_name: string
    health: 'HEALTHY' | 'WARNING' | 'CRITICAL'
    task_total: number
    backlog: number
    error_rate: number
    mysql_pool_in_use: number
    redis_conn_in_use: number
  }>
  alerts: Array<{
    id: number
    name: string
    level: string
    status: string
    message: string | null
    started_at: string
  }>
}

export type LoginResult = {
  access_token: string
  refresh_token: string
  expires_in: number
  user: {
    id: number
    username: string
    display_name: string | null
    role: RoleCode
    roles: RoleCode[]
    permissions: string[]
    projects: number[]
  }
}

export type NotificationItem = {
  id: number
  category: 'ALERT' | 'EXPORT' | 'CLEANUP' | 'REVIEW'
  title: string
  content: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export type AdminUserItem = {
  id: number
  username: string
  display_name: string | null
  email: string | null
  role: RoleCode
  status: 'ACTIVE' | 'LOCKED' | 'DISABLED'
  fail_count: number
  locked_until: string | null
  last_login_at: string | null
  last_login_ip: string | null
  projects: number[]
  created_at: string
}

export type DryRunResult = {
  final_result: TaskResult
  matched_rule: string | null
  trace: RuleGroupTrace[]
}
