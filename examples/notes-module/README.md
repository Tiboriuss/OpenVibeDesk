# Build a notes module

[Documentation](../../docs/README.md) · [Building modules](../../CONTRIBUTING.md#building-modules) · [Architecture](../../docs/architecture.md)

This small, self-contained example needs no additional packages. It is not one of OVD's automatically loaded built-in modules.

1. Copy the entire `notes-module` directory into `<userData>/modules/`; the containing directory name is your choice. See the [module setup instructions](../../CONTRIBUTING.md#building-modules) for the user-data location.
2. Restart OVD.
3. Review and enable the **Notes** module (currently **Notizen**) under **Settings → Modules** (**Einstellungen → Module**). OVD requests approval for the local module code's fingerprint before its first execution.
4. Open **Notes** in the dock to add or search notes. The assistant can use the same functions, for example: “Save a note: Prepare the presentation for Friday.”

[`module.json`](module.json) contains metadata, contributions and tool schemas only. After approval and activation, the host loads [`backend.cjs`](backend.cjs) in a separate process and calls `activate({ moduleId, dataDirectory })`. The result supplies named handlers in `tools`; each receives `(args, { signal })`.

The backend validates inputs in addition to the manifest schema, honors cancellation, limits listed note data to 24 KiB per page, and writes updates atomically to `notes.json` in the host-provided data directory. It stores at most 500 notes of up to 2,000 characters each. Listing uses `query`, `offset` and `limit` (default 20, maximum 50), with `hasMore` and `nextOffset` for continuation. The example deliberately provides searching/reading and adding notes; it does not expose editing or deletion.

[`notes.html`](notes.html) and [`settings.html`](settings.html) run in separate isolated iframes. Their HTML, CSS and JavaScript are self-contained. The UI calls tools with `parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*')` and receives `ovd:result` with the matching `requestId`, `ok`, and either `result` or `error`. Both sides check the sender window. Module views have no direct access to the workspace API.

A separate process is not an OS sandbox. Approval is for trusted local code. The declared `storage.module-data` permission describes the example's intended access; the host supplies a dedicated data directory, but the module process still has the current user's OS permissions.

Disable the module under **Settings → Modules**. Its note data remains in the module data directory.
