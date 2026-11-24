import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppPrefs, Game, PlayStatus } from '@shared/types'
import { PLAY_STATUSES, PLAY_STATUS_LABELS } from '@shared/types'
import { formatPlayTime, formatReleaseDate, formatSince, sortGames } from '@shared/filter'
import { imgUrl, useApp } from '../state'
import { Cover } from '../components/Cover'
import { IconMusic } from '../components/Icons'
import { useGamepad, type PadAction } from './useGamepad'
import './bp.css'

interface Shelf {
  key: string
  label: string
  games: Game[]
}

type Screen = 'home' | 'game' | 'menu'

const glyph = (k: string, cls: string, label?: string): JSX.Element => (
  <span className={`bp-key ${cls}`} aria-label={label ?? k}>{k}</span>
)

export default function BigPicture({ onExit }: { onExit: () => void }): JSX.Element {
  const { lib, systemsById, collectionsById, putGame, reload } = useApp()
  const [shelfIdx, setShelfIdx] = useState(0)
  const [itemIdx, setItemIdx] = useState<Record<string, number>>({})
  const [screen, setScreen] = useState<Screen>('home')
  const [action, setAction] = useState(0)
  const [menuIdx, setMenuIdx] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const [musicOn, setMusicOn] = useState(true)
  const [track, setTrack] = useState<string | null>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [mediaIdx, setMediaIdx] = useState(0)
  const [showMedia, setShowMedia] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const tracks = useRef<string[]>([])
  const trackPos = useRef(0)
  const noticeTimer = useRef<number>()

  // ---------- shelves ----------
  const shelves = useMemo<Shelf[]>(() => {
    const owned = (lib?.games ?? []).filter((g) => !g.wishlist)
    const byTitle = (gs: Game[]): Game[] => sortGames(gs, 'title', 'asc')
    const recent = (gs: Game[]): Game[] => sortGames(gs, 'lastPlayed', 'desc')
    const out: Shelf[] = [
      { key: 'playing', label: 'Playing', games: recent(owned.filter((g) => g.playStatus === 'playing')) },
      { key: 'backlog', label: 'Backlog', games: byTitle(owned.filter((g) => g.backlog)) },
      { key: 'favorites', label: 'Favorites', games: byTitle(owned.filter((g) => g.favorite)) },
      { key: 'all', label: 'All Games', games: byTitle(owned) }
    ]
    for (const s of lib?.systems ?? []) {
      const gs = owned.filter((g) => g.copies.some((c) => c.systemId === s.id))
      if (gs.length) out.push({ key: `s${s.id}`, label: s.name, games: byTitle(gs) })
    }
    for (const c of lib?.collections ?? []) {
      const gs = owned.filter((g) => g.collectionIds.includes(c.id))
      if (gs.length) out.push({ key: `c${c.id}`, label: c.name, games: byTitle(gs) })
    }
    return out.filter((s) => s.games.length || s.key === 'all')
  }, [lib])
  const shelf = shelves[Math.min(shelfIdx, shelves.length - 1)] ?? { key: 'all', label: 'All Games', games: [] }
  const idx = Math.min(itemIdx[shelf.key] ?? 0, Math.max(0, shelf.games.length - 1))
  const game = shelf.games[idx] ?? null
  const sys = game?.copies[0] ? systemsById.get(game.copies[0].systemId) : undefined
  const launchCopy = game?.copies.find((c) => c.launchType !== 'none') ?? null

  // ---------- setup: full screen, prefs, clock, music ----------
  useEffect(() => {
    window.api.setFullScreen(true).catch(() => undefined)
    window.api.getPrefs().then(setPrefs).catch(() => undefined)
    const t = window.setInterval(() => setClock(new Date()), 15000)
    return () => {
      window.clearInterval(t)
      window.api.setFullScreen(false).catch(() => undefined)
      audio.current?.pause()
    }
  }, [])

  const playTrack = useCallback(() => {
    const a = audio.current
    if (!a || !tracks.current.length) return
    const src = tracks.current[trackPos.current % tracks.current.length]
    trackPos.current++
    a.src = src
    setTrack(decodeURIComponent(src.split('/').pop() ?? '').replace(/\.[^.]+$/, ''))
    a.play().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!prefs?.musicFolder) return
    window.api.listMusic().then((list) => {
      tracks.current = list.map((v) => ({ v, r: Math.random() })).sort((x, y) => x.r - y.r).map((x) => x.v)
      if (tracks.current.length) {
        const a = new Audio()
        a.volume = prefs.musicVolume
        a.onended = playTrack
        a.onerror = () => window.setTimeout(playTrack, 500)
        audio.current = a
        playTrack()
      }
    }).catch(() => undefined)
    return () => {
      audio.current?.pause()
      audio.current = null
    }
  }, [prefs, playTrack])

  // Lower the music while a clip or trailer plays.
  useEffect(() => {
    const a = audio.current
    if (!a || !prefs) return
    a.volume = videoPlaying ? prefs.musicVolume * 0.15 : prefs.musicVolume
    if (!musicOn) a.pause()
    else if (a.paused && a.src) a.play().catch(() => undefined)
  }, [videoPlaying, musicOn, prefs])

  // Pause music while a game runs; resume when GameVault is focused again or the session ends.
  useEffect(() => {
    const resume = (): void => {
      if (musicOn && audio.current?.paused && audio.current.src) audio.current.play().catch(() => undefined)
    }
    window.addEventListener('focus', resume)
    const off = window.api.onPlaySession(() => resume())
    return () => {
      window.removeEventListener('focus', resume)
      off()
    }
  }, [musicOn])

  // On a game's page, start its clip/trailer after a short pause.
  useEffect(() => {
    setShowMedia(false)
    setVideoPlaying(false)
    setMediaIdx(0)
    if (screen !== 'game') return
    const t = window.setTimeout(() => setShowMedia(true), 900)
    return () => window.clearTimeout(t)
  }, [screen, game?.id])

  const say = (msg: string): void => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }

  const launch = async (): Promise<void> => {
    if (!game || !launchCopy) return say('This game has no launch method on this PC yet.')
    say(`Starting ${game.title}…`)
    try {
      const r = await window.api.launch(launchCopy.id)
      if (r.ok) {
        audio.current?.pause()
        if (game.playStatus === 'not_started') putGame(await window.api.patchGame(game.id, { playStatus: 'playing' }))
      } else say(r.message)
    } catch (e) {
      say((e as Error).message)
    }
  }
  const patch = async (p: Parameters<typeof window.api.patchGame>[1], msg: string): Promise<void> => {
    if (!game) return
    try {
      putGame(await window.api.patchGame(game.id, p))
      say(msg)
    } catch (e) {
      say((e as Error).message)
    }
  }

  // ---------- game page actions ----------
  const actions = game
    ? [
        ...(launchCopy ? [{ key: 'A', cls: 'a', label: 'Play', hint: launchCopy.launchType === 'emulator' ? lib?.emulators.find((e) => e.id === launchCopy.emulatorId)?.name ?? '' : launchCopy.launchType === 'steam' ? 'Steam' : '', run: launch }] : []),
        { key: 'Y', cls: 'y', label: game.favorite ? 'Favorite ✓' : 'Add to favorites', hint: '', run: () => patch({ favorite: !game.favorite }, game.favorite ? 'Removed from favorites' : 'Added to favorites') },
        { key: 'X', cls: 'x', label: game.backlog ? 'In Backlog ✓' : 'Add to Backlog', hint: '', run: () => patch({ backlog: !game.backlog }, game.backlog ? 'Removed from backlog' : 'Added to backlog') },
        {
          key: '⇄', cls: 'neutral', label: 'Status', hint: PLAY_STATUS_LABELS[game.playStatus],
          run: () => {
            const next = PLAY_STATUSES[(PLAY_STATUSES.indexOf(game.playStatus) + 1) % PLAY_STATUSES.length] as PlayStatus
            return patch({ playStatus: next }, `Status: ${PLAY_STATUS_LABELS[next]}`)
          }
        },
        { key: 'B', cls: 'b', label: 'Back', hint: '', run: () => setScreen('home') }
      ]
    : []

  const menu = [
    { label: 'Resume', run: () => setScreen('home') },
    { label: musicOn ? 'Turn music off' : 'Turn music on', run: () => setMusicOn((m) => !m) },
    { label: 'Exit Big Picture', run: onExit }
  ]

  const moveItem = (d: number): void => {
    if (!shelf.games.length) return
    setItemIdx((m) => ({ ...m, [shelf.key]: Math.max(0, Math.min(shelf.games.length - 1, idx + d)) }))
  }
  const moveShelf = (d: number): void => setShelfIdx((i) => (i + d + shelves.length) % shelves.length)

  const onPad = (a: PadAction): void => {
    if (screen === 'menu') {
      if (a === 'up') setMenuIdx((i) => (i + menu.length - 1) % menu.length)
      else if (a === 'down') setMenuIdx((i) => (i + 1) % menu.length)
      else if (a === 'a') menu[menuIdx].run()
      else if (a === 'b' || a === 'menu') setScreen('home')
      return
    }
    if (a === 'menu' || a === 'view') {
      setMenuIdx(0)
      setScreen('menu')
      return
    }
    if (screen === 'home') {
      if (a === 'left') moveItem(-1)
      else if (a === 'right') moveItem(1)
      else if (a === 'lb' || a === 'up') moveShelf(-1)
      else if (a === 'rb' || a === 'down') moveShelf(1)
      else if (a === 'a') launchCopy ? launch() : game && setScreen('game')
      else if (a === 'x' && game) {
        setAction(0)
        setScreen('game')
      } else if (a === 'y' && game) patch({ favorite: !game.favorite }, game.favorite ? 'Removed from favorites' : 'Added to favorites')
      else if (a === 'b') {
        setMenuIdx(0)
        setScreen('menu')
      }
      return
    }
    // game page
    if (a === 'up') setAction((i) => (i + actions.length - 1) % actions.length)
    else if (a === 'down') setAction((i) => (i + 1) % actions.length)
    else if (a === 'a') actions[Math.min(action, actions.length - 1)]?.run()
    else if (a === 'b') setScreen('home')
    else if (a === 'y') actions.find((x) => x.key === 'Y')?.run()
    else if (a === 'x') actions.find((x) => x.key === 'X')?.run()
    else if (a === 'left' || a === 'right') setMediaIdx((i) => Math.max(0, i + (a === 'left' ? -1 : 1)))
    else if (a === 'lb' || a === 'rb') {
      moveItem(a === 'lb' ? -1 : 1)
      setAction(0)
    }
  }
  useGamepad(onPad)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        e.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onExit])

  // Keep a refreshed library when games change elsewhere.
  useEffect(() => {
    const t = window.setInterval(() => void reload(), 60000)
    return () => window.clearInterval(t)
  }, [reload])

  // ---------- render ----------
  const bg = game?.heroFile ?? game?.coverFile ?? null
  const kicker = game
    ? [game.playStatus === 'playing' ? 'Playing' : game.backlog ? 'Backlog' : PLAY_STATUS_LABELS[game.playStatus], sys?.name].filter(Boolean).join(' · ')
    : ''
  const time = clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const cardW = 'var(--bp-card)'
  const offset = Math.max(0, idx - 1)

  const media = game ? mediaFor(game, prefs) : []
  const current = media.length ? media[Math.min(mediaIdx, media.length - 1)] : null

  return (
    <div className={`bp ${screen === 'game' ? 'on-game' : ''}`} data-testid="bigpicture">
      <div className={`bp-bg ${game?.heroFile ? 'hero' : 'cover'}`} key={bg ?? 'none'} style={bg ? { backgroundImage: `url("${imgUrl(bg)}")` } : undefined} />
      <div className="bp-shade" />

      <header className="bp-top">
        {glyph('LB', 'shoulder')}
        <nav className="bp-shelves" aria-label="Shelves">
          {shelves.map((s, i) => (
            <button key={s.key} className={`bp-shelf ${i === shelfIdx ? 'on' : ''}`} onClick={() => { setShelfIdx(i); setScreen('home') }} data-testid="bp-shelf">
              {s.label}
            </button>
          ))}
        </nav>
        {glyph('RB', 'shoulder')}
        <span className="bp-spacer" />
        {track && musicOn && (
          <span className="bp-music" data-testid="bp-music"><span className="bp-music-icon"><IconMusic size={14} /></span><span><b>{track}</b><small>Your music folder</small></span></span>
        )}
        <span className="bp-clock">{time}</span>
      </header>

      {screen !== 'game' && (
        <>
          {game ? (
            <section className="bp-hero" key={game.id}>
              <span className="bp-kicker">{kicker}</span>
              <LogoOrTitle game={game} testId="bp-title" />
              <div className="bp-meta">
                {game.releaseDate && <span>{game.releaseDate.slice(0, 4)}</span>}
                {formatPlayTime(game.playSeconds) && <span>{formatPlayTime(game.playSeconds)} played</span>}
                {game.lastPlayedAt && <span>Last played {formatSince(game.lastPlayedAt)}</span>}
                {game.rating != null && <span className="bp-stars">{'★'.repeat(game.rating)}<span>{'★'.repeat(5 - game.rating)}</span></span>}
              </div>
              {game.description && <p className="bp-desc">{game.description}</p>}
              <div className="bp-buttons">
                <button className="bp-btn primary" onClick={launch} disabled={!launchCopy} data-testid="bp-play">{glyph('A', 'a')} {launchCopy ? 'Play' : 'Not set up to play'}</button>
                <button className="bp-btn" onClick={() => { setAction(0); setScreen('game') }} data-testid="bp-details">{glyph('X', 'x')} Details{game.clipFile || game.videoIds.length ? ' & video' : ''}</button>
              </div>
            </section>
          ) : (
            <section className="bp-hero"><h1 className="bp-title">Nothing here yet</h1><p className="bp-desc">Add games in the desktop view, then come back.</p></section>
          )}
          <section className="bp-row" aria-label={`${shelf.label} games`}>
            <div className="bp-track" style={{ transform: `translateX(calc(${-offset} * (${cardW} + 22px)))` }}>
              {shelf.games.map((g, i) => (
                <button
                  key={g.id}
                  className={`bp-card ${i === idx ? 'on' : ''}`}
                  onClick={() => (i === idx ? setScreen('game') : setItemIdx((m) => ({ ...m, [shelf.key]: i })))}
                  aria-label={g.title}
                  data-testid="bp-card"
                >
                  <Cover file={g.coverFile} title={g.title} fit={g.coverFit} posX={g.coverPosX} posY={g.coverPosY} zoom={g.coverZoom} kind={systemsById.get(g.copies[0]?.systemId ?? -1)?.kind} />
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {screen === 'game' && game && (
        <div className="bp-game" data-testid="bp-game">
          <div className="bp-media">
            <figure className="bp-video">
              {current && showMedia && current.kind === 'clip' && (
                <video
                  src={imgUrl(current.src)}
                  autoPlay
                  loop
                  playsInline
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                  onEnded={() => setVideoPlaying(false)}
                  data-testid="bp-clip"
                />
              )}
              {current && showMedia && current.kind === 'trailer' && (
                <iframe
                  title={`${game.title} trailer`}
                  src={`https://www.youtube-nocookie.com/embed/${current.src}?autoplay=1&controls=0&rel=0&modestbranding=1&playsinline=1`}
                  allow="autoplay; encrypted-media"
                  onLoad={() => setVideoPlaying(true)}
                  data-testid="bp-trailer"
                />
              )}
              {(!current || current.kind === 'image' || !showMedia) &&
                (() => {
                  const still = current?.kind === 'image' ? current.src : game.heroFile ?? game.images[0]?.file ?? null
                  return still ? (
                    <div className="bp-still" style={{ backgroundImage: `url("${imgUrl(still)}")` }} />
                  ) : (
                    <div className="bp-still-cover">
                      <div className="bp-still-cover-art"><Cover file={game.coverFile} title={game.title} fit={game.coverFit} posX={game.coverPosX} posY={game.coverPosY} zoom={game.coverZoom} kind={sys?.kind} /></div>
                    </div>
                  )
                })()}
              {current && current.kind !== 'image' && <span className="bp-badge"><span className="dot" /> {current.kind === 'clip' ? 'Your clip' : 'Trailer · IGDB'}</span>}
            </figure>
            {media.length > 1 && (
              <div className="bp-thumbs">
                {media.slice(0, 6).map((m, i) => (
                  <button key={i} className={`bp-thumb ${i === mediaIdx ? 'on' : ''}`} onClick={() => setMediaIdx(i)} aria-label={m.kind === 'image' ? 'Screenshot' : m.kind === 'clip' ? 'Your clip' : 'Trailer'}>
                    {m.kind === 'image' ? <span style={{ backgroundImage: `url("${imgUrl(m.src)}")` }} /> : <span className="vid">▶ {m.kind === 'clip' ? 'Clip' : 'Trailer'}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <section className="bp-side">
            <span className="bp-kicker">{[sys?.name, game.copies[0] ? (game.copies[0].format === 'physical' ? 'Physical' : 'Digital') : ''].filter(Boolean).join(' · ')}</span>
            <LogoOrTitle game={game} small />
            <div className="bp-meta">
              {game.releaseDate && <span>{formatReleaseDate(game.releaseDate)}</span>}
              {game.developer && <span>{game.developer}</span>}
            </div>
            <div className="bp-stats">
              <div><b>{formatPlayTime(game.playSeconds) || '—'}</b><small>Played</small></div>
              <div><b className="bp-stars">{game.rating != null ? '★'.repeat(game.rating) : '—'}</b><small>My rating</small></div>
              <div><b>{game.lastPlayedAt ? formatSince(game.lastPlayedAt) : '—'}</b><small>Last played</small></div>
            </div>
            <nav className="bp-actions" aria-label="Game actions">
              {actions.map((a, i) => (
                <button key={a.label} className={`bp-action ${i === action ? 'on' : ''}`} onClick={() => { setAction(i); a.run() }} data-testid="bp-action">
                  {glyph(a.key, a.cls)}
                  <span className="label">{a.label}</span>
                  <span className="hint">{a.hint}</span>
                </button>
              ))}
            </nav>
            {game.collectionIds.length > 0 && <p className="bp-cols">In {game.collectionIds.map((c) => collectionsById.get(c)?.name).filter(Boolean).join(', ')}</p>}
          </section>
        </div>
      )}

      <footer className="bp-hints">
        {screen === 'game' ? (
          <>
            <span>{glyph('A', 'a')} Select</span><span>{glyph('B', 'b')} Back</span><span>{glyph('Y', 'y')} Favorite</span><span>{glyph('X', 'x')} Backlog</span><span>{glyph('LB', 'shoulder')}{glyph('RB', 'shoulder')} Prev / next game</span>
          </>
        ) : (
          <>
            <span>{glyph('A', 'a')} Play</span><span>{glyph('X', 'x')} Details</span><span>{glyph('Y', 'y')} Favorite</span><span>{glyph('LB', 'shoulder')}{glyph('RB', 'shoulder')} Shelves</span><span>{glyph('☰', 'neutral')} Menu</span>
          </>
        )}
      </footer>

      {notice && <div className="bp-notice" role="status">{notice}</div>}

      {screen === 'menu' && (
        <div className="bp-menu-wrap" onClick={() => setScreen('home')}>
          <div className="bp-menu" role="menu" onClick={(e) => e.stopPropagation()} data-testid="bp-menu">
            <h2>GameVault</h2>
            {menu.map((m, i) => (
              <button key={m.label} role="menuitem" className={`bp-action ${i === menuIdx ? 'on' : ''}`} onClick={m.run} data-testid="bp-menu-item">
                <span className="label">{m.label}</span>
              </button>
            ))}
            <p className="bp-menu-tip">Keyboard: arrows, Enter, Esc · F11 leaves Big Picture</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** A game's transparent logo, falling back to its title when there is none (or it fails to load). */
function LogoOrTitle({ game, small, testId }: { game: Game; small?: boolean; testId?: string }): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const ok = game.logoFile && failed !== game.logoFile
  return (
    <>
      {ok && (
        <img
          className={`bp-logo ${small ? 'small' : ''}`}
          src={imgUrl(game.logoFile as string)}
          alt=""
          onError={() => setFailed(game.logoFile)}
          onLoad={(e) => (e.currentTarget.naturalWidth < 40 ? setFailed(game.logoFile) : undefined)}
        />
      )}
      <h1 className={ok ? 'sr-only' : `bp-title ${small ? 'small' : ''}`} data-testid={testId}>{game.title}</h1>
    </>
  )
}

type Media = { kind: 'clip' | 'trailer' | 'image'; src: string }

/** What can play on a game's page: the user's clip first, then IGDB trailers (online), then screenshots. */
function mediaFor(game: Game, prefs: AppPrefs | null): Media[] {
  const out: Media[] = []
  if (game.clipFile) out.push({ kind: 'clip', src: game.clipFile })
  if (prefs?.playTrailers !== false && navigator.onLine) for (const v of game.videoIds.slice(0, 2)) out.push({ kind: 'trailer', src: v })
  for (const im of game.images.slice(0, 6)) out.push({ kind: 'image', src: im.file })
  return out
}
