# Product and host review — November 2026

[Documentation index](README.md) · [Maturation plan](maturation-plan.md) · [Architecture](architecture.md)

**Reviewed:** 11 November 2026. **Starting point:** `c3905d7`, the source of `v0.1.8`. This record covers the original review and the subsequent R02, R03, R04 and OVD-Bar implementation checks. Published packages and their platform evidence are documented separately in the [release guide](releases.md).

OVD's existing modular desktop design fits its intended users. The immediate problems were unnecessary chrome, controls becoming unreachable in small windows, and several mismatches between a visible action and its actual state. The review corrected those contained defects; follow-ups bounded provider requests, completed source reads, reduced retained data/window traffic and rebuilt the launcher as the OVD-Bar. These changes add no product modules or new test framework. **R05, visible workspace-wide save recovery, is the next reliability package.**

## Review method and coverage

Source review was split across the Host/Assistant boundary, settings and module management, and Mail/Files. Changed paths were then exercised in real Electron windows with isolated profiles, fictional content, a local synthetic provider and a disposable process module. Personal profiles, credentials and mailboxes were not used. No real mail was sent.

| Area | Review and practical coverage |
| --- | --- |
| Assistant and chats | Reading area, Markdown copy, activity/journal disclosure, uncertain outcomes, reference buttons and cross-window drag payloads, opening sessions, rejected renames, narrow windows and zoom. |
| Settings | All eight available categories, navigation and search, model selection, retained AI/repository/mail form edits, account preference persistence, module ordering and failure presentation. |
| Mail | Account/folder scope, additional recipients supplied through the shared draft state, reader and toolbar density, overflow dismissal, minimum-size draft controls and reference payloads. |
| Files | Paths, breadcrumbs, compact counts, narrow layouts and module reference identity. |
| Host and external modules | Lazy discovery into Diagnostics; cancelled versus applied module changes in the operation journal; crashed-process recovery; code fingerprints; bounds and saved display selection using simulated work areas; keyboard access with 20 additional Dock entries. |
| Providers, MCP, storage and distribution | Source/contract review, installed SDK inspection and official documentation comparison. Live Azure/ChatGPT accounts, remote OAuth servers, Windows runtime, installer upgrades and large-data performance were not revalidated in this pass. |

Display-bound checks used real Electron windows with simulated work areas, not physical multi-monitor setups. The later OVD-Bar follow-up implements display-change recovery and verifies it with simulated addition/removal/metrics events; physical display reconfiguration remains unverified. Original review layouts included 450×360 application windows, wider views up to 1280px, larger text, and zoom. Settings were checked at 150% zoom; Chat and Chats at 200% with a 320 CSS-pixel viewport. Keyboard checks targeted navigation, overflow dismissal, focus visibility and access to offscreen Dock entries. This is not a complete VoiceOver or WCAG conformance assessment.

## Criteria used

These are OVD implementation choices informed by current primary documentation, not a requirement to copy another application's appearance.

