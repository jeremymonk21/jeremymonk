import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import * as db from './db'
import { cleanupImages, downloadImage, importImageFile, initImages, resolveImage, IMAGE_EXTENSIONS } from './images'
import { artworkUrls, detectSteamPath, getOwnedGames, getStoreDetails, installedSteamApps, resolveSteamId, SteamError } from './steam'
import { checkCopy, launchCopy, openSteamInstall } from './launcher'
import { buildCsv, createBackup, stageRestore, swapInStaged } from './backup'
import { removeSampleTags, seedSamplesIfFirstRun } from './samples'
import { getSecret, initSecrets, setSecret } from './secrets'
import type {
  GameInput,
  GamePatch,
  ImportProgress,
  Library,
  MetadataField,
  SteamConfig,
  SteamImportOptions,
  SteamOwnedGame,
  SystemKind
} from '@shared/types'

protocol.registerSchemesAsPrivileged([{ scheme: 'gvimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const DATA_DIR = process.env.GAMEVAULT_DATA_DIR || join(app.getPath('userData'), 'data')
mkdirSync(DATA_DIR, { recursive: true })

let database: db.DB
let win: BrowserWindow | null = null
let closeReady = false

function openDb(): void {
  database = db.openDatabase(DATA_DIR)
}

function library(): Library {
  return {
    games: db.listGames(database),
    systems: db.listSystems(database),
    genres: db.listTags(database, 'genres'),
    categories: db.listTags(database, 'categories'),
    dataDir: DATA_DIR,
    hasSamples: db.hasSamples(database)
  }
}

function steamPathOverride(): string | null {
  return db.getSetting(database, 'steam_path')
}

async function effectiveSteamPath(): Promise<string | null> {
  const o = steamPathOverride()
  if (o && existsSync(o)) return o
  return detectSteamPath()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e1016',
    title: 'GameVault',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })
  // Ask the renderer to flush unsaved notes before the window closes.
  win.on('close', (e) => {
    if (closeReady || !win) return
    e.preventDefault()
    win.webContents.send('app:before-close')
    setTimeout(() => {
      closeReady = true
      win?.close()
    }, 3000)
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------------- IPC ----------------

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...args))
}

function registerIpc(): void {
  ipcMain.on('app:close-ready', () => {
    closeReady = true
    win?.close()
  })

  handle('library:get', () => library())
  handle('game:save', (input: GameInput) => {
    try {
      return db.saveGame(database, input)
    } catch (e) {
      if (/UNIQUE constraint failed: games.steam_app_id/.test((e as Error).message))
        throw new Error('Another game in your collection already uses this Steam App ID.')
      throw e
    }
  })
  handle('game:patch', (id: number, patch: GamePatch) => db.patchGame(database, id, patch))
  handle('game:delete', (id: number) => db.deleteGame(database, id))
  handle('game:unlock', (id: number, field: MetadataField) => db.unlockField(database, id, field))

  handle('system:create', (name: string, kind: SystemKind) => db.createSystem(database, name, kind))
  handle('system:update', (id: number, name: string, kind: SystemKind) => db.updateSystem(database, id, name, kind))
  handle('system:delete', (id: number) => db.deleteSystem(database, id))
  handle('system:usage', (id: number) => db.systemUsage(database, id))
  handle('tag:create', (table: 'genres' | 'categories', name: string) => db.createTag(database, checkTable(table), name))
  handle('tag:rename', (table: 'genres' | 'categories', id: number, name: string) => db.renameTag(database, checkTable(table), id, name))
  handle('tag:delete', (table: 'genres' | 'categories', id: number) => db.deleteTag(database, checkTable(table), id))
  handle('tag:usage', (table: 'genres' | 'categories', id: number) => db.tagUsage(database, checkTable(table), id))

  handle('samples:remove', () => {
    const n = db.removeSamples(database)
    removeSampleTags(database)
    return n
  })

  handle('images:pick', async (multi: boolean) => {
    const r = await dialog.showOpenDialog(win!, {
      title: multi ? 'Choose images' : 'Choose box art',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    })
    if (r.canceled) return []
    return r.filePaths.map((p) => importImageFile(p))
  })
  handle('images:importPath', (p: string) => importImageFile(p))

  handle('dialog:pickLaunchFile', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose the game program or shortcut',
      properties: ['openFile'],
      filters: [
        { name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('dialog:pickFolder', async (title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  handle('launch:check', async (copyId: number) => {
    const copy = findCopy(copyId)
    return checkCopy(copy, steamPathOverride())
  })
  handle('launch:run', async (copyId: number) => launchCopy(findCopy(copyId), steamPathOverride()))
  handle('launch:steamInstall', (appId: number) => openSteamInstall(appId))

  // ---- Steam ----
  handle('steam:getConfig', async (): Promise<SteamConfig> => ({
    hasApiKey: !!getSecret('steam_api_key'),
    steamId: db.getSetting(database, 'steam_id') ?? '',
    steamPath: steamPathOverride(),
    autoDetectedSteamPath: await detectSteamPath()
  }))
  handle('steam:setConfig', async (cfg: { apiKey?: string | null; steamId?: string; steamPath?: string | null }) => {
    if (cfg.apiKey !== undefined) setSecret('steam_api_key', cfg.apiKey ? cfg.apiKey.trim() : null)
    if (cfg.steamPath !== undefined) db.setSetting(database, 'steam_path', cfg.steamPath || null)
    if (cfg.steamId !== undefined) {
      const input = cfg.steamId.trim()
      if (!input) db.setSetting(database, 'steam_id', null)
      else {
        const key = getSecret('steam_api_key')
        const id = /^\d{17}$/.test(input) || /profiles\/\d{17}/.test(input) || !key ? input : await resolveSteamId(key, input)
        db.setSetting(database, 'steam_id', /profiles\/(\d{17})/.exec(id)?.[1] ?? id)
      }
    }
    return true
  })
  handle('steam:owned', async (): Promise<SteamOwnedGame[]> => {
    const key = getSecret('steam_api_key')
    if (!key) throw new SteamError('Add your Steam Web API key in Settings → Steam first.', 'auth')
    const idInput = db.getSetting(database, 'steam_id')
    if (!idInput) throw new SteamError('Add your SteamID64 or profile URL in Settings → Steam first.', 'bad_input')
    const steamId = await resolveSteamId(key, idInput)
    const owned = await getOwnedGames(key, steamId)
    const installed = installedSteamApps(await effectiveSteamPath())
    return owned
      .map((g) => ({
        appId: g.appid,
        name: g.name || `Steam app ${g.appid}`,
        playtimeMinutes: g.playtime_forever ?? 0,
        installed: installed.has(g.appid),
        existingGameId: db.getGameBySteamId(database, g.appid)?.id ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  handle('steam:installedLocal', async (): Promise<SteamOwnedGame[]> => {
    const path = await effectiveSteamPath()
    if (!path) throw new SteamError('The Steam client was not found on this PC. You can set its folder in Settings → Steam.', 'not_found')
    return [...installedSteamApps(path).values()]
      .map((a) => ({ appId: a.appId, name: a.name || `Steam app ${a.appId}`, playtimeMinutes: 0, installed: true, existingGameId: db.getGameBySteamId(database, a.appId)?.id ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  handle('steam:import', (items: Array<{ appId: number; name: string; installed: boolean }>, opts: SteamImportOptions) => {
    if (importRunning) throw new Error('An import is already running.')
    runImport(items, opts, false)
    return true
  })
  handle('steam:refresh', (gameIds: number[], opts: SteamImportOptions) => {
    if (importRunning) throw new Error('An import is already running.')
    const items = gameIds
      .map((id) => db.getGame(database, id))
      .filter((g): g is NonNullable<typeof g> => !!g && !!g.steamAppId)
      .map((g) => ({ appId: g.steamAppId as number, name: g.title, installed: false }))
    if (!items.length) throw new Error('None of the selected games are linked to Steam.')
    runImport(items, opts, true)
    return true
  })
  handle('steam:cancel', () => {
    importCancelled = true
  })
  handle('steam:updateInstalled', async () => {
    const installed = installedSteamApps(await effectiveSteamPath())
    let n = 0
    for (const appId of installed.keys()) {
      const g = db.getGameBySteamId(database, appId)
      if (g) {
        const before = g.copies.find((c) => c.steamAppId === appId)?.launchType
        db.ensureSteamCopy(database, g.id, appId, true)
        if (before !== 'steam') n++
      }
    }
    return n
  })

  // ---- backup / export ----
  handle('backup:create', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Save GameVault backup',
      defaultPath: join(app.getPath('documents'), `GameVault-backup-${stamp}.zip`),
      filters: [{ name: 'GameVault backup', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true, message: 'Cancelled' }
    await createBackup(database, DATA_DIR, r.filePath)
    return { ok: true, path: r.filePath, message: 'Backup saved.' }
  })
  handle('backup:pickRestore', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a GameVault backup',
      properties: ['openFile'],
      filters: [{ name: 'GameVault backup', extensions: ['zip'] }]
    })
    if (r.canceled) return null
    const staging = join(DATA_DIR, 'restore-staging')
    const info = stageRestore(r.filePaths[0], staging)
    return { path: r.filePaths[0], ...info }
  })
  handle('backup:restore', async (zipPath: string) => restoreFrom(zipPath))
  handle('export:csv', async () => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export collection as CSV',
      defaultPath: join(app.getPath('documents'), 'GameVault-collection.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true, message: 'Cancelled' }
    writeFileSync(r.filePath, buildCsv(database), 'utf8')
    return { ok: true, path: r.filePath, message: 'CSV exported.' }
  })
  handle('app:openDataFolder', () => shell.openPath(DATA_DIR))
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })
  handle('app:showInFolder', (p: string) => shell.showItemInFolder(p))
  handle('app:version', () => app.getVersion())
}

function checkTable(t: string): 'genres' | 'categories' {
  if (t !== 'genres' && t !== 'categories') throw new Error('Invalid table')
  return t
}

function findCopy(copyId: number) {
  const row = database.prepare('SELECT game_id FROM copies WHERE id = ?').get(copyId) as { game_id: number } | undefined
  const copy = row ? db.getGame(database, row.game_id)?.copies.find((c) => c.id === copyId) : undefined
  if (!copy) throw new Error('This copy no longer exists.')
  return copy
}

async function restoreFrom(zipPath: string): Promise<{ ok: boolean; message: string; safetyBackup: string }> {
  if (importRunning) throw new Error('A Steam import is running. Stop it or wait for it to finish, then restore.')
  const staging = join(DATA_DIR, 'restore-staging')
  stageRestore(zipPath, staging)
  // Safety net: back up the current collection first.
  const safetyDir = join(DATA_DIR, 'backups')
  mkdirSync(safetyDir, { recursive: true })
  const safety = join(safetyDir, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`)
  await createBackup(database, DATA_DIR, safety)
  database.close()
  try {
    swapInStaged(DATA_DIR, staging)
  } finally {
    openDb()
  }
  return { ok: true, message: 'Backup restored.', safetyBackup: safety }
}

// ---------------- Steam import job ----------------

let importRunning = false
let importCancelled = false

function sendProgress(p: ImportProgress): void {
  win?.webContents.send('steam:progress', p)
}

async function fetchCover(appId: number, headerImage?: string): Promise<{ file: string; portrait: boolean } | null> {
  for (const url of artworkUrls(appId, headerImage)) {
    const f = await downloadImage(url)
    if (f) return { file: f, portrait: url.includes('library_600x900') }
  }
  return null
}

async function runImport(items: Array<{ appId: number; name: string; installed: boolean }>, opts: SteamImportOptions, refresh: boolean): Promise<void> {
  importRunning = true
  importCancelled = false
  const p: ImportProgress = { done: 0, total: items.length, current: '', phase: 'importing', added: 0, updated: 0, errors: [] }
  sendProgress(p)
  try {
    for (const item of items) {
      if (importCancelled) break
      p.current = item.name
      sendProgress(p)
      try {
        let game = db.getGameBySteamId(database, item.appId)
        if (game) {
          db.ensureSteamCopy(database, game.id, item.appId, item.installed)
          p.updated++
        } else {
          game = db.insertSteamGame(database, item.appId, item.name, item.installed)
          p.added++
        }
        let headerImage: string | undefined
        if (opts.fetchMetadata) {
          let details = null
          try {
            details = await getStoreDetails(item.appId)
          } catch (e) {
            if (e instanceof SteamError && e.code === 'rate_limited') {
              p.current = `${item.name} (Steam asked us to slow down — waiting 60s)`
              sendProgress(p)
              await new Promise((r) => setTimeout(r, 60000))
              details = await getStoreDetails(item.appId).catch(() => null)
            } else throw e
          }
          if (details) {
            headerImage = details.headerImage
            db.applyExternalMetadata(database, game.id, {
              // Keep the library name for titles on first import unless the store has one.
              title: details.title || undefined,
              description: details.description,
              developer: details.developer,
              publisher: details.publisher,
              releaseDate: details.releaseDate,
              genres: details.genres
            })
          }
        }
        const fresh = db.getGame(database, game.id)
        if (opts.downloadArtwork && fresh && !fresh.lockedFields.includes('cover') && (refresh || !fresh.coverFile)) {
          const cover = await fetchCover(item.appId, headerImage)
          if (cover) {
            db.applyExternalMetadata(database, game.id, { coverFile: cover.file })
            // Landscape fallback art (header images) looks best letterboxed rather than cropped.
            database.prepare('UPDATE games SET cover_fit = ?, cover_pos_x = 50, cover_pos_y = 50, cover_zoom = 1 WHERE id = ?').run(cover.portrait ? 'cover' : 'contain', game.id)
          } else if (!fresh.coverFile) {
            p.errors.push(`${item.name}: no artwork available (you can upload your own).`)
          }
        }
      } catch (e) {
        p.errors.push(`${item.name}: ${(e as Error).message}`)
      }
      p.done++
      sendProgress(p)
    }
    p.phase = importCancelled ? 'cancelled' : 'finished'
    p.current = ''
    sendProgress(p)
  } catch (e) {
    p.phase = 'error'
    p.errors.push((e as Error).message)
    sendProgress(p)
  } finally {
    importRunning = false
  }
}

// ---------------- lifecycle ----------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.gamevault.desktop')
    initImages(DATA_DIR)
    initSecrets(DATA_DIR)
    try {
      openDb()
    } catch (e) {
      dialog.showErrorBox(
        'GameVault could not open its database',
        `${(e as Error).message}\n\nData folder: ${DATA_DIR}\n\nYou can restore a backup by moving the damaged gamevault.db out of that folder and restarting, then using Settings → Restore.`
      )
      app.quit()
      return
    }
    if (process.env.GAMEVAULT_NO_SAMPLES !== '1') seedSamplesIfFirstRun(database)
    else db.setSetting(database, 'samples_seeded', '1')

    protocol.handle('gvimg', (req) => {
      const file = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''))
      const full = resolveImage(file)
      if (!full || !existsSync(full)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(full).toString())
    })

    registerIpc()
    createWindow()
    // Housekeeping: remove image files no longer used by any game.
    setTimeout(() => {
      try {
        cleanupImages(db.referencedImages(database))
      } catch {
        /* non-critical */
      }
    }, 10000)
  })

  app.on('window-all-closed', () => {
    try {
      database?.close()
    } catch {
      /* ignore */
    }
    app.quit()
  })
}
