/**
 * End-to-end checks for the organizing, play-time, online-source, emulator and Big Picture features.
 *
 *   npm run build && node tests/e2e/features.cjs      (needs a display; on Linux use xvfb-run)
 */
const { _electron } = require('playwright-core')
const { execFileSync } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const assert = require('assert')

const ROOT = path.join(__dirname, '..', '..')
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'))
const SHOTS = process.env.GV_SHOTS || ''
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-feat-'))
const dataDir = path.join(work, 'data')
fs.mkdirSync(dataDir, { recursive: true })
let step = 0
const log = (m) => console.log(`  ✔ ${++step}. ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock online services (IGDB, Twitch auth, SteamGridDB, Steam store) ----------------
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'),
  Buffer.alloc(1024)
])
const calls = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    calls.push({ path: u.pathname, body, auth: req.headers.authorization || '', clientId: req.headers['client-id'] || '' })
    const json = (o, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (u.pathname === '/oauth2/token') {
      if (u.searchParams.get('client_id') !== 'CID' || u.searchParams.get('client_secret') !== 'SECRET') return json({ message: 'invalid client' }, 400)
      return json({ access_token: 'TOKEN', expires_in: 5000000, token_type: 'bearer' })
    }
    if (u.pathname === '/v4/games') {
      if (req.headers.authorization !== 'Bearer TOKEN') return json({ message: 'unauthorized' }, 401)
      if (/where id = 1001/.test(body))
        return json([{
          id: 1001, name: 'Okami', summary: 'A wolf goddess restores colour to the world.',
          first_release_date: 1158624000, genres: [{ name: 'Adventure' }, { name: 'Action' }],
          involved_companies: [{ developer: true, publisher: false, company: { name: 'Clover Studio' } }, { developer: false, publisher: true, company: { name: 'Capcom' } }],
          platforms: [{ name: 'PlayStation 2' }], cover: { image_id: 'co1abc' }, videos: [{ video_id: 'yt123' }], screenshots: [{ image_id: 'sc1' }]
        }])
      if (/search "okami"/i.test(body))
        return json([
          { id: 1001, name: 'Okami', first_release_date: 1158624000, platforms: [{ name: 'PlayStation 2' }], cover: { image_id: 'co1abc' } },
          { id: 1002, name: 'Okami HD', first_release_date: 1512086400, platforms: [{ name: 'PC (Microsoft Windows)' }], cover: { image_id: 'co2def' } }
        ])
      if (/search "crash team racing"/i.test(body)) return json([{ id: 2001, name: 'Crash Team Racing', first_release_date: 937094400, platforms: [{ name: 'PlayStation' }], cover: { image_id: 'co3' } }])
      if (/search "spyro the dragon"/i.test(body)) return json([{ id: 2002, name: 'Spyro the Dragon', first_release_date: 905212800, platforms: [{ name: 'PlayStation' }], cover: { image_id: 'co4' } }])
      if (/where id = (2001|2002)/.test(body)) {
        const id = Number(/where id = (\d+)/.exec(body)[1])
        return json([{ id, name: id === 2001 ? 'Crash Team Racing' : 'Spyro the Dragon', summary: 'Retro classic.', first_release_date: 937094400, genres: [{ name: 'Racing' }], platforms: [{ name: 'PlayStation' }], cover: { image_id: 'co' + id } }])
      }
      return json([])
    }
    if (u.pathname.startsWith('/igdbimg/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    if (u.pathname.startsWith('/sgdb/api/v2/')) {
      if (req.headers.authorization !== 'Bearer SGDBKEY') return json({ success: false, errors: ['bad key'] }, 401)
      const p = u.pathname.replace('/sgdb/api/v2', '')
      if (p.startsWith('/search/autocomplete/')) return json({ success: true, data: [{ id: 77, name: 'Okami' }] })
      if (p.startsWith('/grids/game/77')) return json({ success: true, data: [1, 2, 3].map((i) => ({ id: i, url: `http://127.0.0.1:${port}/sgdbimg/grid${i}.png`, thumb: `http://127.0.0.1:${port}/sgdbimg/grid${i}.png`, width: 600, height: 900 })) })
      if (p.startsWith('/heroes/game/77')) return json({ success: true, data: [{ id: 9, url: `http://127.0.0.1:${port}/sgdbimg/hero.png`, thumb: `http://127.0.0.1:${port}/sgdbimg/hero.png` }] })
      if (p.startsWith('/logos/game/77')) return json({ success: true, data: [{ id: 8, url: `http://127.0.0.1:${port}/sgdbimg/logo.png`, thumb: `http://127.0.0.1:${port}/sgdbimg/logo.png` }] })
      return json({ success: true, data: [] })
    }
    if (u.pathname.startsWith('/sgdbimg/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    if (u.pathname === '/api/storesearch/') return json({ total: 0, items: [] })
    res.writeHead(404)
    res.end()
  })
})
let port = 0

