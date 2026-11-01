import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Stores the Steam Web API key outside the database (so it is never included in
 * backups or CSV exports), encrypted with Windows DPAPI via Electron safeStorage.
 */
let file = ''

export function initSecrets(dataDir: string): void {
  file = join(dataDir, 'secrets.json')
}

function readAll(): Record<string, { enc: boolean; v: string }> {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export function getSecret(key: string): string | null {
  const item = readAll()[key]
  if (!item) return null
  try {
    if (item.enc) return safeStorage.decryptString(Buffer.from(item.v, 'base64'))
    return Buffer.from(item.v, 'base64').toString('utf8')
  } catch {
    // Encrypted on another machine/user account — treat as missing.
    return null
  }
}

export function setSecret(key: string, value: string | null): void {
  const all = readAll()
  if (value == null || value === '') delete all[key]
  else {
    const enc = safeStorage.isEncryptionAvailable()
    all[key] = { enc, v: (enc ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8')).toString('base64') }
  }
  writeFileSync(file + '.tmp', JSON.stringify(all))
  renameSync(file + '.tmp', file)
}
