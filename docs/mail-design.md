# Mail module product guide

[Documentation index](README.md) · [Architecture](architecture.md) · [Settings design](settings-design.md) · [Brand guide](brand.md) · [Building modules](../CONTRIBUTING.md#building-modules)

> This guide preserves the product direction supplied by the user. It describes the target experience and a development sequence, not a list of completed features. Sections marked **Current implementation** describe the code that exists today. Other requirements describe the target design. See the [project README](../README.md) and [architecture](architecture.md) for the current overall scope.

The Mail module should feel like a complete everyday email application: **connect accounts, read and organize messages, compose email, and reliably recover drafts**. Its interface stays clear and belongs within OpenVibeDesk.

The initial protocol foundation is **IMAP for reading and synchronization** and **SMTP for sending**. Authentication uses a username and password or app password. OAuth belongs to a later stage.

## Current implementation at a glance

| Area | Present today | Still part of the target design |
| --- | --- | --- |
| Accounts | Multiple editable account groups, separate IMAP/SMTP checks, TLS and OS credential storage. | OAuth, reliable provider discovery and a configurable outgoing reply address. |
| Reading | Account/folder navigation, paged metadata, text reading, message details, attachment downloads and explicit read/unread changes. | Isolated HTML display, inline image handling and richer previews. |
| Organizing | Server folder browsing and local view filters. | Stars/flags, move/archive/trash/restore/delete actions, folder editing and a unified inbox. |
| Composing | Separate plain-text draft window, account selection, To/CC/BCC, attachments and a reply to the sender or `Reply-To`. | Recipient chips, reply-all, forwarding, signatures and rich-text composition. |
| Sending | SMTP, confirmed manual send, actual outcome reporting and protection against repeating accepted or uncertain sends. | Sent-folder filing/reconciliation and complete delivery-state handling. |
| Search and storage | Bounded server search plus shared `mail.query`/`mail.count` filters; local drafts and explicit chat snapshots. | Threaded conversations, persistent offline mail cache, local full-text index and full synchronization. |
| Assistant | Mail discovery, queries/counts, reading/opening, draft preparation/editing, send requests, account-form preparation and mail references. | Every future Mail feature must expose the same validated assistant access when implemented. |

Implementation entry points are the [Mail frontend](../modules/ovd-mail/frontend/), [module backend](../modules/ovd-mail/backend/index.ts), [capability definitions](../modules/ovd-mail/backend/capabilities.ts) and [shared query contract](../shared/mail-query.ts). Source paths below refer to implementation, not a proposal to translate existing UI labels.

## 1. Interface foundation

Use the familiar three-pane arrangement:

```text
+------------------------------------------------------------------------+
| Mail                                      Search              Settings |
+---------------+-----------------------+--------------------------------+
| Accounts      | Messages              | Open message                   |
|               |                       |                                |
| + New message | Mara Schneider        | Launch checklist               |
|               | Launch checklist      | From: Mara                     |
| Inbox         | Today · 09:18         | To: me                         |
| Drafts        |                       |                                |
| Sent          | Team                  | Hello, could you ...           |
| Archive       | Project meeting       |                                |
| Trash         | Yesterday             | [Reply] [Reply all] [Forward]  |
| Spam          |                       |                                |
|               |                       | Attachments                    |
| Custom folders|                       |                                |
+---------------+-----------------------+--------------------------------+
```

- **Left:** accounts, folders and a compose action.
- **Middle:** a message list with sender, subject, preview, date and status.
- **Right:** the selected message and its main actions.
- **Narrow windows:** adapt the panes or show them sequentially so the application remains usable.

Keep frequent actions directly available and put occasional actions in an overflow menu. Icons need tooltips and accessible labels. The sketch illustrates the target layout; its reply-all, forwarding and organization actions are not yet available.

**Current implementation:** the [real IMAP view](../modules/ovd-mail/frontend/ImapMailView.tsx) follows this layout and adapts at narrow widths. The compose action remains in the Mail window. A separate “new mail” Dock entry is not required. Real accounts are the primary view; a visible demonstration mailbox must not replace them.

## 2. Account setup

Support multiple IMAP/SMTP accounts. Start with a clear setup flow rather than an elaborate wizard.

Each configured account has one expandable group in Settings. Its summary shows name, email address, and incoming/outgoing setup status. General details, IMAP and SMTP are prefilled and editable there. Changing server settings must not require removing and recreating an account. Preserve the account ID and its existing draft and SMTP associations.

An empty password field retains stored credentials when the connection identity is unchanged. Changing the server or login requires the credentials explicitly requested by the form. See the shared [settings principles](settings-design.md).

### Personal details

- Display name, such as “Tibor Miller”.
- Email address.
- Optional separate reply address.

### Incoming server: IMAP

- Server address and port.
- **Implicit TLS** or **STARTTLS**.
- Username.
- Password or app password.

### Outgoing server: SMTP

- Server address and port.
- **Implicit TLS** or **STARTTLS**.
- Username and password.
- An option to reuse the IMAP credentials.

Check IMAP and SMTP **separately**. A working incoming connection must not imply that outgoing mail is configured correctly.

Target setup flow:

1. Enter a name and email address.
2. Suggest server settings when reliable discovery is available.
3. Let the user complete or correct every field.
4. Check IMAP and SMTP.
5. Save the account and synchronize its folders.

Use understandable errors such as “Sign-in failed”, “Server unreachable” or “Invalid certificate”. Expandable technical details can help diagnosis without replacing the explanation.

**Current implementation:** [account settings](../modules/ovd-mail/frontend/MailAccounts.tsx) provide editable account groups and separate checks/saves. Provider autodiscovery and a configurable outgoing reply address remain target features. Saving an account does not establish continuous background synchronization.

### Encryption and common ports

| Service | Common mode | Typical port |
| --- | --- | ---: |
| IMAP | Implicit TLS | 993 |
| IMAP | STARTTLS | 143 |
| SMTP submission | Implicit TLS | 465 |
| SMTP submission | STARTTLS | 587 |

These ports are **suggestions**, not fixed values. With implicit TLS, encryption starts immediately. STARTTLS upgrades an established connection. Both require a successful encrypted connection **before credentials are transmitted**. Validate certificates and server names; a failed STARTTLS upgrade must never silently fall back to cleartext. See [RFC 8314](https://www.rfc-editor.org/rfc/rfc8314.html).

### Limitations without OAuth

The current version can use accounts whose providers permit password or app-password authentication for IMAP and SMTP. Do not promise compatibility with every account. Provider requirements vary; consult the provider's current documentation, such as [Microsoft's Outlook.com settings](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com) and [Google's app-password guidance](https://support.google.com/mail/answer/185833?hl=en). Google documents eligibility conditions for app passwords; an account or organization may not offer them.

Explain this boundary during setup. An OAuth-dependent account is not supported merely because its server accepts IMAP connections.

## 3. Reading messages

### Message list

Keep each row compact while showing:

- Sender or display name.
- Subject.
- A short text preview.
- Date or time.
- Unread state.
- An attachment indicator when applicable.
- An optional star or flag.

Keep the list responsive for large mailboxes. Load older messages when needed.

**Current implementation:** metadata is paged and message bodies load on demand. A row can show a body preview only after that body has been loaded; it does not preload every message merely to fill a preview. The ordinary folder view initially requests up to 25 messages and limits the visible collection to 500. Stars and flags are not implemented.

### Message reader

The target reader shows:

- Subject.
- Sender.
- Recipients and CC where applicable.
- Date and time.
- Message content.
- Attachments.
- Reply, forward, archive and delete actions.

Additional headers and technical details belong in an expandable details section.

**Current implementation:** the text reader exposes message metadata, attachments, reply and read/unread actions. Opening a real message alone does **not** change its read state. Forwarding, archiving and deleting remain target actions.

### HTML email

Support both text and HTML, treating HTML as untrusted external content:

- Never execute scripts or active content.
- Block remote images initially and let the user load them deliberately.
- Open links only after an intentional action.
- Distinguish inline images from ordinary attachments.
- Offer a text alternative where possible.

HTML email requires suitable isolation and sanitization because it can contain active content and external resources. See [RFC 8621, HTML Email Display](https://www.rfc-editor.org/rfc/rfc8621.html#section-9.2).

**Current implementation:** Mail displays text. An isolated HTML renderer and controlled image loading have not been implemented.

## 4. Composing and replying

Composition belongs in a separate window or clearly separated editor. A **dedicated draft window** suits OpenVibeDesk because it can sit beside Mail and Chat.

### Fields and behavior

| Field or function | Target behavior |
| --- | --- |
| **From** | Select a sending account or sender. |
| **To** | Enter one or more direct recipients. |
| **CC** | Add visible copy recipients. |
| **BCC** | Add hidden copy recipients. |
| **Subject** | Enter and edit the subject. |
| **Message** | Write and edit the body. |
| **Attachments** | Add, inspect and remove files. |
| **Signature** | Optionally insert an account-specific signature. |
| **Send** | Send following the user's explicit action and configured confirmation flow. |
| **Draft** | Save changes locally without a separate save action. |

CC and BCC may start collapsed, with an obvious control to reveal them.

**Current implementation:** the [draft editor](../modules/ovd-mail/frontend/DraftView.tsx) has account selection, To/CC/BCC, subject, plain text, attachments and send-state feedback. Signatures and rich-text editing are not implemented.

### Recipients

- Present multiple addresses as individual entries.
- Validate addresses before sending without inventing unnecessarily restrictive rules.
- Avoid duplicate recipients where possible.
- Make the selected sending account obvious when several accounts exist.
- Respect `Reply-To` when replying.
- For reply-all, include the visible participants and appropriately exclude the user's own addresses.

**Current implementation:** recipient fields are plain-text inputs. [SMTP submission](../modules/ovd-mail/backend/smtp-service.ts) parses addresses, rejects ambiguous/invalid input and deduplicates recipients. Recipient chips and reply-all remain target work.

**BCC requires particular care:** include BCC addresses in the SMTP envelope without accidentally revealing them in headers visible to other recipients. See [RFC 5322, destination address fields](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.3).

### Replies and forwarding

- **Reply:** address the appropriate sender or `Reply-To`.
- **Reply all:** address the relevant participants, with editable recipients.
- **Forward:** pass the content into a new message, allowing attachments to be retained or removed.
- Clearly quote the original content when replying.
- Preserve conversation relationships through `Message-ID`, `In-Reply-To` and `References`. See [RFC 5322, identification fields](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4).

**Current implementation:** `drafts.create` supports a new message and a reply. A new message to a source sender can use `sourceEmailId`, `recipientFromSource="sender"` and `mode="new"`; `mode="reply"` respects the reply address, quotes available text and retains valid message identifiers. Reply-all and forwarding have no equivalent implementation yet.

### Formatting

A **reliable plain-text editor** matters more for the first version than a complex document editor. A simple formatting toolbar can follow:

- Bold, italic and underline.
- Paragraphs and lists.
- Links.
- Quotations.
- Clear formatting.

If HTML composition is added, generate a corresponding text alternative where possible. This is target behavior, not the current SMTP format.

## 5. Drafts and recovery

Drafts are a core feature. Closing the editor or an application crash must not silently destroy a long message.

A draft needs to retain:

- Sending account.
- To, CC and BCC.
- Subject and body.
- Attachments and their status.
- The relationship to the source message.
- The last-save time.

Recommended initial sequence:

1. Save changes automatically to local storage.
2. Restore them after a restart.
3. Show whether a draft was saved locally.
4. Add IMAP draft-folder synchronization next.

If drafts are later edited on several devices, make conflicts visible. Never silently replace one version with another.

Detect moved or deleted attachment files before the user attempts to send. A managed attachment copy may make drafts more robust.

**Current implementation:** local draft records retain the sending account, To/CC/BCC, subject, body, reply headers, attachment references and modification time in the existing workspace store. They are restored on startup. The [draft persistence coordinator](../modules/ovd-mail/backend/draft-persistence.ts) tracks each draft revision and publishes **saving**, **saved** or **error**; an older completed write cannot acknowledge newer edits. The [editor](../modules/ovd-mail/frontend/DraftView.tsx) shows that actual state, a successful save time when available, and a save/retry button with **Cmd/Ctrl+S**. Drafts recovered from disk show that they are saved without inventing a historical save timestamp.

Draft creation and updates wait for persistence before reporting successful storage. Through the same module capabilities, the assistant can inspect `saveState` in `drafts.get`/`drafts.list`, request `drafts.save`, or check `drafts.save_status`. Those tools remain available through normal selective discovery. A save failure retains the current edits in memory and displays an actionable error. Closing the draft window or quitting flushes pending changes and is blocked if saving fails. An abrupt process or system failure can still lose edits that have not yet received a successful save acknowledgement.

Attachments remain references to local files, which are checked again for availability and changes when sending. Managed attachment copies, IMAP draft-folder synchronization and cross-device conflict handling remain target work. Local draft persistence does not send a message or file a copy in Sent.

## 6. Sending and outcomes

The target sending sequence must be understandable:

1. Check recipients, sending account and attachments.
2. The user deliberately requests Send.
3. Submit the message over SMTP.
4. After server acceptance, show that it was accepted/sent.
5. File a copy in Sent or reconcile it with the server.

SMTP acceptance is not proof of final delivery or that a recipient read the message.

**Current implementation:** SMTP submission and truthful outcomes exist. Sent-folder filing/reconciliation does **not**. Manual sending keeps its confirmation dialog. For assistant requests, the explicitly saved “Without confirmations” mode (`Ohne Abfragen` in the current UI) can skip individual dialogs for a clear user instruction. It does not authorize independent sending or let the assistant change its own permissions. See [confirmation behavior](architecture.md).

### Failure cases

- **Connection or authentication failure:** retain the draft and explain the failure.
- **Some recipients rejected:** identify them and explain what happened for the others.
- **Server accepted the message but filing the Sent copy failed:** retain the sent state and retry only the filing operation, never automatically resubmit the message.
- **Connection lost during submission and the outcome is unknown:** explain that the server may already have accepted the message. Automatic resubmission can create duplicates. See [RFC 1047](https://www.rfc-editor.org/rfc/rfc1047.html).

Some providers file sent messages themselves. Future reconciliation must account for that to avoid duplicate copies. Sent-folder identification and behavior vary by server; see [RFC 6154](https://www.rfc-editor.org/rfc/rfc6154.html).

Current results use `sent`, `failed`, `cancelled` and `uncertain`. An accepted or uncertain draft is protected from another send. Partial recipient rejection is reported separately when other recipients were accepted. Empty error fields must not turn a successful result into a failure. Failure to persist a known SMTP result must not erase the known server outcome or trigger resubmission.

## 7. Folders and everyday actions

The target interface represents at least:

- Inbox.
- Drafts.
- Sent.
- Archive.
- Trash.
- Spam.
- Custom folders and subfolders.

Names vary across providers and languages. Prefer server special-use metadata for identifying system folders and allow manual mapping when needed. See [RFC 6154, special-use mailboxes](https://www.rfc-editor.org/rfc/rfc6154.html).

Everyday target actions include:

- Mark read or unread.
- Star or flag a message.
- Move to another folder.
- Archive.
- Move to Trash.
- Restore from Trash.
- Permanently delete with an unmistakable confirmation.
- Create and rename folders where supported by the server.

A **unified inbox** is useful for multiple accounts, but each message must still identify its originating account.

**Current implementation:** the module lists and opens server folders, recognizes common special-use folders for presentation, exposes local drafts, and changes read/unread state. It does not yet provide manual special-folder mapping, a unified inbox, flags, move/archive/trash/restore/delete actions or folder editing. Browsing an Archive or Trash folder does not mean those mutation actions are implemented.

## 8. Search and conversations

### Search

The target global search supports at least:

- Sender and recipient.
- Subject.
- Message body where available.
- Folder and account.
- Unread state.
- Messages with attachments.
- A date range.

Be honest about the search scope. Local search can only find downloaded and indexed material. A server search can find additional messages while the connection is available.

Possible target syntax:

```text
Mara Launch
from:mara@example.org
subject:Invoice
has:attachment
is:unread
```

Operators are useful but must not be required: ordinary filters remain usable without specialized syntax. These examples do **not** describe an implemented operator parser.

**Current implementation:** bounded `mail.search` and the shared `mail.query`/`mail.count` services operate on the server. Query/count filters combine text, sender, recipient, subject, read state and receipt time; account and folder scope are explicit. They return `scope`, `observedAt`, `countExact` and `complete`. A lower bound must not be presented as a complete count. Time ranges use the host's timezone and server receipt time rather than old conversation dates.

The [filter/count controls](../modules/ovd-mail/frontend/MailQueryControls.tsx) use those same services. Attachment-only and ordinary loaded-view filters apply to the loaded collection; they are not complete server-wide attachment queries. A local full-text index is not present. Query budgets, pagination and the separate legacy search scope are documented in the [architecture](architecture.md).

### Conversations

Optionally group messages into conversations using message and reply IDs as the primary relationship. The subject alone is not a reliable thread key.

It must remain possible to open, reply to, move or delete each message in a conversation independently.

**Current implementation:** reply identifiers are preserved where available, but the UI does not implement conversation/thread grouping.

## 9. Attachments

The target baseline includes:

- Display and download attachments.
- Attach multiple files to a draft.
- Add files by drag and drop.
- Show names and sizes.
- Remove attachments before sending.
- Choose a download location.
- Explain download failures and missing local files.

Image and PDF previews are useful later additions. Never blindly trust a filename or claimed media type.

**Current implementation:** attachment downloads, multiple draft attachments, removal and file selection are available. The optional [Files module](../modules/ovd-files/) can attach a selected file to the active draft. Dragging a Mail or Files entry into Chat creates a reference; it does not implement dragging arbitrary files into the draft editor. Compose-file drop support and image/PDF previews remain target features.

## 10. Synchronization and offline behavior

IMAP connects to the existing mailbox. The target app also maintains a local cache so messages display quickly and previously downloaded content remains available offline.

### Synchronization principles

- Synchronize accounts and folders independently.
- Load recent messages and metadata first; retrieve older content on demand.
- Reconcile read state, flags and moves with the server.
- Show interruptions and reconnect in a controlled way.
- Make offline state visible.
- Mark queued offline changes as **pending**.
- Never silently discard conflicts or failed updates.

Use **UID and UIDVALIDITY per folder** for reliable message identity. If UIDVALIDITY changes, revalidate previous mappings for that folder. See [RFC 9051, unique identifiers](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1).

IMAP IDLE may deliver timely change notifications when available; periodic refresh remains a useful alternative.

**Current implementation:** folder paging and reads validate UID/UIDVALIDITY. Messages are held in bounded session memory and refreshed on demand. Persistent offline mail caching, queued offline mutations, IDLE-driven synchronization and full conflict reconciliation are not implemented. Local drafts and explicit chat snapshots are separate persisted records, not a general offline mailbox.

## 11. Security and privacy

Keep boundaries understandable:

- Store credentials in the **OS credential store**, not as plaintext database values.
- Validate TLS and certificates for IMAP and SMTP.
- Treat mail content and attachments as untrusted data.
- Isolate external HTML when HTML display is introduced.
- Do not load remote images automatically without the relevant user setting.
- Avoid unnecessary logging of passwords, message bodies or complete messages.
- Include the local database, attachments and backups in the privacy design.

**Transport encryption** protects the connection to the mail server; it does not automatically provide end-to-end message encryption. S/MIME or OpenPGP can be added later.

**Current implementation:** credentials use the OS store and TLS checks are active. HTML display is absent rather than an already completed isolated renderer. The local workspace database is not encrypted; drafts, explicit reference snapshots and chat answers can contain mail content. This needs to remain visible in product documentation and in the design of a future persistent mail cache.

## 12. Integration with the OpenVibeDesk assistant

The key difference from an ordinary mail program is practical integration: Chat should act on Mail and open the relevant place in the workspace.

Example requests:

- “Find Mara's email about the launch checklist.”
- “Summarize the latest message from Jonas.”
- “Open this email.”
- “Prepare a reply and ask about the meeting date.”
- “Which attachments does this message have?”

Keep the workflow visible:

```text
The user asks about an email
        |
        v
The assistant discovers the Mail module and loads a suitable tool
        |
        v
A bounded query finds the relevant messages
        |
        v
Select a clear match or ask for genuinely missing information
        |
        v
Open the corresponding message in the Mail window
        |
        v
Answer the question or prepare a draft
```

Product boundaries:

- The user can identify **which message** the assistant is using.
- Mail content may itself contain instructions; it remains data and does not acquire authority over the assistant.
- Required content may be transmitted to the selected AI provider. Make that understandable in the interface.
- The assistant may prepare and open a draft and request sending through the same validated service.
- Sending follows the user's explicit instruction and the configured host confirmation mode. Standard behavior requires confirmation; the user may explicitly save “Without confirmations” for requested assistant actions.
- Future mutations such as move and delete need appropriate, understandable permissions and confirmation behavior; their assistant access must be implemented alongside their UI.

**Current implementation:** explicit mail references and active selection are separate from general mailbox-tool access. Search results and selected references provide bounded resource IDs, not arbitrary trusted text from a drag payload. Before sending a chat message, selected mail content is resolved in the host and stored as a bounded snapshot. General mailbox queries respect the saved access setting or the applicable one-off permission. See the [architecture](architecture.md) and [capabilities](../modules/ovd-mail/backend/capabilities.ts).

## 13. Recommended implementation in OpenVibeDesk

Electron, React, separate windows and the local Main process suit this design. Mail is an **optional module**, not a second feature set hard-coded into Chat.

```text
Mail module frontend
  |-- Message list and reader
  |-- Draft window
  `-- Account settings
           |
           v
Typed preload / named validated capabilities
           |
           v
Mail module backend in the host
  |-- Accounts and credentials
  |-- IMAP access (full synchronization remains a target)
  |-- SMTP submission
  |-- MIME handling
  |-- Attachments
  `-- Local draft storage (persistent mail index/cache remains a target)
           |
           v
The same bounded capabilities exposed to the assistant
```

The renderer calls named functions rather than receiving general network, filesystem or credential access. The assistant uses those same domain functions through the module's offered tools. Initial discovery stays limited to `find_modules` and `get_module_tools`; complete catalogs are not copied into every conversation.

Before introducing a large persistent mailbox, extend the existing simple storage model with suitable account, folder, message, draft, attachment and synchronization-state schemas. The [module contribution guide](../CONTRIBUTING.md#building-modules) explains registration, validated tools and reference contracts. Visual changes also follow the [brand guide](brand.md).

## 14. Development sequence and practical checks

This sequence preserves the original product priorities. Several foundations already exist; it is not a claim that every item in a row is implemented.

| Stage | Scope | Intended result |
| --- | --- | --- |
| **1. Accounts and incoming mail** | Setup, credentials, TLS, IMAP connection, folders and Inbox. | Read real messages safely. |
| **2. Everyday mail reader** | HTML/text, attachments, search, status, move and Trash. | Make the mailbox useful for daily work. |
| **3. Composition and drafts** | Editor, To/CC/BCC, replies, forwarding, attachments and local recovery. | Prepare messages reliably. |
| **4. Sending** | SMTP, clear outcomes, Sent-folder handling and failure recovery. | Deliberate, understandable sending. |
| **5. Assistant workflow** | Find, select, open, summarize and prepare drafts. | Mail and Chat work together. |
| **6. Convenience** | Multiple accounts, unified inbox, signatures, better search and previews. | A rounded everyday tool. |

Assistant access is a requirement of **every implemented stage**, not work postponed until stage 5. Multiple accounts have already arrived and may precede other convenience work when needed. OAuth, calendars, Exchange-specific features and enterprise administration are not prerequisites for the initial baseline.

Use a designated test mailbox or synthetic data for practical checks: receiving, replying, CC/BCC, attachments, recovery after restart, offline behavior and send failures. Test future features when they are introduced; do not present an unimplemented offline or forwarding flow as already verified. Do not send real user mail merely to test a change.

Preserve drag and drop, references, navigation and draft restoration during redesigns. Check each user workflow both through the interface and through the assistant, including the actual result and any confirmation. See [contribution guidance](../CONTRIBUTING.md#building-modules) and the [documentation index](README.md).
