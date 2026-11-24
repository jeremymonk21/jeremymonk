import { useEffect, useRef } from 'react'

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'menu' | 'view'

/** Standard-mapping button indexes (Xbox controllers in Chromium). */
const BUTTONS: Array<[number, PadAction]> = [
  [0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [8, 'view'], [9, 'menu'],
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']
]
const REPEATABLE: PadAction[] = ['up', 'down', 'left', 'right', 'lb', 'rb']
const KEYS: Record<string, PadAction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b', x: 'x', X: 'x', y: 'y', Y: 'y', f: 'y', F: 'y',
  q: 'lb', Q: 'lb', e: 'rb', E: 'rb', PageUp: 'lb', PageDown: 'rb', Tab: 'menu', m: 'menu', M: 'menu'
}

/**
 * Calls `onAction` for Xbox controller input (buttons, D-pad, left stick, with auto-repeat while held)
 * and the matching keyboard keys. Returns nothing; reads the latest handler on every event.
 */
export function useGamepad(onAction: (a: PadAction) => void, enabled = true): void {
  const handler = useRef(onAction)
  handler.current = onAction
  useEffect(() => {
    if (!enabled) return
    const held = new Map<PadAction, number>() // action → next repeat time
    let raf = 0
    const fire = (a: PadAction): void => handler.current(a)
    const loop = (): void => {
      const now = performance.now()
      const pressed = new Set<PadAction>()
      for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (!pad || !pad.connected) continue
        for (const [i, a] of BUTTONS) if (pad.buttons[i]?.pressed) pressed.add(a)
        const [x = 0, y = 0] = pad.axes
        if (x < -0.55) pressed.add('left')
        if (x > 0.55) pressed.add('right')
        if (y < -0.55) pressed.add('up')
        if (y > 0.55) pressed.add('down')
      }
      for (const a of pressed) {
        const next = held.get(a)
        if (next === undefined) {
          fire(a)
          held.set(a, now + 380)
        } else if (REPEATABLE.includes(a) && now >= next) {
          fire(a)
          held.set(a, now + 110)
        }
      }
      for (const a of [...held.keys()]) if (!pressed.has(a)) held.delete(a)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const a = KEYS[e.key]
      if (!a) return
      e.preventDefault()
      e.stopPropagation()
      fire(a)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [enabled])
}
