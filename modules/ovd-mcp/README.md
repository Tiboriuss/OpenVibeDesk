# MCP as an optional OVD module

[Documentation](../../docs/README.md) · [Architecture](../../docs/architecture.md) · [Building modules](../../CONTRIBUTING.md#building-modules)

[`module.json`](module.json) contributes settings and management capabilities. The backend owns configuration, secrets, connections, the tool inventory and execution. The UI uses the same services through typed IPC methods. MCP adds no dock entry and requires no MCP-specific dispatch logic in the chat.

## Setup

Add a server under **Settings → MCP** (currently **Einstellungen → MCP**):

- **Stdio:** enter an executable, its individual arguments and an optional working directory. OVD launches it without an additional shell. Store credentials as secret environment values rather than putting them in command-line arguments. The process inherits the SDK's limited default environment plus the explicitly configured values, rather than OVD's entire environment.
- **Streamable HTTP:** use HTTPS, or HTTP on `localhost`, `127.0.0.1` or `[::1]`. Enter a Bearer token separately if required. Credentials in the URL, query parameters, fragments and redirects are rejected.

Save, connect, select the required tools, then save their permissions separately. New tools are denied by default. Changing the executable, arguments, working directory or HTTP target clears the saved tool allowlist. Automatic connection at app startup is optional and off by default; saved opt-in connections start in the background. The assistant can prepare public configuration and permissions in the form, but only the user can save them. It cannot save a configuration or grant itself tools.

Bearer tokens and configured environment values live in the OS credential store and are write-only from the settings UI. Public configuration, token-presence flags, environment key names and tool permissions are stored in `servers.json` under `<userData>/module-data/ovd-mcp/`. Writes are serialized and atomic. Unreadable configuration is not silently overwritten. Unsaved forms survive category changes and settings searches and participate in the app's unsaved-settings close protection.

## Lazy tool discovery

A connected server with permitted, supported tools appears as the virtual module `ovd-mcp.<serverId>`. Its name and description come from the user's configuration. The model receives short source metadata; `find_modules` locates the source and `get_module_tools` loads only the schemas needed for the current task. The complete server inventory is not attached to every AI request.

The shared contract is [`ModuleToolProvider`](../../shared/module-tool-provider.ts). The host checks source availability and the actual schema offered to the model. The MCP service also checks the live connection, current permission and arguments before execution. Tool names bind the connection, configuration, permissions and catalog revision; an old offer cannot silently acquire a different meaning after any of them changes.

Object input schemas are limited to 12,000 serialized JSON characters. JSON Schema Draft-07, 2019-09 and 2020-12 are supported, with local references only. Asynchronous schemas and unsupported dialects are rejected. Original schemas remain unchanged in the tool offer; unsupported tools show a reason in the UI. Inventory loading is limited to 500 tools or 25 server pages and reports a warning when that limit is reached. UI inventory pages include schemas; the assistant's `mcp.tools` management result contains metadata only. It must use `get_module_tools` to load executable definitions.

Server descriptions, schemas and results are untrusted data. Server instructions are not imported as a system prompt. Annotations such as `readOnlyHint` are hints, not permission grants. Assistant calls use OVD's confirmation mode, including the user's explicitly saved **Without confirmations** option (**Ohne Abfragen**). That option grants no new server or tool permissions. A direct UI tool call still uses the same permission and argument validation.

## Outcomes and cleanup

Results contain bounded text or structured data and explicitly flag truncation. Text chunks are at most 12,000 characters and the result stays below the common 28,000-character JSON budget. Non-text content is represented as an unsupported-content notice. Known configured secrets are redacted from returned data; tool metadata that echoes them is not offered for execution.

`isError: true` is a failed tool result. Cancellation, failure and an uncertain outcome remain distinct. A timeout or transport failure after a call may have been sent returns `uncertain`; OVD does not automatically replay the call. The audit contains at most 100 metadata entries from the current app session: server, tool, time, duration and outcome, with no arguments, results or secret values.

Disconnecting, disabling the module or quitting closes client connections and local server processes. HTTP cleanup attempts session deletion before closing the transport, with a bounded cleanup wait. Disconnecting cannot undo an external action that has already run.

## Implementation map

- [`backend/store.ts`](backend/store.ts): public configuration and OS credential-store access.
- [`backend/service.ts`](backend/service.ts): MCP clients, transport lifecycle, validation, the shared call service and dynamic tool provider.
- [`backend/capabilities.ts`](backend/capabilities.ts) and [`backend/index.ts`](backend/index.ts): validated management for the UI and assistant.
- [`shared/mcp.ts`](../../shared/mcp.ts): settings, inventory, permissions, audit and result contracts.
- [`frontend/`](frontend/): compact settings UI.
- [`examples/mcp-server/`](../../examples/mcp-server/README.md): a separate framework server with three tools.

This first integration supports tools. OAuth, legacy HTTP/SSE transport, MCP resources, prompts, sampling and elicitation are not integrated. The transports use the [official TypeScript SDK v1 client](https://ts.sdk.modelcontextprotocol.io/client); the installed version is pinned in [`package.json`](../../package.json).
