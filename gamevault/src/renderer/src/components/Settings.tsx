import { useEffect, useState } from 'react'
import type { AppPrefs, SteamConfig, SystemKind, Tag } from '@shared/types'
import { EmulatorSettings } from './EmulatorSettings'
import { useApp } from '../state'
import { IconDownload, IconEdit, IconFolder, IconPlus, IconRefresh, IconSteam, IconTrash, IconUpload } from './Icons'

const KIND_LABELS: Record<SystemKind, string> = { pc: 'PC', console: 'Console', handheld: 'Handheld', other: 'Other' }

function EditableRow({ name, meta, onRename, onDelete, extra, testId }: { name: string; meta?: string; onRename: (n: string) => Promise<void>; onDelete?: () => void; extra?: React.ReactNode; testId?: string }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const { toast } = useApp()
  const commit = async (): Promise<void> => {
    if (draft.trim() === name) return setEditing(false)
    try {
      await onRename(draft)
      setEditing(false)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="list-row" data-testid={testId}>
      {editing ? (
        <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); commit() }}>
          <input className="input" style={{ flex: 1, height: 32 }} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} data-testid="rename-input" />
          {extra}
          <button className="btn sm primary" type="submit">Save</button>
          <button className="btn sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <span className="name">{name}</span>
          {meta && <span className="meta">{meta}</span>}
          <button className="btn sm ghost" onClick={() => { setDraft(name); setEditing(true) }} data-testid="rename"><IconEdit size={14} /> Rename</button>
          {onDelete && <button className="btn sm ghost" onClick={onDelete} aria-label={`Remove ${name}`} data-testid="remove"><IconTrash size={14} /></button>}
        </>
      )}
    </div>
  )
}

