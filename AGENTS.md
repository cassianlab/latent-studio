# Latent Studio Agent Rules

## Scope

This repository is the macOS local-first Latent Studio application. Read `docs/Latent Studio 升级方案.md` before changing product behavior. Keep the legacy image-generation and canvas repositories read-only when using them as references.

## Active Work

- Follow the staged dependencies in `tasks/`; the current production milestone is `tasks/phase-2-foundation.md`.
- Preserve approved prototype behavior while replacing one explicit mock boundary at a time.
- Record hard-to-reverse process, storage, or security decisions in `adr/`.

## Process Boundaries

- Electron main owns filesystem access, SQLite, credentials, model calls, queues, Skills, and subprocesses.
- Preload exposes narrow typed business commands and events.
- Renderer owns presentation and transient UI state. It never receives API keys, raw database handles, Node.js access, or generic filesystem/command primitives.

## Product And UI

- Ship a desktop application, not a browser product. Browser preview exists only for isolated UI development.
- Preserve the Simplified Chinese interface and warm-white / near-black / restrained-red design tokens.
- Keep unfinished model, search, task, and Skill behavior visibly marked as simulated.
- After UI changes, validate 1024x720, 1440x900, and a wide desktop in light and dark themes.

## Code And Verification

- Organize code by business capability and expose one clear entry from each capability directory.
- Keep manually maintained code files below 1000 lines; React pages should normally stay below 500 lines.
- Test observable behavior. For bug fixes, add a failing reproduction before the fix.
- Run TypeScript, unit tests, the file-size check, and the production build before closing a task.

## Local Task Convention

Tasks live in `tasks/*.md` with checkboxes, acceptance criteria, dependencies, and verification evidence. Close a task only after the recorded checks pass.
