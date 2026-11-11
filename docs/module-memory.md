# Memory modules

[Documentation](README.md) · [Module authoring](../CONTRIBUTING.md#building-modules) · [Module repositories](module-repositories.md)

OVD provides an optional host contract for automatically retrieving relevant memories before a new Assistant request. The module owns storage, search, correction, deletion, settings and its interface. OVD supplies the current question, validates and bounds the returned facts, and adds a source-labelled snapshot to that request. No memory database or memory module is bundled with this extension.

This contract is available from **v0.1.4**. Older hosts, including **v0.1.3**, reject the new manifest contribution. The module catalog currently has no minimum-host-version negotiation; document the required host version when distributing a module.

The separate [Memory module](https://github.com/Tiboriuss/OpenVibeDesk-Modules/tree/main/modules/memory) is an optional catalog download using this Host contract. Its retrieval, storage, observation-review policy and presentation preferences belong to that module; installing OVD alone does not enable a memory store or automatic learning.

## Retrieval and explicit storage

An approved, enabled module opts in with `contributions.memory.retrieveTool`. The named tool must belong to that module and must not require action confirmation. The declaration is a contract that this function only retrieves existing data: it must not create memories, learn from the question, update business records or execute actions mentioned in stored text. Approved process modules run with normal user permissions, so this semantic contract is not an operating-system sandbox.

Before the first AI request of a new task, the host retrieves from ready memory providers with Workspace tools enabled, at most once per provider and within the shared retrieval deadline. The model does not have to discover the module first. Normal tools for explicitly saving, finding, correcting or deleting memories still use lazy discovery and the same domain services as the module interface. A user request such as “Remember our workshop's opening hours” is handled by those ordinary tools, not by the automatic retrieval hook.

The hook receives only the bounded current user text, an opaque chat ID, host time and result limits. It receives no earlier messages, attached resource contents, provider credentials or automatic post-answer event. Its result is factual context, never an instruction or access grant. The host does not treat an automatically retrieved “skill” or command as a user-selected working instruction.

## Manifest and callback

The additive API-v1 contribution is:

```json
"contributions": {
  "views": [],
  "navigation": [],
  "settings": [],
  "memory": { "retrieveTool": "company-memory.recall" }
}
```

Here is a complete minimal `module.json` for a retrieval adapter:

```json
{
  "apiVersion": 1,
  "id": "company-memory",
  "title": "Company memory",
  "version": "0.1.0",
  "description": "Retrieve explicitly saved company facts with their sources.",
  "keywords": ["memory", "remember", "facts"],
  "permissions": ["Read the module's saved memories"],
  "runtime": { "type": "process", "entry": "backend.cjs" },
  "capabilities": ["company-memory.recall"],
  "tools": [{
    "name": "company-memory.recall",
    "label": "Find saved facts",
    "description": "Read relevant saved facts without changing them. Return sources and validity dates.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "maxLength": 6000 },
        "sessionId": { "type": "string", "minLength": 1, "maxLength": 128 },
        "now": { "type": "string", "maxLength": 40 },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20 },
        "maxChars": { "type": "integer", "minimum": 1, "maximum": 8000 }
      },
      "required": ["query", "sessionId", "now", "limit", "maxChars"],
      "additionalProperties": false
    }
  }],
  "contributions": {
    "views": [],
    "navigation": [],
    "settings": [],
    "memory": { "retrieveTool": "company-memory.recall" }
  }
}
```

The host calls the ordinary tool handler with:

```js
{
  query: "When does our workshop open on Saturday?",
  sessionId: "opaque-host-chat-id",
  now: "2026-11-03T13:00:00.000Z",
  limit: 20,
  maxChars: 8000
}
```

Return this strict JSON envelope, using an empty array for no relevant facts:

```json
{
  "hasMore": false,
  "memories": [{
    "id": "opening-hours-saturday",
    "text": "The workshop opens at 09:00 on Saturdays.",
    "source": {
      "title": "Opening hours confirmed by the workshop manager",
      "uri": "https://example.com/workshop/opening-hours"
    },
    "updatedAt": "2026-11-01T10:00:00.000Z",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }]
}
```

The optional `hasMore: true` reports that the module found additional relevant facts beyond its returned selection. It marks retrieval as truncated even when every returned record fits the host budget; omitting it defaults to no such claim. `id`, `text` and `source.title` are required. `source.uri` is an optional HTTP(S) address without credentials. A module can also return `source.reference: {type, id}` for one of its own declared reference types; the host binds module identity itself. The source is provenance supplied by the module, not proof that its factual claim is correct. `updatedAt` and `expiresAt` are optional ISO timestamps. Return precise sources and dates whenever available; the host excludes expired records and removes duplicate IDs within one module.

The [shared schemas](../shared/module-memory.ts) are the authoritative contract. Bounds include 20 returned records per provider, 2,000 characters per memory text, 128 characters for a memory ID, 300 for a source title and 1,000 for a source URI. The question is limited to 6,000 characters; its JSON-encoded form also fits 6,000 UTF-8 bytes. The combined accepted memory array is limited to 20 records and 8,000 serialized characters, including host-bound provenance. Character limits are not token counts, and the ordinary process transport limits still apply. The host interleaves providers in stable module-ID order to prevent one provider from taking every slot. It records at most 500 providers; an installation beyond this bound reports truncation. Return your most relevant entries first; additional explicit searches remain available through ordinary module tools.

## Chat presentation

Successful empty retrievals are silent by default. The module owns any user-facing preference for displaying its recall results, alongside its other settings. The host has no dedicated memory display setting: it renders the generic result contract below. Errors and truncated results remain visible, so a missing or partial source is not mistaken for a complete result.

A retrieval result can additionally return an optional presentation hint:

```json
{ "memories": [], "display": "hide" }
```

| `display` | Chat presentation |
| --- | --- |
| Omitted or `"auto"` | Show this provider when it contributes memories; hide a successful empty result. |
| `"show"` | Show this provider's retrieval disclosure, including an intentionally empty result. |
| `"hide"` | Hide this provider's memories and successful disclosure; keep any failure or truncation warning. |

A module cannot suppress failure or truncation warnings. With multiple providers, the host filters their normal disclosures and memories independently; one module's `"hide"` does not hide another module's results. For a truncated result with `"hide"`, the warning remains visible while that module's memory text is hidden.

This is presentation only. A hint does not disable retrieval, remove a memory from model context, change permissions or become an instruction. The host saves the hint with that answer's provider status, and continuation/reformulation reuses that snapshot. A later change to the module's preference affects new retrieval results; saved answers retain their recorded hints without another module call. Historical snapshots without hints follow the automatic default.

### Module-owned display preferences

If a module offers display controls, implement them inside that module:

1. Declare its own settings entry in `contributions.settings` and render a compact choice in that settings form, for example **Show relevant results**, **Always show results**, and **Hide normal results**. Store the choice durably in the module's `dataDirectory` through one validated settings service.
2. Expose reading and changing that preference through the module's ordinary tools, using the same service as its settings form. For example, `company-memory.get-settings` and `company-memory.update-settings` can handle “Hide this module's recall notices.” Keep authorization, saves and errors consistent across the interface and Assistant.
3. In the read-only retrieval handler, read the already saved preference and map it to `display: "auto"`, `"show"` or `"hide"` in the returned envelope. Include it even when `memories` is empty. Do not update the setting or learn from the question while retrieving.

For example, after your module's own service has loaded the preference and retrieved the matching records:

```js
const display = savedSettings.recallDisplay ?? 'auto';
return { memories, hasMore, display };
```

Validate the stored value with the shared `memoryResultDisplaySchema`. This is an authoring pattern, not a bundled settings service or memory module; each module supplies its own storage, interface and tools. The host does not inspect module-specific settings or add their controls to core categories.

The `display` hint is supported from **v0.1.7**; releases through **v0.1.6** do not accept it in the strict result envelope. Modules supporting those hosts must omit the field. The original `memories`/`hasMore` contract remains compatible.

## Minimal CommonJS backend

This adapter reads `memories.json` from its own `dataDirectory`. The JSON file contains an array of records matching the response example above. The example deliberately supplies only the retrieval part; a complete memory module adds its own explicit save/edit/delete tools, durable storage, settings and interface. It must not write this file from `recall` or from activation.

```js
const fs = require('node:fs/promises');
const path = require('node:path');

exports.activate = async ({ dataDirectory }) => ({
  tools: {
    'company-memory.recall': async ({ query, now, limit, maxChars }, { signal }) => {
      signal.throwIfAborted();
      const file = path.join(dataDirectory, 'memories.json');
      let records;
      try {
        if ((await fs.stat(file)).size > 64 * 1024) {
          throw new Error('Use indexed storage for larger memory collections.');
        }
        records = JSON.parse(await fs.readFile(file, { encoding: 'utf8', signal }));
      } catch (error) {
        if (error.code === 'ENOENT') return { memories: [] };
        throw error;
      }
      if (!Array.isArray(records)) throw new Error('Invalid memory store.');
      const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const ranked = records
        .filter(item => !item.expiresAt || Date.parse(item.expiresAt) > Date.parse(now))
        .map(item => ({ item, score: terms.filter(term => item.text.toLocaleLowerCase().includes(term)).length }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const memories = [];
      for (const { item } of ranked) {
        signal.throwIfAborted();
        if (memories.length >= limit) break;
        if (JSON.stringify({ memories: [...memories, item] }).length > maxChars) continue;
        memories.push(item);
      }
      return { memories, hasMore: memories.length < ranked.length };
    }
  }
});
```

Production modules should validate their store, rank relevance meaningfully, distinguish projects/people and retain correction provenance. The chat ID can help scope a lookup but is not a user identity or permission token. Do not infer that every returned preference is globally applicable. Resolve contradictions in the module and expose inspection and correction through the same tools used by the interface.

## Request lifecycle and visibility

- Only available, enabled modules with approved current code run. A new package or changed fingerprint retains the existing code-approval flow. Disabling Workspace tools skips automatic memory retrieval.
- Retrieval uses at most four concurrent callbacks under one five-second host deadline, propagates cancellation and makes no automatic retry. A queued callback that cannot start before the deadline is reported as failed without being invoked. An unavailable, invalid or timed-out provider contributes a bounded failure status; other successful results can still be used. The Assistant must not claim that missing results prove no memories exist.
- The host binds module identity, validates sources and validity, and adds the bounded selection as untrusted context for the current task. Tool schemas and the complete memory store are not preloaded.
- When the display rules above call for it, chat shows a compact **Gedächtnis** disclosure with the number of selected memories and unavailable sources. Expanding it reveals source labels, recorded text, dates and provider results. Successful empty retrievals do not add a disclosure under the default behavior; failure and truncation warnings remain visible.
- The accepted snapshot is saved with that assistant message before inference. It records what was supplied for this answer, rather than becoming a second editable memory store. Ordinary future history does not automatically reinsert earlier snapshots; a new request retrieves again.
- **Reformulate answer** uses the stored snapshot and evidence only. It does not run a memory callback, even under **Without confirmations**. Explicit task continuation reuses the original snapshot instead of refreshing facts halfway through the saved task.

Disabling or deleting a memory module does not retroactively erase snapshots already stored in chats. A module's own retention or correction policy applies to its store; existing chat snapshots remain historical records. The read-only retrieval interface provides no learning or background extraction. A module may separately opt into the [generic event interface](module-events.md) to receive selected future observations and process them into its own store. Those subscriptions start off, require their own user selection and never turn retrieval into a write operation. OVD supplies no finished memory module or extraction policy.

## Optional event-based updates

A memory module may additionally declare `contributions.events.subscriptions` for selected host chat topics or other modules' domain events. The user chooses those sources under Settings → Modules. The host then delivers future bounded events to `onEvent(event, {signal})` independently of the foreground chat. The receiver owns relevance decisions, durable updates and deduplication receipts; the host owns the queue and acknowledgement protocol. See [Module events](module-events.md) for the complete contract and failure behavior.

Keep the two entry points separate. `recall` only retrieves already stored facts. `onEvent` may update the module's own store according to its configured policy, then return `{ack: event.id}`. Treat user statements, assistant claims and confirmed action outcomes distinctly. A finished-turn event is not proof that every sentence in its assistant text is correct. Event redelivery must not duplicate memory records or replay the originating actions.

## Practical validation before publishing

Use synthetic facts and an isolated profile. Verify the module through its interface and ordinary Assistant tools, then start a new chat and ask a question that requires a saved fact. Inspect the exact provider request and the **Gedächtnis** disclosure. Also exercise no matches, `display: "show"`/`"hide"`, changing the module's saved display preference through its interface and Assistant, an expired fact, malformed output, cancellation, a slow provider, multiple modules and the combined budget. Confirm that hiding presentation leaves the model context unchanged and cannot hide failures or truncation. Confirm that an unapproved/disabled module and disabled Workspace tools cause no recall invocation. Restart and reformulate a saved answer: the recorded snapshot and presentation hint must remain available without a new lookup or write. Test explicit continuation with the same expectation.

Publish the prepared module through the existing [repository workflow](module-repositories.md#publish-a-module). Installing the package alone does not execute its code or grant new access.
