import { describe, expect, it } from 'vitest'
import type {
  ConversationSnapshot, ISessions, IWorkspaces, ObservableSnapshot, SessionFace, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SideChatController } from '../src/client/controller.ts'
import type { SelectionHit } from '../src/client/selection.ts'
import type { SideChatView } from '../src/client/view.ts'

const MAIN: SessionId = 'main' as SessionId
const SIDE: SessionId = 'side' as SessionId

/** Flush pending microtask chains (awaited async helpers) before asserting. */
const settle = () => new Promise<void>(resolve => { setTimeout(resolve, 0) })

/** Chat-node fixture shorthand (the reader touches order + nodes.get only). */
function snapshotOf(nodes: readonly { key: string; kind: string; data: unknown }[], running = false): ConversationSnapshot {
  return {
    chat: {
      order: nodes.map(node => node.key),
      nodes: { get: (key: string) => nodes.find(node => node.key === key), values: () => [] },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
    },
    running,
    promptError: null,
  } as unknown as ConversationSnapshot
}

const USER = (key: string, text: string) => ({
  key,
  kind: 'user',
  data: { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text }], source: { kind: 'user' } },
})

const ASSISTANT = (key: string, text: string, status = 'settled') => ({
  key,
  kind: 'assistant-step',
  data: { status, turn: 1, step: 1, blocks: text === '' ? [] : [{ kind: 'text', text }], time: 0 },
})

/** Mutable per-session fake: snapshot + notify listeners + prompt/cancel log. */
class FakeSession {
  snapshot: ConversationSnapshot
  readonly listeners = new Set<() => void>()
  readonly prompts: string[] = []
  cancelCount = 0
  openCount = 0

  constructor(snapshot: ConversationSnapshot) {
    this.snapshot = snapshot
  }

  notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  face(): SessionFace {
    return {
      getSnapshot: () => this.snapshot,
      subscribe: (fn: () => void) => {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      prompt: async (parts: readonly { type: string; text: string }[]) => {
        this.prompts.push(parts[0]?.text ?? '')
        return { ok: true as const }
      },
      cancel: async () => {
        this.cancelCount += 1
        return { ok: true as const }
      },
      open: async () => {
        this.openCount += 1
      },
    } as unknown as SessionFace
  }
}

function hit(text: string, nodeKey = 'a1'): SelectionHit {
  return { nodeKey, text, rect: { top: 0, left: 0, bottom: 0, right: 0 } }
}

const MAIN_NODES = [USER('u1', 'explain'), ASSISTANT('a1', 'the arcane passage')]

interface Harness {
  readonly controller: SideChatController
  readonly mainSession: FakeSession
  readonly sideSession: FakeSession
  readonly archived: SessionId[]
  /** Views the main record published; call after `open` bound the record. */
  trackViews(): SideChatView[]
}

/**
 * Wire the controller against fake services: current session `main` (already
 * holding one assistant answer), and blank session `side` handed out by
 * connectWorkspace on the first ask. `gateConnect` holds session creation.
 */
function boot(mainNodes: readonly object[] = MAIN_NODES, gateConnect?: Promise<void>): Harness {
  const mainSession = new FakeSession(snapshotOf(mainNodes as never))
  const sideSession = new FakeSession(snapshotOf([]))
  const archived: SessionId[] = []

  const sessions = {
    list: {
      getSnapshot: () => ({
        current: MAIN,
        byId: { [MAIN]: { blank: false, cwd: '/w' }, [SIDE]: { blank: false, cwd: '/w' } },
      }),
    },
    binding: (id: SessionId) =>
      id === MAIN
        ? { session: mainSession.face() }
        : id === SIDE
          ? { session: sideSession.face() }
          : undefined,
  } as unknown as ISessions

  const workspaces = {
    list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', path: '/w', sessionIds: [MAIN] }] }) },
    connectWorkspace: async () => {
      if (gateConnect !== undefined) await gateConnect
      return SIDE
    },
    archiveSession: async (id: SessionId) => {
      archived.push(id)
    },
  } as unknown as IWorkspaces

  const controller = new SideChatController({
    sessions,
    workspaces,
    layout: { openDetails: () => {}, closeDetails: () => {} } as unknown as ILayout,
    mountPanel: () => () => {},
  })

  const trackViews = (): SideChatView[] => {
    const views: SideChatView[] = []
    const source: ObservableSnapshot<SideChatView> = controller.viewOf(MAIN)
    const record = (view: SideChatView): void => {
      const last = views.at(-1)
      if (last === undefined || last !== view) views.push(view)
    }
    record(source.getSnapshot())
    source.subscribe(() => record(source.getSnapshot()))
    return views
  }

  return { controller, mainSession, sideSession, archived, trackViews }
}

describe('SideChatController streaming', () => {
  it('opens the side window and archives the session at creation', async () => {
    const { controller, sideSession, archived } = boot()
    controller.open(hit('arcane'))
    await controller.ask(MAIN, 'what does it mean?')
    // The window open is what lets live events fold into chat nodes; the
    // creation-time archive hides the row from the sidebar immediately.
    expect(sideSession.openCount).toBe(1)
    expect(archived).toEqual([SIDE])
  })

  it('renders partial assistant text while the side turn is running', async () => {
    const { controller, sideSession, trackViews } = boot()
    controller.open(hit('arcane'))
    const views = trackViews()
    await controller.ask(MAIN, 'what does it mean?')
    // The wire's first user message is the assembled context prompt.
    const PROMPT = 'You are answering in a side conversation … <question>'

    // Turn starts: the panel shows the typed question, not the prompt.
    sideSession.snapshot = snapshotOf([
      USER('u1', PROMPT),
      ASSISTANT('a1', '', 'running'),
    ], true)
    sideSession.notify()
    let view = views.at(-1)!
    expect(view.running).toBe(true)
    expect(view.rows[0]).toEqual({ role: 'user', text: 'what does it mean?', state: 'final' })
    expect(view.rows.at(-1)).toEqual({ role: 'assistant', text: '', state: 'streaming' })

    // Tokens land mid-turn.
    sideSession.snapshot = snapshotOf([
      USER('u1', PROMPT),
      ASSISTANT('a1', 'it mea', 'running'),
    ], true)
    sideSession.notify()
    view = views.at(-1)!
    expect(view.rows.at(-1)).toEqual({ role: 'assistant', text: 'it mea', state: 'streaming' })

    // Turn settles: same text, final state, running cleared; the display
    // question stays the typed one for the whole thread.
    sideSession.snapshot = snapshotOf([
      USER('u1', PROMPT),
      ASSISTANT('a1', 'it means this', 'settled'),
    ], false)
    sideSession.notify()
    view = views.at(-1)!
    expect(view.running).toBe(false)
    expect(view.rows.at(-1)).toEqual({ role: 'assistant', text: 'it means this', state: 'final' })
    expect(view.rows[0]!.text).toBe('what does it mean?')
  })

  it('sends follow-up asks as plain text into the same side session', async () => {
    const { controller, sideSession } = boot()
    controller.open(hit('arcane'))
    await controller.ask(MAIN, 'first question')
    await controller.ask(MAIN, 'second question')
    expect(sideSession.prompts).toHaveLength(2)
    expect(sideSession.prompts[0]).toContain('<selected_passage>')
    expect(sideSession.prompts[1]).toBe('second question')
  })
})

describe('SideChatController one-shot lifecycle', () => {
  it('close cancels the running turn and resets the view without re-archiving', async () => {
    const { controller, sideSession, archived, trackViews } = boot()
    controller.open(hit('arcane'))
    const views = trackViews()
    await controller.ask(MAIN, 'q1')
    // The creation-time archive already hid the session; retirement must not
    // repeat it.
    expect(archived).toEqual([SIDE])
    sideSession.snapshot = snapshotOf([
      USER('u1', 'q1'),
      ASSISTANT('a1', 'partial', 'running'),
    ], true)
    sideSession.notify()
    expect(views.at(-1)!.running).toBe(true)

    controller.close(MAIN)
    await settle()

    expect(sideSession.cancelCount).toBe(1)
    expect(archived).toEqual([SIDE])
    const view = views.at(-1)!
    expect(view.ready).toBe(false)
    expect(view.rows).toEqual([])
    expect(view.quote).toBe('')
    expect(view.running).toBe(false)
  })

  it('a new selection retires the previous side session and carries the new quote', async () => {
    const { controller, archived } = boot()
    controller.open(hit('arcane'))
    await controller.ask(MAIN, 'q1')

    controller.open(hit('other passage', 'a2'))
    await settle()
    expect(archived).toEqual([SIDE])
    expect(controller.viewOf(MAIN).getSnapshot().quote).toContain('other passage')
    expect(controller.viewOf(MAIN).getSnapshot().ready).toBe(false)
  })

  it('close during session creation discards the late-arriving session', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const { controller, archived, trackViews } = boot(MAIN_NODES, gate)
    controller.open(hit('arcane'))
    const views = trackViews()
    const asking = controller.ask(MAIN, 'q1')
    expect(views.at(-1)!.status).toBe('creating')

    controller.close(MAIN)
    release()
    await asking
    await settle()

    // The side session that slipped past retirement is still discarded.
    expect(archived).toEqual([SIDE])
    const view = views.at(-1)!
    expect(view.status).toBe('idle')
    expect(view.ready).toBe(false)
  })

  it('a blank current session does not open the panel', () => {
    const sessions = {
      list: { getSnapshot: () => ({ current: 'blank' as SessionId, byId: { blank: { blank: true } } }) },
      binding: () => undefined,
    } as unknown as ISessions
    const controller = new SideChatController({
      sessions,
      workspaces: {} as IWorkspaces,
      layout: { openDetails: () => {}, closeDetails: () => {} } as unknown as ILayout,
      mountPanel: () => () => {},
    })
    controller.open(hit('x'))
    expect(controller.viewOf('blank' as SessionId).getSnapshot().quote).toBe('')
  })
})
