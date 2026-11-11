# R04 memory and window-traffic measurements

[Documentation](README.md) · [Architecture](architecture.md#window-state-projections) · [Maturation plan](maturation-plan.md#r04-bound-memory-and-reduce-cross-window-traffic)

Measured on 11 November 2026 in isolated macOS Electron profiles. **Before** is a frozen build immediately preceding R04, with R03 already implemented; **After** is the R04 implementation measured against the same synthetic fixtures. Later OVD-Bar work is recorded separately below and does not change these historical measurements. These are development measurements, not release benchmarks or guarantees for every computer. No personal mailbox, credentials or live provider was used. The practical harnesses remain outside the repository; this work adds no test framework or CI workflow.

## Mail

The fixture selected 60 different messages through the actual Mail renderer. Each supplied body contained 100 KiB of HTML, 20 KiB of text and four valid 256×256 CID PNGs. Network requests were blocked. Payload counters measured retained UTF-8 strings, conservative UTF-16 string storage and one decoded RGBA frame per image. Renderer heap samples were taken after garbage collection. These counters do not equal process RSS, GPU memory or the complete cost of animated/remote images.

| Measurement | Before | After |
| --- | ---: | ---: |
| Host body payload after 60 selections, UTF-8 bytes | 91,389,111 | 12,185,208 |
| Retained body entries | 60 | 8 |
| UTF-16 plus decoded-image estimate, bytes | 245,692,782 | 32,759,024 |
| Renderer JavaScript heap after 60 selections, bytes | 87,353,768 | 6,470,324 |
| Refreshed list payload, serialized bytes | 91,435,703 | 40,112 |
| Host retained body bytes after closing Mail | 91,389,111 | 0 |

The new cache plateaued at eight bodies from the tenth selection onward. It enforces both a 16 MiB encoded-string budget and a 32 MiB UTF-16-plus-image estimate, including at most one pinned selection. An individually oversized body is returned to the single reader without entering the host cache. Unknown image dimensions are charged conservatively; the estimate is not an absolute renderer-memory limit.

Lists and change notifications carry metadata and compact previews. The renderer owns one selected body. Source identity, read status and display preferences remain separate from payload eviction. Checks covered a cache hit for the active selection, reloading an evicted body without resetting remote-image preferences, saved-reference source rehydration, a late in-flight read after window close, reopening, account removal and module disable. Closing Mail released body payloads; disabling the module also cleared its live metadata. No external resources were loaded.

## Host and Chat

The fixture contained 31 sessions, 1,500 messages in total and 600 in the active conversation. Five native windows were open. IPC counts sum serialized `workspace:changed` payloads over those windows; they exclude Electron framing and unrelated IPC.

| Measurement | Before | After |
| --- | ---: | ---: |
| Twelve draft updates, aggregate IPC bytes | 117,190,030 | 5,498 |
| Twenty streaming chunks, aggregate IPC bytes | 234,553,860 | 1,847,990 |
| Initial Chat DOM nodes | 11,489 | 1,990 |
| Initially rendered messages | 600 | 100 |
| Chat keystroke to two paint frames, median ms | 99.98 | 48.69 |

Window projections remove unrelated histories and bodies. Unchanged projections are not broadcast again. The Chat window initially receives the latest 100 messages; explicit earlier-history loading preserves the reading anchor. Full-text session search runs against canonical Host history, with compact result pages. The complete state still feeds persistence, tools, references, forks and reformulation. This is not history deletion or a change to the provider context budget.

Checks covered search matches in unloaded messages, earlier-history loading with a measured 0.17px anchor shift, identity-only chat drag, branching an older message with its complete canonical prefix, and rejection of Chat-only IPC from Settings. The Host retained all 31 sessions and the newly completed conversation. A final 19-check Host pass additionally exercised normal Assistant discovery, search in unloaded content, second-page continuation, rejection after a real rename, pending-request recovery from off-page history and keyboard loading in both Chat and Chats. Input timing used actual Electron input events and includes scheduling/two-frame waits; eight samples are descriptive, not a portable latency benchmark. Explicitly loading more history increases the displayed content again.

The subsequent [OVD-Bar validation](ovd-bar.md) confirmed that its projection still excludes unrelated chat history. Changing orientation, size, opacity, placement and entry overflow preserves that boundary. These were functional checks, including Assistant control and restart, rather than a second performance benchmark; the IPC and timing figures above remain the original R04 results.

## Files and storage

Four directories each contained 3,000 synthetic files. The same path lengths and byte budget returned 91 entries per page. Initially visiting each directory retained 12,004 identity mappings and added 12,000 paths to the shared selection set. After the change it retained 368 temporary identities and added no directory-scan paths to that set.

After eight further page requests, the old view held 819 rows and 8,329 DOM nodes; the new view held 91 rows and 1,091 nodes. Filter-input to two-frame timing changed from a 50ms median to 33.3ms. Enumeration still scans/sorts the directory: observed first-page times were roughly 49–54ms before and 55–74ms after under concurrent validation. This work claims lower retention and DOM cost, not faster filesystem enumeration.

Temporary identities use a 2,048-entry LRU. The actual Files window separately pins its visible page and selected preview, within 501 identities. Saved reference paths use their existing durable index. Listing 6,000 additional file identities reached the cache limit while selected/pinned files and a saved reference remained readable through the normal lazy Assistant workflow. Previous/next navigation, off-page Assistant selection, identity-only drag, reference restoration and attachment handoff outside the synthetic Documents folder passed. Disabling Files released temporary identities and view pins while preserving the saved reference. Explicit native file picks remain separate from directory enumeration. Native keyboard checks retained pager focus at first/last-page boundaries; the selected preview survived navigation. At a 460px viewport there was no horizontal document overflow, and a changed-directory cursor failed visibly with a working first-page retry.

The existing store was also measured, without changing its durability contract. For 60 sessions × 80 messages, serialized workspace size was 5,604,016 bytes. Median acknowledged save time was 41.07ms before and 47.98ms after; synchronous serialization medians were 4.47ms and 4.51ms. These runs varied under concurrent load. SQLite still exports the whole database; no storage speedup is claimed. Visible save recovery remains R05, and incremental storage/migrations remain R08.

## Remaining limits and verification

The source-reading regression checks still reached long plain/HTML mail and draft tails, enumerated all 56 drafts, rejected changed cursors, preserved independent cancellation and restored exact mail sources in a fresh process. Default and custom Assistant-requested pages matched the visible Mail reader. At completion of the R04 measurement run, production TypeScript and Vite builds, 51 existing tests and 536 local documentation links passed. Those counts describe that recorded run, not fixed totals for subsequent changes. No new repository tests were added for R04.

The changes do not establish Windows performance, unrestricted memory bounds, offline synchronization, full accessibility certification or workspace-wide save recovery. [R05](maturation-plan.md#r05-visible-durability-for-the-whole-workspace) remains the next reliability package. Large-folder enumeration and explicitly expanded histories remain measurable scale limits; whole-database writes remain [R08](maturation-plan.md#r08-incremental-storage-and-migrations), and the Mail list's 500-message navigation contract remains [R13](maturation-plan.md#r13-mail-search-lists-and-conversations). The approach follows [Electron's measurement-first performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).
