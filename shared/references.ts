import { z } from 'zod';

const resourceId = z.string().min(1).max(128);
export const MAX_MODULE_REFERENCES = 5;
export const moduleReferenceInputSchema = z.object({ moduleId: resourceId, type: z.string().min(1).max(80), id: resourceId }).strict();
export type ModuleReferenceInput = z.infer<typeof moduleReferenceInputSchema>;
export const moduleReferenceSummarySchema = moduleReferenceInputSchema.extend({
  title: z.string().max(300), description: z.string().max(500).optional(), mediaType: z.string().max(160).optional(),
  size: z.number().finite().nonnegative().optional(), icon: z.string().max(40).optional()
}).strict();
export type ModuleReferenceSummary = z.infer<typeof moduleReferenceSummarySchema>;
export const moduleReferenceSchema = moduleReferenceSummarySchema.extend({
  readable: z.boolean(), truncated: z.boolean(), capturedAt: z.string().max(100), text: z.string().max(8000).optional(),
  sourceVersion: z.string().max(200).optional(), sourceUpdatedAt: z.string().max(100).optional(),
  metadata: z.record(z.string().max(80), z.union([z.string().max(1024), z.number().finite(), z.boolean()])).refine(value => Object.keys(value).length <= 20).optional()
}).strict();
export type ModuleReference = z.infer<typeof moduleReferenceSchema>;
export const moduleReferenceInputsSchema = z.array(moduleReferenceInputSchema).max(MAX_MODULE_REFERENCES).refine(items => new Set(items.map(moduleReferenceKey)).size === items.length, 'Eine Referenz darf nur einmal angehängt werden.');

export function moduleReferenceKey(reference: ModuleReferenceInput): string { return JSON.stringify([reference.moduleId, reference.type, reference.id]); }
export function moduleReferenceInput(reference: ModuleReferenceInput): ModuleReferenceInput { return { moduleId: reference.moduleId, type: reference.type, id: reference.id }; }
export function moduleReferenceSummary(reference: ModuleReferenceSummary): ModuleReferenceSummary {
  return moduleReferenceSummarySchema.parse({ ...moduleReferenceInput(reference), title: reference.title, ...(reference.description !== undefined ? { description: reference.description } : {}), ...(reference.mediaType !== undefined ? { mediaType: reference.mediaType } : {}), ...(reference.size !== undefined ? { size: reference.size } : {}), ...(reference.icon !== undefined ? { icon: reference.icon } : {}) });
}

/** Drag payloads identify resources only. The module resolves metadata and content. */
export const MODULE_REFERENCE_DRAG_TYPE = 'application/x-openvibedesk-reference';
export const MODULE_REFERENCE_DRAG_PREFIX = 'openvibedesk-reference:';
type DragData = Pick<DataTransfer, 'getData' | 'setData' | 'effectAllowed'>;
export function writeModuleReferenceDrag(data: DragData, reference: ModuleReferenceInput): void {
  const serialized = JSON.stringify(moduleReferenceInputSchema.parse(moduleReferenceInput(reference)));
  data.setData(MODULE_REFERENCE_DRAG_TYPE, serialized);
  data.setData('text/plain', MODULE_REFERENCE_DRAG_PREFIX + serialized);
  data.effectAllowed = 'copy';
}
export function readModuleReferenceDrag(data: Pick<DataTransfer, 'getData'>): ModuleReferenceInput | undefined {
  const text = data.getData('text/plain');
  const payload = data.getData(MODULE_REFERENCE_DRAG_TYPE) || (text.startsWith(MODULE_REFERENCE_DRAG_PREFIX) ? text.slice(MODULE_REFERENCE_DRAG_PREFIX.length) : '');
  if (!payload || payload.length > 1024) return;
  try { const parsed = moduleReferenceInputSchema.safeParse(JSON.parse(payload)); return parsed.success ? parsed.data : undefined; } catch { return; }
}
