/**
 * Stage 5: Big Picture. Driven with the keyboard, which goes through the same input handler as the
 * Xbox controller (arrows = D-pad/stick, Enter = A, Esc = B, X = X, Y = Y, Q/E = LB/RB, Tab = Menu).
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

function wav(file, seconds = 3) {
  const rate = 8000
  const n = rate * seconds
  const b = Buffer.alloc(44 + n)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28)
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
  b.fill(128, 44)
  fs.writeFileSync(file, b)
}

module.exports = async function stage5(t) {
  const { app, win, work, byTitle, until, nav, shot, log, closeApp, launch } = t
  const music = path.join(work, 'Music')
  fs.mkdirSync(music, { recursive: true })
  wav(path.join(music, 'File City Morning.wav'))
  await win.evaluate((m) => window.api.setPrefs({ musicFolder: m, musicVolume: 0.3 }), music)

  await nav(win, 'nav-all')
  await win.setViewportSize({ width: 1680, height: 720 })
  await win.click('[data-testid=open-bigpicture]')
  await win.waitForSelector('[data-testid=bigpicture]')
  const shelves = await win.locator('[data-testid=bp-shelf]').allTextContents()
  assert.equal(shelves[0], 'Playing')
  assert.ok(shelves.includes('All Games') && shelves.includes('PlayStation 1') && shelves.includes('Digimon Series'), shelves.join(','))
  await win.waitForSelector('[data-testid=bp-music]:has-text("File City Morning")')
  const fullscreen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
  assert.equal(fullscreen, true)
  await win.waitForTimeout(400)
  await shot(win, 'f09-bigpicture-home')
  log('Big Picture opens full screen with shelves (Playing first, systems, collections) and music from your folder')

  // Shelf & game navigation
  const firstTitle = await win.textContent('[data-testid=bp-title]')
  await win.keyboard.press('ArrowRight')
  await until(async () => (await win.textContent('[data-testid=bp-title]')) !== firstTitle, 'move right')
  await win.keyboard.press('e') // RB: next shelf (Backlog)
  await until(async () => (await win.locator('.bp-shelf.on').textContent()) === 'Backlog', 'next shelf')
  await win.keyboard.press('q') // LB: back to Playing
  await until(async () => (await win.locator('.bp-shelf.on').textContent()) === 'Playing', 'previous shelf')
  // Jump to the PlayStation 1 shelf and pick Crash Team Racing
  while ((await win.locator('.bp-shelf.on').textContent()) !== 'PlayStation 1') await win.keyboard.press('e')
  for (let i = 0; i < 8 && (await win.textContent('[data-testid=bp-title]')) !== 'Crash Team Racing'; i++) await win.keyboard.press('ArrowRight')
  assert.equal(await win.textContent('[data-testid=bp-title]'), 'Crash Team Racing')
  log('D-pad/stick moves between games; LB/RB switch shelves')

  // Game page: favorite with Y, backlog with X, B to go back
  await win.keyboard.press('x')
  await win.waitForSelector('[data-testid=bp-game]')
  const before = (await byTitle(win, 'Crash Team Racing')).favorite
  await win.keyboard.press('y')
  await until(async () => (await byTitle(win, 'Crash Team Racing')).favorite === !before, 'favorite via Y')
  await win.keyboard.press('x')
  await until(async () => (await byTitle(win, 'Crash Team Racing')).backlog === true, 'backlog via X')
  await win.waitForTimeout(1200)
  await shot(win, 'f10-bigpicture-game')
  await win.keyboard.press('Escape')
  await win.waitForSelector('[data-testid=bp-game]', { state: 'detached' })
  log('Game page: Y favorites, X adds to backlog, B goes back')

  // A on the home screen launches through the emulator; play time is tracked
  const sessions = (await byTitle(win, 'Crash Team Racing')).sessionCount
  await win.keyboard.press('Enter')
  await until(async () => (await byTitle(win, 'Crash Team Racing')).sessionCount === sessions + 1, 'launch from Big Picture', 15000)
  log('A launches the game from Big Picture (emulator) and the session is recorded')

  // Menu → Exit Big Picture
  await win.keyboard.press('Tab')
  await win.waitForSelector('[data-testid=bp-menu]')
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await win.waitForSelector('.topbar')
  await until(async () => !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())), 'left full screen')
  await win.setViewportSize({ width: 1400, height: 880 })
  log('Menu → Exit Big Picture returns to the desktop view')

  // Start in Big Picture
  await win.evaluate(() => window.api.setPrefs({ startInBigPicture: true }))
  await closeApp(app)
  const r = await launch()
  await r.win.waitForSelector('[data-testid=bigpicture]')
  await r.win.keyboard.press('F11')
  await r.win.waitForSelector('.topbar')
  await r.win.evaluate(() => window.api.setPrefs({ startInBigPicture: false }))
  t.app = r.app
  t.win = r.win
  log('"Start GameVault in Big Picture" works; F11 leaves it')
}
