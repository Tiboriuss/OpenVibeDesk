import { z } from 'zod';

export const ATTENTION_PULSE_MS = 10_000;
export const MAX_MODULE_ATTENTION = 8;
export const MAX_ATTENTION = 100;
export const attentionKeySchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const moduleAttentionInputSchema = z.object({
  key: attentionKeySchema,
  message: z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value))
}).strict();
export type ModuleAttentionInput = z.infer<typeof moduleAttentionInputSchema>;
/** Session-local hints only: never mail bodies, tool schemas, credentials or action authority. */
export interface ModuleAttention extends ModuleAttentionInput {
  id: string;
  moduleId: string;
  createdAt: number;
  pulseUntil: number;
}
export const attentionAcknowledgementSchema = z.object({
  moduleId: z.string().min(1).max(128),
  ids: z.array(z.string().uuid()).max(MAX_ATTENTION).optional()
}).strict();
