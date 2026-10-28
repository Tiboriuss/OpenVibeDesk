# Getting started

[Documentation](README.md) · [Repository overview](../README.md) · [Contributing](../CONTRIBUTING.md)

OpenVibeDesk is an early desktop app for one user. macOS development has been exercised in practice. Windows and Linux packaging targets exist, but wider platform and installer validation is still pending.

## Install the development tools

The versions declared in [package.json](../package.json) are **Node.js 22.13 or newer** and **pnpm 11.25.0**. Check your terminal:

```sh
node --version
npm --version
pnpm --version
```

If Node.js and npm are installed but `pnpm` is not found, install the repository's pinned pnpm version:

```sh
npm install --global pnpm@11.25.0
```

Open a new terminal if the executable is not yet on your `PATH`. Use your existing Node installation or version manager; a permissions error from a global install is a reason to check that setup rather than run the app as an administrator.

## Start from a checkout

In the repository directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` compiles the main process and renderer, then launches Electron. You do not need to install a packaged application. It does not watch source files: close the app and run `pnpm dev` again to pick up changes. The dock opens the individual workspace windows.

A second launch reuses the existing app instance, so close the previous process before checking a new build. Build outputs are written to `dist/` and `dist-electron/`; they are not source files to edit or commit.

## First run

The interface currently uses primarily German labels. The names below pair the English explanation with the actual visible label.

### Connect an AI provider

1. Open **Settings → AI & connection** (**Einstellungen → KI & Verbindung**).
2. Expand **Connection** (**Verbindung**), enter the OpenAI-compatible endpoint and any required API key, then save.
3. Select the intelligent and simple model tiers under **Models** (**Modelle**). Configure the thinking level supported by your provider.
4. Enable workspace tools under **Workspace access** (**Workspace-Zugriff**) if your endpoint supports tool calling.

Streaming is required for chat. Workspace control additionally requires the provider to return complete tool calls. Local loopback endpoints may use HTTP; remote endpoints require HTTPS. If a provider does not support tools, disable workspace tools to use ordinary chat.

Messages, selected references, and tool results may be sent to that endpoint. Saved secrets are stored through the operating system's credential store.

### Add a mail account

Open **Settings → Email** (**Einstellungen → E-Mail**) and add an IMAP account. IMAP reception and SMTP sending are configured and checked separately within the same account group. Save both configurations if you intend to send mail. A successful IMAP connection alone does not configure SMTP.

Use the Mail window to browse folders and messages. Drag a message into chat to reference it. The [mail design guide](mail-design.md) describes the intended workflow and identifies work that remains beyond the current implementation.

### Configure optional modules and MCP

Open **Settings → Modules** (**Einstellungen → Module**) to manage optional modules. The Assistant is required. The module navigation order is configurable under **Modules → Sidebar & dock** (**Module → Seitenleiste & Dock**).

To connect a local or remote MCP server, follow the [MCP module guide](../modules/ovd-mcp/README.md). Only saved servers and currently approved tools can be used. The [sample server](../examples/mcp-server/README.md) provides a small local example.

To install a custom module, follow [module installation](../CONTRIBUTING.md#installation-and-approval). Copying a folder requires a restart; third-party code also requires approval of its current file fingerprint.

### Adjust agent execution

Under **Settings → Agent** (**Einstellungen → Agent**), configure round and call limits, run and request timeouts, active tool and schema budgets, retained history, and transport retries. The current defaults and bounds are defined in [shared/agent-settings.ts](../shared/agent-settings.ts).

When an agent reaches a limit, the UI retains its results and reports the reason. Changing a setting does not restart a completed run automatically. An uncertain send or external write must be checked before retrying.

The separate **Without confirmations** option (**Ohne Abfragen**) is under **AI & connection → Workspace access**. It skips individual host confirmations for requested assistant actions when explicitly saved by the user. It does not grant new tool permissions or approve new or changed third-party modules.

## Local data

The internal application name remains `ai-workspace` so existing installations can retain their data and credentials. The app uses Electron's `userData` directory; on macOS it is currently:

```text
~/Library/Application Support/ai-workspace/
```

Important entries include:

| Path under `userData` | Purpose |
| --- | --- |
| `workspace.sqlite` | Workspace state and chat sessions; currently unencrypted. |
| `modules/<module-folder>/module.json` | Custom module discovery. |
| `module-settings.json` | Module approvals and disabled module IDs. |
| `module-data/<moduleId>/` | Module-owned local data. |

Other account and configuration files may also live here. Credentials are managed separately by the OS credential store. Unsent chat composer drafts also use renderer local storage. See [architecture and persistence](architecture.md) before changing or migrating these locations.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `pnpm: command not found` | Follow [development-tool installation](#install-the-development-tools) and check your terminal's `PATH`. |
| The UI still shows the old build | Exit the running app, then run `pnpm dev` again. |
| An agent cannot find module tools | Check the module's enabled/approval state, provider tool-calling support, and configured agent limits. |
| Mail can be read but not sent | Check and save the account's SMTP settings independently of IMAP. |
| A module does not appear | Check its `module.json`, runtime files, compatibility, and approval status; see the [module contract](../CONTRIBUTING.md#building-modules). |
| Files open at Documents | Navigate with the path bar. Documents is a starting location; access follows OS permissions. |
| A binary file has no text preview | PDF, Office, and other binary formats currently provide metadata rather than extracted content. |

For changes and local packaging commands, continue with [Contributing](../CONTRIBUTING.md#development). For incomplete features, see the [current limitations](../README.md#data-and-current-limitations).
