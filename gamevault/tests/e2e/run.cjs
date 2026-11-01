/**
 * End-to-end verification of GameVault, driving the real Electron app with Playwright.
 *
 *   npm run build && node tests/e2e/run.cjs        (needs a display; on Linux CI use xvfb-run)
 *
 * Covers: persistence across restarts, manual entry, combined filters, favorites, ratings,
 * notes autosave, Steam import against a local mock Steam server (preview, no duplicates on
 * repeat import, personal edits preserved on refresh, installed detection), launching a local
 * program, missing launch paths, backup/restore and CSV export.
 */
const { _electron } = require('playwright-core')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const assert = require('assert')

const ROOT = path.join(__dirname, '..', '..')
const SHOTS = process.env.GV_SHOTS || ''
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-e2e-'))
const dataDir = path.join(work, 'data')
let step = 0
const log = (m) => console.log(`  ✔ ${++step}. ${m}`)

// ---------------- mock Steam ----------------
const mock = {
  owned: [
    { appid: 10, name: 'Mock Game Alpha', playtime_forever: 600 },
    { appid: 20, name: 'Mock Game Beta', playtime_forever: 0 },
    { appid: 30, name: 'Mock Game Gamma', playtime_forever: 30 }
  ],
  developer: 'Alpha Studio v1',
  description: 'Original store description.'
}
// Tiny valid PNG (1x1) padded to pass the size check.
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'),
  Buffer.alloc(1024)
])
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) {
    if (u.searchParams.get('key') !== 'TESTKEY') { res.writeHead(403); return res.end() }
    return json({ response: { game_count: mock.owned.length, games: mock.owned } })
  }
  if (u.pathname.startsWith('/ISteamUser/ResolveVanityURL')) return json({ response: { success: 1, steamid: '76561198000000000' } })
  if (u.pathname === '/api/appdetails') {
    const id = u.searchParams.get('appids')
    if (id === '30') return json({ [id]: { success: false } })
    return json({ [id]: { success: true, data: {
      name: id === '10' ? 'Mock Game Alpha' : 'Mock Game Beta',
      short_description: id === '10' ? mock.description : 'Beta &amp; friends.',
      developers: [id === '10' ? mock.developer : 'Beta Dev'], publishers: ['Mock Pub'],
      release_date: { date: id === '10' ? '21 Aug, 2012' : 'Mar 3, 2020' },
      genres: [{ description: 'Action' }, { description: 'Indie' }]
    } } })
  }
  if (u.pathname.startsWith('/cdn/10/library_600x900')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG) }
  res.writeHead(404); res.end()
})

// Fake Steam install: app 10 installed, others not.
const steamDir = path.join(work, 'Steam')
fs.mkdirSync(path.join(steamDir, 'steamapps', 'common', 'Alpha'), { recursive: true })
fs.writeFileSync(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n "0"\n {\n  "path" "${steamDir.replace(/\\/g, '\\\\')}"\n }\n}\n`)
fs.writeFileSync(path.join(steamDir, 'steamapps', 'appmanifest_10.acf'), '"AppState"\n{\n "appid" "10"\n "name" "Mock Game Alpha"\n "StateFlags" "4"\n "installdir" "Alpha"\n}\n')

async function launch(port) {
  const app = await _electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: ['--no-sandbox', ROOT],
    timeout: 30000,
    env: {
      ...process.env,
      GAMEVAULT_DATA_DIR: dataDir,
      GAMEVAULT_STEAM_API_BASE: `http://127.0.0.1:${port}`,
      GAMEVAULT_STEAM_STORE_BASE: `http://127.0.0.1:${port}`,
      GAMEVAULT_STEAM_CDN_BASE: `http://127.0.0.1:${port}/cdn`,
      GAMEVAULT_STORE_SPACING_MS: '0',
      GAMEVAULT_STEAM_PATH: steamDir
    }
  })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.log('    [pageerror]', e.message))
  await win.setViewportSize({ width: 1400, height: 880 })
  await win.waitForSelector('.topbar')
  return { app, win }
}
const lib = (win) => win.evaluate(() => window.api.getLibrary())
const byTitle = async (win, t) => (await lib(win)).games.find((g) => g.title === t)
const shot = async (win, name) => SHOTS && win.screenshot({ path: path.join(SHOTS, `${name}.png`) })
async function confirmOk(win) {
  await win.click('[data-testid=confirm-ok]')
}
async function stubDialogs(app, { save, open }) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.save })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.open] })
  }, { save, open })
}
async function openGame(win, title) {
  if (await win.isVisible('[data-testid=detail-back]')) await win.click('[data-testid=detail-back]')
  await win.click('.nav-item:has-text("All Games")')
  await win.fill('[data-testid=search]', title)
  await win.click(`[data-testid=game-card]:has-text("${title}")`)
  await win.waitForSelector(`[data-testid=detail-title]:has-text("${title}")`)
}

