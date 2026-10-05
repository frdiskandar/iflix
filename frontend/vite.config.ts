import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/upstream': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Watch-together: REST rooms + default video + WS room socket.
      // Same-origin /ws keeps localhost, 127.0.0.1, and LAN devices working.
      '/api/v1/rooms': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/default-video.mp4': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
