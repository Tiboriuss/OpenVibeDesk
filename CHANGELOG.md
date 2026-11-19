# Changelog

[Repository overview](README.md) · [Documentation](docs/README.md) · [Installer and update guide](docs/releases.md)

## v0.1.11 — 19 November 2026

This alpha update adds English and German interface support, consistent settings controls and recovery for workspace saves and unsent chats.

### Interface and modules

- English is the default for new profiles and profiles without a saved language. A saved language or System preference carries over. The Assistant, Settings, OVD-Bar and daily workflows in Mail, Files and MCP switch language in open windows. Mail account setup retains its existing labels.
- Appearance puts language and text size in matching rows with immediate application. Native dropdowns share one visual style across host and bundled module settings while fitting their own form layouts.
- Module authors can translate manifest contributions, lazy tool descriptions and isolated views using the [localization guide](docs/localization.md). The refreshed [README gallery](README.md#a-look-inside) uses the English interface and fictional data.

### Workspace recovery

- OVD reports when a workspace write fails and can retry a recoverable write with the latest in-memory state. The Assistant can inspect and retry a pending save through the same service.
- Each chat restores its unsent draft and selected references after restart. Accepting a message and clearing its draft happen in the same workspace write.
- If the workspace file cannot be loaded, a recovery dialog can open the data folder, save a copy or retry after repair. The original file is preserved. See the [recovery and localization acceptance records](docs/maturation-plan.md).

### Verification and installers

The production build and all 51 existing tests passed. Isolated macOS Electron profiles exercised language and text size changes, keyboard navigation, narrow settings windows, Assistant access, persistence and recovery. The release provides Apple Silicon and Intel macOS installers with ad-hoc signatures and an unsigned Windows x64 installer. See the [installation guide](docs/releases.md) and [release downloads](https://github.com/Tiboriuss/OpenVibeDesk/releases/tag/v0.1.11).

## v0.1.10 — 16 November 2026

This alpha update adds separately configured speech input to the existing Assistant and groups Chat and speech settings into independently saved sections.

### Speech input

- Dictate live through a Realtime transcription endpoint or upload one recorded WAV after Stop. Speech has its own provider, endpoint, model/deployment, authentication, language and microphone settings. OpenAI, OpenAI-compatible, Azure and DeepSeek presets describe their supported transports; a chat-compatible API alone does not provide transcription. ChatGPT sign-in does not currently include transcription API access.
- Recording begins as soon as microphone access is available, while the live provider connection is prepared. A bounded queue preserves the beginning and sends it in order once the provider is ready. Stop works while connecting, and Cancel discards queued audio.
- A failed recording can be retained in memory for an explicit transcription retry without reopening the microphone. Audio is never replayed automatically. New recordings, dismissal, settings/session changes and window closure discard retained audio.
- Transcription appears as a preview and is inserted at the tracked position in the editable composer. Existing text and references remain available; dictation never automatically sends a message.
- Capture is limited to two minutes, with a 20-second pending connection buffer. Microphone access is restricted to the trusted Chat window during a user-initiated recording. The Assistant can inspect speech settings and prepare changes through the existing lazy tool-discovery flow; credentials remain in the local vault.

### Settings and documentation

- **KI & Verbindung** now contains peer **Chat** and **Spracheingabe** groups. Each owns its Save button, status and errors; edits survive category changes, search and collapsing a group.
- Added the [speech input guide](docs/speech-input.md) and updated setup, provider, architecture and settings documentation.

### Verification and compatibility

TypeScript and the production build passed. Practical checks used an isolated Electron app, synthetic microphone audio and local HTTP/WebSocket providers. They covered the interface and Assistant configuration path, independent saves, narrow layouts, permissions and restart. Ten focused connection-buffer checks verified byte-for-byte audio order, Stop/Cancel before readiness, settings/session/window cancellation, explicit retry without a new microphone, timeout handling and a single WAV upload after Stop. Temporary service checks also covered the recording/queue limits and delayed microphone permission.

Actual remote-provider accounts and physical Windows/Intel Mac speech workflows were not exercised. Installer builds run on the release workflow's native runners. App identity and profile paths remain stable; install over the existing version. Mac apps remain ad-hoc signed without Developer ID/notarization, and Windows installers remain unsigned. See the [release](https://github.com/Tiboriuss/OpenVibeDesk/releases/tag/v0.1.10) for build results and downloads.

## v0.1.9 — 11 November 2026

This alpha update matures the existing workspace and introduces the configurable OVD-Bar. It adds no bundled product modules. Earlier release notes remain on [GitHub Releases](https://github.com/Tiboriuss/OpenVibeDesk/releases).

### Desktop and everyday use

- The former sidebar/Dock is now the **OVD-Bar**: vertical or horizontal, adjustable size and background opacity, fixed screen edges or free placement, optional idle collapse and an always-on-top preference. Position survives restart and is constrained to available work areas. Its compact menu, keyboard navigation and module attention signals remain available with many modules.
- OVD-Bar settings and entry ordering share one searchable category. The Assistant can inspect and change preferences, reorder entries and position the bar through the same Host services; new capabilities are discovered only when needed.
- Chat, Chats, Mail, drafts, Files, MCP and Settings use more compact layouts with reachable actions in narrow windows. Settings retain edits across category/search changes. Session search covers the complete saved history while returning bounded pages; Chat initially shows the latest 100 messages with an explicit earlier-history action.

### Assistant and source reading

- **R02:** a validated whole-request budget covers the serialized provider request, with a separate answer reserve. Older history is removed first, then complete tool exchanges become bounded, paged result references. Reading those results does not repeat an action. An unavoidable overflow stops visibly and retains outcomes. The estimate is conservative and does not detect a provider's actual model limit.
- **R03:** Mail and local draft text can be read completely in bounded pages, including text beyond the preview. Saved Mail references carry exact source locators for reopening after restart. Changed sources fail explicitly; cancelling one reader does not cancel another reader's shared transfer. Source size limits still apply.
- Provider stream parsing, module cancellation and process recovery were corrected during the product review. Confirmed, failed and uncertain outcomes remain distinct; answer reformulation stays tool-free, and recovery does not replay completed or uncertain writes.

### Memory use and window traffic

- **R04:** native windows receive only their relevant state; unchanged projections are not broadcast again. Mail bodies and inline-image data have aggregate cache budgets, and the Mail renderer retains only the selected body.
- Files uses bounded temporary identities, pins the visible page/preview and preserves separately saved reference identities. Previous/next directory pages keep the selected preview usable.
- [Measurements](docs/performance-2026-11.md) record the fixture, before/after results and limits. These improvements do not migrate the database, provide offline Mail synchronization or impose an absolute whole-process memory cap.

### Documentation and compatibility

- Updated the architecture, settings/mail guides, module authoring and repository instructions, diagnostics and maturation plan. Added an [OVD-Bar guide](docs/ovd-bar.md) and refreshed screenshots for its actual interface.
- The downloadable catalog is separate from the bundled app and now includes Notes, Skill Library and Memory. Existing repository access, local approval, memory retrieval and event contracts remain in place.
- Application identity and profile paths remain stable. Install the new version over the existing app; there is no in-app automatic updater. Existing v0.1.8 local credentials are retained. Updating from v0.1.7 or earlier needs the previously documented one-time credential reentry/sign-in.
- The Mac upgrade fixture now reads the appropriate chat and draft windows, matching the new scoped state contract.

### Verification and remaining work

TypeScript/build, all 51 existing tests and local documentation links passed. Practical checks used synthetic profiles and local providers for UI/Assistant parity, restart, cancellation, save errors, large content, cache/paging behavior and the OVD-Bar. Native focus behavior was checked on macOS; display removal and alternate work areas were simulated. See the [review](docs/project-review-2026-11.md), [R02–R04 acceptance records](docs/maturation-plan.md) and [OVD-Bar verification](docs/ovd-bar.md#verification-scope).

An isolated, ad-hoc signed Apple Silicon package at version 0.1.9 passed launch, real UI save and replacement with a temporary 0.1.10 verification package built from the same source. Settings, chat identity, draft content, module data and the local credential survived replacement. The resource seal and all 14 nested Mach-O binaries passed signature/architecture checks. The temporary 0.1.10 package is a test fixture, not a published release; this check does not exercise browser quarantine approval or certify every older-profile migration.

**R05 is next:** visible, acknowledged save/error/retry behavior for the whole workspace. Truthful Mail-list paging remains R13; everyday Mail mutations, offline synchronization, storage migrations/backups, broader module lifecycle guarantees and full keyboard/assistive-technology coverage remain open. Passing local checks or packaging does not establish complete Windows/Linux runtime validation.

Release downloads use ad-hoc sealed Mac apps without Developer ID/notarization and unsigned Windows installers. Installer build results and assets are recorded on the [GitHub release](https://github.com/Tiboriuss/OpenVibeDesk/releases/tag/v0.1.9); a published release can appear before its build finishes.
