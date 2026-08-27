# Side Chat for DeepSeek Harness

`dsh-plugin-side-chat` is a DeepSeek Harness Web plugin for asking follow-up questions about a selected passage without adding those questions to the main conversation.

Select text in an assistant response, choose **Ask about this**, and continue in a temporary side conversation rendered in the right-hand details column. The main conversation remains visible and unchanged.

> Compatibility: version 0.1.x targets DeepSeek Harness 0.1.1-rc.2, Cordis 4.0.1, and Node.js 22.19+ or 24+.

## Features

- Opens from a text selection inside an assistant message.
- Streams answers and reasoning in the side panel.
- Preserves the main conversation and composer while the panel is open.
- Includes the selected passage, its containing assistant message, and the four most recent transcript entries in the first side-chat prompt.
- Sends later follow-up questions as plain messages in the same side session.
- Cancels active generation when the user presses Stop, closes the panel, starts another selection, or unloads the plugin.
- Provides English and Simplified Chinese interface copy.

## Quick start for `npx` Web users

`npx @deepseek-ai/dsh web` starts the built-in `web` profile. Install Side Chat into that same profile, then start or restart Harness.

The current `dsh plugin` command delegates package management to `pnpm`, so `pnpm` must be available on `PATH` even when the Harness CLI is invoked through `npx`:

```bash
npm install --global pnpm
```

Each DSH profile is a one-package pnpm workspace. Pass `-w` to explicitly target that workspace root and avoid `ERR_PNPM_ADDING_TO_ROOT` on pnpm versions that enforce the root-add safeguard.

Install the npm release:

```bash
npx @deepseek-ai/dsh plugin --profile web add -w dsh-plugin-side-chat
npx @deepseek-ai/dsh web
```

Install a pinned GitHub revision before or instead of an npm release:

```bash
npx @deepseek-ai/dsh plugin --profile web add -w \
  github:minwoogwak99/side-chat#<tag-or-commit>
npx @deepseek-ai/dsh web
```

One-off `npx` execution does not make the plugin installation temporary. Harness stores the profile and its plugin dependencies under `$DSH_HOME/profiles/web` (`~/.dsh/profiles/web` by default), and later `npx @deepseek-ai/dsh web` invocations reuse them.

This release is tested with `@deepseek-ai/dsh@0.1.1-rc.2`. Harness is in developer preview, so pin the same CLI version for reproducible installation and startup:

