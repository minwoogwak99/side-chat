/**
 * Context assembly for the side chat's first prompt. Pure functions over the
 * main conversation snapshot: extract a plain user/assistant transcript, then
 * render the first side-chat message that carries the selected passage, the
 * containing assistant message, and a bounded recent transcript alongside the
 * user's question. All caps keep the injected context bounded regardless of
 * how long the source conversation grew.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistantChatData, ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Cap for the quoted selection inside the prompt. */
const QUOTE_MAX_CHARS = 4000
/** Cap for the containing assistant message inside the prompt. */
const MESSAGE_MAX_CHARS = 4000
/** Cap for one transcript entry inside the prompt. */
const ENTRY_MAX_CHARS = 1500
/** Number of trailing transcript entries the prompt carries (≈2 exchanges). */
const TRANSCRIPT_ENTRIES = 4
/** Marker appended to a clipped section. */
const CLIPPED = '\n…[clipped]'

/** One flattened dialogue turn for prompt context. */
export interface TranscriptEntry {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** Read a chat node's (role, text) pair, or null for kinds the transcript skips. */
function entryOfNode(node: ChatNode): TranscriptEntry | null {
  switch (node.kind) {
    case 'user':
    case 'steering':
      return {
        role: 'user',
        text: node.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n'),
      }
    case 'assistant-step':
      return {
        role: 'assistant',
        text: (node.data as AssistantChatData).blocks
          .flatMap(block => block.kind === 'text' ? [block.text] : [])
          .join('\n\n'),
      }
    default:
      return null
  }
}

/**
 * Flatten a conversation snapshot into a user/assistant text transcript in
 * flow order. Tool calls, commands, retries, and injected context rows are
 * skipped — the prompt needs the dialogue, not the machinery.
 * @param snapshot - main conversation snapshot (event-window projection).
 * @returns entries with non-empty text.
 */
export function extractTranscript(snapshot: ConversationSnapshot): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key) as ChatNode | undefined
    if (node === undefined) continue
    const entry = entryOfNode(node)
    if (entry === null || entry.text.trim() === '') continue
    entries.push({ role: entry.role, text: entry.text.trim() })
  }
  return entries
}

/**
 * Read the full text of one assistant message by its chat node key.
 *
 * @param snapshot - main conversation snapshot.
 * @param nodeKey - the `data-chat-anchor-key` the selection was made in.
 * @returns the message's text blocks joined, or undefined when the key names
 *   no assistant node or carries no text.
 */
export function assistantMessageText(snapshot: ConversationSnapshot, nodeKey: string): string | undefined {
  const node = snapshot.chat.nodes.get(nodeKey) as ChatNode | undefined
  if (node === undefined || node.kind !== 'assistant-step') return undefined
  const text = (node.data as AssistantChatData).blocks
    .flatMap(block => block.kind === 'text' ? [block.text] : [])
    .join('\n\n')
    .trim()
  return text === '' ? undefined : text
}

/** Clip one section to its cap, appending the clipped marker when it fires. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}${CLIPPED}`
}

/** Inputs of {@link buildSideChatPrompt}; every optional section may be empty. */
export interface SideChatPromptInput {
  /** The user's follow-up question (required, verbatim). */
  readonly question: string
  /** The selected passage (required). */
  readonly quote: string
  /** Full text of the assistant message containing the selection, when known. */
  readonly containingMessage?: string | undefined
  /** Recent main-conversation transcript, oldest first. */
  readonly transcript: readonly TranscriptEntry[]
}

/**
 * Render the side chat's first user message. The wrapper copy is model-facing
 * English and pinned verbatim: it frames the side conversation so the model
 * answers the question from the passage and context instead of re-deriving
 * the whole original task.
 *
 * @param input - question, quote, optional containing message and transcript.
 * @returns the complete first-prompt text.
 */
export function buildSideChatPrompt(input: SideChatPromptInput): string {
  const sections: string[] = []
  sections.push(
    'You are answering in a side conversation. The user selected a passage inside one assistant message of another conversation and asks a follow-up question about it. '
    + 'Answer the question using the passage and the conversation context below; keep the answer self-contained.',
  )
  sections.push(`<selected_passage>\n${clip(input.quote, QUOTE_MAX_CHARS)}\n</selected_passage>`)
  if (input.containingMessage !== undefined && input.containingMessage.trim() !== '') {
    sections.push(
      `<containing_assistant_message>\n${clip(input.containingMessage, MESSAGE_MAX_CHARS)}\n</containing_assistant_message>`,
    )
  }
  if (input.transcript.length > 0) {
    const tail = input.transcript.slice(-TRANSCRIPT_ENTRIES)
    const lines = tail.map(entry => `[${entry.role}]: ${clip(entry.text, ENTRY_MAX_CHARS)}`)
    sections.push(`<recent_conversation>\n${lines.join('\n')}\n</recent_conversation>`)
  }
  sections.push(`<question>\n${input.question}\n</question>`)
  return sections.join('\n\n')
}
