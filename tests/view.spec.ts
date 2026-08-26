import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { deriveSideView } from '../src/client/view.ts'

/** Minimal snapshot carrying the fields deriveSideView reads. */
function sideSnapshot(parts: {
  order?: readonly string[]
  get?: (key: string) => unknown
  running?: boolean
  promptError?: ConversationSnapshot['promptError']
}): ConversationSnapshot {
  return {
    running: parts.running ?? false,
    promptError: parts.promptError ?? null,
    chat: {
      order: parts.order ?? [],
      nodes: { get: parts.get ?? (() => undefined), values: () => [] },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
    },
  } as unknown as ConversationSnapshot
}

describe('deriveSideView', () => {
  it('derives an idle unbound view before the side session exists', () => {
    const view = deriveSideView(undefined, 'the quote', { status: 'idle' })
    expect(view).toEqual({
      status: 'idle',
      error: undefined,
      quote: 'the quote',
      ready: false,
      running: false,
      rows: [],
    })
  })

  it('shows the typed first question instead of the assembled prompt row', () => {
    const snapshot = sideSnapshot({
      order: ['u1', 'a1', 'u2'],
      get: (key) => {
        if (key === 'u1') {
          // The wire's first user message is the assembled context prompt.
          return {
            key,
            kind: 'user',
            data: { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'You are answering in a side conversation… <question>\nwhat?\n</question>' }], source: {} },
          }
        }
        if (key === 'a1') {
          return {
            key,
            kind: 'assistant-step',
            data: { status: 'settled', turn: 1, step: 1, time: 0, blocks: [{ kind: 'text', text: 'answer one' }] },
          }
        }
        return {
          key,
          kind: 'user',
          data: { kind: 'user', seq: 3, time: 0, content: [{ type: 'text', text: 'second question' }], source: {} },
        }
      },
    })
    const view = deriveSideView(snapshot, 'q', { status: 'idle', firstQuestion: 'what?' })
    // First user row renders the typed question; later user rows pass through.
    expect(view.rows).toEqual([
      { role: 'user', text: 'what?', state: 'final' },
      { role: 'assistant', text: 'answer one', state: 'final' },
      { role: 'user', text: 'second question', state: 'final' },
    ])
  })

  it('folds user and assistant rows with the streaming state', () => {
    const snapshot = sideSnapshot({
      order: ['u1', 'a1', 'a2'],
      get: (key) => {
        if (key === 'u1') {
          return {
            key,
            kind: 'user',
            data: { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'question one' }], source: {} },
          }
        }
        if (key === 'a1') {
          return {
            key,
            kind: 'assistant-step',
            data: { status: 'settled', turn: 1, step: 1, time: 0, blocks: [{ kind: 'text', text: 'settled answer' }] },
          }
        }
        return {
          key,
          kind: 'assistant-step',
          data: { status: 'running', turn: 2, step: 1, time: 0, blocks: [{ kind: 'text', text: 'partial' }] },
        }
      },
      running: true,
    })
    const view = deriveSideView(snapshot, 'q', { status: 'idle' })
    expect(view.ready).toBe(true)
    expect(view.running).toBe(true)
    expect(view.rows).toEqual([
      { role: 'user', text: 'question one', state: 'final' },
      { role: 'assistant', text: 'settled answer', state: 'final' },
      { role: 'assistant', text: 'partial', state: 'streaming' },
    ])
  })

  it('keeps a running text-less assistant step as a streaming row', () => {
    const snapshot = sideSnapshot({
      order: ['a1'],
      get: () => ({
        key: 'a1',
        kind: 'assistant-step',
        data: { status: 'running', turn: 1, step: 1, time: 0, blocks: [] },
      }),
      running: true,
    })
    expect(deriveSideView(snapshot, 'q', { status: 'idle' }).rows).toEqual([
      { role: 'assistant', text: '', state: 'streaming' },
    ])
  })

  it('clips the displayed quote with a marker', () => {
    const view = deriveSideView(undefined, 'x'.repeat(1000), { status: 'idle' })
    expect(view.quote.length).toBe(401)
    expect(view.quote.endsWith('…')).toBe(true)
  })

  it('folds record errors over snapshot prompt errors, record first', () => {
    const sendError = deriveSideView(undefined, 'q', { status: 'error', error: 'boom' })
    expect(sendError.error).toBe('boom')
    const promptError = deriveSideView(
      sideSnapshot({ promptError: { op: 'send', error: { code: 'model-unavailable', message: 'no route', details: {} } } }),
      'q',
      { status: 'idle' },
    )
    expect(promptError.error).toBe('model-unavailable: no route')
  })
})
