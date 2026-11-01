import { describe, expect, it } from 'vitest'
import { applyFilters, DEFAULT_FILTERS, filterGames, parseLooseDate, sortGames, type FilterState } from '@shared/filter'
import type { Game } from '@shared/types'

let nextId = 1
function game(p: Partial<Game> & { systems?: Array<[number, 'physical' | 'digital']> }): Game {
  const id = nextId++
  return {
    id, title: 'Untitled', description: '', developer: '', publisher: '', releaseDate: '', coverFile: null, coverFit: 'cover',
    coverPosX: 50, coverPosY: 50, coverZoom: 1, rating: null, notes: '', playStatus: 'not_started', favorite: false,
    dateAdded: `2024-01-${String(id).padStart(2, '0')}T00:00:00Z`, updatedAt: '', steamAppId: null, source: 'manual', lockedFields: [],
    isSample: false, genreIds: [], categoryIds: [], images: [],
    copies: (p.systems ?? [[1, 'digital']]).map(([systemId, format], i) => ({
      id: id * 10 + i, gameId: id, systemId, format, store: '', steamAppId: null, launchType: 'none', launchTarget: '', launchArgs: '', launchWorkDir: ''
    })),
    ...p
  } as Game
}

const PC = 1, PS5 = 2, SWITCH = 3
const RPG = 10, ACTION = 11, PUZZLE = 12
const BACKLOG = 20, COOP = 21

const games = [
  game({ title: 'The Witcher 3', genreIds: [RPG, ACTION], categoryIds: [BACKLOG], playStatus: 'playing', rating: 5, favorite: true, releaseDate: '2015-05-19', systems: [[PC, 'digital'], [PS5, 'physical']] }),
  game({ title: 'Portal 2', genreIds: [PUZZLE], categoryIds: [COOP], playStatus: 'completed', rating: 4, releaseDate: '2011-04', systems: [[PC, 'digital']] }),
  game({ title: 'Astro Bot', genreIds: [ACTION], playStatus: 'completed', rating: null, favorite: true, releaseDate: '2024', systems: [[PS5, 'physical']] }),
  game({ title: 'Zelda: Echoes', genreIds: [ACTION, PUZZLE], categoryIds: [BACKLOG, COOP], playStatus: 'not_started', rating: 3, releaseDate: '', systems: [[SWITCH, 'digital']] }),
  game({ title: 'Élite Dangerous', genreIds: [], playStatus: 'dropped', rating: 2, releaseDate: '2014-12-16', systems: [[PC, 'digital']] })
]
const F = (p: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...p })
const titles = (gs: Game[]): string[] => gs.map((g) => g.title)

describe('filters combine', () => {
  it('system view then genre', () => {
    expect(titles(filterGames(games, F({ view: { kind: 'system', systemId: PS5 }, genreIds: [ACTION] })))).toEqual(['The Witcher 3', 'Astro Bot'])
  })
  it('system + genre + status + favorites + category all together', () => {
    const r = filterGames(games, F({ view: { kind: 'system', systemId: PC }, genreIds: [RPG, PUZZLE], statuses: ['playing', 'completed'], categoryIds: [BACKLOG], favoritesOnly: true }))
    expect(titles(r)).toEqual(['The Witcher 3'])
  })
  it('genre values are OR-ed, filter types are AND-ed', () => {
    expect(titles(filterGames(games, F({ genreIds: [RPG, PUZZLE] })))).toEqual(['The Witcher 3', 'Portal 2', 'Zelda: Echoes'])
    expect(titles(filterGames(games, F({ genreIds: [RPG, PUZZLE], categoryIds: [COOP] })))).toEqual(['Portal 2', 'Zelda: Echoes'])
  })
  it('favorites view', () => {
    expect(titles(filterGames(games, F({ view: { kind: 'favorites' } })))).toEqual(['The Witcher 3', 'Astro Bot'])
  })
  it('format filter respects the selected system copy', () => {
    expect(titles(filterGames(games, F({ formats: ['physical'] })))).toEqual(['The Witcher 3', 'Astro Bot'])
    expect(titles(filterGames(games, F({ view: { kind: 'system', systemId: PC }, formats: ['physical'] })))).toEqual([])
  })
  it('search by title ignores case and accents', () => {
    expect(titles(filterGames(games, F({ search: 'elite' })))).toEqual(['Élite Dangerous'])
    expect(titles(filterGames(games, F({ search: 'witcher 3' })))).toEqual(['The Witcher 3'])
    expect(titles(filterGames(games, F({ search: 'zelda', statuses: ['completed'] })))).toEqual([])
  })
})

describe('sorting', () => {
  it('title ignores leading "The"', () => {
    expect(titles(sortGames(games, 'title', 'asc'))).toEqual(['Astro Bot', 'Élite Dangerous', 'Portal 2', 'The Witcher 3', 'Zelda: Echoes'])
  })
  it('rating desc puts unrated last', () => {
    expect(titles(sortGames(games, 'rating', 'desc'))).toEqual(['The Witcher 3', 'Portal 2', 'Zelda: Echoes', 'Élite Dangerous', 'Astro Bot'])
    expect(titles(sortGames(games, 'rating', 'asc')).at(-1)).toBe('Astro Bot')
  })
  it('release date handles partial dates and unknowns last', () => {
    expect(titles(sortGames(games, 'releaseDate', 'asc'))).toEqual(['Portal 2', 'Élite Dangerous', 'The Witcher 3', 'Astro Bot', 'Zelda: Echoes'])
    expect(titles(sortGames(games, 'releaseDate', 'desc'))).toEqual(['Astro Bot', 'The Witcher 3', 'Élite Dangerous', 'Portal 2', 'Zelda: Echoes'])
  })
  it('date added', () => {
    expect(titles(applyFilters(games, F({ sortKey: 'dateAdded', sortDir: 'desc' })))[0]).toBe('Élite Dangerous')
  })
})

describe('parseLooseDate', () => {
  it.each([
    ['21 Aug, 2012', '2012-08-21'],
    ['Aug 21, 2012', '2012-08-21'],
    ['Sept 3, 2019', '2019-09-03'],
    ['March 2020', '2020-03'],
    ['Q4 2024', '2024'],
    ['2023-9-5', '2023-09-05'],
    ['Coming soon', ''],
    ['', '']
  ])('%s -> %s', (input, out) => expect(parseLooseDate(input)).toBe(out))
})
