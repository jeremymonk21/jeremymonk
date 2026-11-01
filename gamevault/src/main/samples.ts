/**
 * Fictional sample games for the first-run design preview. They are flagged
 * `is_sample` and can be removed in one click from the banner or Settings.
 */
import type { DB } from './db'
import { createTag, listSystems, listTags, saveGame, setSetting, getSetting } from './db'
import { writeImageBuffer } from './images'
import type { GameFormat, PlayStatus } from '@shared/types'

interface Sample {
  title: string
  system: string
  format: GameFormat
  store: string
  genres: string[]
  category?: string
  status: PlayStatus
  rating: number | null
  favorite: boolean
  release: string
  dev: string
  colors: [string, string, string]
  motif: 'sun' | 'grid' | 'peaks' | 'rings' | 'waves' | 'stars'
  desc: string
}

const SAMPLES: Sample[] = [
  { title: 'Starfall Odyssey', system: 'PC', format: 'digital', store: 'Steam', genres: ['RPG', 'Adventure'], category: 'Backlog', status: 'playing', rating: 5, favorite: true, release: '2023-09-14', dev: 'Lumen Forge', colors: ['#1b1446', '#6a3df0', '#ffb86b'], motif: 'stars', desc: 'Chart a course across a shattered galaxy, recruit an unlikely crew and decide the fate of a dying star.' },
  { title: 'Neon Drift', system: 'PlayStation 5', format: 'physical', store: 'Retail', genres: ['Racing'], status: 'completed', rating: 4, favorite: false, release: '2022-03-02', dev: 'Afterglow Studio', colors: ['#0b0f2e', '#ff2e88', '#22e1ff'], motif: 'grid', desc: 'Arcade street racing through a rain-soaked synthwave city.' },
  { title: 'Hollow Pines', system: 'Nintendo Switch', format: 'digital', store: 'Nintendo eShop', genres: ['Adventure', 'Puzzle'], category: 'Cozy', status: 'not_started', rating: null, favorite: true, release: '2021-10-28', dev: 'Small Lantern', colors: ['#0f2a22', '#2f7d5b', '#f4d58d'], motif: 'peaks', desc: 'A quiet mystery in a forest town where the trees remember everything.' },
  { title: 'Iron Bastion', system: 'Xbox Series X|S', format: 'digital', store: 'Microsoft Store', genres: ['Strategy'], status: 'on_hold', rating: 3, favorite: false, release: '2024-05-21', dev: 'Northwall Games', colors: ['#1d1d1f', '#8a8f98', '#ff6a3d'], motif: 'rings', desc: 'Build, defend and outthink your rivals in a war of steam-powered fortresses.' },
  { title: 'Tidebound', system: 'PC', format: 'digital', store: 'GOG', genres: ['Survival', 'Adventure'], category: 'Backlog', status: 'dropped', rating: 2, favorite: false, release: '2020-07-09', dev: 'Saltwind', colors: ['#06253a', '#1679ab', '#bde8f5'], motif: 'waves', desc: 'Survive on a raft as the ocean slowly reveals a drowned civilisation.' },
  { title: 'Ember & Ash', system: 'PlayStation 4', format: 'physical', store: 'Retail', genres: ['Action', 'RPG'], category: 'Couch Co-op', status: 'completed', rating: 5, favorite: true, release: '2019-11-15', dev: 'Cinder House', colors: ['#2a0a0a', '#c0392b', '#ffcf6b'], motif: 'sun', desc: 'Two siblings, one cursed blade, and a kingdom on fire.' },
  { title: 'Pocket Planets', system: 'Nintendo Switch', format: 'physical', store: 'Retail', genres: ['Simulation'], category: 'Cozy', status: 'playing', rating: 4, favorite: false, release: '2023', dev: 'Tiny Orbit', colors: ['#24123d', '#ff8fb1', '#ffe08a'], motif: 'rings', desc: 'Tend a tiny solar system of tiny planets with tiny problems.' },
  { title: 'Signal Lost', system: 'PC', format: 'digital', store: 'Epic Games Store', genres: ['Horror'], status: 'not_started', rating: null, favorite: false, release: '2025-02', dev: 'Quiet Static', colors: ['#050505', '#1f3b2c', '#7dff9b'], motif: 'grid', desc: 'A lone radio operator. A frequency that should not exist.' }
]

