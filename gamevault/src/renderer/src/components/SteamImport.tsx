import { useEffect, useMemo, useState } from 'react'
import type { ImportProgress, SteamOwnedGame } from '@shared/types'
import { Modal, useApp } from '../state'
import { IconAlert, IconCheck, IconSearch } from './Icons'

export function SteamImport({ mode, onClose, progress }: { mode: 'library' | 'installed'; onClose: () => void; progress: ImportProgress | null }): JSX.Element {
  const { toast } = useApp()
  const [list, setList] = useState<SteamOwnedGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [fetchMetadata, setFetchMetadata] = useState(true)
  const [downloadArtwork, setDownloadArtwork] = useState(true)
  const [started, setStarted] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setList(null)
    setError(null)
    ;(mode === 'library' ? window.api.steamOwned() : window.api.steamInstalledLocal())
      .then((l) => {
        if (!alive) return
        setList(l)
        setSelected(new Set(l.filter((g) => g.existingGameId == null).map((g) => g.appId)))
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [mode, attempt])

  const shown = useMemo(() => (list ?? []).filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase())), [list, q])
  const newCount = (list ?? []).filter((g) => g.existingGameId == null).length
  const running = started && progress?.phase === 'importing'
  const finished = started && progress && progress.phase !== 'importing'

  const toggle = (id: number): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const start = async (): Promise<void> => {
    const items = (list ?? []).filter((g) => selected.has(g.appId)).map((g) => ({ appId: g.appId, name: g.name, installed: g.installed }))
    if (!items.length) return
    try {
      setStarted(true)
      await window.api.steamImport(items, { fetchMetadata, downloadArtwork })
    } catch (e) {
      setStarted(false)
      toast((e as Error).message, 'error')
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const minutes = fetchMetadata ? Math.ceil((selected.size * 1.8) / 60) : 0

  return (
    <Modal title={mode === 'library' ? 'Import your Steam library' : 'Import installed Steam games'} onClose={() => (running ? undefined : onClose())} size="mid" closeOnBackdrop={!running}>
      <div className="modal-body">
        {!started && (
          <>
            {!list && !error && <div className="center-load"><span className="spinner lg" /> {mode === 'library' ? 'Fetching your library from Steam…' : 'Reading installed games on this PC…'}</div>}
            {error && (
              <div className="banner error">
                <IconAlert />
                <div className="grow">{error}</div>
                <button className="btn sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
              </div>
            )}
            {list && list.length === 0 && <div className="empty" style={{ padding: 30 }}><p>{mode === 'library' ? 'Steam returned no games for this account.' : 'No installed Steam games were found.'}</p></div>}
            {list && list.length > 0 && (
              <>
                <p className="muted small" style={{ marginTop: 0 }}>
                  {list.length} games found · {newCount} new · {list.length - newCount} already in your collection (matched by Steam App ID — they'll be updated, never duplicated).
                </p>
                <div className="row" style={{ marginBottom: 10 }}>
                  <div className="search" style={{ maxWidth: 'none' }}>
                    <IconSearch size={16} />
                    <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter list…" />
                  </div>
                  <button className="btn sm" onClick={() => setSelected(new Set([...selected, ...shown.filter((g) => g.existingGameId == null).map((g) => g.appId)]))}>Select new</button>
                  <button className="btn sm" onClick={() => setSelected(new Set([...selected, ...shown.map((g) => g.appId)]))}>Select all</button>
                  <button className="btn sm" onClick={() => setSelected(new Set([...selected].filter((id) => !shown.some((g) => g.appId === id))))}>Select none</button>
                </div>
                <div className="import-list" data-testid="import-list">
                  {shown.map((g) => (
                    <label key={g.appId} className="import-row" data-testid="import-row">
                      <input type="checkbox" checked={selected.has(g.appId)} onChange={() => toggle(g.appId)} />
                      <span className="name">{g.name}</span>
                      {g.installed && <span className="status-pill ready">Installed</span>}
                      {g.existingGameId != null && <span className="status-pill owned">In collection · update</span>}
                      {g.playtimeMinutes > 0 && <span className="muted small">{Math.round(g.playtimeMinutes / 60)} h</span>}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  <label className="check"><input type="checkbox" checked={fetchMetadata} onChange={(e) => setFetchMetadata(e.target.checked)} /> Fetch store details (description, genres, developer, publisher, release date)</label>
                  <label className="check"><input type="checkbox" checked={downloadArtwork} onChange={(e) => setDownloadArtwork(e.target.checked)} /> Download box art (cached locally; existing covers are kept)</label>
                  <span className="muted small">
                    Notes, ratings, favorites, categories, play status, launch settings and any fields you edited are never overwritten.
                    Games are only marked launchable if Steam reports them installed on this PC.
                    {minutes > 1 && ` Steam limits store requests, so this may take about ${minutes} minutes — you can cancel any time and keep what's imported.`}
                  </span>
                </div>
              </>
            )}
          </>
        )}
        {started && progress && (
          <div data-testid="import-progress">
            <div className="row" style={{ marginBottom: 10 }}>
              {running ? <span className="spinner" /> : progress.phase === 'finished' ? <IconCheck color="var(--ok)" /> : <IconAlert color="var(--warn)" />}
              <b>
                {running ? `Importing ${progress.done + 1 > progress.total ? progress.total : progress.done + 1} of ${progress.total}…` : progress.phase === 'finished' ? 'Import complete' : progress.phase === 'cancelled' ? 'Import cancelled' : 'Import stopped'}
              </b>
              <span className="spacer" />
              <span className="muted small">{pct}%</span>
            </div>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <p className="muted small">{running ? progress.current : `${progress.added} added · ${progress.updated} updated${progress.errors.length ? ` · ${progress.errors.length} warnings` : ''}`}</p>
            {progress.errors.length > 0 && (
              <div className="error-list">{progress.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
            )}
          </div>
        )}
        {started && !progress && <div className="center-load"><span className="spinner lg" /> Starting…</div>}
      </div>
      <div className="modal-foot">
        {!started && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!selected.size} onClick={start} data-testid="import-start">Import {selected.size} game{selected.size === 1 ? '' : 's'}</button>
          </>
        )}
        {running && <button className="btn danger" onClick={() => window.api.steamCancel()}>Stop import</button>}
        {finished && <button className="btn primary" onClick={onClose} data-testid="import-done">Done</button>}
      </div>
    </Modal>
  )
}
