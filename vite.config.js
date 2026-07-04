import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { outDir: 'dist-electron', lib: { entry: 'electron/main.js' } }
  },
  preload: {
    build: { outDir: 'dist-electron', lib: { entry: 'electron/preload.js' } }
  },
  renderer: {
    plugins: [react()]
  }
})