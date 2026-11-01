/**
 * Steam integration.
 *
 * Supported, documented mechanisms used here:
 *  - Steam Web API (api.steampowered.com) with a personal Web API key from
 *    https://steamcommunity.com/dev/apikey:
 *      IPlayerService/GetOwnedGames/v1 — the owned library (appid, name, playtime)
 *      ISteamUser/ResolveVanityURL/v1  — custom profile URL -> SteamID64
 *    The profile's "Game details" privacy setting must be Public for GetOwnedGames
 *    to return games (a private profile returns an empty response).
 *  - Steam Store appdetails endpoint (store.steampowered.com/api/appdetails) for
 *    description, developer, publisher, release date and genres. It needs no key
 *    but is rate-limited, so requests are spaced out.
 *  - Steam CDN artwork (library_600x900 portrait capsule, header image fallback).
 *  - Local Steam install files (libraryfolders.vdf / appmanifest_<appid>.acf) to
 *    detect which games are actually installed on this PC — no network needed.
 *  - The steam:// URL protocol (steam://rungameid/<appid>) to launch games via the
 *    Steam client, which is Valve's supported way for third-party launchers.
 *
 * The user's Steam password is never requested or stored.
 */
import { net } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseLooseDate } from '@shared/filter'

const API_BASE = process.env.GAMEVAULT_STEAM_API_BASE || 'https://api.steampowered.com'
const STORE_BASE = process.env.GAMEVAULT_STEAM_STORE_BASE || 'https://store.steampowered.com'
const CDN_BASES = process.env.GAMEVAULT_STEAM_CDN_BASE
  ? [process.env.GAMEVAULT_STEAM_CDN_BASE]
  : ['https://shared.akamai.steamstatic.com/store_item_assets/steam/apps', 'https://cdn.cloudflare.steamstatic.com/steam/apps']

export class SteamError extends Error {
  constructor(
    message: string,
    public code: 'auth' | 'private' | 'not_found' | 'network' | 'rate_limited' | 'bad_input'
  ) {
    super(message)
  }
}

async function getJson(url: string, timeoutMs = 20000): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await net.fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    throw new SteamError(`Could not reach Steam. Check your internet connection. (${(e as Error).message})`, 'network')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 || res.status === 403) throw new SteamError('Steam rejected the Web API key. Check that the key is correct and active.', 'auth')
  if (res.status === 429) throw new SteamError('Steam is rate-limiting requests. Wait a few minutes and try again.', 'rate_limited')
  if (!res.ok) throw new SteamError(`Steam returned an error (HTTP ${res.status}).`, 'network')
  try {
    return await res.json()
  } catch {
    throw new SteamError('Steam returned an unexpected response.', 'network')
  }
}

/** Accepts a SteamID64, a profile URL (/profiles/<id> or /id/<vanity>) or a bare vanity name. */
export async function resolveSteamId(apiKey: string, input: string): Promise<string> {
  const s = input.trim()
  if (!s) throw new SteamError('Enter your SteamID64 or profile URL.', 'bad_input')
  const profiles = /profiles\/(\d{17})/.exec(s)
  if (profiles) return profiles[1]
  if (/^\d{17}$/.test(s)) return s
  const vanity = /\/id\/([^/?#]+)/.exec(s)?.[1] ?? (/^[A-Za-z0-9_-]{2,32}$/.test(s) ? s : null)
  if (!vanity) throw new SteamError('That does not look like a SteamID64 or Steam profile URL.', 'bad_input')
  const data = (await getJson(`${API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`)) as {
    response?: { success?: number; steamid?: string }
  }
  if (data.response?.success === 1 && data.response.steamid) return data.response.steamid
  throw new SteamError(`No Steam profile found for "${vanity}".`, 'not_found')
}

export interface OwnedGame {
  appid: number
  name: string
  playtime_forever?: number
}

export async function getOwnedGames(apiKey: string, steamId: string): Promise<OwnedGame[]> {
  if (!apiKey) throw new SteamError('Add your Steam Web API key in Settings first.', 'auth')
  const url =
    `${API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}` +
    `&include_appinfo=1&include_played_free_games=1&format=json`
  const data = (await getJson(url, 45000)) as { response?: { game_count?: number; games?: OwnedGame[] } }
  const resp = data.response
  if (!resp || (resp.game_count === undefined && !resp.games)) {
    throw new SteamError(
      'Steam returned no library data. This usually means the profile\'s "Game details" privacy setting is not Public. ' +
        'In Steam: Profile → Edit Profile → Privacy Settings → set "Game details" to Public, then try again.',
      'private'
    )
  }
  return (resp.games ?? []).filter((g) => Number.isInteger(g.appid))
}

export interface StoreDetails {
  title?: string
  description?: string
  developer?: string
  publisher?: string
  releaseDate?: string
  genres?: string[]
  headerImage?: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

let lastStoreCall = 0
const STORE_SPACING_MS = Number(process.env.GAMEVAULT_STORE_SPACING_MS ?? 1600)

/** Store metadata for one app. Returns null when Steam has no store page (delisted, tools, etc.). */
export async function getStoreDetails(appId: number): Promise<StoreDetails | null> {
  const wait = lastStoreCall + STORE_SPACING_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastStoreCall = Date.now()
  const data = (await getJson(`${STORE_BASE}/api/appdetails?appids=${appId}&l=english`)) as Record<
    string,
    { success: boolean; data?: Record<string, unknown> }
  > | null
  const entry = data?.[String(appId)]
  if (!entry?.success || !entry.data) return null
  const d = entry.data as {
    name?: string
    short_description?: string
    about_the_game?: string
    developers?: string[]
    publishers?: string[]
    release_date?: { date?: string; coming_soon?: boolean }
    genres?: Array<{ description: string }>
    header_image?: string
  }
  const desc = d.short_description || (d.about_the_game ? stripHtml(d.about_the_game).slice(0, 2000) : '')
  return {
    title: d.name,
    description: stripHtml(desc || ''),
    developer: (d.developers ?? []).join(', '),
    publisher: (d.publishers ?? []).join(', '),
    releaseDate: parseLooseDate(d.release_date?.date ?? ''),
    genres: (d.genres ?? []).map((g) => g.description).filter(Boolean),
    headerImage: d.header_image
  }
}

export interface StoreSearchResult {
  appId: number
  name: string
  thumb: string
}

/**
 * Searches the public Steam Store catalogue by name (no API key, no ownership needed).
 * Used to fill in details for games you own anywhere — disc, other stores, downloads.
 */
export async function searchStore(term: string): Promise<StoreSearchResult[]> {
  const q = term.trim()
  if (q.length < 2) return []
  const data = (await getJson(`${STORE_BASE}/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=US`)) as {
    items?: Array<{ id: number; name: string; type?: string; tiny_image?: string }>
  }
  return (data.items ?? [])
    .filter((i) => Number.isInteger(i.id) && (!i.type || i.type === 'app'))
    .slice(0, 8)
    .map((i) => ({ appId: i.id, name: i.name, thumb: i.tiny_image || `${CDN_BASES[0]}/${i.id}/capsule_231x87.jpg` }))
}

/** Candidate artwork URLs, best (portrait box art) first. */
export function artworkUrls(appId: number, headerImage?: string): string[] {
  const urls: string[] = []
  for (const base of CDN_BASES) urls.push(`${base}/${appId}/library_600x900_2x.jpg`, `${base}/${appId}/library_600x900.jpg`)
  for (const base of CDN_BASES) urls.push(`${base}/${appId}/header.jpg`)
  if (headerImage) urls.push(headerImage)
  return urls
}

// ---------------- local Steam installation ----------------

function runReg(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, 'i').exec(stdout)
      resolve(m ? m[1].trim() : null)
    })
  })
}

