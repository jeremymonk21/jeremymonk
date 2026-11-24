import { memo } from 'react'
import type { Game, GameSystem } from '@shared/types'
import { Cover } from './Cover'
import { IconCheck, IconCloud, IconDisc, IconHeart, IconStar, IconX } from './Icons'
import { formatPlayTime } from '@shared/filter'

export function Stars({ value, onChange, size = 14 }: { value: number | null; onChange?: (v: number | null) => void; size?: number }): JSX.Element {
  if (!onChange) {
    if (value == null) return <span className="unrated">Unrated</span>
    return (
      <span className="stars" aria-label={`${value} of 5 stars`} title={`${value} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`star ${i <= value ? 'on' : ''}`}><IconStar size={size} filled={i <= value} /></span>
        ))}
      </span>
    )
  }
  return (
    <span className="stars editable" role="radiogroup" aria-label="Personal rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}
          title={value === i ? 'Click again to clear rating' : `${i} star${i > 1 ? 's' : ''}`}
          className={`star ${value != null && i <= value ? 'on' : ''}`}
          onClick={() => onChange(value === i ? null : i)}
        >
          <IconStar size={size} filled={value != null && i <= value} />
        </button>
      ))}
    </span>
  )
}

export function systemLabel(game: Game, systems: Map<number, GameSystem>): string {
  const names = [...new Set(game.copies.map((c) => systems.get(c.systemId)?.name).filter(Boolean))] as string[]
  if (!names.length) return 'No system'
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

export type CardMode = 'normal' | 'collection' | 'wishlist'

interface CardProps {
  game: Game
  systems: Map<number, GameSystem>
  scopeSystemId: number | null
  installed: boolean
  onOpen: (g: Game) => void
  onToggleFavorite: (g: Game) => void
  small: boolean
  mode?: CardMode
  selectMode?: boolean
  selected?: boolean
  onSelect?: (g: Game) => void
  /** Collection view: remove from this collection. Wishlist: "I got it!". */
  onAction?: (g: Game, action: 'remove' | 'gotIt' | 'note') => void
}

export const GameCard = memo(function GameCard({
  game,
  systems,
  scopeSystemId,
  installed,
  onOpen,
  onToggleFavorite,
  small,
  mode = 'normal',
  selectMode = false,
  selected = false,
  onSelect,
  onAction
}: CardProps): JSX.Element {
  const copies = scopeSystemId ? game.copies.filter((c) => c.systemId === scopeSystemId) : game.copies
  const hasPhysical = copies.some((c) => c.format === 'physical')
  const hasDigital = copies.some((c) => c.format === 'digital')
  const primary = copies[0] ? systems.get(copies[0].systemId) : undefined
  const label = scopeSystemId ? (systems.get(scopeSystemId)?.name ?? '') : systemLabel(game, systems)
  const hours = formatPlayTime(game.playSeconds)
  const activate = (): void => (selectMode && onSelect ? onSelect(game) : onOpen(game))
  const pill = game.playStatus === 'playing' ? 'Playing' : game.backlog ? 'Backlog' : null
  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      tabIndex={0}
      role={selectMode ? 'checkbox' : 'button'}
      aria-checked={selectMode ? selected : undefined}
      aria-label={`${game.title}, ${label}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate()
        }
      }}
      data-testid="game-card"
    >
      <div className="card-art">
        <Cover file={game.coverFile} title={game.title} fit={game.coverFit} posX={game.coverPosX} posY={game.coverPosY} zoom={game.coverZoom} kind={primary?.kind} compact={small} />
        {selectMode ? (
          <span className={`select-box ${selected ? 'on' : ''}`} aria-hidden="true">{selected && <IconCheck size={16} />}</span>
        ) : (
          mode !== 'wishlist' && (
            <button
              className={`fav-btn ${game.favorite ? 'on' : ''}`}
              aria-label={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={game.favorite}
              title={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(game)
              }}
              data-testid="fav-toggle"
            >
              <IconHeart size={16} filled={game.favorite} />
            </button>
          )
        )}
        {pill && mode !== 'wishlist' && <span className={`status-tag ${pill === 'Playing' ? 'playing' : 'backlog'} ${selectMode || !game.favorite ? '' : 'shift'}`}>{pill}</span>}
        {!selectMode && mode === 'collection' && onAction && (
          <button className="card-action" onClick={(e) => { e.stopPropagation(); onAction(game, 'remove') }} data-testid="remove-from-collection">
            <IconX size={12} /> Remove
          </button>
        )}
        {!selectMode && mode === 'wishlist' && onAction && (
          <div className="card-hover-actions">
            <button className="btn play sm" onClick={(e) => { e.stopPropagation(); onAction(game, 'gotIt') }} data-testid="got-it">I got it!</button>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); onAction(game, 'note') }} data-testid="edit-wish-note">Edit note</button>
          </div>
        )}
        {mode !== 'wishlist' && (
          <div className="card-badges">
            {hasPhysical && <span className="mini-badge" title="Physical copy"><IconDisc size={12} />{!small && 'Physical'}</span>}
            {hasDigital && <span className="mini-badge" title="Digital copy"><IconCloud size={12} />{!small && 'Digital'}</span>}
            {installed && <span className="mini-badge installed" title="A launch method is configured on this PC">▶{!small && ' Installed'}</span>}
          </div>
        )}
      </div>
      <div className="card-info">
        <div className="card-title" title={game.title}>{game.title}</div>
        {mode === 'wishlist' ? (
          <div className={`wish-note ${game.notes ? '' : 'empty'}`}>{game.notes || 'Add a note…'}</div>
        ) : (
          <div className="card-meta">
            <span className="sys" title={label}>{label}</span>
            <span className="row" style={{ gap: 6 }}>
              {hours && !small && <span className="hours">{hours}</span>}
              <Stars value={game.rating} size={small ? 10 : 12} />
            </span>
          </div>
        )}
      </div>
    </div>
  )
})
