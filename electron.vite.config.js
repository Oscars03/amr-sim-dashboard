import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/main.js'),
        output: { entryFileNames: 'main.js' }
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/preload.js'),
        output: { entryFileNames: 'preload.cjs', format: 'cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: path.join(__dirname, 'index.html')
      }
    },
    plugins: [react()]
  }
})
