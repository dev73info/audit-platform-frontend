<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notification'
import { useProjectStore } from '@/stores/project'
import { projectEnvLabel, projectStatusMeta } from '@/utils/labels'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const projects = useProjectStore()
const notifications = useNotificationStore()

const collapsed = ref(false)

interface MenuItem {
  path: string
  title: string
  icon: string
  group: string
}

const menuItems = computed<MenuItem[]>(() => {
  const raw = router.getRoutes()
  const seen = new Set<string>()
  const items: MenuItem[] = []
  for (const entry of raw) {
    const path = entry.path
    if (!path.startsWith('/console/')) continue
    if (path.includes(':')) continue
    if (seen.has(path)) continue
    seen.add(path)
    const meta = entry.meta as { title?: string; icon?: string; group?: string }
    if (!meta.title || !meta.icon) continue
    items.push({
      path,
      title: meta.title,
      icon: meta.icon,
      group: meta.group ?? '其它',
    })
  }
  const order = ['概览', '项目', '审核', '运营', '系统', '其它']
  return items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
})

const groups = computed(() => {
  const map = new Map<string, MenuItem[]>()
  for (const item of menuItems.value) {
    const list = map.get(item.group) ?? []
    list.push(item)
    map.set(item.group, list)
  }
  return [...map.entries()]
})

const activeMenu = computed(() => {
  const meta = route.meta as { activeMenu?: string }
  return meta.activeMenu ?? route.path
})

const currentProject = computed(() => projects.current)

async function handleProjectChange(id: number) {
  projects.select(id)
  // 切换项目后刷新当前页，让列表带上新的 project_id 上下文
  await router.replace({ path: route.path, query: { ...route.query, project_id: id } })
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm('退出后需要重新登录，确认退出？', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  auth.logout()
  projects.reset()
  notifications.reset()
  ElMessage.success('已退出登录')
  await router.replace({ name: 'login' })
}

onMounted(async () => {
  auth.hydrate()
  try {
    await auth.loadProfile()
  } catch {
    // 令牌失效由全局 401 监听处理
  }
  try {
    await projects.loadProjects()
  } catch {
    // 项目列表加载失败不阻塞页面
  }
  try {
    await notifications.load()
  } catch {
    // 通知加载失败不阻塞页面
  }
})

watch(
  () => route.fullPath,
  () => {
    void notifications.load().catch(() => undefined)
  },
)
</script>

<template>
  <div class="ap-shell" :class="{ 'ap-shell--collapsed': collapsed }">
    <aside class="ap-shell__aside">
      <div class="ap-shell__brand">
        <span class="ap-shell__logo">审</span>
        <span v-show="!collapsed" class="ap-shell__brand-text">审核中台</span>
      </div>

      <nav class="ap-shell__nav">
        <div v-for="[group, items] in groups" :key="group" class="ap-shell__group">
          <div v-show="!collapsed" class="ap-shell__group-title">{{ group }}</div>
          <RouterLink
            v-for="item in items"
            :key="item.path"
            :to="item.path"
            class="ap-shell__link"
            :class="{ 'is-active': activeMenu === item.path }"
            :title="collapsed ? item.title : undefined"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span v-show="!collapsed" class="ap-shell__link-text">{{ item.title }}</span>
          </RouterLink>
        </div>
      </nav>

      <button class="ap-shell__collapse" type="button" @click="collapsed = !collapsed">
        <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
        <span v-show="!collapsed">收起侧栏</span>
      </button>
    </aside>

    <div class="ap-shell__main">
      <header class="ap-shell__header">
        <el-select
          v-if="currentProject"
          :model-value="currentProject.id"
          class="ap-shell__project"
          placeholder="选择项目"
          @change="handleProjectChange"
        >
          <el-option
            v-for="item in projects.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          >
            <span class="ap-shell__project-option">
              <span class="ap-mono">{{ item.code }}</span>
              <el-tag size="small" effect="plain">{{ projectEnvLabel(item.env) }}</el-tag>
            </span>
          </el-option>
        </el-select>
        <span v-else class="ap-text-aux">未选择项目</span>

        <div class="ap-grow"></div>

        <el-tooltip content="待议与告警" placement="bottom">
          <el-badge :value="notifications.unread" :hidden="notifications.unread === 0">
            <el-button text circle @click="router.push('/console/reviews')">
              <el-icon><Bell /></el-icon>
            </el-button>
          </el-badge>
        </el-tooltip>

        <el-dropdown trigger="click">
          <span class="ap-shell__user">
            <el-avatar :size="28">{{ auth.displayName.slice(0, 1) || 'A' }}</el-avatar>
            <span class="ap-shell__user-name">{{ auth.displayName || auth.username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                {{ projectStatusMeta(auth.role).label }}
              </el-dropdown-item>
              <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="ap-shell__content">
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.ap-shell {
  display: flex;
  height: 100%;
  background: var(--ap-bg-page);
}

.ap-shell__aside {
  width: var(--ap-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #101a2e;
  color: #cbd5e1;
  transition: width var(--ap-transition);
}

.ap-shell--collapsed .ap-shell__aside {
  width: var(--ap-sidebar-width-collapsed);
}

.ap-shell__brand {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
  height: var(--ap-header-height);
  padding: 0 var(--ap-space-4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ap-shell__logo {
  width: 26px;
  height: 26px;
  border-radius: var(--ap-radius-control);
  background: var(--ap-color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ap-shell__brand-text {
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}

.ap-shell__nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--ap-space-3) var(--ap-space-2);
}

.ap-shell__group + .ap-shell__group {
  margin-top: var(--ap-space-4);
}

.ap-shell__group-title {
  padding: 0 var(--ap-space-3) var(--ap-space-2);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #64748b;
  text-transform: uppercase;
}

.ap-shell__link {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
  height: 36px;
  padding: 0 var(--ap-space-3);
  border-radius: var(--ap-radius-control);
  color: #cbd5e1;
  text-decoration: none;
  font-size: var(--ap-font-size-body);
  transition: background var(--ap-transition), color var(--ap-transition);
}

.ap-shell__link:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.ap-shell__link.is-active {
  background: var(--ap-color-primary);
  color: #fff;
}

.ap-shell__link-text {
  white-space: nowrap;
}

.ap-shell__collapse {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
  height: 40px;
  padding: 0 var(--ap-space-4);
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: var(--ap-font-size-aux);
}

.ap-shell__collapse:hover {
  color: #fff;
}

.ap-shell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ap-shell__header {
  height: var(--ap-header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--ap-space-3);
  padding: 0 var(--ap-space-6);
  background: var(--ap-bg-card);
  border-bottom: 1px solid var(--ap-border);
}

.ap-shell__project {
  width: 220px;
}

.ap-shell__project-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ap-space-2);
}

.ap-shell__user {
  display: flex;
  align-items: center;
  gap: var(--ap-space-2);
  cursor: pointer;
  color: var(--ap-text-regular);
  outline: none;
}

.ap-shell__user-name {
  font-size: var(--ap-font-size-body);
}

.ap-shell__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 1024px) {
  .ap-shell__aside {
    width: var(--ap-sidebar-width-collapsed);
  }

  .ap-shell__aside .ap-shell__brand-text,
  .ap-shell__aside .ap-shell__link-text,
  .ap-shell__aside .ap-shell__group-title,
  .ap-shell__aside .ap-shell__collapse span {
    display: none;
  }
}
</style>
