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
        manualChunks(id) {
          // 分包要避免互相引用成环：只按 node_modules 下的真实包名归属，
          // 不按路径里是否含 "vue" 判断（element-plus 内部路径也带 vue，会成环）。
          if (id.includes('node_modules/pinia')) {
            return 'pinia'
          }
          if (id.includes('node_modules/element-plus')) {
            return 'element-plus'
          }
          if (id.includes('node_modules/vue/') || id.includes('node_modules/vue-router')) {
            return 'vue-vendor'
          }
          if (id.includes('node_modules')) {
            return 'vendor'
          }
          return 'app'
        },
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
