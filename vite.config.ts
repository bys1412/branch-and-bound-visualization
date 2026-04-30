import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // 合并系统环境变量（GitHub Actions 注入的）和 .env 文件中的变量
  const viteAppPassword = process.env.VITE_APP_PASSWORD || env.VITE_APP_PASSWORD;
  const geminiApiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
  return {
    base: '/branch-and-bound-visualization/',
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey),
      'process.env.VITE_APP_PASSWORD': JSON.stringify(viteAppPassword)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      open: true,
    },
  };
});
