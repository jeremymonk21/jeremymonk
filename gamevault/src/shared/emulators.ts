/**
 * Starting points for common Windows emulators. Every field stays editable in the app,
 * because command-line options can change between emulator versions.
 * {file} is replaced with the game file's full path.
 */
export interface EmulatorPreset {
  key: string
  label: string
  name: string
  system: string
  args: string
  extensions: string
  exeHint: string
  needsBios: boolean
}

export const EMULATOR_PRESETS: EmulatorPreset[] = [
  { key: 'duckstation', label: 'DuckStation — PlayStation 1', name: 'DuckStation', system: 'PlayStation 1', args: '-batch -fullscreen "{file}"', extensions: 'chd,cue,m3u,pbp,iso,ecm', exeHint: 'duckstation-qt-x64-ReleaseLTCG.exe', needsBios: true },
  { key: 'pcsx2', label: 'PCSX2 — PlayStation 2', name: 'PCSX2', system: 'PlayStation 2', args: '-batch -fullscreen -nogui "{file}"', extensions: 'iso,chd,cso,gz', exeHint: 'pcsx2-qt.exe', needsBios: true },
  { key: 'rpcs3', label: 'RPCS3 — PlayStation 3', name: 'RPCS3', system: 'PlayStation 3', args: '--no-gui "{file}"', extensions: 'iso,bin', exeHint: 'rpcs3.exe (game file: the game’s EBOOT.BIN or .iso)', needsBios: false },
  { key: 'ppsspp', label: 'PPSSPP — PSP', name: 'PPSSPP', system: 'PSP', args: '--fullscreen "{file}"', extensions: 'iso,cso,chd,pbp', exeHint: 'PPSSPPWindows64.exe', needsBios: false },
  { key: 'dolphin-gc', label: 'Dolphin — GameCube', name: 'Dolphin', system: 'GameCube', args: '-b -e "{file}"', extensions: 'rvz,iso,gcm,ciso,gcz', exeHint: 'Dolphin.exe', needsBios: false },
  { key: 'dolphin-wii', label: 'Dolphin — Wii', name: 'Dolphin (Wii)', system: 'Wii', args: '-b -e "{file}"', extensions: 'rvz,iso,wbfs,wad', exeHint: 'Dolphin.exe', needsBios: false },
  { key: 'cemu', label: 'Cemu — Wii U', name: 'Cemu', system: 'Wii U', args: '-f -g "{file}"', extensions: 'wua,wux,wud,rpx', exeHint: 'Cemu.exe', needsBios: false },
  { key: 'ra-snes', label: 'RetroArch — SNES (Snes9x core)', name: 'RetroArch SNES', system: 'SNES', args: '-f -L "cores\\snes9x_libretro.dll" "{file}"', extensions: 'sfc,smc,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-nes', label: 'RetroArch — NES (Mesen core)', name: 'RetroArch NES', system: 'NES', args: '-f -L "cores\\mesen_libretro.dll" "{file}"', extensions: 'nes,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-n64', label: 'RetroArch — Nintendo 64 (Mupen64Plus-Next core)', name: 'RetroArch N64', system: 'Nintendo 64', args: '-f -L "cores\\mupen64plus_next_libretro.dll" "{file}"', extensions: 'z64,n64,v64,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-gb', label: 'RetroArch — Game Boy / Color (Gambatte core)', name: 'RetroArch Game Boy', system: 'Game Boy / Color', args: '-f -L "cores\\gambatte_libretro.dll" "{file}"', extensions: 'gb,gbc,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-gba', label: 'RetroArch — Game Boy Advance (mGBA core)', name: 'RetroArch GBA', system: 'Game Boy Advance', args: '-f -L "cores\\mgba_libretro.dll" "{file}"', extensions: 'gba,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-nds', label: 'RetroArch — Nintendo DS (melonDS DS core)', name: 'RetroArch DS', system: 'Nintendo DS', args: '-f -L "cores\\melondsds_libretro.dll" "{file}"', extensions: 'nds,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-md', label: 'RetroArch — Genesis / Mega Drive (Genesis Plus GX core)', name: 'RetroArch Genesis', system: 'Sega Genesis / Mega Drive', args: '-f -L "cores\\genesis_plus_gx_libretro.dll" "{file}"', extensions: 'md,gen,bin,smd,zip,7z', exeHint: 'retroarch.exe', needsBios: false },
  { key: 'ra-dc', label: 'RetroArch — Dreamcast (Flycast core)', name: 'RetroArch Dreamcast', system: 'Dreamcast', args: '-f -L "cores\\flycast_libretro.dll" "{file}"', extensions: 'chd,cdi,gdi,m3u', exeHint: 'retroarch.exe', needsBios: true },
  { key: 'custom', label: 'Other emulator…', name: '', system: '', args: '"{file}"', extensions: '', exeHint: 'the emulator’s .exe', needsBios: false }
]

/** Turns a ROM / disc-image file name into a readable title: "Final Fantasy VII (USA) (Disc 1).chd" → "Final Fantasy VII". */
export function titleFromFileName(fileName: string): string {
  let t = fileName.replace(/\.[^.]+$/, '')
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, ' ') // (USA), [!], (Disc 1), (Rev 1)
  t = t.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  // "Legend of Zelda, The" → "The Legend of Zelda"
  const m = /^(.*), (The|A|An)$/i.exec(t)
  if (m) t = `${m[2]} ${m[1]}`
  return t
}
