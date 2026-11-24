import { useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, Game } from '@shared/types'
import { formatPlayTime, pickRandom } from '@shared/filter'
import { Modal, useApp } from '../state'
import { Cover } from './Cover'
import { IconDice, IconHeart, IconImage, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from './Icons'

/** Checkbox menu of collections plus a "new collection" box. Used on the game page and in multi-select. */
export function CollectionMenu({
  checked,
  partial = [],
  onToggle,
  onCreate,
  onClose,
  align = 'left'
}: {
  checked: number[]
  partial?: number[]
  onToggle: (c: Collection, on: boolean) => void
  onCreate: (name: string) => void
  onClose: () => void
  align?: 'left' | 'right' | 'up'
}): JSX.Element {
  const { lib } = useApp()
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])
  const style: React.CSSProperties = align === 'up' ? { top: 'auto', bottom: 'calc(100% + 8px)', left: 0 } : {}
  return (
    <div className={`menu ${align === 'right' ? 'right' : ''}`} ref={ref} role="menu" aria-label="Collections" style={style} data-testid="collection-menu">
      <div className="menu-head">Collections</div>
      {(lib?.collections ?? []).length === 0 && <div className="menu-empty">No collections yet. Name one below.</div>}
      {(lib?.collections ?? []).map((c) => {
        const on = checked.includes(c.id)
        const mixed = !on && partial.includes(c.id)
        return (
          <label key={c.id} className="menu-item" role="menuitemcheckbox" aria-checked={mixed ? 'mixed' : on}>
            <input
              type="checkbox"
              checked={on}
              ref={(el) => {
                if (el) el.indeterminate = mixed
              }}
              onChange={() => onToggle(c, !on)}
            />
            <span style={{ flex: 1 }}>{c.name}</span>
          </label>
        )
      })}
      <div className="menu-sep" />
      <form
        className="row"
        style={{ gap: 6, padding: '4px 6px' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) {
            onCreate(name.trim())
            setName('')
          }
        }}
      >
        <input className="input" style={{ height: 32, flex: 1, minWidth: 0 }} placeholder="New collection…" value={name} onChange={(e) => setName(e.target.value)} aria-label="New collection name" data-testid="collection-menu-new" />
        <button className="btn sm" type="submit" disabled={!name.trim()}><IconPlus size={13} /></button>
      </form>
    </div>
  )
}

