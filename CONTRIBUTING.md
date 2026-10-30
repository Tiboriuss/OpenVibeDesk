# Contributing

[Repository overview](README.md) · [Documentation](docs/README.md) · [Repository working rules](AGENTS.md)

OpenVibeDesk is an early project. Issues and pull requests are welcome; explain the goal and proposed approach before making a substantial change.

Keep repository documentation in **English**, distinguish implemented behavior from design targets, and update links when headings or paths change. Visible names, logos, colors, and interfaces follow the [brand guide](docs/brand.md). Use the 20 supplied `ovd-*.svg` masters in [assets/brand](assets/brand/) without redrawing the pupils, upper V, separate violet triangle, or outlined wordmark. [Design tokens](assets/brand/source/tokens.json) are the canonical values; bundle Manrope with its [SIL OFL license](assets/brand/fonts/OFL.txt).

## Development

Install Node.js 22.13 or newer and pnpm 11.25.0. The [getting-started guide](docs/getting-started.md) covers installation and first-run setup. From the repository directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development command builds once and opens Electron. Restart it after source changes. Relevant commands are declared in [package.json](package.json):

| Command | Use |
| --- | --- |
| `pnpm typecheck` | Check TypeScript in the main process and renderer. |
| `pnpm build` | Compile the application. |
| `pnpm test` | Run the existing focused tests when relevant. |
| `pnpm pack:mac` | Produce a macOS DMG in `release/`. |
| `pnpm pack:win` | Produce a Windows NSIS installer in `release/`. |
| `pnpm pack:linux` | Produce a Linux AppImage in `release/`. |

Validate the affected workflow in the app first. Describe the behavior before and after the change and how you checked it. macOS development has been exercised in practice; further platform and installer checks remain. Packaging scripts alone do not establish that every target can be built or run on every host.

Do not add routine test suites or push/PR test workflows. The user-authorized [release installer workflow](docs/releases.md) is the exception: it packages macOS/Windows installers without trusted publisher certificates for published releases and supports an explicit manual validation build. Use focused existing tests or temporary checks when they establish something necessary. For application changes, check both the interface and assistant path through the shared capabilities. Documentation changes should be checked for correct commands, links, and consistency with the code.

Do not commit user data, API keys, `.env` files, databases, or generated application build outputs. Use synthetic data and temporary test credentials; never send real mail or modify a real mailbox to validate a change. Preserve Electron's process boundaries: no renderer Node integration and no unrestricted IPC bridge. See the [architecture](docs/architecture.md).

## Building modules

The OVD Assistant is the required `ovd-assistant` module. Domain modules register through a manifest; the chat must not need module-specific prompts or hardcoded tool catalogs. A company module can own its windows, settings, domain functions and chat references without changing OVD core.

Choose the extension path that matches the work:

