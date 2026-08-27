# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-08-27

### Fixed

- Installation, update, removal, and packed-artifact verification now pass
  pnpm's explicit workspace-root flag through `dsh plugin`, avoiding
  `ERR_PNPM_ADDING_TO_ROOT` in DSH profiles.

## [0.1.1] - 2026-08-26

### Added

- Model reasoning now renders in the panel as the main chat's collapsible
  **Think** disclosure (same `DisclosureRow` chrome and summary/body
  contract as `ReasoningRow`): one-line streaming summary while thinking,
  click to expand the full reasoning text.
- Public package metadata, an npx-first Web installation guide, and CI that
  installs the packed artifact into an isolated Harness `web` profile.

### Changed

- The first prompt's `<recent_conversation>` section now carries the last 4
  transcript entries (about two exchanges, ≤6,000 chars) instead of the
  last 12 — the selected passage and its containing message remain the
  primary context.
- The panel's first user row now displays the typed question instead of the
  assembled context prompt sent on the wire — internal framing stays out of
  the chat transcript.
- Panel transcript styling mirrors the main chat design contracts: user
  bubbles use the DeepSeek bubble fill (22px radius, 16/24 type, right
  aligned, 82% width cap), assistant messages render as plain full-width
  16/28 text without a bubble, rows follow the main chat's 16px rhythm.
- Clean-clone development now resolves published Harness declarations from
  the package lock instead of linking a machine-local Harness checkout.
- The panel view uses a plugin-local observable snapshot, removing the last
  runtime test alias to Harness source files.

### Verified

- Follow-up questions (after the first answer) are sent as the typed text
  only — the context prompt is assembled once, on the first message.

## [0.1.0] - 2026-08-25

### Added

- Selection launcher: drag-select a passage inside an assistant message and
  click the **Ask about this** popup button to open the side-chat panel.
- Side-chat panel in the right-hand details column (`details` slot shadow
  entry at `priority: -100`); the main conversation stays visible.
- One-shot hidden side sessions: created in the main session's workspace,
  archived at creation (never listed in the sidebar/history), canceled and
  discarded on close or new selection.
- Context-bearing first prompt: selected passage, containing assistant
  message, and the last 12 turns of the main conversation.
- Live streaming of side-chat answers, including follow-up questions.
- Stop (cancel the running answer, keep the thread) and Close (discard the
  thread) controls.
- Chinese and English UI dictionaries (`sideChat` namespace).
- Unit tests for context assembly, selection reading, view folding, and the
  controller state machine (29 tests).
