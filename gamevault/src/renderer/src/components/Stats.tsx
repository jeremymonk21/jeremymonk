import { useEffect, useState } from 'react'
import type { Game, Stats } from '@shared/types'
import { useApp } from '../state'
import { formatPlayTime } from '@shared/filter'
import { Cover } from './Cover'
import { IconDice } from './Icons'

type Range = 'month' | 'year' | 'all'

export function StatsView({ onOpen, onSurprise }: { onOpen: (g: Game) => void; onSurprise: () => void }): JSX.Element {
  const { lib, toast } = useApp()
  const [range, setRange] = useState<Range>('year')
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    let alive = true
    setStats(null)
    window.api
      .stats(range)
      .then((s) => alive && setStats(s))
      .catch((e) => toast((e as Error).message, 'error'))
    return () => {
      alive = false
    }
  }, [range, lib, toast])

  const byId = new Map((lib?.games ?? []).map((g) => [g.id, g]))
  if (!stats) return <div className="center-load"><span className="spinner lg" /> Crunching the numbers…</div>
  const maxH = Math.max(1, ...stats.months.map((m) => m.hours))
  const maxSys = Math.max(1, ...stats.perSystem.map((s) => s.count))
  const pct = stats.owned ? Math.round((stats.completed / stats.owned) * 100) : 0
  const rangeLabel = range === 'month' ? 'this month' : range === 'year' ? 'in the last 12 months' : 'all time'
  return (
    <div className="stats" data-testid="stats">
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="segmented" role="radiogroup" aria-label="Time range">
          {(['month', 'year', 'all'] as Range[]).map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r === 'month' ? 'This month' : r === 'year' ? 'Last 12 months' : 'All time'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={onSurprise} disabled={!stats.owned}><IconDice size={16} /> Surprise me</button>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Games owned</div><div className="kpi-value" data-testid="stat-owned">{stats.owned}</div><div className="kpi-sub">{stats.wishlist ? `+${stats.wishlist} on your wishlist` : 'Wishlist is empty'}</div></div>
        <div className="kpi"><div className="kpi-label">Completed</div><div className="kpi-value">{stats.completed}</div><div className="kpi-sub">{pct}% of your collection</div></div>
        <div className="kpi"><div className="kpi-label">Hours played</div><div className="kpi-value" data-testid="stat-hours">{stats.totalSeconds >= 36000 ? `${Math.round(stats.totalHours)}h` : formatPlayTime(stats.totalSeconds) || '0h'}</div><div className="kpi-sub">{stats.gamesPlayed} game{stats.gamesPlayed === 1 ? '' : 's'} {rangeLabel}</div></div>
        <div className="kpi"><div className="kpi-label">Backlog</div><div className="kpi-value">{stats.backlog}</div><div className="kpi-sub">games waiting for you</div></div>
      </div>
      <div className="stats-grid">
        <section className="section">
          <h3>Hours played {range === 'month' ? 'per week' : 'per month'}</h3>
          {stats.months.every((m) => !m.hours) ? (
            <p className="muted" style={{ margin: 0 }}>No play sessions yet {rangeLabel}. Time is tracked when you press Play in GameVault.</p>
          ) : (
            <div className="month-bars" role="img" aria-label={`Hours played ${range === 'month' ? 'per week' : 'per month'}`}>
              {stats.months.map((m, i) => (
                <div key={i} className="month-bar">
                  <span className="v">{m.hours ? `${m.hours}h` : ''}</span>
                  <div style={{ height: `${Math.round((m.hours / maxH) * 130)}px` }} />
                  <span className="l">{m.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="section">
          <h3>Most played</h3>
          {stats.topPlayed.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing played yet.</p>}
          <ol className="top-list">
            {stats.topPlayed.map((t) => {
              const g = byId.get(t.gameId)
              return (
                <li key={t.gameId}>
                  <button onClick={() => g && onOpen(g)}>
                    <span className="mini-cover">{g && <Cover file={g.coverFile} title={g.title} fit={g.coverFit} posX={g.coverPosX} posY={g.coverPosY} zoom={1} compact />}</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{t.title}</span>
                      <span className="muted small">{t.system}</span>
                    </span>
                    <b>{formatPlayTime(t.seconds) || '<1m'}</b>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
        <section className="section">
          <h3>Games per system</h3>
          {stats.perSystem.length === 0 && <p className="muted" style={{ margin: 0 }}>No games yet.</p>}
          <div style={{ display: 'grid', gap: 9 }}>
            {stats.perSystem.map((s) => (
              <div key={s.name} className="sys-bar">
                <span className="ellipsis">{s.name}</span>
                <div><div style={{ width: `${Math.round((s.count / maxSys) * 100)}%` }} /></div>
                <span style={{ textAlign: 'right' }}>{s.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