| Need | Extension path |
| --- | --- |
| Install or update an existing module | Add a source under **Settings → Modules**; follow [module repositories](docs/module-repositories.md). |
| Build a company integration with its own interface | Create a standalone **process module** using the contract below. Distribute its prebuilt files through a public/private catalog or copy its folder locally. |
| Make an existing MCP server's tools available | Configure the bundled [MCP module](modules/ovd-mcp/README.md). An MCP server is a connection, not an installed OVD module with its own views. |
| Change a bundled OVD domain or the host itself | Work in this checkout and retain the shared UI/Assistant services and [process boundaries](docs/architecture.md#processes-and-trust-boundaries). |

These examples demonstrate different parts of the contract. The built-in adapters are architecture references; they cannot be copied unchanged into a repository package.

| Example | Demonstrates |
| --- | --- |
| [Mail](modules/ovd-mail/) | Domain views, account settings, shared services, and mail references. |
| [Files](modules/ovd-files/) | File navigation, paged content, and generic module references. |
| [MCP](modules/ovd-mcp/README.md) | Connection settings, credential storage, and dynamic tool sources. |
| [Sample notes module](examples/notes-module/README.md) | The runnable starting point for a standalone process module with HTML views and settings. |

A practical authoring sequence is: start with Notes, choose a stable module ID, implement shared domain tools and their schemas, connect the interface to those tools, then add references or attention hints where useful. Exercise that module through both the interface and a concrete Assistant request before [publishing its package](docs/module-repositories.md#publish-a-module). Adding a module does not require editing the Assistant prompt.

### Installation and approval

Custom modules are discovered at startup from `<userData>/modules/<module-folder>/module.json`. On macOS, `userData` is currently `~/Library/Application Support/ai-workspace/`. Built-in modules are discovered under `<appPath>/modules/`.

For distribution through a public or private repository, see [module repositories](docs/module-repositories.md). The catalog helper prepares versioned packages and checksums without executing module code. Repository installs and updates are discovered immediately, but installation and execution approval remain separate steps. A repository is a catalog plus prebuilt files; OVD does not clone an arbitrary source checkout or build it on the user's machine.

After manually copying a module, restart OVD and open **Settings → Modules** (currently **Einstellungen → Module**). Third-party modules require explicit approval of their current file fingerprint. Changed files require new approval. Disabling a module removes its contributions and capabilities without deleting its data.

Approvals and disabled IDs are stored in `<userData>/module-settings.json`; module-owned data belongs under `<userData>/module-data/<moduleId>/`. Keep the module ID stable across updates: it identifies its data, references, tools and installation provenance. Never write user data into the installed package directory: it changes the approved fingerprint and conflicts with repository updates. Updates preserve the data directory; the author must handle any data-format migration safely. See [local data](docs/getting-started.md#local-data).

### Manifest and contributions

A process module contains at least:

```text
my-module/
  module.json
  backend.cjs
  view.html       # Optional view contribution.
  settings.html   # Optional settings contribution.
```

Start from the [sample manifest](examples/notes-module/module.json). The contract is defined by [ModuleManifest](shared/modules.ts) and the [validated manifest schema](electron/modules.ts):

- Set `apiVersion: 1`, a unique `id`, `title`, semantic `version`, a short `description`, and relevant discovery `keywords`. Third-party modules cannot claim `ovd-` IDs, required-module status, or internal host adapters.
- Use `runtime: { "type": "process", "entry": "backend.cjs" }` for a prepared **CommonJS** backend exporting `activate`. The worker loads it with `require`; compile TypeScript or ESM sources to a compatible entry beforehand. Bundle dependencies beforehand; OVD does not install packages when loading a module.
- Describe each function in `tools` with its name, useful description, optional activity label, and bounded object JSON Schema without `$ref`. Names start with the module ID, such as `my-module.list`. `capabilities` must list exactly the same names. The host derives provider-compatible names; the backend and module interface continue to use the manifest names.
- Declare intended access in `permissions`. Requested non-mutating domain reads and view navigation should work autonomously with Workspace tools enabled; do not add per-resource read confirmations or require the user to attach every resource first. A tool's `confirmation` uses the host's shared approval flow for actions that need it. Sending, destructive changes and protected settings need an understandable, reviewable confirmation flow by default. The explicitly saved **Without confirmations** mode (currently **Ohne Abfragen**) can approve requested assistant actions automatically; approval of new or changed module code and configured MCP tool permissions remain separate.
- Point `contributions.views` and `.settings` at local HTML files through `entry`; `.navigation` references a view declared by the module. IDs must be unique within each contribution type. Process-module views and settings must also use distinct IDs across those two types. Integrate descriptions and search terms with the [settings design](docs/settings-design.md).

The host automatically adds discoverable actions to open each process-module view, minimize/maximize/close its window, and open contributed settings. Authors supply the domain operations behind those views. A settings contribution supplies an entry in OVD's category/search navigation; its HTML form still needs its own load, validation, save and error behavior through declared module tools. The host does not generate fields or persist arbitrary settings for it.

### Backend lifecycle

```js
exports.activate = async ({ moduleId, dataDirectory }) => ({
  tools: {
    'my-module.list': async (args, { signal }) => ({ items: [] })
  },
  dispose: async () => { /* Close connections and release resources. */ }
});
```

Implement every manifest tool exactly once. Interface actions and the assistant must use the same functions; every implemented domain action available in the interface needs an assistant entry point. Validate domain inputs and resource IDs, exclude secrets from results, respect cancellation, and return bounded JSON with clear errors and search limits. Persist changes safely and never automatically repeat side effects after an uncertain result.

Process activation is lazy: approval makes contributions discoverable, and the first backend invocation starts the process. Do not assume `activate` runs at app startup or when a window merely opens. Once started, the process can retain connections or timers until it is stopped; release them in `dispose`. There is no general process-module startup scheduler. The bundled Mail polling lifecycle belongs to its host adapter.

The activation context contains `moduleId`, `dataDirectory` and `attention`; tool handlers receive `signal` and, for journalled calls, `operation`. It is not the main-process workspace API or a credential-store bridge. OVD does not forward saved provider, mail or repository credentials to modules. Design a module's own configuration and credential handling explicitly, keeping secrets out of ordinary tool arguments/results, reference snapshots and logs.

Use structured domain results for expected failures, for example `{ outcome: 'failed', message: 'The order no longer exists.' }`, and `cancelled` or `uncertain` where appropriate. The host deliberately hides arbitrary backend exception details; throwing an exception is not a way to show a useful domain error. Successful JSON output must describe what actually happened, including whether a remote system accepted a change or its result is still unknown.

### Durable action hooks

Journalled agent calls receive an optional `context.operation` alongside `signal`: `{runId, actionId, attemptId, argsHash}`. The host owns these IDs. `actionId` identifies a logical recorded step across explicit continuation attempts; `attemptId` changes for a permitted new attempt. An unrelated new user request gets a separate root task, even if its text/arguments match. Normal UI calls may have no operation identity. IDs do not grant access or override confirmations.

The activated process module can optionally provide two hooks in addition to `tools` and `dispose`:

```js
exports.activate = async () => ({
  tools: {
    'my-module.list': async (args, { signal, operation }) => ({ items: [] })
  },
  prepareOperation: async ({ toolName, args }, { signal }) => {
    signal.throwIfAborted();
    // Resolve omitted targets to stable explicit IDs here. When available,
    // include resource: { id: stableResourceId, version: currentRevision }.
    return { args };
  },
  reconcile: async ({ toolName, args, operation }, { signal }) => {
    signal.throwIfAborted();
    // Check durable receipts/status for this action; never call tools[toolName].
    return { state: 'unknown', detail: 'No authoritative status is available.' };
  }
});
```

`prepareOperation` returns `{args?, resource?: {id, version}}`. Keep it free of business changes: resolve mutable selections, validate identity and report the revision without executing the requested action. The host validates the returned arguments against the original tool schema, freezes them and binds them to approved module code/schema. A process module cannot classify itself as effect-free simply by returning an annotation. Changed code or resource versions block execution of an old pending step.

`reconcile` returns `{state: 'completed' | 'not_applied' | 'unknown', result?, detail?}`. Return `completed` only with authoritative evidence of the earlier effect; `not_applied` requires proof that no effect occurred. Otherwise retain `unknown`. A timeout, missing receipt or disconnected server is not proof of non-application. Store receipts under the module's own data directory or use a remote idempotency/status API where supported. A module without reliable hooks can execute a new approved request, but an uncertain earlier write remains blocked. Hooks are optional compatibility additions, not new manifest tools or automatic retries.

The host's [operation journal](docs/architecture.md#durable-operations-and-explicit-continuation) stores ordinary arguments and bounded redacted results unencrypted. Never pass credentials as operation arguments or hide them in text/results; use the existing protected settings/credential flow. Public summaries omit arguments and result blobs; the Assistant retrieves bounded historical results deliberately through lazy tools. During explicit continuation, `operations.retry({actionId})` lets the host reuse the exact saved arguments without asking the model to reconstruct them. Whole catalogs and journal contents must not be injected into every prompt. A local journal cannot guarantee exactly-once remote execution across a crash, and approved process code still runs with normal user permissions rather than an OS sandbox.

### Module attention indicators

The activation context also provides an optional attention publisher. Use it for a short hint that the user should visit the module:

```js
exports.activate = async ({ moduleId, dataDirectory, attention }) => ({
  tools: {
    'my-module.refresh': async (args, { signal }) => {
      signal.throwIfAborted();
      // Perform the module's own work, then publish a bounded hint.
      attention.publish({ key: 'updated', message: 'New items are available.' });
      return { outcome: 'completed' };
    },
    'my-module.review': async () => {
      attention.clear('updated');
      return { outcome: 'completed' };
    }
  }
});
```

Declare these example tools in the manifest like any other module function. The publisher is bound to the approved process's identity; modules cannot name another module. Keys contain 1–80 ASCII letters/digits or `._:-` and start with a letter/digit. Messages are ordinary single-line text of at most 160 characters; do not include bodies, credentials or other sensitive content. The host retains at most eight hints per module and 100 overall, in session memory.

A dot appears on the module's primary Dock icon and contributed Settings categories. It breathes for ten seconds, then stays static; reduced-motion preferences disable the animation. Opening the relevant module/category acknowledges the hints captured for that visit. Newer publications remain visible, including updates to the same key, and updating an outstanding hint does not continually restart its animation. Explicit clearing removes only that module's key. Disable/failure removes its hints and ignores stale process messages. Modules without navigation or settings contributions have no icon target; their hints remain available through the shared listing.

The Assistant discovers `modules.attention` and `modules.acknowledge_attention` lazily to inspect or acknowledge the same state. Hints grant no permissions, execute no actions and are not automatically copied into provider context. See [attention types](shared/module-attention.ts) and the [host](electron/module-host.ts).

### Queries, time, and result completeness

Prefer a small set of composable domain tools. Listing and counting must share validated filters. A count must not simply count the loaded page. Include `scope`, `observedAt`, `countExact`, and `complete` where applicable; when an exact count is unavailable, `count` is a lower bound.

Distinguish received time from the sender's date. Resolve relative calendar periods in the local IANA timezone with an exclusive end, using the shared [time utilities](shared/time.ts). Each request already includes a small current-time context from the host. Time and [calculation tools](shared/calculation.ts) are discovered on demand like other tools. Do not infer today's date from old chat messages or create a separate tool for every possible user question.

### HTML views

HTML views run in an isolated iframe without Node or the workspace API. Package each view/settings entry as self-contained HTML: the current host permits inline scripts/styles and data/blob images, but not external scripts, linked stylesheets, relative asset fetches, direct network requests, embedded frames or form navigation. Put domain network and filesystem work behind the backend tools. Views send:

```js
parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*');
```

They receive `ovd:result` with the same `requestId`, `ok`, and either `result` or `error`. Check `event.source === parent` when handling replies. The host accepts only the corresponding sender window and that module's own tools. The sample uses inline assets; arbitrary external content is not loaded. See the [view host](src/ModuleViewHost.tsx) and [sample view](examples/notes-module/notes.html).

To select one of the module's own declared references in chat without dragging, send `parent.postMessage({ type: 'ovd:reference', requestId, reference: { moduleId, type, id } }, '*')`. The reply uses the same `ovd:result` envelope. The host validates the sender, owning module and reference, resolves its metadata, and opens chat with the reference selected. Selection does not submit a question or execute the reference's instructions. This is the keyboard-accessible alternative to a draggable resource.

### Execution model and package limits

A separate backend process provides crash isolation, **not an operating-system sandbox**. Approved code runs with the user's normal permissions. Manifest `permissions` do not enforce filesystem or network restrictions; module authors are responsible for those accesses.

The [loader](electron/modules.ts) limits a manifest to 64 KiB and a module to 16 MiB, 200 files, and 12 directory levels. Symbolic links are not allowed.

The [process runtime](electron/module-runtime.ts) currently enforces these bounds:

| Boundary | Limit |
| --- | --- |
| Activation | 10 seconds |
| Individual invocation | 60 seconds |
| Encoded arguments | 16 KiB |
| Encoded result | 32 KiB |
| Pending invocations per module | 16 |

These process-module boundaries are distinct from the configurable [agent execution budgets](shared/agent-settings.ts). Do not treat a timed-out external write as a confirmed failure that is safe to repeat.

API version **1** is the current contract. Catalogs and manifests validate that API version; they do not negotiate a minimum OVD app version, an OS/CPU-specific package, or dependencies between modules. Record the required OVD release in your module's documentation and exercise it on the platforms you claim to support. Native dependencies need particular care because packages are not rebuilt for the user's Electron version or architecture. See [repository publishing](docs/module-repositories.md#publish-a-module) for the versioned package layout and update rules.

### Discovery and context budgets

The assistant initially sees up to 20 short module descriptions and only `find_modules` and `get_module_tools`. Support narrow queries and paginated discovery. The active tool count is configurable: **12 by default**, within the current **1–24** range in [agent settings](shared/agent-settings.ts). Schema and history budgets are configurable too. Descriptions must be sufficient to discover a tool without placing full catalogs, user data, or schemas in module summaries or durable chat messages.

Built-in adapters with dynamic tools can register the generic [ModuleToolProvider](shared/module-tool-provider.ts). It exposes short virtual sources, paginated schema selection, and lookup of the exact current offer. Source IDs are namespaced under the parent module; tool offers are tied to the current configuration/schema version. The host tracks parent status and in-flight calls. The provider must recheck permissions and arguments immediately before execution. External server instructions do not become system instructions. [MCP](modules/ovd-mcp/README.md) uses this contract without a special branch in the agent loop. This registration API is host-only: installed process modules expose the static tool definitions in their manifest, not arbitrary dynamic child catalogs.

### Resource references

References carry a stable resource ID and a bounded snapshot with an explicit scope and timestamp. The responsible module also needs a targeted content-reading tool with continuation so even long individual resources remain fully accessible. Opening a resource and reading its content are separate functions. Nested references are not resolved automatically.

The shared [reference contract](shared/references.ts) carries only `{moduleId,type,id}` during drag and drop. Use the `application/x-openvibedesk-reference` MIME type and a `text/plain` fallback containing `openvibedesk-reference:` followed by the same JSON object; set `effectAllowed` to `copy`. Do not include content, metadata or instruction roles in the payload. Built-in host adapters register resolution through [ModuleReferenceRegistry](electron/module-references.ts); renderers cannot submit arbitrary text as a trusted snapshot. Preserve selection, removal, sending, local restoration, and chat branching.

A process module can declare a `snapshotTool` on a reference contribution:

```json
{
  "referenceTypes": [
    {
      "id": "procedure",
      "title": "Procedure",
      "snapshotTool": "my-module.reference",
      "usage": "instructions"
    }
  ]
}
```

This is the `contributions.referenceTypes` portion of the manifest, not a complete module. Declare `my-module.reference` in `tools` and `capabilities` with parameters accepting `{ "id": "<stable-resource-id>" }`. It must be an own-module function without `confirmation`; resolving a reference is a read and must not change business data. Return a bounded [ModuleReference](shared/references.ts) with the same `moduleId`, `type` and `id`, a title, `readable`, `truncated`, `capturedAt` and available `text`. Include source revision/time where available. The host derives summaries from the snapshot without sending its text to the renderer. Declaring a type without `snapshotTool` does not install a process resolver.

The host's `ModuleHost.resolveReference` invokes this declared function through the normal schema, approved-code, identity and cancellation checks. `ModuleReferenceRegistry` validates the snapshot before chat can use it. `usage` defaults to ordinary `context`. The host assigns it from the approved manifest and ignores any role supplied by the backend. Reference-type IDs must be unique, and process contributions with `usage: "instructions"` require a snapshot function.

Supply resource names and descriptions in the reference metadata. The shared chat renders those titles and a generic role marker for instruction references; it does not add optional-module feature names or routine provider-transfer notices.

An explicitly selected `instructions` reference supplies reusable working instructions for the current submitted request, including other selected mail or file context. It does not grant workspace permissions, bypass confirmations or become a system instruction. Ordinary mail, file content and tool results remain source data. Instructions must be readable, complete and nonempty; an unavailable, deleted, disabled or changed module must not silently fall back to a historical instruction snapshot. Historical snapshots remain available as records, but do not automatically apply to later requests. Authors must still provide a targeted reading function for inspecting stored instructions.

`snapshotTool`, `usage` and `ovd:reference` are additions to the current API-1 host contract. Older hosts with strict manifest validation do not accept the new contribution fields; distribute modules using them with a host build containing this reference support.

### Validate a module

Exercise installation, approval and restart, the view and settings, the equivalent assistant task, cancellation, required confirmation, and disabling. For a repository release, also exercise an update with retained module data and fresh code approval. Confirm that the Assistant discovers only the needed tools and that missing/stale references or uncertain changes produce an honest outcome. Preserve existing mail references, drag and drop, drafts, attachments, and local data. Use synthetic fixtures or a designated test mailbox without sending real messages.

Continue with the [architecture](docs/architecture.md), [notes module example](examples/notes-module/README.md), or [MCP server example](examples/mcp-server/README.md).
