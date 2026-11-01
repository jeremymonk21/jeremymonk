import { net } from 'electron'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join, resolve, sep } from 'path'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

let imagesDir = ''

export function initImages(dataDir: string): string {
  imagesDir = join(dataDir, 'images')
  mkdirSync(imagesDir, { recursive: true })
  return imagesDir
}

export function getImagesDir(): string {
  return imagesDir
}

/** Resolves a stored image file name to an absolute path inside the images folder (or null if unsafe). */
export function resolveImage(file: string): string | null {
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) return null
  const full = resolve(imagesDir, file)
  if (!full.startsWith(resolve(imagesDir) + sep)) return null
  return full
}

/** Copies an image from anywhere on disk into the app's data folder, returning the new file name. */
export function importImageFile(sourcePath: string): string {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error(`Unsupported image type ".${ext}".`)
  const st = statSync(sourcePath)
  if (st.size > MAX_IMAGE_BYTES) throw new Error('That image is larger than 40 MB.')
  const name = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`
  copyFileSync(sourcePath, join(imagesDir, name))
  return name
}

export function writeImageBuffer(buf: Buffer, ext: string): string {
  const name = `${randomUUID()}.${ext}`
  writeFileSync(join(imagesDir, name), buf)
  return name
}

function extFromContentType(ct: string | null, url: string): string | null {
  const c = (ct || '').toLowerCase()
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg'
  if (c.includes('png')) return 'png'
  if (c.includes('webp')) return 'webp'
  if (c.includes('gif')) return 'gif'
  if (c.includes('avif')) return 'avif'
  const e = extname(new URL(url).pathname).slice(1).toLowerCase()
  return IMAGE_EXTENSIONS.includes(e) && e !== 'svg' ? (e === 'jpeg' ? 'jpg' : e) : null
}

/** Downloads an image and caches it in the data folder. Returns null when not found. */
export async function downloadImage(url: string, timeoutMs = 20000): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, { signal: ctl.signal })
    if (!res.ok) return null
    const ext = extFromContentType(res.headers.get('content-type'), url)
    if (!ext) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 512 || buf.length > MAX_IMAGE_BYTES) return null
    return writeImageBuffer(buf, ext)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Removes image files no longer referenced by any game. */
export function cleanupImages(referenced: Set<string>): number {
  let removed = 0
  if (!existsSync(imagesDir)) return 0
  for (const f of readdirSync(imagesDir)) {
    if (referenced.has(f)) continue
    try {
      // Leave very recent files alone; they may belong to an editor that has not been saved yet.
      if (Date.now() - statSync(join(imagesDir, f)).mtimeMs < 24 * 3600 * 1000) continue
      unlinkSync(join(imagesDir, f))
      removed++
    } catch {
      /* ignore */
    }
  }
  return removed
}
