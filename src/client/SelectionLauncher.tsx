/**
 * Selection launcher: the always-mounted `shell.overlay` entry. Watches the
 * document selection; when a non-empty selection sits inside one assistant
 * chat row, shows a floating "Ask about this" button above it. Clicking hands
 * the validated hit to the controller (which opens the side panel) and clears
 * the selection. Pure presentation — detection logic lives in selection.ts,
 * actions arrive through the inject face.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SelectionHit } from './selection.ts'
import { readAssistantSelection } from './selection.ts'
import css from './SelectionLauncher.module.css'

/** Inject face supplied by the plugin's apply. */
export interface SelectionLauncherInjected {
  /** Open the side panel for the current session carrying this hit. */
  openSelection: (hit: SelectionHit) => void
}

/** Full props: runtime share (unused globals), inject face, and the `t` seat. */
export type SelectionLauncherProps = PropsRuntime<'shell.overlay'> & SelectionLauncherInjected & PropsLocale<'sideChat'>

/** Button placement offset above the selection rect. */
const BUTTON_OFFSET = 6
/** Viewport/layer clamping margin. */
const EDGE_MARGIN = 4

/**
 * The launcher surface: an inert full-size layer with one absolutely
 * positioned button. Local state only — the hit lives until the selection
 * collapses, a scroll moves it, Escape dismisses it, or the button is used.
 */
export function SelectionLauncher({ openSelection, t }: SelectionLauncherProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [hit, setHit] = useState<SelectionHit | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const recompute = useCallback(() => {
    const next = readAssistantSelection(window.getSelection())
    if (next === null) {
      setHit(null)
      setPos(null)
      return
    }
    // Position against the layer's live rect so the button tracks the frame,
    // not the viewport (no fixed-position ancestor assumptions).
    const layer = layerRef.current
    const layerRect = layer?.getBoundingClientRect()
    setHit(next)
    if (layerRect === undefined) return
    setPos({
      top: Math.max(EDGE_MARGIN, next.rect.top - layerRect.top - 28 - BUTTON_OFFSET),
      left: Math.min(
        Math.max(EDGE_MARGIN, next.rect.left - layerRect.left),
        Math.max(EDGE_MARGIN, layerRect.width - 140),
      ),
    })
  }, [])

  useEffect(() => {
    const documentRef = document
    let frame: number | null = null
    // selectionchange storms during a drag; rAF-coalesce the recomputes.
    const onSelectionChange = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        recompute()
      })
    }
    const onMouseUp = (): void => { recompute() }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey || event.key === 'Escape') recompute()
    }
    const onScroll = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      setHit(null)
      setPos(null)
    }
    const onMouseDown = (event: MouseEvent): void => {
      // Pressing our own button must keep the hit alive for the click.
      if (event.target instanceof Node && buttonRef.current?.contains(event.target) === true) return
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      setHit(null)
      setPos(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setHit(null)
        setPos(null)
      }
    }
    documentRef.addEventListener('selectionchange', onSelectionChange)
    documentRef.addEventListener('mouseup', onMouseUp)
    documentRef.addEventListener('keyup', onKeyUp)
    documentRef.addEventListener('scroll', onScroll, { capture: true, passive: true })
    documentRef.addEventListener('mousedown', onMouseDown)
    documentRef.addEventListener('keydown', onKeyDown)
    return () => {
      documentRef.removeEventListener('selectionchange', onSelectionChange)
      documentRef.removeEventListener('mouseup', onMouseUp)
      documentRef.removeEventListener('keyup', onKeyUp)
      documentRef.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
      documentRef.removeEventListener('mousedown', onMouseDown)
      documentRef.removeEventListener('keydown', onKeyDown)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [recompute])

  const onAsk = useCallback(() => {
    if (hit === null) return
    openSelection(hit)
    window.getSelection()?.removeAllRanges()
    setHit(null)
    setPos(null)
  }, [hit, openSelection])

  return (
    <div ref={layerRef} className={css.layer}>
      {hit !== null && pos !== null && (
        <button
          ref={buttonRef}
          type="button"
          className={css.ask}
          style={{ top: pos.top, left: pos.left }}
          onClick={onAsk}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
          <span className={css.askLabel}>{t('launcher.ask')}</span>
        </button>
      )}
    </div>
  )
}
