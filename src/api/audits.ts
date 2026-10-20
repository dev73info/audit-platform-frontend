/** 审核定义、触发源、规则、结果路由与 dry-run。 */

import { del, get, post, put } from '@/api/http'
import type {
  AuditItem,
  DryRunResult,
  PageResult,
  ResultRoute,
  RuleGroup,
  TriggerSourceItem,
} from '@/api/types'

export type AuditListParams = {
  page?: number
  page_size?: number
  sort?: string
  keyword?: string
  'filter[status]'?: string
  'filter[media_type]'?: string
  [key: string]: unknown
}

export type AuditDetail = AuditItem & {
  triggers?: TriggerSourceItem[]
  rules?: RuleGroup[]
  routes?: Record<string, ResultRoute>
}

/* ---------------- 审核定义 ---------------- */

/** 审核列表。 */
export function listAudits(projectId: number, params?: AuditListParams): Promise<PageResult<AuditItem>> {
  return get<PageResult<AuditItem>>(`/api/admin/v1/projects/${projectId}/audits`, params)
}

/** 审核详情。 */
export function getAudit(auditId: number): Promise<AuditDetail> {
  return get<AuditDetail>(`/api/admin/v1/audits/${auditId}`)
}

/** 新建审核。 */
export function createAudit(projectId: number, payload: Partial<AuditItem>): Promise<AuditDetail> {
  return post<AuditDetail>(`/api/admin/v1/projects/${projectId}/audits`, payload)
}

/** 编辑审核。 */
export function updateAudit(auditId: number, payload: Partial<AuditItem>): Promise<AuditDetail> {
  return put<AuditDetail>(`/api/admin/v1/audits/${auditId}`, payload)
}

/** 删除审核（进回收站）。 */
export function deleteAudit(auditId: number): Promise<void> {
  return del<void>(`/api/admin/v1/audits/${auditId}`)
}

/** 启用审核。 */
export function enableAudit(auditId: number): Promise<AuditDetail> {
  return post<AuditDetail>(`/api/admin/v1/audits/${auditId}/enable`)
}

/** 暂停审核。 */
export function pauseAudit(auditId: number): Promise<AuditDetail> {
  return post<AuditDetail>(`/api/admin/v1/audits/${auditId}/pause`)
}

/** 克隆审核。 */
export function cloneAudit(auditId: number): Promise<AuditDetail> {
  return post<AuditDetail>(`/api/admin/v1/audits/${auditId}/clone`)
}

/* ---------------- 触发源 ---------------- */

/** 触发源列表。 */
export function listTriggerSources(
  auditId: number,
  params?: Record<string, unknown>,
): Promise<PageResult<TriggerSourceItem>> {
  return get<PageResult<TriggerSourceItem>>(`/api/admin/v1/audits/${auditId}/trigger-sources`, params)
}

/** 触发源详情。 */
export function getTriggerSource(triggerId: number): Promise<TriggerSourceItem> {
  return get<TriggerSourceItem>(`/api/admin/v1/trigger-sources/${triggerId}`)
}

/** 新建触发源。 */
export function createTriggerSource(
  auditId: number,
  payload: Partial<TriggerSourceItem>,
): Promise<TriggerSourceItem> {
  return post<TriggerSourceItem>(`/api/admin/v1/audits/${auditId}/trigger-sources`, payload)
}

/** 编辑触发源。 */
export function updateTriggerSource(
  triggerId: number,
  payload: Partial<TriggerSourceItem>,
): Promise<TriggerSourceItem> {
  return put<TriggerSourceItem>(`/api/admin/v1/trigger-sources/${triggerId}`, payload)
}

/** 删除触发源。 */
export function deleteTriggerSource(triggerId: number): Promise<void> {
  return del<void>(`/api/admin/v1/trigger-sources/${triggerId}`)
}

/** 启用触发源。 */
export function enableTriggerSource(triggerId: number): Promise<TriggerSourceItem> {
  return post<TriggerSourceItem>(`/api/admin/v1/trigger-sources/${triggerId}/enable`)
}

/** 暂停触发源。 */
export function pauseTriggerSource(triggerId: number): Promise<TriggerSourceItem> {
  return post<TriggerSourceItem>(`/api/admin/v1/trigger-sources/${triggerId}/pause`)
}

/** 发送测试消息。 */
export function testTriggerSource(triggerId: number): Promise<{ ok: boolean; message?: string }> {
  return post<{ ok: boolean; message?: string }>(`/api/admin/v1/trigger-sources/${triggerId}/test`)
}

/** 最近消费记录。 */
export function listTriggerRecent(triggerId: number): Promise<PageResult<Record<string, unknown>>> {
  return get<PageResult<Record<string, unknown>>>(`/api/admin/v1/trigger-sources/${triggerId}/recent`)
}

/* ---------------- 规则 ---------------- */

/** 规则组列表。 */
export function listRules(auditId: number, params?: Record<string, unknown>): Promise<PageResult<RuleGroup>> {
  return get<PageResult<RuleGroup>>(`/api/admin/v1/audits/${auditId}/rules`, params)
}

/** 规则组详情。 */
export function getRule(ruleId: number): Promise<RuleGroup> {
  return get<RuleGroup>(`/api/admin/v1/rules/${ruleId}`)
}

/** 新建规则组。 */
export function createRule(auditId: number, payload: Partial<RuleGroup>): Promise<RuleGroup> {
  return post<RuleGroup>(`/api/admin/v1/audits/${auditId}/rules`, payload)
}

/** 编辑规则组。 */
export function updateRule(ruleId: number, payload: Partial<RuleGroup>): Promise<RuleGroup> {
  return put<RuleGroup>(`/api/admin/v1/rules/${ruleId}`, payload)
}

/** 删除规则组。 */
export function deleteRule(ruleId: number): Promise<void> {
  return del<void>(`/api/admin/v1/rules/${ruleId}`)
}

/** 规则试跑。 */
export function dryRunRules(auditId: number, sample: unknown): Promise<DryRunResult> {
  return post<DryRunResult>(`/api/admin/v1/audits/${auditId}/rules/dry-run`, { sample })
}

/* ---------------- 结果路由 ---------------- */

/** 路由列表（按结论分组）。 */
export function listRoutes(auditId: number): Promise<Record<string, ResultRoute>> {
  return get<Record<string, ResultRoute>>(`/api/admin/v1/audits/${auditId}/routes`)
}

/** 保存某条结论的路由。 */
export function saveRoute(auditId: number, resultType: string, payload: Partial<ResultRoute>): Promise<ResultRoute> {
  return put<ResultRoute>(`/api/admin/v1/audits/${auditId}/routes/${resultType}`, payload)
}

/** 应用路由模板。 */
export function applyRouteTemplate(
  auditId: number,
  template: 'reject_all_except_pass' | 'same_actions_all' | 'callback_only' | 'pass_release_review_manual',
): Promise<Record<string, ResultRoute>> {
  return post<Record<string, ResultRoute>>(`/api/admin/v1/audits/${auditId}/routes/apply-template`, {
    template,
  })
}

/** 路由渲染预览。 */
export function previewRoute(
  auditId: number,
  resultType: string,
  sample: unknown,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>(`/api/admin/v1/audits/${auditId}/routes/preview`, {
    result_type: resultType,
    sample,
  })
}
