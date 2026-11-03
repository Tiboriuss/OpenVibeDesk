# MCP as an optional OVD module

[Documentation](../../docs/README.md) · [Architecture](../../docs/architecture.md) · [Building modules](../../CONTRIBUTING.md#building-modules)

[`module.json`](module.json) contributes settings and management capabilities. The backend owns configuration, secrets, connections, the tool inventory and execution. The UI uses the same services through typed IPC methods. MCP adds no dock entry and requires no MCP-specific dispatch logic in the chat.

## Setup

Add a server under **Settings → MCP** (currently **Einstellungen → MCP**):

- **Stdio:** enter an executable, its individual arguments and an optional working directory. OVD launches it without an additional shell. Store credentials as secret environment values rather than putting them in command-line arguments. The process inherits the SDK's limited default environment plus the explicitly configured values, rather than OVD's entire environment.
- **Streamable HTTP:** use HTTPS, or HTTP on `localhost`, `127.0.0.1` or `[::1]`. Select **No authentication**, **Bearer token**, or **OAuth · sign in in browser** (currently **Keine Anmeldung**, **Bearer-Token**, **OAuth · im Browser anmelden**). Credentials in the MCP URL, query parameters, fragments and redirects are rejected.

Save, connect, select the required tools, then save their permissions separately. New tools are denied by default. Changing the executable, arguments, working directory or HTTP target clears the saved tool allowlist. Automatic connection at app startup is optional and off by default; saved opt-in connections start in the background. The assistant can prepare public configuration and permissions in the form, but only the user can save them. It cannot save a configuration or grant itself tools.

Bearer tokens, OAuth credentials and configured environment values live in the OS credential store and are write-only from the settings UI. Public configuration, credential-presence flags, environment key names and tool permissions are stored in `servers.json` under `<userData>/module-data/ovd-mcp/`. Writes are serialized and atomic. Unreadable configuration is not silently overwritten. Unsaved forms survive category changes and settings searches and participate in the app's unsaved-settings close protection. Existing Bearer-token configurations retain their authentication method.

## OAuth for HTTP servers

MCP OAuth is available from **v0.1.4**. It uses the official SDK's authorization helpers with OVD's browser, credential store and connection lifecycle. It applies to Streamable HTTP connections. Stdio servers continue to receive their configured environment credentials.

1. Select **OAuth · im Browser anmelden**, enter the MCP URL and save the server.
2. Choose **Im Browser anmelden**. Complete the provider's sign-in and consent in your normal browser. OVD connects the saved server afterwards.
3. Review and save the desired **Werkzeugfreigaben**. Signing in does not approve any tools or expand their existing allowlist.

The connection card distinguishes a saved login, an outstanding browser sign-in and a required new login. **Anmeldung abbrechen** closes the pending local sign-in; **Abmelden** removes the saved local OAuth session and disconnects the server. Disconnecting alone retains the login for a later connection. Logging out of OVD does not log out your browser or revoke the provider's independent browser session.

If a failed authorization leaves a registration that cannot be reused, **Anmeldung zurücksetzen** clears the local OAuth session and registration so you can start again. Saved public client settings and an explicitly configured client secret remain available. An unavailable credential store must become accessible before credentials can be safely changed.

Automatic startup connections and ordinary tool calls never open a login browser. Saved renewable credentials can refresh in the background. If authentication is no longer usable, the card shows that sign-in is required. A failed or uncertain tool call is not automatically repeated after authentication; sign in first, then decide how to continue the task.

### Registration and advanced settings

For servers supporting dynamic client registration, leave the optional client fields empty. OVD discovers the authorization server, registers its desktop client and uses Authorization Code with PKCE. The expanded **OAuth-Einstellungen** group also supports a client registered with your provider:

| Setting | Use |
| --- | --- |
| **Client-ID** | The client identifier issued for this application. |
| **Issuer-URL** | The expected authorization-server issuer for that registered client; it must match discovered metadata when discovery is used. |
| **Autorisierungs-URL** | Optional authorization endpoint for browser sign-in. Leave empty to use discovery. |
| **Token-URL** | Optional endpoint for code exchange and token renewal. Leave empty to use discovery. |
| **Client-Secret** | Only when the provider requires one. It is stored securely, never returned to the UI, and a blank field preserves it. |
| **Scopes** | Optional additional provider scopes, separated by spaces (for example `offline_access` when required for refresh). Server-required and previously granted scopes are retained alongside them. |
| **Lokaler Rückruf-Port** | Default `43189`. The redirect URI is `http://127.0.0.1:43189/oauth/callback`; substitute your saved port when registering it with the provider. |

Manual endpoint fields are available from **v0.1.5**. An individual override replaces that discovered endpoint; discovery must still supply the other endpoint and its metadata. When both URLs are set, also enter a pre-registered **Client-ID** and explicit **Issuer-URL**. This configures Authorization Code with PKCE without requiring authorization-server discovery. PKCE support must be enabled for the registered client at the provider. Leave both endpoint fields empty to retain automatic discovery and dynamic registration where supported. Clearing a field and saving restores discovery for that endpoint.

Use HTTPS endpoint URLs. Loopback HTTP is allowed only for a local HTTP MCP server. URL credentials, fragments and OAuth protocol/secret query parameters are rejected; fixed public routing parameters are supported. Enter client secrets only in **Client-Secret**. Saving a changed endpoint invalidates the previous login and clears tool permissions, so sign in and review the required tools again.

The callback listener exists only for a pending sign-in. A busy port requires closing the other sign-in or selecting another port and updating the provider registration. State and PKCE bind the callback to the pending request; credentials and registrations remain bound to their server and issuer. Changing the HTTP target or authentication identity invalidates the prior binding and requires reviewing tool permissions again.

The implemented registration paths are pre-registration and Dynamic Client Registration. OVD does not currently host or supply a Client ID Metadata Document. Providers that require that registration mechanism, device authorization, client-credentials-only grants or a proprietary login flow need a compatible pre-registered Authorization Code client or a separate integration. This is a supported OAuth subset, not a claim that every MCP authorization extension is implemented. The [current MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) distinguishes these registration mechanisms; the installed [SDK v1 client guide](https://ts.sdk.modelcontextprotocol.io/client#oauth-client-authentication-helpers) describes the provider integration and issuer-bound credentials.

### Assistant access

The Assistant can inspect authentication status through `mcp.servers`, start an explicit sign-in with `mcp.sign_in`, cancel it with `mcp.cancel_sign_in`, and log out with `mcp.sign_out`. Login and logout follow the host's confirmation policy. The provider's browser consent remains interactive. `mcp.settings` can prepare public OAuth configuration, including the optional authorization and token endpoints, in the form; only the user can save it. Tokens and client secrets are never tool arguments or results. The normal lazy module discovery and tool allowlist still apply.

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
- [`backend/oauth.ts`](backend/oauth.ts): OAuth discovery, browser authorization, loopback callbacks and issuer-bound token handling.
- [`backend/capabilities.ts`](backend/capabilities.ts) and [`backend/index.ts`](backend/index.ts): validated management for the UI and assistant.
- [`shared/mcp.ts`](../../shared/mcp.ts): settings, inventory, permissions, audit and result contracts.
- [`frontend/`](frontend/): compact settings UI.
- [`examples/mcp-server/`](../../examples/mcp-server/README.md): a separate framework server with three tools.

This integration supports tools and the HTTP OAuth flows described above. Legacy HTTP/SSE transport, MCP resources, prompts, sampling and elicitation are not integrated. The transports use the [official TypeScript SDK v1 client](https://ts.sdk.modelcontextprotocol.io/client); the installed version is pinned in [`package.json`](../../package.json).
