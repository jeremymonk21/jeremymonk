import { useCallback, useEffect, useRef, useState } from 'react'
import type { CopyInput, Game, GameCopy, LaunchCheck, PlayStatus } from '@shared/types'
import { PLAY_STATUSES, PLAY_STATUS_LABELS } from '@shared/types'
import { formatPlayTime, formatReleaseDate, formatSince } from '@shared/filter'
import { CollectionMenu } from './Organize'
import { swatchFor } from './Filters'
import { imgUrl, Modal, useApp } from '../state'
import { Cover } from './Cover'
import { Stars } from './Gallery'
import { gameToInput, LaunchFields } from './LaunchFields'
import { IconBack, IconCloud, IconDisc, IconEdit, IconHeart, IconPlay, IconPlus, IconRefresh, IconSteam, IconTrash, IconX } from './Icons'

type NotesState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function DetailView({ game, onClose, onEdit, onGotIt }: { game: Game; onClose: () => void; onEdit: () => void; onGotIt?: () => void }): JSX.Element {
  const { putGame, dropGame, toast, confirm, systemsById, genresById, categoriesById, collectionsById, lib, registerFlush, reload } = useApp()
  const [colMenu, setColMenu] = useState(false)
  const [checks, setChecks] = useState<Record<number, LaunchCheck>>({})
  const [launching, setLaunching] = useState<number | null>(null)
  const [launchEdit, setLaunchEdit] = useState<CopyInput | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [newCat, setNewCat] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // ---- notes autosave ----
  const [notes, setNotes] = useState(game.notes)
  const [notesState, setNotesState] = useState<NotesState>('idle')
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>()
  const gameId = game.id

  const flushNotes = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const value = pending.current
    if (value == null) return
    setNotesState('saving')
    try {
      const g = await window.api.patchGame(gameId, { notes: value })
      if (pending.current === value) pending.current = null
      putGame(g)
      setNotesState(pending.current == null ? 'saved' : 'dirty')
    } catch (e) {
      setNotesState('error')
      toast(`Your notes could not be saved: ${(e as Error).message}`, 'error')
      throw e
    }
  }, [gameId, putGame, toast])

  useEffect(() => registerFlush(flushNotes), [registerFlush, flushNotes])
  useEffect(() => () => void flushNotes().catch(() => undefined), [flushNotes])
  useEffect(() => {
    setNotes(game.notes)
    pending.current = null
    setNotesState('idle')
    scrollRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  const onNotes = (v: string): void => {
    setNotes(v)
    pending.current = v
    setNotesState('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flushNotes().catch(() => undefined), 700)
  }

  // ---- launch checks ----
  const copiesKey = JSON.stringify(game.copies)
  const runChecks = useCallback(async () => {
    const out: Record<number, LaunchCheck> = {}
    await Promise.all(
      game.copies
        .filter((c) => c.launchType !== 'none')
        .map(async (c) => {
          try {
            out[c.id] = await window.api.checkLaunch(c.id)
          } catch (e) {
            out[c.id] = { copyId: c.id, state: 'unknown', message: (e as Error).message }
          }
        })
    )
    setChecks(out)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copiesKey])
  useEffect(() => {
    runChecks()
  }, [runChecks])

  const patch = async (p: Parameters<typeof window.api.patchGame>[1]): Promise<void> => {
    try {
      putGame(await window.api.patchGame(game.id, p))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const genreNames = game.genreIds.map((id) => genresById.get(id)?.name).filter(Boolean) as string[]

  const saveCopies = async (copies: CopyInput[]): Promise<boolean> => {
    try {
      const g = await window.api.saveGame({ ...gameToInput(game, genreNames), copies })
      putGame(g)
      return true
    } catch (e) {
      toast((e as Error).message, 'error')
      return false
    }
  }

  const launch = async (c: GameCopy): Promise<void> => {
    setLaunching(c.id)
    try {
      const r = await window.api.launch(c.id)
      if (r.ok) {
        toast(`${game.title}: ${r.message}`, 'success')
        if (game.playStatus === 'not_started') patch({ playStatus: 'playing' })
      } else if (r.state === 'not_installed' && c.steamAppId) {
        toast(r.message, 'error', { label: 'Install in Steam', run: () => window.api.steamInstall(c.steamAppId as number) })
      } else if (r.state === 'missing_file') {
        toast(`${r.message}. The game may have been moved or uninstalled.`, 'error', { label: 'Fix path', run: () => setLaunchEdit({ ...c }) })
      } else toast(r.message, 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLaunching(null)
      runChecks()
    }
  }

  const removeLaunch = async (c: GameCopy): Promise<void> => {
    const ok = await confirm({ title: 'Remove launch method?', body: <p>The game stays in your collection; only the {c.launchType === 'steam' ? 'Steam launch' : 'launch path'} for this copy is removed.</p>, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    if (await saveCopies(game.copies.map((x) => (x.id === c.id ? { ...x, launchType: 'none', launchTarget: '', launchArgs: '', launchWorkDir: '' } : x)))) toast('Launch method removed.', 'success')
  }

  const del = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${game.title}"?`,
      body: <p>This removes the game, its notes, rating and images from your collection. This cannot be undone (unless you restore a backup).</p>,
      confirmLabel: 'Delete game',
      danger: true
    })
    if (!ok) return
    try {
      pending.current = null
      await window.api.deleteGame(game.id)
      dropGame(game.id)
      onClose()
      toast(`Deleted "${game.title}".`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const toggleCategory = (id: number): void => {
    patch({ categoryIds: game.categoryIds.includes(id) ? game.categoryIds.filter((x) => x !== id) : [...game.categoryIds, id] })
  }
  const addCategory = async (): Promise<void> => {
    const name = newCat.trim()
    if (!name) return
    try {
      const existing = lib?.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
      const tag = existing ?? (await window.api.createTag('categories', name))
      if (!existing) await reload()
      setNewCat('')
      if (!game.categoryIds.includes(tag.id)) await patch({ categoryIds: [...game.categoryIds, tag.id] })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const refreshIgdb = async (): Promise<void> => {
    try {
      putGame(await window.api.refreshIgdb(game.id))
      await reload()
      toast('Details refreshed from IGDB. Your notes, rating and edited fields were kept.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const refreshSteam = async (): Promise<void> => {
    try {
      await window.api.steamRefresh([game.id], { fetchMetadata: true, downloadArtwork: true })
      toast('Refreshing from Steam… your notes, rating and edited fields are kept.', 'info')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !launchEdit && !lightbox && !document.querySelector('.overlay')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, launchEdit, lightbox])

  const ready = game.copies.filter((c) => checks[c.id]?.state === 'ready')
  const primaryPlay = ready[0]
  const systemsList = [...new Set(game.copies.map((c) => systemsById.get(c.systemId)?.name).filter(Boolean))]
  const formats = [...new Set(game.copies.map((c) => c.format))]
  const stores = [...new Set(game.copies.map((c) => c.store).filter(Boolean))]
  const firstKind = game.copies[0] ? systemsById.get(game.copies[0].systemId)?.kind : undefined

  return (
    <div className="detail" ref={scrollRef} data-testid="detail">
      <div className="detail-hero">
        {game.coverFile && <div className="hero-bg" style={{ backgroundImage: `url("${imgUrl(game.coverFile)}")` }} />}
        <div className="detail-top">
          <button className="btn" onClick={onClose} data-testid="detail-back"><IconBack size={16} /> Back</button>
          <span className="spacer" />
          {game.igdbId ? (
            <button className="btn" onClick={refreshIgdb} title="Re-download details from IGDB" data-testid="refresh-igdb"><IconRefresh size={16} /> Refresh details</button>
          ) : (
            game.steamAppId && <button className="btn" onClick={refreshSteam} title="Re-download metadata and artwork from Steam"><IconRefresh size={16} /> Refresh from Steam</button>
          )}
          <button className="btn" onClick={onEdit} data-testid="detail-edit"><IconEdit size={16} /> Edit</button>
          <button className="btn danger" onClick={del} data-testid="detail-delete"><IconTrash size={16} /> Delete</button>
        </div>
        <div className="detail-body">
          <div>
            <div className="detail-cover">
              <Cover file={game.coverFile} title={game.title} fit={game.coverFit} posX={game.coverPosX} posY={game.coverPosY} zoom={game.coverZoom} kind={firstKind} />
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="detail-title" data-testid="detail-title">{game.title}</h1>
            <div className="detail-sub">
              <span>{systemsList.join(' · ') || 'No system'}</span>
              {formats.map((f) => (
                <span key={f} className="row" style={{ gap: 5 }}>{f === 'physical' ? <IconDisc size={14} /> : <IconCloud size={14} />}{f === 'physical' ? 'Physical' : 'Digital'}</span>
              ))}
              {game.releaseDate && <span>{formatReleaseDate(game.releaseDate)}</span>}
              {game.isSample && <span className="tag">Sample</span>}
            </div>
            <div className="detail-actions">
              {primaryPlay && (
                <button className="btn play lg" onClick={() => launch(primaryPlay)} disabled={launching != null} data-testid="play">
                  {launching === primaryPlay.id ? <span className="spinner" /> : <IconPlay size={18} />} Play
                  {ready.length > 1 && <span className="small" style={{ opacity: .8 }}>({systemsById.get(primaryPlay.systemId)?.name}{primaryPlay.store ? ` · ${primaryPlay.store}` : ''})</span>}
                </button>
              )}
              <button className={`btn lg ${game.favorite ? 'toggled' : ''}`} onClick={() => patch({ favorite: !game.favorite })} aria-pressed={game.favorite} data-testid="detail-fav">
                <IconHeart size={18} filled={game.favorite} color={game.favorite ? 'var(--fav)' : undefined} /> {game.favorite ? 'Favorite' : 'Add to favorites'}
              </button>
              {game.wishlist ? (
                onGotIt && <button className="btn play lg" onClick={onGotIt} data-testid="detail-got-it">I got it!</button>
              ) : (
                <button
                  className={`btn lg ${game.backlog ? 'toggled-warn' : ''}`}
                  onClick={() => patch({ backlog: !game.backlog })}
                  aria-pressed={game.backlog}
                  disabled={game.playStatus === 'playing' && !game.backlog}
                  title={game.playStatus === 'playing' ? 'Games you are playing are not in the backlog' : undefined}
                  data-testid="detail-backlog"
                >
                  {game.backlog ? '✓ In Backlog' : '+ Backlog'}
                </button>
              )}
              <span className="spacer" />
              <div className="row" style={{ gap: 8 }}>
                <span className="muted small">My rating</span>
                <Stars value={game.rating} onChange={(v) => patch({ rating: v })} size={22} />
                {game.rating != null && <button className="btn ghost sm" onClick={() => patch({ rating: null })} data-testid="clear-rating">Clear</button>}
              </div>
            </div>

            <div className="section">
              <h3>Play status</h3>
              <div className="segmented" role="radiogroup" aria-label="Play status">
                {PLAY_STATUSES.map((s: PlayStatus) => (
                  <button key={s} role="radio" aria-checked={game.playStatus === s} className={game.playStatus === s ? 'on' : ''} onClick={() => patch({ playStatus: s })} data-testid={`status-${s}`}>
                    {PLAY_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {game.wishlist && (
              <div className="banner" style={{ marginTop: 16 }}>
                <span className="grow">This game is on your <b>wishlist</b>. It isn't counted in your collection until you mark it as owned.</span>
              </div>
            )}
            {!game.wishlist && <PlayTime game={game} />}

            <div className="section">
              <h3>
                <span>{game.wishlist ? 'Wishlist note' : 'My notes'}</span>
                <span className={`notes-status ${notesState === 'saved' ? 'saved' : notesState === 'error' ? 'error' : ''}`} data-testid="notes-status">
                  {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : notesState === 'dirty' ? 'Unsaved changes…' : notesState === 'error' ? (
                    <>Not saved — <button className="btn sm" onClick={() => flushNotes().catch(() => undefined)}>Retry</button></>
                  ) : 'Saved automatically'}
                </span>
              </h3>
              <textarea
                className="textarea"
                style={{ width: '100%', minHeight: 130 }}
                value={notes}
                placeholder="Thoughts, progress, tips, who you lent it to…"
                onChange={(e) => onNotes(e.target.value)}
                onBlur={() => void flushNotes().catch(() => undefined)}
                data-testid="notes"
              />
            </div>

            {!game.wishlist && (
              <div className="section">
                <h3>Collections</h3>
                <div className="row wrap" style={{ gap: 8 }}>
                  {game.collectionIds.map((id) => {
                    const c = collectionsById.get(id)
                    return c ? (
                      <span key={id} className="tag cat" style={{ height: 28, fontSize: 13 }} data-testid="detail-collection-tag">
                        <span className="nav-swatch" style={{ width: 10, height: 10, borderRadius: 3, background: swatchFor(c.name) }} />
                        {c.name}
                        <button aria-label={`Remove from ${c.name}`} title={`Remove from ${c.name}`} onClick={() => patch({ collectionIds: game.collectionIds.filter((x) => x !== id) })}><IconX size={12} /></button>
                      </span>
                    ) : null
                  })}
                  <div className="dropdown">
                    <button className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setColMenu((m) => !m)} data-testid="detail-add-collection"><IconPlus size={13} /> Add to collection</button>
                    {colMenu && (
                      <CollectionMenu
                        checked={game.collectionIds}
                        onClose={() => setColMenu(false)}
                        onToggle={(c, on) => patch({ collectionIds: on ? [...game.collectionIds, c.id] : game.collectionIds.filter((x) => x !== c.id) })}
                        onCreate={async (name) => {
                          try {
                            const c = await window.api.createCollection(name)
                            await window.api.setCollectionMembers(c.id, [game.id], true)
                            await reload()
                          } catch (e) {
                            toast((e as Error).message, 'error')
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="section">
              <h3>Custom categories</h3>
              <div className="row wrap" style={{ gap: 8 }}>
                {(lib?.categories ?? []).map((c) => (
                  <button key={c.id} className={`chip ${game.categoryIds.includes(c.id) ? 'on' : ''}`} onClick={() => toggleCategory(c.id)} aria-pressed={game.categoryIds.includes(c.id)}>
                    {c.name}
                  </button>
                ))}
                <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); addCategory() }}>
                  <input className="input" style={{ height: 30, width: 170 }} placeholder="New category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} data-testid="new-category" />
                  <button className="btn sm" type="submit" disabled={!newCat.trim()}><IconPlus size={14} /> Add</button>
                </form>
              </div>
            </div>

            <div className="section">
              <h3>About</h3>
              {game.description ? <p className="desc" style={{ marginTop: 0 }}>{game.description}</p> : <p className="muted" style={{ marginTop: 0 }}>No description yet. Use Edit to add one.</p>}
              <dl className="kv">
                <dt>Genres</dt>
                <dd>{genreNames.length ? <span className="row wrap" style={{ gap: 6 }}>{genreNames.map((n) => <span key={n} className="tag">{n}</span>)}</span> : <span className="muted">—</span>}</dd>
                <dt>Categories</dt>
                <dd>{game.categoryIds.length ? <span className="row wrap" style={{ gap: 6 }}>{game.categoryIds.map((id) => <span key={id} className="tag cat">{categoriesById.get(id)?.name}</span>)}</span> : <span className="muted">—</span>}</dd>
                <dt>Developer</dt>
                <dd>{game.developer || <span className="muted">—</span>}</dd>
                <dt>Publisher</dt>
                <dd>{game.publisher || <span className="muted">—</span>}</dd>
                <dt>Release date</dt>
                <dd>{game.releaseDate ? formatReleaseDate(game.releaseDate) : <span className="muted">—</span>}</dd>
                <dt>Store / launcher</dt>
                <dd>{stores.length ? stores.join(', ') : <span className="muted">—</span>}</dd>
                {game.steamAppId && (
                  <>
                    <dt>Steam App ID</dt>
                    <dd>{game.steamAppId}</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="section">
              <h3>Copies & launching</h3>
              {game.copies.length === 0 && <p className="muted" style={{ margin: 0 }}>No copies recorded. Use Edit to add a system.</p>}
              {game.copies.map((c) => {
                const sys = systemsById.get(c.systemId)
                const chk = checks[c.id]
                return (
                  <div className="copy-row" key={c.id} data-testid="copy-row">
                    <div className="copy-main">
                      <div className="name">
                        {sys?.name ?? 'Unknown system'} · {c.format === 'physical' ? 'Physical' : 'Digital'}
                        {c.store ? ` · ${c.store}` : ''}
                      </div>
                      <div className="sub">
                        {c.launchType === 'none' && (c.store === 'Steam' ? 'Owned on Steam — launching not set up on this PC.' : 'Owned — collection entry.')}
                        {c.launchType === 'steam' && `Launches via Steam (App ID ${c.steamAppId ?? '?'})`}
                        {c.launchType === 'emulator' && `${lib?.emulators.find((e) => e.id === c.emulatorId)?.name ?? 'Emulator'} · ${c.launchTarget}`}
                        {(c.launchType === 'executable' || c.launchType === 'shortcut') && `${c.launchTarget}${c.launchArgs ? `  ${c.launchArgs}` : ''}`}
                      </div>
                      {chk && chk.state !== 'ready' && <div className="sub err-text" data-testid="launch-problem">{chk.message}</div>}
                    </div>
                    <LaunchPill copy={c} check={chk} />
                    {chk?.state === 'ready' && (
                      <button className="btn play sm" onClick={() => launch(c)} disabled={launching != null}><IconPlay size={14} /> Play</button>
                    )}
                    {chk?.state === 'not_installed' && c.steamAppId && (
                      <button className="btn sm" onClick={() => window.api.steamInstall(c.steamAppId as number)}><IconSteam size={14} /> Install in Steam</button>
                    )}
                    {c.launchType === 'none' && c.steamAppId && (
                      <button className="btn sm" onClick={() => saveCopies(game.copies.map((x) => (x.id === c.id ? { ...x, launchType: 'steam' } : x)))}>
                        <IconSteam size={14} /> Launch via Steam
                      </button>
                    )}
                    <button className="btn sm" onClick={() => setLaunchEdit({ ...c })} data-testid="configure-launch">
                      {c.launchType === 'none' ? 'Set up launch…' : 'Edit launch…'}
                    </button>
                    {c.launchType !== 'none' && <button className="btn sm danger" onClick={() => removeLaunch(c)} data-testid="remove-launch">Remove</button>}
                  </div>
                )
              })}
            </div>

            {game.images.length > 0 && (
              <div className="section">
                <h3>Images</h3>
                <div className="thumbs">
                  {game.images.map((im) => (
                    <div className="thumb" key={im.id} onClick={() => setLightbox(im.file)}>
                      <img src={imgUrl(im.file)} alt="" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {launchEdit && (
        <LaunchDialog
          copy={launchEdit}
          isPc={systemsById.get(launchEdit.systemId)?.kind === 'pc'}
          onClose={() => setLaunchEdit(null)}
          onSave={async (c) => {
            if (await saveCopies(game.copies.map((x) => (x.id === c.id ? { ...x, ...c } : x)))) {
              setLaunchEdit(null)
              toast('Launch settings saved.', 'success')
            }
          }}
        />
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={imgUrl(lightbox)} alt="" />
        </div>
      )}
    </div>
  )
}

function LaunchPill({ copy, check }: { copy: GameCopy; check?: LaunchCheck }): JSX.Element {
  if (copy.launchType === 'none') return <span className="status-pill owned">Owned</span>
  if (!check) return <span className="status-pill owned"><span className="spinner" style={{ width: 12, height: 12 }} /> Checking</span>
  if (check.state === 'ready') return <span className="status-pill ready" data-testid="pill-installed">Installed</span>
  if (check.state === 'missing_file') return <span className="status-pill err" data-testid="pill-missing">File missing</span>
  if (check.state === 'not_installed') return <span className="status-pill warn">Not installed</span>
  if (check.state === 'steam_missing') return <span className="status-pill warn">Steam not found</span>
  return <span className="status-pill warn">Not set up</span>
}

function LaunchDialog({ copy, isPc, onClose, onSave }: { copy: CopyInput; isPc: boolean; onClose: () => void; onSave: (c: CopyInput) => void }): JSX.Element {
  const [c, setC] = useState(copy)
  const invalid = (c.launchType === 'executable' || c.launchType === 'shortcut') && !c.launchTarget.trim()
  const steamInvalid = c.launchType === 'steam' && !c.steamAppId
  return (
    <Modal title="Launch settings" onClose={onClose} size="mid">
      <div className="modal-body">
        <LaunchFields copy={c} onChange={setC} isPc={isPc} />
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={invalid || steamInvalid} onClick={() => onSave(c)} data-testid="save-launch">Save</button>
      </div>
    </Modal>
  )
}

/** Play time panel: totals plus a 14-day chart of tracked sessions. */
function PlayTime({ game }: { game: Game }): JSX.Element {
  const [days, setDays] = useState<number[] | null>(null)
  useEffect(() => {
    let alive = true
    window.api.dailyPlay(game.id, 14).then((d) => alive && setDays(d)).catch(() => alive && setDays([]))
    return () => {
      alive = false
    }
  }, [game.id, game.playSeconds])
  const max = Math.max(1, ...(days ?? [0]))
  const total = formatPlayTime(game.playSeconds)
  return (
    <div className="section" data-testid="playtime">
      <h3>Play time</h3>
      <div className="playtime-grid">
        <div><div className="big-num" data-testid="playtime-total">{total || '0m'}</div><div className="muted small">Total</div></div>
        <div><div className="big-num">{game.sessionCount}</div><div className="muted small">Sessions</div></div>
        <div><div className="big-num">{game.lastPlayedAt ? formatSince(game.lastPlayedAt) : '—'}</div><div className="muted small">Last played</div></div>
      </div>
      {days && days.some((d) => d > 0) ? (
        <>
          <div className="playtime-bars" role="img" aria-label="Minutes played each of the last 14 days">
            {days.map((d, i) => (
              <div key={i} title={formatPlayTime(d) || 'not played'} style={{ height: `${Math.max(4, Math.round((d / max) * 46))}px`, opacity: d ? 1 : 0.25 }} />
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Last 14 days</div>
        </>
      ) : (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Time is tracked automatically when you press Play in GameVault.{game.steamAppId ? ' Hours from your Steam import are included in the total.' : ''}
        </p>
      )}
    </div>
  )
}
