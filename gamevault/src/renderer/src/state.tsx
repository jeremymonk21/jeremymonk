import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, Game, GameSystem, Library, Tag } from '@shared/types'
import { IconAlert, IconCheck, IconInfo, IconX } from './components/Icons'

export type ToastKind = 'info' | 'success' | 'error'
interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: { label: string; run: () => void }
}

export interface ConfirmOptions {
  title: string
  body: React.ReactNode
  confirmLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label: string
  initial?: string
  confirmLabel?: string
  multiline?: boolean
  placeholder?: string
}

interface Ctx {
  lib: Library | null
  loadError: string | null
  reload: () => Promise<void>
  putGame: (g: Game) => void
  dropGame: (id: number) => void
  systemsById: Map<number, GameSystem>
  genresById: Map<number, Tag>
  categoriesById: Map<number, Tag>
  toast: (text: string, kind?: ToastKind, action?: Toast['action']) => void
  confirm: (o: ConfirmOptions) => Promise<boolean>
  /** Asks for a line (or block) of text; resolves null when cancelled. */
  prompt: (o: PromptOptions) => Promise<string | null>
  collectionsById: Map<number, Collection>
  /** Registers a flush callback run before the window closes (e.g. unsaved notes). */
  registerFlush: (fn: () => Promise<void>) => () => void
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function AppProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [lib, setLib] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const [promptState, setPromptState] = useState<(PromptOptions & { resolve: (v: string | null) => void; value: string }) | null>(null)
  const flushers = useRef(new Set<() => Promise<void>>())

  const reload = useCallback(async () => {
    try {
      const l = await window.api.getLibrary()
      setLib(l)
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    reload()
    window.api.onBeforeClose(async () => {
      await Promise.all([...flushers.current].map((f) => f().catch(() => undefined)))
    })
  }, [reload])

  const putGame = useCallback((g: Game) => {
    setLib((l) => {
      if (!l) return l
      const exists = l.games.some((x) => x.id === g.id)
      return { ...l, games: exists ? l.games.map((x) => (x.id === g.id ? g : x)) : [...l.games, g] }
    })
  }, [])
  const dropGame = useCallback((id: number) => {
    setLib((l) => (l ? { ...l, games: l.games.filter((g) => g.id !== id) } : l))
  }, [])

  const toast = useCallback((text: string, kind: ToastKind = 'info', action?: Toast['action']) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, kind, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), [])
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((resolve) => setPromptState({ ...o, resolve, value: o.initial ?? '' })), [])
  const registerFlush = useCallback((fn: () => Promise<void>) => {
    flushers.current.add(fn)
    return () => {
      flushers.current.delete(fn)
    }
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      lib,
      loadError,
      reload,
      putGame,
      dropGame,
      systemsById: new Map((lib?.systems ?? []).map((s) => [s.id, s])),
      genresById: new Map((lib?.genres ?? []).map((s) => [s.id, s])),
      categoriesById: new Map((lib?.categories ?? []).map((s) => [s.id, s])),
      collectionsById: new Map((lib?.collections ?? []).map((c) => [c.id, c])),
      toast,
      confirm,
      prompt,
      registerFlush
    }),
    [lib, loadError, reload, putGame, dropGame, toast, confirm, prompt, registerFlush]
  )

  const closeConfirm = (v: boolean): void => {
    confirmState?.resolve(v)
    setConfirmState(null)
  }

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="t-icon">{t.kind === 'error' ? <IconAlert /> : t.kind === 'success' ? <IconCheck /> : <IconInfo />}</span>
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action && (
              <button className="btn sm" onClick={() => { t.action?.run(); setToasts((x) => x.filter((y) => y.id !== t.id)) }}>
                {t.action.label}
              </button>
            )}
            <button className="btn ghost sm icon" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
      {promptState && (
        <Modal title={promptState.title} onClose={() => { promptState.resolve(null); setPromptState(null) }} size="sm">
          <form onSubmit={(e) => { e.preventDefault(); promptState.resolve(promptState.value); setPromptState(null) }}>
            <div className="modal-body">
              <label className="field">
                {promptState.label}
                {promptState.multiline ? (
                  <textarea className="textarea" autoFocus rows={4} value={promptState.value} placeholder={promptState.placeholder} onChange={(e) => setPromptState({ ...promptState, value: e.target.value })} data-testid="prompt-input" />
                ) : (
                  <input className="input" autoFocus value={promptState.value} placeholder={promptState.placeholder} onChange={(e) => setPromptState({ ...promptState, value: e.target.value })} data-testid="prompt-input" />
                )}
              </label>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => { promptState.resolve(null); setPromptState(null) }}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!promptState.multiline && !promptState.value.trim()} data-testid="prompt-ok">{promptState.confirmLabel ?? 'OK'}</button>
            </div>
          </form>
        </Modal>
      )}
      {confirmState && (
        <Modal title={confirmState.title} onClose={() => closeConfirm(false)} size="sm">
          <div className="modal-body">{confirmState.body}</div>
          <div className="modal-foot">
            <button className="btn" onClick={() => closeConfirm(false)}>Cancel</button>
            <button className={`btn ${confirmState.danger ? 'solid-danger' : 'primary'}`} autoFocus onClick={() => closeConfirm(true)} data-testid="confirm-ok">
              {confirmState.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </AppCtx.Provider>
  )
}

export function Modal({
  title,
  onClose,
  children,
  size,
  closeOnBackdrop = true
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  size?: 'sm' | 'mid' | 'wide'
  closeOnBackdrop?: boolean
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'wide' ? 'wide' : size === 'mid' ? 'mid' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }, [key, v])
  return [v, setV]
}

export const imgUrl = (file: string): string => `gvimg://local/${encodeURIComponent(file)}`
