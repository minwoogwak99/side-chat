// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readAssistantSelection } from '../src/client/selection.ts'

// jsdom's Range carries no layout: stub the rect the browser would compute.
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({
    top: 10, left: 20, bottom: 30, right: 40, width: 20, height: 20, x: 20, y: 10, toJSON: () => ({}),
  }) as DOMRect
})

/** Build one chat flow row the way ChatNodeSeat renders it. */
function row(key: string, kind: string, text: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset.chatAnchorKey = key
  element.dataset.chatFlowKey = key
  element.dataset.chatFlowKind = kind
  element.textContent = text
  document.body.appendChild(element)
  return element
}

/** Select the full text of an element through a real Range. */
function selectAll(element: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

afterEach(() => {
  document.body.textContent = ''
  window.getSelection()?.removeAllRanges()
})

describe('readAssistantSelection', () => {
  it('reads a selection inside one assistant row', () => {
    const assistant = row('a1', 'assistant-step', 'some dense jargon explained here')
    selectAll(assistant)
    const hit = readAssistantSelection(window.getSelection())
    expect(hit).not.toBeNull()
    expect(hit?.nodeKey).toBe('a1')
    expect(hit?.text).toBe('some dense jargon explained here')
  })

  it('rejects selections in non-assistant rows', () => {
    const user = row('u1', 'user', 'my own message')
    selectAll(user)
    expect(readAssistantSelection(window.getSelection())).toBeNull()
  })

  it('rejects selections spanning two rows', () => {
    const first = row('a1', 'assistant-step', 'first part')
    const second = row('a2', 'assistant-step', 'second part')
    const range = document.createRange()
    range.setStartBefore(first.firstChild ?? first)
    range.setEndAfter(second.firstChild ?? second)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(readAssistantSelection(window.getSelection())).toBeNull()
  })

  it('rejects collapsed, missing, and blank selections', () => {
    const assistant = row('a1', 'assistant-step', 'text')
    const selection = window.getSelection()
    expect(readAssistantSelection(null)).toBeNull()
    expect(readAssistantSelection(selection)).toBeNull()
    const range = document.createRange()
    range.setStart(assistant.firstChild ?? assistant, 0)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(readAssistantSelection(selection)).toBeNull()
  })

  it('rejects selections past the hard cap', () => {
    const assistant = row('a1', 'assistant-step', 'x'.repeat(9000))
    selectAll(assistant)
    expect(readAssistantSelection(window.getSelection())).toBeNull()
  })

  it('whitespace-normalizes the carried text', () => {
    const assistant = row('a1', 'assistant-step', 'line one\n   line two\t\ttab')
    selectAll(assistant)
    expect(readAssistantSelection(window.getSelection())?.text).toBe('line one line two tab')
  })
})