/** Banner at the top of a collection's page. */
export function CollectionHeader({ collection, games, onAddGames, onDeleted }: { collection: Collection; games: Game[]; onAddGames: () => void; onDeleted: () => void }): JSX.Element {
  const { reload, toast, confirm, prompt } = useApp()
  const systems = new Set(games.flatMap((g) => g.copies.map((c) => c.systemId)))
  const hours = Math.round(games.reduce((s, g) => s + g.playSeconds, 0) / 3600)
  const mosaic = collection.coverFile ? [] : games.filter((g) => g.coverFile).slice(0, 6)
  const rename = async (): Promise<void> => {
    const name = await prompt({ title: 'Rename collection', label: 'Name', initial: collection.name, confirmLabel: 'Rename' })
    if (!name || name.trim() === collection.name) return
    try {
      await window.api.updateCollection(collection.id, { name })
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const cover = async (): Promise<void> => {
    try {
      const [f] = await window.api.pickImages(false)
      if (!f) return
      await window.api.updateCollection(collection.id, { coverFile: f })
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const del = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete the "${collection.name}" collection?`,
      body: <p>The collection is removed. The {games.length} game{games.length === 1 ? '' : 's'} in it stay in your library.</p>,
      confirmLabel: 'Delete collection',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.deleteCollection(collection.id)
      onDeleted()
      await reload()
      toast(`Deleted the "${collection.name}" collection.`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <section className="col-header" data-testid="collection-header">
      {collection.coverFile ? (
        <div className="col-mosaic" style={{ gridTemplateColumns: '1fr' }}>
          <div><Cover file={collection.coverFile} title={collection.name} fit="cover" posX={50} posY={50} zoom={1} /></div>
        </div>
      ) : (
        <div className="col-mosaic">
          {mosaic.map((g) => (
            <div key={g.id}><Cover file={g.coverFile} title={g.title} fit="cover" posX={g.coverPosX} posY={g.coverPosY} zoom={1} /></div>
          ))}
        </div>
      )}
      <div className="col-header-body">
        <span className="col-kicker">Collection</span>
        <h2>{collection.name}</h2>
        <span className="muted">
          {games.length} game{games.length === 1 ? '' : 's'} · {systems.size} system{systems.size === 1 ? '' : 's'}
          {hours > 0 ? ` · ${hours} hours played` : ''}
        </span>
        <div className="row wrap" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={onAddGames} data-testid="collection-add-games"><IconPlus size={16} /> Add games…</button>
          <button className="btn" onClick={rename} data-testid="collection-rename">Rename</button>
          <button className="btn" onClick={cover}><IconImage size={16} /> {collection.coverFile ? 'Change cover' : 'Set cover'}</button>
          {collection.coverFile && <button className="btn ghost" onClick={async () => { await window.api.updateCollection(collection.id, { coverFile: null }); await reload() }}>Use game covers</button>}
          <button className="btn danger" onClick={del} data-testid="collection-delete"><IconTrash size={16} /> Delete collection</button>
        </div>
      </div>
    </section>
  )
}

/** Searchable checklist to add many games to a collection at once. */
export function AddGamesDialog({ collection, onClose }: { collection: Collection; onClose: () => void }): JSX.Element {
  const { lib, reload, toast, systemsById } = useApp()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const candidates = useMemo(
    () =>
      (lib?.games ?? [])
        .filter((g) => !g.wishlist && !g.collectionIds.includes(collection.id))
        .filter((g) => !q || g.title.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [lib, q, collection.id]
  )
  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.setCollectionMembers(collection.id, [...picked], true)
      await reload()
      toast(`Added ${picked.size} game${picked.size === 1 ? '' : 's'} to ${collection.name}.`, 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Add games to ${collection.name}`} onClose={onClose} size="mid">
      <div className="modal-body">
        <div className="search" style={{ maxWidth: 'none', marginBottom: 10 }}>
          <IconSearch size={16} />
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your games…" data-testid="add-games-search" />
        </div>
        <div className="import-list">
          {candidates.length === 0 && <div className="menu-empty">{q ? 'No matching games.' : 'Every game is already in this collection.'}</div>}
          {candidates.map((g) => (
            <label key={g.id} className="import-row" data-testid="add-games-row">
              <input type="checkbox" checked={picked.has(g.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })} />
              <span className="name">{g.title}</span>
              <span className="muted small">{[...new Set(g.copies.map((c) => systemsById.get(c.systemId)?.name))].filter(Boolean).join(', ')}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!picked.size || busy} onClick={add} data-testid="add-games-confirm">Add {picked.size || ''} game{picked.size === 1 ? '' : 's'}</button>
      </div>
    </Modal>
  )
}

/** Floating action bar for multi-select. */
export function BulkBar({ selected, inCollectionId, onDone, onClear }: { selected: Game[]; inCollectionId: number | null; onDone: () => void; onClear: () => void }): JSX.Element {
  const { reload, toast, collectionsById } = useApp()
  const [menu, setMenu] = useState(false)
  const ids = selected.map((g) => g.id)
  const all = (fn: (g: Game) => boolean): boolean => selected.length > 0 && selected.every(fn)
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      await reload()
      toast(label, 'success')
      onDone()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const checked = (collectionsById.size ? [...collectionsById.keys()] : []).filter((c) => all((g) => g.collectionIds.includes(c)))
  const partial = [...collectionsById.keys()].filter((c) => selected.some((g) => g.collectionIds.includes(c)))
  const n = selected.length
  const s = n === 1 ? '' : 's'
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Selected games" data-testid="bulk-bar">
      <span className="count">{n} selected</span>
      <div className="dropdown">
        <button className="btn primary" disabled={!n} onClick={() => setMenu((m) => !m)} data-testid="bulk-collection">Add to collection…</button>
        {menu && (
          <CollectionMenu
            align="up"
            checked={checked}
            partial={partial}
            onClose={() => setMenu(false)}
            onToggle={(c, on) => run(on ? `Added ${n} game${s} to ${c.name}.` : `Removed ${n} game${s} from ${c.name}.`, () => window.api.setCollectionMembers(c.id, ids, on))}
            onCreate={(name) =>
              run(`Created ${name} with ${n} game${s}.`, async () => {
                const c = await window.api.createCollection(name)
                await window.api.setCollectionMembers(c.id, ids, true)
              })
            }
          />
        )}
      </div>
      {inCollectionId != null && (
        <button className="btn" disabled={!n} onClick={() => run(`Removed ${n} game${s} from ${collectionsById.get(inCollectionId)?.name}.`, () => window.api.setCollectionMembers(inCollectionId, ids, false))}>
          Remove from collection
        </button>
      )}
      {all((g) => g.backlog) ? (
        <button className="btn" disabled={!n} onClick={() => run(`Took ${n} game${s} off the backlog.`, () => window.api.patchGames(ids, { backlog: false }))}>Remove from Backlog</button>
      ) : (
        <button className="btn" disabled={!n} onClick={() => run(`Added ${n} game${s} to the backlog.`, () => window.api.patchGames(ids, { backlog: true }))} data-testid="bulk-backlog">Mark Backlog</button>
      )}
      <button className="btn" disabled={!n} onClick={() => run(`Set ${n} game${s} to Playing.`, () => window.api.patchGames(ids, { playStatus: 'playing' }))} data-testid="bulk-playing">Set Playing</button>
      {all((g) => g.favorite) ? (
        <button className="btn" disabled={!n} onClick={() => run(`Removed ${n} game${s} from favorites.`, () => window.api.patchGames(ids, { favorite: false }))}><IconHeart size={15} /> Unfavorite</button>
      ) : (
        <button className="btn" disabled={!n} onClick={() => run(`Added ${n} game${s} to favorites.`, () => window.api.patchGames(ids, { favorite: true }))}><IconHeart size={15} /> Favorite</button>
      )}
      <button className="btn ghost icon" aria-label="Clear selection" title="Clear selection" onClick={onClear}><IconX size={16} /></button>
    </div>
  )
}

type Pool = 'backlog' | 'all' | 'notStarted' | `system:${number}` | `collection:${number}`

/** "Surprise me" — picks a random game from a pool. */
export function SurpriseMe({ onClose, onOpen, onPlay }: { onClose: () => void; onOpen: (g: Game) => void; onPlay: (g: Game) => void }): JSX.Element {
  const { lib, systemsById } = useApp()
  const owned = (lib?.games ?? []).filter((g) => !g.wishlist)
  const [pool, setPool] = useState<Pool>(owned.some((g) => g.backlog) ? 'backlog' : 'all')
  const list = owned.filter((g) => {
    if (pool === 'backlog') return g.backlog
    if (pool === 'notStarted') return g.playStatus === 'not_started'
    if (pool.startsWith('system:')) return g.copies.some((c) => c.systemId === Number(pool.slice(7)))
    if (pool.startsWith('collection:')) return g.collectionIds.includes(Number(pool.slice(11)))
    return true
  })
  const [pick, setPick] = useState<Game | null>(() => pickRandom(list))
  const [spins, setSpins] = useState(0)
  useEffect(() => {
    setPick(pickRandom(list))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])
  const spin = (): void => {
    setPick((p) => pickRandom(list, p?.id))
    setSpins((n) => n + 1)
  }
  const usedSystems = [...new Set(owned.flatMap((g) => g.copies.map((c) => c.systemId)))].map((id) => systemsById.get(id)).filter(Boolean)
  const launchable = pick?.copies.some((c) => c.launchType !== 'none')
  const sys = pick?.copies[0] ? systemsById.get(pick.copies[0].systemId) : undefined
  return (
    <Modal title={<span className="row" style={{ gap: 8 }}><IconDice size={20} /> Surprise me</span>} onClose={onClose} size="sm">
      <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
        <label className="field">
          Pick from
          <select className="select" value={pool} onChange={(e) => setPool(e.target.value as Pool)} data-testid="surprise-pool">
            <option value="backlog">Backlog ({owned.filter((g) => g.backlog).length})</option>
            <option value="notStarted">Not started ({owned.filter((g) => g.playStatus === 'not_started').length})</option>
            <option value="all">Whole collection ({owned.length})</option>
            {usedSystems.map((s) => s && <option key={s.id} value={`system:${s.id}`}>{s.name}</option>)}
            {(lib?.collections ?? []).map((c) => <option key={c.id} value={`collection:${c.id}`}>{c.name}</option>)}
          </select>
        </label>
        {pick ? (
          <div className="surprise" key={`${pick.id}-${spins}`} data-testid="surprise-pick">
            <button className="surprise-cover" onClick={() => onOpen(pick)} aria-label={`Open ${pick.title}`}>
              <Cover file={pick.coverFile} title={pick.title} fit={pick.coverFit} posX={pick.coverPosX} posY={pick.coverPosY} zoom={pick.coverZoom} kind={sys?.kind} />
            </button>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{pick.title}</div>
              <div className="muted small">
                {sys?.name ?? ''}
                {pick.backlog ? ' · in your backlog' : ''}
                {formatPlayTime(pick.playSeconds) ? ` · ${formatPlayTime(pick.playSeconds)} played` : ''}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty" style={{ padding: 24 }}>
            <p style={{ margin: 0 }}>Nothing to pick from here yet.</p>
          </div>
        )}
      </div>
      <div className="modal-foot">
        {pick && <button className="btn" onClick={() => onOpen(pick)}>Open game</button>}
        <button className="btn" onClick={spin} disabled={list.length < 2} data-testid="surprise-spin"><IconDice size={16} /> Spin again</button>
        {pick && launchable && <button className="btn play" onClick={() => onPlay(pick)}><IconPlay size={14} /> Play now</button>}
      </div>
    </Modal>
  )
}
