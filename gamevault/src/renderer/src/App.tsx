import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterState, SidebarView } from '@shared/filter'
import { applyFilters, DEFAULT_FILTERS, inView } from '@shared/filter'
import type { Game, ImportProgress } from '@shared/types'
import { AppProvider, useApp, usePersistentState } from './state'
import { GameCard } from './components/Gallery'
import { SearchBox, Sidebar, Toolbar, type Page } from './components/Filters'
import { DetailView } from './components/DetailView'
import { GameEditor, type EditorMode } from './components/GameEditor'
import { SettingsView } from './components/Settings'
import { SteamImport } from './components/SteamImport'
import { AddGamesDialog, BulkBar, CollectionHeader, SurpriseMe } from './components/Organize'
import { StatsView } from './components/Stats'
import { IconAlert, IconCheckSquare, IconDice, IconDownload, IconGamepad, IconHeart, IconInfo, IconList, IconPlay, IconPlus, IconSearch, IconStar } from './components/Icons'

const BigPicture = lazy(() => import('./bigpicture/BigPicture'))

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell(): JSX.Element {
  const { lib, loadError, reload, putGame, toast, systemsById, collectionsById, confirm, prompt } = useApp()
  const [prefs, setPrefs] = usePersistentState('gv.prefs', { sortKey: DEFAULT_FILTERS.sortKey, sortDir: DEFAULT_FILTERS.sortDir, cardSize: 180 })
  const [f, setFState] = useState<FilterState>({ ...DEFAULT_FILTERS, sortKey: prefs.sortKey, sortDir: prefs.sortDir })
  const [openId, setOpenId] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ game: Game | null; mode: EditorMode } | null>(null)
  const [page, setPage] = useState<Page>('library')
  const [importMode, setImportMode] = useState<'library' | 'installed' | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [addToCollection, setAddToCollection] = useState<number | null>(null)
  const [surprise, setSurprise] = useState(false)
  const [bigPicture, setBigPicture] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const setF = useCallback(
    (u: Partial<FilterState>) => {
      setFState((x) => ({ ...x, ...u }))
      if (u.sortKey || u.sortDir) setPrefs((p) => ({ ...p, ...(u.sortKey ? { sortKey: u.sortKey } : {}), ...(u.sortDir ? { sortDir: u.sortDir } : {}) }))
    },
    [setPrefs]
  )

  // Steam import / refresh progress (runs in the background in the main process).
  const importModeRef = useRef(importMode)
  importModeRef.current = importMode
  useEffect(() => {
    return window.api.onSteamProgress((p) => {
      setProgress(p)
      if (p.phase !== 'importing') {
        reload()
        if (!importModeRef.current) {
          toast(
            p.phase === 'finished' ? `Steam: ${p.added} added, ${p.updated} updated${p.errors.length ? `, ${p.errors.length} warnings` : ''}.` : p.phase === 'cancelled' ? 'Steam import cancelled.' : `Steam import stopped: ${p.errors.at(-1) ?? ''}`,
            p.phase === 'finished' ? 'success' : 'error'
          )
        }
      } else if (p.done > 0 && p.done % 10 === 0) reload()
    })
  }, [reload, toast])

  // A game session ended (play time tracking) — refresh so hours update.
  useEffect(() => window.api.onPlaySession(() => void reload()), [reload])

  // Big Picture: F11 toggles it; the app can also be set to start in it.
  useEffect(() => {
    window.api.getPrefs().then((p) => p.startInBigPicture && setBigPicture(true)).catch(() => undefined)
  }, [])

  const games = lib?.games ?? []
  const scoped = useMemo(() => games.filter((g) => inView(g, f.view)), [games, f.view])
  const visible = useMemo(() => applyFilters(games, f), [games, f])
  const openGame = openId != null ? games.find((g) => g.id === openId) ?? null : null
  const selectedGames = useMemo(() => games.filter((g) => selected.has(g.id)), [games, selected])

  useEffect(() => {
    if (openId != null && lib && !openGame) setOpenId(null)
  }, [openId, lib, openGame])
  useEffect(() => {
    if (f.view.kind === 'collection' && lib && !collectionsById.has(f.view.collectionId)) setF({ view: { kind: 'all' } })
  }, [f.view, lib, collectionsById, setF])

  const toggleFav = useCallback(
    async (g: Game) => {
      putGame({ ...g, favorite: !g.favorite })
      try {
        putGame(await window.api.patchGame(g.id, { favorite: !g.favorite }))
      } catch (e) {
        putGame(g)
        toast((e as Error).message, 'error')
      }
    },
    [putGame, toast]
  )
  const open = useCallback((g: Game) => setOpenId(g.id), [])
  const toggleSelect = useCallback((g: Game) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(g.id)) n.delete(g.id)
      else n.add(g.id)
      return n
    })
  }, [])
  const exitSelect = (): void => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const goView = (v: SidebarView): void => {
    setPage('library')
    setOpenId(null)
    exitSelect()
    setF({ view: v, ...(v.kind === 'collection' ? { collectionIds: [] } : {}) })
    contentRef.current?.scrollTo({ top: 0 })
  }
  const goPage = (p: Page): void => {
    setPage(p)
    setOpenId(null)
    exitSelect()
  }

  const newCollection = async (): Promise<void> => {
    const name = await prompt({ title: 'New collection', label: 'Name', placeholder: 'e.g. Digimon, Final Fantasy, Couch co-op', confirmLabel: 'Create' })
    if (!name) return
    try {
      const c = await window.api.createCollection(name)
      await reload()
      goView({ kind: 'collection', collectionId: c.id })
      toast(`Created "${c.name}". Add games from here, a game's page, or with Select.`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const cardAction = useCallback(
    async (g: Game, action: 'remove' | 'gotIt' | 'note') => {
      try {
        if (action === 'remove' && f.view.kind === 'collection') {
          await window.api.setCollectionMembers(f.view.collectionId, [g.id], false)
          await reload()
          toast(`Removed "${g.title}" from ${collectionsById.get(f.view.collectionId)?.name}.`, 'success', {
            label: 'Undo',
            run: async () => {
              if (f.view.kind === 'collection') await window.api.setCollectionMembers(f.view.collectionId, [g.id], true)
              await reload()
            }
          })
        } else if (action === 'gotIt') {
          setEditor({ game: g, mode: 'gotIt' })
        } else if (action === 'note') {
          const note = await prompt({ title: `Note for ${g.title}`, label: 'Note', initial: g.notes, multiline: true, confirmLabel: 'Save note' })
          if (note === null) return
          putGame(await window.api.patchGame(g.id, { notes: note }))
        }
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [f.view, reload, toast, collectionsById, prompt, putGame]
  )

  const quickPlay = async (g: Game): Promise<void> => {
    const copy = g.copies.find((c) => c.launchType !== 'none')
    if (!copy) return
    const r = await window.api.launch(copy.id)
    toast(r.ok ? `${g.title}: ${r.message}` : r.message, r.ok ? 'success' : 'error')
  }

  const removeSamples = async (): Promise<void> => {
    if (!(await confirm({ title: 'Remove sample games?', body: <p>All sample games are deleted. Games you've added yourself are not affected.</p>, confirmLabel: 'Remove samples', danger: true }))) return
    const n = await window.api.removeSamples()
    await reload()
    toast(`Removed ${n} sample game${n === 1 ? '' : 's'}.`, 'success')
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'F11' && !bigPicture) {
        e.preventDefault()
        setBigPicture(true)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n' && !editor && !bigPicture) {
        e.preventDefault()
        setEditor({ game: null, mode: 'new' })
      } else if (e.key === 'Escape' && selectMode && !document.querySelector('.overlay')) exitSelect()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [editor, selectMode, bigPicture])

  if (loadError)
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div>
          <div className="empty-art"><IconAlert size={44} /></div>
          <h2>Your collection couldn't be loaded</h2>
          <p>{loadError}</p>
          <button className="btn primary" onClick={reload}>Try again</button>
        </div>
      </div>
    )
  if (!lib) return <div className="center-load" style={{ height: '100%' }}><span className="spinner lg" /> Loading your collection…</div>

  if (bigPicture)
    return (
      <Suspense fallback={<div className="center-load" style={{ height: '100%' }}><span className="spinner lg" /></div>}>
        <BigPicture onExit={() => setBigPicture(false)} />
      </Suspense>
    )

  const v = f.view
  const collection = v.kind === 'collection' ? collectionsById.get(v.collectionId) ?? null : null
  const viewTitle: Record<string, string> = { all: 'All Games', playing: 'Playing', backlog: 'Backlog', favorites: 'Favorites', wishlist: 'Wishlist' }
  const title =
    page === 'settings' ? 'Settings & Data' : page === 'stats' ? 'Stats' : v.kind === 'system' ? systemsById.get(v.systemId)?.name ?? 'System' : v.kind === 'collection' ? collection?.name ?? 'Collection' : viewTitle[v.kind]
  const scopeSystemId = v.kind === 'system' ? v.systemId : null
  const small = prefs.cardSize < 150
  const cardMode = v.kind === 'wishlist' ? 'wishlist' : v.kind === 'collection' ? 'collection' : 'normal'
  const owned = games.filter((g) => !g.wishlist)
  const library = page === 'library'

  const emptyView: Record<string, { icon: JSX.Element; title: string; text: string }> = {
    playing: { icon: <IconPlay size={44} />, title: 'Nothing marked as Playing', text: 'Set a game to Playing on its page (or with Select) and it shows up here.' },
    backlog: { icon: <IconList size={48} />, title: 'Your backlog is empty', text: 'Mark games you want to play next with “+ Backlog” on their page, or select several and use Mark Backlog.' },
    favorites: { icon: <IconHeart size={48} />, title: 'No favorites yet', text: 'Hover over any game card and click the heart to add it here.' },
    wishlist: { icon: <IconStar size={48} />, title: 'Your wishlist is empty', text: 'Keep track of games you want but don’t own yet. They stay separate from your collection.' },
    collection: { icon: <IconGamepad size={48} />, title: 'This collection is empty', text: 'Add games with “Add games…” above, from a game’s page, or by selecting several cards.' }
  }
  const viewEmpty = scoped.length === 0 && emptyView[v.kind]

  return (
    <div className="app" style={{ ['--card-w' as string]: `${prefs.cardSize}px` }}>
      <Sidebar
        view={v}
        onView={goView}
        page={page}
        onPage={goPage}
        systems={lib.systems}
        collections={lib.collections}
        games={games}
        onAdd={() => setEditor({ game: null, mode: v.kind === 'wishlist' ? 'wishlist' : 'new' })}
        onNewCollection={newCollection}
        onBigPicture={() => setBigPicture(true)}
      />
      <main className="main">
        <header className="topbar">
          <div className="topbar-row">
            <h1 className="page-title">{title}</h1>
            {library && (
              <span className="page-sub" data-testid="result-count">
                {visible.length === scoped.length ? `${scoped.length} game${scoped.length === 1 ? '' : 's'}` : `${visible.length} of ${scoped.length} games`}
                {v.kind === 'wishlist' ? ' · not counted in your collection' : ''}
              </span>
            )}
            <span className="spacer" />
            {library && v.kind === 'wishlist' && (
              <button className="btn primary" onClick={() => setEditor({ game: null, mode: 'wishlist' })} data-testid="add-wishlist"><IconPlus size={16} /> Add to wishlist</button>
            )}
            {library && v.kind !== 'wishlist' && (
              <button className="btn" onClick={() => setSurprise(true)} disabled={!owned.length} data-testid="surprise-open"><IconDice size={16} /> Surprise me</button>
            )}
            {library && v.kind !== 'wishlist' && (
              <button className={`btn ${selectMode ? 'toggled' : ''}`} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))} aria-pressed={selectMode} data-testid="select-mode">
                <IconCheckSquare size={15} /> {selectMode ? 'Done' : 'Select'}
              </button>
            )}
            {library && <SearchBox value={f.search} onChange={(s) => setF({ search: s })} />}
          </div>
          {library && (
            <Toolbar
              f={f}
              setF={setF}
              scoped={scoped}
              genres={lib.genres}
              categories={lib.categories}
              collections={lib.collections}
              cardSize={prefs.cardSize}
              setCardSize={(n) => setPrefs((p) => ({ ...p, cardSize: n }))}
              onManageCategories={() => { goPage('settings'); setTimeout(() => document.getElementById('settings-categories')?.scrollIntoView({ behavior: 'smooth' }), 50) }}
            />
          )}
        </header>
        <div className="content" ref={contentRef}>
          {progress?.phase === 'importing' && !importMode && (
            <div className="banner">
              <span className="spinner" />
              <span className="grow">Steam: {progress.done} of {progress.total} — {progress.current}</span>
              <button className="btn sm" onClick={() => window.api.steamCancel()}>Stop</button>
            </div>
          )}
          {page === 'settings' && <SettingsView onImport={setImportMode} />}
          {page === 'stats' && <StatsView onOpen={(g) => { setPage('library'); setOpenId(g.id) }} onSurprise={() => setSurprise(true)} />}
          {library && (
            <>
              {lib.hasSamples && (
                <div className="banner" data-testid="sample-banner">
                  <IconInfo />
                  <span className="grow">You're looking at <b>sample games</b> for a design preview. Remove them whenever you're ready to start your own collection.</span>
                  <button className="btn sm danger" onClick={removeSamples} data-testid="remove-samples">Remove samples</button>
                </div>
              )}
              {collection && (
                <CollectionHeader key={collection.id} collection={collection} games={scoped} onAddGames={() => setAddToCollection(collection.id)} onDeleted={() => goView({ kind: 'all' })} />
              )}
              {owned.length === 0 && v.kind !== 'wishlist' ? (
                <div className="empty" data-testid="empty-collection">
                  <div>
                    <div className="empty-art"><IconGamepad size={52} /></div>
                    <h2>Your collection is empty</h2>
                    <p>Add your first game by hand — physical or digital, any system — or import your Steam library.</p>
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <button className="btn primary lg" onClick={() => setEditor({ game: null, mode: 'new' })}><IconPlus /> Add your first game</button>
                      <button className="btn lg" onClick={() => goPage('settings')}><IconDownload /> Import from Steam</button>
                    </div>
                  </div>
                </div>
              ) : viewEmpty ? (
                <div className="empty" data-testid="empty-view">
                  <div>
                    <div className="empty-art">{viewEmpty.icon}</div>
                    <h2>{viewEmpty.title}</h2>
                    <p>{viewEmpty.text}</p>
                    {v.kind === 'wishlist' ? (
                      <button className="btn primary" onClick={() => setEditor({ game: null, mode: 'wishlist' })}><IconPlus size={16} /> Add to wishlist</button>
                    ) : v.kind === 'collection' && collection ? null : (
                      <button className="btn" onClick={() => goView({ kind: 'all' })}>Browse all games</button>
                    )}
                  </div>
                </div>
              ) : visible.length === 0 ? (
                <div className="empty" data-testid="empty-results">
                  <div>
                    <div className="empty-art"><IconSearch size={48} /></div>
                    <h2>No games match</h2>
                    <p>{f.search ? `Nothing matches “${f.search}” with the current filters.` : 'Try removing some filters.'}</p>
                    <button className="btn primary" onClick={() => setF({ search: '', genreIds: [], categoryIds: [], collectionIds: [], statuses: [], formats: [], favoritesOnly: false })}>Clear search & filters</button>
                  </div>
                </div>
              ) : (
                <div className={`gallery ${small ? 'small' : ''}`} data-testid="gallery">
                  {visible.map((g) => (
                    <GameCard
                      key={g.id}
                      game={g}
                      systems={systemsById}
                      scopeSystemId={scopeSystemId}
                      installed={g.copies.some((c) => c.launchType !== 'none')}
                      onOpen={open}
                      onToggleFavorite={toggleFav}
                      small={small}
                      mode={cardMode}
                      selectMode={selectMode}
                      selected={selected.has(g.id)}
                      onSelect={toggleSelect}
                      onAction={cardAction}
                    />
                  ))}
                </div>
              )}
              {selectMode && <div style={{ height: 90 }} />}
            </>
          )}
        </div>
        {selectMode && library && (
          <BulkBar selected={selectedGames} inCollectionId={collection?.id ?? null} onDone={() => undefined} onClear={() => setSelected(new Set())} />
        )}
        {openGame && library && <DetailView key={openGame.id} game={openGame} onClose={() => setOpenId(null)} onEdit={() => setEditor({ game: openGame, mode: 'edit' })} onGotIt={() => setEditor({ game: openGame, mode: 'gotIt' })} />}
      </main>
      {editor && (
        <GameEditor
          game={editor.game}
          mode={editor.mode}
          defaultSystemId={v.kind === 'system' ? v.systemId : null}
          defaultCollectionId={collection?.id ?? null}
          onClose={() => setEditor(null)}
          onSaved={(g) => {
            setEditor(null)
            if (g.wishlist) {
              goView({ kind: 'wishlist' })
              return
            }
            setPage('library')
            setOpenId(g.id)
          }}
        />
      )}
      {addToCollection != null && collectionsById.get(addToCollection) && (
        <AddGamesDialog collection={collectionsById.get(addToCollection)!} onClose={() => setAddToCollection(null)} />
      )}
      {surprise && (
        <SurpriseMe
          onClose={() => setSurprise(false)}
          onOpen={(g) => { setSurprise(false); setPage('library'); setOpenId(g.id) }}
          onPlay={(g) => { setSurprise(false); quickPlay(g) }}
        />
      )}
      {importMode && <SteamImport mode={importMode} progress={progress} onClose={() => { setImportMode(null); setProgress((p) => (p?.phase === 'importing' ? p : null)) }} />}
    </div>
  )
}
