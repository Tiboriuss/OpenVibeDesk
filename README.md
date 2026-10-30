# OpenVibeDesk

![OpenVibeDesk — a desktop workspace with an integrated assistant](assets/brand/readme-header.svg)

**An everyday desktop app with an assistant built in.**

OpenVibeDesk is an open-source project for people who want to get their daily work done. It brings mail, files, and company tools into a local desktop app with familiar windows, buttons, and menus. You can work directly in the interface, ask the assistant for help, and move between the two as needed.

The assistant works with the same app you see. Ask it to find an email, and it can open that message in the mail window. Ask for a reply, and it can prepare an editable draft. The interface and assistant use the same functions, so the conversation connects to visible work you can inspect and continue yourself.

This is an early, single-user **alpha**. Releases include installers for **macOS Apple Silicon, macOS Intel and Windows x64**. Development and practical use have been exercised on macOS; automated package checks do not establish complete Windows runtime or upgrade validation. Linux remains a local build target. The application interface is currently primarily German; this repository's documentation is maintained in English.

[Project goal](#who-we-are-building-this-for) · [Screenshots](#a-look-inside) · [Add modules](#modules-and-a-small-ai-context) · [Download](#download-and-install) · [Getting started](docs/getting-started.md) · [Documentation](docs/README.md) · [Maturation plan](docs/maturation-plan.md)

## Who we are building this for

Think of a small auto repair shop dealing with customer messages, supplier emails, and the daily inbox backlog. Its staff should be able to find a conversation, understand what needs attention, and prepare a reply through an app they can use without learning how AI agents work. Good defaults, clear windows, and understandable actions matter more than adding another layer of complexity.

Every business has its own tools. An IT service provider or the IT person at a small company should be able to build a module connecting OVD to that company's ERP, for example to look up a customer or an order. That module can provide ordinary controls for staff and the same functions for the assistant. Company-specific integrations can be distributed through private module repositories. ERP access is an example of what a custom module could add; it is not a bundled integration today.

The ambition is a useful app for everyday people and small businesses. It is not a self-learning agent trying to replace every tool or take over the business. We are building for people who need practical help with their work, with familiar controls and an assistant they can call on when useful. Large enterprise deployments and AI power users are not the audience driving the design.

This is the direction of the project. The early version already has Mail, Files, Chat, and module support; making those dependable and approachable for daily use is the next step.

## A look inside

Read a message, bring it into Chat as a reference, and let the Assistant prepare a reply in a separate draft window. Files and approved MCP tools join the same workspace.

These screenshots show the running app with **fictional sample data in isolated profiles**, captured on 28 October 2026. They illustrate the workspace; later layout refinements and the module catalog are not pictured. The interface is currently primarily German. Click any image to view it at full size.

| Assistant | Mail |
| --- | --- |
| [![Assistant summarizing a referenced email, showing a Markdown table and completed workspace actions](assets/screenshots/assistant.png)](assets/screenshots/assistant.png) | [![Mail module with account folders, a message list and an HTML message in the reading pane](assets/screenshots/mail.png)](assets/screenshots/mail.png) |
| Reference content, inspect tool activity and prepare the next step through Chat. | Browse folders and messages with HTML/text reading and controlled image loading. |

| Files | MCP connections |
| --- | --- |
| [![Files module browsing fictional Project Atlas documents with a text preview and a reference-in-chat action](assets/screenshots/files.png)](assets/screenshots/files.png) | [![MCP settings with a local example server and individual tool approvals](assets/screenshots/mcp.png)](assets/screenshots/mcp.png) |
| Navigate local folders, preview supported text and reference files in Chat. | Connect integrations and choose which tools the Assistant may discover and use. [View tool permissions](assets/screenshots/mcp-tools.png). |

| Mail drafts | Settings and modules |
| --- | --- |
| [![Reply draft prepared by the Assistant with recipient, subject, quoted message and visible local save status](assets/screenshots/draft.png)](assets/screenshots/draft.png) | [![Searchable settings with the required Assistant and optional Files, Mail and MCP modules](assets/screenshots/settings.png)](assets/screenshots/settings.png) |
| Review the prepared reply and its save status before sending. | Manage optional modules and workspace preferences in compact categories. |

[Screenshot details and refresh guidance](assets/screenshots/README.md)

## Available features

| Area | Current scope |
| --- | --- |
| **Assistant** | Streaming, Markdown, session management, chat branches, tool-free answer reformulation, journal-backed explicit task continuation, mail/chat/file references, time and calculation tools, and configurable agent execution. |
| **Mail** | Per-account sender names, signatures and retrieval intervals; folders, search/filter/count, HTML/text reading, attachments, local drafts, SMTP sending and separate Sent-copy filing with retry. |
| **Files** | Folder navigation with a path bar, filtering and sorting, text previews, drag-and-drop references in chat, and attachments for mail drafts. |
| **MCP** | Local servers over Stdio and remote servers over Streamable HTTP, individual tool approvals, and a compact activity log. |
| **Module management** | Multiple public/private repositories, searchable catalogs, module installation and updates, local code approval, and shared Assistant access. |

Mail, chat, files, and settings open in separate windows. The dock and its module order are configurable. Settings use compact groups and global search.

Modules can signal new activity with a small dot on their Dock and Settings icons: it briefly breathes, then stays visible until acknowledged. The Mail module uses this for newly observed Inbox activity.

## Modules and a small AI context

OVD can grow with the tools a person or small business actually uses. A module can contribute its own windows, settings, navigation entries, chat references and Assistant tools. Its interface and the Assistant call the same functions. Installing a module does not require modifying the chat or adding its entire tool catalog to every conversation.

| Extension | How it fits |
| --- | --- |
| **Included modules** | The Assistant (`ovd-assistant`) is required. [Mail](modules/ovd-mail/), [Files](modules/ovd-files/) and [MCP](modules/ovd-mcp/README.md) ship with the app and can be disabled individually. |
| **Modules from repositories** | Add independent modules from public/private GitHub repositories or HTTPS catalogs. Each source can publish multiple modules, with their own versioned updates. |
| **MCP servers** | Connect external tools through the included MCP module. An MCP server is configured there; it is not an OVD module package and does not automatically add its own OVD interface. |

### Install your first additional module

1. Open **Settings → Modules → Module sources** (**Einstellungen → Module → Modulquellen**).
2. Choose **Repository hinzufügen** and save [OpenVibeDesk-Modules](https://github.com/Tiboriuss/OpenVibeDesk-Modules) as the source URL. The public catalog needs no token.
3. Select **Katalog laden**, choose a module and click **Installieren**.
4. Review and select **Freigeben & aktivieren**. Its declared views, settings and tools become available in the running app.

The separate [module repository](https://github.com/Tiboriuss/OpenVibeDesk-Modules) currently publishes **Notes** (`sample-notes`), a small example of shared UI/Assistant functions, and **Skill Library** (`skill-library`), for storing and explicitly attaching reusable working instructions to a request. These are optional downloads, not bundled features. Check each module's documentation for host requirements.

Reload the catalog to check for updates, then select **Aktualisieren** for the chosen module. Updates preserve its separate data directory, but changed code needs renewed approval before running. Module updates and application installer upgrades are separate; neither happens automatically. See the [repository guide](docs/module-repositories.md) for the complete workflow and troubleshooting.

### Private modules for your company

Use the same settings to add a private company repository alongside public sources. A repository access token is entered locally and kept in the OS credential store. An IT service provider can publish a prebuilt ERP or order-management module for its customers without putting that integration in the OVD core. The repository supplies the module list and packages; each module owns its business functions, interface and Assistant integration.

Start with the [module authoring contract](CONTRIBUTING.md#building-modules), the [Notes example](examples/notes-module/README.md), and the [publishing guide](docs/module-repositories.md#publish-a-module). Packages are checked before installation, and third-party code requires local approval. Approved backends run with the user's OS rights; they are not sandboxed plugins.

### Discover only what the task needs

The Assistant initially sees short descriptions of available modules and just two discovery tools: `find_modules` finds relevant modules; `get_module_tools` loads the selected functions. Repository catalogs and unused schemas stay out of the initial context. References carry a stable resource ID and a bounded snapshot; the owning module supplies reading tools for more content.

The Assistant can also inspect module sources, refresh catalogs, find updates and request installation. Source credentials and code approval stay in the local interface. See [repository control through Chat](docs/module-repositories.md#assistant-control).

## Download and install

Installer downloads appear on [GitHub Releases](https://github.com/Tiboriuss/OpenVibeDesk/releases) after the release build finishes: a macOS DMG for Apple Silicon, a macOS DMG for Intel, and a Windows x64 installer. Mac apps use an ad-hoc signature to seal their packaged code and resources, without an Apple Developer ID certificate or notarization. Windows installers are unsigned. The operating system may therefore warn or require approval before opening them; see the [installation guide](docs/getting-started.md#install-or-update-the-app).

To update, quit OVD and install the newer version over the existing app: replace it in Applications on Mac, or run the newer Windows installer using the same Windows account. The app's local profile and OS-stored credentials are retained. See [installation and updates](docs/getting-started.md#install-or-update-the-app) and the [release guide](docs/releases.md). Updates are installed manually; there is no in-app automatic updater yet.

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

## Data and current limitations

- **Local storage:** Settings, drafts, chats, and prepared outgoing message copies are stored on the computer. The workspace database and prepared message copies are currently **unencrypted**. API keys, mail passwords, and MCP secrets use the operating system's credential store.
- **AI provider:** Messages, selected references, and requested tool results are sent to the configured provider. A local desktop app can use either a local or remote model endpoint.
- **Answer reformulation:** Uses saved snapshots and bounded result evidence in a text-only branch, even with **Without confirmations** enabled. Older answers without usable evidence cannot be reformulated safely. Editing and sending a request starts a separate new execution. See [the chat workflow](docs/getting-started.md#reformulate-an-answer).
- **Task recovery:** A separate unencrypted local journal records agent actions before dispatch and their known outcomes. Explicit continuation reuses completed results, restricts retries to eligible original steps, and blocks unknown effects until a module can reconcile them. New unplanned changes require a new request; restarting the app never resumes actions automatically. See [task continuation](docs/getting-started.md#continue-an-interrupted-task).
- **Mail:** OAuth, full synchronization, HTML composition and a durable offline cache are not implemented. The HTML reader supports a restricted subset of sender formatting; remote images start blocked and are enabled per message. SMTP server acceptance does not guarantee delivery. Sent-copy filing has its own visible status and retry; a filing failure never triggers another SMTP send.
- **Files:** UTF-8 text files up to 2 MiB can be read in pages. PDF, Office, and other binary formats currently provide metadata. Local paths are accessible within operating-system permissions; Documents is a starting location, not an access boundary.
- **Extensions:** MCP OAuth, resources, prompts, and the legacy SSE transport are not implemented. Local MCP servers and approved third-party modules run with normal user permissions, outside an operating-system sandbox.

With Workspace tools enabled, the Assistant can search and read configured mail and files and navigate their views for your task without individual read approvals. Sending and other protected actions use the shared confirmation flow. The explicitly saved **Without confirmations** mode (currently **Ohne Abfragen**) can skip individual confirmations for requested assistant actions. MCP tool permissions and approval of third-party module code remain separate.

The internal package name `ai-workspace` and storage identifiers are retained to preserve existing data and credentials. See [data locations](docs/getting-started.md#local-data) and the [architecture](docs/architecture.md).

## Next steps

The [maturation plan](docs/maturation-plan.md) prioritizes the existing Assistant, Mail, Files and MCP modules, with dependencies and practical acceptance criteria. It adds no new product modules.

| Priority | Focus | Next work |
| --- | --- | --- |
| First | Trustworthy existing workflows | Bound complete agent context (R02); add long-content continuation (R03), aggregate memory budgets and visible save recovery. Tool-free answer reformulation (R01a) is implemented and practically verified. |
| Foundation | Storage and module lifecycle | Add migrations and backup/restore; finish module compatibility and settings lifecycle contracts; assess MCP compatibility. External reference resolution, explicit instruction references and durable task continuation are implemented. |
| Daily use | Existing modules and interface | Complete everyday mail actions, synchronization and composition; refine Chat, Files, MCP, settings and accessibility. |
| Release | Reproducible distribution | macOS/Windows installers and integrity checks are available. Trusted publisher signing, notarization and broader runtime/upgrade validation remain. |

The [mail](docs/mail-design.md) and [settings](docs/settings-design.md) design guides describe both ongoing requirements and future work; they are not feature-completion lists.

## Contributing and branding

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and module authoring, and [AGENTS.md](AGENTS.md) for repository working rules. The [documentation index](docs/README.md) links all guides, examples, and the architecture decision record.

Use the supplied [brand assets](assets/brand/) and [brand guide](docs/brand.md), including the [horizontal logo](assets/brand/ovd-horizontal-primary.svg) and [symbol](assets/brand/ovd-symbol-primary.svg).

**License:** Project code is licensed under [MIT](LICENSE). The bundled Manrope font uses the [SIL Open Font License 1.1](assets/brand/fonts/OFL.txt); its provenance is recorded in [SOURCE.txt](assets/brand/fonts/SOURCE.txt).
