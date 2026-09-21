import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, type WebContents } from 'electron'

const rendererUrl = process.env.ELECTRON_RENDERER_URL

function isAllowedNavigation(url: string): boolean {
  if (rendererUrl) {
    return url.startsWith(`${rendererUrl}/`) || url === rendererUrl
  }

  return url === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

function installNavigationGuards(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
    }
  })

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function createMainWindow(): BrowserWindow {
  const iconPath = join(app.getAppPath(), 'public/icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  installNavigationGuards(window.webContents)
  window.once('ready-to-show', () => window.show())

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

export * from './window-lifecycle'
export * from './single-instance'
