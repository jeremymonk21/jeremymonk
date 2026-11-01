import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterState, SidebarView } from '@shared/filter'
import { applyFilters, DEFAULT_FILTERS, inView } from '@shared/filter'
import type { Game, ImportProgress } from '@shared/types'
import { AppProvider, useApp, usePersistentState } from './state'
import { GameCard } from './components/Gallery'
import { SearchBox, Sidebar, Toolbar } from './components/Filters'
import { DetailView } from './components/DetailView'
import { GameEditor } from './components/GameEditor'
import { SettingsView } from './components/Settings'
import { SteamImport } from './components/SteamImport'
import { IconAlert, IconDownload, IconGamepad, IconHeart, IconInfo, IconPlus, IconSearch } from './components/Icons'

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell(): JSX.Element {
  const { lib, loadError, reload, putGame, toast, systemsById, confirm } = useApp()
  const [prefs, setPrefs] = usePersistentState('gv.prefs', { sortKey: DEFAULT_FILTERS.sortKey, sortDir: DEFAULT_FILTERS.sortDir, cardSize: 180 })
  const [f, setFState] = useState<FilterState>({ ...DEFAULT_FILTERS, sortKey: prefs.sortKey, sortDir: prefs.sortDir })
  const [openId, setOpenId] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ game: Game | null } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importMode, setImportMode] = useState<'library' | 'installed' | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const setF = useCallback(
    (u: Partial<FilterState>) => {
      setFState((x) => ({ ...x, ...u }))
      if (u.sortKey || u.sortDir) setPrefs((p) => ({ ...p, ...(u.sortKey ? { sortKey: u.sortKey } : {}), ...(u.sortDir ? { sortDir: u.sortDir } : {}) }))
    },
    [setPrefs]
  )

  // Steam import / refresh progress (runs in the background in the main process).
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
  const importModeRef = useRef(importMode)
  importModeRef.current = importMode

  const games = lib?.games ?? []
  const scoped = useMemo(() => games.filter((g) => inView(g, f.view)), [games, f.view])
  const visible = useMemo(() => applyFilters(games, f), [games, f])
  const openGame = openId != null ? games.find((g) => g.id === openId) ?? null : null

  useEffect(() => {
    if (openId != null && lib && !openGame) setOpenId(null)
  }, [openId, lib, openGame])

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

  const goView = (v: SidebarView): void => {
    setSettingsOpen(false)
    setOpenId(null)
    setF({ view: v })
    contentRef.current?.scrollTo({ top: 0 })
  }

  const removeSamples = async (): Promise<void> => {
    if (!(await confirm({ title: 'Remove sample games?', body: <p>All sample games are deleted. Games you've added yourself are not affected.</p>, confirmLabel: 'Remove samples', danger: true }))) return
    const n = await window.api.removeSamples()
    await reload()
    toast(`Removed ${n} sample game${n === 1 ? '' : 's'}.`, 'success')
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n' && !editor) {
        e.preventDefault()
        setEditor({ game: null })
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [editor])

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

  const title = settingsOpen ? 'Settings & Data' : f.view.kind === 'all' ? 'All Games' : f.view.kind === 'favorites' ? 'Favorites' : systemsById.get(f.view.systemId)?.name ?? 'System'
  const scopeSystemId = f.view.kind === 'system' ? f.view.systemId : null
  const small = prefs.cardSize < 150

  return (
    <div className="app" style={{ ['--card-w' as string]: `${prefs.cardSize}px` }}>
      <Sidebar
        view={f.view}
        onView={goView}
        systems={lib.systems}
        games={games}
        onAdd={() => setEditor({ game: null })}
        onSettings={() => { setSettingsOpen(true); setOpenId(null) }}
        settingsOpen={settingsOpen}
      />
      <main className="main">
        <header className="topbar">
          <div className="topbar-row">
            <h1 className="page-title">{title}</h1>
            {!settingsOpen && <span className="page-sub" data-testid="result-count">{visible.length === scoped.length ? `${scoped.length} game${scoped.length === 1 ? '' : 's'}` : `${visible.length} of ${scoped.length} games`}</span>}
            <span className="spacer" />
            {!settingsOpen && <SearchBox value={f.search} onChange={(s) => setF({ search: s })} />}
          </div>
          {!settingsOpen && (
            <Toolbar
              f={f}
              setF={setF}
              scoped={scoped}
              genres={lib.genres}
              categories={lib.categories}
              cardSize={prefs.cardSize}
              setCardSize={(n) => setPrefs((p) => ({ ...p, cardSize: n }))}
              onManageCategories={() => { setSettingsOpen(true); setTimeout(() => document.getElementById('settings-categories')?.scrollIntoView({ behavior: 'smooth' }), 50) }}
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
          {settingsOpen ? (
            <SettingsView onImport={setImportMode} />
          ) : (
            <>
              {lib.hasSamples && (
                <div className="banner" data-testid="sample-banner">
                  <IconInfo />
                  <span className="grow">You're looking at <b>sample games</b> for a design preview. Remove them whenever you're ready to start your own collection.</span>
                  <button className="btn sm danger" onClick={removeSamples} data-testid="remove-samples">Remove samples</button>
                </div>
              )}
              {games.length === 0 ? (
                <div className="empty" data-testid="empty-collection">
                  <div>
                    <div className="empty-art"><IconGamepad size={52} /></div>
                    <h2>Your collection is empty</h2>
                    <p>Add your first game by hand — physical or digital, any system — or import your Steam library.</p>
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <button className="btn primary lg" onClick={() => setEditor({ game: null })}><IconPlus /> Add your first game</button>
                      <button className="btn lg" onClick={() => setSettingsOpen(true)}><IconDownload /> Import from Steam</button>
                    </div>
                  </div>
                </div>
              ) : visible.length === 0 ? (
                <div className="empty" data-testid="empty-results">
                  <div>
                    <div className="empty-art">{f.view.kind === 'favorites' && scoped.length === 0 ? <IconHeart size={48} /> : <IconSearch size={48} />}</div>
                    {f.view.kind === 'favorites' && scoped.length === 0 ? (
                      <>
                        <h2>No favorites yet</h2>
                        <p>Hover over any game card and click the heart to add it here.</p>
                        <button className="btn" onClick={() => goView({ kind: 'all' })}>Browse all games</button>
                      </>
                    ) : (
                      <>
                        <h2>No games match</h2>
                        <p>{f.search ? `Nothing matches “${f.search}” with the current filters.` : 'Try removing some filters.'}</p>
                        <button className="btn primary" onClick={() => setF({ search: '', genreIds: [], categoryIds: [], statuses: [], formats: [], favoritesOnly: false })}>Clear search & filters</button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`gallery ${small ? 'small' : ''}`} data-testid="gallery">
                  {visible.map((g) => (
                    <GameCard key={g.id} game={g} systems={systemsById} scopeSystemId={scopeSystemId} installed={g.copies.some((c) => c.launchType !== 'none')} onOpen={open} onToggleFavorite={toggleFav} small={small} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {openGame && !settingsOpen && <DetailView key={openGame.id} game={openGame} onClose={() => setOpenId(null)} onEdit={() => setEditor({ game: openGame })} />}
      </main>
      {editor && (
        <GameEditor
          game={editor.game}
          defaultSystemId={f.view.kind === 'system' ? f.view.systemId : null}
          onClose={() => setEditor(null)}
          onSaved={(g) => {
            setEditor(null)
            setSettingsOpen(false)
            setOpenId(g.id)
          }}
        />
      )}
      {importMode && <SteamImport mode={importMode} progress={progress} onClose={() => { setImportMode(null); setProgress((p) => (p?.phase === 'importing' ? p : null)) }} />}
    </div>
  )
}
