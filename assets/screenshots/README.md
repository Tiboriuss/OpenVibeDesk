# Application screenshots

[Repository overview](../../README.md) · [Documentation](../../docs/README.md)

The gallery follows Atlas Studio, a fictional team preparing a website launch. The workspace views were captured from the English Electron app on 19 November 2026. The MCP views were refreshed on 26 November for v0.1.14.

| Image | What it shows |
| --- | --- |
| [OVD-Bar](ovd-bar.png) | The horizontal launcher with its module icons and overflow button. |
| [OVD-Bar settings](ovd-bar-settings.png) | Bottom placement, size and opacity settings for the bar shown above. |
| [Assistant](assistant.png) | A referenced email, the completed workspace actions, a Markdown task table and a prepared reply. |
| [Mail](mail.png) | A seven-message inbox with the launch email open in the HTML reading pane. |
| [Draft](draft.png) | The Assistant’s reply with its recipient, quoted email and local save status. |
| [Files](files.png) | The project brief, its text preview and the action to reference it in chat. |
| [MCP](mcp.png) | The studio's connected HTTP server, negotiated protocol version and two tool definitions awaiting review. |
| [MCP tool permissions](mcp-tools.png) | Two previously name-approved tools appear unchecked after an upgrade. Open **Tool definition** to review either tool before saving permissions. |
| [Settings](settings.png) | The required Assistant and the three optional bundled modules. |

## Refreshing the gallery

1. Build the checkout with `pnpm build`. Launch Electron with a fresh `userData` directory and use English as the interface language.
2. Use a temporary workspace and fictional records. The examples use `example.org` addresses, a local Mail fixture, a loopback model endpoint and a loopback MCP server. Keep credentials and personal account or folder names out of the profile.
3. Exercise the workflows in the app. For the Assistant example, reference the launch email, request a summary and a reply, then open the locally saved draft. For MCP, connect the example server and expand its tool permissions.
4. Capture each application window after the interface settles using `webContents.capturePage()`. Check readable text, form values, paths and tool descriptions before replacing the PNGs.
5. Update the capture date and verify the image links in the [repository overview](../../README.md).
