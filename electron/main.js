import { app, BrowserWindow } from 'electron'
import { fork } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mapServer, win

function createWindow() {
  win = new BrowserWindow({
  width: 1400,
  height: 900,
  minWidth: 1000,
  minHeight: 700,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs')
  }
})
win.maximize()

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  mapServer = fork(path.join(__dirname, '../map-server.cjs'), [], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  mapServer?.kill()
  if (process.platform !== 'darwin') app.quit()
})