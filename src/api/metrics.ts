/** 监控指标：总览、告警。 */

import { get } from '@/api/http'
import type { MetricsOverview, PageResult } from '@/api/types'

export type MetricsScope = 'global' | 'project' | 'audit'

export type MetricsParams = {
  scope?: MetricsScope
  id?: number
  range?: '1h' | '6h' | '24h' | '7d'
  project_id?: number
  [key: string]: unknown
}

/** 指标总览。 */
export function getOverview(params?: MetricsParams): Promise<MetricsOverview> {
  return get<MetricsOverview>('/api/admin/v1/metrics/overview', params)
}

/** 指定范围的指标。 */
export function getMetrics(params?: MetricsParams): Promise<MetricsOverview> {
  return get<MetricsOverview>('/api/admin/v1/metrics', params)
}

/** 告警列表。 */
export function getAlerts(params?: Record<string, unknown>): Promise<PageResult<MetricsOverview['alerts'][number]>> {
  return get<PageResult<MetricsOverview['alerts'][number]>>('/api/admin/v1/metrics/alerts', params)
}
