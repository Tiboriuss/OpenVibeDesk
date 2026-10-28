# Application screenshots

[Repository overview](../../README.md) · [Documentation](../../docs/README.md)

Captured on **28 October 2026** from the application at commit `8d0b8b0`. These are captures of the running Electron interface, with fictional sample content supplied through isolated local profiles and fixtures. They are not interface mockups. The images retain the current German labels.

| Image | Visible workflow |
| --- | --- |
| [Assistant](assistant.png) | A referenced email, lazy workspace-tool execution, a Markdown summary and a prepared reply. |
| [Mail](mail.png) | Account/folder navigation, message list and the isolated HTML reader. |
| [Files](files.png) | A synthetic local workspace, text preview and the action for referencing a file in Chat. |
| [MCP](mcp.png) | A connected local example server and its saved configuration. |
| [MCP tool permissions](mcp-tools.png) | Two approved read tools and one blocked creation tool in the same settings panel. |
| [Draft](draft.png) | The reply created through the Assistant, with actual local save status. |
| [Settings](settings.png) | Category navigation and the four installed built-in modules. |

## Sample content and capture boundaries

The Atlas Studio mailbox, people, messages and documents are fictional. Email addresses use `example.org`. Files were created for these captures under a temporary workspace, so visible paths contain no personal home directory. Mail responses and model responses came from local fixtures; the Assistant's tool discovery, message reading, draft creation and local save used the app's existing host paths. The Files capture uses the actual file service against synthetic files. MCP uses a local fixture server and explicitly approved example tools.

The normal application profile and stored credentials were not loaded. Mail submission, actual mailbox changes, unrelated network access and external application launches were blocked. No message was sent. The captures require no production demo mode or application-source changes.

Images are PNG captures at logical window resolution. UI content was not repainted or edited after capture; retina output was resized for repository display. Names, paths, account metadata, messages, references, model identifiers and server fields were reviewed before inclusion.

## Refreshing the screenshots

1. Build the current checkout with `pnpm build`.
2. Launch an isolated `userData` profile with new fictional records. Keep the normal profile and OS credential store out of the capture process; use local fixtures for Mail, AI and MCP.
3. Exercise the existing interface and capabilities. Capture settled states with complete text, meaningful selections and visible status; avoid loading spinners, errors and secret fields.
4. Capture only the application's content, retaining its actual layout and labels. Use approximately 1280 × 840 for wide views and a readable size for Chat and compose windows.
5. Inspect every image for personal data and readability, replace the corresponding PNG, and check the overview at ordinary README width. Keep the full-size image links working.
6. Update the capture date, source commit and descriptions when the images change. Screenshots illustrate the implemented interface, not planned features.
