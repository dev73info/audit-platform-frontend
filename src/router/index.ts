import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'

import { getToken } from '@/api/http'

const routerHistory =
  import.meta.env.VITE_ROUTER_MODE === 'history'
    ? createWebHistory(import.meta.env.BASE_URL)
    : createWebHashHistory(import.meta.env.BASE_URL)

const routes = [
  {
    path: '/',
    redirect: '/console/dashboard',
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/console',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/DashboardView.vue'),
        meta: { title: '监控看板', icon: 'Odometer', group: '概览' },
      },
      {
        path: 'projects',
        name: 'project-list',
        component: () => import('@/views/projects/ProjectListView.vue'),
        meta: { title: '项目列表', icon: 'FolderOpened', group: '项目' },
      },
      {
        path: 'projects/:id',
        name: 'project-detail',
        component: () => import('@/views/projects/ProjectDetailView.vue'),
        props: true,
        meta: { title: '项目详情', activeMenu: '/console/projects', group: '项目' },
      },
      {
        path: 'projects/:id/config',
        name: 'project-config',
        component: () => import('@/views/projects/ProjectConfigView.vue'),
        props: true,
        meta: { title: '项目配置', activeMenu: '/console/projects', group: '项目' },
      },
      {
        path: 'audits',
        name: 'audit-list',
        component: () => import('@/views/audits/AuditListView.vue'),
        meta: { title: '审核列表', icon: 'Files', group: '审核' },
      },
      {
        path: 'audits/:id',
        name: 'audit-edit',
        component: () => import('@/views/audits/AuditEditView.vue'),
        props: true,
        meta: { title: '审核编辑', activeMenu: '/console/audits', group: '审核' },
      },
      {
        path: 'audits/:id/triggers',
        name: 'audit-triggers',
        component: () => import('@/views/audits/TriggerSourceView.vue'),
        props: true,
        meta: { title: '触发源', activeMenu: '/console/audits', group: '审核' },
      },
      {
        path: 'audits/:id/rules',
        name: 'audit-rules',
        component: () => import('@/views/audits/RuleConfigView.vue'),
        props: true,
        meta: { title: '规则配置', activeMenu: '/console/audits', group: '审核' },
      },
      {
        path: 'audits/:id/routes',
        name: 'audit-routes',
        component: () => import('@/views/audits/RouteConfigView.vue'),
        props: true,
        meta: { title: '结果路由', activeMenu: '/console/audits', group: '审核' },
      },
      {
        path: 'tasks',
        name: 'task-list',
        component: () => import('@/views/tasks/TaskListView.vue'),
        meta: { title: '任务列表', icon: 'Tickets', group: '运营' },
      },
      {
        path: 'tasks/:id',
        name: 'task-detail',
        component: () => import('@/views/tasks/TaskDetailView.vue'),
        props: true,
        meta: { title: '任务详情', activeMenu: '/console/tasks', group: '运营' },
      },
      {
        path: 'reviews',
        name: 'review-queue',
        component: () => import('@/views/review/ReviewQueueView.vue'),
        meta: { title: '待议复核', icon: 'Stamp', group: '运营' },
      },
      {
        path: 'recycle',
        name: 'recycle-bin',
        component: () => import('@/views/recycle/RecycleBinView.vue'),
        meta: { title: '回收站', icon: 'Delete', group: '运营' },
      },
      {
        path: 'logs',
        name: 'audit-log',
        component: () => import('@/views/logs/AuditLogView.vue'),
        meta: { title: '审计日志', icon: 'Document', group: '运营' },
      },
      {
        path: 'users',
        name: 'user-list',
        component: () => import('@/views/users/UserListView.vue'),
        meta: { title: '用户与角色', icon: 'User', group: '系统' },
      },
      {
        path: 'api-clients',
        name: 'api-client-list',
        component: () => import('@/views/apiclients/ApiClientListView.vue'),
        meta: { title: '开放 API 客户端', icon: 'Connection', group: '系统' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/console/dashboard',
  },
]

const router = createRouter({
  history: routerHistory,
  routes,
})

router.beforeEach((to) => {
  if (to.meta.public) {
    return true
  }
  if (!getToken()) {
    return { name: 'login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? ''
  document.title = title ? `${title} · 审核中台` : '审核中台'
})

export default router
