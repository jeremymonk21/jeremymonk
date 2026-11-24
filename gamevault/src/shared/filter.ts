import type { Game, GameFormat, PlayStatus } from './types'

export type SidebarView =
  | { kind: 'all' }
  | { kind: 'playing' }
  | { kind: 'backlog' }
  | { kind: 'favorites' }
  | { kind: 'wishlist' }
  | { kind: 'system'; systemId: number }
  | { kind: 'collection'; collectionId: number }

export type SortKey = 'title' | 'rating' | 'releaseDate' | 'dateAdded' | 'playTime' | 'lastPlayed'
export type SortDir = 'asc' | 'desc'

export interface FilterState {
  view: SidebarView
  search: string
  /** Match games having ANY of the selected genres. */
  genreIds: number[]
  /** Match games having ANY of the selected categories. */
  categoryIds: number[]
  /** Match games in ANY of the selected collections. */
  collectionIds: number[]
  statuses: PlayStatus[]
  formats: GameFormat[]
  favoritesOnly: boolean
  sortKey: SortKey
  sortDir: SortDir
}

export const DEFAULT_FILTERS: FilterState = {
  view: { kind: 'all' },
  search: '',
  genreIds: [],
  categoryIds: [],
  collectionIds: [],
  statuses: [],
  formats: [],
  favoritesOnly: false,
  sortKey: 'title',
  sortDir: 'asc'
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Games in scope of the sidebar view (before toolbar filters). */
export function inView(game: Game, view: SidebarView): boolean {
  // The wishlist is kept apart from the owned collection.
  if (view.kind === 'wishlist') return game.wishlist
  if (game.wishlist) return false
  switch (view.kind) {
    case 'playing':
      return game.playStatus === 'playing'
    case 'backlog':
      return game.backlog
    case 'favorites':
      return game.favorite
    case 'system':
      return game.copies.some((c) => c.systemId === view.systemId)
    case 'collection':
      return game.collectionIds.includes(view.collectionId)
    default:
      return true
  }
}

/**
 * Applies every filter together (logical AND between filter types,
 * logical OR between values of the same type).
 */
export function filterGames(games: Game[], f: FilterState): Game[] {
  const q = normalize(f.search)
  const terms = q ? q.split(' ') : []
  return games.filter((g) => {
    if (!inView(g, f.view)) return false
    if (f.favoritesOnly && !g.favorite) return false
    if (terms.length) {
      const t = normalize(g.title)
      if (!terms.every((term) => t.includes(term))) return false
    }
    if (f.genreIds.length && !f.genreIds.some((id) => g.genreIds.includes(id))) return false
    if (f.categoryIds.length && !f.categoryIds.some((id) => g.categoryIds.includes(id))) return false
    if (f.collectionIds.length && !f.collectionIds.some((id) => g.collectionIds.includes(id))) return false
    if (f.statuses.length && !f.statuses.includes(g.playStatus)) return false
    if (f.formats.length) {
      const relevant =
        f.view.kind === 'system' ? g.copies.filter((c) => c.systemId === (f.view as { systemId: number }).systemId) : g.copies
      if (!relevant.some((c) => f.formats.includes(c.format))) return false
    }
    return true
  })
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Title used for sorting: ignores a leading "The"/"A"/"An". */
export function sortTitle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim()
}

/** Turns a partial date into a sortable string; unknown dates sort last. */
function dateKey(d: string): string | null {
  if (!d) return null
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(d)
  if (!m) return null
  return `${m[1]}-${m[2] ?? '00'}-${m[3] ?? '00'}`
}

export function sortGames(games: Game[], key: SortKey, dir: SortDir): Game[] {
  const mult = dir === 'asc' ? 1 : -1
  const byTitle = (a: Game, b: Game): number => collator.compare(sortTitle(a.title), sortTitle(b.title))
  return [...games].sort((a, b) => {
    let r = 0
    if (key === 'title') {
      r = byTitle(a, b) * mult
    } else if (key === 'rating') {
      // Unrated games always last regardless of direction.
      if (a.rating == null && b.rating == null) r = 0
      else if (a.rating == null) return 1
      else if (b.rating == null) return -1
      else r = (a.rating - b.rating) * mult
    } else if (key === 'releaseDate') {
      const ka = dateKey(a.releaseDate)
      const kb = dateKey(b.releaseDate)
      if (ka == null && kb == null) r = 0
      else if (ka == null) return 1
      else if (kb == null) return -1
      else r = (ka < kb ? -1 : ka > kb ? 1 : 0) * mult
    } else if (key === 'playTime') {
      r = (a.playSeconds - b.playSeconds) * mult
    } else if (key === 'lastPlayed') {
      if (!a.lastPlayedAt && !b.lastPlayedAt) r = 0
      else if (!a.lastPlayedAt) return 1
      else if (!b.lastPlayedAt) return -1
      else r = (a.lastPlayedAt < b.lastPlayedAt ? -1 : a.lastPlayedAt > b.lastPlayedAt ? 1 : 0) * mult
    } else if (key === 'dateAdded') {
      r = (a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : a.id - b.id) * mult
    }
    return r !== 0 ? r : byTitle(a, b)
  })
}

export function applyFilters(games: Game[], f: FilterState): Game[] {
  return sortGames(filterGames(games, f), f.sortKey, f.sortDir)
}

/** Formats a stored release date for display. */
export function formatReleaseDate(d: string): string {
  if (!d) return ''
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(d)
  if (!m) return d
  const [, y, mo, da] = m
  if (!mo) return y
  const date = new Date(Number(y), Number(mo) - 1, da ? Number(da) : 1)
  return date.toLocaleDateString(undefined, da ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long' })
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
}

/**
 * Parses free-form dates (e.g. Steam's "21 Aug, 2012", "Aug 21, 2012", "Q4 2024", "2019")
 * into "YYYY[-MM[-DD]]". Returns '' when no year is recognisable.
 */
export function parseLooseDate(input: string): string {
  const s = (input || '').trim()
  if (!s) return ''
  const iso = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s)
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (iso) {
    const [, y, mo, d] = iso
    if (!mo) return y
    if (!d) return `${y}-${pad(Number(mo))}`
    return `${y}-${pad(Number(mo))}-${pad(Number(d))}`
  }
  const lower = s.toLowerCase().replace(/[.,]/g, ' ')
  const year = /\b(19|20)\d{2}\b/.exec(lower)?.[0]
  if (!year) return ''
  let month: number | undefined
  for (const word of lower.split(/\s+/)) {
    const key = word.slice(0, 4) === 'sept' ? 'sept' : word.slice(0, 3)
    if (MONTHS[key] && /^[a-z]+$/.test(word)) {
      month = MONTHS[key]
      break
    }
  }
  if (!month) return year
  const day = lower
    .split(/\s+/)
    .map((w) => /^\d{1,2}$/.test(w) ? Number(w) : NaN)
    .find((n) => n >= 1 && n <= 31)
  return day ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}`
}

/** "41h 20m", "35m", or "" when never played. */
export function formatPlayTime(seconds: number): string {
  if (!seconds || seconds < 60) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** "today", "yesterday", "3 days ago", "Mar 4". */
export function formatSince(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined })
}

/** Picks a random game (Surprise me), avoiding `avoidId` when there is another choice. */
export function pickRandom(games: Game[], avoidId?: number | null, rnd: () => number = Math.random): Game | null {
  if (!games.length) return null
  const pool = games.length > 1 && avoidId != null ? games.filter((g) => g.id !== avoidId) : games
  return pool[Math.floor(rnd() * pool.length)] ?? null
}