// ---------------- helpers ----------------
async function launch(extraEnv = {}) {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['--no-sandbox', ROOT],
    timeout: 30000,
    env: {
      ...process.env,
      GAMEVAULT_DATA_DIR: dataDir,
      GAMEVAULT_NO_SAMPLES: '1',
      GAMEVAULT_MIN_SESSION_SECONDS: '1',
      GAMEVAULT_IGDB_BASE: `http://127.0.0.1:${port}/v4`,
      GAMEVAULT_TWITCH_TOKEN_URL: `http://127.0.0.1:${port}/oauth2/token`,
      GAMEVAULT_IGDB_IMAGE_BASE: `http://127.0.0.1:${port}/igdbimg`,
      GAMEVAULT_SGDB_BASE: `http://127.0.0.1:${port}/sgdb/api/v2`,
      GAMEVAULT_STEAM_STORE_BASE: `http://127.0.0.1:${port}`,
      GAMEVAULT_STEAM_CDN_BASE: `http://127.0.0.1:${port}/cdn`,
      GAMEVAULT_STORE_SPACING_MS: '0',
      ...extraEnv
    }
  })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.log('    [pageerror]', e.message))
  await win.setViewportSize({ width: 1400, height: 880 })
  await win.waitForSelector('.topbar, .bp')
  return { app, win }
}
async function closeApp(app) {
  const exited = new Promise((r) => app.process().once('exit', r))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await exited
}
const lib = (win) => win.evaluate(() => window.api.getLibrary())
const byTitle = async (win, t) => (await lib(win)).games.find((g) => g.title === t)
const shot = async (win, name) => SHOTS && win.screenshot({ path: path.join(SHOTS, `${name}.png`) })
async function until(check, what, timeout = 10000) {
  const end = Date.now() + timeout
  while (!(await check().catch(() => false))) {
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what)
    await sleep(100)
  }
}
const titles = (win) => win.locator('[data-testid=game-card] .card-title').allTextContents()
async function nav(win, id) {
  if (await win.isVisible('[data-testid=detail-back]')) await win.click('[data-testid=detail-back]')
  await win.click(`[data-testid="${id}"]`)
}
async function openGame(win, title) {
  await nav(win, 'nav-all')
  await win.fill('[data-testid=search]', title)
  await win.click(`[data-testid=game-card]:has-text("${title}")`)
  await win.waitForSelector(`[data-testid=detail-title]:has-text("${title}")`)
  await win.fill('[data-testid=search]', '').catch(() => {})
}
async function addGame(win, title, system, format = 'physical') {
  await win.click('[data-testid=add-game]')
  await win.fill('[data-testid=edit-title]', title)
  if (process.env.GV_DEBUG) console.log(await win.locator('[data-testid=copy-system] option').allTextContents())
  await win.selectOption('[data-testid=copy-system]', { label: system })
  await win.click(`[data-testid=format-${format}]`)
  await win.click('[data-testid=save-game]')
  await win.waitForSelector(`[data-testid=detail-title]:has-text("${title}")`)
  await win.click('[data-testid=detail-back]')
}
async function prompt(win, text) {
  await win.fill('[data-testid=prompt-input]', text)
  await win.click('[data-testid=prompt-ok]')
}

