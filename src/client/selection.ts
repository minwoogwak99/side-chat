/**
 * Selection reading for the side-chat launcher: turns a live DOM selection
 * into a quote when (and only when) it sits inside one assistant chat row.
 *
 * The chat flow's DOM contract is stable: every rendered Chat node row is a
 * `[data-chat-anchor-key]` element carrying `data-chat-flow-kind` (see
 * ui-conversation's ChatNodeSeat). Assistant rows are kind `assistant-step`.
 * Pure DOM-in/DOM-out — no React, no services; unit-testable with jsdom.
 */

/** Hard cap for a carried quote; longer selections are rejected outright. */
export const MAX_SELECTION_CHARS = 8000

/** One validated selection inside an assistant message. */
export interface SelectionHit {
  /** Chat node key (`data-chat-anchor-key`) of the containing assistant row. */
  readonly nodeKey: string
  /** Selected text, whitespace-normalized. */
  readonly text: string
  /** Selection bounding rect in viewport coordinates (button placement). */
  readonly rect: { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }
}

/** Chat row kinds the launcher may quote from (assistant messages only). */
const QUOTABLE_KINDS = new Set(['assistant-step'])

/** Resolve the enclosing chat row of a selection endpoint, if any. */
function chatRowOf(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement ?? null
  return element?.closest<HTMLElement>('[data-chat-anchor-key]') ?? null
}

/**
 * Read the current selection as a quotable assistant passage.
 *
 * @param selection - the live browser selection (usually `window.getSelection()`).
 * @returns the hit, or null when nothing is selected, the selection crosses
 *   rows or targets a non-assistant row, or the text exceeds
 *   {@link MAX_SELECTION_CHARS}.
 */
export function readAssistantSelection(selection: Selection | null): SelectionHit | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const anchorRow = chatRowOf(selection.anchorNode)
  const focusRow = chatRowOf(selection.focusNode)
  if (anchorRow === null || anchorRow !== focusRow) return null
  if (!QUOTABLE_KINDS.has(anchorRow.dataset.chatFlowKind ?? '')) return null
  const nodeKey = anchorRow.dataset.chatAnchorKey
  if (nodeKey === undefined || nodeKey === '') return null
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (text === '' || text.length > MAX_SELECTION_CHARS) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return {
    nodeKey,
    text,
    rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
  }
}
