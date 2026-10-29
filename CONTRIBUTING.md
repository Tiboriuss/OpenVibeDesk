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

Do not add routine test suites or push/PR test workflows. The user-authorized [release installer workflow](docs/releases.md) is the exception: it packages unsigned macOS/Windows installers for published releases and supports an explicit manual validation build. Use focused existing tests or temporary checks when they establish something necessary. For application changes, check both the interface and assistant path through the shared capabilities. Documentation changes should be checked for correct commands, links, and consistency with the code.

Do not commit user data, API keys, `.env` files, databases, or generated application build outputs. Use synthetic data and temporary test credentials; never send real mail or modify a real mailbox to validate a change. Preserve Electron's process boundaries: no renderer Node integration and no unrestricted IPC bridge. See the [architecture](docs/architecture.md).

## Building modules

The OVD Assistant is the required `ovd-assistant` module. Domain modules register through a manifest; the chat must not need module-specific prompts or hardcoded tool catalogs. Built-in examples are:

| Example | Demonstrates |
| --- | --- |
| [Mail](modules/ovd-mail/) | Domain views, account settings, shared services, and mail references. |
| [Files](modules/ovd-files/) | File navigation, paged content, and generic module references. |
| [MCP](modules/ovd-mcp/README.md) | Connection settings, credential storage, and dynamic tool sources. |
| [Sample notes module](examples/notes-module/README.md) | A standalone process module with HTML views, installable without core changes. |

### Installation and approval

Custom modules are discovered at startup from `<userData>/modules/<module-folder>/module.json`. On macOS, `userData` is currently `~/Library/Application Support/ai-workspace/`. Built-in modules are discovered under `<appPath>/modules/`.

For distribution through a public or private repository, see [module repositories](docs/module-repositories.md). The catalog helper prepares versioned packages and checksums without executing module code. Repository installs are discovered immediately.

After manually copying a module, restart OVD and open **Settings → Modules** (currently **Einstellungen → Module**). Third-party modules require explicit approval of their current file fingerprint. Changed files require new approval. Disabling a module removes its contributions and capabilities without deleting its data.

Approvals and disabled IDs are stored in `<userData>/module-settings.json`; module-owned data belongs under `<userData>/module-data/<moduleId>/`. See [local data](docs/getting-started.md#local-data).

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
- Use `runtime: { "type": "process", "entry": "backend.cjs" }` for a prepared JavaScript backend. Bundle dependencies beforehand; OVD does not install packages when loading a module.
- Describe each function in `tools` with its name, useful description, optional activity label, and bounded object JSON Schema without `$ref`. Names start with the module ID, such as `my-module.list`. `capabilities` must list exactly the same names. The host derives provider-compatible names; the backend and module interface continue to use the manifest names.
- Declare intended access in `permissions`. A tool's `confirmation` uses the host's shared approval flow. By default the user is asked. The explicitly saved **Without confirmations** mode (currently **Ohne Abfragen**) can approve requested assistant actions automatically; approval of new or changed module code remains separate. Sending, destructive changes, and protected settings need an understandable, reviewable confirmation flow.
- Point `contributions.views` and `.settings` at local HTML files through `entry`; `.navigation` references a view declared by the module. IDs must be unique within each contribution type. Process-module views and settings must also use distinct IDs across those two types. Integrate descriptions and search terms with the [settings design](docs/settings-design.md).

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

The [process runtime](electron/module-runtime.ts) currently enforces these bounds:

| Boundary | Limit |
| --- | --- |
| Activation | 10 seconds |
| Individual invocation | 60 seconds |
| Encoded arguments | 16 KiB |
| Encoded result | 32 KiB |
| Pending invocations per module | 16 |

These process-module boundaries are distinct from the configurable [agent execution budgets](shared/agent-settings.ts). Do not treat a timed-out external write as a confirmed failure that is safe to repeat.

### Queries, time, and result completeness

Prefer a small set of composable domain tools. Listing and counting must share validated filters. A count must not simply count the loaded page. Include `scope`, `observedAt`, `countExact`, and `complete` where applicable; when an exact count is unavailable, `count` is a lower bound.

Distinguish received time from the sender's date. Resolve relative calendar periods in the local IANA timezone with an exclusive end, using the shared [time utilities](shared/time.ts). Each request already includes a small current-time context from the host. Time and [calculation tools](shared/calculation.ts) are discovered on demand like other tools. Do not infer today's date from old chat messages or create a separate tool for every possible user question.

### HTML views

HTML views run in an isolated iframe without Node or the workspace API. They send:

```js
parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*');
```

They receive `ovd:result` with the same `requestId`, `ok`, and either `result` or `error`. Check `event.source === parent` when handling replies. The host accepts only the corresponding sender window and that module's own tools. The sample uses inline assets; arbitrary external content is not loaded. See the [view host](src/ModuleViewHost.tsx) and [sample view](examples/notes-module/notes.html).

### Execution model and package limits

A separate backend process provides crash isolation, **not an operating-system sandbox**. Approved code runs with the user's normal permissions. Manifest `permissions` do not enforce filesystem or network restrictions; module authors are responsible for those accesses.

The [loader](electron/modules.ts) limits a manifest to 64 KiB and a module to 16 MiB, 200 files, and 12 directory levels. Symbolic links are not allowed.

### Discovery and context budgets

The assistant initially sees up to 20 short module descriptions and only `find_modules` and `get_module_tools`. Support narrow queries and paginated discovery. The active tool count is configurable: **12 by default**, within the current **1–24** range in [agent settings](shared/agent-settings.ts). Schema and history budgets are configurable too. Descriptions must be sufficient to discover a tool without placing full catalogs, user data, or schemas in module summaries or durable chat messages.

Built-in adapters with dynamic tools can register the generic [ModuleToolProvider](shared/module-tool-provider.ts). It exposes short virtual sources, paginated schema selection, and lookup of the exact current offer. Source IDs are namespaced under the parent module; tool offers are tied to the current configuration/schema version. The host tracks parent status and in-flight calls. The provider must recheck permissions and arguments immediately before execution. External server instructions do not become system instructions. [MCP](modules/ovd-mcp/README.md) uses this contract without a special branch in the agent loop.

### Resource references

References carry a stable resource ID and a bounded snapshot with an explicit scope and timestamp. The responsible module also needs a targeted content-reading tool with continuation so even long individual resources remain fully accessible. Opening a resource and reading its content are separate functions. Nested references are not resolved automatically.

The shared [reference contract](shared/references.ts) carries only `{moduleId,type,id}` during drag and drop. Built-in host adapters register resolution through [ModuleReferenceRegistry](electron/module-references.ts); renderers cannot submit arbitrary text as a trusted snapshot. Preserve selection, removal, sending, local restoration, and chat branching. Declaring `referenceTypes` alone does not execute module code or install a resolver.

### Validate a module

Exercise installation, approval and restart, the view and settings, the equivalent assistant task, cancellation, required confirmation, and disabling. Preserve existing mail references, drag and drop, drafts, attachments, and local data. Use synthetic fixtures or a designated test mailbox without sending real messages.

Continue with the [architecture](docs/architecture.md), [notes module example](examples/notes-module/README.md), or [MCP server example](examples/mcp-server/README.md).
