import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

const localBackendTarget = 'http://127.0.0.1:8090'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 文件名带内容 hash：改版后旧 chunk 与新 chunk 的 URL 互不冲突，
        // 已打开的旧页面继续按旧文件名取到旧文件，切换瞬间不会混版本。
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // 不做手工分包：按包名切会把 element-plus 与 vendor 互切成环
        // （Vite 会告警 Circular chunk），交给 Rollup 默认策略更稳。
      },
    },
  },
  server: {
    // 绑 0.0.0.0：localhost / 127.0.0.1 / 局域网 IP 都能进。
    host: '0.0.0.0',
    port: 5181,
    // 端口被占时直接报错退出，不要静默自增到别的端口。
    strictPort: true,
    proxy: {
      '/api': localBackendTarget,
      '/open': localBackendTarget,
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
