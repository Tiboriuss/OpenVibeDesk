# OpenVibeDesk maturation plan

[Documentation index](README.md) · [Architecture](architecture.md) · [Mail design](mail-design.md) · [Settings design](settings-design.md) · [Module contract](../CONTRIBUTING.md#building-modules)

**Baseline:** 28 October 2026, commit `e52f3a1`. **Last status review:** 11 November 2026, starting from `v0.1.8` / `c3905d7`. **Status:** implementation backlog with progress recorded below; package descriptions are not feature-completion claims.

Make the existing workspace dependable for daily use: an action has the same meaning in the interface and Assistant, acknowledged data survives restart, large workloads remain bounded, and failures have a visible recovery path. Keep the required Assistant and the existing optional Mail, Files and MCP modules. This plan adds no new product modules.

R01a/R01b, R02, R03 and the measured R04 changes are implemented and practically verified within the acceptance scopes recorded below. The configurable OVD-Bar is also implemented, including shared Assistant settings and exact position control. **R05 is next:** extend visible, revision-aware save recovery to the whole workspace. Truthful Mail-list paging remains under R13; incremental storage remains R08. Preserve the current architecture and improve it in small, independently usable changes.

[Starting point](#verified-starting-point) · [Delivery order](#delivery-order) · [Work packages](#work-packages) · [Milestones](#milestones-and-release-gates) · [Validation](#practical-validation-and-measurements) · [Decisions](#architecture-decisions-to-make-before-larger-changes)

## Scope and working rules

This plan covers the desktop host, Assistant/chat, Mail, Files, MCP, settings, module SDK/contract, local data, performance and distribution. Adding missing everyday functions inside an existing module is in scope. A calendar, contacts module, browser, marketplace, cloud backend, multi-user system or new autonomous agent framework is not.

- UI and Assistant call the same validated domain service. Complete each vertical slice through the actual visible result, persistence and assistant capability.
- Keep discovery lazy. Initial requests contain short module descriptions and the two discovery tools; loading content or schemas is deliberate and bounded.
- Preserve generic references, cross-window drag and drop, chat branches, account identities, drafts and accepted-send records.
- Preserve the saved confirmation mode. `Ohne Abfragen` skips individual confirmations for requested assistant actions; it does not grant access, approve changed module code or let the assistant change its own permissions.
- External content is data. Mail, files, tool output and MCP prompts cannot authorize actions or change host policy.
- Keep checks local and practical. Use synthetic profiles or designated test mailboxes and existing focused tests where relevant; do not add routine push/PR test workflows. The authorized exception is the release installer workflow and its manual packaging validation. Add a regression test only when it protects a meaningful boundary that is difficult to verify reliably by hand.
- Keep repository documentation in English and update current-scope claims after implementation. Record source verification separately from package publication and platform support.

A later user-requested extension added [module repository sources](module-repositories.md) on 29 October 2026. This is an implemented host distribution feature. The original baseline remains historical; the package status and remaining work below reflect the latest review.

**Implementation update — 29 October 2026:** R01a's text-only answer reformulation and bounded evidence capture, plus R01b's separate durable action journal, optional module recovery hooks and restricted explicit continuation, are implemented and practically verified in [commit `cae81b5`](https://github.com/Tiboriuss/OpenVibeDesk/commit/cae81b5e8379ee3c39f2d2e5b43dc1c4b61d694f). Evidence is recorded under [R01](#r01-safe-regeneration-and-operation-lifecycle). Current behavior is described under [answer reformulation](architecture.md#answer-reformulation) and [durable operations](architecture.md#durable-operations-and-explicit-continuation). R05's broader workspace-save recovery remains unfinished.

**Implementation update — 30 October 2026:** [v0.1.2](https://github.com/Tiboriuss/OpenVibeDesk/releases/tag/v0.1.2) includes autonomous Mail research with Workspace tools enabled, without per-message selection or a separate general-mail access switch. Tool transport accepts batches beyond the former hidden eight-call cap and can use the configured non-streaming fallback for malformed, missing or oversized call fields before dispatch; completed actions are retained. These fixes do not implement R02's whole-request context budget or remove bounded transport checks. External modules can resolve context and explicitly selected instruction references through the shared contract; R10 still tracks compatibility and lifecycle gaps. macOS arm64/x64 and Windows x64 installers, checksums and release metadata were produced successfully; trusted publisher signing and full platform/upgrade validation remain open under R20.

**Review update — 11 November 2026:** the [product and host review](project-review-2026-11.md) records the source audit, primary research, practical scope and corrections. UI density, minimum-size layouts, retained form values, module cancellation outcomes, crash recovery and window bounds were improved. Since the original baseline, provider diagnostics, direct ChatGPT sign-in, Azure compatibility fixes, prompt-free local credential storage, module memory retrieval/events and MCP OAuth have also been implemented; see their current guides. The review led to the R02–R04 implementation recorded below. R05, R07, R08 and R10 remain open.

**Context follow-up — 11 November 2026:** R02 implements global validated context settings, exact serialized request bounds, whole-exchange compaction, run-local result paging and terminal budget stops. [R02 below](#r02-budget-the-entire-provider-request) records its practical evidence. It bounds outgoing requests without automatically detecting provider/model limits. Underlying source continuation is covered by the completed R03 slice, while R13 still covers the Mail list's paging contract.

**Source-reading follow-up — 11 November 2026:** R03 adds underlying MIME text continuation, revision-bound local draft text/list pages, a compact Mail text reader and exact saved-source rehydration. This is separate from R02's temporary tool-result cache. Implementation and fifteen practical application checks are complete, including a fresh-process restart. [R03 below](#r03-complete-content-through-bounded-continuation) records the limits and acceptance scope. R04 subsequently measured and reduced retention and window traffic without replacing storage.

**Memory and traffic follow-up — 11 November 2026:** R04 now has before/after measurements and practical checks for bounded Mail body retention, sender-derived window projections, Chat/session paging and bounded Files identities/pages. Full canonical history, source references and storage acknowledgements remain intact. See [R04 below](#r04-bound-memory-and-reduce-cross-window-traffic) and the [measurement report](performance-2026-11.md). R05 is the next package; the whole-database storage strategy remains unchanged.

**OVD-Bar follow-up — 11 November 2026:** the user-prioritized desktop launcher update adds vertical/horizontal layout, adjustable size/background opacity, anchored/free placement, optional idle collapse and shared Assistant controls. `settings.update` changes its configuration; lazy `bar.get`/`bar.move` capabilities inspect displays and persist an exact free position. Entry ordering now lives in **Settings → OVD-Bar**. Settings failure/retry, keyboard access, module attention, safe reveal clicks, simulated display recovery and fresh-process restoration were checked. The [OVD-Bar guide](ovd-bar.md) describes behavior and verification scope. This completes a contained desktop/settings slice; R05 remains the next reliability package, and broader R16/R18 accessibility work remains open.

## Verified starting point

These are source observations at the original baseline, with selected later progress noted. The [architecture](architecture.md) contains the full current behavior and limits; the [November review](project-review-2026-11.md#review-method-and-coverage) states which paths were practically rechecked.

| Area | Already implemented | Maturation gap |
| --- | --- | --- |
| Assistant execution | Streaming, stop, configurable limits, lazy tools, frozen offers and explicit outcomes. | Operation recovery and safe regeneration were gaps at baseline, now implemented under R01. Whole-request budgeting and source continuation are implemented and practically verified under R02/R03. |
| Chat and references | CommonMark/GFM, sessions, branches, persisted snapshots, paged chat/file reads, compact session pages and generic drag identities. | Richer reference inspection, explicitly expanded-history scale and consistent visible save recovery outside the existing acknowledged paths. |
| Mail reading | Real accounts, folders, search/query/count, read status, attachments, isolated HTML/text reader and per-message image control. | R03 adds long-message reading; R04 bounds aggregate preview/CID retention and releases inactive payloads. Everyday mutations remain open. |
| Drafts and sending | Local save status/recovery, complete bounded draft reads/list pages, per-account signatures, SMTP outcome handling, prepared MIME, separate Sent filing/reconciliation and draft/outbox/history classification. | Managed attachment recovery, reply-all/forward and richer composition. |
| Mail synchronization | UID/UIDVALIDITY checks, bounded server queries and session memory. | Persistent cache, incremental sync, offline reads and explicit conflict handling. |
| Files | OS-accessible paths, browse/sort/filter, paged UTF-8 reads, chat references and draft attachment handoff. | R04 bounds temporary identities and displayed pages. Large-folder enumeration cost, missing/changed source UX and a small set of everyday file actions remain. |
| MCP | Stdio/Streamable HTTP, saved credentials, explicit tool approvals, lazy virtual sources and bounded activity. | OAuth is now implemented under R19; current protocol compatibility, broader status/recovery and bounded resource/prompt integration remain open. |
| Module host | Manifests, approval fingerprints, process isolation, own views/settings and typed capabilities. | External reference resolution is now implemented; contract versioning and complete dirty/busy lifecycle integration remain open under R10. |
| Settings and desktop | Searchable categories, compact retained forms, account groups, adjustable OVD-Bar with entry ordering and close guards. | Consistent recovery, broader keyboard/assistive-technology coverage and finer state subscriptions. |
| Persistence and release | Atomic workspace snapshots, credential storage and packaging scripts. | Provider diagnostics and the local encrypted vault are now implemented; versioned migrations, backup/restore and verified signed releases remain open. |

### Concrete findings that determine the order

1. At the baseline, [response regeneration](../src/NativeApp.tsx) forked the request and sent it through the normal agent path again. Mail had domain-specific resend guards, but generic mutations could be requested again. R01a replaces that route with a host-enforced text-only operation; its practical acceptance is tracked below. Rewriting an answer and executing a new task have separate semantics.
2. At the baseline, [the agent loop](../electron/agent.ts) bounded initial history, individual results and schemas separately, but not their combined outgoing request. R02 now bounds the complete serialized request, with the practical evidence recorded below.
3. At the baseline, [Mail capabilities](../modules/ovd-mail/backend/capabilities.ts) exposed `mail.read` as a 12,000-character snapshot without continuation; `drafts.get` had the same body limit and `drafts.list` stopped at 50. Live mail resolution depended on session memory. R03 now supplies source-bound continuation and saved locators rather than simply increasing those result limits. The [preview loader](../modules/ovd-mail/backend/mail-service.ts) still caps plain text at 20,000 characters and HTML at 128 KiB, independently of the new full-text path.
4. At the baseline, [Mail session caching](../modules/ovd-mail/backend/index.ts) limited metadata entries to 1,000 but retained all opened bodies without an aggregate byte budget. R04 now separates metadata from a byte-budgeted body/CID cache and one selected renderer body; see the measured limits below.
5. At the baseline, [main-process commits](../electron/main.ts) broadcast complete workspace state to native windows. R04 now projects and caches each window's required state. The [store](../electron/store.ts) still serializes workspace JSON and exports the complete SQLite database. Generic autosave errors are logged; they do not have the draft editor's visible recovery contract.
6. [Files listing](../modules/ovd-files/backend/file-service.ts) still enumerates and stats the directory before returning each page. R04 replaced the previously growing temporary path maps with a 2,048-entry LRU, bounded visible/selected pins and a separate durable reference index. Avoiding repeated directory scans remains R17. Path-derived IDs identify a location; snapshots and source versions must distinguish replacement or disappearance.
7. The installed `@modelcontextprotocol/sdk` version is `1.32.2`, with protocol support through `2025-11-25`. The official current protocol is `2026-07-28`, which changes discovery and request metadata. Current-protocol support needs an explicit migration and interoperability check. See the [official versioning guidance](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning).

## Delivery order

**P0** protects the existing product from repeated actions, inaccessible content, unbounded growth or invisible data loss. **P1** completes daily workflows and their supporting infrastructure. **P2** adds polish after those foundations work.

Sizes express relative scope, not dates: **S** is a contained change; **M** crosses a few existing boundaries; **L** requires several independently reviewable slices. Split every L package before implementation. Packages remain **planned** unless a progress entry states otherwise. Record completion against the acceptance criteria, not merely a merged schema or button.

| Package | Priority | Size | Dependencies | Deliverable |
| --- | --- | --- | --- | --- |
| R01a | P0 | M | None | Tool-free answer reformulation and bounded evidence; implemented and practically verified |
| R01b | P0 | L | Separate journal; broader workspace recovery remains R05 | Durable operation identity, reconciliation and restricted continuation; implemented and practically verified |
| R02 | P0 | M | None | Whole-request context budget; implemented and practically verified |
| R03 | P0 | M | None | Complete bounded mail/draft retrieval; implemented and practically verified |
| R04 | P0 | M | None | Measured memory and IPC budgets; implemented and practically verified |
| R05 | P0 | M | None | Visible save failures and restart recovery |
| R06 | P0 | M | None | Host/content boundary verification |
| R07 | P0 assessment, P1 migration | M | None; R01 before retry changes | MCP protocol compatibility |
| R08 | P1 | L | R04 measurements, R05 | Incremental storage and migrations |
| R09 | P1 | M | R05; R08 for migrated storage | Backup, restore and retention |
| R10 | P1 | L | R01 lifecycle contract, R05 | Complete versioned module contract |
| R11 | P1 | L | R01, R03, R05 | Everyday mail actions |
| R12 | P1 | L | R04, R08, R09; R11 before queued mutations | Mail cache and synchronization |
| R13 | P1/P2 | M | R03, R11; R12 for offline search | Consistent mail search and conversations |
| R14 | P1/P2 | L | R03, R05; R08/R09 for managed files | Composition and attachment recovery |
| R15 | P1 | M | R06; provider registration | Mail account authentication |
| R16 | P1 | M | R01, R02, R05 | Chat, references and desktop interaction |
| R17 | P1 navigation/scale, P2 operations/previews | L | R04; R01/R05 before mutations | Files usability and scale |
| R18 | P1 | M | Integrate alongside each package | Settings and accessibility consistency |
| R19 | P1 tools/auth, P2 content | L | R01/R07 for tools/auth; R08 for log; R10 for resources | MCP operational completeness |
| R20 | P1 macOS, P2 other platforms | L | Relevant gates below | Reproducible development and releases |

**R01a/R01b and R02–R04 are implemented within their recorded acceptance scopes. R05 is next: extend visible, acknowledged save recovery to the whole workspace.** The Mail-list paging contract remains under R13, and R05–R07 can progress independently. The journal's scoped durability does not finish R05's workspace-wide recovery or require waiting for R08's database migration. Everyday online Mail actions can ship before full offline synchronization. UI/accessibility improvements ship with each change rather than accumulating at the end.

## Work packages

### R01 Safe regeneration and operation lifecycle

**Outcome:** regenerating prose never silently repeats a completed external action.

Keep three intents separate: rewrite an answer from recorded results, continue unfinished work, and explicitly start a new execution. R01a now implements a host-enforced tool-free regeneration path using the saved request, answer, reference snapshots and bounded domain-result evidence. It creates a new branch without rediscovering tools or rereading current sources. **Without confirmations** cannot turn this operation into an agent run. Old history without usable evidence shows a limitation before a branch or provider request is created, instead of replaying the request. Editing a request prepares a separate new execution only when the user sends it. The shared `chats.reformulate` capability queues the same text-only operation after the current agent finishes successfully, avoiding recursive execution; stop, error or limit discards the queued request.

New answers retain at most 24,000 serialized evidence characters, with at most 8,000 characters per result, plus honest truncation and outcome metadata inside that bound. Schemas, discovery catalogs and tool arguments are excluded; ordinary history context does not automatically expand these records. A reformulation uses historical evidence only and must preserve failed, cancelled and uncertain outcomes. This is evidence for rewriting an answer, not an action journal or a guarantee of exactly-once remote execution. **R01a status:** implemented and practically verified in commit `cae81b5` (linked in the implementation update above). A future extension may permit explicitly classified local reads. Existing interaction metadata and remote MCP read-only annotations are not proof that a tool has no effects.

R01b now implements host-generated run/action/attempt IDs, resource/version binding, timestamps, durable outcome records and optional module preparation/reconciliation hooks. Its independent unencrypted `<userData>/operation-journal/operations.json` acknowledges an intent and dispatch boundary before execution and stores terminal outcomes afterwards. It retains ordinary frozen arguments and bounded redacted results, with sensitive argument keys rejected; whole journals do not enter default model context. Corruption, storage limits and write failures stop new actions while preserving prior guards. Restart converts running effects to uncertain and never resumes a task automatically. **R01b status:** implemented and practically verified in commit `cae81b5` (linked in the implementation update above). This slice does not complete R05 or establish a safe backup/restore policy.

UI and Assistant have separate rewrite, continue and new-request entry points. Explicit continuation can reuse completed matching historical outcomes, retry only eligible original unfinished steps with unchanged resource/code/schema/approval bindings, and use trusted effect-free reads. `operations.retry({actionId})` selects one saved step inside that continuation; the host retrieves its exact arguments without sending a bulk argument catalog to the model. It is rejected outside an explicit continuation and retains the original logical action ID with a new attempt when a retry is allowed. An unplanned write requires a new explicitly submitted user request. Unknown effects require the owning module's authoritative status hook or stay blocked; no original-tool fallback is allowed. MCP's stable server/tool/configuration identity is separate from offered connection names, and remote read-only annotations do not make it a trusted read. Mail's adapter reuses existing SMTP/Sent guards and performs no SMTP or APPEND in status reconciliation. Other domain mutations without a reliable status hook remain blocked when uncertain.

Use explicit running, completed, failed, cancelled and uncertain states. Cancellation stops new work and requests cancellation of in-flight work; it is not rollback. Idempotency applies only where the domain or remote service supports it. A local journal cannot guarantee exactly-once remote execution across a crash.

**R01a practical acceptance — verified on 29 October 2026:** an isolated Electron profile, local synthetic provider and explicitly approved process module exercised the real UI and Assistant path. Sending a request through lazy discovery performed one synthetic module write. Repeated UI reformulation, another reformulation after a fresh-process restart and an actual Assistant request through `chats.reformulate` left the write counter at one. Reformulation provider requests contained no tools. An unsolicited provider tool call was rejected without an effect. A legacy answer without evidence created neither a branch nor a provider request. Original history and reference snapshots, unsent composer text and reference selection, Markdown/copy behavior, recorded evidence, provenance and the saved **Without confirmations** mode were retained across the relevant navigation/restart checks. This demonstrates the generic host boundary; no separate SMTP or MCP transport send/write was exercised, and their domain-specific guards were unchanged.

**R01b practical acceptance — verified on 29 October 2026:** thirteen scenarios across two fresh-process stages used an isolated Electron profile, local synthetic provider and explicitly approved process module. The actual UI sent a request with acknowledged intent before one write, then continued by reusing that write and retrying only the failed trusted read with the same logical action ID and a new attempt. A post-effect exception and actual UI Stop preserved uncertainty; continuation was refused until a separate receipt/status check resolved it without invoking the write. Authoritative non-application enabled `operations.retry` with the exact host-stored arguments. Changed resource versions, changed approved code and new unplanned writes were rejected without another module effect. Injected pre-intent persistence failure produced a visible error and zero invocations. A forced exit after one effect restored the same IDs as uncertain in a fresh process, preserved **Without confirmations** and started no work automatically. An actual Assistant request discovered `chats.continue` and handed off to the same guarded workflow. R01a reformulation remained a separate tool-free operation after journal integration. These scenarios establish the generic host/process-module boundary; they do not claim real SMTP or MCP transport interoperability, complete R05 recovery, or exactly-once remote execution.

Three additional Mail integration checks used a separate isolated profile and synthetic SMTP/IMAP service stubs. An actual agent batch updated a draft and sent its updated content once, validating the initial resource-version handoff between those steps. A subsequent provider failure followed by explicit continuation reused the accepted send record without another SMTP or APPEND call. A failed Sent-filing action reconciled from the existing persisted guard without any SMTP or APPEND invocation by the status hook. No real mailbox, mail transport or user profile was used.

**Implementation seam:** [agent loop](../electron/agent.ts), [chat entry points](../src/NativeApp.tsx), [host](../electron/main.ts), [tool outcomes](../electron/agent-tools.ts), [shared model](../shared/model.ts).

### R02 Budget the entire provider request

**Outcome:** a long tool run remains within a declared context envelope without losing the user's task or important action outcomes.

**Status — 11 November 2026:** implemented and practically verified. The [current contract](architecture.md#whole-request-context-budget) budgets the complete serialized provider request: instructions, current request, reference and memory snapshots, history, tool schemas, arguments/results and opaque provider items. All provider paths, including text-only reformulation and non-streaming fallback, enforce the wire bound before sending.

The global Agent settings use `contextTokenBudget` (default 128,000; range 16,000–2,000,000) and `outputTokenReserve` (default 8,192; range 1,024–65,536), with at least 4,096 left for input. Every serialized UTF-8 byte counts as one conservatively estimated input token; the hard byte ceiling is total minus reserve. These settings do not detect a model's context window or use its tokenizer. The reserve leaves local room for an answer; it does not impose a universal provider output limit or add `max_output_tokens` to the ChatGPT connection. The Assistant may prepare changes, but the user saves them for subsequent runs.

The allocator removes oldest history first, then compacts whole fully answered tool batches into untrusted provenance/outcome references. Current request, system instructions, memory and reference snapshots stay unchanged. Retained opaque reasoning items remain unchanged and may only be removed with their whole batch. Compaction does not replay a call, rewrite saved snapshots or erase completed/uncertain action records. Existing step/time, result and lazy-discovery limits still apply.

The lazy, read-only host tool `read_tool_result` pages the exact already-bounded, sanitized result retained in the run, up to 6,000 UTF-16 code units per call without splitting surrogate pairs. It never rereads a source or invokes its module. Handles expire after the run. Returned pages can enter bounded saved answer evidence under `read_tool_result` (8,000 characters per result, 24,000 overall, with explicit omissions); they are not domain journal actions. The durable journal separately retains bounded results for recovery. If protected content still cannot fit, `context_budget` ends the run with retained outcomes and measured limits. Changing a budget never resumes work automatically.

**Practical acceptance — verified on 11 November 2026:** eleven isolated Electron checks exercised a run with 80 results of about 24,000 characters, five exact result pages including a Unicode tail, preservation of completed and uncertain writes with each dispatched only once, rejection of an expired prior-run handle, oversized current requests/references with zero provider fetches including the text-only path, and no automatic resume after a setting change. Serialized requests stayed within the configured envelope. Bounded saved evidence retained a read page's tail and provenance; actual answer reformulation used that evidence without offered tools, new module calls or journal changes. An oversized reformulation stopped before provider/module calls and left saved evidence unchanged. Settings were separately exercised through the real UI, Assistant preparation and restart, including invalid pairs, retained edits and narrow/high-zoom layouts. These local checks do not establish live provider model limits or complete source-content retrieval.

**Implementation seam:** [context allocation](../electron/agent-context.ts), [provider serialization](../electron/provider-request.ts), [context assembly](../electron/ai.ts), [agent loop](../electron/agent.ts), [tool runtime](../electron/agent-tools.ts), [agent settings](../shared/agent-settings.ts). [Diagnostics](diagnostics.md#context-budget-records) record numeric budget measurements without raw payloads. The just-in-time retrieval approach follows [Anthropic's context engineering guidance](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents); the estimator and recovery rules are OVD design decisions. Provider-aware tokenization or per-model limits would be a separate extension.

### R03 Complete content through bounded continuation

**Outcome:** the Assistant can read the end of a long email or draft and enumerate all local drafts without receiving everything at once.

**Status — 11 November 2026:** implemented and practically verified. Run-local R02 paging cannot recover source text omitted by the original tool result. R03 reads underlying content through its own stable continuation contract.

`mail.read` now accepts a source-bound cursor and 2–6,000-unit page size, default 4,000. It reports offset, returned and total characters, decoded source bytes, version, observation time, completeness and continuation. Every page validates the exact server UID and UIDVALIDITY, including cached pages. Full-text extraction preserves MIME decoding and Unicode boundaries, prefers plain text, and converts the complete permitted HTML part for HTML-only messages instead of paging the preview fallback. `show: true` opens the same source section in the compact Mail text reader, also reachable through **Vollständigen Text lesen**, with previous/next and return-to-preview controls.

New saved mail references include validated account ID, connection hash, folder, UIDVALIDITY and UID. The adapter binds these to the original resource ID before rehydrating exact-UID metadata independently of the live list. It never searches for a replacement by subject or sender. Failed rehydration preserves the historical snapshot. Older locator-free references remain snapshot-only until the original message is selected again.

Source limits are separate from preview limits: decoded plain text up to 8 MiB, HTML up to 4 MiB, a 32 MiB declared-part/download boundary, and at most 16 MiB of UTF-16 spool data. The completed-spool cache holds four entries, expires idle entries after five minutes, and permits two concurrent fills. Text pages stay within a 16,000-character serialized envelope. Oversized sources fail explicitly while the preview remains usable. Temporary unencrypted files are removed on normal expiry/eviction/exit; abnormal-exit cleanup is best-effort on a later read, not guaranteed immediate erasure. Cancellation propagates into I/O, shared consumers cancel independently, and obsolete account work/cache is invalidated. See the [current implementation and temporary-file lifecycle](architecture.md#complete-mail-and-draft-text).

`drafts.get` pages the complete local body with a revision-bound cursor, default/max 6,000 UTF-16 units and minimum 2. `drafts.list` uses a scope- and collection-bound cursor with stable update-time/ID sorting, exact totals and up to 50 records per page. Both bound serialized results to 24,000 characters and shorten a page rather than dropping continuation. Changes invalidate old cursors; attachment paths are omitted and ancillary metadata excerpts are explicit. The complete editor and existing save/send/filing services remain unchanged.

**Practical acceptance — verified on 11 November 2026:** fifteen isolated Electron checks exercised the real Mail UI, Assistant discovery/dispatch, installed ImapFlow MIME decoding and persisted workspace. The reader and Assistant reached an exact Unicode tail beyond 20,000 characters in a plain-text source of 38,035 UTF-16 units delivered with base64 encoding, and the Assistant reached an HTML-only tail beyond the 128 KiB preview boundary in a part of 220,171 decoded bytes delivered with quoted-printable encoding. Repeated `show: true` requests navigated the same selected Mail reader to successive source sections; previous-page and return-to-preview controls worked. An additional check confirmed identical Assistant/UI text and ranges for the default 4,000-character page and a subsequent custom 2,000-character page. The Assistant read draft text beyond 12,000 characters without attachment paths, enumerated all 56 drafts including draft 51 without gaps/duplicates, and received errors for changed draft and collection cursors.

The identity-only Mail drag persisted a bounded snapshot and validated source locator. A fresh process restored that actual SQLite workspace and rehydrated the exact mail without listing the mailbox or replacing the saved snapshot. Changed UIDVALIDITY rejected the cursor before downloading another message; changing the account connection through Settings rejected the old locator while retaining its snapshot. Concurrent consumers shared one full-text transfer; cancelling one left the other intact, while cancelling the last closed the in-flight transfer. These checks used synthetic data and transport fixtures, without accessing real mail or external services. They establish this source-reading path, not full IMAP synchronization, unbounded content support or R04's aggregate preview/CID memory behavior.

**Implementation seam:** [mail service](../modules/ovd-mail/backend/mail-service.ts), [content spool](../modules/ovd-mail/backend/mail-content-store.ts), [draft content](../modules/ovd-mail/backend/draft-content.ts), [mail capabilities](../modules/ovd-mail/backend/capabilities.ts), [mail host](../modules/ovd-mail/backend/index.ts), [source locators](../shared/mail-source.ts), [page contract](../shared/mail-content.ts).

### R04 Bound memory and reduce cross-window traffic

**Outcome:** browsing image-heavy mail or long chats does not continuously increase memory or make other windows sluggish.

**Status — 11 November 2026:** implemented and practically verified, following measurements of the frozen R03 build. The [full measurement record](performance-2026-11.md) distinguishes payload budgets, renderer heap, IPC bytes and timing limits.

- Mail now separates metadata from a byte-budgeted body/CID cache: 16 MiB encoded strings and 32 MiB conservative UTF-16-plus-image cost, with at most one pinned selection inside the budgets. Lists and notifications carry metadata; the renderer owns one selected body. Closing Mail, removing an account and disabling the module release the relevant payloads. Saved source identity and display preferences survive eviction; late reads cannot repopulate a closed cache.
- Verified-sender window projections carry only required state and skip unchanged broadcasts. The initial active Chat page contains 100 messages, with explicit earlier-history loading and scroll-anchor preservation. Compact session pages use full canonical content search, shared by the UI and the Assistant's revision-bound `chats.list` continuation. Full Host history/evidence remains authoritative for persistence, tools, references, branches and reformulation.
- Files no longer retain every entry scanned in a directory. Returned identities enter a 2,048-entry LRU; the real Files window pins its bounded visible page and selected preview separately. Durable reference paths remain independent. Previous/next server pages replace the ever-growing rendered list, and selection survives page changes. Ordinary enumeration no longer populates the explicit native-picker selection set; UI and Assistant attachment handoff remain available for known files.

**Practical acceptance:** the same 60-mail HTML/CID fixture plateaued at eight cached bodies and reduced renderer JavaScript heap from 87.35 MB to 6.47 MB. Refreshed list payload fell from 91.44 MB to 40.1 KB; closing Mail released all retained body bytes. With 31 sessions and 1,500 messages across five windows, twelve draft updates dropped from 117,190,030 to 5,498 serialized IPC bytes; twenty stream chunks dropped from 234,553,860 to 1,847,990. Initial Chat DOM nodes fell from 11,489 to 1,990. Existing source-continuation, reference/restart and independent cancellation checks still passed.

Four initial visits to 3,000-file directories retained 368 temporary identities instead of 12,004; 6,000 further returned identities reached the 2,048 limit while visible/selected and saved-reference reads remained usable. Eight more UI page requests retained 91 rows instead of 819. Actual Assistant discovery/read/open, reference drag, draft attachment and module-disable paths were exercised with synthetic data. Input measurements improved for these fixtures; they are not universal latency claims or full accessibility certification.

The store's 5.6 MB fixture still uses whole-database serialization/export. Save timings did not justify folding a storage migration into this change; visible durability and incremental storage remain R05/R08. Explicitly expanded Chat history, large-folder enumeration, complete process/GPU memory bounds and the Mail list's 500-row navigation behavior remain outside this acceptance. This measurement-first approach follows [Electron's performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).

**Implementation seam:** [window projections](../electron/workspace-view.ts), [host](../electron/main.ts), [Mail body cache](../modules/ovd-mail/backend/mail-body-cache.ts), [Mail view](../modules/ovd-mail/frontend/MailWorkspace.tsx), [file identities](../modules/ovd-files/backend/file-service.ts), [Files pages](../modules/ovd-files/frontend/FilesView.tsx).

### R05 Visible durability for the whole workspace

**Outcome:** “saved” consistently means the exact relevant revision was acknowledged on disk.

**Status — next package:** drafts and the operation journal already have dedicated durability contracts. General settings writes are serialized and published after persistence; the OVD-Bar form also retains failed edits and offers retry. Those contained paths do not provide a common save/error/retry contract for chat history, composer recovery and the remaining workspace mutations. Some delayed workspace checkpoints still only log failures.

Extend the existing draft save contract to chat completion, pending composer text/references and important settings changes. Surface saving/error/retry states; preserve unsaved input and avoid reporting completed persistence after a failed write. Use revision-aware acknowledgements and shared close/quit guards. Coalesce streaming checkpoints without letting continuous activity postpone durability indefinitely.

Validate loaded records before use. On unreadable/corrupt data, preserve the original and offer recovery; never silently replace it with an empty workspace. Interrupted runs remain distinguishable from completed answers. Preserve R01b's independently acknowledged operation journal while extending save recovery to the rest of the workspace; changes to R08 storage must retain its intent/outcome guards.

**Acceptance:** injected disk-full, permission and interrupted-write failures are visible, keep unsaved content and recover on retry. Restart restores the acknowledged chat/draft/reference revision without duplicate provider requests. Closing a busy/dirty window follows one understandable policy.

**Implementation seam:** [store](../electron/store.ts), [host](../electron/main.ts), [chat composer](../src/NativeApp.tsx), [draft persistence reference implementation](../modules/ovd-mail/backend/draft-persistence.ts).

### R06 Verify host and untrusted-content boundaries

**Outcome:** maturation preserves the boundary between displayed content and privileged workspace actions.

Map each IPC endpoint to allowed window/frame identity, input validation and domain permission. Check main-frame versus child-frame senders, external URL schemes, navigation, popup and permission handling. Keep HTML sanitization, CSS restrictions, iframe sandbox and network policy together; improving sender-layout fidelity must not weaken external-image consent or expose preload APIs. Verify dependency fixes and selected Electron fuses in packaged builds. Evaluate replacing application `file://` loading with a restricted custom protocol as a contained host change.

Treat these as verification and targeted hardening tasks, not claims that all listed problems currently exist. Approved module/MCP processes remain ordinary user processes; declared permissions are not an OS sandbox. A real OS sandbox would require a separate design decision.

**Acceptance:** synthetic malicious HTML, forged frame messages and invalid links cannot invoke host capabilities or load tracking resources before permission. Legitimate Mail/Chat links and external module views still work. A small compatibility corpus covers newsletter tables, Unicode/charsets, quoted threads, missing CID images and long links at 450px and increased zoom. Build/update changes preserve this evidence. Basis: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [DOMPurify's integration guidance](https://github.com/cure53/DOMPurify).

### R07 MCP protocol compatibility

**Outcome:** supported server versions are explicit and checked, including existing installations.

**Rechecked 11 November 2026:** installed SDK `1.32.2` still declares `2025-11-25` as its newest protocol. The official current version is `2026-07-28`. This establishes a modern-only interoperability gap, not a failure of every existing legacy/dual-era connection. No SDK upgrade was made during the UI/host review.

First record an interoperability matrix for installed SDK, negotiated protocol, Stdio/HTTP transport and supported features. Compare the `2025-11-25` handshake path with `2026-07-28` request metadata and `server/discover`. Select an SDK/adapter migration only after exercising both eras with local synthetic servers. Pin and document the chosen version; do not advertise current support based on package recency alone.

Retain approval/schema identity checks across discovery, reconnect and protocol negotiation. Distinguish a rejected pre-execution version request from an unknown outcome after a tool request; compatibility fallback must never become a mutation retry. Unsupported versions or extensions get actionable status.

**Acceptance:** legacy and modern fixtures connect, list approved tools and execute a harmless request through UI/Assistant. A changed schema is rejected until reviewed. Unknown versions fail clearly; disconnect after a synthetic write never produces a second write.

**Implementation seam:** [MCP service](../modules/ovd-mcp/backend/service.ts), [provider contract](../shared/module-tool-provider.ts), [package manifest](../package.json). Reference: [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning) and the [July 2026 specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

### R08 Incremental storage and migrations

**Outcome:** larger histories and a future mail cache do not require rewriting one complete workspace blob for every update.

Write a short architecture decision comparing the existing `sql.js` snapshot path with an incrementally persisted SQLite connection owned by a dedicated worker/process. Validate Electron packaging, native dependency support, transaction durability and migration recovery before choosing a driver. Introduce versioned schemas incrementally for sessions/messages, references, drafts, operations and module-owned metadata. Preserve public IDs and existing save acknowledgements.

Use one controlled writer, short transactions and explicit durability settings. Keep MIME bodies and attachments in bounded managed storage with transactional references and orphan cleanup. If WAL is chosen, define checkpoint, busy and backup behavior; do not merely add a WAL pragma to the current in-memory export design. SQLite documents both WAL concurrency benefits and its operational constraints in [Write-Ahead Logging](https://www.sqlite.org/wal.html).

**Acceptance:** migration of a populated synthetic profile preserves content/IDs and sent/uncertain guards. Forced failure before, during and after migration leaves a recoverable original or validated new store. Old binaries refuse unsupported schemas instead of overwriting them. Writes scale with changed data; checkpoint behavior meets the agreed responsiveness targets under the large-history fixture below.

### R09 Backup, restore and data retention

**Outcome:** users can recover their local work and understand which content remains on disk.

Provide a consistent backup of workspace records, module data and managed draft/outgoing files, with format version, manifest and integrity checks. Exclude credentials by default and explain reconnection requirements. Offer a reviewable restore flow and preserve the existing profile before replacement. The Assistant may prepare backup/restore and inspect status through the same service; destructive replacement follows the host's applicable confirmation and data rules.

Restoring an older snapshot must not erase evidence of later external actions. Preserve/merge newer local operation and delivery records where available. On a clean restore without that evidence, show the backup cutoff and mark restored actionable records as historical/unverified until reviewed or reconciled; do not silently restore an old unsent draft as a fresh executable operation. A backup cannot establish whether later SMTP/MCP effects occurred. Never auto-resume restored tasks.

Add usage summaries and separate retention controls for expendable mail cache, chat snapshots, drafts, diagnostics and outgoing evidence. Never remove accepted/uncertain-send guards merely because a history row is hidden. Keep necessary minimal operation evidence until its retention policy can preserve replay protection. State clearly that the current database is unencrypted. Decide at-rest encryption and key/backup recovery before enabling a large durable mailbox cache by default.

**Acceptance:** restore into a clean synthetic profile and recover chats, branches, refs, drafts and filing state without sending. Exercise backup → synthetic SMTP/MCP write → restore older backup: no automatic/retry write and no silent reset of accepted work to sendable. Corrupt/incompatible backups fail before replacement. Cache cleanup leaves source mail and user files intact. Use a consistent snapshot mechanism such as SQLite's [backup API](https://www.sqlite.org/backup.html), not an arbitrary live database-file copy.

### R10 Complete the existing module contract

**Outcome:** an external module can participate in references, settings, recovery and Assistant control without new core special cases.

**Review progress — 11 November 2026:** runtime-failed modules can be disabled and reactivated with a fresh process; changed code still requires approval. Declined module changes now remain cancelled without an applied journal effect. This does not add a generic dirty/busy/close bridge or a dedicated runtime-failed status.

Version the host API and declare supported compatibility ranges. Define input/output validation, bounded continuation, stable resource identity, error/outcome codes and cancellation. R01b now supplies optional operation preparation/reconciliation hooks. A bounded process-module reference resolver and request-scoped instruction references are also implemented through explicit manifest contributions; a type declaration without a snapshot function still does not imply that content resolution works. Extend the isolated view/settings bridge with dirty/busy/save/close lifecycle reporting and recoverable disable/shutdown behavior.

**Reference/skill review follow-ups — 29 October 2026:**

- Add a shared Assistant capability for preparing a generic module reference in the chat composer. The module-view bridge can currently select its own reference, but there is no equivalent generic Assistant action. Preparing an instruction reference must not activate it in the running request; a later explicit user submission applies it.
- Validate an original request's instruction references before creating/selecting a continuation branch, or remove that branch on preflight failure. Currently a changed, deleted or disabled skill is rejected before a provider call but can leave an empty continuation chat.

Keep code-fingerprint approval, per-module data ownership, frozen tool offers and lazy discovery. Return useful invalid-manifest and compatibility diagnostics. Separate runtime-failed state from invalid-package state, and expose controlled restart/rescan through one UI/Assistant service. Split large built-in adapters along actual domain services as they change; avoid a wholesale rewrite. Maintain a small UI-action-to-capability matrix in the contribution guide.

**Acceptance:** extend the existing [Notes example](../examples/notes-module/README.md), without adding another example module, to exercise reference → Chat → paged read → reopen, unsaved settings, cancellation, crash and disable. Restarting a crashed module restores availability without replaying its previous call. Changed code requires approval; saved snapshots remain readable when the module is absent. The required Assistant remains available.

**Implementation seam:** [module types](../shared/modules.ts), [host](../electron/module-host.ts), [runtime](../electron/module-runtime.ts), [reference registry](../electron/module-references.ts), [view bridge](../src/ModuleViewHost.tsx).

### R11 Everyday mail actions

**Outcome:** the current Mail module supports routine organization through the same UI and Assistant actions.

Implement in small slices: flag/unflag, move, archive, move to Trash and restore. Add account-level special-folder mapping with server metadata first and explicit fallback selection. Use UID-based operations and negotiate server support; never use a broad EXPUNGE as a casual fallback that could remove unrelated messages. Preserve destination identities and report partial batch outcomes. Add multi-selection after single-message behavior is reliable; permanent deletion and folder editing follow with explicit scope and appropriate confirmation.

Reconcile uncertain move/copy outcomes before offering a retry. An undo action is a compensating operation with its own result, not a promise that a remote change never occurred. Initially require connectivity for mutations; queueing comes only with R12's durable conflict model.

**Acceptance:** UI and “Archive these three messages” affect exactly the same synthetic IDs. A partial failure keeps per-item state, refuses broad retry and retains working references. Read status, Sent filing and permission modes do not regress. Protocol basis: [IMAP4rev2](https://www.rfc-editor.org/rfc/rfc9051.html) and [special-use mailboxes](https://www.rfc-editor.org/rfc/rfc6154.html).

### R12 Mail cache and synchronization

**Outcome:** downloaded mail remains usable offline and reconnect reconciles it with the server predictably.

Start with persisted metadata and explicitly fetched bodies, with per-account size/age budgets and visible cache coverage. Then add an account/folder sync coordinator: bounded connections, new/changed/removed message reconciliation, controlled reconnect with jitter and suspend/resume handling. Prefer server-supported IDLE and incremental synchronization; retain a polling/full-revalidation fallback. Never assume every provider implements CONDSTORE or QRESYNC. Their conditional updates and resynchronization mechanisms are specified in [RFC 7162](https://www.rfc-editor.org/rfc/rfc7162.html).

Invalidate the affected folder mapping on UIDVALIDITY change. Distinguish local cached results, server-observed results and pending mutations. Only afterwards introduce a durable offline mutation queue with resource versions, conflict status and reconciliation. Keep SMTP and uncertain APPEND outside generic retry queues. Server-side draft synchronization is a later slice with explicit local/server revision conflicts; local recovery remains authoritative until that policy exists.

**Acceptance:** restart offline and read previously cached content; missing content is labelled unavailable. Reconnect after another client changes flags/moves/deletes mail, after UIDVALIDITY changes, and after sleep. Counts remain honest about scope/freshness. Queued mutations do not duplicate or silently overwrite conflicts.

### R13 Mail search, lists and conversations

**Outcome:** the same question has the same scope and completeness in Mail and Chat.

**Review finding — 11 November 2026:** the current UI retains at most 500 messages. Inbox refresh keeps the newest entries, older-page loading keeps the oldest entries, and query pagination stops at the cap. Introduce an explicit loaded-page window that preserves selected message identity and reading position. Show when more server results exist beyond the retained window, and verify refresh/navigation with more than 500 synthetic messages before treating paging as complete.

Converge the overlapping legacy search and query paths onto shared filters and cursor semantics while preserving old callers. Expose account/folder/date/read/attachment scope consistently, with selected filter chips and visible result provenance. Add unified Inbox only after per-account identity and merged ordering are reliable. Distinguish folder entries from logical messages; do not silently deduplicate counts.

After R12, add a local full-text index over cached content. Evaluate [SQLite FTS5](https://www.sqlite.org/fts5.html) for lexical search, snippets and ranking; index coverage is not the entire server mailbox. Use server search for uncached scope and label incomplete results. A vector database is not required for this baseline. Add optional conversations using Message-ID/reply relationships, with access to each individual message; subject-only grouping is insufficient.

**Acceptance:** “latest ten overall”, “Calimoto count”, “unread”, and “received today” match UI results and declared timezone/scope. Cursor invalidation, duplicate folder copies and partial account failures remain explicit. A local offline search never claims server-wide completeness.

### R14 Composition and attachment recovery

**Outcome:** common reply/forward tasks are easy, and a restored draft has a trustworthy attachment state.

Add reply-all and forward with correct recipient selection, Reply-To handling, self-address exclusion, subject and reply headers. Improve To/CC/BCC editing with visible validation and keyboard-friendly recipient chips. Add file drop into compose using the same validated attachment path as Files and the native picker. Define local draft discard/recovery and paginated send-history navigation separately from deleting delivery evidence.

Offer managed attachment copies for reliable local recovery, with storage limits, source/version metadata and lifecycle cleanup. Preserve existing external-path drafts; show changed/missing file status and a deliberate relink/replace action. Keep outgoing prepared MIME immutable and distinct from editable draft storage. Preserve the existing per-account sender names and plain-text signatures. A deliberately small rich-text composer with a plain-text alternative is a separate later slice; it must preserve formatting and safe pasted content across save/restart.

For partial recipient rejection, prepare a new reviewed draft for rejected recipients only; never repeat the accepted submission. Absence from Sent cannot prove that an uncertain SMTP submission was not accepted.

**Acceptance:** a saved draft restores after source files move or disappear according to its chosen attachment mode. UI and Assistant produce identical reply-all/forward fields. CC/BCC, Unicode filenames and duplicates behave correctly. SMTP acceptance, partial recipient rejection and Sent filing remain separate; repeated filing never resends.

**Implementation seam:** [draft frontend](../modules/ovd-mail/frontend/index.tsx), [SMTP service](../modules/ovd-mail/backend/smtp-service.ts), [outgoing store](../modules/ovd-mail/backend/outgoing-store.ts), [Sent service](../modules/ovd-mail/backend/sent-service.ts).

### R15 Account authentication and connection recovery

**Outcome:** accounts requiring modern authentication can be used without weakening credential handling.

Add provider-specific OAuth support to the existing Mail account groups, starting with the actual provider needed by users. Verify registration, allowed scopes, IMAP/SMTP support and provider-specific requirements before implementation; OAuth is not one universal server switch. Preserve password/app-password accounts.

Use the system browser and authorization-code flow with PKCE, bind callback/state/issuer, keep tokens in the local encrypted credential store and handle refresh/revocation explicitly. Never ship a supposedly secret desktop client credential. Explain reauthentication separately from bad server settings, offline state or TLS failure. The Assistant can open/prepare setup and inspect public connection status; it cannot consent or retrieve tokens.

**Acceptance:** complete login, cancellation, expired/revoked token and changed-account flows using a designated account; no secrets appear in logs, models or snapshots. Existing IDs and drafts survive reauthentication. Foundations: [OAuth for native apps](https://www.rfc-editor.org/rfc/rfc8252.html) and [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html).

### R16 Chat and desktop interaction

**Outcome:** users can understand what the Assistant is doing and navigate its evidence without losing their place.

**Implemented slices:** R04 adds compact session pages and earlier-history loading with scroll-anchor preservation. The OVD-Bar adds keyboard navigation, overflow, native menus, safe hover reveal, display-bound placement and matching Assistant controls. The reference inspection, cross-window focus and wider accessibility acceptance below remain open.

Show running tool activity immediately, with compact outcome summaries, elapsed time, stop and a route to the affected resource. Use R01's distinct rewrite/continue/new-execution actions. Make saved reference chips keyboard-openable: source, snapshot time, completeness, open source and explicitly requested refresh/read-more. Old snapshots remain evidence of what was sent, even when the current source changes or disappears.

Preserve the existing paged session search and evaluate scalable indexing when measurements justify it. Keep selection/scroll stable during streaming and rendering optimizations. Review shortcuts, focus restoration across native windows, screen changes, large text, Markdown tables/code and links. Keep actions outside user bubbles; keep generic reference labels independent of Mail. Improve provider diagnostics for authentication, rate limits, unsupported parameters, context overflow and malformed streaming. Record usage only when supplied, otherwise label it estimated/unavailable. Connection checks must be harmless and must not enable tools or retry domain actions.

**Acceptance:** mail/file/chat reference → send → branch → restart → inspect/open source works by pointer and keyboard. Streaming never drags a reader away from older text. Missing modules retain snapshot readability. Synthetic provider failures show a usable next step without exposing content or credentials.

### R17 Files usability and scale

**Outcome:** the lightweight Files module remains fast, understandable and fully usable from Chat.

Avoid rescanning/stating every entry for each page. Use a bounded directory snapshot/index with revision-bound cursors and explicit refresh; define behavior for large directories and partial access. Preserve R04's temporary-identity LRU, bounded visible/selected pins, durable reference index and previous/next UI pages. A location ID, content version and immutable chat snapshot are different things: show changed, moved, missing or permission-denied sources rather than silently substituting content.

Add back/forward navigation, useful path completion, hidden-file control, keyboard selection and a non-drag reference action where missing. An optional P2 slice can add a small file-operation set if daily use needs it: create folder, rename, copy/move and OS Trash, with collision review and per-item results. These operations are not prerequisites for a mature lightweight file reader. No permanent deletion or arbitrary execution is needed. Add PDF/image preview and bounded text extraction only after choosing maintained readers and isolation/resource limits; unsupported formats remain honestly metadata-only. Text extraction is not OCR and must not be labelled as complete document understanding.

**Acceptance:** browse a synthetic 10,000-entry folder across pages without repeated full scans or UI stalls; cancel/refresh safely. References survive restart and report source replacement. UI and Assistant target the same paths for rename/move/Trash, with no Documents-only restriction and no directory-wide content ingestion.

**Implementation seam:** [Files service](../modules/ovd-files/backend/file-service.ts), [Files frontend](../modules/ovd-files/frontend/), [file contracts](../shared/files.ts).

### R18 Settings and accessibility consistency

**Outcome:** configuration stays compact while saving, permissions and recovery remain understandable.

**Implemented slices:** compact category navigation/search, retained forms and the dedicated OVD-Bar category are available. OVD-Bar controls coalesce rapid edits, preserve local values after save failure and expose retry; keyboard, narrow-window and reduced-motion behavior were checked. Applying this consistently to every settings contribution and completing VoiceOver coverage remain open.

Integrate each new option into existing categories/search/synonyms and expandable groups. Keep account configuration grouped by account. Provide task-oriented agent presets plus advanced overrides, with visible current values and reset-to-default. The Assistant may prepare execution/context settings, but only the user's save applies them to subsequent runs. A preset must not silently change permissions or resume stopped work. Separate effective running settings from pending form changes.

Standardize dirty/saving/saved/error feedback, secret-present indicators and prepared-assistant-change previews. Preserve unrelated unsaved inputs during preparation, navigation and search. Add storage/cache/backup controls to the existing settings structure, not a new module. Perform keyboard and VoiceOver walkthroughs across every existing window, checking focus, names/roles, status announcements, contrast, large text, reduced motion and compact target spacing. Provide non-drag alternatives to reference and ordering workflows.

**Acceptance:** complete setup, search, reorder, reset, failed save and assistant-prepared edit without a mouse or lost values. Use 450px windows and large text; no essential control disappears. Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the interaction baseline, including focus visibility, dragging alternatives and target size/spacing; do not claim full conformance without a complete assessment.

### R19 MCP operational completeness

**Outcome:** existing integrations remain usable through reconnects, permission changes and modern authentication.

After R07, improve connection states, diagnostics, inventory refresh and approval diffs. Bind an offer to server identity, schema and current approval; a changed/revoked offer cannot execute. Respect protocol-defined cache hints and negotiated capabilities where supported. Add a bounded, redacted persistent operation log through R01/R08, with filters and status/reconciliation routes rather than repeat buttons for unknown outcomes.

**OAuth implementation update, 3 November 2026:** v0.1.4 adds HTTP browser authorization with PKCE, protected-resource/authorization-server discovery, issuer-bound credentials, pre-registered clients and Dynamic Client Registration. Version 0.1.5 adds optional authorization/token endpoint overrides and a pre-registered manual flow for providers without authorization-server discovery. Settings and Assistant can start, cancel and end a local sign-in; saved tokens can refresh without opening the browser. Existing Stdio and Bearer connections remain available. Authentication never grants tools or automatically replays an uncertain call. See [MCP OAuth setup](../modules/ovd-mcp/README.md#oauth-for-http-servers) for the implemented scope. This does not complete R07 or R19: a hosted Client ID Metadata Document, wider provider compatibility evidence, persistent diagnostics and the content features below remain open. The current [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and [security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) guide further compatibility work.

Finally integrate resources as backend-resolved, bounded references with continuation, and prompts as explicitly selected templates/data. Neither automatically enters system instructions. Server sampling, elicitation, arbitrary remote UI and task extensions require separate demand and approval design; they are not enabled just to claim broad protocol support.

**Acceptance:** restart/reconnect, token expiry, inventory/schema change, disabled server and post-write disconnect all have truthful UI/Assistant states. A synthetic resource can be referenced and read in pages without dumping the server catalog into context. Malicious tool descriptions/prompts cannot approve access.

### R20 Development and release readiness

**Outcome:** contributors can reproduce the app and users can upgrade without losing their workspace.

**Current delivery:** [the release workflow](releases.md) builds macOS Apple Silicon/Intel DMGs and a Windows x64 installer, checks the complete asset set and attaches installers, checksums and metadata to a published release. Mac bundles use ad-hoc signatures for integrity; they have no trusted Developer ID or notarization, and Windows installers are unsigned. Manual installation over the existing app retains the separate profile. Successful packaging is not a completed runtime, migration or interrupted-upgrade assessment. Linux remains a local packaging target, and there is no automatic app updater.

Keep `pnpm install --frozen-lockfile` and the existing build workflow documented. Add an isolated development/test profile and optional renderer hot reload only if it preserves single-instance and process-restart semantics; do not change the production profile during checks. Record a small provider/server/platform compatibility matrix, dependency licenses and a local release checklist. Keep diagnostic exports opt-in, bounded and redacted, with model/protocol/version, durations and error categories rather than message content.

Complete practical macOS release validation first: packaged resources, local credential storage, packaged dependencies, multi-window drag/drop, shutdown and migration. Add trusted signing/notarization beyond the current alpha packages. A future automatic update path needs verified metadata/packages, user-visible release notes and safe restart; never interrupt unsaved work or an external action. Data rollback must respect migration compatibility. Validate Windows/Linux on those platforms before broader support claims. Electron documents [signing and notarization](https://www.electronjs.org/docs/latest/tutorial/code-signing); review its [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) at release time.

**Acceptance:** fresh install, upgrade from the previous profile, failed/interrupted update, uninstall/reinstall and restored backup retain expected data and R09's protection against resurrecting old actionable records. Invalid updates are rejected. No secret enters release artifacts. A version is called supported only with recorded practical platform evidence. Signing credentials and provider registrations are external prerequisites, not assumed to exist.

## Milestones and release gates

| Milestone | Required result | Main packages |
| --- | --- | --- |
| M1 Existing workflows are trustworthy | No mutation replay on regeneration; bounded requests; long content reachable; memory bounded; save failures visible; host boundaries checked; MCP compatibility known. | R01a, R02–R07 assessment |
| M2 Work survives scale and interruption | Durable operation recovery, migration/recovery proof, backup/retention, complete external-module lifecycle. | R01b, R08–R10 |
| M3 Mail works for daily tasks | Organization, reply-all/forward, recoverable attachments, current authentication where needed, offline read/reconnect and honest search. | R11–R15; rich composition/threading may follow |
| M4 The workspace behaves consistently | Reference inspection, accessible chat/settings, responsive basic Files and reliable existing MCP connections. | R16–R19; advanced previews/resources/prompts may follow |
| M5 A release can be maintained | Proven macOS package/update/migration path, scoped diagnostics and accurate support documentation. | R20 plus relevant prior gates |

These are outcome gates, not mandatory serial departments. R16/R18 and the read-only portions of R17 can proceed while Mail develops. R07's compatibility assessment starts early; protocol migration must pass before advertising new-version support. No shipping milestone requires every P2 convenience feature.

M1 remains open despite the completed R01–R04 slices: workspace-wide durability, broader host-boundary verification and MCP compatibility evidence still need their own acceptance. The OVD-Bar follow-up does not complete M4 or establish support on untested operating systems.

## Practical validation and measurements

Maintain one small, repeatable acceptance worksheet, with fixture/profile, UI path, equivalent assistant request, expected result, observed result and evidence. Use isolated synthetic content and controllable local endpoints. Run the relevant existing checks; add only a focused guard for a high-impact regression when needed. Do not build a large new test framework or add routine CI beyond the authorized release-packaging workflow.

| Scenario | Required evidence |
| --- | --- |
| Mail → Chat → draft → restart → send → failed filing → retry | Correct IDs/fields/snapshot, durable draft, exactly one attempted synthetic SMTP submission, separate filing status. |
| Regenerate/continue after a synthetic remote write | Existing effect reused or reconciled; no automatic duplicate. |
| Long mail/draft/chat/file | Reach final content via continuation; provenance and version changes handled; bounded provider request. |
| Reference drag, removal, send recovery and branch | Identity-only drop, correct backend content, preserved snapshots; no recursive expansion. |
| Storage failure and interrupted migration | Visible error, preserved original data, verified retry/restore and acknowledged revisions. |
| Mail offline/reconnect and second-client changes | Clear cache coverage, correct UIDVALIDITY handling, explicit conflicts, no invented exact count. |
| Malicious HTML or tool content | No script/host privilege, no unapproved external request/access, normal links still usable. |
| Large folders/history/mail bodies | Measured plateau, cancellation, stable cursors and usable typing/scroll. |
| Changed module or MCP offer | Approval invalidation, no stale execution, existing snapshots retained. |
| Keyboard, VoiceOver, narrow windows and package upgrade | Reachable controls, meaningful focus/status, preserved work and correct packaged behavior. |

Start measurements with 10,000 chat messages across sessions, a 10,000-entry directory, 100 sequential image-heavy mail opens, and an 80-result agent run. These are synthetic workload definitions, not supported-product limits. Record hardware/OS, build mode and fixture so results are comparable.

Initial acceptance proposals are: visible local feedback within 100 ms; acknowledged small local saves within 1 second at the 95th percentile under the fixture; no repeated main-thread stalls above 100 ms during normal interaction; an enforced aggregate body/cache budget; and every provider request fitting its declared input/output envelope. R04 now records cache and window-traffic measurements with fixed implementation budgets; the broader latency targets are not measured release claims. Adjust them from the recorded baseline before treating them as release gates; network completion time is measured separately from UI responsiveness.

For each implementation slice, finish the affected UI and assistant workflow, error/cancel/restart case, appropriate type/build checks, and updated documentation. Preserve proof of no extra external action where retries or recovery changed. Commit/push and publication remain separate user-directed steps.

## Architecture decisions to make before larger changes

| Decision | Recommended starting point | Evidence required |
| --- | --- | --- |
| Database driver/process | Incremental SQLite behind a narrow storage interface, with one writer; retain existing store until migration works. | Packaging, durability, large-profile measurements and rollback/recovery exercise. |
| Context accounting | Implemented: conservative whole-wire byte estimate, global context/reserve settings and run-local result paging. Provider-aware tokenization or per-model limits remain a possible extension. | Large synthetic runs are verified against the configured local bound; live model limits still require provider-specific evidence. |
| Persistent mail content | Opt-in scope, bounded managed cache, clear retention and an explicit encryption/key-recovery decision. | Storage/backup design, cleanup and offline/reconnect exercise. |
| Module API | Version existing contract and complete its missing lifecycle/reference paths. | Existing Notes example works without core-specific branches. |
| MCP modernization | Maintain a declared legacy/current compatibility matrix and adopt the smallest verified migration. | Dual-era synthetic servers, stale approval and unknown-outcome cases. |
| Search | Shared typed filters first; FTS5 over cached content when available. | Scope/coverage correctness and useful latency; no embeddings requirement. |
| UI performance | Measure, then narrow subscriptions, paging and selective virtualization. | Better latency/memory while preserving accessibility and selection. |
| Advanced automation | Keep the current single-agent execution model and improve its reliability. | No present requirement justifies product subagents, arbitrary code execution or a workflow engine. |

## Keeping the plan current

Use package IDs in implementation notes or issues. Before starting, verify the referenced gap still exists and split the package into a reviewable user workflow. After completion, record the commit and practical acceptance evidence here, update the current-scope docs, and remove superseded limitations. New library/protocol versions are inputs to a compatibility check, not automatic reasons to rewrite working code.

The external references linked beside the relevant decisions were checked on **28 October 2026**. Established IMAP, SQLite and OAuth specifications remain relevant alongside newer MCP and agent-context techniques. OVD-specific priorities, budgets and acceptance criteria are project recommendations, not claims that those sources mandate this roadmap.
