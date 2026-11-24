/**
 * Online metadata and artwork sources beyond Steam.
 *
 * IGDB (owned by Twitch): game details for every platform, including retro and Nintendo.
 *   Auth: Twitch "client credentials" — a Client ID + Client Secret from dev.twitch.tv/console
 *   are exchanged for an app access token (POST id.twitch.tv/oauth2/token). Requests are
 *   POST api.igdb.com/v4/<endpoint> with an Apicalypse query body and the headers
 *   Client-ID and Authorization: Bearer <token>. Images: images.igdb.com/igdb/image/upload/t_<size>/<image_id>.jpg
 *
 * SteamGridDB: community artwork — portrait box art ("grids"), wide backgrounds ("heroes")
 *   and transparent logos. Auth: Authorization: Bearer <API key> from steamgriddb.com
 *   (Profile → Preferences → API). Base: www.steamgriddb.com/api/v2.
 *
 * Keys are kept in secrets.json (encrypted with Windows DPAPI), never in backups.
 */
import { net } from 'electron'
import { parseLooseDate } from '@shared/filter'
import { getSecret } from './secrets'

const TWITCH_TOKEN_URL = process.env.GAMEVAULT_TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token'
const IGDB_BASE = process.env.GAMEVAULT_IGDB_BASE || 'https://api.igdb.com/v4'
const IGDB_IMG = process.env.GAMEVAULT_IGDB_IMAGE_BASE || 'https://images.igdb.com/igdb/image/upload'
const SGDB_BASE = process.env.GAMEVAULT_SGDB_BASE || 'https://www.steamgriddb.com/api/v2'

export class SourceError extends Error {}

async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20000)
  try {
    return await net.fetch(url, { ...init, signal: ctl.signal })
  } catch (e) {
    throw new SourceError(`Could not reach ${new URL(url).host}. Check your internet connection. (${(e as Error).message})`)
  } finally {
    clearTimeout(timer)
  }
}

// ---------------- IGDB ----------------

let token: { value: string; expires: number; clientId: string } | null = null

export function igdbConfigured(): boolean {
  return !!(getSecret('igdb_client_id') && getSecret('igdb_client_secret'))
}

async function igdbToken(force = false): Promise<{ token: string; clientId: string }> {
  const clientId = getSecret('igdb_client_id')
  const secret = getSecret('igdb_client_secret')
  if (!clientId || !secret) throw new SourceError('Add your IGDB (Twitch) Client ID and Client Secret in Settings → Online sources.')
  if (!force && token && token.clientId === clientId && token.expires > Date.now() + 60000) return { token: token.value, clientId }
  const u = new URL(TWITCH_TOKEN_URL)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('client_secret', secret)
  u.searchParams.set('grant_type', 'client_credentials')
  const res = await request(u.toString(), { method: 'POST' })
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new SourceError('Twitch rejected the IGDB Client ID or Client Secret. Check them in Settings → Online sources (dev.twitch.tv/console).')
  if (!res.ok) throw new SourceError(`Twitch sign-in failed (HTTP ${res.status}).`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new SourceError('Twitch did not return an access token.')
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, clientId }
  return { token: token.value, clientId }
}

