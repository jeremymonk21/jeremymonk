import Database from 'better-sqlite3'
import { join } from 'path'
import type {
  CopyInput,
  Game,
  GameCopy,
  GameInput,
  GamePatch,
  GameSystem,
  MetadataField,
  PlayStatus,
  SystemKind,
  Tag
} from '@shared/types'
import { PLAY_STATUSES } from '@shared/types'

export type DB = Database.Database

const DEFAULT_SYSTEMS: Array<[string, SystemKind]> = [
  ['PC', 'pc'],
  ['PlayStation 5', 'console'],
  ['PlayStation 4', 'console'],
  ['PlayStation 3', 'console'],
  ['Xbox Series X|S', 'console'],
  ['Xbox One', 'console'],
  ['Xbox 360', 'console'],
  ['Nintendo Switch 2', 'console'],
  ['Nintendo Switch', 'console'],
  ['Wii U', 'console'],
  ['Wii', 'console'],
  ['Nintendo 3DS', 'handheld'],
  ['PlayStation Vita', 'handheld']
]

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE systems (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'console',
    builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    developer TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    release_date TEXT NOT NULL DEFAULT '',
    cover_file TEXT,
    cover_fit TEXT NOT NULL DEFAULT 'cover',
    cover_pos_x REAL NOT NULL DEFAULT 50,
    cover_pos_y REAL NOT NULL DEFAULT 50,
    cover_zoom REAL NOT NULL DEFAULT 1,
    rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    notes TEXT NOT NULL DEFAULT '',
    play_status TEXT NOT NULL DEFAULT 'not_started',
    favorite INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    steam_app_id INTEGER UNIQUE,
    source TEXT NOT NULL DEFAULT 'manual',
    locked_fields TEXT NOT NULL DEFAULT '[]',
    is_sample INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE copies (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    system_id INTEGER NOT NULL REFERENCES systems(id),
    format TEXT NOT NULL DEFAULT 'digital',
    store TEXT NOT NULL DEFAULT '',
    steam_app_id INTEGER,
    launch_type TEXT NOT NULL DEFAULT 'none',
    launch_target TEXT NOT NULL DEFAULT '',
    launch_args TEXT NOT NULL DEFAULT '',
    launch_workdir TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX copies_game ON copies(game_id);
  CREATE INDEX copies_system ON copies(system_id);
  CREATE TABLE genres (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
  CREATE TABLE game_genres (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, genre_id)
  );
  CREATE TABLE game_categories (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, category_id)
  );
  CREATE TABLE game_images (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `
]

export function openDatabase(dataDir: string): DB {
  const db = new Database(join(dataDir, 'gamevault.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      if (v === 0) {
        const ins = db.prepare('INSERT INTO systems (name, kind, builtin, sort_order) VALUES (?, ?, 1, ?)')
        DEFAULT_SYSTEMS.forEach(([name, kind], i) => ins.run(name, kind, i))
      }
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

const now = (): string => new Date().toISOString()

// ---------------- settings ----------------

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSetting(db: DB, key: string, value: string | null): void {
  if (value == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ---------------- reading ----------------

interface GameRow {
  id: number
  title: string
  description: string
  developer: string
  publisher: string
  release_date: string
  cover_file: string | null
  cover_fit: string
  cover_pos_x: number
  cover_pos_y: number
  cover_zoom: number
  rating: number | null
  notes: string
  play_status: string
  favorite: number
  date_added: string
  updated_at: string
  steam_app_id: number | null
  source: string
  locked_fields: string
  is_sample: number
}

interface CopyRow {
  id: number
  game_id: number
  system_id: number
  format: string
  store: string
  steam_app_id: number | null
  launch_type: string
  launch_target: string
  launch_args: string
  launch_workdir: string
}

function mapCopy(r: CopyRow): GameCopy {
  return {
    id: r.id,
    gameId: r.game_id,
    systemId: r.system_id,
    format: r.format === 'physical' ? 'physical' : 'digital',
    store: r.store,
    steamAppId: r.steam_app_id,
    launchType: (['steam', 'executable', 'shortcut'].includes(r.launch_type) ? r.launch_type : 'none') as GameCopy['launchType'],
    launchTarget: r.launch_target,
    launchArgs: r.launch_args,
    launchWorkDir: r.launch_workdir
  }
}

function parseLocked(s: string): MetadataField[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function mapGame(r: GameRow): Game {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    developer: r.developer,
    publisher: r.publisher,
    releaseDate: r.release_date,
    coverFile: r.cover_file,
    coverFit: r.cover_fit === 'contain' ? 'contain' : 'cover',
    coverPosX: r.cover_pos_x,
    coverPosY: r.cover_pos_y,
    coverZoom: r.cover_zoom,
    rating: r.rating,
    notes: r.notes,
    playStatus: (PLAY_STATUSES as readonly string[]).includes(r.play_status) ? (r.play_status as PlayStatus) : 'not_started',
    favorite: !!r.favorite,
    dateAdded: r.date_added,
    updatedAt: r.updated_at,
    steamAppId: r.steam_app_id,
    source: (r.source as Game['source']) || 'manual',
    lockedFields: parseLocked(r.locked_fields),
    isSample: !!r.is_sample,
    genreIds: [],
    categoryIds: [],
    copies: [],
    images: []
  }
}

export function listGames(db: DB, where = '', params: unknown[] = []): Game[] {
  const rows = db.prepare(`SELECT * FROM games ${where}`).all(...params) as GameRow[]
  const games = rows.map(mapGame)
  if (!games.length) return games
  const byId = new Map(games.map((g) => [g.id, g]))
  const ids = games.map((g) => g.id)
  const inList = `(${ids.map(() => '?').join(',')})`
  // For large libraries, fall back to fetching all rows and filtering in JS (avoids SQLite variable limits).
  const useAll = ids.length > 500
  const q = (sql: string): unknown[] => (useAll ? db.prepare(sql.replace(/ WHERE game_id IN \?/, '')).all() : db.prepare(sql.replace('?', inList)).all(...ids))
  for (const c of q('SELECT * FROM copies WHERE game_id IN ? ORDER BY id') as CopyRow[]) byId.get(c.game_id)?.copies.push(mapCopy(c))
  for (const r of q('SELECT * FROM game_genres WHERE game_id IN ?') as Array<{ game_id: number; genre_id: number }>)
    byId.get(r.game_id)?.genreIds.push(r.genre_id)
  for (const r of q('SELECT * FROM game_categories WHERE game_id IN ?') as Array<{ game_id: number; category_id: number }>)
    byId.get(r.game_id)?.categoryIds.push(r.category_id)
  for (const r of q('SELECT * FROM game_images WHERE game_id IN ? ORDER BY sort_order, id') as Array<{ id: number; game_id: number; file: string }>)
    byId.get(r.game_id)?.images.push({ id: r.id, file: r.file })
  return games
}

export function getGame(db: DB, id: number): Game | null {
  return listGames(db, 'WHERE id = ?', [id])[0] ?? null
}

export function getGameBySteamId(db: DB, appId: number): Game | null {
  const row = db
    .prepare('SELECT g.id FROM games g WHERE g.steam_app_id = ? UNION SELECT c.game_id FROM copies c WHERE c.steam_app_id = ? LIMIT 1')
    .get(appId, appId) as { id: number } | undefined
  return row ? getGame(db, row.id) : null
}

export function listSystems(db: DB): GameSystem[] {
  return (db.prepare('SELECT * FROM systems ORDER BY sort_order, name').all() as Array<{ id: number; name: string; kind: SystemKind; builtin: number; sort_order: number }>).map(
    (r) => ({ id: r.id, name: r.name, kind: r.kind, builtin: !!r.builtin, sortOrder: r.sort_order })
  )
}

export function listTags(db: DB, table: 'genres' | 'categories'): Tag[] {
  return db.prepare(`SELECT id, name FROM ${table} ORDER BY name COLLATE NOCASE`).all() as Tag[]
}

// ---------------- writing games ----------------

function genreIdFor(db: DB, name: string): number {
  const clean = name.trim()
  const row = db.prepare('SELECT id FROM genres WHERE name = ?').get(clean) as { id: number } | undefined
  if (row) return row.id
  return Number(db.prepare('INSERT INTO genres (name) VALUES (?)').run(clean).lastInsertRowid)
}

function writeCopies(db: DB, gameId: number, copies: CopyInput[]): void {
  const keep = copies.filter((c) => c.id).map((c) => c.id as number)
  const existing = (db.prepare('SELECT id FROM copies WHERE game_id = ?').all(gameId) as Array<{ id: number }>).map((r) => r.id)
  for (const id of existing) if (!keep.includes(id)) db.prepare('DELETE FROM copies WHERE id = ?').run(id)
  for (const c of copies) {
    const vals = [c.systemId, c.format, c.store.trim(), c.steamAppId, c.launchType, c.launchTarget.trim(), c.launchArgs, c.launchWorkDir.trim()]
    if (c.id && existing.includes(c.id)) {
      db.prepare(
        'UPDATE copies SET system_id=?, format=?, store=?, steam_app_id=?, launch_type=?, launch_target=?, launch_args=?, launch_workdir=? WHERE id=?'
      ).run(...vals, c.id)
    } else {
      db.prepare(
        'INSERT INTO copies (game_id, system_id, format, store, steam_app_id, launch_type, launch_target, launch_args, launch_workdir) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(gameId, ...vals)
    }
  }
}

function writeGenres(db: DB, gameId: number, names: string[]): void {
  db.prepare('DELETE FROM game_genres WHERE game_id = ?').run(gameId)
  const ins = db.prepare('INSERT OR IGNORE INTO game_genres (game_id, genre_id) VALUES (?, ?)')
  for (const n of names) if (n.trim()) ins.run(gameId, genreIdFor(db, n))
}

function writeCategories(db: DB, gameId: number, ids: number[]): void {
  db.prepare('DELETE FROM game_categories WHERE game_id = ?').run(gameId)
  const ins = db.prepare('INSERT OR IGNORE INTO game_categories (game_id, category_id) SELECT ?, id FROM categories WHERE id = ?')
  for (const id of ids) ins.run(gameId, id)
}

function writeImages(db: DB, gameId: number, files: string[]): void {
  db.prepare('DELETE FROM game_images WHERE game_id = ?').run(gameId)
  const ins = db.prepare('INSERT INTO game_images (game_id, file, sort_order) VALUES (?, ?, ?)')
  files.forEach((f, i) => ins.run(gameId, f, i))
}

function clampRating(r: number | null | undefined): number | null {
  if (r == null) return null
  const n = Math.round(Number(r))
  return n >= 1 && n <= 5 ? n : null
}

/**
 * Creates or updates a game from the editor. When editing a game that came from Steam,
 * any metadata field the user changed is added to `locked_fields` so that later
 * Steam refreshes keep the user's version.
 */
export function saveGame(db: DB, input: GameInput, opts: { source?: Game['source']; isSample?: boolean } = {}): Game {
  const title = input.title.trim()
  if (!title) throw new Error('A title is required.')
  return db.transaction(() => {
    const ts = now()
    const status = (PLAY_STATUSES as readonly string[]).includes(input.playStatus) ? input.playStatus : 'not_started'
    let id = input.id
    if (id) {
      const before = getGame(db, id)
      if (!before) throw new Error('This game no longer exists.')
      const locked = new Set<MetadataField>(input.lockedFields ?? before.lockedFields)
      // Games linked to Steam (imported, or details looked up from the Steam Store) remember
      // which fields the user changed by hand so refreshes never overwrite them.
      if (before.source === 'steam' || before.steamAppId || input.steamAppId) {
        const genreNames = (ids: number[]): string =>
          listTags(db, 'genres')
            .filter((t) => ids.includes(t.id))
            .map((t) => t.name.toLowerCase())
            .sort()
            .join('|')
        const newGenres = input.genreNames.map((n) => n.trim().toLowerCase()).filter(Boolean).sort().join('|')
        if (before.title !== title) locked.add('title')
        if (before.description !== input.description) locked.add('description')
        if (before.developer !== input.developer) locked.add('developer')
        if (before.publisher !== input.publisher) locked.add('publisher')
        if (before.releaseDate !== input.releaseDate) locked.add('releaseDate')
        if (genreNames(before.genreIds) !== newGenres) locked.add('genres')
        if (before.coverFile !== input.coverFile) locked.add('cover')
        for (const f of input.sourceFields ?? []) locked.delete(f)
      }
      db.prepare(
        `UPDATE games SET title=?, description=?, developer=?, publisher=?, release_date=?, cover_file=?, cover_fit=?, cover_pos_x=?, cover_pos_y=?, cover_zoom=?,
         rating=?, notes=?, play_status=?, favorite=?, steam_app_id=?, locked_fields=?, updated_at=? WHERE id=?`
      ).run(
        title,
        input.description,
        input.developer.trim(),
        input.publisher.trim(),
        input.releaseDate.trim(),
        input.coverFile,
        input.coverFit,
        input.coverPosX,
        input.coverPosY,
        input.coverZoom,
        clampRating(input.rating),
        input.notes ?? before.notes,
        status,
        input.favorite ? 1 : 0,
        input.steamAppId,
        JSON.stringify([...locked]),
        ts,
        id
      )
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO games (title, description, developer, publisher, release_date, cover_file, cover_fit, cover_pos_x, cover_pos_y, cover_zoom,
             rating, notes, play_status, favorite, date_added, updated_at, steam_app_id, source, locked_fields, is_sample)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            title,
            input.description,
            input.developer.trim(),
            input.publisher.trim(),
            input.releaseDate.trim(),
            input.coverFile,
            input.coverFit,
            input.coverPosX,
            input.coverPosY,
            input.coverZoom,
            clampRating(input.rating),
            input.notes ?? '',
            status,
            input.favorite ? 1 : 0,
            ts,
            ts,
            input.steamAppId,
            opts.source ?? 'manual',
            JSON.stringify(input.lockedFields ?? []),
            opts.isSample ? 1 : 0
          ).lastInsertRowid
      )
    }
    writeCopies(db, id, input.copies)
    writeGenres(db, id, input.genreNames)
    writeCategories(db, id, input.categoryIds)
    writeImages(db, id, input.imageFiles)
    return getGame(db, id) as Game
  })()
}

export function patchGame(db: DB, id: number, patch: GamePatch): Game {
  return db.transaction(() => {
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.favorite !== undefined) {
      sets.push('favorite = ?')
      vals.push(patch.favorite ? 1 : 0)
    }
    if (patch.rating !== undefined) {
      sets.push('rating = ?')
      vals.push(clampRating(patch.rating))
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      vals.push(String(patch.notes))
    }
    if (patch.playStatus !== undefined && (PLAY_STATUSES as readonly string[]).includes(patch.playStatus)) {
      sets.push('play_status = ?')
      vals.push(patch.playStatus)
    }
    if (sets.length) {
      sets.push('updated_at = ?')
      vals.push(now())
      const res = db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      if (!res.changes) throw new Error('This game no longer exists.')
    }
    if (patch.categoryIds) writeCategories(db, id, patch.categoryIds)
    const g = getGame(db, id)
    if (!g) throw new Error('This game no longer exists.')
    return g
  })()
}

export function unlockField(db: DB, id: number, field: MetadataField): Game | null {
  const g = getGame(db, id)
  if (!g) return null
  db.prepare('UPDATE games SET locked_fields = ? WHERE id = ?').run(JSON.stringify(g.lockedFields.filter((f) => f !== field)), id)
  return getGame(db, id)
}

export function deleteGame(db: DB, id: number): void {
  db.prepare('DELETE FROM games WHERE id = ?').run(id)
}

/** Image files referenced by any game (for cleanup of orphaned files). */
export function referencedImages(db: DB): Set<string> {
  const set = new Set<string>()
  for (const r of db.prepare('SELECT cover_file AS f FROM games WHERE cover_file IS NOT NULL UNION SELECT file FROM game_images').all() as Array<{ f: string }>)
    set.add(r.f)
  return set
}

// ---------------- Steam metadata merge ----------------

export interface ExternalMetadata {
  title?: string
  description?: string
  developer?: string
  publisher?: string
  releaseDate?: string
  genres?: string[]
  coverFile?: string | null
}

/**
 * Applies metadata from Steam to an existing game, skipping fields the user has
 * edited by hand. Personal data (notes, rating, favorite, categories, status,
 * copies and launch settings) is never touched here.
 */
export function applyExternalMetadata(db: DB, gameId: number, meta: ExternalMetadata): void {
  db.transaction(() => {
    const g = getGame(db, gameId)
    if (!g) return
    const locked = new Set(g.lockedFields)
    const sets: string[] = []
    const vals: unknown[] = []
    const put = (field: MetadataField, col: string, value: string | undefined | null): void => {
      if (value == null || locked.has(field)) return
      if (field !== 'cover' && !String(value).trim()) return
      sets.push(`${col} = ?`)
      vals.push(value)
    }
    put('title', 'title', meta.title)
    put('description', 'description', meta.description)
    put('developer', 'developer', meta.developer)
    put('publisher', 'publisher', meta.publisher)
    put('releaseDate', 'release_date', meta.releaseDate)
    if (meta.coverFile && !locked.has('cover')) {
      sets.push('cover_file = ?')
      vals.push(meta.coverFile)
    }
    if (sets.length) {
      sets.push('updated_at = ?')
      vals.push(now())
      db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...vals, gameId)
    }
    if (meta.genres && meta.genres.length && !locked.has('genres')) writeGenres(db, gameId, meta.genres)
  })()
}

/** Inserts a new Steam game (PC, digital, Steam store). Launching is NOT enabled unless installed. */
export function insertSteamGame(db: DB, appId: number, name: string, installed: boolean): Game {
  const pc = (db.prepare("SELECT id FROM systems WHERE kind = 'pc' ORDER BY builtin DESC, sort_order LIMIT 1").get() as { id: number } | undefined)?.id
  const systemId = pc ?? Number(db.prepare("INSERT INTO systems (name, kind, builtin, sort_order) VALUES ('PC', 'pc', 1, 0)").run().lastInsertRowid)
  return saveGame(
    db,
    {
      title: name || `Steam app ${appId}`,
      description: '',
      developer: '',
      publisher: '',
      releaseDate: '',
      coverFile: null,
      coverFit: 'cover',
      coverPosX: 50,
      coverPosY: 50,
      coverZoom: 1,
      rating: null,
      notes: '',
      playStatus: 'not_started',
      favorite: false,
      steamAppId: appId,
      genreNames: [],
      categoryIds: [],
      imageFiles: [],
      copies: [
        {
          systemId,
          format: 'digital',
          store: 'Steam',
          steamAppId: appId,
          launchType: installed ? 'steam' : 'none',
          launchTarget: '',
          launchArgs: '',
          launchWorkDir: ''
        }
      ]
    },
    { source: 'steam' }
  )
}

/** Ensures an existing game has a Steam copy for this appid (e.g. a manual entry later matched to Steam). */
export function ensureSteamCopy(db: DB, gameId: number, appId: number, installed: boolean): void {
  const has = db.prepare('SELECT id, launch_type FROM copies WHERE game_id = ? AND steam_app_id = ?').get(gameId, appId) as
    | { id: number; launch_type: string }
    | undefined
  if (has) {
    // Only turn on Steam launching when detected as installed and no other method is configured.
    if (installed && has.launch_type === 'none') db.prepare("UPDATE copies SET launch_type = 'steam' WHERE id = ?").run(has.id)
    return
  }
  const pc = (db.prepare("SELECT id FROM systems WHERE kind = 'pc' ORDER BY builtin DESC, sort_order LIMIT 1").get() as { id: number }).id
  db.prepare(
    "INSERT INTO copies (game_id, system_id, format, store, steam_app_id, launch_type) VALUES (?, ?, 'digital', 'Steam', ?, ?)"
  ).run(gameId, pc, appId, installed ? 'steam' : 'none')
  db.prepare('UPDATE games SET steam_app_id = COALESCE(steam_app_id, ?) WHERE id = ?').run(appId, gameId)
}

// ---------------- systems & tags ----------------

export function createSystem(db: DB, name: string, kind: SystemKind): GameSystem {
  const clean = name.trim()
  if (!clean) throw new Error('System name cannot be empty.')
  if (db.prepare('SELECT 1 FROM systems WHERE name = ?').get(clean)) throw new Error(`A system named "${clean}" already exists.`)
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM systems').get() as { m: number }).m
  db.prepare('INSERT INTO systems (name, kind, builtin, sort_order) VALUES (?, ?, 0, ?)').run(clean, kind, max + 1)
  return listSystems(db).find((s) => s.name.toLowerCase() === clean.toLowerCase()) as GameSystem
}

export function updateSystem(db: DB, id: number, name: string, kind: SystemKind): void {
  const clean = name.trim()
  if (!clean) throw new Error('System name cannot be empty.')
  const clash = db.prepare('SELECT id FROM systems WHERE name = ? AND id != ?').get(clean, id)
  if (clash) throw new Error(`A system named "${clean}" already exists.`)
  db.prepare('UPDATE systems SET name = ?, kind = ? WHERE id = ?').run(clean, kind, id)
}

export function systemUsage(db: DB, id: number): number {
  return (db.prepare('SELECT COUNT(DISTINCT game_id) AS n FROM copies WHERE system_id = ?').get(id) as { n: number }).n
}

export function deleteSystem(db: DB, id: number): void {
  const n = systemUsage(db, id)
  if (n > 0) throw new Error(`This system is used by ${n} game${n === 1 ? '' : 's'}. Move or remove those copies first.`)
  db.prepare('DELETE FROM systems WHERE id = ?').run(id)
}

export function createTag(db: DB, table: 'genres' | 'categories', name: string): Tag {
  const clean = name.trim()
  if (!clean) throw new Error('Name cannot be empty.')
  const existing = db.prepare(`SELECT id, name FROM ${table} WHERE name = ?`).get(clean) as Tag | undefined
  if (existing) throw new Error(`"${existing.name}" already exists.`)
  const id = Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(clean).lastInsertRowid)
  return { id, name: clean }
}

export function renameTag(db: DB, table: 'genres' | 'categories', id: number, name: string): void {
  const clean = name.trim()
  if (!clean) throw new Error('Name cannot be empty.')
  if (db.prepare(`SELECT 1 FROM ${table} WHERE name = ? AND id != ?`).get(clean, id)) throw new Error(`"${clean}" already exists.`)
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(clean, id)
}

export function deleteTag(db: DB, table: 'genres' | 'categories', id: number): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}

export function tagUsage(db: DB, table: 'genres' | 'categories', id: number): number {
  const join = table === 'genres' ? 'game_genres WHERE genre_id' : 'game_categories WHERE category_id'
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${join} = ?`).get(id) as { n: number }).n
}

export function removeSamples(db: DB): number {
  const res = db.prepare('DELETE FROM games WHERE is_sample = 1').run()
  return res.changes
}

export function hasSamples(db: DB): boolean {
  return !!db.prepare('SELECT 1 FROM games WHERE is_sample = 1 LIMIT 1').get()
}
