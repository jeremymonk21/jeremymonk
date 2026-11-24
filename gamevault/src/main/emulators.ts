import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { Emulator, ScanCandidate } from '@shared/types'
import { titleFromFileName } from '@shared/emulators'

export interface EmulatorStatus {
  id: number
  exeFound: boolean
  folderFound: boolean
  biosOk: boolean | null
}

export function emulatorStatus(e: Emulator): EmulatorStatus {
  let biosOk: boolean | null = null
  if (e.biosFolder) {
    try {
      biosOk = existsSync(e.biosFolder) && readdirSync(e.biosFolder).some((f) => !f.startsWith('.'))
    } catch {
      biosOk = false
    }
  }
  return { id: e.id, exeFound: !!e.exePath && existsSync(e.exePath), folderFound: !!e.gamesFolder && existsSync(e.gamesFolder), biosOk }
}

function extList(e: Emulator): string[] {
  return e.extensions
    .split(/[,\s]+/)
    .map((x) => x.replace(/^\./, '').toLowerCase())
    .filter(Boolean)
}

/** Lists game files in the emulator's folder (and one level of sub-folders) that aren't in the collection yet. */
export function scanEmulatorFolder(e: Emulator, known: Set<string>): ScanCandidate[] {
  if (!e.gamesFolder || !existsSync(e.gamesFolder)) throw new Error(`The games folder for ${e.name} was not found: ${e.gamesFolder || '(not set)'}`)
  const exts = extList(e)
  if (!exts.length) throw new Error(`Set the file types for ${e.name} (for example: chd, cue, iso).`)
  const files: string[] = []
  const walk = (dir: string, depth: number): void => {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < 2) walk(full, depth + 1)
      } else if (exts.includes(extname(name).slice(1).toLowerCase())) files.push(full)
    }
  }
  walk(e.gamesFolder, 0)

  // Files referenced by playlists (.m3u) or cue sheets (.cue) are parts of another entry, not games of their own.
  const covered = new Set<string>()
  for (const f of files) {
    const ext = extname(f).toLowerCase()
    if (ext !== '.m3u' && ext !== '.cue') continue
    try {
      const text = readFileSync(f, 'utf8')
      const refs = ext === '.m3u' ? text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [...text.matchAll(/FILE\s+"([^"]+)"/gi)].map((m) => m[1])
      for (const r of refs) covered.add(join(dirname(f), r).toLowerCase())
    } catch {
      /* unreadable playlist: ignore */
    }
  }
  return files
    .filter((f) => !covered.has(f.toLowerCase()) && !known.has(f.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({ file: f, fileName: basename(f), guessedTitle: titleFromFileName(basename(f)), emulatorId: e.id, systemId: e.systemId }))
}