// Owned on a second system too (demonstrates multi-system ownership).
const EXTRA_COPIES: Record<string, Array<{ system: string; format: GameFormat; store: string }>> = {
  'Starfall Odyssey': [{ system: 'PlayStation 5', format: 'physical', store: 'Retail' }],
  'Ember & Ash': [{ system: 'PC', format: 'digital', store: 'Steam' }]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function coverSvg(s: Sample): string {
  const [bg, mid, accent] = s.colors
  let art = ''
  switch (s.motif) {
    case 'sun':
      art = `<circle cx="300" cy="430" r="190" fill="${accent}" opacity=".9"/><rect y="520" width="600" height="380" fill="${bg}" opacity=".85"/>`
      break
    case 'grid':
      art = Array.from({ length: 12 }, (_, i) => `<line x1="${-300 + i * 100}" y1="900" x2="300" y2="470" stroke="${accent}" stroke-width="3" opacity=".7"/>`).join('') +
        Array.from({ length: 8 }, (_, i) => `<line x1="0" x2="600" y1="${490 + i * i * 7}" y2="${490 + i * i * 7}" stroke="${accent}" stroke-width="2" opacity=".6"/>`).join('') +
        `<circle cx="300" cy="380" r="120" fill="${mid}"/>`
      break
    case 'peaks':
      art = `<circle cx="420" cy="260" r="70" fill="${accent}"/><polygon points="0,900 0,560 140,420 260,560 380,380 600,640 600,900" fill="${mid}"/><polygon points="0,900 0,700 200,560 360,720 500,600 600,700 600,900" fill="${bg}" opacity=".9"/>`
      break
    case 'rings':
      art = `<circle cx="300" cy="420" r="140" fill="${mid}"/><ellipse cx="300" cy="420" rx="250" ry="60" fill="none" stroke="${accent}" stroke-width="14" transform="rotate(-18 300 420)"/>`
      break
    case 'waves':
      art = Array.from({ length: 6 }, (_, i) => `<path d="M0 ${560 + i * 60} Q 150 ${520 + i * 60} 300 ${560 + i * 60} T 600 ${560 + i * 60} V 900 H 0 Z" fill="${i % 2 ? mid : accent}" opacity="${0.25 + i * 0.12}"/>`).join('')
      break
    case 'stars':
      art = Array.from({ length: 70 }, (_, i) => `<circle cx="${(i * 97) % 600}" cy="${(i * 53) % 900}" r="${(i % 3) + 1}" fill="#fff" opacity="${0.3 + (i % 5) / 8}"/>`).join('') +
        `<circle cx="300" cy="400" r="150" fill="${mid}"/><circle cx="350" cy="360" r="150" fill="${bg}" opacity=".55"/><circle cx="300" cy="400" r="175" fill="none" stroke="${accent}" stroke-width="4"/>`
      break
  }
  const words = s.title.toUpperCase().split(' ')
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 ? words : [words[0]]
  const text = lines.map((l, i) => `<text x="300" y="${110 + i * 70}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="62" letter-spacing="4" fill="#fff">${esc(l)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
<rect width="600" height="900" fill="url(#g)"/>${art}
<rect width="600" height="260" fill="url(#g)" opacity=".0"/>${text}
<text x="300" y="860" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="22" letter-spacing="6" fill="#fff" opacity=".7">${esc(s.dev.toUpperCase())}</text>
</svg>`
}

export function seedSamplesIfFirstRun(db: DB): void {
  if (getSetting(db, 'samples_seeded')) return
  const count = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n
  setSetting(db, 'samples_seeded', '1')
  if (count > 0) return
  db.transaction(() => {
    const systems = listSystems(db)
    const sysId = (name: string): number => (systems.find((s) => s.name === name) ?? systems[0]).id
    const catIds = new Map<string, number>()
    const createdCats: number[] = []
    const genresBefore = new Set(listTags(db, 'genres').map((t) => t.id))
    for (const s of SAMPLES) {
      if (s.category && !catIds.has(s.category)) {
        const existing = listTags(db, 'categories').find((t) => t.name === s.category)
        catIds.set(s.category, existing ? existing.id : createTag(db, 'categories', s.category).id)
        if (!existing) createdCats.push(catIds.get(s.category) as number)
      }
    }
    SAMPLES.forEach((s, i) => {
      const cover = writeImageBuffer(Buffer.from(coverSvg(s)), 'svg')
      const copies = [{ system: s.system, format: s.format, store: s.store }, ...(EXTRA_COPIES[s.title] ?? [])]
      const game = saveGame(
        db,
        {
          title: s.title,
          description: s.desc + '\n\n(Sample game — remove it any time from the banner or Settings.)',
          developer: s.dev,
          publisher: s.dev,
          releaseDate: s.release,
          coverFile: cover,
          coverFit: 'cover',
          coverPosX: 50,
          coverPosY: 50,
          coverZoom: 1,
          rating: s.rating,
          notes: i === 0 ? 'Sample note: notes are saved automatically as you type.' : '',
          playStatus: s.status,
          favorite: s.favorite,
          steamAppId: null,
          genreNames: s.genres,
          categoryIds: s.category ? [catIds.get(s.category) as number] : [],
          imageFiles: [],
          copies: copies.map((c) => ({
            systemId: sysId(c.system),
            format: c.format,
            store: c.store,
            steamAppId: null,
            launchType: 'none' as const,
            launchTarget: '',
            launchArgs: '',
            launchWorkDir: ''
          }))
        },
        { source: 'sample', isSample: true }
      )
      // Stagger "date added" so sorting by it is meaningful in the preview.
      db.prepare('UPDATE games SET date_added = ? WHERE id = ?').run(new Date(Date.now() - (SAMPLES.length - i) * 86400000).toISOString(), game.id)
    })
    const createdGenres = listTags(db, 'genres').map((t) => t.id).filter((id) => !genresBefore.has(id))
    setSetting(db, 'sample_tags', JSON.stringify({ categories: createdCats, genres: createdGenres }))
  })()
}

/** Removes categories that only existed for the sample games. */
export function removeSampleTags(db: DB): void {
  let tags: { categories?: number[]; genres?: number[] } = {}
  try {
    tags = JSON.parse(getSetting(db, 'sample_tags') || '{}')
  } catch {
    /* ignore */
  }
  for (const id of tags.categories ?? []) db.prepare('DELETE FROM categories WHERE id = ? AND id NOT IN (SELECT category_id FROM game_categories)').run(id)
  for (const id of tags.genres ?? []) db.prepare('DELETE FROM genres WHERE id = ? AND id NOT IN (SELECT genre_id FROM game_genres)').run(id)
  setSetting(db, 'sample_tags', null)
}
