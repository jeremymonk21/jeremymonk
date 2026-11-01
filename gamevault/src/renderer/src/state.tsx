import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Game, GameSystem, Library, Tag } from '@shared/types'
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
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), [])
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
      toast,
      confirm,
      registerFlush
    }),
    [lib, loadError, reload, putGame, dropGame, toast, confirm, registerFlush]
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
