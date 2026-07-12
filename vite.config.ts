import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendHost = process.env.BACKEND_HOST || '127.0.0.1';
const backendPort = process.env.BACKEND_PORT || '8000';
const frontendPort = Number(process.env.FRONTEND_PORT || '5177');
const backendProxyTarget = `http://${backendHost}:${backendPort}`;
const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  root: 'frontend',
  base: basePath,
  plugins: [react()],
  server: {
    port: frontendPort,
    proxy: {
      '/api': backendProxyTarget,
      '/media': backendProxyTarget,
    },
  },
  define: {
    // 2026-07-12 主人拍: 注入前端 build 时间戳. 用户在右下角 VersionBadge 看到当前 build 时间.
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 确保每次 build asset filename 都带 hash, 击穿 CDN/浏览器缓存
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
