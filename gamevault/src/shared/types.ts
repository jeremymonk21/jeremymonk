// Shared data types used by the main process, preload bridge and renderer.

export const PLAY_STATUSES = ['not_started', 'playing', 'completed', 'on_hold', 'dropped'] as const
export type PlayStatus = (typeof PLAY_STATUSES)[number]

export const PLAY_STATUS_LABELS: Record<PlayStatus, string> = {
  not_started: 'Not Started',
  playing: 'Playing',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped'
}

export type GameFormat = 'physical' | 'digital'
export type SystemKind = 'pc' | 'console' | 'handheld' | 'other'

/** How a copy is launched. `none` means it is a plain collection entry. */
export type LaunchType = 'none' | 'steam' | 'executable' | 'shortcut' | 'emulator'

export type CoverFit = 'cover' | 'contain'

/** Metadata fields that can be refreshed from an external source (Steam). */
export const METADATA_FIELDS = [
  'title',
  'description',
  'developer',
  'publisher',
  'releaseDate',
  'genres',
  'cover'
] as const
export type MetadataField = (typeof METADATA_FIELDS)[number]

export interface GameSystem {
  id: number
  name: string
  kind: SystemKind
  builtin: boolean
  sortOrder: number
}

export interface Tag {
  id: number
  name: string
}

export interface GameCopy {
  id: number
  gameId: number
  systemId: number
  format: GameFormat
  /** Store or launcher, e.g. "Steam", "Epic Games Store", "PlayStation Store", "Retail". */
  store: string
  steamAppId: number | null
  launchType: LaunchType
  launchTarget: string
  launchArgs: string
  launchWorkDir: string
  /** For launchType 'emulator': which emulator setup runs launchTarget (the game file). */
  emulatorId: number | null
}

export interface GameImage {
  id: number
  file: string
}

export interface Game {
  id: number
  title: string
  description: string
  developer: string
  publisher: string
  /** ISO-like date: "YYYY", "YYYY-MM" or "YYYY-MM-DD"; empty string when unknown. */
  releaseDate: string
  coverFile: string | null
  coverFit: CoverFit
  coverPosX: number
  coverPosY: number
  coverZoom: number
  /** 1–5, or null when unrated. */
  rating: number | null
  notes: string
  playStatus: PlayStatus
  favorite: boolean
  dateAdded: string
  updatedAt: string
  steamAppId: number | null
  source: 'manual' | 'steam' | 'sample'
  /** Metadata fields the user changed by hand; external refreshes never overwrite them. */
  lockedFields: MetadataField[]
  isSample: boolean
  /** Marked by the user as "want to play next". Cleared automatically when set to Playing. */
  backlog: boolean
  /** On the wishlist (not owned yet). Wishlist games are kept out of the collection, counts and stats. */
  wishlist: boolean
  genreIds: number[]
  categoryIds: number[]
  collectionIds: number[]
  copies: GameCopy[]
  images: GameImage[]
  /** Wide background art and transparent logo, used by Big Picture. */
  heroFile: string | null
  logoFile: string | null
  igdbId: number | null
  /** YouTube video ids (trailers) from IGDB. */
  videoIds: string[]
  /** The user's own video clip, stored in the data folder. */
  clipFile: string | null
  /** Seconds tracked by GameVault plus minutes imported from Steam. */
  playSeconds: number
  sessionCount: number
  lastPlayedAt: string | null
}

export interface Collection {
  id: number
  name: string
  coverFile: string | null
  sortOrder: number
}

export interface Emulator {
  id: number
  name: string
  systemId: number
  exePath: string
  /** Arguments; {file} is replaced with the game file path. */
  args: string
  gamesFolder: string
  /** Comma-separated file extensions to scan for, e.g. "chd,cue,m3u". */
  extensions: string
  /** Optional folder that must contain BIOS files (shown as a warning when empty). */
  biosFolder: string
}

export interface ScanCandidate {
  file: string
  fileName: string
  guessedTitle: string
  emulatorId: number
  systemId: number
}

export interface PlaySession {
  gameId: number
  startedAt: string
  seconds: number
}

