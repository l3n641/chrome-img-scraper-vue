import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import {crx} from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// https://vite.dev/config/
export default defineConfig({
    plugins: [vue(), crx({manifest})],
    server: {
        port: 5173,
        strictPort: true,
        // 🔥 核心配置：允许跨域
        cors: true,
        headers: {
            'Access-Control-Allow-Origin': '*',
        },
        // 如果你在使用特定的热更新配置，也可以尝试指定 hmr 客户端协议
        hmr: {
            clientPort: 5173,
        },
    },
})


