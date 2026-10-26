import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development the React app runs on :5173 and forwards /api calls to
// the FastAPI backend, so the browser never needs to know the backend address.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