export interface Stats {
  owned: number
  completed: number
  backlog: number
  wishlist: number
  /** Hours per month for the chosen range (oldest first). */
  months: Array<{ label: string; hours: number }>
  totalHours: number
  totalSeconds: number
  gamesPlayed: number
  perSystem: Array<{ name: string; count: number }>
  topPlayed: Array<{ gameId: number; title: string; system: string; hours: number; seconds: number }>
}

export interface Library {
  games: Game[]
  systems: GameSystem[]
  genres: Tag[]
  categories: Tag[]
  collections: Collection[]
  emulators: Emulator[]
  dataDir: string
  hasSamples: boolean
}

export interface CopyInput {
  id?: number
  systemId: number
  format: GameFormat
  store: string
  steamAppId: number | null
  launchType: LaunchType
  launchTarget: string
  launchArgs: string
  launchWorkDir: string
  emulatorId?: number | null
}

export interface GameInput {
  id?: number
  title: string
  description: string
  developer: string
  publisher: string
  releaseDate: string
  coverFile: string | null
  coverFit: CoverFit
  coverPosX: number
  coverPosY: number
  coverZoom: number
  rating: number | null
  /** Omit when updating to leave existing notes untouched (notes are saved by the notes box). */
  notes?: string
  playStatus: PlayStatus
  favorite: boolean
  steamAppId: number | null
  genreNames: string[]
  categoryIds: number[]
  copies: CopyInput[]
  imageFiles: string[]
  backlog?: boolean
  wishlist?: boolean
  collectionIds?: number[]
  heroFile?: string | null
  logoFile?: string | null
  igdbId?: number | null
  videoIds?: string[]
  clipFile?: string | null
  lockedFields?: MetadataField[]
  /** Fields whose value came straight from an online lookup; these are not locked as manual edits. */
  sourceFields?: MetadataField[]
}

export interface LookupResult {
  appId: number
  title: string
  description: string
  developer: string
  publisher: string
  releaseDate: string
  genres: string[]
  coverFile: string | null
  coverPortrait: boolean
}

/** Quick, personal edits that never touch imported metadata. */
export interface GamePatch {
  favorite?: boolean
  rating?: number | null
  notes?: string
  playStatus?: PlayStatus
  categoryIds?: number[]
  backlog?: boolean
  wishlist?: boolean
  collectionIds?: number[]
}

export type LaunchState =
  | 'ready'
  | 'not_configured'
  | 'missing_file'
  | 'steam_missing'
  | 'not_installed'
  | 'unknown'

export interface LaunchCheck {
  copyId: number
  state: LaunchState
  message: string
}

export interface LaunchResult {
  ok: boolean
  state: LaunchState | 'error'
  message: string
}

// ---------------- Steam ----------------

export interface SteamConfig {
  hasApiKey: boolean
  steamId: string
  steamPath: string | null
  autoDetectedSteamPath: string | null
}

export interface SteamOwnedGame {
  appId: number
  name: string
  playtimeMinutes: number
  installed: boolean
  /** Existing collection game id, when this appid is already in the collection. */
  existingGameId: number | null
}

export interface SteamImportOptions {
  fetchMetadata: boolean
  downloadArtwork: boolean
}

export interface ImportProgress {
  done: number
  total: number
  current: string
  phase: 'importing' | 'finished' | 'cancelled' | 'error'
  added: number
  updated: number
  errors: string[]
}

export interface BackupResult {
  ok: boolean
  cancelled?: boolean
  path?: string
  message: string
}

/** App-wide preferences stored in the database (and so included in backups). */
export interface AppPrefs {
  startInBigPicture: boolean
  /** Folder of the user's own music for Big Picture ('' = no music). */
  musicFolder: string
  /** 0–1 */
  musicVolume: number
  /** Play IGDB trailers (YouTube, online only) in Big Picture. */
  playTrailers: boolean
}

export const DEFAULT_PREFS: AppPrefs = { startInBigPicture: false, musicFolder: '', musicVolume: 0.35, playTrailers: true }
