# Getting started

[Documentation](README.md) · [Repository overview](../README.md) · [Contributing](../CONTRIBUTING.md)

OpenVibeDesk is an early desktop app for one user. The release workflow builds macOS and Windows installers without trusted publisher certificates. Mac apps use an ad-hoc signature for package integrity and are not notarized; Windows installers are unsigned. macOS development has been exercised in practice; build automation alone does not establish full platform or upgrade validation. Linux remains a local packaging target.

## Install or update the app

Select the installer matching your computer from the [published releases](https://github.com/Tiboriuss/OpenVibeDesk/releases).

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

Installed macOS and Windows builds check GitHub Releases at startup by default. Under **Settings → Updates**, you can check now, turn startup checks off, or choose **Preview and stable** to include alphas. When a matching installer is ready, OVD marks the Settings icon and offers the download. Install it over the current app. Manage independently downloaded modules under **Settings → Modules**. [Update settings and reminders](releases.md#check-for-updates-in-ovd)

App updates retain the `ai-workspace` user profile. Existing legacy OS credential entries are left untouched, but this checkout uses local credential files and does not import those entries automatically. The first update from an OS-store build needs one-time password/key reentry and OAuth sign-in; see [Credential storage](#credential-storage). Do not delete the profile when replacing the app. While OVD is still an early version, keep a backup of important local data before changing versions; downgrading to an older version is not an established recovery method.

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

`pnpm dev` compiles the main process and renderer, then launches Electron. You do not need to install a packaged application. It does not watch source files: close the app and run `pnpm dev` again to pick up changes. The OVD-Bar opens the individual workspace windows.

A second launch reuses the existing app instance, so close the previous process before checking a new build. Build outputs are written to `dist/` and `dist-electron/`; they are not source files to edit or commit.

## First run

### Choose the interface language

OVD starts in English. Open **Settings → Appearance → Interface language** (**Einstellungen → Darstellung → Oberflächensprache**) and choose **System**, **Deutsch** or **English**. Open windows update immediately. **System** uses the first supported language in your operating system’s preferred list and falls back to English. You can also ask the Assistant to change the interface language.

Chat, session management, host settings and the OVD-Bar use the selected language. Each module supplies its own translations. Speech recognition has its own [language setting](#enable-speech-input).

### Arrange the workspace

Open module windows from the OVD-Bar. Its **…** menu provides common size, orientation and placement choices; **Customize OVD-Bar…** opens the complete settings. Under **Settings → OVD-Bar**, choose a vertical or horizontal layout, size, background opacity, foreground behavior and optional idle collapse. Drag its grip for free placement. **Items and order** sets the order of available entries.

The Assistant can make the same changes, for example “Make the OVD-Bar horizontal at the bottom” or “Move Files before Mail.” Position and preferences survive restart. See the [OVD-Bar guide](ovd-bar.md) for keyboard use and display behavior.

To keep Chat visible while working in another window, click the pin in the Assistant title bar. Click it again to unpin. **Settings → Appearance → Keep Assistant on top** and a request such as “Keep the Assistant on top” control the same preference. The choice survives restart. Changing it while Chat is closed or minimized takes effect the next time you show Chat. Native Wayland sessions do not support this window setting.

Chat initially displays the latest 100 messages; **Load earlier messages** reveals earlier messages without deleting or truncating saved history. The Chats manager searches the full saved conversation text and pages its results. Files also offers previous/next directory pages while retaining the selected preview.

### Connect an AI provider

1. Open **Settings → AI & connection** (**Einstellungen → KI & Verbindung**).
2. Expand **Chat → Connection** (**Chat → Verbindung**) and choose your provider: OpenAI, Azure AI Foundry, an OpenAI-compatible service or **ChatGPT**. For API-key connections, select the supported interface and authentication, enter the endpoint/key and save. ChatGPT uses **Continue with ChatGPT** to authorize eligible plan usage in your system browser.
3. Select the intelligent and simple model tiers under **Models** (**Modelle**). Azure uses your deployment names; manual entry remains available if no suitable model list is returned. Configure the Thinking level supported by your provider.
4. Enable workspace tools under **Workspace access** (**Workspace-Zugriff**) if your endpoint supports tool calling.

See [AI providers](ai-providers.md) for complete setup, Azure v1/classic endpoint examples and direct ChatGPT sign-in. ChatGPT needs no additional program or API key. Streaming is required for chat. Workspace control additionally requires complete tool calls. Local loopback HTTP is permitted; remote HTTP providers require HTTPS. If a model does not support tools, disable workspace tools to use ordinary chat.

API keys and ChatGPT OAuth credentials use the local encrypted credential store. For ChatGPT, an identity-only sign-in is distinct from permission to use the plan; OVD shows the actual grant and provides account selection and usage controls. The same Workspace permissions and operation safeguards apply to every connection.

### Enable speech input

Expand **Voice input** under **AI & connection**, enable it and select a provider. Choose **Live** or **After recording** for transcription. Save its own transcription URL, model/deployment and API key. Speech and chat providers are independent; a ChatGPT sign-in does not configure an audio API connection.

Click the microphone in Chat to dictate. **Stop recording** releases the microphone and inserts the finished transcript in the editable draft. **Cancel voice input** or Escape discards this dictation and preserves what you typed. See [Speech input](speech-input.md) for provider compatibility, microphone permissions and cancellation.

### Resume an unsent chat

Open the same conversation from **Chats** to continue typing where you left off. OVD saves the text together with its selected mail, chat and module references. If saving fails, keep the window open and use **Retry save** once storage is available again. After a restart, accepted messages appear in the conversation and unsent drafts return to the input field.

You can also ask the Assistant to prepare text for a specific chat. Open that chat to review, edit and send it.

### Reformulate an answer

Use **Reformulate answer** (**Antwort neu formulieren**) beside an assistant answer to create a new branch from its saved results. The branch is marked **Reformulated · no actions** (German: **Neu formuliert · keine Aktionen**). OVD sends the recorded context to the selected model to rewrite the answer; it does not run tools or reread source mail, files or integrations. **Without confirmations** does not change this behavior.

New answers retain bounded result evidence locally for this purpose. For an older answer without usable evidence, OVD explains that it cannot safely reformulate it and leaves the original chat intact. There is no automatic retry of the original task. Your unsent text and reference selections remain with their existing chat while you inspect the branch.

To change the task itself, use **Edit request as a new chat** (**Auftrag als neuen Chat bearbeiten**) on the user message. It opens an editable draft; selecting **Send** starts a new execution under your saved permissions. To recover unfinished work instead, use the separate [task continuation workflow](#continue-an-interrupted-task).

You can also ask the Assistant to reformulate a stored answer through `chats.reformulate`. That queues the same text-only operation after the current agent run finishes successfully. Stopping the current run, an error or a reached limit discards the queued request. See [answer reformulation](architecture.md#answer-reformulation) for evidence limits and behavior after restart.

### Continue an interrupted task

**Continue task** (**Auftrag fortsetzen**) is available on eligible interrupted, failed, limited or uncertain recorded tasks. It opens a continuation branch using the saved action plan. Completed matching steps supply their historical results without running again. Only known-safe unfinished original steps with unchanged resource/code/approval bindings, plus explicitly audited reads, may execute. New unplanned changes require a separate request that you intentionally send. Continuing can therefore stop with a clear explanation when the source or module has changed; it is not a general “try everything again” action.

A failed Mail search/query can be continued: those audited reads may display their results in the Mail window but neither change mailbox content/read status nor send a message. Workspace tools must remain enabled and module/account identities must still be current; Mail reads do not require separate mailbox or message approval. **Reformulate answer** remains completely tool-free and does not perform a search.

Expand **Task status** (**Auftragsstatus**) to inspect the saved steps and whether a change is confirmed, absent or unknown. For an uncertain step, **Check status** (**Status prüfen**) asks its module for a status check without repeating the original tool. A module may be unable to prove what happened; that step remains blocked. For Mail, existing SMTP-acceptance and Sent-copy records remain authoritative, and a status check never sends or appends a message. **Without confirmations** does not bypass these recovery restrictions.

After an app restart, interrupted actions are shown as uncertain and never restart automatically. Older tasks without a durable journal cannot be continued automatically. Keep the operation-journal file with the local profile; deleting it removes execution evidence rather than repairing an action. The journal's own durable writes do not imply that every chat/composer/settings save already has the broader recovery design planned under R05.

The Assistant reaches the same workflow with `chats.continue`, `operations.get_run`, `operations.read_result`, `operations.retry` and `operations.reconcile`. During an explicit continuation, `operations.retry` selects one saved step by its action ID; the host supplies its exact original arguments and applies current permissions and recovery guards. It cannot start an arbitrary new step or run outside a continuation. Result retrieval is bounded and historical; it does not fetch current source content or execute the old task. See [durable operations](architecture.md#durable-operations-and-explicit-continuation) for limits and module requirements.

### Add a mail account

Open **Settings → Email** (**Einstellungen → E-Mail**) and add an IMAP account. IMAP reception and SMTP sending are configured and checked separately within the same account group. Save both configurations if you intend to send mail. A successful IMAP connection alone does not configure SMTP.

Under **Sender, signature & mail checks**, set the outgoing sender name, plain-text signature and retrieval interval. With Mail enabled and an interval selected, OVD checks the Inbox while the app is running, even with the Mail window closed. Newly observed activity can show a dot on the Mail icon. Background checks only request Inbox status.

You can also ask in Chat, for example “For the Workshop account, suggest the sender name Workshop Service and check for mail every 15 minutes.” Settings opens the matching account section and shows the form value and the suggestion for each change. Fields you have already edited start unchecked. Select the changes you want, choose **Apply to form**, then use **Save settings** when ready. Incoming and outgoing server suggestions follow the same review flow, with their own save buttons. Enter any required password directly in the form.

Use the Mail window to browse folders and messages. Drag a message into chat to reference it. The [mail design guide](mail-design.md) describes the intended workflow and identifies work that remains beyond the current implementation.

### Read HTML mail

When a message has a usable HTML alternative, the Mail reader displays it automatically. Use **HTML** or **Text** in the reading pane to switch views. Messages without HTML use text; a partially loaded view is marked accordingly. This does not mark the message read.

In a narrow window, opening a message gives it a dedicated reading view. Use the back button to return to the selected message in the filtered list. **Settings → Appearance → Text size → Larger** also enlarges the HTML content. Wide newsletter layouts adapt to the reading pane. A table that still needs extra space scrolls within the message.

External images start blocked. Select **Load external images** (German: **Externe Bilder laden**) to show them for that message, or **Hide external images** (**Externe Bilder ausblenden**) to block them again. Loading contacts external servers and may reveal your IP address and access time. Embedded supported raster images are handled separately. The choice applies to the loaded message in the current session rather than becoming a permanent account setting.

You can ask the Assistant to switch the format or load images for a specific message. To work with links, try “Which links are in this email?” and then “Open the workshop manual.” Listing links reads the available HTML preview. Opening hands the chosen destination to the default browser or mail app and follows your saved confirmation mode. In the reader, click a link or focus it and press Enter. Links within the message stay in the reader. [HTML mail behavior](mail-design.md#html-email)

For a truncated preview, select **Read full text** to read the underlying message in pages with **Back** and **Next**. **Preview** returns to the preview. The Assistant uses the same source reading and can show its current page in the Mail window; it can also read long local drafts in pages. Newly saved Mail references can recover their exact source after restart. Removed or changed sources and size limits are reported explicitly rather than replaced by a different message. This requires the source account/server; it is not an offline archive.

### Configure optional modules and MCP

Open **Settings → Modules** (**Einstellungen → Module**) to manage modules. The Assistant is required; Mail, Files and MCP are included optional modules. Enable or disable them here. Arrange their available navigation entries under **OVD-Bar → Items and order** (**OVD-Bar → Einträge & Reihenfolge**). The [OVD-Bar guide](ovd-bar.md) covers orientation, size, placement, background opacity and optional idle collapse.

#### Install from a module repository

1. Expand **Module sources**, then **Add repository**.
2. Enter a name and repository URL. Start with the public [OpenVibeDesk-Modules catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules), which currently offers Notes, Skill Library and Memory. You can add multiple sources, including private company repositories or direct HTTPS JSON catalogs.
3. Leave the token empty for a public source. For a private repository, enter a token with read access to its contents; it is stored in the local encrypted credential store. Save the source with **Add source**.
4. Expand **Module catalog** and select **Load catalog**. Search or filter by source, then choose **Install** beside a module.
5. Select **Approve and enable**, review its declared access and approve the downloaded code. Its views, settings and Assistant tools are registered without restarting the app.

To check for updates, load the catalog again and choose **Update** where offered. Updated code requires renewed approval. Installed module data stays in its own directory. These are deliberate module updates, separate from app installer updates; OVD does not install new versions in the background.

The Assistant can help with requests such as “Show available modules,” “Check my module sources for updates,” or “Install Notes from this catalog.” It can prepare a source form, but you save source access and approve new code locally. **Without confirmations** does not replace that code approval.

See the [module repository guide](module-repositories.md) for private access, source removal, conflicts and publishing your own modules. For development without a repository, [manual installation](../CONTRIBUTING.md#installation-and-approval) copies a prebuilt folder to `<userData>/modules/`; that discovery path requires a restart and subsequent code approval.

#### Connect an MCP server

To connect a local or remote MCP server, follow the [MCP module guide](../modules/ovd-mcp/README.md). A tool approval is tied to the definition advertised by that server. After upgrading from v0.1.13 or earlier, connect the server, review the tools you use, and select **Save permissions**. Later changes to an approved definition also appear for review. [Reviewing tool changes](../modules/ovd-mcp/README.md#reviewing-tool-changes) The [sample server](../examples/mcp-server/README.md) provides a small local example.

For an OAuth-protected HTTP server, select **OAuth · browser sign-in**, save its configuration, then use **Sign in through browser**. Complete the provider's consent in the browser and approve the required tools separately. The [OAuth setup guide](../modules/ovd-mcp/README.md#oauth-for-http-servers) covers pre-registered clients, optional authorization/token endpoint overrides, callback URLs, cancellation and sign-out. Startup connections never open a login browser automatically.

MCP servers supply tools through the MCP module. Configure them in **Settings → MCP**; do not enter their URLs as module repository sources. Module repositories distribute OVD packages with manifests and can add their own views and settings.

### Adjust agent execution

Under **Settings → Agent** (**Einstellungen → Agent**), configure round and call limits, run and request timeouts, active tool and schema budgets, retained history, and transport retries. The current defaults and bounds are defined in [shared/agent-settings.ts](../shared/agent-settings.ts).

The **Context** group also sets **Context budget** and **Response reserve**. Defaults are 128,000 estimated tokens total and an 8,192-token answer reserve. OVD conservatively counts the complete serialized request in UTF-8 bytes; this is not the provider's exact token count or automatic model-limit detection. Choose values suitable for your model. Older history and completed tool exchanges can be compacted; saved result pages remain readable without repeating their actions. If the current request cannot fit, shorten it or adjust the budget for a deliberately started task.

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
| `workspace.sqlite` | Workspace state, chat history and unsent drafts. The file is unencrypted. |
| `ovd-bar-position.json` | Free OVD-Bar placement and its display identity; appearance preferences remain in workspace settings. |
| `operation-journal/operations.json` | Durable agent run/action records, ordinary frozen arguments and bounded redacted results; currently unencrypted. Preserve it to retain recovery guards. |
| `modules/<module-folder>/module.json` | Custom module discovery. |
| `module-settings.json` | Module approvals and disabled module IDs. |
| `module-repositories.json` | Source URLs and installation receipts; access tokens are stored separately in the local encrypted credential store. |
| `module-data/<moduleId>/` | Module-owned local data. |
| `chatgpt/accounts.json` | Stable installation identity, saved ChatGPT registration/account metadata and selected profile; OAuth tokens remain in the local encrypted credential store. |
| `credentials/vault.json` | Authenticated AES-256-GCM encrypted credentials for built-in services. |
| `credentials/local.key` | Local encryption key; retain it with the vault when backing up the profile. |

Other account and configuration files may also live here. Credentials are managed separately by the local encrypted credential store. See [architecture and persistence](architecture.md) before changing or migrating these locations.

Full Mail text reading also uses bounded, unencrypted temporary files under the operating system's temporary directory. They are removed on expiry/close and cleaned up after interrupted runs; they are not a persistent offline cache. See [source-reading limits](architecture.md#complete-mail-and-draft-text).

### If the workspace cannot open

OVD shows a startup dialog before opening any windows. Use **Open data folder** to locate the profile. If the file is unreadable, correct its access rights. If it requires a newer format, use the OVD version that created it or a compatible update. For SQLite companion files, close the other application that opened the database. Keep the database and its companion files together.

For a damaged or unsupported file, **Save a copy…** saves its original bytes to a new file outside the profile. Keep that copy private. It can contain chat history, drafts and selected reference content. Copying lets you or your IT contact investigate while the original stays in place. A full profile backup also needs the other data listed above.

After correcting the problem, choose **Reopen**. OVD checks the file again before starting the workspace. **Quit** exits from recovery. These steps work without an AI connection.

### Credential storage

The current checkout stores API keys, IMAP/SMTP passwords, repository tokens, ChatGPT credentials, and MCP secrets in `credentials/vault.json`, encrypted with AES-256-GCM. Its randomly generated key is stored beside it in `credentials/local.key`. Where POSIX permissions are supported, the directory is restricted to `0700` and both files to `0600`; Windows relies on the user profile's normal access controls. There is no master password or normal-use OS credential-store lookup, so this storage does not trigger repeated macOS Keychain password prompts.

This is deliberately weaker than OS-keychain protection: a program or person able to read both files as your OS user can decrypt the credentials. Keep the vault and key together in a private backup, outside a public repository or support-log export. The vault has authenticated contents and serialized atomic writes; an unreadable, corrupted or missing-key store fails visibly without replacing its existing data.

Releases through **v0.1.7** used the OS credential store. When updating directly from one of those versions, reenter provider keys, mail passwords and private-repository tokens in their existing settings, and sign in to ChatGPT/MCP OAuth again. Public account settings, registrations, chats, drafts and module data remain. Old OS entries are neither read automatically nor deleted; there is no automatic credential migration. A normal restart or later installer replacement retains the new local vault, so these credentials do not need repeated reentry. Downgrading is not a credential migration path.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `pnpm: command not found` | Follow [development-tool installation](#install-the-development-tools) and check your terminal's `PATH`. |
| The UI still shows the old build | Exit the running app, then run `pnpm dev` again. |
| An AI request fails on another computer | Enable and export a local [diagnostic report](diagnostics.md) on that computer before reporting the failure. |
| An agent cannot find module tools | Check the module's enabled/approval state, provider tool-calling support, and configured agent limits. |
| Mail can be read but not sent | Check and save the account's SMTP settings independently of IMAP. |
| A module does not appear | Check its `module.json`, runtime files, compatibility, and approval status; see the [module contract](../CONTRIBUTING.md#building-modules). |
| A saved repository shows no modules | Load its catalog with **Load catalog**. Catalog lists are session-local; saving a source alone does not fetch it. Check the source's error/status. |
| A private repository cannot be loaded | Check the source URL and saved token's repository access. See [private sources](module-repositories.md#private-company-repositories). |
| An installed module is not active | Select **Approve and enable** after installation or an update. Downloading does not grant execution approval. |
| A module update shows a conflict | The installed ID may belong to another source or a manually modified package. OVD will not silently replace it; see [module repositories](module-repositories.md). |
| Files open at Documents | Navigate with the path bar. Documents is a starting location; access follows OS permissions. |
| A binary file has no text preview | PDF, Office, and other binary formats currently provide metadata rather than extracted content. |

For changes and local packaging commands, continue with [Contributing](../CONTRIBUTING.md#development). For incomplete features, see the [current limitations](../README.md#data-and-current-limitations).
