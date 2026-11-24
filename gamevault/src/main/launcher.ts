import { shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { dirname, extname } from 'path'
import type { Emulator, GameCopy, LaunchCheck, LaunchResult } from '@shared/types'
import { detectSteamPath, installedSteamApps } from './steam'

const SHORTCUT_EXTS = ['.lnk', '.url', '.bat', '.cmd']

/** Called when a tracked game process exits, with the moment it started. */
export type OnExit = (startedAt: number) => void

export interface LaunchContext {
  steamPathOverride: string | null
  /** The emulator setup for an 'emulator' copy. */
  emulator?: Emulator | null
  /** Receives the session when the game's process (or Steam's running game) ends. */
  onExit?: OnExit
}

/** Splits a command-line argument string, honouring double quotes. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2])
  return out
}

/** Emulator command-line arguments with {file} replaced by the game file. Each token stays one argument. */
export function emulatorArgs(template: string, file: string): string[] {
  const tokens = splitArgs(template || '"{file}"')
  const out = tokens.map((t) => t.split('{file}').join(file))
  if (!tokens.some((t) => t.includes('{file}'))) out.push(file)
  return out
}

async function steamState(appId: number | null, overridePath: string | null): Promise<{ steamPath: string | null; installed: boolean | null }> {
  const steamPath = overridePath && existsSync(overridePath) ? overridePath : await detectSteamPath()
  if (!steamPath || !appId) return { steamPath, installed: null }
  return { steamPath, installed: installedSteamApps(steamPath).has(appId) }
}

function biosMissing(em: Emulator): boolean {
  if (!em.biosFolder) return false
  try {
    return !existsSync(em.biosFolder) || readdirSync(em.biosFolder).filter((f) => !f.startsWith('.')).length === 0
  } catch {
    return true
  }
}

export async function checkCopy(copy: GameCopy, ctx: LaunchContext): Promise<LaunchCheck> {
  const base = { copyId: copy.id }
  switch (copy.launchType) {
    case 'none':
      return { ...base, state: 'not_configured', message: 'No launch method configured.' }
    case 'steam': {
      if (!copy.steamAppId) return { ...base, state: 'not_configured', message: 'This copy has no Steam App ID.' }
      const { steamPath, installed } = await steamState(copy.steamAppId, ctx.steamPathOverride)
      if (!steamPath) return { ...base, state: 'steam_missing', message: 'The Steam client was not found on this PC.' }
      if (installed === false) return { ...base, state: 'not_installed', message: 'Steam reports this game is not installed.' }
      return { ...base, state: 'ready', message: 'Installed — launches through Steam.' }
    }
    case 'emulator': {
      const em = ctx.emulator
      if (!em) return { ...base, state: 'not_configured', message: 'The emulator for this copy has been removed. Choose another in Edit launch.' }
      if (!em.exePath) return { ...base, state: 'not_configured', message: `${em.name} has no program selected. Set it in Settings → Emulators.` }
      if (!existsSync(em.exePath)) return { ...base, state: 'missing_file', message: `${em.name} was not found at ${em.exePath}` }
      if (!copy.launchTarget) return { ...base, state: 'not_configured', message: 'No game file selected.' }
      if (!existsSync(copy.launchTarget)) return { ...base, state: 'missing_file', message: `Game file not found: ${copy.launchTarget}` }
      if (biosMissing(em)) return { ...base, state: 'ready', message: `Ready — but ${em.name}'s BIOS folder looks empty, so the game may not start.` }
      return { ...base, state: 'ready', message: `Ready — opens in ${em.name}.` }
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

export async function launchCopy(copy: GameCopy, ctx: LaunchContext): Promise<LaunchResult> {
  const check = await checkCopy(copy, ctx)
  if (copy.launchType === 'steam') {
    if (check.state === 'steam_missing' || check.state === 'not_configured') return { ok: false, state: check.state, message: check.message }
    if (check.state === 'not_installed')
      return { ok: false, state: 'not_installed', message: 'Steam reports this game is not installed. You can install it from Steam.' }
    try {
      await shell.openExternal(`steam://rungameid/${copy.steamAppId}`)
      if (ctx.onExit && copy.steamAppId) watchSteamGame(copy.steamAppId, ctx.onExit)
      return { ok: true, state: 'ready', message: 'Launching through Steam…' }
    } catch (e) {
      return { ok: false, state: 'error', message: `Steam could not be opened: ${(e as Error).message}` }
    }
  }
  if (check.state !== 'ready') return { ok: false, state: check.state, message: check.message }

  if (copy.launchType === 'emulator' && ctx.emulator) {
    const em = ctx.emulator
    return spawnDetached(em.exePath, emulatorArgs(em.args, copy.launchTarget), dirname(em.exePath), ctx.onExit)
  }

  const target = copy.launchTarget
  const ext = extname(target).toLowerCase()
  try {
    if (statSync(target).isDirectory()) return { ok: false, state: 'error', message: 'The launch path is a folder, not a program or shortcut.' }
    if (ext === '.lnk' && process.platform === 'win32') {
      // Run the shortcut's own target so the game's process can be timed; fall back to the shell.
      try {
        const link = shell.readShortcutLink(target)
        if (link.target && existsSync(link.target) && /\.exe$/i.test(link.target)) {
          const args = [...splitArgs(link.args ?? ''), ...splitArgs(copy.launchArgs)]
          return spawnDetached(link.target, args, copy.launchWorkDir || link.cwd || dirname(link.target), ctx.onExit)
        }
      } catch {
        /* fall through */
      }
    }
    if (copy.launchType === 'shortcut' || SHORTCUT_EXTS.includes(ext)) {
      // Windows shortcuts (.lnk/.url) are opened by the shell, exactly like double-clicking them.
      if (copy.launchArgs.trim() && ext !== '.lnk' && ext !== '.url') {
        return spawnDetached(target, splitArgs(copy.launchArgs), copy.launchWorkDir || dirname(target), ctx.onExit)
      }
      const err = await shell.openPath(target)
      if (err) return { ok: false, state: 'error', message: `Windows could not open the shortcut: ${err}` }
      return { ok: true, state: 'ready', message: 'Launching…' }
    }
    return spawnDetached(target, splitArgs(copy.launchArgs), copy.launchWorkDir || dirname(target), ctx.onExit)
  } catch (e) {
    return { ok: false, state: 'error', message: `Could not start the game: ${(e as Error).message}` }
  }
}

function spawnDetached(file: string, args: string[], cwd: string, onExit?: OnExit): Promise<LaunchResult> {
  return new Promise((resolve) => {
    let settled = false
    try {
      // Batch files must run through cmd.exe; quote the path and arguments ourselves because
      // Node does not quote them when `shell` is enabled (paths like "C:\Program Files\..." would break).
      const useShell = /\.(bat|cmd)$/i.test(file)
      const q = (s: string): string => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
      const child = useShell
        ? spawn(q(file), args.map(q), { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: true })
        : spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
      const started = Date.now()
      child.once('error', (e) => {
        if (settled) return
        settled = true
        resolve({ ok: false, state: 'error', message: `Could not start the game: ${e.message}` })
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        if (onExit) child.once('exit', () => onExit(started))
        child.unref()
        resolve({ ok: true, state: 'ready', message: 'Launching…' })
      })
    } catch (e) {
      resolve({ ok: false, state: 'error', message: `Could not start the game: ${(e as Error).message}` })
    }
  })
}

/**
 * Steam starts the game itself, so GameVault watches Steam's "RunningAppID" registry value:
 * it switches to the game's App ID while it runs and back to 0 when it closes.
 */
function readRunningAppId(): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(null)
      const m = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out)
      resolve(m ? parseInt(m[1], 16) : null)
    })
  })
}

const watching = new Set<number>()
function watchSteamGame(appId: number, onExit: OnExit): void {
  if (process.platform !== 'win32' || watching.has(appId)) return
  watching.add(appId)
  let started: number | null = null
  const deadline = Date.now() + 5 * 60 * 1000 // give Steam up to 5 minutes to start the game (updates etc.)
  const tick = async (): Promise<void> => {
    const running = await readRunningAppId()
    if (started == null) {
      if (running === appId) started = Date.now()
      else if (Date.now() > deadline || running === null) return void watching.delete(appId)
    } else if (running !== appId) {
      watching.delete(appId)
      onExit(started)
      return
    }
    setTimeout(tick, 10000)
  }
  setTimeout(tick, 5000)
}

export async function openSteamInstall(appId: number): Promise<void> {
  await shell.openExternal(`steam://install/${appId}`)
}
