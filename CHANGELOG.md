# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  controller state machine (26 tests).
