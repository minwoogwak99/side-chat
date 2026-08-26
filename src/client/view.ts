/**
 * Side-panel view derivation: folds the side session's conversation snapshot
 * (plus the controller's own lifecycle state) into the immutable view the
 * panel renders. Pure — the controller republishes through its snapshot store
 * on every side-session notify, so the panel subscribes through the bound
 * hook and carries no folding logic of its own.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistantChatData, ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One rendered side-conversation row. */
export interface SideChatRow {
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** `streaming` marks the still-running assistant output (running marker in the UI). */
  readonly state: 'final' | 'streaming'
}

/** Controller-owned lifecycle state folded into the view. */
export interface SideChatRecordState {
  /** `creating` while the side session is being connected; `error` blocks input. */
  readonly status: 'idle' | 'creating' | 'error'
  /** Error copy for the `error` status; otherwise undefined. */
  readonly error?: string | undefined
  /**
   * The typed text of the first ask. The side session's first user message is
   * the assembled context prompt; the panel displays this text for that row
   * instead, so the internal framing never appears as a chat bubble.
   */
  readonly firstQuestion?: string | undefined
}

/** The complete panel view published through the hooks compartment. */
export interface SideChatView extends SideChatRecordState {
  /** Quote snippet carried from the selection (already capped for display). */
  readonly quote: string
  /** Whether the side session is bound and its transcript is live. */
  readonly ready: boolean
  /** Whether the side session has a running turn (stop control). */
  readonly running: boolean
  /** Transcript rows in flow order. */
  readonly rows: readonly SideChatRow[]
}

/** Display cap for the quoted snippet in the panel header. */
const QUOTE_DISPLAY_CHARS = 400

/** Clip the quote for display with an explicit marker. */
function displayQuote(text: string): string {
  return text.length <= QUOTE_DISPLAY_CHARS ? text : `${text.slice(0, QUOTE_DISPLAY_CHARS)}…`
}

/**
 * Transcript entries plus per-node streaming flags, in flow order. The first
 * user row (the assembled context prompt on the wire) renders the typed
 * `firstQuestion` instead — internal framing stays out of the panel.
 */
function sideRowsOf(snapshot: ConversationSnapshot, firstQuestion: string | undefined): readonly SideChatRow[] {
  const rows: SideChatRow[] = []
  let sawUserRow = false
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key) as ChatNode | undefined
    if (node === undefined) continue
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = node.data.content
        .map(block => block.type === 'text' ? block.text : '')
        .filter(text => text !== '')
        .join('\n\n')
        .trim()
      const shown = sawUserRow || firstQuestion === undefined ? text : firstQuestion
      sawUserRow = true
      if (text !== '') rows.push({ role: 'user', text: shown, state: 'final' })
    } else if (node.kind === 'assistant-step') {
      const data = node.data as AssistantChatData
      const text = data.blocks
        .flatMap(block => block.kind === 'text' ? [block.text] : [])
        .join('\n\n')
        .trim()
      // A running step renders as a streaming row even before its first text
      // block lands, so the user sees the turn in flight immediately.
      if (text !== '' || data.status === 'running') {
        rows.push({
          role: 'assistant',
          text,
          state: data.status === 'running' ? 'streaming' : 'final',
        })
      }
    }
  }
  return rows
}

/** Prompt-error copy folded from the side snapshot, if the last op failed. */
function promptErrorOf(snapshot: ConversationSnapshot): string | undefined {
  const error = snapshot.promptError
  if (error === null) return undefined
  return error.error.message === '' ? error.error.code : `${error.error.code}: ${error.error.message}`
}

/**
 * Derive the complete panel view.
 *
 * @param snapshot - side session snapshot, or undefined before the session is bound.
 * @param quote - the selected passage carried by the record.
 * @param state - controller lifecycle state.
 * @returns the immutable view for the panel.
 */
export function deriveSideView(
  snapshot: ConversationSnapshot | undefined,
  quote: string,
  state: SideChatRecordState,
): SideChatView {
  const sendError = state.status === 'error' ? state.error : undefined
  return {
    status: state.status,
    error: sendError ?? (snapshot === undefined ? undefined : promptErrorOf(snapshot)),
    quote: displayQuote(quote),
    ready: snapshot !== undefined,
    running: snapshot?.running ?? false,
    rows: snapshot === undefined ? [] : sideRowsOf(snapshot, state.firstQuestion),
  }
}
