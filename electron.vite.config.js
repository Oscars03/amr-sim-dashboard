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
      outDir: 'dist',            // ✅ THIS was missing!
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(__dirname, 'index.html')
      }
    },
    // ✅ เพิ่ม publicDir ชี้ไปที่ images folder
    publicDir: path.join(__dirname, 'public'),
    plugins: [react()]
  }
})