import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/jobs':         { target: 'http://jobs-service:8000',        changeOrigin: true, rewrite: p => p.replace(/^\/api\/jobs/, '/jobs') },
      '/api/applications': { target: 'http://applications-service:3001', changeOrigin: true, rewrite: p => p.replace(/^\/api\/applications/, '/applications') },
    },
  },
  build: {
    outDir: 'dist',
  },
});