;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  console.log(`GameVault e2e — data: ${dataDir}`)

  // ================= Launch 1 =================
  let { app, win } = await launch(port)
  await win.waitForSelector('[data-testid=gallery]')
  assert.equal(await win.locator('[data-testid=game-card]').count(), 8)
  await shot(win, '01-gallery-samples')
  log('First run shows 8 sample games with a removal banner')

  await win.click('[data-testid=remove-samples]')
  await confirmOk(win)
  await win.waitForSelector('[data-testid=empty-collection]')
  assert.equal((await lib(win)).games.length, 0)
  assert.equal((await lib(win)).categories.length, 0, 'sample-only categories removed')
  await shot(win, '02-empty')
  log('Samples removed in one click; empty state shown')

  // Manual entry
  await win.click('[data-testid=add-game]')
  await win.fill('[data-testid=edit-title]', 'Hades')
  await win.selectOption('[data-testid=copy-system]', { label: 'PC' })
  await win.click('[data-testid=format-digital]')
  await win.fill('[data-testid=edit-genre]', 'Roguelike')
  await win.press('[data-testid=edit-genre]', 'Enter')
  await win.fill('[data-testid=edit-genre]', 'Action')
  await win.press('[data-testid=edit-genre]', 'Enter')
  await win.fill('[data-testid=edit-date]', 'Sep 17, 2020')
  await win.fill('[data-testid=edit-description]', 'Battle out of hell.')
  await shot(win, '03-editor')
  await win.click('[data-testid=save-game]')
  await win.waitForSelector('[data-testid=detail-title]:has-text("Hades")')
  log('Game added manually through the editor')

  await win.click('.detail .stars.editable .star >> nth=3') // 4 stars
  await win.click('[data-testid=status-playing]')
  await win.click('[data-testid=detail-fav]')
  await win.fill('[data-testid=new-category]', 'Backlog')
  await win.press('[data-testid=new-category]', 'Enter')
  await win.fill('[data-testid=notes]', 'Beat the first boss with the spear.')
  await win.waitForSelector('[data-testid=notes-status]:has-text("Saved")', { timeout: 5000 })
  // Type more and close the app immediately: the before-close flush must save it.
  await win.type('[data-testid=notes]', ' Next: try the bow.')
  await shot(win, '04-detail')
  let hades = await byTitle(win, 'Hades')
  assert.equal(hades.rating, 4)
  assert.equal(hades.playStatus, 'playing')
  assert.equal(hades.favorite, true)
  assert.equal(hades.releaseDate, '2020-09-17')
  log('Rating, play status, favorite, category and notes saved from the detail view')

  await win.click('[data-testid=detail-back]')
  await win.click('[data-testid=add-game]')
  await win.fill('[data-testid=edit-title]', 'Mario Kart 8 Deluxe')
  await win.selectOption('[data-testid=copy-system]', { label: 'Nintendo Switch' })
  await win.click('[data-testid=format-physical]')
  await win.fill('[data-testid=edit-genre]', 'Racing')
  await win.press('[data-testid=edit-genre]', 'Enter')
  await win.click('[data-testid=add-copy]')
  await win.selectOption('[data-testid=copy-system] >> nth=1', { label: 'Nintendo Switch' })
  await win.click('[data-testid=format-digital] >> nth=1')
  await win.click('[data-testid=save-game]')
  await win.waitForSelector('[data-testid=detail-title]:has-text("Mario Kart")')
  const mk = await byTitle(win, 'Mario Kart 8 Deluxe')
  assert.deepEqual(mk.copies.map((c) => c.format).sort(), ['digital', 'physical'])
  log('Same game owned physically and digitally on one entry')
  await win.click('[data-testid=detail-back]')
  // Close the window like the user would (title-bar X): the app flushes pending notes first.
  const exited = new Promise((r) => app.process().once('exit', r))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await exited
  log('Window closed by the user; app exited after flushing pending notes')

  // ================= Launch 2 =================
  ;({ app, win } = await launch(port))
  await win.waitForSelector('[data-testid=gallery]')
  hades = await byTitle(win, 'Hades')
  assert.ok(hades, 'Hades persisted')
  assert.equal(hades.notes, 'Beat the first boss with the spear. Next: try the bow.')
  assert.equal(hades.rating, 4)
  assert.equal(hades.favorite, true)
  assert.equal(hades.playStatus, 'playing')
  assert.equal(hades.categoryIds.length, 1)
  assert.equal(await win.locator('[data-testid=game-card]').count(), 2)
  log('After restart: games, notes (incl. last keystrokes), rating, favorite, status and category persisted')

  // Combined filters through the UI
  await win.click('[data-testid="nav-system-Nintendo Switch"]')
  assert.equal(await win.locator('[data-testid=game-card]').count(), 1)
  await win.click('[data-testid=filter-genre]')
  assert.equal(await win.locator('.menu .menu-item:has-text("Roguelike")').count(), 0, 'genre list scoped to system')
  await win.click('.menu .menu-item:has-text("Racing")')
  await win.keyboard.press('Escape')
  assert.equal(await win.locator('[data-testid=game-card]').count(), 1)
  await win.click('[data-testid=filter-favorites]')
  await win.waitForSelector('[data-testid=empty-results]')
  await win.click('[data-testid=clear-filters]')
  await win.click('.nav-item:has-text("All Games")')
  await win.click('[data-testid=filter-status]')
  await win.click('.menu .menu-item:has-text("Playing")')
  await win.keyboard.press('Escape')
  await win.click('[data-testid=filter-format]')
  await win.click('.menu .menu-item:has-text("Digital")')
  await win.keyboard.press('Escape')
  assert.deepEqual(await win.locator('[data-testid=game-card] .card-title').allTextContents(), ['Hades'])
  await win.fill('[data-testid=search]', 'mario')
  await win.waitForSelector('[data-testid=empty-results]')
  await win.click('[data-testid=clear-filters]')
  await win.click('[data-testid=nav-favorites]')
  assert.deepEqual(await win.locator('[data-testid=game-card] .card-title').allTextContents(), ['Hades'])
  // Toggle favorite directly from a card
  await win.click('.nav-item:has-text("All Games")')
  await win.hover('[data-testid=game-card]:has-text("Mario Kart")')
  await win.click('[data-testid=game-card]:has-text("Mario Kart") [data-testid=fav-toggle]')
  await win.waitForFunction(() => document.querySelector('[data-testid=nav-favorites] .count')?.textContent === '2')
  log('System → genre → status/format/favorites filters combine; search; favorites toggled from a card')

  // ---------------- Steam import (mock) ----------------
  await win.evaluate(() => window.api.steamSetConfig({ apiKey: 'TESTKEY', steamId: '76561198000000000' }))
  await win.click('[data-testid=nav-settings]')
  await win.click('[data-testid=steam-import-library]')
  await win.waitForSelector('[data-testid=import-row]')
  assert.equal(await win.locator('[data-testid=import-row]').count(), 3)
  await shot(win, '05-steam-preview')
  // Deselect Gamma for the first import (preview lets the user choose).
  await win.click('[data-testid=import-row]:has-text("Gamma") input')
  await win.click('[data-testid=import-start]')
  await win.waitForSelector('[data-testid=import-done]', { timeout: 30000 })
  await win.click('[data-testid=import-done]')
  let L = await lib(win)
  assert.equal(L.games.length, 4)
  let alpha = L.games.find((g) => g.steamAppId === 10)
  const beta = L.games.find((g) => g.steamAppId === 20)
  assert.equal(alpha.developer, 'Alpha Studio v1')
  assert.equal(alpha.releaseDate, '2012-08-21')
  assert.ok(alpha.coverFile, 'artwork cached locally')
  assert.ok(fs.existsSync(path.join(dataDir, 'images', alpha.coverFile)))
  assert.equal(alpha.copies[0].launchType, 'steam', 'installed game gets Steam launch')
  assert.equal(beta.copies[0].launchType, 'none', 'not-installed game is NOT marked launchable')
  assert.equal(beta.description, 'Beta & friends.')
  log('Steam preview + selective import; metadata & artwork cached; only installed games launchable')

  // Personal data + a manual metadata edit on a Steam game
  await win.click('.nav-item:has-text("All Games")')
  await openGame(win, 'Mock Game Alpha')
  await win.waitForSelector('[data-testid=pill-installed]')
  await win.click('.detail .stars.editable .star >> nth=4') // 5 stars
  await win.click('[data-testid=detail-fav]')
  await win.fill('[data-testid=notes]', 'My Alpha notes')
  // Open the editor while the notes are still being saved — the editor must not clobber them.
  await win.click('[data-testid=detail-edit]')
  await win.fill('[data-testid=edit-description]', 'My own description.')
  await win.click('[data-testid=save-game]')
  await win.waitForSelector('[data-testid=detail-title]:has-text("Mock Game Alpha")')
  alpha = await byTitle(win, 'Mock Game Alpha')
  assert.deepEqual(alpha.lockedFields, ['description'])
  log('Editing Steam metadata locks that field against refreshes')

  // Re-import everything with changed upstream metadata
  mock.developer = 'Alpha Studio v2'
  mock.description = 'Changed store description.'
  await win.click('[data-testid=detail-back]')
  await win.click('[data-testid=nav-settings]')
  await win.click('[data-testid=steam-import-library]')
  await win.waitForSelector('[data-testid=import-row]')
  await win.click('button:has-text("Select all")')
  await win.click('[data-testid=import-start]')
  await win.waitForSelector('[data-testid=import-done]', { timeout: 30000 })
  const summary = await win.textContent('[data-testid=import-progress]')
  assert.match(summary, /1 added · 2 updated/)
  await win.click('[data-testid=import-done]')
  L = await lib(win)
  assert.equal(L.games.length, 5, 'no duplicates after repeat import')
  assert.equal(L.games.filter((g) => g.steamAppId === 10).length, 1)
  alpha = L.games.find((g) => g.steamAppId === 10)
  assert.equal(alpha.developer, 'Alpha Studio v2', 'unlocked metadata refreshed')
  assert.equal(alpha.description, 'My own description.', 'edited field kept')
  assert.equal(alpha.notes, 'My Alpha notes')
  assert.equal(alpha.rating, 5)
  assert.equal(alpha.favorite, true)
  assert.equal(alpha.copies.length, 1)
  const gamma = L.games.find((g) => g.steamAppId === 30)
  assert.ok(gamma && !gamma.coverFile && gamma.description === '', 'game without store data still imported for manual editing')
  log('Repeat import: no duplicates, metadata refreshed, notes/rating/favorite/manual edits preserved')

  // Refresh from detail view
  mock.developer = 'Alpha Studio v3'
  await openGame(win, 'Mock Game Alpha')
  await win.click('button:has-text("Refresh from Steam")')
  await win.waitForFunction(async () => (await window.api.getLibrary()).games.find((g) => g.steamAppId === 10).developer === 'Alpha Studio v3', null, { timeout: 15000 })
  alpha = await byTitle(win, 'Mock Game Alpha')
  assert.equal(alpha.notes, 'My Alpha notes')
  assert.equal(alpha.description, 'My own description.')
  log('Per-game "Refresh from Steam" keeps personal data')

  // ---------------- Launching ----------------
  const marker = path.join(work, 'launched.txt')
  fs.mkdirSync(path.join(work, 'My Games'), { recursive: true }) // path with a space, like "Program Files"
  const exe = path.join(work, 'My Games', process.platform === 'win32' ? 'game.cmd' : 'game.sh')
  fs.writeFileSync(exe, process.platform === 'win32' ? `@echo off\r\necho %* > "${marker}"\r\n` : `#!/bin/sh\necho "$@" > "${marker}"\n`)
  fs.chmodSync(exe, 0o755)
  await openGame(win, 'Hades')
  assert.equal(await win.locator('[data-testid=play]').count(), 0, 'no Play button without a launch method')
  await win.click('[data-testid=configure-launch]')
  await win.selectOption('[data-testid=launch-type]', 'executable')
  await win.fill('[data-testid=launch-target]', exe)
  await win.fill('input[placeholder="(none)"]', '--fast "two words"')
  await win.click('[data-testid=save-launch]')
  await win.waitForSelector('[data-testid=pill-installed]')
  await shot(win, '06-detail-launch')
  await win.click('[data-testid=play]')
  for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal(fs.readFileSync(marker, 'utf8').replace(/"/g, '').trim(), '--fast two words')
  log('Configured program launched from the detail view with arguments')

  fs.unlinkSync(exe)
  await win.click('[data-testid=detail-back]')
  await openGame(win, 'Hades')
  await win.waitForSelector('[data-testid=pill-missing]')
  assert.equal(await win.locator('[data-testid=play]').count(), 0, 'Play hidden when file missing')
  assert.match(await win.textContent('[data-testid=launch-problem]'), /File not found/)
  const res = await win.evaluate(async (id) => window.api.launch(id), (await byTitle(win, 'Hades')).copies[0].id)
  assert.equal(res.ok, false)
  assert.equal(res.state, 'missing_file')
  await shot(win, '07-missing-path')
  await win.click('[data-testid=remove-launch]')
  await confirmOk(win)
  await win.waitForFunction(async () => (await window.api.getLibrary()).games.find((g) => g.title === 'Hades').copies[0].launchType === 'none')
  log('Missing launch file detected and explained; Play hidden; launch path removed')

  // ---------------- Backup / restore / CSV ----------------
  const zip = path.join(work, 'backup.zip')
  const csv = path.join(work, 'export.csv')
  await win.click('[data-testid=detail-back]')
  await win.click('[data-testid=nav-settings]')
  await stubDialogs(app, { save: zip, open: zip })
  await win.click('[data-testid=backup]')
  for (let i = 0; i < 50 && !fs.existsSync(zip); i++) await new Promise((r) => setTimeout(r, 100))
  assert.ok(fs.statSync(zip).size > 1000)
  await stubDialogs(app, { save: csv, open: zip })
  await win.click('[data-testid=csv]')
  for (let i = 0; i < 50 && !fs.existsSync(csv); i++) await new Promise((r) => setTimeout(r, 100))
  const csvText = fs.readFileSync(csv, 'utf8')
  assert.match(csvText, /^﻿Title,Systems,Formats/)
  assert.match(csvText, /\r\nHades,PC,Digital,,(Action; Roguelike|Roguelike; Action),Backlog,Playing,4,Yes,2020-09-17/)
  log('Backup zip and CSV export written')

  // Destroy data, then restore
  await openGame(win, 'Hades')
  await win.click('[data-testid=detail-delete]')
  await confirmOk(win)
  await win.waitForFunction(async () => !(await window.api.getLibrary()).games.some((g) => g.title === 'Hades'))
  await win.click('[data-testid=nav-settings]')
  await win.click('[data-testid=restore]')
  await confirmOk(win)
  await win.waitForFunction(async () => (await window.api.getLibrary()).games.some((g) => g.title === 'Hades'), null, { timeout: 15000 })
  hades = await byTitle(win, 'Hades')
  assert.equal(hades.notes, 'Beat the first boss with the spear. Next: try the bow.')
  alpha = await byTitle(win, 'Mock Game Alpha')
  assert.ok(fs.existsSync(path.join(dataDir, 'images', alpha.coverFile)), 'artwork restored')
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.startsWith('before-restore-')), 'safety backup created')
  log('Deleted game recovered by restoring the backup (notes, artwork, categories); safety backup made')
  await app.close()

  // ================= Launch 3 =================
  ;({ app, win } = await launch(port))
  await win.waitForSelector('[data-testid=gallery]')
  L = await lib(win)
  assert.equal(L.games.length, 5)
  assert.equal(L.games.find((g) => g.title === 'Hades').rating, 4)
  await win.click('.nav-item:has-text("All Games")')
  await shot(win, '08-final')
  log('Restored collection persists after another restart')
  await app.close()

  server.close()
  console.log(`\nAll ${step} checks passed.`)
  if (!process.env.GV_KEEP) fs.rmSync(work, { recursive: true, force: true })
})().catch((e) => {
  console.error('\n✘ E2E FAILED:', e)
  process.exit(1)
})
