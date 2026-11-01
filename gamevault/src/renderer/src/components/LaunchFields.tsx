import type { CopyInput, Game, GameInput, LaunchType } from '@shared/types'
import { IconFolder } from './Icons'

export function gameToInput(g: Game, genreNames: string[]): GameInput {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    developer: g.developer,
    publisher: g.publisher,
    releaseDate: g.releaseDate,
    coverFile: g.coverFile,
    coverFit: g.coverFit,
    coverPosX: g.coverPosX,
    coverPosY: g.coverPosY,
    coverZoom: g.coverZoom,
    rating: g.rating,
    playStatus: g.playStatus,
    favorite: g.favorite,
    steamAppId: g.steamAppId,
    genreNames,
    categoryIds: g.categoryIds,
    copies: g.copies.map((c) => ({ ...c })),
    imageFiles: g.images.map((i) => i.file),
    lockedFields: g.lockedFields
  }
}

export const LAUNCH_LABELS: Record<LaunchType, string> = {
  none: 'Not launchable (collection entry only)',
  steam: 'Steam (steam:// launch)',
  executable: 'Program (.exe)',
  shortcut: 'Windows shortcut (.lnk / .url)'
}

/** Editor for a copy's launch configuration. */
export function LaunchFields({ copy, onChange, isPc }: { copy: CopyInput; onChange: (c: CopyInput) => void; isPc: boolean }): JSX.Element {
  const set = (p: Partial<CopyInput>): void => onChange({ ...copy, ...p })
  const pickFile = async (): Promise<void> => {
    const f = await window.api.pickLaunchFile()
    if (f) {
      const isShortcut = /\.(lnk|url)$/i.test(f)
      set({ launchTarget: f, launchType: isShortcut ? 'shortcut' : 'executable' })
    }
  }
  const pickDir = async (): Promise<void> => {
    const d = await window.api.pickFolder('Choose the working directory')
    if (d) set({ launchWorkDir: d })
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="field">
        Launch method
        <select className="select" value={copy.launchType} onChange={(e) => set({ launchType: e.target.value as LaunchType })} data-testid="launch-type">
          {(Object.keys(LAUNCH_LABELS) as LaunchType[]).map((k) => (
            <option key={k} value={k}>
              {LAUNCH_LABELS[k]}
            </option>
          ))}
        </select>
        {!isPc && copy.launchType === 'none' && <span className="hint">Console entries stay normal collection entries. Only set a launch method if you have a compatible way to play it on this PC (for example an emulator shortcut).</span>}
      </label>
      {copy.launchType === 'steam' && (
        <label className="field">
          Steam App ID
          <input
            className="input"
            inputMode="numeric"
            value={copy.steamAppId ?? ''}
            onChange={(e) => set({ steamAppId: e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')) : null })}
            placeholder="e.g. 620"
          />
          <span className="hint">GameVault asks the Steam client to start the game (steam://rungameid/ID). Steam must be installed and the game installed in Steam.</span>
        </label>
      )}
      {(copy.launchType === 'executable' || copy.launchType === 'shortcut') && (
        <>
          <label className="field">
            {copy.launchType === 'shortcut' ? 'Shortcut file' : 'Program file'}
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={copy.launchTarget} onChange={(e) => set({ launchTarget: e.target.value })} placeholder="C:\\Games\\MyGame\\Game.exe" data-testid="launch-target" />
              <button type="button" className="btn" onClick={pickFile}><IconFolder size={16} /> Browse…</button>
            </div>
          </label>
          <div className="grid-2">
            <label className="field">
              Launch arguments <span className="hint">Optional, e.g. -windowed</span>
              <input className="input" value={copy.launchArgs} onChange={(e) => set({ launchArgs: e.target.value })} placeholder="(none)" />
            </label>
            <label className="field">
              Working directory <span className="hint">Optional — defaults to the file's folder</span>
              <div className="row">
                <input className="input" style={{ flex: 1, minWidth: 0 }} value={copy.launchWorkDir} onChange={(e) => set({ launchWorkDir: e.target.value })} placeholder="(file's folder)" />
                <button type="button" className="btn icon" onClick={pickDir} aria-label="Browse for working directory"><IconFolder size={16} /></button>
              </div>
            </label>
          </div>
        </>
      )}
    </div>
  )
}
