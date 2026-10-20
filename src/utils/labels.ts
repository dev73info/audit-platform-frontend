/** 状态、结果、枚举的中文标签与语义色。与设计文档 8.1「状态语义用色严格统一」一致。 */

export type SemanticTone = 'pass' | 'reject' | 'review' | 'neutral' | 'info' | 'primary'

export function projectStatusMeta(status: string): { label: string; tone: SemanticTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: '启用', tone: 'pass' }
    case 'PAUSED':
      return { label: '暂停', tone: 'review' }
    case 'DISABLED':
      return { label: '停用', tone: 'neutral' }
    case 'DELETED':
      return { label: '已删除', tone: 'neutral' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function projectEnvLabel(env: string): string {
  switch (env) {
    case 'dev':
      return '开发'
    case 'test':
      return '测试'
    case 'staging':
      return '预发'
    case 'prod':
      return '生产'
    default:
      return env
  }
}

export function auditStatusMeta(status: string): { label: string; tone: SemanticTone } {
  switch (status) {
    case 'DRAFT':
      return { label: '草稿', tone: 'neutral' }
    case 'ACTIVE':
      return { label: '启用', tone: 'pass' }
    case 'PAUSED':
      return { label: '暂停', tone: 'review' }
    case 'DELETED':
      return { label: '已删除', tone: 'neutral' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

/** 审核结论：绿=通过、红=不通过、橙=待议。 */
export function resultMeta(result: string): { label: string; tone: SemanticTone } {
  switch (result) {
    case 'PASS':
      return { label: '通过', tone: 'pass' }
    case 'REJECT':
      return { label: '不通过', tone: 'reject' }
    case 'REVIEW':
      return { label: '待议', tone: 'review' }
    case 'UNKNOWN':
      return { label: '未知', tone: 'neutral' }
    default:
      return { label: result, tone: 'neutral' }
  }
}

export function taskStatusMeta(status: string): { label: string; tone: SemanticTone } {
  switch (status) {
    case 'RECEIVED':
      return { label: '已接收', tone: 'neutral' }
    case 'LOCKED':
      return { label: '加锁中', tone: 'neutral' }
    case 'QUEUED':
      return { label: '排队中', tone: 'info' }
    case 'WAITING_QUOTA':
      return { label: '等待配额', tone: 'review' }
    case 'PROCESSING':
      return { label: '处理中', tone: 'info' }
    case 'RULE_EVALUATING':
      return { label: '规则判定', tone: 'info' }
    case 'MEDIA_REVIEWING':
      return { label: '媒体审核', tone: 'info' }
    case 'ROUTING':
      return { label: '执行路由', tone: 'info' }
    case 'REVIEW_PENDING':
      return { label: '待议', tone: 'review' }
    case 'SUCCESS':
      return { label: '已完成', tone: 'pass' }
    case 'FAILED':
      return { label: '失败', tone: 'reject' }
    case 'DUPLICATED':
      return { label: '重复任务', tone: 'neutral' }
    case 'DEAD_LETTER':
      return { label: '死信', tone: 'reject' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function dedupeFlagMeta(flag: string): { label: string; tone: SemanticTone } {
  switch (flag) {
    case 'NORMAL':
      return { label: '正常', tone: 'neutral' }
    case 'DUPLICATED':
      return { label: '已去重', tone: 'info' }
    case 'NO_DEDUPE':
      return { label: '未去重', tone: 'review' }
    default:
      return { label: flag, tone: 'neutral' }
  }
}

export function sourceTypeLabel(type: string): string {
  switch (type) {
    case 'REDIS':
      return 'Redis 队列'
    case 'POLLING':
      return '轮询接口'
    case 'WEBSOCKET':
      return 'WebSocket'
    case 'OPENAPI':
      return '开放 API'
    default:
      return type
  }
}

export function configTypeLabel(type: string): string {
  switch (type) {
    case 'REDIS':
      return 'Redis'
    case 'MYSQL':
      return 'MySQL'
    case 'API':
      return '第三方 API'
    case 'OSS':
      return '对象存储'
    case 'MQ':
      return '消息队列'
    default:
      return type
  }
}

export function actionTypeLabel(type: string): string {
  switch (type) {
    case 'HTTP':
      return 'HTTP API'
    case 'REDIS':
      return 'Redis 命令'
    case 'MYSQL':
      return 'MySQL 更新'
    case 'WEBHOOK':
      return 'Webhook'
    case 'MQ':
      return '消息队列'
    default:
      return type
  }
}

export function mediaTypeLabel(type: string): string {
  switch (type) {
    case 'text':
      return '文本'
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    case 'mixed':
      return '混合'
    default:
      return type
  }
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '超级管理员'
    case 'PROJECT_ADMIN':
      return '项目管理员'
    case 'AUDIT_CONFIGURER':
      return '审核配置员'
    case 'REVIEWER':
      return '审核员/复核员'
    case 'READONLY':
      return '只读用户'
    default:
      return role
  }
}

export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    LOGIN: '登录',
    LOGIN_FAILED: '登录失败',
    LOGOUT: '登出',
    PROJECT_CREATE: '创建项目',
    PROJECT_UPDATE: '编辑项目',
    PROJECT_ENABLE: '启用项目',
    PROJECT_PAUSE: '暂停项目',
    PROJECT_DELETE: '删除项目',
    PROJECT_RESTORE: '恢复项目',
    PROJECT_PURGE: '永久删除项目',
    QUOTA_UPDATE: '调整配额',
    CONFIG_CREATE: '新增连接配置',
    CONFIG_UPDATE: '修改连接配置',
    CONFIG_TEST: '测试连接',
    CONFIG_ROLLBACK: '回滚配置',
    CONFIG_REVEAL: '查看密钥',
    CONFIG_DELETE: '删除连接配置',
    AUDIT_CREATE: '创建审核',
    AUDIT_UPDATE: '编辑审核',
    AUDIT_ENABLE: '启用审核',
    AUDIT_PAUSE: '暂停审核',
    AUDIT_DELETE: '删除审核',
    AUDIT_RESTORE: '恢复审核',
    AUDIT_CLONE: '克隆审核',
    TRIGGER_CREATE: '新增触发源',
    TRIGGER_UPDATE: '编辑触发源',
    TRIGGER_DELETE: '删除触发源',
    TRIGGER_TEST: '测试触发源',
    RULE_CREATE: '新增规则',
    RULE_UPDATE: '编辑规则',
    RULE_DELETE: '删除规则',
    ROUTE_UPDATE: '编辑结果路由',
    ROUTE_TEMPLATE: '应用路由模板',
    TASK_RETRY: '重试任务',
    TASK_STOP: '强制停止任务',
    TASK_REVIEW: '人工复核',
    ACTION_RETRY: '重试动作',
    ACTION_EXEC: '执行动作',
    RECYCLE_RESTORE: '恢复回收站对象',
    RECYCLE_PURGE: '永久删除回收站对象',
    RECYCLE_AUTO_CLEAN: '自动清理回收站',
    API_CLIENT_CREATE: '创建开放 API 客户端',
    API_CLIENT_UPDATE: '编辑开放 API 客户端',
    API_CLIENT_DELETE: '删除开放 API 客户端',
    API_CALL: '开放 API 调用',
    API_SIGN_FAILED: '开放 API 签名失败',
    API_RATE_LIMITED: '开放 API 限流',
    USER_CREATE: '创建用户',
    USER_UPDATE: '编辑用户',
    USER_RESET_PASSWORD: '重置口令',
    USER_SCOPE_UPDATE: '调整项目授权',
  }
  return map[action] ?? action
}