let lastIgdb = 0
async function igdb<T>(endpoint: string, body: string, retry = true): Promise<T> {
  // IGDB allows 4 requests per second.
  const wait = lastIgdb + 260 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastIgdb = Date.now()
  const { token: t, clientId } = await igdbToken()
  const res = await request(`${IGDB_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
    body
  })
  if (res.status === 401 && retry) {
    token = null
    await igdbToken(true)
    return igdb<T>(endpoint, body, false)
  }
  if (res.status === 429) throw new SourceError('IGDB is rate-limiting requests. Wait a moment and try again.')
  if (!res.ok) throw new SourceError(`IGDB returned an error (HTTP ${res.status}).`)
  return (await res.json()) as T
}

export function igdbImage(imageId: string, size: 'cover_big_2x' | 'cover_big' | 'thumb' | '1080p' | 'screenshot_big' = 'cover_big_2x'): string {
  return `${IGDB_IMG}/t_${size}/${imageId}.jpg`
}

const escapeQ = (s: string): string => s.replace(/["\\]/g, ' ').trim()

export interface SourceHit {
  source: 'igdb' | 'steam'
  id: number
  name: string
  year: string
  platforms: string[]
  thumb: string
}

interface IgdbGame {
  id: number
  name: string
  summary?: string
  storyline?: string
  first_release_date?: number
  genres?: Array<{ name: string }>
  platforms?: Array<{ name: string }>
  cover?: { image_id: string }
  involved_companies?: Array<{ developer?: boolean; publisher?: boolean; company?: { name: string } }>
  videos?: Array<{ video_id: string }>
  screenshots?: Array<{ image_id: string }>
  external_games?: Array<{ category?: number; uid?: string }>
}

export async function igdbSearch(term: string): Promise<SourceHit[]> {
  const q = escapeQ(term)
  if (q.length < 2) return []
  const games = await igdb<IgdbGame[]>('games', `search "${q}"; fields name,first_release_date,platforms.name,cover.image_id; limit 10;`)
  return games.map((g) => ({
    source: 'igdb' as const,
    id: g.id,
    name: g.name,
    year: g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : '',
    platforms: (g.platforms ?? []).map((p) => p.name),
    thumb: g.cover ? igdbImage(g.cover.image_id, 'thumb') : ''
  }))
}

export interface IgdbDetails {
  id: number
  title: string
  description: string
  developer: string
  publisher: string
  releaseDate: string
  genres: string[]
  platforms: string[]
  coverUrl: string | null
  screenshotUrls: string[]
  videoIds: string[]
}

export async function igdbDetails(id: number): Promise<IgdbDetails | null> {
  const [g] = await igdb<IgdbGame[]>(
    'games',
    `fields name,summary,storyline,first_release_date,genres.name,platforms.name,cover.image_id,videos.video_id,screenshots.image_id,` +
      `involved_companies.developer,involved_companies.publisher,involved_companies.company.name; where id = ${Math.floor(id)};`
  )
  if (!g) return null
  const companies = g.involved_companies ?? []
  const names = (pred: (c: (typeof companies)[number]) => boolean | undefined): string =>
    [...new Set(companies.filter(pred).map((c) => c.company?.name).filter(Boolean))].join(', ')
  const date = g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : ''
  return {
    id: g.id,
    title: g.name,
    description: (g.summary || g.storyline || '').trim(),
    developer: names((c) => c.developer),
    publisher: names((c) => c.publisher),
    releaseDate: parseLooseDate(date),
    genres: (g.genres ?? []).map((x) => x.name).filter(Boolean),
    platforms: (g.platforms ?? []).map((p) => p.name),
    coverUrl: g.cover ? igdbImage(g.cover.image_id, 'cover_big_2x') : null,
    screenshotUrls: (g.screenshots ?? []).slice(0, 4).map((s) => igdbImage(s.image_id, '1080p')),
    videoIds: (g.videos ?? []).map((v) => v.video_id).filter((v) => /^[A-Za-z0-9_-]{6,20}$/.test(v)).slice(0, 3)
  }
}

export async function testIgdb(): Promise<string> {
  token = null
  await igdbToken(true)
  await igdb('games', 'fields name; limit 1;')
  return 'IGDB connected.'
}

// ---------------- SteamGridDB ----------------

export function sgdbConfigured(): boolean {
  return !!getSecret('sgdb_key')
}

async function sgdb<T>(path: string): Promise<T> {
  const key = getSecret('sgdb_key')
  if (!key) throw new SourceError('Add your SteamGridDB API key in Settings → Online sources.')
  const res = await request(`${SGDB_BASE}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) throw new SourceError('SteamGridDB rejected the API key. Check it in Settings → Online sources.')
  if (res.status === 404) return { success: true, data: [] } as T
  if (!res.ok) throw new SourceError(`SteamGridDB returned an error (HTTP ${res.status}).`)
  return (await res.json()) as T
}

export interface ArtOption {
  id: number
  url: string
  thumb: string
}

export interface ArtSet {
  sgdbGameId: number | null
  grids: ArtOption[]
  heroes: ArtOption[]
  logos: ArtOption[]
}

type SgdbList = { success: boolean; data: Array<{ id: number; url: string; thumb?: string }> }

/** Finds artwork for a game by Steam App ID when known, else by name. */
export async function sgdbArt(title: string, steamAppId?: number | null): Promise<ArtSet> {
  let gameId: number | null = null
  if (steamAppId) {
    const r = await sgdb<{ success: boolean; data?: { id: number } }>(`/games/steam/${steamAppId}`)
    gameId = r.data && !Array.isArray(r.data) ? r.data.id : null
  }
  if (!gameId && title.trim()) {
    const r = await sgdb<{ success: boolean; data: Array<{ id: number; name: string }> }>(`/search/autocomplete/${encodeURIComponent(title.trim())}`)
    gameId = r.data?.[0]?.id ?? null
  }
  if (!gameId) return { sgdbGameId: null, grids: [], heroes: [], logos: [] }
  const map = (r: SgdbList): ArtOption[] => (r.data ?? []).slice(0, 18).map((d) => ({ id: d.id, url: d.url, thumb: d.thumb || d.url }))
  const [grids, heroes, logos] = await Promise.all([
    sgdb<SgdbList>(`/grids/game/${gameId}?dimensions=600x900,342x482,660x930&types=static`),
    sgdb<SgdbList>(`/heroes/game/${gameId}?types=static`),
    sgdb<SgdbList>(`/logos/game/${gameId}?types=static`)
  ])
  return { sgdbGameId: gameId, grids: map(grids), heroes: map(heroes), logos: map(logos) }
}

export async function testSgdb(): Promise<string> {
  await sgdb('/search/autocomplete/zelda')
  return 'SteamGridDB connected.'
}
