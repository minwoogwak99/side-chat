/**
 * Side-chat plugin, browser half.
 *
 * Two registrations:
 *
 * - `shell.overlay` (additive list entry, root scope): the selection launcher
 *   that floats an "Ask about this" button over an assistant-message
 *   selection. Always mounted; costs nothing while no selection exists.
 * - `details` (single slot, session scope, priority -100): the side-chat
 *   panel, registered on demand while a side chat is open. The negative
 *   priority shadows the stock DetailsPanel (priority 0) for the column's
 *   render without disturbing its Cordis lifecycle; disposing the entry
 *   restores it.
 *
 * Session creation and prompt plumbing live in the controller; components
 * receive data and actions through the four props shares only.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { SideChatController } from './controller.ts'
import { SelectionLauncher } from './SelectionLauncher.tsx'
import type { SelectionLauncherInjected } from './SelectionLauncher.tsx'
import { SideChatPanel } from './SideChatPanel.tsx'
import type { SideChatPanelInjected } from './SideChatPanel.tsx'
import { dictionaries, NS } from './locales.ts'
import type { SideChatKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The side-chat launcher and panel copy. */
    sideChat: SideChatKey
  }
}

/** Required services: slot registry, panel geometry, session/workspace faces, and copy. */
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale']

/**
 * Client plugin body: dictionaries, the resident launcher, and the
 * controller owning the on-demand panel entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'side-chat: dictionaries')

  const controller = new SideChatController({
    sessions: ctx.sessions,
    workspaces: ctx.workspaces,
    layout: ctx.layout,
    mountPanel: () => ctx.slots.inject('details', () => ctx.slots.register({
      name: 'details',
      // Below the stock DetailsPanel's default 0: the lowest live entry
      // renders, so the side chat takes the column while mounted and the
      // stock panel returns when this entry is disposed.
      priority: -100,
      locale: NS,
      inject: (sessionId: SessionId): SideChatPanelInjected => ({
        ask: (question) => { void controller.ask(sessionId, question) },
        stop: () => { controller.stop(sessionId) },
        close: () => { controller.close(sessionId) },
        hooks: { sideChat: controller.viewOf(sessionId) },
      }),
    }, SideChatPanel)),
  })

  ctx.effect(() => {
    const dispose = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'side-chat-launcher',
      order: 100,
      locale: NS,
      inject: (): SelectionLauncherInjected => ({
        openSelection: (hit) => { controller.open(hit) },
      }),
    }, SelectionLauncher))
    return () => {
      dispose()
      controller.dispose()
    }
  }, 'side-chat: launcher + controller')
}
