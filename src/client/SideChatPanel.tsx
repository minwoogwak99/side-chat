/**
 * Side-chat panel: the session-scoped `details` shadow entry. Renders the
 * quoted selection, the side conversation transcript, and a minimal composer.
 * Everything reactive arrives through the bound `useSideChat` hook (the
 * record's snapshot store); every action is an injected callback. The draft
 * is component-local state — it lives exactly as long as this mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatView } from './view.ts'
import css from './SideChatPanel.module.css'

/** Inject face supplied by the plugin's apply. */
export interface SideChatPanelInjected {
  /** Send one follow-up question (first ask carries the context). */
  ask: (question: string) => void
  /** Cancel the side session's running turn. */
  stop: () => void
  /** Close the panel and restore the stock details column. */
  close: () => void
  /** Registrant hooks compartment: the record's view source. */
  hooks: {
    sideChat: {
      getSnapshot(): SideChatView
      subscribe(fn: () => void): () => void
    }
  }
}

/** Full props: runtime share, inject face (hooks bound to useSideChat), `t` seat. */
export type SideChatPanelProps = PropsRuntime<'details'> & InjectFace<SideChatPanelInjected> & PropsLocale<'sideChat'>

/**
 * The panel surface. Auto-focuses the composer on mount so a follow-up can be
 * typed immediately after the selection click.
 */
export function SideChatPanel({ useSideChat, ask, stop, close, t }: SideChatPanelProps) {
  const view = useSideChat(s => s)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = useCallback(() => {
    const text = draft.trim()
    if (text === '' || view.status === 'creating') return
    ask(text)
    setDraft('')
  }, [ask, draft, view.status])

  const onDraftKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }, [submit])

  const sending = view.status === 'creating'
  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{t('panel.title')}</div>
        <button type="button" className={css.close} aria-label={t('panel.close')} onClick={close}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {view.quote !== '' && (
        <blockquote className={css.quote}>
          <div className={css.quoteLabel}>{t('panel.quoteLabel')}</div>
          <div className={css.quoteText}>{view.quote}</div>
        </blockquote>
      )}
      <div className={css.body} role="log" aria-live="polite">
        {view.rows.length === 0 && !view.running && (
          <div className={css.empty}>{sending ? t('panel.creating') : t('panel.empty')}</div>
        )}
        {view.rows.map((row, index) => (
          <div key={index} className={css.row} data-role={row.role} data-state={row.state}>
            <div className={row.role === 'user' ? css.bubbleUser : css.bubbleAssistant}>
              {row.text === '' && row.state === 'streaming' ? t('panel.generating') : row.text}
              {row.text !== '' && row.state === 'streaming' && (
                <span className={css.streaming}>▍</span>
              )}
            </div>
          </div>
        ))}
        {view.running && view.rows[view.rows.length - 1]?.state !== 'streaming' && (
          <div className={css.row} data-role="assistant" data-state="streaming">
            <div className={css.bubbleAssistant}>{t('panel.generating')}</div>
          </div>
        )}
        {view.error !== undefined && <div className={css.error} role="alert">{view.error}</div>}
      </div>
      <div className={css.composer}>
        <textarea
          ref={inputRef}
          className={css.input}
          rows={2}
          value={draft}
          placeholder={t('panel.inputPlaceholder')}
          disabled={sending}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={onDraftKeyDown}
          aria-label={t('panel.inputPlaceholder')}
        />
        <div className={css.controls}>
          {view.running
            ? (
              <button type="button" className={css.secondary} onClick={stop}>
                {t('panel.stop')}
              </button>
            )
            : undefined}
          <button
            type="button"
            className={css.primary}
            disabled={sending || draft.trim() === ''}
            onClick={submit}
          >
            {t('panel.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
