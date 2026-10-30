# Build a notes module

[Documentation](../../docs/README.md) · [Building modules](../../CONTRIBUTING.md#building-modules) · [Repository distribution](../../docs/module-repositories.md) · [Architecture](../../docs/architecture.md)

This small, self-contained example needs no additional packages. It is not one of OVD's automatically loaded built-in modules.

## Try it

For installation through the app, add the [OpenVibeDesk Modules catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) and select **Notes** (currently **Notizen**). Follow the [repository setup guide](../../docs/module-repositories.md#configure-a-source). The catalog contains a separately published copy; this directory is the local authoring example.

For local development:

1. Copy the entire `notes-module` directory into `<userData>/modules/`; the containing directory name is your choice. See the [module setup instructions](../../CONTRIBUTING.md#building-modules) for the user-data location.
2. Restart OVD.
3. Review and enable the **Notes** module (currently **Notizen**) under **Settings → Modules** (**Einstellungen → Module**). OVD requests approval for the local module code's fingerprint before its first execution.
4. Open **Notes** in the dock to add or search notes. The assistant can use the same functions, for example: “Save a note: Prepare the presentation for Friday.”

Both copies use the ID `sample-notes`. Use one installation method per profile: a repository package cannot overwrite a manually installed module with the same ID.

## How it works

[`module.json`](module.json) contains metadata, contributions and tool schemas only. After approval and activation, the host loads [`backend.cjs`](backend.cjs) in a separate process and calls `activate({ moduleId, dataDirectory })`. The result supplies named handlers in `tools`; each receives `(args, { signal })`.

The backend validates inputs in addition to the manifest schema, honors cancellation, limits listed note data to 24 KiB per page, and writes updates atomically to `notes.json` in the host-provided data directory. It stores at most 500 notes of up to 2,000 characters each. Listing uses `query`, `offset` and `limit` (default 20, maximum 50), with `hasMore` and `nextOffset` for continuation. The example deliberately provides searching/reading and adding notes; it does not expose editing or deletion.

[`notes.html`](notes.html) and [`settings.html`](settings.html) run in separate isolated iframes. Their HTML, CSS and JavaScript are self-contained. The UI calls tools with `parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*')` and receives `ovd:result` with the matching `requestId`, `ok`, and either `result` or `error`. Both sides check the sender window. Module views have no direct access to the workspace API.

A separate process is not an OS sandbox. Approval is for trusted local code. The declared `storage.module-data` permission describes the example's intended access; the host supplies a dedicated data directory, but the module process still has the current user's OS permissions.

Disable the module under **Settings → Modules**. Its note data remains in the module data directory.

## Adapt and publish it

Choose your own module ID and rename the `sample-notes.*` tool names consistently in the manifest, backend and UI. Keep the ID stable after release so existing data remains associated with the module. Add the functions your users need to both the interface and Assistant through the shared tool contract.

From the OVD checkout, after installing its development dependencies:

```sh
pnpm build
node scripts/prepare-module-repository.cjs examples/notes-module /path/to/your-module-catalog
```

For a customized module, replace the example path with its prebuilt folder. The helper generates an immutable version directory and a catalog listing; it does not publish to Git or execute the module. Exercise the installed package through its window and the Assistant in a separate profile before publishing. Increment the manifest version for every update, including documentation changes shipped inside the package. See [publishing a module](../../docs/module-repositories.md#publish-a-module) for private catalogs, hashes, compatibility and update behavior.

This example covers basic tools, a view, settings and persistence. It does not implement chat references or durable operation reconciliation. For those extensions, follow the [full module contract](../../CONTRIBUTING.md#building-modules) and the [Skill Library example](https://github.com/Tiboriuss/OpenVibeDesk-Modules/tree/main/modules/skill-library).
