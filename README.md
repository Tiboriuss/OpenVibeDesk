# OpenVibeDesk

![OpenVibeDesk — a desktop workspace with an integrated assistant](assets/brand/readme-header.svg)

**A desktop workspace you can operate through its interface and its assistant.**

OpenVibeDesk brings chat, mail, files, and custom integrations into a local desktop app. The assistant can retrieve information and control the relevant windows: for example, find an email, open it in the mail window, and prepare a draft addressed to its sender. The interface and assistant use the same validated capabilities.

This is an early, single-user development version. Development and practical use have been exercised on **macOS**. Windows and Linux build targets exist; broader platform, installer, and release validation is still pending. The application interface is currently primarily German; this repository's documentation is maintained in English.

[Getting started](docs/getting-started.md) · [Documentation](docs/README.md) · [Contributing and modules](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

## Available features

| Area | Current scope |
| --- | --- |
| **Assistant** | Streaming, Markdown, session management, chat branches, mail/chat/file references, time and calculation tools, and configurable agent execution. |
| **Mail** | IMAP accounts, folders, server search, combined filters and counts, plain-text reading, attachments, local drafts, SMTP sending, and separate Sent-copy filing with retry. |
| **Files** | Folder navigation with a path bar, filtering and sorting, text previews, drag-and-drop references in chat, and attachments for mail drafts. |
| **MCP** | Local servers over Stdio and remote servers over Streamable HTTP, individual tool approvals, and a compact activity log. |

Mail, chat, files, and settings open in separate windows. The dock and its module order are configurable. Settings use compact groups and global search.

## Run locally

Install **Node.js 22.13 or newer** and **pnpm 11.25.0**, then run these commands in a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` builds the project and launches Electron without installing the app. It does not start a hot-reload server; restart it after source changes. If `pnpm` is missing, see [setup and troubleshooting](docs/getting-started.md#install-the-development-tools).

Configure an OpenAI-compatible endpoint and models in **Settings → AI & connection** (currently **Einstellungen → KI & Verbindung**). Streaming is required; workspace actions also require tool calling. The [first-run guide](docs/getting-started.md#first-run) covers mail accounts, optional modules, and MCP setup.

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Check main-process and renderer TypeScript. |
| `pnpm build` | Compile TypeScript and build the renderer. |
| `pnpm test` | Run the existing focused tests. |
| `pnpm pack:mac` | Build a macOS DMG under `release/`. |
| `pnpm pack:win` | Build a Windows NSIS installer under `release/`. |
| `pnpm pack:linux` | Build a Linux AppImage under `release/`. |

The build targets do not imply verified cross-compilation, signing, or production-ready distribution. See [development and validation](CONTRIBUTING.md#development).

## Modules and a small AI context

The **Assistant is the required module**, `ovd-assistant`. [Mail](modules/ovd-mail/), [Files](modules/ovd-files/), and [MCP](modules/ovd-mcp/README.md) are optional modules with their own domain logic, interfaces, and registration.

The assistant initially receives short module descriptions and two discovery tools:

1. `find_modules` finds modules relevant to the task.
2. `get_module_tools` loads the specific tools needed before calling them.

Complete tool catalogs are loaded only as needed. References carry a stable resource ID and a bounded snapshot; more content can be retrieved explicitly.

Custom modules are discovered at startup under `<userData>/modules/`. Their exact file contents require local approval before execution. Connected MCP servers with approved tools use the same discovery mechanism. See the [module contract](CONTRIBUTING.md#building-modules), [sample notes module](examples/notes-module/README.md), and [sample MCP server](examples/mcp-server/README.md).

## Data and current limitations

- **Local storage:** Settings, drafts, chats, and prepared outgoing message copies are stored on the computer. The workspace database and prepared message copies are currently **unencrypted**. API keys, mail passwords, and MCP secrets use the operating system's credential store.
- **AI provider:** Messages, selected references, and requested tool results are sent to the configured provider. A local desktop app can use either a local or remote model endpoint.
- **Mail:** OAuth, HTML rendering, full synchronization, and a durable offline cache are not implemented. SMTP server acceptance does not guarantee delivery. Sent-copy filing has its own visible status and retry; a filing failure never triggers another SMTP send.
- **Files:** UTF-8 text files up to 2 MiB can be read in pages. PDF, Office, and other binary formats currently provide metadata. Local paths are accessible within operating-system permissions; Documents is a starting location, not an access boundary.
- **Extensions:** MCP OAuth, resources, prompts, and the legacy SSE transport are not implemented. Local MCP servers and approved third-party modules run with normal user permissions, outside an operating-system sandbox.

Sending and other protected actions use the shared confirmation flow. The explicitly saved **Without confirmations** mode (currently **Ohne Abfragen**) can skip individual confirmations for requested assistant actions. Tool permissions and approval of third-party module code remain separate.

The internal package name `ai-workspace` and storage identifiers are retained to preserve existing data and credentials. See [data locations](docs/getting-started.md#local-data) and the [architecture](docs/architecture.md).

## Next steps

| Area | Current state | Next work |
| --- | --- | --- |
| Desktop and chat | Usable foundation | Improve usability, accessibility, and reliability. |
| Mail | Basic reading and sending | Add OAuth, HTML rendering, synchronization, and offline caching. |
| Modules and MCP | Shared registration and selective tool discovery | Exercise the module contract further; add MCP resources, prompts, and OAuth. |
| Distribution | Local development and packaging scripts | Validate platforms, signed packages, data migrations, and updates. |

The [mail](docs/mail-design.md) and [settings](docs/settings-design.md) design guides describe both ongoing requirements and future work; they are not feature-completion lists.

## Contributing and branding

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and module authoring, and [AGENTS.md](AGENTS.md) for repository working rules. The [documentation index](docs/README.md) links all guides, examples, and the architecture decision record.

Use the supplied [brand assets](assets/brand/) and [brand guide](docs/brand.md), including the [horizontal logo](assets/brand/ovd-horizontal-primary.svg) and [symbol](assets/brand/ovd-symbol-primary.svg).

**License:** Project code is licensed under [MIT](LICENSE). The bundled Manrope font uses the [SIL Open Font License 1.1](assets/brand/fonts/OFL.txt); its provenance is recorded in [SOURCE.txt](assets/brand/fonts/SOURCE.txt).
