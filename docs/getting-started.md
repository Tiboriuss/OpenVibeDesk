# Getting started

[Documentation](README.md) · [Repository overview](../README.md) · [Contributing](../CONTRIBUTING.md)

OpenVibeDesk is an early desktop app for one user. The release workflow builds macOS and Windows installers without trusted publisher certificates. Mac apps use an ad-hoc signature for package integrity and are not notarized; Windows installers are unsigned. macOS development has been exercised in practice; build automation alone does not establish full platform or upgrade validation. Linux remains a local packaging target.

## Install or update the app

Open [GitHub Releases](https://github.com/Tiboriuss/OpenVibeDesk/releases) and wait for the release build to finish. Select the installer matching your computer:

| Computer | Download |
| --- | --- |
| Mac with Apple Silicon (M-series) | macOS `arm64` DMG |
| Mac with an Intel processor | macOS `x64` DMG |
| Windows with an Intel/AMD 64-bit processor | Windows `x64` EXE |

These early packages have no trusted publisher identity. macOS Gatekeeper or Windows SmartScreen may warn or block opening. Only approve the specific downloaded OVD app if you trust its source. The release assets include checksums for verifying downloaded files; see [Releases and installers](releases.md#signing-and-operating-system-approval).

### macOS

Open the DMG and drag **OpenVibeDesk.app** to **Applications**. Eject the disk image, then open the copy in Applications. Until releases have a trusted Developer ID signature and notarization, macOS may block opening because it cannot verify the developer or check the app. After that attempt, use **System Settings → Privacy & Security → Open Anyway** for this specific app if you trust the download. Its availability depends on system policy. Follow [Apple's opening instructions](https://support.apple.com/en-us/102445); do not disable Gatekeeper globally or remove quarantine attributes to bypass its checks.

An alert saying the app **is damaged** is a different problem from the expected unidentified-developer warning. It can indicate a broken download or invalid package signature. Download a fresh copy, compare its checksum, and report the release version and Mac architecture if it persists. Do not treat damage alerts as a normal installation step. The [release guide](releases.md#package-integrity-checks) explains the package checks.

For a newer version, finish running work, quit OVD completely, and copy the new **OpenVibeDesk.app** to the same Applications folder. Choose **Replace** when Finder asks. Keep the same application name rather than creating a second copy with a different name. The local profile is stored outside the application bundle and is retained.

### Windows

Run the EXE installer using your usual Windows account. Installation uses the per-user app location and does not require an all-users deployment. Launch OVD from its shortcut after setup finishes.

For a newer version, finish running work, quit OVD, and run the new installer using the same account. It recognizes the existing OVD installation and replaces its application files. Reuse the existing installation location. You do not need to uninstall first; settings, drafts, chats, installed modules and credentials remain separate from the installer files.

### Data and update scope

These are manual installer upgrades. OVD currently has no automatic update checker or in-app installer. Application releases and updates to optional modules are separate: manage module updates under **Settings → Modules**.

App updates retain the `ai-workspace` user profile and existing OS credential entries. See [Local data](#local-data) for storage locations. Do not delete that profile when replacing the app. While OVD is still an early version, keep a backup of important local data before changing versions; downgrading to an older version is not an established recovery method.

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

### Read HTML mail

When a message has a usable HTML alternative, the Mail reader displays it automatically. Use **HTML** or **Text** in the reading pane to switch views. Messages without HTML use text; a partially loaded view is marked accordingly. This does not mark the message read.

External images start blocked. Select **Load external images** (currently **Externe Bilder laden**) to show them for that message, or **Hide external images** (**Externe Bilder ausblenden**) to block them again. Loading contacts external servers and may reveal your IP address and access time. Embedded supported raster images are handled separately. The choice applies to the loaded message in the current session rather than becoming a permanent account setting.

The assistant can perform the same actions, for example: “Show this email as HTML,” “Switch to the text view,” or “Load the external images in this message.” Image loading follows your saved confirmation mode. Mail links open in the default external application after an intentional click. The reader removes active content and limits sender CSS, so complex layouts may differ from the sender's original. For details, see [HTML mail behavior](mail-design.md#html-email).

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
