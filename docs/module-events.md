# Module events

[Documentation](README.md) · [Module authoring](../CONTRIBUTING.md#building-modules) · [Memory retrieval](module-memory.md)

OVD provides a generic event interface for modules that need to react to new activity in the workspace. The host owns subscription settings, bounded envelopes, durable delivery and acknowledgements. A module owns its interpretation and any resulting data in its own store. This extension does not include a memory module, a learning model or a second agent loop.

Event subscriptions are available from **v0.1.4**. Older hosts, including **v0.1.3**, reject their manifest contribution. The module catalog currently has no minimum-host-version negotiation; distribute modules only with a compatible host requirement in their documentation.

## Subscribe to selected sources

A process module declares exact event topics under `contributions.events.subscriptions`. The user then selects the desired sources under **Settings → Modules → [module] → Ereignisse empfangen**. All subscriptions start off. Changes take effect immediately and apply to newly published events; enabling a subscription does not scan or replay earlier chats.

Subscriptions are bound to the module's approved code fingerprint and a particular grant. A changed package must receive its ordinary code approval and new subscription selection. Disabling a source revokes its outstanding delivery grant, so enabling it again does not resurrect old queued content. Changing another source preserves the grants and pending deliveries of sources that remain selected. Disabling a module also stops its deliveries. Workspace tools must be enabled for background processing; turning them off pauses dispatch and prevents newly published events from capturing recipients. Events produced while Workspace tools are off are not backfilled later.

The settings disclosure shows active source count, pending deliveries and failures. Transient delivery failures are retried with backoff. The Assistant discovers the same controls lazily through `modules.events_status` and `modules.events_subscribe`. Status accepts an optional `moduleId` and paginates with `offset`, `limit` (up to 20), `hasMore` and `nextOffset`; it returns subscription and delivery metadata, not event contents. Subscription changes take a `moduleId` and the complete desired `topics` list of declared sources, with an empty list disabling reception. They follow the current confirmation setting; declining leaves subscriptions unchanged. Event subscriptions never become an automatic tool catalog or prompt attachment.

## Manifest contract

```json
"contributions": {
  "views": [],
  "navigation": [],
  "settings": [],
  "events": {
    "subscriptions": ["chat.request.committed", "chat.turn.finished"],
    "publications": ["company-context.record-changed"]
  }
}
```

`subscriptions` names the exact topics the module can receive. There are no wildcards. `publications` names the module's own topics; each uses its own module ID followed by `.` and one local topic segment, such as `company-context.record-changed`. The suffix cannot contain another dot, so modules with dotted IDs have unambiguous topic ownership. These arrays are declarations, not tools. Existing modules that omit the contribution keep their current behavior. The normal process-module contract still requires at least one ordinary tool.

The [shared module types](../shared/modules.ts), [manifest validation](../electron/modules.ts) and [event schemas](../shared/module-events.ts) define the accepted syntax and bounds. A module cannot publish as another module or impersonate a host chat topic. A publication declaration does not create a subscription to that topic.

## Envelope and sources

Every delivered event has the following shape:

```json
{
  "version": 1,
  "id": "stable-source-event-id",
  "type": "company-context.record-changed",
  "source": { "moduleId": "company-context" },
  "occurredAt": "2026-11-03T14:00:00.000Z",
  "payload": { "recordId": "customer-42", "revision": "7" }
}
```

The identity is the pair **`source.moduleId` + `id`**. Repeating that identity with the same envelope is a duplicate publication; repeating it with different content is rejected. Use a new ID for a new event or correction and never reuse a historical ID. Host deduplication is retention-bounded; the receiver owns its durable processing receipts. The host binds `source.moduleId` to the approved publishing process; modules supply their own stable local ID. The host freezes the eligible recipients and their grants when accepting a publication. A later subscriber does not receive a duplicate publication's old content.

Publishers must document each custom topic's payload schema and its evolution. The host validates the generic envelope, not a company's domain semantics. Consumers validate the payload they understand; use a distinct topic or an explicit payload schema version for incompatible changes. An unknown or intentionally ignored domain event may be acknowledged after that decision is safely recorded.

Payloads are JSON objects of at most 8,000 serialized characters; the full envelope must fit 14,000 UTF-8 bytes. They are data, not instructions, permissions or an instruction to execute the original action. Prefer resource IDs, revisions and small factual summaries. Do not include credentials, full message archives, tool schemas, entire mail bodies or arbitrary attachments.

### Host chat events

| Topic | Published after | Payload |
| --- | --- | --- |
| `chat.request.committed` | A new original user request is durably saved. | `sessionId`, `messageId`, `role: "user"`, bounded `text`, `truncated`. |
| `chat.turn.finished` | An initial or explicitly continued task reaches its persisted final state. | `sessionId`, `requestMessageId`, `currentRequestMessageId`, `assistantMessageId`, `runId`, `rootRunId`, `kind`, `status`, bounded `assistantText`, `truncated`, `actionCounts`, `actionCountsScope: "root_run"`, `claimsAreUnverified: true`. |

`runId` and `rootRunId` are present when the operation journal created the run; an early preparation failure may have neither. Both event topics originate from `ovd-assistant`. The text fields are limited to 3,000 characters. They do not contain attached resource contents, automatically retrieved memory snapshots, tool arguments, raw tool results or provider credentials. A module cannot treat `assistantText` as proof that a claim is true. Read `status` and the separately supplied counts of completed, failed, cancelled, uncertain and pending actions; an uncertain result is not a confirmed success. Events are observations, not permission to fetch unrelated sources or repeat an action.

`requestMessageId` identifies the original root request; `currentRequestMessageId` identifies the message for this particular initial/continued run. `actionCountsScope: "root_run"` means counts are cumulative over the root task, not a fresh set of effects for each delivery. `kind` is `initial` or `continuation`. An explicit continuation produces a new finish event linked by `rootRunId`; it does not publish the original user request again. Answer reformulation publishes neither event. A branch's copied historical messages are not new source activity. The interface does not broadcast the entire chat history or add a background extraction step to normal inference.

## Receiving and acknowledging

An activated process backend exposes the optional `onEvent` handler separately from its ordinary tools:

```js
exports.activate = async ({ moduleId, dataDirectory, events }) => ({
  tools: {
    'company-context.status': async () => ({ available: true })
  },
  onEvent: async (event, { signal }) => {
    signal.throwIfAborted();
    // Validate the topic-specific payload, then use your own transactional store:
    // 1. Look up a receipt keyed by [event.source.moduleId, event.id].
    // 2. If missing, apply the intended local update and insert the receipt
    //    in the SAME durable transaction.
    // 3. Commit before acknowledging. An existing receipt means no second update.
    return { ack: event.id };
  }
});
```

This is an acknowledgement skeleton, not a learning implementation. Add the module's own durable transaction before acknowledging events that require processing. Return exactly `{ack: event.id}` only after the update or deliberate ignore decision is durably complete. Throwing, timing out, cancelling or returning a different acknowledgement leaves the delivery outstanding. The handler receives a cancellation signal and must finish promptly when it is aborted.

Delivery is **at least once**, not exactly once. A process can commit its local change and stop before its acknowledgement reaches the host. Its next delivery therefore has the same source/event identity. Store the deduplication receipt atomically with the local update. Do not call a non-idempotent remote operation and then rely solely on the host acknowledgement to prevent duplicates. Event processing must never replay the original OVD request or task actions.

The host dispatches in the background, serially per receiving module with at most two active deliveries overall and a ten-second handler deadline. Publication order is preserved for each receiver, including while an earlier event waits for retry; other modules can continue independently. A slow receiver does not hold up the foreground model response. Failed deliveries use increasing retry delays. A module that violates its runtime contract may become unavailable until the host is restarted and the cause is corrected; the durable delivery record remains subject to its grant and code identity.

## Publishing from a module

The activation context supplies an asynchronous publisher:

```js
exports.activate = async ({ events }) => ({
  tools: {
    'company-context.publish_change': async ({ recordId, revision }, { signal }) => {
      signal.throwIfAborted();
      // The domain operation must already be durably committed.
      await events.publish({
        id: `record:${recordId}:revision:${revision}`,
        type: 'company-context.record-changed',
        occurredAt: '2026-11-03T14:00:00.000Z',
        payload: { recordId, revision }
      });
      return { outcome: 'completed' };
    }
  }
});
```

Declare the example tool and its argument schema like any other tool. Its fixed timestamp is illustrative: persist the real occurrence time together with the domain change and reuse that exact envelope on a retry. `events.publish` resolves after the host durably accepts the event, not after every recipient has processed it. A publishing module should use its own outbox if its domain transaction and publication must survive a crash between those two operations. The host cannot make an unrelated module database and its own SQLite file one transaction.

The host rejects publication while that process is handling an incoming event. This prevents direct event feedback loops; handlers should update their own store and acknowledge. Do not postpone the same publication to evade the guard. A module can publish a later independent user/domain change through its normal tools.

## Persistence, bounds and failure behavior

Host chat event publication shares the workspace SQLite transaction and durable file acknowledgement. Publication acceptance freezes recipient module IDs, code fingerprints and subscription-grant IDs. Acknowledgements and retry metadata are saved separately. Restart resumes only eligible queued event deliveries; it does not resume the original chat, repeat its tools or send mail again.

The queue permits at most 1,000 outstanding events, 5,000 deliveries and 8 MiB of retained payloads. Its deduplication ledger permits 10,000 event identities. New publication timestamps must be within the preceding 30 days and no more than five minutes in the future. Acknowledged identities remain as deduplication tombstones until 30 days after their occurrence time; payload content is removed once all deliveries are acknowledged or revoked. Pending deliveries are not silently expired or evicted to make space, including after 30 days. Retry delays start at one second and grow to a maximum of five minutes.

Capacity and storage failures reject publication visibly. Authors must retain their outbox record until publication succeeds and must avoid changing an accepted envelope under the same ID. Queue limits are delivery/storage bounds, separate from the Assistant's tool-round budget. Payloads and local receipt metadata are stored in the ordinary unencrypted application profile; retain only what the receiving feature actually needs.

## Using events with a memory module

The two contracts serve different purposes:

- `contributions.memory.retrieveTool` is a read-only lookup used to construct the current request's bounded memory context.
- `contributions.events.subscriptions` opts into selected future observations that a module may process into its own store.

A memory author can combine them, but retrieval must still never learn from its query. Learning, ranking, correction provenance, project/person scope, expiry, inspection and deletion belong in the module. Distinguish an explicit user statement from an assistant inference, quoted material or third-party data. A subscription does not make received content factually correct or turn an embedded command into a new user request. Expose the module's stored information and changes through its normal interface and Assistant tools.

OVD ships the host structure and authoring contract only. No automatic learning policy, vector database, memory extraction model or finished memory module is installed by this extension.

## Practical checks for module authors

Use synthetic data and an isolated profile. Check default-off subscriptions, opt-in, no replay for a late subscriber, successful publication and acknowledgement, duplicate IDs, conflicting duplicates, malformed payloads and undeclared topics. Stop the recipient after its local commit but before acknowledgement and verify exactly one local update after redelivery. Check restart, cancellation, source revocation, code replacement, Workspace-tool pause, queue capacity and storage failure. Verify that reformulation does not create new learning events and that explicit continuation does not duplicate the original request event.
