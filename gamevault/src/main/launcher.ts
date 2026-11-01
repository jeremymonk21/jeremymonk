import { shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { dirname, extname } from 'path'
import type { GameCopy, LaunchCheck, LaunchResult } from '@shared/types'
import { detectSteamPath, installedSteamApps } from './steam'

const SHORTCUT_EXTS = ['.lnk', '.url', '.bat', '.cmd']

/** Splits a command-line argument string, honouring double quotes. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2])
  return out
}

async function steamState(appId: number | null, overridePath: string | null): Promise<{ steamPath: string | null; installed: boolean | null }> {
  const steamPath = overridePath && existsSync(overridePath) ? overridePath : await detectSteamPath()
  if (!steamPath || !appId) return { steamPath, installed: null }
  return { steamPath, installed: installedSteamApps(steamPath).has(appId) }
}

export async function checkCopy(copy: GameCopy, steamPathOverride: string | null): Promise<LaunchCheck> {
  const base = { copyId: copy.id }
  switch (copy.launchType) {
    case 'none':
      return { ...base, state: 'not_configured', message: 'No launch method configured.' }
    case 'steam': {
      if (!copy.steamAppId) return { ...base, state: 'not_configured', message: 'This copy has no Steam App ID.' }
      const { steamPath, installed } = await steamState(copy.steamAppId, steamPathOverride)
      if (!steamPath) return { ...base, state: 'steam_missing', message: 'The Steam client was not found on this PC.' }
      if (installed === false) return { ...base, state: 'not_installed', message: 'Steam reports this game is not installed.' }
      return { ...base, state: 'ready', message: 'Installed — launches through Steam.' }
    }
    case 'executable':
    case 'shortcut': {
      if (!copy.launchTarget) return { ...base, state: 'not_configured', message: 'No file selected.' }
      if (!existsSync(copy.launchTarget)) return { ...base, state: 'missing_file', message: `File not found: ${copy.launchTarget}` }
      if (copy.launchWorkDir && !existsSync(copy.launchWorkDir))
        return { ...base, state: 'missing_file', message: `Working directory not found: ${copy.launchWorkDir}` }
      return { ...base, state: 'ready', message: 'Installed — ready to launch.' }
    }
    default:
      return { ...base, state: 'unknown', message: 'Unknown launch method.' }
  }
}

export async function launchCopy(copy: GameCopy, steamPathOverride: string | null): Promise<LaunchResult> {
  const check = await checkCopy(copy, steamPathOverride)
  if (copy.launchType === 'steam') {
    if (check.state === 'steam_missing' || check.state === 'not_configured') return { ok: false, state: check.state, message: check.message }
    if (check.state === 'not_installed')
      return { ok: false, state: 'not_installed', message: 'Steam reports this game is not installed. You can install it from Steam.' }
    try {
      await shell.openExternal(`steam://rungameid/${copy.steamAppId}`)
      return { ok: true, state: 'ready', message: 'Launching through Steam…' }
    } catch (e) {
      return { ok: false, state: 'error', message: `Steam could not be opened: ${(e as Error).message}` }
    }
  }
  if (check.state !== 'ready') return { ok: false, state: check.state, message: check.message }

  const target = copy.launchTarget
  const ext = extname(target).toLowerCase()
  try {
    if (statSync(target).isDirectory()) return { ok: false, state: 'error', message: 'The launch path is a folder, not a program or shortcut.' }
    if (copy.launchType === 'shortcut' || SHORTCUT_EXTS.includes(ext)) {
      // Windows shortcuts (.lnk/.url) are opened by the shell, exactly like double-clicking them.
      if (copy.launchArgs.trim() && ext !== '.lnk' && ext !== '.url') {
        return spawnDetached(target, splitArgs(copy.launchArgs), copy.launchWorkDir || dirname(target))
      }
      const err = await shell.openPath(target)
      if (err) return { ok: false, state: 'error', message: `Windows could not open the shortcut: ${err}` }
      return { ok: true, state: 'ready', message: 'Launching…' }
    }
    return spawnDetached(target, splitArgs(copy.launchArgs), copy.launchWorkDir || dirname(target))
  } catch (e) {
    return { ok: false, state: 'error', message: `Could not start the game: ${(e as Error).message}` }
  }
}

function spawnDetached(file: string, args: string[], cwd: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    let settled = false
    try {
      const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: /\.(bat|cmd)$/i.test(file) })
      child.once('error', (e) => {
        if (settled) return
        settled = true
        resolve({ ok: false, state: 'error', message: `Could not start the game: ${e.message}` })
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        child.unref()
        resolve({ ok: true, state: 'ready', message: 'Launching…' })
      })
    } catch (e) {
      resolve({ ok: false, state: 'error', message: `Could not start the game: ${(e as Error).message}` })
    }
  })
}

export async function openSteamInstall(appId: number): Promise<void> {
  await shell.openExternal(`steam://install/${appId}`)
}
