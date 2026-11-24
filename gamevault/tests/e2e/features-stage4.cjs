/** Stage 4: emulator setups, folder scan with online lookup, launching through the emulator, play time. */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

module.exports = async function stage4(t) {
  const { win, work, byTitle, lib, until, nav, openGame, shot, log } = t
  const win32 = process.platform === 'win32'
  // A stand-in "emulator": records its arguments, then runs for 2 seconds.
  const emuDir = path.join(work, 'Emulators', 'DuckStation')
  const games = path.join(work, 'Games', 'PS1')
  const bios = path.join(work, 'Emulators', 'bios')
  fs.mkdirSync(emuDir, { recursive: true })
  fs.mkdirSync(path.join(games, 'Final Fantasy VII'), { recursive: true })
  fs.mkdirSync(bios, { recursive: true })
  const marker = path.join(work, 'emu-args.txt')
  const exe = path.join(emuDir, win32 ? 'duckstation.cmd' : 'duckstation.sh')
  fs.writeFileSync(exe, win32 ? `@echo off\r\necho %* > "${marker}"\r\nping -n 3 127.0.0.1 > nul\r\n` : `#!/bin/sh\necho "$@" > "${marker}"\nsleep 2\n`)
  fs.chmodSync(exe, 0o755)
  for (const f of ['Crash Team Racing (USA).chd', 'Spyro the Dragon (USA) (Rev 1).chd', 'readme.txt']) fs.writeFileSync(path.join(games, f), 'x')
  fs.writeFileSync(path.join(games, 'Final Fantasy VII', 'FF7.m3u'), 'FF7 (Disc 1).chd\nFF7 (Disc 2).chd\n')
  for (const d of ['FF7 (Disc 1).chd', 'FF7 (Disc 2).chd']) fs.writeFileSync(path.join(games, 'Final Fantasy VII', d), 'x')

  await nav(win, 'nav-settings')
  await win.click('[data-testid=add-emulator]')
  await win.selectOption('[data-testid=emu-preset]', 'duckstation')
  assert.match(await win.inputValue('[data-testid=emu-args]'), /\{file\}/)
  await win.fill('[data-testid=emu-exe]', exe)
  await win.fill('[data-testid=emu-folder]', games)
  await win.click('[data-testid=emu-save]')
  await win.waitForSelector('[data-testid=emulator-row]:has-text("DuckStation")')
  const em = (await lib(win)).emulators[0]
  assert.equal(em.name, 'DuckStation')
  assert.equal((await lib(win)).systems.find((s) => s.id === em.systemId).name, 'PlayStation 1')
  log('Emulator added from the DuckStation preset (PS1, arguments and file types filled in)')

  await win.click('[data-testid=emulator-scan]')
  await win.waitForSelector('[data-testid=scan-list]')
  const found = await win.locator('[data-testid=scan-title]').evaluateAll((els) => els.map((e) => e.value))
  assert.deepEqual(found.sort(), ['Crash Team Racing', 'FF7', 'Spyro the Dragon'], 'disc files inside the .m3u and non-game files skipped')
  await win.locator('[data-testid=scan-title]').nth(found.indexOf('FF7')).fill('Final Fantasy VII')
  assert.equal(await win.isChecked('[data-testid=scan-lookup]'), true, 'online lookup on when IGDB is set up')
  await shot(win, 'f07-scan')
  await win.click('[data-testid=scan-add]')
  await win.waitForSelector('[data-testid=scan-done]', { timeout: 30000 })
  assert.match(await win.textContent('[data-testid=scan-progress]'), /Added 3 games/)
  await win.click('[data-testid=scan-done]')
  const ctr = await byTitle(win, 'Crash Team Racing')
  assert.equal(ctr.igdbId, 2001, 'matched on IGDB for the PS1 platform')
  assert.equal(ctr.description, 'Retro classic.')
  assert.ok(ctr.coverFile)
  assert.equal(ctr.copies[0].launchType, 'emulator')
  assert.equal(ctr.copies[0].emulatorId, em.id)
  assert.equal(ctr.copies[0].format, 'physical')
  const ff7 = await byTitle(win, 'Final Fantasy VII')
  assert.ok(ff7.copies[0].launchTarget.endsWith('FF7.m3u'))
  log('Folder scan finds 3 PS1 games (multi-disc .m3u as one), titles editable, IGDB details and art added')

  // Re-scan finds nothing new
  await win.click('[data-testid=emulator-scan]')
  await win.waitForSelector('.toast:has-text("No new games")')

  // Launch through the emulator; play time is tracked
  await openGame(win, 'Crash Team Racing')
  await win.waitForSelector('[data-testid=pill-installed]')
  await shot(win, 'f08-emulator-game')
  await win.click('[data-testid=play]')
  await until(async () => (await byTitle(win, 'Crash Team Racing')).sessionCount === 1, 'emulator session recorded', 15000)
  const args = fs.readFileSync(marker, 'utf8').replace(/"/g, '').trim()
  assert.ok(args.startsWith('-batch -fullscreen ') && args.endsWith('Crash Team Racing (USA).chd'), `emulator args: ${args}`)
  log('Play opens the game in the emulator with the preset arguments, and play time is recorded')

  // Missing game file is explained
  fs.unlinkSync(path.join(games, 'Spyro the Dragon (USA) (Rev 1).chd'))
  await openGame(win, 'Spyro the Dragon')
  await win.waitForSelector('[data-testid=pill-missing]')
  assert.match(await win.textContent('[data-testid=launch-problem]'), /Game file not found/)
  assert.equal(await win.locator('[data-testid=play]').count(), 0)
  await win.click('[data-testid=detail-back]')
  log('A moved or deleted game file is reported on the game page and Play is hidden')
}
