/**
 * Side-chat controller: the apply-world state machine behind the panel.
 *
 * One record per main session, keyed by session id and living for the plugin
 * fiber's lifetime. The record owns a stable {@link SnapshotStore} whose value
 * is the panel view — stable identity is what lets the entry's inject hooks
 * compartment bind `useSideChat` once and still observe record resets.
 *
 * Side chats are ONE-SHOT and INVISIBLE: the side session is archived the
 * moment it is created (hidden from every sidebar/history surface for its
 * whole life), its conversation window is opened without staging it (see
 * {@link SideChatController.#openSideWindow}), and closing the panel — or
 * starting a different selection — cancels any running turn and discards the
 * binding. A follow-up Q&A thread is asked, answered, and discarded, never
 * accumulated.
 *
 * The side session is a fresh blank session in the main session's workspace
 * (`workspaces.connectWorkspace`), never staged — the main chat stays
 * current. Only the FIRST ask carries the assembled context prompt; follow-up
 * asks are plain messages into the same side session, and every snapshot
 * notify republishes the view so streaming answers render live.
 */
import type {
  ConversationSnapshot, ISessions, IWorkspaces, ObservableSnapshot, SessionFace,
  SessionId, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { assistantMessageText, buildSideChatPrompt, extractTranscript } from './context.ts'
import type { SelectionHit } from './selection.ts'
import { deriveSideView, type SideChatView } from './view.ts'

/** Constructor dependencies, all plain service faces (test-fakeable). */
export interface SideChatControllerDeps {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly layout: ILayout
  /**
   * Mount the panel's `details` shadow entry (priority below the stock
   * DetailsPanel) and return its disposer. Supplied by the browser half's
   * apply so the controller stays free of slot-registry typing.
   */
  readonly mountPanel: () => () => void
}

/** One main session's side-chat state. The store identity survives resets. */
interface SideChatRecord {
  readonly store: SnapshotStore<SideChatView>
  quote: SelectionHit
  sideSessionId: SessionId | undefined
  status: 'idle' | 'creating' | 'error'
  error: string | undefined
  unsubscribe: (() => void) | undefined
  /** Bumped by every teardown; in-flight asks stale-check against it. */
  epoch: number
  /** True once the side session is archived (hidden from every grouping surface). */
  hidden: boolean
}

/** Static empty source for scopes whose session has no record (yet). */
const EMPTY_VIEW = deriveSideView(undefined, '', { status: 'idle' })
const EMPTY_SOURCE: ObservableSnapshot<SideChatView> = {
  getSnapshot: () => EMPTY_VIEW,
  subscribe: () => () => {},
}

/**
 * Owns per-session side-chat records and the panel entry lifecycle.
 * Constructor is cheap and side-effect free; behavior starts on
 * {@link SideChatController.open}.
 */
export class SideChatController {
  readonly #deps: SideChatControllerDeps
  readonly #records = new Map<SessionId, SideChatRecord>()
  #disposePanel: (() => void) | undefined
  /** Main session whose side chat currently owns the panel, if any. */
  #activeMainId: SessionId | undefined

  /**
   * @param deps - service faces plus the panel mount callback.
   */
  constructor(deps: SideChatControllerDeps) {
    this.#deps = deps
  }

  /** Observable view source for one session's panel (empty source when absent). */
  viewOf(sessionId: SessionId): ObservableSnapshot<SideChatView> {
    return this.#records.get(sessionId)?.store ?? EMPTY_SOURCE
  }

  /**
   * Open the side panel for the current session carrying a new selection.
   * Any live side chat (this session's or another's) is retired first —
   * one panel, one side conversation at a time. The stock details entry
   * stays shadowed until {@link SideChatController.close}.
   * @param hit - validated selection inside an assistant message.
   */
  open(hit: SelectionHit): void {
    const list = this.#deps.sessions.list.getSnapshot()
    const current = list.current
    if (current === undefined) return
    if (list.byId[current]?.blank !== false) return
    // Only one side conversation is visible at a time; the panel's details
    // entry always renders the current session's record, so a different
    // session's live thread is already invisible — end it.
    if (this.#activeMainId !== undefined && this.#activeMainId !== current) {
      const prior = this.#records.get(this.#activeMainId)
      if (prior !== undefined) void this.#retire(prior)
    }
    const record = this.#recordOf(current)
    void this.#retire(record)
    record.quote = hit
    record.status = 'idle'
    record.error = undefined
    this.#activeMainId = current
    this.#disposePanel ??= this.#deps.mountPanel()
    this.#deps.layout.openDetails()
    this.#publish(record)
  }

  /**
   * Send one follow-up question. The first ask creates the side session and
   * carries the context prompt; later asks are plain messages. Each side
   * snapshot notify republishes the view, so streaming answers render live.
   * @param sessionId - main session whose record owns the side chat.
   * @param question - user question text (non-blank after trim).
   */
  async ask(sessionId: SessionId, question: string): Promise<void> {
    const record = this.#records.get(sessionId)
    if (record === undefined || record.status === 'creating') return
    const text = question.trim()
    if (text === '') return
    const epoch = record.epoch
    try {
      if (record.sideSessionId === undefined) {
        record.status = 'creating'
        record.error = undefined
        this.#publish(record)
        const sideId = await this.#connectSideSession(sessionId)
        if (record.epoch !== epoch) {
          // Closed/superseded mid-creation: the session slipped past the
          // retirement that missed it — discard it here and change nothing.
          await this.#discardSession(sideId, false)
          return
        }
        record.sideSessionId = sideId
        record.status = 'idle'
        // Hide the one-shot session from every grouping surface for its
        // whole life, not just after close. Failure only means the row stays
        // visible until retirement retries the archive.
        try {
          await this.#deps.workspaces.archiveSession(sideId)
          record.hidden = true
        } catch {
          // Retirement's archive is the fallback.
        }
        this.#bindSide(record)
        // Open the conversation window WITHOUT staging the session (staging
        // is the current-selection move). The window is what lets live
        // session events fold into chat nodes instead of dropping cold.
        try {
          await this.#openSideWindow(sideId)
          const prompt = this.#firstPrompt(sessionId, record.quote, text)
          await this.#send(record, prompt)
        } catch (error) {
          // The fresh side session is unusable (window open or prompt throw);
          // discard it so the next ask starts from a clean record.
          if (record.epoch === epoch) await this.#retire(record)
          throw error
        }
      } else {
        await this.#send(record, text)
      }
    } catch (error: unknown) {
      // Creation/transport failure lands here before any prompt result does.
      if (record.epoch !== epoch) return
      record.status = 'error'
      record.error = error instanceof Error ? error.message : String(error)
      this.#publish(record)
    }
  }

  /**
   * Cancel the side session's running turn but keep the thread open — the
   * user may still want to ask something else about the same passage.
   * @param sessionId - main session whose record owns the side chat.
   */
  stop(sessionId: SessionId): void {
    const face = this.#sideFaceOf(sessionId)
    if (face === undefined) return
    void face.cancel().catch(() => {
      // Stop failure surfaces through the side snapshot's promptError on the
      // next publish; nothing to restore here.
    })
  }

  /**
   * Close the panel AND end the one-shot side conversation: cancel any
   * running turn, unbind, archive the side session out of the workspace
   * history, and reset the record. The stock DetailsPanel remounts as the
   * details winner.
   * @param sessionId - main session whose record owns the side chat.
   */
  close(sessionId: SessionId): void {
    const record = this.#records.get(sessionId)
    if (record !== undefined) void this.#retire(record)
    if (this.#activeMainId === sessionId) this.#activeMainId = undefined
    this.#disposePanel?.()
    this.#disposePanel = undefined
    this.#deps.layout.closeDetails()
  }

  /** Plugin teardown: drop the panel entry, retire every side chat, clear records. */
  dispose(): void {
    this.#disposePanel?.()
    this.#disposePanel = undefined
    this.#activeMainId = undefined
    for (const record of this.#records.values()) {
      void this.#retire(record)
    }
    this.#records.clear()
  }

  #recordOf(sessionId: SessionId): SideChatRecord {
    let record = this.#records.get(sessionId)
    if (record === undefined) {
      const store = createSnapshotStore<SideChatView>(deriveSideView(undefined, '', { status: 'idle' }))
      record = {
        store,
        quote: { nodeKey: '', text: '', rect: { top: 0, left: 0, bottom: 0, right: 0 } },
        sideSessionId: undefined,
        status: 'idle',
        error: undefined,
        unsubscribe: undefined,
        epoch: 0,
        hidden: false,
      }
      this.#records.set(sessionId, record)
    }
    return record
  }

  /**
   * End one record's side conversation: cancel the running turn, unbind the
   * subscription, archive the side session unless it was already archived at
   * creation, and reset the record content. Store identity survives.
   */
  async #retire(record: SideChatRecord): Promise<void> {
    record.epoch += 1
    record.unsubscribe?.()
    record.unsubscribe = undefined
    const sideId = record.sideSessionId
    const hidden = record.hidden
    record.sideSessionId = undefined
    record.status = 'idle'
    record.error = undefined
    record.quote = { nodeKey: '', text: '', rect: { top: 0, left: 0, bottom: 0, right: 0 } }
    record.hidden = false
    if (sideId !== undefined) await this.#discardSession(sideId, hidden)
    this.#publish(record)
  }

  /**
   * Cancel a session's running turn and archive it out of every history
   * surface. `hidden` skips the archive when the creation-time one already
   * landed (the host set is idempotent, but one archive keeps the wire quiet).
   * @param sideId - session to discard.
   * @param hidden - whether the session is already archived.
   */
  async #discardSession(sideId: SessionId, hidden: boolean): Promise<void> {
    const face = this.#deps.sessions.binding(sideId)?.session
    if (face !== undefined) {
      try {
        await face.cancel()
      } catch {
        // Already settled or gone; archiving below is still the right call.
      }
    }
    if (hidden) return
    try {
      await this.#deps.workspaces.archiveSession(sideId)
    } catch {
      // Archiving a ghost must not surface anywhere — the thread is dead
      // either way from this plugin's perspective.
    }
  }

  /**
   * Open the side session's conversation window without staging it. The
   * public SessionFace contract has no window verb (staging — becoming the
   * current selection — is the only sanctioned opener), so this reaches the
   * concrete Session's idempotent open() through a structural cast. A window
   * is required for live events to fold: cold sessions drop every frame and
   * would leave the panel permanently empty.
   * @param sideId - session whose window should open.
   */
  async #openSideWindow(sideId: SessionId): Promise<void> {
    const face = this.#deps.sessions.binding(sideId)?.session
    const opener = face as unknown as { open?: () => Promise<void> } | undefined
    if (face === undefined || typeof opener?.open !== 'function') {
      throw new Error('side-chat: session window open() unavailable (harness runtime mismatch)')
    }
    await opener.open()
  }

  /** Resolve the workspace holding the main session and connect a blank session in it. */
  async #connectSideSession(mainId: SessionId): Promise<SessionId> {
    const sessions = this.#deps.sessions.list.getSnapshot()
    const summary = sessions.byId[mainId]
    const workspaces = this.#deps.workspaces.list.getSnapshot()
    const workspace = workspaces.items.find(item => item.sessionIds.includes(mainId))
      ?? (summary?.cwd === undefined
        ? undefined
        : workspaces.items.find(item => item.path === summary.cwd))
    if (workspace === undefined) {
      throw new Error(`side-chat: no workspace found for session ${mainId}`)
    }
    return await this.#deps.workspaces.connectWorkspace(workspace.workspaceId)
  }

  /** Assemble the context-bearing first prompt from the main session snapshot. */
  #firstPrompt(mainId: SessionId, quote: SelectionHit, question: string): string {
    const snapshot: ConversationSnapshot | undefined = this.#deps.sessions.binding(mainId)?.session.getSnapshot()
    const transcript = snapshot === undefined ? [] : extractTranscript(snapshot)
    const containingMessage = snapshot === undefined ? undefined : assistantMessageText(snapshot, quote.nodeKey)
    return buildSideChatPrompt({ question, quote: quote.text, containingMessage, transcript })
  }

  /** Send one message into the side session, folding a rejected result into the record. */
  async #send(record: SideChatRecord, text: string): Promise<void> {
    const face = this.#requireSideFace(record)
    const result = await face.prompt([{ type: 'text', text }], 'queue')
    if (record.sideSessionId === undefined) return
    if (!result.ok) {
      record.status = 'error'
      record.error = `${result.error.code}: ${result.error.message}`
      this.#publish(record)
    }
    // Acceptance needs no explicit publish: the side session's own notify (our
    // subscription) republishes the view with the queued/running turn.
  }

  #sideFaceOf(sessionId: SessionId): SessionFace | undefined {
    const record = this.#records.get(sessionId)
    if (record?.sideSessionId === undefined) return undefined
    return this.#deps.sessions.binding(record.sideSessionId)?.session
  }

  #requireSideFace(record: SideChatRecord): SessionFace {
    const id = record.sideSessionId
    if (id === undefined) throw new Error('side-chat: side session not connected')
    const face = this.#deps.sessions.binding(id)?.session
    if (face === undefined) throw new Error(`side-chat: side session ${id} resolved no binding`)
    return face
  }

  /** Subscribe the record to its side session's snapshot and publish immediately. */
  #bindSide(record: SideChatRecord): void {
    record.unsubscribe?.()
    record.unsubscribe = undefined
    const face = this.#requireSideFace(record)
    record.unsubscribe = face.subscribe(() => { this.#publish(record) })
    this.#publish(record)
  }

  #publish(record: SideChatRecord): void {
    const snapshot = record.sideSessionId === undefined
      ? undefined
      : this.#deps.sessions.binding(record.sideSessionId)?.session.getSnapshot()
    record.store.set(deriveSideView(snapshot, record.quote.text, {
      status: record.status,
      error: record.error,
    }))
  }
}
