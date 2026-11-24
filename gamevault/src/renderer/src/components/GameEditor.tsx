import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtOption, ArtSet, CopyInput, Game, GameInput, LookupHit, LookupResult, MetadataField } from '@shared/types'
import { matchSystem } from '@shared/platforms'
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

/** new: add an owned game · edit: edit any game · wishlist: add a wanted game · gotIt: move a wishlist game into the collection. */
export type EditorMode = 'new' | 'edit' | 'wishlist' | 'gotIt'

export function GameEditor({
  game,
  mode = game ? 'edit' : 'new',
  defaultSystemId,
  defaultCollectionId = null,
  onClose,
  onSaved
}: {
  game: Game | null
  mode?: EditorMode
  defaultSystemId: number | null
  defaultCollectionId?: number | null
  onClose: () => void
  onSaved: (g: Game) => void
}): JSX.Element {
  const { lib, genresById, toast, confirm, reload, systemsById } = useApp()
  const initial = useMemo(() => {
    const firstSystem = defaultSystemId ?? lib?.systems[0]?.id ?? null
    if (game) {
      const base = gameToInput(game, game.genreIds.map((id) => genresById.get(id)?.name ?? '').filter(Boolean))
      if (mode === 'gotIt') {
        return { ...base, wishlist: false, copies: base.copies.length ? base.copies : emptyInput(firstSystem).copies }
      }
      return base
    }
    const blank = emptyInput(firstSystem)
    if (mode === 'wishlist') return { ...blank, wishlist: true, copies: [] }
    return { ...blank, collectionIds: defaultCollectionId ? [defaultCollectionId] : [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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

  // ---- online details lookup (IGDB + Steam Store) and artwork (SteamGridDB) ----
  const [hits, setHits] = useState<LookupHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchErrors, setSearchErrors] = useState<string[]>([])
  const [applying, setApplying] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [lookupDismissed, setLookupDismissed] = useState(false)
  const [art, setArt] = useState<ArtSet | null>(null)
  const [artLoading, setArtLoading] = useState(false)
  const [artPicker, setArtPicker] = useState(false)
  const [usingArt, setUsingArt] = useState<number | null>(null)
  const lastSearched = useRef('')

  const runSearch = async (term: string): Promise<void> => {
    const q = term.trim()
    if (q.length < 2) return
    lastSearched.current = q.toLowerCase()
    setSearching(true)
    setSearchErrors([])
    try {
      const r = await window.api.searchDetails(q)
      if (lastSearched.current === q.toLowerCase()) {
        setHits(r.hits)
        setSearchErrors(r.errors)
      }
    } catch (e) {
      setSearchErrors([(e as Error).message])
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

  const loadArt = async (title: string, steamAppId: number | null): Promise<void> => {
    setArtLoading(true)
    try {
      const cfg = await window.api.sourcesGetConfig()
      if (!cfg.sgdb) {
        setArt(null)
        return
      }
      setArt(await window.api.listArt(title, steamAppId))
    } catch (e) {
      toast(`SteamGridDB: ${(e as Error).message}`, 'error')
    } finally {
      setArtLoading(false)
    }
  }

  const applyHit = async (hit: LookupHit): Promise<void> => {
    setApplying(`${hit.source}:${hit.id}`)
    try {
      const d = await window.api.lookupDetails(hit.source, hit.id)
      setLookup(d)
      setHits(null)
      const systemId = matchSystem(d.platforms.length ? d.platforms : hit.platforms, lib?.systems ?? [])
      setV((x) => {
        const next: GameInput = {
          ...x,
          title: d.title || x.title,
          description: d.description || x.description,
          developer: d.developer || x.developer,
          publisher: d.publisher || x.publisher,
          releaseDate: d.releaseDate || x.releaseDate,
          genreNames: d.genres.length ? d.genres : x.genreNames,
          steamAppId: x.steamAppId ?? d.appId,
          igdbId: d.igdbId ?? x.igdbId ?? null,
          videoIds: d.videoIds.length ? d.videoIds : x.videoIds ?? [],
          imageFiles: [...x.imageFiles, ...d.screenshotFiles.filter((f) => !x.imageFiles.includes(f))]
        }
        if (d.coverFile) {
          if (!x.coverFile) Object.assign(next, { coverFile: d.coverFile, coverFit: d.coverPortrait ? 'cover' : 'contain', coverPosX: 50, coverPosY: 50, coverZoom: 1 })
          else next.imageFiles = [...next.imageFiles, d.coverFile] // keep the user's own cover; offer the found art as an extra image
        }
        // Single, untouched copy on a different system? Point it at the platform the game came out on.
        if (!game && systemId && x.copies.length === 1 && !x.copies[0].id && x.copies[0].launchType === 'none' && d.platforms.length === 1)
          next.copies = [{ ...x.copies[0], systemId }]
        return next
      })
      if (d.releaseDate) setDateDraft(d.releaseDate)
      toast(`Filled in details for "${d.title}" from ${hit.source === 'igdb' ? 'IGDB' : 'the Steam Store'}. Review them, then save.`, 'success')
      loadArt(d.title, d.appId)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setApplying(null)
    }
  }

  const useArt = async (kind: 'grid' | 'hero' | 'logo', opt: ArtOption): Promise<void> => {
    setUsingArt(opt.id)
    try {
      const f = await window.api.downloadArt(opt.url)
      if (kind === 'grid') set({ coverFile: f, coverFit: 'cover', coverPosX: 50, coverPosY: 50, coverZoom: 1 })
      else if (kind === 'hero') set({ heroFile: f })
      else set({ logoFile: f })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setUsingArt(null)
    }
  }

  // Background and logo for Big Picture: take SteamGridDB's top pick automatically if none is set yet.
  useEffect(() => {
    if (!art) return
    ;(async () => {
      if (!v.heroFile && art.heroes[0]) await useArt('hero', art.heroes[0])
      if (!v.logoFile && art.logos[0]) await useArt('logo', art.logos[0])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art])

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
    if (mode === 'gotIt' && !copies.length) {
      toast('Add the system and format you bought it on.', 'error')
      return
    }
    for (const c of copies) {
      if (c.launchType === 'emulator' && (!c.emulatorId || !c.launchTarget.trim())) {
        toast('A copy is set to launch with an emulator but the emulator or game file is missing.', 'error')
        return
      }
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
      toast(mode === 'gotIt' ? `"${g.title}" is now in your collection.` : g.wishlist && !game ? `Added "${g.title}" to your wishlist.` : game ? 'Changes saved.' : `Added "${g.title}".`, 'success')
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
    <Modal
      title={mode === 'gotIt' ? `Add ${game?.title} to your collection` : mode === 'wishlist' ? 'Add to wishlist' : game ? `Edit ${game.title}` : 'Add a game'}
      onClose={tryClose}
      size="wide"
      closeOnBackdrop={false}
    >
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
                    ? <>Details filled in from {lookup.source === 'igdb' ? 'IGDB' : `the Steam Store (App ID ${lookup.appId})`}. Edit anything you like before saving.</>
                    : <>Find the description, genres, dates and box art online — works for games you own anywhere.</>}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {(lookup || v.title.trim().length > 1) && (
                    <button type="button" className="btn sm" onClick={() => { setArtPicker(true); if (!art) loadArt(v.title, v.steamAppId) }} data-testid="art-open">
                      <IconImage size={14} /> Artwork…
                    </button>
                  )}
                  <button type="button" className="btn sm" disabled={v.title.trim().length < 2 || searching} onClick={() => { setLookupDismissed(false); runSearch(v.title) }} data-testid="lookup-search">
                    {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconSearch size={14} />} {lookup ? 'Look up again' : 'Find details online'}
                  </button>
                </span>
              </div>
              {searchErrors.map((err) => <div key={err} className="err-text small" style={{ marginTop: 6 }}>{err}</div>)}
              {hits && hits.length === 0 && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  No matches for "{lastSearched.current}". Check the spelling, or fill the details in by hand. Adding IGDB in Settings → Online sources finds console and retro games.
                </div>
              )}
              {hits && hits.length > 0 && (
                <div className="lookup-hits">
                  {hits.map((h) => (
                    <button type="button" key={`${h.source}:${h.id}`} className="lookup-hit" onClick={() => applyHit(h)} disabled={applying != null} data-testid="lookup-hit">
                      {h.thumb ? <img src={h.thumb} alt="" className={h.source === 'igdb' ? 'portrait' : ''} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <span className="thumb-empty" />}
                      <span className="name">
                        <span style={{ display: 'block' }}>{h.name}</span>
                        <span className="muted small">{[h.year, h.platforms.slice(0, 4).join(', ')].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className={`src-badge ${h.source}`}>{h.source === 'igdb' ? 'IGDB' : 'Steam'}</span>
                      {applying === `${h.source}:${h.id}` ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <span className="use">Use</span>}
                    </button>
                  ))}
                  <button type="button" className="btn sm ghost" onClick={() => { setHits(null); setLookupDismissed(true) }}>None of these</button>
                </div>
              )}
              {(artLoading || (art && art.grids.length > 0)) && (
                <div style={{ marginTop: 12 }}>
                  <div className="small" style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
                    Box art from SteamGridDB <span className="muted" style={{ fontWeight: 400 }}>· click to use{v.heroFile || v.logoFile ? ' · background & logo for Big Picture picked too' : ''}</span>
                  </div>
                  {artLoading ? <span className="spinner" /> : (
                    <div className="art-strip">
                      {art?.grids.slice(0, 8).map((g) => (
                        <button type="button" key={g.id} className="art-opt" onClick={() => useArt('grid', g)} disabled={usingArt != null} aria-label="Use this box art" data-testid="art-grid">
                          <img src={g.thumb} alt="" />
                          {usingArt === g.id && <span className="spinner" />}
                        </button>
                      ))}
                      <button type="button" className="art-opt more" onClick={() => setArtPicker(true)}>More…</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {artPicker && (
              <ArtPicker
                art={art}
                loading={artLoading}
                current={{ hero: v.heroFile ?? null, logo: v.logoFile ?? null }}
                busyId={usingArt}
                onUse={useArt}
                onClearHero={() => set({ heroFile: null })}
                onClearLogo={() => set({ logoFile: null })}
                onSearch={(t) => loadArt(t, null)}
                defaultTerm={v.title}
                onClose={() => setArtPicker(false)}
              />
            )}

            {v.wishlist && (
              <label className="field">
                Wishlist note <span className="hint">Which version you want, where to look, price to watch for…</span>
                <textarea className="textarea" rows={3} value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} data-testid="wish-note" />
              </label>
            )}
            {mode === 'gotIt' && <div className="banner small" style={{ margin: 0 }}>Nice! Confirm the system and format you got, then add it to your collection. Your note is kept.</div>}
            <div style={v.wishlist ? { display: 'none' } : undefined}>
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

            {!v.wishlist && (
              <div className="field">
                Collections <span className="hint">A game can be in as many collections as you like.</span>
                <div className="row wrap" style={{ gap: 6 }}>
                  {(lib?.collections ?? []).length === 0 && <span className="muted small">No collections yet — make one with + next to Collections in the sidebar.</span>}
                  {(lib?.collections ?? []).map((c) => {
                    const on = (v.collectionIds ?? []).includes(c.id)
                    return (
                      <button type="button" key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ collectionIds: on ? (v.collectionIds ?? []).filter((x) => x !== c.id) : [...(v.collectionIds ?? []), c.id] })} data-testid="editor-collection">
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

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
            {!game && !v.wishlist && (
              <label className="field">
                My notes
                <textarea className="textarea" rows={3} value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
              </label>
            )}
            {!v.wishlist && (
              <div className="row wrap" style={{ gap: 20 }}>
                <label className="check"><input type="checkbox" checked={v.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> Favorite</label>
                <label className="check" title={v.playStatus === 'playing' ? 'Games set to Playing come off the backlog' : undefined}>
                  <input type="checkbox" checked={!!v.backlog && v.playStatus !== 'playing'} disabled={v.playStatus === 'playing'} onChange={(e) => set({ backlog: e.target.checked })} data-testid="editor-backlog" /> In my Backlog
                </label>
              </div>
            )}

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
        {mode === 'new' ? (
          <label className="check left">
            <input type="checkbox" checked={!!v.wishlist} onChange={(e) => set({ wishlist: e.target.checked })} data-testid="editor-wishlist" /> Add to Wishlist instead (I don't own it yet)
          </label>
        ) : (
          <span className="left muted small">Images are copied into GameVault's data folder, so moving the originals won't break anything.</span>
        )}
        <button className="btn" onClick={tryClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving} data-testid="save-game">
          {saving && <span className="spinner" />}{' '}
          {mode === 'gotIt' ? 'Add to collection' : v.wishlist && !game ? 'Add to wishlist' : game ? 'Save changes' : 'Add game'}
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

/** Pick box art, Big Picture background and logo from SteamGridDB. */
function ArtPicker({
  art,
  loading,
  current,
  busyId,
  onUse,
  onClearHero,
  onClearLogo,
  onSearch,
  defaultTerm,
  onClose
}: {
  art: ArtSet | null
  loading: boolean
  current: { hero: string | null; logo: string | null }
  busyId: number | null
  onUse: (kind: 'grid' | 'hero' | 'logo', o: ArtOption) => void
  onClearHero: () => void
  onClearLogo: () => void
  onSearch: (term: string) => void
  defaultTerm: string
  onClose: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'grid' | 'hero' | 'logo'>('grid')
  const [term, setTerm] = useState(defaultTerm)
  const list = art ? (tab === 'grid' ? art.grids : tab === 'hero' ? art.heroes : art.logos) : []
  return (
    <Modal title="Artwork from SteamGridDB" onClose={onClose} size="wide">
      <div className="tabs">
        <button className={tab === 'grid' ? 'on' : ''} onClick={() => setTab('grid')}>Box art</button>
        <button className={tab === 'hero' ? 'on' : ''} onClick={() => setTab('hero')}>Background (Big Picture)</button>
        <button className={tab === 'logo' ? 'on' : ''} onClick={() => setTab('logo')}>Logo (Big Picture)</button>
      </div>
      <div className="modal-body">
        <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); onSearch(term) }}>
          <input className="input" style={{ flex: 1 }} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search SteamGridDB" />
          <button className="btn" type="submit"><IconSearch size={14} /> Search</button>
        </form>
        {tab !== 'grid' && (current.hero || current.logo) && (
          <div className="row small muted" style={{ marginBottom: 10 }}>
            {tab === 'hero' && current.hero && <><span>Background chosen.</span><button className="btn sm ghost" onClick={onClearHero}>Remove</button></>}
            {tab === 'logo' && current.logo && <><span>Logo chosen.</span><button className="btn sm ghost" onClick={onClearLogo}>Remove</button></>}
          </div>
        )}
        {loading ? (
          <div className="center-load"><span className="spinner lg" /> Loading artwork…</div>
        ) : !art ? (
          <p className="muted">Add a SteamGridDB API key in Settings → Online sources to browse community artwork.</p>
        ) : list.length === 0 ? (
          <p className="muted">No {tab === 'grid' ? 'box art' : tab === 'hero' ? 'backgrounds' : 'logos'} found. Try another search.</p>
        ) : (
          <div className={`art-grid ${tab}`}>
            {list.map((o) => (
              <button key={o.id} className="art-opt" onClick={() => onUse(tab, o)} disabled={busyId != null} data-testid={`art-${tab}`}>
                <img src={o.thumb} alt="" loading="lazy" />
                {busyId === o.id && <span className="spinner" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <span className="left muted small">Chosen images are downloaded into GameVault's data folder.</span>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}
