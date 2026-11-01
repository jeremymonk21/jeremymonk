import { useEffect, useMemo, useRef, useState } from 'react'
import type { CopyInput, Game, GameInput, LookupResult, MetadataField } from '@shared/types'
import { PLAY_STATUSES, PLAY_STATUS_LABELS } from '@shared/types'
import { parseLooseDate } from '@shared/filter'
import { imgUrl, Modal, useApp } from '../state'
import { Cover } from './Cover'
import { Stars } from './Gallery'
import { gameToInput, LaunchFields } from './LaunchFields'
import { IconImage, IconLock, IconPlus, IconSearch, IconTrash, IconUpload, IconX } from './Icons'

const STORES = [
  'Steam', 'Epic Games Store', 'GOG', 'Xbox app / Microsoft Store', 'EA app', 'Ubisoft Connect', 'Battle.net', 'itch.io',
  'Amazon Games', 'Humble', 'PlayStation Store', 'Nintendo eShop', 'Xbox Store', 'Retail', 'Other'
]

function emptyInput(defaultSystemId: number | null): GameInput {
  return {
    title: '',
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
    steamAppId: null,
    genreNames: [],
    categoryIds: [],
    imageFiles: [],
    copies: defaultSystemId
      ? [{ systemId: defaultSystemId, format: 'physical', store: '', steamAppId: null, launchType: 'none', launchTarget: '', launchArgs: '', launchWorkDir: '' }]
      : []
  }
}

