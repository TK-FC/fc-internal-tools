import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// Note: `base` is set via CLI flag in package.json build/preview scripts.
// Vite 8 wasn't honouring base from this file — leaving a note here so we don't lose track.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
})