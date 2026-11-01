import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DB } from './db'
import { listGames, listSystems, listTags } from './db'
import { PLAY_STATUS_LABELS } from '@shared/types'

const MANIFEST_APP = 'GameVault'
const FORMAT = 1
const SAFE_IMAGE = /^images\/[A-Za-z0-9._-]+$/

/** Writes a .zip containing the database (collection, ratings, notes, categories) and every stored image. */
export async function createBackup(db: DB, dataDir: string, outPath: string): Promise<void> {
  const tmp = join(dataDir, `backup-${Date.now()}.db.tmp`)
  try {
    await db.backup(tmp)
    const zip = new AdmZip()
    const games = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n
    zip.addFile(
      'manifest.json',
      Buffer.from(JSON.stringify({ app: MANIFEST_APP, format: FORMAT, createdAt: new Date().toISOString(), games }, null, 2))
    )
    zip.addLocalFile(tmp, '', 'gamevault.db')
    const imagesDir = join(dataDir, 'images')
    if (existsSync(imagesDir)) {
      for (const f of readdirSync(imagesDir)) zip.addLocalFile(join(imagesDir, f), 'images')
    }
    const partial = `${outPath}.partial`
    await zip.writeZipPromise(partial)
    renameSync(partial, outPath)
  } finally {
    rmSync(tmp, { force: true })
  }
}

export interface BackupInfo {
  createdAt: string
  games: number
}

/** Validates a backup and extracts it into a staging folder. */
export function stageRestore(zipPath: string, stagingDir: string): BackupInfo {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new Error('This file is not a valid GameVault backup (could not open the zip).')
  }
  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) throw new Error('This file is not a GameVault backup (manifest missing).')
  let manifest: { app?: string; format?: number; createdAt?: string; games?: number }
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
  } catch {
    throw new Error('The backup manifest is damaged.')
  }
  if (manifest.app !== MANIFEST_APP) throw new Error('This file is not a GameVault backup.')
  if ((manifest.format ?? 0) > FORMAT) throw new Error('This backup was made by a newer version of GameVault. Please update the app first.')
  if (!zip.getEntry('gamevault.db')) throw new Error('The backup does not contain a collection database.')

  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(join(stagingDir, 'images'), { recursive: true })
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const name = e.entryName.replace(/\\/g, '/')
    if (name === 'gamevault.db') writeFileSync(join(stagingDir, 'gamevault.db'), e.getData())
    else if (SAFE_IMAGE.test(name)) writeFileSync(join(stagingDir, name), e.getData())
  }
  // Make sure the database opens and looks like ours.
  const check = new Database(join(stagingDir, 'gamevault.db'), { readonly: true })
  try {
    const ok = check.pragma('integrity_check', { simple: true })
    if (ok !== 'ok') throw new Error('The database inside the backup is damaged.')
    check.prepare('SELECT COUNT(*) FROM games').get()
  } catch (e) {
    throw new Error(`The backup database could not be read: ${(e as Error).message}`)
  } finally {
    check.close()
  }
  return { createdAt: manifest.createdAt ?? '', games: manifest.games ?? 0 }
}

/**
 * Swaps the staged backup into the live data folder. The caller must have closed the
 * database. On failure the previous data is put back.
 */
/** Windows can briefly lock files (antivirus, indexer, image cache); retry renames for a short while. */
function renameRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    }
  }
}

/**
 * Swaps the staged backup into the live data folder. The caller must have closed the
 * database. On failure everything that was moved is put back exactly as it was.
 */
export function swapInStaged(dataDir: string, stagingDir: string): void {
  const old = join(dataDir, `previous-${Date.now()}`)
  mkdirSync(old, { recursive: true })
  // Every completed move, so a failure can be undone in reverse order.
  const done: Array<[string, string]> = []
  const move = (from: string, to: string): void => {
    renameRetry(from, to)
    done.push([from, to])
  }
  try {
    for (const f of ['gamevault.db', 'gamevault.db-wal', 'gamevault.db-shm']) {
      if (existsSync(join(dataDir, f))) move(join(dataDir, f), join(old, f))
    }
    if (existsSync(join(dataDir, 'images'))) move(join(dataDir, 'images'), join(old, 'images'))
    move(join(stagingDir, 'gamevault.db'), join(dataDir, 'gamevault.db'))
    move(join(stagingDir, 'images'), join(dataDir, 'images'))
  } catch (e) {
    for (const [from, to] of done.reverse()) {
      try {
        renameRetry(to, from)
      } catch {
        /* best effort; the previous data is still in the previous-* folder */
      }
    }
    throw e
  }
  try {
    rmSync(old, { recursive: true, force: true })
    rmSync(stagingDir, { recursive: true, force: true })
  } catch {
    /* leftovers are harmless */
  }
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(db: DB): string {
  const systems = new Map(listSystems(db).map((s) => [s.id, s.name]))
  const genres = new Map(listTags(db, 'genres').map((t) => [t.id, t.name]))
  const cats = new Map(listTags(db, 'categories').map((t) => [t.id, t.name]))
  const header = [
    'Title', 'Systems', 'Formats', 'Stores', 'Genres', 'Categories', 'Play Status', 'Rating', 'Favorite',
    'Release Date', 'Developer', 'Publisher', 'Date Added', 'Steam App ID', 'Notes'
  ]
  const rows = listGames(db, 'ORDER BY title COLLATE NOCASE').map((g) => {
    const uniq = (xs: string[]): string => [...new Set(xs.filter(Boolean))].join('; ')
    return [
      g.title,
      uniq(g.copies.map((c) => systems.get(c.systemId) ?? '')),
      uniq(g.copies.map((c) => (c.format === 'physical' ? 'Physical' : 'Digital'))),
      uniq(g.copies.map((c) => c.store)),
      uniq(g.genreIds.map((id) => genres.get(id) ?? '')),
      uniq(g.categoryIds.map((id) => cats.get(id) ?? '')),
      PLAY_STATUS_LABELS[g.playStatus],
      g.rating ?? '',
      g.favorite ? 'Yes' : 'No',
      g.releaseDate,
      g.developer,
      g.publisher,
      g.dateAdded.slice(0, 10),
      g.steamAppId ?? '',
      g.notes
    ]
  })
  // Leading BOM so Excel detects UTF-8.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
