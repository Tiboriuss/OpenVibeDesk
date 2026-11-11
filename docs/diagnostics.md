# Diagnostics and support reports

[Documentation](README.md) · [AI providers](ai-providers.md) · [Local credentials](getting-started.md#credential-storage)

OVD provides switchable local diagnostics for AI requests and host agent execution, including Responses streaming and Azure Foundry protocol mismatches. Capture is disabled by default. This is a general host feature; domain-specific preferences still belong to their modules.

## Capture a problem on the affected computer

1. Open **Settings → Diagnose → Diagnoseprotokoll** and enable **Diagnoseprotokoll aktivieren**. The choice is saved immediately and restored after restart.
2. Reproduce the issue with a new, harmless text or read-only request. Enabling logging does not retry the previous task or repeat completed actions.
3. Return to the diagnostics settings and choose **Protokoll exportieren**. Select a destination outside the app and its profile. The result is a local JSON file; OVD does not upload or send it automatically.
4. Share that file with the developer, together with what you expected to happen. Disable logging when finished if ongoing capture is unnecessary.

The same workflow works on another computer. Exporting can be cancelled without producing a report. A failed export or unavailable log storage is shown in settings. Disabling capture retains existing entries for export; **Leeren** removes them while preserving the enabled/disabled preference.

## What is recorded

Reports contain application/runtime/platform information, technical provider configuration, per-request correlation IDs, HTTP status and recognised provider request IDs, stream event types, item indexes, completion states, and specific parser failure categories. Request bodies and complete provider replies are never written to the log.

Agent records also show provider-turn boundaries, tool start/result, entry into recovery and the reason execution ended (`answer`, `handoff`, `cancelled`, `limit` or `error`). Tool results include the host's read/write/unknown policy and recorded effect when available. A random `agentRunId` connects these records to the individual provider requests; it is unrelated to saved chat or operation IDs. Tool and module names are fingerprinted, and no tool arguments, results, question text or error messages are copied. This distinguishes a provider failure from a host stop or a model answer after a tool result. A generated answer is not itself proof that an uncertain action succeeded; the operation journal remains authoritative.

Potentially sensitive values such as message text, tool arguments, encrypted reasoning and custom identifiers are represented only by their type, length and keyed fingerprints. These fingerprints can show that two fields differ without exposing their contents. Fingerprints use a fresh in-memory key per process; do not compare them across different process sessions. Known public model names may be included, while custom deployment and endpoint identities are fingerprinted. No passwords, API keys, OAuth tokens, mail bodies or raw server error descriptions are included.

For example, a Responses error can identify `terminal_item_id_changed`, `reasoning_summary_changed` or `completed_function_arguments_changed` instead of leaving only the user-facing generic error. Older reports may contain `reasoning_encrypted_conflict`: the current parser handles different valid opaque ciphertexts by selecting the completed stream item's payload rather than requiring byte equality; see [Responses compatibility](ai-providers.md#troubleshooting-and-validation-scope). This helps distinguish optional metadata from an actual changed tool call. Diagnostic recording itself does not grant tool access or execute an action.

Logs rotate across at most three files of 1 MiB each under `<userData>/diagnostics/`. Stream event sampling and individual record bounds limit growth; final outcomes and failure categories are retained independently of sampled deltas. An exported JSON report may be larger than the source JSONL because it includes formatting and environment metadata. Logs stay separate from the local credential vault and ordinary chat data.

### Context-budget records

With capture enabled, `agent.context` records the numeric result of context allocation before an agent provider turn:

| Field | Meaning |
| --- | --- |
| `requestBytes` | UTF-8 size of the serialized request envelope, sized for the complete-response fallback. A streaming envelope can be one byte smaller. |
| `estimatedInputTokens` | Conservative local estimate: one serialized UTF-8 byte counts as one input token. This is not a tokenizer or a provider usage/billing count. |
| `inputTokenBudget` | Configured total context minus the reserved answer space. |
| `outputTokenReserve` | Space reserved locally for the answer; not a universally enforced provider output limit. |
| `omittedHistoryMessages` | Additional older messages removed by total-budget allocation during this run. Earlier history-selection limits are separate. |
| `compactedResults` | Number of tool results replaced by compact historical references during this run. |

These records also carry the existing agent correlation and execution counters. They contain no raw request/result payload, resource locator, result-reference ID or reasoning ciphertext. Compaction changes only the active provider context; it does not erase saved chat history or alter journal outcomes.

If allocation cannot fit the request, `agent.context` records `limitReason: "context_budget"` with the rejected request's byte count, estimated input tokens, input budget and answer reserve; omission and compaction counters are reported only for successful allocation. The subsequent `agent.finished` record with `reason: "limit"` and `limitReason: "context_budget"` identifies a local budget stop, rather than an endpoint rejection or a completed user task. A request rejected by the transport's final guard records the same four numeric measurements in `provider.failed` with `kind: "context_budget"`; cancellation and timeout classification still take precedence. The chat retains the relevant limit measurements and a route to Agent settings. Increasing a saved budget does not resume the stopped run or repeat an action. See the [context-budget contract](architecture.md#whole-request-context-budget) for allocation, temporary result pages and provider guard behavior.

## Interpret the end of a run

| Evidence | What it establishes |
| --- | --- |
| `provider.failed` with a parser category | The provider exchange failed before producing an accepted result; inspect that category and the correlated stream records. |
| `agent.finished` with `reason: "limit"` | A configured tool, time or context budget stopped the run. The task is not thereby complete. |
| `agent.finished` with `reason: "handoff"` | The run handed control back instead of continuing automatically. |
| `agent.finished` with `reason: "answer"` | The model produced an answer. Check the visible operation status for any failed or uncertain changes. |

Use the correlated records and the reported UI behavior together. The export does not contain the answer, source contents or a universal OS/crash trace. For source-size limits and Mail cache behavior, use the [Mail guide](mail-design.md#3-reading-messages) and [performance measurements](performance-2026-11.md), rather than interpreting every incomplete read as a provider failure.

## Assistant access

The required Assistant module offers the same controls through lazy discovery:

- `diagnostics.status`: read capture state, storage limits and write status without returning log contents.
- `diagnostics.update`: save `enabled: true` or `false` through the same settings service.
- `diagnostics.export`: open the native save dialog; the user chooses the destination.
- `diagnostics.clear`: clear local entries through the configured confirmation flow.

General `settings.update` also accepts `diagnosticsEnabled`. Neither path retries a task. Log exports are not automatically inserted into model context. The generic Files module can handle a deliberately selected export like any other local file.

## Credential storage is separate

The current checkout stores built-in connection credentials in a local encrypted vault rather than an OS credential store. The encryption key lives alongside the vault, so this avoids Keychain prompts with less protection against access to the whole profile. Existing OS entries are not automatically read or deleted. See [credential storage](getting-started.md#credential-storage) for the one-time re-entry/sign-in step and recovery limitations.
