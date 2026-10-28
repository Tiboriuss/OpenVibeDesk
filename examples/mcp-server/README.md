# Connect a small framework through MCP

[Documentation](../../docs/README.md) · [MCP module](../../modules/ovd-mcp/README.md) · [Building modules](../../CONTRIBUTING.md#building-modules)

This standalone MCP server demonstrates how an application can expose its functions to OVD. It is not started automatically. Its three tools report framework status, list tasks and create a task in memory. Restarting the server clears that example data.

Install the repository dependencies with `pnpm install`, then:

1. Add a server under **Settings → MCP** (currently **Einstellungen → MCP**), for example with the name “Example framework” and description “Create and find tasks”.
2. Select **Stdio**. Enter `node` as the executable, or its absolute path if it is not on the app's `PATH`.
3. Add the absolute path to [`server.cjs`](server.cjs) as one argument, then save.
4. Connect, select the required tools in the inventory and save the tool permissions.
5. Ask the assistant, for example: “Create a task in the example framework: Review the proposal.”

The tools are `framework_status`, `tasks_list` and `tasks_create`. The example stores at most 50 tasks; titles contain 1–200 characters. [`server.cjs`](server.cjs) uses the repository's SDK and Zod dependencies and does not need a separate installation in this directory.

OVD discovers the connection as a tool source and loads only the schemas required for the task. Tools without permission are not offered. The server receives no OVD workspace API and no automatic authority to control OVD windows. Like other configured Stdio servers, however, it is a local process with the current user's OS permissions; the example is not a sandbox.

Replace the example handlers with your framework's actual services without changing OVD's chat or system prompt. This server uses the [official TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/client) over Stdio; a remote server can expose Streamable HTTP instead. The current OVD integration's supported transports and limits are documented in the [MCP module](../../modules/ovd-mcp/README.md).