/** Finds the Steam client install folder (registry first, then common locations). */
export async function detectSteamPath(): Promise<string | null> {
  if (process.env.GAMEVAULT_STEAM_PATH) return existsSync(process.env.GAMEVAULT_STEAM_PATH) ? process.env.GAMEVAULT_STEAM_PATH : null
  const candidates: string[] = []
  const reg = await runReg('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  if (reg) candidates.push(reg.replace(/\//g, '\\'))
  const reg2 = await runReg('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (reg2) candidates.push(reg2)
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam')
  } else if (process.env.HOME) {
    candidates.push(join(process.env.HOME, '.steam', 'steam'), join(process.env.HOME, '.local', 'share', 'Steam'))
  }
  for (const c of candidates) if (existsSync(join(c, 'steamapps'))) return c
  return null
}

/** Library folders listed in steamapps/libraryfolders.vdf (always includes the main install). */
export function steamLibraryFolders(steamPath: string): string[] {
  const folders = new Set<string>([steamPath])
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (existsSync(vdf)) {
    try {
      const text = readFileSync(vdf, 'utf8')
      const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) folders.add(m[1].replace(/\\\\/g, '\\'))
    } catch {
      /* ignore unreadable file */
    }
  }
  return [...folders].filter((f) => existsSync(join(f, 'steamapps')))
}

export interface InstalledSteamApp {
  appId: number
  name: string
  installDir: string
}

/** Reads appmanifest files to find games that are fully installed on this PC. */
export function installedSteamApps(steamPath: string | null): Map<number, InstalledSteamApp> {
  const out = new Map<number, InstalledSteamApp>()
  if (!steamPath) return out
  for (const lib of steamLibraryFolders(steamPath)) {
    const apps = join(lib, 'steamapps')
    let files: string[] = []
    try {
      files = readdirSync(apps)
    } catch {
      continue
    }
    for (const f of files) {
      const m = /^appmanifest_(\d+)\.acf$/i.exec(f)
      if (!m) continue
      try {
        const text = readFileSync(join(apps, f), 'utf8')
        const name = /"name"\s+"([^"]*)"/.exec(text)?.[1] ?? ''
        const dir = /"installdir"\s+"([^"]*)"/.exec(text)?.[1] ?? ''
        const flags = Number(/"StateFlags"\s+"(\d+)"/.exec(text)?.[1] ?? '4')
        // StateFlags bit 4 = fully installed. Skip Steamworks redistributables.
        if ((flags & 4) === 0) continue
        if (/^Steamworks Common Redistributables$/i.test(name)) continue
        out.set(Number(m[1]), { appId: Number(m[1]), name, installDir: join(apps, 'common', dir) })
      } catch {
        /* skip unreadable manifest */
      }
    }
  }
  return out
}
