# dsh-plugin-side-chat

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web-client
plugin: **ask follow-up questions about any passage of an AI answer without
polluting your main chat history.**

Select a word or sentence in an assistant message → an **Ask about this**
button pops up → a side-chat panel opens in the right-hand details column
(your existing chat stays visible) → ask away. Answers stream token by token,
just like the main conversation.

The side conversation runs in its own throwaway session:

- **Hidden** — the session never appears in the sidebar or history. It is
  archived the moment it is created.
- **One-shot** — closing the panel (or starting a new selection) cancels any
  running turn and discards the thread. Nothing accumulates.
- **Context-aware** — the first question carries the selected passage, the
  full assistant message it came from, and the last 12 turns of the main
  chat, so the model answers with full context. Follow-up questions are
  plain messages in the same thread.

## Requirements

- A [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
  checkout with the `dsh` CLI runnable from it.
- A profile that serves the web app (e.g. the default `web` profile, or your
  own combination of `dsh-base` + `dsh-web-app`).

## Install

From GitHub, into a profile of your choice:

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-side-chat -w
```

Notes:

- `-w` is required: the profile directory is a pnpm workspace root, and pnpm
  refuses root installs without it (the `dsh plugin` command forwards to
  pnpm).
- No build step runs on install — `lib/` build artifacts are committed to the
  repository, so git installs work with no `prepare` script and no
  `allowBuilds` configuration.
- Restart the `dsh` server after installing: the client-module graph caches
  package manifests at startup.

Verify it loaded: open the web UI and check
`/plugins/dsh-plugin-side-chat/client.js` returns 200, or inspect
`window.__DSH_BOOT__.entries` for the `dsh-plugin-side-chat` row.

### Uninstall

```sh
dsh plugin --profile web remove dsh-plugin-side-chat
```

### Install from a local checkout (development)

```sh
dsh plugin --profile web add /path/to/dsh-plugin-side-chat -w
```

## Usage

1. Drag-select a passage inside an **assistant** message in the chat.
2. Click the **Ask about this** button that appears above the selection.
3. Ask a question in the side panel; the answer streams live.
4. Keep asking follow-ups, or close the panel — the thread is discarded.

Stop cancels the running answer but keeps the thread open for more
questions.

## How it works

- A `shell.overlay` slot entry watches the document selection. A selection
  counts only when both endpoints sit inside the same assistant row
  (`[data-chat-flow-kind="assistant-step"]` — the ui-conversation DOM
  contract).
- Clicking the button mounts a `details` slot entry at `priority: -100`,
  shadowing the stock DetailsPanel for the panel's lifetime, and opens the
  details column. The main conversation column is never covered.
- The first ask creates a blank session in the main session's workspace
  (`workspaces.connectWorkspace`), immediately archives it (hidden from every
  grouping surface), opens its conversation window without staging it, and
  sends one context-bearing prompt:
  `<selected_passage>`, `<containing_assistant_message>`,
  `<recent_conversation>` (last 12 turns, each clipped), `<question>`.
- Later asks are plain messages into the same session; the panel subscribes
  to the session snapshot and republishes per frame, so partial assistant
  text renders while streaming.
- Close (or a new selection, or plugin unload) bumps an epoch, cancels the
  running turn, and resets the record; a session created mid-close is
  discarded when it arrives.

## Build from source

Type-checking resolves `@deepseek-ai/*` packages from a harness checkout:
either a sibling `../deepseek-harness` directory or an explicit
`DSH_HARNESS_ROOT`.

```sh
pnpm install
pnpm run build   # typecheck + tsdown → lib/index.js, lib/client.js
pnpm test
```

**After changing sources, run the build and commit the updated `lib/`** —
the install-from-git contract above depends on committed artifacts.

## Debugging

- Host row present but nothing in the browser? Check `package.json`
  `dsh.client` (platform/inject), the `exports["./client"]` → `lib/client.js`
  artifact, and that the server was restarted.
- The tool-details panel disappearing while the side chat is open is the
  intended shadow behavior; it restores on close. Closing the side chat also
  closes the details column (no public read of the layout state exists, so
  close is unconditional).
- Discarded side sessions stay archived in the host session registry — the
  harness has no session-delete API; archiving hides them from all
  grouping surfaces.
- A `session window open() unavailable` error means the harness runtime
  dropped the internal `Session.open()` this plugin uses to stream without
  staging; re-check
  `packages/client/runtime/src/client/sessions/session.ts` and adapt
  `#openSideWindow` in `src/client/controller.ts`.

## License

[MIT](LICENSE)
