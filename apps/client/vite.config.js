import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Optional: proxy API requests to backend during dev
      // '/api': {
      //   target: 'http://localhost:3000',
      //   changeOrigin: true,
      // },
    },
  },
})
