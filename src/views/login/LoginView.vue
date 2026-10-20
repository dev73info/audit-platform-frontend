<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  username: '',
  password: '',
  captcha: '',
})

const errors = reactive({
  username: '',
  password: '',
  captcha: '',
})

const captchaRequired = ref(false)
const submitting = ref(false)

const ERROR_TEXT: Record<string, string> = {
  CAPTCHA_REQUIRED: '连续登录失败，请输入图形验证码',
  ACCOUNT_LOCKED: '账号已被锁定，请联系管理员解锁',
  UNAUTHORIZED: '账号或密码错误',
  INVALID_PARAM: '输入内容不正确',
  RATE_LIMITED: '登录过于频繁，请稍后再试',
  INTERNAL_ERROR: '登录失败，请稍后再试',
}

function errorText(err: ApiError): string {
  return ERROR_TEXT[err.code] ?? err.message
}

async function submit() {
  errors.username = form.username.trim() ? '' : '请输入账号'
  errors.password = form.password ? '' : '请输入密码'
  errors.captcha = ''
  if (errors.username || errors.password) return

  submitting.value = true
  try {
    await auth.login(form.username.trim(), form.password, form.captcha.trim() || undefined)
    await router.replace(String(route.query.redirect ?? '/console/dashboard'))
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'CAPTCHA_REQUIRED') {
        captchaRequired.value = true
        errors.captcha = errorText(err)
      } else if (err.code === 'ACCOUNT_LOCKED') {
        errors.password = errorText(err)
      } else {
        errors.password = errorText(err)
        ElMessage.error(err.message)
      }
    } else {
      ElMessage.error('操作失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <div class="login__brand">
        <span class="login__logo">审</span>
        <span class="login__name">审核中台</span>
      </div>

      <el-form class="login__form" label-position="top" @submit.prevent="submit">
        <el-form-item label="账号" :error="errors.username">
          <el-input
            v-model="form.username"
            placeholder="请输入账号"
            autocomplete="username"
            clearable
          />
        </el-form-item>

        <el-form-item label="密码" :error="errors.password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>

        <el-form-item v-if="captchaRequired" label="验证码" :error="errors.captcha">
          <el-input
            v-model="form.captcha"
            placeholder="请输入图形验证码"
            autocomplete="off"
            clearable
            @keyup.enter="submit"
          />
        </el-form-item>

        <el-form-item>
          <el-button
            class="login__submit"
            type="primary"
            native-type="submit"
            :loading="submitting"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>

      <p class="login__tip">开发默认账号 admin / Test@123456</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ap-space-6);
  background: var(--ap-bg-page);
}

.login__card {
  width: 100%;
  max-width: 380px;
  background: var(--ap-bg-card);
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-radius-card);
  box-shadow: var(--ap-shadow-card);
  padding: var(--ap-space-6);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: var(--ap-space-3);
  margin-bottom: var(--ap-space-5);
}

.login__logo {
  width: 40px;
  height: 40px;
  border-radius: var(--ap-radius-sm);
  background: var(--ap-color-primary);
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.login__name {
  font-size: var(--ap-font-size-title);
  font-weight: 600;
  color: var(--ap-text-primary);
}

.login__form :deep(.el-form-item) {
  margin-bottom: var(--ap-space-4);
}

.login__submit {
  width: 100%;
}

.login__tip {
  margin: 0;
  font-size: var(--ap-font-size-aux);
  color: var(--ap-text-secondary);
  text-align: center;
}
</style>
