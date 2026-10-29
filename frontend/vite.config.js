import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /uploads (item photos) to the local backend so you can run both together.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000' },
  },
  build: { outDir: 'dist' },
});
