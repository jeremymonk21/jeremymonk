import { useEffect, useRef, useState } from 'react'
import type { FilterState, SidebarView, SortKey } from '@shared/filter'
import type { Game, GameFormat, GameSystem, PlayStatus, Tag } from '@shared/types'
import { PLAY_STATUSES, PLAY_STATUS_LABELS } from '@shared/types'
import { IconChevron, IconGamepad, IconGrid, IconHandheld, IconHeart, IconMonitor, IconPlus, IconSearch, IconSettings, IconSort, IconX } from './Icons'

export function Sidebar({
  view,
  onView,
  systems,
  games,
  onAdd,
  onSettings,
  settingsOpen
}: {
  view: SidebarView
  onView: (v: SidebarView) => void
  systems: GameSystem[]
  games: Game[]
  onAdd: () => void
  onSettings: () => void
  settingsOpen: boolean
}): JSX.Element {
  const counts = new Map<number, number>()
  for (const g of games) for (const sid of new Set(g.copies.map((c) => c.systemId))) counts.set(sid, (counts.get(sid) ?? 0) + 1)
  const favCount = games.filter((g) => g.favorite).length
  const shown = systems.filter((s) => (counts.get(s.id) ?? 0) > 0 || (view.kind === 'system' && view.systemId === s.id))
  const active = (v: SidebarView): boolean =>
    !settingsOpen && v.kind === view.kind && (v.kind !== 'system' || (view.kind === 'system' && v.systemId === view.systemId))
  const icon = (s: GameSystem): JSX.Element =>
    s.kind === 'pc' ? <IconMonitor size={16} /> : s.kind === 'handheld' ? <IconHandheld size={16} /> : <IconGamepad size={16} />
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo"><IconGamepad size={18} color="#fff" /></div>
        GameVault
      </div>
      <div className="sidebar-add">
        <button className="btn primary block" onClick={onAdd} data-testid="add-game">
          <IconPlus size={16} /> Add Game
        </button>
      </div>
      <nav className="nav" aria-label="Library">
        <button className={`nav-item ${active({ kind: 'all' }) ? 'active' : ''}`} onClick={() => onView({ kind: 'all' })}>
          <span className="nav-icon"><IconGrid size={16} /></span>
          <span className="nav-label">All Games</span>
          <span className="count">{games.length}</span>
        </button>
        <button className={`nav-item ${active({ kind: 'favorites' }) ? 'active' : ''}`} onClick={() => onView({ kind: 'favorites' })} data-testid="nav-favorites">
          <span className="nav-icon"><IconHeart size={16} /></span>
          <span className="nav-label">Favorites</span>
          <span className="count">{favCount}</span>
        </button>
        <div className="nav-section">Systems</div>
        {shown.length === 0 && <div className="muted small" style={{ padding: '4px 10px' }}>Systems appear here as you add games.</div>}
        {shown.map((s) => (
          <button
            key={s.id}
            className={`nav-item ${active({ kind: 'system', systemId: s.id }) ? 'active' : ''}`}
            onClick={() => onView({ kind: 'system', systemId: s.id })}
            data-testid={`nav-system-${s.name}`}
          >
            <span className="nav-icon">{icon(s)}</span>
            <span className="nav-label">{s.name}</span>
            <span className="count">{counts.get(s.id) ?? 0}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className={`nav-item ${settingsOpen ? 'active' : ''}`} onClick={onSettings} data-testid="nav-settings">
          <span className="nav-icon"><IconSettings size={16} /></span>
          <span className="nav-label">Settings & Data</span>
        </button>
      </div>
    </aside>
  )
}

function useClickOutside(ref: React.RefObject<HTMLElement>, onOut: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut()
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOut()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [ref, onOut, active])
}

export function MultiSelect<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  emptyText,
  testId,
  footer
}: {
  label: string
  options: Array<{ value: T; label: string; count?: number }>
  selected: T[]
  onChange: (v: T[]) => void
  emptyText: string
  testId?: string
  footer?: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const toggle = (v: T): void => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  return (
    <div className="dropdown" ref={ref}>
      <button className={`chip ${selected.length ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={testId}>
        {label}
        {selected.length > 0 && <span className="badge">{selected.length}</span>}
        <IconChevron size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {options.length === 0 && <div className="menu-empty">{emptyText}</div>}
          {options.map((o) => (
            <label key={String(o.value)} className="menu-item" role="menuitemcheckbox" aria-checked={selected.includes(o.value)}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.count !== undefined && <span className="muted small">{o.count}</span>}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => onChange([])}>Clear selection</button>
            </>
          )}
          {footer && (
            <>
              <div className="menu-sep" />
              {footer}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  rating: 'My rating',
  releaseDate: 'Release date',
  dateAdded: 'Date added'
}

export function Toolbar({
  f,
  setF,
  scoped,
  genres,
  categories,
  cardSize,
  setCardSize,
  onManageCategories
}: {
  f: FilterState
  setF: (u: Partial<FilterState>) => void
  scoped: Game[]
  genres: Tag[]
  categories: Tag[]
  cardSize: number
  setCardSize: (n: number) => void
  onManageCategories: () => void
}): JSX.Element {
  // Option counts reflect the current sidebar scope (system → then genre/category).
  const count = (key: 'genreIds' | 'categoryIds', id: number): number => scoped.filter((g) => g[key].includes(id)).length
  const genreOpts = genres.map((g) => ({ value: g.id, label: g.name, count: count('genreIds', g.id) })).filter((o) => o.count > 0 || f.genreIds.includes(o.value))
  const catOpts = categories.map((c) => ({ value: c.id, label: c.name, count: count('categoryIds', c.id) }))
  const statusOpts = PLAY_STATUSES.map((s) => ({ value: s, label: PLAY_STATUS_LABELS[s], count: scoped.filter((g) => g.playStatus === s).length }))
  const formatOpts: Array<{ value: GameFormat; label: string }> = [
    { value: 'physical', label: 'Physical' },
    { value: 'digital', label: 'Digital' }
  ]
  const anyFilter = f.genreIds.length || f.categoryIds.length || f.statuses.length || f.formats.length || f.favoritesOnly || f.search
  return (
    <>
      <div className="filters">
        <MultiSelect label="Genre" options={genreOpts} selected={f.genreIds} onChange={(v) => setF({ genreIds: v })} emptyText="No genres in this view yet." testId="filter-genre" />
        <MultiSelect
          label="Category"
          options={catOpts}
          selected={f.categoryIds}
          onChange={(v) => setF({ categoryIds: v })}
          emptyText="No custom categories yet."
          testId="filter-category"
          footer={<button className="menu-item" onClick={onManageCategories}><IconPlus size={14} /> Manage categories…</button>}
        />
        <MultiSelect<PlayStatus> label="Status" options={statusOpts} selected={f.statuses} onChange={(v) => setF({ statuses: v })} emptyText="" testId="filter-status" />
        <MultiSelect<GameFormat> label="Format" options={formatOpts} selected={f.formats} onChange={(v) => setF({ formats: v })} emptyText="" testId="filter-format" />
        {f.view.kind !== 'favorites' && (
          <button className={`chip ${f.favoritesOnly ? 'on' : ''}`} onClick={() => setF({ favoritesOnly: !f.favoritesOnly })} aria-pressed={f.favoritesOnly} data-testid="filter-favorites">
            <IconHeart size={13} filled={f.favoritesOnly} /> Favorites only
          </button>
        )}
        {anyFilter ? (
          <button className="chip" onClick={() => setF({ genreIds: [], categoryIds: [], statuses: [], formats: [], favoritesOnly: false, search: '' })} data-testid="clear-filters">
            <IconX size={13} /> Clear filters
          </button>
        ) : null}
        <span className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          <IconSort size={15} color="var(--text-3)" />
          <select className="select" style={{ height: 30, fontSize: 13 }} value={f.sortKey} onChange={(e) => setF({ sortKey: e.target.value as SortKey })} aria-label="Sort by" data-testid="sort-key">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <button className="btn sm" onClick={() => setF({ sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' })} title="Toggle sort direction" data-testid="sort-dir">
            {f.sortDir === 'asc' ? (f.sortKey === 'title' ? 'A → Z' : 'Low → High') : f.sortKey === 'title' ? 'Z → A' : 'High → Low'}
          </button>
        </div>
        <div className="sep" />
        <label className="size-ctl" title="Card size">
          <IconGrid size={14} />
          <input className="range" type="range" min={120} max={300} step={10} value={cardSize} onChange={(e) => setCardSize(Number(e.target.value))} aria-label="Card size" />
          <IconGrid size={20} />
        </label>
      </div>
    </>
  )
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement))) {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  return (
    <div className="search">
      <IconSearch size={16} />
      <input
        ref={ref}
        className="input"
        placeholder="Search titles…  (Ctrl+F)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        aria-label="Search games by title"
        data-testid="search"
      />
      {value && (
        <button className="btn ghost sm icon clear" onClick={() => onChange('')} aria-label="Clear search">
          <IconX size={14} />
        </button>
      )}
    </div>
  )
}
