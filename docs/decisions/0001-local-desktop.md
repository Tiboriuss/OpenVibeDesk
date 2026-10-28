# ADR 0001: A local desktop app without a backend server

[Documentation](../README.md) · [Architecture](../architecture.md) · [Contributing](../../CONTRIBUTING.md#building-modules)

**Status:** accepted · 2026-10-27

## Context

The workspace should behave like an installed, single-user app. Mail, files and chat need to work together in independently movable desktop windows, opened from a separate dock. Requiring a dedicated server, Docker, PostgreSQL or LibreChat would add unnecessary installation and maintenance work.

## Decision

Electron supplies the main process, preload bridge and sandboxed React renderers. TypeScript defines the process boundaries and UI actions. Shared state and chat sessions live in a local SQLite file; unsent chat drafts use renderer-local storage. The user enters API keys in the settings renderer, which passes them through a typed preload method to the main process for storage in the operating system's credential store. Saved keys are not returned to the renderer.

The initial implementation uses `sql.js` so development does not depend on a native SQLite ABI. The preload exposes named methods only, and the main process validates IPC senders and inputs. See the implementation in [`electron/main.ts`](../../electron/main.ts), [`electron/preload.ts`](../../electron/preload.ts) and [`electron/store.ts`](../../electron/store.ts).

## Consequences

The app runs without a dedicated application server. External mail, AI and MCP services remain optional connections managed by the desktop app. `sql.js` loads and exports the whole database, so this initial storage model is unsuitable for a large synchronized mailbox. A persistent mail cache will require a suitable relational schema, migrations, backup handling and a storage implementation designed for that workload; native SQLite with WAL is the planned direction.

Windows, macOS and Linux have packaging targets in [`package.json`](../../package.json). macOS development has been exercised during this project. Signing, installer validation and broader platform testing remain separate release work; having a packaging target does not establish that a platform's release package has been verified.