export function GameEditor({ game, defaultSystemId, onClose, onSaved }: { game: Game | null; defaultSystemId: number | null; onClose: () => void; onSaved: (g: Game) => void }): JSX.Element {
  const { lib, genresById, toast, confirm, reload, systemsById } = useApp()
  const initial = useMemo(
    () => (game ? gameToInput(game, game.genreIds.map((id) => genresById.get(id)?.name ?? '').filter(Boolean)) : emptyInput(defaultSystemId ?? lib?.systems[0]?.id ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [v, setV] = useState<GameInput>(initial)
  const [saving, setSaving] = useState(false)
  const [genreDraft, setGenreDraft] = useState('')
  const [dateDraft, setDateDraft] = useState(initial.releaseDate)
  const [dateError, setDateError] = useState('')
  const [titleError, setTitleError] = useState('')
  const [showLaunch, setShowLaunch] = useState<Record<number, boolean>>({})
  const set = (p: Partial<GameInput>): void => setV((x) => ({ ...x, ...p }))
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const isSteam = game?.source === 'steam' || !!game?.steamAppId

  // ---- online details lookup ----
  type Hit = { appId: number; name: string; thumb: string }
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [applying, setApplying] = useState<number | null>(null)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [lookupDismissed, setLookupDismissed] = useState(false)
  const lastSearched = useRef('')

  const runSearch = async (term: string): Promise<void> => {
    const q = term.trim()
    if (q.length < 2) return
    lastSearched.current = q.toLowerCase()
    setSearching(true)
    setSearchError('')
    try {
      const r = await window.api.searchDetails(q)
      if (lastSearched.current === q.toLowerCase()) setHits(r)
    } catch (e) {
      setSearchError((e as Error).message)
      setHits(null)
    } finally {
      setSearching(false)
    }
  }

  // When adding a new game, look the title up automatically after a short pause in typing.
  useEffect(() => {
    if (game || lookup || lookupDismissed) return
    const q = v.title.trim()
    if (q.length < 3 || q.toLowerCase() === lastSearched.current) return
    const t = window.setTimeout(() => void runSearch(q), 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.title, game, lookup, lookupDismissed])

  const applyHit = async (hit: Hit): Promise<void> => {
    setApplying(hit.appId)
    try {
      const d = await window.api.lookupDetails(hit.appId)
      setLookup(d)
      setHits(null)
      setV((x) => {
        const next: GameInput = {
          ...x,
          title: d.title || x.title,
          description: d.description || x.description,
          developer: d.developer || x.developer,
          publisher: d.publisher || x.publisher,
          releaseDate: d.releaseDate || x.releaseDate,
          genreNames: d.genres.length ? d.genres : x.genreNames,
          steamAppId: x.steamAppId ?? d.appId
        }
        if (d.coverFile) {
          if (!x.coverFile) Object.assign(next, { coverFile: d.coverFile, coverFit: d.coverPortrait ? 'cover' : 'contain', coverPosX: 50, coverPosY: 50, coverZoom: 1 })
          else next.imageFiles = [...x.imageFiles, d.coverFile] // keep the user's own cover; offer the found art as an extra image
        }
        return next
      })
      if (d.releaseDate) setDateDraft(d.releaseDate)
      toast(`Filled in details for "${d.title}". Review them, then save.`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setApplying(null)
    }
  }

  /** Fields still holding exactly what the lookup returned (not manual edits). */
  const sourceFields = (final: GameInput): MetadataField[] => {
    if (!lookup) return []
    const out: MetadataField[] = []
    if (final.title === lookup.title) out.push('title')
    if (final.description === lookup.description) out.push('description')
    if (final.developer === lookup.developer) out.push('developer')
    if (final.publisher === lookup.publisher) out.push('publisher')
    if (final.releaseDate === lookup.releaseDate) out.push('releaseDate')
    if (final.genreNames.map((g) => g.toLowerCase()).sort().join('|') === lookup.genres.map((g) => g.toLowerCase()).sort().join('|')) out.push('genres')
    if (lookup.coverFile && final.coverFile === lookup.coverFile) out.push('cover')
    return out
  }

  const tryClose = async (): Promise<void> => {
    if (dirty && !(await confirm({ title: 'Discard changes?', body: <p>You have unsaved changes to this game.</p>, confirmLabel: 'Discard', danger: true }))) return
    onClose()
  }

  const commitDate = (): string | null => {
    const raw = dateDraft.trim()
    if (!raw) {
      setDateError('')
      return ''
    }
    const parsed = parseLooseDate(raw)
    if (!parsed) {
      setDateError('Use a date like 2023-09-14, 2023-09 or 2023.')
      return null
    }
    setDateError('')
    setDateDraft(parsed)
    return parsed
  }

  const save = async (): Promise<void> => {
    if (!v.title.trim()) {
      setTitleError('Please enter a title.')
      return
    }
    const date = commitDate()
    if (date === null) return
    const copies = v.copies.filter((c) => c.systemId)
    for (const c of copies) {
      if ((c.launchType === 'executable' || c.launchType === 'shortcut') && !c.launchTarget.trim()) {
        toast('A copy is set to launch a program but no file is selected. Choose a file or set the launch method to "Not launchable".', 'error')
        return
      }
      if (c.launchType === 'steam' && !c.steamAppId) {
        toast('A copy is set to launch through Steam but has no Steam App ID.', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const final: GameInput = { ...v, releaseDate: date, copies, genreNames: [...v.genreNames, ...(genreDraft.trim() ? [genreDraft.trim()] : [])] }
      const fromLookup = sourceFields(final)
      if (!game && lookup) {
        // New game: anything changed after the lookup counts as a manual edit and is kept on refresh.
        const all: MetadataField[] = ['title', 'description', 'developer', 'publisher', 'releaseDate', 'genres', 'cover']
        final.lockedFields = all.filter((f) => !fromLookup.includes(f) && (f !== 'cover' || !!final.coverFile))
      }
      final.sourceFields = fromLookup
      const g = await window.api.saveGame(final)
      await reload()
      toast(game ? 'Changes saved.' : `Added "${g.title}".`, 'success')
      onSaved(g)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const addGenre = (name: string): void => {
    const n = name.trim().replace(/,$/, '')
    if (!n) return
    if (!v.genreNames.some((g) => g.toLowerCase() === n.toLowerCase())) set({ genreNames: [...v.genreNames, n] })
    setGenreDraft('')
  }

  const pickCover = async (): Promise<void> => {
    try {
      const [f] = await window.api.pickImages(false)
      if (f) set({ coverFile: f, coverPosX: 50, coverPosY: 50, coverZoom: 1 })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const pickExtra = async (): Promise<void> => {
    try {
      const files = await window.api.pickImages(true)
      if (files.length) set({ imageFiles: [...v.imageFiles, ...files] })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const updateCopy = (i: number, c: CopyInput): void => set({ copies: v.copies.map((x, j) => (j === i ? c : x)) })
  const addCopy = (): void =>
    set({
      copies: [
        ...v.copies,
        { systemId: lib?.systems[0]?.id ?? 0, format: 'digital', store: '', steamAppId: null, launchType: 'none', launchTarget: '', launchArgs: '', launchWorkDir: '' }
      ]
    })
  const removeCopy = async (i: number): Promise<void> => {
    const c = v.copies[i]
    if (c.id && !(await confirm({ title: 'Remove this copy?', body: <p>This removes the {systemsById.get(c.systemId)?.name} {c.format} copy (and its launch settings) when you save.</p>, confirmLabel: 'Remove', danger: true })))
      return
    set({ copies: v.copies.filter((_, j) => j !== i) })
  }

  const locked = (f: MetadataField): JSX.Element | null =>
    isSteam && v.lockedFields?.includes(f) ? (
      <button type="button" className="lock" title="You edited this field, so Steam refreshes will not overwrite it. Click to let Steam update it again." onClick={() => set({ lockedFields: v.lockedFields?.filter((x) => x !== f) })}>
        <IconLock size={11} /> Kept on refresh · unlock
      </button>
    ) : null

  const existingGenres = (lib?.genres ?? []).filter((g) => !v.genreNames.some((n) => n.toLowerCase() === g.name.toLowerCase()))
  const genreSuggest = genreDraft ? existingGenres.filter((g) => g.name.toLowerCase().includes(genreDraft.toLowerCase())).slice(0, 8) : existingGenres.slice(0, 12)

  return (
    <Modal title={game ? `Edit ${game.title}` : 'Add a game'} onClose={tryClose} size="wide" closeOnBackdrop={false}>
      <div className="modal-body">
        <div className="editor-grid">
          <div>
            <CoverEditor v={v} set={set} onPick={pickCover} kind={v.copies[0] ? systemsById.get(v.copies[0].systemId)?.kind : undefined} />
            {locked('cover')}
          </div>
          <div style={{ display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 }}>
            <label className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>Title * {locked('title')}</span>
              <input className="input" autoFocus value={v.title} onChange={(e) => { set({ title: e.target.value }); setTitleError('') }} placeholder="Game title" data-testid="edit-title" />
              {titleError && <span className="err-text small">{titleError}</span>}
            </label>

            <div className="lookup" data-testid="lookup">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">
                  {lookup
                    ? <>Details filled in from the Steam Store catalogue (App ID {lookup.appId}). Edit anything you like before saving.</>
                    : <>Find the description, genres, dates and box art online — works for games you own anywhere.</>}
                </span>
                <button type="button" className="btn sm" disabled={v.title.trim().length < 2 || searching} onClick={() => { setLookupDismissed(false); runSearch(v.title) }} data-testid="lookup-search">
                  {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconSearch size={14} />} {lookup ? 'Look up again' : 'Find details online'}
                </button>
              </div>
              {searchError && <div className="err-text small" style={{ marginTop: 6 }}>Couldn't search online: {searchError} You can still fill everything in by hand.</div>}
              {hits && hits.length === 0 && <div className="small muted" style={{ marginTop: 6 }}>No matches on the Steam Store for "{lastSearched.current}". Console-only games often aren't listed — fill the details in by hand.</div>}
              {hits && hits.length > 0 && (
                <div className="lookup-hits">
                  {hits.map((h) => (
                    <button type="button" key={h.appId} className="lookup-hit" onClick={() => applyHit(h)} disabled={applying != null} data-testid="lookup-hit">
                      <img src={h.thumb} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                      <span className="name">{h.name}</span>
                      {applying === h.appId ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <span className="use">Use</span>}
                    </button>
                  ))}
                  <button type="button" className="btn sm ghost" onClick={() => { setHits(null); setLookupDismissed(true) }}>None of these</button>
                </div>
              )}
            </div>

            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="field" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Systems & formats — add one row per copy you own</span>
                <button type="button" className="btn sm" onClick={addCopy} data-testid="add-copy"><IconPlus size={14} /> Add copy</button>
              </div>
              {v.copies.length === 0 && <div className="banner warn small">Add at least one copy so the game appears under a system.</div>}
              {v.copies.map((c, i) => {
                const sys = systemsById.get(c.systemId)
                return (
                  <div className="copy-card" key={c.id ?? `new-${i}`} data-testid="copy-card">
                    <div className="grid-3">
                      <label className="field">
                        System
                        <select className="select" value={c.systemId} onChange={(e) => updateCopy(i, { ...c, systemId: Number(e.target.value) })} data-testid="copy-system">
                          {(lib?.systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        Format
                        <div className="segmented">
                          <button type="button" className={c.format === 'physical' ? 'on' : ''} onClick={() => updateCopy(i, { ...c, format: 'physical' })} data-testid="format-physical">Physical</button>
                          <button type="button" className={c.format === 'digital' ? 'on' : ''} onClick={() => updateCopy(i, { ...c, format: 'digital' })} data-testid="format-digital">Digital</button>
                        </div>
                      </label>
                      <label className="field">
                        Store / launcher
                        <input className="input" list="gv-stores" value={c.store} onChange={(e) => updateCopy(i, { ...c, store: e.target.value })} placeholder={c.format === 'physical' ? 'Retail' : 'e.g. Steam'} />
                      </label>
                    </div>
                    <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                      <button type="button" className="btn sm ghost" onClick={() => setShowLaunch((s) => ({ ...s, [i]: !s[i] }))} data-testid="toggle-launch">
                        {c.launchType === 'none' ? 'Launch settings (not launchable)' : 'Launch settings (configured)'} {showLaunch[i] ? '▴' : '▾'}
                      </button>
                      <button type="button" className="btn sm danger" onClick={() => removeCopy(i)} aria-label="Remove copy"><IconTrash size={14} /> Remove</button>
                    </div>
                    {showLaunch[i] && (
                      <div style={{ marginTop: 10 }}>
                        <LaunchFields copy={c} onChange={(nc) => updateCopy(i, nc)} isPc={sys?.kind === 'pc'} />
                      </div>
                    )}
                  </div>
                )
              })}
              <datalist id="gv-stores">{STORES.map((s) => <option key={s} value={s} />)}</datalist>
            </div>

            <div className="grid-2">
              <label className="field">
                <span className="row" style={{ justifyContent: 'space-between' }}>Release date {locked('releaseDate')}</span>
                <input className="input" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} onBlur={() => { const d = commitDate(); if (d !== null) set({ releaseDate: d }) }} placeholder="YYYY-MM-DD, YYYY-MM or YYYY" data-testid="edit-date" />
                {dateError && <span className="err-text small">{dateError}</span>}
              </label>
              <label className="field">
                Play status
                <select className="select" value={v.playStatus} onChange={(e) => set({ playStatus: e.target.value as GameInput['playStatus'] })}>
                  {PLAY_STATUSES.map((s) => <option key={s} value={s}>{PLAY_STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="row" style={{ justifyContent: 'space-between' }}>Developer {locked('developer')}</span>
                <input className="input" value={v.developer} onChange={(e) => set({ developer: e.target.value })} data-testid="edit-developer" />
              </label>
              <label className="field">
                <span className="row" style={{ justifyContent: 'space-between' }}>Publisher {locked('publisher')}</span>
                <input className="input" value={v.publisher} onChange={(e) => set({ publisher: e.target.value })} />
              </label>
            </div>

            <div className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>Genres {locked('genres')}</span>
              <div className="tag-input">
                {v.genreNames.map((g) => (
                  <span className="tag" key={g}>{g}<button type="button" aria-label={`Remove ${g}`} onClick={() => set({ genreNames: v.genreNames.filter((x) => x !== g) })}><IconX size={12} /></button></span>
                ))}
                <input
                  value={genreDraft}
                  placeholder={v.genreNames.length ? 'Add another…' : 'Type a genre and press Enter'}
                  onChange={(e) => (e.target.value.endsWith(',') ? addGenre(e.target.value) : setGenreDraft(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addGenre(genreDraft)
                    } else if (e.key === 'Backspace' && !genreDraft && v.genreNames.length) set({ genreNames: v.genreNames.slice(0, -1) })
                  }}
                  data-testid="edit-genre"
                />
              </div>
              {genreSuggest.length > 0 && (
                <div className="suggest">
                  {genreSuggest.map((g) => <button type="button" key={g.id} className="chip" style={{ height: 26 }} onClick={() => addGenre(g.name)}>+ {g.name}</button>)}
                </div>
              )}
            </div>

            <div className="field">
              Custom categories <span className="hint">Your own groupings, kept separate from genres. Manage them in Settings.</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {(lib?.categories ?? []).length === 0 && <span className="muted small">No categories yet — create them from a game's page or Settings.</span>}
                {(lib?.categories ?? []).map((c) => (
                  <button type="button" key={c.id} className={`chip ${v.categoryIds.includes(c.id) ? 'on' : ''}`} onClick={() => set({ categoryIds: v.categoryIds.includes(c.id) ? v.categoryIds.filter((x) => x !== c.id) : [...v.categoryIds, c.id] })}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>Description {locked('description')}</span>
              <textarea className="textarea" rows={5} value={v.description} onChange={(e) => set({ description: e.target.value })} data-testid="edit-description" />
            </label>

            <div className="grid-2">
              <div className="field">
                My rating
                <div className="row"><Stars value={v.rating} onChange={(r) => set({ rating: r })} size={22} />{v.rating != null && <button type="button" className="btn ghost sm" onClick={() => set({ rating: null })}>Unrated</button>}</div>
              </div>
              <label className="field">
                Steam App ID <span className="hint">Optional. Links this game to Steam to avoid duplicates on import.</span>
                <input className="input" inputMode="numeric" value={v.steamAppId ?? ''} onChange={(e) => set({ steamAppId: e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="e.g. 620" />
              </label>
            </div>
            {!game && (
              <label className="field">
                My notes
                <textarea className="textarea" rows={3} value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
              </label>
            )}
            <label className="check"><input type="checkbox" checked={v.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> Favorite</label>

            <div className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>
                Additional images
                <button type="button" className="btn sm" onClick={pickExtra}><IconUpload size={14} /> Upload images…</button>
              </span>
              {v.imageFiles.length === 0 ? (
                <span className="muted small">Screenshots, alternate covers, photos of your copy…</span>
              ) : (
                <div className="thumbs">
                  {v.imageFiles.map((f) => (
                    <div className="thumb" key={f} style={{ cursor: 'default' }}>
                      <img src={imgUrl(f)} alt="" />
                      <div className="rm row" style={{ gap: 4 }}>
                        <button type="button" className="btn sm" title="Use as box art" onClick={() => set({ coverFile: f, coverPosX: 50, coverPosY: 50, coverZoom: 1 })}><IconImage size={13} /></button>
                        <button type="button" className="btn sm danger" aria-label="Remove image" onClick={() => set({ imageFiles: v.imageFiles.filter((x) => x !== f) })}><IconX size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <span className="left muted small">Images are copied into GameVault's data folder, so moving the originals won't break anything.</span>
        <button className="btn" onClick={tryClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving} data-testid="save-game">
          {saving && <span className="spinner" />} {game ? 'Save changes' : 'Add game'}
        </button>
      </div>
    </Modal>
  )
}

function CoverEditor({ v, set, onPick, kind }: { v: GameInput; set: (p: Partial<GameInput>) => void; onPick: () => void; kind?: 'pc' | 'console' | 'handheld' | 'other' }): JSX.Element {
  const { toast } = useApp()
  const frame = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const [dropping, setDropping] = useState(false)

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!v.coverFile || v.coverFit !== 'cover') return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ x: e.clientX, y: e.clientY, px: v.coverPosX, py: v.coverPosY })
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag || !frame.current) return
    const r = frame.current.getBoundingClientRect()
    // Dragging right reveals more of the left side: object-position moves the opposite way.
    const dx = ((e.clientX - drag.x) / r.width) * 100 * (1.6 / v.coverZoom)
    const dy = ((e.clientY - drag.y) / r.height) * 100 * (1.6 / v.coverZoom)
    const clamp = (n: number): number => Math.max(0, Math.min(100, n))
    set({ coverPosX: Math.round(clamp(drag.px - dx)), coverPosY: Math.round(clamp(drag.py - dy)) })
  }
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      const path = window.api.pathForFile(file)
      const name = await window.api.importImagePath(path)
      set({ coverFile: name, coverPosX: 50, coverPosY: 50, coverZoom: 1 })
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="cover-editor">
      <div
        ref={frame}
        className={`cover-frame ${v.coverFile && v.coverFit === 'cover' ? 'draggable' : ''} ${drag ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        title={v.coverFile && v.coverFit === 'cover' ? 'Drag to reposition' : undefined}
      >
        <Cover file={v.coverFile} title={v.title || 'New game'} fit={v.coverFit} posX={v.coverPosX} posY={v.coverPosY} zoom={v.coverZoom} kind={kind} />
        <div className="grid-guide" />
        {dropping && <div className="drop-hint">Drop image</div>}
      </div>
      <div className="row">
        <button type="button" className="btn sm" style={{ flex: 1 }} onClick={onPick} data-testid="upload-cover"><IconUpload size={14} /> {v.coverFile ? 'Replace' : 'Upload box art'}</button>
        {v.coverFile && <button type="button" className="btn sm danger icon" onClick={() => set({ coverFile: null })} aria-label="Remove box art" title="Remove box art"><IconTrash size={14} /></button>}
      </div>
      {v.coverFile && (
        <>
          <div className="segmented" style={{ width: '100%' }}>
            <button type="button" style={{ flex: 1 }} className={v.coverFit === 'cover' ? 'on' : ''} onClick={() => set({ coverFit: 'cover' })}>Fill & crop</button>
            <button type="button" style={{ flex: 1 }} className={v.coverFit === 'contain' ? 'on' : ''} onClick={() => set({ coverFit: 'contain' })}>Show whole</button>
          </div>
          {v.coverFit === 'cover' && (
            <>
              <label className="field">
                Zoom
                <input className="range" type="range" min={1} max={3} step={0.05} value={v.coverZoom} onChange={(e) => set({ coverZoom: Number(e.target.value) })} />
              </label>
              <div className="grid-2" style={{ gap: 8 }}>
                <label className="field">Horizontal<input className="range" type="range" min={0} max={100} value={v.coverPosX} onChange={(e) => set({ coverPosX: Number(e.target.value) })} /></label>
                <label className="field">Vertical<input className="range" type="range" min={0} max={100} value={v.coverPosY} onChange={(e) => set({ coverPosY: Number(e.target.value) })} /></label>
              </div>
              <span className="hint">Drag the image to reposition. The artwork is never stretched.</span>
              <button type="button" className="btn sm ghost" onClick={() => set({ coverPosX: 50, coverPosY: 50, coverZoom: 1 })}>Reset position</button>
            </>
          )}
        </>
      )}
      {!v.coverFile && <span className="hint">Upload, or drag an image file onto the frame. A generated placeholder is used until then.</span>}
    </div>
  )
}
