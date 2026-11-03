import { z } from 'zod';

export const MODULE_EVENT_PAYLOAD_CHARS = 8000;
export const MODULE_EVENT_BYTES = 14000;
export const MODULE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MODULE_EVENT_PENDING_LIMIT = 1000;
export const MODULE_EVENT_DELIVERY_LIMIT = 5000;
export const MODULE_EVENT_LEDGER_LIMIT = 10000;
export const MODULE_EVENT_QUEUE_BYTES = 8 * 1024 * 1024;

export const eventModuleIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/).max(80);
export const moduleEventTopicSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/).max(160);
const eventId = z.string().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value));

function boundedJson(value: unknown): boolean {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 2000 || depth > 8) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'string') return item.length <= MODULE_EVENT_PAYLOAD_CHARS;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) return item.length <= 1000 && item.every(child => visit(child, depth + 1));
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
    return Object.entries(item).every(([key, child]) => key.length <= 300 && visit(child, depth + 1));
  };
  try { return visit(value, 0) && JSON.stringify(value).length <= MODULE_EVENT_PAYLOAD_CHARS; } catch { return false; }
}

/** Event payloads are bounded data. Source identity and recipients are assigned by the host. */
export const moduleEventSchema = z.object({
  version: z.literal(1), id: eventId, type: moduleEventTopicSchema,
  source: z.object({ moduleId: eventModuleIdSchema }).strict(),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).refine(boundedJson, 'Event payload must be bounded JSON data.')
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= MODULE_EVENT_BYTES, 'Event exceeds its transport budget.');
export type ModuleEvent = z.infer<typeof moduleEventSchema>;

export const moduleEventRecipientSchema = z.object({
  moduleId: eventModuleIdSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), grantId: z.string().uuid()
}).strict();
export type ModuleEventRecipient = z.infer<typeof moduleEventRecipientSchema>;
export const moduleEventPublicationSchema = z.object({
  event: moduleEventSchema, recipients: z.array(moduleEventRecipientSchema).max(500)
}).strict().refine(value => new Set(value.recipients.map(item => item.moduleId)).size === value.recipients.length, 'Duplicate event recipient.');
export type ModuleEventPublication = z.infer<typeof moduleEventPublicationSchema>;
export interface ModuleEventDelivery { event: ModuleEvent; recipient: ModuleEventRecipient; attempts: number; nextAttemptAt: number; }
export interface ModuleEventQueueStatus { pending: number; failed: number; lastError?: string; }
export interface ModuleEventGrant { fingerprint: string; grantId: string; topics: readonly string[]; }
