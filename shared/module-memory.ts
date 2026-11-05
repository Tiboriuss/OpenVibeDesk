import { z } from 'zod';

/** Retrieval limits are context/transport budgets, not agent action-loop limits. */
export const MEMORY_QUERY_CHARS = 6000;
export const MEMORY_CONTEXT_CHARS = 8000;
export const MEMORY_MAX_ITEMS = 20;
export const MEMORY_TIMEOUT_MS = 5000;
export const memoryResultDisplaySchema = z.enum(['auto', 'show', 'hide']);
const resourceId = z.string().trim().min(1).max(128);
const moduleId = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/).max(80);
const timestamp = z.iso.datetime({ offset: true });
const sourceUrl = z.string().max(1000).refine(value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, 'Memory source URLs must use HTTP(S) without credentials.');

/** Only the current query and opaque session identity are supplied automatically. */
export const memoryRecallRequestSchema = z.object({
  query: z.string().max(MEMORY_QUERY_CHARS), sessionId: resourceId, now: timestamp
}).strict();
export type MemoryRecallRequest = z.infer<typeof memoryRecallRequestSchema>;

/** A provider's retrieval function is read-only; it must not learn from this query. */
export const moduleMemorySchema = z.object({
  id: resourceId, text: z.string().trim().min(1).max(2000),
  source: z.object({ title: z.string().trim().min(1).max(300), uri: sourceUrl.optional(),
    reference: z.object({ type: z.string().trim().min(1).max(80), id: resourceId }).strict().optional()
  }).strict(),
  updatedAt: timestamp.optional(), expiresAt: timestamp.optional()
}).strict();
export type ModuleMemory = z.infer<typeof moduleMemorySchema>;
export const moduleMemoryResultSchema = z.object({ memories: z.array(moduleMemorySchema).max(MEMORY_MAX_ITEMS), hasMore: z.boolean().optional(), display: memoryResultDisplaySchema.optional() }).strict();
export const recalledMemorySchema = moduleMemorySchema.extend({ moduleId, moduleTitle: z.string().min(1).max(120) }).strict();
export const memoryProviderStatusSchema = z.object({
  moduleId, title: z.string().min(1).max(120), status: z.enum(['completed', 'failed', 'truncated']),
  count: z.number().int().min(0).max(MEMORY_MAX_ITEMS), detail: z.string().max(300).optional(), display: memoryResultDisplaySchema.optional()
}).strict();
export const memoryRecallSnapshotSchema = z.object({
  version: z.literal(1), retrievedAt: timestamp,
  memories: z.array(recalledMemorySchema).max(MEMORY_MAX_ITEMS).refine(items => JSON.stringify(items).length <= MEMORY_CONTEXT_CHARS, 'Memory context exceeds its budget.'),
  providers: z.array(memoryProviderStatusSchema).max(500), truncated: z.boolean()
}).strict();
export type MemoryRecallSnapshot = z.infer<typeof memoryRecallSnapshotSchema>;

/** Presentation never changes the sourced context saved or supplied to the model. */
export function deriveMemoryPresentation(snapshot: MemoryRecallSnapshot) {
  const providers = snapshot.providers.filter(provider => {
    if (provider.status !== 'completed') return true;
    if (provider.display === 'hide') return false;
    return provider.display === 'show' || provider.count > 0 || snapshot.memories.some(memory => memory.moduleId === provider.moduleId);
  });
  const visibleModules = new Set(providers.map(provider => provider.moduleId));
  const knownModules = new Set(snapshot.providers.map(provider => provider.moduleId));
  const hiddenModules = new Set(snapshot.providers.filter(provider => provider.display === 'hide').map(provider => provider.moduleId));
  // Older snapshots can contain sourced facts without a provider row. Their
  // absence is not a module's request to hide those facts.
  const memories = snapshot.memories.filter(memory => !hiddenModules.has(memory.moduleId) && (visibleModules.has(memory.moduleId) || !knownModules.has(memory.moduleId)));
  return { visible: providers.length > 0 || memories.length > 0 || snapshot.truncated, providers, memories, truncated: snapshot.truncated };
}

/** Invalid historical snapshots are never promoted to live context. */
export function normalizeMemoryRecallSnapshot(value: unknown): MemoryRecallSnapshot | undefined {
  const result = memoryRecallSnapshotSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