function TagManager({ table, tags, title, help }: { table: 'genres' | 'categories'; tags: Tag[]; title: string; help: string }): JSX.Element {
  const { reload, toast, confirm, lib } = useApp()
  const [name, setName] = useState('')
  const usage = (id: number): number => (lib?.games ?? []).filter((g) => (table === 'genres' ? g.genreIds : g.categoryIds).includes(id)).length
  const create = async (): Promise<void> => {
    try {
      await window.api.createTag(table, name)
      setName('')
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="section" id={`settings-${table}`}>
      <h3>{title}</h3>
      <p className="muted small" style={{ marginTop: -4 }}>{help}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); create() }} style={{ marginBottom: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder={table === 'categories' ? 'New category, e.g. "Couch co-op" or "Backlog"' : 'New genre'} value={name} onChange={(e) => setName(e.target.value)} data-testid={`new-${table}`} />
        <button className="btn" type="submit" disabled={!name.trim()} data-testid={`create-${table}`}><IconPlus size={16} /> Create</button>
      </form>
      {tags.length === 0 && <p className="muted small">None yet.</p>}
      {tags.map((t) => {
        const n = usage(t.id)
        return (
          <EditableRow
            key={t.id}
            name={t.name}
            meta={`${n} game${n === 1 ? '' : 's'}`}
            testId={`${table}-row`}
            onRename={async (nn) => { await window.api.renameTag(table, t.id, nn); await reload() }}
            onDelete={async () => {
              const ok = await confirm({
                title: `Remove "${t.name}"?`,
                body: <p>{n ? `It will be removed from ${n} game${n === 1 ? '' : 's'}. The games themselves are not deleted.` : 'No games use it.'}</p>,
                confirmLabel: 'Remove',
                danger: true
              })
              if (!ok) return
              try {
                await window.api.deleteTag(table, t.id)
                await reload()
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
          />
        )
      })}
    </div>
  )
}

function Systems(): JSX.Element {
  const { lib, reload, toast, confirm } = useApp()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SystemKind>('console')
  const counts = new Map<number, number>()
  for (const g of lib?.games ?? []) for (const s of new Set(g.copies.map((c) => c.systemId))) counts.set(s, (counts.get(s) ?? 0) + 1)
  const create = async (): Promise<void> => {
    try {
      await window.api.createSystem(name, kind)
      setName('')
      await reload()
      toast('System added.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="section" id="settings-systems">
      <h3>Game systems</h3>
      <p className="muted small" style={{ marginTop: -4 }}>Systems appear in the sidebar once a game uses them. Add any custom system (e.g. "Sega Saturn", "Steam Deck", "MAME").</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); create() }} style={{ marginBottom: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="New system name" value={name} onChange={(e) => setName(e.target.value)} data-testid="new-system" />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as SystemKind)} aria-label="System type">
          {(Object.keys(KIND_LABELS) as SystemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <button className="btn" type="submit" disabled={!name.trim()} data-testid="create-system"><IconPlus size={16} /> Add system</button>
      </form>
      {(lib?.systems ?? []).map((s) => {
        const n = counts.get(s.id) ?? 0
        return (
          <EditableRow
            key={s.id}
            name={s.name}
            meta={`${KIND_LABELS[s.kind]} · ${n} game${n === 1 ? '' : 's'}`}
            onRename={async (nn) => { await window.api.updateSystem(s.id, nn, s.kind); await reload() }}
            onDelete={async () => {
              if (n > 0) {
                toast(`"${s.name}" is used by ${n} game${n === 1 ? '' : 's'}. Change or remove those copies first.`, 'error')
                return
              }
              if (!(await confirm({ title: `Remove "${s.name}"?`, body: <p>No games use this system.</p>, confirmLabel: 'Remove', danger: true }))) return
              try {
                await window.api.deleteSystem(s.id)
                await reload()
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
          />
        )
      })}
    </div>
  )
}

function SteamSettings({ onImport }: { onImport: (mode: 'library' | 'installed') => void }): JSX.Element {
  const { toast, lib, reload } = useApp()
  const [cfg, setCfg] = useState<SteamConfig | null>(null)
  const [key, setKey] = useState('')
  const [steamId, setSteamId] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async (): Promise<void> => {
    const c = await window.api.steamGetConfig()
    setCfg(c)
    setSteamId(c.steamId)
    setPath(c.steamPath ?? '')
  }
  useEffect(() => {
    load().catch((e) => toast((e as Error).message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.steamSetConfig({ ...(key ? { apiKey: key } : {}), steamId, steamPath: path || null })
      setKey('')
      await load()
      toast('Steam settings saved.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const steamGames = (lib?.games ?? []).filter((g) => g.steamAppId)
  return (
    <div className="section" id="settings-steam">
      <h3><span className="row" style={{ gap: 8 }}><IconSteam size={16} /> Steam (optional)</span></h3>
      <p className="small" style={{ marginTop: -4, color: 'var(--text-2)' }}>
        GameVault works fully without Steam. To import your Steam library it uses Valve's official Steam Web API with your own key. Your Steam password is never asked for or stored.
      </p>
      <ol className="steps small">
        <li>Get a free Web API key at <a href="#" onClick={(e) => { e.preventDefault(); window.api.openExternal('https://steamcommunity.com/dev/apikey') }}>steamcommunity.com/dev/apikey</a> (any domain name, e.g. "localhost"). Requires a Steam account that has made a purchase and has Steam Guard enabled.</li>
        <li>Enter your SteamID64 (17 digits) or your profile URL (<code>steamcommunity.com/id/yourname</code>).</li>
        <li>In Steam: <b>Profile → Edit Profile → Privacy Settings</b>, set <b>Game details</b> to <b>Public</b>. If it's private, Steam returns an empty library.</li>
      </ol>
      <p className="muted small">The key is stored only on this PC, encrypted with your Windows account, and is not included in backups. Store details (description, genres, developer, publisher, release date) come from the Steam Store; artwork is downloaded once and cached locally.</p>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <label className="field">
          Steam Web API key {cfg?.hasApiKey && <span className="ok">· saved</span>}
          <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg?.hasApiKey ? '•••••••• (enter a new key to replace)' : '32-character key'} data-testid="steam-key" />
        </label>
        <label className="field">
          SteamID64 or profile URL
          <input className="input" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="7656119… or https://steamcommunity.com/id/…" data-testid="steam-id" />
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        Steam folder <span className="hint">Used to detect which games are installed. {cfg?.autoDetectedSteamPath ? `Detected: ${cfg.autoDetectedSteamPath}` : 'Steam was not detected automatically.'}</span>
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder={cfg?.autoDetectedSteamPath ?? 'C:\\Program Files (x86)\\Steam'} />
          <button className="btn" onClick={async () => { const d = await window.api.pickFolder('Choose your Steam folder'); if (d) setPath(d) }}><IconFolder size={16} /> Browse…</button>
        </div>
      </label>
      <div className="row wrap" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={save} disabled={busy} data-testid="steam-save">{busy && <span className="spinner" />} Save Steam settings</button>
        {cfg?.hasApiKey && (
          <button className="btn danger" onClick={async () => { await window.api.steamSetConfig({ apiKey: null }); await load(); toast('API key removed.', 'success') }}>Remove key</button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => onImport('library')} disabled={!cfg?.hasApiKey || !cfg?.steamId} title={!cfg?.hasApiKey ? 'Save an API key and Steam ID first' : ''} data-testid="steam-import-library"><IconDownload size={16} /> Import Steam library…</button>
        <button className="btn" onClick={() => onImport('installed')} title="No API key needed — reads installed games from this PC" data-testid="steam-import-installed"><IconDownload size={16} /> Import installed Steam games…</button>
      </div>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={async () => { try { const n = await window.api.steamUpdateInstalled(); toast(n ? `Enabled Steam launching for ${n} installed game${n === 1 ? '' : 's'}.` : 'Install status is up to date.', 'success'); await reload() } catch (e) { toast((e as Error).message, 'error') } }}>
          <IconRefresh size={14} /> Detect installed Steam games
        </button>
        <button className="btn sm" disabled={!steamGames.length} onClick={async () => { try { await window.api.steamRefresh(steamGames.map((g) => g.id), { fetchMetadata: true, downloadArtwork: false }); toast(`Refreshing metadata for ${steamGames.length} Steam games in the background… Notes, ratings, favorites, categories and your edits are kept.`) } catch (e) { toast((e as Error).message, 'error') } }}>
          <IconRefresh size={14} /> Refresh metadata for all Steam games ({steamGames.length})
        </button>
      </div>
    </div>
  )
}

function BigPictureSettings(): JSX.Element {
  const { toast } = useApp()
  const [p, setP] = useState<AppPrefs | null>(null)
  useEffect(() => {
    window.api.getPrefs().then(setP).catch(() => undefined)
  }, [])
  const update = async (u: Partial<AppPrefs>): Promise<void> => {
    try {
      setP(await window.api.setPrefs(u))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  if (!p) return <div className="section" id="settings-bigpicture" />
  return (
    <div className="section" id="settings-bigpicture">
      <h3>Big Picture</h3>
      <p className="muted small" style={{ marginTop: -4 }}>Full-screen mode for the couch or a big monitor, driven by an Xbox controller. Open it with the Big Picture button or F11.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          Music folder <span className="hint">Your own music (MP3, OGG, FLAC, WAV, M4A) plays shuffled in the background. Leave empty for no music.</span>
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={p.musicFolder} onChange={(e) => setP({ ...p, musicFolder: e.target.value })} onBlur={() => update({ musicFolder: p.musicFolder })} data-testid="bp-music" />
            <button className="btn" onClick={async () => { const d = await window.api.pickFolder('Choose your music folder'); if (d) update({ musicFolder: d }) }}><IconFolder size={16} /> Browse…</button>
          </div>
        </label>
        <label className="field">
          Music volume
          <input className="range" type="range" min={0} max={1} step={0.05} value={p.musicVolume} onChange={(e) => setP({ ...p, musicVolume: Number(e.target.value) })} onMouseUp={() => update({ musicVolume: p.musicVolume })} onKeyUp={() => update({ musicVolume: p.musicVolume })} style={{ maxWidth: 300 }} />
        </label>
        <label className="check"><input type="checkbox" checked={p.playTrailers} onChange={(e) => update({ playTrailers: e.target.checked })} /> Play trailers from IGDB (needs internet). Your own clips always play.</label>
        <label className="check"><input type="checkbox" checked={p.startInBigPicture} onChange={(e) => update({ startInBigPicture: e.target.checked })} data-testid="bp-start" /> Start GameVault in Big Picture</label>
      </div>
    </div>
  )
}

function SourcesSettings(): JSX.Element {
  const { toast } = useApp()
  const [cfg, setCfg] = useState<{ igdb: boolean; igdbClientId: string; sgdb: boolean } | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [sgdbKey, setSgdbKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = async (): Promise<void> => {
    const c = await window.api.sourcesGetConfig()
    setCfg(c)
    setClientId(c.igdbClientId)
  }
  useEffect(() => {
    load().catch(() => undefined)
  }, [])
  const saveAndTest = async (which: 'igdb' | 'sgdb'): Promise<void> => {
    setBusy(which)
    try {
      if (which === 'igdb') await window.api.sourcesSetConfig({ igdbClientId: clientId, ...(secret ? { igdbClientSecret: secret } : {}) })
      else if (sgdbKey) await window.api.sourcesSetConfig({ sgdbKey })
      setSecret('')
      setSgdbKey('')
      await load()
      toast(await window.api.sourcesTest(which), 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const remove = async (which: 'igdb' | 'sgdb'): Promise<void> => {
    await window.api.sourcesSetConfig(which === 'igdb' ? { igdbClientId: null, igdbClientSecret: null } : { sgdbKey: null })
    await load()
    toast(which === 'igdb' ? 'IGDB keys removed.' : 'SteamGridDB key removed.', 'success')
  }
  const link = (url: string, label: string): JSX.Element => (
    <a href="#" onClick={(e) => { e.preventDefault(); window.api.openExternal(url) }}>{label}</a>
  )
  return (
    <div className="section" id="settings-sources">
      <h3>Online sources (optional)</h3>
      <p className="small" style={{ marginTop: -4, color: 'var(--text-2)' }}>
        Used by <b>Add Game</b> to fill in details and artwork for games on any system, including Nintendo and retro consoles. Keys stay on this PC, encrypted with your Windows account, and aren't included in backups.
      </p>
      <div className="source-block">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>IGDB — game details for every platform</b>
          {cfg?.igdb && <span className="status-pill ready">Connected</span>}
        </div>
        <ol className="steps small">
          <li>Go to {link('https://dev.twitch.tv/console', 'dev.twitch.tv/console')} (sign in with Twitch) and choose <b>Register Your Application</b>.</li>
          <li>Name: <code>GameVault</code> · OAuth Redirect URL: <code>http://localhost</code> · Category: <b>Application Integration</b> · Client type: <b>Confidential</b>.</li>
          <li>Open the app, copy the <b>Client ID</b>, click <b>New Secret</b> and copy the secret.</li>
        </ol>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <label className="field">Client ID<input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" data-testid="igdb-client-id" /></label>
          <label className="field">
            Client Secret {cfg?.igdb && <span className="ok">· saved</span>}
            <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg?.igdb ? '•••••••• (enter a new one to replace)' : ''} autoComplete="off" data-testid="igdb-secret" />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!clientId.trim() || (!secret && !cfg?.igdb) || busy != null} onClick={() => saveAndTest('igdb')} data-testid="igdb-save">
            {busy === 'igdb' && <span className="spinner" />} Save &amp; test
          </button>
          {cfg?.igdb && <button className="btn danger" onClick={() => remove('igdb')}>Remove</button>}
        </div>
      </div>
      <div className="source-block">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>SteamGridDB — box art, backgrounds and logos</b>
          {cfg?.sgdb && <span className="status-pill ready">Connected</span>}
        </div>
        <ol className="steps small">
          <li>Sign in at {link('https://www.steamgriddb.com/profile/preferences/api', 'steamgriddb.com → Profile → Preferences → API')}.</li>
          <li>Click <b>Generate API Key</b> and paste it here.</li>
        </ol>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: 1 }} type="password" value={sgdbKey} onChange={(e) => setSgdbKey(e.target.value)} placeholder={cfg?.sgdb ? '•••••••• (enter a new key to replace)' : 'API key'} autoComplete="off" data-testid="sgdb-key" />
          <button className="btn primary" disabled={(!sgdbKey && !cfg?.sgdb) || busy != null} onClick={() => saveAndTest('sgdb')} data-testid="sgdb-save">
            {busy === 'sgdb' && <span className="spinner" />} Save &amp; test
          </button>
          {cfg?.sgdb && <button className="btn danger" onClick={() => remove('sgdb')}>Remove</button>}
        </div>
      </div>
    </div>
  )
}

export function SettingsView({ onImport }: { onImport: (mode: 'library' | 'installed') => void }): JSX.Element {
  const { lib, reload, toast, confirm } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.api.version().then(setVersion).catch(() => undefined)
  }, [])

  const backup = async (): Promise<void> => {
    setBusy('backup')
    try {
      const r = await window.api.createBackup()
      if (r.ok) toast(`Backup saved to ${r.path}`, 'success', { label: 'Show', run: () => window.api.showInFolder(r.path as string) })
    } catch (e) {
      toast(`Backup failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const restore = async (): Promise<void> => {
    setBusy('restore')
    try {
      const info = await window.api.pickRestore()
      if (!info) return
      const ok = await confirm({
        title: 'Restore this backup?',
        body: (
          <>
            <p>
              Backup from <b>{info.createdAt ? new Date(info.createdAt).toLocaleString() : 'unknown date'}</b> with <b>{info.games}</b> game{info.games === 1 ? '' : 's'}.
            </p>
            <p>Your current collection (games, artwork, notes, ratings and categories) will be <b>replaced</b>. A safety backup of the current data is saved first, in the data folder's <code>backups</code> folder.</p>
          </>
        ),
        confirmLabel: 'Replace & restore',
        danger: true
      })
      if (!ok) return
      const r = await window.api.restore(info.path)
      await reload()
      toast(`${r.message} Safety backup of the previous data: ${r.safetyBackup}`, 'success')
    } catch (e) {
      toast(`Restore failed: ${(e as Error).message}. Your current collection was not changed.`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const csv = async (): Promise<void> => {
    setBusy('csv')
    try {
      const r = await window.api.exportCsv()
      if (r.ok) toast(`Exported to ${r.path}`, 'success', { label: 'Show', run: () => window.api.showInFolder(r.path as string) })
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const removeSamples = async (): Promise<void> => {
    if (!(await confirm({ title: 'Remove sample games?', body: <p>All sample games (and sample-only categories) are deleted. Your own games are not affected.</p>, confirmLabel: 'Remove samples', danger: true }))) return
    const n = await window.api.removeSamples()
    await reload()
    toast(`Removed ${n} sample game${n === 1 ? '' : 's'}.`, 'success')
  }

  const jump = (id: string): void => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {[
          ['settings-backup', 'Backup'],
          ['settings-categories', 'Categories'],
          ['settings-systems', 'Systems'],
          ['settings-emulators', 'Emulators'],
          ['settings-sources', 'Online sources'],
          ['settings-steam', 'Steam'],
          ['settings-bigpicture', 'Big Picture'],
          ['settings-genres', 'Genres']
        ].map(([id, label]) => (
          <button key={id} className="chip" onClick={() => jump(id)}>{label}</button>
        ))}
      </nav>
      <div className="section" id="settings-backup">
        <h3>Backup, restore & export</h3>
        <p className="muted small" style={{ marginTop: -4 }}>A backup is a single .zip with your whole collection: games, copies, artwork and images, ratings, notes, favorites, play status, systems, genres and categories.</p>
        <div className="row wrap">
          <button className="btn primary" onClick={backup} disabled={!!busy} data-testid="backup">{busy === 'backup' ? <span className="spinner" /> : <IconDownload size={16} />} Create backup…</button>
          <button className="btn" onClick={restore} disabled={!!busy} data-testid="restore">{busy === 'restore' ? <span className="spinner" /> : <IconUpload size={16} />} Restore from backup…</button>
          <button className="btn" onClick={csv} disabled={!!busy} data-testid="csv">{busy === 'csv' ? <span className="spinner" /> : <IconDownload size={16} />} Export CSV…</button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => window.api.openDataFolder()}><IconFolder size={16} /> Open data folder</button>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>Data folder: <code>{lib?.dataDir}</code></p>
      </div>
      {lib?.hasSamples && (
        <div className="section">
          <h3>Sample games</h3>
          <div className="row">
            <span className="grow muted" style={{ flex: 1 }}>Sample games are shown for a first look at the design.</span>
            <button className="btn danger" onClick={removeSamples} data-testid="settings-remove-samples"><IconTrash size={16} /> Remove sample games</button>
          </div>
        </div>
      )}
      <TagManager table="categories" tags={lib?.categories ?? []} title="Custom categories" help='Your own groupings, such as "Backlog", "Couch co-op" or "Comfort games". Separate from genres.' />
      <Systems />
      <EmulatorSettings />
      <SourcesSettings />
      <SteamSettings onImport={onImport} />
      <BigPictureSettings />
      <TagManager table="genres" tags={lib?.genres ?? []} title="Genres" help="Genres come from game metadata or what you type in the editor. Rename or tidy them here." />
      <p className="muted small">GameVault {version}</p>
    </div>
  )
}
