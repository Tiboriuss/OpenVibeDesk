# Diagnostics and support reports

[Documentation](README.md) · [AI providers](ai-providers.md) · [Local credentials](getting-started.md#credential-storage)

The current checkout provides switchable local diagnostics for AI requests, including Responses streaming and Azure Foundry protocol mismatches. It is disabled by default. This is a general host feature; domain-specific preferences still belong to their modules.

## Capture a problem on the affected computer

1. Open **Settings → Diagnose → Diagnoseprotokoll** and enable **Diagnoseprotokoll aktivieren**. The choice is saved immediately and restored after restart.
2. Reproduce the issue with a new, harmless text or read-only request. Enabling logging does not retry the previous task or repeat completed actions.
3. Return to the diagnostics settings and choose **Protokoll exportieren**. Select a destination outside the app and its profile. The result is a local JSON file; OVD does not upload or send it automatically.
4. Share that file with the developer, together with what you expected to happen. Disable logging when finished if ongoing capture is unnecessary.

The same workflow works on another computer. Exporting can be cancelled without producing a report. A failed export or unavailable log storage is shown in settings. Disabling capture retains existing entries for export; **Leeren** removes them while preserving the enabled/disabled preference.

## What is recorded

Reports contain application/runtime/platform information, technical provider configuration, per-request correlation IDs, HTTP status and recognised provider request IDs, stream event types, item indexes, completion states, and specific parser failure categories. Request bodies and complete provider replies are never written to the log.

Potentially sensitive values such as message text, tool arguments, encrypted reasoning and custom identifiers are represented only by their type, length and keyed fingerprints. These fingerprints can show that two fields differ without exposing their contents. Fingerprints use a fresh in-memory key per process; do not compare them across different process sessions. Known public model names may be included, while custom deployment and endpoint identities are fingerprinted. No passwords, API keys, OAuth tokens, mail bodies or raw server error descriptions are included.

For example, a Responses error can identify `reasoning_encrypted_conflict`, `terminal_item_id_changed` or `completed_function_arguments_changed` instead of leaving only the user-facing generic error. This helps distinguish late optional metadata from an actual changed tool call. Diagnostic recording does not change protocol validation, grant tool access or execute an action.

Logs rotate across at most three files of 1 MiB each under `<userData>/diagnostics/`. Stream event sampling and individual record bounds limit growth; final outcomes and failure categories are retained independently of sampled deltas. An exported JSON report may be larger than the source JSONL because it includes formatting and environment metadata. Logs stay separate from the local credential vault and ordinary chat data.

## Assistant access

The required Assistant module offers the same controls through lazy discovery:

- `diagnostics.status`: read capture state, storage limits and write status without returning log contents.
- `diagnostics.update`: save `enabled: true` or `false` through the same settings service.
- `diagnostics.export`: open the native save dialog; the user chooses the destination.
- `diagnostics.clear`: clear local entries through the configured confirmation flow.

General `settings.update` also accepts `diagnosticsEnabled`. Neither path retries a task. Log exports are not automatically inserted into model context. The generic Files module can handle a deliberately selected export like any other local file.

## Credential storage is separate

The current checkout stores built-in connection credentials in a local encrypted vault rather than an OS credential store. The encryption key lives alongside the vault, so this avoids Keychain prompts with less protection against access to the whole profile. Existing OS entries are not automatically read or deleted. See [credential storage](getting-started.md#credential-storage) for the one-time re-entry/sign-in step and recovery limitations.
