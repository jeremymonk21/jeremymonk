import { useState } from 'react'
import type { CoverFit, SystemKind } from '@shared/types'
import { imgUrl } from '../state'
import { IconGamepad, IconHandheld, IconMonitor } from './Icons'

const PALETTES: Array<[string, string]> = [
  ['#3b2a8f', '#c24f8c'],
  ['#0f4c75', '#3282b8'],
  ['#1e5128', '#4e9f3d'],
  ['#5c2a9d', '#2d8cf0'],
  ['#7b2d26', '#e1883c'],
  ['#203a43', '#2c7a7b'],
  ['#4a1942', '#c94b4b'],
  ['#232526', '#5d6d7e'],
  ['#1a2a6c', '#b21f1f'],
  ['#134e5e', '#71b280']
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return Math.abs(h)
}

export function Placeholder({ title, kind, compact }: { title: string; kind?: SystemKind; compact?: boolean }): JSX.Element {
  const [a, b] = PALETTES[hash(title) % PALETTES.length]
  const angle = 120 + (hash(title + 'x') % 90)
  const Icon = kind === 'pc' ? IconMonitor : kind === 'handheld' ? IconHandheld : IconGamepad
  const len = title.length
  const fontSize = compact ? 'clamp(11px, 1.1vw, 15px)' : len > 30 ? '1.15em' : len > 16 ? '1.45em' : '1.9em'
  return (
    <div className="placeholder" style={{ background: `linear-gradient(${angle}deg, ${a}, ${b})` }} aria-label={`${title} (no box art)`}>
      <span className="ph-icon"><Icon size={compact ? 18 : 26} /></span>
      <span className="ph-title" style={{ fontSize }}>{title}</span>
    </div>
  )
}

interface CoverProps {
  file: string | null
  title: string
  fit: CoverFit
  posX: number
  posY: number
  zoom: number
  kind?: SystemKind
  compact?: boolean
}

/**
 * Renders box art inside a fixed 2:3 frame without ever stretching it.
 * "cover" fills the frame (cropping, with user positioning & zoom);
 * "contain" shows the entire image over a blurred backdrop.
 */
export function Cover({ file, title, fit, posX, posY, zoom, kind, compact }: CoverProps): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  if (!file || failed === file) return <Placeholder title={title} kind={kind} compact={compact} />
  const src = imgUrl(file)
  return (
    <div className="cover">
      {fit === 'contain' && <img className="backdrop" src={src} alt="" draggable={false} />}
      <img
        className={`main ${loaded ? '' : 'loading'}`}
        src={src}
        alt={title}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(file)}
        style={{
          objectFit: fit,
          objectPosition: `${posX}% ${posY}%`,
          transform: fit === 'cover' && zoom !== 1 ? `scale(${zoom})` : undefined,
          transformOrigin: `${posX}% ${posY}%`
        }}
      />
    </div>
  )
}
