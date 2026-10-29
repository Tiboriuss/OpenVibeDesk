# Settings design

[Documentation index](README.md) · [Architecture](architecture.md) · [Brand guide](brand.md) · [Mail design](mail-design.md) · [Building modules](../CONTRIBUTING.md#building-modules)

The settings concept comes from the shared user-supplied design guide: a compact desktop interface informed by the task-focused navigation of Raycast and VS Code. Show current state and frequently used options first; reveal detail when needed.

This is a continuing product contract. **Current implementation** notes describe existing behavior; explicitly listed future additions are not available features. This document does not translate or rename the application's current UI labels.

## Navigation and presentation

- Use a separate, resizable settings window with a global search, icon-based category navigation and compact setting rows. Adapt navigation and controls to narrow windows.
- Organize categories around the user's tasks. Add Mail, Agent, MCP or another category when the corresponding feature exists, rather than displaying empty placeholders.
- Put related settings in expandable groups. Summaries show useful current state without exposing secrets. Allow several groups to remain open, preserve their state during use, and temporarily reveal relevant groups during search.
- Group Mail settings **per account**: name and email identify the account, followed by editable IMAP incoming and SMTP outgoing details. Prefill existing accounts; test and save incoming/outgoing connections separately. Preserve other accounts' unsaved edits.
- Use clear labels and short help text. Reveal technical detail when useful. Support keyboard operation, visible focus and accessible icon labels.

**Current implementation:** [SettingsView](../src/SettingsView.tsx) combines core categories with available module contributions from the [frontend registry](../src/module-registry.tsx). The core covers AI connection/access, Agent, display, Dock/window behavior and module management. Mail and MCP contribute their own settings through their manifests and frontend adapters. Groups and responsive navigation are present; this is not a claim of a completed accessibility audit for every control.

Mail's current account forms live in [MailAccounts](../modules/ovd-mail/frontend/MailAccounts.tsx). MCP server forms live in [McpSettings](../modules/ovd-mcp/frontend/McpSettings.tsx). These domain forms remain with their modules rather than expanding a monolithic core settings page.

Each Mail account contains a coherent **Konto & Posteingang · IMAP** group, an independent **Absender, Signatur & Abruf** group, and **Postausgang · SMTP**. Each group's save/test actions are inside its bordered content. The local account name is distinct from the outgoing sender name. Sender/signature/polling preferences save independently without a connection test; pending IMAP/SMTP edits remain intact. The Assistant can prepare public preference changes through `accounts.preferences` and inspect one account through `accounts.preferences_get`; the user reviews and saves the form.

Module-contributed category icons can show a small attention dot, shared with the Dock. A new hint breathes briefly, then remains static; reduced motion disables breathing. Visiting a concrete module category acknowledges its currently captured hints, while later arrivals remain. See the [module attention contract](../CONTRIBUTING.md#module-attention-indicators).

## Search and extensibility

- Search across categories, including closed groups. Use labels, descriptions, IDs and common synonyms.
- Register new settings with the shared navigation/search metadata. Module providers, Mail and integrations contribute real controls; do not imply that a missing integration exists.
- Keep the settings category order separate from workspace navigation order.
- Filters for changed/advanced values, externally shareable deep links, and settings import/export are possible future additions.

**Current implementation:** [settings-registry](../src/settings-registry.ts) supplies core categories, setting metadata and normalized matching. Module settings add manifest titles, descriptions and keywords to that search. Matching groups can open temporarily while their ordinary expanded state remains separate. A module form is mounted when first visited and retained while its category is hidden, so navigation/search does not routinely discard its draft values. Disabling a module is a separate lifecycle action, not an ordinary category switch.

Internal navigation already supports opening a category or a search through the host. That should not be described as a completed external URL/deep-link or import/export feature.

### Sidebar and Dock order

The module-management category includes an expandable control for arranging the **actual available workspace navigation entries** with Up/Down actions. It uses the same catalog as the live Dock.

- Save a custom order immediately and apply it across windows and after restart.
- Append newly available contributions after saved entries when a custom order exists.
- Retain positions for disabled or temporarily unavailable entries, so reactivation restores their place.
- Reset to the module/core defaults with the standard-order action.
- Preserve keyboard focus during movement, show saving/failure state and restore the actual saved order after a failure.

**Current implementation:** [NavigationOrderSettings](../src/NavigationOrderSettings.tsx) and [shared navigation logic](../shared/navigation.ts) provide this behavior through `Settings.navigationOrder`. The assistant can use `navigation.get` and `navigation.move` through the same validated persistence path. This does not reorder the settings categories or enable disabled modules.

## Saving, recovery and security

- Apply simple preferences immediately, with errors shown and the actual saved state restored on failure.
- Save credentials and related connection settings explicitly as a coherent operation.
- Preserve unsaved input across category navigation, search and group collapse. Do not silently lose it when closing the window. Make dirty, busy, saved and failed states understandable.
- Where useful, let users reset an individual changed value or group to its default.
- Keep secrets in the OS credential store. Do not include them in summaries, search data or model context, and do not read stored values back into ordinary forms.

**Current implementation:** display preferences, Dock behavior and navigation order save immediately. AI, Agent, Mail connections and MCP server/tool settings use their respective explicit save controls. [Main-process persistence and close handling](../electron/main.ts) combine the reported dirty/busy states of those forms. In-progress operations block closing; unsaved edits use a visible discard decision. Existing password/token fields indicate stored state without returning their secret value. A save operation that fails must not be presented as completed.

A prepared assistant change is not an applied setting. For protected configuration, the assistant opens the appropriate form and supplies allowed public fields; the user reviews and saves them. Existing unsaved inputs must survive that preparation flow. MCP tool permissions likewise require an explicit save and must not be granted merely because a suggestion was displayed. See [MCP module behavior](../modules/ovd-mcp/README.md) and [architecture](architecture.md).

The saved “Without confirmations” mode (`Ohne Abfragen` in the current UI) governs individual confirmations for requested assistant actions. It does not let the assistant enable that mode itself, read credentials, or approve new/changed third-party module code. Explain immediate changes, prepared changes and user-saved access settings distinctly.

## Adding or changing settings

Follow the [module contribution contract](../CONTRIBUTING.md#building-modules) and [brand guide](brand.md). Add metadata and the matching control together, use the existing category/group structure, keep technical detail proportional, and preserve pending edits. Verify narrow-window and keyboard use, a save failure, and the corresponding assistant workflow with synthetic data. Broader filters, external deep links or import/export remain future work until their actual behavior is implemented and checked.

## Module sources and installation

The Modules category groups installed modules, sidebar ordering and [repository sources/catalogs](module-repositories.md). Source editors are expandable, preserve independent unsaved changes across category/search navigation and keep save/remove actions inside their own form. Access tokens use password fields and are never repopulated. Catalogs show per-source loading/errors and distinguish available, installed, update, conflict and incompatible states. Installation and code approval remain separate visible steps. The assistant can prepare source settings and use the same catalog/install service, without receiving credentials or bypassing fingerprint approval.