| Criterion | Application to OVD | Primary reference |
| --- | --- | --- |
| Every persistent sentence should help the current task. | Remove repeated storage/security/drag explanations; retain errors, actual save state, incomplete results and consequential choices. | [Apple: Writing](https://developer.apple.com/design/human-interface-guidelines/writing) |
| Put common actions first; disclose secondary detail on demand. | Keep task controls visible, put technical module descriptions behind Details, and keep sources/catalogs below installed modules. | [Microsoft: Command bar](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/command-bar) |
| Adapt to the available window, not the physical display. | Reflow controls and give long navigation/content areas their own scroll boundary. | [Microsoft: Responsive layouts](https://learn.microsoft.com/en-us/windows/apps/design/layout/screen-sizes-and-breakpoints-for-responsive-design), [W3C: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| Compactness must preserve usable targets and keyboard access. | Use labelled icon buttons, visible focus and accessible dismissal. Use 24×24 CSS pixels as the baseline for standalone targets, with larger primary controls. | [W3C: Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [ARIA: Menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) |
| Profile before replacing infrastructure. | Treat full-state IPC and database exports as measurable scaling risks; do not change frameworks or storage drivers as a cosmetic fix. | [Electron: Performance](https://www.electronjs.org/docs/latest/tutorial/performance) |
| Protocol compatibility depends on negotiated behavior. | Compare the installed MCP SDK's supported versions with actual server eras before choosing an upgrade. | [MCP: Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) |

## Corrections made

| Finding | Result |
| --- | --- |
| Declining module activation/deactivation could still produce an applied/completed journal outcome. | Confirmation happens before dispatch. Declining returns cancelled with no applied effect. Module state, fingerprint and busy state are rechecked around dispatch. |
| A crashed module could not be disabled through the normal management flow. | A runtime-failed module can be disabled and activated again with a fresh process. Invalid packages remain unavailable; changed code still requires approval. No failed call is replayed. |
| The Assistant offered the Diagnostics category, but host navigation rejected it. | Host navigation accepts the shared core category IDs. Core settings metadata is checked against that type. |
| New windows and a growing Dock could extend beyond the work area; restored windows were forced onto the primary display. | Shared bounds fitting keeps windows reachable and restores the appropriate display. The later OVD-Bar controller adds display-change recovery, bounded navigation overflow and an always-reachable native menu containing Quit. |
| Settings categories below the fold were inaccessible in low windows. | The category navigation now has its own scroll boundary and visible keyboard focus. Small windows use compact horizontal navigation. |
| Module administration buried everyday enable/disable controls under sources and long descriptions. | Installed modules come first, followed by collapsed sources/catalogs. Technical details expand on demand; search reveals matching groups without resetting form drafts. Entry ordering now belongs to the separate OVD-Bar category. |
| Switching from a model list to a manual model ID cleared the chosen value. | The current model is retained. |
| Module errors relied on CSS loaded by the optional Mail module. | Host settings now own their generic error presentation. |
| Chat rendered a separate journal row even for ordinary text answers. | Plain replies have no empty task journal. Tool activity contains the detailed journal; running, failed, cancelled and uncertain work remains inspectable. Continuation remains a separate action. |
| Chat chrome repeated input/storage explanations and squeezed the reading area. | The permanent help footer and redundant preparation text are removed. Input instructions remain accessible; drag guidance appears during a drag. Denktiefe uses a compact icon at narrow widths. |
| Chats had a large heading, repeated instructions and overflowing unbroken titles. A rejected rename closed the editor. | A single search/action toolbar replaces the heading/footer. Titles truncate and open the chat. Rename rejection retains editable input and shows the error locally. References remain available by button and drag. |
| A draft updated by the Assistant could contain hidden CC/BCC recipients. | Changes to those fields reveal them in the existing draft. |
| Mail filters could apply the active account's folder to a different selected account. | Folder choices are loaded for the selected account; another account cannot inherit the old current-folder shortcut. |
| Mail's overflow stayed open after Escape or an outside interaction. | It closes on Escape, outside click and focus departure, with focus returned where appropriate. |
| Draft actions could fall below the visible area at 450×360. | Draft content scrolls when needed, preserving access to attachments and Send. |
| Long file breadcrumbs hid the current folder. | Navigation and resizing reveal the current path end. Ancestors remain scrollable and keyboard accessible. |

Mail/reader/draft spacing, settings padding and repeated help were reduced together. Save errors, sending uncertainty, partial query results and code approval remain visible. Generic chat and host labels do not introduce optional-module terminology.

### Measured layout changes

The same synthetic content was measured before and after the changes. Values are usable container height in CSS pixels, not performance benchmarks.

| View and viewport | Before | After |
| --- | ---: | ---: |
| Chats list at 450×360 | 112px | 271px |
| Chats list at 320×260 CSS pixels, 200% zoom | 0px | 171px |
| Chat reading area at 450×360 | 159px | 178px |
| Chat reading area at 320×260 CSS pixels, 200% zoom | 24px | 78px |

## R02 implementation follow-up — 11 November 2026

The original review identified unbounded accumulated tool exchanges as the next reliability gap: separate limits on history, schemas and individual results did not bound the combined outgoing request. R02 implements that combined bound. This follow-up records its implementation and practical checks separately from the original layout/correctness findings.

The [whole-request budget](architecture.md#whole-request-context-budget) now checks the exact serialized request before every provider call, including text-only requests and fallback. Global Agent settings default to a 128,000-token estimate and an 8,192-token answer reserve. One serialized UTF-8 byte counts as one conservatively estimated input token; wire bytes must fit within total minus reserve. These are local bounds, not an actual tokenizer, automatic model-limit detection or a provider output cap.

Oldest history is removed first, then whole fully answered tool batches become untrusted result references. The current request, system instructions, memory and reference snapshots stay unchanged. Opaque reasoning is only removed with its whole batch; retained items remain unchanged. The lazy host tool `read_tool_result` reads immutable, already-bounded result pages from the current run without invoking a module again. Handles expire at the end of the run. Read pages can join saved answer evidence under that host tool name within the existing 8,000-character/result and 24,000-character aggregate limits, with explicit omissions; they are not domain journal actions. An unavoidable overflow ends with `context_budget`, retaining outcomes and requiring a deliberate next step. Changing settings never resumes actions automatically.

Eleven practical synthetic Electron checks covered 80 large results, five exact result pages including a Unicode tail, completed and uncertain writes each dispatched once, rejection of expired handles, oversized current requests/references with zero provider fetches including text-only requests, and no automatic resume after changing limits. Requests stayed inside the configured envelope. Bounded saved evidence retained the read tail and provenance for actual tool-free reformulation, without new module calls or journal changes; an oversized reformulation stopped before sending and preserved its evidence. Separate real Electron settings checks covered invalid budget pairs, Assistant preparation, retained edits, explicit saves, restart and narrow/high-zoom layouts. See [R02's acceptance record](maturation-plan.md#r02-budget-the-entire-provider-request) and [numeric context diagnostics](diagnostics.md#context-budget-records). These checks establish the local request bound; they do not establish live provider model limits. Source-content retrieval is the separate R03 follow-up below.

## R03 source-reading follow-up — 11 November 2026

[Complete Mail and draft reads](architecture.md#complete-mail-and-draft-text) now continue through underlying content rather than the truncated preview. `mail.read` and the compact Mail text reader share source-bound pages, including plain-text and HTML-only MIME extraction. Each page validates the exact account/folder/UID/UIDVALIDITY identity. `drafts.get` pages complete bodies; `drafts.list` exposes revision-bound collection pages and exact totals. Saved Mail references can rehydrate the original source after restart without a mailbox-wide lookup or replacing their historical snapshot.

Fifteen isolated Electron checks exercised the actual UI, normal Assistant discovery/dispatch, MIME decoding and persisted workspace. They reached long Unicode/plain/HTML tails, enumerated all 56 synthetic drafts, rejected changed source/draft cursors, preserved independent cancellation and restored an exact referenced mail in a fresh process. An additional page-parity check matched the visible reader to default and custom Assistant-requested ranges. [R03's acceptance record](maturation-plan.md#r03-complete-content-through-bounded-continuation) states the size limits, temporary-file lifecycle and verification scope. This completes bounded online source reading; persistent offline mail and the Mail list's separate 500-message navigation boundary remain open.

## R04 memory and window-traffic follow-up — 11 November 2026

[R04](maturation-plan.md#r04-bound-memory-and-reduce-cross-window-traffic) separates Mail metadata from bounded body/CID retention, sends verified native windows only their required state, pages initial Chat history and the Chats collection, and bounds temporary Files identities and rendered directory pages. Canonical histories, saved snapshots, source locators, operation evidence and acknowledged persistence stay authoritative. Explicitly loading more Chat history can still increase displayed content; directory enumeration and whole-database exports remain unchanged.

The [measurement report](performance-2026-11.md) preserves the frozen R03/R04 comparison: the 60-mail fixture retained eight cached bodies instead of 60, and renderer JavaScript heap changed from 87.35 MB to 6.47 MB. Twelve draft updates across five windows changed from 117,190,030 to 5,498 serialized IPC bytes. Files retained one bounded page instead of accumulating every loaded row. Practical checks covered normal Assistant access, unloaded-history search, cursor invalidation, selected-file/reference retention, attachment handoff, cancellation, close/disable cleanup and source restoration after restart. Those fixture-specific results do not claim universal latency, complete process/GPU memory bounds or a storage speedup.

## OVD-Bar follow-up — 11 November 2026

The former Dock is now the configurable [OVD-Bar](ovd-bar.md): vertical/horizontal layout, size and background opacity, edge/free placement, optional idle collapse, a compact menu and shared Assistant controls. Entry ordering moved from Modules into OVD-Bar settings. The UI, native menu and `settings.update` share persisted configuration; lazy `bar.get` and `bar.move` inspect display geometry and save an exact free position through the controller. Module attention signals and lazy capability discovery keep their existing Host contracts. This supersedes the original Dock layout and settings placement described above.

The Bar controller responds to display addition/removal and work-area changes; simulated display events and fresh-process position restoration were checked. This improves on the original opening-only bounds recovery, without claiming physical multi-monitor or Windows/Linux validation. Separate visible macOS Electron windows verified inactive startup, native focus/blur, focus-held expansion and hover reveal without taking keyboard focus. Pointer checks included the collapsed handle's lower/right edges: the first reveal click opens no accidental module, while the next deliberate activation still opens Mail and acknowledges its notice.

Other isolated checks covered settings search, a 350 CSS-pixel viewport, rapid queued edits, retained values/retry after an injected save failure, orientation-aware keys, reduced-motion attention, overflow with 40 additional navigation entries, background-only pixel alpha, and persistence failure handling for an unreadable saved position. Normal Assistant requests updated settings, inspected displays and moved the Bar; a fresh process restored the resulting position. These checks do not complete the broader R16/R18 accessibility assessment.

## Remaining work, in priority order

1. **R05 — Extend acknowledged saving across the workspace.** Drafts, the operation journal and explicit settings writes already have scoped acknowledgements; the OVD-Bar form also retains failed edits for retry. [Workspace commit/checkpoint paths](../electron/main.ts) still log some delayed save failures to the console. Awaiting a renderer IPC response is not a blanket promise of disk durability. Provide revision-aware save/error/retry state for the remaining chat/composer/workspace changes and preserve unsaved input. The rename UI fix above handles rejected requests; it does not finish this storage contract.
2. **R13 — Make Mail-list limits explicit.** R03 source continuation is now implemented and verified, including exact source restoration after restart. The separate [MailWorkspace](../modules/ovd-mail/frontend/MailWorkspace.tsx) list still caps visible message state at 500. Inbox refresh retains the newest 500, older-page loading retains the oldest 500, and query paging stops at the cap. Design page windows and retained selection deliberately, show the loaded-window boundary honestly, and exercise refresh while reading an older page.
3. **R08 — Incremental storage after visible durability.** R04 has since measured and reduced whole-workspace broadcasts, aggregate body retention and long-list DOM costs; see the [before/after report](performance-2026-11.md). [Store mutations](../electron/store.ts) still clone/export the complete in-memory database. The 5.6 MB fixture's median save time was about 41–48ms across runs, without a storage change. Migrations and incremental records remain separate work; preserve the acknowledged operation and draft contracts.

4. **R10 — Complete the generic module lifecycle.** The external [view bridge](../src/ModuleViewHost.tsx) exposes invocation and references, but no complete dirty/busy/save/close handshake. Built-in close handling does not automatically protect an external company's unsaved form. Add a versioned, module-neutral contract shared by window close, disable, update and quit, with timeout/failure behavior. Keep module-owned settings, references, memory and events outside core domain-specific branches. Crash recovery is now usable; a distinct runtime-failed status and broader lifecycle remain open.
5. **R07/R19 — Verify current MCP interoperability.** SDK `1.32.2` declares `2025-11-25` as its newest supported protocol. The official current specification is `2026-07-28`; its compatibility matrix distinguishes legacy, dual-era and modern-only servers. Current legacy support does not establish modern-only compatibility. Build local fixtures for both eras and transport cancellation before choosing an SDK migration. Existing OAuth/tool approvals must survive, and a lost response must never trigger a repeated mutation. [Official current version](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning), [transport-specific cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation).
6. **R16/R18/R20 — Finish consistency and platform evidence.** Perform full keyboard/VoiceOver walkthroughs, including installed module iframes; consolidate remaining duplicated style rules as their components change. The build still warns about the CommonJS-loaded Vite config and a main renderer chunk above 500kB. Profile startup before splitting it. Windows interaction, real provider/remote-server compatibility, signing and upgrade/recovery checks remain separate release work.

R09 backup/restore and the other unfinished maturation packages remain open. The review does not replace their acceptance criteria or claim that the application is now free of defects.

## Validation result

TypeScript for main and renderer and the production Vite build passed for the reviewed implementation. Focused isolated Electron checks passed across Host, Settings, Mail/Files, Chat/Chats and the OVD-Bar. The original checks included journal cancellation without an applied effect, a fresh process after a crash, fingerprint rejection, uncertain-status inspection without replay, Markdown-source copy, reference handoff, rejected-rename input retention and persisted synthetic account preferences. The R02–R04 and OVD-Bar follow-ups above record their separate acceptance evidence and limits.

No personal data was needed for these checks. Live mail transport, real provider behavior and other operating systems are outside this validation scope. The practical fixtures and screenshots were kept in the local review workspace rather than introducing another permanent test framework or CI workflow.
