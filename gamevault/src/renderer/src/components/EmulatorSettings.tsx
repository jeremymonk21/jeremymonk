import { useEffect, useState } from 'react'
import type { Emulator, GameFormat, ImportProgress, ScanCandidate } from '@shared/types'
import { EMULATOR_PRESETS } from '@shared/emulators'
import { Modal, useApp } from '../state'
import { IconAlert, IconCheck, IconEdit, IconFolder, IconPlus, IconRefresh, IconTrash } from './Icons'

type Status = { id: number; exeFound: boolean; folderFound: boolean; biosOk: boolean | null; games: number }

export function EmulatorSettings(): JSX.Element {
  const { lib, systemsById, reload, toast, confirm } = useApp()
  const [status, setStatus] = useState<Map<number, Status>>(new Map())
  const [editing, setEditing] = useState<(Omit<Emulator, 'id'> & { id?: number }) | null>(null)
  const [scan, setScan] = useState<{ emulator: Emulator; items: ScanCandidate[] } | null>(null)
  const [scanning, setScanning] = useState<number | null>(null)
  const emulators = lib?.emulators ?? []

  const refreshStatus = async (): Promise<void> => {
    try {
      setStatus(new Map((await window.api.emulatorStatus()).map((s) => [s.id, s])))
    } catch {
      /* non-critical */
    }
  }
  useEffect(() => {
    refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib])

  const runScan = async (e: Emulator): Promise<void> => {
    setScanning(e.id)
    try {
      const items = await window.api.scanEmulator(e.id)
      if (!items.length) toast(`No new games found in ${e.gamesFolder}.`, 'info')
      else setScan({ emulator: e, items })
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setScanning(null)
    }
  }

  const remove = async (e: Emulator): Promise<void> => {
    const s = status.get(e.id)
    const ok = await confirm({
      title: `Remove ${e.name}?`,
      body: <p>{s?.games ? `${s.games} game${s.games === 1 ? '' : 's'} launch with it; they stay in your collection but won't be launchable until you pick another emulator.` : 'No games use it.'} Your game files are not touched.</p>,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    await window.api.deleteEmulator(e.id)
    await reload()
  }

  return (
    <div className="section" id="settings-emulators" data-testid="emulator-settings">
      <h3>
        Emulators &amp; game folders
        <span className="row" style={{ gap: 6 }}>
          {emulators.length > 1 && (
            <button className="btn sm" onClick={async () => { for (const e of emulators) await runScan(e) }} disabled={scanning != null}>
              <IconRefresh size={14} /> Scan all
            </button>
          )}
          <button className="btn sm primary" onClick={() => setEditing({ name: '', systemId: lib?.systems.find((s) => s.name === 'PlayStation 1')?.id ?? lib?.systems[0]?.id ?? 0, exePath: '', args: '"{file}"', gamesFolder: '', extensions: '', biosFolder: '' })} data-testid="add-emulator">
            <IconPlus size={14} /> Add emulator
          </button>
        </span>
      </h3>
      <p className="muted small" style={{ marginTop: -4 }}>
        One row per system. GameVault finds the games in each folder, can look up their details and art, and Play opens them in the emulator — with play time tracked.
        Use game files and BIOS files dumped from discs and consoles you own.
      </p>
      {emulators.length === 0 && <div className="banner small" style={{ margin: 0 }}>No emulators yet. Click <b>Add emulator</b> and pick one from the list — DuckStation for PS1, PCSX2 for PS2, Dolphin for GameCube, RetroArch for older systems…</div>}
      {emulators.length > 0 && (
        <div className="emu-table" role="table" aria-label="Emulator setups">
          <div className="emu-row head" role="row">
            <span role="columnheader">System</span><span role="columnheader">Emulator</span><span role="columnheader">Game folder</span><span role="columnheader">Status</span><span role="columnheader" />
          </div>
          {emulators.map((e) => {
            const s = status.get(e.id)
            const problem = !s ? null : !s.exeFound ? 'Program not found' : !s.folderFound ? 'Folder not found' : s.biosOk === false ? 'BIOS missing' : null
            return (
              <div className="emu-row" role="row" key={e.id} data-testid="emulator-row">
                <span role="cell" style={{ fontWeight: 600 }}>{systemsById.get(e.systemId)?.name ?? '?'}</span>
                <span role="cell">{e.name}</span>
                <span role="cell" className="mono ellipsis" title={e.gamesFolder}>{e.gamesFolder || '—'}</span>
                <span role="cell">
                  {problem ? <span className="status-pill warn"><IconAlert size={12} /> {problem}</span> : <span className="status-pill ready">{s?.games ?? 0} game{s?.games === 1 ? '' : 's'}</span>}
                </span>
                <span role="cell" className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => runScan(e)} disabled={scanning != null} data-testid="emulator-scan">{scanning === e.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconRefresh size={14} />} Scan</button>
                  <button className="btn sm ghost icon" aria-label={`Edit ${e.name}`} onClick={() => setEditing({ ...e })}><IconEdit size={14} /></button>
                  <button className="btn sm ghost icon" aria-label={`Remove ${e.name}`} onClick={() => remove(e)}><IconTrash size={14} /></button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {editing && <EmulatorDialog value={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); refreshStatus() }} />}
      {scan && <ScanDialog emulator={scan.emulator} items={scan.items} onClose={() => { setScan(null); reload() }} />}
    </div>
  )
}

function EmulatorDialog({ value, onClose, onSaved }: { value: Omit<Emulator, 'id'> & { id?: number }; onClose: () => void; onSaved: () => void }): JSX.Element {
  const { lib, toast } = useApp()
  const [e, setE] = useState(value)
  const [preset, setPreset] = useState(value.id ? '' : 'duckstation')
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Emulator>): void => setE((x) => ({ ...x, ...p }))
  const hint = EMULATOR_PRESETS.find((p) => p.key === preset)
  useEffect(() => {
    if (!preset || value.id) return
    const p = EMULATOR_PRESETS.find((x) => x.key === preset)
    if (!p) return
    const sys = lib?.systems.find((s) => s.name === p.system)
    setE((x) => ({ ...x, name: p.name, args: p.args, extensions: p.extensions, systemId: sys?.id ?? x.systemId }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])
  const save = async (): Promise<void> => {
    if (!e.args.includes('{file}')) {
      toast('The arguments need {file} where the game file goes.', 'error')
      return
    }
    setSaving(true)
    try {
      await window.api.saveEmulator(e)
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title={value.id ? `Edit ${value.name}` : 'Add an emulator'} onClose={onClose} size="mid">
      <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
        {!value.id && (
          <label className="field">
            Emulator
            <select className="select" value={preset} onChange={(ev) => setPreset(ev.target.value)} data-testid="emu-preset">
              {EMULATOR_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span className="hint">Fills in typical settings — you can change anything below.</span>
          </label>
        )}
        <div className="grid-2">
          <label className="field">Name<input className="input" value={e.name} onChange={(ev) => set({ name: ev.target.value })} data-testid="emu-name" /></label>
          <label className="field">
            System
            <select className="select" value={e.systemId} onChange={(ev) => set({ systemId: Number(ev.target.value) })} data-testid="emu-system">
              {(lib?.systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          Emulator program {hint?.exeHint && <span className="hint">usually {hint.exeHint}</span>}
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={e.exePath} onChange={(ev) => set({ exePath: ev.target.value })} placeholder="C:\Emulators\DuckStation\duckstation-qt-x64-ReleaseLTCG.exe" data-testid="emu-exe" />
            <button className="btn" onClick={async () => { const f = await window.api.pickLaunchFile(); if (f) set({ exePath: f }) }}><IconFolder size={16} /> Browse…</button>
          </div>
        </label>
        <label className="field">
          Game folder <span className="hint">Where this system's game files live, e.g. D:\Games\PS1</span>
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={e.gamesFolder} onChange={(ev) => set({ gamesFolder: ev.target.value })} data-testid="emu-folder" />
            <button className="btn" onClick={async () => { const d = await window.api.pickFolder('Choose the game folder'); if (d) set({ gamesFolder: d }) }}><IconFolder size={16} /> Browse…</button>
          </div>
        </label>
        <div className="grid-2">
          <label className="field">
            Arguments <span className="hint">{'{file}'} = the game file</span>
            <input className="input mono" value={e.args} onChange={(ev) => set({ args: ev.target.value })} data-testid="emu-args" />
          </label>
          <label className="field">
            File types <span className="hint">comma-separated</span>
            <input className="input" value={e.extensions} onChange={(ev) => set({ extensions: ev.target.value })} placeholder="chd, cue, iso" data-testid="emu-ext" />
          </label>
        </div>
        <label className="field">
          BIOS folder <span className="hint">Optional. {hint?.needsBios ? 'This system needs a BIOS dumped from your own console — ' : ''}GameVault warns you if it's empty.</span>
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={e.biosFolder} onChange={(ev) => set({ biosFolder: ev.target.value })} />
            <button className="btn" onClick={async () => { const d = await window.api.pickFolder('Choose the BIOS folder'); if (d) set({ biosFolder: d }) }}><IconFolder size={16} /> Browse…</button>
          </div>
        </label>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || !e.name.trim()} data-testid="emu-save">{saving && <span className="spinner" />} Save</button>
      </div>
    </Modal>
  )
}

function ScanDialog({ emulator, items, onClose }: { emulator: Emulator; items: ScanCandidate[]; onClose: () => void }): JSX.Element {
  const { systemsById, toast } = useApp()
  const [rows, setRows] = useState(items.map((i) => ({ ...i, title: i.guessedTitle, on: true })))
  const [format, setFormat] = useState<GameFormat>('physical')
  const [lookup, setLookup] = useState(true)
  const [canLookup, setCanLookup] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  useEffect(() => {
    window.api.sourcesGetConfig().then((c) => { setCanLookup(c.igdb); setLookup(c.igdb) }).catch(() => undefined)
    return window.api.onScanProgress(setProgress)
  }, [])
  const chosen = rows.filter((r) => r.on && r.title.trim())
  const running = progress?.phase === 'importing'
  const start = async (): Promise<void> => {
    try {
      const p = await window.api.importScanned(chosen.map((r) => ({ file: r.file, title: r.title.trim(), emulatorId: r.emulatorId, systemId: r.systemId, format })), { lookup: lookup && canLookup })
      setProgress(p)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <Modal title={`${items.length} new ${systemsById.get(emulator.systemId)?.name ?? ''} game${items.length === 1 ? '' : 's'} found`} onClose={() => !running && onClose()} size="mid" closeOnBackdrop={false}>
      <div className="modal-body">
        {!progress ? (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>Titles are guessed from the file names — fix any before adding. Untick files you don't want.</p>
            <div className="import-list" data-testid="scan-list">
              {rows.map((r, i) => (
                <div key={r.file} className="import-row" style={{ cursor: 'default' }}>
                  <input type="checkbox" checked={r.on} onChange={() => setRows(rows.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} aria-label={`Add ${r.fileName}`} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <input className="input" style={{ height: 30, width: '100%' }} value={r.title} onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} aria-label="Title" data-testid="scan-title" />
                    <span className="mono small muted ellipsis" style={{ display: 'block', background: 'none', padding: '2px 0 0' }} title={r.file}>{r.fileName}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="row wrap" style={{ marginTop: 14, gap: 20 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="small muted">Mark as</span>
                <span className="segmented">
                  <button className={format === 'physical' ? 'on' : ''} onClick={() => setFormat('physical')}>Physical (I own the disc/cart)</button>
                  <button className={format === 'digital' ? 'on' : ''} onClick={() => setFormat('digital')}>Digital</button>
                </span>
              </span>
              <label className="check" title={canLookup ? '' : 'Add IGDB keys in Settings → Online sources'}>
                <input type="checkbox" checked={lookup && canLookup} disabled={!canLookup} onChange={(ev) => setLookup(ev.target.checked)} data-testid="scan-lookup" />
                Look up details &amp; art online{canLookup ? '' : ' (needs IGDB keys)'}
              </label>
            </div>
          </>
        ) : (
          <div data-testid="scan-progress">
            <div className="row" style={{ marginBottom: 10 }}>
              {running ? <span className="spinner" /> : <IconCheck color="var(--ok)" />}
              <b>{running ? `Adding ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `Added ${progress.added} game${progress.added === 1 ? '' : 's'}`}</b>
              <span className="spacer" />
              <span className="muted small">{pct}%</span>
            </div>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <p className="muted small">{running ? progress.current : 'Each game launches in ' + emulator.name + '. Open any game to change its details or artwork.'}</p>
            {progress.errors.length > 0 && <div className="error-list">{progress.errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
          </div>
        )}
      </div>
      <div className="modal-foot">
        {!progress && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!chosen.length} onClick={start} data-testid="scan-add">Add {chosen.length} game{chosen.length === 1 ? '' : 's'}</button>
          </>
        )}
        {progress && !running && <button className="btn primary" onClick={onClose} data-testid="scan-done">Done</button>}
      </div>
    </Modal>
  )
}