```bash
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add -w dsh-plugin-side-chat
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

Update or remove the npm package with the same profile:

```bash
npx @deepseek-ai/dsh plugin --profile web update -w dsh-plugin-side-chat@latest
npx @deepseek-ai/dsh plugin --profile web remove -w dsh-plugin-side-chat
```

Restart the Web process after installing, updating, or removing the plugin so Harness rebuilds the Browser client-module graph.

## Install into another profile

Any profile that includes the Harness Web application can host Side Chat:

```bash
npx @deepseek-ai/dsh plugin --profile <profile> add -w dsh-plugin-side-chat
```

For a local checkout during development:

```bash
npx @deepseek-ai/dsh plugin --profile <profile> add -w /absolute/path/to/side-chat
```

If `dsh` is already installed on `PATH`, omit the `npx @deepseek-ai/dsh` prefix. When working from the DeepSeek Harness source repository, the equivalent command is `pnpm dsh plugin --profile <profile> add -w <package-spec>`.

No install-time build is required. The repository and npm package include prebuilt `lib/index.js` and `lib/client.js` artifacts, so GitHub installs do not need a `prepare` script or pnpm `allowBuilds` configuration.

## Usage

1. Drag-select a passage inside an assistant message.
2. Select **Ask about this** above the selection.
3. Ask a question in the right-hand panel. The answer streams as it is generated, and reasoning appears in a collapsible **Think** row.
4. Continue with follow-up questions, press Stop to cancel only the current answer, or close the panel to retire the side conversation.

## Architecture

The package is one Harness bundle with an empty Host entry and a Browser client entry:

```text
side-chat/
  package.json                    Bundle and Browser-client manifests
  cordis.patch.yml                Host Loader row
  src/index.ts                    Empty Host plugin entry
  src/client/index.ts             Slot registration and composition
  src/client/controller.ts        Side-session lifecycle and streaming
  src/client/selection.ts         Assistant-message selection validation
  src/client/context.ts           Bounded first-prompt assembly
  src/client/view.ts              Conversation snapshot projection
  src/client/*.tsx                Launcher and side-panel UI
  lib/index.js                    Prebuilt Host ESM bundle
  lib/client.js                   Prebuilt Harness Browser module
```

The Browser plugin registers two entries:

| Slot | ID/priority | Purpose |
| --- | ---: | --- |
| `shell.overlay` | `side-chat-launcher`, order `100` | Watches assistant-message selections and renders the launcher near the selection. |
| `details` | dynamic, priority `-100` | Temporarily replaces the stock details panel while Side Chat is open. |

The launcher accepts a selection only when both endpoints are inside the same assistant row identified by `[data-chat-flow-kind="assistant-step"]`. Opening Side Chat creates a controller record for the active main session and dynamically registers the `details` entry. Closing it disposes that entry, restoring the stock details panel.

The UI uses Harness primitives, CSS Modules, `--dsw-*` semantic tokens, keyboard focus styles, and reduced-motion behavior. The Browser artifact uses Harness's required `window.__ModuleLoader__.load({ id, factory })` wrapper and leaves only Web platform module-table packages external.

## Side-session lifecycle and data

The first question connects to the main session's workspace, creates a blank side session, archives it immediately so it does not appear in normal sidebar/history groupings, and sends a bounded context prompt containing:

- the selected passage;
- the complete assistant message containing that passage;
- the four most recent main-conversation transcript entries, clipped to the prompt limits; and
- the user's question.

The assembled context prompt is not shown as the user bubble in the Side Chat panel. Later questions are sent as plain text to the same side session.

Closing the panel cancels active generation and drops the Browser controller record, but it does not physically delete the archived Harness session. DeepSeek Harness currently exposes archive behavior rather than a session-delete API, so retired side sessions can remain in the Host session registry.

Side Chat has no plugin-owned Host database, settings document, credentials, or external network endpoint. Model requests and session persistence use the active Harness services.

## Development

A clean clone uses published Harness type declarations and does not require a sibling DeepSeek Harness checkout, `DSH_HARNESS_ROOT`, or generated local symlinks.

```bash
git clone https://github.com/minwoogwak99/side-chat.git
cd side-chat
npm ci
npm run verify
```

`npm run verify` performs type checking, all unit tests, and both production bundles. After changing source files, commit the regenerated `lib/index.js` and `lib/client.js`; pinned GitHub installation depends on those prebuilt artifacts.

## Publishing

Before publishing a release:

1. Run `npm ci` and `npm run verify`.
2. Confirm that the regenerated `lib/` artifacts are committed.
3. Run `npm pack --dry-run --ignore-scripts` and inspect the file list.
4. Install the tarball with `add -w` into a temporary `$DSH_HOME` Web profile with the pinned npx CLI.
5. Verify the generated Cordis configuration and `/plugins/dsh-plugin-side-chat/client.js` response.
6. Publish with `npm publish --access public`, or tag the prebuilt GitHub revision.

Record the exact Harness version tested by each release because developer-preview releases can introduce compatibility changes.

## Troubleshooting and limitations

- If the Host row loads but the Browser entry does not, confirm the `dsh.client` manifest, `exports["./client"]`, prebuilt `lib/client.js`, and a full Web restart.
- Side Chat intentionally shadows the stock details panel while open. Closing Side Chat restores the stock entry and closes the details column.
- If selection no longer opens the launcher, check whether the Harness conversation UI still applies `[data-chat-flow-kind="assistant-step"]` to assistant rows.
- A `session window open() unavailable` error means the installed Harness runtime no longer exposes the internal `Session.open()` seam used to stream without staging. Revalidate `SideChatController.#openSideWindow` against the target Harness release.
- Retired side sessions are archived, not physically deleted.

## References

- [DeepSeek Harness Quick Start](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart)
- [Package and install a plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- [Your first Harness plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- [DeepSeek Harness architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)
- [DeepSeek Harness source repository](https://github.com/deepseek-ai/deepseek-harness)

## License

[MIT](LICENSE)
