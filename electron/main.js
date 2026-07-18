import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fork, execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mapServer, win

app.setName('IRiSH AMR Simulator')
if (process.platform === 'linux') {
  app.setAppUserModelId('com.oscars03.amrsimdashboard')
} else if (process.platform === 'win32') {
  app.setAppUserModelId('IRiSH AMR Simulator')
}

function createWindow() {
  win = new BrowserWindow({
    title: 'IRiSH AMR Simulator',
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: path.join(__dirname, '../public/icon.png')
  })
  win.maximize()

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  //win.webContents.openDevTools()
}

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('restart-app', () => {
  if (!app.isPackaged) {
    console.log("Mocking restart...");
    app.relaunch();
    app.quit();
    return;
  }
  autoUpdater.quitAndInstall(false, true)
})

let devDownloadInterval = null;

ipcMain.handle('start-download', () => {
  if (!app.isPackaged) {
    if (devDownloadInterval) clearInterval(devDownloadInterval);
    let percent = 0;
    devDownloadInterval = setInterval(() => {
      percent += 2;
      if (percent >= 100) {
        clearInterval(devDownloadInterval);
        win?.webContents.send('update-status', { status: 'downloaded', version: '0.3.0', message: 'Update ready.' });
      } else {
        win?.webContents.send('update-status', {
          status: 'downloading',
          percent: percent,
          progress: percent,
          message: `Downloading update... ${percent}%`
        });
      }
    }, 100);
    return;
  }
  autoUpdater.downloadUpdate();
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    // Mock update flow: send checking, then send available (waits for start-download)
    win?.webContents.send('update-status', { status: 'checking', message: 'Checking for updates...' })
    setTimeout(() => {
      win?.webContents.send('update-status', { status: 'available', version: '0.3.0', message: 'New version v0.3.0 is available!' })
    }, 1000);
    return { status: 'dev', message: 'Auto-update is mocked in Development mode.' }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    return { status: 'checking', result }
  } catch (err) {
    win?.webContents.send('update-status', { status: 'error', message: err.message })
    return { status: 'error', message: err.message }
  }
})

function checkAutoUpdate() {
  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => {
    win?.webContents.send('update-status', { status: 'checking', message: 'Checking for updates...' })
  })

  autoUpdater.on('update-available', (info) => {
    win?.webContents.send('update-status', { status: 'available', version: info.version, message: `New version v${info.version} is available!` })
    // The front-end custom UI now displays a confirmation popup and calls start-download
  })

  autoUpdater.on('update-not-available', (info) => {
    win?.webContents.send('update-status', { status: 'not-available', message: 'App is up to date.' })
  })

  autoUpdater.on('error', (err) => {
    if (err.message.includes('404')) return;
    win?.webContents.send('update-status', { status: 'error', message: err.message })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.floor(progressObj?.percent || 0)
    win?.webContents.send('update-status', {
      status: 'downloading',
      percent: percent,
      progress: percent,
      message: `Downloading update... ${percent}%`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send('update-status', { status: 'downloaded', version: info.version, message: 'Update ready to install.' })
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'The update has been downloaded. Restart the app to apply the changes.',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true)
      }
    })
  })

  autoUpdater.checkForUpdatesAndNotify()
}

app.whenReady().then(() => {
  mapServer = fork(path.join(__dirname, '../map-server.cjs'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  createWindow()

  if (!app.isPackaged) {
    // Optionally skip updates in dev
  } else {
    checkAutoUpdate()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (mapServer) {
    mapServer.kill();
  }
  try {
    execSync('pkill -f map-server || true');
    execSync('pkill -f amr_sim_node || true');
    execSync('pkill -f rosbridge || true');
    execSync('pkill -f gz || true');
  } catch (e) {
    console.log("Cleanup background process finished");
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
})