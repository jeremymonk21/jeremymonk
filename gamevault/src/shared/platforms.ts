/** Maps platform names used by IGDB / file folders onto GameVault system names. */
const ALIASES: Record<string, string[]> = {
  PC: ['pc (microsoft windows)', 'pc', 'windows', 'linux', 'mac', 'steam'],
  'PlayStation 1': ['playstation', 'playstation 1', 'ps1', 'psx', 'psone'],
  'PlayStation 2': ['playstation 2', 'ps2'],
  'PlayStation 3': ['playstation 3', 'ps3'],
  'PlayStation 4': ['playstation 4', 'ps4'],
  'PlayStation 5': ['playstation 5', 'ps5'],
  PSP: ['playstation portable', 'psp'],
  'PlayStation Vita': ['playstation vita', 'ps vita', 'vita'],
  'Xbox 360': ['xbox 360'],
  'Xbox One': ['xbox one'],
  'Xbox Series X|S': ['xbox series x|s', 'xbox series x', 'xbox series s'],
  'Nintendo Switch': ['nintendo switch', 'switch'],
  'Nintendo Switch 2': ['nintendo switch 2', 'switch 2'],
  'Wii U': ['wii u'],
  Wii: ['wii'],
  GameCube: ['nintendo gamecube', 'gamecube', 'gc', 'ngc'],
  'Nintendo 64': ['nintendo 64', 'n64'],
  SNES: ['super nintendo entertainment system', 'super famicom', 'snes', 'sfc'],
  NES: ['nintendo entertainment system', 'family computer', 'famicom', 'nes'],
  'Game Boy / Color': ['game boy', 'game boy color', 'gb', 'gbc'],
  'Game Boy Advance': ['game boy advance', 'gba'],
  'Nintendo DS': ['nintendo ds', 'nds', 'ds'],
  'Nintendo 3DS': ['nintendo 3ds', 'new nintendo 3ds', '3ds'],
  'Sega Genesis / Mega Drive': ['sega mega drive/genesis', 'genesis', 'mega drive', 'megadrive', 'md'],
  Dreamcast: ['dreamcast', 'dc']
}

/** Returns the system id whose name matches one of `platforms` (IGDB names or folder names), else null. */
export function matchSystem(platforms: string[], systems: Array<{ id: number; name: string }>): number | null {
  const norm = (s: string): string => s.toLowerCase().trim()
  for (const p of platforms.map(norm)) {
    const direct = systems.find((s) => norm(s.name) === p)
    if (direct) return direct.id
    for (const [name, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(p)) {
        const s = systems.find((x) => norm(x.name) === norm(name))
        if (s) return s.id
      }
    }
  }
  return null
}
