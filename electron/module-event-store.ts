import { createHash } from 'node:crypto';
import type { Database, SqlValue } from 'sql.js';
import { MODULE_EVENT_DELIVERY_LIMIT, MODULE_EVENT_LEDGER_LIMIT, MODULE_EVENT_PENDING_LIMIT, MODULE_EVENT_QUEUE_BYTES, MODULE_EVENT_RETENTION_MS,
  moduleEventPublicationSchema, moduleEventRecipientSchema, moduleEventSchema, moduleEventTopicSchema, type ModuleEvent, type ModuleEventDelivery, type ModuleEventGrant,
  type ModuleEventPublication, type ModuleEventQueueStatus, type ModuleEventRecipient } from '../shared/module-events';

/** SQL mutations are called only inside the workspace store's durable write queue. */
export function initializeModuleEventStore(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS module_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, id TEXT NOT NULL,
    type TEXT NOT NULL, occurred_at INTEGER NOT NULL, hash TEXT NOT NULL,
    event_json TEXT, payload_bytes INTEGER NOT NULL DEFAULT 0, UNIQUE(source, id))`);
  db.run(`CREATE TABLE IF NOT EXISTS module_event_deliveries (
    event_sequence INTEGER NOT NULL, module_id TEXT NOT NULL, fingerprint TEXT NOT NULL, grant_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(event_sequence, module_id))`);
  db.run('CREATE INDEX IF NOT EXISTS module_event_delivery_due ON module_event_deliveries(next_attempt_at, event_sequence)');
}

type Row = Record<string, SqlValue>;
function rows(db: Database, sql: string, values: SqlValue[] = []): Row[] {
  const statement = db.prepare(sql);
  try { statement.bind(values); const result: Row[] = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
}
function scalar(db: Database, sql: string): number { return Number(Object.values(rows(db, sql)[0] ?? { value: 0 })[0] ?? 0); }
function eventHash(event: ModuleEvent): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(event))).digest('hex');
}
function clearDeliveredPayloads(db: Database): void {
  db.run('UPDATE module_events SET event_json = NULL, payload_bytes = 0 WHERE event_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM module_event_deliveries d WHERE d.event_sequence = module_events.sequence)');
}
function pruneAcknowledged(db: Database, now: number): void {
  // Never remove pending deliveries to make room. Empty acknowledged tombstones
  // outlive the accepted publication window, so old events cannot be replayed.
  db.run('DELETE FROM module_events WHERE occurred_at < ? AND event_json IS NULL AND NOT EXISTS (SELECT 1 FROM module_event_deliveries d WHERE d.event_sequence = module_events.sequence)', [now - MODULE_EVENT_RETENTION_MS]);
}

export function insertModuleEvents(db: Database, publications: readonly ModuleEventPublication[], now = Date.now()): void {
  pruneAcknowledged(db, now);
  for (const raw of publications) {
    const { event, recipients } = moduleEventPublicationSchema.parse(raw), source = event.source.moduleId, hash = eventHash(event);
    const existing = rows(db, 'SELECT hash FROM module_events WHERE source = ? AND id = ?', [source, event.id])[0];
    if (existing) {
      if (existing.hash !== hash) throw new Error('Diese Ereignis-ID wurde bereits mit anderem Inhalt gespeichert.');
      // Recipients are immutable at initial publication. A retry cannot expose
      // historical content to a newly enabled subscriber or a new code grant.
      continue;
    }
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAt) || occurredAt < now - MODULE_EVENT_RETENTION_MS || occurredAt > now + 5 * 60 * 1000) throw new Error('Das Ereignis liegt außerhalb des zulässigen Zeitraums.');
    if (scalar(db, 'SELECT COUNT(*) FROM module_events') >= MODULE_EVENT_LEDGER_LIMIT) throw new Error('Das Ereignisprotokoll hat sein Aufbewahrungslimit erreicht. Neue Ereignisse wurden nicht gespeichert.');
    const encoded = JSON.stringify(event), bytes = Buffer.byteLength(encoded, 'utf8');
    if (recipients.length && (scalar(db, 'SELECT COUNT(*) FROM module_events WHERE event_json IS NOT NULL') >= MODULE_EVENT_PENDING_LIMIT
      || scalar(db, 'SELECT COUNT(*) FROM module_event_deliveries') + recipients.length > MODULE_EVENT_DELIVERY_LIMIT
      || scalar(db, 'SELECT COALESCE(SUM(payload_bytes),0) FROM module_events') + bytes > MODULE_EVENT_QUEUE_BYTES)) throw new Error('Die Ereigniswarteschlange ist voll. Vorhandene Ereignisse bleiben erhalten; neue wurden nicht gespeichert.');
    db.run('INSERT INTO module_events(source,id,type,occurred_at,hash,event_json,payload_bytes) VALUES(?,?,?,?,?,?,?)', [source, event.id, event.type, occurredAt, hash, recipients.length ? encoded : null, recipients.length ? bytes : 0]);
    const sequence = scalar(db, 'SELECT last_insert_rowid()');
    for (const recipient of recipients) db.run('INSERT INTO module_event_deliveries(event_sequence,module_id,fingerprint,grant_id) VALUES(?,?,?,?)', [sequence, recipient.moduleId, recipient.fingerprint, recipient.grantId]);
  }
}

export function readPendingModuleEvents(db: Database, limit = 20, now = Date.now()): ModuleEventDelivery[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isFinite(now)) throw new Error('Ungültige Ereignisabfrage.');
  return rows(db, `SELECT e.event_json,e.hash,d.module_id,d.fingerprint,d.grant_id,d.attempts,d.next_attempt_at
    FROM module_event_deliveries d JOIN module_events e ON e.sequence = d.event_sequence
    WHERE d.next_attempt_at <= ? AND NOT EXISTS (
      SELECT 1 FROM module_event_deliveries earlier WHERE earlier.module_id = d.module_id AND earlier.event_sequence < d.event_sequence
    ) ORDER BY e.sequence,d.module_id LIMIT ?`, [now, limit]).map(row => {
    try {
      const event = moduleEventSchema.parse(JSON.parse(String(row.event_json)));
      if (eventHash(event) !== row.hash) throw new Error('Event checksum mismatch');
      return { event, recipient: moduleEventRecipientSchema.parse({ moduleId: row.module_id, fingerprint: row.fingerprint, grantId: row.grant_id }),
        attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at) };
    } catch { throw new Error('Das gespeicherte Modulereignis ist ungültig. Es wird nicht zugestellt.'); }
  });
}

function identity(delivery: ModuleEventDelivery): SqlValue[] {
  const event = moduleEventSchema.parse(delivery.event), recipient = moduleEventRecipientSchema.parse(delivery.recipient);
  return [event.source.moduleId, event.id, recipient.moduleId, recipient.fingerprint, recipient.grantId];
}
const deliveryWhere = 'event_sequence IN (SELECT sequence FROM module_events WHERE source = ? AND id = ?) AND module_id = ? AND fingerprint = ? AND grant_id = ?';
export function acknowledgeStoredModuleEvent(db: Database, delivery: ModuleEventDelivery): void {
  db.run(`DELETE FROM module_event_deliveries WHERE ${deliveryWhere}`, identity(delivery));
  clearDeliveredPayloads(db);
}
export function failStoredModuleEvent(db: Database, delivery: ModuleEventDelivery, detail?: string, now = Date.now()): void {
  if (!Number.isFinite(now)) throw new Error('Ungültiger Ereigniszeitpunkt.');
  const values = identity(delivery), current = rows(db, `SELECT attempts FROM module_event_deliveries WHERE ${deliveryWhere}`, values)[0];
  if (!current) return;
  const attempts = Math.min(1_000_000, Number(current.attempts) + 1), delay = Math.min(300_000, 1000 * 2 ** Math.min(attempts - 1, 9));
  db.run(`UPDATE module_event_deliveries SET attempts = ?,next_attempt_at = ?,last_error = ?,updated_at = ? WHERE ${deliveryWhere}`,
    [attempts, now + delay, detail?.slice(0, 300) || 'Das Modul hat die Verarbeitung noch nicht bestätigt.', now, ...values]);
}
export function dropStoredModuleEvents(db: Database, moduleId: string, keep?: ModuleEventGrant): void {
  if (keep) {
    moduleEventRecipientSchema.parse({ moduleId, fingerprint: keep.fingerprint, grantId: keep.grantId });
    const topics = new Set(keep.topics);
    for (const row of rows(db, 'SELECT d.event_sequence,d.fingerprint,d.grant_id,e.type FROM module_event_deliveries d JOIN module_events e ON e.sequence = d.event_sequence WHERE d.module_id = ?', [moduleId])) {
      if (row.fingerprint !== keep.fingerprint || row.grant_id !== keep.grantId || !topics.has(String(row.type))) db.run('DELETE FROM module_event_deliveries WHERE event_sequence = ? AND module_id = ?', [row.event_sequence, moduleId]);
    }
  } else db.run('DELETE FROM module_event_deliveries WHERE module_id = ?', [moduleId]);
  clearDeliveredPayloads(db);
}
function revokedDeliveries(db: Database, grants: readonly (ModuleEventRecipient & { topics: readonly string[] })[]): Row[] {
  if (grants.length > 16000) throw new Error('Zu viele Ereignisabonnements.');
  const allowed = new Map<string, { fingerprint: string; grantId: string }>(), modules = new Set<string>();
  for (const grant of grants) {
    const { moduleId, fingerprint, grantId } = moduleEventRecipientSchema.parse({ moduleId: grant.moduleId, fingerprint: grant.fingerprint, grantId: grant.grantId });
    modules.add(moduleId);
    if (modules.size > 500 || grant.topics.length > 100) throw new Error('Ungültige Ereignisabonnements.');
    for (const rawTopic of grant.topics) {
      const topic = moduleEventTopicSchema.parse(rawTopic), key = `${moduleId}\0${topic}`, previous = allowed.get(key);
      if (previous && (previous.fingerprint !== fingerprint || previous.grantId !== grantId)) throw new Error('Widersprüchliche Ereignisabonnements.');
      allowed.set(key, { fingerprint, grantId });
      if (allowed.size > 16000) throw new Error('Zu viele Ereignisabonnements.');
    }
  }
  return rows(db, 'SELECT d.event_sequence,d.module_id,d.fingerprint,d.grant_id,e.type FROM module_event_deliveries d JOIN module_events e ON e.sequence = d.event_sequence').filter(row => {
    const grant = allowed.get(`${row.module_id}\0${row.type}`);
    return !grant || grant.fingerprint !== row.fingerprint || grant.grantId !== row.grant_id;
  });
}
export function moduleEventGrantsNeedReconciliation(db: Database, grants: readonly (ModuleEventRecipient & { topics: readonly string[] })[]): boolean {
  return revokedDeliveries(db, grants).length > 0;
}
export function reconcileStoredModuleEventGrants(db: Database, grants: readonly (ModuleEventRecipient & { topics: readonly string[] })[]): void {
  for (const row of revokedDeliveries(db, grants)) db.run('DELETE FROM module_event_deliveries WHERE event_sequence = ? AND module_id = ?', [row.event_sequence, row.module_id]);
  clearDeliveredPayloads(db);
}
export function readModuleEventQueueStatus(db: Database, moduleId?: string): ModuleEventQueueStatus {
  const values = moduleId === undefined ? [] : [moduleId], where = moduleId === undefined ? '' : ' WHERE module_id = ?';
  const summary = rows(db, `SELECT COUNT(*) AS pending,COALESCE(SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END),0) AS failed FROM module_event_deliveries${where}`, values)[0];
  const error = rows(db, `SELECT last_error FROM module_event_deliveries WHERE last_error IS NOT NULL${moduleId === undefined ? '' : ' AND module_id = ?'} ORDER BY updated_at DESC LIMIT 1`, values)[0];
  return { pending: Number(summary.pending), failed: Number(summary.failed), ...(typeof error?.last_error === 'string' ? { lastError: error.last_error.slice(0, 300) } : {}) };
}
