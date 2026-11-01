import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BackupResult,
  Game,
  GameInput,
  GamePatch,
  GameSystem,
  ImportProgress,
  LaunchCheck,
  LaunchResult,
  Library,
  LookupResult,
  MetadataField,
  SteamConfig,
  SteamImportOptions,
  SteamOwnedGame,
  SystemKind,
  Tag
} from '@shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (e) {
    // Strip Electron's "Error invoking remote method 'x': Error:" prefix for friendlier messages.
    const msg = String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
    throw new Error(msg)
  }
}

const api = {
  getLibrary: () => call<Library>('library:get'),
  saveGame: (input: GameInput) => call<Game>('game:save', input),
  patchGame: (id: number, patch: GamePatch) => call<Game>('game:patch', id, patch),
  deleteGame: (id: number) => call<void>('game:delete', id),
  unlockField: (id: number, field: MetadataField) => call<Game>('game:unlock', id, field),

  createSystem: (name: string, kind: SystemKind) => call<GameSystem>('system:create', name, kind),
  updateSystem: (id: number, name: string, kind: SystemKind) => call<void>('system:update', id, name, kind),
  deleteSystem: (id: number) => call<void>('system:delete', id),
  systemUsage: (id: number) => call<number>('system:usage', id),
  createTag: (table: 'genres' | 'categories', name: string) => call<Tag>('tag:create', table, name),
  renameTag: (table: 'genres' | 'categories', id: number, name: string) => call<void>('tag:rename', table, id, name),
  deleteTag: (table: 'genres' | 'categories', id: number) => call<void>('tag:delete', table, id),
  tagUsage: (table: 'genres' | 'categories', id: number) => call<number>('tag:usage', table, id),
  removeSamples: () => call<number>('samples:remove'),

  pickImages: (multi: boolean) => call<string[]>('images:pick', multi),
  importImagePath: (path: string) => call<string>('images:importPath', path),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  pickLaunchFile: () => call<string | null>('dialog:pickLaunchFile'),
  pickFolder: (title: string) => call<string | null>('dialog:pickFolder', title),

  checkLaunch: (copyId: number) => call<LaunchCheck>('launch:check', copyId),
  launch: (copyId: number) => call<LaunchResult>('launch:run', copyId),
  steamInstall: (appId: number) => call<void>('launch:steamInstall', appId),

  searchDetails: (term: string) => call<Array<{ appId: number; name: string; thumb: string }>>('meta:search', term),
  lookupDetails: (appId: number) => call<LookupResult>('meta:details', appId),

  steamGetConfig: () => call<SteamConfig>('steam:getConfig'),
  steamSetConfig: (cfg: { apiKey?: string | null; steamId?: string; steamPath?: string | null }) => call<boolean>('steam:setConfig', cfg),
  steamOwned: () => call<SteamOwnedGame[]>('steam:owned'),
  steamInstalledLocal: () => call<SteamOwnedGame[]>('steam:installedLocal'),
  steamImport: (items: Array<{ appId: number; name: string; installed: boolean }>, opts: SteamImportOptions) => call<boolean>('steam:import', items, opts),
  steamRefresh: (gameIds: number[], opts: SteamImportOptions) => call<boolean>('steam:refresh', gameIds, opts),
  steamCancel: () => call<void>('steam:cancel'),
  steamUpdateInstalled: () => call<number>('steam:updateInstalled'),
  onSteamProgress: (fn: (p: ImportProgress) => void) => {
    const listener = (_e: unknown, p: ImportProgress): void => fn(p)
    ipcRenderer.on('steam:progress', listener)
    return (): void => {
      ipcRenderer.removeListener('steam:progress', listener)
    }
  },

  createBackup: () => call<BackupResult>('backup:create'),
  pickRestore: () => call<{ path: string; createdAt: string; games: number } | null>('backup:pickRestore'),
  restore: (path: string) => call<{ ok: boolean; message: string; safetyBackup: string }>('backup:restore', path),
  exportCsv: () => call<BackupResult>('export:csv'),
  openDataFolder: () => call<string>('app:openDataFolder'),
  openExternal: (url: string) => call<void>('app:openExternal', url),
  showInFolder: (path: string) => call<void>('app:showInFolder', path),
  version: () => call<string>('app:version'),

  onBeforeClose: (fn: () => Promise<void> | void) => {
    ipcRenderer.on('app:before-close', async () => {
      try {
        await fn()
      } finally {
        ipcRenderer.send('app:close-ready')
      }
    })
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
