import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantMessageText, buildSideChatPrompt, extractTranscript } from '../src/client/context.ts'

/** Minimal chat store over a node list (the reader touches order + get only). */
function snapshotOf(nodes: readonly { key: string; kind: string; data: unknown }[]): ConversationSnapshot {
  return {
    chat: {
      order: nodes.map(node => node.key),
      nodes: {
        get: (key: string) => nodes.find(node => node.key === key),
        values: () => [],
      },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
    },
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

const TOOL_NODE = (key: string) => ({
  key,
  kind: 'command',
  data: { node: {} },
})

describe('extractTranscript', () => {
  it('flattens user and assistant rows in flow order and skips machinery kinds', () => {
    const snapshot = snapshotOf([
      USER('u1', 'first question'),
      TOOL_NODE('c1'),
      ASSISTANT('a1', 'first answer'),
      USER('u2', 'second question'),
      ASSISTANT('a2', 'second answer'),
    ])
    expect(extractTranscript(snapshot)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'first answer' },
      { role: 'user', text: 'second question' },
      { role: 'assistant', text: 'second answer' },
    ])
  })

  it('skips empty-text entries', () => {
    const snapshot = snapshotOf([USER('u1', '  '), ASSISTANT('a1', '')])
    expect(extractTranscript(snapshot)).toEqual([])
  })

  it('keeps only text blocks of an assistant message', () => {
    const snapshot = snapshotOf([{
      key: 'a1',
      kind: 'assistant-step',
      data: {
        status: 'settled',
        turn: 1,
        step: 1,
        time: 0,
        blocks: [
          { kind: 'reasoning', text: 'hidden reasoning' },
          { kind: 'text', text: 'visible one' },
          { kind: 'text', text: 'visible two' },
          { kind: 'tool-call', callId: 'x', name: 'bash', argsRaw: '{}' },
        ],
      },
    }])
    expect(extractTranscript(snapshot)).toEqual([
      { role: 'assistant', text: 'visible one\n\nvisible two' },
    ])
  })
})

describe('assistantMessageText', () => {
  it('returns the joined text of the named assistant node', () => {
    const snapshot = snapshotOf([USER('u1', 'q'), ASSISTANT('a1', 'the message')])
    expect(assistantMessageText(snapshot, 'a1')).toBe('the message')
  })

  it('returns undefined for unknown keys and non-assistant kinds', () => {
    const snapshot = snapshotOf([USER('u1', 'q'), ASSISTANT('a1', 'x')])
    expect(assistantMessageText(snapshot, 'missing')).toBeUndefined()
    expect(assistantMessageText(snapshot, 'u1')).toBeUndefined()
  })
})

describe('buildSideChatPrompt', () => {
  const base = {
    question: 'what does this term mean?',
    quote: 'the selected passage',
    transcript: [{ role: 'user' as const, text: 'earlier' }],
  }

  it('carries the question and the passage with the framing copy', () => {
    const prompt = buildSideChatPrompt(base)
    expect(prompt).toContain('side conversation')
    expect(prompt).toContain('<selected_passage>\nthe selected passage\n</selected_passage>')
    expect(prompt).toContain('<question>\nwhat does this term mean?\n</question>')
    expect(prompt).toContain('[user]: earlier')
  })

  it('includes the containing message section only when provided non-blank', () => {
    expect(buildSideChatPrompt(base)).not.toContain('containing_assistant_message')
    const prompt = buildSideChatPrompt({ ...base, containingMessage: 'the whole message' })
    expect(prompt).toContain('<containing_assistant_message>\nthe whole message\n</containing_assistant_message>')
    expect(buildSideChatPrompt({ ...base, containingMessage: '   ' })).not.toContain('containing_assistant_message')
  })

  it('caps each section and the transcript tail', () => {
    const prompt = buildSideChatPrompt({
      question: 'q',
      quote: 'x'.repeat(5000),
      containingMessage: 'y'.repeat(5000),
      transcript: Array.from({ length: 20 }, (_, i) => ({
        role: 'user' as const,
        text: `entry ${i} ${'z'.repeat(2000)}`,
      })),
    })
    expect(prompt).toContain('…[clipped]')
    // 20 entries, only the last 12 ride along.
    expect(prompt).toContain('[user]: entry 8')
    expect(prompt).not.toContain('[user]: entry 7 ')
    // The huge sections were clipped well below their raw lengths.
    expect(prompt.length).toBeLessThan(30000)
  })
})