/** Creates a database exactly like GameVault 1.0 did (schema v1) with one game, to test the upgrade. */
function makeV1Database() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'db.ts'), 'utf8')
  const v1 = /const MIGRATIONS: string\[\] = \[\s*\/\/ v1\s*`([\s\S]*?)`/.exec(src)[1]
  const script = `
    const Database = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'better-sqlite3'))})
    const db = new Database(${JSON.stringify(path.join(dataDir, 'gamevault.db'))})
    db.exec(${JSON.stringify(v1)})
    db.prepare("INSERT INTO systems (name, kind, builtin, sort_order) VALUES ('PC','pc',1,0),('PlayStation 5','console',1,1)").run()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO games (title, notes, rating, favorite, play_status, date_added, updated_at) VALUES ('Old Favourite', 'Notes from version 1.0', 5, 1, 'completed', ?, ?)").run(now, now)
    db.prepare("INSERT INTO copies (game_id, system_id, format, store) VALUES (1, 2, 'physical', 'Retail')").run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('samples_seeded', '1')").run()
    db.pragma('user_version = 1')
    db.close()`
  execFileSync(ELECTRON, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
}

;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
  console.log(`GameVault feature e2e — data: ${dataDir}`)

  // ================= Upgrade from 1.0 =================
  makeV1Database()
  let { app, win } = await launch()
  await win.waitForSelector('[data-testid=gallery]')
  let old = await byTitle(win, 'Old Favourite')
  assert.ok(old, 'game from 1.0 kept')
  assert.equal(old.notes, 'Notes from version 1.0')
  assert.equal(old.rating, 5)
  assert.equal(old.backlog, false)
  assert.equal(old.wishlist, false)
  assert.deepEqual(old.collectionIds, [])
  assert.ok((await lib(win)).systems.some((s) => s.name === 'PlayStation 1'), 'retro systems added')
  log('A 1.0 database upgrades in place: games, notes and ratings kept; retro systems added')

  // ================= Collections =================
  await addGame(win, 'Digimon World', 'PlayStation 1')
  await addGame(win, 'Digimon World 2', 'PlayStation 1')
  await addGame(win, 'Digimon Survive', 'PlayStation 5', 'digital')
  await addGame(win, 'Hades', 'PC', 'digital')

  await win.click('[data-testid=new-collection]')
  await prompt(win, 'Digimon')
  await win.waitForSelector('[data-testid=collection-header]:has-text("Digimon")')
  await win.waitForSelector('[data-testid=empty-view]')
  await win.click('[data-testid=collection-add-games]')
  await win.fill('[data-testid=add-games-search]', 'digimon')
  for (const t of ['Digimon World', 'Digimon World 2']) await win.click(`[data-testid=add-games-row]:has-text("${t}") >> nth=0`)
  await win.click('[data-testid=add-games-confirm]')
  await until(async () => (await titles(win)).length === 2, 'two games in collection')
  // Add the Switch game from its own page via the collections menu.
  await openGame(win, 'Digimon Survive')
  await win.click('[data-testid=detail-add-collection]')
  await win.click('[data-testid=collection-menu] .menu-item:has-text("Digimon") input')
  await win.waitForSelector('[data-testid=detail-collection-tag]:has-text("Digimon")')
  // A game can be in many collections: create a second one from the same menu.
  await win.fill('[data-testid=collection-menu-new]', 'Monster Raising')
  await win.press('[data-testid=collection-menu-new]', 'Enter')
  await win.waitForSelector('[data-testid=detail-collection-tag]:has-text("Monster Raising")')
  await win.keyboard.press('Escape')
  await nav(win, 'nav-collection-Digimon')
  assert.deepEqual((await titles(win)).sort(), ['Digimon Survive', 'Digimon World', 'Digimon World 2'])
  assert.match(await win.textContent('[data-testid=collection-header]'), /3 games · 2 systems/)
  await shot(win, 'f01-collection')
  log('Collections: created from the sidebar, filled from the page, the game page and a second collection')

  // Remove from collection (game stays in library), rename, delete
  await win.hover('[data-testid=game-card]:has-text("Digimon World 2")')
  await win.click('[data-testid=game-card]:has-text("Digimon World 2") [data-testid=remove-from-collection]')
  await until(async () => (await titles(win)).length === 2, 'removal')
  assert.ok(await byTitle(win, 'Digimon World 2'), 'removed game still in library')
  await win.click('[data-testid=collection-rename]')
  await prompt(win, 'Digimon Series')
  await win.waitForSelector('[data-testid="nav-collection-Digimon Series"]')
  await nav(win, 'nav-collection-Monster Raising')
  await win.click('[data-testid=collection-delete]')
  await win.click('[data-testid=confirm-ok]')
  await win.waitForSelector('[data-testid="nav-collection-Monster Raising"]', { state: 'detached' })
  assert.equal((await lib(win)).games.filter((g) => !g.wishlist).length, 5, 'deleting a collection keeps its games')
  log('Remove from collection keeps the game; rename and delete collection work')

  // ================= Multi-select =================
  await nav(win, 'nav-all')
  await win.click('[data-testid=select-mode]')
  for (const t of ['Hades', 'Digimon World 2']) await win.click(`[data-testid=game-card]:has-text("${t}") >> nth=0`)
  await win.waitForSelector('[data-testid=bulk-bar]:has-text("2 selected")')
  await shot(win, 'f02-multiselect')
  await win.click('[data-testid=bulk-backlog]')
  await until(async () => (await byTitle(win, 'Hades')).backlog && (await byTitle(win, 'Digimon World 2')).backlog, 'bulk backlog')
  await win.click('[data-testid=bulk-collection]')
  await win.fill('[data-testid=collection-menu-new]', 'Weekend')
  await win.press('[data-testid=collection-menu-new]', 'Enter')
  await until(async () => (await lib(win)).collections.some((c) => c.name === 'Weekend'), 'bulk collection')
  const weekend = (await lib(win)).collections.find((c) => c.name === 'Weekend').id
  assert.ok((await byTitle(win, 'Hades')).collectionIds.includes(weekend))
  await win.click('[data-testid=select-mode]')
  log('Multi-select: mark several games Backlog and add them to a new collection at once')

  // ================= Backlog & Playing =================
  await nav(win, 'nav-backlog')
  assert.deepEqual((await titles(win)).sort(), ['Digimon World 2', 'Hades'])
  await openGame(win, 'Digimon World')
  await win.click('[data-testid=detail-backlog]')
  await until(async () => (await byTitle(win, 'Digimon World')).backlog, 'backlog toggle')
  await win.click('[data-testid=status-playing]')
  await until(async () => (await byTitle(win, 'Digimon World')).playStatus === 'playing', 'playing')
  assert.equal((await byTitle(win, 'Digimon World')).backlog, false, 'Playing takes it off the backlog')
  await nav(win, 'nav-playing')
  assert.deepEqual(await titles(win), ['Digimon World'])
  await nav(win, 'nav-backlog')
  assert.deepEqual((await titles(win)).sort(), ['Digimon World 2', 'Hades'])
  log('Backlog only holds games you mark; setting Playing moves a game from Backlog to Playing')

  // ================= Wishlist =================
  await nav(win, 'nav-wishlist')
  await win.waitForSelector('[data-testid=empty-view]')
  await win.click('[data-testid=add-wishlist]')
  await win.fill('[data-testid=edit-title]', 'Chrono Cross')
  await win.fill('[data-testid=wish-note]', 'Want the PS1 original.')
  await win.click('[data-testid=save-game]')
  await win.waitForSelector('[data-testid=game-card]:has-text("Chrono Cross")')
  let cc = await byTitle(win, 'Chrono Cross')
  assert.equal(cc.wishlist, true)
  assert.equal(cc.notes, 'Want the PS1 original.')
  await nav(win, 'nav-all')
  assert.ok(!(await titles(win)).includes('Chrono Cross'), 'wishlist kept out of the collection')
  assert.equal(await win.textContent('[data-testid=nav-all] .count'), '5')
  await nav(win, 'nav-wishlist')
  await win.hover('[data-testid=game-card]:has-text("Chrono Cross")')
  await win.click('[data-testid=edit-wish-note]')
  await prompt(win, 'Want the PS1 original. Max $40.')
  await until(async () => (await byTitle(win, 'Chrono Cross')).notes.includes('$40'), 'note saved')
  await shot(win, 'f03-wishlist')
  await win.hover('[data-testid=game-card]:has-text("Chrono Cross")')
  await win.click('[data-testid=got-it]')
  await win.selectOption('[data-testid=copy-system]', { label: 'PlayStation 1' })
  await win.click('[data-testid=format-physical]')
  await win.click('[data-testid=save-game]')
  await win.waitForSelector('[data-testid=detail-title]:has-text("Chrono Cross")')
  cc = await byTitle(win, 'Chrono Cross')
  assert.equal(cc.wishlist, false)
  assert.equal(cc.copies[0].format, 'physical')
  assert.equal(cc.notes, 'Want the PS1 original. Max $40.')
  log('Wishlist: add with a note, kept out of the collection, "I got it!" moves it in with its note')

  // ================= Play time =================
  const marker = path.join(work, 'ran.txt')
  const exe = path.join(work, process.platform === 'win32' ? 'game.cmd' : 'game.sh')
  fs.writeFileSync(exe, process.platform === 'win32' ? `@echo off\r\necho ran > "${marker}"\r\nping -n 3 127.0.0.1 > nul\r\n` : `#!/bin/sh\necho ran > "${marker}"\nsleep 2\n`)
  fs.chmodSync(exe, 0o755)
  await openGame(win, 'Hades')
  await win.click('[data-testid=configure-launch]')
  await win.selectOption('[data-testid=launch-type]', 'executable')
  await win.fill('[data-testid=launch-target]', exe)
  await win.click('[data-testid=save-launch]')
  await win.waitForSelector('[data-testid=pill-installed]')
  await win.click('[data-testid=play]')
  await until(async () => (await byTitle(win, 'Hades')).sessionCount === 1, 'play session recorded', 15000)
  const hades = await byTitle(win, 'Hades')
  assert.ok(hades.playSeconds >= 1 && hades.playSeconds < 30, `tracked ${hades.playSeconds}s`)
  assert.ok(hades.lastPlayedAt)
  assert.equal(hades.playStatus, 'playing', 'launching a Not Started game marks it Playing')
  assert.equal(hades.backlog, false, '...and takes it off the backlog')
  await win.waitForSelector('[data-testid=playtime-total]')
  log('Play time is recorded when a game launched from GameVault closes')

  // ================= Stats & Surprise me =================
  await win.click('[data-testid=detail-back]')
  await win.click('[data-testid=nav-stats]')
  await win.waitForSelector('[data-testid=stats]')
  assert.equal(await win.textContent('[data-testid=stat-owned]'), '6')
  await shot(win, 'f04-stats')
  await nav(win, 'nav-all')
  await win.click('[data-testid=surprise-open]')
  await win.selectOption('[data-testid=surprise-pool]', 'backlog')
  const pick = await win.textContent('[data-testid=surprise-pick]')
  assert.match(pick, /Digimon World 2/, 'only backlog game left')
  await win.keyboard.press('Escape')
  log('Stats page counts the collection (not the wishlist); Surprise me picks from the backlog')

  await closeApp(app)

  // ================= Restart: everything persists =================
  ;({ app, win } = await launch())
  await win.waitForSelector('[data-testid=gallery]')
  const L = await lib(win)
  assert.deepEqual(L.collections.map((c) => c.name).sort(), ['Digimon Series', 'Weekend'])
  assert.equal(L.games.find((g) => g.title === 'Hades').sessionCount, 1)
  assert.equal(L.games.find((g) => g.title === 'Digimon World 2').backlog, true)
  log('Collections, backlog, wishlist changes and play time persist after restart')

  globalThis.__gv = { app, win, work, dataDir, port, calls, launch, closeApp, lib, byTitle, shot, until, titles, nav, openGame, prompt, log }
  // Later stages add their checks in features-stage*.cjs files.
  for (const f of fs.readdirSync(__dirname).filter((n) => /^features-stage\d+\.cjs$/.test(n)).sort()) await require(path.join(__dirname, f))(globalThis.__gv)
  await globalThis.__gv.closeApp(globalThis.__gv.app)

  server.close()
  console.log(`\nAll ${step} feature checks passed.`)
  if (!process.env.GV_KEEP) fs.rmSync(work, { recursive: true, force: true })
})().catch((e) => {
  console.error('\n✘ FEATURE E2E FAILED:', e)
  process.exit(1)
})
