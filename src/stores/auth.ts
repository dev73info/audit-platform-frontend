import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { clearToken, get, getToken, post, setToken } from '@/api/http'
import type { LoginResult, RoleCode } from '@/api/types'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export const useAuthStore = defineStore('audit-auth', () => {
  const token = ref('')
  const username = ref('')
  const displayName = ref('')
  const role = ref<RoleCode>('READONLY')
  const permissions = ref<string[]>([])
  const projectIds = ref<number[]>([])
  const hydrated = ref(false)
  const loading = ref(false)

  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  const isAuthed = computed(() => token.value.length > 0)
  const isSuperAdmin = computed(() => role.value === 'SUPER_ADMIN')

  function applyLogin(payload: LoginResult) {
    token.value = payload.access_token
    setToken(payload.access_token)
    applyProfile(payload.user)
    scheduleRefresh()
  }

  function applyProfile(user: LoginResult['user']) {
    username.value = user.username
    displayName.value = user.display_name ?? user.username
    role.value = user.role
    permissions.value = user.permissions ?? []
    projectIds.value = user.projects ?? []
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      void refresh()
    }, REFRESH_INTERVAL_MS)
  }

  async function refresh(): Promise<boolean> {
    if (!token.value) return false
    try {
      const payload = await post<LoginResult>('/api/admin/v1/auth/refresh')
      applyLogin(payload)
      return true
    } catch {
      logout()
      return false
    }
  }

  function hydrate() {
    if (hydrated.value) return
    hydrated.value = true
    token.value = getToken()
  }

  async function login(usernameInput: string, passwordInput: string, captcha?: string, mfaCode?: string) {
    loading.value = true
    try {
      const payload = await post<LoginResult>('/api/admin/v1/auth/login', {
        username: usernameInput.trim(),
        password: passwordInput,
        ...(captcha ? { captcha } : {}),
        ...(mfaCode ? { mfa_code: mfaCode } : {}),
      })
      applyLogin(payload)
      return payload
    } finally {
      loading.value = false
    }
  }

  async function loadProfile(): Promise<void> {
    const payload = await get<LoginResult['user']>('/api/admin/v1/auth/me')
    applyProfile(payload)
  }

  function logout() {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    token.value = ''
    username.value = ''
    displayName.value = ''
    role.value = 'READONLY'
    permissions.value = []
    projectIds.value = []
    clearToken()
  }

  function can(permission: string): boolean {
    if (isSuperAdmin.value) return true
    return permissions.value.includes(permission)
  }

  return {
    token,
    username,
    displayName,
    role,
    permissions,
    projectIds,
    hydrated,
    loading,
    isAuthed,
    isSuperAdmin,
    hydrate,
    login,
    refresh,
    loadProfile,
    logout,
    can,
  }
})
