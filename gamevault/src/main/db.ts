import Database from 'better-sqlite3'
import { join } from 'path'
import type {
  Collection,
  Emulator,
  Stats,
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

const RETRO_SYSTEMS: Array<[string, SystemKind]> = [
  ['PlayStation 1', 'console'],
  ['PlayStation 2', 'console'],
  ['PSP', 'handheld'],
  ['GameCube', 'console'],
  ['Nintendo 64', 'console'],
  ['SNES', 'console'],
  ['NES', 'console'],
  ['Game Boy / Color', 'handheld'],
  ['Game Boy Advance', 'handheld'],
  ['Nintendo DS', 'handheld'],
  ['Sega Genesis / Mega Drive', 'console'],
  ['Dreamcast', 'console']
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
  `,
  // v2: backlog, wishlist, collections, play time, emulators, Big Picture art
  `
  ALTER TABLE games ADD COLUMN backlog INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN wishlist INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN hero_file TEXT;
  ALTER TABLE games ADD COLUMN logo_file TEXT;
  ALTER TABLE games ADD COLUMN igdb_id INTEGER;
  ALTER TABLE games ADD COLUMN video_ids TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE games ADD COLUMN clip_file TEXT;
  ALTER TABLE games ADD COLUMN imported_play_minutes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE copies ADD COLUMN emulator_id INTEGER REFERENCES emulators(id) ON DELETE SET NULL;
  CREATE TABLE collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    cover_file TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE collection_games (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, game_id)
  );
  CREATE TABLE play_sessions (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    seconds INTEGER NOT NULL
  );
  CREATE INDEX play_sessions_game ON play_sessions(game_id);
  CREATE TABLE emulators (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system_id INTEGER NOT NULL REFERENCES systems(id),
    exe_path TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '"{file}"',
    games_folder TEXT NOT NULL DEFAULT '',
    extensions TEXT NOT NULL DEFAULT '',
    bios_folder TEXT NOT NULL DEFAULT ''
  );
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
      if (v === 1) {
        // Retro systems for emulation (skipped when the user already created one with the same name).
        const max = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM systems').get() as { m: number }).m
        const ins = db.prepare('INSERT OR IGNORE INTO systems (name, kind, builtin, sort_order) VALUES (?, ?, 1, ?)')
        RETRO_SYSTEMS.forEach(([name, kind], i) => ins.run(name, kind, max + 1 + i))
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
  backlog: number
  wishlist: number
  hero_file: string | null
  logo_file: string | null
  igdb_id: number | null
  video_ids: string
  clip_file: string | null
  imported_play_minutes: number
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
  emulator_id: number | null
}

function mapCopy(r: CopyRow): GameCopy {
  return {
    id: r.id,
    gameId: r.game_id,
    systemId: r.system_id,
    format: r.format === 'physical' ? 'physical' : 'digital',
    store: r.store,
    steamAppId: r.steam_app_id,
    launchType: (['steam', 'executable', 'shortcut', 'emulator'].includes(r.launch_type) ? r.launch_type : 'none') as GameCopy['launchType'],
    launchTarget: r.launch_target,
    launchArgs: r.launch_args,
    launchWorkDir: r.launch_workdir,
    emulatorId: r.emulator_id ?? null
  }
}

function parseJsonArray<T>(s: string): T[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
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
    backlog: !!r.backlog,
    wishlist: !!r.wishlist,
    genreIds: [],
    categoryIds: [],
    collectionIds: [],
    copies: [],
    images: [],
    heroFile: r.hero_file,
    logoFile: r.logo_file,
    igdbId: r.igdb_id,
    videoIds: parseJsonArray<string>(r.video_ids).filter((v) => typeof v === 'string'),
    clipFile: r.clip_file,
    playSeconds: (r.imported_play_minutes || 0) * 60,
    sessionCount: 0,
    lastPlayedAt: null
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
  for (const r of q('SELECT * FROM collection_games WHERE game_id IN ? ORDER BY added_at') as Array<{ game_id: number; collection_id: number }>)
    byId.get(r.game_id)?.collectionIds.push(r.collection_id)
  const sessions = (useAll
    ? db.prepare('SELECT game_id, SUM(seconds) AS s, COUNT(*) AS n, MAX(started_at) AS last FROM play_sessions GROUP BY game_id').all()
    : db.prepare(`SELECT game_id, SUM(seconds) AS s, COUNT(*) AS n, MAX(started_at) AS last FROM play_sessions WHERE game_id IN ${inList} GROUP BY game_id`).all(...ids)) as Array<{
    game_id: number
    s: number
    n: number
    last: string
  }>
  for (const r of sessions) {
    const g = byId.get(r.game_id)
    if (!g) continue
    g.playSeconds += r.s
    g.sessionCount = r.n
    g.lastPlayedAt = r.last
  }
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
    const emu = c.launchType === 'emulator' ? (c.emulatorId ?? null) : null
    const vals = [c.systemId, c.format, c.store.trim(), c.steamAppId, c.launchType, c.launchTarget.trim(), c.launchArgs, c.launchWorkDir.trim(), emu]
    if (c.id && existing.includes(c.id)) {
      db.prepare(
        'UPDATE copies SET system_id=?, format=?, store=?, steam_app_id=?, launch_type=?, launch_target=?, launch_args=?, launch_workdir=?, emulator_id=? WHERE id=?'
      ).run(...vals, c.id)
    } else {
      db.prepare(
        'INSERT INTO copies (game_id, system_id, format, store, steam_app_id, launch_type, launch_target, launch_args, launch_workdir, emulator_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
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

function writeCollections(db: DB, gameId: number, ids: number[]): void {
  const before = new Set((db.prepare('SELECT collection_id AS c FROM collection_games WHERE game_id = ?').all(gameId) as Array<{ c: number }>).map((r) => r.c))
  const want = new Set(ids)
  for (const c of before) if (!want.has(c)) db.prepare('DELETE FROM collection_games WHERE game_id = ? AND collection_id = ?').run(gameId, c)
  const ins = db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, game_id, added_at) SELECT id, ?, ? FROM collections WHERE id = ?')
  for (const c of want) if (!before.has(c)) ins.run(gameId, now(), c)
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
      if (before.source === 'steam' || before.steamAppId || input.steamAppId || before.igdbId || input.igdbId) {
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
    // Optional fields: only written when the caller provides them.
    const extra: Array<[string, unknown]> = []
    if (input.backlog !== undefined) extra.push(['backlog', input.backlog && status !== 'playing' ? 1 : 0])
    else if (status === 'playing') extra.push(['backlog', 0])
    if (input.wishlist !== undefined) extra.push(['wishlist', input.wishlist ? 1 : 0])
    if (input.heroFile !== undefined) extra.push(['hero_file', input.heroFile])
    if (input.logoFile !== undefined) extra.push(['logo_file', input.logoFile])
    if (input.igdbId !== undefined) extra.push(['igdb_id', input.igdbId])
    if (input.videoIds !== undefined) extra.push(['video_ids', JSON.stringify(input.videoIds)])
    if (input.clipFile !== undefined) extra.push(['clip_file', input.clipFile])
    if (extra.length) db.prepare(`UPDATE games SET ${extra.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...extra.map(([, v]) => v), id)
    if (input.collectionIds) writeCollections(db, id, input.collectionIds)
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
      // Starting a game takes it off the backlog.
      if (patch.playStatus === 'playing') sets.push('backlog = 0')
    }
    if (patch.backlog !== undefined) {
      sets.push('backlog = ?')
      vals.push(patch.backlog ? 1 : 0)
    }
    if (patch.wishlist !== undefined) {
      sets.push('wishlist = ?')
      vals.push(patch.wishlist ? 1 : 0)
    }
    if (sets.length) {
      sets.push('updated_at = ?')
      vals.push(now())
      const res = db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      if (!res.changes) throw new Error('This game no longer exists.')
    }
    if (patch.categoryIds) writeCategories(db, id, patch.categoryIds)
    if (patch.collectionIds) writeCollections(db, id, patch.collectionIds)
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
  const sql = `SELECT cover_file AS f FROM games WHERE cover_file IS NOT NULL
    UNION SELECT hero_file FROM games WHERE hero_file IS NOT NULL
    UNION SELECT logo_file FROM games WHERE logo_file IS NOT NULL
    UNION SELECT clip_file FROM games WHERE clip_file IS NOT NULL
    UNION SELECT cover_file FROM collections WHERE cover_file IS NOT NULL
    UNION SELECT file FROM game_images`
  for (const r of db.prepare(sql).all() as Array<{ f: string }>) set.add(r.f)
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
  // Owning it on Steam takes it off the wishlist.
  db.prepare('UPDATE games SET wishlist = 0 WHERE id = ? AND wishlist = 1').run(gameId)
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

// ---------------- collections ----------------

export function listCollections(db: DB): Collection[] {
  return (db.prepare('SELECT * FROM collections ORDER BY sort_order, name COLLATE NOCASE').all() as Array<{ id: number; name: string; cover_file: string | null; sort_order: number }>).map(
    (r) => ({ id: r.id, name: r.name, coverFile: r.cover_file, sortOrder: r.sort_order })
  )
}

export function createCollection(db: DB, name: string): Collection {
  const clean = name.trim()
  if (!clean) throw new Error('Collection name cannot be empty.')
  if (db.prepare('SELECT 1 FROM collections WHERE name = ?').get(clean)) throw new Error(`A collection named "${clean}" already exists.`)
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM collections').get() as { m: number }).m
  const id = Number(db.prepare('INSERT INTO collections (name, sort_order, created_at) VALUES (?, ?, ?)').run(clean, max + 1, now()).lastInsertRowid)
  return { id, name: clean, coverFile: null, sortOrder: max + 1 }
}

export function updateCollection(db: DB, id: number, patch: { name?: string; coverFile?: string | null }): void {
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('Collection name cannot be empty.')
    if (db.prepare('SELECT 1 FROM collections WHERE name = ? AND id != ?').get(clean, id)) throw new Error(`A collection named "${clean}" already exists.`)
    db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(clean, id)
  }
  if (patch.coverFile !== undefined) db.prepare('UPDATE collections SET cover_file = ? WHERE id = ?').run(patch.coverFile, id)
}

export function deleteCollection(db: DB, id: number): void {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
}

/** Adds or removes many games at once (multi-select). */
export function setCollectionMembership(db: DB, collectionId: number, gameIds: number[], member: boolean): void {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) throw new Error('This collection no longer exists.')
    const ins = db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, game_id, added_at) VALUES (?, ?, ?)')
    const del = db.prepare('DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?')
    for (const g of gameIds) member ? ins.run(collectionId, g, now()) : del.run(collectionId, g)
  })()
}

/** Applies the same quick edit to many games (multi-select). */
export function patchGames(db: DB, ids: number[], patch: GamePatch): Game[] {
  return db.transaction(() => ids.map((id) => patchGame(db, id, patch)))()
}

// ---------------- play time ----------------

export function addPlaySession(db: DB, gameId: number, startedAt: string, seconds: number): void {
  if (seconds < 1) return
  db.prepare('INSERT INTO play_sessions (game_id, started_at, seconds) VALUES (?, ?, ?)').run(gameId, startedAt, Math.round(seconds))
}

export function setImportedPlayMinutes(db: DB, gameId: number, minutes: number): void {
  db.prepare('UPDATE games SET imported_play_minutes = ? WHERE id = ?').run(Math.max(0, Math.round(minutes)), gameId)
}

/** Seconds played per day for one game, for the last `days` days (oldest first). */
export function dailyPlay(db: DB, gameId: number, days: number): number[] {
  const out = new Array(days).fill(0)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const rows = db.prepare('SELECT started_at, seconds FROM play_sessions WHERE game_id = ? AND started_at >= ?').all(gameId, start.toISOString()) as Array<{
    started_at: string
    seconds: number
  }>
  for (const r of rows) {
    const d = new Date(r.started_at)
    d.setHours(0, 0, 0, 0)
    const idx = Math.round((d.getTime() - start.getTime()) / 86400000)
    if (idx >= 0 && idx < days) out[idx] += r.seconds
  }
  return out
}

export function computeStats(db: DB, range: 'month' | 'year' | 'all'): Stats {
  const games = listGames(db).filter((g) => !g.wishlist)
  const systems = new Map(listSystems(db).map((s) => [s.id, s.name]))
  const nowD = new Date()
  const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1)
  let from: Date | null
  const months: Array<{ label: string; hours: number; start: Date; end: Date }> = []
  const fmt = (d: Date, withYear: boolean): string => d.toLocaleDateString(undefined, withYear ? { month: 'short', year: '2-digit' } : { month: 'short' })
  if (range === 'month') {
    from = monthStart
    // Weekly buckets inside the current month.
    for (let d = new Date(monthStart); d <= nowD; d = new Date(d.getTime() + 7 * 86400000)) {
      const end = new Date(Math.min(d.getTime() + 7 * 86400000, nowD.getTime() + 1))
      months.push({ label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), hours: 0, start: d, end })
    }
  } else {
    let count = 12
    if (range === 'all') {
      const first = db.prepare('SELECT MIN(started_at) AS m FROM play_sessions').get() as { m: string | null }
      if (first.m) {
        const f = new Date(first.m)
        count = Math.max(12, (nowD.getFullYear() - f.getFullYear()) * 12 + nowD.getMonth() - f.getMonth() + 1)
      }
      count = Math.min(count, 60)
    }
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1)
      const end = new Date(nowD.getFullYear(), nowD.getMonth() - i + 1, 1)
      months.push({ label: fmt(start, count > 12), hours: 0, start, end })
    }
    from = range === 'year' ? months[0].start : null
  }
  const sessions = db.prepare('SELECT s.game_id, s.started_at, s.seconds FROM play_sessions s JOIN games g ON g.id = s.game_id WHERE g.wishlist = 0').all() as Array<{
    game_id: number
    started_at: string
    seconds: number
  }>
  const perGame = new Map<number, number>()
  let total = 0
  for (const s of sessions) {
    const t = new Date(s.started_at)
    if (from && t < from) continue
    total += s.seconds
    perGame.set(s.game_id, (perGame.get(s.game_id) ?? 0) + s.seconds)
    const b = months.find((m) => t >= m.start && t < m.end)
    if (b) b.hours += s.seconds / 3600
  }
  // All-time totals include hours imported from Steam.
  if (range === 'all') {
    for (const g of games) {
      const tracked = perGame.get(g.id) ?? 0
      const importedOnly = Math.max(0, g.playSeconds - tracked)
      if (importedOnly > 0) {
        perGame.set(g.id, tracked + importedOnly)
        total += importedOnly
      }
    }
  }
  const counts = new Map<string, number>()
  for (const g of games) for (const sid of new Set(g.copies.map((c) => c.systemId))) counts.set(systems.get(sid) ?? '?', (counts.get(systems.get(sid) ?? '?') ?? 0) + 1)
  const byId = new Map(games.map((g) => [g.id, g]))
  return {
    owned: games.length,
    completed: games.filter((g) => g.playStatus === 'completed').length,
    backlog: games.filter((g) => g.backlog).length,
    wishlist: (db.prepare('SELECT COUNT(*) AS n FROM games WHERE wishlist = 1').get() as { n: number }).n,
    months: months.map((m) => ({ label: m.label, hours: Math.round(m.hours * 10) / 10 })),
    totalHours: Math.round(total / 360) / 10,
    totalSeconds: total,
    gamesPlayed: [...perGame.values()].filter((v) => v > 0).length,
    perSystem: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    topPlayed: [...perGame.entries()]
      .filter(([id, sec]) => byId.has(id) && sec > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, sec]) => {
        const g = byId.get(id) as Game
        return { gameId: id, title: g.title, system: systems.get(g.copies[0]?.systemId ?? -1) ?? '', hours: Math.round(sec / 360) / 10, seconds: sec }
      })
  }
}

// ---------------- emulators ----------------

interface EmulatorRow {
  id: number
  name: string
  system_id: number
  exe_path: string
  args: string
  games_folder: string
  extensions: string
  bios_folder: string
}

function mapEmulator(r: EmulatorRow): Emulator {
  return { id: r.id, name: r.name, systemId: r.system_id, exePath: r.exe_path, args: r.args, gamesFolder: r.games_folder, extensions: r.extensions, biosFolder: r.bios_folder }
}

export function listEmulators(db: DB): Emulator[] {
  return (db.prepare('SELECT * FROM emulators ORDER BY id').all() as EmulatorRow[]).map(mapEmulator)
}

export function getEmulator(db: DB, id: number): Emulator | null {
  const r = db.prepare('SELECT * FROM emulators WHERE id = ?').get(id) as EmulatorRow | undefined
  return r ? mapEmulator(r) : null
}

export function saveEmulator(db: DB, e: Omit<Emulator, 'id'> & { id?: number }): Emulator {
  if (!e.name.trim()) throw new Error('Give the emulator a name.')
  if (!db.prepare('SELECT 1 FROM systems WHERE id = ?').get(e.systemId)) throw new Error('Choose a system.')
  const vals = [e.name.trim(), e.systemId, e.exePath.trim(), e.args.trim() || '"{file}"', e.gamesFolder.trim(), e.extensions.trim().toLowerCase(), e.biosFolder.trim()]
  let id = e.id
  if (id) db.prepare('UPDATE emulators SET name=?, system_id=?, exe_path=?, args=?, games_folder=?, extensions=?, bios_folder=? WHERE id=?').run(...vals, id)
  else id = Number(db.prepare('INSERT INTO emulators (name, system_id, exe_path, args, games_folder, extensions, bios_folder) VALUES (?,?,?,?,?,?,?)').run(...vals).lastInsertRowid)
  return getEmulator(db, id) as Emulator
}

export function deleteEmulator(db: DB, id: number): void {
  db.transaction(() => {
    // Copies that launched with this emulator become plain collection entries again.
    db.prepare("UPDATE copies SET launch_type = 'none', emulator_id = NULL WHERE emulator_id = ?").run(id)
    db.prepare('DELETE FROM emulators WHERE id = ?').run(id)
  })()
}

/** All game files already in the collection (to skip during folder scans). */
export function knownLaunchTargets(db: DB): Set<string> {
  return new Set((db.prepare("SELECT launch_target AS t FROM copies WHERE launch_target != ''").all() as Array<{ t: string }>).map((r) => r.t.toLowerCase()))
}
